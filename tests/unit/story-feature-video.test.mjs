// Movie / Clip / Subtitles on a real PlayerLoop at 30 fps with synthetic video records and a stand-in UI: the video
// queue, the view's fades, the clip's frame clock and the timeline Delay rows follow, the clip's end, the stop marker,
// the Movie's blocking, captions over a clip, the seek re-speed of an audio video on a speed change (the delay
// helpers around it, the screen's freeze overlay), the host's seek, and a video's sound and pauses (the page's video
// element on a stand-in document). Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Audio } from "../../src/engine/audio.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { GLTarget } from "../../src/engine/texture.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { delayWithPauseSpeedAdjustment } from "../../src/story/commands/misc.js";
import { disposeStoryFeatures, installStoryFeatures, setStoryFeaturesSpeed } from "../../src/story/features/index.js";
import { calcVideoRealDuration, delayWithSpeedAdjustment } from "../../src/story/features/timing.js";
import { VideoInfo, browserSource, delayUntilVideoTimeline, seekStoryVideo, storyVideo, storyVideoPosition,
         tryPauseCurrentVideo } from "../../src/story/features/video.js";
import { StoryPlayerCore } from "../../src/story/player-core.js";
import { StorySession } from "../../src/story/session.js";
import { HeadlessAudioContext, headlessGL } from "../../scripts/lib/headless.mjs";
import { storyState } from "../../scripts/lib/story-state.mjs";

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

const Z = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 };
const rect = (aMin, aMax, size) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax, m_AnchoredPosition: { x: 0, y: 0 }, m_SizeDelta: size,
                                      m_Pivot: { x: 0.5, y: 0.5 } });
const FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }), MID = (w, h) => rect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: w, y: h });
const SCALER = { m_Enabled: 1, m_UiScaleMode: 1, m_ReferencePixelsPerUnit: 100, m_ScaleFactor: 1, m_ReferenceResolution: { x: 1920, y: 1080 },
                 m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 0, class: "ClampedCanvasScaler", _maxAspectThreshold: Math.fround(13 / 6) };
const img = (a, material = null) => ({ m_Enabled: 1, m_Color: { r: 0, g: 0, b: 0, a }, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1,
                                       m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1, sprite: null, material });
const cg = (a) => ({ m_Enabled: 1, m_Alpha: a, m_IgnoreParentGroups: false });
const uiDoc = () => {
  const rec = (path, extra = {}, r = FULL) => ({ path, name: path.split("/").pop(), active: true, localPosition: Z, localRotation: Q,
                                                 localScale: ONE, rect: r, ...extra });
  const cam = "UIAdvWidget/VideoAndStillCamera", V = "UIAdvWidget/VideoCanvas/VideoView", S = "UIAdvWidget/StillCanvas/AdvStillView";
  const canvas = (path, order, scaler, camera = cam) => rec(path, { canvas: { m_Enabled: 1, m_RenderMode: 1, m_SortingOrder: order,
    m_OverrideSorting: false, m_PixelPerfect: false, camera, m_PlaneDistance: 100 }, canvasScaler: scaler });
  const mat = (name, floats) => ({ material: name, shader: { shader: "UI/Default" }, keywords: [], floats, colors: {}, textures: {} });
  return { nodes: [
    canvas("UIAdvWidget/VideoCanvas", 301, { ...SCALER, m_ScreenMatchMode: 1, class: undefined }),
    rec(V, { videoView: { enabled: 1, _video: `${V}/VideoParent/Video`, _maskArea: `${V}/MaskArea`, _curtainCanvasGroup: `${V}/Curtain`,
                          _videoCanvasGroup: `${V}/VideoParent` } }),
    rec(`${V}/VideoParent`, { canvasGroup: cg(1) }),
    rec(`${V}/VideoParent/Video`, { image: { ...img(1), m_Color: { r: 1, g: 1, b: 1, a: 1 } } }, MID(1920, 1080)),
    rec(`${V}/MaskArea`, { image: img(1, "UI-Mask") }, MID(1920, 1080)),
    rec(`${V}/Curtain`, { image: img(1, "UI-Masked"), canvasGroup: cg(1) }),
    canvas("UIAdvWidget/StillCanvas", 302, SCALER),
    rec(S, { stillView: { enabled: 1, _overlay: `${S}/Overlay`, _background: `${S}/Background`, _target: `${S}/Target` } }),
    rec(`${S}/Overlay`, { image: img(0) }, MID(2048, 2048)), { ...rec(`${S}/Background`, { image: img(1) }), active: false },
    rec(`${S}/Target`),
    canvas("UIAdvWidget/VideoAndStillRenderScreenCanvas", 302, { ...SCALER, m_Enabled: 0 }, undefined),
    rec("UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen", { rawImage: { m_Enabled: 1, m_Color: { r: 1, g: 1, b: 1, a: 1 },
      m_UVRect: { x: 0, y: 0, width: 1, height: 1 }, texture: null, material: null } }),
    canvas("UIAdvWidget/FrameCanvas", 303, SCALER, "UIAdvWidget/UICamera"),
  ], sprites: {}, textures: {},
  materials: { "UI-Mask": mat("UI-Mask", { _ColorMask: 0, _Stencil: 1, _StencilComp: 8, _StencilOp: 2 }),
               "UI-Masked": mat("UI-Masked", { _ColorMask: 15, _Stencil: 2, _StencilComp: 3, _StencilOp: 0, _StencilReadMask: 1 }) },
  videoAndStillCamera: { path: cam, camera: { m_Enabled: 1, m_ClearFlags: 2, m_BackGroundColor: { r: 0, g: 0, b: 0, a: 0 },
    m_NormalizedViewPortRect: { x: 0, y: 0, width: 1, height: 1 }, orthographic: false, "field of view": 60,
    "near clip plane": 0.3, "far clip plane": 1000, m_HDR: true },
    additionalCameraData: { m_RenderPostProcessing: 1, m_VolumeLayerMask: { m_Bits: 2048 }, m_Antialiasing: 0 } },
  videoAndStillScreenImage: "UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen" };
};
const video = (id, frames, audio = false) => ({ master: { _id: id, _assetName: `adv/v${id}`, _autoStop: false, _width: 1920, _height: 1080,
  _hasAudio: audio }, file: `videos/v${id}.webm`, frameRate: [30, 1], frames, width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 });

