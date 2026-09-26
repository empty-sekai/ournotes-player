import { bindAssets, unbindAssets } from "../data/assets.js";
import { F } from "../engine/core.js";
import { SOUND_CATEGORY } from "../engine/audio.js";
import { trackGL } from "../engine/gltrack.js";
import { ShaderLib } from "../engine/glsl.js";
import { PlayerLoop } from "../engine/loop.js";
import { LiveLightWeightBackground } from "./background.js";
import { LiveFx } from "./fx.js";
import { LiveNotes } from "./noteview.js";
import { LiveRenderer } from "./renderer.js";
import { LIVE_OPTION_BY_NAME, LiveOptionContext, LiveSettingsError, liveCategoryVolumes, liveDerived, liveNoteEffectName,
         liveNoteSeMaps, liveOptionItems, liveSettingsChanges } from "./settings.js";
import { LiveExecutor } from "./simulator.js";
import { LiveAudio, LiveGameClock } from "./sound.js";
import { LiveStage } from "./stage.js";

// ChartSession: the chart preview of one live in LightWeight mode (auto play at Perfect, the game's Live options of
// `settings` (settings.js), 60 fps), drawn into a WebGL2 context. It has no DOM access: the caller owns the context
// and its canvas, calls step() at the frame rate (ChartPlayer drives it with requestAnimationFrame) and render() /
// resize() as needed.
//
// Game flow reproduced (states of App.Live's FiniteStateMachine, applied in GameMain's Update):
//   load        FullInitialize: renderer, stage (intro timeline evaluated at 0), note views, effects
//   intro       MusicStartAnimationStateNode.Enter: HideUI, then LiveStartSequenceAsync starts the start timeline
//               (stage.startIntro); the timeline advances on game time. While it plays the sequence calls
//               LiveGameView.UpdateFrame(null) each frame, which only runs LiveSelfRenderCamera.ManualUpdate (enables
//               the effect camera when ShouldRenderThisFrame; with SetRenderFrame(60) at 60 fps that is every frame,
//               which LiveRenderer does) and returns before the views: nothing to call here
//   start       the timeline's UniTask loop ends at UniTask Update of the frame after the last evaluation; the
//               sequence transitions (TransitionNextState) and Fwk.FiniteStateMachine.Update (pending state -> Exit,
//               Enter, then Update of the new state, same call) enters LiveStartStateNodeBase.Enter in that frame's
//               Update: PlayMusic, LiveExecutor.StartLive, OnEnter, IsEnterChangeNextState (true) -> ChangeState
//               (playing), SetActiveLiveUI (LiveUIView on), OnStartMusicScore (background presenter only; nothing in
//               LightWeight mode)
//   playing     from the next frame: LivePlayingStateNodeBase.Update: the chart clock from the BGM's audio-synced
//               time, LiveExecutor.Update, then the views
//   ended       IsPlayingMusic false, PostMusicBufferMs 0, ShouldContinueUpdateAfterMusicStop false: no further live
//               update; the result states that follow are not part of the session
//
// Player features (not in the game):
//   direct start  the session starts at the chart. The game's start canvas (UILiveStartCanvas) is not built; create()
//           runs the start request and the intro timeline to its end without drawing and without the intro's sounds
//           (start cheer, start voice), so stage, lane and tap area are as the game leaves them at PlayMusic, and the
//           session then stays at the end of the intro (state "start", paused) until play().
//   seek    the chart-side state is re-simulated frame by frame without drawing: LiveExecutor, note views, live UI
//           (judgement, combo counter), on the 60 fps game-time grid of the music position (the music-off clock); a
//           seek backwards starts again from the music start (the state the session had at PlayMusic), a seek forwards
//           continues from the current state. Effects (note / lane effects, hold loops, particles) are cleared, sounds
//           other than the music are stopped. With the music on, the BGM restarts at the reached position and the
//           live update waits until the audio clock is past it.
//   catch-up  when the chart clock has moved on by more than one frame since the last live update (a late frame, a
//           slow device, a tab in the background), the frames in between are simulated in deltaTime steps from the
//           last update's music position without drawing and without sounds, then the frame's own update runs: the
//           state equals the continuous run's (no judgement is lost to the jump; sounds of the missed frames are not
//           played, the hold-loop SE follows the frame's own update). Up to LIVE_CATCHUP_FX_FRAMES missed frames the
//           effects are stepped too (update, DOTween, Animators, particles); beyond that they are cleared as on a
//           seek. A jump of more than LIVE_CATCHUP_MAX_MS is a seek to the new chart time.
//   speed   Time.timeScale for the game time (effects, tweens, animators) and the playbackRate of the music (the chart
//           clock follows the music; its pitch changes); without music the game clock runs at the speed.
//   pause   no step runs and the AudioContext is suspended (music, sounds and their clock stop together).
//   end     the step that ends the chart (and a seek to its end) suspends the AudioContext too: the session has no
//           state after the chart, and the sounds still playing (the finish cheer loops by itself) stop with it;
//           play() resumes it (and starts the chart again).
//   music / sound effects on and off; a chart without audio files (manifest "audio": false) runs on the game clock.
//   settings  the game reads the Live options once, when the live boots. setSettings() applies a change at once and
//           gives the state a live booted with the new values has at the current chart time: options read by the
//           simulation, the note views or the live UI restart the chart state and re-simulate it to the current chart
//           time (as a seek); options that are constants of a draw (lane, background, line opacities) and the note
//           SE maps are replaced; the live category volumes change the playing sounds at once, as in the game's
//           settings panel. Options that select other files (mirrored score, note design, effect set, quality) need a
//           new session (ChartPlayer creates it and returns to the chart time).
//   end of the chart  with a post-music lead (ChartPosition > 0) the chart runs behind the music by the lead and goes
//           on after the music has ended until the lead is used up (its time then reaches the music length); the
//           session ends at the next frame.

