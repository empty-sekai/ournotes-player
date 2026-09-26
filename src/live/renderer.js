import { F } from "../engine/core.js";
import { UnityProgram } from "../engine/glsl.js";
import { mat4 } from "../engine/math.js";
import { URPPost } from "../engine/postfx.js";
import { Prefab } from "../engine/prefab.js";
import { GLTarget, GLTex } from "../engine/texture.js";
import { LiveRenderCanvas } from "./canvas.js";

// LiveRenderer and LiveCameraMath: the live screen renderer. The three live cameras that draw in
// LightWeight mode, their render targets, per-camera submission and Unity's sorting, the effect camera's URP post
// (URPPost) and the LiveMainCamera composite (RenderCanvas) to the output canvas.
//
// Cameras (all Base, empty stacks; render order = camera depth):
//   effect  LiveGameView/LiveGameCamera/LiveEffectCamera  depth 3  layer 29 -> "LiveGameView_Effect"
//           (int)(W*e) x (int)(H*e), RGB111110Float, post on (Bloom from LiveGameVolume, FXAA)
//   game    LiveGameView/LiveGameCamera                     depth 4  layer 25 -> "LiveGameView_InGame" W x H ARGB32
//   main    Live/LiveMainCamera                             depth 5  ortho 5.4 -> screen (via an HDR intermediate)
// The stage camera, sub cameras and the stage RT do not exist in LightWeight mode (LiveBackgroundView disabled).
//
// Sorting rule implemented for every camera (Unity ScriptableRenderContext.DrawRenderers as URP's forward renderer
// calls it; the renderer data's opaque / transparent layer masks decide which queues a camera draws):
//   1. opaque range (queue <= 2500) first, if the camera's renderer has the layer in its opaque mask (LiveGame {25},
//      LiveGameEffect {} -> the effect camera draws no opaque-queue item), then the transparent range (queue > 2500);
//   2. inside a range: sortingLayer (layer value), then sortingOrder, then queue;
//   3. then distance: opaque front to back, transparent back to front (item.distance, larger = farther);
//   4. ties keep submission order.
// ENGINE: Unity's sort keys (2, 3) are native; the documented priority is used, ties in submission order.
// The SortingLayer criterion is taken to include the order in layer (the documented 2D sorting priority:
// layer/order, render queue, distance), the opaque QuantizedFrontToBack buckets are taken as plain front to back,
// and the engine's final tie-breaks (material / instance ids) are replaced by submission order.

export const LIVE_QUALITY = { High: 0, Middle: 1, Low: 2 };

// ------------------------------------------------------------------------------------------ camera math (no GL)
export const LiveCameraMath = {
  REF_ASPECT: F(1.7777778),

  // LiveGameView.FullInitialize: a = (float)w / (float)h, clamped to 16:9 from above, then
  // CalcVerticalFovKeepingHorizontal(54, 1.7777778, a), all float32.
  // ENGINE: tanf / atanf are the device libm's; here double precision rounded to float32 (within one float ulp).
  laneFov(w, h) {
    const a0 = F(F(w) / F(h));
    const a = a0 <= LiveCameraMath.REF_ASPECT ? a0 : LiveCameraMath.REF_ASPECT;
    let v = F(Math.tan(F(F(F(54 * F(0.017453292)) * 0.5))));
    v = F(Math.atan(F(v * LiveCameraMath.REF_ASPECT)));
    v = F(Math.tan(F(F(v + v) * 0.5)));
    v = F(Math.atan(F(v / a)));
    return { aspect: a0, clampedAspect: a, fov: F(F(v + v) * F(57.29578)) };
  },

  // Camera.worldToCameraMatrix: inverse of the camera transform (rotation + translation) with z negated
  worldToCamera(localToWorld) { return mat4.mul(mat4.scale(1, 1, -1), mat4.inverseRigid(localToWorld)); },

  // Camera.cameraToWorldMatrix = inverse(worldToCameraMatrix)
  cameraToWorld(localToWorld) {
    const m = Float32Array.from(localToWorld);
    m[8] = -m[8]; m[9] = -m[9]; m[10] = -m[10];
    return m;
  },

  // Matrix4x4.Ortho(-size*aspect, size*aspect, -size, size, near, far) (OpenGL clip space)
  ortho(size, aspect, near, far) {
    const m = new Float32Array(16);
    const r = size * aspect, t = size;
    m[0] = 1 / r; m[5] = 1 / t; m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near); m[15] = 1;
    return m;
  },

  // world point -> target pixel (origin top-left, y down)
  project(viewProj, p, w, h) {
    const x = viewProj[0] * p.x + viewProj[4] * p.y + viewProj[8] * p.z + viewProj[12];
    const y = viewProj[1] * p.x + viewProj[5] * p.y + viewProj[9] * p.z + viewProj[13];
    const ww = viewProj[3] * p.x + viewProj[7] * p.y + viewProj[11] * p.z + viewProj[15];
    return { x: (x / ww * 0.5 + 0.5) * w, y: (1 - (y / ww * 0.5 + 0.5)) * h, w: ww };
  },

  // RenderTexture sizes: in-game W x H; effect (int)(W*e) x (int)(H*e) (float32 product, truncation)
  targets(W, H, effectScale) {
    return { inGame: { w: W, h: H },
             effect: { w: Math.trunc(F(F(W) * F(effectScale))), h: Math.trunc(F(F(H) * F(effectScale))) } };
  },
};

