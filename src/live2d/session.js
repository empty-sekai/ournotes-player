import { bindAssets, unbindAssets } from "../data/assets.js";
import { ShaderLib } from "../engine/glsl.js";
import { PlayerLoop } from "../engine/loop.js";
import { mat4 } from "../engine/math.js";
import { UnityRandom } from "../engine/random.js";
import { GLTex } from "../engine/texture.js";
import { Live2DCharacter } from "./character.js";
import { cubismCore } from "./cubism.js";
import { Live2DDrawing } from "./drawing.js";

// ModelSession: one Live2D model of the game's ADV, running idle as the story shows a character (auto eye blink,
// breath, physics, the default motion replayed, motions and expressions on request), drawn into a WebGL2 context. It
// has no DOM access: the caller owns the context and its canvas, calls step() at 30 steps per second of game time
// (ModelPlayer drives it with requestAnimationFrame) and render() / resize() as needed.
//
// Game flow reproduced:
//   load   the episode loader's LoadCharacter: Live2DCharacter.Init, Live2DCharacterController.Warmup (standby) and
//          the hide that ends it, with the player loop running (create() steps the loop until the warmup is done)
//   In     AdvInCommand (AddSpeaker) at the next frame's Update: Show with the requested motion and expression (or the
//          defaults) and fade 0, the field renderer's registration (no lighting for multiply-blend drawables,
//          brightness applied after compositing), SetIgnoreAllUpdate(false), lighting, physics and breath switches
//   frames Live2DCharacterController.OnUpdate, the Animator, OnLateUpdate and CubismModel.OnModelUpdate in Unity's
//          phase order at the ADV's 30 fps; the default motion is replayed whenever it ends (HandlingLoopMotion)
//   requests  playMotion() / setExpression() run at the next frame's Update, where the ADV runs its story commands
//          (Live2DCharacterController.PlayMotion / PlayExpression with the given fade time)
//
// Viewer choices (not the game's; docs/fidelity.md):
//   view      the model's canvas (moc3 canvas info) fitted into the drawing buffer by an orthographic camera, on a
//             transparent background; the story's stage, camera, field compositing and post-processing are not drawn
//   lighting  off (_LightingEnabled 0), as the game draws characters without Unity lighting and for an "unlit" In; the
//             main light, ambient probe and multiply texture get the neutral values below
//   return    after a motion other than the default one, the controller's next motion (NextMotionName) is the default
//             motion, so the character returns to its idle; `loop` replays the motion instead (LoopMotion)

export const MODEL_FRAME_RATE = 30;             // AdvPlayerSettings target frame rate (Application.targetFrameRate)

// neutral scene values of the Lit shader (the story's stage would provide them); unused while lighting is off
export const NEUTRAL_LIGHT = {
  _MainLightPosition: [0, 0, 1, 0],             // no visible directional light: URP's default
  _MainLightColor: [0, 0, 0, 0],
};
// ambient probe of a Flat white environment: SH(N) = 1
export const NEUTRAL_AMBIENT = {
  unity_SHAr: [0, 0, 0, 1], unity_SHAg: [0, 0, 0, 1], unity_SHAb: [0, 0, 0, 1],
  unity_SHBr: [0, 0, 0, 0], unity_SHBg: [0, 0, 0, 0], unity_SHBb: [0, 0, 0, 0], unity_SHC: [0, 0, 0, 0],
  unity_LightData: [0, 0, 0, 0],
};
export const CAMERA_NEAR = 0.3, CAMERA_FAR = 1000, CAMERA_DISTANCE = 10;   // Unity's camera defaults; camera at z = -10

// GL objects created through the session's context, deleted by dispose() (as ChartSession does). Only a
// WebGL2RenderingContext itself is tracked; a wrapped or proxied context is used as given.
const GL_OBJECTS = [["createBuffer", "deleteBuffer"], ["createTexture", "deleteTexture"],
  ["createFramebuffer", "deleteFramebuffer"], ["createRenderbuffer", "deleteRenderbuffer"],
  ["createProgram", "deleteProgram"], ["createShader", "deleteShader"], ["createVertexArray", "deleteVertexArray"]];

