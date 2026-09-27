import { bindAssets, unbindAssets } from "../data/assets.js";
import { Audio } from "../engine/audio.js";
import { ShaderLib } from "../engine/glsl.js";
import { trackGL } from "../engine/gltrack.js";
import { PlayerLoop } from "../engine/loop.js";
import { Transform } from "../engine/math.js";
import { UnityRandom } from "../engine/random.js";
import { Live2DCharacter } from "../live2d/character.js";
import { cubismCore } from "../live2d/cubism.js";
import { motionSyncCore } from "../live2d/motionsync.js";
import { AdvBackgroundField, AdvCamera, AdvCharacterField, AdvFieldRendererManager, AdvGlobalVolume, AdvQuality } from "./field.js";
import { ADV_PLAYBACK_MODE, STORY_FRAME_RATE, StoryCommandError, checkStoryUI, createStoryContext } from "./interfaces.js";
import { storyModels } from "./models.js";
import { StoryCharacters, StoryPlayerCore } from "./player-core.js";
import { STORY_LANGUAGES, advViewport, storyLines, storyStart } from "./params.js";
import { speakerName } from "./commands/talk.js";
import { StoryRenderer } from "./renderer.js";
import { SilentAudio } from "./silent-audio.js";
import { SimpleStorySession } from "./simple/session.js";
import { AdvStageData } from "./stage.js";
import { disposeStoryFeatures, installStoryFeatures, setStoryFeaturesSpeed } from "./features/index.js";
import { StoryUI } from "./ui.js";
import { AnimRecords } from "./features/clips.js";
import { resumeCurrentVideoIfNeeded, seekStoryVideo, storyVideo, storyVideoPosition,
         tryPauseCurrentVideo } from "./features/video.js";

// StorySession: one story episode (ADV) of the game played on a WebGL2 context, or headless with gl = null (Node:
// tests, read sets). It has no DOM access: the caller calls step() at 30 steps per second of game time (StoryPlayer
// drives it with requestAnimationFrame) and render() as needed.
//
// Game flow reproduced:
//   load    AdvEpisodeResourceLoader.Preload: the episode's cue sheets, the Character rows' models (Init, Warmup, the
//           hide that ends it; the player loop runs meanwhile, as the game warms characters up while loading; the
//           models are read as models.js describes), the stages with their particle groups; the talk window. An
//           Overlay episode is played by SimpleStorySession (the game's SimpleAdvPlayer); an episode with a command,
//           stage feature, talk window or text this player does not reproduce is refused before its characters load.
//   play    AdvPlayer.Play (player-core.js): the initialize rows, the episode's rows, the finalize rows; auto or manual
//           advance, the playback speed, the shortcut (start at a line).
//   frames  AdvPlayer.OnUpdate (the sound manager, the character controllers, the motion waits), the Animators,
//           OnLateUpdate, CubismModel.OnModelUpdate and the volume update in Unity's phase order at 30 fps; the UI's own
//           updates after them.

export { STORY_FRAME_RATE, STORY_LANGUAGES, advViewport, storyLines };

const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// every text the episode can show: the Talk lines and their speaker names, the Location captions, the title
export const storyTexts = (episode, player, masterIds, localize, titleTextId = 0) => {
  const p = { ctx: { settings: { player, masterIds }, localize } }, out = new Set();
  for (const c of episode.commands) {
    if (c.IgnoreData) continue;
    if (c.cmd === "Talk" && c.AdvTextID && c.AdvTextID !== "0") { out.add(localize(c.AdvTextID)); out.add(speakerName(c, p)); }
    else if (c.cmd === "Location") out.add(localize(c.AdvTextID || (c.TargetTextIDs || [])[0]));
  }
  if (titleTextId) out.add(localize(titleTextId));
  out.delete("");
  return [...out];
};

export class StorySession {
  constructor() {
    this.disposed = false;
    this.gl = null; this.assets = null; this.loop = null; this.core = null; this.ui = null; this.audio = null;
    this.renderer = null; this.error = null; this.ended = false; this.endReason = null;
    this.speaker = ""; this.text = "";
    this._stepping = null; this._draw = true; this._gl = null; this._started = null; this._dialogVideo = false;
  }

