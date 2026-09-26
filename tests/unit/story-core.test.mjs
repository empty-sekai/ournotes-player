import assert from "node:assert/strict";
import test from "node:test";

import { PlayerLoop } from "../../src/engine/loop.js";
import { ADV_COMMAND, StoryCommandError, checkEpisodeCommands, checkStoryUI, createStoryContext, createStoryUILayers,
         registerCommand, registeredCommands, unregisteredCommands, STORY_CONTEXT_FIELDS } from "../../src/story/interfaces.js";
import { advRow, advViewport, floatParam, htmlColor, intParam, storyLines } from "../../src/story/params.js";
import { AdvCommandDelayTokens, NEXT_STEP, StoryCharacters, StoryPlayerCore } from "../../src/story/player-core.js";
import { SilentAudio } from "../../src/story/silent-audio.js";
import { AdvCharacterField, AdvFieldRendererManager, AdvGlobalVolume } from "../../src/story/field.js";
import { AdvStageData } from "../../src/story/stage.js";
import { Transform } from "../../src/engine/math.js";
import { createAutoAdvCancellation } from "../../src/story/commands/talk.js";
import { delayWithPauseSpeedAdjustment } from "../../src/story/commands/misc.js";
import { featureState } from "../../src/story/features/state.js";
import { StoryRenderer } from "../../src/story/renderer.js";

// ------------------------------------------------------------------------------------------------ synthetic story
// A story UI with the timing the interpreter depends on: the typewriter shows one character per Update tick, the
// location caption and the rule transitions last their duration on the loop.
class TimingUI {
  constructor(loop, log) {
    this.loop = loop; this.log = log; this.typing = false; this.layers = createStoryUILayers();
    this.talkWindows = ["UIDefaultTalkWindow"];
  }
  load() { return Promise.resolve(); }
  setTalkWindow(name) { if (!this.talkWindows.includes(name)) throw new StoryCommandError(`talk window ${name}`); }
  showTalk() {} hideTalk() { this.log("hideTalk"); } hideTalkNextIndicator() {} setAutoMode(on) { this.auto = on; }
  setFastIconActive() {} setPlaybackSpeed(r) { this.rate = r; } setSpeakerName(n) { this.speaker = n; }
  showTitle(t) { this.log(`title ${t}`); return Promise.resolve(); }
  get isTyping() { return this.typing; }
  setTalk(text) {
    const n = [...text].length;
    this.typing = true;
    let cancelled = false;
    const finished = (async () => {
      for (let i = 0; i < n && !cancelled; i++) await this.loop.yield("Update");
      this.typing = false;
    })();
    return { totalLength: n, finished, cancel: () => { cancelled = true; } };
  }
  showLocation(name) { this.log(`location ${name}`); return this.loop.delay(2.5); }
  transitionSettings(a) { return { address: a }; }
  fadeOut(s, c, d) { this.log(`fadeOut ${d}`); return this.loop.delay(d); }
  fadeIn(s, c, d) { this.log(`fadeIn ${d}`); return this.loop.delay(d); }
  fadeInLetterBox() { return Promise.resolve(); }
  render() {} renderLetterBox() {} dispose() {}
}

const SETTINGS = {
  _initializeEpisodes: [{ Command: 15, BgmID: 0 }, { Command: 31, Parameter1: "Stop" },
                        { Command: 6, TargetName: "adv_transition_0001", TargetAssetName: "t1", Duration: 1, IsNoWait: true }],
  _finalizeEpisodes: [{ Command: 2, IsNoWait: true, IgnoreLipSync: true }, { Command: 5, TargetAssetName: "t1", Duration: 1 }],
  _targetNameSplitKey: "・", _waitAfterVoiceTime: 0.6, _waitTalkTextUnitTime: 0.04, _minTalkDisplayTime: 1.6,
  _defaultTransitionAssetAddress: "t1", _defaultFocusDataSettingsKey: "k", _focusDataSettingsMap: { _list: [] },
};

const TEXT = { 1: { english: "Hello there" }, 2: { english: "Bye" }, 3: { english: "<b>Tall</b> <r=reading>tree</r>" },
               11000: { english: "???" }, 11001: { english: " & " } };
const SOUNDS = { 7: { _soundCueSheetID: 1, _cueName: "bgm", _category: 0 }, 8: { _soundCueSheetID: 1, _cueName: "se", _category: 1 } };
const CUES = { bgm: { sampleRate: 48000, samples: 48000 * 60 }, se: { sampleRate: 48000, samples: 24000 } };

