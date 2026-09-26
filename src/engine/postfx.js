import { F } from "./core.js";
import { applyState } from "./glsl.js";
import { mat4 } from "./math.js";
import { FxCurve } from "./particles.js";
import { UnityRandom } from "./random.js";
import { GLTarget, GLTex } from "./texture.js";

// URPPost: the URP 17 post-processing chain of a camera that runs post (LiveEffectCamera in the live renderer, the ADV
// main camera in the story): Volume parameter defaults and stack evaluation (VolumeManager), the full-screen blit, the
// LDR colour grading LUT (ColorGradingLutPass), depth of field (Bokeh), camera motion blur, Bloom (RenderBloomTexture,
// Gaussian, low quality), UberPost (bloom, internal LUT, lens distortion, chromatic aberration, vignette, film grain,
// tonemapping) and FinalPost (FXAA), in the order of PostProcessPassRenderGraph.RenderPostProcessingRenderGraph. The
// chain runs the game's own GLES3 programs through ShaderLib; every value fed to them is the one URP computes on the
// CPU.
//
// Blits draw one full-screen triangle with no vertex inputs (Blitter.BlitTexture with the procedural triangle,
// _BlitScaleBias (1, 1, 0, 0)); a null target means the default framebuffer with the caller's viewport.

// ------------------------------------------------------------------------------------------------ volume parameters
// Parameter kinds, by the Interp of the VolumeParameter class: "f" FloatParameter and its Min / Max / Clamped
// subclasses (lerp in single precision), "i" IntParameter and its subclasses (lerp truncated to int), "c" ColorParameter,
// "v2" / "v4" Vector2Parameter / Vector4Parameter (lerp per component), "n" the rest (BoolParameter, enum parameters,
// TextureParameter, NoInterp*, TextureCurveParameter: VolumeParameter<T>.Interp takes the overriding value when t > 0).
export const VOLUME_PARAMS = {
  Bloom: { skipIterations: "i", threshold: "f", intensity: "f", scatter: "f", clamp: "f", tint: "c",
           highQualityFiltering: "n", filter: "n", downscale: "n", maxIterations: "i", dirtTexture: "n", dirtIntensity: "f" },
  ChannelMixer: { redOutRedIn: "f", redOutGreenIn: "f", redOutBlueIn: "f", greenOutRedIn: "f", greenOutGreenIn: "f",
                  greenOutBlueIn: "f", blueOutRedIn: "f", blueOutGreenIn: "f", blueOutBlueIn: "f" },
  ChromaticAberration: { intensity: "f" },
  ColorAdjustments: { postExposure: "f", contrast: "f", colorFilter: "c", hueShift: "f", saturation: "f" },
  ColorCurves: { master: "n", red: "n", green: "n", blue: "n", hueVsHue: "n", hueVsSat: "n", satVsSat: "n", lumVsSat: "n" },
  DepthOfField: { mode: "n", gaussianStart: "f", gaussianEnd: "f", gaussianMaxRadius: "f", highQualitySampling: "n",
                  focusDistance: "f", aperture: "f", focalLength: "f", bladeCount: "i", bladeCurvature: "f", bladeRotation: "f" },
  FilmGrain: { type: "n", intensity: "f", response: "f", texture: "n" },
  LensDistortion: { intensity: "f", xMultiplier: "f", yMultiplier: "f", center: "v2", scale: "f" },
  LiftGammaGain: { lift: "v4", gamma: "v4", gain: "v4" },
  MotionBlur: { mode: "n", quality: "n", intensity: "f", clamp: "f" },
  ShadowsMidtonesHighlights: { shadows: "v4", midtones: "v4", highlights: "v4", shadowsStart: "f", shadowsEnd: "f",
                               highlightsStart: "f", highlightsEnd: "f" },
  SplitToning: { shadows: "c", highlights: "c", balance: "f" },
  Tonemapping: { mode: "n", neutralHDRRangeReductionMode: "n", acesPreset: "n", hueShiftAmount: "f", detectPaperWhite: "n",
                 paperWhite: "f", detectBrightnessLimits: "n", minNits: "f", maxNits: "f" },
  Vignette: { color: "c", center: "v2", intensity: "f", smoothness: "f", rounded: "n" },
  WhiteBalance: { temperature: "f", tint: "f" },
  AdvCurvedLens: { center: "v2", intensity: "f", size: "f", softness: "f", horizontalRate: "f", verticalRate: "f",
                   scale: "f", attenuateByCameraDistance: "n", reverse: "n" },
};

// the ColorCurves curves of the default profile (serialized TextureCurve values)
const key = (time, value) => Object.freeze({ time, value, inSlope: 1, outSlope: 1, weightedMode: 0, inWeight: 0, outWeight: 0 });
const textureCurve = (keys, zeroValue, loop) => Object.freeze({
  "<length>k__BackingField": keys.length, m_Loop: loop, m_ZeroValue: zeroValue, m_Range: 1,
  m_Curve: Object.freeze({ m_Curve: Object.freeze(keys), m_PreInfinity: 2, m_PostInfinity: 2, m_RotationOrder: 4 }) });
