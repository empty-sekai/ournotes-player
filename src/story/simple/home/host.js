import { join } from "../../../engine/core.js";
import { applyState } from "../../../engine/glsl.js";
import { mat4, quat } from "../../../engine/math.js";
import { CURVE_DEFAULTS, URPPost } from "../../../engine/postfx.js";
import { GLTarget, GLTex } from "../../../engine/texture.js";
import { blurPass, BLUR_SHADER, DualKawaseBlur, UIBlur } from "./blur.js";
import { HomeScene } from "./objects.js";
import { SpotCamera } from "./camera.js";
import { parseGlb } from "./glb.js";
import { checkSpotCamera, checkSpotStack, HOME_VIEW_MASK, spotMainCamera, spotVolumeStack } from "./post.js";
import { materialQueue, ShaderInfo, sortDrawItems, SpotRoom } from "./room.js";
import { skeletonDataVersion, spineRuntime, SpotSkeletonData } from "./spine.js";

// The 3D part of the home host of the simple ADV player: the live home spot drawn behind a tap or area talk
// (SpotManager with its SpotSceneRoot, SpotCameraController and UIBlurController).
//   - room: the background prefab's cards (host/spot/room.glb) with the game's shaders and the saved material values,
//     the renderers active after SpotBackground.Prepare, the floor queue override (room.js), and for the Lit materials
//     URP's lighting state of the main camera in the spot (spotLighting);
//   - Spine characters (SpotSpineCharacter / SkeletonAnimation) through the page's Spine runtime (spine.js);
//   - the main camera: default pose, focus and return tweens, Reset (camera.js), and its post-processing: the spot's
//     volume stack through the URP post chain (post.js);
//   - the UI blur: rate ramp and the Dual Kawase pass on the camera colour (blur.js).
// Scene placement (SpotSceneRoot.SetObject): the background and situation prefabs are parented under _objRoot
// keeping their local transforms; the background root then gets localPosition = backgroundPosition, eulerAngles (world)
// = backgroundRotation, localScale = backgroundScale. The situation's matrices in spot.json are prefab-space world
// matrices, so under _objRoot they are objRoot x matrix. The room file bakes each renderer's prefab-space world matrix,
// the background root's own serialized transform included: home.roomRoot ({localPosition, localRotation, localScale}
// of that root) is taken back out before the situation's transform goes on; without it the baked space is taken as the
// root's local space.
// With gl = null nothing is drawn and every timing (camera tweens, blur ramp, Spine updates) still runs.

export const SPINE_MISSING = "Spine runtime missing";
// A tap talk whose character no SpotCharacter of the spot carries: the game starts a tap talk only from a tapped
// SpotCharacter (HomeSpotAfterTalkRequestFactory.TrySelectAdv: MasterStoryHomeSpotTapTalkEpisode._spotId == the spot
// and _characterId == the tapped SpotCharacter's _characterId), so it never plays such a talk; the session plays it
// as a tap talk without the camera focus
export const NO_TAP_TARGET = "no tap target for the talk's character in the spot (camera focus not played)";

// CameraClearFlags (1 Skybox, 2 SolidColor, 3 Depth, 4 Nothing)
const CLEAR_SKYBOX = 1, CLEAR_SOLID = 2;
const IDENTITY_Q = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

const matrixOf = (a, what) => {
  if (!Array.isArray(a) || a.length !== 16) throw new Error(`${what}: not a 4 x 4 column-major matrix`);
  return Float32Array.from(a);
};
const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
const colorOf = (c) => (Array.isArray(c) ? c : c ? [c.r, c.g, c.b, c.a] : [0, 0, 0, 1]);

// SpotSceneRoot.SetObject: the background root's localToWorld under _objRoot (world TRS {position, rotation,
// scale}, or null for identity): localPosition = p, eulerAngles = e (a world rotation: localRotation =
// inverse(parent rotation) x Euler(e)), localScale = s
export const backgroundMatrix = (settings, objRoot) => {
  const p = settings.backgroundPosition, e = settings.backgroundRotation, s = settings.backgroundScale;
  if (!p || !e || !s) throw new Error("situationSettings: backgroundPosition / Rotation / Scale missing");
  const parent = objRoot ? mat4.trs(objRoot.position, objRoot.rotation, objRoot.scale) : mat4.identity();
  const parentRot = objRoot ? objRoot.rotation : IDENTITY_Q;
  const q = quat.mul(conj(parentRot), quat.euler(e.x, e.y, e.z));
  return mat4.mul(parent, mat4.trs(p, q, s));
};

// the inverse of Matrix4x4.TRS(t, q, s): S^-1 x R^-1 x T^-1
export const inverseTRS = (t, q, s) => {
  const zero = { x: 0, y: 0, z: 0 }, one = { x: 1, y: 1, z: 1 };
  return mat4.mul(mat4.scale(1 / s.x, 1 / s.y, 1 / s.z),
                  mat4.mul(mat4.trs(zero, conj(q), one), mat4.trs({ x: -t.x, y: -t.y, z: -t.z }, IDENTITY_Q, one)));
};