const makeStory = (commands, { auto = true, speed = 10, shortCutIndex = -1 } = {}) => {
  const loop = new PlayerLoop(30), lines = [];
  const log = (m) => lines.push(`${loop.frameCount} ${m}`);
  const ui = checkStoryUI(new TimingUI(loop, log));
  const episode = { advId: 1, commands, text: TEXT, sounds: SOUNDS, cuesheets: { 1: { _cueSheetName: "s" } } };
  const assets = { json: () => CUES };
  const resolve = (id) => { const s = SOUNDS[id]; return { sheet: "s", cue: s._cueName, category: s._category, row: s }; };
  const audio = new SilentAudio(resolve, loop, { assets });
  loop.on("update", () => audio.update());
  const stub = { stopAlwaysUpdate() {}, markUpdateOnce() {} };
  const ctx = createStoryContext({
    loop, camera: null, field: null, background: null, fieldRenderer: null, volume: stub, characters: new StoryCharacters(),
    stages: new Map(), ui, audio, quality: {}, lang: "en", playbackMode: 0, titleTextId: 0, episode, story: {}, assets,
    settings: { player: SETTINGS, masterIds: { _unknownCharacterNameTextId: "11000", _splitCharacterNameTextId: "11001" } },
    localize: (id) => (TEXT[id] ? TEXT[id].english : ""), renderer: null, gl: null });
  const trace = [];
  const core = new StoryPlayerCore(ctx, { auto, speed, shortCutIndex,
                                          onCommand: (c) => trace.push(`${loop.frameCount} #${c.i} ${c.cmd}`) });
  return { loop, core, ui, audio, trace, lines };
};

const run = async ({ loop, core }, { maxFrames = 3000, each = null } = {}) => {
  let done = false, err = null;
  core.play().then(() => { done = true; }, (e) => { err = e; done = true; });
  let n = 0;
  while (!done && n < maxFrames) { if (each) each(n); await loop.step(); n++; }
  if (err) throw err;
  assert.ok(done, "the episode ended");
  return n;
};

const talk = (i, id, extra = {}) => ({ i, cmd: "Talk", AdvTextID: String(id), ...extra });

// ------------------------------------------------------------------------------------------------ interfaces
test("registry: every built-in command is an AdvCommand, registered once", () => {
  const names = registeredCommands();
  for (const n of ["In", "Out", "Talk", "FadeOut", "FadeIn", "Focus", "Bgm", "Location", "Motion", "Character", "Stage",
                   "Se", "TalkWindow", "Look", "LookTarget", "Pedestal", "Track", "Zoom", "MoveToDirection", "PanV2"])
    assert.ok(names.includes(n), n);
  for (const n of names) assert.ok(ADV_COMMAND.includes(n));
  assert.throws(() => registerCommand("Talk", () => Promise.resolve()), StoryCommandError);
  assert.throws(() => registerCommand("NotACommand", () => Promise.resolve()), StoryCommandError);
});

test("registry: an episode with unregistered commands is refused, naming them", () => {
  const rows = [{ cmd: "Talk" }, { cmd: "Timeline" }, { cmd: "ChoiceSet" }, { cmd: "Timeline" }, { cmd: "GoTo", IgnoreData: true }];
  assert.deepEqual(unregisteredCommands(rows.filter((c) => !c.IgnoreData)), ["Timeline", "ChoiceSet"]);
  assert.throws(() => checkEpisodeCommands(rows, "story 1"), /story 1: commands not supported by this player: Timeline, ChoiceSet$/);
  assert.throws(() => StoryPlayerCore.checkEpisode({ commands: [{ i: 0, cmd: "Timeline" }] }, SETTINGS, "story 2"),
                /Timeline/);
  assert.doesNotThrow(() => StoryPlayerCore.checkEpisode({ commands: [talk(0, 1)] }, SETTINGS, "story 3"));
});

test("StoryContext has exactly the published fields", () => {
  const parts = Object.fromEntries(STORY_CONTEXT_FIELDS.map((k) => [k, null]));
  assert.deepEqual(Object.keys(createStoryContext(parts)), [...STORY_CONTEXT_FIELDS]);
  const { lang, ...less } = parts;
  assert.throws(() => createStoryContext(less), /"lang" missing/);
  assert.throws(() => createStoryContext({ ...parts, extra: 1 }), /unknown field "extra"/);
  assert.throws(() => checkStoryUI({ layers: [] }), /StoryUI: missing/);
});

