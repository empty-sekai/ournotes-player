// ModelSession over a synthetic model: a stand-in for Live2D Cubism Core (a few parameters, three drawables whose
// vertices follow ParamAngleX, one of them masked), a prefab with the components the runtime reads, shaders in the
// packed Unity layout, all in memory; drawn into the no-op WebGL2 context of scripts/lib/headless.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { MODEL_FRAME_RATE, ModelSession } from "../../src/live2d/session.js";
import { headlessGL, headlessImages } from "../../scripts/lib/headless.mjs";

const IDS = ["ParamAngleX", "ParamEyeLOpen", "ParamMouthOpenY", "ParamBreath"];
const MIN = [-30, 0, 0, 0], MAX = [30, 1, 1, 1], DEF = [0, 1, 0, 0];
const DRAWABLES = ["ArtMesh0", "ArtMesh1", "ArtMesh2"];
const QUAD = [-0.1, -0.1, 0.1, -0.1, 0.1, 0.1, -0.1, 0.1];

// the stand-in Core: Moc / Model with parameter, part and drawable arrays; update() moves every drawable by
// ParamAngleX / 300 in x (and reports its vertices as changed on every update, as a model in motion does) and sets
// drawable 1's opacity to ParamEyeLOpen
const fakeCore = () => {
  const made = [];
  const core = {
    Version: { csmGetVersion: () => 0x05010000, csmGetLatestMocVersion: () => 5 },
    Moc: { fromArrayBuffer: () => ({ _release() { core.releasedMocs++; } }) },
    Model: {
      fromMoc() {
        const n = DRAWABLES.length;
        const d = {
          count: n, ids: DRAWABLES.slice(), constantFlags: new Uint8Array([4, 4, 4]), dynamicFlags: new Uint8Array([1, 1, 1]),
          opacities: new Float32Array([1, 1, 1]), renderOrders: new Int32Array([2, 0, 1]), maskCounts: new Int32Array([0, 0, 1]),
          masks: [new Int32Array(0), new Int32Array(0), new Int32Array([0])],
          vertexPositions: DRAWABLES.map((_, i) => Float32Array.from(QUAD, (v, k) => v + (k % 2 ? 0 : i * 0.2))),
          vertexUvs: DRAWABLES.map(() => new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])),
          indices: DRAWABLES.map(() => new Uint16Array([0, 1, 2, 0, 2, 3])),
          multiplyColors: new Float32Array(4 * n).fill(1), screenColors: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
          resetDynamicFlags() { for (let i = 0; i < n; i++) this.dynamicFlags[i] &= 1; },
        };
        const m = {
          parameters: { count: IDS.length, ids: IDS.slice(), minimumValues: Float32Array.from(MIN),
                        maximumValues: Float32Array.from(MAX), defaultValues: Float32Array.from(DEF), values: Float32Array.from(DEF) },
          parts: { count: 1, ids: ["Part0"], opacities: new Float32Array([1]) },
          drawables: d,
          canvasinfo: { CanvasWidth: 600, CanvasHeight: 900, CanvasOriginX: 300, CanvasOriginY: 450, PixelsPerUnit: 600 },
          updates: 0,
          update() {
            this.updates++;
            const ax = this.parameters.values[0] / 300;
            for (let i = 0; i < n; i++) {
              d.vertexPositions[i].set(Float32Array.from(QUAD, (v, k) => v + (k % 2 ? 0 : i * 0.2 + ax)));
              d.dynamicFlags[i] |= 32;
            }
            const o = Math.fround(this.parameters.values[1]);
            if (o !== d.opacities[1]) { d.opacities[1] = o; d.dynamicFlags[1] |= 4; }
          },
          release() { core.releasedModels++; },
        };
        made.push(m);
        return m;
      },
    },
    made, releasedModels: 0, releasedMocs: 0,
  };
  return core;
};

const MOC = new Uint8Array([0x4d, 0x4f, 0x43, 0x33, 5, 0, 0, 0, 0, 0, 0, 0]);