export const LIVE_CATCHUP_FX_FRAMES = 12;     // catch-up: effects stepped up to this many missed frames
export const LIVE_CATCHUP_MAX_MS = 2000;      // catch-up: a longer jump of the chart clock is a seek
export const LIVE_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];   // the playback speeds the controls offer

export class ChartSession {
  // opts:
  //   gl            WebGL2RenderingContext (required); used by this session alone while it lives
  //   assets        AssetStore of the chart (required)
  //   audioContext  an AudioContext to play into, at any sample rate (the waveforms are decoded into its rate; default:
  //                 a 48 kHz one created and closed by the session)
  //   settings      Live options by name (settings.js LIVE_OPTIONS; default: the chart data's preset-1 values); values
  //                 the chart's files do not offer raise LiveSettingsError
  //   quality       LiveQuality 0..2 (default: the manifest's `quality`, else 1 = Middle, the game's option default);
  //                 a chart manifest carries the files of the qualities it lists; settings.LiveQuality takes precedence
  //   seed          seed of the particle random stream (default: from the clock, as the game's TickCount)
  //   width, height drawing buffer size in pixels (default: the canvas size)
  // Resolves once the session is at the start of the chart, paused.
  static async create(opts = {}) {
    const s = new ChartSession();
    try {
      await s._load(opts);
      await s._prepare();
      await s.pause();
    } catch (e) {
      await s.dispose().catch(() => {});
      throw e;
    }
    return s;
  }