const makePlayer = (rows, { auto = true } = {}) => {
  const loop = new PlayerLoop(30), calls = [];
  let indicator = false;
  const log = (name) => (...a) => { calls.push([name, ...a]); };
  const ui = { layers: createStoryUILayers(), isTyping: false,
    hideTalk: log("hideTalk"), clearSubtitles: log("clearSubtitles"), showSubtitles: log("showSubtitles"),
    updateHiddenSubtitles: log("hidden"), showNextIndicator: () => { indicator = true; }, hideNextIndicator: () => { indicator = false; },
    isShowingNextIndicator: () => indicator, isShowingTalk: () => false, showAutoButton: log("autoOn"), hideAutoButton: log("autoOff"),
    showFastForwardButton() {}, showVideoButtons: log("videoButtons"), hideVideoButtons() {}, resetPauseVideoButton() {} };
  const docs = { "ui/ui.json": uiDoc(), "videos/videos.json": { videos: { 11: video(11, 60), 12: video(12, 30), 13: video(13, 45, true) } } };
  const ctx = { loop, ui, gl: null, camera: { setShakeOffset() {} }, field: { root: { localPosition: { ...Z } } },
                background: { root: { localPosition: { ...Z } } },
                settings: { player: { _waitVideoLingeringTimeOnAutoPlay: 0.3, _waitSubtitlesLingeringTimeOnAutoPlay: 0.1,
                                      _waitTalkTextUnitTime: 0.04, _minTalkDisplayTime: 1.6, _waitAfterVoiceTime: 0.6 } },
                audio: { stop() {}, play: () => 0, isPlaying: () => false }, localize: (id) => `line ${id}`,
                episode: { commands: rows.map((r, i) => ({ i, ...r })) }, story: { ui: "ui/ui.json", videos: "videos/videos.json" },
                assets: { json: (p) => { assert.ok(docs[p], p); return docs[p]; } } };
  const p = { ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1, isAutoPlay: auto, isPause: false, nextStep: 0, lineIndex: -1,
              session: { voicePlayIds: [], withVoice: true }, errors: [], fail(e) { this.errors.push(e); },
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return this.shortCutIndex >= 0; },
              calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
              changeNextStepStateOnAutoPlay() { this.nextStep = this.isAutoPlay ? 2 : 1; } };
  return { ctx, p, loop, calls };
};
const cmd = (t, row) => commandHandler(row.cmd)(row, t.p);

test("Clip: the row returns once the video plays; Delay rows follow its frames; its end sets GoNext and resets the flags", async () => {
  const rows = [{ cmd: "Clip", VideoID: 11, Parameter1: "0.5", Parameter2: "0.8" }, { cmd: "Clip" }, { cmd: "Movie", VideoID: 12 }];
  const t = makePlayer(rows);
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx);
  assert.equal(v.current.masterVideoId, 11);                              // preloaded: 11 current, 12 prepared
  assert.equal(v.tasks.length, 1);
  const frames = await settle(t.loop, cmd(t, { ...rows[0], i: 0 }));
  assert.equal(frames, 0);                                                // no audio: plays at once
  assert.deepEqual(v.flow, { clipVideoPlaying: true, clipVideoSkip: false, clipControlAvailable: true, movieVideoPlaying: false });
  assert.equal(v.timeline.isActive, true);
  await steps(t.loop, 7);
  assert.ok(v.view.videoCG.alpha > 0.5 && v.view.videoCG.alpha < 0.65, `${v.view.videoCG.alpha}`);    // OutQuad 7/15 of the way to 0.8
  await steps(t.loop, 8);
  assert.equal(v.view.videoCG.alpha, Math.fround(0.8));
  // a Delay of 1 s on the timeline: 30 video frames from the start frame
  v.timeline.advanceTarget(1);
  const d = delayUntilVideoTimeline(t.p);
  const f1 = t.loop.frameCount;
  await settle(t.loop, d);
  assert.ok(t.loop.frameCount - f1 >= 14 && t.loop.frameCount - f1 <= 16, `${t.loop.frameCount - f1}`);
  assert.deepEqual(await d, { completed: true, remaining: 0 });
  t.p.nextStep = 0;
  await steps(t.loop, 32);                                                // 2 s: the clip ends
  assert.equal(v.current.isPlayFinished(), true);
  assert.equal(t.p.nextStep, 2);                                          // OnPlayVideoFinished in auto mode
  assert.equal(v.flow.clipVideoPlaying, false);
  // the stop marker: auto lingering 0.3 s, fade-out 0 -> hidden at once, the next prepared video becomes current
  const s = await settle(t.loop, cmd(t, { ...rows[1], i: 1 }));
  assert.ok(s >= 9 && s <= 10, `${s}`);
  assert.equal(v.current.masterVideoId, 12);
  assert.equal(v.view.node.activeSelf, false);
  assert.equal(v.timeline.isActive, false);
  disposeStoryFeatures(t.ctx);
});