  // gl: WebGL2RenderingContext, or null (headless: nothing is drawn, the UI and the characters still run)
  // store: the AssetStore of the story (the union of the manifest's common files and one language group)
  // opts:
  //   lang         "ja" "en" "zh-Hant" "zh-Hans" "ko" (default: the manifest's language, else ui/languages.json's)
  //   quality      BaseQualityMode 0 (Worst) .. 4 (Best, default); the game's quality option gives Best 4, High 3,
  //                Middle 2 (STORY_QUALITY)
  //   filmGrain    multiplier of the film grain's intensity (1: the game's; default 0, no film grain)
  //   seed         seed of UnityEngine.Random (eye blinks, pseudo lip sync) (default: from the clock); random: a
  //                UnityRandom instead
  //   auto         auto mode (default false: the game's fresh-profile preference); speed: AdvPlaybackSpeed 10
  //                (default), 15, 17, 20
  //   line         start at this line (the game's shortcut to it), default 0
  //   row          start at the row of this Index instead (the shortcut to it; the lines before it count as shown)
  //   voice        false: no voices (AdvPlaybackSession.WithVoice); default true
  //   sound        false: no Web Audio (SilentAudio keeps the timing); default: Web Audio when available
  //   audioContext an AudioContext to play into (default: an own one at 48 kHz, closed on dispose)
  //   title        false: the episode title is not shown
  //   autoplay     start playing as soon as the story is loaded (in the frame the loading ends)
  //   ui           (gl, loop, parts) -> StoryUI, instead of the story UI (ui.js)
  //   audio        (resolve, loop, {assets}) -> SoundManager, instead of Audio / SilentAudio
  //   onCommand(c), onLine({index, row, speaker, text}), onEnded({reason}), onLoaded() (in the frame the loading ends)
  //   onLog({row, speaker, text, voiceIds})  a talk log entry (Talk, Location, subtitles, chat; the lines skipped by
  //                the shortcut too)
  //   width, height  drawing buffer size (default: the canvas size)
  // An Overlay episode (playbackMode 1) returns a SimpleStorySession (simple/session.js: the game's SimpleAdvPlayer
  // in its host screen), with the same interface.
  static async create(gl, store, opts = {}) {
    if (store && SimpleStorySession.isSimpleStory(store)) return SimpleStorySession.create(gl, store, opts);
    const s = new StorySession();
    try {
      await s._load(gl, store, opts);
    } catch (e) {
      await s.dispose().catch(() => {});
      throw e;
    }
    return s;
  }

  // the facts a page can check before creating a session: the commands the episode executes, and the unsupported ones
  static requirements(store) {
    if (SimpleStorySession.isSimpleStory(store)) return SimpleStorySession.requirements(store);
    const story = store.json("story.json"), episode = store.json(story.episode), scene = store.json(story.scene);
    const commands = StoryPlayerCore.requiredCommands(episode, scene.settings.playerSettings);
    return { commands, unsupported: commands.filter((c) => !StoryPlayerCore.supportedCommands().includes(c)) };
  }