  async _load({ gl, assets, audioContext = null, quality, seed, width, height, settings = null } = {}) {
    if (!gl) throw new Error("ChartSession: a WebGL2 context is required");
    if (!assets) throw new Error("ChartSession: an AssetStore is required");
    bindAssets(gl, assets);
    this.gl = gl; this.assets = assets;
    this._gl = trackGL(gl);
    const live = assets.json("live.json");
    const scene = assets.json(live.scene);
    const noteAssets = assets.json(live.noteAssets);
    const audioData = assets.json(live.liveAudio);
    // Live options: defaults, ranges and the values the chart's files offer, then the settings of this session
    const ctx = new LiveOptionContext({ live, scene, notes: noteAssets, audio: audioData, info: assets.info || null });
    if (quality !== undefined && quality !== null) ctx.defaults.LiveQuality = Number(quality);
    const s = ctx.resolve(settings || {});
    this.optionContext = ctx;
    this._settings = s;
    this.derived = liveDerived(ctx, s);
    // MirrorChart (4): the score converted with isMirror (SsMusicScoreConverter), a file of its own
    const score = assets.json(s.MirrorChart ? live.notesMirror : live.notes);
    this.live = live;
    this.score = score; this.noteAssets = noteAssets;
    const loop = new PlayerLoop(60);
    this.loop = loop;

    // FullInitialize: renderer (cameras, RTs, LightWeight background, post), stage (lane + start timeline),
    // simulation, note views, effects. The effects are built after the stage so that their animation hook runs
    // after the timeline evaluation (DirectorUpdateAnimation precedes ParticleSystemBeginUpdateAll).
    const renderer = new LiveRenderer(gl, new ShaderLib(gl, "livescene/shaders", assets), scene, loop,
                                      { quality: s.LiveQuality, settings: s });
    await renderer.load();
    this.renderer = renderer;
    const c = gl.canvas;
    this.resize(width ?? (c ? c.width : gl.drawingBufferWidth), height ?? (c ? c.height : gl.drawingBufferHeight));
    this._applySize();
    const stage = new LiveStage(renderer, scene, loop);
    await stage.load();
    stage.attach(loop);
    this.stage = stage;
    this.exec = new LiveExecutor(score, noteAssets.settings, this.derived);
    // NoteDesignId (306): the note skin asset of MasterLiveNoteSkin (SoloLiveResourceLoadStateNode.CreateLoadParameter)
    const skin = s.NoteDesignId !== ctx.defaults.NoteDesignId
      ? noteAssets.noteSkins[noteAssets.settings.skins[String(s.NoteDesignId)]] : undefined;
    this.notes = new LiveNotes(gl, noteAssets, score, { base: "livenotes", settings: s, displayOffsetMs: this.exec.D, skin,
                                                        scene: renderer.prefab });
    await this.notes.load();
    this.fx = new LiveFx({ gl, loop, notes: noteAssets, score, scene, introStars: () => stage.intro.stars(),
                           seed: seed ?? (Date.now() >>> 0), settings: s, effect: liveNoteEffectName(ctx, s) });
    await this.fx.load();

    // live sound: SoundManager with the live's CRI routing, LiveSoundPlayer (cheers, note SE, BGM); every cue of
    // the live's audio table decoded up front
    this.audio = new LiveAudio(loop, audioData, { assets, context: audioContext });
    await this.audio.load();
    this.audio.setCategoryVolumes(liveCategoryVolumes(ctx, s));    // unchanged volumes keep the data's values
    const noteSe = liveNoteSeMaps(ctx, s);
    if (noteSe) this.audio.setNoteSe(noteSe);

    // MusicSyncTimeProvider / LivePlayingStateNodeBase state (offsetMs 0 for a fresh profile; chartPositionMs
    // LiveSettings.ChartPositionMs of ChartPosition 3)
    this.clock = { lastMs: -1, hasMusicEverPlayed: false, offsetMs: 0, chartPositionMs: this.derived.chartPositionMs,
                   postMusicBufferMs: 0, postMusicElapsedMs: 0, musicLengthMs: 0 };
    this.state = "load";             // load -> intro -> start -> playing -> ended
    this.startRequested = false;
    this.frame = null;               // frame result of the last live update
    this.chartMs = null;             // chart time of the last live update
    this.lastSec = null;             // music position (s) of the last live update (catch-up and seek grid origin)
    this.pendingSeek = null;         // chart time a too long jump seeks to after the step
    this.voidFrame = false;          // the step of such a jump: no live update, no view / effect / UI advance
    // player state
    this.holdStart = false;          // stay at the end of the intro until play
    this.hold = null;                // no live update while the chart time is <= this (after seek / resume / speed)
    this.preDts = [];                // deltaTime of every frame up to and including the music start frame
    this.paused = false;
    this.seeking = false;
    this.skipRender = false;         // no draw in the render phase (state-only runs)
    this.disposed = false;

    loop.on("update", () => this._update());
    loop.on("update", (l) => { if (!this.voidFrame) this.notes.updateGradients(l.deltaTime); });   // ArrowGradientAnimator
    loop.on("animation", (l) => { if (!this.voidFrame) this.notes.animate(l); });
    loop.on("render", () => { if (!this.skipRender && !this._noDraw && !this.voidFrame) this.render(); });
    stage.intro.onEnd = () => { this.state = "start"; };
    // Signal track -> LivePlayableTimeline receiver: PlayVoice (NotifyPlayVoice -> PlayLiveStartVoice) is the intro's
    // start voice, not played by the direct start
    stage.intro.onSignal = (name) => { if (name !== "PlayVoice") throw new Error(`timeline signal ${name}`); };
  }

