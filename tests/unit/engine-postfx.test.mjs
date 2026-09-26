// URPPost (src/engine/postfx.js): Volume stack evaluation (VolumeManager, VolumeParameter.Interp per parameter type),
// TextureCurve evaluation, the colour grading inputs (ColorGradingLutPass, ColorUtils), the uber pass keywords and
// values, lens distortion, the bokeh kernel, depth of field, camera motion blur and the pass order of the chain. The
// shader programs are stand-ins that record what each blit feeds them; GL is the headless stand-in. Synthetic inputs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CURVE_DEFAULTS, URPPost, VOLUME_DEFAULTS, VOLUME_PARAMS } from "../../src/engine/postfx.js";
import { mat4 } from "../../src/engine/math.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

const F = Math.fround;
const STATE = { src: 1, dst: 0, srcA: 1, dstA: 0, op: 0, opA: 0, colMask: 15, zTest: 8, zWrite: 0, cull: 0,
                offsetFactor: 0, offsetUnits: 0, stencilFront: [8, 0, 0, 0], stencilBack: [8, 0, 0, 0],
                stencilRef: 0, stencilRead: 255, stencilWrite: 255 };

// a URPPost on the headless GL with recording programs: blits = [{shader, pass, keywords, subShader, value(name)}]
const rig = ({ w = 1280, h = 720 } = {}) => {
  const calls = [], blits = [];
  const gl = headlessGL({ onCall: (name, args) => calls.push({ name, args }) });
  const lib = {
    program: (shader, pass, keywords, subShader) => ({ apply: (sheets) => {
      const value = (n) => { for (const s of sheets) if (n in s) return s[n]; return undefined; };
      blits.push({ shader: shader.split("/").pop(), pass, keywords: [...keywords].sort(), subShader, value });
    } }),
    state: () => STATE,
  };
  const post = new URPPost(gl, lib, {});
  post.initLut();
  post.resizeBloom(w, h);
  const tex = (tw, th, label) => ({ glTexture: gl.createTexture(), width: tw, height: th, label, bind() {} });
  const o = { width: w, height: h, frameCount: 7, grain: Array.from({ length: 10 }, (_, i) => tex(256, 256, `grain${i}`)),
              gray: tex(4, 4, "gray"), black: tex(4, 4, "black") };
  return { gl, post, calls, blits, tex, o, src: tex(w, h, "color"), dst: tex(w, h, "post") };
};

const P = (asset, params, active = 1) => ({ asset, active, ...Object.fromEntries(
  Object.entries(params).map(([k, v]) => [k, { m_OverrideState: 1, m_Value: v }])) });
const vol = (components, weight = 1) => ({ profile: { components }, weight });
const f32 = (v) => Array.from(v, F);

// ----------------------------------------------------------------------------------------------- volume stack
test("every component of VOLUME_DEFAULTS has a kind for each parameter and nothing else", () => {
  assert.deepEqual(Object.keys(VOLUME_PARAMS).sort(), Object.keys(VOLUME_DEFAULTS).sort());
  for (const [c, kinds] of Object.entries(VOLUME_PARAMS)) {
    assert.deepEqual(Object.keys(kinds).sort(), Object.keys(VOLUME_DEFAULTS[c]).sort(), c);
    for (const k of Object.values(kinds)) assert.ok(["f", "i", "c", "v2", "v4", "n"].includes(k), `${c}: ${k}`);
  }
});

test("the default stack is the defaults, with fresh colour and vector objects", () => {
  const a = URPPost.evaluateStack([]), b = URPPost.evaluateStack([]);
  assert.deepEqual(a, VOLUME_DEFAULTS);
  assert.notEqual(a.Bloom.tint, VOLUME_DEFAULTS.Bloom.tint);
  a.Vignette.center.x = 0; assert.equal(b.Vignette.center.x, 0.5);
  assert.equal(a.ColorCurves.master, CURVE_DEFAULTS.linear);
  assert.equal(a.ColorCurves.hueVsSat, CURVE_DEFAULTS.hue);
  assert.equal(a.ColorCurves.lumVsSat, CURVE_DEFAULTS.sat);
});

test("FloatParameter.Interp lerps in float32 (from + (to - from) * t, each step rounded)", () => {
  const t = F(0.3), from = F(0.9), to = F(0.2);
  const s = URPPost.evaluateStack([vol([P("Bloom", { threshold: to, scatter: F(0.25) })], 0.3)]);
  assert.equal(s.Bloom.threshold, F(from + F(F(to - from) * t)));
  assert.equal(s.Bloom.scatter, F(F(0.7) + F(F(F(0.25) - F(0.7)) * t)));
  // two volumes blend in order, each from the value before it
  const two = URPPost.evaluateStack([vol([P("Bloom", { intensity: 2 })], 0.5), vol([P("Bloom", { intensity: 4 })], 0.25)]);
  assert.equal(two.Bloom.intensity, F(1 + F(F(4 - 1) * 0.25)));
});

