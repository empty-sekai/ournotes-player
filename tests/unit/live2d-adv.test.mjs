// Live2DCharacter's story (ADV) calls over a synthetic model: a stand-in for Live2D Cubism Core and a prefab with the
// components the runtime reads. Pause / resume with requests made while paused, motion speed, seeking the playing
// motion, the parameter loop, the eye-blink stop, the angle and look overrides, brightness, sorting, layer, parent
// and the lip-sync entry points. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Transform } from "../../src/engine/math.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { EASE } from "../../src/engine/tween.js";
import { UnityRandom } from "../../src/engine/random.js";
import { Live2DCharacter } from "../../src/live2d/character.js";
import { LIP_MODE } from "../../src/live2d/lipsync.js";
import { Live2DParameterLoopController } from "../../src/live2d/paramloop.js";
import { Live2DParameterStore, Live2DParameters, easeSine, hermite } from "../../src/live2d/math.js";

const F = Math.fround;
const IDS = ["ParamAngleX", "ParamBodyAngleX", "ParamEyeLOpen", "ParamEyeROpen", "ParamEyeBallX", "ParamEyeBallY",
             "ParamMouthOpenY", "ParamBreath", "ParamLoopA"];
const MIN = [-30, -10, 0, 0, -1, -1, 0, 0, -1], MAX = [30, 10, 1, 1, 1, 1, 1, 1, 1], DEF = [0, 0, 1, 1, 0, 0, 0, 0, 0];

const fakeCore = () => ({
  Version: { csmGetVersion: () => 0x05010000, csmGetLatestMocVersion: () => 5 },
  Moc: { fromArrayBuffer: () => ({ _release() {} }) },
  Model: {
    fromMoc() {
      const quad = [-0.1, -0.1, 0.1, -0.1, 0.1, 0.1, -0.1, 0.1];
      const d = {
        count: 1, ids: ["ArtMesh0"], constantFlags: new Uint8Array([4]), dynamicFlags: new Uint8Array([1]),
        opacities: new Float32Array([1]), renderOrders: new Int32Array([0]), maskCounts: new Int32Array([0]),
        masks: [new Int32Array(0)], vertexPositions: [Float32Array.from(quad)],
        vertexUvs: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])], indices: [new Uint16Array([0, 1, 2, 0, 2, 3])],
        multiplyColors: new Float32Array(4).fill(1), screenColors: new Float32Array([0, 0, 0, 1]),
        resetDynamicFlags() { this.dynamicFlags[0] &= 1; },
      };
      return {
        parameters: { count: IDS.length, ids: IDS.slice(), minimumValues: Float32Array.from(MIN),
                      maximumValues: Float32Array.from(MAX), defaultValues: Float32Array.from(DEF), values: Float32Array.from(DEF) },
        parts: { count: 1, ids: ["Part0"], opacities: new Float32Array([1]) },
        drawables: d,
        canvasinfo: { CanvasWidth: 600, CanvasHeight: 900, CanvasOriginX: 300, CanvasOriginY: 450, PixelsPerUnit: 600 },
        update() {},
        release() {},
      };
    },
  },
});

const curve = (len, v0, v1) => ({ m_Curve: [{ time: 0, value: v0, inSlope: 0, outSlope: 0 }, { time: len, value: v1, inSlope: 0, outSlope: 0 }] });
const fadeData = (name, len, ids, curves, pfit = ids.map(() => -1), pfot = ids.map(() => -1)) => ({
  m_Name: `${name}.fade`, MotionName: name, FadeInTime: 0.5, FadeOutTime: 0.5, MotionLength: len,
  ParameterFadeInTimes: pfit, ParameterFadeOutTimes: pfot, ParameterIds: ids, ParameterCurves: curves,
});
const clip = (name, id, len, value) => ({
  clip: name, stopTime: len, loopTime: true, startTime: 0, cycleOffset: 0,
  events: [{ functionName: "InstanceId", intParameter: id }], dense: { curveCount: 0 },
  bindings: [{ path: "Parameters/ParamAngleX", class: "CubismParameter", attribute: "Value" }],
  streamed: { curveCount: 0, frames: [] }, constant: [value],
});