  // GameMain.Update -> LiveManager.OnUpdate -> FiniteStateMachine.Update -> state node Update
  _update() {
    this.audio.tick();                                             // SoundManager.OnUpdate
    if (this.state !== "playing" && this.state !== "ended") this.preDts.push(this.loop.deltaTime);
    if (this.state === "load" && this.startRequested) {
      this.state = "intro";                                        // MusicStartAnimationStateNode.Enter
      this.fx.setUIActive(false);                                  // HideUI: LiveUIView off
      this.stage.startIntro();                                     // LiveStartSequenceAsync -> PlayLiveStartAnimation
    } else if (this.state === "start") {
      if (this.holdStart) { this.exec.resetFrame(); return; }      // waiting for play
      this.state = "playing";                                      // LiveStartStateNodeBase.Enter (pending applied)
      this.audio.startMusic();                                     // StopStartCheer(1), StopFinishCheer(0), PlayMusic
      this.clock.musicLengthMs = this.audio.musicLengthMs();       // LiveSoundPlayer.GetMusicLength
      this.fx.setUIActive(true);                                   // SetActiveLiveUI
      this.exec.resetFrame();
      return;                                                      // the playing state updates from the next frame
    }
    if (this.state !== "playing") { this.exec.resetFrame(); return; }
    const chartMs = this._chartMs();
    if (chartMs === null) {                                        // no live update this frame
      if (this.state === "ended" && this.chartMs !== null) {       // frames before the music end that were missed
        if (this.clock.musicLengthMs - this.chartMs > LIVE_CATCHUP_MAX_MS) this._voidStep(this.clock.musicLengthMs);
        else this._catchUp(null);
      }
      this.exec.resetFrame();
      return;
    }
    if (this.chartMs !== null && chartMs - this.chartMs > LIVE_CATCHUP_MAX_MS) {
      this._voidStep(chartMs);                                     // a long jump is a seek (after this step)
      return;
    }
    this._catchUp(chartMs);
    const fr = this.exec.update(chartMs, this.loop.deltaTime);
    this.frame = fr;
    this.chartMs = chartMs;
    this.lastSec = this.clock.sec;
    this.notes.update(fr);                                         // LiveAllNoteView.UpdateNoteView
    this.fx.update(fr);                                            // lane / note effects, then LiveUIView
    this.audio.update(fr);                                         // OnUpdateSE, then the finish voice / cheer once
  }

  // this step does not count for the chart side (the seek after it simulates its frame): no view, effect or UI step
  _voidStep(seekMs) {
    this.pendingSeek = seekMs;
    this.voidFrame = true;
    this.fx.frozen = true;
    this.exec.resetFrame();
  }

  // catch-up (see the header): the grid frames lastSec + k x deltaTime inside the music that the chart clock passed
  // before `chartMs` (more than half a frame before it), or, with chartMs null (the music has ended), every grid frame
  // still inside the music; each one simulated as the continuous run's frame would be, without drawing and sounds.
  // The frames of the post-music lead are never missed: its chart time advances by one frame's time per frame (the
  // first lead frame's chart time runs ahead of the music grid by the fraction of a frame the music ended into).
  _catchUp(chartMs) {
    if (this.lastSec === null || this.chartMs === null) return;
    const dt = this.loop.deltaTime, len = this.clock.musicLengthMs, cp = this.clock.chartPositionMs, times = [];
    let s = this.lastSec;
    for (;;) {
      const n = s + dt, m = Math.trunc(n * 1000), t = Math.max(m + cp, 0);   // music ms, chart ms (NormalizeTimeMs)
      if (!(n * 1000 < len) || (chartMs !== null && t > chartMs - dt * 500)) break;
      if (m >= 1 && t > this.chartMs) times.push([t, n]);
      s = n;
      if (times.length > LIVE_CATCHUP_MAX_MS / (dt * 1000) + 2) break;
    }
    if (!times.length) return;
    const fx = times.length <= LIVE_CATCHUP_FX_FRAMES;
    for (const [t, n] of times) {
      const fr = this.exec.update(t, dt);
      this.frame = fr; this.chartMs = t; this.lastSec = n;
      this.notes.update(fr);
      this.notes.updateGradients(dt);
      if (fx) {                                                    // update, DOTween, Animators and particles
        this.fx.update(fr);
        this.loop.tweens.update(dt);
        this.fx.ui.tweens(dt);
        this.fx.animation(dt);
      } else this.fx.uiFrame(fr, dt);
      this.notes.advanceGraph(dt);
      this.exec.resetFrame();
    }
    if (!fx) this.fx.clearEffects();
  }

