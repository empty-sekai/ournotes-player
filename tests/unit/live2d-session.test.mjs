// ModelSession over the synthetic model of live2d-fixture.mjs (its product form) and the stand-in for Live2D Cubism
// Core, drawn into the no-op WebGL2 context of scripts/lib/headless.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIT, modelFiles, withCore } from "./live2d-fixture.mjs";
import { MODEL_FRAME_RATE, ModelSession } from "../../src/live2d/session.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

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
  assert.deepEqual(s.info, { schema: "nnnotes.product/1", product: "live2d.model", subject: "model" });
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

test("errors: no Core, unknown format, unknown initial motion; a disposed session; model.json checks", async () => {
  const saved = globalThis.Live2DCubismCore;
  delete globalThis.Live2DCubismCore;
  try {
    await assert.rejects(open().create(), /Live2D Cubism Core is not loaded/);
  } finally { if (saved) globalThis.Live2DCubismCore = saved; }
  await withCore(async () => {
    const gl = headlessGL();
    const edit = (json) => ModelSession.create({ gl, assets: modelFiles({ json }) });
    await assert.rejects(edit((m) => ({ ...m, format: 2 })), /model\.json: format 2 is not supported \(3 expected\)/);
    await assert.rejects(edit(({ motionSync, ...m }) => m), /model\.json: "motionSync" missing/);
    await assert.rejects(edit((m) => ({ ...m, moc: "CAB-test:999" })), /model\.json: object not found: CAB-test:999/);
    await assert.rejects(edit((m) => ({ ...m, prefab: m.moc })), /model\.json: CAB-test:\d+: a MonoBehaviour, not a GameObject/);
    await assert.rejects(edit((m) => ({ ...m, bindings: {} })), /mtn_idle: no names for its bindings/);
    await assert.rejects(edit((m) => ({ ...m, shaders: { [LIT]: m.shaders[LIT] } })), /mask material Mask: not drawn with Live2D Cubism\/Mask/);
    await (await ModelSession.create({ gl, assets: modelFiles({ motionSync: true }) })).dispose();
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

test("a session creates no AudioContext and deletes the GL objects it created on dispose", () => withCore(async () => {
  const saved = { ac: globalThis.AudioContext, gl2: globalThis.WebGL2RenderingContext };
  globalThis.AudioContext = class { constructor() { throw new Error("an AudioContext was created"); } };
  globalThis.WebGL2RenderingContext = class {};
  try {
    // a WebGL2RenderingContext (so the session tracks its objects) over the no-op context, recording creates and deletes
    const base = headlessGL({ width: 200, height: 300 }), made = new Set(), deleted = new Set();
    const target = Object.create(globalThis.WebGL2RenderingContext.prototype);
    const gl = new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k];
        const v = base[k];
        if (typeof v !== "function") return v;
        return (...a) => {
          const r = v(...a);
          if (typeof k === "string" && k.startsWith("create") && r) made.add(r);
          if (typeof k === "string" && k.startsWith("delete") && a[0]) deleted.add(a[0]);
          return r;
        };
      },
    });
    const s = await ModelSession.create({ gl, assets: modelFiles(), seed: 1 });
    for (let i = 0; i < 5; i++) await s.step();
    s.render();
    assert.ok(made.size > 10);
    assert.ok(Object.keys(target).length > 0, "the create / delete methods are wrapped while the session lives");
    await s.dispose();
    assert.deepEqual([...made].filter((o) => !deleted.has(o)), []);
    assert.deepEqual(Object.keys(target), [], "the wrappers are removed");
  } finally {
    for (const [k, v] of [["AudioContext", saved.ac], ["WebGL2RenderingContext", saved.gl2]])
      if (v) globalThis[k] = v; else delete globalThis[k];
  }
}));