// localToWorld of the room file's baked space: the background root's matrix with the root's serialized transform
// (home.roomRoot, baked into every vertex) taken out
export const roomMatrix = (background, roomRoot) => {
  if (!roomRoot) return background;
  const { localPosition: t, localRotation: q, localScale: s } = roomRoot;
  if (!t || !q || !s) throw new Error("home.roomRoot: localPosition / localRotation / localScale missing");
  return mat4.mul(background, inverseTRS(t, q, s));
};

// worldToLocal of the room file's baked space (the inverse of roomMatrix: the Transform chain's inverse TRS in reverse
// order): roomRoot's TRS x the background root's inverse TRS x objRoot's inverse TRS
export const roomInverse = (settings, objRoot, roomRoot) => {
  const p = settings.backgroundPosition, e = settings.backgroundRotation, s = settings.backgroundScale;
  if (!p || !e || !s) throw new Error("situationSettings: backgroundPosition / Rotation / Scale missing");
  const parentRot = objRoot ? objRoot.rotation : IDENTITY_Q;
  let m = inverseTRS(p, quat.mul(conj(parentRot), quat.euler(e.x, e.y, e.z)), s);
  if (objRoot) m = mat4.mul(m, inverseTRS(objRoot.position, objRoot.rotation, objRoot.scale));
  if (!roomRoot) return m;
  return mat4.mul(mat4.trs(roomRoot.localPosition, roomRoot.localRotation, roomRoot.localScale), m);
};

// ------------------------------------------------------------------------------------------------ URP lighting
// UnityEngine.Rendering.Universal ShEvalMode (Auto 0, PerVertex 1, Mixed 2, PerPixel 3), LightRenderingMode (Disabled 0,
// PerPixel 1, PerVertex 2), RenderingMode (Forward 0, Deferred 1, ForwardPlus 2); UnityEngine.Rendering.AmbientMode
// (Skybox 0, Trilight 1, Flat 3, Custom 4), DefaultReflectionMode (Skybox 0, Custom 1)
const SH_AUTO = 0, SH_VERTEX = 1, SH_MIXED = 2, SH_PIXEL = 3;
const LIGHTS_DISABLED = 0, LIGHTS_PER_PIXEL = 1, LIGHTS_PER_VERTEX = 2;
const RENDERING_FORWARD = 0;
const AMBIENT_FLAT = 3;
const REFLECTION_SKYBOX = 0;
// renderer features that set lighting keywords of their own (screen-space occlusion, decals, screen-space shadows)
const LIGHTING_FEATURES = new Set(["ScreenSpaceAmbientOcclusion", "DecalRendererFeature", "ScreenSpaceShadows"]);
const white = (c) => !!c && c.r === 1 && c.g === 1 && c.b === 1;