const trackGL = (gl) => {
  if (typeof WebGL2RenderingContext !== "function" || !(gl instanceof WebGL2RenderingContext)) return { release() {} };
  const live = new Set(), entry = new WeakMap(), wrapped = [];
  const collected = new FinalizationRegistry((e) => live.delete(e));
  for (const [c, d] of GL_OBJECTS) {
    const create = gl[c], del = gl[d];
    if (typeof create !== "function" || typeof del !== "function") continue;
    gl[c] = (...a) => {
      const o = create.apply(gl, a);
      if (o) { const e = { ref: new WeakRef(o), del: d }; live.add(e); entry.set(o, e); collected.register(o, e, e); }
      return o;
    };
    gl[d] = (o) => {
      const e = o && entry.get(o);
      if (e) { live.delete(e); entry.delete(o); collected.unregister(e); }
      return del.call(gl, o);
    };
    wrapped.push(c, d);
  }
  return {
    release() {
      for (const k of wrapped) delete gl[k];
      if (!gl.isContextLost()) for (const e of [...live].reverse()) { const o = e.ref.deref(); if (o) gl[e.del](o); }
      live.clear();
    },
  };
};

const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

export class ModelSession {
  constructor() {
    this.disposed = false;
    this.character = null; this.drawing = null; this.loop = null; this.gl = null; this.assets = null;
    this._gl = null; this._stepping = null; this._pending = []; this._noDraw = false;
  }

  // opts:
  //   gl           WebGL2RenderingContext (required); used by this session alone while it lives
  //   assets       AssetStore of the model (required): model.json and the files it names
  //   motion, expression   shown first (default: the model's default motion / expression); loop: replay that motion
  //   physics, breath      CubismPhysicsController and the harmonic breath on (default true)
  //   seed         seed of the auto eye blink's random intervals (default: from the clock)
  //   width, height  drawing buffer size in pixels (default: the canvas size)
  // Resolves once the model is loaded and shown (one frame stepped after the load).
  static async create(opts = {}) {
    const s = new ModelSession();
    try {
      await s._load(opts);
    } catch (e) {
      await s.dispose().catch(() => {});
      throw e;
    }
    return s;
  }

  async _load({ gl, assets, motion = "", expression = "", loop: loopMotion = false, physics = true, breath = true, seed,
                width, height } = {}) {
    if (!gl) throw new Error("ModelSession: a WebGL2 context is required");
    if (!assets) throw new Error("ModelSession: an AssetStore is required");
    await cubismCore();
    bindAssets(gl, assets);
    this.gl = gl; this.assets = assets;
    this._gl = trackGL(gl);
    const index = assets.json("model.json");
    if (index.format !== 1) throw new Error(`model.json: format ${index.format} is not supported (1 expected)`);
    for (const k of ["moc3", "prefab", "shaders"])
      if (typeof index[k] !== "string" || !index[k]) throw new Error(`model.json: "${k}" missing`);
    if (!/(^|\/)shaders\.json$/.test(index.shaders)) throw new Error("model.json: \"shaders\" must name a shaders.json");
    const prefab = assets.json(index.prefab);
    this.info = assets.info;
    this.seed = seed ?? (Date.now() >>> 0);
    const loop = this.loop = new PlayerLoop(MODEL_FRAME_RATE);
    const ch = this.character = new Live2DCharacter(prefab, assets.arrayBuffer(index.moc3), loop,
                                                    { random: new UnityRandom(this.seed) });
    this.motions = [...ch.clips.keys()];
    this.expressions = ch.expressions.map((e) => e.name);
    for (const [name, list] of [[motion, this.motions], [expression, this.expressions]])
      if (name && !list.includes(name)) throw new Error(`${ch.name}: no ${list === this.motions ? "motion" : "expression"} "${name}"`);
    const lib = new ShaderLib(gl, dirname(index.shaders), assets);
    gl.frontFace(gl.CW);                          // Unity's front-face convention with its world-to-camera matrix
    this.white = GLTex.solid(gl, [255, 255, 255, 255], "white");
    const drawing = this.drawing = new Live2DDrawing(gl, lib, ch, { dir: dirname(index.prefab), resources: index.resources,
                                                                    white: this.white, assets });
    await drawing.loadTextures();
    drawing.prepare();
    const c = gl.canvas;
    this._wantSize = { w: Math.max(1, Math.round(width ?? (c ? c.width : 300))),
                       h: Math.max(1, Math.round(height ?? (c ? c.height : 150))) };
    this.size = null;

    // player-loop hooks in Unity phase order; requests run in Update before the controller, as story commands do
    loop.on("update", () => {
      const p = this._pending;
      this._pending = [];
      for (const f of p) f();
      ch.update();
    });
    loop.on("animation", () => ch.animatorUpdate());
    loop.on("lateUpdate", () => ch.lateUpdate());
    loop.on("preLateEnd", () => ch.modelUpdate());
    loop.on("render", () => { if (!this._noDraw) this.render(); });

    // load: Init + Warmup (standby) + hide, with the loop running
    let done = false, error = null;
    ch.load().then(() => { done = true; }, (e) => { error = e; done = true; });
    this._noDraw = true;
    for (let n = 0; !done; n++) {
      if (n > 10 * MODEL_FRAME_RATE) throw new Error(`${ch.name}: the warmup did not finish`);
      await loop.step();
    }
    if (error) throw error;
    // In
    this._pending.push(() => {
      ch.show(motion, expression, 0);
      this._follow(motion || ch.defaultMotionName, loopMotion);
      ch.setDisableLightingForMultiplyBlendDrawables(true);     // AdvFieldRendererFeature.RegisterCharacterEntry
      ch.setUsePostCompositeBrightness(true);
      ch.setIgnoreAllUpdate(false);
      ch.setLightingEnabled(false);
      ch.setPhysicsEnabled(!!physics);
      ch.setBreathMotionEnabled(!!breath);
    });
    await loop.step();
    this._noDraw = false;
  }

