// Live2D runtime parts without a Cubism Core: parameter math, clips, fade data, physics, Core access. Synthetic inputs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CubismModel, cubismCore } from "../../src/live2d/cubism.js";
import { Live2DParameterStore, Live2DParameters, clampF, easeSine, hermite } from "../../src/live2d/math.js";
import { Live2DClip, Live2DFadeMotion } from "../../src/live2d/motion.js";
import { Live2DPhysics } from "../../src/live2d/physics.js";

const F = Math.fround;

const fakeCore = (ids, min, max, def) => ({
  parameters: { ids, count: ids.length, minimumValues: min, maximumValues: max, defaultValues: def, values: Float32Array.from(def) },
});

test("easeSine is 0 and 1 outside [0, 1] and the cosine ease inside", () => {
  assert.equal(easeSine(-0.5), 0);
  assert.equal(easeSine(1.5), 1);
  assert.equal(easeSine(0), 0);
  assert.equal(easeSine(1), F(0.5 - 0.5 * Math.cos(F(3.1415927))));
  assert.equal(easeSine(0.5), F(0.5 - 0.5 * Math.cos(F(0.5 * F(3.1415927)))));
});

test("clampF maps NaN to the minimum", () => {
  assert.equal(clampF(NaN, -1, 2), -1);
  assert.equal(clampF(5, -1, 2), 2);
  assert.equal(clampF(-5, -1, 2), -1);
  assert.equal(clampF(0.5, -1, 2), 0.5);
});

test("hermite clamps outside the keys, meets the keys and interpolates in float32", () => {
  const keys = [{ time: 0, value: 0, inSlope: 0, outSlope: 0 }, { time: 1, value: 10, inSlope: 0, outSlope: 0 }];
  assert.equal(hermite(keys, -1), 0);
  assert.equal(hermite(keys, 2), 10);
  assert.equal(hermite(keys, 0.5), 5);
  const v = hermite(keys, 0.25);
  assert.equal(v, F(v));
  assert.ok(v > 0 && v < 5);
  const step = [{ time: 0, value: 3, inSlope: 0, outSlope: Infinity }, { time: 1, value: 7, inSlope: 0, outSlope: 0 }];
  assert.equal(hermite(step, 0.5), 3);              // an infinite slope holds the left key
});

test("parameter writes clamp to the moc3 range (override, add, multiply) and the store restores", () => {
  const P = new Live2DParameters(fakeCore(["A", "B"], [-1, 0], [1, 10], [0, 5]));
  assert.equal(P.idx("B"), 1);
  assert.throws(() => P.idx("C"), /not in model/);
  P.override(0, 3, 1);
  assert.equal(P.value[0], 1);
  P.override(1, 9, 0.5);
  assert.equal(P.value[1], F(F(9 * 0.5) + F(0.5 * 5)));
  P.value[1] = 4; P.add(1, 2, 1);
  assert.equal(P.value[1], 6);
  P.multiply(1, 0.5, 1);
  assert.equal(P.value[1], 3);
  const parts = new Float32Array([1, 0.5]);
  const S = new Live2DParameterStore(P, parts);
  P.value[0] = -0.5; P.value[1] = 8; parts[0] = 0;
  S.restore();
  assert.deepEqual([...P.value], [1, 3]);
  assert.deepEqual([...parts], [1, 0.5]);
});

const clipData = (extra = {}) => ({
  clip: "mtn_test", stopTime: 2, loopTime: true, startTime: 0, cycleOffset: 0,
  events: [{ functionName: "InstanceId", intParameter: -7 }],
  dense: { curveCount: 0 },
  bindings: [{ path: "Parameters/A", class: "CubismParameter", attribute: "Value" },
             { path: "Parameters/B", class: "CubismParameter", attribute: "Value" }],
  streamed: { curveCount: 1, frames: [[0, [[0, 0, 0, 1, 0]]], [1, [[0, 0, 0, 0, 1]]]] },
  constant: [4],
  ...extra,
});

test("a clip writes its streamed cubic keys and constants raw, wrapped past its length", () => {
  const P = new Live2DParameters(fakeCore(["A", "B"], [-10, -10], [10, 10], [0, 0]));
  const c = new Live2DClip(clipData(), P);
  assert.equal(c.instanceId, -7);
  const v = new Float32Array(2);
  c.write(0.5, v);
  assert.deepEqual([...v], [0.5, 4]);                // segment 0: c2 x + c3 with c2 = 1
  c.write(1.5, v);
  assert.equal(v[0], 1);                              // segment 1: constant 1
  c.write(2.5, v);                                    // past the length: 0.5 wrapped
  assert.equal(v[0], 0.5);
  assert.equal(new Live2DClip(clipData({ loopTime: false }), P).localTime(2.5), 2);
  assert.throws(() => new Live2DClip(clipData({ dense: { curveCount: 1 } }), P), /dense/);
  assert.throws(() => new Live2DClip(clipData({ bindings: [{ path: "X", class: "Transform", attribute: "m_LocalPosition" }] }), P),
                /binding/);
});

