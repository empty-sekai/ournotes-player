import { F } from "../../engine/core.js";
import { UIError } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { CanvasNode } from "./canvas.js";
import { DT_PLUGIN, dtTo, storyDOTween } from "./dotween-core.js";
import { SCREEN_CANVAS_PATH, storyScreen, storyUIDoc } from "./screen.js";
import { featureSlot, featureState } from "./state.js";

// Videos of Movie and Clip rows: the loader's video queue (AdvEpisodeResourceLoader: VideoIDs of the Movie / Clip rows
// in row order, at most two prepared ahead; the commands take Session.CurrentVideoInfo, not their own VideoID), the
// playing video (Fwk.Video.VideoInfo over a CRI Mana player), AdvVideoView on UIAdvWidget/VideoCanvas, the video
// timeline that Delay rows follow during a clip (AdvVideoTimeline), the flow flags (AdvFlowParameters) and the helpers
// of AdvVideoCommandHelper.
// ENGINE: CRI Mana decodes and clocks the movie by its audio track. Here a video is prepared at once, starts playing on
// Start, and its time advances by the loop's delta x its speed in the update phase; the displayed frame is
// floor(time x frame rate). The end (PlayEnd) is reached at frames / frame rate. A browser page shows the WebM of the
// story data through an HTMLVideoElement kept on that clock.

export const CRI_STATUS = Object.freeze({ Stop: 0, Dechead: 1, WaitPrep: 2, Prep: 3, Ready: 4, Playing: 5, PlayEnd: 6 });
const MAX_VIDEO_LOAD_TASK = 2;                // AdvEpisodeResourceLoader.MaxVideoLoadTask
const MAX_SPEED = 3;                          // VideoInfo.ChangePlaybackSpeed cap
const STALL_SECONDS = 5;                      // AdvVideoTimeline stall limit
export const TIMELINE = Object.freeze({ Reached: 0, Waiting: 1, Aborted: 2 });

const waitUntil = async (loop, pred, stop) => {
  while (!pred()) { await loop.yield("Update"); if (stop && stop()) return false; }
  return true;
};

// Fwk.Video.VideoInfo with the CRI Mana player state
export class VideoInfo {
  constructor(uid, masterId, rec, source) {
    const m = rec.master;
    this.uniqueVideoId = uid; this.masterVideoId = masterId; this.assetName = m._assetName;
    this.autoStop = !!m._autoStop; this.hasAudio = !!m._hasAudio;
    this.file = rec.file;
    this.frameRate = rec.frameRate[0] / rec.frameRate[1];
    this.frames = rec.frames;
    this.duration = rec.frames / this.frameRate;
    // VideoSize: the master size when both are positive, else the movie's display size
    this.videoSize = m._width > 0 && m._height > 0 ? { x: m._width, y: m._height } : { x: rec.displayWidth || 0, y: rec.displayHeight || 0 };
    this.status = CRI_STATUS.Ready;
    this.time = 0; this.speed = 1; this.paused = false;
    this.onPlayFinished = [];
    this.source = source;                    // null once released
  }

  isPlaying() { return this.status === CRI_STATUS.Playing; }
  isPlayFinished() { return !this.source || this.status === CRI_STATUS.PlayEnd; }
  isStopComplete() { return this.status === CRI_STATUS.Stop; }
  isReady() { return this.status === CRI_STATUS.Ready; }
  isPaused() { return this.paused; }
  get material() { return this.source; }

  changePlaybackSpeed(s) { this.speed = Math.min(s, MAX_SPEED); if (this.source) this.source.setSpeed(this.speed); }
  play(speed) { if (speed !== undefined) this.changePlaybackSpeed(speed); this.start(); }
  start() {
    if (!this.source) return;
    if (this.status === CRI_STATUS.Ready || this.status === CRI_STATUS.Stop) { this.status = CRI_STATUS.Playing; this.time = 0; }
    this.source.sync(this);
  }
  stop() { if (this.source) { this.status = CRI_STATUS.Stop; this.source.sync(this); } }
  prepare() { if (this.source && this.status === CRI_STATUS.Stop) this.status = CRI_STATUS.Ready; }
  pause(on) { this.paused = !!on; if (this.source) this.source.sync(this); }

  // CriMana.Player.GetDisplayedFrameNo: -1 before the first frame
  displayedFrameNo() {
    if (this.status !== CRI_STATUS.Playing && this.status !== CRI_STATUS.PlayEnd) return -1;
    return Math.min(Math.floor(this.time * this.frameRate + 1e-6), this.frames - 1);
  }