test("Movie: blocks until the video ends and fades out; while shortcutting the video is skipped", async () => {
  const rows = [{ cmd: "Movie", VideoID: 12, Parameter2: "0.5" }, { cmd: "Movie", VideoID: 13 }, { cmd: "Clip", VideoID: 11 }];
  const t = makePlayer(rows, { auto: false });
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx);
  const frames = await settle(t.loop, cmd(t, { ...rows[0], i: 0 }));
  assert.ok(frames >= 45 && frames <= 47, `${frames}`);                   // 1 s of video + 0.5 s fade-out
  assert.equal(v.flow.movieVideoPlaying, false);
  assert.equal(v.current.masterVideoId, 13);
  // an audio video at speed 2: stopped and prepared again (two ticks) before it plays
  t.p.playbackSpeed = 20;
  const run = cmd(t, { ...rows[1], i: 1 });
  await steps(t.loop, 1);
  assert.equal(v.current.isPlaying(), false);
  await steps(t.loop, 2);
  assert.equal(v.current.isPlaying(), true);
  assert.equal(v.current.speed, 2);
  await settle(t.loop, run);
  t.p.shortCutIndex = 5;                                                  // shortcut: nothing shown
  await settle(t.loop, cmd(t, { cmd: "Movie", VideoID: 11, i: 2 }));
  assert.equal(v.current, null);
  disposeStoryFeatures(t.ctx);
});

test("Subtitles: a caption over a clip waits for the clip's end, then a tap (manual); without a video like a talk line", async () => {
  const rows = [{ cmd: "Clip", VideoID: 12, Parameter3: "HideClipControl" }, { cmd: "Subtitles", AdvTextID: "5" }];
  const t = makePlayer(rows, { auto: false });
  await installStoryFeatures(t.ctx, t.p);
  await settle(t.loop, cmd(t, { ...rows[0], i: 0 }));
  const sub = cmd(t, { ...rows[1], i: 1 });
  let done = false; sub.then(() => { done = true; });
  await steps(t.loop, 10);
  assert.equal(t.p.nextStep, 1);                                          // AllowNext while the clip plays
  await steps(t.loop, 25);                                                // the clip ends: indicator shown, still waiting
  assert.equal(done, false);
  t.p.nextStep = 2;                                                       // the tap
  await steps(t.loop, 2);
  assert.equal(done, true);
  assert.equal(t.p.nextStep, 0);
  assert.ok(t.calls.some((c) => c[0] === "showSubtitles" && c[1] === "line 5"));
  // the clip has ended: a caption waits like a talk line (next indicator, then the tap)
  const sub2 = cmd(t, { cmd: "Subtitles", AdvTextID: "6", i: 2 });
  let done2 = false; sub2.then(() => { done2 = true; });
  await steps(t.loop, 3);
  assert.equal(done2, false);
  assert.equal(t.p.nextStep, 1);
  t.p.nextStep = 2;
  await steps(t.loop, 1);
  assert.equal(done2, true);
  // an invalid text id clears the caption; shortcut rows show nothing
  await settle(t.loop, cmd(t, { cmd: "Subtitles", i: 2 }));
  assert.ok(t.calls.some((c) => c[0] === "clearSubtitles"));
  disposeStoryFeatures(t.ctx);
});

// ------------------------------------------------------------------------------------------------ the host's seek
test("host seek: a playing movie moves forward and back and its row ends with it; a clip is not moved in place", async () => {
  const t = makePlayer([{ cmd: "Movie", VideoID: 11 }, { cmd: "Clip", VideoID: 12 }], { auto: false });
  await installStoryFeatures(t.ctx, t.p);
  assert.equal(storyVideoPosition(t.ctx), null);                          // prepared, not playing
  assert.equal(await seekStoryVideo(t.ctx, 1), false);
  let done = false;
  const run = cmd(t, { cmd: "Movie", VideoID: 11, i: 0 });
  run.then(() => { done = true; });
  await steps(t.loop, 10);
  const at = storyVideoPosition(t.ctx);
  assert.deepEqual([at.kind, at.duration, at.seekable], ["movie", 2, true]);
  assert.ok(at.time > 0.25 && at.time < 0.4, `${at.time}`);
  assert.equal(await seekStoryVideo(t.ctx, 1.5), true);                   // forward: 0.5 s left
  assert.equal(storyVideoPosition(t.ctx).time, 1.5);
  await steps(t.loop, 10);
  assert.equal(done, false);
  assert.equal(await seekStoryVideo(t.ctx, -3), true);                    // back, clamped to the start
  assert.equal(storyVideoPosition(t.ctx).time, 0);
  await steps(t.loop, 50);
  assert.equal(done, false);
  const n = await settle(t.loop, run);
  assert.ok(n >= 10 && n <= 12, `${n}`);                                  // the rest of the 2 s from the start
  assert.equal(storyVideoPosition(t.ctx), null);                          // ended and faded out
  // a clip: seekable through a new session at its row (fastForwardClip), not in place (the rows under it follow its
  // frames)
  await settle(t.loop, cmd(t, { cmd: "Clip", VideoID: 12, i: 1 }));
  await steps(t.loop, 6);
  const clip = storyVideoPosition(t.ctx), time = clip.time;
  assert.deepEqual([clip.kind, clip.duration, clip.seekable, clip.row], ["clip", 1, true, 1]);
  assert.equal(await seekStoryVideo(t.ctx, 0.9), false);
  assert.equal(storyVideoPosition(t.ctx).time, time);
  disposeStoryFeatures(t.ctx);
});

