// Opt-in: a story episode through StorySession in Node (gl = null: nothing is drawn, no sound is played), with Live2D
// Cubism Core and, when given, Live2D's MotionSync Core. The whole story runs: interpreter, camera and field, the
// Live2D characters (load, warmup, frames), the story UI's timing and layout.
//
//   OURNOTES_STORY=<path>       a story manifest of a site (stories/<advId>.json), or a directory with a story's logical
//                               files (story.json, episode.json, scene.json, ...; its models in story.json modelsDir);
//                               skipped without it
//   OURNOTES_STORY_LANG=<lang>  the language to load from a manifest (default: the manifest's)
//   CUBISM_CORE=<file>          Live2D's live2dcubismcore.min.js (skipped without it; not part of this repository)
//   MOTIONSYNC_CORE=<file>      Live2D's live2dcubismmotionsynccore.min.js (optional: without it lip sync is missing)
//   OURNOTES_STORY_LINE=<n>     the line of the seek check (default: the middle line)
//   OURNOTES_FF_FRAMES=<a>,<b>  the fast-forward check: drawn to frame a, then fast-forwarded to frame b (default
//                               300,900); with a Clip row, also a seek within its clip to OURNOTES_FF_CLIP seconds (20)
//
// Checks: the episode plays to its end in auto mode with every Live2D parameter finite; two runs with the same seed
// give the same command trace and the same per-frame state; a session started at a line (the game's shortcut) shows
// that line first, within its first 2 s, deterministically; taps in manual mode advance every line; a fast-forward
// (and a seek within a clip, from the clip's row and from where the clip plays) reaches the state of the same steps
// drawn (the headless GL context: every draw call made), sound included.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { HeadlessAudioContext, headlessGL, headlessImages, openStory } from "../../scripts/lib/headless.mjs";
import { storyState } from "../../scripts/lib/story-state.mjs";

const DIR = process.env.OURNOTES_STORY || "", CORE = process.env.CUBISM_CORE || "", MS = process.env.MOTIONSYNC_CORE || "";
const LANG = process.env.OURNOTES_STORY_LANG || null;
const SKIP = !DIR ? "OURNOTES_STORY is not set (path of a story manifest or directory)"
  : !CORE ? "CUBISM_CORE is not set (path of Live2D's live2dcubismcore.min.js)" : false;

// the Cores in this context, as a page's classic <script>s run in the page's (their Node detection hidden: they take
// the browser's way); in a vm context of their own their code runs several times slower
const loadScript = (file, name) =>
  new Function("process", "require", "module", "__dirname", `${fs.readFileSync(file, "utf8")}
;return ${name};`)();

if (!SKIP) {
  globalThis.Live2DCubismCore = loadScript(CORE, "Live2DCubismCore");
  if (MS) globalThis.Live2DCubismMotionSyncCore = loadScript(MS, "Live2DCubismMotionSyncCore");
}

// the story's store, loaded once for every run
let storeLoad = null;
const openStore = () => (storeLoad ||= openStory(DIR, { lang: LANG }));

const hash = (x) => crypto.createHash("sha1").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex").slice(0, 16);
const arr = (a) => Array.from(a, (v) => (Number.isFinite(v) ? v : String(v)));

// the state of one frame: camera, character stages, each shown character's parameters and displayed meshes, volumes
const frameState = (s) => {
  const sc = s.scene, cam = sc.camera;
  const chars = [...s.characters.values()].filter((c) => c.isShowing).map((c) => [
    s.characters.label(c), hash(arr(c.params.value)),
    hash(c.renderers.map((r) => { const m = c.displayed(r); return m ? arr(m) : null; }))]);
  return hash([Array.from(cam.transform.localToWorld()), cam.fov, sc.field.stages.map((t) => Array.from(t.localToWorld())),
               sc.fieldRenderer.entries.map((e) => [e.alpha, e.brightness, e.blur]), chars, sc.volume.stack]);
};

const run = async ({ seed = 1, line = 0, auto = true, taps = null, maxFrames = 30 * 60 * 30 } = {}) => {
  const { StorySession } = await import("../../src/story/session.js");
  const store = await openStore();
  const trace = [], states = [];
  let s = null;
  const at = () => `${s ? s.frame : 0}`;
  s = await StorySession.create(null, store, {
    seed, line, auto, sound: false, autoplay: true,
    onCommand: (c) => trace.push(`${at()} #${c.i} ${c.cmd}`),
    onLine: (e) => trace.push(`${at()} line ${e.index}`),
  });
  for (let n = 0; !s.ended && n < maxFrames; n++) {
    if (taps && taps(s, n)) s.tap();
    await s.step({ draw: false });
    for (const ch of s.characters.values())
      for (let i = 0; i < ch.params.count; i++) assert.ok(Number.isFinite(ch.params.value[i]), `${ch.name} parameter ${i}`);
    states.push(frameState(s));
  }
  assert.ok(s.ended, "the episode ended");
  const out = { trace, states, frames: s.frame, lines: s.lineCount };
  await s.dispose();
  return out;
};