test("motion notifications: the first motion's start, the ends, the default motion's return and loop replays", () => withCore(async () => {
  const events = [];
  const { gl } = open();
  let s = null;
  const log = (type, detail) => events.push([type, detail.name, detail.loop, s ? s.motion : null]);
  s = await ModelSession.create({ gl, assets: modelFiles(), seed: 1, onMotion: log });
  assert.deepEqual(events, [["motionstart", "mtn_idle", true, null]]);     // the In's motion; the warmup is not reported
  events.length = 0;
  s.playMotion("mtn_turn");
  for (let i = 0; i < 3 * MODEL_FRAME_RATE && events.length < 4; i++) await s.step();
  // the request starts mtn_turn; the idle fades out under it and ends with it; the default motion follows
  assert.deepEqual(events, [["motionstart", "mtn_turn", false, "mtn_turn"], ["motionend", "mtn_idle", undefined, "mtn_turn"],
                            ["motionend", "mtn_turn", undefined, "mtn_turn"], ["motionstart", "mtn_idle", true, "mtn_idle"]]);
  assert.equal(s.motionPlaying, false);
  events.length = 0;
  s.playMotion("mtn_turn", { loop: true });
  for (let i = 0; i < 4 * MODEL_FRAME_RATE; i++) await s.step();
  const turns = events.filter(([t, n]) => t === "motionstart" && n === "mtn_turn");
  assert.ok(turns.length >= 3 && turns.every(([, , loop]) => loop === true), `loop starts ${turns.length}`);
  const i2 = events.findIndex((e, i) => i > 0 && e[0] === "motionstart");
  assert.deepEqual(events[i2 - 1].slice(0, 2), ["motionend", "mtn_turn"]);  // a replay follows the end of the last run
  // the callback can be replaced or removed
  const other = [];
  s.onmotion = (type, detail) => other.push([type, detail.name]);
  s.playMotion("mtn_idle");
  await s.step();
  assert.deepEqual(other[other.length - 1], ["motionstart", "mtn_idle"]);
  s.onmotion = null;
  const n = other.length;
  s.playMotion("mtn_turn");
  await s.step();
  assert.equal(other.length, n);
  await s.dispose();
}));

test("ModelPlayer: motionstart comes before ready, then motionstart / motionend follow the motions", () => withCore(async () => {
  const { ModelPlayer } = await import("../../src/live2d/player.js");
  const doc = { defaultView: { devicePixelRatio: 1 } };
  const el = (tag) => ({
    tagName: tag.toUpperCase(), style: {}, className: "", textContent: "", hidden: false, clientHeight: 300, children: [],
    ownerDocument: doc, append(...c) { this.children.push(...c); }, remove() {}, addEventListener() {}, removeEventListener() {},
    attachShadow() { return el("#shadow-root"); }, getBoundingClientRect: () => ({ width: 200, height: 300 }),
    getContext: () => headlessGL({ width: 200, height: 300 }),
  });
  doc.createElement = el;
  const frames = [], saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  globalThis.cancelAnimationFrame = () => {};
  try {
    const events = [];
    const on = Object.fromEntries(["ready", "motionstart", "motionend"].map((t) => [t, (e) => events.push([t, e.detail && e.detail.name])]));
    const p = await ModelPlayer.create(el("div"), { assets: modelFiles(), seed: 1, on });
    assert.deepEqual(events, [["motionstart", "mtn_idle"], ["ready", null]]);
    assert.deepEqual([p.looping, p.seed, p.time], [false, 1, p.session.time]);
    assert.ok(p.time > 0);
    p.playMotion("mtn_turn");
    let now = performance.now();                                       // the player's clock
    for (let i = 0; i < 3 * MODEL_FRAME_RATE && frames.length; i++) { now += 1000 / MODEL_FRAME_RATE; await frames.shift()(now); }
    assert.deepEqual(events.slice(2, 6), [["motionstart", "mtn_turn"], ["motionend", "mtn_idle"], ["motionend", "mtn_turn"],
                                          ["motionstart", "mtn_idle"]]);
    await p.dispose();
  } finally {
    for (const [k, v] of [["requestAnimationFrame", saved.raf], ["cancelAnimationFrame", saved.caf]])
      if (v) globalThis[k] = v; else delete globalThis[k];
  }
}));