// A camera of the live scene: transform + the serialized Camera / UniversalAdditionalCameraData values.
export class LiveCamera {
  constructor(name, transform, cam, extra = {}) {
    this.name = name;
    this.transform = transform;
    this.orthographic = !!cam.orthographic;
    this.orthoSize = cam["orthographic size"];
    this.fov = cam["field of view"];
    this.near = cam["near clip plane"];
    this.far = cam["far clip plane"];
    this.clearFlags = cam.m_ClearFlags;                  // 2 SolidColor
    const b = cam.m_BackGroundColor;
    this.clearColor = [b.r, b.g, b.b, b.a];
    this.depth = cam.m_Depth;
    this.cullingMask = cam.m_CullingMask.m_Bits;
    this.hdr = !!cam.m_HDR;
    Object.assign(this, extra);
  }

  // per-frame camera matrices for a target of w x h (Camera.aspect = target width / height)
  matrices(w, h) {
    const L = this.transform.localToWorld();
    const view = LiveCameraMath.worldToCamera(L);
    const aspect = F(F(w) / F(h));
    const proj = this.orthographic ? LiveCameraMath.ortho(this.orthoSize, aspect, this.near, this.far)
                                   : mat4.perspective(this.fov, aspect, this.near, this.far);
    return { view, proj, viewProj: mat4.mul(proj, view), position: { x: L[12], y: L[13], z: L[14] },
             worldToCamera: view, cameraToWorld: LiveCameraMath.cameraToWorld(L), localToWorld: L, aspect };
  }
};

// general 4x4 inverse (column-major), float32 result
LiveCameraMath.inverse = (m) => {
  const a = Array.from(m), inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) throw new Error("singular matrix");
  return Float32Array.from(inv, (v) => v / det);
};

LiveCameraMath.det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) +
                                m[8] * (m[1] * m[6] - m[5] * m[2]);

// Per-camera constants URP sets before a camera's passes (UnityPerFrame / UnityPerCamera), GLES: no projection
// flip for render textures (_ProjectionParams.x = 1), no reversed z.
LiveCameraMath.globals = (cam, m, w, h, time, dt) => {
  const n = cam.near, f = cam.far, P = m.proj, iv = LiveCameraMath.inverse;
  const zx = 1 - f / n, zy = f / n;
  const ow = cam.orthographic ? cam.orthoSize * m.aspect : 0, oh = cam.orthographic ? cam.orthoSize : 0;
  return {
    unity_MatrixV: m.view, unity_MatrixInvV: iv(m.view), unity_MatrixP: P, unity_MatrixInvP: iv(P),
    unity_MatrixVP: m.viewProj, unity_MatrixInvVP: iv(m.viewProj), glstate_matrix_projection: P,
    unity_CameraProjection: P, unity_CameraInvProjection: iv(P), unity_CameraToWorld: m.cameraToWorld,
    unity_WorldToCamera: m.worldToCamera,
    _WorldSpaceCameraPos: [m.position.x, m.position.y, m.position.z, 0],
    _ProjectionParams: [1, n, f, 1 / f], _ScreenParams: [w, h, 1 + 1 / w, 1 + 1 / h],
    _ZBufferParams: [zx, zy, zx / f, zy / f], unity_OrthoParams: [ow, oh, 0, cam.orthographic ? 1 : 0],
    _Time: [time / 20, time, time * 2, time * 3], _SinTime: [Math.sin(time / 8), Math.sin(time / 4), Math.sin(time / 2), Math.sin(time)],
    _CosTime: [Math.cos(time / 8), Math.cos(time / 4), Math.cos(time / 2), Math.cos(time)],
    unity_DeltaTime: [dt, dt ? 1 / dt : 0, dt, dt ? 1 / dt : 0], _TimeParameters: [time, Math.sin(time), Math.cos(time), 0],
    _GlobalMipBias: [0, 0],
  };
};