test("IntParameter.Interp truncates (int)((to - from) * t + from)", () => {
  const at = (to, t) => URPPost.evaluateStack([vol([P("Bloom", { maxIterations: to })], t)]).Bloom.maxIterations;
  assert.equal(at(3, 0.5), 4);                    // from 6: 6 + (-1.5) = 4.5 -> 4
  assert.equal(at(9, 0.5), 7);                    // 7.5 -> 7
  assert.equal(at(3, 1), 3);
  assert.equal(at(3, 0), 6);
  const neg = URPPost.evaluateStack([vol([P("Bloom", { skipIterations: -4 })], 0.5)]).Bloom.skipIterations;
  assert.equal(neg, -1);                          // 1 + (-2.5) = -1.5 -> -1 (towards zero)
  const blades = URPPost.evaluateStack([vol([P("DepthOfField", { bladeCount: 8 })], 0.7)]).DepthOfField.bladeCount;
  assert.equal(blades, Math.trunc(F(F(3 * F(0.7)) + 5)));
});

test("colours and vectors lerp per component; other parameters take the overriding value when t > 0", () => {
  const c = { r: 1, g: 0.5, b: 0.25, a: 1 }, t = F(0.4);
  const s = URPPost.evaluateStack([vol([
    P("Bloom", { tint: c, highQualityFiltering: 1 }),
    P("Vignette", { center: { x: 0.2, y: 0.9 }, rounded: 1 }),
    P("LiftGammaGain", { lift: { x: 0.5, y: 1, z: 1, w: 0.2 } }),
    P("FilmGrain", { type: 9 }),
  ], 0.4)]);
  const L = (a, b) => F(F(a) + F(F(F(b) - F(a)) * t));
  assert.deepEqual(s.Bloom.tint, { r: 1, g: L(1, 0.5), b: L(1, 0.25), a: 1 });
  assert.deepEqual(s.Vignette.center, { x: L(0.5, 0.2), y: L(0.5, 0.9) });
  assert.deepEqual(s.LiftGammaGain.lift, { x: L(1, 0.5), y: 1, z: 1, w: L(0, 0.2) });
  assert.equal(s.Bloom.highQualityFiltering, 1);
  assert.equal(s.Vignette.rounded, 1);
  assert.equal(s.FilmGrain.type, 9);
  const none = URPPost.evaluateStack([vol([P("FilmGrain", { type: 9 })], 0)]);
  assert.equal(none.FilmGrain.type, 0);
  const curve = { ...CURVE_DEFAULTS.linear };
  assert.equal(URPPost.evaluateStack([vol([P("ColorCurves", { master: curve })], 0.01)]).ColorCurves.master, curve);
});

test("weights clamp to [0, 1]; inactive components and parameters without override are skipped", () => {
  assert.equal(URPPost.evaluateStack([vol([P("Bloom", { intensity: 3 })], 7)]).Bloom.intensity, 3);
  assert.equal(URPPost.evaluateStack([vol([P("Bloom", { intensity: 3 })], -2)]).Bloom.intensity, 0);
  assert.equal(URPPost.evaluateStack([vol([P("Bloom", { intensity: 3 }, 0)])]).Bloom.intensity, 0);
  const off = { asset: "Bloom", active: 1, intensity: { m_OverrideState: 0, m_Value: 3 } };
  assert.equal(URPPost.evaluateStack([vol([off])]).Bloom.intensity, 0);
});

test("unknown components and parameters are errors", () => {
  assert.throws(() => URPPost.evaluateStack([vol([P("PaniniProjection", { distance: 1 })])]), /PaniniProjection not supported/);
  assert.throws(() => URPPost.evaluateStack([vol([P("Bloom", { lensFlare: 1 })])]), /Bloom\.lensFlare: unknown parameter/);
});

// ---------------------------------------------------------------------------------------------- TextureCurve
const curveOf = (keys, { length = keys.length, loop = 0, zero = 0 } = {}) => ({
  "<length>k__BackingField": length, m_Loop: loop, m_ZeroValue: zero, m_Range: 1,
  m_Curve: { m_Curve: keys.map(([time, value, slope = 0]) => ({ time, value, inSlope: slope, outSlope: slope,
                                                                    weightedMode: 0, inWeight: 0, outWeight: 0 })),
             m_PreInfinity: 2, m_PostInfinity: 2, m_RotationOrder: 4 },
});

