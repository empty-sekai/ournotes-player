import { AssetStore } from "../data/assets.js";
import { ChartSession } from "../live/session.js";
import { ChartControls, PLAYER_CSS } from "./controls.js";

// ChartPlayer: a ChartSession on a canvas inside a host element. It creates the canvas and its WebGL2 context, keeps
// the drawing buffer at the element's size in device pixels (ResizeObserver, devicePixelRatio), drives the session
// with requestAnimationFrame and reports its state as events. Everything it adds lives in one <div> appended to the
// host, with its styles in that div's shadow root.
//
//   const player = await ChartPlayer.create(host, { src: "charts/100001_expert.json" });
//   player.addEventListener("ended", () => { ... });
//   await player.play();          // from a user gesture: it resumes the AudioContext
//
// Events (CustomEvent, `detail` as noted): ready, play, pause, seeked {time}, timeupdate {time} (at most every 250 ms
// while playing, and after a seek), ended, error {error}, progress {loaded, total} (bytes, while loading).

const TIMEUPDATE_MS = 250;
const MAX_STEPS = 4;              // steps per animation frame at most (a late frame catches up to 4 frames of game time)

export class ChartPlayer extends EventTarget {
  // host: an Element or a ShadowRoot. opts:
  //   src          URL of a chart manifest (charts/<id>.json), or
  //   assets       an AssetStore
  //   controls     show the control bar (default true)
  //   autoplay     start playing once loaded (default false); a browser that blocks audio without a user gesture
  //                keeps the player paused until play() is called from a gesture
  //   speed        playback speed (default 1), music / se (default true)
  //   quality, seed, audioContext   passed to ChartSession
  //   pixelRatio   device pixels per CSS pixel of the drawing buffer (default window.devicePixelRatio)
  //   signal       an AbortSignal that cancels the loading
  //   on           {type: listener}: event listeners added before the loading starts (progress, ready, error)
  // Resolves once the chart is ready (the "ready" event has fired); rejects on a loading error.
  static async create(host, opts = {}) {
    const p = new ChartPlayer(host, opts);
    for (const [type, fn] of Object.entries(opts.on || {})) p.addEventListener(type, fn);
    try {
      await p._init();
    } catch (e) {
      if (!p.disposed) { p._fail(e); await p.dispose(); }
      throw e;
    }
    return p;
  }

  constructor(host, opts) {
    super();
    if (!host || typeof host.append !== "function") throw new TypeError("ChartPlayer: host must be an Element or a ShadowRoot");
    this.host = host;
    this.opts = opts;
    this.session = null;
    this.disposed = false;
    this._abort = new AbortController();
    const doc = host.ownerDocument || document;
    const root = this.root = doc.createElement("div");
    root.className = "ournotes-player";
    root.style.cssText = "display:block;position:relative;width:100%;height:100%;overflow:hidden;background:#000;outline:none;";
    root.tabIndex = 0;                                     // keys reach the player while it has the focus
    const shadow = this.shadow = root.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = PLAYER_CSS;
    const canvas = this.canvas = doc.createElement("canvas");
    canvas.className = "canvas";
    const status = this.statusEl = doc.createElement("div");
    status.className = "status";
    shadow.append(style, canvas, status);
    host.append(root);
    if (root.clientHeight === 0) root.style.aspectRatio = "16 / 9";   // a host without a height: 16:9 at its width
  }

  async _init() {
    const o = this.opts, signal = o.signal ? anySignal([o.signal, this._abort.signal]) : this._abort.signal;
    this._status("loading…");
    const mb = (n) => (n / 1048576).toFixed(1);
    const assets = o.assets || await AssetStore.fromManifest(o.src, {
      signal,
      onProgress: (loaded, total) => {
        this._status(`loading ${mb(loaded)} / ${mb(total)} MB`);
        this._emit("progress", { loaded, total });
      },
    });
    if (this.disposed) throw abortError();
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
                                                  premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this._onLost = (e) => { e.preventDefault(); this._fail(new Error("the WebGL context was lost")); };
    this.canvas.addEventListener("webglcontextlost", this._onLost);
    const [w, h] = this._pixelSize();
    const session = await ChartSession.create({ gl, assets, audioContext: o.audioContext, quality: o.quality, seed: o.seed,
                                                width: w, height: h });
    if (this.disposed) { await session.dispose(); throw abortError(); }
    this.session = session;
    if (o.speed !== undefined && o.speed !== null && Number(o.speed) !== 1) session.setSpeed(Number(o.speed));
    if (o.music === false) session.setMusic(false);
    if (o.se === false) session.setSe(false);
    session.render();
    this._observe();
    this._keys = (e) => { if (this._ui) this._ui.key(e); };
    this.root.addEventListener("keydown", this._keys);
    this._focus = () => this.root.focus({ preventScroll: true });
    this.root.addEventListener("pointerdown", this._focus);
    if (o.controls !== false) this._ui = new ChartControls(this);
    this._status("");
    this._drive();
    this._emit("ready");
    if (o.autoplay) await this._autoplay();
  }

  // ------------------------------------------------------------------------------------------------ public API
  get currentTime() { return this.session ? this.session.positionMs() : 0; }
  set currentTime(ms) { this.seek(ms).catch((e) => this._fail(e)); }
  get duration() { return this.session ? this.session.durationMs() : NaN; }
  get paused() { return !this.session || !this.session.playing; }
  get ended() { return !!this.session && this.session.ended; }
  get speed() { return this.session ? this.session.speed : 1; }
  set speed(r) { this._need().setSpeed(Number(r)); this._changed(); }
  get music() { return !!this.session && this.session.musicOn; }
  set music(on) { this._need().setMusic(!!on); this._changed(); }
  get se() { return !!this.session && this.session.seOn; }
  set se(on) { this._need().setSe(!!on); this._changed(); }
  get audioAvailable() { return !!this.session && this.session.audioAvailable; }
  get chart() { return this.session ? this.session.chart : null; }
  // the control bar on / off
  get controls() { return !!this._ui; }
  set controls(on) {
    if (!!on === !!this._ui || !this.session) return;
    if (on) this._ui = new ChartControls(this);
    else { this._ui.dispose(); this._ui = null; }
  }

