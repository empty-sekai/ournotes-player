import { AssetStore } from "../data/assets.js";
import { cubismCore } from "./cubism.js";
import { MODEL_FRAME_RATE, ModelSession } from "./session.js";

// ModelPlayer: a ModelSession on a canvas inside a host element. It creates the canvas and its WebGL2 context (with a
// transparent, premultiplied-alpha drawing buffer: the page's background shows around the model), keeps the drawing
// buffer at the element's size in device pixels (ResizeObserver, devicePixelRatio), drives the session with
// requestAnimationFrame at 30 steps per second of game time and reports its state as events. Everything it adds lives
// in one <div> appended to the host, with its styles in that div's shadow root.
//
//   const player = await ModelPlayer.create(host, { src: "models/adv_live2d_rana_003_casual_spring_01.json" });
//   player.playMotion(player.motions[3]);
//   player.setExpression("exp_smile01");
//
// Events (CustomEvent, `detail` as noted): progress {loaded, total} (bytes, while loading), ready, play, pause,
// error {error}.

const MAX_STEPS = 4;              // steps per animation frame at most (a late frame catches up to 4 frames of game time)

const PLAYER_CSS = `
:host { all: initial; visibility: inherit; }   /* hidden with its host element */
.canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.status { position: absolute; left: 12px; bottom: 12px; color: #888; font: 12px/1.4 system-ui, sans-serif;
          white-space: pre-wrap; pointer-events: none; }
.status[hidden] { display: none; }
`;

export class ModelPlayer extends EventTarget {
  // host: an Element or a ShadowRoot. opts:
  //   src          URL of a model manifest (models/<id>.json), or
  //   assets       an AssetStore
  //   motion, expression, loop, physics, breath, seed   passed to ModelSession
  //   paused       start paused (default false)
  //   pixelRatio   device pixels per CSS pixel of the drawing buffer (default window.devicePixelRatio)
  //   signal       an AbortSignal that cancels the loading
  //   on           {type: listener}: event listeners added before the loading starts (progress, ready, error)
  // Resolves once the model is shown (the "ready" event has fired); rejects on a loading error.
  static async create(host, opts = {}) {
    const p = new ModelPlayer(host, opts);
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
    if (!host || typeof host.append !== "function") throw new TypeError("ModelPlayer: host must be an Element or a ShadowRoot");
    this.host = host;
    this.opts = opts;
    this.session = null;
    this.disposed = false;
    this._paused = !!opts.paused;
    this._abort = new AbortController();
    const doc = host.ownerDocument || document;
    const root = this.root = doc.createElement("div");
    root.className = "ournotes-live2d";
    root.style.cssText = "display:block;position:relative;width:100%;height:100%;overflow:hidden;";
    const shadow = this.shadow = root.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = PLAYER_CSS;
    const canvas = this.canvas = doc.createElement("canvas");
    canvas.className = "canvas";
    const status = this.statusEl = doc.createElement("div");
    status.className = "status";
    shadow.append(style, canvas, status);
    host.append(root);
    this._autoHeight = root.clientHeight === 0;
    if (this._autoHeight) root.style.aspectRatio = "2 / 3";       // a host without a height: a portrait box at its width
  }

  async _init() {
    const o = this.opts, signal = o.signal ? anySignal([o.signal, this._abort.signal]) : this._abort.signal;
    this._status("loading…");
    await cubismCore();                              // a page without the Core fails before downloading the model
    const mb = (n) => (n / 1048576).toFixed(1);
    const assets = o.assets || await AssetStore.fromManifest(o.src, {
      signal,
      onProgress: (loaded, total) => {
        this._status(`loading ${mb(loaded)} / ${mb(total)} MB`);
        this._emit("progress", { loaded, total });
      },
    });
    if (this.disposed) throw abortError();
    const gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
                                                  stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this._onLost = (e) => { e.preventDefault(); this._fail(new Error("the WebGL context was lost")); };
    this.canvas.addEventListener("webglcontextlost", this._onLost);
    const [w, h] = this._pixelSize();
    const session = await ModelSession.create({ gl, assets, motion: o.motion, expression: o.expression, loop: o.loop,
                                                physics: o.physics !== false, breath: o.breath !== false, seed: o.seed,
                                                width: w, height: h });
    if (this.disposed) { await session.dispose(); throw abortError(); }
    this.session = session;
    if (this._autoHeight) {                                        // the box takes the model canvas' proportions
      const c = session.character.core.canvas;
      this.root.style.aspectRatio = `${c.CanvasWidth} / ${c.CanvasHeight}`;
    }
    session.render();
    this._observe();
    this._status("");
    this._drive();
    this._emit("ready");
  }