// ---- prefab
const fadeData = (name, len, value) => ({
  MotionName: name, FadeInTime: 1, FadeOutTime: 1, MotionLength: len, ParameterFadeInTimes: [-1], ParameterFadeOutTimes: [-1],
  ParameterIds: ["ParamAngleX"], ParameterCurves: [{ m_Curve: [{ time: 0, value, inSlope: 0, outSlope: 0 },
                                                               { time: len, value, inSlope: 0, outSlope: 0 }] }],
});
const clip = (name, id, len, value, opacity) => ({
  clip: name, stopTime: len, loopTime: true, startTime: 0, cycleOffset: 0,
  events: [{ functionName: "InstanceId", intParameter: id }], dense: { curveCount: 0 },
  bindings: [{ path: "Parameters/ParamAngleX", class: "CubismParameter", attribute: "Value" },
             ...(opacity === undefined ? [] : [{ path: "", class: "CubismRenderController", attribute: "Opacity" }])],
  streamed: { curveCount: 0, frames: [] }, constant: [value, ...(opacity === undefined ? [] : [opacity])],
});
const tex = { texture: "textures/texture_00.png", name: "texture_00", width: 4, height: 4, mipCount: 1,
              settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
const material = (keywords) => ({ material: keywords.length ? "LitMasked" : "Lit", shader: { shader: "Live2D Cubism/Lit-URP-ADV-optimize" },
                                  keywords, floats: { _SrcColor: 1, _DstColor: 10, _SrcAlpha: 1, _DstAlpha: 10, _Cull: 0 }, colors: {} });

const prefab = ({ physics = true, mipCount = 1, opacity, missing = false } = {}) => {
  const root = "model";
  const node = (path, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 0,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
  const mb = (cls, fields) => ({ type: "MonoBehaviour", class: cls, ...fields });
  return { key: "model", canvas: {}, nodes: [
    node(root, [
      mb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: -0.41, z: 0 },
                              BaseScale: 1.6, _motionList: [clip("mtn_idle", -1, 2, 0), clip("mtn_turn", -2, 1, 30, opacity)],
                              _expressionList: ["exp_idle", "exp_closed"] }),
      mb("CubismFadeController", { CubismFadeMotionList: { MotionInstanceIds: [-1, -2],
        CubismFadeMotionObjects: [fadeData("mtn_idle", 2, 0), fadeData("mtn_turn", 1, 30)] } }),
      mb("CubismExpressionController", { UseLegacyBlendCalculation: 0, CurrentExpressionIndex: -1, CurrentFadeInTime: -1,
        ExpressionsList: { CubismExpressionObjects: [
          { name: "exp_idle.exp3", FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [] },
          { name: "exp_closed.exp3", FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [
            ...(missing ? [{ Id: "ParamMissing", Value: 1, Blend: 1 }] : []), { Id: "ParamEyeLOpen", Value: 0, Blend: 2 }] }] } }),
      mb("CubismHarmonicMotionController", { BlendMode: 1, ChannelTimescales: [1] }),
      mb("CubismAutoEyeBlinkInput", { Mean: 2.5, MaximumDeviation: 2, Timescale: 10 }),
      mb("CubismEyeBlinkController", { BlendMode: 2, EyeOpening: 1 }),
      mb("CubismMouthController", { BlendMode: 0, MouthOpening: 0 }),
      ...(physics ? [mb("CubismPhysicsController", { _rig: { Fps: 60, Gravity: { x: 0, y: -1 }, Wind: { x: 0, y: 0 }, SubRigs: [] } })] : []),
      mb("CubismRenderController", { _sortingOrder: 0, Opacity: 1 }),
    ]),
    node(`${root}/Parameters`),
    ...IDS.map((id) => node(`${root}/Parameters/${id}`, [mb("CubismParameter", {}),
      ...(id === "ParamEyeLOpen" ? [mb("CubismEyeBlinkParameter", {})] : []),
      ...(id === "ParamBreath" ? [mb("CubismHarmonicMotionParameter", { Channel: 0, Direction: 2, NormalizedOrigin: 0.5,
                                                                         NormalizedRange: 0.5, Duration: 3 })] : [])])),
    node(`${root}/Drawables`),
    ...DRAWABLES.map((id, i) => node(`${root}/Drawables/${id}`, [
      mb("CubismDrawable", { _unmanagedIndex: i }),
      { type: "MeshRenderer", m_Materials: [material(i === 2 ? ["CUBISM_MASK_ON"] : [])] },
      mb("CubismRenderer", { _localSortingOrder: 0, _color: { r: 1, g: 1, b: 1, a: 1 }, _mainTexture: { ...tex, mipCount } }),
    ])),
  ] };
};

