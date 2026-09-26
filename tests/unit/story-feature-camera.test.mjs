// Story feature commands on the camera and the character field (Shake, CameraShake, Tilt, Role, Pan, DoF, MoveTo*,
// Forward, Back, Brightness, Angle) on a real PlayerLoop at 30 fps with stand-in scene objects. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { Transform } from "../../src/engine/math.js";
import { UnityRandom } from "../../src/engine/random.js";
import { EASE } from "../../src/engine/tween.js";
import { commandHandler } from "../../src/story/interfaces.js";
import { FEATURE_COMMANDS, disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { ShakeTween, shakeWaypoints } from "../../src/story/features/dotween.js";
import { reorderCharacters } from "../../src/story/commands/placement.js";

const F = Math.fround;
const flush = () => new Promise((res) => setImmediate(res));

const settledFrame = async (loop, promise, { max = 400 } = {}) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  while (!done && loop.frameCount < max) await loop.step();
  assert.ok(done, `not settled after ${max} frames`);
  return loop.frameCount;
};

class FakeFieldRenderer {
  constructor() {
    this.entries = [0, 1, 2, 3, 4].map((i) => ({ index: i, target: null, sortingOrder: -1, renderIndex: -1, alpha: 1,
                                                 brightness: 1, blur: 0 }));
    this.defaultOrder = [4, 0, 3, 1, 2];
    this.priority = {};
    this.defaultOrder.forEach((e, i) => { this.priority[e] = i; });
    this.calls = [];
  }
  static entryIndex(pos) { return { 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pos] ?? -1; }
  entryOf(pos) { const i = FakeFieldRenderer.entryIndex(pos); return i < 0 ? null : this.entries[i]; }
  setCharacterEntries() { this.calls.push(["entries", { ...this.priority }]); }
  sortCharacters() { this.calls.push(["sort"]); }
  setCharacterBlur(pos, dur, v, ease) { this.calls.push(["charBlur", pos, dur, v, ease]); return Promise.resolve(); }
  setBackgroundBlur(dur, v, ease) { this.calls.push(["bgBlur", dur, v, ease]); return Promise.resolve(); }
  applyBlurRadiusByCameraDistance(cd, dur) { this.calls.push(["radius", cd, dur]); return Promise.resolve(); }
}

const fakeCamera = (loop) => ({
  calls: [], offset: null, euler: { x: 0, y: 0, z: 0 },
  setShakeOffset(o) { this.offset = o; },
  rotateX(v, dur, ease) { this.calls.push(["rx", v, dur, ease]); return loop.delay(dur); },
  rotateY(v, dur, ease) { this.calls.push(["ry", v, dur, ease]); return loop.delay(dur); },
  rotateZ(v, dur, ease) { this.calls.push(["rz", v, dur, ease]); return loop.delay(dur); },
});

const makePlayer = ({ speed = 10, overlay = false, quality = {}, settings = {} } = {}) => {
  const loop = new PlayerLoop(30);
  const field = { root: new Transform("AdvCharacterField"), field: new Transform("Field"), stages: [] };
  field.field.setParent(field.root);
  for (let i = 0; i < 5; i++) { const s = new Transform(`Stage${i + 1}`, field.field); field.stages.push(s); }
  field.stageTransform = (pos) => field.stages[{ 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pos]] || null;
  const background = { root: new Transform("AdvBackgroundField"), field: new Transform("Field"),
                       color: { r: 1, g: 1, b: 1, a: 1 }, originalColor: { r: 1, g: 1, b: 1, a: 1 }, brightness: 1,
                       colorTween: null };
  const characters = new Map();
  const ctx = {
    loop, field, background, camera: fakeCamera(loop), fieldRenderer: new FakeFieldRenderer(),
    characters: { get: (n) => characters.get(n) }, ui: {}, episode: { commands: [] }, story: {},
    quality: { characterBlur: true, backgroundBlur: true, ...quality },
    settings: { player: { _shakeFieldStrength: 0.01, _shakeUIStrength: 2, _cameraShakeStrength: 0.02,
                          _cameraShakeDuration: 0.5, _cameraShakeVibrato: 10, _cameraShakeRandomness: 90, ...settings } },
  };
  const p = {
    ctx, playbackSpeed: speed, nextStep: 0, cancelled: false, shortCutIndex: -1, isOverlay: overlay,
    session: { targetNameToPosition: new Map(), positionToCharacter: new Map(), focusCameraDistance: 3 },
    speedRate() { return this.playbackSpeed / 10; },
    get shortcut() { return this.shortCutIndex >= 0; },
    calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
    delay(sec) { return loop.delay(sec); },
    ease(s, def = EASE.OutQuad) { const e = { Linear: 1, OutSine: 3 }[s]; return e ?? def; },
    noWait(c, task) { if (c.IsNoWait) { task.catch((e) => { throw e; }); return Promise.resolve(); } return task; },
    fail(e) { throw e; },
  };
  return { p, ctx, loop, characters };
};

