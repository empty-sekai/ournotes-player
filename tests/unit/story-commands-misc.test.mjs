// Story commands of src/story/commands/misc.js (Delay, Wait, CancelDelay, ForceAuto, SoundVolume, Expression, Costume,
// EyeBlink) on a real PlayerLoop at 30 fps and a stand-in player. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SoundCategoryVolumes } from "../../src/engine/audio.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { MISC_COMMANDS, delayWithPauseSpeedAdjustment } from "../../src/story/commands/misc.js";

const F = Math.fround;
const { Delay, Wait, CancelDelay, ForceAuto, SoundVolume, Expression, Costume, EyeBlink } = MISC_COMMANDS;

// a stand-in for the StoryPlayerCore members the commands use
const makePlayer = ({ speed = 10, auto = false, shortcut = false } = {}) => {
  const loop = new PlayerLoop(30);
  const log = [];
  const volumes = new SoundCategoryVolumes((name, v) => log.push([loop.frameCount, name, v]));
  const characters = new Map();
  const pending = [];
  const p = {
    ctx: {
      loop,
      audio: { getVolume: (n) => volumes.get(n), changeVolume: (n, v) => volumes.change(n, v) },
      characters: { get: (n) => characters.get(n), setAssetIndex: (n, i) => log.push(["asset", n, i]) },
      settings: { player: { _waitCommandLingeringTimeOnAutoPlay: 2.0 } },
    },
    session: {
      eyeBlinkStoppedTargetNames: new Set(),
      delayTokens: {                  // AdvCommandDelayTokens: CancelDelay ends a pending Delay with true
        delay: () => new Promise((res) => pending.push(res)),
        cancel: (result = true) => { for (const res of pending.splice(0)) res(result); },
      },
    },
    playbackSpeed: speed, autoPlay: auto, forcedAutoPlay: false, isPause: false, nextStep: 0, cancelled: false,
    shortCutIndex: shortcut ? 7 : -1,
    speedRate() { return this.playbackSpeed / 10; },
    get shortcut() { return this.shortCutIndex >= 0; },
    get isAutoPlay() { return this.forcedAutoPlay || this.autoPlay; },
    calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
    changeNextStepStateOnAutoPlay() { this.nextStep = this.isAutoPlay ? 2 : 1; },
    delay(sec) { return this.session.delayTokens.delay(sec); },
    noWait(c, task) { if (c.IsNoWait) { task.catch(() => {}); return Promise.resolve(); } return task; },
  };
  return { p, loop, log, volumes, characters };
};

const flush = () => new Promise((res) => setImmediate(res));

// steps the loop until `promise` settles; the frame it settled in (0: before the first step)
const settledFrame = async (loop, promise, { max = 200, each = null } = {}) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  while (!done && loop.frameCount < max) {
    if (each) each(loop.frameCount);
    await loop.step();
  }
  assert.ok(done, `not settled after ${max} frames`);
  return loop.frameCount;
};

const fakeCharacter = () => ({
  calls: [],
  playExpression(name, fade) { this.calls.push(["expression", name, fade]); },
  playDefaultExpression(fade) { this.calls.push(["default", fade]); },
  setEyeBlinkStopped(stopped, fade) { this.calls.push(["eyeBlink", stopped, fade]); },
});

test("Delay counts CalcDuration(Duration) down by the float delta time once per frame", async () => {
  // float32 1.0 - 30 x f32(1/30) reaches 0 in frame 30; 0.5 keeps a positive residue after 15 frames
  let t = makePlayer();
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 1 }, t.p)), 30);
  t = makePlayer();
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 0.5 }, t.p)), 16);
  t = makePlayer({ speed: 20 });                              // Double speed: 1.0 / 2
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 1 }, t.p)), 16);
  t = makePlayer({ speed: 15 });                              // 1.0 / 1.5
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 1 }, t.p)), 20);
  t = makePlayer();                                           // IsNoWait is not read
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 1, IsNoWait: true }, t.p)), 30);
});