test("the default curves evaluate to the identity and to 0.5", () => {
  for (let i = 0; i < 128; i++) {
    assert.equal(URPPost.evaluateCurve(CURVE_DEFAULTS.linear, i / 128), i / 128);
    assert.equal(URPPost.evaluateCurve(CURVE_DEFAULTS.hue, i / 128), 0.5);
    assert.equal(URPPost.evaluateCurve(CURVE_DEFAULTS.sat, i / 128), 0.5);
  }
});

test("TextureCurve.Evaluate goes by the serialized length", () => {
  assert.equal(URPPost.evaluateCurve(curveOf([], { zero: 0.25 }), 0.3), 0.25);
  assert.equal(URPPost.evaluateCurve(curveOf([], { length: 1, zero: 0.25 }), 0.3), 0);          // AnimationCurve, no keys
  assert.equal(URPPost.evaluateCurve(curveOf([[0.4, F(0.7)]], { loop: 1 }), 0.9), F(0.7));        // one key, looping
  const c = curveOf([[0, 0, 1], [0.5, 0.6, 1], [1, 1, 1]]);
  assert.equal(URPPost.evaluateCurve(c, 0.5), F(0.6));
  assert.ok(URPPost.evaluateCurve(c, 0.25) > 0.25);
  assert.equal(URPPost.evaluateCurve(c, 2), 1);                                                    // clamped
  assert.throws(() => URPPost.evaluateCurve(curveOf([[0, 0], [0.5, 1]], { loop: 1 }), 0.2), /looping TextureCurve/);
});

// ----------------------------------------------------------------------------------------- colour grading
const lum = (c) => F(F(F(c[0] * F(0.2126729)) + F(c[1] * F(0.7151522))) + F(c[2] * F(0.072175)));
const g2l = (c) => (c <= 0.04045 ? c / 12.92 : c < 1 ? Math.pow((c + 0.055) / 1.055, 2.4)
  : c === 1 ? 1 : Math.pow(c, F(2.2)));

test("Mathf.GammaToLinearSpace: linear below 0.04045, the sRGB curve below 1, pow 2.2 above 1", () => {
  assert.equal(URPPost.gammaToLinear(0.02), 0.02 / 12.92);
  assert.equal(URPPost.gammaToLinear(0.5), Math.pow(0.555 / 1.055, 2.4));
  assert.equal(URPPost.gammaToLinear(1), 1);
  assert.equal(URPPost.gammaToLinear(F(1.2)), Math.pow(F(1.2), F(2.2)));
});

test("ColorUtils.PrepareLiftGammaGain", () => {
  const neutral = { x: 1, y: 1, z: 1, w: 0 };
  const [l, g, n] = URPPost.prepareLiftGammaGain({ lift: neutral, gamma: neutral, gain: neutral });
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(l[i]) < 1e-6);
    assert.ok(Math.abs(g[i] - 1) < 1e-6);
    assert.ok(Math.abs(n[i] - 1) < 1e-6);
  }
  assert.equal(l[3], 0); assert.equal(g[3], 0); assert.equal(n[3], 0);
  const lift = { x: 0.8, y: 0.5, z: 0.2, w: 0.1 }, gamma = { x: 0.3, y: 0.3, z: 0.3, w: -2 }, gain = { x: 1, y: 0.9, z: 0.7, w: -0.125 };
  const [L, G, N] = URPPost.prepareLiftGammaGain({ lift, gamma, gain });
  const lin = (v, s) => [v.x, v.y, v.z].map((c) => F(g2l(c) * F(s)));
  const ll = lin(lift, 0.15), gl = lin(gamma, 0.8), nl = lin(gain, 0.8);
  assert.deepEqual(L.slice(0, 3), ll.map((c) => F(F(0.1) + F(c - lum(ll)))));
  assert.deepEqual(G.slice(0, 3), gl.map((c) => F(1 / Math.max(F(F(-2 + 1) + F(c - lum(gl))), F(0.001)))));
  assert.deepEqual(N.slice(0, 3), nl.map((c) => F(F(F(-0.125) + 1) + F(c - lum(nl)))));
  assert.equal(G[0], F(1 / F(0.001)));             // clamped before the inverse
});

test("ColorUtils.PrepareShadowsMidtonesHighlights: linear + w (x4 for w >= 0), at least 0", () => {
  const [s, m, h] = URPPost.prepareShadowsMidtonesHighlights({
    shadows: { x: 1, y: 0.5, z: 0, w: 0.25 }, midtones: { x: 1, y: 1, z: 1, w: -0.194 }, highlights: { x: 0.2, y: 0.2, z: 0.2, w: -1 },
  });
  assert.deepEqual(s, [2, F(g2l(0.5) + 1), 1, 0]);
  assert.deepEqual(m, [F(1 + F(-0.194)), F(1 + F(-0.194)), F(1 + F(-0.194)), 0]);
  assert.deepEqual(h, [0, 0, 0, 0]);
});