test("a clip skips unbound curves and writes the model curves' controller fields", () => {
  const P = new Live2DParameters(fakeCore(["A", "B"], [-10, -10], [10, 10], [0, 0]));
  const c = new Live2DClip(clipData({
    bindings: [{ path: "", class: "CubismEyeBlinkController", attribute: "EyeOpening" },
               { path: null, class: "CubismParameter", attribute: null },
               { path: "Parameters/B", class: "CubismParameter", attribute: "Value" },
               { path: "", class: "CubismMouthController", attribute: "MouthOpening" }],
    streamed: { curveCount: 2, frames: [[0, [[0, 0, 0, 1, 0], [1, 0, 0, 0, 9]]], [1, [[0, 0, 0, 0, 1], [1, 0, 0, 0, 9]]]] },
    constant: [4, 0.25],
  }), P);
  assert.equal(c.streamed.length, 0);
  assert.equal(c.fieldCurves.length, 1);
  const v = new Float32Array(2), fields = { eyeOpening: 1, mouthOpening: 0 };
  c.write(0.5, v, fields);
  assert.deepEqual([...v], [0, 4]);                   // the unbound curve writes nothing
  assert.deepEqual(fields, { eyeOpening: 0.5, mouthOpening: 0.25 });
  c.write(0.5, v);                                    // without fields only the parameters are written
});

test("fade motion data resolves curves to parameters and skips unknown ids", () => {
  const P = new Live2DParameters(fakeCore(["A", "B"], [-1, -1], [1, 1], [0, 0]));
  const key = [{ time: 0, value: 1, inSlope: 0, outSlope: 0 }];
  const M = new Live2DFadeMotion({ MotionName: "m", FadeInTime: 1, FadeOutTime: 1, MotionLength: 2,
                                   ParameterFadeInTimes: [-1, -1], ParameterFadeOutTimes: [-1, -1],
                                   ParameterIds: ["B", "Missing"], ParameterCurves: [{ m_Curve: key }, { m_Curve: key }] }, P);
  assert.deepEqual([...M.curveOf.keys()], [1]);
  assert.equal(M.curveOf.get(1).k, 0);
});

const rig = () => ({
  Fps: 60, Gravity: { x: 0, y: -1 }, Wind: { x: 0, y: 0 },
  SubRigs: [{
    Input: [{ SourceId: "In", Weight: 100, SourceComponent: 0, IsInverted: false }],
    Output: [{ DestinationId: "Out", ParticleIndex: 1, SourceComponent: 2, TranslationScale: { x: 0, y: 0 }, AngleScale: 10,
               Weight: 100, IsInverted: false }],
    Particles: [{ InitialPosition: { x: 0, y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
                { InitialPosition: { x: 0, y: 3 }, Mobility: 0.95, Delay: 0.9, Acceleration: 1.5, Radius: 3 }],
    Normalization: { Position: { Minimum: -10, Maximum: 10, Default: 0 }, Angle: { Minimum: -10, Maximum: 10, Default: 0 } },
  }],
});

test("physics at rest stays at rest; a moved input swings the output within its range and settles", () => {
  const P = new Live2DParameters(fakeCore(["In", "Out"], [-10, -30], [10, 30], [0, 0]));
  const ph = new Live2DPhysics(rig(), P);
  ph.stabilize();
  assert.equal(P.value[1], 0);
  for (let i = 0; i < 30; i++) ph.evaluate(1 / 30);
  assert.equal(P.value[1], 0);
  P.value[0] = 10;
  let peak = 0;
  for (let i = 0; i < 30; i++) { P.value[0] = 10; ph.evaluate(1 / 30); peak = Math.max(peak, Math.abs(P.value[1])); }
  assert.ok(peak > 0.1 && peak <= 30, `peak ${peak}`);
  const out = [];
  for (let i = 0; i < 600; i++) { P.value[0] = 10; ph.evaluate(1 / 30); out.push(P.value[1]); }
  assert.ok(Math.abs(out[599] - out[598]) < 1e-3, "settles");
  ph.allow = false;
  P.value[1] = 7; ph.evaluate(1 / 30);
  assert.equal(P.value[1], 7);                       // switched off: the output is not written
});

test("cubismCore() rejects with a clear message when the page has not loaded the Core", async () => {
  const saved = globalThis.Live2DCubismCore;
  delete globalThis.Live2DCubismCore;
  try {
    await assert.rejects(cubismCore(), /Live2D Cubism Core is not loaded.*live2dcubismcore\.min\.js/);
  } finally { if (saved) globalThis.Live2DCubismCore = saved; }
});

test("cubismCore() waits for the Core's runtime; CubismModel checks the moc3 header and version", async () => {
  const saved = globalThis.Live2DCubismCore;
  let up = false;
  globalThis.Live2DCubismCore = {
    Version: { csmGetVersion: () => { if (!up) throw new Error("not ready"); return 0x05010000; }, csmGetLatestMocVersion: () => 5 },
    Moc: { fromArrayBuffer: () => null }, Model: { fromMoc: () => null },
  };
  try {
    setTimeout(() => { up = true; }, 30);
    assert.equal(await cubismCore(), globalThis.Live2DCubismCore);
    assert.throws(() => new CubismModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), /not a moc3/);
    const moc = (v) => new Uint8Array([0x4d, 0x4f, 0x43, 0x33, v, 0, 0, 0]).buffer;
    assert.throws(() => new CubismModel(moc(6)), /version 6 is newer/);
    assert.throws(() => new CubismModel(moc(5)), /rejected/);
  } finally {
    if (saved) globalThis.Live2DCubismCore = saved; else delete globalThis.Live2DCubismCore;
  }
});