// ------------------------------------------------------------------------------------------------ helpers
test("parameters: Single.TryParse / Int32.TryParse / TryParseHtmlString", () => {
  assert.equal(floatParam(" 1.5 "), 1.5); assert.equal(floatParam("Stop"), 0); assert.equal(floatParam(undefined), 0);
  assert.equal(floatParam("-.25e1"), -2.5); assert.equal(intParam("12"), 12); assert.equal(intParam("1.5"), 0);
  assert.deepEqual(htmlColor("#FFF"), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(htmlColor("#00000080"), { r: 0, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(htmlColor("＃FFFFFF"), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(htmlColor("#FFFFFFF"), { r: 0, g: 0, b: 0, a: 1 });
  assert.throws(() => htmlColor("white"), StoryCommandError);
  assert.deepEqual(advRow({ Command: 35, TargetName: "x" }, "init0"), { Command: 35, TargetName: "x", i: "init0", cmd: "TalkWindow" });
});

test("StoryCharacters: TargetName-TargetAssetIndex keys, the first model of a key kept, Costume index", () => {
  const cs = new StoryCharacters(), a = { n: "a" }, b = { n: "b" }, a2 = { n: "a2" };
  assert.ok(cs.add("rana", 0, a)); assert.ok(!cs.add("rana", 0, b)); assert.ok(cs.add("rana", 1, a2));
  assert.equal(cs.get("rana"), a);
  cs.setAssetIndex("rana", 1);
  assert.equal(cs.get("rana"), a2); assert.equal(cs.label(a2), "rana-1"); assert.equal(cs.label(a), "rana");
  assert.equal(cs.get(""), undefined); assert.equal(cs.get("tomori"), undefined);
});

test("calcDuration: speed rate and shortcut", () => {
  const { core } = makeStory([]);
  assert.equal(core.calcDuration(2, 0), 2); assert.equal(core.calcDuration(0, 0.5), 0.5); assert.equal(core.calcDuration(-1, 3), 0);
  core.playbackSpeed = 20; assert.equal(core.calcDuration(2, 0), 1);
  core.playbackSpeed = 15; assert.equal(core.calcDuration(3, 0), 2);
  core.shortCutIndex = 4; assert.equal(core.calcDuration(3, 0), 0);
});

test("GetBlockingSeconds", () => {
  const b = StoryPlayerCore.blockingSeconds;
  assert.equal(b({ cmd: "In", Duration: 0.5, DelaySeconds: 2 }), 0.5);
  assert.equal(b({ cmd: "Focus", Duration: 0.5, DelaySeconds: 2 }), 2.5);
  assert.equal(b({ cmd: "Zoom", Duration: 0.5, DelaySeconds: -2 }), 0.5);
  assert.equal(b({ cmd: "Flash" }), 0.3);
  assert.equal(b({ cmd: "Still", Parameter1: "1.25" }), 1.25);
  assert.equal(b({ cmd: "Talk", Duration: 3 }), 0);
});

test("AdvCommandDelayTokens: a delay that runs out resumes like PlayerLoop.delay; CancelDelay ends the pending ones " +
     "with true at the next tick, a stop with false", async () => {
  const loop = new PlayerLoop(30), tokens = new AdvCommandDelayTokens(loop);
  const got = [];
  tokens.delay(0.1).then((ok) => got.push(["a", ok, loop.frameCount]));
  loop.delay(0.1).then((ok) => got.push(["b", ok, loop.frameCount]));
  const pending = tokens.delay(10).then((ok) => got.push(["c", ok, loop.frameCount]));
  for (let i = 0; i < 5; i++) await loop.step();
  assert.deepEqual(got, [["a", true, 3], ["b", true, 3]]);
  tokens.cancel();
  await loop.step();
  await pending;
  assert.deepEqual(got[2], ["c", true, 6]);
  const stopped = tokens.delay(10);
  tokens.cancel(false);
  await loop.step();
  assert.equal(await stopped, false);
  assert.equal(await tokens.delay(0), true);
});

test("advViewport: 13:6 letterbox on narrower landscape screens", () => {
  assert.deepEqual(advViewport(2340, 1080), { x: 0, y: 0, w: 2340, h: 1080 });
  assert.deepEqual(advViewport(1920, 1080), { x: 0, y: 97, w: 1920, h: 886 });
  assert.deepEqual(advViewport(2400, 1080), { x: 0, y: 0, w: 2400, h: 1080 });
});

// ------------------------------------------------------------------------------------------------ playback
test("playback: initialize rows, story rows, finalize rows; FadeOut awaited, FadeIn IsNoWait forgotten", async () => {
  const s = makeStory([{ i: 0, cmd: "Bgm", BgmID: 7 }, talk(1, 1), { i: 2, cmd: "Se", SeID: 8 },
                       { i: 3, cmd: "FadeOut", Duration: 0.5, IsNoWait: true }, { i: 4, cmd: "FadeIn", Duration: 0.5 }]);
  const frames = await run(s);
  const cmds = s.trace.map((t) => t.split(" ").slice(1).join(" "));
  assert.deepEqual(cmds, ["#-1 TalkWindow", "#init0 Bgm", "#init1 Se", "#init2 FadeIn", "#0 Bgm", "#1 Talk", "#2 Se",
                          "#3 FadeOut", "#4 FadeIn", "#fin0 Talk", "#fin1 FadeOut"]);
  const frameOf = (k) => Number(s.trace.find((t) => t.includes(` #${k} `)).split(" ")[0]);
  // the line: 11 characters (one per tick), then max(0.04 x 11, 1.6) s from the typewriter's end
  const talkEnd = frameOf(2);
  assert.ok(talkEnd - frameOf(1) >= 11 + 48 && talkEnd - frameOf(1) <= 11 + 51, `talk took ${talkEnd - frameOf(1)} frames`);
  assert.equal(frameOf(3), talkEnd);                                     // Se never blocks
  assert.ok(frameOf(4) - frameOf(3) >= 15, "FadeOut ignores IsNoWait");
  assert.ok(frameOf("fin0") - frameOf(4) >= 15, "FadeIn without IsNoWait is awaited");
  assert.ok(frames > frameOf("fin1") + 29, "the final FadeOut is awaited");
  assert.ok(s.lines.includes(`${frameOf("fin0")} hideTalk`), "the empty finalize Talk hides the talk window");
});

test("playback: IgnoreData rows are neither executed nor checked", async () => {
  const s = makeStory([{ i: 0, cmd: "Timeline", IgnoreData: true }, talk(1, 2)]);
  await run(s);
  assert.ok(!s.trace.some((t) => t.includes("Timeline")));
});

test("playback speed divides the auto-advance timing", async () => {
  const slow = makeStory([talk(0, 2), { i: 1, cmd: "Location", AdvTextID: "2" }]);
  const fast = makeStory([talk(0, 2), { i: 1, cmd: "Location", AdvTextID: "2" }], { speed: 20 });
  await run(slow); await run(fast);
  const gap = (s) => { const f = s.trace.map((t) => [t.split(" ")[1], Number(t.split(" ")[0])]);
                       return f.find(([k]) => k === "#1")[1] - f.find(([k]) => k === "#0")[1]; };
  // 3 characters (WaitWhile ends with the typewriter), the float32 countdown of 1.6 s at speed 1 and 0.8 s at speed 2
  // (the typewriter here does not follow the speed), then WaitAutoPlayText's and Talk's WaitUntil ticks
  assert.deepEqual([gap(slow), gap(fast)], [54, 29]);
});

test("manual advance: a line waits for a tap; a tap while typing reveals it and needs a second tap", async () => {
  const s = makeStory([talk(0, 1), talk(1, 1)], { auto: false });
  const taps = { 30: 1, 40: 1, 45: 1, 200: 1, 260: 1 };
  let n = 0;
  await run(s, { each: (k) => { n = k; if (taps[k]) s.core.tap(); } });
  const f = (k) => Number(s.trace.find((t) => t.includes(` #${k} `)).split(" ")[0]);
  // line 0 shows at frame 1; the tap at 30 (typing over) advances it; line 1's first tap (40) comes while typing
  assert.ok(f(1) >= 31 && f(1) <= 32, `line 1 at ${f(1)}`);
  assert.ok(f("fin0") >= 46 && f("fin0") <= 47, `after line 1: ${f("fin0")}`);
  assert.equal(s.core.nextStep, NEXT_STEP.Idle);
});

test("auto mode toggled on while a line waits for a tap advances it", async () => {
  const s = makeStory([talk(0, 1), talk(1, 2)], { auto: false });
  await run(s, { each: (k) => { if (k === 50) s.core.setAuto(true); } });
  const f1 = Number(s.trace.find((t) => t.includes(" #1 ")).split(" ")[0]);
  assert.ok(f1 >= 51 && f1 <= 52, `line 1 at ${f1}`);
  assert.equal(s.ui.auto, true);
});

test("shortcut: the rows before the target run instantly and silently; the last skipped BGM plays at the target", async () => {
  const s = makeStory([{ i: 0, cmd: "Bgm", BgmID: 7 }, talk(1, 1), { i: 2, cmd: "Location", AdvTextID: "2" },
                       { i: 3, cmd: "FadeOut", Duration: 2 }, talk(4, 2)], { shortCutIndex: 4 });
  const played = [];
  const play = s.audio.play.bind(s.audio);
  s.audio.play = (id, o) => { played.push([id, s.loop.frameCount]); return play(id, o); };
  let covered = 0;
  await run(s, { each: () => { if (s.core.coverBlack) covered++; } });
  const f = (k) => Number(s.trace.find((t) => t.includes(` #${k} `)).split(" ")[0]);
  assert.equal(f(3), f(0), "skipped rows take no time");
  assert.ok(f(4) - f(3) >= 6 && f(4) - f(3) <= 8, "0.2 s after the skipped rows the target row runs");
  assert.deepEqual(played.map((p) => p[0]), [7], "the BGM plays once, at the target");
  assert.ok(covered >= 6, "the screen is covered black while shortcutting");
  assert.equal(s.core.shortcut, false);
});

test("talk log: Talk lines (also those the shortcut passes) and Location captions, tags removed but ruby kept", async () => {
  const s = makeStory([talk(0, 3, { TargetName: "A", TargetTextIDs: ["1"], VoiceIDs: [5] }), { i: 1, cmd: "Location", AdvTextID: "2" },
                       talk(2, 2)], { shortCutIndex: 2 });
  const logs = [];
  s.core.onLog = (e) => logs.push(e);
  await run(s);
  assert.deepEqual(logs.slice(0, 3), [
    { row: 0, speaker: "Hello there", text: "Tall <r=reading>tree</r>", voiceIds: [5] },
    { row: 1, speaker: null, text: "Bye", voiceIds: [] },
    { row: 2, speaker: "", text: "Bye", voiceIds: [] }]);
});

test("stop (skip): the running wait ends, the finalize rows do not run", async () => {
  const s = makeStory([talk(0, 1), talk(1, 2)]);
  await run(s, { each: (k) => { if (k === 20) s.core.stop(1); } });
  assert.ok(!s.trace.some((t) => t.includes("#fin")));
  assert.equal(s.core.stopReason, 1);
});

test("playback: PlayCommands follows the list index; a row that moved it is not stepped past", async () => {
  const rows = [0, 1, 2, 3, 4].map((i) => ({ i, cmd: "Delay", Duration: 0, ...(i === 3 ? { IgnoreData: true } : {}) }));
  const s = makeStory(rows);
  const ran = [];
  let back = true;
  const exec = s.core.execute.bind(s.core);
  s.core.execute = (c) => {
    if (typeof c.i === "number" && c.i >= 0) ran.push([c.i, s.core.currentEpisodeListIndex]);
    if (c.i === 0) s.core.setCurrentEpisodeListIndex(3);              // onto an IgnoreData row: it is passed over
    if (c.i === 4 && back) { back = false; s.core.setCurrentEpisodeListIndex(2); }
    return exec(c);
  };
  await run(s);
  assert.deepEqual(ran, [[0, 0], [4, 4], [2, 2], [4, 4]]);
  assert.equal(s.core.currentEpisodeListIndex, 5);
});

// the fields of the story video the core and the Delay command read (features/video.js StoryVideo)
const fakeVideo = (states = []) => {
  const v = { flow: { clipVideoSkip: false, clipVideoPlaying: false, clipControlAvailable: false, movieVideoPlaying: false },
              advanced: [], snapped: [],
              timeline: { isActive: true, remainingSeconds: 0.5, advanceTarget: (d) => v.advanced.push(d),
                          end() { this.isActive = false; } },
              updateTimeline: () => (states.length ? states.shift() : 0), snapTimeline: (paused) => v.snapped.push(paused) };
  return v;
};

test("Delay with a video timeline: the target moves by the raw Duration; a lost video leaves the rest to the clock", async () => {
  const s = makeStory([{ i: 0, cmd: "Delay", Duration: 1 }, { i: 1, cmd: "Delay", Duration: 0 }], { speed: 20 });
  const v = featureState(s.core.ctx).video = fakeVideo([1, 1, 1, 1, 2]);   // Waiting x4, then Aborted with 0.5 s left
  await run(s);
  const f = (k) => Number(s.trace.find((t) => t.includes(` #${k} `)).split(" ")[0]);
  assert.deepEqual(v.advanced, [1]);                                     // not divided by the speed rate
  assert.equal(v.timeline.isActive, false);
  // four waiting frames, then CalcDuration(0.5) = 0.25 s at x2 on the clock
  assert.ok(f(1) - f(0) >= 11 && f(1) - f(0) <= 13, `delay took ${f(1) - f(0)} frames`);
});

test("DelayWithPauseSpeedAdjustment ends when a Clip video is skipped", async () => {
  const s = makeStory([]);
  const v = featureState(s.core.ctx).video = fakeVideo();
  let result = null;
  delayWithPauseSpeedAdjustment(s.core, 5).then((r) => { result = r; });
  for (let n = 0; n < 3; n++) await s.loop.step();
  assert.equal(result, null);
  v.flow.clipVideoSkip = true;
  for (let n = 0; n < 2; n++) await s.loop.step();
  assert.equal(result, true);
});

test("a tap on a playing video shows its controls and does not advance the line", () => {
  const s = makeStory([]);
  const shown = [];
  s.ui.showVideoButtons = (skip) => shown.push(skip);
  const v = featureState(s.core.ctx).video = fakeVideo();
  s.core.nextStep = NEXT_STEP.AllowNext;
  v.flow.movieVideoPlaying = true;
  s.core.tap();
  assert.deepEqual(shown, [true]);
  assert.equal(s.core.nextStep, NEXT_STEP.AllowNext);
  v.flow.movieVideoPlaying = false;
  s.core.tap();
  assert.equal(s.core.nextStep, NEXT_STEP.GoNext);
});

test("auto-advance token: a new one cancels the previous; the Auto button keeps it, fast-forward clears it", () => {
  const s = makeStory([]), core = s.core;
  let cancelled = 0;
  createAutoAdvCancellation(core, () => { cancelled += 1; });
  createAutoAdvCancellation(core, () => { cancelled += 10; });
  assert.equal(cancelled, 1);
  core.playbackSpeed = 15; core.autoPlay = true;
  core.session.voicePlayIds = [s.audio.play(8, {})];
  core.pressAuto(false);                                      // auto off at x1.5: speed x1, voices stopped, token kept
  assert.deepEqual(core.session.voicePlayIds, []);
  assert.equal(core.playbackSpeed, 10);
  assert.equal(cancelled, 1);
  core.pressFastForward(15);                                  // StopCurrentVoices(false): the token cleared
  assert.equal(cancelled, 11);
  assert.equal(core.autoAdvCancel, null);
});

test("AdvFieldRendererManager: OnCharacterOrderChanged after each SetCharacterEntries; the foreground entry count", () => {
  const fr = new AdvFieldRendererManager(new PlayerLoop(30), {});
  let n = 0;
  const off = fr.onCharacterOrderChanged(() => n++);
  fr.setCharacterEntries(); fr.sortCharacters();
  assert.equal(n, 2);
  off();
  fr.sortCharacters();
  assert.equal(n, 2);
  assert.equal(fr.isForegroundActive, false);
  fr.addForegroundEntry(); fr.addForegroundEntry(); fr.removeForegroundEntry();
  assert.equal(fr.isForegroundActive, true);
  fr.removeForegroundEntry(); fr.removeForegroundEntry();     // never below 0
  assert.equal(fr.foreground.count, 0);
  fr.addForegroundEntry();
  assert.equal(fr.isForegroundActive, true);
});

test("StoryRenderer: feature renderers routed by layer (main camera list, offscreen composite, UI camera refused)", () => {
  const items = [12, 6, 7, 9, 11, 0].map((layer) => ({ layer }));
  const groups = [{ entries: [{ layer: 6 }, { layer: 8 }] }, { entries: [{ layer: 7 }] }];
  const r = StoryRenderer.routeOffscreen(items, groups);
  const layers = (list) => list.map((it) => it.layer);
  assert.deepEqual(layers(r.background), [12]);
  assert.deepEqual(r.groups.map(layers), [[6], [7]]);                    // 9: no group has it, not drawn
  assert.deepEqual(layers(r.foreground), [11]);
  assert.deepEqual(layers(StoryRenderer.mainCameraItems(items)), [12, 6, 7, 9, 11]);
  assert.throws(() => StoryRenderer.checkLayer(13), /UI camera/);
  assert.throws(() => StoryRenderer.checkLayer(5), /UI camera/);
  assert.doesNotThrow(() => StoryRenderer.checkLayer(11));
});

test("storyLines: Talk rows with a valid text id", () => {
  const e = { commands: [talk(0, 1), talk(1, 0), { i: 2, cmd: "Talk" }, talk(3, 2, { IgnoreData: true }), talk(4, 2)] };
  assert.deepEqual(storyLines(e).map((c) => c.i), [0, 4]);
});

test("AdvGlobalVolume: volumes of equal priority blend in registration order", () => {
  // the prefab parts are not needed for the order: the volume's own fields as the constructor leaves them
  const v = Object.create(AdvGlobalVolume.prototype);
  const profile = (name) => ({ name });
  v.warmup = { profile: profile("warmup"), enabled: true, weight: 1 };
  v.all = { profile: null, enabled: false, weight: 1 };
  v.registered = [v.warmup];
  v.always = false;
  const stage = (name) => synthStage({ volumeProfiles: name ? [profile(name)] : [] });
  const order = () => v._volumes().map((x) => x.profile.name);
  v.setStageInfo(stage("stage1"));
  assert.deepEqual(order(), ["warmup", "stage1"]);
  const child = { profile: profile("post"), enabled: true, weight: 0.5 };
  v.addChildVolume(child);
  assert.deepEqual(order(), ["warmup", "stage1", "post"]);
  v.setStageInfo(stage("stage2"));                          // still enabled: keeps its place
  assert.deepEqual(order(), ["warmup", "stage2", "post"]);
  v.setStageInfo(stage(null));                              // disabled: unregistered
  assert.deepEqual(order(), ["warmup", "post"]);
  v.setStageInfo(stage("stage3"));                          // enabled again: registered after the child
  assert.deepEqual(order(), ["warmup", "post", "stage3"]);
  v.removeChildVolume(child);
  v.addChildVolume(child);
  assert.deepEqual(order(), ["warmup", "stage3", "post"]);
  assert.equal(v.always, true);
});

// a stage with the fields the stage methods use (the prefab parts are not needed)
const synthStage = ({ focusPoints = [], lightGroups = [], volumeProfiles = [], particleGroups = [] } = {}) => {
  const st = Object.create(AdvStageData.prototype);
  Object.assign(st, { name: "stage", focusPoints, volumeProfiles, characterFieldPosition: { x: 1, y: 2, z: 3 },
                      characterFieldScale: 2, currentLightGroup: 0, currentParticleEffectGroup: 0, particleGroups,
                      loop: { name: "loop" } });
  st.lightGroups = lightGroups.map((g) => g.map((path) => ({ path })));
  st.lightActive = new Map(st.lightGroups.flat().map((l) => [l.path, false]));
  return st;
};

test("AdvCharacterField: focus stage positions, field position and scale", () => {
  const f = Object.create(AdvCharacterField.prototype);
  f.anchors = Array.from({ length: 9 }, (_, i) => new Transform(`anchor${i}`));
  f.stages = Array.from({ length: 5 }, (_, i) => new Transform(`stage${i}`));
  f.field = new Transform("field");
  f.stageY = f.stages.map(() => 0); f.stageYTweens = f.stages.map(() => null);
  const set = (k) => Array.from({ length: 9 }, (_, i) => ({ x: k, y: i, z: 0 }));
  const stage = synthStage({ focusPoints: [set(0), set(10)] });
  f.setStageInfo(stage, 1);
  assert.deepEqual(f.anchors.map((a) => a.localPosition.x), Array(9).fill(10));
  assert.deepEqual(f.stages.map((s) => s.localPosition.y), [0, 2, 4, 6, 8]);   // every second point
  assert.deepEqual(f.field.localPosition, { x: 1, y: 2, z: 3 });
  assert.deepEqual(f.stages[0].localScale, { x: 2, y: 2, z: 2 });
  for (const i of [-1, 2]) {                                  // GetFocusPoints: out of range takes entry 0
    f.applyFocusStagePositions(stage, i);
    assert.equal(f.anchors[3].localPosition.x, 0);
  }
  f.applyFocusStagePositions(stage, 1);
  f.applyFocusStagePositions(null);                           // only the positions: field position and scale stay
  assert.deepEqual(f.anchors[8].localPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(f.field.localPosition, { x: 1, y: 2, z: 3 });
  f.setStageInfo(null);
  assert.deepEqual(f.field.localPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(f.stages[4].localScale, { x: 1, y: 1, z: 1 });
});

test("AdvStageData: light groups by GameObject activity; ChangeLights keeps the index", () => {
  const st = synthStage({ lightGroups: [["a", "b"], ["b", "c"], ["d"]] });
  const active = () => st.activeLights().map((l) => l.path);
  assert.deepEqual(active(), []);                             // AdvLightGroupCollection.Init: all inactive
  st.showLights();
  assert.deepEqual(active(), ["a", "b"]);
  st.changeLights(1);                                         // group 0 hidden (b too), group 1 shown
  assert.deepEqual(active(), ["b", "c"]);
  assert.equal(st.currentLightGroup, 1);
  st.hideLights();
  assert.deepEqual(active(), []);
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try {
    st.changeLights(5);                                       // out of range: reported, nothing shown
    assert.deepEqual(active(), []);
    assert.equal(st.currentLightGroup, 5);
    st.changeLights(2);                                       // hiding group 5 is reported again
    assert.deepEqual(active(), ["d"]);
    assert.equal(warned, 2);
    const empty = synthStage();
    empty.changeLights(3); empty.showLights();               // no groups: nothing, silently
    assert.equal(warned, 2);
  } finally { console.warn = warn; }
  st.changeParticleEffects(4);                               // no particle groups: the index is kept, silently
  assert.equal(st.currentParticleEffectGroup, 4);
});

test("AdvStageData: particle groups play, stop and change by the current index; the speed reaches every group", () => {
  const log = [];
  const fx = (name) => ({ play: (...a) => log.push(`${name}.play${a.length}`),
                          stop: (immediate, loop) => log.push(`${name}.stop:${immediate}:${loop.name}`),
                          setPlaybackSpeed: (r) => log.push(`${name}.speed:${r}`) });
  const a = fx("a"), b = fx("b"), c = fx("c");
  const st = synthStage({ particleGroups: [[a, b], [b, c]] });
  st.playParticleEffects();                                   // group 0: each effect's Play()
  st.changeParticleEffects(1);                                // group 0 stopped (not at once), group 1 played
  st.stopParticleEffects();
  assert.deepEqual(log.splice(0), ["a.play0", "b.play0", "a.stop:false:loop", "b.stop:false:loop", "b.play0", "c.play0",
                                   "b.stop:false:loop", "c.stop:false:loop"]);
  st.setPlaybackSpeed(1.5);                                   // every effect of every group
  assert.deepEqual(log.splice(0), ["a.speed:1.5", "b.speed:1.5", "b.speed:1.5", "c.speed:1.5"]);
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try { st.changeParticleEffects(3); } finally { console.warn = warn; }   // TryGetGroup: out of range, reported
  assert.deepEqual(log.splice(0), ["b.stop:false:loop", "c.stop:false:loop"]);
  assert.equal(warned, 1);
  assert.equal(st.currentParticleEffectGroup, 3);
});

test("AdvGlobalVolume.applyStageAllVolume: the stage's profile by index, else disabled", () => {
  const v = Object.create(AdvGlobalVolume.prototype);
  v.warmup = { profile: { name: "warmup" }, enabled: true, weight: 1 };
  v.all = { profile: null, enabled: false, weight: 1 };
  v.registered = [v.warmup];
  v.always = false;
  const stage = synthStage({ volumeProfiles: [{ name: "p0" }, { name: "p1" }] });
  const order = () => v._volumes().map((x) => x.profile.name);
  v.applyStageAllVolume(stage, 1);
  assert.deepEqual(order(), ["warmup", "p1"]);
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try { v.applyStageAllVolume(stage, 2); } finally { console.warn = warn; }
  assert.equal(warned, 1);
  assert.deepEqual(order(), ["warmup"]);
  v.applyStageAllVolume(synthStage(), 0);                     // no profiles: disabled, silently
  assert.deepEqual(order(), ["warmup"]);
  v.setStageInfo(stage);
  assert.deepEqual(order(), ["warmup", "p0"]);
});

test("Overlay episodes go to the simple player (manifest and session)", async () => {
  const { STORY_MANIFEST_FORMAT, fetchStoryManifest } = await import("../../src/story/assets.js");
  const { StorySession } = await import("../../src/story/session.js");
  const { SimpleStorySession } = await import("../../src/story/simple/session.js");
  const man = { format: STORY_MANIFEST_FORMAT, advId: 5, story: { playbackMode: 1 },
                requires: { commands: ["In", "LookTarget", "Stage", "Talk"] } };
  const fetch = async () => ({ ok: true, json: async () => man });
  assert.equal((await fetchStoryManifest("https://example.org/stories/5.json", { fetch })).manifest.advId, 5);
  man.requires.commands.push("Effect");                       // the one row of the simple set not reproduced
  await assert.rejects(fetchStoryManifest("https://example.org/stories/5.json", { fetch }),
                       (e) => e instanceof StoryCommandError && /story 5: .*Effect/.test(e.message));
  const files = {
    "story.json": { episode: "episode.json", scene: "scene.json", ui: "ui/ui.json" },
    "episode.json": { advId: 5, master: { _playbackMode: 1 }, commands: [{ i: 0, cmd: "Stage" }, { i: 1, cmd: "Talk", AdvTextID: "1" }], text: {} },
    "scene.json": { settings: { playerSettings: {} } },
  };
  const store = { info: {}, has: (n) => n in files, json: (n) => files[n] };
  assert.equal(SimpleStorySession.isSimpleStory(store), true);
  assert.deepEqual(StorySession.requirements(store),
                   { commands: ["Talk"], skipped: ["Stage"], unsupported: [], invalid: null });
  // the simple session loads: without its talk window data it refuses the story
  await assert.rejects(StorySession.create(null, store),
                       (e) => e instanceof StoryCommandError && /story 5: the simple talk window/.test(e.message));
});