test("the neutral LUT inputs", () => {
  const r = rig();
  r.post.buildLut(URPPost.evaluateStack([]));
  assert.equal(r.blits.length, 1);
  const b = r.blits[0], v = b.value;
  assert.equal(b.shader, "LutBuilderLdr"); assert.equal(b.pass, 0); assert.deepEqual(b.keywords, []);
  assert.deepEqual(v("_Lut_Params"), [16, 0.5 / 256, 0.5 / 16, 16 / 15]);
  for (const x of v("_ColorBalance").slice(0, 3)) assert.ok(Math.abs(x - 1) < 1e-5);
  assert.deepEqual(v("_ColorFilter"), [1, 1, 1, 1]);
  assert.deepEqual(v("_ChannelMixerRed"), [1, 0, 0, 0]);
  assert.deepEqual(v("_ChannelMixerGreen"), [0, 1, 0, 0]);
  assert.deepEqual(v("_ChannelMixerBlue"), [0, 0, 1, 0]);
  assert.deepEqual(v("_HueSatCon"), [0, 1, 1, 0]);
  assert.deepEqual(v("_Shadows"), [1, 1, 1, 0]);
  assert.deepEqual(v("_ShaHiLimits"), [0, 0.3, 0.55, 1]);
  assert.deepEqual(v("_SplitShadows"), [0.5, 0.5, 0.5, 0]);
  assert.deepEqual(v("_SplitHighlights"), [0.5, 0.5, 0.5, 0]);
  const linear = v("_CurveMaster"), half = v("_CurveHueVsHue");
  assert.notEqual(linear, half);
  for (const n of ["_CurveRed", "_CurveGreen", "_CurveBlue"]) assert.equal(v(n), linear);
  for (const n of ["_CurveHueVsSat", "_CurveSatVsSat", "_CurveLumVsSat"]) assert.equal(v(n), half);
  assert.equal(v("_Lift").length, 4);
});

test("the LUT inputs of colour adjustments, mixer, split toning, white balance and curves", () => {
  const r = rig();
  const master = curveOf([[0, 0, 1], [F(0.19), F(0.22), F(1.19)], [1, 1, 1]]);
  const stack = URPPost.evaluateStack([vol([
    P("ColorAdjustments", { postExposure: 0.05, contrast: 41.5, colorFilter: { r: 0.5, g: 1, b: 0.25, a: 0.75 },
                            hueShift: 90, saturation: -100 }),
    P("ChannelMixer", { redOutRedIn: 50, greenOutBlueIn: -20 }),
    P("SplitToning", { shadows: { r: 0.4, g: 0.5, b: 0.6, a: 1 }, highlights: { r: 0.7, g: 0.6, b: 0.5, a: 1 }, balance: 20 }),
    P("ShadowsMidtonesHighlights", { shadowsEnd: 0.4 }),
    P("WhiteBalance", { temperature: 48.6 }),
    P("ColorCurves", { master }),
  ])]);
  const uploads = [];
  r.calls.length = 0;
  r.post.buildLut(stack);
  for (const c of r.calls) if (c.name === "texImage2D") uploads.push(c.args);
  const v = r.blits[0].value;
  assert.deepEqual(v("_ColorFilter"), [g2l(0.5), 1, g2l(0.25), 0.75]);
  assert.deepEqual(v("_ChannelMixerRed"), [F(0.5), 0, 0, 0]);
  assert.deepEqual(v("_ChannelMixerGreen"), [0, 1, F(-0.2), 0]);
  assert.deepEqual(v("_HueSatCon"), [F(0.25), 0, F(F(F(41.5) / 100) + 1), 0]);
  assert.deepEqual(v("_SplitShadows"), [F(0.4), F(0.5), F(0.6), F(0.2)]);
  assert.deepEqual(v("_SplitHighlights"), [F(0.7), F(0.6), F(0.5), 0]);
  assert.equal(v("_ShaHiLimits")[1], F(0.4));
  const cb = v("_ColorBalance");
  assert.ok(cb[0] > 1 && cb[2] < 1, "warmer white balance: more L gain, less S gain");
  // one new curve texture: R16F 128 x 1 with Evaluate(i / 128)
  assert.equal(uploads.length, 1);
  const [, , internal, w, h, , , , px] = uploads[0];
  assert.equal(internal, r.gl.R16F); assert.equal(w, 128); assert.equal(h, 1);
  assert.deepEqual(Array.from(px), Array.from({ length: 128 }, (_, i) => URPPost.evaluateCurve(master, i / 128)).map(F));
  assert.notEqual(v("_CurveMaster"), v("_CurveRed"));
  r.calls.length = 0;
  r.post.buildLut(stack);                                                      // baked once per curve value
  assert.equal(r.calls.filter((c) => c.name === "texImage2D").length, 0);
});