test("Delay: no wait for Duration 0 or while shortcutting", async () => {
  let t = makePlayer();
  assert.equal(await settledFrame(t.loop, Delay({}, t.p)), 0);
  t = makePlayer({ shortcut: true });
  assert.equal(await settledFrame(t.loop, Delay({ Duration: 3 }, t.p)), 0);
});

test("Delay rescales the remaining time when the playback speed changes", async () => {
  const { p, loop } = makePlayer();
  // frames 1-11 at rate 1, then the rest (f32 1 - 11 x f32(1/30)) halved, counted down in frames 12-21
  const each = (f) => { if (f === 10) p.playbackSpeed = 20; };
  const frame = await settledFrame(loop, Delay({ Duration: 1 }, p), { each });
  assert.equal(frame, 21);
});

test("Delay holds while Model.IsPause", async () => {
  const { p, loop } = makePlayer();
  // 0.1 s = 3 frames; paused before frame 2's check, resumed before frame 6: frames 3-6 do not count
  const frame = await settledFrame(loop, Delay({ Duration: 0.1 }, p), {
    each: (f) => { if (f === 1) p.isPause = true; if (f === 5) p.isPause = false; } });
  assert.equal(frame, 7);
});

test("DelayWithPauseSpeedAdjustment ends when the playback stops", async () => {
  const { p, loop } = makePlayer();
  const d = delayWithPauseSpeedAdjustment(p, 10);
  let result = null;
  d.then((v) => { result = v; });
  await loop.step(); await loop.step();
  p.cancelled = true;
  await loop.step();
  assert.equal(result, false);
});

test("Wait (manual) waits for the tap and does not linger", async () => {
  const { p, loop } = makePlayer();
  const frame = await settledFrame(loop, Wait({}, p), { each: (f) => { if (f === 3) p.nextStep = 2; } });
  assert.equal(frame, 4);
  const t = makePlayer();
  const w = Wait({}, t.p);
  assert.equal(t.p.nextStep, 1);                              // AllowNext
  t.p.nextStep = 2;                                           // already GoNext: still resumes at the next tick
  assert.equal(await settledFrame(t.loop, w), 1);
});

test("Wait (auto) lingers _waitCommandLingeringTimeOnAutoPlay / speed after one frame", async () => {
  let t = makePlayer({ auto: true });
  const w = Wait({}, t.p);
  assert.equal(t.p.nextStep, 2);                              // GoNext
  // WaitUntil resumes in frame 1, where the 2.0 s delay starts (its creating frame does not count; float32 elapsed
  // reaches 2.0 after 61 ticks)
  assert.equal(await settledFrame(t.loop, w), 62);
  t = makePlayer({ auto: true, speed: 15 });
  // f32(2 / 1.5) = 1.3333334 s -> TimeSpan 1.333 s: 40 frames after frame 1
  assert.equal(await settledFrame(t.loop, Wait({}, t.p)), 41);
  t = makePlayer();
  t.p.forcedAutoPlay = true;                                  // ForcedAutoPlay makes IsAutoPlay true
  assert.equal(await settledFrame(t.loop, Wait({}, t.p)), 62);
});

test("Wait: nothing while shortcutting; a stop ends the linger", async () => {
  let t = makePlayer({ shortcut: true });
  assert.equal(await settledFrame(t.loop, Wait({}, t.p)), 0);
  assert.equal(t.p.nextStep, 0);
  t = makePlayer({ auto: true });
  const frame = await settledFrame(t.loop, Wait({}, t.p), { each: (f) => { if (f === 10) t.p.cancelled = true; } });
  assert.equal(frame, 11);
});

test("CancelDelay ends a pending Session.DelayTokens.Delay at once with true; Delay rows are not affected", async () => {
  const { p, loop } = makePlayer();
  const pending = p.delay(5);
  const row = Delay({ Duration: 0.1 }, p);
  await CancelDelay({}, p);
  assert.equal(await pending, true);
  assert.equal(await settledFrame(loop, row), 3);
});

test("ForceAuto switches ForcedAutoPlay", async () => {
  const { p } = makePlayer();
  await ForceAuto({}, p);
  assert.equal(p.forcedAutoPlay, true);
  assert.equal(p.isAutoPlay, true);
  await ForceAuto({}, p);
  assert.equal(p.forcedAutoPlay, false);
  assert.equal(p.isAutoPlay, false);
});