export const CURVE_DEFAULTS = Object.freeze({
  linear: textureCurve([key(0, 0), key(1, 1)], 0, 0),     // master, red, green, blue
  hue: textureCurve([], 0.5, 1),                            // hueVsHue, hueVsSat
  sat: textureCurve([], 0.5, 0),                            // satVsSat, lumVsSat
});

// The stack's default state: the URP global default volume profile (URPDefaultVolumeProfileSettings) of the game's
// render pipeline settings, which overrides every parameter of these components with the component's initial value
// (AdvCurvedLens with its own values); the quality levels have no volume profile of their own.
export const VOLUME_DEFAULTS = {
  Bloom: { skipIterations: 1, threshold: 0.9, intensity: 0, scatter: 0.7, clamp: 65472, tint: { r: 1, g: 1, b: 1, a: 1 },
           highQualityFiltering: 0, filter: 0, downscale: 0, maxIterations: 6, dirtTexture: null, dirtIntensity: 0 },
  ChannelMixer: { redOutRedIn: 100, redOutGreenIn: 0, redOutBlueIn: 0, greenOutRedIn: 0, greenOutGreenIn: 100,
                  greenOutBlueIn: 0, blueOutRedIn: 0, blueOutGreenIn: 0, blueOutBlueIn: 100 },
  ChromaticAberration: { intensity: 0 },
  ColorAdjustments: { postExposure: 0, contrast: 0, colorFilter: { r: 1, g: 1, b: 1, a: 1 }, hueShift: 0, saturation: 0 },
  ColorCurves: { master: CURVE_DEFAULTS.linear, red: CURVE_DEFAULTS.linear, green: CURVE_DEFAULTS.linear,
                 blue: CURVE_DEFAULTS.linear, hueVsHue: CURVE_DEFAULTS.hue, hueVsSat: CURVE_DEFAULTS.hue,
                 satVsSat: CURVE_DEFAULTS.sat, lumVsSat: CURVE_DEFAULTS.sat },
  DepthOfField: { mode: 0, gaussianStart: 10, gaussianEnd: 30, gaussianMaxRadius: 1, highQualitySampling: 0,
                  focusDistance: 10, aperture: 5.6, focalLength: 50, bladeCount: 5, bladeCurvature: 1, bladeRotation: 0 },
  FilmGrain: { type: 0, intensity: 0, response: 0.8, texture: null },
  LensDistortion: { intensity: 0, xMultiplier: 1, yMultiplier: 1, center: { x: 0.5, y: 0.5 }, scale: 1 },
  LiftGammaGain: { lift: { x: 1, y: 1, z: 1, w: 0 }, gamma: { x: 1, y: 1, z: 1, w: 0 }, gain: { x: 1, y: 1, z: 1, w: 0 } },
  MotionBlur: { mode: 0, quality: 0, intensity: 0, clamp: 0.05 },
  ShadowsMidtonesHighlights: { shadows: { x: 1, y: 1, z: 1, w: 0 }, midtones: { x: 1, y: 1, z: 1, w: 0 },
                               highlights: { x: 1, y: 1, z: 1, w: 0 }, shadowsStart: 0, shadowsEnd: 0.3,
                               highlightsStart: 0.55, highlightsEnd: 1 },
  SplitToning: { shadows: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, highlights: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, balance: 0 },
  Tonemapping: { mode: 0, neutralHDRRangeReductionMode: 2, acesPreset: 3, hueShiftAmount: 0, detectPaperWhite: 0,
                 paperWhite: 300, detectBrightnessLimits: 1, minNits: 0.005, maxNits: 1000 },
  Vignette: { color: { r: 0, g: 0, b: 0, a: 1 }, center: { x: 0.5, y: 0.5 }, intensity: 0, smoothness: 0.2, rounded: 0 },
  WhiteBalance: { temperature: 0, tint: 0 },
  AdvCurvedLens: { center: { x: 0.5, y: 0.5 }, intensity: 0, size: 0.35, softness: 0.2, horizontalRate: 1, verticalRate: 0.15,
                   scale: 1, attenuateByCameraDistance: 1, reverse: 1 },
};

const lerp = (a, b, t) => F(F(a) + F(F(F(b) - F(a)) * t));     // FloatParameter.Interp: fsub, fmul, fadd in single precision

// VolumeParameter.Interp(from, to, t) of a parameter kind
const interp = (kind, from, to, t) => {
  switch (kind) {
    case "f": return lerp(from, to, t);
    case "i": {                                                   // IntParameter.Interp: (int)((float)(to - from) * t + from)
      const r = F(F(F((to | 0) - (from | 0)) * t) + F(from | 0));
      return r >= -2147483648 && r < 2147483648 ? Math.trunc(r) : -2147483648;   // IL2CPP float-to-int: INT_MIN out of range
    }
    case "c": return { r: lerp(from.r, to.r, t), g: lerp(from.g, to.g, t), b: lerp(from.b, to.b, t), a: lerp(from.a, to.a, t) };
    case "v2": return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
    case "v4": return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), z: lerp(from.z, to.z, t), w: lerp(from.w, to.w, t) };
    default: return t > 0 ? to : from;
  }
};

const isVector = (v) => !!v && typeof v === "object" && ("r" in v || "x" in v);