// ---------------------------------------------------------------------------------------------------- bloom
test("bloom prefilter: scatter = Mathf.Lerp(0.05, 0.95), threshold in linear, knee = threshold / 2", () => {
  const r = rig();
  const stack = URPPost.evaluateStack([vol([P("Bloom", { threshold: F(1.2), intensity: 5, scatter: F(0.7) })])]);
  r.post.renderBloom(stack, r.src);
  const p = r.blits[0].value("_Params");
  const thr = g2l(F(1.2));
  assert.deepEqual(f32(p), f32([F(F(0.05) + F(F(F(0.95) - F(0.05)) * F(0.7))), 65472, thr, thr * 0.5]));
  assert.deepEqual(r.blits[0].keywords, ["_ENABLE_ALPHA_OUTPUT"]);
});

// ----------------------------------------------------------------------------------------------------- uber
const uberOf = (components, opts = {}) => {
  const r = rig();
  const stack = URPPost.evaluateStack([vol(components)]);
  r.post.uber(stack, r.src, r.o.black, r.dst, { ...r.o, ...opts });
  return { r, b: r.blits[0], v: r.blits[0].value };
};

test("uber keywords of the default stack", () => {
  const { b } = uberOf([]);
  assert.equal(b.shader, "UberPost");
  assert.deepEqual(b.keywords, ["_ENABLE_ALPHA_OUTPUT", "_USE_FAST_SRGB_LINEAR_CONVERSION"]);
});

test("uber bloom tint: linear tint times 1 / luminance, white when the luminance is not positive", () => {
  const white = uberOf([P("Bloom", { intensity: 0.6 })]);
  assert.ok(white.b.keywords.includes("_BLOOM_LQ"));
  const w = F(1 / lum([1, 1, 1]));
  assert.deepEqual(f32(white.v("_Bloom_Params")), [F(0.6), w, w, w]);
  const tint = { r: 1, g: F(0.8), b: F(0.6), a: 1 };
  const t = uberOf([P("Bloom", { intensity: 2, tint })]);
  const lin = [1, F(g2l(F(0.8))), F(g2l(F(0.6)))], rl = F(1 / lum(lin));
  const got = f32(t.v("_Bloom_Params")), want = [2, ...lin.map((c) => F(c * rl))];
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(got[i] - want[i]) <= 2.4e-7 * Math.abs(want[i]), `${i}: ${got[i]} ${want[i]}`);
  const black = uberOf([P("Bloom", { intensity: 2, tint: { r: 0, g: 0, b: 0, a: 1 } })]);
  assert.deepEqual(black.v("_Bloom_Params"), [2, 1, 1, 1]);
});

test("chromatic aberration, vignette and tonemapping", () => {
  const { b, v } = uberOf([P("ChromaticAberration", { intensity: F(0.46) }),
                           P("Vignette", { intensity: F(0.42), smoothness: F(0.35), center: { x: 0.5, y: 0.4 }, rounded: 1 }),
                           P("Tonemapping", { mode: 2 })]);
  assert.ok(b.keywords.includes("_CHROMATIC_ABERRATION"));
  assert.ok(b.keywords.includes("_TONEMAP_ACES"));
  assert.equal(v("_Chroma_Params"), F(F(0.46) * F(0.05)));
  assert.deepEqual(f32(v("_Vignette_Params1")), [0, 0, 0, F(1280 / 720)]);
  assert.deepEqual(f32(v("_Vignette_Params2")), [0.5, F(0.4), F(F(0.42) * 3), F(F(0.35) * 5)]);
  assert.ok(uberOf([P("Tonemapping", { mode: 1 })]).b.keywords.includes("_TONEMAP_NEUTRAL"));
});

