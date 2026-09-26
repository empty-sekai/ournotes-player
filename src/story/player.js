import { StoryControls, STORY_PLAYER_CSS } from "./controls.js";
import { fetchStoryManifest, loadStoryStore } from "./assets.js";
import { cubismCore } from "../live2d/cubism.js";
import { parseStoryQuality } from "./params.js";
import { STORY_FRAME_RATE, StorySession } from "./session.js";

// StoryPlayer: a StorySession on a canvas inside a host element. It creates the canvas and its WebGL2 context, keeps
// the drawing buffer at the element's size in device pixels, drives the session with requestAnimationFrame at 30 steps
// per second of game time, turns clicks on the story screen into taps, and reports its state as events. Everything it
// adds lives in one <div> appended to the host, with its styles in that div's shadow root.
//
//   const player = await StoryPlayer.create(host, { src: "stories/10462.json", lang: "en" });
//   player.play();                      // from a user gesture: audio starts with it
//
// Events (CustomEvent, `detail` as noted): progress {loaded, total} (bytes, while loading), ready, play, pause,
// line {index, lineCount, speaker, text}, log {row, speaker, text, voiceIds} (a talk log entry: Talk, Location,
// subtitles, chat; the lines before the start line too), command {index, cmd}, ended {reason}, error {error}.

const MAX_STEPS = 4;              // steps per animation frame at most (a late frame catches up to 4 frames of game time)

export class StoryPlayer extends EventTarget {
  // host: an Element or a ShadowRoot. opts:
  //   src          URL of a story manifest (stories/<advId>.json), or
  //   assets       an AssetStore of the story (one language)
  //   lang         the language ("ja" "en" "zh-Hant" "zh-Hans" "ko"; default: the manifest's)
  //   auto         auto mode (default false, the game's fresh-profile preference); speed: AdvPlaybackSpeed 10
  //                (default), 15, 17, 20
  //   quality      "best" (default), "high", "middle" (the game's quality option) or a BaseQualityMode 0..4
  //   line         start at this line (default 0)
  //   autoplay     play as soon as the story is loaded (audio may still wait for a user gesture)
  //   controls     show the control bar (default true); uiLang: the control labels' language (default: lang)
  //   voice        false: no voices; sound: false: no Web Audio (silent, same timing); volumes {Bgm, Se, Voice} (0..1)
  //   seed         seed of UnityEngine.Random (eye blinks, pseudo lip sync)
  //   fetch, signal, pixelRatio, on {type: listener}
  static async create(host, opts = {}) {
    const p = new StoryPlayer(host, opts);
    for (const [type, fn] of Object.entries(opts.on || {})) p.addEventListener(type, fn);
    await p.load();
    return p;
  }

  constructor(host, opts = {}) {
    super();
    if (!host || typeof host.append !== "function") throw new TypeError("StoryPlayer: host must be an Element or a ShadowRoot");
    this.host = host;
    this.opts = opts;
    this.session = null;
    this.store = null;
    this.disposed = false;
    this._paused = false;
    this._auto = !!opts.auto;
    this._speed = opts.speed || 10;
    this._volumes = { Bgm: 1, Se: 1, Voice: 1, ...(opts.volumes || {}) };
    this._lang = opts.lang || null;
    this._abort = new AbortController();
    const doc = host.ownerDocument || document;
    const root = this.root = doc.createElement("div");
    root.className = "ournotes-story";
    root.tabIndex = 0;
    root.style.cssText = "display:block;position:relative;width:100%;height:100%;overflow:hidden;outline:none;";
    const shadow = this.shadow = root.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STORY_PLAYER_CSS;
    const stage = doc.createElement("div");
    stage.className = "stage";
    const canvas = this.canvas = doc.createElement("canvas");
    canvas.className = "canvas";
    const status = this.statusEl = doc.createElement("div");
    status.className = "status";
    stage.append(canvas, status);
    shadow.append(style, stage);
    host.append(root);
    this._autoHeight = root.clientHeight === 0;
    if (this._autoHeight) root.style.aspectRatio = "13 / 6";      // a host without a height: the ADV aspect
    this.controls = opts.controls === false ? null : new StoryControls(this, { lang: opts.uiLang || opts.lang });
  }

  // Loads the story (the manifest, the files of the language) and prepares the session; resolves once it is ready.
  async load() {
    if (this._loaded) return this._loaded;
    this._loaded = (async () => {
      try {
        await this._init();
      } catch (e) {
        if (!this.disposed) { this._fail(e); await this.dispose(); }
        throw e;
      }
    })();
    return this._loaded;
  }

