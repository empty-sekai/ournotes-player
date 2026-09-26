import { bindAssets, unbindAssets } from "../../data/assets.js";
import { Audio } from "../../engine/audio.js";
import { ShaderLib } from "../../engine/glsl.js";
import { trackGL } from "../../engine/gltrack.js";
import { PlayerLoop } from "../../engine/loop.js";
import { Transform } from "../../engine/math.js";
import { UnityRandom } from "../../engine/random.js";
import { GLTarget } from "../../engine/texture.js";
import { UIError, UINode, UITween } from "../../engine/ugui.js";
import { tmpUnsupported } from "../../engine/uitext.js";
import { Live2DCharacter } from "../../live2d/character.js";
import { cubismCore } from "../../live2d/cubism.js";
import { motionSyncCore } from "../../live2d/motionsync.js";
import { AdvFieldRendererManager, AdvQuality } from "../field.js";
import { ADV_PLAYBACK_MODE, STORY_FRAME_RATE, StoryCommandError, createStoryContext } from "../interfaces.js";
import { StoryCharacters } from "../player-core.js";
import { STORY_LANGUAGES, storyLines } from "../params.js";
import { speakerName } from "../commands/talk.js";
import { countedText, shownText } from "../ui-ruby.js";
import { removeTagsWithRuby } from "../ui-talk.js";
import { SilentAudio } from "../silent-audio.js";
import { SIMPLE_ADVANCE, SIMPLE_COMPLETE } from "./define.js";
import { SimpleHomeHost } from "./home/host.js";
import { SIMPLE_OWN_COMMANDS, SIMPLE_SHARED_COMMANDS, SimpleAdvPlayer } from "./player.js";
import { CameraTargetRenderer, SimpleCaptureRenderer, cameraTargetDesc } from "./render.js";
import { SimpleCanvas, SimpleUIDoc, runtimeNodeRecord, setActive } from "./ui.js";
import { SIMPLE_UNIMPLEMENTED, simpleUnsupportedCommands, validateSimpleEpisode } from "./validator.js";
import { SimpleAdvView, SimpleTalkWindow } from "./view.js";

// SimpleStorySession: an Overlay episode (MasterAdv._playbackMode 1) as the game plays it: SimpleAdvPlayer inside the
// screen that opens it. Same interface as StorySession (create, step, render, play, tap, dispose, line state), so the
// story element and page code drive either.
//
// Hosts (host/host.json of the story, written for Overlay episodes):
//   home       the home spot scene (SpotManager): the 3D spot with its Spine characters (home/host.js), a tap talk
//              blurs it over 0.2 s while the camera moves 0.5 s to the tapped character and returns after the talk;
//              an area talk blurs and shows the episode title as a system message first. Manual advance (a tap
//              advances), everything cleaned up at the end (SimpleAdvCompleteBehavior.CleanupAll).
//   afterlive  the live result screen's reward phase (LiveResultDisplayPresenter): the fixed background and the reward
//              panel's talk area. Auto advance; at the end the talk window hides and the characters stay
//              (HideTalkWindowKeepCharacters). The result panel, rewards, score and member card are runtime data
//              of a played live and are not drawn (host.afterlive.substitutes).
//   none       no host data: the talk alone on black in a full-screen overlay root with the default layout profile.

const TALK_WINDOW = "UISimpleAdvTalkWindow";
const LAYERS = ["Camera1", "Camera2", "Camera3", "Camera4", "Camera5"];
const CAMERA_LAYER_BASE = 6;                // LayerMask of Camera1 (the capture prefab's layer); Camera2..5 follow
const HOME_TALK_FOCUS = 0.5;                // SpotManager._talkFocusDuration / _talkReturnDuration
const HOME_BLUR = 0.2;                      // SpotManager._blurDuration
const REFERENCE = { x: 1920, y: 1080 };     // the host widgets' CanvasScaler reference resolution
// endReason / onEnded reason, numbered as StorySession's: 0 the talk played to its end, 1 stopped (skip / dispose),
// 2 the game's validator refused the episode and nothing was shown
export const SIMPLE_END_REASON = Object.freeze({ completed: 0, stopped: 1, invalid: 2 });