test("SoundVolume without a duration sets the category volume at once", async () => {
  const { p, log, volumes } = makePlayer();
  await SoundVolume({ Parameter1: "Voice", Parameter2: "0.5" }, p);
  assert.equal(volumes.get("Voice"), 0.5);
  log.length = 0;
  await SoundVolume({ Parameter2: "0.5" }, p);               // empty category: Bgm and Voice
  assert.deepEqual(log, [[0, "Bgm", F(F(0.7) * 0.5)], [0, "Voice", 0.5]]);
  log.length = 0;
  await SoundVolume({ Parameter1: "ALL", Parameter2: "1" }, p);
  assert.deepEqual(log.map((e) => e[1]), ["Bgm", "Voice"]);
  log.length = 0;
  await SoundVolume({ Parameter1: "Se", Parameter2: "0" }, p);   // "se": nothing
  assert.deepEqual(log, []);
  const s = makePlayer({ shortcut: true });                   // shortcutting: CalcDuration 0
  await SoundVolume({ Parameter1: "Voice", Parameter2: "0", Duration: 5 }, s.p);
  assert.equal(s.volumes.get("Voice"), 0);
});

test("SoundVolume fades linearly, one step per frame from the command's frame, then sets the target", async () => {
  let t = makePlayer();
  await t.loop.step();                                        // the command runs in frame 1 (deltaTime 1/30)
  const frame = await settledFrame(t.loop, SoundVolume({ Parameter1: "Voice", Parameter2: "0", Duration: 0.1 }, t.p));
  assert.equal(frame, 4);
  const dt = F(1 / 30), d = F(0.1), t1 = F(dt / d), t2 = F(F(dt + dt) / d);   // float32 elapsed / duration
  assert.deepEqual(t.log, [[1, "Voice", F(1 - t1)], [2, "Voice", F(1 - t2)], [3, "Voice", 0], [4, "Voice", 0]]);
  // Bgm: the start is GetVolume (0.7 = DefaultVolume x 1), multiplied by DefaultVolume again on each ChangeVolume
  t = makePlayer();
  await t.loop.step();
  await settledFrame(t.loop, SoundVolume({ Parameter2: "1", Duration: 0.1 }, t.p));
  const bgm = t.log.filter((e) => e[1] === "Bgm").map((e) => e[2]);
  assert.deepEqual(bgm, [F(0.56), F(0.63), F(0.7), F(0.7)]);    // 0.7 x (0.7 + 0.3 t), t = 1/3, 2/3, 1; then 0.7 x 1
  assert.equal(t.volumes.get("Voice"), 1);
});

test("SoundVolume: IsNoWait returns at once; a new SoundVolume stops a running fade where it is", async () => {
  const { p, loop, log, volumes } = makePlayer();
  await loop.step();
  const first = SoundVolume({ Parameter1: "Voice", Parameter2: "0", Duration: 1, IsNoWait: true }, p);
  assert.equal(await settledFrame(loop, first), 1);
  await loop.step(); await loop.step();                       // steps in frames 1, 2, 3
  assert.equal(log.length, 3);
  await SoundVolume({ Parameter1: "se" }, p);                // "se" still refreshes the token
  const at = volumes.get("Voice");
  for (let i = 0; i < 40; i++) await loop.step();
  assert.equal(log.length, 3);
  assert.equal(volumes.get("Voice"), at);
  const dt = F(1 / 30);
  assert.equal(at, F(1 - F(F(dt + dt) + dt)));                // Lerp(1, 0, elapsed / 1) after three steps
});

test("Expression plays ExpressionName or the default expression with MotionFadeIn", async () => {
  const { p, characters } = makePlayer();
  const ch = fakeCharacter();
  characters.set("A", ch);
  await Expression({ TargetName: "A", ExpressionName: "exp_smile01", MotionFadeIn: 0.5 }, p);
  await Expression({ TargetName: "A" }, p);
  await Expression({ TargetName: "B", ExpressionName: "exp_smile01" }, p);   // not loaded: nothing
  assert.deepEqual(ch.calls, [["expression", "exp_smile01", 0.5], ["default", 0]]);
  const s = makePlayer({ shortcut: true });
  s.characters.set("A", ch);
  await Expression({ TargetName: "A", ExpressionName: "exp_sad01", MotionFadeIn: 2 }, s.p);
  assert.deepEqual(ch.calls[2], ["expression", "exp_sad01", 0]);
});