const prefab = ({ mouthTags = ["ParamMouthOpenY"] } = {}) => {
  const root = "model";
  const node = (path, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 0,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
  const mb = (cls, fields) => ({ type: "MonoBehaviour", class: cls, ...fields });
  const head = node(`${root}/Anchors/Head`);
  head.localPosition = { x: 0.25, y: 1.5, z: 0 };
  return { key: "model", canvas: {}, nodes: [
    node(root, [
      mb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: 0, z: 0 },
                              BaseScale: 1, _motionList: [clip("mtn_idle", -1, 2, 0), clip("mtn_turn", -2, 1, 30)],
                              _expressionList: ["exp_idle", "exp_closed"] }),
      mb("CubismFadeController", { CubismFadeMotionList: { MotionInstanceIds: [-1, -2, -3], CubismFadeMotionObjects: [
        fadeData("mtn_idle", 2, ["ParamAngleX", "ParamEyeLOpen"], [curve(2, 0, 0), curve(2, 1, 1)]),
        fadeData("mtn_turn", 1, ["ParamAngleX"], [curve(1, 30, 30)]),
        fadeData("misc_sway", 2, ["ParamLoopA", "ParamMissing"], [curve(2, 0, 1), curve(2, 0, 1)]),
      ] } }),
      mb("CubismExpressionController", { UseLegacyBlendCalculation: 0, CurrentExpressionIndex: -1, CurrentFadeInTime: -1,
        ExpressionsList: { CubismExpressionObjects: [
          { name: "exp_idle.exp3", FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [] },
          { name: "exp_closed.exp3", FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [{ Id: "ParamEyeLOpen", Value: 0, Blend: 2 }] }] } }),
      mb("CubismHarmonicMotionController", { BlendMode: 1, ChannelTimescales: [1] }),
      mb("CubismAutoEyeBlinkInput", { Mean: 2.5, MaximumDeviation: 2, Timescale: 10 }),
      mb("CubismEyeBlinkController", { BlendMode: 2, EyeOpening: 1 }),
      mb("CubismMouthController", { BlendMode: 0, MouthOpening: 0 }),
      mb("CubismRenderController", { _sortingOrder: 0, Opacity: 1 }),
    ]),
    node(`${root}/Parameters`),
    ...IDS.map((id) => node(`${root}/Parameters/${id}`, [mb("CubismParameter", {}),
      ...(id === "ParamEyeLOpen" || id === "ParamEyeROpen" ? [mb("CubismEyeBlinkParameter", {})] : []),
      ...(mouthTags.includes(id) ? [mb("CubismMouthParameter", {})] : []),
      ...(id === "ParamBreath" ? [mb("CubismHarmonicMotionParameter", { Channel: 0, Direction: 2, NormalizedOrigin: 0.5,
                                                                         NormalizedRange: 0.5, Duration: 3 })] : [])])),
    node(`${root}/Anchors`),
    head,
    node(`${root}/Drawables`),
    node(`${root}/Drawables/ArtMesh0`, [
      mb("CubismDrawable", { _unmanagedIndex: 0 }),
      { type: "MeshRenderer", m_Materials: [{ material: "Lit" }] },
      mb("CubismRenderer", { _localSortingOrder: 0, _color: { r: 1, g: 1, b: 1, a: 1 }, _mainTexture: {} }),
    ]),
  ] };
};

// a loaded, shown character driven by a 30 fps loop (the story's hooks)
const shown = async (opts = {}) => {
  const saved = globalThis.Live2DCubismCore;
  globalThis.Live2DCubismCore = fakeCore();
  try {
    const loop = new PlayerLoop(30);
    const moc = new Uint8Array([0x4d, 0x4f, 0x43, 0x33, 5, 0, 0, 0, 0, 0, 0, 0]).buffer;
    const ch = new Live2DCharacter(prefab(opts), moc, loop, { random: new UnityRandom(1) });
    const requests = [];
    loop.on("update", () => { for (const f of requests.splice(0)) f(); ch.update(); });
    loop.on("animation", () => ch.animatorUpdate());
    loop.on("lateUpdate", () => ch.lateUpdate());
    loop.on("preLateEnd", () => ch.modelUpdate());
    let done = false;
    ch.load().then(() => { done = true; });
    for (let n = 0; !done && n < 300; n++) await loop.step();
    assert.ok(done, "warmup finished");
    ch.show("", "", 0);
    ch.setIgnoreAllUpdate(false);
    const steps = async (n) => { for (let i = 0; i < n; i++) await loop.step(); };
    return { ch, loop, steps, requests };
  } finally { if (saved) globalThis.Live2DCubismCore = saved; else delete globalThis.Live2DCubismCore; }
};

const P = (ch, id) => ch.params.value[ch.params.idx(id)];

