import { F } from "./core.js";
import { applyState } from "./glsl.js";
import { UnityRandom } from "./random.js";
import { GLTarget, GLTex } from "./texture.js";

// URPPost: the URP 17 post-processing chain of a camera that runs post (LiveEffectCamera in the live
// renderer): Volume parameter defaults and stack evaluation, the
// full-screen blit, the LDR colour grading LUT (ColorGradingLutPass), Bloom (RenderBloomTexture, Gaussian, low
// quality), UberPost (bloom, internal LUT, vignette, film grain) and FinalPost (FXAA). The chain runs the game's own
// GLES3 programs through ShaderLib; every value fed to them is the one URP computes on the CPU.
//
// Blits draw one full-screen triangle with no vertex inputs (Blitter.BlitTexture with the procedural triangle,
// _BlitScaleBias (1, 1, 0, 0)); a null target means the default framebuffer with the caller's viewport.

// Volume component defaults (URP VolumeParameter initial values) for the components the game's profiles use;
// AdvCurvedLens (a game component) is inactive unless a profile overrides its intensity.
export const VOLUME_DEFAULTS = {
  Bloom: { skipIterations: 1, threshold: 0.9, intensity: 0, scatter: 0.7, clamp: 65472, tint: { r: 1, g: 1, b: 1, a: 1 },
           highQualityFiltering: 0, filter: 0, downscale: 0, maxIterations: 6, dirtTexture: null, dirtIntensity: 0 },
  WhiteBalance: { temperature: 0, tint: 0 },
  ColorAdjustments: { postExposure: 0, contrast: 0, colorFilter: { r: 1, g: 1, b: 1, a: 1 }, hueShift: 0, saturation: 0 },
  Vignette: { color: { r: 0, g: 0, b: 0, a: 1 }, center: { x: 0.5, y: 0.5 }, intensity: 0, smoothness: 0.2, rounded: 0 },
  FilmGrain: { type: 0, intensity: 0, response: 0.8, texture: null },
  AdvCurvedLens: { center: { x: 0.5, y: 0.5 }, intensity: 0, size: 0, softness: 1, horizontalRate: 0, verticalRate: 0,
                   scale: 1, attenuateByCameraDistance: 0, reverse: 0 },
};

// FloatParameter-typed parameters (interpolated); every other scalar parameter
// (int, enum, bool, texture) takes the overriding value when the weight is > 0.
export const VOLUME_FLOATS = {
  Bloom: ["threshold", "intensity", "scatter", "clamp", "dirtIntensity"],
  WhiteBalance: ["temperature", "tint"],
  ColorAdjustments: ["postExposure", "contrast", "hueShift", "saturation"],
  Vignette: ["intensity", "smoothness"],
  FilmGrain: ["intensity", "response"],
  AdvCurvedLens: ["intensity", "size", "softness", "horizontalRate", "verticalRate", "scale"],
};

export class URPPost {
  constructor(gl, lib, { vao = null } = {}) {
    this.gl = gl; this.lib = lib;
    this.vao = vao || gl.createVertexArray();
    this.lut = null; this.curves = null;
    this.bloom = []; this.bloomBase = null;
  }