test("Costume sets the TargetName's asset index", async () => {
  const { p, log } = makePlayer();
  await Costume({ TargetName: "A", TargetAssetIndex: 1 }, p);
  await Costume({ TargetName: "A" }, p);
  assert.deepEqual(log, [["asset", "A", 1], ["asset", "A", 0]]);
});

test("EyeBlink: stop / resume / toggle, recorded in the session, 0.2 s transition", async () => {
  const { p, characters } = makePlayer();
  const ch = fakeCharacter(), names = p.session.eyeBlinkStoppedTargetNames;
  characters.set("A", ch);
  await EyeBlink({ TargetName: "A", Parameter1: "Stop" }, p);
  assert.ok(names.has("A"));
  await EyeBlink({ TargetName: "A" }, p);                    // toggle: resume
  assert.ok(!names.has("A"));
  await EyeBlink({ TargetName: "A" }, p);                    // toggle: stop
  await EyeBlink({ TargetName: "A", Parameter1: "RESUME" }, p);
  await EyeBlink({ TargetName: "B", Parameter1: "stop" }, p); // not loaded: recorded for a later In
  assert.deepEqual(ch.calls.map((c) => c[1]), [true, false, true, false]);
  assert.ok(ch.calls.every((c) => c[2] === F(0.2)));
  assert.deepEqual([...names], ["B"]);
  await EyeBlink({ Parameter1: "stop" }, p);                 // empty TargetName: not recorded
  assert.deepEqual([...names], ["B"]);
  const warn = console.warn, warned = [];
  console.warn = (m) => warned.push(m);
  try { await EyeBlink({ TargetName: "A", Parameter1: "pause" }, p); } finally { console.warn = warn; }
  assert.equal(warned.length, 1);
  assert.equal(ch.calls.length, 4);
  const s = makePlayer({ shortcut: true });
  s.characters.set("A", ch);
  await EyeBlink({ TargetName: "A", Parameter1: "stop" }, s.p);
  assert.deepEqual(ch.calls[4], ["eyeBlink", true, 0]);
});

test("with the interpreter: registered, and running on StoryPlayerCore", async () => {
  const { StoryPlayerCore, StoryCharacters } = await import("../../src/story/player-core.js");
  for (const name of Object.keys(MISC_COMMANDS)) assert.ok(StoryPlayerCore.supportedCommands().includes(name), name);
  const loop = new PlayerLoop(30), characters = new StoryCharacters();
  const a0 = { isShowing: false }, a1 = { isShowing: false };
  characters.add("A", 0, a0); characters.add("A", 1, a1);
  const settings = { player: { _waitCommandLingeringTimeOnAutoPlay: 2 } };
  const ctx = { loop, episode: { commands: [] }, characters, settings };
  const p = new StoryPlayerCore(ctx, { auto: true, speed: 20 });
  await p.execute({ i: 0, cmd: "Costume", TargetName: "A", TargetAssetIndex: 1 });
  assert.equal(characters.get("A"), a1);
  let delayed = null;
  p.delay(3).then((ok) => { delayed = ok; });
  await p.execute({ i: 1, cmd: "CancelDelay" });
  await loop.step();                                          // the cancellation is observed at the next Update tick
  assert.equal(delayed, true);
  let start = loop.frameCount;
  assert.equal(await settledFrame(loop, p.execute({ i: 2, cmd: "Delay", Duration: 1 })) - start, 16);
  // auto, Double speed: one frame, then the 1.0 s linger on PlayerLoop.delay (30 ticks)
  start = loop.frameCount;
  assert.equal(await settledFrame(loop, p.execute({ i: 3, cmd: "Wait" }), { max: start + 100 }) - start, 31);
});