// UnityPerDraw for a renderer with no lighting data (unlit live content): the engine defaults.
// unity_RenderingLayer: asfloat(renderingLayerMask 1).
// ENGINE: the probe / lightmap members are set natively; Unity's defaults for a renderer without probes are used.
// One sheet per draw, read by name (UnityProgram.lookup): the members that depend on the matrix are computed when a
// program reads them, the constant members are shared and frozen.
class LivePerObject {
  #inverse = null;

  constructor(M) {
    this.unity_ObjectToWorld = M;
    this.unity_MatrixPreviousM = M;
  }

  get unity_WorldToObject() {
    // ENGINE: world-to-object of a zero-scale transform is native; zeros are passed (the draw covers no pixel).
    // A zero-scale transform (e.g. an effect whose animated scale reaches 0) has no inverse; every vertex then maps to
    // one point, so the draw covers no pixel whatever unity_WorldToObject holds.
    if (!this.#inverse) {
      const M = this.unity_ObjectToWorld;
      this.#inverse = LiveCameraMath.det3(M) === 0 ? new Float32Array(16) : LiveCameraMath.inverse(M);
    }
    return this.#inverse;
  }

  get unity_MatrixPreviousMI() { return this.unity_WorldToObject; }
  get unity_WorldTransformParams() { return [0, 0, 0, LiveCameraMath.det3(this.unity_ObjectToWorld) < 0 ? -1 : 1]; }
  get unity_LightIndices() { return new Float32Array(8); }
}
const renderingLayer1 = new Float32Array(new Uint32Array([1]).buffer)[0];
for (const [k, v] of Object.entries({
  unity_LODFade: [0, 0, 0, 0], unity_RenderingLayer: [renderingLayer1, 0, 0, 0], unity_LightData: [0, 0, 0, 0],
  unity_ProbesOcclusion: [1, 1, 1, 1], unity_SpecCube0_HDR: [1, 1, 0, 0], unity_SpecCube1_HDR: [1, 1, 0, 0],
  unity_SpecCube0_BoxMax: [0, 0, 0, 0], unity_SpecCube0_BoxMin: [0, 0, 0, 0], unity_SpecCube0_ProbePosition: [0, 0, 0, 0],
  unity_SpecCube1_BoxMax: [0, 0, 0, 0], unity_SpecCube1_BoxMin: [0, 0, 0, 0], unity_SpecCube1_ProbePosition: [0, 0, 0, 0],
  unity_LightmapST: [1, 1, 0, 0], unity_DynamicLightmapST: [1, 1, 0, 0],
  unity_SHAr: [0, 0, 0, 0], unity_SHAg: [0, 0, 0, 0], unity_SHAb: [0, 0, 0, 0], unity_SHBr: [0, 0, 0, 0],
  unity_SHBg: [0, 0, 0, 0], unity_SHBb: [0, 0, 0, 0], unity_SHC: [0, 0, 0, 0],
  unity_RendererBounds_Min: [0, 0, 0, 0], unity_RendererBounds_Max: [0, 0, 0, 0], unity_MotionVectorsParams: [0, 0, 0, 0],
})) Object.defineProperty(LivePerObject.prototype, k, { value: Object.freeze(v), enumerable: true });

LiveCameraMath.perObject = (M) => new LivePerObject(M);