// The lighting state URP gives the main camera's draws in the spot, which holds no light: {pipeline, renderer,
// keywords, globals, perObject}. Raises on a setting whose effect is not reproduced here.
//   graphics        story.scene `graphics`: quality levels, pipeline assets, renderers
//   quality         the quality level (GameConfig.SetBaseQualityModeInternal: QualitySettings.SetQualityLevel(
//                   BaseQualityMode)); its pipeline asset, else GraphicsSettings' default one
//   rendererIndex   the camera's UniversalAdditionalCameraData m_RendererIndex (-1: the asset's default renderer)
//   renderSettings  the active scene's RenderSettings (SpotManager.ActiveSpotScene makes the "Spot" scene active)
//   lights          the Light / ReflectionProbe components of the scene and the placed prefabs ({path, active, m_Enabled})
// Keywords (UniversalRenderer.Setup, ForwardLights.Setup, MainLightShadowCasterPass / AdditionalLightsShadowCasterPass
// .Setup): EVALUATE_SH_VERTEX / EVALUATE_SH_MIXED by the asset's SH evaluation mode; _ADDITIONAL_LIGHTS_VERTEX /
// _ADDITIONAL_LIGHTS when the asset supports additional lights (the renderer strips their off variants, so the keyword
// is on without an additional light); the asset's reflection probe blending / box projection keywords; no shadow, mixed
// lighting, light layer, cookie or Forward+ keyword. Constants: SetupMainLightConstants without a main light (URP's
// default light: position (0, 0, 1, 0), colour black with w 1, not subtractive); SetupAdditionalLightConstants without
// an additional light (_AdditionalLightsCount 0).
// ENGINE: PlatformAutoDetect.ShAutoDetect gives PerVertex for Auto on a mobile shader API (GLES3); UniversalRenderer
// sets stripAdditionalLightOffVariants outside XR.
// ENGINE: the ambient probe of a Flat ambient is built natively from the ambient colour; a white Flat ambient is taken as
// SH(N) = 1 (L0 only), as the ADV renderer does, and other ambients are refused.
// ENGINE: the default reflection of a Skybox-mode scene without a skybox material (and without a custom cube) is taken
// as black; its HDR decode values (1, 1, 0, 0) only scale that black.
// ENGINE: unity_LightData (native per-object light data): x the offset of the per-object light indices (0), y their
// count (0), z 1 (the main light's culling-mask factor; it multiplies the black main light).
export const spotLighting = ({ pipeline: pipe, renderer: rend, renderSettings, lights = [], lightmaps = [], what = "home spot" }) => {
  const pipeName = pipe.m_Name, rendName = rend.m_Name;
  if (rend.m_RenderingMode !== RENDERING_FORWARD)
    throw new Error(`${what}: renderer ${rendName} rendering mode ${rend.m_RenderingMode} (only Forward is reproduced)`);
  for (const f of rend.m_RendererFeatures || []) {
    const cls = String(f.class || "").split(".").pop();
    if (f.m_Active && LIGHTING_FEATURES.has(cls)) throw new Error(`${what}: renderer feature ${cls} of ${rendName} is not reproduced`);
  }
  const lit = lights.find((l) => l.active && l.m_Enabled);
  if (lit) throw new Error(`${what}: ${lit.type || "Light"} ${lit.path} is not reproduced (the spot is drawn without lights)`);
  const rs = renderSettings;
  if (!rs) throw new Error(`${what}: the Spot scene's RenderSettings (home.sceneRoot.renderSettings) are missing`);
  if (rs.m_Fog) throw new Error(`${what}: scene fog is not reproduced`);
  if (rs.m_Sun) throw new Error(`${what}: RenderSettings.sun is not reproduced`);
  if (lightmaps.length) throw new Error(`${what}: lightmaps are not reproduced`);
  if (rs.m_AmbientMode !== AMBIENT_FLAT || !white(rs.m_AmbientSkyColor) || rs.m_AmbientIntensity !== 1)
    throw new Error(`${what}: ambient mode ${rs.m_AmbientMode} is not reproduced (only a white Flat ambient)`);
  if (rs.m_SkyboxMaterial || rs.m_CustomReflection || rs.m_DefaultReflectionMode !== REFLECTION_SKYBOX)
    throw new Error(`${what}: a default reflection other than the empty skybox's is not reproduced`);
  // the shadow casters' empty shadow map path, taken when the asset enables shadows and no light casts
  if (pipe.m_MainLightShadowsSupported && pipe.m_MainLightRenderingMode === LIGHTS_PER_PIXEL)
    throw new Error(`${what}: ${pipeName} main light shadows (the empty shadow map) are not reproduced`);
  if (pipe.m_AdditionalLightShadowsSupported && pipe.m_AdditionalLightsRenderingMode === LIGHTS_PER_PIXEL)
    throw new Error(`${what}: ${pipeName} additional light shadows (the empty shadow map) are not reproduced`);
  if (pipe.m_SupportsLightLayers) throw new Error(`${what}: ${pipeName} light layers are not reproduced`);
  const keywords = [];
  const sh = pipe.m_ShEvalMode === SH_AUTO ? SH_VERTEX : pipe.m_ShEvalMode;
  if (sh === SH_VERTEX) keywords.push("EVALUATE_SH_VERTEX");
  else if (sh === SH_MIXED) keywords.push("EVALUATE_SH_MIXED");
  else if (sh !== SH_PIXEL) throw new Error(`${what}: ${pipeName} SH evaluation mode ${pipe.m_ShEvalMode}`);
  const add = pipe.m_AdditionalLightsRenderingMode;
  if (add === LIGHTS_PER_VERTEX) keywords.push("_ADDITIONAL_LIGHTS_VERTEX");
  else if (add === LIGHTS_PER_PIXEL) keywords.push("_ADDITIONAL_LIGHTS");
  else if (add !== LIGHTS_DISABLED) throw new Error(`${what}: ${pipeName} additional lights mode ${add}`);
  if (pipe.m_ReflectionProbeBlending) keywords.push("_REFLECTION_PROBE_BLENDING");
  if (pipe.m_ReflectionProbeBoxProjection) keywords.push("_REFLECTION_PROBE_BOX_PROJECTION");
  const zeros = (n) => new Float32Array(n * 4);
  const globals = {
    _MainLightPosition: [0, 0, 1, 0], _MainLightColor: [0, 0, 0, 1],
    // not written by URP without an additional light, and not read with a count of 0
    _AdditionalLightsCount: [0, 0, 0, 0], _AdditionalLightsPosition: zeros(16), _AdditionalLightsColor: zeros(16),
    _AdditionalLightsAttenuation: zeros(16), _AdditionalLightsSpotDir: zeros(16),
  };
  const perObject = {
    unity_LightData: [0, 0, 1, 0], unity_LightIndices: zeros(2), unity_SpecCube0_HDR: [1, 1, 0, 0],
    unity_SHAr: [0, 0, 0, 1], unity_SHAg: [0, 0, 0, 1], unity_SHAb: [0, 0, 0, 1],
    unity_SHBr: [0, 0, 0, 0], unity_SHBg: [0, 0, 0, 0], unity_SHBb: [0, 0, 0, 0], unity_SHC: [0, 0, 0, 0],
  };
  return { pipeline: pipe, renderer: rend, keywords, globals, perObject };
};