test("every feature command is registered under its AdvCommand name", () => {
  for (const [name, fn] of Object.entries(FEATURE_COMMANDS)) assert.equal(commandHandler(name), fn, name);
});

test("DOTween.Shake waypoints: segment count, durations, decay, vector-based z clamp, deterministic stream", () => {
  const w = shakeWaypoints(F(1), { x: 0.05, y: 0.05, z: 0 }, 10, 90, false, true, true, new UnityRandom(7));
  assert.equal(w.ends.length, 10);
  assert.deepEqual(w.ends[9], { x: 0, y: 0, z: 0 });
  let sum = 0;
  for (const d of w.durations) sum = F(sum + d);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  assert.ok(w.durations[9] > w.durations[0]);                           // fadeOut: later segments are longer
  const mag = w.ends.slice(0, 9).map((v) => Math.hypot(v.x, v.y, v.z));
  for (const v of w.ends) assert.ok(v.z === 0);                         // strength z 0 clamps z away (-0 too)
  for (let i = 1; i < 9; i++) assert.ok(mag[i] < mag[i - 1] + 1e-7, "magnitude decays");
  assert.ok(Math.abs(mag[0] - F(Math.hypot(0.05, 0.05))) < 1e-6);
  const again = shakeWaypoints(F(1), { x: 0.05, y: 0.05, z: 0 }, 10, 90, false, true, true, new UnityRandom(7));
  assert.deepEqual(again, w);
  // float strength (UI): no clamp, z from the random rotation about the up axis
  const u = shakeWaypoints(F(0.5), { x: 3, y: 3, z: 3 }, 10, 90, false, false, true, new UnityRandom(7));
  assert.equal(u.ends.length, 5);
  assert.ok(u.ends.slice(0, 4).some((v) => v.z !== 0));
  // short shakes use at least 2 segments
  assert.equal(shakeWaypoints(F(0.1), { x: 1, y: 1, z: 0 }, 10, 90, false, true, true, new UnityRandom(1)).ends.length, 2);
});

test("a shake tween starts from the value at its first update and ends there", async () => {
  const loop = new PlayerLoop(30);
  let pos = { x: 5, y: 1, z: 0 };
  const wp = shakeWaypoints(F(0.5), { x: 0.2, y: 0.2, z: 0 }, 10, 90, false, true, true, new UnityRandom(3));
  const t = new ShakeTween(loop.tweens, wp, () => pos, (v) => { pos = v; });
  const seen = [];
  const frame = await settledFrame(loop, t.promise.then(() => seen.push({ ...pos })));
  assert.equal(frame, 16);                                              // 15 float32 steps of 1/30 stay below 0.5
  assert.deepEqual(seen[0], { x: 5, y: 1, z: 0 });
});

test("Shake: CanvasLayers choose the targets; strengths come from the player settings; roots rest at zero", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p, { random: new UnityRandom(11) });
  const moved = { bg: false, ch: false };
  t.ctx.loop.on("tweens", () => {
    if (t.ctx.background.root.localPosition.x !== 0) moved.bg = true;
    if (t.ctx.field.root.localPosition.x !== 0) moved.ch = true;
  });
  const frame = await settledFrame(t.loop, commandHandler("Shake")({ cmd: "Shake", Duration: 0.5, Parameter1: "5",
                                                                     CanvasLayers: [0] }, t.p));
  // DelayWithSpeedAdjustment: the first tick subtracts the calling frame's delta time (0 here: called before a frame)
  assert.equal(frame, 16);
  assert.deepEqual(moved, { bg: true, ch: false });
  const rest = t.ctx.background.root.localPosition;                    // back at the start (float residue of the last segment)
  assert.ok(Math.abs(rest.x) < 1e-6 && Math.abs(rest.y) < 1e-6 && rest.z === 0);
  // no layers: both fields; IsNoWait: the row returns at once
  const f0 = t.loop.frameCount;
  const done = commandHandler("Shake")({ cmd: "Shake", Duration: 0.5, Parameter1: "1", IsNoWait: 1 }, t.p);
  assert.equal(await settledFrame(t.loop, done), f0);
  disposeStoryFeatures(t.ctx);
});

