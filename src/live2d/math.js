import { F } from "../engine/core.js";

// Parameter math of the game's fork of Cubism SDK for Unity: the fade easing, ClampF, AnimationCurve evaluation of
// the fade motion curves, CubismParameter value writes and CubismParameterStore.
//
// The managed math is float32 without FMA; F (Math.fround) is applied in source order.

// CubismFadeMath.GetEasingSine (the cosine in double)
export const easeSine = (x) => {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return F(0.5 - 0.5 * Math.cos(F(x * F(3.1415927))));
};

// ClampF (NaN -> min)
export const clampF = (v, min, max) => ((min <= v) ? (v <= max ? v : max) : min);

// UnityEngine.AnimationCurve.Evaluate for Hermite keys, clamped before the first and after the last key (every
// CubismFadeMotionData curve has pre / post wrap mode 2 = clamp and weightedMode 0).
// ENGINE: AnimationCurve.Evaluate is native; Unity's documented Hermite form, float32 in source order.
export const hermite = (keys, t) => {
  const n = keys.length;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys[n - 1].time) return keys[n - 1].value;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m].time <= t) lo = m; else hi = m; }
  const a = keys[lo], b = keys[hi];
  if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
  const dx = F(b.time - a.time);
  const s = F(F(t - a.time) / dx);
  const m1 = F(a.outSlope * dx), m2 = F(b.inSlope * dx);
  const s2 = F(s * s), s3 = F(s2 * s);
  const h00 = F(F(F(2 * s3) - F(3 * s2)) + 1), h10 = F(F(s3 - F(2 * s2)) + s), h01 = F(F(-2 * s3) + F(3 * s2));
  const h11 = F(s3 - s2);
  return F(F(F(F(h00 * a.value) + F(h10 * m1)) + F(h11 * m2)) + F(h01 * b.value));
};

// The model's CubismParameter values (Value) with the moc3's ranges and defaults.
export class Live2DParameters {
  constructor(core) {
    const p = core.parameters;
    this.ids = p.ids;
    this.count = p.count;
    this.min = Float32Array.from(p.minimumValues);
    this.max = Float32Array.from(p.maximumValues);
    this.def = Float32Array.from(p.defaultValues);
    this.value = Float32Array.from(p.values);      // CubismParameter.Value
    this.index = new Map(this.ids.map((id, i) => [id, i]));
  }

  idx(id) {
    const i = this.index.get(id);
    if (i === undefined) throw new Error(`parameter ${id} not in model`);
    return i;
  }

  // CubismParameterExtensionMethods.OverrideValue: c = ClampF(v); Value = c * w + (1 - w) * Value
  override(i, v, w) {
    const c = clampF(F(v), this.min[i], this.max[i]);
    this.value[i] = F(F(c * w) + F(F(1 - w) * this.value[i]));
  }

  // AddToValue
  add(i, v, w) { this.override(i, F(F(v * w) + this.value[i]), 1); }

  // MultiplyValueBy
  multiply(i, v, w) { this.override(i, F(F(F(F(v + -1) * w) + 1) * this.value[i]), 1); }
}

// CubismParameterStore (execution order 150): the parameter and part values saved in LateUpdate and restored at the
// start of the next frame's model read-back.
export class Live2DParameterStore {
  constructor(params, parts) {
    this.params = params; this.parts = parts;
    this.saved = Float32Array.from(params.value);
    this.savedParts = Float32Array.from(parts);
  }

  save() { this.saved.set(this.params.value); this.savedParts.set(this.parts); }

  restore() {
    for (let i = 0; i < this.params.count; i++) this.params.override(i, this.saved[i], 1);
    this.parts.set(this.savedParts);
  }
}