export class SimpleHomeHost {
  // gl: WebGL2 context or null; store: the story's AssetStore; loop: the session's PlayerLoop; host: host/host.json;
  // opts: {camera: {near, far, clearFlags, clearColor: [r, g, b, a], orthographicSize, rendererIndex, hdr, volumeMask}
  //        of the main camera in the spot (post.js spotMainCamera),
  //        graphics: story.scene `graphics` (the render settings tree), quality: the quality level (BaseQualityMode),
  //        post: {lib: the ShaderLib of the story's shaders (the URP post programs), textures: scene.json
  //               `postTextures` (by renderer name), filmGrain: multiplier of FilmGrain.intensity (default 0: none),
  //               screenScale(width): the game's screen pixels per pixel of the target (default 1)},
  //        spine: a Spine runtime (default globalThis.spine; null for none)}
  // A drawn host needs graphics, quality, the camera's orthographicSize (URP's lighting state, spotLighting) and
  // post.lib (the main camera's post chain).
  static async create(gl, store, loop, data, opts = {}) {
    const h = new SimpleHomeHost(gl, store, loop, data, opts);
    try { if (gl) await h._upload(); } catch (e) { h.dispose(); throw e; }
    return h;
  }

  constructor(gl, store, loop, data, opts = {}) {
    const host = data.host;
    if (host?.kind !== "home" || !host.home) throw new Error("not a home host product");
    const home = this.home = host.home, objects = this.objects = opts.objects;
    this.data = data;
    const scene = this.scene = new HomeScene(data, objects);
    const main = objects.prefab(data.scene.prefabs.cameraManager), manager = main.find("CameraManager").c.fields;
    const mainPath = main.pathOf(manager._mainCamera);
    const cam = opts.camera || spotMainCamera(main.fields(mainPath, "Camera"),
      main.fields(mainPath, "UniversalAdditionalCameraData"), scene.camera ? { camera: scene.camera } : null);
    this.gl = gl; this.store = store; this.loop = loop;
    this.missing = [];
    this.spot = data.document(home.parts.spot, "spot.json");
    this.spineDir = data.file(home.parts.spot, "spine");
    this.shaders = new ShaderInfo(objects);
    const summary = data.document(home.parts.room, "room.json");
    this.room = new SpotRoom(parseGlb(store.bytes(data.file(home.parts.room, summary.glb))), summary, home.backgroundState, objects, this.shaders);
    const settings = this.spot.situationSettings, objRoot = scene.objRoot;
    const roomRoot = scene.background.nodes.get(scene.background.root.name).node;
    this.rootMatrix = scene.rootMatrix;
    this.backgroundMatrix = backgroundMatrix(settings, objRoot);
    this.roomMatrix = roomMatrix(this.backgroundMatrix, roomRoot);
    this.roomInverse = roomInverse(settings, objRoot, roomRoot);
    this.camera = new SpotCamera(loop, settings, { near: cam.near, far: cam.far });
    this.orthographicSize = cam.orthographicSize;
    this.rendererIndex = cam.rendererIndex;
    this.graphics = data.scene.graphics;
    this.quality = opts.quality;
    this.clearFlags = cam.clearFlags ?? CLEAR_SOLID;
    this.clearColor = colorOf(cam.clearColor);
    this.cameraHDR = cam.hdr !== false;
    this.hdr = false;                       // the camera colour's HDR (_postSetup)
    this.volumeMask = cam.volumeMask ?? HOME_VIEW_MASK;
    this.cameraSettings = cam;
    this.postOpts = opts.post || {};
    this.blur = new UIBlur(loop);
    this.blurParams = objects.uiBlur(this.graphics.graphics, 0);
    this.skeletons = [];
    this.spineReason = null;
    this._hooks = [];
    this._initSpine(opts.spine !== undefined ? opts.spine : globalThis.spine);
    if (data.story.host.talk === "tap" && !this.tapTarget(data.story.host.characterId)) this.missing.push(NO_TAP_TARGET);
  }

  // SpotSpineCharacter -> SkeletonAnimation, each started at its initial animation's end state (spine.js)
  _initSpine(candidate) {
    const chars = (this.spot.spineCharacters || []).filter((c) => c.skeletonData && c.animation && c.world);
    if (!chars.length) return;
    const recs = new Map((this.spot.skeletons || []).map((r) => [r.name, r]));
    const first = recs.get(chars[0].skeletonData);
    if (!first) throw new Error(`spot.json: skeleton data ${chars[0].skeletonData} not listed`);
    const file = join(this.spineDir, first.skeleton);
    const version = skeletonDataVersion(first.skeleton, /\.json$/i.test(file) ? this.store.text(file) : this.store.bytes(file));
    const { runtime, reason } = spineRuntime(candidate, version);
    if (!runtime) { this.missing.push(SPINE_MISSING); this.spineReason = reason; return; }
    this.spine = runtime;
    const used = [...new Set(chars.map((c) => c.skeletonData))].map((n) => {
      if (!recs.has(n)) throw new Error(`spot.json: skeleton data ${n} not listed`);
      return recs.get(n);
    });
    this.spineData = new SpotSkeletonData(runtime, used, (f) => this.store.text(join(this.spineDir, f)),
                                          (f) => this.store.bytes(join(this.spineDir, f)));
    const extra = new Map(chars.map((c) => [c.path, this.scene.spine(c.path)]));
    const named = new Map();
    for (const { pages } of extra.values()) for (const [page, material] of pages) {
      if (named.has(page) && named.get(page).id !== material.id) throw new Error(`atlas page ${page}: conflicting materials`);
      named.set(page, material);
    }
    this.pageMaterials = new Map(this.spineData.pages().map((page) => {
      if (!named.has(page)) throw new Error(`atlas page ${page}: no material`);
      return [page, named.get(page)];
    }));
    for (const c of chars) {
      const skeleton = this.spineData.skeleton(c.skeletonData, c.animation);
      skeleton.applyEndState();
      // Renderer.sortingOrder of the SkeletonAnimation's MeshRenderer
      const e = extra.get(c.path) || {};
      this.skeletons.push({ character: c, skeleton, matrix: mat4.mul(this.rootMatrix, matrixOf(c.world, c.path)),
                            sortingOrder: e.sortingOrder ?? c.sortingOrder ?? 0, mesh: null, gpu: null });
    }
    // SkeletonAnimation.Update (updateTiming InUpdate): the loop's update phase
    this._on("update", (loop) => { for (const s of this.skeletons) s.skeleton.update(loop.deltaTime); });
  }