// the AnimationCurve of a TextureCurve value (FxCurve, see particles.js)
const curveCache = new WeakMap();
const curveOf = (c) => {
  let x = curveCache.get(c);
  if (!x) curveCache.set(c, x = new FxCurve(c.m_Curve));
  return x;
};

const BOKEH = "Hidden/Universal Render Pipeline/BokehDepthOfField";
const MOTION_BLUR = "Hidden/Universal Render Pipeline/CameraMotionBlur";

// 4 x 4 inverse (column-major)
// ENGINE: Matrix4x4.Inverse is native; here the cofactor inverse in double precision, stored as float32.
const inverse4 = (m) => {
  const a = Array.from(m), o = new Array(16);
  o[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  o[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  o[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  o[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  o[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  o[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  o[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  o[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  o[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  o[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  o[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  o[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  o[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  o[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  o[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  o[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
  const out = new Float32Array(16);
  if (det === 0) return out;
  for (let i = 0; i < 16; i++) out[i] = o[i] / det;
  return out;
};

export class URPPost {
  constructor(gl, lib, { vao = null } = {}) {
    this.gl = gl; this.lib = lib;
    this.vao = vao || gl.createVertexArray();
    this.lut = null; this.curveTex = new WeakMap();      // curve textures by TextureCurve value
    this.bloom = []; this.bloomBase = null;
    this.targets = new Map();               // DoF / motion blur targets by name
    this.volumeTextures = new Map();        // texture-valued volume parameters by exported file (loadVolumeTextures)
    this.bokeh = null;                      // bokeh kernel and the values it was made for
    this.motion = null;                     // MotionVectorsPersistentData of the camera
  }

  // VolumeManager stack for one camera (VolumeManager.Update): the default state (ReplaceData), then each volume in
  // registration order blended by its weight (OverrideData: Mathf.Clamp01(weight); inactive components skipped; each
  // overridden parameter through its Interp). `volumes` = [{profile: {components: [...]}, weight}].
  static evaluateStack(volumes) {
    const stack = {};
    for (const [name, d] of Object.entries(VOLUME_DEFAULTS)) {
      const c = stack[name] = {};
      for (const [k, v] of Object.entries(d)) c[k] = isVector(v) ? { ...v } : v;
    }
    for (const v of volumes) {
      const t = F(Math.min(1, Math.max(0, v.weight)));
      for (const comp of v.profile.components) {
        if (!comp.active) continue;
        const dst = stack[comp.asset], kinds = VOLUME_PARAMS[comp.asset];
        if (!dst) throw new Error(`volume component ${comp.asset} not supported`);
        for (const [k, p] of Object.entries(comp)) {
          if (!p || typeof p !== "object" || !("m_OverrideState" in p) || !p.m_OverrideState) continue;
          if (!kinds[k]) throw new Error(`${comp.asset}.${k}: unknown parameter`);
          dst[k] = interp(kinds[k], dst[k], p.m_Value, t);
        }
      }
    }
    return stack;
  }

  // ------------------------------------------------------------------ resources
  // film grain textures by FilmGrain.type (the renderer's post data); the Uber shader samples them with its inline
  // sampler_LinearRepeat
  static async loadGrain(gl, base, descs) {
    const out = [];
    for (const d of descs) {
      const t = await GLTex.load(gl, base, d);
      GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: 0, m_WrapV: 0 }, 1);
      out.push(t);
    }
    return out;
  }

  // the textures the overridden texture parameters of `profiles` name (FilmGrain.texture of a Custom grain), by exported
  // file; the Uber shader samples the grain with its inline sampler_LinearRepeat (other textures: bilinear, clamp)
  async loadVolumeTextures(base, profiles, assets) {
    const gl = this.gl;
    for (const p of profiles) {
      for (const comp of (p && p.components) || []) {
        for (const [k, v] of Object.entries(comp)) {
          const d = v && typeof v === "object" && v.m_OverrideState ? v.m_Value : null;
          if (!d || typeof d !== "object" || typeof d.texture !== "string" || this.volumeTextures.has(d.texture)) continue;
          const t = await GLTex.load(gl, base, d, assets);
          const repeat = comp.asset === "FilmGrain" && k === "texture";
          GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: repeat ? 0 : 1, m_WrapV: repeat ? 0 : 1 }, 1);
          this.volumeTextures.set(d.texture, t);
        }
      }
    }
  }

  _volumeTexture(desc) {
    const t = this.volumeTextures.get(desc.texture);
    if (!t) throw new Error(`volume texture ${desc.name || desc.texture} not loaded (URPPost.loadVolumeTextures)`);
    return t;
  }

  // neutral colour curves (TextureCurve, 128 x 1) and the 256 x 16 internal LUT target
  initLut() {
    const gl = this.gl;
    const curve = (f) => {
      const px = new Float32Array(128);
      for (let i = 0; i < 128; i++) px[i] = f(i * (1 / 128));
      return this._curveTarget(px);
    };
    const linear = curve((x) => x), half = curve(() => 0.5);
    this.curveTex.set(CURVE_DEFAULTS.linear, linear);
    this.curveTex.set(CURVE_DEFAULTS.hue, half);
    this.curveTex.set(CURVE_DEFAULTS.sat, half);
    this.lut = new GLTarget(gl, 256, 16, { label: "InternalLut" });
  }

  // TextureCurve.GetTexture: R16_SFloat 128 x 1, bilinear, clamp
  // ENGINE: Texture2D.SetPixels / Apply convert the curve to half floats natively; here the GL upload converts them.
  _curveTarget(px) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 128, 1, 0, gl.RED, gl.FLOAT, px);
    GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 }, 1);
    return new GLTex(gl, t, 128, 1, "curve");
  }

  // the curve texture of a TextureCurve value: pixel i = Evaluate(i * 1/128)
  _curveTexture(c) {
    let t = this.curveTex.get(c);
    if (!t) {
      const px = new Float32Array(128);
      for (let i = 0; i < 128; i++) px[i] = URPPost.evaluateCurve(c, i * (1 / 128));
      this.curveTex.set(c, t = this._curveTarget(px));
    }
    return t;
  }

  // TextureCurve.Evaluate of a deserialized curve (no SetDirty since loading): the serialized length decides; the zero
  // value for 0, else the AnimationCurve. A looping curve of 2 or more keys would evaluate its looping curve, which only
  // SetDirty builds (TextureCurve's constructors); for a loaded curve it is null and the game's LUT pass fails.
  static evaluateCurve(c, time) {
    const n = c["<length>k__BackingField"];
    if (n === 0) return c.m_ZeroValue;
    if (!c.m_Loop || n === 1) return curveOf(c).evaluate(time);
    throw new Error(`looping TextureCurve of ${n} keys: no looping curve for a loaded curve`);
  }

  // bloom chain for a camera colour target of w x h (Half downscale; mip i = size >> i), RGBA16F
  resizeBloom(w, h) {
    const gl = this.gl, F16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    for (const m of this.bloom) { m.down.release(); m.up.release(); }
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    this.bloomBase = { w: bw, h: bh };
    this.bloom = [];
    for (let i = 0; i < 16; i++) {
      const mw = Math.max(1, bw >> i), mh = Math.max(1, bh >> i);
      this.bloom.push({ down: new GLTarget(gl, mw, mh, { ...F16, label: `_BloomMipDown${i}` }),
                        up: new GLTarget(gl, mw, mh, { ...F16, label: `_BloomMipUp${i}` }) });
      if (mw === 1 && mh === 1) break;
    }
  }

  // a named intermediate target of w x h (the render graph's transient textures), made again when the size changes
  _target(name, w, h, fmt) {
    const gl = this.gl, old = this.targets.get(name);
    if (old && old.width === w && old.height === h) return old;
    if (old) old.release();
    const formats = {
      rgba16f: { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT },
      r8: { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE },
      r32f: { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST },
    };
    const t = new GLTarget(gl, w, h, { ...formats[fmt], label: name });
    this.targets.set(name, t);
    return t;
  }

  // the camera depth texture for DoF / motion blur: `o.depth`, else the copy of a depth buffer nothing drew into (the
  // cleared depth, 1 on OpenGL ES)
  _depth(o, w, h) {
    if (o.depth) return o.depth;
    const had = this.targets.get("_CameraDepthTexture"), t = this._target("_CameraDepthTexture", w, h, "r32f");
    if (t !== had) {
      const gl = this.gl;
      t.bind(); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return t;
  }

  // ---------------------------------------------------------------------- blit
  blit(shader, pass, sheets, target, { subShader = 0, keywords = [], matFloats = {}, viewport = null } = {}) {
    const gl = this.gl;
    const prog = this.lib.program(shader, pass, keywords, subShader);
    if (target) target.bind();
    else { const v = viewport; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(v.x, v.y, v.w, v.h); }
    prog.apply([...sheets, { _BlitScaleBias: [1, 1, 0, 0], _GlobalMipBias: [0, 0], _RTHandleScale: [1, 1, 1, 1] }]);
    applyState(gl, this.lib.state(shader, pass, matFloats, subShader));
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ENGINE: Mathf.GammaToLinearSpace is native: sRGB curve below 1, exactly 1 at 1, powf(c, 2.2) above 1.
  static gammaToLinear(c) {
    if (c <= 0.04045) return c / 12.92;
    if (c < 1) return Math.pow((c + 0.055) / 1.055, 2.4);
    return c === 1 ? 1 : Math.pow(c, Math.fround(2.2));
  }

  static texel(t) { return [1 / t.width, 1 / t.height, t.width, t.height]; }

  static sourceSize(t) { return [t.width, t.height, 1 / t.width, 1 / t.height]; }   // PostProcessUtils.SetSourceSize

  // ------------------------------------------------------------ colour grading
  // ColorUtils.PrepareLiftGammaGain (single precision): lift = linear * 0.15, gamma and gain = linear * 0.8, each minus
  // its luminance (ColorUtils.Luminance) plus w (gamma, gain: w + 1); gamma is inverted (1 / max(x, 0.001))
  static prepareLiftGammaGain(lgg) {
    const lin = URPPost.gammaToLinear;
    const k = [F(0.2126729), F(0.7151522), F(0.072175)];
    const part = (v, scale) => {
      const c = [F(lin(v.x) * F(scale)), F(lin(v.y) * F(scale)), F(lin(v.z) * F(scale))];
      return { c, lum: F(F(F(c[0] * k[0]) + F(c[1] * k[1])) + F(c[2] * k[2])) };
    };
    const L = part(lgg.lift, 0.15), G = part(lgg.gamma, 0.8), N = part(lgg.gain, 0.8);
    const gw = F(lgg.gamma.w + 1), nw = F(lgg.gain.w + 1);
    return [
      [...L.c.map((v) => F(lgg.lift.w + F(v - L.lum))), 0],
      [...G.c.map((v) => F(1 / Math.max(F(gw + F(v - G.lum)), F(0.001)))), 0],
      [...N.c.map((v) => F(nw + F(v - N.lum))), 0],
    ];
  }

  // ColorUtils.PrepareShadowsMidtonesHighlights: linear colour plus w (x 4 when w >= 0), clamped at 0
  static prepareShadowsMidtonesHighlights(smh) {
    const lin = URPPost.gammaToLinear;
    const part = (v) => {
      const w = F(v.w * (v.w >= 0 ? 4 : 1));
      return [...[v.x, v.y, v.z].map((c) => { const x = F(lin(c) + w); return x <= 0 ? 0 : x; }), 0];
    };
    return [part(smh.shadows), part(smh.midtones), part(smh.highlights)];
  }

  // ---------------------------------------------------------------------- LUT
  buildLut(stack) {                         // ColorGradingLutPass.ExecutePass, LDR, size 16
    const wb = stack.WhiteBalance, F = Math.fround;
    const t1 = F(wb.temperature / 65), t2 = F(wb.tint / 65);
    const x = F(0.31271 - F(t1 * (t1 < 0 ? 0.1 : 0.05)));
    const y = F(F(F(F(2.87 * x) - F(F(3 * x) * x)) - 0.27509507) + F(t2 * 0.05));
    const X = F(x / y), Z = F(F(F(1 - x) - y) / y);
    const L = F(F(F(0.7328 * X) + 0.4296) - F(0.1624 * Z));
    const M = F(F(F(-0.7036 * X) + 1.6975) + F(0.0061 * Z));
    const S = F(F(F(0.003 * X) + 0.0136) + F(0.9834 * Z));
    const ca = stack.ColorAdjustments, cm = stack.ChannelMixer, smh = stack.ShadowsMidtonesHighlights;
    const st = stack.SplitToning, cc = stack.ColorCurves, lin = URPPost.gammaToLinear, cf = ca.colorFilter;
    const [lift, gamma, gain] = URPPost.prepareLiftGammaGain(stack.LiftGammaGain);
    const [shadows, midtones, highlights] = URPPost.prepareShadowsMidtonesHighlights(smh);
    const ct = (c) => this._curveTexture(c);
    const sheet = {
      _Lut_Params: [16, 0.5 / 256, 0.5 / 16, 16 / 15],
      _ColorBalance: [F(0.949237 / L), F(1.03542 / M), F(1.08728 / S), 0],
      _ColorFilter: [lin(cf.r), lin(cf.g), lin(cf.b), cf.a],
      _ChannelMixerRed: [F(cm.redOutRedIn / 100), F(cm.redOutGreenIn / 100), F(cm.redOutBlueIn / 100), 0],
      _ChannelMixerGreen: [F(cm.greenOutRedIn / 100), F(cm.greenOutGreenIn / 100), F(cm.greenOutBlueIn / 100), 0],
      _ChannelMixerBlue: [F(cm.blueOutRedIn / 100), F(cm.blueOutGreenIn / 100), F(cm.blueOutBlueIn / 100), 0],
      _HueSatCon: [F(ca.hueShift / 360), F(F(ca.saturation / 100) + 1), F(F(ca.contrast / 100) + 1), 0],
      _Lift: lift, _Gamma: gamma, _Gain: gain,
      _Shadows: shadows, _Midtones: midtones, _Highlights: highlights,
      _ShaHiLimits: [smh.shadowsStart, smh.shadowsEnd, smh.highlightsStart, smh.highlightsEnd],
      _SplitShadows: [st.shadows.r, st.shadows.g, st.shadows.b, F(st.balance / 100)],   // ColorUtils.PrepareSplitToning
      _SplitHighlights: [st.highlights.r, st.highlights.g, st.highlights.b, 0],
      _CurveMaster: ct(cc.master), _CurveRed: ct(cc.red), _CurveGreen: ct(cc.green), _CurveBlue: ct(cc.blue),
      _CurveHueVsHue: ct(cc.hueVsHue), _CurveHueVsSat: ct(cc.hueVsSat), _CurveLumVsSat: ct(cc.lumVsSat),
      _CurveSatVsSat: ct(cc.satVsSat),
    };
    const s = "Hidden/Universal Render Pipeline/LutBuilderLdr";
    this.blit(s, 0, [sheet], this.lut);
  }

  // ------------------------------------------------------------ depth of field
  // DepthOfField.IsActive: a mode other than Off (the shader level and render target count checks pass on OpenGL ES 3)
  static dofActive(stack) { return stack.DepthOfField.mode !== 0; }

  // PostProcessPassRenderGraph.PrepareBokehKernel: 3 rings of 7, 14, 21 points on a rotated N-gon (bladeCount,
  // bladeCurvature, bladeRotation), scaled by maxRadius: (u, v, length, u * rcpAspect)
  // ENGINE: Mathf.Cos / Sin / Pow / Sqrt / Tan use the device's libm; here double precision rounded to float32.
  static bokehKernel(D, maxRadius, rcpAspect) {
    const out = new Float32Array(42 * 4), n = F(D.bladeCount), curvature = F(1 - D.bladeCurvature);
    const rotation = F(D.bladeRotation * F(0.017453292));
    const PI = F(3.1415927), TWO_PI = F(6.2831855);
    const nt = F(Math.cos(F(PI / n)));
    let idx = 0;
    for (let ring = 1; ring < 4; ring++) {
      const points = ring * 7, radius = F(F(ring + F(0.14285715)) / F(3.142857));
      for (let point = 0; point < points; point++) {
        const phi = F(F(point * TWO_PI) / points);
        const dt = F(Math.cos(F(phi - F(F(TWO_PI / n) * Math.trunc(F(F(F(phi * n) + PI) / TWO_PI))))));
        const r = F(radius * F(Math.pow(F(nt / dt), curvature)));
        const u = F(F(F(Math.cos(F(phi - rotation))) * r) * maxRadius);
        const v = F(F(F(Math.sin(F(phi - rotation))) * r) * maxRadius);
        out.set([u, v, F(Math.sqrt(F(F(u * u) + F(v * v)))), F(u * rcpAspect)], idx * 4);
        idx++;
      }
    }
    return out;
  }

  // RenderDoF + RenderDoFBokeh: DoFTarget like the source; CoC from the camera depth (full size, R8), prefilter to half
  // size (RGBA16F ping), bokeh blur (pong), post blur (ping), composite. The GLES 3.0 programs are in subshader 1
  // (subshader 0 needs GLES 3.1: its prefilter gathers the CoC texels; the passes compute the same).
  // `o` = {camera: {near, far}, depth}
  _depthOfField(stack, source, o) {
    const D = stack.DepthOfField;
    if (D.mode !== 2) throw new Error(`depth of field mode ${D.mode} (Gaussian) not implemented`);
    const w = source.width, h = source.height, wh = Math.trunc(w / 2), hh = Math.trunc(h / 2);
    const dst = this._target("_DoFTarget", w, h, "rgba16f"), coc = this._target("_FullCoCTexture", w, h, "r8");
    const ping = this._target("_PingTexture", wh, hh, "rgba16f"), pong = this._target("_PongTexture", wh, hh, "rgba16f");
    // "A Lens and Aperture Camera Model for Synthetic Image Generation" [Potmesil81]
    const f = F(D.focalLength / 1000), A = F(D.focalLength / D.aperture), P = F(D.focusDistance);
    const maxCoC = F(F(f * A) / F(P - f));
    const maxRadius = Math.min(F(14 / h), F(0.05));                  // GetMaxBokehRadiusInPixels
    const rcpAspect = F(1 / F(wh / hh));
    const b = this.bokeh, k = [D.bladeCount, D.bladeCurvature, D.bladeRotation, maxRadius, rcpAspect];
    if (!b || b.key.some((v, i) => v !== k[i])) this.bokeh = { key: k, kernel: URPPost.bokehKernel(D, maxRadius, rcpAspect) };
    const uvMargin = F(F(1 / h) * 2);
    const near = F(o.camera.near), far = F(o.camera.far);
    const tz = F(far * F(1 / near)), zc0 = F(1 - tz), invFar = F(1 / far);
    const common = {
      _CoCParams: [P, maxCoC, maxRadius, rcpAspect], _BokehKernel: this.bokeh.kernel,
      _DownSampleScaleFactor: [0.5, 0.5, 2, 2], _BokehConstants: [uvMargin, F(uvMargin * 2), 0, 0],
      _SourceSize: URPPost.sourceSize(source),
      _ZBufferParams: [zc0, tz, F(zc0 * invFar), F(tz * invFar)],    // ScriptableRenderer.SetPerCameraShaderVariables
      _CameraDepthTexture: this._depth(o, w, h), _FullCoCTexture: coc, _DofTexture: ping,
    };
    const opts = { subShader: 1, keywords: ["_USE_FAST_SRGB_LINEAR_CONVERSION", "_ENABLE_ALPHA_OUTPUT"] };
    const pass = (i, src, target) => this.blit(BOKEH, i, [{ _BlitTexture: src, _BlitTexture_TexelSize: URPPost.texel(src) },
                                                          common], target, opts);
    pass(0, source, coc);
    pass(1, source, ping);
    pass(2, ping, pong);
    pass(3, pong, ping);
    pass(4, source, dst);
    return dst;
  }

  // -------------------------------------------------------------- motion blur
  // MotionVectorsPersistentData.Update (UniversalRenderPipeline.RenderSingleCamera, every frame of the camera): this
  // frame's view-projection and the previous frame's; both are this frame's on the first frame and after the aspect
  // ratio changed. `camera` = {view, proj} (Unity's view matrix, the OpenGL projection).
  // ENGINE: GL.GetGPUProjectionMatrix leaves an OpenGL ES projection unchanged.
  updateMotion(camera, aspect, frameCount) {
    const m = this.motion;
    if (m && m.frame === frameCount && m.aspect === aspect) return;
    const vp = mat4.mul(camera.proj, camera.view);
    this.motion = { frame: frameCount, aspect, vp, prev: !m || m.aspect !== aspect ? vp : m.vp };
  }

  // RenderMotionBlur (camera motion blur): _MotionBlurTarget like the source; pass = quality (+ 3 for camera and objects)
  _motionBlur(stack, source, o) {
    const B = stack.MotionBlur;
    if (B.mode !== 0) throw new Error(`motion blur mode ${B.mode} (camera and objects) not implemented`);
    const w = source.width, h = source.height, dst = this._target("_MotionBlurTarget", w, h, "rgba16f");
    const depth = this._depth(o, w, h), cam = o.camera;
    // ScriptableRenderer.SetCameraMatrices: unity_MatrixInvVP = inverse(view) * inverse(GPU projection)
    const invVP = mat4.mul(inverse4(cam.view), inverse4(cam.proj));
    this.blit(MOTION_BLUR, B.quality, [{
      _BlitTexture: source, _BlitTexture_TexelSize: URPPost.texel(source), _SourceSize: URPPost.sourceSize(source),
      _Intensity: B.intensity, _Clamp: B.clamp, _ViewProjM: this.motion.vp, _PrevViewProjM: this.motion.prev,
      unity_MatrixInvVP: invVP, _CameraDepthTexture: depth, _CameraDepthTexture_TexelSize: URPPost.texel(depth),
    }], dst, { keywords: ["_ENABLE_ALPHA_OUTPUT"] });
    return dst;
  }

  // -------------------------------------------------------------------- bloom
  renderBloom(stack, source) {              // RenderBloomTexture (Gaussian, LQ)
    const B = stack.Bloom, s = "Hidden/Universal Render Pipeline/Bloom";
    if (B.filter !== 0 || B.downscale !== 0 || B.highQualityFiltering) throw new Error("bloom mode not implemented");
    const n = Math.min(Math.max(Math.trunc(Math.fround(Math.log2(Math.max(this.bloomBase.w, this.bloomBase.h))) - 1), 1),
                       B.maxIterations, this.bloom.length);
    const scatter = 0.05 + 0.9 * Math.min(1, Math.max(0, B.scatter));
    const thr = URPPost.gammaToLinear(B.threshold);
    const params = [scatter, B.clamp, thr, thr * 0.5];
    const tx = URPPost.texel;
    this.blit(s, 0, [{ _BlitTexture: source, _Params: params }], this.bloom[0].down, { keywords: ["_ENABLE_ALPHA_OUTPUT"] });
    for (let i = 1; i < n; i++) {
      const prev = this.bloom[i - 1].down, m = this.bloom[i];
      this.blit(s, 1, [{ _BlitTexture: prev, _BlitTexture_TexelSize: tx(prev) }], m.up);
      this.blit(s, 2, [{ _BlitTexture: m.up, _BlitTexture_TexelSize: tx(m.up) }], m.down);
    }
    for (let i = n - 2; i >= 0; i--) {
      const low = i === n - 2 ? this.bloom[i + 1].down : this.bloom[i + 1].up;
      this.blit(s, 3, [{ _BlitTexture: this.bloom[i].down, _SourceTexLowMip: low, _Params: params }], this.bloom[i].up);
    }
    return n === 1 ? this.bloom[0].down : this.bloom[0].up;
  }

  // per-frame grain offsets: two values of a UnityRandom stream seeded with the frame count.
  // ENGINE: Unity's Random is native (see random.js); the offsets match the game's only in distribution.
  static grainOffsets(seed) {
    const r = new UnityRandom(seed);
    return [r.value(), r.value()];
  }

  // SetupLensDistortion: _Distortion_Params1 = (center * 2 - 1, max(x multiplier, 1e-4), max(y multiplier, 1e-4)),
  // _Distortion_Params2 = (theta or 1 / theta, 2 tan(theta / 2), 1 / scale, intensity * 100) with theta = 1.6 *
  // max(|intensity * 100|, 1) degrees, at most 160
  static lensDistortionParams(L) {
    const amount = F(Math.abs(F(L.intensity * 100)));
    const theta = F(Math.min(F(160), F(Math.max(amount, 1) * F(1.6))) * F(0.017453292));
    const sigma = F(Math.tan(F(theta * 0.5)));
    return [
      [F(F(L.center.x * 2) - 1), F(F(L.center.y * 2) - 1), Math.max(F(L.xMultiplier), F(1e-4)), Math.max(F(L.yMultiplier), F(1e-4))],
      [L.intensity >= 0 ? theta : F(1 / theta), F(sigma * 2), F(1 / L.scale), F(L.intensity * 100)],
    ];
  }

  // LensDistortion.IsActive: intensity != 0 and a positive multiplier
  static lensDistortionActive(L) { return L.intensity !== 0 && (L.xMultiplier > 0 || L.yMultiplier > 0); }

  // --------------------------------------------------------------------- uber
  // `o` = {width, height (camera colour size), frameCount (grain seed), grain (textures by type), gray, black,
  // hasFinalPass (film grain then belongs to FinalPost)}
  uber(stack, source, bloomTex, target, o) {
    const B = stack.Bloom, G = stack.FilmGrain, V = stack.Vignette, s = "Hidden/Universal Render Pipeline/UberPost";
    const CA = stack.ChromaticAberration, LD = stack.LensDistortion, tm = stack.Tonemapping.mode;
    // UberPostSetupBloomPass: tint = Color.linear over ColorUtils.Luminance(tint) (white when not positive)
    const lin = URPPost.gammaToLinear;
    const tint = [lin(B.tint.r), lin(B.tint.g), lin(B.tint.b)];
    const l = tint[0] * 0.2126729 + tint[1] * 0.7151522 + tint[2] * 0.072175;
    const nt = l > 0 ? tint.map((v) => v / l) : [1, 1, 1];
    const kw = ["_USE_FAST_SRGB_LINEAR_CONVERSION", "_ENABLE_ALPHA_OUTPUT"];
    if (B.intensity > 0 && B.dirtTexture && B.dirtIntensity > 0) throw new Error("bloom lens dirt not implemented");
    if (B.intensity > 0) kw.push("_BLOOM_LQ");
    if (URPPost.lensDistortionActive(LD)) kw.push("_DISTORTION");
    if (CA.intensity > 0) kw.push("_CHROMATIC_ABERRATION");
    const grainOn = !o.hasFinalPass && G.intensity > 0 && (G.type !== 10 || !!G.texture);   // SetupGrain, FilmGrain.IsActive
    if (grainOn) kw.push("_FILM_GRAIN");
    if (tm === 2) kw.push("_TONEMAP_ACES");                     // LDR grading: tonemapping in the uber pass
    else if (tm === 1) kw.push("_TONEMAP_NEUTRAL");
    const gt = !grainOn ? o.gray : G.type === 10 ? this._volumeTexture(G.texture) : o.grain[G.type];
    if (!gt) throw new Error(`film grain type ${G.type}`);
    const [ox, oy] = URPPost.grainOffsets(o.frameCount);
    const w = o.width, h = o.height, tx = URPPost.texel;
    const aspect = w / h;
    const [d1, d2] = URPPost.lensDistortionParams(LD);
    this.blit(s, 0, [{
      _BlitTexture: source, _BlitTexture_TexelSize: tx(source),
      _Bloom_Texture: bloomTex, _BloomTexture_TexelSize: tx(bloomTex), _Bloom_Params: [B.intensity, ...nt],
      _InternalLut: this.lut, _Lut_Params: [1 / 256, 1 / 16, 15, Math.pow(2, stack.ColorAdjustments.postExposure)],
      _UserLut: o.black, _UserLut_Params: [0, 0, 0, 0],
      _Distortion_Params1: d1, _Distortion_Params2: d2, _Chroma_Params: F(CA.intensity * F(0.05)),
      _Vignette_Params1: [V.color.r, V.color.g, V.color.b, V.rounded ? aspect : 1],
      _Vignette_Params2: [V.center.x, V.center.y, V.intensity * 3, V.smoothness * 5],
      _Grain_Texture: gt, _Grain_Params: [G.intensity * 4, G.response],
      _Grain_TilingParams: [w / gt.width, h / gt.height, ox, oy],
    }], target, { keywords: kw });
  }

  // ------------------------------------------------------------------- chain
  // RenderPostProcessingRenderGraph of a camera: the LUT (ColorGradingLutPass), then from the camera colour `source`:
  // depth of field, motion blur, bloom (when Bloom is active) and the uber pass into `target`. The camera's motion data
  // is updated first (it is every frame, post or not). `o` = the uber options plus camera {view, proj, near, far} and
  // depth (the camera depth texture; null: nothing drew depth).
  // ENGINE: Application.isPlaying is true (motion blur runs).
  render(stack, source, target, o) {
    this.updateMotion(o.camera, F(o.width / o.height), o.frameCount);
    this.buildLut(stack);
    let color = source;
    if (URPPost.dofActive(stack)) color = this._depthOfField(stack, color, o);
    if (stack.MotionBlur.intensity > 0) color = this._motionBlur(stack, color, o);    // MotionBlur.IsActive
    const bloom = stack.Bloom.intensity > 0 ? this.renderBloom(stack, color) : o.black;   // Bloom.IsActive
    this.uber(stack, color, bloom, target, o);
  }

  // ---------------------------------------------------------------- FinalPost
  // FXAA when the camera's antialiasing is FXAA; the GLES3 programs are in subshader 1 (subshader 0 is GLES 3.1).
  // `target` null = default framebuffer with `viewport`.
  finalPost(source, target, { width, height, fxaa, viewport = null }) {
    const kw = fxaa ? ["_FXAA", "_ENABLE_ALPHA_OUTPUT"] : ["_ENABLE_ALPHA_OUTPUT"];
    this.blit("Hidden/Universal Render Pipeline/FinalPost", 0,
              [{ _BlitTexture: source, _SourceSize: [width, height, 1 / width, 1 / height] }], target,
              { subShader: 1, keywords: kw, viewport });
  }
};
