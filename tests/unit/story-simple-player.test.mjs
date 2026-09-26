import assert from "node:assert/strict";
import test from "node:test";

import { PlayerLoop } from "../../src/engine/loop.js";
import { UINode } from "../../src/engine/ugui.js";
import { createStoryContext } from "../../src/story/interfaces.js";
import { StoryCharacters } from "../../src/story/player-core.js";
import { SilentAudio } from "../../src/story/silent-audio.js";
import { AdvFieldRendererManager } from "../../src/story/field.js";
import { SIMPLE_ADVANCE, SIMPLE_COMPLETE } from "../../src/story/simple/define.js";
import { SimpleAdvPlayer, playLastQueueMotion, talkLipSyncMode } from "../../src/story/simple/player.js";
import { CameraTargetRenderer } from "../../src/story/simple/render.js";
import { runtimeNodeRecord } from "../../src/story/simple/ui.js";
import { SimpleAdvView } from "../../src/story/simple/view.js";

const F = Math.fround;

// a Live2D controller stand-in recording the calls the simple handlers and shared commands make
const fakeCharacter = (name, log) => {
  const state = { isShowing: false, isAlive: true, defaultMotionName: "idle", ctl: { currentMotion: "" },
                  originalLookX: 0, originalLookY: 0, brightness: 1, lookEnabled: false };
  const methods = {
    show(motion, expr, fade) { state.isShowing = true; state.ctl.currentMotion = motion || "idle"; log.push(`${name} show ${motion || "idle"} ${fade}`); },
    hide() { state.isShowing = false; log.push(`${name} hide`); },
    playMotion(m) { state.ctl.currentMotion = m; log.push(`${name} motion ${m}`); },
    setParent(t) { state.parent = t; }, setLayer(l) { state.layer = l; },
    setLookEnabled(v) { state.lookEnabled = v; },
    smoothChangeToLook(x, y, d) { log.push(`${name} look ${x.toFixed(3)} ${y} ${d}`); return Promise.resolve(); },
    setBreathMotionEnabled(v) { state.breath = v; },
  };
  return new Proxy(state, { get: (t, k) => (k in methods ? methods[k] : k in t ? t[k] : () => {}) });
};

// the talk window stand-in: the typewriter shows one character per Update tick
const fakeWindow = (loop, log) => {
  const root = new UINode(runtimeNodeRecord("UISimpleAdvTalkWindow", "UISimpleAdvTalkWindow"), null);
  const talk = {
    typing: false, showing: false,
    refresh() {}, showTalk() { this.showing = true; }, hideTalk() { this.showing = false; log.push("hideTalk"); },
    hideTalkNextIndicator() {}, setSpeakerName() {},
    get isTyping() { return this.typing; },
    setTalk(text) {
      const n = [...text].length; this.typing = true; let cancelled = false;
      const finished = (async () => { for (let i = 0; i < n && !cancelled; i++) await loop.yield("Update"); this.typing = false; })();
      return { totalLength: n, finished, cancel: () => { cancelled = true; } };
    },
  };
  return { root, talk, setSpeakerName(n) { this.speakerName = n; } };
};

const SETTINGS = { _initializeEpisodes: [{ Command: 15, BgmID: 0 }], _finalizeEpisodes: [{ Command: 5 }],
                   _targetNameSplitKey: ",", _waitAfterVoiceTime: 0.6, _waitTalkTextUnitTime: 0.04,
                   _minTalkDisplayTime: 1.6, _waitCommandLingeringTimeOnAutoPlay: 1 };
const TEXT = { 1: { english: "Hello" }, 2: { english: "Hi" }, 3: { english: "Narration" }, 10: { english: "A" }, 11: { english: "B" } };

const makeSimple = (commands, request) => {
  const loop = new PlayerLoop(30), log = [];
  const characters = new StoryCharacters();
  for (const n of ["a", "b"]) characters.add(n, 0, fakeCharacter(n, log));
  const audio = new SilentAudio(() => null, loop, { assets: { json: () => ({}) } });
  const episode = { advId: 1, commands, text: TEXT, sounds: {} };
  const ctx = createStoryContext({
    loop, camera: null, field: null, background: null, fieldRenderer: new AdvFieldRendererManager(loop, {}), volume: null,
    characters, stages: new Map(), ui: null, audio, quality: { characterPhysics: true, characterBreathMotion: true },
    settings: { player: SETTINGS, masterIds: { _unknownCharacterNameTextId: "0", _splitCharacterNameTextId: "0" } },
    localize: (id) => (TEXT[id] ? TEXT[id].english : ""), lang: "en", playbackMode: 1, titleTextId: 0, episode,
    story: {}, assets: null, renderer: null, gl: null });
  const root = new UINode(runtimeNodeRecord("Canvas", "Canvas"), null);
  const overlay = new UINode(runtimeNodeRecord("Canvas/Overlay", "Overlay", { active: false }), root);
  const tweens = { active: new Set() };
  const view = new SimpleAdvView(overlay, null, { tweens, dotween: { defaultEaseType: 6 } });
  loop.on("tweens", (l) => { for (const t of [...tweens.active]) t.step(l.deltaTime); });
  const crts = view.slots.map((s) => new CameraTargetRenderer(s.index, null));
  const win = fakeWindow(loop, log);
  const lines = [];
  const player = new SimpleAdvPlayer(ctx, view, win, new Map([["UISimpleAdvTalkWindow", win]]), request,
    { slotStage: (s) => crts[s.index], onLine: (e) => lines.push(`${loop.frameCount} ${e.text}`) });
  loop.on("update", (l) => player.p.motions.update(l.deltaTime));
  return { loop, player, view, win, log, lines, crts };
};