  async _init() {
    const o = this.opts, signal = o.signal ? anySignal([o.signal, this._abort.signal]) : this._abort.signal;
    const t = this.controls ? this.controls.t : null;
    this._status(t ? `${t.loading}…` : "loading…");
    await cubismCore();                              // a page without the Core fails before downloading the story
    if (o.assets) this.store = o.assets;
    else {
      this._manifest = await fetchStoryManifest(o.src, { fetch: o.fetch, signal });
      this.store = await this._loadStore(this._lang, signal);
    }
    if (this.disposed) throw abortError();
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
                                                  premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this._onLost = (e) => { e.preventDefault(); this._fail(new Error("the WebGL context was lost")); };
    this.canvas.addEventListener("webglcontextlost", this._onLost);
    // one AudioContext for every session of the player (a seek or a language switch starts a new session); the cues
    // are 48 kHz: at that rate they decode without resampling
    const AC = this.root.ownerDocument.defaultView.AudioContext;
    if (AC && o.sound !== false) this._audioContext = new AC({ sampleRate: 48000 });
    await this._startSession(o.line || 0, !!o.autoplay);
    this._observe();
    this._status("");
    this._drive();
    this._emit("ready");
    if (this.controls && !o.autoplay) this.controls.showStart(true);
  }

  _loadStore(lang, signal) {
    const mb = (n) => (n / 1048576).toFixed(1);
    const t = this.controls ? this.controls.t : null;
    return loadStoryStore(this.opts.src, {
      lang, fetch: this.opts.fetch, signal, manifest: this._manifest,
      onProgress: (loaded, total) => {
        this._status(`${t ? t.loading : "loading"} ${mb(loaded)} / ${mb(total)} MB`);
        this._emit("progress", { loaded, total });
      },
    });
  }

  async _startSession(line, autoplay) {
    const [w, h] = this._pixelSize();
    const o = this.opts;
    const session = await StorySession.create(this.gl, this.store, {
      lang: this._lang || undefined, quality: parseStoryQuality(o.quality), seed: o.seed, auto: this._auto, speed: this._speed, line,
      voice: o.voice, sound: this._audioContext ? undefined : false, audioContext: this._audioContext || null, autoplay,
      width: w, height: h,
      onCommand: (c) => this._emit("command", { index: c.i, cmd: c.cmd }),
      onLine: (e) => { this._emit("line", { index: e.index, lineCount: session.lineCount, speaker: e.speaker, text: e.text });
                       this._sync(); },
      onLog: (e) => this._emit("log", e),
      onEnded: (e) => { this._emit("ended", e); this._sync(); },
    });
    if (this.disposed) { await session.dispose(); throw abortError(); }
    this.session = session;
    this._lang = session.lang;
    for (const [cat, v] of Object.entries(this._volumes)) session.setVolume(cat, v);
    session.resize(w, h);
    session.render();
    this._sync();
  }

  // ------------------------------------------------------------------------------------------------ public API
  get line() { return this.session ? this.session.line : -1; }
  get lineCount() { return this.session ? this.session.lineCount : 0; }
  get speaker() { return this.session ? this.session.speaker : ""; }
  get text() { return this.session ? this.session.text : ""; }
  get auto() { return this._auto; }
  get speed() { return this._speed; }
  get paused() { return this._paused; }
  get ended() { return !!this.session && this.session.ended; }
  get lang() { return this._lang; }
  get languages() { return this._manifest ? Object.keys(this._manifest.manifest.languages) : [this._lang].filter(Boolean); }
  get info() { return this.store ? this.store.info : null; }

  // starts the episode (the first call; call it from a user gesture so that audio may start) or resumes it
  play() {
    const s = this._need();
    if (s.audio && s.audio.resume) s.audio.resume().catch(() => {});
    if (this.controls) this.controls.showStart(false);
    if (!s.started) s.play();
    if (this._paused) { this._paused = false; if (s.audio && s.audio.resume) s.audio.resume().catch(() => {}); }
    this._emit("play");
    this._sync();
  }

  // stops the frames (the player's pause; the game has none): game time and sound stop together
  pause() {
    if (this._paused) return;
    this._paused = true;
    const s = this.session;
    if (s && s.audio && s.audio.suspend) s.audio.suspend().catch(() => {});
    this._emit("pause");
    this._sync();
  }

  // a tap on the story screen (AdvPlayerUIEventHandler.OnNextButtonTapped); before the first play it starts it
  next() {
    const s = this._need();
    if (!s.started) { this.play(); return; }
    s.tap();
  }

  // the story menu's Auto button: turning auto off at a speed other than x1 resets the speed to x1
  setAuto(on) {
    this._auto = !!on;
    if (this.session) { this.session.setAuto(this._auto); this._speed = this.session.speed; }
    this._sync();
  }

  // the story menu's Fast-forward button, set to AdvPlaybackSpeed 10, 15, 17 or 20: a speed other than x1 turns auto
  // on, x1 brings the player's auto choice back
  setSpeed(speed) {
    const v = Number(speed);
    if (![10, 15, 17, 20].includes(v)) throw new RangeError(`speed ${speed}: one of 10, 15, 17, 20`);
    this._speed = v;
    if (this.session) { this.session.setSpeed(v); this._auto = this.session.isAuto; }
    this._sync();
  }