// ---- shaders (packed Unity layout)
const program = "#ifdef VERTEX\n#version 300 es\nvoid main() {}\n#endif\n#ifdef FRAGMENT\n#version 300 es\nvoid main() {}\n#endif\n";
const V = (val, name = "") => ({ val, name });
const pass = (blend) => ({ state: {
  rtBlend0: { srcBlend: blend[0], destBlend: blend[1], srcBlendAlpha: blend[2], destBlendAlpha: blend[3], blendOp: V(0),
              blendOpAlpha: V(0), colMask: V(15) },
  zTest: V(4), zWrite: V(0), culling: V(0, "_Cull"), offsetFactor: V(0), offsetUnits: V(0), stencilRef: V(0),
  stencilReadMask: V(255), stencilWriteMask: V(255), rtSeparateBlend: false, alphaToMask: V(0),
  stencilOpFront: { comp: V(8), pass: V(0), fail: V(0), zFail: V(0) }, stencilOpBack: { comp: V(8), pass: V(0), fail: V(0), zFail: V(0) },
} });
const litPass = pass([V(1, "_SrcColor"), V(10, "_DstColor"), V(1, "_SrcAlpha"), V(10, "_DstAlpha")]);
const maskPass = pass([V(1), V(1), V(1), V(1)]);

const modelFiles = ({ format = 1, physics = true, mipCount = 1, opacity, missing = false } = {}) => {
  const lit = "Live2D Cubism/Lit-URP-ADV-optimize", mask = "Live2D Cubism/Mask";
  const text = {
    "model.json": JSON.stringify({ format, name: "model", moc3: "model.moc3", prefab: "model.prefab.json",
      shaders: "shaders/shaders.json", resources: {
        cubismMask: { material: "Mask", shader: { shader: mask }, keywords: [], floats: { _Cull: 0 }, colors: {} },
        cubismMaskCulling: { material: "MaskCulling", shader: { shader: mask }, keywords: [], floats: { _Cull: 1 }, colors: {} } } }),
    "model.prefab.json": JSON.stringify(prefab({ physics, mipCount, opacity, missing })),
    "shaders/shaders.json": JSON.stringify([
      { name: lit, parsed: "lit.json", variants: [{ file: "lit/0.glsl", subShader: 0, pass: 0, keywords: [] },
                                                   { file: "lit/1.glsl", subShader: 0, pass: 0, keywords: ["CUBISM_MASK_ON"] }] },
      { name: mask, parsed: "mask.json", variants: [{ file: "mask/0.glsl", subShader: 0, pass: 0, keywords: [] }] }]),
    "shaders/lit.json": JSON.stringify({ properties: [], subShaders: [{ tags: { tags: [] }, passes: [litPass] }] }),
    "shaders/mask.json": JSON.stringify({ properties: [], subShaders: [{ tags: { tags: [] }, passes: [maskPass] }] }),
    "shaders/lit/0.glsl": program, "shaders/lit/1.glsl": program, "shaders/mask/0.glsl": program,
  };
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4]);
  return headlessImages(new AssetStore({ text, bytes: { "model.moc3": MOC, "textures/texture_00.png": png },
                                         info: { id: "model", model: { group: "test" } } }));
};

const withCore = async (fn) => {
  const saved = globalThis.Live2DCubismCore, core = fakeCore();
  globalThis.Live2DCubismCore = core;
  try { return await fn(core); } finally { if (saved) globalThis.Live2DCubismCore = saved; else delete globalThis.Live2DCubismCore; }
};

const open = (opts = {}) => {
  const calls = [];
  const gl = headlessGL({ width: 200, height: 300, onCall: (name) => calls.push(name) });
  return { gl, calls, create: () => ModelSession.create({ gl, assets: modelFiles(), seed: 1, ...opts }) };
};

test("a model loads, warms up and is shown with its default motion and expression", () => withCore(async (core) => {
  const { create } = open();
  const s = await create();
  assert.equal(MODEL_FRAME_RATE, 30);
  assert.equal(s.name, "model");
  assert.deepEqual(s.motions, ["mtn_idle", "mtn_turn"]);
  assert.deepEqual(s.expressions, ["exp_idle", "exp_closed"]);
  assert.equal(s.motion, "mtn_idle");
  assert.equal(s.expression, "exp_idle");
  assert.deepEqual(s.info, { id: "model", model: { group: "test" } });
  assert.ok(s.loop.frameCount > 8 && s.loop.frameCount < 20, `load frames ${s.loop.frameCount}`);
  assert.equal(s.character.isShowing, true);
  assert.equal(s.physics, true);
  assert.equal(s.breath, true);
  // the masked drawable forms one junction, drawn into channel 0 at full tile size
  assert.equal(s.character.junctions.length, 1);
  assert.deepEqual(s.character.junctions[0].tile, [0, 0, 0, 1]);
  assert.equal(s.character.renderers[0].isMaskSource, true);
  await s.dispose();
  assert.equal(core.releasedModels, 1);
  assert.equal(core.releasedMocs, 1);
}));