  _on(phase, fn) { this.loop.on(phase, fn); this._hooks.push([phase, fn]); }

  // ------------------------------------------------------------------------------------------------ GPU resources
  // URP's lighting state of the main camera in the spot (spotLighting): checked before any GL call
  _lighting() {
    const scene = this.scene, what = `home spot ${this.home.spotId}`, o = this.objects;
    if (typeof this.orthographicSize !== "number") throw new Error(`${what}: the main camera's orthographic size is needed`);
    if (!this.graphics) throw new Error(`${what}: URP lighting needs the scene's render settings`);
    const quality = this.store.objectJson(this.graphics.quality).m_QualitySettings[this.quality];
    if (!quality) throw new Error(`${what}: quality level ${this.quality} is missing`);
    const pipeline = o.mono(quality.customRenderPipeline || this.store.objectJson(this.graphics.graphics).m_CustomRenderPipeline);
    const renderer = o.mono(pipeline.m_RendererDataList[this.rendererIndex < 0 ? pipeline.m_DefaultRendererIndex : this.rendererIndex]);
    return spotLighting({ pipeline, renderer: { ...renderer, m_RendererFeatures: renderer.m_RendererFeatures.map((r) => o.mono(r)) },
      renderSettings: scene.renderSettings, lightmaps: scene.lightmaps, lights: scene.lights, what });
  }

  // the keywords of a material's programs: its own and the camera's global lighting keywords
  _keywords(mat) { return [...(mat.keywords || []), ...this.lighting.keywords]; }

  // the main camera's volume stack (post.js) and what its post chain needs: checked before any GL call
  _postSetup() {
    const what = `home spot ${this.home.spotId}`, P = this.postOpts;
    checkSpotCamera(this.cameraSettings, what);
    if (!P.lib) throw new Error(`${what}: the main camera's post-processing needs the story's shaders (opts.post.lib)`);
    // UniversalRenderPipeline.InitializeStackedCameraData: HDR = Camera.allowHDR && the pipeline asset's supportsHDR
    this.hdr = this.cameraHDR && !!this.lighting.pipeline.m_SupportsHDR;
    const stack = checkSpotStack(spotVolumeStack(this.scene.volumes, this.volumeMask, what), what);
    this.filmGrain = P.filmGrain ?? 0;
    const G = stack.FilmGrain, grain = G.intensity * this.filmGrain > 0 && G.type !== 10;
    const renderer = this.lighting.renderer;
    const textures = this.objects.mono(renderer.postProcessData)?.textures;
    if (grain && !textures?.filmGrainTex) throw new Error(`${what}: film grain textures of renderer ${renderer.m_Name} are missing`);
    return { stack, grainDescs: grain ? textures.filmGrainTex.map((r) => this.objects.id(r, "Texture2D")) : null };
  }