const row = (i, cmd, extra = {}) => ({ i, cmd, ...extra });
const EPISODE = [
  row(0, "Character", { TargetName: "a" }), row(1, "Character", { TargetName: "b" }),
  row(2, "In", { TargetName: "a", PositionType: 3, IsNoWait: true, Duration: 0.3 }),
  row(3, "In", { TargetName: "b", PositionType: 7, IsNoWait: true, Duration: 0.3 }),
  row(4, "Stage", { TargetAssetName: "000333" }),
  row(5, "Talk", { TargetName: "a", TargetTextIDs: ["10"], AdvTextID: "1" }),
  row(6, "LookTarget", { TargetName: "a", PositionType: 7, Duration: 0.2 }),
  row(7, "Talk", { TargetName: "b", TargetTextIDs: ["11"], AdvTextID: "2" }),
  row(8, "Out", { TargetName: "a" }),
  row(9, "CancelDelay"),
  row(10, "Talk", { AdvTextID: "3" }),
];

const drive = async (s, { taps = true, maxFrames = 2000 } = {}) => {
  let result = null;
  const done = s.player.play().then((r) => { result = r; });
  for (let f = 0; f < maxFrames && result === null; f++) {
    await s.loop.step();
    if (taps && s.win.talk.showing && !s.win.talk.typing && f % 5 === 0) s.view.onTapped();
  }
  await done;
  return result;
};

test("simple player: manual talk, slots by PositionType, look target, skipped commands, CleanupAll", async () => {
  const s = makeSimple(EPISODE, { advanceMode: SIMPLE_ADVANCE.Manual, completeBehavior: SIMPLE_COMPLETE.CleanupAll });
  const seen = [];
  s.player.hooks.onLine = (e) => seen.push(s.view.slots.map((x) => x.targetName));
  let r = null;
  const done = s.player.play().then((x) => { r = x; });
  for (let f = 0; f < 3000 && r === null; f++) {
    await s.loop.step();
    if (s.win.talk.showing && !s.win.talk.typing && f % 5 === 0) s.view.onTapped();
  }
  await done;
  assert.equal(r, "completed");
  // the In rows (IsNoWait) set their slots at the end of the frame (Slot.Show yields to LastPostLateUpdate), after the
  // first line started; PositionType 3 -> the second slot, 7 -> the fourth
  assert.deepEqual(seen[0], [null, null, null, null, null]);
  assert.deepEqual(seen[1], [null, "a", null, "b", null]);
  assert.deepEqual(s.player.skipped.map((x) => x.cmd), ["Stage", "CancelDelay"]);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[2], [null, null, null, "b", null]);             // Out: a hidden at once
  // LookTarget toward PositionType 7 from 3: (0.8 - (-0.8)) x 0.2 = 0.32, y 0
  assert.ok(s.log.includes("a look 0.320 0 0.2"), s.log.join("\n"));
  assert.ok(s.log.indexOf("a hide") > 0);
  assert.equal(s.view.root.activeSelf, false);                          // CleanupAll after the fade out
  assert.ok(s.view.slots.every((x) => !x.character));
});

test("simple player: auto advance keeps the characters (HideTalkWindowKeepCharacters) and ignores taps", async () => {
  const s = makeSimple(EPISODE.filter((c) => c.cmd !== "Out"),
                       { advanceMode: SIMPLE_ADVANCE.Auto, completeBehavior: SIMPLE_COMPLETE.HideTalkWindowKeepCharacters });
  const r = await drive(s, { taps: true });
  assert.equal(r, "completed");
  assert.equal(s.view.root.activeSelf, true);
  assert.deepEqual(s.view.slots.map((x) => x.targetName), [null, "a", null, "b", null]);
  assert.equal(s.view.tap.activeSelf, false);                           // input off after RetainCompletedPresentation
  assert.equal(s.view.window.root.activeSelf, false);
  // "Hello" (5 characters): the typewriter's 5 ticks, then from its end 0.04 x 5 s and the rest of the 1.6 s minimum
  // display time (48 frames)
  const [f0, f1] = s.lines.slice(0, 2).map((l) => Number(l.split(" ")[0]));
  assert.equal(f1 - f0, 53, `${f0} -> ${f1}`);
});

test("simple player: an invalid row refuses the episode before anything shows", async () => {
  const s = makeSimple([row(0, "Talk", { AdvTextID: "1" }), row(1, "EyeBlink", { TargetName: "a", Parameter1: "close" })],
                       { advanceMode: SIMPLE_ADVANCE.Manual });
  assert.equal(await drive(s), "invalid");
  assert.equal(s.lines.length, 0);
  assert.equal(s.player.validation.failure.row, 1);
});

test("simple player: helpers", () => {
  assert.equal(talkLipSyncMode(" EveryoneLipSync "), 3);
  assert.equal(talkLipSyncMode("airlipsync_holdopen"), 2);
  assert.equal(talkLipSyncMode("AirLipSync"), 1);
  assert.equal(talkLipSyncMode(""), 0);
  const played = [];
  const m = { waiting: new Map([["a", { m: "w" }]]), queues: new Map([["a", [{ m: "q1" }, { m: "q2" }]]]),
              playInternal: (d) => played.push(d.m) };
  playLastQueueMotion(m, "a");
  assert.deepEqual(played, ["q2"]);
  assert.equal(m.waiting.size + m.queues.size, 0);
  m.waiting.set("b", { m: "w" });
  playLastQueueMotion(m, "b");
  assert.deepEqual(played, ["q2", "w"]);
  assert.equal(F(0.2), F(0.2));
});