// Unity's per-camera draw order (header comment).
LiveCameraMath.sortItems = (items, opaqueDrawn = true) => {
  const tagged = items.map((it, i) => ({ it, i }));
  const opaque = tagged.filter((e) => e.it.queue <= 2500), transparent = tagged.filter((e) => e.it.queue > 2500);
  const key = (a, b) => (a.it.sortingLayer || 0) - (b.it.sortingLayer || 0) || a.it.sortingOrder - b.it.sortingOrder ||
                        a.it.queue - b.it.queue;
  opaque.sort((a, b) => key(a, b) || (a.it.distance - b.it.distance) || a.i - b.i);
  transparent.sort((a, b) => key(a, b) || (b.it.distance - a.it.distance) || a.i - b.i);
  return [...(opaqueDrawn ? opaque : []), ...transparent].map((e) => e.it);
};

// ------------------------------------------------------------------------------------------------ renderer
// `scene` = parsed livescene/scene.json, `lib` = ShaderLib over "livescene/shaders", `loop` = PlayerLoop.
// Screen size: resize(W, H) (Screen.width / height; LiveGameView.FullInitialize runs again on a size change).
// `settings`: the live settings (settings.js) read by the lane and the render canvas; absent: the data's defaults.
export class LiveRenderer {
  constructor(gl, lib, scene, loop, { quality = LIVE_QUALITY.Middle, base = "livescene", settings } = {}) {
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is required");
    this.gl = gl; this.lib = lib; this.scene = scene; this.loop = loop; this.base = base; this.settings = settings;
    gl.frontFace(gl.CW);                    // Unity's front-face convention with its world-to-camera matrix
    this.vao = gl.createVertexArray();
    this.post = new URPPost(gl, lib, { vao: this.vao });
    this.prefab = new Prefab(scene.scene);
    // MasterLiveQualitySettings row of the LiveQuality
    this.qualityRow = scene.master.liveQualitySettings.find((r) => r._quality === quality);
    if (!this.qualityRow) throw new Error(`no MasterLiveQualitySettings for quality ${quality}`);
    this.quality = quality;
    const camera = (path, name, extra) => {
      const t = this.prefab.transform(path);
      return new LiveCamera(name, t, this.prefab.component(path, "Camera"),
                               { uacd: this.prefab.component(path, "UniversalAdditionalCameraData"), ...extra });
    };
    this.cameras = {
      effect: camera("LiveGameView/LiveGameCamera/LiveEffectCamera", "effect", { opaqueDrawn: false }),
      game: camera("LiveGameView/LiveGameCamera", "game", { opaqueDrawn: true }),
      main: camera("Live/LiveMainCamera", "main", { opaqueDrawn: true }),
    };
    this.queues = { effect: [], game: [], main: [] };
    this.size = null;
    this.stats = { dropped: 0, drawn: { effect: 0, game: 0, main: 0 } };
    this.canvas = null;                     // LiveRenderCanvas (canvas.js), set by load()
    this.effectStack = this._effectStack();
  }

  // LiveEffectCamera's Volume (LiveGameVolume, global, priority 0) after
  // LiveViewPresenter.ApplyQualityEffectBloomSettings -> QualityConstants.ApplyQualityBloomMaxIterations:
  // quality != High -> maxIterations.Override(max(4, value - 1)) on the shared profile (applied once here).
  _effectStack() {
    const vol = this.prefab.component("LiveGameView/LiveGameCamera/LiveEffectCamera", "Volume");
    const profile = JSON.parse(JSON.stringify(vol.sharedProfile));
    if (this.quality !== LIVE_QUALITY.High)
      for (const c of profile.components)
        if (c.asset === "Bloom") c.maxIterations = { m_OverrideState: 1, m_Value: Math.max(4, c.maxIterations.m_Value - 1) };
    return URPPost.evaluateStack([{ profile, weight: vol.weight }]);
  }