  // ------------------------------------------------------------------------------------------------ state
  get name() { return this.character.name; }
  get defaultMotion() { return this.character.defaultMotionName; }
  get defaultExpression() { return this.character.defaultExpressionName; }
  // the motion / expression last requested of the controller (CurrentMotionName / CurrentExpressionName)
  get motion() { return this.character.ctl.currentMotion; }
  get expression() { return this.character.ctl.currentExpression; }
  get looping() { return this.character.ctl.loopMotion; }
  // a motion other than the default one is playing (the controller's current motion has not ended)
  get motionPlaying() { return this.character.anyMotionPlaying() && !this.character.isCurrentMotionDefault; }
  get physics() { return this.character.physicsEnabled; }
  // the model has physics (a CubismPhysicsController); without it the physics switch has no effect
  get hasPhysics() { return this.character.hasPhysics; }
  get breath() { return this.character.breathMotionEnabled; }
  // game time in seconds since the session was created
  get time() { return this.loop.time; }
  get busy() { return !!this._stepping; }

  // ------------------------------------------------------------------------------------------------ requests
  // Plays a motion (Live2DCharacterController.PlayMotion) at the next step. fade: fade-in time in seconds, -1 for the
  // motion's own (FadeInTime of its fade data); loop: replay it whenever it ends. Without loop, the default motion
  // follows it (the controller's next motion).
  playMotion(name, { fade = -1, loop = false } = {}) {
    const ch = this._need();
    if (!ch.clips.has(name)) throw new Error(`${ch.name}: no motion "${name}"`);
    const f = Number(fade);
    this._pending.push(() => { this._follow(name, loop); ch.playMotion(name, f); });
  }

  // what follows a motion when it ends (HandlingLoopMotion): the motion again (LoopMotion), else the default motion
  // (NextMotionName, its own fade-in time); the default motion itself is replayed by the controller
  _follow(name, loop) {
    const ch = this.character, c = ch.ctl, isDefault = name === ch.defaultMotionName;
    c.loopMotion = !!loop && !isDefault;
    c.nextMotion = loop || isDefault ? "" : ch.defaultMotionName;
    c.nextMotionFade = -1;
  }

  // Sets an expression (Live2DCharacterController.PlayExpression) at the next step; fade: fade-in time in seconds,
  // -1 for the expression's own.
  setExpression(name, { fade = -1 } = {}) {
    const ch = this._need();
    if (!ch.expressionIndex.has(name)) throw new Error(`${ch.name}: no expression "${name}"`);
    const f = Number(fade);
    this._pending.push(() => ch.playExpression(name, f));
  }