  async _load(gl, store, opts) {
    if (!store) throw new Error("StorySession: an AssetStore is required");
    this.gl = gl || null; this.assets = store; this.opts = opts;
    const story = this.story = store.json("story.json");
    const episode = this.episode = store.json(story.episode);
    const scene = store.json(story.scene);
    const P = scene.settings.playerSettings;
    const what = `story ${episode.advId ?? story.advId}`;
    const mode = episode.master ? episode.master._playbackMode || 0 : 0;
    StoryPlayerCore.checkEpisode(episode, P, what);
    this.playbackMode = mode;
    const langDoc = store.has("ui/languages.json") ? store.json("ui/languages.json") : null;
    const info = store.info || {};
    const lang = this.lang = opts.lang || info.loadedLanguage || info.language || (langDoc && langDoc.language) || "ja";
    if (langDoc && langDoc.language !== lang) throw new Error(`${what}: the loaded language is ${langDoc.language}, not ${lang}`);
    const field = langDoc ? langDoc.field : STORY_LANGUAGES[lang];
    if (!field) throw new Error(`${what}: unknown language ${lang}`);
    // LocalizeManager.GetLocalizedText over the episode's text table and the title
    const titleTextId = opts.title === false || !episode.master ? 0 : episode.master._titleTextId || 0;
    const localize = (id) => {
      const r = episode.text[id];
      if (r) return r[field] ?? "";
      if (titleTextId && String(id) === String(titleTextId) && episode.title) return episode.title[field] ?? "";
      console.warn(`${what}: text ${id} missing`);
      return "";
    };

    await cubismCore();
    const motionSync = await motionSyncCore().catch(() => null);        // without it lip sync is reported missing
    if (gl) { bindAssets(gl, store); this._gl = trackGL(gl); }
    const loop = this.loop = new PlayerLoop(STORY_FRAME_RATE);
    const quality = this.quality = new AdvQuality(opts.quality ?? 4, P);
    this.seed = opts.seed ?? (Date.now() >>> 0);
    const random = opts.random || new UnityRandom(this.seed);        // UnityEngine.Random: one state for all

    // the scene objects under the AdvManager transform (identity)
    const manager = new Transform("AdvManager");
    const camNode = scene.cameraManager.nodes.find((n) => n.path === "CameraManager/MainCamera");
    if (!camNode) throw new Error(`${what}: scene.json has no CameraManager/MainCamera`);
    const sc = this.scene = {
      camera: new AdvCamera(loop, camNode),
      field: new AdvCharacterField(loop, scene.characterField, manager),
      background: new AdvBackgroundField(scene.backgroundField, manager),
      volume: new AdvGlobalVolume(scene.globalVolume, quality),
      fieldRenderer: new AdvFieldRendererManager(loop, quality),
      stageData: new Map(),
      postTextures: scene.postTextures[scene.shaders.cameraRenderers[0]],
      session: null,
    };
    for (const [name, prefab] of Object.entries(scene.stages)) {
      const st = new AdvStageData(prefab);                            // refuses stage features not reproduced
      st.prefab.root.setParent(manager);
      sc.stageData.set(name, st);
    }
    AdvStageData.resolveShared([...sc.stageData.values()]);

    // per-frame hooks in Unity phase order, before the UI's own: AdvPlayer.OnUpdate runs the character controllers,
    // then UIAdvWidget.OnUpdate (the motion waits run on the playback's own UniTask loop: StoryPlayerCore.play)
    const characters = this.characters = new StoryCharacters();
    let audio = null;
    loop.on("update", () => {
      audio.update();
      for (const ch of characters.values()) ch.update();
    });
    loop.on("animation", () => { for (const ch of characters.values()) ch.animatorUpdate(); });
    loop.on("lateUpdate", () => { for (const ch of characters.values()) ch.lateUpdate(); });
    loop.on("preLateEnd", () => { for (const ch of characters.values()) ch.modelUpdate(); });
    loop.on("postLate", () => sc.volume.postLateUpdate());

    // the UI; its talk windows and every text the episode shows are checked before the rest loads
    const uiDoc = store.json(story.ui);
    const fonts = store.has("ui/fonts.json") ? store.json("ui/fonts.json") : null;
    const parts = { assets: store, dir: dirname(story.ui), lang, fonts, language: langDoc };
    const ui = this.ui = checkStoryUI(opts.ui ? opts.ui(gl, loop, parts) : new StoryUI(gl, loop, uiDoc, parts));
    if (Array.isArray(ui.talkWindows)) {
      const names = episode.commands.filter((c) => c.cmd === "TalkWindow" && !c.IgnoreData).map((c) => c.TargetAssetName);
      const missing = [...new Set(names.filter((n) => !ui.talkWindows.includes(n)))];
      if (missing.length) throw new StoryCommandError(`${what}: talk windows not supported by this player: ${missing.join(", ")}`);
    }
    if (typeof ui.checkTexts === "function")
      ui.checkTexts(storyTexts(episode, P, scene.settings.masterIdSettings, localize, titleTextId));
    // UIAdvWidget.Init and SetLetterBoxSprite (AdvPlayer.Init): UpdateLetterBoxBands for the screen at load (the
    // drawing buffer size of the options, else the canvas size), before StartPlayTask fades the bands in
    if (gl && typeof ui.updateLetterBoxBands === "function") {
      const c = gl.canvas, w = Math.max(1, Math.round(opts.width || (c ? c.width : 300)));
      const h = Math.max(1, Math.round(opts.height || (c ? c.height : 150)));
      ui.updateLetterBoxBands({ screenWidth: w, screenHeight: h, viewport: advViewport(w, h) });
    }

    // the sound manager with every cue of the episode ready; a story without its sound files (story.json `audio`
    // empty) plays no sound, with the voices off as in the game without voice data (Session.WithVoice false: the
    // lines advance by their length, the speakers get the timed pseudo lip sync)
    const resolve = Audio.episodeResolver(episode);
    const hasSounds = !!story.audio && Object.keys(story.audio).length > 0;
    const webAudio = hasSounds && opts.sound !== false && typeof globalThis.AudioContext === "function";
    audio = this.audio = opts.audio ? opts.audio(resolve, loop, { assets: store })
      : webAudio ? new Audio(resolve, loop, { context: opts.audioContext || null, assets: store })
        : new SilentAudio(resolve, loop, { assets: store, sounds: hasSounds });
    await audio.preload(Object.keys(episode.sounds).map(Number));

    // renderer and characters: the Character rows' preload, keyed TargetName-TargetAssetIndex (the first model of a
    // key is kept); IgnoreData rows are not preloaded. The story's shaders draw the stage and the post-processing,
    // each model's own shaders its character (the story's in a story of manifest format /1, models.js).
    const storyLib = gl ? new ShaderLib(gl, "shaders", store) : null;
    const renderer = this.renderer = gl ? new StoryRenderer(gl, storyLib, sc, quality, loop, { assets: store }) : null;
    if (renderer) renderer.filmGrain = opts.filmGrain ?? 0;
    const modelOf = storyModels(gl, store, story, what, { lib: storyLib, resources: scene.resources });
    for (const c of episode.commands) {
      if (c.cmd !== "Character" || c.IgnoreData) continue;
      if (characters.has(c.TargetName, c.TargetAssetIndex || 0)) continue;
      const { model, lib } = modelOf(`Character/Live2D/${c.TargetAssetName}`);
      const ch = new Live2DCharacter(store.json(model.prefab), store.arrayBuffer(model.moc3), loop, { random, motionSync });
      ch.setParent(sc.field.poolRoot);
      sc.field.characterRoots.add(ch.root);
      characters.add(c.TargetName, c.TargetAssetIndex || 0, ch);
      if (renderer) renderer.addCharacter(ch, { lib, dir: model.textureDir, resources: model.resources });
    }
    if (renderer) await renderer.load("");
    await ui.load();

    // the interpreter
    const ctx = this.ctx = createStoryContext({
      loop, camera: sc.camera, field: sc.field, background: sc.background, fieldRenderer: sc.fieldRenderer,
      volume: sc.volume, characters, stages: sc.stageData, ui, audio, quality,
      settings: { player: P, masterIds: scene.settings.masterIdSettings }, localize, lang, playbackMode: mode,
      titleTextId, episode, story, assets: store, renderer, gl: this.gl });
    this.lines = storyLines(episode);
    const { line, shortCutIndex } = storyStart(episode, { line: opts.line, row: opts.row });
    const core = this.core = new StoryPlayerCore(ctx, {
      auto: !!opts.auto, speed: opts.speed || 10, shortCutIndex,
      onCommand: opts.onCommand || null,
      onLine: (e) => { this.speaker = e.speaker; this.text = e.text; if (opts.onLine) opts.onLine(e); },
      onLog: opts.onLog || null,
      onError: (e) => { if (!this.error) this.error = e; },
      onSpeed: (rate) => setStoryFeaturesSpeed(ctx, rate),
    });
    core.lineIndex = line - 1;
    if (opts.voice === false || (!hasSounds && !opts.audio)) core.session.withVoice = false;
    sc.session = core.session;
    // AdvStage.Init: the stages' particle groups (before the features load, so that their materials load too)
    const stages = [...sc.stageData.values()];
    const records = stages.some((st) => st.hasParticleEffects) ? new AnimRecords(scene, StoryCommandError) : null;
    for (const st of stages) st.initParticleGroups(ctx, records);
    await installStoryFeatures(ctx, core, { random });                   // the feature modules' per-episode setup
    loop.on("render", () => this._renderHook());

    // load: Init + Warmup (standby) + hide per character, with the loop running; then the loader's settings
    let done = false, error = null;
    const loaded = (async () => {
      await Promise.all([...characters.values()].map((ch) => ch.load()));
      for (const ch of characters.values()) {
        ch.setLightingEnabled(mode === ADV_PLAYBACK_MODE.Normal); ch.setMultiplyTexture(null);
      }
      sc.volume.markUpdateOnce();                                       // WarmupPresentationAsync
      if (opts.onLoaded) opts.onLoaded();
      if (opts.autoplay) this._run();
    })().then(() => { done = true; }, (e) => { error = e; done = true; });
    this._draw = false;
    for (let n = 0; !done; n++) {
      if (n > 20 * STORY_FRAME_RATE) throw new Error(`${what}: the character warmup did not finish`);
      await loop.step();
    }
    await loaded;
    this._draw = true;
    if (error) throw error;
  }