test("host seek: the video's clock holds until its source shows the position, at most 30 updates", async () => {
  let pending = null;
  const source = { clock: (time, delta) => time + delta, setSpeed() {}, sync() {}, seek(time, done) { pending = done; },
                   release() {} };
  const v = new VideoInfo(1, 11, video(11, 300), source), dt = 1 / 30;
  v.play();
  v.advance(dt);
  assert.equal(v.time, dt);
  let ended = 0;
  v.seekTo(4).then(() => { ended++; });
  for (let i = 0; i < 5; i++) v.advance(dt);
  assert.equal(v.time, 4);                                                // held
  pending();
  await flush();
  assert.equal(ended, 1);
  v.advance(dt);
  assert.equal(v.time, 4 + dt);
  // a source that does not report: the clock goes on after 30 updates
  v.seekTo(2).then(() => { ended++; });
  for (let i = 0; i < 29; i++) v.advance(dt);
  await flush();
  assert.deepEqual([v.time, ended], [2, 1]);
  v.advance(dt);
  await flush();
  assert.deepEqual([v.time, ended], [2, 2]);
  v.advance(dt);
  assert.equal(v.time, 2 + dt);
  // a later seek ends the earlier one's wait; a release ends a waiting seek; the end of the video is the limit
  v.seekTo(1).then(() => { ended++; });
  v.seekTo(99).then(() => { ended++; });
  await flush();
  assert.deepEqual([v.time, ended], [10, 3]);
  v.release();
  await flush();
  assert.equal(ended, 4);
});

// ------------------------------------------------------------------------------------------------ sound and pauses
// a page's <video> elements and WebGL context as far as the browser source uses them. An element plays on its own
// clock: run(sec) moves a playing one on by sec x its rate; a seek (currentTime set) is recorded in seeks, holds the
// position and reports "seeked" at seeked()
const fakePage = () => {
  const els = [];
  const gl = new Proxy({}, { get: (o, k) => (typeof k === "string" && /^[A-Z_0-9]+$/.test(k) ? 0 : () => ({})) });
  const document = { createElement: () => {
    let pos = 0, seeking = false;
    const on = [];
    const el = { muted: false, paused: true, ended: false, error: null, readyState: 4, playbackRate: 1, plays: 0,
                 refuse: null, seeks: [],
                 get currentTime() { return pos; },
                 set currentTime(t) { pos = t; seeking = true; el.seeks.push(t); },
                 seeked() { seeking = false; for (const f of on) f(); },
                 run(sec) { if (!el.paused && !seeking) pos += sec * el.playbackRate; },
                 addEventListener(k, f) { if (k === "seeked") on.push(f); }, removeAttribute() {}, load() {},
                 pause() { el.paused = true; },
                 play() {
                   el.plays++;
                   if (el.refuse && !el.muted) return Promise.reject(el.refuse);
                   el.paused = false;
                   return Promise.resolve();
                 } };
    els.push(el);
    return el;
  } };
  return { els, gl, document };
};
const withPage = async (fn) => {
  const page = fakePage(), saved = globalThis.document;
  globalThis.document = page.document;
  try { await fn(page); } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
};

test("a video's sound: on the movie bus of the sound manager, else muted; a refused play goes on muted", () => withPage(async (page) => {
  const routed = [];
  const audio = { connectMedia: (el) => { const n = { el, on: true, disconnect() { n.on = false; } }; routed.push(n); return n; } };
  const ctx = { gl: page.gl, assets: { bytes: () => new Uint8Array(8) }, audio };
  const src = browserSource(ctx, "videos/a.webm"), el = page.els[0];
  assert.deepEqual([routed.length, routed[0].el === el, el.muted], [1, true, false]);
  const v = new VideoInfo(1, 11, video(11, 60, true), src);
  v.play();
  assert.equal(el.paused, false);
  v.pause(true);                                                          // VideoInfo.Pause: picture and sound
  assert.equal(el.paused, true);
  v.pause(false);
  assert.equal(el.paused, false);
  v.release();
  assert.deepEqual([routed[0].on, el.paused], [false, true]);
  // a sound manager without Web Audio (a silent session): the video plays muted
  browserSource({ ...ctx, audio: {} }, "videos/b.webm");
  assert.equal(page.els[1].muted, true);
  // a page that does not let a video with sound start yet: it plays muted
  const src3 = browserSource(ctx, "videos/c.webm"), el3 = page.els[2];
  el3.refuse = Object.assign(new Error("no user gesture"), { name: "NotAllowedError" });
  new VideoInfo(2, 11, video(11, 60, true), src3).play();
  await flush();
  assert.deepEqual([el3.muted, el3.paused, el3.plays], [true, false, 2]);
}));

test("the host's pause holds the loaded videos' elements and keeps the videos' own state", () => withPage(async (page) => {
  const t = makePlayer([{ cmd: "Movie", VideoID: 11 }]);
  await installStoryFeatures(t.ctx, t.p);
  const sv = storyVideo(t.ctx), cur = sv.current;
  cur.source = browserSource({ gl: page.gl, assets: { bytes: () => new Uint8Array(8) }, audio: {} }, "videos/v11.webm",
                             () => sv.held);
  const el = page.els[0];
  t.loop.on("update", (l) => el.run(l.deltaTime));                       // the element plays in real time
  const run = cmd(t, { cmd: "Movie", VideoID: 11, i: 0 });
  await steps(t.loop, 3);
  assert.equal(el.paused, false);
  StorySession.prototype.setPaused.call({ ctx: t.ctx }, true);           // StoryPlayer.pause: no frame runs meanwhile
  assert.deepEqual([sv.held, el.paused, cur.isPlaying(), cur.isPaused()], [true, true, true, false]);
  StorySession.prototype.setPaused.call({ ctx: t.ctx }, false);
  assert.equal(el.paused, false);
  await settle(t.loop, run);
  assert.equal(el.paused, true);                                          // ended, released by the next video's prepare
  disposeStoryFeatures(t.ctx);
}));