test("pause keeps motion and expression requests and resume plays them, with the layer times moved", async () => {
  const { ch, loop, steps } = await shown();
  await steps(3);
  ch.playMotion("mtn_turn", 0);
  const pm = ch.layer.list[ch.layer.list.length - 1];
  const end0 = pm.endTime, start0 = pm.startTime;
  ch.pause();
  assert.equal(ch.pausing, true);
  assert.equal(ch.layer.paused, true);
  assert.equal(ch.model.ignore, true);
  assert.equal(ch.harmonicTimescales[0], 0);
  const t0 = ch.layer.pauseTime;
  ch.playMotion("mtn_idle", 0);
  ch.playExpression("exp_closed", 0);
  ch.playParameterLoop("misc_sway", 0);
  assert.deepEqual(ch.pending.motion, { name: "mtn_idle", fade: 0 });
  assert.deepEqual(ch.pending.expression, { name: "exp_closed", fade: 0 });
  assert.deepEqual(ch.pending.paramLoop, { name: "misc_sway", fade: 0 });
  assert.equal(ch.layer.list.length, 2);                     // nothing played while paused
  await steps(4);
  const d = F(loop.time - t0);
  ch.resume();
  assert.equal(pm.startTime, F(d + start0));
  assert.equal(pm.endTime, F(loop.time + 0.5));             // the pending motion then cut it to its fade-out
  assert.ok(F(d + end0) > pm.endTime);
  assert.equal(ch.harmonicTimescales[0], 1);
  assert.equal(ch.layer.list[ch.layer.list.length - 1].clip.name, "mtn_idle");
  assert.equal(ch.expr.current, 1);
  assert.equal(ch.paramLoop.motionName, "misc_sway");
  assert.deepEqual(ch.pending, { motion: null, expression: null, paramLoop: null });
});

test("hide clears a pause without playing its requests, and show resumes breath", async () => {
  const { ch } = await shown();
  ch.pause();
  ch.playMotion("mtn_turn", 0);
  ch.hide();
  assert.equal(ch.pausing, false);
  assert.equal(ch.pending.motion, null);
  ch.show("", "", 0);
  assert.equal(ch.harmonicTimescales[0], 1);
  assert.equal(ch.layer.list[ch.layer.list.length - 1].clip.name, "mtn_idle");
});

test("setMotionSpeed rescales the playing motions around Time.time and the blink speed", async () => {
  const { ch, loop, steps } = await shown();
  await steps(2);
  ch.playMotion("mtn_turn", 0);
  await steps(1);
  const pm = ch.layer.list[ch.layer.list.length - 1];
  const t = loop.time, e0 = pm.endTime, f0 = pm.fadeInStartTime;
  ch.setMotionSpeed(2);
  assert.equal(ch.blink.timescale, F(10 * 2));
  assert.equal(pm.speed, 2);
  assert.equal(pm.endTime, F(t + F(F(1 * F(e0 - t)) / 2)));
  assert.equal(pm.fadeInStartTime, F(t - F(F(1 * F(t - f0)) / 2)));
  assert.equal(ch.anim.speed, 2);
});

test("applyStateAtMotionTime seeks the newest clip forward to min(s, length - 0.0001) and moves its fade-in start", async () => {
  const { ch, loop, steps } = await shown();
  await steps(2);
  ch.playMotion("mtn_turn", 0);
  ch.applyStateAtMotionTime(5);
  assert.equal(ch.anim.time, F(1 + F(-0.0001)));
  const pm = ch.layer.list[ch.layer.list.length - 1];
  assert.ok(pm.fadeInStartTime <= F(loop.time - F(F(1 + F(-0.0001)) / 1)));
  const before = ch.anim.time;
  ch.applyStateAtMotionTime(0.2);                            // never back
  assert.equal(ch.anim.time, before);
  ch.pause();
  ch.applyStateAtMotionTime(0.9);                            // not while paused
  assert.equal(ch.canApplyStateImmediately, false);
});