  // ------------------------------------------------------------------------------------------------ public API
  get info() { return this.session ? this.session.info : null; }
  get name() { return this.session ? this.session.name : ""; }
  get motions() { return this.session ? this.session.motions.slice() : []; }
  get expressions() { return this.session ? this.session.expressions.slice() : []; }
  get defaultMotion() { return this.session ? this.session.defaultMotion : ""; }
  get defaultExpression() { return this.session ? this.session.defaultExpression : ""; }
  get motion() { return this.session ? this.session.motion : ""; }
  get expression() { return this.session ? this.session.expression : ""; }
  get motionPlaying() { return !!this.session && this.session.motionPlaying; }
  get physics() { return !!this.session && this.session.physics; }
  set physics(on) { this._need().setPhysics(!!on); }
  get hasPhysics() { return !!this.session && this.session.hasPhysics; }
  get breath() { return !!this.session && this.session.breath; }
  set breath(on) { this._need().setBreath(!!on); }
  get paused() { return this._paused; }

  // plays a motion (fade: fade-in seconds, -1 = the motion's own; loop: replay it); takes effect at the next frame
  playMotion(name, opts) { this._need().playMotion(name, opts); }
  // sets an expression (fade: fade-in seconds, -1 = the expression's own)
  setExpression(name, opts) { this._need().setExpression(name, opts); }

  play() {
    if (!this._paused) return;
    this._paused = false;
    this._emit("play");
  }

  pause() {
    if (this._paused) return;
    this._paused = true;
    this._emit("pause");
  }

  // stops the player and removes it from the host; the WebGL context is released
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._running = false;
    this._abort.abort();
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.session) await this.session.dispose();
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
    if (!this.session) throw new Error(this.disposed ? "ModelPlayer: disposed" : "ModelPlayer: not ready");
    return this.session;
  }

  _emit(type, detail = null) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _status(msg) { this.statusEl.textContent = msg; this.statusEl.hidden = !msg; }

  _fail(e) {
    this._running = false;
    this._status(`error: ${e && e.message ? e.message : e}`);
    this._emit("error", { error: e });
  }

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
      if (this._paused && !s.busy) s.render();                  // no step follows while paused: draw now
    });
    try { this._ro.observe(this.root, { box: "device-pixel-content-box" }); } catch (_) { this._ro.observe(this.root); }
  }

  // requestAnimationFrame paces the session; every step advances one frame of game time (1/30 s). An animation frame
  // runs the steps that are due (at most 4, drawing only the last), so game time keeps real time on any display rate.
  _drive() {
    const s = this.session, dt = 1 / MODEL_FRAME_RATE;
    let acc = 0, last = performance.now();
    this._running = true;
    const tick = async (now) => {
      if (!this._running || this.disposed) return;
      if (this._paused) { acc = 0; last = now; this._raf = requestAnimationFrame(tick); return; }
      acc = Math.min(acc + (now - last) / 1000, dt * MAX_STEPS);
      last = now;
      let n = 0;
      try {
        while (acc >= dt && n < MAX_STEPS && !this._paused && !this.disposed) {
          acc -= dt; n++;
          await s.step({ draw: !(acc >= dt && n < MAX_STEPS) });   // a further step follows: no draw for this one
        }
      } catch (e) { if (!this.disposed) this._fail(e); return; }
      if (this.disposed) return;
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