test("Shake without IsNoWait: a tap (next step GoNext) ends the wait", async () => {
  const t = makePlayer();
  const task = commandHandler("Shake")({ cmd: "Shake", Duration: 2, Parameter1: "1", CanvasLayers: [2] }, t.p);
  assert.equal(t.p.nextStep, 1);                                        // ChangeAllowNextState
  for (let i = 0; i < 5; i++) await t.loop.step();
  t.p.nextStep = 2;
  assert.ok(await settledFrame(t.loop, task) < 10);
});

test("CameraShake toggles: the first row starts a looping shake and waits the fade, the next one stops it", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p, { random: new UnityRandom(5) });
  const start = commandHandler("CameraShake")({ cmd: "CameraShake", Parameter1: "0.5" }, t.p);
  assert.equal(await settledFrame(t.loop, start), 15);                  // UniTask.Delay(0.5): float32 elapsed reaches 0.5 at 15
  let seen = 0;
  for (let i = 0; i < 30; i++) { await t.loop.step(); if (t.ctx.camera.offset) seen++; }
  assert.ok(seen > 20, "the camera offset moves while the shake plays");
  const stop = commandHandler("CameraShake")({ cmd: "CameraShake", Duration: 0.3 }, t.p);
  await settledFrame(t.loop, stop);
  assert.equal(t.ctx.camera.offset, null);
  // Overlay playback mode: nothing
  const o = makePlayer({ overlay: true });
  await commandHandler("CameraShake")({ cmd: "CameraShake", Parameter1: "0.5" }, o.p);
  assert.equal(o.ctx.camera.offset, null);
  disposeStoryFeatures(t.ctx);
});

test("Tilt / Role / Pan: camera rotations after the prologue (Overlay: nothing)", async () => {
  const t = makePlayer();
  await settledFrame(t.loop, commandHandler("Tilt")({ cmd: "Tilt", Parameter1: "5", Parameter2: "OutSine", Duration: 1 }, t.p));
  await settledFrame(t.loop, commandHandler("Role")({ cmd: "Role", Parameter1: "-10", Duration: 0.5 }, t.p));
  assert.deepEqual(t.ctx.camera.calls, [["rx", -5, 1, 3], ["rz", -10, 0.5, 6]]);
  await settledFrame(t.loop, commandHandler("Pan")({ cmd: "Pan", Parameter1: "5", Parameter2: "Linear", Duration: 1 }, t.p));
  assert.deepEqual(t.ctx.camera.calls[2], ["ry", 5, 1, 1]);
  assert.equal(t.ctx.field.field.localEuler.y, 5);
  assert.equal(t.ctx.background.field.localEuler.y, 5);
  const o = makePlayer({ overlay: true });
  await commandHandler("Tilt")({ cmd: "Tilt", Parameter1: "5" }, o.p);
  assert.deepEqual(o.ctx.camera.calls, []);
});

test("DoF: characters by default (TargetName's position), background / character by CanvasLayers, quality gates", async () => {
  const t = makePlayer();
  t.p.session.targetNameToPosition.set("rana", 7);
  await settledFrame(t.loop, commandHandler("DoF")({ cmd: "DoF", TargetName: "rana", Parameter1: "1", Duration: 0.5 }, t.p));
  assert.deepEqual(t.ctx.fieldRenderer.calls, [["radius", 3, 0], ["charBlur", 7, 0.5, 1, 6]]);
  t.ctx.fieldRenderer.calls = [];
  await settledFrame(t.loop, commandHandler("DoF")({ cmd: "DoF", PositionType: 3, Parameter1: "0.5", CanvasLayers: [0, 2] }, t.p));
  assert.deepEqual(t.ctx.fieldRenderer.calls, [["radius", 3, 0], ["bgBlur", 0, 0.5, 6], ["radius", 3, 0], ["charBlur", 3, 0, 0.5, 6]]);
  const g = makePlayer({ quality: { characterBlur: false } });
  await settledFrame(g.loop, commandHandler("DoF")({ cmd: "DoF", PositionType: 3, Parameter1: "1" }, g.p));
  assert.deepEqual(g.ctx.fieldRenderer.calls, []);
});