test("the parameter loop plays misc_ motions only, fades by the sine ease and stops at weight 0", async () => {
  const params = new Live2DParameters({ parameters: { ids: ["A", "B"], count: 2, minimumValues: [-1, -1], maximumValues: [1, 1],
                                                     defaultValues: [0.5, 0], values: Float32Array.from([0.5, 0]) } });
  const store = new Live2DParameterStore(params, new Float32Array(0));
  const m = fadeData("misc_x", 2, ["A", "Z"], [curve(2, -1, 1), curve(2, 0, 0)]);
  const L = new Live2DParameterLoopController([fadeData("mtn_a", 1, ["A"], [curve(1, 0, 0)]), m], params, store);
  L.play("mtn_a", 0);
  assert.equal(L.isPlaying, false);
  assert.match(L.warnings[0], /misc_/);
  L.play("misc_x", 0.5);
  assert.equal(L.isPlaying, true);
  assert.deepEqual(L.targets, [0, -1]);
  L.advanceTime(F(1 / 30));
  const w = F(0 + F(F(1 - 0) * easeSine(F(F(1 / 30) / 0.5))));
  assert.equal(L.weight, w);
  L.lateUpdate();
  const c = hermite(m.ParameterCurves[0].m_Curve, L.phaseTime);
  assert.equal(params.value[0], F(0.5 + F(F(c - 0.5) * w)));   // default + (curve - default) x weight
  for (let i = 0; i < 100; i++) L.advanceTime(F(1 / 30));
  assert.equal(L.weight, 1);
  assert.ok(L.phaseTime < 2);
  L.stop(0.2);
  for (let i = 0; i < 10 && L.isPlaying; i++) L.advanceTime(F(1 / 30));
  assert.equal(L.isPlaying, false);
  assert.equal(params.value[0], 0.5);                        // targets back at their defaults
});

test("the eye-blink stop eases EyeOpening open and restores the auto blink on clear", async () => {
  const { ch, steps } = await shown();
  await steps(2);
  ch.eyeOpening = 0.25;
  ch.setEyeBlinkStopped(true, 0.2);
  assert.equal(ch.isEyeBlinkStopped, true);
  assert.equal(ch.isAutoEyeBlinking, false);
  assert.equal(ch.blink.isBlinking, false);
  assert.equal(ch.eyeBlinkStop.start, 0.25);
  await steps(3);
  const S = ch.eyeBlinkStop;
  const dt = F(1 / 30);
  assert.equal(S.elapsed, F(F(F(0 + dt) + dt) + dt));       // deltaTime x motion speed per update
  ch.setEyeBlinkEnabled(false);                              // kept for the stop's end
  assert.equal(S.wasAuto, false);
  ch.setEyeBlinkStopped(false);
  assert.equal(ch.isEyeBlinkStopped, false);
  assert.equal(ch.isAutoEyeBlinking, false);
});

test("the additive angle override is added to the motion's value and taken back before the next update", async () => {
  const { ch, steps } = await shown();
  await steps(2);
  ch.setOverrideAngleEnabled(true, true);
  ch.setAngleX(5); ch.setBodyAngleX(2);
  await steps(1);
  assert.equal(ch.angle.appliedX, 5);
  assert.equal(ch.angle.appliedBodyX, 2);                    // no ParamBodyAngleXAdd: added to ParamBodyAngleX
  const ax = P(ch, "ParamAngleX");
  ch._restoreAdditiveOverrideAngles();
  assert.equal(P(ch, "ParamAngleX"), F(ax - 5));
  assert.equal(ch.angle.appliedX, 0);
  ch.setOverrideAngleEnabled(true, false);
  ch.setAngleX(100);
  await steps(1);
  assert.equal(P(ch, "ParamAngleX"), 30);                    // clamped
  ch.resetAngleLook();
  assert.deepEqual([ch.angle.override, ch.angle.additive, ch.angle.x, ch.angle.bodyX], [false, false, 0, 0]);
});

test("smoothRotateToAngle tweens from the values at start and a new call kills the running one", async () => {
  const { ch, steps } = await shown();
  ch.setOverrideAngleEnabled(true, true);
  const first = ch.smoothRotateToAngle(10, 4, 1, EASE.InOutQuad);
  await steps(3);
  assert.ok(ch.angle.x > 0 && ch.angle.x < 10);
  const second = ch.smoothRotateToAngle(-10, 0, 0.1, EASE.InOutQuad);
  assert.equal(await first, false);
  await steps(5);
  assert.equal(await second, true);
  assert.equal(ch.angle.x, -10);
  assert.equal(ch.angle.bodyX, 0);
});

test("look: enabling takes the eye ball values, smoothChangeToLook with duration 0 applies at once", async () => {
  const { ch, steps } = await shown();
  await steps(2);
  ch.setLookEnabled(true);
  assert.equal(ch.originalLookX, P(ch, "ParamEyeBallX"));
  assert.equal(await ch.smoothChangeToLook(0.5, -0.25, 0), true);
  // applied at once: the Core got the look (the parameters then read back and restored from the store)
  const core = ch.core.parameters.values, ids = ch.params.ids;
  assert.equal(core[ids.indexOf("ParamEyeBallX")], 0.5);
  assert.equal(core[ids.indexOf("ParamEyeBallY")], -0.25);
  const p = ch.smoothChangeToLook(1, 1, 0.2);
  await steps(8);
  assert.equal(await p, true);
  assert.equal(ch.lookX, 1);
  ch.setLookEnabled(false);
  assert.deepEqual([ch.originalLookX, ch.originalLookY], [0, 0]);
});