  advance(dt) {
    if (this.status !== CRI_STATUS.Playing || this.paused || !this.source) return;
    this.time += dt * this.speed;
    if (this.time >= this.duration) { this.time = this.duration; this.status = CRI_STATUS.PlayEnd; }
    this.source.sync(this);
  }

  // VideoInfo.OnUpdate: at PlayEnd (or without a source) the play-finished functions run once
  update() {
    if (!this.isPlayFinished() || !this.onPlayFinished.length) return;
    const fs = this.onPlayFinished;
    this.onPlayFinished = [];
    for (const f of fs) f();
  }

  release() { if (this.source) this.source.release(); this.source = null; this.status = CRI_STATUS.Stop; }
}

// A video source without a decoder (headless): the state only
const headlessSource = () => ({ setSpeed() {}, sync() {}, release() {}, glTex: null });

// A browser video source: the WebM through an HTMLVideoElement, kept within a tenth of a second of the video's clock,
// uploaded into a texture when it shows a new frame
const browserSource = (ctx, file) => {
  const gl = ctx.gl, el = document.createElement("video");
  el.muted = !ctx.sound; el.playsInline = true; el.preload = "auto";
  el.src = URL.createObjectURL(new Blob([ctx.assets.bytes(file)], { type: "video/webm" }));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  let fresh = false, w = 1, h = 1;
  const onFrame = () => { fresh = true; el.requestVideoFrameCallback(onFrame); };
  if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(onFrame);
  return {
    setSpeed(s) { el.playbackRate = s; },
    sync(v) {
      const run = v.status === CRI_STATUS.Playing && !v.paused;
      if (Math.abs(el.currentTime - v.time) > 0.1) el.currentTime = v.time;
      if (run && el.paused) el.play().catch(() => {});
      else if (!run && !el.paused) el.pause();
    },
    glTex() {
      if ((fresh || !el.requestVideoFrameCallback) && el.readyState >= 2) {
        fresh = false; w = el.videoWidth; h = el.videoHeight;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
      return { glTexture: tex, width: w, height: h };
    },
    release() { el.pause(); URL.revokeObjectURL(el.src); el.removeAttribute("src"); el.load(); gl.deleteTexture(tex); },
  };
};

// AdvVideoTimeline
export class VideoTimeline {
  constructor() { this.end(); }
  begin(videoId, startFrameNo) {
    Object.assign(this, { videoId, isActive: true, elapsed: 0, lastAbortReason: 0, target: 0, stalled: 0,
                          startFrameNo: Math.max(startFrameNo, 0) });
  }
  end() { Object.assign(this, { isActive: false, videoId: 0, elapsed: 0, lastAbortReason: 0, stalled: 0, startFrameNo: 0, target: 0 }); }
  advanceTarget(d) { if (d > 0 && this.isActive) this.target = F(this.target + d); }
  snapTargetToElapsed() { if (this.isActive) this.target = this.elapsed; }
  get remainingSeconds() { return Math.max(F(this.target - this.elapsed), 0); }
  _abort(reason) { this.lastAbortReason = reason; return TIMELINE.Aborted; }
  update(o) {
    if (!this.isActive || !o.hasVideo) return this._abort(1);
    if (o.isPlaybackFinished) return this._abort(2);
    if (o.isProgressing && o.frameRate > 0 && o.displayedFrameNo > this.startFrameNo) {
      const t = F((o.displayedFrameNo - this.startFrameNo) / o.frameRate);
      if (t > this.elapsed) { this.elapsed = t; this.stalled = 0; return this.target <= t ? TIMELINE.Reached : TIMELINE.Waiting; }
    }
    if (this.target <= this.elapsed) { this.stalled = 0; return TIMELINE.Reached; }
    if (o.isSuspended) { this.stalled = 0; return TIMELINE.Waiting; }
    this.stalled = F(this.stalled + o.deltaSeconds);
    return this.stalled < STALL_SECONDS ? TIMELINE.Waiting : this._abort(3);
  }
}

// the video system of a story context: queue, current video, view, timeline, flow flags
export class StoryVideo {
  constructor(ctx, doc) {
    this.ctx = ctx; this.doc = doc;
    this.requests = [];                       // _videoRequestQueue
    for (const c of ctx.episode.commands)
      if ((c.cmd === "Movie" || c.cmd === "Clip") && !c.IgnoreData && (c.VideoID || 0) > 0) this.requests.push(c.VideoID);
    this.tasks = [];                          // _videoLoadTaskQueue (prepared videos)
    this.loaded = [];                         // Loader.LoadedVideoIds
    this.current = null;                      // Session.CurrentVideoInfo
    this.nextUid = 1;
    this.timeline = new VideoTimeline();
    this.flow = { clipVideoPlaying: false, clipVideoSkip: false, clipControlAvailable: false, movieVideoPlaying: false };
    this.view = new VideoView(ctx);
    this._hook = (l) => this._update(l.deltaTime);
    ctx.loop.on("update", this._hook);
    // Preload: prepare up to two, then the first becomes the current video
    while (this._enqueue()) {}
    if (this.tasks.length) this._setCurrent(this.tasks.shift());
  }

  get hasCurrentVideoInfo() { return this.current !== null; }
  // Session.VideoPlaying / VideoPlayingOrSeekRespeeding (no seek re-speed here)
  get videoPlaying() { const v = this.current; return !!v && (v.isPlaying() || v.isPlayFinished()); }
  get videoPlayingOrSeekRespeeding() { const v = this.current; return !!v && v.isPlaying(); }
  get isClipVideoPlaying() { return this.flow.clipVideoPlaying; }
  get isVideoPlaying() { return this.flow.clipVideoPlaying || this.flow.movieVideoPlaying; }

  _setCurrent(v) { this.current = v; }

  // EnqueueVideoLoadTask -> PrepareVideoTask
  _enqueue() {
    if (!this.requests.length || this.tasks.length >= MAX_VIDEO_LOAD_TASK) return false;
    const id = this.requests.shift(), rec = this.doc.videos[id];
    if (!rec) throw new StoryCommandError(`video ${id} is not in the story data`);
    let v = null;
    if (rec.master && (rec.master._assetName ?? "").trim()) {
      const ctx = this.ctx;
      const src = ctx.gl && typeof document !== "undefined" ? browserSource(ctx, rec.file) : headlessSource();
      v = new VideoInfo(this.nextUid++, id, rec, src);
      this.loaded.push(v);
    }
    this.tasks.push(v);
    return true;
  }

  // PrepareNextVideo: release the current video's asset, then the next prepared one becomes current
  prepareNext() {
    if (this.current) this.current.release();
    this._setCurrent(null);
    this._enqueue();
    if (this.tasks.length) this._setCurrent(this.tasks.shift());
  }

  // VideoManager.OnUpdate -> VideoPlayer.UpdatePlayingVideos: time, the play-finished functions, AutoStop release
  _update(dt) {
    for (const v of this.loaded) v.advance(dt);
    for (const v of this.loaded) {
      if (v.releaseNext) { v.releaseNext = false; v.release(); continue; }
      const finished = v.status === CRI_STATUS.PlayEnd;
      v.update();
      if (finished && v.autoStop && v.source) { v.stop(); v.releaseNext = true; }
    }
  }

  // Session.UpdateVideoTimeline(delta, isPlayerPaused)
  updateTimeline(delta, paused) {
    const v = this.current, has = !!v && v.uniqueVideoId === this.timeline.videoId;
    return this.timeline.update({
      hasVideo: has, isPlaybackFinished: has && v.isPlayFinished(), isProgressing: has && v.isPlaying(),
      isSuspended: paused || (has && v.isPaused()), displayedFrameNo: has ? v.displayedFrameNo() : -1,
      frameRate: has ? v.frameRate : 0, deltaSeconds: delta,
    });
  }

  // SnapVideoTimelineToCurrentPosition(paused)
  snapTimeline(paused) { if (this.timeline.isActive) { this.updateTimeline(0, paused); this.timeline.snapTargetToElapsed(); } }

  setVideoAlpha(alpha, duration, cancelled) { return this.view.setAlpha(alpha, duration, cancelled); }

  // ReapplyPlaybackSpeed for the current video (a speed change also reaches an audio video directly here)
  setPlaybackSpeed(rate) { if (this.current) this.current.changePlaybackSpeed(rate); }

  // AdvPlayer.Stop: every loaded video stopped
  dispose() {
    const hs = this.ctx.loop.hooks.update, i = hs.indexOf(this._hook);
    if (i >= 0) hs.splice(i, 1);
    for (const v of this.loaded) v.release();
    this.view.dispose();
  }

  snapshot() {
    const v = this.current;
    return { current: v ? [v.masterVideoId, v.status, v.time, v.speed] : null, flow: { ...this.flow },
             timeline: [this.timeline.isActive, this.timeline.elapsed, this.timeline.target], view: this.view.snapshot() };
  }
}

// AdvVideoView (ui/ui.json record `videoView`) on VideoCanvas
export class VideoView {
  constructor(ctx) {
    this.ctx = ctx;
    this.screen = storyScreen(ctx);
    this.mgr = storyDOTween(ctx);
    const { doc, dir } = storyUIDoc(ctx), canvas = this.screen.canvas.video, base = SCREEN_CANVAS_PATH.video;
    const nodes = new Map();
    for (const rec of doc.nodes) {
      if (!rec.path.startsWith(`${base}/`)) continue;
      const parentPath = rec.path.slice(0, rec.path.lastIndexOf("/"));
      const parent = parentPath === base ? canvas.root : nodes.get(parentPath);
      if (!parent) throw new UIError(`${rec.path}: parent not in the story UI data`);
      const n = new CanvasNode(rec, parent);
      if (rec.image) {
        const mat = rec.image.material ? doc.materials[rec.image.material] : null;
        if (rec.image.material && !mat) throw new UIError(`${rec.path}: material ${rec.image.material} not in the story UI data`);
        n.image = { ...rec.image, m_Enabled: !!rec.image.m_Enabled, m_Color: { ...rec.image.m_Color },
                    spriteObj: canvas.uiSprite(doc, rec.image.sprite, dir), material: mat ? canvas.material(mat) : null };
      }
      if (rec.rawImage || rec.text || rec.animator) throw new UIError(`${rec.path}: component not implemented on the video canvas`);
      nodes.set(rec.path, n);
    }
    const viewRec = doc.nodes.find((r) => r.videoView);
    if (!viewRec || !nodes.has(viewRec.path)) throw new StoryCommandError("the story UI data has no AdvVideoView");
    const vv = viewRec.videoView, get = (p) => {
      const n = nodes.get(p);
      if (!n) throw new StoryCommandError(`AdvVideoView: ${p} missing`);
      return n;
    };
    this.node = get(viewRec.path);
    this.video = get(vv._video); this.maskArea = get(vv._maskArea);
    this.curtain = get(vv._curtainCanvasGroup); this.videoParent = get(vv._videoCanvasGroup);
    if (!this.video.image || !this.curtain.canvasGroup || !this.videoParent.canvasGroup)
      throw new StoryCommandError("AdvVideoView: the video graphic or its canvas groups are missing");
    this.curtainCG = this.curtain.canvasGroup; this.videoCG = this.videoParent.canvasGroup;
    this.targetAlpha = 0; this.sourceSize = null; this.info = null;
    // CalcContainedSize over the view rect, applied at every layout while a source size is set (RefreshLayoutByViewport)
    const fit = (n) => {
      const r = this.node.rect, s = this.sourceSize;
      if (!s || !r || !(s.x > 0 && s.y > 0 && r.w > 0 && r.h > 0)) { n.sizeDelta = { x: 0, y: 0 }; return; }
      const a = F(s.x / s.y);
      n.sizeDelta = F(r.w / r.h) <= a ? { x: r.w, y: F(r.w / a) } : { x: F(a * r.h), y: r.h };
    };
    this.video.fitter = fit; this.maskArea.fitter = fit;
    this.video.image.glTex = () => (this.info && this.info.source && this.info.source.glTex ? this.info.source.glTex() : null);
    this.hideInternal();                      // UIAdvWidget.Refresh
  }

  _fade(cg, to, duration) {
    return dtTo(this.mgr, () => cg.alpha, (v) => { cg.alpha = v; }, F(to), duration, DT_PLUGIN.float).setTarget(cg);
  }

  // AdvVideoView.ShowVideo(size, material, alpha, fade)
  async show(info, alpha, fade, cancelled) {
    this.targetAlpha = alpha;
    this.node.activeSelf = true;
    this.sourceSize = { ...info.videoSize };
    this.info = info;
    this.video.activeSelf = true; this.maskArea.activeSelf = true; this.curtain.activeSelf = true;
    this.mgr.kill(this.videoCG); this.mgr.kill(this.curtainCG);
    if (fade > 0) await Promise.all([this.mgr.toUniTask(this._fade(this.videoCG, alpha, fade), cancelled),
                                     this.mgr.toUniTask(this._fade(this.curtainCG, 1, fade), cancelled)]);
    this.videoCG.alpha = F(alpha); this.curtainCG.alpha = 1;
  }

  // AdvVideoView.HideVideo(duration)
  async hide(duration, cancelled) {
    if (duration > 0) {
      this.mgr.kill(this.videoCG); this.mgr.kill(this.curtainCG);
      await Promise.all([this.mgr.toUniTask(this._fade(this.videoCG, 0, duration), cancelled),
                         this.mgr.toUniTask(this._fade(this.curtainCG, 0, duration), cancelled)]);
    }
    this.hideInternal();
  }

  hideInternal() {
    this.sourceSize = null; this.targetAlpha = 0; this.info = null;
    this.mgr.kill(this.videoCG); this.videoCG.alpha = 0;
    this.video.sizeDelta = { x: 0, y: 0 }; this.video.activeSelf = false;
    this.maskArea.activeSelf = false; this.maskArea.sizeDelta = { x: 0, y: 0 };
    this.mgr.kill(this.curtainCG); this.curtainCG.alpha = 0; this.curtain.activeSelf = false;
    this.node.activeSelf = false;
  }

  // AdvVideoView.SetAlpha(alpha, duration): the video only, not the curtain
  async setAlpha(alpha, duration, cancelled) {
    this.targetAlpha = alpha;
    this.mgr.kill(this.videoCG);
    if (duration > 0) await this.mgr.toUniTask(this._fade(this.videoCG, alpha, duration), cancelled);
    this.videoCG.alpha = F(alpha);
  }

  dispose() { this.mgr.kill(this.videoCG); this.mgr.kill(this.curtainCG); }

  snapshot() { return [this.node.activeSelf, this.videoCG.alpha, this.curtainCG.alpha, this.targetAlpha, this.sourceSize]; }
}

export const storyVideo = (ctx) => featureState(ctx).video || null;

export const loadVideos = (ctx) => {
  const uses = ctx.episode.commands.some((c) => (c.cmd === "Movie" || c.cmd === "Clip") && !c.IgnoreData);
  if (!uses) return null;
  const file = ctx.story && ctx.story.videos;
  const v = featureSlot(ctx, "video", () => new StoryVideo(ctx, file ? ctx.assets.json(file) : { videos: {} }));
  const s = featureState(ctx);
  s.disposers.push(() => v.dispose());
  (s.snapshots = s.snapshots || []).push(() => ({ video: v.snapshot() }));
  (s.speedListeners = s.speedListeners || []).push((rate) => v.setPlaybackSpeed(rate));
  return v;
};

// AdvPlayerHelper.DelayUntilVideoTimelineAsync -> {completed, remaining}: follows the clip's frame clock until the
// timeline target is reached; a skip to the clip marker, a shortcut or a stop end it as reached; a lost, finished or
// stalled video ends it with the remaining seconds (the timeline ends)
export const delayUntilVideoTimeline = async (p) => {
  const v = storyVideo(p.ctx), loop = p.ctx.loop;
  for (;;) {
    if (v.flow.clipVideoSkip) { v.snapTimeline(!!p.isPause); return { completed: true, remaining: 0 }; }
    if (p.shortCutIndex >= 0 || p.cancelled) return { completed: true, remaining: 0 };
    const s = v.updateTimeline(loop.deltaTime, !!p.isPause);
    if (s === TIMELINE.Reached) return { completed: true, remaining: 0 };
    if (s === TIMELINE.Aborted) { const r = v.timeline.remainingSeconds; v.timeline.end(); return { completed: false, remaining: r }; }
    await loop.yield("Update");
  }
};

// Session.VideoTimeline.IsActive, for the Delay command
export const videoTimelineActive = (ctx) => { const v = storyVideo(ctx); return !!v && v.timeline.isActive; };

// AdvPlayerUIEventHandler.TryShowVideoControl: a tap during a Movie, or a Clip with controls, shows the video buttons
// (skip when a clip marker follows) and does not reach the script
export const tryShowVideoControl = (p) => {
  const v = storyVideo(p.ctx);
  if (!v) return false;
  if (v.flow.clipVideoPlaying && v.flow.clipControlAvailable) { p.ctx.ui.showVideoButtons(findNextClipMarkerIndex(p) >= 0); return true; }
  if (v.flow.movieVideoPlaying) { p.ctx.ui.showVideoButtons(true); return true; }
  return false;
};

// FindNextClipMarkerIndex: rows after the current one; a Clip with a video first -> -1; a Clip marked SkipClipTarget
export const findNextClipMarkerIndex = (p) => {
  const rows = p.ctx.episode.commands;
  if (typeof p.currentEpisodeListIndex !== "number") throw new StoryCommandError("the player has no current row index");
  for (let i = p.currentEpisodeListIndex + 1; i < rows.length; i++) {
    const c = rows[i];
    if (c.cmd !== "Clip") continue;
    if ((c.VideoID || 0) > 0) return -1;
    if ((c.Parameter3 ?? "").toLowerCase() === "skipcliptarget") return i;
  }
  return -1;
};