test("a page's video keeps its own clock: the video's time is the element's position, never pulled to game time", () => withPage(async (page) => {
  const src = browserSource({ gl: page.gl, assets: { bytes: () => new Uint8Array(8) }, audio: {} }, "videos/a.webm");
  const el = page.els[0], v = new VideoInfo(1, 11, video(11, 300, true), src), dt = 1 / 30;
  v.play();
  assert.equal(el.paused, false);
  // game time falls behind (one update over half a second of the element's playback): the video is where it is heard
  el.run(0.5);
  v.advance(dt);
  assert.deepEqual([v.time, v.displayedFrameNo()], [0.5, 15]);
  // game time runs ahead of an element that has not moved (decoding, no data yet): the video's time holds
  for (let i = 0; i < 10; i++) v.advance(dt);
  assert.equal(v.time, 0.5);
  el.readyState = 1;
  el.run(0.2);
  v.advance(dt);
  assert.equal(v.time, 0.5);
  el.readyState = 4;
  v.advance(dt);
  assert.ok(Math.abs(v.time - 0.7) < 1e-9);
  assert.deepEqual(el.seeks, []);                                         // no seek either way
  // the end of the element is the video's end
  el.ended = true;
  v.advance(dt);
  assert.deepEqual([v.time, v.isPlayFinished(), el.paused], [10, true, true]);
}));

test("a page's video: a start at a seek position and the end of a hold put the element at the clock once", () => withPage(async (page) => {
  let held = false;
  const src = browserSource({ gl: page.gl, assets: { bytes: () => new Uint8Array(8) }, audio: {} }, "videos/a.webm", () => held);
  const el = page.els[0], v = new VideoInfo(1, 11, video(11, 300, true), src), dt = 1 / 30;
  v.setSeekPosition(60);                                                  // a start at frame 60
  v.play();
  assert.deepEqual([el.seeks, v.time], [[2], 2]);
  el.run(0.5);                                                            // no position while the seek runs
  v.advance(dt);
  assert.equal(v.time, 2);
  el.seeked();
  el.run(0.1);
  v.advance(dt);
  assert.ok(Math.abs(v.time - 2.1) < 1e-9);
  // a hold (the host's fast-forward): the element waits, the video's time runs on game time
  held = true;
  v.source.sync(v);
  assert.equal(el.paused, true);
  for (let i = 0; i < 30; i++) v.advance(dt);
  assert.ok(Math.abs(v.time - 3.1) < 1e-9);
  assert.equal(el.seeks.length, 1);
  held = false;
  v.source.sync(v);                                                       // the hold ends: one seek to the clock
  assert.deepEqual([el.seeks.length, el.seeks[1], el.paused], [2, v.time, false]);
  el.seeked();
  el.run(0.2);
  v.advance(dt);
  assert.ok(Math.abs(v.time - 3.3) < 1e-9);
  assert.equal(el.seeks.length, 2);
  // an element that failed leaves the video on game time, without seeks
  el.error = { code: 3 };
  v.advance(dt);
  v.advance(dt);
  assert.ok(Math.abs(v.time - (3.3 + 2 * dt)) < 1e-9);
  assert.equal(el.seeks.length, 2);
}));

// a StorySession as fastForwardClip uses it, over the stand-in player: the script of rows is play()'s
const clipSession = (t, script) => {
  const ff = [];
  return { ctx: t.ctx, opts: { row: 3 }, disposed: false, ended: false, ff, played: null,
           audio: { setFastForward(on) { ff.push(on); } },
           get frame() { return t.loop.frameCount; },
           play() { this.played = this.played || script(); },
           async step() { await t.loop.step(); await flush(); },
           fastForward: StorySession.prototype.fastForward };
};

test("a seek within a clip: the session plays on to the clip's time, every row under it as played, then goes on", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 11 }]);
  await installStoryFeatures(t.ctx, t.p);
  const rows = [];
  const script = async () => {
    await flush();
    await cmd(t, { cmd: "Clip", VideoID: 11, i: 3 });
    for (const [k, d] of [["a", 0.5], ["b", 0.5], ["c", 0.5]]) { await cmd(t, { cmd: "Delay", Duration: d, i: 4 }); rows.push(k); }
  };
  const s = clipSession(t, script), sv = storyVideo(t.ctx);
  let yields = 0;
  const r = await StorySession.prototype.fastForwardClip.call(s, () => 1.2,
    { budgetMs: 0, pause: async () => { yields++; } });
  const clip = sv.current;
  assert.deepEqual([r.back, clip.row, rows], [false, 3, ["a", "b"]]);               // 1.0 s of Delay rows on its frames
  assert.ok(Math.abs(r.time - 1.2) < 1e-6 && clip.time === r.time, `${r.time}`);
  assert.deepEqual([s.ff, sv.held, yields > 0], [[true, false], false, true]);
  assert.deepEqual(storyVideoPosition(t.ctx), { kind: "clip", time: clip.time, duration: 2, row: 3, seekable: true });
  // it goes on from there as played
  await steps(t.loop, 12);
  assert.deepEqual(rows, ["a", "b", "c"]);
  disposeStoryFeatures(t.ctx);
});

test("a seek within a clip stops for a seek back, and at the clip's end; it holds the videos as the player is paused", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 12 }]);
  await installStoryFeatures(t.ctx, t.p);
  const s = clipSession(t, async () => { await flush(); await cmd(t, { cmd: "Clip", VideoID: 12, i: 3 }); });
  let want = 0.9, n = 0;
  const back = await StorySession.prototype.fastForwardClip.call(s, () => { if (++n === 20) want = 0.1; return want; },
    { budgetMs: Infinity });
  assert.equal(back.back, true);
  assert.ok(back.time > 0.1 && back.time < 0.9, `${back.time}`);
  disposeStoryFeatures(t.ctx);
  const t2 = makePlayer([{ cmd: "Clip", VideoID: 12 }]);
  await installStoryFeatures(t2.ctx, t2.p);
  const s2 = clipSession(t2, async () => { await flush(); await cmd(t2, { cmd: "Clip", VideoID: 12, i: 3 }); });
  const end = await StorySession.prototype.fastForwardClip.call(s2, () => 5, { budgetMs: Infinity, paused: () => true });
  assert.deepEqual([end.time, end.back, storyVideo(t2.ctx).held], [1, false, true]);   // the 1 s clip ended first
  disposeStoryFeatures(t2.ctx);
});