test("brightness clamps, sorting order is n x 1000, layer and parent, head position, isAlive", async () => {
  const { ch } = await shown();
  ch.setUsePostCompositeBrightness(false);
  ch.setBrightness(2);
  assert.equal(ch.brightness, 1);
  ch.setBrightness(-1);
  assert.equal(ch.brightness, 0);
  assert.deepEqual(ch.renderers[0].color, { r: 0, g: 0, b: 0, a: 1 });
  ch.setUsePostCompositeBrightness(true);
  ch.setBrightness(0.5);
  assert.equal(ch.brightness, 0.5);
  assert.deepEqual(ch.renderers[0].color, { r: 1, g: 1, b: 1, a: 1 });
  ch.setSortingOrder(3);
  assert.equal(ch.rc.sortingOrder, 3000);
  assert.equal(ch.renderers[0].sortingOrder, 3000);
  ch.setLayer(7);
  assert.equal(ch.gameObjectLayer, 7);
  assert.ok([...ch.prefab.nodes.values()].every((e) => e.transform.layer === 7));
  const stage = new Transform("stage");
  stage.localPosition = { x: 1, y: 0, z: 0 };
  ch.setParent(stage);
  assert.equal(ch.root.parent, stage);
  const h = ch.headPosition();
  assert.ok(Math.abs(h.x - (1 + 0.25)) < 1e-6);
  assert.equal(ch.isAlive, true);
  ch.release();
  assert.equal(ch.isAlive, false);
});

test("lip sync entry points: timed pseudo lip sync length, manual mouth, a model without MotionSync", async () => {
  const { ch, steps } = await shown();
  assert.equal(ch.isMotionSyncEnabled, false);
  assert.equal(ch.lipSyncMode, LIP_MODE.None);
  ch.setLipSyncEnabled(true);
  assert.equal(ch.lipSyncMode, LIP_MODE.CriSyncVoice);
  ch.setLipSyncEnabled(true, false);
  ch.startTimedPseudoLipSync(10, 1, 1);
  assert.equal(ch.lip.timedTimer, F(F(0.14) * 10));
  assert.equal(ch.lipSyncMode, LIP_MODE.TimedPseudo);
  await steps(5);
  assert.ok(ch.mouthOpening >= 0 && ch.mouthOpening <= 1);
  ch.stopTimedPseudoLipSync();
  assert.equal(ch.lipSyncMode, LIP_MODE.CriSyncVoice);
  // a voice's PCM without its CRI Lips analysis: reported, the mouth closed
  ch.setLipsAnalyzer({ sampleRate: 48000, pull: () => new Float32Array(0) });
  await steps(1);
  assert.equal(ch.lipSyncMissing, "CRI Lips analysis");
  ch.setLipSyncEnabled(false);
  ch.setMouthOpening(0.5);
  assert.equal(ch.lipSyncMode, LIP_MODE.Manual);
  assert.equal(ch.mouthOpening, 0.5);
});

test("playParameterLoop drives a misc_ motion on top of the chain and hide stops it", async () => {
  const { ch, steps } = await shown();
  ch.playParameterLoop("misc_sway", 0);
  assert.equal(ch.paramLoop.isPlaying, true);
  await steps(10);
  assert.ok(P(ch, "ParamLoopA") > 0);
  ch.stopParameterLoop(0);
  assert.equal(ch.paramLoop.isPlaying, false);
  ch.playParameterLoop("", 0);                               // warned, not played
  assert.equal(ch.paramLoop.isPlaying, false);
  ch.playParameterLoop("misc_sway", 0);
  ch.hide();
  assert.equal(ch.paramLoop.isPlaying, false);
});

test("mouth controller: ParamMouthOpenY only when it carries CubismMouthParameter; other mouth tags are removed", async () => {
  for (const [tags, want] of [[["ParamMouthOpenY"], 0.75], [[], 0], [["ParamBreath", "ParamMouthOpenY"], 0.75], [["ParamBreath"], 0]]) {
    const { ch, steps } = await shown({ mouthTags: tags });
    assert.deepEqual(ch.mouthDestinations, tags.includes("ParamMouthOpenY") ? [ch.params.idx("ParamMouthOpenY")] : [], String(tags));
    ch.setMouthOpening(0.75);
    await steps(3);
    assert.equal(P(ch, "ParamMouthOpenY"), want, String(tags));
  }
});