const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// the texts the simple window shows: Talk lines and their speaker names
export const simpleTexts = (episode, player, masterIds, localize) => {
  const p = { ctx: { settings: { player, masterIds }, localize } }, out = new Set();
  for (const c of episode.commands) {
    if (c.IgnoreData || c.cmd !== "Talk" || !c.AdvTextID || c.AdvTextID === "0") continue;
    out.add(localize(c.AdvTextID)); out.add(speakerName(c, p));
  }
  out.delete("");
  return [...out];
};

export class SimpleStorySession {
  constructor() {
    this.disposed = false; this.gl = null; this.assets = null; this.loop = null; this.player = null;
    this.error = null; this.ended = false; this.endReason = null; this.speaker = ""; this.text = "";
    this._stepping = null; this._draw = true; this._gl = null; this._started = null; this.missing = [];
  }

  // an Overlay episode: the simple player plays it
  static isSimpleStory(store) {
    const story = store.json("story.json"), episode = store.json(story.episode);
    return (episode.master ? episode.master._playbackMode || 0 : 0) === ADV_PLAYBACK_MODE.Overlay;
  }

  // the commands the simple player runs for the episode, and the episode's refusal by the game's validator
  static requirements(store) {
    const story = store.json("story.json"), episode = store.json(story.episode), scene = store.json(story.scene);
    const v = validateSimpleEpisode(episode, scene.settings.playerSettings, 0);
    const run = new Set([...SIMPLE_SHARED_COMMANDS, ...SIMPLE_OWN_COMMANDS]);
    const commands = [...new Set(episode.commands.filter((c) => !c.IgnoreData).map((c) => c.cmd))];
    return { commands: commands.filter((c) => run.has(c)), skipped: commands.filter((c) => !run.has(c)),
             unsupported: simpleUnsupportedCommands(commands), invalid: v.ok ? null : v.failure };
  }

  // gl / store / opts as StorySession.create (auto and speed are the game's request: home talks advance by tap at
  // x1, live result talks advance on their own), plus
  //   spine   the Spine runtime for the home spot's characters (default: the page's global `spine`; null: none)
  static async create(gl, store, opts = {}) {
    const s = new SimpleStorySession();
    try { await s._load(gl, store, opts); } catch (e) { await s.dispose().catch(() => {}); throw e; }
    return s;
  }