  // VolumeManager stack for one camera: defaults, then each volume (registration order) blended by its weight.
  // `volumes` = [{profile: {components: [...]}, weight}].
  static evaluateStack(volumes) {
    const stack = JSON.parse(JSON.stringify(VOLUME_DEFAULTS));
    const lerp = (a, b, t) => a + (b - a) * t;
    for (const v of volumes) {
      const t = Math.min(1, Math.max(0, v.weight));
      for (const comp of v.profile.components) {
        if (!comp.active) continue;
        const dst = stack[comp.asset];
        if (!dst) throw new Error(`volume component ${comp.asset} not supported`);
        for (const [k, p] of Object.entries(comp)) {
          if (!p || typeof p !== "object" || !("m_OverrideState" in p) || !p.m_OverrideState) continue;
          if (!(k in dst)) throw new Error(`${comp.asset}.${k}: unknown parameter`);
          const from = dst[k], to = p.m_Value;
          if (VOLUME_FLOATS[comp.asset].includes(k)) dst[k] = lerp(from, to, t);      // FloatParameter.Interp
          else if (to && typeof to === "object" && "r" in to)
            dst[k] = { r: lerp(from.r, to.r, t), g: lerp(from.g, to.g, t), b: lerp(from.b, to.b, t), a: lerp(from.a, to.a, t) };
          else if (to && typeof to === "object" && "x" in to) dst[k] = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
          else if (t > 0) dst[k] = to;
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

  // neutral colour curves (TextureCurve, 128 x 1) and the 256 x 16 internal LUT target
  initLut() {
    const gl = this.gl;
    const curve = (f) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const px = new Float32Array(128);
      for (let i = 0; i < 128; i++) px[i] = f(i * (1 / 128));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 128, 1, 0, gl.RED, gl.FLOAT, px);
      GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 }, 1);
      return new GLTex(gl, t, 128, 1, "curve");
    };
    const linear = curve((x) => x), half = curve(() => 0.5);
    this.curves = { _CurveMaster: linear, _CurveRed: linear, _CurveGreen: linear, _CurveBlue: linear,
                    _CurveHueVsHue: half, _CurveHueVsSat: half, _CurveSatVsSat: half, _CurveLumVsSat: half };
    this.lut = new GLTarget(gl, 256, 16, { label: "InternalLut" });
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

  static gammaToLinear(c) {             // Mathf.GammaToLinearSpace
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  static texel(t) { return [1 / t.width, 1 / t.height, t.width, t.height]; }

  // ---------------------------------------------------------------------- LUT
  buildLut(stack) {                         // ColorGradingLutPass, LDR, size 16
    const wb = stack.WhiteBalance, F = Math.fround;
    const t1 = F(wb.temperature / 65), t2 = F(wb.tint / 65);
    const x = F(0.31271 - F(t1 * (t1 < 0 ? 0.1 : 0.05)));
    const y = F(F(F(F(2.87 * x) - F(F(3 * x) * x)) - 0.27509507) + F(t2 * 0.05));
    const X = F(x / y), Z = F(F(F(1 - x) - y) / y);
    const L = F(F(F(0.7328 * X) + 0.4296) - F(0.1624 * Z));
    const M = F(F(F(-0.7036 * X) + 1.6975) + F(0.0061 * Z));
    const S = F(F(F(0.003 * X) + 0.0136) + F(0.9834 * Z));
    const ca = stack.ColorAdjustments;
    if (ca.postExposure || ca.contrast || ca.hueShift || ca.saturation) throw new Error("colour adjustments not implemented");
    const lum = (v) => F(F(F(v[0] * 0.2126729) + F(v[1] * 0.7151522)) + F(v[2] * 0.072175));
    const lift = [F(1 * 0.15), F(1 * 0.15), F(1 * 0.15)], lL = lum(lift);
    const gam = [F(0.8), F(0.8), F(0.8)], lG = lum(gam);
    const gain = [F(0.8), F(0.8), F(0.8)], lN = lum(gain);
    const sheet = {
      _Lut_Params: [16, 0.5 / 256, 0.5 / 16, 16 / 15],
      _ColorBalance: [F(0.949237 / L), F(1.03542 / M), F(1.08728 / S), 0],
      _ColorFilter: [ca.colorFilter.r, ca.colorFilter.g, ca.colorFilter.b, ca.colorFilter.a],
      _ChannelMixerRed: [1, 0, 0, 0], _ChannelMixerGreen: [0, 1, 0, 0], _ChannelMixerBlue: [0, 0, 1, 0],
      _HueSatCon: [0, 1, 1, 0],
      _Lift: [...lift.map((v) => F(v - lL)), 0],
      _Gamma: [...gam.map((v) => F(1 / Math.max(F(F(v - lG) + 1), 1e-3))), 0],
      _Gain: [...gain.map((v) => F(F(v - lN) + 1)), 0],
      _Shadows: [1, 1, 1, 0], _Midtones: [1, 1, 1, 0], _Highlights: [1, 1, 1, 0], _ShaHiLimits: [0, 0.3, 0.55, 1],
      _SplitShadows: [0.5, 0.5, 0.5, 0], _SplitHighlights: [0.5, 0.5, 0.5, 0],
      ...this.curves,
    };
    const s = "Hidden/Universal Render Pipeline/LutBuilderLdr";
    this.blit(s, 0, [sheet], this.lut);
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

  // --------------------------------------------------------------------- uber
  // `o` = {width, height (camera colour size), frameCount (grain seed), grain (textures by type), gray, black}
  uber(stack, source, bloomTex, target, o) {
    const B = stack.Bloom, G = stack.FilmGrain, V = stack.Vignette, s = "Hidden/Universal Render Pipeline/UberPost";
    const lin = URPPost.gammaToLinear;
    const tint = [lin(B.tint.r), lin(B.tint.g), lin(B.tint.b)];
    const l = tint[0] * 0.2126729 + tint[1] * 0.7151522 + tint[2] * 0.072175;
    const nt = l > 0 ? tint.map((v) => v / l) : [1, 1, 1];
    const kw = ["_USE_FAST_SRGB_LINEAR_CONVERSION", "_ENABLE_ALPHA_OUTPUT"];
    if (B.intensity > 0) kw.push("_BLOOM_LQ");
    const grainOn = G.intensity > 0;
    if (grainOn) kw.push("_FILM_GRAIN");
    const gt = grainOn ? o.grain[G.type] : o.gray;
    if (!gt) throw new Error(`film grain type ${G.type}`);
    const [ox, oy] = URPPost.grainOffsets(o.frameCount);
    const w = o.width, h = o.height, tx = URPPost.texel;
    const aspect = w / h;
    this.blit(s, 0, [{
      _BlitTexture: source, _BlitTexture_TexelSize: tx(source),
      _Bloom_Texture: bloomTex, _BloomTexture_TexelSize: tx(bloomTex), _Bloom_Params: [B.intensity, ...nt],
      _InternalLut: this.lut, _Lut_Params: [1 / 256, 1 / 16, 15, Math.pow(2, stack.ColorAdjustments.postExposure)],
      _UserLut: o.black, _UserLut_Params: [0, 0, 0, 0],
      _Vignette_Params1: [V.color.r, V.color.g, V.color.b, V.rounded ? aspect : 1],
      _Vignette_Params2: [V.center.x, V.center.y, V.intensity * 3, V.smoothness * 5],
      _Grain_Texture: gt, _Grain_Params: [G.intensity * 4, G.response],
      _Grain_TilingParams: [w / gt.width, h / gt.height, ox, oy],
    }], target, { keywords: kw });
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
