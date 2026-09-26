// Voice on a real PlayerLoop at 30 fps with a stand-in sound manager (voices finish after a set number of frames) and
// stand-in characters: the row's frames in auto and manual mode, a tap during the voices, the lip sync of named
// speakers, the scope shared with later rows, voices off, shortcutting. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { commandHandler } from "../../src/story/interfaces.js";
import "../../src/story/features/index.js";
import { beginVoicePlaybackScope } from "../../src/story/commands/voice.js";

const flush = () => new Promise((res) => setImmediate(res));
const settle = async (loop, promise, max = 600) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  const f0 = loop.frameCount;
  while (!done && loop.frameCount - f0 < max) { await loop.step(); await flush(); }
  assert.ok(done, "not settled");
  return loop.frameCount - f0;
};
const steps = async (loop, n) => { await flush(); for (let i = 0; i < n; i++) { await loop.step(); await flush(); } };

// a sound manager whose voices finish `len` frames after they start (onFinished runs on stop and on the end)
const fakeAudio = (loop, len) => {
  const a = { nextId: 1, playing: new Map(), log: [], lastBgmOrSeFrame: -1,
    play(soundId, { onPlayStart = null } = {}) {
      const info = { id: a.nextId++, soundId, onFinished: [], end: loop.frameCount + len };
      a.playing.set(info.id, info); a.log.push(["play", soundId, loop.frameCount]);
      if (onPlayStart) onPlayStart(info);
      return info.id;
    },
    stop(id) { const i = a.playing.get(id); if (!i) return; a.playing.delete(id); a.log.push(["stop", i.soundId]); for (const f of i.onFinished) f(); },
    isPlaying: (id) => a.playing.has(id), pcmSource: (info) => ({ voice: info.id }) };
  loop.on("update", () => {
    for (const i of [...a.playing.values()]) if (loop.frameCount >= i.end) { a.playing.delete(i.id); for (const f of i.onFinished) f(); }
  });
  return a;
};
const fakeCharacter = (name, log) => ({ name, isMotionSyncEnabled: false,
  setLipSyncPresentationMode(m) { log.push([name, "mode", m]); }, setLipsAnalyzer(s) { log.push([name, "lips", s && s.voice]); },
  setLipSyncEnabled(b) { log.push([name, "lip", b]); }, clearMotionSyncSource() {}, stopTimedPseudoLipSync() {},
  setMouthOpening(v) { log.push([name, "mouth", v]); } });

const makePlayer = ({ auto = true, len = 20, withVoice = true } = {}) => {
  const loop = new PlayerLoop(30), chLog = [], indicator = [];
  const chars = new Map([["A", fakeCharacter("A", chLog)], ["B", fakeCharacter("B", chLog)]]);
  const ctx = { loop, audio: fakeAudio(loop, len), characters: { get: (n) => chars.get(n) },
                ui: { showNextIndicator: () => indicator.push(true), hideNextIndicator: () => indicator.push(false) },
                settings: { player: { _waitAfterVoiceTime: 0.6, _targetNameSplitKey: "/" } } };
  const p = { ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1, isAutoPlay: auto, nextStep: 0, autoAdvCancel: null,
              session: { voicePlayIds: [], withVoice, activeVoiceLipSync: new Map(), motionSyncVoices: new Map() },
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return this.shortCutIndex >= 0; },
              changeNextStepStateOnAutoPlay() { this.nextStep = this.isAutoPlay ? 2 : 1; },
              noWait(c, task) { if (c.IsNoWait) { task.catch((e) => { throw e; }); return Promise.resolve(); } return task; },
              tap() { const f = this.autoAdvCancel; this.autoAdvCancel = null; if (f) f(); if (this.nextStep === 1) this.nextStep = 2; } };
  return { ctx, p, loop, chLog, indicator };
};
const Voice = commandHandler("Voice");

test("Voice (auto): the voices, then 0.6 s from the frame after the last one's end; the named speaker's lip sync", async () => {
  const t = makePlayer({ len: 20 });
  const frames = await settle(t.loop, Voice({ i: 0, TargetName: "A/B", VoiceIDs: [7, 8, 9] }, t.p));
  // the voices end in the MonoBehaviour update of frame 20 and are seen at the next tick; each further voice's wait
  // costs one tick; then 18 frames of DelayWithSpeedAdjustment(0.6)
  assert.equal(frames, 20 + 1 + 2 + 18);
  assert.deepEqual(t.ctx.audio.log.filter((e) => e[0] === "play").map((e) => e[1]), [7, 8, 9]);
  // lip sync on the voice (A: voice 1, B: voice 2), stopped at the voice's end and again by the row's end; voice 3 has
  // no speaker
  assert.deepEqual(t.chLog.filter((e) => e[0] === "A" && e[1] === "lips").map((e) => e[2]), [1, null, null]);
  assert.deepEqual(t.chLog.filter((e) => e[0] === "B" && e[1] === "lips").map((e) => e[2]), [2, null, null]);
  assert.deepEqual(t.chLog.filter((e) => e[1] === "mouth"), [["A", "mouth", 0], ["B", "mouth", 0]]);
  assert.equal(t.p.nextStep, 0);
  assert.deepEqual(t.p.session.voicePlayIds, []);
});

test("Voice (manual): the front next indicator after the voices, the tap ends the row; a tap during the voices cuts them", async () => {
  const t = makePlayer({ auto: false, len: 30 });
  const row = Voice({ i: 0, VoiceIDs: [5] }, t.p);
  await steps(t.loop, 31);
  assert.deepEqual(t.indicator, [true]);
  t.p.tap();
  await settle(t.loop, row);
  assert.deepEqual(t.indicator, [true, false]);
  assert.equal(t.p.nextStep, 0);
  const row2 = Voice({ i: 1, VoiceIDs: [6] }, t.p);
  await steps(t.loop, 5);
  t.p.tap();
  const f = await settle(t.loop, row2);
  assert.equal(f, 1);                                                   // the cancelled wait ends at the next tick
  assert.equal(t.p.nextStep, 2);                                        // no ChangeIdleState after the cancel
  assert.deepEqual(t.ctx.audio.log.at(-1), ["stop", 6]);
});

test("Voice: a later Talk's scope makes an IsNoWait Voice stale; voices off and shortcut rows do nothing", async () => {
  const t = makePlayer({ len: 40 });
  await Voice({ i: 0, VoiceIDs: [3], IsNoWait: true }, t.p);
  await steps(t.loop, 3);
  beginVoicePlaybackScope(t.p.session);                                 // a Talk row starts
  t.p.session.voicePlayIds = [];                                        // and stops the current voices
  t.ctx.audio.stop(1);
  const cancel = t.p.autoAdvCancel; t.p.autoAdvCancel = null; cancel();
  await steps(t.loop, 2);
  assert.equal(t.ctx.audio.log.filter((e) => e[0] === "stop").length, 1);   // the stale Voice stopped nothing more
  const off = makePlayer({ withVoice: false });
  assert.equal(await settle(off.loop, Voice({ i: 0, VoiceIDs: [1] }, off.p)), 0);
  assert.equal(off.ctx.audio.log.length, 0);
  const sc = makePlayer();
  sc.p.shortCutIndex = 3;
  assert.equal(await settle(sc.loop, Voice({ i: 0, VoiceIDs: [1] }, sc.p)), 0);
  assert.equal(sc.ctx.audio.log.length, 0);
});