const T = { skip: SKIP, timeout: 900000 };

test("story: the episode plays to its end; the same seed gives the same trace and states", T, async () => {
  const a = await run({ seed: 7 }), b = await run({ seed: 7 });
  assert.ok(a.trace.some((t) => t.endsWith(" TalkWindow")), "the initial TalkWindow row ran");
  assert.ok(a.trace.some((t) => / #fin1 FadeOut$/.test(t)), "the finalize rows ran");
  assert.equal(a.trace.filter((t) => / line \d+$/.test(t)).length, a.lines, "every line showed once");
  assert.deepEqual(a.trace, b.trace);
  assert.equal(hash(a.states), hash(b.states));
});

test("story: a session started at a line shows that line first", T, async () => {
  const full = await run({ seed: 3 });
  const target = Number(process.env.OURNOTES_STORY_LINE || Math.floor(full.lines / 2));
  const seek = await run({ seed: 3, line: target });
  const shown = seek.trace.filter((t) => / line \d+$/.test(t));
  assert.equal(shown[0].split(" ").pop(), String(target), "the first line shown is the target");
  const firstLine = Number(shown[0].split(" ")[0]);
  assert.ok(firstLine < 60, `the target line shows within 2 s (frame ${firstLine})`);
  const again = await run({ seed: 3, line: target });
  assert.deepEqual(seek.trace, again.trace, "a seek is deterministic");
  assert.equal(hash(seek.states), hash(again.states));
});

test("story: manual mode advances on taps", T, async () => {
  let last = -1;
  const taps = (s, n) => { if (!s.core.nextStep || n - last < 45) return false; last = n; return true; };
  const r = await run({ seed: 5, auto: false, taps });
  assert.equal(r.trace.filter((t) => / line \d+$/.test(t)).length, r.lines);
});

// a session on the headless GL context whose sound clock is the game clock: the sources end when the game time passes
// their end, before the frame runs
const openDrawn = async (opts = {}) => {
  const { StorySession } = await import("../../src/story/session.js");
  const store = headlessImages(await openStore());
  const audioContext = new HeadlessAudioContext({ endSources: true });
  const s = await StorySession.create(headlessGL({ width: 1300, height: 600 }), store,
                                      { seed: 1, auto: true, audioContext, autoplay: false, width: 1300, height: 600, ...opts });
  const step = s.loop.step.bind(s.loop);
  s.loop.step = () => { audioContext.advance(Math.fround(s.loop.time + s.loop.stepDelta())); return step(); };
  audioContext.advance(s.loop.time);
  s.play();
  return s;
};
const drawnTo = async (s, frame) => { while (s.frame < frame && !s.ended) await s.step({ draw: true }); };
const sameState = (a, b, what) => {
  const x = storyState(a), y = storyState(b);
  const differ = Object.keys(x).filter((k) => x[k] !== y[k]);
  assert.deepEqual(differ, [], `${what}: ${differ.join(", ")} differ`);
  assert.equal(a.frame, b.frame);
};

test("story: a fast-forward reaches the state of the same steps drawn", T, async () => {
  const [from, to] = (process.env.OURNOTES_FF_FRAMES || "300,900").split(",").map(Number);
  const a = await openDrawn(), b = await openDrawn();
  await drawnTo(a, from); await drawnTo(b, from);
  await b.fastForward(() => b.frame >= to, { budgetMs: Infinity });
  await drawnTo(a, to);
  sameState(a, b, `drawn to frame ${from}, fast-forwarded to ${to}`);
  const clip = b.episode.commands.find((c) => c.cmd === "Clip" && !c.IgnoreData && (c.VideoID || 0) > 0);
  await a.dispose(); await b.dispose();
  if (!clip) return;
  const target = Number(process.env.OURNOTES_FF_CLIP || 20);
  // a seek within the clip from its row, then on from where the clip plays to twice the time
  const c = await openDrawn({ row: clip.i }), d = await openDrawn({ row: clip.i });
  assert.equal((await c.fastForwardClip(() => target, { budgetMs: Infinity })).back, false);
  await drawnTo(d, c.frame);
  sameState(c, d, `clip row ${clip.i} to ${target} s`);
  await c.fastForwardClip(() => 2 * target, { row: clip.i, budgetMs: Infinity });
  await drawnTo(d, c.frame);
  sameState(c, d, `clip row ${clip.i} on to ${2 * target} s`);
  await c.dispose(); await d.dispose();
});