  // LivePlayingStateNodeBase.Update clock gate; null = no live update this frame. `src`: the music clock (the
  // session's audio; a re-simulation passes its own game clock), `dt`: the frame's deltaTime.
  _chartMs(src = this.audio, dt = this.loop.deltaTime) {
    const c = this.clock;
    const playing = src.isPlayingMusic();
    let t;
    if (playing) {
      t = src.musicTimeMs();                                       // (int) GetMusicSyncTimeMillSeconds
      c.lastMs = t;
      c.hasMusicEverPlayed = true;
      c.sec = src.musicSec ? src.musicSec() : t / 1000;            // the music position, unrounded
    } else {
      if (!c.hasMusicEverPlayed) return null;
      const lead = Math.max(0, -c.chartPositionMs);
      if (lead < 1) { this.state = "ended"; return null; }         // ShouldContinueUpdateAfterMusicStop false
      const b = c.postMusicBufferMs + lead;
      // the lead is used up: the chart time has stopped at the music length + lead (see the header)
      if (c.postMusicElapsedMs >= b) { this.state = "ended"; return null; }
      if (b >= 1 && c.postMusicElapsedMs < b) c.postMusicElapsedMs = F(F(F(dt) * 1000) + c.postMusicElapsedMs);   // float
      t = Math.trunc(Math.min(c.postMusicElapsedMs, b)) + c.musicLengthMs;
      c.sec = t / 1000;
    }
    if (t < 1) return null;
    const ms = Math.max(c.offsetMs + t + c.chartPositionMs, 0);   // NormalizeTimeMs
    if (this.hold !== null) {                                      // the state already is that of chart time hold
      if (ms <= this.hold) return null;
      this.hold = null;
    }
    return ms;
  }

  // The chart time the next frame of a re-simulation reaches: _chartMs of the frame after `clk` advances by `dt`,
  // without changing any state; null: the frame has no live update; Infinity: the frame ends the chart. In the
  // post-music lead (ChartPosition > 0) the chart time follows the float32 elapsed time, not the game clock.
  _nextChartMs(clk, len, dt) {
    const c = this.clock, n = clk.sec + dt;                        // LiveGameClock.advance
    let t;
    if (n * 1000 < len) t = Math.trunc(n * 1000);                  // isPlaying, timeMs
    else {
      if (!c.hasMusicEverPlayed) return null;
      const lead = Math.max(0, -c.chartPositionMs), b = c.postMusicBufferMs + lead;
      if (lead < 1 || c.postMusicElapsedMs >= b) return Infinity;
      const e = b >= 1 && c.postMusicElapsedMs < b ? F(F(F(dt) * 1000) + c.postMusicElapsedMs) : c.postMusicElapsedMs;
      t = Math.trunc(Math.min(e, b)) + c.musicLengthMs;
    }
    if (t < 1) return null;
    return Math.max(c.offsetMs + t + c.chartPositionMs, 0);
  }