  async load() {
    const gl = this.gl;
    this.tex = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"),
      black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"),
      clear: GLTex.solid(gl, [0, 0, 0, 0], "clear"),
    };
    // SiriusPostProcessData of ForwardRendererLiveGameEffect (film grain textures; FilmGrain is off in LiveGameVolume)
    this.grain = await URPPost.loadGrain(gl, this.base, this.scene.postTextures.ForwardRendererLiveGameEffect.filmGrainTex);
    this.post.initLut();
    this.canvas = new LiveRenderCanvas(this);
    await this.canvas.load();
  }

  // ------------------------------------------------------------------------------ targets
  resize(W, H) {
    if (this.size && this.size.W === W && this.size.H === H) return;
    const gl = this.gl;
    for (const t of Object.values(this.rt || {})) t.release();
    const sz = LiveCameraMath.targets(W, H, this.qualityRow._effectRenderingScale);
    this.size = { W, H, ...sz };
    const F16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    this.rt = {
      // "LiveGameView_InGame": RenderTextureFormat.ARGB32 + depth-stencil (SystemInfo depth-stencil format)
      // ENGINE: the depth-stencil format is device dependent; D24S8 here.
      inGame: new GLTarget(gl, W, H, { depth: true, label: "LiveGameView_InGame" }),
      // "LiveGameView_Effect": RenderTextureFormat.RGB111110Float (22) = WebGL2 R11F_G11F_B10F (the same format)
      effect: new GLTarget(gl, sz.effect.w, sz.effect.h, { internal: gl.R11F_G11F_B10F, format: gl.RGB,
                                                             type: gl.UNSIGNED_INT_10F_11F_11F_REV, label: "LiveGameView_Effect" }),
      // effect camera colour attachment (HDR, post on). URP picks B10G11R11 or RGBA16F for the HDR camera target
      // depending on a player setting; RGBA16F is assumed here.
      effectColor: new GLTarget(gl, sz.effect.w, sz.effect.h, { ...F16, depth: true, label: "_CameraColorAttachment(effect)" }),
      effectPost: new GLTarget(gl, sz.effect.w, sz.effect.h, { ...F16, label: "_CameraColorAttachment(effect, after uber)" }),
      // LiveMainCamera: HDR on, target = back buffer -> URP renders into an HDR intermediate, then the final blit
      // (same format choice)
      mainColor: new GLTarget(gl, W, H, { ...F16, label: "_CameraColorAttachment(main)" }),
    };
    this.post.resizeBloom(sz.effect.w, sz.effect.h);
    // LiveGameView.FullInitialize: FOV of both lane cameras. Its one-time GL.Clear of both RTs
    // (ClearRenderTexture) is covered by every frame's camera clear.
    const fov = LiveCameraMath.laneFov(W, H).fov;
    this.cameras.game.fov = fov; this.cameras.effect.fov = fov;
    this.canvas.resize(W, H);
  }

  // ------------------------------------------------------------------------------ submission
  submit(camera, item) {
    const q = this.queues[camera];
    if (!q) throw new Error(`unknown live camera ${camera}`);
    if (typeof item.draw !== "function" || typeof item.sortingOrder !== "number" || typeof item.queue !== "number")
      throw new Error(`bad render item for ${camera}`);
    q.push({ sortingLayer: 0, distance: 0, ...item });
  }

  // frames other modules position their objects in; matrices are column-major
  get frames() {
    const L = this.cameras.game.transform.localToWorld();
    return {
      game: { localToWorld: L, cameraToWorld: LiveCameraMath.cameraToWorld(L),
              worldToCamera: LiveCameraMath.worldToCamera(L),
              screenRoot: this.prefab.transform("LiveGameView/LiveGameCamera/screen_root").localToWorld(),
              fov: this.cameras.game.fov },
      laneJudgementRoot3D: this.prefab.transform("LiveGameView/root/LiveGameLane/judgement_root").localToWorld(),
      transform: (path) => this.prefab.transform(path),          // any scene node (Transform)
    };
  }

  _ctx(cam, w, h) {
    const m = cam.matrices(w, h), gl = this.gl;
    const globals = LiveCameraMath.globals(cam, m, w, h, this.loop.time, this.loop.deltaTime);
    return { gl, lib: this.lib, camera: m, globals, perObject: (M) => LiveCameraMath.perObject(M),
             target: { width: w, height: h }, name: cam.name, tex: this.tex, vao: this.vao };
  }

  _drawCamera(name, target, w, h) {
    const gl = this.gl, cam = this.cameras[name];
    target.bind();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMask(0xff);
    const c = cam.clearColor;                 // clear flags SolidColor (2): colour + depth + stencil
    gl.clearColor(c[0], c[1], c[2], c[3]); gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const ctx = this._ctx(cam, w, h);
    const all = this.queues[name];
    const list = LiveCameraMath.sortItems(all, cam.opaqueDrawn);
    this.stats.dropped += all.length - list.length;
    for (const it of list) { target.bind(); it.draw(ctx); }
    this.stats.drawn[name] = list.length;
    return ctx;
  }

  // ------------------------------------------------------------------------------ frame
  // Call once per frame in the render hook after every submit; `viewport` (optional) = {x, y, w, h} of the canvas.
  render(viewport) {
    const S = this.size, R = this.rt;
    if (!S) throw new Error("LiveRenderer.resize() was not called");
    this.stats.dropped = 0;
    // 1. LiveEffectCamera (depth 3): layer 29 -> colour attachment, post (LUT, bloom, uber), FinalPost FXAA -> effect RT.
    //    LiveSelfRenderCamera renders it every frame (SetRenderFrame(60) in FullInitialize, 60 fps).
    this._drawCamera("effect", R.effectColor, S.effect.w, S.effect.h);
    const stack = this.effectStack;
    this.post.buildLut(stack);
    const bloom = this.post.renderBloom(stack, R.effectColor);
    this.post.uber(stack, R.effectColor, bloom, R.effectPost, { width: S.effect.w, height: S.effect.h,
                   frameCount: this.loop.frameCount, grain: this.grain, gray: this.tex.gray, black: this.tex.black });
    const aa = this.cameras.effect.uacd.m_Antialiasing === 1;               // AntialiasingMode.FastApproximateAntialiasing
    this.post.finalPost(R.effectPost, R.effect, { width: S.effect.w, height: S.effect.h, fxaa: aa });
    // 2. LiveGameCamera (depth 4): layer 25 straight into the in-game RT (no post, no HDR, no MSAA: no intermediate)
    this._drawCamera("game", R.inGame, S.W, S.H);
    // 3. LiveMainCamera (depth 5): RenderCanvas (+ other submitted canvases) -> HDR intermediate -> back buffer
    this.submit("main", this.canvas.item());
    this._drawCamera("main", R.mainColor, S.W, S.H);
    this.canvas.finalBlit(R.mainColor, viewport || { x: 0, y: 0, w: S.W, h: S.H });
    for (const k of Object.keys(this.queues)) this.queues[k] = [];
  }
};