test("lens distortion: keyword when active, SetupLensDistortion values", () => {
  const on = uberOf([P("LensDistortion", { intensity: F(0.5), center: { x: F(0.25), y: 0.5 }, xMultiplier: 0, scale: 2 })]);
  assert.ok(on.b.keywords.includes("_DISTORTION"));
  const theta = F(F(Math.min(160, F(50 * F(1.6)))) * F(0.017453292));
  assert.deepEqual(f32(on.v("_Distortion_Params1")), [-0.5, 0, F(1e-4), 1]);
  assert.deepEqual(f32(on.v("_Distortion_Params2")), [theta, F(F(Math.tan(F(theta * 0.5))) * 2), 0.5, 50]);
  const [, neg] = URPPost.lensDistortionParams({ intensity: F(-0.5), xMultiplier: 1, yMultiplier: 1, center: { x: 0.5, y: 0.5 }, scale: 1 });
  assert.equal(neg[0], F(1 / theta));
  const [, big] = URPPost.lensDistortionParams({ intensity: 2, xMultiplier: 1, yMultiplier: 1, center: { x: 0.5, y: 0.5 }, scale: 1 });
  assert.equal(big[0], F(F(160) * F(0.017453292)));                 // at most 160 degrees
  const [, small] = URPPost.lensDistortionParams({ intensity: F(0.001), xMultiplier: 1, yMultiplier: 1, center: { x: 0.5, y: 0.5 }, scale: 1 });
  assert.equal(small[0], F(F(1.6) * F(0.017453292)));               // |intensity * 100| at least 1
  const [p1] = URPPost.lensDistortionParams({ intensity: 1, xMultiplier: -1, yMultiplier: -3, center: { x: 0.5, y: 0.5 }, scale: 1 });
  assert.deepEqual(f32(p1.slice(2)), [F(1e-4), F(1e-4)]);
  assert.ok(!uberOf([P("LensDistortion", { intensity: 0.5, xMultiplier: 0, yMultiplier: 0 })]).b.keywords.includes("_DISTORTION"));
  assert.ok(!uberOf([P("LensDistortion", { intensity: 0 })]).b.keywords.includes("_DISTORTION"));
});

test("film grain: renderer textures by type, a custom texture, none without texture or with a final pass", () => {
  const g = uberOf([P("FilmGrain", { type: 9, intensity: 1, response: F(0.3) })]);
  assert.ok(g.b.keywords.includes("_FILM_GRAIN"));
  assert.equal(g.v("_Grain_Texture").label, "grain9");
  assert.deepEqual(f32(g.v("_Grain_Params")), [4, F(0.3)]);
  const tiling = g.v("_Grain_TilingParams");
  assert.deepEqual(tiling.slice(0, 2), [1280 / 256, 720 / 256]);
  assert.deepEqual(tiling.slice(2), URPPost.grainOffsets(7));
  const desc = { texture: "textures/custom.png", name: "custom", width: 64, height: 32, mipCount: 1 };
  assert.ok(!uberOf([P("FilmGrain", { type: 10, intensity: 1 })]).b.keywords.includes("_FILM_GRAIN"));
  assert.throws(() => uberOf([P("FilmGrain", { type: 10, intensity: 1, texture: desc })]), /custom not loaded/);
  const r = rig(), custom = r.tex(64, 32, "custom");
  r.post.volumeTextures.set(desc.texture, custom);
  r.post.uber(URPPost.evaluateStack([vol([P("FilmGrain", { type: 10, intensity: 1, texture: desc })])]), r.src, r.o.black, r.dst, r.o);
  assert.equal(r.blits[0].value("_Grain_Texture"), custom);
  assert.deepEqual(r.blits[0].value("_Grain_TilingParams").slice(0, 2), [20, 22.5]);
  const fin = uberOf([P("FilmGrain", { type: 9, intensity: 1 })], { hasFinalPass: true });
  assert.ok(!fin.b.keywords.includes("_FILM_GRAIN"));
  assert.equal(fin.v("_Grain_Texture").label, "gray");
});

test("loadVolumeTextures loads the overridden texture parameters once, with the uber pass's samplers", async () => {
  const r = rig();
  const images = [];
  const assets = { image: async (p) => { images.push(p); return { width: 64, height: 32, close() {} }; } };
  const desc = { texture: "textures/custom.png", name: "custom", width: 64, height: 32, mipCount: 1,
                 settings: { m_FilterMode: 0, m_WrapU: 1, m_WrapV: 1 } };
  const prof = { components: [P("FilmGrain", { type: 10, intensity: 1, texture: desc }),
                              { asset: "Bloom", active: 1, dirtTexture: { m_OverrideState: 0, m_Value: { ...desc, texture: "textures/dirt.png" } } }] };
  r.calls.length = 0;
  await r.post.loadVolumeTextures("base", [prof, prof], assets);
  assert.equal(images.length, 1);
  assert.ok(r.post.volumeTextures.has("textures/custom.png"));
  assert.ok(!r.post.volumeTextures.has("textures/dirt.png"));
  const params = r.calls.filter((c) => c.name === "texParameteri").map((c) => c.args.slice(1));
  assert.deepEqual(params.slice(-4), [[r.gl.TEXTURE_MAG_FILTER, r.gl.LINEAR], [r.gl.TEXTURE_MIN_FILTER, r.gl.LINEAR],
                                      [r.gl.TEXTURE_WRAP_S, r.gl.REPEAT], [r.gl.TEXTURE_WRAP_T, r.gl.REPEAT]]);
});