  async _upload() {
    this.lighting = this._lighting();
    const post = this._postSetup();
    this.volumeStack = post.stack;
    const gl = this.gl;
    this.lib = this.objects.lib;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.tex = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
      blackCube: this._blackCube(),
    };
    this.buffers = [];
    this.textures = [];
    this.frameBuffers = new Map();
    // room: one vertex buffer per glb accessor, one index buffer per primitive, textures by glb index
    const byAccessor = new Map(), buf = (data, target) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW);
      this.buffers.push(b);
      return b;
    };
    const attr = (index, data) => {
      if (!byAccessor.has(index)) byAccessor.set(index, buf(data, gl.ARRAY_BUFFER));
      return byAccessor.get(index);
    };
    for (const part of this.room.parts) {
      const p = part.primitive;
      part.gpu = { in_POSITION0: { buffer: attr(p.positionAccessor, p.positions), size: 3, type: gl.FLOAT, normalized: false },
                   in_TEXCOORD0: { buffer: attr(p.uvAccessor, p.uvs), size: 2, type: gl.FLOAT, normalized: false },
                   index: buf(p.indices, gl.ELEMENT_ARRAY_BUFFER), count: p.indices.length };
      if (p.normals) part.gpu.in_NORMAL0 = { buffer: attr(p.normalAccessor, p.normals), size: 3, type: gl.FLOAT, normalized: false };
      const texs = {};
      for (const [slot, t] of Object.entries(part.material.textures || {})) {
        if (t.texture === null || t.texture === undefined) continue;
        texs[slot] = await this.objects.texture(t.texture.id);
      }
      part.textures = texs;
      for (const pass of part.passes) {
        this.lib.program(part.material.shader, pass, this._keywords(part.material), part.subShader);
        this.lib.state(part.material.shader, pass, part.material.floats || {}, part.subShader);
      }
    }
    // Spine atlas pages
    if (this.spineData) {
      this.pageTextures = new Map();
      for (const page of this.spineData.pages()) this.pageTextures.set(page, await this._pageTexture(page));
      for (const m of new Set(this.pageMaterials.values()))
        for (const pass of this.shaders.forwardPasses(m.shader)) this.lib.program(m.shader, pass, this._keywords(m), this.shaders.subShader(m.shader));
    }
    if (!this.shaders.has(BLUR_SHADER)) throw new Error(`host shaders: ${BLUR_SHADER} not packed`);
    this.kawase = new DualKawaseBlur(gl, this.lib);
    // the main camera's post chain: the renderer's film grain textures (only when the grain is drawn), its LUT
    this.urp = new URPPost(gl, this.postOpts.lib, { vao: this.vao });
    this.grain = post.grainDescs ? await URPPost.loadGrain(gl, post.grainDescs, (id) => this.objects.texture(id)) : [];
    this.urp.initLut();
    this.cameraColor = null;
    this.room.glb = null;                 // the file's bytes are no longer needed
  }

  // the default reflection cube of the spot (spotLighting): black, 1 x 1 per face
  _blackCube() {
    const gl = this.gl, t = gl.createTexture(), px = new Uint8Array([0, 0, 0, 255]);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const tex = new GLTex(gl, t, 1, 1, "black cube");
    tex.target = gl.TEXTURE_CUBE_MAP;
    return tex;
  }

  async _pageTexture(page) {
    const material = this.pageMaterials.get(page), texture = material.textures._MainTex?.texture;
    if (!texture) throw new Error(`atlas page ${page}: no main texture`);
    return this.objects.texture(texture.id);
  }

  // a framebuffer drawing into the caller's target with a depth-stencil buffer of our own
  _frameBuffer(target, width, height) {
    const gl = this.gl;
    let e = this.frameBuffers.get(target);
    if (e && (e.width !== width || e.height !== height || e.texture !== target.glTexture)) {
      gl.deleteFramebuffer(e.fb); gl.deleteRenderbuffer(e.depth); this.frameBuffers.delete(target); e = null;
    }
    if (!e) {
      const fb = gl.createFramebuffer(), depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.glTexture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`home spot target: framebuffer incomplete 0x${st.toString(16)}`);
      e = { fb, depth, width, height, texture: target.glTexture };
      this.frameBuffers.set(target, e);
    }
    return e.fb;
  }

  // ---------------------------------------------------------------------------------------------- camera and UI
  // SpotCameraController.UiAlphaRatio
  get uiAlpha() { return this.camera.uiAlphaRatio; }

  // SpotCameraController.StopUiFadeAndShow
  stopUiFadeAndShow() { this.camera.stopUiFadeAndShow(); }

  // UIBlurController.ExecBlur(duration) (SpotManager.EffectBlur(_blurDuration 0.2))
  execBlur(duration = 0.2) { this.blur.exec(duration); }

  // UIBlurController.StopBlur()
  stopBlur() { this.blur.stop(); }

  // the blur rate the pass uses this frame (0 while the blur is off)
  get blurRate() { return this.blur.effectiveRate; }

  // the SpotCharacter a tap on which starts the talks of this _characterId (the first one: a tap on any of them
  // selects the same rows), or null
  tapTarget(characterId) { return (this.spot.characters || []).find((x) => x._characterId === characterId) || null; }

  // SpotCameraController.FocusCharacterAsync(the SpotCharacter with this _characterId, duration)
  focusCharacter(characterId, duration = 0.5) {
    const c = this.tapTarget(characterId);
    if (!c || !c.focusWorld) {
      console.warn(`[SpotCameraController] no focus transform for character ${characterId}`);
      return Promise.resolve();
    }
    const m = matrixOf(c.focusWorld, c.path);
    return this.camera.focus(mat4.transformPoint(this.rootMatrix, { x: m[12], y: m[13], z: m[14] }), c._distanceRatio, duration);
  }

  // SpotCameraController.ReturnToDefaultPosition(duration) (RestoreCameraAfterTalkAsync, _talkReturnDuration 0.5)
  returnToDefaultPosition(duration = 0.5) { return this.camera.returnToDefault(duration); }

  // SpotCameraController.Reset
  resetCamera() { this.camera.reset(); }

  // ------------------------------------------------------------------------------------------------------ drawing
  // The main camera into `target` (a GLTarget of width x height, the camera stack's colour target, which the UI camera
  // draws on): the spot into the camera's colour target (renderScene), then its post chain with the spot's volume
  // stack from there into `target`. The main camera is not the last camera of its stack: the uber pass takes the film
  // grain, and no FinalPost runs here.
  render(target, width, height) {
    if (!this.gl) return;
    const color = this._cameraColor(width, height);
    this.renderScene(color, width, height);
    const cam = this.camera, P = this.postOpts;
    this.urp.render(this.volumeStack, color, target, {
      width, height, frameCount: this.loop.frameCount, grain: this.grain,
      grainScale: P.screenScale ? P.screenScale(width) : 1, grainIntensity: this.filmGrain,
      gray: this.tex.gray, black: this.tex.black, depth: null,
      camera: { view: cam.viewMatrix(), proj: cam.projection(width / height), near: cam.near, far: cam.far } });
    target.bind();
  }

  // the main camera's colour target at the screen size: RGBA16F for an HDR camera (as the story renderer's camera
  // colour), else RGBA8
  _cameraColor(width, height) {
    const gl = this.gl, c = this.cameraColor;
    if (c && c.width === width && c.height === height) return c;
    if (c) this._releaseCameraColor();
    const fmt = this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : {};
    this.cameraColor = new GLTarget(gl, width, height, { ...fmt, label: "CameraColor" });
    this.urp.resizeBloom(width, height);
    return this.cameraColor;
  }

  _releaseCameraColor() {
    const gl = this.gl, c = this.cameraColor, e = this.frameBuffers.get(c);
    if (e) { gl.deleteFramebuffer(e.fb); gl.deleteRenderbuffer(e.depth); this.frameBuffers.delete(c); }
    c.release();
    this.cameraColor = null;
  }

  // The main camera's draws into `target` (a GLTarget of width x height): clear per the camera's clear flags, then
  // URP's opaque and transparent lists of the room's renderers and the Spine renderers.
  renderScene(target, width, height) {
    const gl = this.gl;
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._frameBuffer(target, width, height));
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMask(0xff);
    let bits = gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT;
    // ENGINE: a Skybox clear without a skybox material clears to the background colour.
    if (this.clearFlags === CLEAR_SOLID || this.clearFlags === CLEAR_SKYBOX) {
      const c = this.clearColor;
      gl.clearColor(c[0], c[1], c[2], c[3]);
      bits |= gl.COLOR_BUFFER_BIT;
    }
    gl.clearDepth(1); gl.clearStencil(0); gl.clear(bits);
    const cam = this.camera, V = cam.viewMatrix(), aspect = width / height, P = cam.projection(aspect), t = this.loop.time;
    const camPos = cam.position, os = this.orthographicSize;
    // ScriptableRenderer.SetPerCameraShaderVariables (a perspective camera: unity_OrthoParams.w 0) and the lighting
    const globals = { unity_MatrixVP: mat4.mul(P, V), unity_MatrixV: V, _ProjectionParams: [1, cam.near, cam.far, 1 / cam.far],
                      _ScreenParams: [width, height, 1 + 1 / width, 1 + 1 / height], _Time: [t / 20, t, t * 2, t * 3],
                      _GlobalMipBias: [0, 0], _WorldSpaceCameraPos: [camPos.x, camPos.y, camPos.z],
                      unity_OrthoParams: [os * aspect, os, 0, 0], ...this.lighting.globals, unity_SpecCube0: this.tex.blackCube };
    const items = this.room.drawItems(this.roomMatrix, camPos).map((it) => ({
      ...it, draw: () => this._drawRoomPart(it.part, globals) }));
    for (const s of this.skeletons) {
      if (!s.mesh || s.skeleton.dirty) this._uploadSkeleton(s);
      if (!s.mesh.indices.length) continue;
      const b = s.mesh.bounds, c = mat4.transformPoint(s.matrix, b.center);
      const mat = this.pageMaterials.get(s.mesh.draws[0].page);
      items.push({ queue: materialQueue(mat, this.shaders), sortingOrder: s.sortingOrder,
                   dist: Math.hypot(c.x - camPos.x, c.y - camPos.y, c.z - camPos.z), draw: () => this._drawSkeleton(s, globals) });
    }
    items.forEach((it, i) => { it.index = i; });
    for (const it of sortDrawItems(items)) it.draw();
    gl.frontFace(gl.CW);
    target.bind();
  }

  // the property sheet of a material record: floats, colours, and per texture slot the texture (when bound) with its
  // _ST and _TexelSize; unset properties fall back to the shader defaults (the last sheet)
  _materialSheets(mat, textures) {
    const s = { ...(mat.floats || {}) };
    for (const [k, c] of Object.entries(mat.colors || {})) s[k] = c;
    for (const [k, t] of Object.entries(mat.textures || {})) s[`${k}_ST`] = [t.scale.x, t.scale.y, t.offset.x, t.offset.y];
    for (const [k, tex] of Object.entries(textures)) {
      s[k] = tex;
      s[`${k}_TexelSize`] = [1 / tex.width, 1 / tex.height, tex.width, tex.height];
    }
    return [s, this.lib.defaults(mat.shader, this.tex)];
  }

  _bind(prog, bufs) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      const b = bufs[name];
      if (b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, b.size, b.type, b.normalized, 0, 0);
      } else if (name === "in_COLOR0") gl.vertexAttrib4f(loc, 1, 1, 1, 1);
      else throw new Error(`${prog.label}: vertex attribute ${name} has no data`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.index);
  }

  // Unity flips the front face for a negative-determinant object matrix
  _frontFace(M) { const gl = this.gl; gl.frontFace(det3(M) < 0 ? gl.CCW : gl.CW); }

  _drawRoomPart(part, globals) {
    const gl = this.gl, mat = part.material, M = this.roomMatrix;
    const sheets = [{ unity_ObjectToWorld: M, unity_WorldToObject: this.roomInverse, ...this.lighting.perObject },
                    ...this._materialSheets(mat, part.textures), globals];
    for (const pass of part.passes) {
      const prog = this.lib.program(mat.shader, pass, this._keywords(mat), part.subShader);
      prog.apply(sheets);
      applyState(gl, this.lib.state(mat.shader, pass, mat.floats || {}, part.subShader));
      this._frontFace(M);
      this._bind(prog, part.gpu);
      gl.drawElements(gl.TRIANGLES, part.gpu.count, gl.UNSIGNED_INT, 0);
    }
  }

  // SkeletonRenderer.LateUpdate: the mesh of the current pose into the skeleton's buffers
  _uploadSkeleton(s) {
    const mesh = s.mesh = s.skeleton.buildMesh(), gl = this.gl;
    if (!gl) return;
    // Index buffers belong to the bound VAO; uploads must not change a preceding character's vertex array.
    gl.bindVertexArray(this.vao);
    if (!s.gpu) {
      const b = () => { const x = gl.createBuffer(); this.buffers.push(x); return x; };
      s.gpu = { in_POSITION0: { buffer: b(), size: 3, type: gl.FLOAT, normalized: false },
                in_COLOR0: { buffer: b(), size: 4, type: gl.UNSIGNED_BYTE, normalized: true },
                in_TEXCOORD0: { buffer: b(), size: 2, type: gl.FLOAT, normalized: false }, index: b() };
    }
    const up = (buffer, data, target = gl.ARRAY_BUFFER) => { gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.DYNAMIC_DRAW); };
    up(s.gpu.in_POSITION0.buffer, mesh.positions); up(s.gpu.in_COLOR0.buffer, mesh.colors);
    up(s.gpu.in_TEXCOORD0.buffer, mesh.uvs); up(s.gpu.index, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
  }

  _drawSkeleton(s, globals) {
    const gl = this.gl;
    for (const d of s.mesh.draws) {
      const mat = this.pageMaterials.get(d.page), sub = this.shaders.subShader(mat.shader);
      const sheets = [{ unity_ObjectToWorld: s.matrix }, ...this._materialSheets(mat, { _MainTex: this.pageTextures.get(d.page) }), globals];
      for (const pass of this.shaders.forwardPasses(mat.shader)) {
        const prog = this.lib.program(mat.shader, pass, this._keywords(mat), sub);
        prog.apply(sheets);
        applyState(gl, this.lib.state(mat.shader, pass, mat.floats || {}, sub));
        this._frontFace(s.matrix);
        this._bind(prog, s.gpu);
        gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, d.start * 4);
      }
    }
  }

  // UIRenderPass "CaptureAndBlur" on `target` (the camera colour after the spot and the UI below the blur) in place,
  // skipped while the blur rate is 0
  applyBlur(target, width, height) {
    if (!this.gl) return;
    const pass = blurPass(this.blurParams, this.blur.effectiveRate);
    if (!pass) return;
    this.kawase.apply(target, width, height, pass);
    target.bind();
  }

  dispose() {
    for (const [phase, fn] of this._hooks) {
      const list = this.loop.hooks[phase], i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    this._hooks = [];
    this.camera.kill();
    this.blur.dispose();
    const gl = this.gl;
    if (!gl) return;
    if (this.kawase) this.kawase.dispose();
    if (this.cameraColor) this._releaseCameraColor();
    if (this.urp) this._releasePost();
    for (const b of this.buffers || []) gl.deleteBuffer(b);
    for (const t of [...(this.textures || []), ...Object.values(this.tex || {})]) gl.deleteTexture(t.glTexture);
    for (const e of (this.frameBuffers || new Map()).values()) { gl.deleteFramebuffer(e.fb); gl.deleteRenderbuffer(e.depth); }
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.lib) for (const p of this.lib.cache.values()) {
      gl.deleteProgram(p.program);
      for (const b of p.blocks) gl.deleteBuffer(b.buffer);
    }
    this.buffers = []; this.textures = []; this.frameBuffers = new Map(); this.tex = {}; this.vao = null;
  }

  // the post chain's targets and textures: the grain, the LUT, the bloom mips, the named targets and the curve
  // textures of the stack's ColorCurves (its programs belong to the story's ShaderLib)
  _releasePost() {
    const gl = this.gl, u = this.urp;
    for (const t of this.grain || []) gl.deleteTexture(t.glTexture);
    if (u.lut) u.lut.release();
    for (const m of u.bloom) { m.down.release(); m.up.release(); }
    for (const t of u.targets.values()) t.release();
    const curves = new Set(this.volumeStack ? Object.values(this.volumeStack.ColorCurves) : []);
    for (const c of Object.values(CURVE_DEFAULTS)) curves.add(c);
    const seen = new Set();
    for (const c of curves) {
      const t = u.curveTex.get(c);
      if (t && !seen.has(t)) { seen.add(t); gl.deleteTexture(t.glTexture); }
    }
    this.urp = null; this.grain = [];
  }
}