  _run() {
    if (this._started) return this._started;
    this._started = this.core.play().then((reason) => {
      this.ended = true; this.endReason = reason;
      if (this.opts.onEnded) this.opts.onEnded({ reason });
    }, (e) => { if (!this.error) this.error = e; });
    return this._started;
  }

  // ------------------------------------------------------------------------------------------------ state
  get time() { return this.loop.time; }
  get frame() { return this.loop.frameCount; }
  get line() { return this.core.lineIndex; }
  get lineCount() { return this.lines.length; }
  get isAuto() { return this.core.isAutoPlay; }
  get speed() { return this.core.playbackSpeed; }
  get started() { return !!this._started; }
  get busy() { return !!this._stepping; }
  // the video a Movie or Clip row plays: {kind: "movie" | "clip", time, duration, seekable} (seconds), else null
  get video() { return this.ctx ? storyVideoPosition(this.ctx) : null; }

  // ------------------------------------------------------------------------------------------------ requests
  // starts the episode at the next frame's Update (the UniTask timing a command resumes at)
  play() {
    if (this._started) return;
    this._started = this.loop.yield("Update").then(() => { this._started = null; return this._run(); });
  }

  tap() { this.core.tap(); }
  // the story menu's Auto and Fast-forward buttons (turning auto off resets the speed to x1; a speed other than x1
  // turns auto on, x1 brings the player's auto choice back)
  setAuto(on) { this.core.pressAuto(!!on); }
  setSpeed(speed) { this.core.pressFastForward(speed); }
  skip() { this.core.stop(1); }
  // user volume of a sound category ("Bgm", "Se", "Voice"): the option volume ("<Cat>Config"), 0..1; "Movie": the
  // movie sound volume of the videos (no category, no option of the app's; 1 by default)
  setVolume(category, v) {
    if (category === "Movie") { if (this.audio.setMovieVolume) this.audio.setMovieVolume(v); return; }
    if (this.audio.setOptionVolume) this.audio.setOptionVolume(category, v);
  }
  // the host's pause (no step runs meanwhile): the videos hold too, their sound with them
  setPaused(on) { const v = this.ctx && storyVideo(this.ctx); if (v) v.setHeld(on); }
  // The host's fast-forward: steps without drawing until done() says so (asked before each step), the episode ends or
  // the session is disposed. Meanwhile the sound is muted and ends by game time (Audio.setFastForward) and the videos
  // hold; it awaits pause() after every budgetMs of steps (the page stays responsive). Then the sounds and the playing
  // video are placed at the time reached, and the videos hold while paused() says so. Drawing reads the state and
  // changes none of it, so the state reached is the state of the same steps played. -> the number of steps
  async fastForward(done, { budgetMs = 12, pause = () => new Promise((r) => setTimeout(r, 0)), paused = () => false } = {}) {
    const v = this.ctx && storyVideo(this.ctx), audio = this.audio;
    if (audio && audio.setFastForward) audio.setFastForward(true);
    if (v) v.setHeld(true);
    let n = 0, t0 = performance.now();
    try {
      while (!this.disposed && !this.ended && !done()) {
        await this.step({ draw: false });
        n++;
        if (performance.now() - t0 >= budgetMs) { await pause(); t0 = performance.now(); }
      }
    } finally {
      if (!this.disposed) {
        if (audio && audio.setFastForward) audio.setFastForward(false);
        const cur = v && v.current;
        if (cur && cur.source && cur.isPlaying()) cur.seekTo(cur.time);
        if (v) v.setHeld(paused());
      }
    }
    return n;
  }
  // The host's seek within a clip: fast-forwards until the clip of the Clip row `row` (default: the row the session
  // started at, option `row`) has played target() seconds (read before each step), as if played: every row, the
  // Delay rows on the clip's frames, the subtitles, the sounds' timing. In a session started at that row the clip
  // comes after the shortcut; in one already playing it, the seek goes on from its time. It stops when target() falls
  // behind the time reached (a seek back: the caller starts again at the row), when the clip ends or stops first, or
  // when the session is disposed. Options as fastForward. -> {time, back}: the clip's time reached (null: it did not
  // play)
  async fastForwardClip(target, { row = this.opts.row, ...opts } = {}) {
    const v = this.ctx && storyVideo(this.ctx);
    if (!v || row == null) return { time: null, back: false };
    const fps = STORY_FRAME_RATE, from = this.frame;
    let clip = null, back = false;
    this.play();
    await this.fastForward(() => {
      const cur = v.current, want = target();
      if (!clip && cur && cur.row === row && v.flow.clipVideoPlaying) clip = cur;
      if (!clip) return this.frame - from > fps * (10 + want);               // the clip did not come
      if (want < clip.time - 1e-6) { back = true; return true; }
      return clip.time >= want - 1e-6 || v.current !== clip || clip.isPlayFinished();   // reached, or it ended first
    }, opts);
    return { time: clip ? clip.time : null, back };
  }
  // the skip confirmation of the story menu: open, the playback waits (AdvPlayer.OnOpenDialog -> Model.SetPause) and a
  // playing video pauses (OnSkipButtonTapped -> TryPauseCurrentVideo); closed, the playback goes on and, unless the
  // skip was confirmed (resume false: the stop follows), so does the video (OnConfirmDialogButtonTapped ->
  // ResumeCurrentVideoIfNeeded)
  setDialogOpen(open, resume = true) {
    if (!this.core) return;
    this.core.isPause = !!open;
    if (open) { this._dialogVideo = this._dialogVideo || tryPauseCurrentVideo(this.ctx); return; }
    if (resume) resumeCurrentVideoIfNeeded(this.ctx, this._dialogVideo);
    this._dialogVideo = false;
  }
  // moves the playing movie to `sec` seconds of it (a seek of the host's; the game has none): the rows after a Movie
  // row wait for its end alone. -> a promise of false when no video can be seeked now (`video.seekable`)
  seekVideo(sec) { return this.ctx ? seekStoryVideo(this.ctx, sec) : Promise.resolve(false); }