// ---------------------------------------------------------------------------------------------- depth of field
test("PrepareBokehKernel: 7 + 14 + 21 points; round blades lie on the ring radii", () => {
  const D = { ...VOLUME_DEFAULTS.DepthOfField, bladeCount: 5, bladeCurvature: 1, bladeRotation: 0 };
  const maxRadius = F(14 / 720), rcp = F(1 / F(640 / 360));
  const k = URPPost.bokehKernel(D, maxRadius, rcp);
  assert.equal(k.length, 42 * 4);
  let i = 0;
  for (let ring = 1; ring < 4; ring++) {
    const radius = F(F(ring + F(1 / 7)) / F(3 + 1 / 7));
    for (let p = 0; p < ring * 7; p++, i++) {
      const [u, v, len, ur] = k.subarray(i * 4, i * 4 + 4);
      assert.ok(Math.abs(len - radius * maxRadius) < 1e-7, `ring ${ring} point ${p}`);
      assert.ok(Math.abs(Math.hypot(u, v) - len) < 1e-7);
      assert.equal(ur, F(u * rcp));
    }
  }
  assert.deepEqual([k[0], k[1]], [F(F(F(F(1 + F(1 / 7)) / F(3 + 1 / 7)) * 1) * maxRadius), 0]);
  // straight blades (curvature 0): the corners of the pentagon are further out than the edge midpoints
  const flat = URPPost.bokehKernel({ ...D, bladeCurvature: 0 }, maxRadius, rcp);
  const ring3 = Array.from({ length: 21 }, (_, j) => flat[(21 + j) * 4 + 2]);
  assert.ok(Math.max(...ring3) > Math.min(...ring3) * 1.1);
  assert.ok(URPPost.bokehKernel({ ...D, bladeRotation: 30 }, maxRadius, rcp)[1] < 0);
});

const camera = () => {
  const view = mat4.trs({ x: 0, y: 1, z: -10 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 1, z: 1 });
  return { view, proj: mat4.perspective(30, 1280 / 720, 0.3, 5000), near: 0.3, far: 5000 };
};

test("render: LUT, bokeh depth of field, camera motion blur, bloom, uber in order, each feeding the next", () => {
  const r = rig();
  const stack = URPPost.evaluateStack([vol([
    P("Bloom", { intensity: 0.6, threshold: 1 }),
    P("DepthOfField", { mode: 2, focusDistance: F(0.1) }),
    P("MotionBlur", { intensity: 1, quality: 1 }),
  ])]);
  r.post.render(stack, r.src, r.dst, { ...r.o, camera: camera() });
  const seq = r.blits.map((b) => `${b.shader}#${b.pass}`);
  assert.deepEqual(seq.slice(0, 7), ["LutBuilderLdr#0", "BokehDepthOfField#0", "BokehDepthOfField#1", "BokehDepthOfField#2",
                                     "BokehDepthOfField#3", "BokehDepthOfField#4", "CameraMotionBlur#1"]);
  assert.equal(seq[7], "Bloom#0");
  assert.equal(seq.at(-1), "UberPost#0");
  const dof = r.blits.slice(1, 6), mb = r.blits[6], bloom0 = r.blits[7], uber = r.blits.at(-1);
  for (const b of dof) {
    assert.equal(b.subShader, 1);
    assert.deepEqual(b.keywords, ["_ENABLE_ALPHA_OUTPUT", "_USE_FAST_SRGB_LINEAR_CONVERSION"]);
  }
  assert.equal(dof[0].value("_BlitTexture"), r.src);
  const out = r.post.targets.get("_DoFTarget"), ping = r.post.targets.get("_PingTexture"), pong = r.post.targets.get("_PongTexture");
  assert.equal(dof[2].value("_BlitTexture"), ping);
  assert.equal(dof[3].value("_BlitTexture"), pong);
  assert.equal(dof[4].value("_DofTexture"), ping);
  assert.equal(dof[4].value("_FullCoCTexture"), r.post.targets.get("_FullCoCTexture"));
  assert.deepEqual([ping.width, ping.height, out.width, out.height], [640, 360, 1280, 720]);
  // CoC parameters [Potmesil81] and the per-camera z buffer parameters (OpenGL ES: no reversed z)
  const f = F(50 / 1000), A = F(50 / F(5.6)), maxRadius = F(14 / 720), fd = stack.DepthOfField.focusDistance;
  assert.equal(fd, F(10 + F(F(0.1) - 10)));                                    // the float32 lerp at weight 1
  assert.deepEqual(f32(dof[0].value("_CoCParams")), [fd, F(F(f * A) / F(fd - f)), maxRadius, F(1 / F(640 / 360))]);
  const tz = F(5000 * F(1 / F(0.3)));
  assert.deepEqual(f32(dof[0].value("_ZBufferParams")), [F(1 - tz), tz, F(F(1 - tz) * F(1 / 5000)), F(tz * F(1 / 5000))]);
  assert.deepEqual(f32(dof[0].value("_BokehConstants")), [F(2 / 720), F(4 / 720), 0, 0]);
  assert.deepEqual(dof[0].value("_DownSampleScaleFactor"), [0.5, 0.5, 2, 2]);
  assert.equal(dof[0].value("_BokehKernel").length, 168);
  // the camera depth texture of a frame without depth writes: cleared to 1
  const depth = dof[0].value("_CameraDepthTexture");
  assert.equal(mb.value("_CameraDepthTexture"), depth);
  assert.ok(r.calls.some((c) => c.name === "clearColor" && c.args.join() === "1,1,1,1"));
  // motion blur from the DoF output; bloom and uber from the motion blur output
  assert.equal(mb.value("_BlitTexture"), out);
  assert.deepEqual(mb.keywords, ["_ENABLE_ALPHA_OUTPUT"]);
  const mbOut = r.post.targets.get("_MotionBlurTarget");
  assert.equal(bloom0.value("_BlitTexture"), mbOut);
  assert.equal(uber.value("_BlitTexture"), mbOut);
  assert.equal(uber.value("_Bloom_Texture"), r.post.bloom[0].up);
  assert.equal(uber.value("_InternalLut"), r.post.lut);
});

