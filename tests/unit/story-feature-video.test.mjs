// Movie / Clip / Subtitles on a real PlayerLoop at 30 fps with synthetic video records and a stand-in UI: the video
// queue, the view's fades, the clip's frame clock and the timeline Delay rows follow, the clip's end, the stop marker,
// the Movie's blocking, captions over a clip. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { delayUntilVideoTimeline, storyVideo } from "../../src/story/features/video.js";

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
              session: { voicePlayIds: [], withVoice: true },
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