  // ------------------------------------------------------------------------------------------------ frames
  // One frame of game time (1/30 s), drawn unless draw is false. No step may start while one runs.
  async step({ draw = true } = {}) {
    if (this.disposed) throw new Error("StorySession: disposed");
    if (this._stepping) throw new Error("StorySession: a step is in progress");
    if (this.error) throw this.error;
    this._draw = draw;
    this._stepping = this.loop.step();
    try { await this._stepping; } finally { this._stepping = null; this._draw = true; }
    if (this.error) throw this.error;
  }

  // drawing buffer size in pixels, applied by the next render()
  resize(width, height) { this._wantSize = { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) }; }

  // a pending Stage capture always renders (ScreenCapture reads the frame)
  _renderHook() {
    const fr = this.scene.fieldRenderer;
    if (!this.gl) {
      if (fr.capture.pending) {
        const res = fr.capture.pending; fr.capture.pending = null;
        this.loop.yield("Update").then(() => res({ headless: true }));
      }
      return;
    }
    if (this._draw || fr.capture.pending) this.render();
  }

  // draws the current state: the ADV viewport (13:6 letterbox) with the front canvas, then the letterbox bands
  render() {
    if (this.disposed || !this.gl) return;
    const gl = this.gl, c = gl.canvas;
    const want = this._wantSize || { w: c ? c.width : 300, h: c ? c.height : 150 };
    if (c && (c.width !== want.w || c.height !== want.h)) { c.width = want.w; c.height = want.h; }
    const w = want.w, h = want.h, vp = advViewport(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.core.coverBlack) return;                                   // TransitionManager black cover (shortcut)
    this.renderer.render(vp, this.ui);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.ui.renderLetterBox({ gl, screenWidth: w, screenHeight: h, viewport: vp });
  }

  // Releases the session: stops the playback, waits for a step in progress, deletes the GL objects it created and
  // releases the Cubism models. The context and its canvas stay the caller's.
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.core) this.core.stop(2);
    try { if (this._stepping) await this._stepping; } catch (_) { /* reported by step */ }
    if (this.loop) this.loop.cancelDelays();
    if (this.audio) {
      try { this.audio.stopAll(9999, false, 0); } catch (_) { /* nothing playing */ }
      if (this.audio.ownsContext && this.audio.ctx && this.audio.ctx.close) this.audio.ctx.close().catch(() => {});
    }
    if (this.ctx) {
      try {
        for (const st of this.scene.stageData.values()) st.releaseParticleGroups();
        disposeStoryFeatures(this.ctx);
      } catch (_) { /* partly installed */ }
    }
    if (this.characters) for (const ch of this.characters.values()) ch.release();
    if (this.ui) { try { this.ui.dispose(); } catch (_) { /* partly loaded */ } }
    if (this.gl) {
      if (this._gl) this._gl.release();
      unbindAssets(this.gl, this.assets);
    }
    for (const k of ["core", "ui", "renderer", "characters", "loop", "_gl", "ctx"]) this[k] = null;
  }
}