// A stand-in session over the player with the engine's sound manager on a clock that is the game clock (its sources
// end when the game time passes their end, before the frame runs), and a script of rows under a clip: a looped music
// cue, a sound effect, a voice a row waits for, Delay rows on the clip's frames. draw: a drawn step reads the state as
// a draw does.
const soundSession = async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 11 }]);
  const clock = new HeadlessAudioContext({ endSources: true });
  const cues = { 1: ["bgm", 0, 48000], 2: ["se", 1, 12000], 3: ["voice", 2, 30000] };
  const audio = new Audio((id) => ({ sheet: "s", cue: cues[id][0], category: cues[id][1], row: {} }), t.loop, { context: clock });
  for (const [cue, , n] of Object.values(cues))
    audio.buffers.set(`s/${cue}`, { buf: clock.createBuffer(2, n, 48000), meta: { sampleRate: 48000, samples: n, loopStart: 24000, loopEnd: n } });
  t.ctx.audio = audio;
  t.loop.on("update", () => audio.update());
  const step = t.loop.step.bind(t.loop);
  t.loop.step = () => { clock.advance(Math.fround(t.loop.time + t.loop.stepDelta())); return step(); };
  await installStoryFeatures(t.ctx, t.p);
  const log = [], reads = [];
  const script = async () => {
    await flush();
    audio.play(1, { loop: true, crossFade: 0 });
    await cmd(t, { cmd: "Clip", VideoID: 11, i: 3 });
    await cmd(t, { cmd: "Delay", Duration: 0.3, i: 4 });
    audio.play(2, { crossFade: 0 });
    const voice = audio.play(3, { crossFade: 0 });
    while (audio.isPlaying(voice)) await t.loop.yield("Update");       // a row waiting for its voice
    log.push(["voice over", t.loop.frameCount]);
    await cmd(t, { cmd: "Delay", Duration: 0.9, i: 5 });
    log.push(["delay", t.loop.frameCount]);
  };
  const s = { ctx: t.ctx, loop: t.loop, audio, disposed: false, ended: false, opts: { row: 3 }, log, reads, played: null,
              get frame() { return t.loop.frameCount; }, play() { this.played = this.played || script(); },
              async step({ draw = true } = {}) { await t.loop.step(); await flush(); if (draw) reads.push(storyState(this).video); },
              fastForward: StorySession.prototype.fastForward, fastForwardClip: StorySession.prototype.fastForwardClip };
  return { t, s };
};

test("a fast-forward reaches the state of the same steps drawn: rows, clip, timeline, sounds and their positions", async () => {
  const drawn = await soundSession(), ff = await soundSession();
  drawn.s.play();
  for (let n = 0; n < 45; n++) await drawn.s.step();
  // a clip seek from its row to 1.2 s, then on with a plain fast-forward
  const r = await ff.s.fastForwardClip(() => 1.2, { budgetMs: 0, pause: async () => {} });
  assert.deepEqual([r.back, ff.s.frame], [false, 37]);
  await ff.s.fastForward(() => ff.s.frame >= 45, { budgetMs: Infinity });
  assert.deepEqual(ff.s.log, drawn.s.log);
  assert.deepEqual(drawn.s.log.map((x) => x[0]), ["voice over", "delay"]);
  assert.deepEqual(storyState(ff.s), storyState(drawn.s));
  assert.equal(ff.s.reads.length, 0);                                     // nothing drawn meanwhile
  // the music plays on (the effect and the voice have ended), restarted at its place in the loop (0.5 .. 1 s)
  const cues = (s) => [...s.audio.playing.values()].map((i) => i.cue.cue);
  assert.deepEqual([cues(ff.s), cues(drawn.s)], [["bgm"], ["bgm"]]);
  const pos = (s) => { const i = [...s.audio.playing.values()][0]; return i.startOffsetSec + (s.audio.ctx.currentTime - i.startCtx); };
  const looped = (x) => (x >= 1 ? 0.5 + ((x - 0.5) % 0.5) : x);
  assert.ok(pos(drawn.s) > 1 && Math.abs(pos(ff.s) - looped(pos(drawn.s))) < 1e-6, `${pos(ff.s)} ${pos(drawn.s)}`);
  assert.equal(ff.s.audio.master.gain.value, 1);
  // one step apart: different states
  await drawn.s.step();
  assert.notDeepEqual(storyState(ff.s), storyState(drawn.s));
  disposeStoryFeatures(ff.t.ctx); disposeStoryFeatures(drawn.t.ctx);
});

test("the skip confirmation pauses a playing video and resumes it; the playback's stop stops every loaded video", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 11 }, { cmd: "Movie", VideoID: 12 }], { auto: false });
  await installStoryFeatures(t.ctx, t.p);
  const session = { core: { isPause: false }, ctx: t.ctx, _dialogVideo: false };
  const dialog = (open) => StorySession.prototype.setDialogOpen.call(session, open);
  assert.equal(tryPauseCurrentVideo(t.ctx), false);                       // prepared, not playing
  dialog(true); dialog(false);
  assert.equal(storyVideo(t.ctx).current.isPaused(), false);
  await settle(t.loop, cmd(t, { cmd: "Clip", VideoID: 11, i: 0 }));
  await steps(t.loop, 3);
  const sv = storyVideo(t.ctx), clip = sv.current;
  dialog(true);
  assert.deepEqual([session.core.isPause, clip.isPaused()], [true, true]);
  const time = clip.time;
  await steps(t.loop, 5);
  assert.equal(clip.time, time);                                          // the paused video's clock holds
  dialog(false);
  assert.deepEqual([session.core.isPause, clip.isPaused()], [false, false]);
  await steps(t.loop, 3);
  assert.ok(clip.time > time);
  dialog(true);                                                           // the skip confirmed: the video stays paused
  StorySession.prototype.setDialogOpen.call(session, false, false);
  assert.deepEqual([session.core.isPause, clip.isPaused(), session._dialogVideo], [false, true, false]);
  // AdvPlayer.Stop: the clip and the prepared movie stop
  t.ctx.audio.stopAll = () => {};
  StoryPlayerCore.prototype._stop.call({ ctx: t.ctx, session: { sePlayIds: [] } }, 1);
  assert.deepEqual(sv.loaded.map((v) => v.isStopComplete()), [true, true]);
  assert.deepEqual([sv.flow.clipVideoPlaying, storyVideoPosition(t.ctx)], [false, null]);   // AdvFlowParameters.Stop
  disposeStoryFeatures(t.ctx);
});