  // the game's Skip: the playback stops, the finalize rows are not played
  skip() { this._need().skip(); }

  // category "Bgm" | "Se" | "Voice", v 0..1
  setVolume(category, v) {
    this._volumes[category] = Math.min(1, Math.max(0, Number(v)));
    if (this.session) this.session.setVolume(category, this._volumes[category]);
  }

  // restarts the episode at line i with the game's shortcut (the rows before it run instantly)
  async seekToLine(i) {
    this._need();
    const n = this.session.lineCount, line = Math.max(0, Math.min(Math.trunc(i), n - 1));
    const playing = this.session.started;
    await this._replace(async () => this._startSession(line, playing));
  }

  // loads another language of the story and restarts at the current line
  async setLanguage(lang) {
    if (lang === this._lang) return;
    if (!this._manifest) throw new Error("StoryPlayer: setLanguage needs a story manifest (src)");
    const store = await this._loadStore(lang, this._abort.signal);
    const line = Math.max(0, this.line), playing = this.session && this.session.started;
    await this._replace(async () => { this.store = store; this._lang = lang; await this._startSession(line, playing); });
  }

  async _replace(fn) {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    const old = this.session;
    this.session = null;
    if (old) { try { if (old.busy) await old._stepping; } catch (_) { /* reported */ } await old.dispose(); }
    try { await fn(); } catch (e) { this._fail(e); throw e; }
    this._drive();
  }

  // stops the player and removes it from the host; the WebGL context is released
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._running = false;
    this._abort.abort();
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.session) await this.session.dispose();
    if (this._audioContext && this._audioContext.close) this._audioContext.close().catch(() => {});
    if (this.gl) {
      this.canvas.removeEventListener("webglcontextlost", this._onLost);
      const lose = this.gl.getExtension("WEBGL_lose_context");
      if (lose && lose.loseContext) lose.loseContext();
    }
    this.root.remove();
    this.session = null; this.gl = null;
  }

  // ------------------------------------------------------------------------------------------------ internals
  _need() {
    if (!this.session) throw new Error(this.disposed ? "StoryPlayer: disposed" : "StoryPlayer: not ready");
    return this.session;
  }

  _emit(type, detail = null) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _sync() { if (this.controls) this.controls.update(); }

  _status(msg) { this.statusEl.textContent = msg; this.statusEl.hidden = !msg; }

  _fail(e) {
    this._running = false;
    const t = this.controls ? this.controls.t : null;
    this._status(`${t ? t.error : "error"}: ${e && e.message ? e.message : e}`);
    this._emit("error", { error: e });
  }

  _pixelSize(entry = null) {
    const dpr = this.opts.pixelRatio || this.root.ownerDocument.defaultView.devicePixelRatio || 1;
    if (entry && entry.devicePixelContentBoxSize && !this.opts.pixelRatio) {
      const b = entry.devicePixelContentBoxSize[0];
      return [Math.max(1, b.inlineSize), Math.max(1, b.blockSize)];
    }
    const r = entry ? entry.contentRect : this.canvas.getBoundingClientRect();
    return [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
  }

  _observe() {
    const Ro = this.root.ownerDocument.defaultView.ResizeObserver;
    if (!Ro) return;
    this._ro = new Ro((entries) => {
      const s = this.session;
      if (!s || this.disposed) return;
      const [w, h] = this._pixelSize(entries[entries.length - 1]);
      s.resize(w, h);
      if (this._paused && !s.busy) s.render();                  // no step follows while paused: draw now
    });
    try { this._ro.observe(this.canvas, { box: "device-pixel-content-box" }); } catch (_) { this._ro.observe(this.canvas); }
  }

  // requestAnimationFrame paces the session; every step advances one frame of game time (1/30 s). An animation frame
  // runs the steps that are due (at most 4, drawing only the last), so game time keeps real time on any display rate.
  _drive() {
    const dt = 1 / STORY_FRAME_RATE;
    let acc = 0, last = performance.now();
    this._running = true;
    const tick = async (now) => {
      const s = this.session;
      if (!this._running || this.disposed || !s) return;
      if (this._paused) { acc = 0; last = now; this._raf = requestAnimationFrame(tick); return; }
      acc = Math.min(acc + (now - last) / 1000, dt * MAX_STEPS);
      last = now;
      let n = 0;
      try {
        while (acc >= dt && n < MAX_STEPS && !this._paused && !this.disposed && this.session === s) {
          acc -= dt; n++;
          await s.step({ draw: !(acc >= dt && n < MAX_STEPS) });   // a further step follows: no draw for this one
        }
      } catch (e) { if (!this.disposed && this.session === s) this._fail(e); return; }
      if (this.disposed || this.session !== s) return;
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

const abortError = () => new DOMException("the player was disposed", "AbortError");

const anySignal = (signals) => {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) { c.abort(s.reason); break; }
    s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
};
