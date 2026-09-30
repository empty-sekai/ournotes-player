// MotionSync owns native contexts and the pointer buffers made by the SDK's ToPointer helpers.
// Synthetic Core tracks those allocations; MOTIONSYNC_CORE optionally runs the same lifecycle on the real Core.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { Live2DCharacter } from "../../src/live2d/character.js";
import { CubismMotionSyncController, motionSyncCore } from "../../src/live2d/motionsync.js";

const setting = () => {
  const refs = ["ParamMouthOpenY", "ParamMouthForm"].map((id) => ({ gameObject: `model/Parameters/${id}` }));
  const vowels = [["Silence", [0, 0]], ["A", [1, 1]], ["I", [0.4, 1]], ["U", [0.4, -1]], ["E", [0.7, 1]], ["O", [1, -1]]];
  return {
    AnalysisType: 0, EmphasisLevel: 0.2,
    PostProcessing: { SampleRate: 30, BlendRatio: 0.5, Smoothing: 1 },
    CubismParameters: refs.map((Parameter) => ({ Parameter, Smooth: 10, Damper: 0.001 })),
    AudioParameters: vowels.map(([Id]) => ({ Id, Scale: 1, Enabled: true })),
    Mappings: vowels.map(([AudioParameterId, values]) => ({ AudioParameterId,
      Targets: refs.map((Parameter, i) => ({ Parameter, Value: values[i] })) })),
  };
};
const controller = (core) => {
  const ids = ["ParamMouthOpenY", "ParamMouthForm"];
  const index = new Map(ids.map((id, i) => [id, i]));
  const params = { ids, index, idx: (id) => index.get(id), value: new Float32Array(2),
    min: [0, -1], max: [1, 1], def: [0, 0] };
  return new CubismMotionSyncController({ IsMotionSyncEnabled: true }, setting(), params,
    { deltaTime: 1 / 30, fixedDelta: 1 / 30, frameCount: 1 }, core);
};
// The release entry point used by both ModelSession.dispose and StorySession.dispose.
const character = (motionSync) => Object.assign(Object.create(Live2DCharacter.prototype), {
  motionSync, alive: true, angle: { tweens: [] }, look: { tweens: [] }, core: { release() {} },
});

const fakeCore = ({ failCreate = false, failConfig = false } = {}) => {
  let next = 4, resultReady = false, contexts = 0;
  const live = new Map(), memory = new Map(), events = [];
  const core = { live, events, contexts: () => contexts, csmMotionSyncTrue: 1 };
  const T = core.ToPointer = {
    Malloc(size) {
      if (resultReady && failConfig) throw new Error("allocation failed");
      const p = next; next += Math.max(4, size);
      live.set(p, size); events.push(["allocate", p]);
      return p;
    },
    Free(p) { assert.ok(live.delete(p), `unknown or twice-freed pointer ${p}`); events.push(["free", p]); },
    AddValuePtrInt32(p, offset, v) { memory.set(p + offset, v); },
    AddValuePtrFloat(p, offset, v) { memory.set(p + offset, v); },
    ConvertMappingInfoCriToFloat32Array(out, p, audioId, ids, vals, n, scale, enabled) {
      out.set([T.Malloc(audioId.length * 4 + 1), T.Malloc(ids.join("").length * 4 + ids.length),
        T.Malloc(vals.length * 4), n, scale, enabled]);
      return out;
    },
    ConvertContextConfigCriToInt32Array(out) { return out; },
    ConvertAnalysisResultToInt32Array(out, p, n) { out.set([T.Malloc(n * 4), n, 0]); memory.set(p, out[0]); resultReady = true; return out; },
    GetProcessedSampleCountFromAnalysisResult(p) { return memory.get(p); },
    GetValuesFromAnalysisResult(p, n) { return Array.from({ length: n }, (_, i) => i ? -0.2 : 0.75); },
  };
  core.Context = class {
    csmMotionSyncCreate() {
      if (failCreate) throw new Error("create failed");
      this.live = true; contexts++; events.push(["create"]);
    }
    csmMotionSyncDelete() { if (this.live) { this.live = false; contexts--; events.push(["delete"]); } }
    csmMotionSyncGetRequireSampleCount() { return 4; }
    csmMotionSyncAnalyze() { assert.equal(this.live, true); return 1; }
  };
  return core;
};
const analyze = (c) => { c.ring.push(new Float32Array(5)); c._analyze(); };