  // play / resume; call it from a user gesture (it resumes the AudioContext). At the end of the chart: from the start.
  async play() {
    const s = this._need();
    if (s.playing) return;
    const done = s.play();                                        // resumes the AudioContext synchronously
    if (this._ui) this._ui.big.hidden = true;
    await done;
    this._wasEnded = false;
    if (this._announced) return;                                  // an earlier play() (a pending autoplay) announced it
    this._announced = true;
    this._emit("play");
    this._changed();
  }

  async pause() {
    const s = this._need();
    if (!s.playing) return;
    await s.pause();
    this._announced = false;
    this._emit("pause");
    this._changed();
  }

  // seek to chart time `ms`; resolves to the chart time reached (the last frame at or before `ms`)
  async seek(ms) {
    const s = this._need();
    const t = await s.seek(Number(ms));
    if (!s.ended) this._wasEnded = false;
    this._emit("seeked", { time: t });
    this._emit("timeupdate", { time: t });
    this._changed();
    return t;
  }

  // stops the player and removes it from the host; the WebGL context is released
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._running = false;
    this._abort.abort();
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this._ui) this._ui.dispose();
    this.root.removeEventListener("keydown", this._keys);
    this.root.removeEventListener("pointerdown", this._focus);
    if (this.session) await this.session.dispose();
    if (this.gl) {
      this.canvas.removeEventListener("webglcontextlost", this._onLost);
      const lose = this.gl.getExtension("WEBGL_lose_context");
      if (lose && lose.loseContext) lose.loseContext();   // frees the context's GPU memory now
    }
    this.root.remove();
    this.session = null; this.gl = null;
  }

  // ------------------------------------------------------------------------------------------------ internals
  _need() {
    if (!this.session) throw new Error(this.disposed ? "ChartPlayer: disposed" : "ChartPlayer: not ready");
    return this.session;
  }

  _emit(type, detail = null) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _status(msg) { this.statusEl.textContent = msg; this.statusEl.hidden = !msg; }

  _fail(e) {
    this._running = false;
    this._status(`error: ${e && e.message ? e.message : e}`);
    this._emit("error", { error: e });
  }

  _changed() { if (this._ui) this._ui.refresh(); }

  // Autoplay: play without a user gesture. A browser that keeps the AudioContext locked leaves its resume pending (or
  // refuses it); the player then stays paused with the big play button shown, and the first play() from a gesture
  // unlocks the audio and starts the chart.
  async _autoplay() {
    const started = this.play();
    const locked = await Promise.race([started.then(() => false, () => true),
                                       new Promise((r) => setTimeout(() => r(true), 300))]);
    if (!locked || this.disposed) return;
    if (this._ui) this._ui.big.hidden = false;
    this._changed();
  }

  // drawing buffer size: the root's content box in device pixels
  _pixelSize(entry = null) {
    const dpr = this.opts.pixelRatio || this.root.ownerDocument.defaultView.devicePixelRatio || 1;
    if (entry && entry.devicePixelContentBoxSize && !this.opts.pixelRatio) {
      const b = entry.devicePixelContentBoxSize[0];
      return [Math.max(1, b.inlineSize), Math.max(1, b.blockSize)];
    }
    const r = entry ? entry.contentRect : this.root.getBoundingClientRect();
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
      if (s.paused && !s.busy) s.render();                      // no step follows while paused: draw now
    });
    try { this._ro.observe(this.root, { box: "device-pixel-content-box" }); } catch (_) { this._ro.observe(this.root); }
  }

  // requestAnimationFrame paces the session; every step advances one frame of game time (1/60 s x speed). A late
  // animation frame runs the steps that are due (at most 4, drawing only the last), so game time keeps real time on
  // a display slower than 60 Hz. No step runs while paused or busy (seek).
  _drive() {
    const s = this.session, dt = s.loop.fixedDelta;
    let acc = 0, last = performance.now(), lastUpdate = 0;
    this._running = true;
    const tick = async (now) => {
      if (!this._running || this.disposed) return;
      if (s.paused || s.busy) { acc = 0; last = now; this._raf = requestAnimationFrame(tick); return; }
      acc = Math.min(acc + (now - last) / 1000, dt * MAX_STEPS);
      last = now;
      let n = 0;
      try {
        while (acc >= dt && n < MAX_STEPS && !s.paused && !s.seeking && !this.disposed) {
          acc -= dt; n++;
          await s.step({ draw: !(acc >= dt && n < MAX_STEPS) });   // a further step follows: no draw for this one
        }
      } catch (e) { if (!this.disposed) this._fail(e); return; }
      if (this.disposed) return;
      if (n) {
        if (s.ended && !this._wasEnded) {
          this._wasEnded = true;
          this._announced = false;
          this._emit("timeupdate", { time: s.positionMs() });
          this._emit("pause");
          this._emit("ended");
        } else if (now - lastUpdate >= TIMEUPDATE_MS && s.playing) {
          lastUpdate = now;
          this._emit("timeupdate", { time: s.positionMs() });
        }
        if (this._ui) this._ui.refresh();
      }
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