// ------------------------------------------------------------------------------------------------ seek re-speed
const F = Math.fround;
// the player's speed change (AdvLocalDataHandler.UpdatePlaybackSpeed -> ReapplyPlaybackSpeed)
const setSpeed = (t, speed) => { t.p.playbackSpeed = speed; setStoryFeaturesSpeed(t.ctx, t.p.speedRate()); };
const playClip = async (t, id) => {
  await settle(t.loop, cmd(t, { cmd: "Clip", VideoID: id, i: 0 }));
  return storyVideo(t.ctx).current;
};

test("seek re-speed: a speed change stops a playing audio clip at its frame and plays it again there at the new speed", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 13 }]);
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx), screen = v.view.screen;
  const video = await playClip(t, 13);
  assert.equal(video.hasAudio, true);
  await steps(t.loop, 10);
  assert.equal(video.displayedFrameNo(), 10);
  setSpeed(t, 20);
  await flush();
  // at once: re-speeding, the video stopped, the copy of the last frame over it at 0.7, the video masked
  assert.equal(v.seekRespeeding, true);
  assert.equal(video.isPlaying(), false);
  assert.equal(v.videoPlayingOrSeekRespeeding, true);
  assert.equal(screen.freeze.activeSelf, true);
  assert.equal(screen.freeze.canvasGroup.alpha, F(0.7));
  assert.equal(v.view.videoCG.alpha, 0);
  await steps(t.loop, 1);                                                 // stopped: started again at frame 10, speed 2
  assert.equal(video.isPlaying(), true);
  assert.equal(video.speed, 2);
  assert.equal(video.seekFrame, 10);
  assert.equal(video.maxFrameDrop, 3);
  assert.equal(v.seekRespeeding, true);
  await steps(t.loop, 2);                                                 // playing, then another frame: 4 frames on
  assert.equal(v.seekRespeeding, false);
  assert.equal(v.seekRespeedAdvancedFrames, 4);
  assert.equal(video.displayedFrameNo(), 16);                             // 2 more in that tick's update
  assert.equal(v.view.videoCG.alpha, 1);
  assert.equal(screen.freeze.activeSelf, true);
  await steps(t.loop, 2);                                                 // two frames later the copy goes
  assert.equal(screen.freeze.activeSelf, false);
  assert.equal(screen.freeze.canvasGroup.alpha, 0);
  assert.equal(v.respeedSessionActive, false);
  // a clip without audio takes a speed at once
  const t2 = makePlayer([{ cmd: "Clip", VideoID: 11 }]);
  await installStoryFeatures(t2.ctx, t2.p);
  const plain = await playClip(t2, 11);
  setSpeed(t2, 15);
  assert.equal(plain.speed, 1.5);
  assert.equal(storyVideo(t2.ctx).seekRespeeding, false);
  assert.deepEqual([...t.p.errors, ...t2.p.errors], []);
  disposeStoryFeatures(t.ctx); disposeStoryFeatures(t2.ctx);
});

test("seek re-speed: a change while one runs loops once more, then the requested rerun runs; a pause marks it for resume", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 13 }]);
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx), video = await playClip(t, 13);
  let stops = 0;
  const stopForSeek = video.stopForSeek.bind(video);
  video.stopForSeek = () => { stops++; stopForSeek(); };
  await steps(t.loop, 5);
  setSpeed(t, 20);
  await steps(t.loop, 1);
  setSpeed(t, 15);                                                        // during the first: a rerun request
  assert.equal(v.respeedRerunRequested, true);
  await steps(t.loop, 20);
  // the first loop saw the speed change and ran again at 1.5; the rerun then ran once more at the same speed
  assert.equal(stops, 3);
  assert.equal(video.speed, 1.5);
  assert.equal(v.seekRespeeding, false);
  assert.equal(v.respeedSessionActive, false);
  assert.equal(v.respeedRerunRequested, false);
  // the player paused: nothing runs, the video is marked for a re-speed on resume
  t.p.isPause = true;
  setSpeed(t, 10);
  assert.equal(v.respeedPendingOnResume, true);
  assert.equal(v.seekRespeeding, false);
  assert.equal(video.speed, 1.5);
  assert.deepEqual(t.p.errors, []);
  disposeStoryFeatures(t.ctx);
});