test("MotionSync: character release returns every SDK allocation and native context, repeatedly", () => {
  const core = fakeCore();
  for (let i = 0; i < 12; i++) {
    const c = controller(core);
    analyze(c);
    assert.equal(core.contexts(), 1);
    assert.ok(core.live.size > 0);
    character(c).release();
    assert.equal(core.contexts(), 0, "a released character must delete its MotionSync context");
    assert.equal(core.live.size, 0, "including the nested mapping strings, values and analysis-result buffer");
  }
});

test("MotionSync: voices reuse their context; release is idempotent and deletes before freeing pointers", () => {
  const core = fakeCore(), c = controller(core), ch = character(c);
  analyze(c);
  const native = c.context, allocated = core.live.size;
  c.setSource({ pull: () => new Float32Array(0) });
  c.setSource(null);
  analyze(c);
  assert.equal(c.context, native);
  assert.equal(core.live.size, allocated);
  ch.release();
  ch.release();
  assert.equal(core.events.filter(([e]) => e === "delete").length, 1);
  const deleted = core.events.findIndex(([e]) => e === "delete");
  assert.ok(deleted < core.events.findIndex(([e]) => e === "free"));
  assert.equal(core.live.size, 0);
});

test("MotionSync: replacing the PCM buffer does not free it twice at release", () => {
  const core = fakeCore(), c = controller(core);
  analyze(c);
  c.context.analyze(new Float32Array(16));
  assert.equal(core.events.filter(([e]) => e === "free").length, 1);
  character(c).release();
  assert.equal(core.live.size, 0);
  assert.equal(core.contexts(), 0);
});

for (const [label, options, error] of [["context creation", { failCreate: true }, /create failed/],
                                    ["configuration allocation", { failConfig: true }, /allocation failed/]]) {
  test(`MotionSync: ${label} failure releases partial state`, () => {
    const core = fakeCore(options), c = controller(core);
    assert.throws(() => analyze(c), error);
    assert.equal(core.live.size, 0);
    assert.equal(core.contexts(), 0);
    character(c).release();
  });
}

test("MotionSync: releasing a controller before analysis or without Core needs no allocations", () => {
  const core = fakeCore();
  const c = controller(core);
  character(c).release();
  c._analyze();
  assert.equal(core.live.size, 0);
  assert.equal(core.contexts(), 0);
  character(controller(null)).release();
});

const CORE = process.env.MOTIONSYNC_CORE;
test("MotionSync: real Core returns all pointer buffers and contexts over 12 character replacements",
  { skip: CORE ? false : "MOTIONSYNC_CORE is not set (external Live2D MotionSync Core)" }, async () => {
  const saved = globalThis.Live2DCubismMotionSyncCore;
  const MS = new Function("process", "require", "module", "__dirname", `${fs.readFileSync(CORE, "utf8")}\n;return Live2DCubismMotionSyncCore;`)();
  globalThis.Live2DCubismMotionSyncCore = MS;
  const T = MS.ToPointer, malloc = T.Malloc, free = T.Free;
  const create = MS.Context.prototype.csmMotionSyncCreate, remove = MS.Context.prototype.csmMotionSyncDelete;
  const live = new Set();
  let contexts = 0;
  try {
    await motionSyncCore();
    T.Malloc = (n) => { const p = malloc(n); if (p) live.add(p); return p; };
    T.Free = (p) => { if (p) assert.ok(live.delete(p), `unknown or twice-freed pointer ${p}`); free(p); };
    MS.Context.prototype.csmMotionSyncCreate = function (...args) { create.apply(this, args); contexts++; };
    MS.Context.prototype.csmMotionSyncDelete = function () { remove.call(this); contexts--; };
    for (let i = 0; i < 12; i++) {
      const c = controller(MS);
      c._analyze();
      const required = c.context.requireSampleCount();
      c.ring.push(new Float32Array(required * 2 + 1));
      c._analyze();
      assert.ok(Array.from(c.result).every(Number.isFinite));
      character(c).release();
      assert.deepEqual({ contexts, pointers: live.size }, { contexts: 0, pointers: 0 },
        `native resources after replacement ${i + 1}`);
    }
  } finally {
    T.Malloc = malloc; T.Free = free;
    MS.Context.prototype.csmMotionSyncCreate = create; MS.Context.prototype.csmMotionSyncDelete = remove;
    if (saved === undefined) delete globalThis.Live2DCubismMotionSyncCore;
    else globalThis.Live2DCubismMotionSyncCore = saved;
  }
});
