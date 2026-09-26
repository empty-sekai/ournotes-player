// Opt-in: story episodes that use the feature commands (camera / field effects, frames, stills, post effects,
// particles, videos, chat, ...) through StorySession in Node (gl = null: nothing is drawn, no sound is played), with
// Live2D Cubism Core. Every row of the episodes runs, the feature commands included.
//
//   OURNOTES_STORY_DIRS=<dir>,<dir>,...   story directories (story.json, episode.json, scene.json, ...); or
//   OURNOTES_STORY_ROOT=<dir> [OURNOTES_STORY_IDS=<id>,<id>,...]   a directory of story directories named by ADV id
//                                         (all of them without OURNOTES_STORY_IDS); skipped without either
//   CUBISM_CORE=<file>                    Live2D's live2dcubismcore.min.js (skipped without it; not in this repository)
//   MOTIONSYNC_CORE=<file>                Live2D's MotionSync Core (optional)
//   OURNOTES_STORY_TRACE=<dir>            writes <id>.json (feature command trace, state hashes) per episode
//   OURNOTES_STORY_TIMEOUT=<seconds>      time limit per episode (both runs), default 3600
//
// A story directory without the story UI's font data (ui/fonts.json), or any with OURNOTES_STORY_STAND_IN_UI=1, plays
// with a timing-only stand-in for the story UI (every UI call completes at once, text reveals at once): the feature
// commands and the scene still run exactly.
// Checks per episode: it plays to its end in auto mode; every feature command it uses ran; two runs with the same seed
// give the same trace and the same per-frame feature state.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { DirStore } from "../../scripts/lib/headless.mjs";
import { createStoryUILayers } from "../../src/story/interfaces.js";

const CORE = process.env.CUBISM_CORE || "", MS = process.env.MOTIONSYNC_CORE || "";
const ROOT = process.env.OURNOTES_STORY_ROOT || "";
const DIRS = process.env.OURNOTES_STORY_DIRS ? process.env.OURNOTES_STORY_DIRS.split(",").map((s) => s.trim()).filter(Boolean)
  : ROOT ? (process.env.OURNOTES_STORY_IDS ? process.env.OURNOTES_STORY_IDS.split(",").map((s) => s.trim())
    : fs.readdirSync(ROOT).filter((n) => fs.existsSync(path.join(ROOT, n, "story.json"))).sort()).map((n) => path.join(ROOT, n))
    : [];
const SKIP = !DIRS.length ? "OURNOTES_STORY_DIRS / OURNOTES_STORY_ROOT is not set"
  : !CORE ? "CUBISM_CORE is not set (path of Live2D's live2dcubismcore.min.js)" : false;
const OUT = process.env.OURNOTES_STORY_TRACE || "";
const STAND_IN = process.env.OURNOTES_STORY_STAND_IN_UI === "1";

const loadScript = (file, name) => {
  const c = { console, setTimeout, clearTimeout, WebAssembly, TextDecoder, TextEncoder, performance, atob, btoa, Math,
              Promise, fetch: undefined };
  c.window = c; c.self = c; c.globalThis = c; c.document = { currentScript: { src: "" } }; c.location = { href: "" };
  vm.createContext(c);
  vm.runInContext(`${fs.readFileSync(file, "utf8")}\n;globalThis.${name} = ${name};`, c);
  return c[name];
};

if (!SKIP) {
  globalThis.Live2DCubismCore = loadScript(CORE, "Live2DCubismCore");
  if (MS) globalThis.Live2DCubismMotionSyncCore = loadScript(MS, "Live2DCubismMotionSyncCore");
}

const hash = (x) => crypto.createHash("sha1").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex").slice(0, 16);