  async _load(gl, store, opts) {
    if (!store) throw new Error("SimpleStorySession: an AssetStore is required");
    this.gl = gl || null; this.assets = store; this.opts = opts;
    const story = this.story = store.json("story.json");
    const episode = this.episode = store.json(story.episode);
    const scene = store.json(story.scene);
    const P = scene.settings.playerSettings;
    const what = `story ${episode.advId ?? story.advId}`;
    // refused before loading (validator.js SIMPLE_UNIMPLEMENTED)
    const lacking = episode.commands.find((c) => !c.IgnoreData && SIMPLE_UNIMPLEMENTED.includes(c.cmd));
    if (lacking) throw new StoryCommandError(`${what}: row ${lacking.i}: ${lacking.cmd} on a character slot is not provided by the simple player`);
    const host = this.host = store.has("host/host.json") ? store.json("host/host.json") : null;
    this.hostKind = host ? host.kind : "none";
    if (!store.has("ui/simple/ui.json")) throw new StoryCommandError(`${what}: the simple talk window (ui/simple/ui.json) is not in the story`);
    const langDoc = store.has("ui/languages.json") ? store.json("ui/languages.json") : null;
    const info = store.info || {};
    const lang = this.lang = opts.lang || info.loadedLanguage || info.language || (langDoc && langDoc.language) || "ja";
    if (langDoc && langDoc.language !== lang) throw new Error(`${what}: the loaded language is ${langDoc.language}, not ${lang}`);
    const field = langDoc ? langDoc.field : STORY_LANGUAGES[lang];
    if (!field) throw new Error(`${what}: unknown language ${lang}`);
    const localize = (id) => {
      const r = episode.text[id];
      if (r) return r[field] ?? "";
      console.warn(`${what}: text ${id} missing`);
      return "";
    };

    // UI documents first: the texts are checked before anything heavy loads
    const loop = this.loop = new PlayerLoop(STORY_FRAME_RATE);
    const simpleDoc = store.json("ui/simple/ui.json");
    const simpleFonts = store.has("ui/simple/fonts.json") ? store.json("ui/simple/fonts.json") : null;
    const ui = this.ui = new SimpleUIDoc(gl, loop, simpleDoc, { assets: store, dir: "ui/simple", fonts: simpleFonts, language: langDoc });
    const hostUi = this.hostUi = host && host.ui
      ? new SimpleUIDoc(gl, loop, store.json(host.ui), { assets: store, dir: dirname(host.ui) }) : null;
    this._checkTexts(simpleTexts(episode, P, scene.settings.masterIdSettings, localize), what);

    await cubismCore();
    const motionSync = await motionSyncCore().catch(() => null);
    if (gl) { bindAssets(gl, store); this._gl = trackGL(gl); }
    const quality = this.quality = new AdvQuality(opts.quality ?? 4, P);
    this.seed = opts.seed ?? (Date.now() >>> 0);
    const random = opts.random || new UnityRandom(this.seed);

    // the UI tween runner (DOTweenComponent) and the host screen's canvases
    const tweens = this.tweens = { active: new Set() };
    this._buildCanvases(host, hostUi, ui, what);
    const view = this.view = new SimpleAdvView(this.overlayRoot, host ? host.layoutRoot : null,
                                               { tweens, dotween: simpleDoc.dotween });
    for (const s of view.slots) s.image.doc = ui;                       // the RawImage: UI/Default of the window doc
    const window = this.window = new SimpleTalkWindow(ui, TALK_WINDOW, { loop, tweens, language: langDoc });

    // characters: the Character rows' models (AdvEpisodeResourceLoader.Preload), keyed TargetName-TargetAssetIndex
    const manager = new Transform("AdvManager");
    const pool = new Transform("Pool", manager);
    const characters = this.characters = new StoryCharacters();
    const renderer = this.renderer = gl ? new SimpleCaptureRenderer(gl, new ShaderLib(gl, "shaders", store), scene.resources, loop,
                                                                    { assets: store }) : null;
    for (const c of episode.commands) {
      if (c.cmd !== "Character" || c.IgnoreData) continue;
      if (characters.has(c.TargetName, c.TargetAssetIndex || 0)) continue;
      const address = `Character/Live2D/${c.TargetAssetName}`;
      const m = story.models[address];
      if (!m) throw new Error(`${what}: model ${address} is not in the story`);
      const ch = new Live2DCharacter(store.json(join(m.dir, m.prefab)), store.arrayBuffer(join(m.dir, m.moc3)), loop,
                                     { random, motionSync });
      ch.setParent(pool);
      characters.add(c.TargetName, c.TargetAssetIndex || 0, ch);
      if (renderer) renderer.addCharacter(ch, m.dir);
    }
    // one CameraTargetRenderer per slot under the runtime parent (the host manager's transform)
    const desc = cameraTargetDesc(host);
    this.cameraTargets = view.slots.map((s) => {
      const crt = new CameraTargetRenderer(s.index, manager, desc);
      crt.layer = CAMERA_LAYER_BASE + LAYERS.indexOf(s.def.layer);
      return crt;
    });

    // audio
    const resolve = Audio.episodeResolver(episode);
    // a story without its sound files (story.json `audio` empty) plays no sound, with the voices off as in the game
    // without voice data (as StorySession)
    const hasSounds = !!story.audio && Object.keys(story.audio).length > 0;
    this.hasSounds = hasSounds;
    const webAudio = hasSounds && opts.sound !== false && typeof globalThis.AudioContext === "function";
    const audio = this.audio = opts.audio ? opts.audio(resolve, loop, { assets: store })
      : webAudio ? new Audio(resolve, loop, { context: opts.audioContext || null, assets: store })
        : new SilentAudio(resolve, loop, { assets: store, sounds: hasSounds });
    await audio.preload(Object.keys(episode.sounds).map(Number));

    // the home spot scene
    if (this.hostKind === "home") {
      const camNode = scene.cameraManager.nodes.find((n) => n.path === "CameraManager/MainCamera");
      const cam = camNode ? camNode.components.find((c) => c.type === "Camera") : null;
      if (!cam) throw new Error(`${what}: scene.json has no CameraManager/MainCamera camera`);
      const bg = cam.m_BackGroundColor;
      this.home = await SimpleHomeHost.create(gl, store, loop, host,
        { camera: { near: cam["near clip plane"], far: cam["far clip plane"], clearFlags: cam.m_ClearFlags,
                    clearColor: [bg.r, bg.g, bg.b, bg.a] }, spine: opts.spine });
      this.missing.push(...this.home.missing);
    }
    if (renderer) await renderer.load();
    await ui.load();
    if (hostUi) await hostUi.load();

    // the command context: the simple session's parts; the ADV field, camera, stages and post are booted by the game
    // but never drawn here (the field renderer is kept so the shared Brightness command reaches the controllers)
    const ctx = this.ctx = createStoryContext({
      loop, camera: null, field: null, background: { brightness: 1, originalColor: { r: 1, g: 1, b: 1, a: 1 },
                                                     color: { r: 1, g: 1, b: 1, a: 1 }, colorTween: null },
      fieldRenderer: new AdvFieldRendererManager(loop, quality), volume: null, characters, stages: new Map(),
      ui: window, audio, quality, settings: { player: P, masterIds: scene.settings.masterIdSettings }, localize, lang,
      playbackMode: ADV_PLAYBACK_MODE.Overlay, titleTextId: 0, episode, story, assets: store, renderer: null, gl: this.gl });
    this.lines = storyLines(episode);
    const line = Math.max(0, Math.min(opts.line || 0, Math.max(0, this.lines.length - 1)));
    const request = this.hostKind === "afterlive"
      ? { advanceMode: SIMPLE_ADVANCE.Auto, completeBehavior: SIMPLE_COMPLETE.HideTalkWindowKeepCharacters }
      : { advanceMode: SIMPLE_ADVANCE.Manual, completeBehavior: SIMPLE_COMPLETE.CleanupAll };
    const player = this.player = new SimpleAdvPlayer(ctx, view, window, new Map([[TALK_WINDOW, window]]), {
      ...request, withVoice: opts.voice !== false && (hasSounds || !!opts.audio), startIndex: line > 0 ? this.lines[line].i : 0,
    }, {
      slotStage: (slot) => this.cameraTargets[slot.index], poolRoot: pool,
      onCommand: opts.onCommand || null,
      onLine: (e) => { this.speaker = e.speaker; this.text = e.text; if (opts.onLine) opts.onLine(e); },
      onError: (e) => { if (!this.error) this.error = e; },
    });
    player.lineIndex = line - 1;

    // per-frame hooks in Unity phase order: the host's character update (SpotManager.UpdateTalkAdvPlayer / the result
    // presenter: Slot.OnUpdate) and the sound manager, the motion waits (ObserveQueuedMotions), UI tweens, animators
    loop.on("update", (l) => {
      audio.update();
      for (const ch of characters.values()) ch.update();
      player.p.motions.update(l.deltaTime);
    });
    loop.on("tweens", (l) => { for (const t of [...tweens.active]) t.step(l.deltaTime); });
    loop.on("animation", (l) => {
      for (const ch of characters.values()) ch.animatorUpdate();
      ui.animate(l.deltaTime); if (hostUi) hostUi.animate(l.deltaTime);
    });
    loop.on("lateUpdate", () => { for (const ch of characters.values()) ch.lateUpdate(); });
    loop.on("preLateEnd", () => { for (const ch of characters.values()) ch.modelUpdate(); });
    loop.on("render", () => { if (this._draw) this.render(); else this._layout(); });

    // Init + Warmup + hide per character with the loop running (AdvManager.Preload)
    let done = false, error = null;
    const loaded = (async () => {
      await Promise.all([...characters.values()].map((ch) => ch.load()));
      for (const ch of characters.values()) { ch.setLightingEnabled(false); ch.setMultiplyTexture(null); }
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

  // the host screen's root canvases (drawn in order) and the overlay root the view lives in
  _buildCanvases(host, hostUi, ui, what) {
    this.canvases = [];
    if (hostUi) {
      // root canvases in sorting order; UISpotLetterbox is not drawn: SpotLetterboxBands sizes its bands for screens
      // wider than 13:6 at runtime (not reproduced; the page is expected at 13:6 or narrower)
      const roots = hostUi.roots.filter((r) => r.rec.canvasScaler && r.name !== "UISpotLetterbox");
      roots.sort((a, b) => ((a.rec.canvas || {}).m_SortingOrder || 0) - ((b.rec.canvas || {}).m_SortingOrder || 0));
      for (const n of hostUi.nodes.values())                            // AspectRatioFitter components
        if (n.rec.aspectRatioFitter && n.rec.aspectRatioFitter.m_Enabled) n.fitter = n.rec.aspectRatioFitter;
      for (const root of roots) {
        const fitters = [];
        const walk = (n) => { if (n.fitter) fitters.push(n); n.children.forEach(walk); };
        walk(root);
        this.canvases.push({ name: root.name, canvas: new SimpleCanvas(root, root.rec.canvasScaler), root, fitters });
      }
      this.overlayRoot = hostUi.node(host.overlayRoot);
      setActive(this.overlayRoot, false);
      if (host.kind === "afterlive") this._resultScreenState(hostUi, host.afterlive);
      this._applyOpenedSequences(hostUi, host.openedSequences);
      if (host.kind === "home") this._homeScreenState(hostUi);
    } else {
      const rec = runtimeNodeRecord("SimpleAdvRoot", "SimpleAdvRoot");
      const root = new UINode({ ...rec, canvasScaler: null }, null);
      root.doc = ui;
      const scaler = { m_Enabled: 1, m_UiScaleMode: 1, m_ReferenceResolution: REFERENCE, m_ScreenMatchMode: 1,
                       m_ReferencePixelsPerUnit: 100 };
      const overlay = new UINode(runtimeNodeRecord("SimpleAdvRoot/Base_AdvSimpleContents", "Base_AdvSimpleContents",
                                                   { active: false }), root);
      overlay.doc = ui;
      this.canvases.push({ name: root.name, canvas: new SimpleCanvas(root, scaler), root, fitters: [] });
      this.overlayRoot = overlay;
    }
    if (!this.canvases.length) throw new UIError(`${what}: the host UI has no root canvas`);
  }

  // UISpotWidget while a talk runs: the view's CanvasGroup at uiAlphaRatio 1 (SpotManager.UpdateUi)
  _homeScreenState(doc) {
    const v = doc.nodes.get("UISpotWidget/View");
    if (v && v.canvasGroup) v.canvasGroup.alpha = 1;
  }

  // the reward phase (ShowRewardPhase -> MusicResultViewPresenter.ShowReward): the reward panel shown
  _resultScreenState(doc, info) {
    if (info && info.rewardPanel) setActive(doc.node(info.rewardPanel), true);
  }

  // The DOTweenSequences the screen played before any talk can start (the widgets' open / transition in, the reward
  // view's in): each event call SimpleAnimationTrigger.PlayAnimation(state) plays the target's Animator state, whose
  // clip has long ended when the talk starts (the talk follows the screen's opening), so its end values apply.
  _applyOpenedSequences(doc, paths) {
    for (const path of paths || []) {
      const seq = doc.node(path).rec.tweenSequence;
      if (!seq) throw new UIError(`${path}: no DOTweenSequence record`);
      for (const cmd of seq.list) {
        for (const call of cmd.calls || []) {
          if (call.method !== "PlayAnimation") throw new UIError(`${path}: sequence call ${call.method} not implemented`);
          const target = doc.node(call.target);
          if (!target.animator) throw new UIError(`${call.target}: no Animator for PlayAnimation(${call.string})`);
          if (!target.animator.play(call.string)) continue;
          const st = target.animator.state;
          target.animator.update(st.clip ? st.clip.length + 1 : 0);
        }
      }
    }
  }

  // texts the simple window cannot lay out as the game does (the text component's rewrite failing, the unsupported
  // rich-text features of what TMP then lays out, characters missing from the talk text's font) raise
  // StoryCommandError before loading, as StoryUI.checkTexts
  _checkTexts(texts, what) {
    const node = this.ui.node(`${TALK_WINDOW}/TalkArea/Content/TextWindow/TalkText`), talk = node.text;
    if (!talk || !node.storyText) throw new StoryCommandError(`${what}: the simple talk window has no text data`);
    const b = node.storyText.b, problems = new Set();
    for (const s of texts) {
      if (typeof s !== "string" || !s) continue;
      let shown = s;
      try {
        shown = shownText(talk, b, s);
        countedText(talk, b, removeTagsWithRuby(s));
      } catch (e) {
        if (!(e instanceof UIError)) throw e;
        problems.add(e.message);
      }
      for (const p of tmpUnsupported(shown, { richText: talk.richText, parseCtrl: talk.parseCtrl })) problems.add(p);
      for (const ch of removeTagsWithRuby(s)) {
        const u = ch.codePointAt(0);
        if (!talk.font.characters[String(u)] && u !== 10 && u !== 13 && u !== 9 && u !== 0x200B)
          problems.add(`${talk.font.name}: U+${u.toString(16).toUpperCase().padStart(4, "0")} not in the font data`);
      }
    }
    if (problems.size) throw new StoryCommandError(`${what}: texts the simple talk window cannot lay out: ${[...problems].join("; ")}`);
  }

  // ------------------------------------------------------------------------------------------------ playback
  // The host's steps around SimpleAdvPlayer.Play (SpotManager.OnTalkCharacter / PlayAreaTalkAsync,
  // LiveResultDisplayPresenter.PlaySimpleAdvResult)
  async _hostPlay() {
    const home = this.home, h = this.host && this.host.home;
    if (home) {
      home.stopUiFadeAndShow();
      if (h.talk === "tap") {
        home.execBlur(HOME_BLUR);
        // without a tap target (home.missing: NO_TAP_TARGET) the talk plays without the focus move
        if (home.tapTarget(h.characterId)) await home.focusCharacter(h.characterId, HOME_TALK_FOCUS);
      } else {
        home.execBlur(HOME_BLUR);
        await this._showSystemMessage();
      }
    }
    const reason = SIMPLE_END_REASON[await this.player.play()];
    if (home) {
      home.stopBlur();
      if (h.talk === "tap") { await home.returnToDefaultPosition(HOME_TALK_FOCUS); home.resetCamera(); }
    }
    return reason;
  }

  // SystemMessageManager.ShowMessageByTextIdAsync(spot._advNameTextId, 1.0) -> UISystemMessage.ShowMessage: the
  // localized title on the message text, Animator.speed and the show sequence's time scale 1.0, then
  // _showAnimation.DOPlayAsync: its CustomEvent plays the widget Animator's state and the sequence lasts its
  // duration (the prefab's 2 s)
  async _showSystemMessage() {
    const doc = this.ui, title = doc.doc.texts && doc.doc.texts.areaTitle;
    const root = doc.roots.find((r) => r.name === "UISystemMessageWidget");
    if (!root || typeof title !== "string") throw new StoryCommandError("the area talk's system message is not in the story data");
    if (!this.canvases.some((c) => c.root === root))
      this.canvases.push({ name: root.name, canvas: new SimpleCanvas(root, root.rec.canvasScaler), root, fitters: [] });
    const view = root.find("View"), trigger = root.find("ShowTrigger"), text = root.find("View/Message/UIText");
    text.storyText.setText(title);                                     // UISystemMessage: UIText.SetText
    setActive(root, true);
    const seq = trigger.rec.tweenSequence;
    if (!seq || seq.list.some((c) => c._commandType !== 1)) throw new UIError("system message: sequence outside the implemented subset");
    // the CustomEvent's SimpleAnimationTrigger state: the controller's non-default state (its "Show" clip)
    const ctrl = view.animator ? view.animator.ctrl : null;
    const shows = ctrl ? ctrl.states.filter((st) => st !== ctrl.states[ctrl.defaultState]) : [];
    if (shows.length !== 1) throw new UIError("system message: the Animator's show state is not unique");
    const state = shows[0].name;
    const duration = seq.list.reduce((a, c) => a + (c._duration > 0 ? c._duration : 0), 0);
    const t = new UITween(this.tweens, { duration, at0: [() => { if (view.activeInHierarchy && view.animator) view.animator.play(state); }] });
    trigger.sequence = t;
    await t.promise;
  }

  _run() {
    if (this._started) return this._started;
    this._started = this._hostPlay().then((reason) => {
      this.ended = true; this.endReason = reason;
      if (this.opts.onEnded) this.opts.onEnded({ reason });
    }, (e) => { if (!this.error) this.error = e; });
    return this._started;
  }

  get time() { return this.loop.time; }
  get frame() { return this.loop.frameCount; }
  get line() { return this.player.lineIndex; }
  get lineCount() { return this.lines.length; }
  get isAuto() { return this.player.isAuto; }
  get speed() { return 10; }
  get started() { return !!this._started; }
  get busy() { return !!this._stepping; }

  play() {
    if (this._started) return;
    this._started = this.loop.yield("Update").then(() => { this._started = null; return this._run(); });
  }

  // a tap on the screen: the TapCatcher (OnTapped); before the first play it starts it
  tap() { this.view.onTapped(); }
  setAuto() {}                              // the request fixes the advance mode; the talks have no auto button
  setSpeed() {}                             // no fast-forward in the simple player
  skip() { this.player.stop(); }
  setVolume(category, v) { if (this.audio.setOptionVolume) this.audio.setOptionVolume(category, v); }

  async step({ draw = true } = {}) {
    if (this.disposed) throw new Error("SimpleStorySession: disposed");
    if (this._stepping) throw new Error("SimpleStorySession: a step is in progress");
    if (this.error) throw this.error;
    this._draw = draw;
    this._stepping = this.loop.step();
    try { await this._stepping; } finally { this._stepping = null; this._draw = true; }
    if (this.error) throw this.error;
  }

  resize(width, height) { this._wantSize = { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) }; }

  _size() {
    const c = this.gl && this.gl.canvas;
    const o = this.opts || {};
    return this._wantSize || { w: c ? c.width : o.width || REFERENCE.x, h: c ? c.height : o.height || REFERENCE.y };
  }

  // the layout of every canvas: the RectTransform pass, then the fitters (the view's layout code, the host nodes'
  // AspectRatioFitters) until nothing changes (each fitter sizes from its parent's rect of the previous pass)
  _layout() {
    const { w, h } = this._size();
    for (const c of this.canvases) {
      for (let i = 0; i < 6; i++) {
        c.canvas.layout(w, h);
        let changed = false;
        if (c.root === this._rootOf(this.overlayRoot)) changed = this.view.fit();
        for (const n of c.fitters) changed = applyFitter(n) || changed;
        if (!changed) break;
      }
    }
    return { w, h };
  }

  _rootOf(node) { let n = node; while (n.parent) n = n.parent; return n; }

  render() {
    if (this.disposed) return;
    const { w, h } = this._layout();
    const gl = this.gl;
    if (!gl) return;
    const c = gl.canvas;
    if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    if (!this.screen || this.screen.width !== w || this.screen.height !== h) {
      if (this.screen) this.screen.release();
      this.screen = new GLTarget(gl, w, h, { label: "SimpleScreen" });
    }
    this.renderer.render(this.view.slots.map((s) => ({ crt: this.cameraTargets[s.index], character: s.character })));
    for (const s of this.view.slots) s.image.rawImage.texture = this.cameraTargets[s.index].target;
    const screen = this.screen;
    screen.bind();
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.home) {
      this.home.renderScene(screen, w, h);
      this.home.applyBlur(screen, w, h);                               // the home header / menu (blurred) are not drawn
      screen.bind();
    }
    for (const cv of this.canvases) cv.canvas.render(gl, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, screen.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.player) this.player.stop();
    try { if (this._stepping) await this._stepping; } catch (_) { /* reported by step */ }
    if (this.loop) this.loop.cancelDelays();
    if (this.audio) {
      try { this.audio.stopAll(9999, false, 0); } catch (_) { /* nothing playing */ }
      if (this.audio.ownsContext && this.audio.ctx && this.audio.ctx.close) this.audio.ctx.close().catch(() => {});
    }
    if (this.home) { try { this.home.dispose(); } catch (_) { /* partly loaded */ } }
    if (this.characters) for (const ch of this.characters.values()) ch.release();
    if (this.renderer) this.renderer.dispose(this.view ? this.view.slots.map((s) => ({ crt: this.cameraTargets[s.index] })) : []);
    if (this.screen) this.screen.release();
    for (const d of [this.ui, this.hostUi]) if (d) { try { d.dispose(); } catch (_) { /* partly loaded */ } }
    if (this.gl) { if (this._gl) this._gl.release(); unbindAssets(this.gl, this.assets); }
    for (const k of ["player", "ui", "hostUi", "renderer", "characters", "loop", "_gl", "ctx", "home", "screen"]) this[k] = null;
  }
}

// AspectRatioFitter.UpdateRect of a host node (modes 1 WidthControlsHeight, 2 HeightControlsWidth, 3 FitInParent,
// 4 EnvelopeParent)
const applyFitter = (n) => {
  const f = n.fitter, mode = f.m_AspectMode, a = f.m_AspectRatio, p = n.parent.rect;
  const before = JSON.stringify([n.anchorMin, n.anchorMax, n.anchoredPosition, n.sizeDelta]);
  if (mode === 3 || mode === 4) {
    n.anchorMin = { x: 0, y: 0 }; n.anchorMax = { x: 1, y: 1 }; n.anchoredPosition = { x: 0, y: 0 };
    const size = { x: 0, y: 0 };
    if ((Math.fround(p.h * a) < p.w) !== (mode === 3)) size.y = Math.fround(Math.fround(p.w / a) - p.h);
    else size.x = Math.fround(Math.fround(p.h * a) - p.w);
    n.sizeDelta = size;
  } else if (mode === 1) n.setSizeWithCurrentAnchors(1, Math.fround(n.rect.w / a));
  else if (mode === 2) n.setSizeWithCurrentAnchors(0, Math.fround(n.rect.h * a));
  return JSON.stringify([n.anchorMin, n.anchorMax, n.anchoredPosition, n.sizeDelta]) !== before;
};