test("seek re-speed: the Movie row waits while its video re-speeds; the playback's stop ends a re-speed", async () => {
  const t = makePlayer([{ cmd: "Movie", VideoID: 13 }], { auto: false });
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx);
  const run = cmd(t, { cmd: "Movie", VideoID: 13, i: 0 });
  let done = false; run.then(() => { done = true; });
  await steps(t.loop, 10);
  setSpeed(t, 20);
  await steps(t.loop, 3);
  assert.equal(done, false);                                              // not ended by the stop for the seek
  assert.equal(v.seekRespeedAdvancedFrames, 4);
  // 10 + 4 frames shown, 31 left at speed 2: 16 more ticks (the last ends it)
  const n = await settle(t.loop, run);
  assert.ok(n >= 15 && n <= 17, `${n}`);
  // a stop of the playback during a re-speed: the flags and the overlay cleared, no rerun
  const t2 = makePlayer([{ cmd: "Clip", VideoID: 13 }]);
  await installStoryFeatures(t2.ctx, t2.p);
  const v2 = storyVideo(t2.ctx), video = await playClip(t2, 13);
  await steps(t2.loop, 4);
  setSpeed(t2, 20);
  setSpeed(t2, 15);
  t2.p.cancelled = true;
  await steps(t2.loop, 2);
  assert.equal(v2.seekRespeeding, false);
  assert.equal(v2.respeedSessionActive, false);
  assert.equal(v2.view.screen.freeze.activeSelf, false);
  assert.equal(v2.view.videoCG.alpha, 1);                                 // the mask restored in the finally part
  assert.equal(video.isPlaying(), false);                                 // left stopped for the seek
  assert.deepEqual([...t.p.errors, ...t2.p.errors], []);
  disposeStoryFeatures(t.ctx); disposeStoryFeatures(t2.ctx);
});

test("seek re-speed: the delay helpers hold while it runs, then rescale and take off the real time of the frames it advanced", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 13 }]);
  await installStoryFeatures(t.ctx, t.p);
  const v = storyVideo(t.ctx);
  await playClip(t, 13);
  await steps(t.loop, 5);
  const ends = {};
  const f0 = t.loop.frameCount, watch = (name, pr) => pr.then((ok) => { ends[name] = [ok, t.loop.frameCount - f0]; });
  watch("speed", delayWithSpeedAdjustment(t.p, 1));
  watch("pause", delayWithPauseSpeedAdjustment(t.p, 1));
  await steps(t.loop, 5);
  setSpeed(t, 20);
  await steps(t.loop, 30);
  assert.equal(v.seekRespeedAdvancedFrames, 4);
  // both: 6 ticks counted (the re-speed's first wait resumes after the delay's in that tick), held for the re-speed's
  // three waits, then (1 - 6 dt) x 1/2 - 4 / 30 / 2 at dt per tick
  const dt = F(t.loop.fixedDelta);
  let r = F(1);
  for (let i = 0; i < 6; i++) r = F(r - dt);
  r = F(F(r * F(1 / 2)) - calcVideoRealDuration(t.p, 4));
  let n = 9;
  while (r > 0) { r = F(r - dt); n++; }
  assert.equal(calcVideoRealDuration(t.p, 4), F(F(F(4) / F(30)) / F(2)));
  assert.deepEqual(ends, { speed: [true, n], pause: [true, n] });
  // without a re-speed the countdown is the plain one
  const plain = makePlayer([]);
  await installStoryFeatures(plain.ctx, plain.p);
  let m = 0;
  const d = delayWithSpeedAdjustment(plain.p, 0.5).then(() => { m = plain.loop.frameCount; });
  await settle(plain.loop, d);
  let q = F(0.5), k = 0;
  while (q > 0) { q = F(q - dt); k++; }
  assert.equal(m, k);
  assert.equal(calcVideoRealDuration(plain.p, 4), 0);                     // no current video
  assert.deepEqual(t.p.errors, []);
  disposeStoryFeatures(t.ctx); disposeStoryFeatures(plain.ctx);
});

test("seek re-speed: the freeze overlay copies the last drawn frame, draws it at the group alpha and clears on a viewport change", async () => {
  const t = makePlayer([{ cmd: "Clip", VideoID: 13 }]);
  await installStoryFeatures(t.ctx, t.p);
  const screen = storyVideo(t.ctx).view.screen, calls = [];
  const gl = headlessGL({ onCall: (n, a) => calls.push([n, ...a]) });
  screen.render({ gl: null, width: 64, height: 32 });                   // layout only (no drawing context)
  assert.deepEqual(screen.screenCanvas.root.children.map((n) => n.name), ["Screen", "VideoSeekFreeze"]);
  screen.target = new GLTarget(gl, 64, 32, { depth: true, label: "UIAdvWidget.VideoAndStill.RenderTexture" });
  screen._cameraDrawn = true;
  assert.equal(screen.tryShowVideoSeekFreeze(F(0.7)), true);
  calls.length = 0;
  screen._copyVideoSeekFreeze(gl);
  const t0 = screen.freezeTarget;
  assert.equal(t0.label, "UIAdvWidget.VideoSeekFreeze.RenderTexture");
  assert.equal(t0.depth, undefined);
  const blit = calls.find(([n]) => n === "blitFramebuffer");
  assert.deepEqual(blit.slice(1), [0, 0, 64, 32, 0, 0, 64, 32, gl.COLOR_BUFFER_BIT, gl.NEAREST]);
  assert.ok(calls.some(([n, target, fb]) => n === "bindFramebuffer" && target === gl.READ_FRAMEBUFFER && fb === screen.target.fb));
  const [item] = screen._freezeItems();
  assert.equal(item.glTex(), t0);
  assert.equal(item.verts[6], F(0.7));                                    // vertex alpha: white x the group's 0.7
  assert.deepEqual(Array.from(item.verts.slice(0, 2)), [0, 0]);           // the screen image's stretched rect
  // a last draw without the camera's canvases: nothing to copy, nothing drawn
  screen.clearVideoSeekFreeze();
  screen._cameraDrawn = false;
  screen.tryShowVideoSeekFreeze(F(0.7));
  screen._copyVideoSeekFreeze(gl);
  assert.deepEqual(screen._freezeItems(), []);
  // a viewport change clears the overlay
  screen.render({ gl: null, width: 64, height: 32 });
  assert.equal(screen.freeze.activeSelf, true);
  screen.render({ gl: null, width: 80, height: 32 });
  assert.equal(screen.freeze.activeSelf, false);
  screen.target = null; screen.freezeTarget = null;
  disposeStoryFeatures(t.ctx);
});