test("render without active effects: LUT and uber only; bloom only when its intensity is positive", () => {
  const r = rig();
  r.post.render(URPPost.evaluateStack([]), r.src, r.dst, { ...r.o, camera: camera() });
  assert.deepEqual(r.blits.map((b) => b.shader), ["LutBuilderLdr", "UberPost"]);
  assert.equal(r.blits[1].value("_BlitTexture"), r.src);
});

test("Gaussian depth of field, camera-and-objects motion blur and bloom lens dirt are errors", () => {
  const r = rig();
  const run = (c) => r.post.render(URPPost.evaluateStack([vol([c])]), r.src, r.dst, { ...r.o, camera: camera() });
  assert.throws(() => run(P("DepthOfField", { mode: 1 })), /Gaussian/);
  assert.throws(() => run(P("MotionBlur", { mode: 1, intensity: 1 })), /camera and objects/);
  const dirt = { texture: "textures/dirt.png", width: 4, height: 4, mipCount: 1 };
  assert.throws(() => run(P("Bloom", { intensity: 1, dirtTexture: dirt, dirtIntensity: 1 })), /lens dirt/);
  assert.doesNotThrow(() => run(P("Bloom", { intensity: 1, dirtTexture: dirt, dirtIntensity: 0 })));
});

// ------------------------------------------------------------------------------------------------ motion blur
test("MotionVectorsPersistentData: previous view-projection from the frame before, reset on an aspect change", () => {
  const r = rig(), cam = camera();
  const moved = { ...cam, view: mat4.trs({ x: 1, y: 1, z: -10 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 1, z: 1 }) };
  const vp0 = mat4.mul(cam.proj, cam.view), vp1 = mat4.mul(moved.proj, moved.view);
  r.post.updateMotion(cam, 1.5, 1);
  assert.deepEqual(r.post.motion.prev, vp0);
  r.post.updateMotion(moved, 1.5, 2);
  assert.deepEqual([r.post.motion.vp, r.post.motion.prev], [vp1, vp0]);
  r.post.updateMotion(cam, 1.5, 2);                                            // same frame: unchanged
  assert.deepEqual(r.post.motion.vp, vp1);
  r.post.updateMotion(cam, 2, 3);
  assert.deepEqual([r.post.motion.vp, r.post.motion.prev], [vp0, vp0]);
});

test("camera motion blur values: matrices, intensity, clamp, pass by quality", () => {
  const r = rig(), cam = camera();
  const stack = URPPost.evaluateStack([vol([P("MotionBlur", { intensity: 1, quality: 2, clamp: F(0.1) })])]);
  r.post.render(stack, r.src, r.dst, { ...r.o, camera: cam });
  const mb = r.blits.find((b) => b.shader === "CameraMotionBlur");
  assert.equal(mb.pass, 2);
  assert.equal(mb.value("_Intensity"), 1);
  assert.equal(mb.value("_Clamp"), F(0.1));
  assert.deepEqual(mb.value("_ViewProjM"), mb.value("_PrevViewProjM"));      // first frame
  const id = mat4.mul(mb.value("unity_MatrixInvVP"), mb.value("_ViewProjM"));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-3, `element ${i}: ${id[i]}`);
  assert.deepEqual(mb.value("_SourceSize"), [1280, 720, 1 / 1280, 1 / 720]);
});