test("MoveTo*: the stage moves by Parameter1 along its axis (OutQuad); Forward / Back re-sort", async () => {
  const t = makePlayer();
  const s = t.ctx.field.stageTransform(5);
  await settledFrame(t.loop, commandHandler("MoveToRight")({ cmd: "MoveToRight", PositionType: 5, Parameter1: "0.5", Duration: 1 }, t.p));
  assert.equal(s.localPosition.x, 0.5);
  await commandHandler("MoveToDown")({ cmd: "MoveToDown", PositionType: 5, Parameter1: "10" }, t.p);
  assert.equal(s.localPosition.y, -10);
  await commandHandler("MoveToForward")({ cmd: "MoveToForward", PositionType: 5, Parameter1: "2" }, t.p);
  assert.equal(s.localPosition.z, -2);
  assert.deepEqual(t.ctx.fieldRenderer.calls, [["sort"]]);
  // the tween eases out: past half way at half time
  const u = makePlayer();
  const st = u.ctx.field.stageTransform(1);
  const task = commandHandler("MoveToUp")({ cmd: "MoveToUp", PositionType: 1, Parameter1: "1", Duration: 1 }, u.p);
  await flush();
  for (let i = 0; i < 15; i++) await u.loop.step();
  assert.ok(st.localPosition.y > 0.7 && st.localPosition.y < 0.8);
  await settledFrame(u.loop, task);
});

test("Forward / Back rewrite the draw priority from the default order", () => {
  const fr = new FakeFieldRenderer();
  reorderCharacters(fr, 5, true);                                       // entry 2 last
  assert.deepEqual(fr.priority, { 4: 0, 0: 1, 3: 2, 1: 3, 2: 4 });
  reorderCharacters(fr, 1, true);                                       // entry 0 last, from the default order
  assert.deepEqual(fr.priority, { 4: 0, 3: 1, 1: 2, 2: 3, 0: 4 });
  reorderCharacters(fr, 5, false);                                      // entry 2 first
  assert.deepEqual(fr.priority, { 2: 0, 4: 1, 0: 2, 3: 3, 1: 4 });
});

test("Brightness: placed character through its entry (with the fallback), background colour, unplaced controller", async () => {
  const t = makePlayer();
  const log = [];
  const ch = { brightness: 1, setBrightness(v) { this.brightness = v; log.push(v); } };
  t.characters.set("rana", ch);
  t.p.session.targetNameToPosition.set("rana", 3);
  await settledFrame(t.loop, commandHandler("Brightness")({ cmd: "Brightness", TargetName: "rana", Parameter1: "0.5", Duration: 0.5 }, t.p));
  assert.equal(t.ctx.fieldRenderer.entryOf(3).brightness, 0.5);
  assert.equal(ch.brightness, 0.5);
  // background: original colour x brightness, kept alpha
  t.ctx.background.originalColor = { r: 1, g: 0.5, b: 0.25, a: 0.8 };
  await settledFrame(t.loop, commandHandler("Brightness")({ cmd: "Brightness", Parameter1: "0.5", Duration: 0.2 }, t.p));
  assert.deepEqual(t.ctx.background.color, { r: 0.5, g: 0.25, b: 0.125, a: Math.fround(0.8) });   // Color is float32
  // loaded but not placed: the controller's own per-frame approach
  const u = makePlayer();
  const c2 = { brightness: 1, setBrightness(v) { this.brightness = v; } };
  u.characters.set("tomori", c2);
  await settledFrame(u.loop, commandHandler("Brightness")({ cmd: "Brightness", TargetName: "tomori", Parameter1: "0", Duration: 0.5 }, u.p));
  assert.equal(c2.brightness, 0);
});

test("Angle: additive override, DelaySeconds, then SmoothRotateToAngle with InOutQuad", async () => {
  const t = makePlayer();
  const calls = [];
  t.characters.set("rana", {
    isAlive: true,
    setOverrideAngleEnabled(a, b) { calls.push(["override", a, b, t.loop.frameCount]); },
    smoothRotateToAngle(a, b, d, e) { calls.push(["rotate", a, b, d, e, t.loop.frameCount]); return Promise.resolve(); },
  });
  await settledFrame(t.loop, commandHandler("Angle")({ cmd: "Angle", TargetName: "rana", Parameter1: "-10", Parameter2: "2",
                                                       DelaySeconds: 0.2, Duration: 0.5 }, t.p));
  assert.deepEqual(calls, [["override", true, true, 0], ["rotate", -10, 2, 0.5, EASE.InOutQuad, 6]]);
});