  setPhysics(on) { const ch = this._need(); this._pending.push(() => ch.setPhysicsEnabled(!!on)); }
  setBreath(on) { const ch = this._need(); this._pending.push(() => ch.setBreathMotionEnabled(!!on)); }

  // ------------------------------------------------------------------------------------------------ frames
  // One frame of game time (1/30 s), drawn unless draw is false. The caller paces the steps (ModelPlayer:
  // requestAnimationFrame, drawing only the last step of an animation frame). No step may start while one runs.
  async step({ draw = true } = {}) {
    if (this.disposed) throw new Error("ModelSession: disposed");
    if (this._stepping) throw new Error("ModelSession: a step is in progress");
    this._noDraw = !draw;
    this._stepping = this.loop.step();
    try { await this._stepping; } finally { this._stepping = null; this._noDraw = false; }
  }

  // Drawing buffer size in pixels, applied by the next render(): the canvas is resized and drawn in the same task.
  resize(width, height) {
    this._wantSize = { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
  }

  _applySize() {
    const { w, h } = this._wantSize, c = this.gl.canvas;
    if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    this.size = { w, h };
  }

  // world-space rectangle of the model's canvas: the moc3 canvas info in model units through the model's root
  _canvasRect() {
    const cv = this.character.core.canvas, ppu = cv.PixelsPerUnit;
    const x0 = -cv.CanvasOriginX / ppu, x1 = (cv.CanvasWidth - cv.CanvasOriginX) / ppu;
    const y0 = -(cv.CanvasHeight - cv.CanvasOriginY) / ppu, y1 = cv.CanvasOriginY / ppu;
    const M = this.character.root.localToWorld();
    const p = (x, y) => [M[0] * x + M[4] * y + M[12], M[1] * x + M[5] * y + M[13]];
    const [ax, ay] = p(x0, y0), [bx, by] = p(x1, y1);
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
  }

  // Camera globals: an orthographic camera looking along +z at the canvas rectangle, fitted into w x h (centred).
  _globals(w, h) {
    const r = this._canvasRect();
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const aspect = w / h;
    let hh = (r.y1 - r.y0) / 2, hw = (r.x1 - r.x0) / 2;
    if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const n = CAMERA_NEAR, f = CAMERA_FAR, d = CAMERA_DISTANCE;
    // worldToCameraMatrix of a camera at (cx, cy, -d) with no rotation (z negated), then the GL orthographic projection
    const V = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, -cx, -cy, -d, 1]);
    const P = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]);
    const VP = mat4.mul(P, V);
    const t = this.loop.time;
    return {
      _ProjectionParams: [1, n, f, 1 / f], unity_MatrixVP: VP, unity_MatrixV: V,
      _Time: [t / 20, t, t * 2, t * 3], _GlobalMipBias: [0, 0], _ScreenParams: [w, h, 1 + 1 / w, 1 + 1 / h],
      ...NEUTRAL_LIGHT,
    };
  }

  // draws the current state: the mask texture when flagged, then the drawables in sorting order
  render() {
    if (this.disposed) return;
    this._applySize();
    const gl = this.gl, { w, h } = this.size;
    this.drawing.renderMasks();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const frame = { globals: this._globals(w, h),
                    perObject: (tr) => ({ unity_ObjectToWorld: tr.localToWorld(), ...NEUTRAL_AMBIENT }) };
    // SortingCriteria.CommonTransparent: sorting order, then back to front (every drawable at the same distance)
    // ENGINE: the renderer sort is native; sorting order first, equal distances keep the submission (Core index) order.
    const items = this.drawing.items([]).sort((a, b) => a.sortingOrder - b.sortingOrder);
    for (const it of items) it.draw(frame);
  }

  // Releases the session: waits for a step in progress, deletes the GL objects it created, releases the Cubism model
  // and drops its state. The context and its canvas stay the caller's.
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { if (this._stepping) await this._stepping; } catch (_) { /* reported by step */ }
    if (this.loop) this.loop.cancelDelays();
    if (this.character) this.character.release();
    if (this.gl) {
      if (this._gl) this._gl.release();
      unbindAssets(this.gl, this.assets);
    }
    for (const k of ["character", "drawing", "loop", "_gl", "_pending"]) this[k] = null;
  }

  _need() {
    if (this.disposed || !this.character) throw new Error("ModelSession: disposed");
    return this.character;
  }
}