  // Drawing buffer size in pixels (Screen.width x Screen.height: the render targets follow it), applied by the next
  // render(): the canvas is resized and drawn in the same task, so a resize never shows a cleared canvas.
  resize(width, height) {
    this._wantSize = { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
  }

  // the size asked for: canvas of the context (when it differs) and render targets
  _applySize() {
    const { w, h } = this._wantSize, c = this.gl.canvas;
    if (this.size && this.size.w === w && this.size.h === h && (!c || (c.width === w && c.height === h))) return;
    if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    this.renderer.resize(w, h);
    this.size = { w, h };
  }

  // draws the current state
  render() {
    this._applySize();
    this.stage.submit(this.renderer);
    this.notes.submit(this.renderer);
    this.fx.submit(this.renderer);
    this.renderer.render();
  }

  // One frame of game time (1/60 s x speed): the loop step, drawn unless draw is false. The caller paces the steps
  // (ChartPlayer: requestAnimationFrame, at most 4 steps per animation frame, drawing only the last). No step may run
  // while paused or busy (a seek or a step in progress).
  async step({ draw = true } = {}) {
    if (this.disposed) throw new Error("ChartSession: disposed");
    this._noDraw = !draw;
    try { await this._step(); } finally { this._noDraw = false; }
    if (this.state === "ended") await this.audio.suspend();       // the end of the chart (see the header)
  }

  // one loop step; seek and the controls wait for a step in progress
  async _step() {
    this._stepping = this.loop.step();
    try { await this._stepping; } finally { this._stepping = null; this.voidFrame = false; this.fx.frozen = false; }
    if (this.pendingSeek !== null) {                               // a chart clock jump longer than the catch-up
      const t = this.pendingSeek;
      this.pendingSeek = null;
      await this.seek(t);
    }
  }

  // Direct start: the start request and the intro timeline run to its end without drawing (and without the intro's
  // sounds); the session then stays at the end of the intro (state start) until play().
  async _prepare() {
    this.holdStart = true; this.startRequested = true;
    const skip = this.skipRender;
    this.skipRender = true;
    try {
      for (let n = 0; this.state !== "start"; n++) {
        if (n > 60 * 60) throw new Error("the intro timeline did not end");
        await this._step();
      }
    } finally { this.skipRender = skip; }
  }

  get started() { return this.state === "playing" || this.state === "ended"; }
  get ended() { return this.state === "ended"; }
  get playing() { return !this.paused && !this.holdStart && this.state !== "ended"; }
  get busy() { return this.seeking || !!this._stepping; }
  get speed() { return this.loop.timeScale; }
  get musicOn() { return this.audio.musicOn; }
  get seOn() { return this.audio.seOn; }
  get audioAvailable() { return this.audio.available; }
  get audioContext() { return this.audio.sm.ctx; }
  // chart metadata of the manifest (title, bands, level, notes, durationMs, ...) or null
  get chart() { return (this.assets.info && this.assets.info.chart) || null; }
  // the Live options in effect (frozen, by name; settings.js)
  get settings() { return this._settings; }
  // every Live option with its default, value, range and the values this chart offers (settings.js liveOptionItems)
  optionItems() { return liveOptionItems(this.optionContext, this._settings); }
  durationMs() { return this.audio.musicLengthMs(); }
  positionMs() { return this.started && this.chartMs !== null ? this.chartMs : 0; }

  // play / resume (call from a user gesture: it resumes the AudioContext); at the end of the chart: from the start
  async play() {
    if (this.disposed) throw new Error("ChartSession: disposed");
    const resumed = this.audio.resume();
    if (this.state === "ended") await this.seek(0);
    this.holdStart = false;
    await resumed;
    await this.audio.resume();                                     // again: a seek suspends the audio
    this.hold = this.chartMs;
    this.paused = false;
  }

  async pause() {
    if (this.paused) return;
    this.paused = true;
    if (this._stepping) await this._stepping;
    await this.audio.suspend();
    if (this.started) this.render();                               // the state the session stopped at
  }

  setSpeed(r) {
    if (!(r > 0) || !Number.isFinite(r)) throw new RangeError(`speed ${r}`);
    this.loop.timeScale = r;
    this.audio.setRate(r);
    this.hold = this.chartMs;
  }

  setMusic(on) {
    this.audio.setMusic(!!on, this._musicSec());
    this.hold = this.chartMs;
  }

  setSe(on) { this.audio.setSe(!!on); }

  // the music position the chart has reached (the game clock's own value when the music is off)
  _musicSec() {
    if (!this.audio.musicOn && this.audio.musicStarted) return this.audio.game.sec;
    return this.chartMs === null ? 0 : (this.chartMs - this.clock.chartPositionMs) / 1000;
  }

  // Changes Live options (by name; the others keep their values, or their defaults with reset). Resolves to the
  // names changed. See the header for how each kind applies; an option that selects other files raises a
  // LiveSettingsError with `reload` true (ChartPlayer creates a new session for it).
  async setSettings(values = {}, { reset = false } = {}) {
    if (this.disposed) throw new Error("ChartSession: disposed");
    const ctx = this.optionContext, prev = this._settings;
    const next = ctx.resolve(values || {}, reset ? null : prev);
    const ch = liveSettingsChanges(prev, next);
    if (ch.reload.length) {
      const e = new LiveSettingsError(`${ch.reload.join(", ")}: select other files; a new session is needed`);
      e.reload = true; e.settings = next;
      throw e;
    }
    const changed = [...ch.none, ...ch.live, ...ch.noteSe, ...ch.boot];
    if (!changed.length) return changed;
    if (this._seekRun) await this._seekRun.catch(() => {});
    if (this._stepping) await this._stepping;
    this._settings = next;
    this.derived = liveDerived(ctx, next);
    if (ch.live.length) this.audio.setCategoryVolumes(liveCategoryVolumes(ctx, next));
    if (ch.noteSe.length) this.audio.setNoteSe(liveNoteSeMaps(ctx, next) || this.audio.data.noteSe);
    const has = (names) => ch.boot.some((n) => names.includes(n));
    this.renderer.settings = next;
    if (has(["LaneOpacity", "GuidelineOpacity", "GuidelineCount"])) this.stage.lane.configure(next);
    if (has(["BackgroundBrightness"])) this.renderer.canvas.configure(next);
    if (has(["SlideOpacity", "GuideOpacity"])) this.notes.setLineOpacity(next);
    if (has(["MeasureLineDisplay"]) && next.MeasureLineDisplay) await this.notes.loadBarLineTexture();
    if (ch.boot.some((n) => LIVE_RESTART.has(n))) await this._restart();
    if (this.paused && !this.disposed) this.render();              // the state the session stays at
    return changed;
  }

  // the chart state of a live booted with the current settings, at the current chart time (setSettings)
  async _restart() {
    if (!this.started) {                                           // at the chart start: nothing simulated yet
      this.exec = new LiveExecutor(this.score, this.noteAssets.settings, this.derived);
      this.notes.configure(this._settings, this.exec.D);
      this.fx.resetUI(this._settings);
      for (const d of this.preDts) this.fx.uiFrame(null, d);
      this.clock.chartPositionMs = this.derived.chartPositionMs;
      return;
    }
    await this.seek(this.positionMs(), { restart: true });
  }

  // Seek to chart time `ms`: the chart-side state of the last frame at or before `ms` on the music-off clock's grid
  // (see the header). Resolves to the chart time reached. restart: from the music start with the current settings
  // (setSettings) even when `ms` is ahead.
  async seek(ms, { restart = false } = {}) {
    if (this.seeking) return this.positionMs();
    this.seeking = true;
    let suspended = false;
    const run = (async () => {
      if (this._stepping) await this._stepping;
      if (this.state === "start") {                                // the music start frame first (as play() would)
        this.holdStart = false;
        const skip = this.skipRender; this.skipRender = true;
        try { await this._step(); } finally { this.skipRender = skip; }
      }
      if (!this.started) return;
      await this.audio.suspend();                                  // no sound while the state is re-simulated
      suspended = true;
      const len = this.durationMs(), dt = this.loop.stepDelta();
      // the end of the chart: a seek to the music length or beyond; a restart of an ended session. A restart keeps
      // its chart time as it is (with ChartPosition < 0 the chart runs past the music length).
      const want = Math.max(0, Math.round(ms));
      const toEnd = restart ? this.state === "ended" : want >= len;
      const target = restart ? want : Math.min(len, want);
      let sec;
      if (restart || this.chartMs === null || target < this.chartMs || this.state === "ended") {
        this._resetChart(len, restart);
        sec = 0;
      } else sec = this.lastSec ?? (this.chartMs - this.clock.chartPositionMs) / 1000;   // forward: from the last update
      const clk = new LiveGameClock(sec);
      const src = { isPlayingMusic: () => clk.isPlaying(len), musicTimeMs: () => clk.timeMs() };
      this.hold = null;
      for (let n = 1; this.state === "playing"; n++) {
        // stop before the frame whose chart time is past the target (or that ends the chart); at the end: until the
        // chart ends
        if (!toEnd && this._nextChartMs(clk, len, dt) > target) break;
        this._simFrame(clk, src, dt);
        if (n % 1200 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      this.notes.sampleArrows();
      this.fx.clearEffects();
      this.audio.seek(clk.sec, !!(this.frame && this.frame.finishedAllNoteUpdate));
      this.hold = this.chartMs;
    })();
    this._seekRun = run;
    try {
      await run;
    } finally {
      this._seekRun = null;
      if (suspended && !this.paused && this.state !== "ended") await this.audio.resume();
      this.seeking = false;
    }
    if (this.paused && this.started) this.render();
    return this.positionMs();
  }

  // the state at the music start frame: new executor, note views released, live UI as after load plus the UI's
  // DOTween / Animator steps of every frame up to the music start, clock gate reset. reconfigure: the note views and
  // the live UI take the current settings (setSettings)
  _resetChart(len, reconfigure = false) {
    this.exec = new LiveExecutor(this.score, this.noteAssets.settings, this.derived);
    if (reconfigure) this.notes.configure(this._settings, this.exec.D); else this.notes.reset();
    this.fx.resetUI(reconfigure ? this._settings : undefined);
    for (const d of this.preDts) this.fx.uiFrame(null, d);
    this.clock = { lastMs: -1, hasMusicEverPlayed: false, offsetMs: 0, chartPositionMs: this.derived.chartPositionMs,
                   postMusicBufferMs: 0, postMusicElapsedMs: 0, musicLengthMs: len };
    this.frame = null; this.chartMs = null; this.lastSec = null; this.state = "playing";
  }

  // one playing frame of the chart-side state, in the frame's order: music clock, clock gate, LiveExecutor.Update, note
  // views, live UI (update, DOTween, Animator), flick graph time
  _simFrame(clk, src, dt) {
    clk.advance(dt);
    const chartMs = this._chartMs(src, dt);
    let fr = null;
    if (chartMs === null) this.exec.resetFrame();
    else {
      fr = this.exec.update(chartMs, dt);
      this.frame = fr; this.chartMs = chartMs; this.lastSec = clk.sec;
      this.notes.update(fr);
    }
    this.notes.updateGradients(dt);
    this.fx.uiFrame(fr, dt);
    this.notes.advanceGraph(dt);
  }

  // Releases the session: waits for a step or seek in progress, stops and disconnects every sound, closes the
  // AudioContext if the session created it, deletes the GL objects it created and drops its state. The context and
  // its canvas stay the caller's.
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.paused = true;
    try { if (this._seekRun) await this._seekRun; } catch (_) { /* reported by seek */ }
    try { if (this._stepping) await this._stepping; } catch (_) { /* reported by step */ }
    if (this.loop) this.loop.cancelDelays();
    const sm = this.audio && this.audio.sm;
    if (sm) {
      sm.stopAll(SOUND_CATEGORY.All);
      for (const b of Object.values(sm.buses)) b.disconnect();
      for (const b of sm.catBuses.values()) b.disconnect();
      if (sm.ownsContext && typeof sm.ctx.close === "function" && sm.ctx.state !== "closed") await sm.ctx.close();
    }
    if (this.gl) {
      // the LightWeight background's copy program is kept per context between builds
      if (LiveLightWeightBackground._prog && LiveLightWeightBackground._prog.gl === this.gl) LiveLightWeightBackground._prog = null;
      if (this._gl) this._gl.release();
      unbindAssets(this.gl, this.assets);
    }
    for (const k of ["renderer", "stage", "notes", "fx", "exec", "audio", "frame", "clock", "live", "score", "noteAssets",
                     "loop", "preDts", "_gl"]) this[k] = null;
  }
}

// boot options whose change restarts the chart state (read by the simulation, the note views' spawn state or the live
// UI's state); the other boot options are constants of a draw
const LIVE_RESTART = new Set(["NoteSpeed", "NoteTiming", "ChartPosition", "JudgePosition", "SimultaneousLineDisplay",
                              "MeasureLineDisplay", "ComboCountDisplay", "ContinuationEffectDisplay",
                              "JudgeResultPositionType"]);
for (const n of LIVE_RESTART) if (!LIVE_OPTION_BY_NAME.has(n)) throw new Error(`live option ${n} missing`);