test("the display follows the parameters two model updates later", () => withCore(async (core) => {
  const { create } = open();
  const s = await create();
  const r = s.character.renderers[0], shown = () => s.character.displayed(r).pos[0];
  const coreX = () => core.made[0].drawables.vertexPositions[0][0];
  const rest = shown();
  s.playMotion("mtn_turn", { fade: 0 });
  const updated = [];
  for (let k = 0; k < 6; k++) {
    await s.step();                                 // step 0: PlayMotion, the Animator writes ParamAngleX = 30
    updated.push(coreX());                          // the Core result of this step's LateUpdate
    if (k === 0) assert.equal(s.character.params.value[0], 30);
    if (k >= 2) assert.equal(shown(), updated[k - 2], `step ${k}`);
    else assert.equal(shown(), rest, `step ${k}`);
  }
  assert.ok(Math.abs(updated[0] - (rest + 0.1)) < 1e-6, "ParamAngleX 30 moves the mesh by 0.1");
  await s.dispose();
}));

test("a motion is followed by the default motion, or replayed with loop", () => withCore(async () => {
  const { create } = open();
  const s = await create();
  s.playMotion("mtn_turn");
  await s.step();
  assert.equal(s.motionPlaying, true);
  for (let i = 0; i < 2 * MODEL_FRAME_RATE && s.motion === "mtn_turn"; i++) await s.step();
  assert.equal(s.motion, "mtn_idle");
  s.playMotion("mtn_turn", { loop: true });
  let starts = 0, prev = null;
  for (let i = 0; i < 4 * MODEL_FRAME_RATE; i++) {
    await s.step();
    const pm = s.character.layer.list[s.character.layer.list.length - 1];
    if (pm !== prev) { starts++; prev = pm; }
  }
  assert.equal(s.motion, "mtn_turn");
  assert.ok(starts >= 3, `starts ${starts}`);
  assert.throws(() => s.playMotion("mtn_none"), /no motion "mtn_none"/);
  assert.throws(() => s.setExpression("exp_none"), /no expression "exp_none"/);
  await s.dispose();
}));

test("expressions fade in; eye blink intervals follow the seed", () => withCore(async () => {
  const run = async (seed, expr) => {
    const { gl } = open();
    const s = await ModelSession.create({ gl, assets: modelFiles(), seed });
    if (expr) s.setExpression(expr, { fade: 0.5 });
    const eye = [];
    for (let i = 0; i < 12 * MODEL_FRAME_RATE; i++) { await s.step({ draw: false }); eye.push(s.character.params.value[1]); }
    const e = s.expression;
    await s.dispose();
    return { eye, e };
  };
  const a = await run(1), b = await run(1), c = await run(7);
  assert.deepEqual(a.eye, b.eye);
  assert.notDeepEqual(a.eye, c.eye);
  assert.ok(a.eye.some((v) => v < 0.1), "the eye closes");
  const x = await run(1, "exp_closed");
  assert.equal(x.e, "exp_closed");
  assert.equal(x.eye[x.eye.length - 1], 0);          // Multiply 0 on ParamEyeLOpen
}));

test("render draws the mask texture when flagged and every visible drawable in sorting order", () => withCore(async () => {
  const { create, calls } = open();
  const s = await create();
  calls.length = 0;
  await s.step();
  const draws = calls.filter((c) => c === "drawElements").length;
  assert.equal(draws, 1 + 3);                       // one mask draw, three drawables
  const order = s.drawing.items([]).sort((a, b) => a.sortingOrder - b.sortingOrder).map((it) => it.transform.name);
  assert.deepEqual(order, ["ArtMesh1", "ArtMesh2", "ArtMesh0"]);   // Core render orders 2, 0, 1
  calls.length = 0;
  s.render();                                       // the mask is not flagged again until the next LateUpdate
  assert.equal(calls.filter((c) => c === "drawElements").length, 3);
  s.resize(640, 360);
  s.render();
  assert.deepEqual([s.gl.canvas.width, s.gl.canvas.height], [640, 360]);
  await s.dispose();
}));