// Unity sets vector properties as float4; a GLES program may declare them vec2 / vec3 (e.g. Sirius/Live/Sprite/Default
// `_Flip`). Returns the sheets with one sheet in front holding the looked-up values cut to the declared width (the
// components GL would read), for plain uniforms of `prog`.
export const liveFitSheets = (prog, sheets) => {
  const gl = prog.gl, width = { [gl.FLOAT_VEC2]: 2, [gl.FLOAT_VEC3]: 3 };
  const fit = {};
  for (const u of prog.uniforms) {
    const n = width[u.type];
    if (!n || u.size !== 1) continue;
    const name = UnityProgram.propertyName(u.name);
    const s = sheets.find((x) => x && name in x);
    if (!s) continue;
    const v = UnityProgram.floats(s[name], 4);
    if (v.length > n) fit[name] = Array.from(v).slice(0, n);
  }
  return [fit, ...sheets];
};

// material property sheet [floats with every scalar shader default filled in, colours as arrays] for render state
// lookups (passState reads state properties such as _ColorMask / _Stencil* from the material floats)
export const liveMaterialSheets = (lib, mat, tex) => {
  const shader = mat.shader.shader, defaults = lib.defaults(shader, tex), floats = {}, colors = {};
  for (const [k, v] of Object.entries(defaults)) if (typeof v === "number") floats[k] = v;
  Object.assign(floats, mat.floats || {});
  for (const [k, v] of Object.entries(mat.colors || {})) colors[k] = [v.r, v.g, v.b, v.a];
  for (const [k, v] of Object.entries(mat.textures || {})) colors[`${k}_ST`] = [v.scale.x, v.scale.y, v.offset.x, v.offset.y];
  return { shader, keywords: mat.keywords || [], floats, colors, defaults };
};