// a timing-only StoryUI (no font data needed): every call completes at once
const standInUI = () => (gl, loop) => {
  let pos = { x: 0, y: 0, z: 0 }, talk = false, indicator = false;
  const done = () => Promise.resolve();
  return {
    layers: createStoryUILayers(), isTyping: false, talkWindows: ["UIDefaultTalkWindow", "UICenterTalkWindow"],
    load: done, setTalkWindow() {}, showTalk() { talk = true; }, hideTalk() { talk = false; }, hideTalkNextIndicator() {},
    setSpeakerName() {}, isShowingTalk: () => talk,
    showNextIndicator() { indicator = true; }, hideNextIndicator() { indicator = false; }, isShowingNextIndicator: () => indicator,
    clearSubtitles() {}, showSubtitles() {}, updateHiddenSubtitles() {}, showAutoButton() {}, hideAutoButton() {},
    showFastForwardButton() {}, showVideoButtons() {}, hideVideoButtons() {}, resetPauseVideoButton() {},
    setTalk: (t) => ({ totalLength: [...(t || "")].length, finished: Promise.resolve(), cancel() {} }),
    setAutoMode() {}, setFastIconActive() {}, setPlaybackSpeed() {}, showTitle: done, showLocation: done,
    transitionSettings: () => ({}), fadeOut: done, fadeIn: done, fadeInLetterBox: done, render() {}, renderLetterBox() {},
    dispose() {}, talkShakeTarget: () => ({ get: () => ({ ...pos }), set: (v) => { pos = { ...v }; } }),
    flash: done, trueCanvasSortOrder: 0,
  };
};

const FEATURE_NAMES = async () => Object.keys((await import("../../src/story/features/index.js")).FEATURE_COMMANDS);

// the feature-side state of one frame
const featureFrame = (s, snapshot) => {
  const sc = s.scene, cam = sc.camera;
  return hash([Array.from(cam.transform.localToWorld()), cam.shakeOffset, cam.euler,
               sc.field.root.localPosition, sc.background.root.localPosition,
               sc.field.field.localRotation, sc.background.field.localRotation,
               sc.field.stages.map((t) => t.localPosition), sc.background.color,
               sc.fieldRenderer.entries.map((e) => [e.brightness, e.blur, e.renderIndex]), sc.fieldRenderer.priority,
               snapshot ? snapshot(s.ctx) : null]);
};

const run = async (dir, { seed = 1, maxFrames = 30 * 60 * 40 } = {}) => {
  const { StorySession } = await import("../../src/story/session.js");
  const features = await import("../../src/story/features/index.js");
  const names = new Set(await FEATURE_NAMES());
  const store = new DirStore(dir);
  const trace = [], states = [];
  let s = null;
  s = await StorySession.create(null, store, {
    seed, auto: true, sound: false, autoplay: true,
    ui: !STAND_IN && store.has("ui/fonts.json") ? undefined : standInUI(),
    onCommand: (c) => { if (names.has(c.cmd)) trace.push(`${s ? s.frame : 0} #${c.i} ${c.cmd}`); },
  });
  for (let n = 0; !s.ended && n < maxFrames; n++) {
    await s.step({ draw: false });
    if (s.error) throw s.error;
    states.push(featureFrame(s, features.snapshotStoryFeatures));
  }
  assert.ok(s.ended, "the episode ended");
  const out = { trace, states: hash(states), frames: s.frame };
  await s.dispose();
  return out;
};

const TIMEOUT_S = Number(process.env.OURNOTES_STORY_TIMEOUT || 3600);
if (!(TIMEOUT_S > 0)) throw new Error(`OURNOTES_STORY_TIMEOUT=${process.env.OURNOTES_STORY_TIMEOUT}: not a positive number`);
const T = { skip: SKIP, timeout: TIMEOUT_S * 1000 };

for (const dir of DIRS) {
  test(`story features: ${path.basename(dir)} plays to its end, deterministically`, T, async () => {
    const episode = JSON.parse(fs.readFileSync(path.join(dir, "episode.json"), "utf8"));
    const names = new Set(await FEATURE_NAMES());
    const used = [...new Set(episode.commands.filter((c) => !c.IgnoreData && names.has(c.cmd)).map((c) => c.cmd))].sort();
    const a = await run(dir, { seed: 7 }), b = await run(dir, { seed: 7 });
    const ran = [...new Set(a.trace.map((t) => t.split(" ").pop()))].sort();
    assert.deepEqual(ran, used, "every feature command of the episode ran");
    assert.deepEqual(a.trace, b.trace);
    assert.equal(a.states, b.states);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${path.basename(dir)}.json`), JSON.stringify({ used, frames: a.frames, trace: a.trace,
                                                                                     states: a.states }, null, 1));
    }
  });
}