test("physics and breath switch off and on", () => withCore(async () => {
  const { create } = open({ physics: false, breath: false });
  const s = await create();
  assert.equal(s.physics, false);
  assert.equal(s.breath, false);
  const breath = async (n) => { const v = []; for (let i = 0; i < n; i++) { await s.step({ draw: false }); v.push(s.character.params.value[3]); } return v; };
  const off = await breath(30);
  assert.ok(off.every((v) => v === off[0]), "breath stopped: ParamBreath constant");
  s.setBreath(true); s.setPhysics(true);
  const on = await breath(3 * MODEL_FRAME_RATE);     // one cycle of the 3 s breath
  assert.equal(s.breath, true);
  assert.equal(s.physics, true);
  assert.ok(new Set(on).size > 10, "breath on: ParamBreath moves");
  await s.dispose();
}));

test("a model without CubismPhysicsController has no physics", () => withCore(async () => {
  const s = await ModelSession.create({ gl: headlessGL(), assets: modelFiles({ physics: false }), seed: 1 });
  assert.equal(s.character.hasPhysics, false);
  assert.equal(s.physics, false);
  s.setPhysics(true);
  for (let i = 0; i < 10; i++) await s.step();
  assert.equal(s.physics, false);
  await s.dispose();
}));

test("a clip curve on CubismRenderController.Opacity sets the model opacity, clamped to [0, 1]", () => withCore(async () => {
  for (const [curve, shown] of [[0.25, 0.25], [1.5, 1], [-2, 0]]) {
    const s = await ModelSession.create({ gl: headlessGL(), assets: modelFiles({ opacity: curve }), seed: 1 });
    assert.equal(s.character.rc.opacity, 1);
    s.playMotion("mtn_turn");
    for (let i = 0; i < 3; i++) await s.step();
    assert.equal(s.character.rc.opacity, Math.fround(shown));
    assert.equal(s.drawing._mpb(s.character.renderers[0]).cubism_ModelOpacity, Math.fround(shown));
    await s.dispose();
  }
}));

test("an expression parameter the model lacks is skipped", () => withCore(async () => {
  const run = async (missing) => {
    const s = await ModelSession.create({ gl: headlessGL(), assets: modelFiles({ missing }), seed: 1 });
    assert.deepEqual(s.character.expressions[1].dest.map((d) => s.character.params.ids[d.i]), ["ParamEyeLOpen"]);
    s.setExpression("exp_closed");
    const v = [];
    for (let i = 0; i < 30; i++) { await s.step(); v.push(s.character.params.value[s.character.params.idx("ParamEyeLOpen")]); }
    await s.dispose();
    return v;
  };
  const a = await run(true);
  assert.deepEqual(a, await run(false));
  assert.ok(a[a.length - 1] < 0.5);
}));

test("a mipmapped texture gets its other levels generated", () => withCore(async () => {
  for (const mipCount of [1, 3]) {
    const calls = [];
    const gl = headlessGL({ width: 200, height: 300, onCall: (name) => calls.push(name) });
    const s = await ModelSession.create({ gl, assets: modelFiles({ mipCount }), seed: 1 });
    assert.equal(calls.filter((n) => n === "generateMipmap").length, mipCount > 1 ? 1 : 0);
    await s.dispose();
  }
}));

test("errors: no Core, unknown format, unknown initial motion; a disposed session", async () => {
  const saved = globalThis.Live2DCubismCore;
  delete globalThis.Live2DCubismCore;
  try {
    await assert.rejects(open().create(), /Live2D Cubism Core is not loaded/);
  } finally { if (saved) globalThis.Live2DCubismCore = saved; }
  await withCore(async () => {
    const gl = headlessGL();
    await assert.rejects(ModelSession.create({ gl, assets: modelFiles({ format: 2 }) }), /format 2 is not supported/);
    await assert.rejects(ModelSession.create({ gl, assets: modelFiles(), motion: "mtn_none" }), /no motion "mtn_none"/);
    const s = await ModelSession.create({ gl, assets: modelFiles(), motion: "mtn_turn", expression: "exp_closed" });
    assert.equal(s.motion, "mtn_turn");
    assert.equal(s.expression, "exp_closed");
    await s.dispose();
    await assert.rejects(s.step(), /disposed/);
    assert.throws(() => s.playMotion("mtn_idle"), /disposed/);
    const again = await ModelSession.create({ gl, assets: modelFiles() });   // the context is free again
    await again.dispose();
  });
});
