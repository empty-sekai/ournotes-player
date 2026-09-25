import { Gradient } from "../engine/anim.js";
import { F, join } from "../engine/core.js";
import { assetsOf } from "../data/assets.js";
import { ShaderLib, applyState } from "../engine/glsl.js";
import { mat4, quat } from "../engine/math.js";
import { UnityRandom } from "../engine/random.js";
import { GLTex } from "../engine/texture.js";

// Unity ParticleSystem (Shuriken) simulation and ParticleSystemRenderer geometry for the live note / lane effects:
// curves and gradients (FxCurve, MinMaxCurve, FxGradient, MinMaxGradient), FxParticleSystem, the effect materials
// (FxMaterials, FxMaterial), PS_STOP, and the lane-in stars of the start timeline (LiveIntroStars, FxMatrixTransform).
// Random streams are UnityRandom (engine/random.js).
//
// Sources
//   - Serialized component data: livenotes/notes.json assets[...].nodes[].components (type "ParticleSystem" /
//     "ParticleSystemRenderer", raw fields).
//   - Managed Unity reference (UnityCsReference, Modules/ParticleSystem): enums
//     (ParticleSystemEnums.cs: shape types, render modes, render space, scaling mode, stop action, sort mode, custom
//     data mode, gradient mode, vertex streams), MinMaxCurve.Evaluate / MinMaxGradient.Evaluate
//     (ParticleSystemStructs.cs: Lerp(min, max, lerpFactor), curveMultiplier), Particle fields (remainingLifetime,
//     startColor as Color32, velocity + animatedVelocity = totalVelocity, randomSeed per particle).
//   - Unity manual (Particle System modules) for the documented module semantics.
// The ParticleSystem itself is native engine code (neither in the game's managed code nor in the C# reference).
// Policy: every place where the exact native behaviour is not recoverable carries `// ENGINE:` and one line why; the
// documented semantics are implemented, never presented as exact. Unsupported module features raise FxError
// (when the system is played or drawn), so an unported feature can never be drawn approximately without notice.
//
// Reproducibility: every in-scope note-effect system has autoRandomSeed = true (the game draws a fresh seed per play:
// its random sequence is not reproducible, so no particle-exact comparison with the game is possible). Here all
// randomness comes from UnityRandom streams (xorshift128, seedable), so a Node run is deterministic for a seed.
// Systems with autoRandomSeed = false (lane effects, randomSeed 0) get their own stream re-seeded on each Play, as
// Unity does, but the order in which the native code draws from it is not known, so values still differ.
//
// Frame model: the effect views (fx-effects.js) call play/stop/clear/onActiveChanged from the update / animation phases
// and simulate(dt) once per frame in the animation phase (after the Animators); drawItem(camera) in the render hook.

export class FxError extends Error {};

// ------------------------------------------------------------------------------------------------ random
// Streams are UnityRandom (engine/random.js: Unity's Rand, xorshift128 with InitState seeding, value() =
// low 23 bits / 8388607). Only the generator family is Unity's:
// ENGINE: which draws the native particle code makes, and in which order, is not known.
// Only value() is used here: every "random between two constants / curves / colours"
// goes through MinMaxCurve / MinMaxGradient.evaluate with value() as the lerp factor (see there), never through
// UnityRandom.range (Random.Range's native mapping). Particle-only helpers work on any UnityRandom:
export const FxRand = {
  // uniform direction (randomDirectionAmount, sphere shapes) and point inside the unit sphere (randomPositionAmount)
  onUnitSphere(rng) {
    const z = rng.value() * 2 - 1, a = rng.value() * 2 * Math.PI, r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(a), r * Math.sin(a), z];
  },
  insideUnitSphere(rng) {
    const d = FxRand.onUnitSphere(rng), k = Math.cbrt(rng.value());
    return [d[0] * k, d[1] * k, d[2] * k];
  },
  fork(rng) { return new UnityRandom(rng.nextU32()); },
};

// ParticleSystemStopBehavior (UnityCsReference ParticleSystemEnums.cs)
export const PS_STOP = Object.freeze({ StopEmittingAndClear: 0, StopEmitting: 1 });

// ------------------------------------------------------------------------------------------------ curves
// UnityEngine.AnimationCurve.Evaluate as used by particle modules, with what animCurve (engine/anim.js) lacks:
// weighted keys (weightedMode 1 In, 2 Out, 3 Both: cubic Bezier in time and value, unweighted sides at 1/3) and
// the pre / post wrap modes (m_PreInfinity / m_PostInfinity: 0 PingPong, 1 Repeat, 2 Clamp).
// ENGINE: AnimationCurve.Evaluate is native; Hermite form, Bezier solve (Newton + bisection to 1e-7), float32 rounding.
// Those are the documented / standard forms. Unity also bakes particle curves into polynomial segments when it can;
// that is the same cubic up to rounding.
export class FxCurve {
  constructor(raw) {
    const ks = (raw && raw.m_Curve) || [];
    this.keys = ks.map((k) => ({ t: F(k.time), v: F(k.value), i: F(k.inSlope), o: F(k.outSlope),
                                 wm: k.weightedMode | 0, iw: F(k.inWeight ?? 1 / 3), ow: F(k.outWeight ?? 1 / 3) }));
    this.pre = raw && raw.m_PreInfinity !== undefined ? raw.m_PreInfinity : 2;
    this.post = raw && raw.m_PostInfinity !== undefined ? raw.m_PostInfinity : 2;
  }

  static _wrap(mode, t, t0, t1) {
    const L = t1 - t0;
    if (!(L > 0)) return t0;
    if (mode === 1) { const r = (t - t0) % L; return t0 + (r < 0 ? r + L : r); }            // Repeat
    if (mode === 0) {                                                                          // PingPong
      const r = Math.abs(t - t0) % (2 * L);
      return t0 + (r > L ? 2 * L - r : r);
    }
    return Math.min(Math.max(t, t0), t1);                                                     // Clamp
  }

  static _segment(a, b, t) {
    const dx = b.t - a.t;
    if (!(dx > 0)) return a.v;
    if (!Number.isFinite(a.o) || !Number.isFinite(b.i)) return a.v;       // stepped (infinite tangent)
    const s = (t - a.t) / dx;
    const weighted = (a.wm & 2) || (b.wm & 1);
    if (!weighted) {
      const s2 = s * s, s3 = s2 * s;
      return F((2 * s3 - 3 * s2 + 1) * a.v + (s3 - 2 * s2 + s) * a.o * dx + (-2 * s3 + 3 * s2) * b.v + (s3 - s2) * b.i * dx);
    }
    const ow = (a.wm & 2) ? a.ow : 1 / 3, iw = (b.wm & 1) ? b.iw : 1 / 3;
    const x1 = ow, x2 = 1 - iw;
    const bx = (u) => { const m = 1 - u; return 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u; };
    let lo = 0, hi = 1, u = s;
    for (let k = 0; k < 40; k++) {
      const x = bx(u) - s;
      if (Math.abs(x) < 1e-7) break;
      if (x > 0) hi = u; else lo = u;
      const m = 1 - u, d = 3 * m * m * x1 + 6 * m * u * (x2 - x1) + 3 * u * u * (1 - x2);
      let nu = d > 1e-9 ? u - x / d : (lo + hi) / 2;
      if (!(nu > lo && nu < hi)) nu = (lo + hi) / 2;
      u = nu;
    }
    const y1 = a.v + ow * dx * a.o, y2 = b.v - iw * dx * b.i, m = 1 - u;
    return F(m * m * m * a.v + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * b.v);
  }

  evaluate(t) {
    const k = this.keys, n = k.length;
    if (n === 0) return 0;
    if (n === 1) return k[0].v;
    if (t < k[0].t) t = FxCurve._wrap(this.pre, t, k[0].t, k[n - 1].t);
    else if (t > k[n - 1].t) t = FxCurve._wrap(this.post, t, k[0].t, k[n - 1].t);
    if (t <= k[0].t) return k[0].v;
    if (t >= k[n - 1].t) return k[n - 1].v;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].t <= t) lo = m; else hi = m; }
    return FxCurve._segment(k[lo], k[hi], t);
  }
};

// ParticleSystem.MinMaxCurve (minMaxState 0 Constant, 1 Curve, 2 TwoCurves, 3 TwoConstants); Evaluate as the managed
// reference (ParticleSystemStructs.cs): Lerp(min, max, lerpFactor), curves times curveMultiplier (serialized `scalar`).
// ENGINE: random MinMax values use the managed Lerp(min, max, t) form, not the native Random.Range mapping.
// The native particle code is not visible. The managed MinMaxCurve / MinMaxGradient.Evaluate(time, lerpFactor) is
// the API Unity itself documents for this evaluation and it is Lerp(min, max, t) = min + (max - min) t; the native
// RangedRandom form of Random.Range (min t + (1 - t) max, see engine/random.js) is not documented for particle modules,
// so Lerp is kept. For a uniform lerp factor both give the same distribution (t <-> 1 - t); only which value a given
// draw maps to differs, and the draws are not reproducible anyway (autoRandomSeed).
export class MinMaxCurve {
  constructor(raw) {
    this.mode = raw ? raw.minMaxState : 0;
    this.scalar = F(raw ? raw.scalar : 0);          // constantMax / curveMultiplier
    this.minScalar = F(raw ? raw.minScalar : 0);    // constantMin
    this.maxCurve = this.mode === 1 || this.mode === 2 ? new FxCurve(raw.maxCurve) : null;
    this.minCurve = this.mode === 2 ? new FxCurve(raw.minCurve) : null;
    if (![0, 1, 2, 3].includes(this.mode)) throw new FxError(`MinMaxCurve mode ${this.mode}`);
  }

  get isRandom() { return this.mode === 2 || this.mode === 3; }

  // time: the curve's time axis (normalized system time or normalized particle age); r: lerpFactor in [0, 1]
  evaluate(time, r = 1) {
    const l = (a, b) => F(a + (b - a) * Math.min(Math.max(r, 0), 1));
    switch (this.mode) {
      case 0: return this.scalar;
      case 1: return F(this.maxCurve.evaluate(time) * this.scalar);
      case 2: return F(l(this.minCurve.evaluate(time), this.maxCurve.evaluate(time)) * this.scalar);
      default: return l(this.minScalar, this.scalar);
    }
  }

  // largest value over [0, 1] for any lerp factor (bounds); curves sampled at 64 points (engine bounds are native)
  maxAbs() {
    if (this.mode === 0) return Math.abs(this.scalar);
    if (this.mode === 3) return Math.max(Math.abs(this.scalar), Math.abs(this.minScalar));
    let m = 0;
    for (let i = 0; i <= 64; i++) {
      m = Math.max(m, Math.abs(this.maxCurve.evaluate(i / 64)));
      if (this.minCurve) m = Math.max(m, Math.abs(this.minCurve.evaluate(i / 64)));
    }
    return m * Math.abs(this.scalar);
  }

  isZero() { return this.mode === 0 ? this.scalar === 0 : this.mode === 3 ? this.scalar === 0 && this.minScalar === 0 : this.scalar === 0; }

  setConstant(v) { this.mode = 0; this.scalar = F(v); }   // C# implicit MinMaxCurve(float)
};

// UnityEngine.Gradient: Blend mode through Gradient (engine/anim.js); Fixed mode (m_Mode 1) here.
// ENGINE: Fixed gradient mode: the colour of the first key at or after t (documented "no interpolation").
export class FxGradient {
  constructor(g) {
    this.mode = g.m_Mode;
    if (g.m_Mode === 0) { this.g = new Gradient(g); return; }
    if (g.m_Mode !== 1) throw new FxError(`gradient mode ${g.m_Mode} not implemented`);
    this.colorKeys = []; this.alphaKeys = [];
    for (let i = 0; i < g.m_NumColorKeys; i++) { const k = g[`key${i}`]; this.colorKeys.push({ t: F(g[`ctime${i}`] / 65535), c: [k.r, k.g, k.b] }); }
    for (let i = 0; i < g.m_NumAlphaKeys; i++) this.alphaKeys.push({ t: F(g[`atime${i}`] / 65535), a: g[`key${i}`].a });
  }

  evaluate(t) {
    if (this.g) return this.g.evaluate(t);
    const pick = (keys) => keys.find((k) => k.t >= t) || keys[keys.length - 1];
    const c = pick(this.colorKeys).c;
    return [c[0], c[1], c[2], pick(this.alphaKeys).a];
  }
};

// ParticleSystem.MinMaxGradient (0 Color, 1 Gradient, 2 TwoColors, 3 TwoGradients, 4 RandomColor), Evaluate as the
// managed reference: Color.Lerp(min, max, lerpFactor); RandomColor = maxGradient.Evaluate(lerpFactor).
// Same choice as MinMaxCurve: the documented managed Lerp form, not the native Random.Range mapping.
export class MinMaxGradient {
  constructor(raw) {
    this.mode = raw.minMaxState;
    const col = (c) => (c ? [c.r, c.g, c.b, c.a] : [1, 1, 1, 1]);
    this.maxColor = col(raw.maxColor);
    this.minColor = col(raw.minColor);
    this.maxGradient = [1, 3, 4].includes(this.mode) ? new FxGradient(raw.maxGradient) : null;
    this.minGradient = this.mode === 3 ? new FxGradient(raw.minGradient) : null;
    if (![0, 1, 2, 3, 4].includes(this.mode)) throw new FxError(`MinMaxGradient mode ${this.mode}`);
  }

  get isRandom() { return this.mode >= 2; }

  evaluate(time, r = 1) {
    const rr = Math.min(Math.max(r, 0), 1);
    const l = (a, b) => [0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * rr);
    switch (this.mode) {
      case 0: return this.maxColor.slice();
      case 1: return this.maxGradient.evaluate(time);
      case 2: return l(this.minColor, this.maxColor);
      case 3: return l(this.minGradient.evaluate(time), this.maxGradient.evaluate(time));
      default: return this.maxGradient.evaluate(rr);
    }
  }
};

export const MinMax = {
  curve: (raw) => new MinMaxCurve(raw),
  gradient: (raw) => new MinMaxGradient(raw),
  animationCurve: (raw) => new FxCurve(raw),
};

// ------------------------------------------------------------------------------------------------ small vector math
export const FxV = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  // column-major 4x4 (mat4 layout)
  point: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
                    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
  dir: (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
                  m[2] * d[0] + m[6] * d[1] + m[10] * d[2]],
  // rotation matrix (3x3 as [c0, c1, c2] columns) of a quaternion
  quatCols: (q) => {
    const m = mat4.trs({ x: 0, y: 0, z: 0 }, q, { x: 1, y: 1, z: 1 });
    return [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  },
  colsMul: (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
                      R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]],
  colsMulT: (R, v) => [FxV.dot(R[0], v), FxV.dot(R[1], v), FxV.dot(R[2], v)],
  // rotation columns of an affine matrix (Gram-Schmidt of its 3x3; a mirrored matrix keeps its third axis)
  matRotation: (m) => {
    const V = FxV, c0 = V.norm([m[0], m[1], m[2]]), a1 = [m[4], m[5], m[6]];
    const c1 = V.norm(V.sub(a1, V.scale(c0, V.dot(a1, c0)))), c2 = V.cross(c0, c1);
    return V.dot(c2, [m[8], m[9], m[10]]) < 0 ? [c0, c1, V.scale(c2, -1)] : [c0, c1, c2];
  },
  // column-major 4x4 = [R0 s0, R1 s1, R2 s2, pos]
  compose: (R, s, pos) => Float32Array.from([R[0][0] * s[0], R[0][1] * s[0], R[0][2] * s[0], 0, R[1][0] * s[1], R[1][1] * s[1],
    R[1][2] * s[1], 0, R[2][0] * s[2], R[2][1] * s[2], R[2][2] * s[2], 0, pos[0], pos[1], pos[2], 1]),
  // rotation (radians) about z, then x, then y: Quaternion.Euler order
  // ENGINE: the particle 3D rotation order is native; Quaternion.Euler order (z, x, y) is assumed.
  eulerCols: (x, y, z) => FxV.quatCols(quat.euler(x * 180 / Math.PI, y * 180 / Math.PI, z * 180 / Math.PI)),
};

// ------------------------------------------------------------------------------------------------ noise
// Gradient noise for the Noise module.
// ENGINE: Unity's noise field is native (function, per-axis offsets, seed, range, octave normalisation); gradient noise here.
// This is classic gradient (Perlin) noise with
// the improved fade 6t^5 - 15t^4 + 10t^3 and a fixed permutation (shuffled by UnityRandom(0)), scaled so that
// |n| <= 1 (1D x2, 2D x sqrt 2, 3D clamped); it is never Unity's exact field, only the same kind of smooth noise.
export const FxNoise = {
  _p: null,
  perm() {
    if (!this._p) {
      const r = new UnityRandom(0), a = Array.from({ length: 256 }, (_, i) => i);
      for (let i = 255; i > 0; i--) { const j = r.nextU32() % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
      this._p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this._p[i] = a[i & 255];
    }
    return this._p;
  },
  fade: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  lerp: (a, b, t) => a + (b - a) * t,
  n1(x) {
    const P = this.perm(), X = Math.floor(x), f = x - X, i = X & 255;
    const g = (h, d) => ((h & 1) ? -d : d) * (1 + ((h >> 1) & 7)) / 8;
    return Math.max(-1, Math.min(1, 2 * this.lerp(g(P[i], f), g(P[i + 1], f - 1), this.fade(f))));
  },
  n2(x, y) {
    const P = this.perm(), X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, i = X & 255, j = Y & 255;
    const g = (h, dx, dy) => { const a = (h & 7) * Math.PI / 4; return Math.cos(a) * dx + Math.sin(a) * dy; };
    const u = this.fade(fx), v = this.fade(fy);
    const n00 = g(P[P[i] + j], fx, fy), n10 = g(P[P[i + 1] + j], fx - 1, fy);
    const n01 = g(P[P[i] + j + 1], fx, fy - 1), n11 = g(P[P[i + 1] + j + 1], fx - 1, fy - 1);
    return Math.max(-1, Math.min(1, Math.SQRT2 * this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), v)));
  },
  n3(x, y, z) {
    const P = this.perm(), X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z, i = X & 255, j = Y & 255, k = Z & 255;
    const g = (h, a, b, c) => {
      h &= 15;
      const u = h < 8 ? a : b, v = h < 4 ? b : h === 12 || h === 14 ? a : c;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };
    const u = this.fade(fx), v = this.fade(fy), w = this.fade(fz), L = this.lerp;
    const A = P[i] + j, AA = P[A] + k, AB = P[A + 1] + k, B = P[i + 1] + j, BA = P[B] + k, BB = P[B + 1] + k;
    const r = L(L(L(g(P[AA], fx, fy, fz), g(P[BA], fx - 1, fy, fz), u), L(g(P[AB], fx, fy - 1, fz), g(P[BB], fx - 1, fy - 1, fz), u), v),
                L(L(g(P[AA + 1], fx, fy, fz - 1), g(P[BA + 1], fx - 1, fy, fz - 1), u),
                  L(g(P[AB + 1], fx, fy - 1, fz - 1), g(P[BB + 1], fx - 1, fy - 1, fz - 1), u), v), w);
    return Math.max(-1, Math.min(1, r));
  },
  // three noise channels at point q (already frequency-scaled and scrolled) by quality 0 Low (1D), 1 Medium (2D),
  // 2 High (3D). The per-axis decorrelation offsets and coordinate pairs are this port's choice.
  sample3(q, quality) {
    const o = [[0, 0, 0], [31.416, 17.32, 5.77], [57.1, 91.7, 43.3]];
    if (quality === 0) return o.map((d, a) => this.n1(q[0] + q[1] + q[2] + d[0] + a * 101.3));
    if (quality === 1) return [this.n2(q[1], q[2]), this.n2(q[2] + o[1][0], q[0] + o[1][1]), this.n2(q[0] + o[2][0], q[1] + o[2][1])];
    return o.map((d) => this.n3(q[0] + d[0], q[1] + d[1], q[2] + d[2]));
  },
};

// ------------------------------------------------------------------------------------------------ particle system
// Per-particle stable random slots (one lerp factor per module property, drawn at birth).
// ENGINE: Unity derives these from the particle's randomSeed with module offsets; separate factors per axis here.
// (Whether axes share one factor is not known.)
export const FX_RND = {
  velX: 0, velY: 1, velZ: 2, orbX: 3, orbY: 4, orbZ: 5, offX: 6, offY: 7, offZ: 8, radial: 9, speedMod: 10,
  limit: 11, limitX: 12, limitY: 13, limitZ: 14, drag: 15, sizeX: 16, sizeY: 17, sizeZ: 18, color: 19,
  rotX: 20, rotY: 21, rotZ: 22, forceX: 23, forceY: 24, forceZ: 25, c1: 26, c2: 30, c1c: 34, c2c: 35, gravity: 36,
  noiseX: 37, noiseY: 38, noiseZ: 39, noisePos: 40, noiseRot: 41, noiseSize: 42, N: 43,
};

// Vertex streams (ParticleSystemVertexStream) -> float count; Position/Normal/Tangent/Color are shader channels,
// every other stream is packed in order into TEXCOORD0.xyzw, TEXCOORD1.xyzw, ... (split across channels).
// ENGINE: stream packing follows the renderer inspector ("UV (TEXCOORD0.xy)", "Custom1.x (TEXCOORD0.z)").
// The native vertex layout itself is not visible.
export const FX_STREAM = {
  0: ["POSITION", 3], 1: ["NORMAL", 3], 2: ["TANGENT", 4], 3: ["COLOR", 4], 4: ["UV", 2], 10: ["Center", 3],
  11: ["VertexID", 1], 12: ["SizeX", 1], 13: ["SizeXY", 2], 14: ["SizeXYZ", 3], 15: ["Rotation", 1],
  16: ["Rotation3D", 3], 19: ["Velocity", 3], 20: ["Speed", 1], 21: ["AgePercent", 1], 22: ["InvStartLifetime", 1],
  23: ["StableRandomX", 1], 24: ["StableRandomXY", 2], 25: ["StableRandomXYZ", 3], 26: ["StableRandomXYZW", 4],
  31: ["Custom1X", 1], 32: ["Custom1XY", 2], 33: ["Custom1XYZ", 3], 34: ["Custom1XYZW", 4],
  35: ["Custom2X", 1], 36: ["Custom2XY", 2], 37: ["Custom2XYZ", 3], 38: ["Custom2XYZW", 4],
};

export class FxParticleSystem {
  // psComp / rendererComp: exported components (raw notes.json fields; rendererComp may be absent); transform:
  // Transform of the GameObject; opts {rng: UnityRandom, materials: FxMaterials | null, name}. Without rng a
  // private stream seeded 1 is used (the global random is not consumed: particle systems have their own Rand).
  constructor(psComp, rendererComp, transform, opts = {}) {
    const { rng = null, materials = null, name = "" } = opts;
    const MM = (raw) => new MinMaxCurve(raw), v3 = (o) => [F(o.x), F(o.y), F(o.z)];
    const c = psComp;
    this.name = name;
    this.transform = transform;
    this.materials = materials;
    this.children = [];
    this.onStopped = null;            // stopAction 3 Callback (LiveGameParticleCallback)
    this.onStopAction = null;         // stopAction 1 Disable / 2 Destroy: (action) => void (host decides)
    this.sharedRng = rng || new UnityRandom(1);
    this.unsupported = [];
    this.main = {
      duration: F(c.lengthInSec), looping: !!c.looping, prewarm: !!c.prewarm, playOnAwake: !!c.playOnAwake,
      simulationSpeed: F(c.simulationSpeed), stopAction: c.stopAction | 0, cullingMode: c.cullingMode | 0,
      startDelay: MM(c.startDelay), simulationSpace: c.moveWithTransform | 0, scalingMode: c.scalingMode | 0,
      emitterVelocityMode: c.emitterVelocityMode | 0, useUnscaledTime: !!c.useUnscaledTime,
      autoRandomSeed: !!c.autoRandomSeed, randomSeed: c.randomSeed >>> 0,
    };
    if (this.main.simulationSpace === 2) this.unsupported.push("custom simulation space");
    if (c.ringBufferMode) this.unsupported.push("ring buffer mode");
    if (this.main.useUnscaledTime) this.unsupported.push("unscaled time");
    const I = c.InitialModule;
    this.initial = {
      startLifetime: MM(I.startLifetime), startSpeed: MM(I.startSpeed), startColor: new MinMaxGradient(I.startColor),
      startSize: MM(I.startSize), startSizeY: MM(I.startSizeY), startSizeZ: MM(I.startSizeZ), size3D: !!I.size3D,
      startRotationX: MM(I.startRotationX), startRotationY: MM(I.startRotationY), startRotation: MM(I.startRotation),
      rotation3D: !!I.rotation3D, randomizeRotationDirection: F(I.randomizeRotationDirection || 0),
      gravityModifier: MM(I.gravityModifier), gravitySource: I.gravitySource | 0, maxParticles: I.maxNumParticles | 0,
    };
    const E = c.EmissionModule;
    this.emission = {
      enabled: !!E.enabled, rateOverTime: MM(E.rateOverTime), rateOverDistance: MM(E.rateOverDistance),
      bursts: (E.m_Bursts || []).slice(0, E.m_BurstCount ?? (E.m_Bursts || []).length).map((b) => ({
        time: F(b.time), count: MM(b.countCurve), cycles: b.cycleCount | 0, interval: F(b.repeatInterval),
        probability: F(b.probability) })),
    };
    const S = c.ShapeModule;
    this.shape = {
      enabled: !!S.enabled, type: S.type, position: v3(S.m_Position), rotation: v3(S.m_Rotation), scale: v3(S.m_Scale),
      radius: F(S.radius.value), radiusMode: S.radius.mode, arc: F(S.arc.value), arcMode: S.arc.mode,
      angle: F(S.angle), length: F(S.length), radiusThickness: F(S.radiusThickness), boxThickness: v3(S.boxThickness),
      randomDirection: F(S.randomDirectionAmount), sphericalDirection: F(S.sphericalDirectionAmount),
      randomPosition: F(S.randomPositionAmount), alignToDirection: !!S.alignToDirection,
    };
    if (this.shape.enabled) {
      if (![0, 1, 2, 3, 4, 5, 10, 11, 12, 15, 16, 18].includes(S.type)) this.unsupported.push(`shape type ${S.type}`);
      if ([0, 1, 2, 3, 4, 10, 11, 12].includes(S.type) && S.radius.mode !== 0) this.unsupported.push("shape radius mode");
      if ([4, 10, 11].includes(S.type) && S.arc.mode !== 0) this.unsupported.push("shape arc mode");
      if (this.shape.alignToDirection) this.unsupported.push("shape alignToDirection");
    }
    const Z = c.SizeModule;
    this.size = Z.enabled ? { separateAxes: !!Z.separateAxes, x: MM(Z.curve), y: MM(Z.y), z: MM(Z.z) } : null;
    this.color = c.ColorModule.enabled ? { gradient: new MinMaxGradient(c.ColorModule.gradient) } : null;
    const V = c.VelocityModule;
    this.velocity = V.enabled ? {
      x: MM(V.x), y: MM(V.y), z: MM(V.z), speedModifier: MM(V.speedModifier), inWorldSpace: !!V.inWorldSpace,
      orbital: [MM(V.orbitalX), MM(V.orbitalY), MM(V.orbitalZ)], offset: [MM(V.orbitalOffsetX), MM(V.orbitalOffsetY),
      MM(V.orbitalOffsetZ)], radial: MM(V.radial) } : null;
    if (this.velocity && (this.velocity.orbital.some((m) => !m.isZero()) || !this.velocity.radial.isZero()))
      this.unsupported.push("orbital / radial velocity");
    const L = c.ClampVelocityModule;
    this.limit = L.enabled ? {
      separateAxis: !!L.separateAxis, x: MM(L.x), y: MM(L.y), z: MM(L.z), magnitude: MM(L.magnitude),
      dampen: F(L.dampen), drag: MM(L.drag), bySize: !!L.multiplyDragByParticleSize,
      byVelocity: !!L.multiplyDragByParticleVelocity, inWorldSpace: !!L.inWorldSpace } : null;
    const R = c.RotationModule;
    this.rotation = R.enabled ? { separateAxes: !!R.separateAxes, x: MM(R.x), y: MM(R.y), z: MM(R.curve) } : null;
    const Fo = c.ForceModule;
    this.force = Fo.enabled ? { x: MM(Fo.x), y: MM(Fo.y), z: MM(Fo.z), inWorldSpace: !!Fo.inWorldSpace } : null;
    if (this.force && Fo.randomizePerFrame) this.unsupported.push("force randomizePerFrame");
    const N = c.NoiseModule;
    this.noise = N && N.enabled ? {
      separateAxes: !!N.separateAxes, strength: [MM(N.strength), MM(N.strengthY), MM(N.strengthZ)],
      frequency: F(N.frequency), damping: !!N.damping, octaves: Math.max(1, N.octaves | 0), octaveMultiplier: F(N.octaveMultiplier),
      octaveScale: F(N.octaveScale), quality: N.quality | 0, scrollSpeed: MM(N.scrollSpeed), remapEnabled: !!N.remapEnabled,
      remap: [MM(N.remap), MM(N.remapY), MM(N.remapZ)], positionAmount: MM(N.positionAmount),
      rotationAmount: MM(N.rotationAmount), sizeAmount: MM(N.sizeAmount) } : null;
    this.noiseOffset = 0;             // accumulated scroll (noise-space units)
    const CD = c.CustomDataModule;
    this.custom = CD.enabled ? [0, 1].map((k) => ({
      mode: CD[`mode${k}`] | 0, count: CD[`vectorComponentCount${k}`] | 0,
      vec: [0, 1, 2, 3].map((j) => MM(CD[`vector${k}_${j}`])), color: new MinMaxGradient(CD[`color${k}`]) })) : null;
    for (const m of ["UVModule", "InheritVelocityModule", "LifetimeByEmitterSpeedModule", "ExternalForcesModule",
                     "SizeBySpeedModule", "RotationBySpeedModule", "ColorBySpeedModule", "CollisionModule",
                     "TriggerModule", "SubModule", "LightsModule", "TrailModule"])
      if (c[m] && c[m].enabled) this.unsupported.push(m);
    // renderer
    const r = rendererComp && rendererComp.m_Enabled ? rendererComp : null;
    this.renderer = r ? {
      renderMode: r.m_RenderMode, alignment: r.m_RenderAlignment, pivot: v3(r.m_Pivot), flip: v3(r.m_Flip),
      minSize: F(r.m_MinParticleSize), maxSize: F(r.m_MaxParticleSize), sortMode: r.m_SortMode,
      sortingLayer: r.m_SortingLayer | 0, sortingLayerID: r.m_SortingLayerID | 0, normalDirection: F(r.m_NormalDirection),
      maskInteraction: r.m_MaskInteraction | 0, sortingFudge: F(r.m_SortingFudge || 0),
      streams: r.m_UseCustomVertexStreams ? r.m_VertexStreams.slice() : [0, 1, 3, 4],
      mesh: r.m_Mesh || null, materials: (r.m_Materials || []).filter(Boolean),
    } : null;
    this.sortingOrder = r ? r.m_SortingOrder | 0 : 0;     // LiveParticleOrderInLayerSetter may overwrite
    this.renderUnsupported = [];
    if (this.renderer) {
      const R2 = this.renderer;
      if (![0, 2, 3, 4, 5].includes(R2.renderMode)) this.renderUnsupported.push(`render mode ${R2.renderMode}`);
      if (R2.renderMode === 4 && !R2.mesh) this.renderUnsupported.push("mesh render mode without mesh data");
      if (R2.alignment === 4) this.renderUnsupported.push("velocity render alignment");
      for (const s of R2.streams) if (!FX_STREAM[s]) this.renderUnsupported.push(`vertex stream ${s}`);
      if (!R2.materials.length) this.renderUnsupported.push("no material");
      // register the materials now, so FxMaterials.load() uploads them before the first draw (Unity loads a prefab's
      // materials with the prefab)
      if (this.materials) for (const m of R2.materials) this.materials.get(m);
    }
    // runtime state
    this.particles = [];
    this.state = "stopped";           // playing | stopping | stopped | paused
    this.time = 0;                    // ParticleSystem.time (system seconds inside the current loop)
    this.loopCount = 0;
    this.delay = 0;                   // remaining start delay (system seconds)
    this.emitAcc = 0;                 // rate-over-time carry
    this.distAcc = 0;                 // rate-over-distance carry
    this.burstDone = this.emission.bursts.map(() => 0);
    this.activeInHierarchy = null;    // null = never told (treated as active)
    this.prevEmitterPos = null;
    this.emittedTotal = 0;            // diagnostics: particles emitted since construction
    this.rng = this.main.autoRandomSeed ? this.sharedRng : new UnityRandom(this.main.randomSeed);
    this._pausedFrom = null;
  }

  // -------------------------------------------------------------------------------------------- state
  get particleCount() { return this.particles.length; }
  // ENGINE: isPlaying stays true while a stopped system still has live particles (observed engine behaviour).
  get isPlaying() { return this.state === "playing" || (this.state === "stopping" && this.particles.length > 0); }
  get isEmitting() { return this.state === "playing"; }
  get isPaused() { return this.state === "paused"; }
  get isStopped() { return this.state === "stopped" || (this.state === "stopping" && this.particles.length === 0); }

  isAlive(withChildren = true) {
    if (this.state === "playing" || this.state === "paused" || this.particles.length > 0) return true;
    return withChildren && this.children.some((c) => c.isAlive(true));
  }

  _checkSupported() {
    if (this.unsupported.length) throw new FxError(`${this.name}: not implemented: ${this.unsupported.join(", ")}`);
  }

  // ParticleSystem.Play; a paused system resumes.
  // ENGINE: Play on a playing system does nothing; on a stopping / finished one it restarts at time 0, keeping particles.
  play(withChildren = true) {
    if (this.activeInHierarchy !== false) this._play();
    if (withChildren) for (const c of this.children) c.play(true);
  }

  _play() {
    if (this.state === "paused") { this.state = this._pausedFrom || "playing"; return; }
    if (this.state === "playing") return;
    this._checkSupported();
    if (!this.main.autoRandomSeed) this.rng.initState(this.main.randomSeed);
    this.state = "playing";
    this.time = 0; this.loopCount = 0; this.emitAcc = 0; this.distAcc = 0;
    this.burstDone = this.emission.bursts.map(() => 0);
    // ENGINE: startDelay is counted in simulated time (dt * simulationSpeed) and drawn once per Play.
    this.delay = Math.max(0, this.main.startDelay.evaluate(0, this.rng.value()));
    this.prevEmitterPos = this._emitterPosition();
    if (this.main.prewarm && this.main.looping) this._prewarm();
  }

  // ENGINE: prewarm simulates one full loop in 60 equal steps before the first frame (native step size not known).
  _prewarm() {
    const n = 60, d = F(this.main.duration / n);
    for (let i = 0; i < n; i++) this._step(d);
  }

  pause(withChildren = true) {
    if (this.state === "playing" || this.state === "stopping") { this._pausedFrom = this.state; this.state = "paused"; }
    if (withChildren) for (const c of this.children) c.pause(true);
  }

  // behavior: Unity's ParticleSystemStopBehavior, PS_STOP.StopEmittingAndClear (0) / StopEmitting (1, the default
  // of ParticleSystem.Stop()); the names "StopEmittingAndClear" / "StopEmitting" are accepted too.
  // ENGINE: the transition to stopped (and the stop action) happens in the next simulate(), not inside Stop.
  stop(withChildren = true, behavior = PS_STOP.StopEmitting) {
    if (![0, 1, "StopEmittingAndClear", "StopEmitting"].includes(behavior)) throw new FxError(`${this.name}: stop behavior ${behavior}`);
    const clear = behavior === PS_STOP.StopEmittingAndClear || behavior === "StopEmittingAndClear";
    if (clear) this.particles.length = 0;
    if (this.state === "playing" || this.state === "paused") this.state = "stopping";
    if (withChildren) for (const c of this.children) c.stop(true, behavior);
  }

  clear(withChildren = true) {
    this.particles.length = 0;
    if (withChildren) for (const c of this.children) c.clear(true);
  }

  // GameObject activation (activeInHierarchy). Activation plays a playOnAwake system (every enable: the pooled effects
  // are re-activated per use).
  // ENGINE: deactivation removes the particles and resets the system to stopped without a stop action.
  onActiveChanged(active) {
    active = !!active;
    if (this.activeInHierarchy === active) return;
    this.activeInHierarchy = active;
    if (active) {
      if (this.main.playOnAwake) this._play();
    } else {
      this.particles.length = 0;
      this.state = "stopped"; this.time = 0; this.delay = 0;
    }
  }

  // -------------------------------------------------------------------------------------------- Animator bindings
  // accessor(attr) -> {get, set} | null for class ParticleSystem bindings (and SetWidth code): "simulationSpeed",
  // "<Module>.<property>.<scalar|minScalar>", "InitialModule.startColor.<maxColor|minColor>.<r|g|b|a>",
  // "ShapeModule.<m_Scale|m_Position|m_Rotation>.<x|y|z>".
  accessor(attr) {
    if (attr === "simulationSpeed")
      return { get: () => this.main.simulationSpeed, set: (v) => { this.main.simulationSpeed = F(v); } };
    const parts = attr.split(".");
    if (parts[0] === "ShapeModule" && parts.length === 3) {
      const key = { m_Scale: "scale", m_Position: "position", m_Rotation: "rotation" }[parts[1]];
      const i = { x: 0, y: 1, z: 2 }[parts[2]];
      if (key === undefined || i === undefined) return null;
      return { get: () => this.shape[key][i], set: (v) => { this.shape[key][i] = F(v); } };
    }
    const mod = { InitialModule: this.initial, EmissionModule: this.emission, SizeModule: this.size,
                  ColorModule: this.color, VelocityModule: this.velocity, ClampVelocityModule: this.limit }[parts[0]];
    if (!mod) return null;
    const prop = mod[parts[1]];
    if (prop instanceof MinMaxCurve && parts.length === 3 && (parts[2] === "scalar" || parts[2] === "minScalar")) {
      const f = parts[2];
      return { get: () => prop[f], set: (v) => { prop[f] = F(v); } };
    }
    if (prop instanceof MinMaxGradient && parts.length === 4 && (parts[2] === "maxColor" || parts[2] === "minColor")) {
      const i = { r: 0, g: 1, b: 2, a: 3 }[parts[3]];
      if (i === undefined) return null;
      const col = prop[parts[2]];
      return { get: () => col[i], set: (v) => { col[i] = F(v); } };
    }
    return null;
  }

  // C# "module.prop = constant" (MinMaxCurve implicit conversion), e.g. setConstant("InitialModule.startSize", w) for
  // main.startSizeX = width (LiveGameLaneEffectBase.SetWidth).
  setConstant(path, v) {
    const [m, p] = path.split(".");
    const mod = { InitialModule: this.initial, EmissionModule: this.emission }[m];
    if (!mod || !(mod[p] instanceof MinMaxCurve)) throw new FxError(`${this.name}: setConstant ${path}`);
    mod[p].setConstant(v);
  }

  // -------------------------------------------------------------------------------------------- transforms
  static worldRotation(t) {
    let q = t.localRotation;
    for (let p = t.parent; p; p = p.parent) q = quat.mul(p.localRotation, q);
    return q;
  }

  // The system's frame by scaling mode (ParticleSystemScalingMode): M = matrix of the local simulation space and of
  // the emission shape, R = world rotation (columns), S = scale the particles get along the system axes.
  //   Hierarchy 0: M = localToWorld, S = lossy scale (column lengths); Local 1: M = TRS(world position, world rotation,
  //   own localScale), parents' scale ignored; Shape 2: M = TR, the scale only moves the shape positions.
  // A transform without a parent chain (FxMatrixTransform: only localToWorld()) gives R from the matrix columns.
  // ENGINE: the lossy-scale extraction ignores shear from non-uniform parent scale under rotation.
  // A matrix-only transform under Local scaling uses its localScale if it has one, else the lossy scale.
  _frame() {
    const t = this.transform, W = t.localToWorld();
    const pos = [W[12], W[13], W[14]];
    const R = t.localRotation ? FxV.quatCols(FxParticleSystem.worldRotation(t)) : FxV.matRotation(W);
    const lossy = [Math.hypot(W[0], W[1], W[2]), Math.hypot(W[4], W[5], W[6]), Math.hypot(W[8], W[9], W[10])];
    let M, S, shapeScale = [1, 1, 1];
    if (this.main.scalingMode === 0) { M = W; S = lossy; }
    else if (this.main.scalingMode === 1) {
      const ls = t.localScale; S = ls ? [ls.x, ls.y, ls.z] : lossy; M = FxV.compose(R, S, pos);
    } else { M = FxV.compose(R, [1, 1, 1], pos); S = [1, 1, 1]; shapeScale = lossy; }
    return { M, R, S, pos, shapeScale };
  }

  _emitterPosition() { const W = this.transform.localToWorld(); return [W[12], W[13], W[14]]; }

  // -------------------------------------------------------------------------------------------- simulation
  // One frame: dt = scaled delta time; the system advances dt * simulationSpeed.
  // ENGINE: the order inside a step follows the documented module order (native order not visible):
  // existing particles age / die, then gravity, force,
  // velocity over lifetime, limit velocity, rotation, position integration; then emission (bursts, rate over time,
  // rate over distance), each new particle simulated for the part of the step after its emission time.
  simulate(dt) {
    if (this.activeInHierarchy === false) return;
    if (this.state === "stopped" || this.state === "paused") return;
    const sdt = F(dt * this.main.simulationSpeed);
    if (!(sdt > 0)) return;
    this._step(sdt);
  }

  _step(sdt) {
    const fr = this._frame();
    const ps = this.particles;
    // ENGINE: noise scroll: the offset advances by scrollSpeed (at the normalized system time) per simulated second
    if (this.noise) this.noiseOffset += this.noise.scrollSpeed.evaluate(this.main.duration > 0 ? this.time / this.main.duration : 0, 1) * sdt;
    for (let i = 0; i < ps.length;) {
      if (this._update(ps[i], sdt, fr)) i++;
      else { ps[i] = ps[ps.length - 1]; ps.pop(); }      // ENGINE: dead particles are swap-removed (buffer order)
    }
    if (this.state === "playing") this._emit(sdt, fr);
    this.prevEmitterPos = fr.pos;
    if (this.state === "stopping" && ps.length === 0) this._stopped();
  }

  // ENGINE: the stop action runs inside the update in which the system is found dead (no live particles, not emitting).
  // Unity sends OnParticleSystemStopped after its particle jobs, still before rendering of that frame.
  _stopped() {
    this.state = "stopped";
    const a = this.main.stopAction;
    if (a === 3) { if (this.onStopped) this.onStopped(this); }
    else if (a === 1 || a === 2) { if (this.onStopAction) this.onStopAction(a, this); }
  }

  _emit(sdt, fr) {
    const main = this.main, em = this.emission, D = main.duration;
    let budget = sdt, start = 0;
    if (this.delay > 0) {
      const d = Math.min(this.delay, budget);
      this.delay = F(this.delay - d); budget = F(budget - d); start = d;
      if (!(budget > 0)) return;
    }
    const moved = this.prevEmitterPos ? FxV.len(FxV.sub(fr.pos, this.prevEmitterPos)) : 0;
    const t0step = this.time;
    let t = this.time, used = 0, guard = 0;
    while (budget - used > 1e-9 && guard++ < 10000) {
      if (!(D > 0)) break;
      if (!main.looping && t >= D) break;
      const seg = Math.min(budget - used, D - t), t1 = t + seg, segStart = start + used;
      if (em.enabled) {
        this._bursts(t, t1, segStart, sdt, fr);
        this._rateOverTime(t, t1, segStart, sdt, fr);
      }
      used += seg; t = t1;
      if (t >= D) {
        if (main.looping) { t = 0; this.loopCount++; this.burstDone = em.bursts.map(() => 0); }
        else { t = D; break; }
      }
    }
    this.time = F(t);
    // rate over distance: the emitter is taken to move linearly during the frame; the n-th particle is emitted where
    // the travelled distance crosses n / rate.
    // ENGINE: rate over distance uses the world displacement since the last update, not scaled by simulationSpeed.
    // emitterVelocityMode Rigidbody without a Rigidbody uses the
    // transform; rate evaluated at the normalized system time of the step start.
    if (em.enabled && moved > 0) {
      const rd = em.rateOverDistance.evaluate(D > 0 ? t0step / D : 0, this.rng.value());
      if (rd > 0) {
        const acc0 = this.distAcc, total = acc0 + rd * moved, n = Math.floor(total);
        for (let k = 1; k <= n; k++) {
          const f = Math.min(Math.max((k - acc0) / (rd * moved), 0), 1);
          this._spawn(F(sdt * (1 - f)), f, fr);
        }
        this.distAcc = total - n;
      }
    }
    if (!main.looping && this.time >= D) this.state = "stopping";      // duration over: no more emission
  }

  // Bursts of the loop segment [t, t1) (system time).
  // ENGINE: a burst fires in the step whose time window contains it (start inclusive), aged by the rest of the step.
  // count = round(count curve at the burst's
  // normalized time); probability tested once per cycle.
  _bursts(t, t1, segStart, sdt, fr) {
    const em = this.emission, D = this.main.duration;
    em.bursts.forEach((b, i) => {
      for (let guard = 0; guard < 100000; guard++) {
        const k = this.burstDone[i];
        const cycles = b.cycles > 0 ? b.cycles : (b.interval > 0 ? Infinity : 1);
        if (k >= cycles) break;
        const T = F(b.time + k * b.interval);
        if (T >= t1) break;
        this.burstDone[i] = k + 1;
        if (T < t) continue;
        if (b.probability < 1 && !(this.rng.value() < b.probability)) continue;
        const n = Math.round(b.count.evaluate(D > 0 ? T / D : 0, this.rng.value()));
        const age = F(sdt - (segStart + (T - t)));
        for (let j = 0; j < n; j++) this._spawn(age, 1 - age / sdt, fr);
      }
    });
  }

  // Rate over time over the loop segment [t, t1): accumulator with fractional carry; the rate curve (time axis = the
  // system duration) is evaluated once at the segment midpoint; particle k is emitted when the accumulator crosses k.
  // ENGINE: the native sampling point of the rate curve, the carry across Play / loops and float precision are not known.
  _rateOverTime(t, t1, segStart, sdt, fr) {
    const D = this.main.duration, seg = t1 - t;
    if (!(seg > 0)) return;
    const rate = this.emission.rateOverTime.evaluate((t + t1) * 0.5 / D, this.rng.value());
    if (!(rate > 0)) return;
    const acc0 = this.emitAcc, total = acc0 + rate * seg, n = Math.floor(total);
    for (let k = 1; k <= n; k++) {
      const tau = (k - acc0) / rate;                       // seconds after the segment start
      const age = F(sdt - (segStart + tau));
      this._spawn(age, 1 - age / sdt, fr);
    }
    this.emitAcc = total - n;
  }

  // Shape module sample in the shape's frame -> {p, d} in the system's local frame (before the system matrix).
  // Shape frame: TRS(m_Position, Euler(m_Rotation), m_Scale).
  // ENGINE: the shape sampling formulas below follow the manual (the native sampling is not visible):
  // Box emits along +Z (volume / shell = one axis at a face / edge = two axes at faces, boxThickness as the proportion
  // of the volume towards the inside, the free axis of an edge chosen uniformly), Edge (SingleSidedEdge) is a segment
  // x in [-radius, radius] emitting along +Y, Sphere / Hemisphere / Circle / Cone base with radiusThickness.
  _shapeSample() {
    const S = this.shape, rng = this.rng, V = FxV;
    if (!S.enabled) return { p: [0, 0, 0], d: [0, 0, 1] };        // ENGINE: disabled shape module: emit at origin along +Z
    let p, d;
    switch (S.type) {
      case 5: case 15: case 16: {
        p = [rng.value() - 0.5, rng.value() - 0.5, rng.value() - 0.5];
        const snap = (ax) => {
          const s = rng.value() < 0.5 ? -1 : 1;
          p[ax] = s * (0.5 - 0.5 * S.boxThickness[ax] * rng.value());
        };
        const free = Math.min(2, Math.floor(rng.value() * 3));
        if (S.type === 15) snap(free);
        else if (S.type === 16) { snap((free + 1) % 3); snap((free + 2) % 3); }
        d = [0, 0, 1];
        break;
      }
      case 12: p = [S.radius * (2 * rng.value() - 1), 0, 0]; d = [0, 1, 0]; break;
      case 18: p = [rng.value() - 0.5, rng.value() - 0.5, 0]; d = [0, 0, 1]; break;
      case 0: case 1: case 2: case 3: {
        const dir = FxRand.onUnitSphere(rng);
        if (S.type >= 2) dir[2] = Math.abs(dir[2]);
        const inner = S.type === 1 || S.type === 3 ? 1 : 1 - S.radiusThickness;
        const r = S.radius * Math.cbrt(inner * inner * inner + (1 - inner * inner * inner) * rng.value());
        p = V.scale(dir, r); d = dir;
        break;
      }
      case 4: case 10: case 11: {
        const a = rng.value() * S.arc * Math.PI / 180;
        const inner = S.type === 11 ? 1 : 1 - S.radiusThickness;
        const r = S.radius * Math.sqrt(inner * inner + (1 - inner * inner) * rng.value());
        p = [Math.cos(a) * r, Math.sin(a) * r, 0];
        if (S.type === 4) {
          const k = S.radius > 0 ? r / S.radius : 0, tn = Math.tan(S.angle * Math.PI / 180);
          d = V.norm([Math.cos(a) * k * tn, Math.sin(a) * k * tn, 1]);
        } else d = V.norm(p[0] || p[1] ? [p[0], p[1], 0] : [1, 0, 0]);
        break;
      }
      default: throw new FxError(`${this.name}: shape type ${S.type}`);
    }
    p = [p[0] * S.scale[0], p[1] * S.scale[1], p[2] * S.scale[2]];
    const Rs = V.quatCols(quat.euler(S.rotation[0], S.rotation[1], S.rotation[2]));
    p = V.add(V.colsMul(Rs, p), S.position);
    d = V.norm(V.colsMul(Rs, d));
    if (S.randomDirection > 0) d = V.norm(V.lerp(d, FxRand.onUnitSphere(rng), S.randomDirection));
    if (S.sphericalDirection > 0) d = V.norm(V.lerp(d, V.norm(p), S.sphericalDirection));
    if (S.randomPosition > 0) p = V.add(p, V.scale(FxRand.insideUnitSphere(rng), S.randomPosition));
    return { p, d };
  }

  // A new particle: start values at the normalized system time, shape position, simulated for `age` (the part of the
  // step after its emission); f = emission point as a fraction of the step (world-space emitter interpolation).
  // ENGINE: the order of random draws at emission is native and not known; the order below is this port's.
  // startColor is stored as Color32 (Particle.startColor) with
  // round(clamp01(c) * 255); a particle whose start lifetime is <= 0 is not emitted; maxParticles drops the excess.
  _spawn(age, f, fr) {
    const I = this.initial, rng = this.rng, V = FxV, D = this.main.duration;
    if (this.particles.length >= I.maxParticles) return;
    this.emittedTotal++;
    const tn = D > 0 ? Math.min(this.time / D, 1) : 0;
    const life = I.startLifetime.evaluate(tn, rng.value());
    if (!(life > 0)) return;
    const speed = I.startSpeed.evaluate(tn, rng.value());
    let size;
    if (I.size3D) size = [I.startSize.evaluate(tn, rng.value()), I.startSizeY.evaluate(tn, rng.value()), I.startSizeZ.evaluate(tn, rng.value())];
    else { const s = I.startSize.evaluate(tn, rng.value()); size = [s, s, s]; }
    const rot = I.rotation3D
      ? [I.startRotationX.evaluate(tn, rng.value()), I.startRotationY.evaluate(tn, rng.value()), I.startRotation.evaluate(tn, rng.value())]
      : [0, 0, I.startRotation.evaluate(tn, rng.value())];
    // ENGINE: randomizeRotationDirection: the fraction of particles whose rotation (and spin) is mirrored
    const sign = I.randomizeRotationDirection > 0 && rng.value() < I.randomizeRotationDirection ? -1 : 1;
    if (sign < 0) { rot[0] = -rot[0]; rot[1] = -rot[1]; rot[2] = -rot[2]; }
    const c32 = (x) => Math.round(Math.min(Math.max(x, 0), 1) * 255) / 255;
    const color0 = I.startColor.evaluate(tn, rng.value()).map(c32);
    const sh = this._shapeSample();
    let pos, vel;
    if (this.main.simulationSpace === 1) {
      const M = fr.M, prev = this.prevEmitterPos || fr.pos;
      // ENGINE: world-space sub-frame emission: emitter position interpolated linearly between the last and this update
      const at = V.lerp(prev, fr.pos, Math.min(Math.max(f, 0), 1));
      const q = [sh.p[0] * fr.shapeScale[0], sh.p[1] * fr.shapeScale[1], sh.p[2] * fr.shapeScale[2]];
      pos = V.add(V.dir(M, q), at);
      // ENGINE: start velocity = shape direction (rotated, not scaled) x speed, into World space by system rotation and scale.
      // (scalingMode Hierarchy / Local scale movement, Shape does not)
      vel = V.colsMul(fr.R, [sh.d[0] * speed * fr.S[0], sh.d[1] * speed * fr.S[1], sh.d[2] * speed * fr.S[2]]);
    } else {
      pos = [sh.p[0] * fr.shapeScale[0], sh.p[1] * fr.shapeScale[1], sh.p[2] * fr.shapeScale[2]];
      vel = V.scale(sh.d, speed);
    }
    const rnd = new Float32Array(FX_RND.N);
    for (let i = 0; i < rnd.length; i++) rnd[i] = rng.value();
    const R2 = this.renderer;
    const flip = R2 ? R2.flip.map((x) => (x > 0 && rng.value() < x ? -1 : 1)) : [1, 1, 1];
    const p = { pos, vel, anim: [0, 0, 0], age: 0, life, size0: size, rot, spin: sign, color0, rnd, flip,
                stable: [rng.value(), rng.value(), rng.value(), rng.value()] };
    if (this._update(p, age, fr)) this.particles.push(p);
  }

  // Normalized age t = age / startLifetime (Particle.remainingLifetime = startLifetime - age).
  _t(p) { return Math.min(Math.max(F(p.age / p.life), 0), 1); }

  // Advance one particle by dt (system seconds); false when it died (age >= start lifetime).
  // ENGINE: velocity over lifetime, limit, drag, dampen and gravity follow the manual; the native forms are not visible:
  // velocity over lifetime is the non-accumulated animatedVelocity; limit velocity clamps the total
  // velocity (velocity + animatedVelocity) and writes the change back into velocity; drag v *= max(0, 1 - drag dt)
  // before the limit; dampen removes that fraction of the speed above the limit once per update (the manual's
  // "0.5 dampens the exceeding velocity by 50%"; a frame-rate-independent native form is possible); gravity uses
  // (0, -9.81, 0) (Physics.gravity / Physics2D.gravity of the project are not in the data) and, like force over
  // lifetime, is integrated into velocity; speedModifier scales the integrated displacement.
  // ENGINE: module vectors in local space enter a World-space simulation through R S v; world vectors a Local one via S^-1 R^T.
  // (R S v: Hierarchy / Local scaling scale movement; the
  // enum documentation of Shape says it "does not affect their size or movement"; S^-1 R^T so that the render matrix
  // M gives the world vector back.)
  _update(p, dt, fr) {
    p.age = F(p.age + dt);
    if (p.age >= p.life) return false;
    const V = FxV, X = FX_RND, r = p.rnd, t = this._t(p);
    const world = this.main.simulationSpace === 1, S = fr.S;
    const mulS = (v) => [v[0] * S[0], v[1] * S[1], v[2] * S[2]];
    const divS = (v) => v.map((c, i) => (Math.abs(S[i]) > 1e-12 ? c / S[i] : 0));
    const toSim = (v, inWorld) => (world === inWorld ? v : world ? V.colsMul(fr.R, mulS(v)) : divS(V.colsMulT(fr.R, v)));
    const fromSim = (v, inWorld) => (world === inWorld ? v.slice() : world ? divS(V.colsMulT(fr.R, v)) : V.colsMul(fr.R, mulS(v)));
    const gm = this.initial.gravityModifier;
    if (!gm.isZero()) {
      const k = gm.evaluate(t, r[X.gravity]);
      p.vel = V.add(p.vel, V.scale(toSim([0, -9.81 * k, 0], true), dt));
    }
    if (this.force) {
      const f = this.force;
      const a = toSim([f.x.evaluate(t, r[X.forceX]), f.y.evaluate(t, r[X.forceY]), f.z.evaluate(t, r[X.forceZ])], f.inWorldSpace);
      p.vel = V.add(p.vel, V.scale(a, dt));
    }
    let speedMod = 1;
    if (this.velocity) {
      const v = this.velocity;
      p.anim = toSim([v.x.evaluate(t, r[X.velX]), v.y.evaluate(t, r[X.velY]), v.z.evaluate(t, r[X.velZ])], v.inWorldSpace);
      speedMod = v.speedModifier.evaluate(t, r[X.speedMod]);
    } else p.anim = [0, 0, 0];
    if (this.limit) {
      const L = this.limit;
      let tot = V.add(p.vel, p.anim);
      let drag = L.drag.evaluate(t, r[X.drag]);
      if (drag > 0) {
        if (L.bySize) { const s = this._size(p); drag *= Math.max(s[0], s[1], s[2]); }       // ENGINE: drag by size uses the largest size axis
        if (L.byVelocity) drag *= V.len(tot);                                                // ENGINE: drag by velocity uses the total speed
        tot = V.scale(tot, Math.max(0, 1 - drag * dt));
      }
      if (L.separateAxis) {
        let v = fromSim(tot, L.inWorldSpace);
        const lim = [L.x.evaluate(t, r[X.limitX]), L.y.evaluate(t, r[X.limitY]), L.z.evaluate(t, r[X.limitZ])];
        v = v.map((c, i) => (Math.abs(c) > lim[i] ? Math.sign(c) * (Math.abs(c) - (Math.abs(c) - lim[i]) * L.dampen) : c));
        tot = toSim(v, L.inWorldSpace);
      } else {
        const lim = L.magnitude.evaluate(t, r[X.limit]), sp = V.len(tot);
        if (sp > lim && sp > 0) tot = V.scale(tot, (sp - (sp - lim) * L.dampen) / sp);
      }
      p.vel = V.sub(tot, p.anim);
    }
    if (this.rotation) {
      const R = this.rotation;
      const w = R.separateAxes ? [R.x.evaluate(t, r[X.rotX]), R.y.evaluate(t, r[X.rotY]), R.z.evaluate(t, r[X.rotZ])]
                               : [0, 0, R.z.evaluate(t, r[X.rotZ])];
      for (let i = 0; i < 3; i++) p.rot[i] = F(p.rot[i] + p.spin * w[i] * dt);
    }
    const e = this.noise ? this._noise(p, t) : [0, 0, 0];
    const v = V.add(p.vel, p.anim), k = dt * speedMod;
    p.pos = [F(p.pos[0] + v[0] * k + e[0] * dt), F(p.pos[1] + v[1] * k + e[1] * dt), F(p.pos[2] + v[2] * k + e[2] * dt)];
    return true;
  }

  // Noise module (documented semantics): noise sampled at the particle position (simulation space) x frequency +
  // scroll offset, octaves summed with amplitude octaveMultiplier^k at frequency x octaveScale^k (normalised by the
  // amplitude sum), optional remap (curves over (n + 1) / 2), strength per axis (or the x curve for all axes) over the
  // particle's normalized age; damping divides the strength by the frequency (API: "higher frequency noise reduces the
  // strength by a proportional amount"); the result moves the particle as a velocity (units / s, not accumulated)
  // times positionAmount; rotationAmount adds noise x strength x amount (degrees / s) to the z rotation; sizeAmount
  // scales the size by 1 + noise x amount (p.noise kept for _size).
  // ENGINE: the Noise module is native; the steps above are the documented semantics, not Unity's exact field.
  // Not known: the noise function (FxNoise), its seed and per-axis
  // offsets, the octave normalisation, the remap input range, the damping form, velocity vs displacement semantics, the
  // space (simulation-space coordinates, unscaled) and the rotation / size mappings.
  _noise(p, t) {
    const N = this.noise, X = FX_RND, r = p.rnd;
    let sum = [0, 0, 0], amp = 1, freq = N.frequency, norm = 0;
    for (let o = 0; o < N.octaves; o++) {
      const q = [p.pos[0] * freq + this.noiseOffset, p.pos[1] * freq + this.noiseOffset, p.pos[2] * freq + this.noiseOffset];
      const n = FxNoise.sample3(q, N.quality);
      sum = sum.map((x, i) => x + amp * n[i]);
      norm += amp; amp *= N.octaveMultiplier; freq *= N.octaveScale;
    }
    let n = sum.map((x) => x / norm);
    if (N.remapEnabled) n = n.map((x, i) => N.remap[N.separateAxes ? i : 0].evaluate((x + 1) / 2, 1));
    const sx = N.strength[0].evaluate(t, r[X.noiseX]);
    let st = N.separateAxes ? [sx, N.strength[1].evaluate(t, r[X.noiseY]), N.strength[2].evaluate(t, r[X.noiseZ])] : [sx, sx, sx];
    if (N.damping && N.frequency > 0) st = st.map((x) => x / N.frequency);
    p.noise = n;
    const rotA = N.rotationAmount.evaluate(t, r[X.noiseRot]);
    if (rotA) p.rot[2] = F(p.rot[2] + n[2] * st[2] * rotA * Math.PI / 180);
    const pa = N.positionAmount.evaluate(t, r[X.noisePos]);
    p.noiseVelocity = [n[0] * st[0] * pa, n[1] * st[1] * pa, n[2] * st[2] * pa];
    return p.noiseVelocity;
  }

  // particle size (start size x size over lifetime, separate axes or one curve for all)
  _size(p) {
    const Z = this.size, X = FX_RND;
    let s = p.size0;
    if (this.noise && p.noise) {
      const a = this.noise.sizeAmount.evaluate(this._t(p), p.rnd[X.noiseSize]);
      if (a) s = s.map((x, i) => x * (1 + p.noise[i] * a));                       // ENGINE: noise size mapping (see _noise)
    }
    if (!Z) return s.slice();
    const t = this._t(p);
    if (!Z.separateAxes) { const k = Z.x.evaluate(t, p.rnd[X.sizeX]); return [s[0] * k, s[1] * k, s[2] * k]; }
    return [s[0] * Z.x.evaluate(t, p.rnd[X.sizeX]), s[1] * Z.y.evaluate(t, p.rnd[X.sizeY]), s[2] * Z.z.evaluate(t, p.rnd[X.sizeZ])];
  }

  // particle colour before the Color32 vertex conversion: startColor (Color32) x colour over lifetime
  _color(p) {
    const c = p.color0;
    if (!this.color) return c.slice();
    const g = this.color.gradient.evaluate(this._t(p), p.rnd[FX_RND.color]);
    return [c[0] * g[0], c[1] * g[1], c[2] * g[2], c[3] * g[3]];
  }

  // custom data stream k (0 = Custom1, 1 = Custom2): 4 floats (Vector mode: the first vectorComponentCount curves,
  // the rest 0; Color mode: the gradient)
  _customData(p, k) {
    const cd = this.custom && this.custom[k];
    if (!cd || cd.mode === 0) return [0, 0, 0, 0];
    const t = this._t(p), X = FX_RND;
    if (cd.mode === 2) return cd.color.evaluate(t, p.rnd[k ? X.c2c : X.c1c]);
    return [0, 1, 2, 3].map((j) => (j < cd.count ? cd.vec[j].evaluate(t, p.rnd[(k ? X.c2 : X.c1) + j]) : 0));
  }

  // test / host helper: world position of a particle
  worldPosition(p, fr = this._frame()) { return this.main.simulationSpace === 1 ? p.pos.slice() : FxV.point(fr.M, p.pos); }

  // -------------------------------------------------------------------------------------------- rendering
  // Camera basis from ctx.camera (the renderer's LiveRenderer): transform localToWorld (+Z forward) when present, else Unity's
  // cameraToWorldMatrix (-Z forward). position overrides the matrix translation. proj: for the min / max size clamp.
  static cameraBasis(cam) {
    const V = FxV, col = (m, i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
    let right = [1, 0, 0], up = [0, 1, 0], fwd = [0, 0, 1], pos = [0, 0, 0];
    if (cam && cam.localToWorld) { const m = cam.localToWorld; right = V.norm(col(m, 0)); up = V.norm(col(m, 1)); fwd = V.norm(col(m, 2)); pos = col(m, 3); }
    else if (cam && cam.cameraToWorld) { const m = cam.cameraToWorld; right = V.norm(col(m, 0)); up = V.norm(col(m, 1)); fwd = V.scale(V.norm(col(m, 2)), -1); pos = col(m, 3); }
    if (cam && cam.position) pos = Array.isArray(cam.position) || cam.position instanceof Float32Array
      ? [cam.position[0], cam.position[1], cam.position[2]] : [cam.position.x, cam.position.y, cam.position.z];
    return { right, up, fwd, pos, proj: cam ? cam.proj : null };
  }

  // world-space bounds of the particle centres, expanded by the largest particle half extent.
  // ENGINE: Unity's renderer bounds are native (computed in the update, own margin); only the centre is used here.
  // (The centre gives the sorting distance.)
  bounds(fr = this._frame()) {
    if (!this.particles.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let ext = 0;
    const sMax = Math.max(fr.S[0], fr.S[1], fr.S[2]);
    for (const p of this.particles) {
      const w = this.worldPosition(p, fr);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
      const s = this._size(p);
      ext = Math.max(ext, 0.5 * Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) * sMax);
    }
    const mn = lo.map((x) => x - ext), mx = hi.map((x) => x + ext);
    return { min: mn, max: mx, center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] };
  }

  // Submission item for this frame (for renderer.submit), or null when nothing is drawn. camera (optional): a position
  // ([x, y, z] or {x, y, z}), {position}, a camera matrix (16 floats, translation = position) or a ctx.camera-like
  // object; with it, `distance` = distance from the camera position to the bounds centre (the renderer's sorting value for
  // perspective cameras), else 0 and item.distanceTo(pos) computes it.
  drawItem(camera = null) {
    const R = this.renderer;
    if (!R || R.renderMode === 5 || this.activeInHierarchy === false || !this.particles.length) return null;
    if (this.renderUnsupported.length) throw new FxError(`${this.name}: renderer: ${this.renderUnsupported.join(", ")}`);
    const b = this.bounds();
    const m = this.materials ? this.materials.get(R.materials[0]) : null;
    const distanceTo = (pos) => (pos ? FxV.len(FxV.sub(b.center, pos)) : 0);
    let camPos = null;
    if (camera) {
      if (camera.length === 16) camPos = [camera[12], camera[13], camera[14]];
      else if (camera.length === 3) camPos = [camera[0], camera[1], camera[2]];
      else if (typeof camera.x === "number") camPos = [camera.x, camera.y, camera.z];
      else camPos = FxParticleSystem.cameraBasis(camera).pos;
    }
    return {
      sortingLayer: R.sortingLayer, sortingOrder: this.sortingOrder,
      queue: m ? m.queue : (R.materials[0].renderQueue >= 0 ? R.materials[0].renderQueue : null),
      distance: distanceTo(camPos), distanceTo, bounds: b, maskInteraction: R.maskInteraction, name: this.name,
      system: this, draw: (ctx) => this.draw(ctx),
    };
  }

  draw(ctx) {
    const geo = this.geometry(ctx.camera);
    if (!geo || !this.materials) return;
    for (const part of geo.parts) this.materials.get(part.material).draw(ctx, part.mesh, geo.localToWorld, {});
  }

  // Vertex layout of the renderer's streams: shader channels first (POSITION, NORMAL, TANGENT, COLOR), then every
  // other stream packed into TEXCOORD0.. (4 floats each, a stream may straddle two channels).
  _layout() {
    const streams = this.renderer.streams;
    if (!streams.includes(0)) throw new FxError(`${this.name}: vertex streams without Position`);
    const attribs = {}, chan = [], tex = [];
    let off = 0;
    for (const s of [0, 1, 2, 3]) if (streams.includes(s)) {
      const [n, k] = [FX_STREAM[s][1], { 0: "in_POSITION0", 1: "in_NORMAL0", 2: "in_TANGENT0", 3: "in_COLOR0" }[s]];
      attribs[k] = [n, off]; chan.push([s, off]); off += n;
    }
    const texStart = off;
    for (const s of streams) if (s > 3) { tex.push([s, off]); off += FX_STREAM[s][1]; }
    const texFloats = off - texStart;
    for (let k = 0; k * 4 < texFloats; k++) attribs[`in_TEXCOORD${k}`] = [Math.min(4, texFloats - 4 * k), texStart + 4 * k];
    return { stride: off, attribs, chan, tex };
  }

  // one vertex into buf at o
  _vertex(buf, o, L, p, v, n, uv, col, center, vid) {
    for (const [s, at] of L.chan) {
      if (s === 0) { buf[at + o] = v[0]; buf[at + o + 1] = v[1]; buf[at + o + 2] = v[2]; }
      else if (s === 1) { buf[at + o] = n[0]; buf[at + o + 1] = n[1]; buf[at + o + 2] = n[2]; }
      else if (s === 2) { buf[at + o] = 1; buf[at + o + 1] = 0; buf[at + o + 2] = 0; buf[at + o + 3] = 1; }  // ENGINE: constant tangent (1, 0, 0, 1)
      else for (let i = 0; i < 4; i++) buf[at + o + i] = col[i];
    }
    for (const [s, at] of L.tex) {
      const w = (vals) => { for (let i = 0; i < vals.length; i++) buf[at + o + i] = vals[i]; };
      switch (s) {
        case 4: w(uv); break;
        case 10: w(center); break;
        case 11: w([vid]); break;
        case 12: case 13: case 14: w(this._size(p).slice(0, s - 11)); break;
        case 15: w([p.rot[2]]); break;
        case 16: w(p.rot); break;
        case 19: w(FxV.add(p.vel, p.anim)); break;
        case 20: w([FxV.len(FxV.add(p.vel, p.anim))]); break;
        case 21: w([this._t(p)]); break;
        case 22: w([1 / p.life]); break;
        case 23: case 24: case 25: case 26: w(p.stable.slice(0, s - 22)); break;
        case 31: case 32: case 33: case 34: w(this._customData(p, 0).slice(0, s - 30)); break;
        case 35: case 36: case 37: case 38: w(this._customData(p, 1).slice(0, s - 34)); break;
        default: throw new FxError(`${this.name}: vertex stream ${s}`);
      }
    }
  }

  // particle draw order by ParticleSystemSortMode; None = buffer order.
  // ENGINE: tie order and the native sort keys (e.g. whether Distance uses the camera position or plane) are not known.
  _sorted(cb, fr) {
    const mode = this.renderer.sortMode, ps = this.particles.slice();
    if (!mode) return ps;
    const key = (p) => {
      const w = this.worldPosition(p, fr), d = FxV.sub(w, cb.pos);
      if (mode === 1 || mode === 5) return FxV.dot(d, d);
      if (mode === 4 || mode === 6) return FxV.dot(d, cb.fwd);
      return p.age;
    };
    const k = new Map(ps.map((p) => [p, key(p)]));
    if (mode === 1 || mode === 4) ps.sort((a, b) => k.get(b) - k.get(a));          // far first
    else if (mode === 5 || mode === 6) ps.sort((a, b) => k.get(a) - k.get(b));
    else if (mode === 2) ps.sort((a, b) => k.get(a) - k.get(b));                    // oldest drawn last (in front)
    else if (mode === 3) ps.sort((a, b) => k.get(b) - k.get(a));
    return ps;
  }

  // Geometry for one camera: {localToWorld, parts: [{material, mesh: {verts, stride, attribs, idx}}]}. Vertices are in
  // the simulation space: Local systems draw with the system matrix M as unity_ObjectToWorld, World systems with
  // identity (Unity's particle renderer convention). World-direction offsets (camera-facing axes, World alignment) are
  // mapped into the system frame without its scale, so M (or, for World space, R S R^T) scales them along the system
  // axes.
  // ENGINE: non-uniform transform scale on billboards / World-space particles is undocumented; extents scale along system axes.
  // (Camera-facing directions are kept.)
  geometry(camera) {
    const R = this.renderer;
    if (!R || R.renderMode === 5 || !this.particles.length) return null;
    if (this.renderUnsupported.length) throw new FxError(`${this.name}: renderer: ${this.renderUnsupported.join(", ")}`);
    const V = FxV, fr = this._frame(), cb = FxParticleSystem.cameraBasis(camera);
    const world = this.main.simulationSpace === 1;
    const mulS = (d) => [d[0] * fr.S[0], d[1] * fr.S[1], d[2] * fr.S[2]];
    // world direction -> offset in simulation space; system-frame direction -> offset in simulation space
    const fromWorld = world ? (d) => V.colsMul(fr.R, mulS(V.colsMulT(fr.R, d))) : (d) => V.colsMulT(fr.R, d);
    const fromLocal = world ? (d) => V.colsMul(fr.R, mulS(d)) : (d) => d.slice();
    const scaleAlong = (d) => V.len(V.colsMul(fr.R, mulS(V.colsMulT(fr.R, d))));
    const L = this._layout();
    const ps = this._sorted(cb, fr);
    const mesh = R.renderMode === 4 ? R.mesh : null;
    const nv = mesh ? mesh.vertices.length : 4;
    const verts = new Float32Array(ps.length * nv * L.stride);
    const c32 = (x) => Math.round(Math.min(Math.max(x, 0), 1) * 255) / 255;      // ENGINE: vertex colour Color32 rounding
    const pv = R.pivot;
    ps.forEach((p, pi) => {
      const size = this._size(p), col = this._color(p).map(c32), w = this.worldPosition(p, fr);
      const base = pi * nv;
      if (!mesh) {
        let right, up, n;
        if (R.renderMode === 2) { right = [1, 0, 0]; up = [0, 0, 1]; n = [0, 1, 0]; }          // ENGINE: horizontal billboard: u +X, v +Z
        else if (R.renderMode === 3) {
          up = [0, 1, 0];
          right = V.norm(V.cross(up, cb.fwd));
          if (!(V.len(right) > 0)) right = cb.right;
          n = V.cross(up, right);                                                                // towards the camera
        } else {
          switch (R.alignment) {
            case 1: right = [1, 0, 0]; up = [0, 1, 0]; n = [0, 0, -1]; break;
            case 2: right = fr.R[0]; up = fr.R[1]; n = V.scale(fr.R[2], -1); break;
            case 3: {
              const f = V.norm(V.sub(w, cb.pos));
              right = V.norm(V.cross(cb.up, f)); up = V.cross(f, right); n = V.scale(f, -1); break;
            }
            default: right = cb.right; up = cb.up; n = V.scale(cb.fwd, -1);
          }
        }
        // ENGINE: rotation sign (positive = clockwise on screen) and normalDirection blend are native conventions
        const th = p.rot[2], cs = Math.cos(th), sn = Math.sin(th);
        const r2 = V.sub(V.scale(right, cs), V.scale(up, sn)), u2 = V.add(V.scale(right, sn), V.scale(up, cs));
        let sx = size[0], sy = size[1];
        // min / max particle size, fraction of the viewport height at the particle's view depth (billboard modes only,
        // manual).
        // ENGINE: which viewport dimension, and whether Horizontal / Vertical billboards are included, is native.
        if (cb.proj && (R.maxSize > 0 || R.minSize > 0)) {
          const P = cb.proj, depth = V.dot(V.sub(w, cb.pos), cb.fwd);
          const vh = P[15] === 0 ? 2 * depth / P[5] : 2 / P[5];
          const e = Math.max(Math.abs(sx) * scaleAlong(r2), Math.abs(sy) * scaleAlong(u2));
          if (e > 0 && vh > 0) {
            if (e > R.maxSize * vh) { const k = R.maxSize * vh / e; sx *= k; sy *= k; }
            else if (e < R.minSize * vh) { const k = R.minSize * vh / e; sx *= k; sy *= k; }
          }
        }
        const nn = fromWorld(n), nrm = V.norm(nn);
        const corners = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
        corners.forEach(([cx, cy, u, v], ci) => {
          const x = (cx * p.flip[0] + pv[0]) * sx, y = (cy * p.flip[1] + pv[1]) * sy, z = pv[2] * size[2];
          const off = fromWorld(V.add(V.add(V.scale(r2, x), V.scale(u2, y)), V.scale(n, -z)));
          this._vertex(verts, (base + ci) * L.stride, L, p, V.add(p.pos, off), nrm, [u, v], col, p.pos, ci);
        });
      } else {
        // mesh: vertex = position + orient(Rot3D((v + pivot) * size)); orient by render alignment
        const Rp = this.initial.rotation3D ? V.eulerCols(p.rot[0], p.rot[1], p.rot[2]) : V.eulerCols(0, 0, p.rot[2]);
        let orient = null, local = false;
        if (R.alignment === 1) orient = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        else if (R.alignment === 2) local = true;
        else if (R.alignment === 3) {
          const f = V.norm(V.sub(w, cb.pos)), rr = V.norm(V.cross(cb.up, f));
          orient = [rr, V.cross(f, rr), f];
        } else orient = [cb.right, cb.up, cb.fwd];                      // ENGINE: mesh particles with View alignment: mesh axes = camera axes
        const tr = (o) => (local ? fromLocal(o) : fromWorld(V.colsMul(orient, o)));
        for (let vi = 0; vi < nv; vi++) {
          const mv = mesh.vertices[vi], mn = mesh.normals ? mesh.normals[vi] : [0, 0, 1], uv = mesh.uv0 ? mesh.uv0[vi] : [0, 0];
          const o = V.colsMul(Rp, [(mv[0] * p.flip[0] + pv[0]) * size[0], (mv[1] * p.flip[1] + pv[1]) * size[1],
                                   ((mv[2] ?? 0) * p.flip[2] + pv[2]) * size[2]]);
          const nrm = V.norm(tr(V.colsMul(Rp, mn)));
          this._vertex(verts, (base + vi) * L.stride, L, p, V.add(p.pos, tr(o)), nrm, [uv[0], uv[1]], col, p.pos, vi);
        }
      }
    });
    const nTotal = ps.length * nv, Idx = nTotal > 65535 ? Uint32Array : Uint16Array;
    const subs = mesh ? mesh.submeshes : [[0, 1, 2, 0, 2, 3]];
    const parts = [];
    subs.forEach((sub, si) => {
      const mat = R.materials[si];              // ENGINE: submeshes beyond the material count are not drawn (MeshRenderer rule)
      if (!mat) return;
      const idx = new Idx(ps.length * sub.length);
      for (let pi = 0; pi < ps.length; pi++) for (let k = 0; k < sub.length; k++) idx[pi * sub.length + k] = pi * nv + sub[k];
      parts.push({ material: mat, mesh: { verts, stride: L.stride, attribs: L.attribs, idx } });
    });
    return { localToWorld: world ? mat4.identity() : fr.M, parts, particles: ps.length };
  }
};

// ------------------------------------------------------------------------------------------------ materials
// Entries of a renderer's m_Materials (exported: material, shader.shader, keywords, renderQueue, textures
// {name: {texture: desc | null, scale, offset}}, floats, ints, colors) drawn with the game's HLSLcc GLES3 programs
// through ShaderLib(gl, "<base>/shaders"), resolved as for the other live materials: shader
// property defaults under the material values, the keywords select the variant (pass 0 of subshader 0), render queue
// -1 -> the shader's Queue tag. Used by the particle renderers and by the effect SpriteRenderers (fx-effects.js).
// Uniform sheets per draw, highest priority first: the draw's sheet (MaterialPropertyBlock-like), ctx.perObject(M),
// the material, the shader defaults, ctx.globals (per camera), then FxMaterials.ENGINE (values no one sets).
// ENGINE: _TextureSampleAdd / _ClipRect / _UIMaskSoftnessX|Y are set by uGUI's CanvasRenderer only; 0 outside a canvas.
// (Only vs_TEXCOORD2 of MobileAddHdrColor reads _ClipRect, and no fragment uses it.)
// ENGINE: unity_GUIZTestMode (ZTest of UI/Additive and MobileAddHdrColor) comes from canvas rendering; LessEqual (4) here.
// ENGINE: the first subshader is taken as the one the GLES3 device runs.
// GPU instancing of mesh particles
// (m_EnableGPUInstancing) is not used: the shaders have no procedural-instancing variant, so Unity builds the vertices
// on the CPU as here.
export class FxMaterials {
  constructor(gl, base = "livenotes") {
    this.gl = gl;
    this.base = base;
    this.mats = new Map();
    this.lib = null;
    this.loaded = false;
    this.missed = new Set();          // materials drawn before their textures were ready (skipped draws)
    this._info = new Map();
    this._index = null;
    this._tex = new Map();
  }

  // parsed shader JSON through assets (works with gl = null when assets can read the packed files)
  shaderInfo(name) {
    if (!this._info.has(name)) {
      const assets = assetsOf(this.gl);
      if (!this._index) this._index = new Map(assets.json(`${this.base}/shaders/shaders.json`).map((r) => [r.name, r]));
      const rec = this._index.get(name);
      if (!rec) throw new FxError(`shader not packed: ${name}`);
      this._info.set(name, assets.json(`${this.base}/shaders/${rec.parsed}`));
    }
    return this._info.get(name);
  }

  // ShaderLab "Queue" tag -> render queue (Background 1000, Geometry 2000, AlphaTest 2450, GeometryLast 2500,
  // Transparent 3000, Overlay 4000, "+n" / "-n" offsets); no tag -> 2000.
  static queueFromTag(tag) {
    if (tag === undefined || tag === null || tag === "") return 2000;
    const m = /^\s*([A-Za-z]+|\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(String(tag));
    if (!m) throw new FxError(`queue tag ${tag}`);
    const names = { background: 1000, geometry: 2000, alphatest: 2450, geometrylast: 2500, transparent: 3000, overlay: 4000 };
    const b = /^\d+$/.test(m[1]) ? Number(m[1]) : names[m[1].toLowerCase()];
    if (b === undefined) throw new FxError(`queue tag ${tag}`);
    return b + (m[2] ? (m[2] === "+" ? 1 : -1) * Number(m[3]) : 0);
  }

  static shaderQueue(info) {
    const tags = (info.subShaders[0].tags && info.subShaders[0].tags.tags) || [];
    const q = tags.find(([k]) => String(k).toLowerCase() === "queue");
    return FxMaterials.queueFromTag(q ? q[1] : undefined);
  }

  get(record) {
    if (!record || !record.shader) throw new FxError("material record missing");
    const key = `${record.material}\u0000${record.shader.shader}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new FxMaterial(this, record);
      this.mats.set(key, m);
      if (this.loaded && this.gl) m._pending = m._load();
    }
    return m;
  }

  // compiles the programs and uploads the textures of every material registered so far (get() before load()); a
  // material first requested after load() loads asynchronously and its draws are skipped until ready (`missed`).
  async load() {
    this.loaded = true;
    const gl = this.gl;
    if (!gl) return;
    if (!this.lib) {
      this.lib = new ShaderLib(gl, join(this.base, "shaders"));
      this.solid = {
        white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
        gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
      };
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
    }
    for (const m of [...this.mats.values()]) await (m._pending || (m._pending = m._load()));
  }

  texture(desc) {
    if (!this._tex.has(desc.texture)) this._tex.set(desc.texture, GLTex.load(this.gl, this.base, desc));
    return this._tex.get(desc.texture);
  }
};

FxMaterials.ENGINE = { _TextureSampleAdd: [0, 0, 0, 0], _ClipRect: [0, 0, 0, 0], _UIMaskSoftnessX: 0, _UIMaskSoftnessY: 0 };
FxMaterials.ENGINE_STATE = { unity_GUIZTestMode: 4 };

export class FxMaterial {
  constructor(owner, record) {
    this.owner = owner;
    this.record = record;
    this.name = record.material;
    this.shader = record.shader.shader;
    this.keywords = record.keywords || [];
    this.ready = false;
    this._queue = undefined;
    this._pending = null;
  }

  get queue() {
    if (this._queue === undefined) {
      const rq = this.record.renderQueue;
      this._queue = rq >= 0 ? rq : FxMaterials.shaderQueue(this.owner.shaderInfo(this.shader));
    }
    return this._queue;
  }

  async _load() {
    const o = this.owner, lib = o.lib, rec = this.record;
    const defaults = lib.defaults(this.shader, o.solid);
    const nums = Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v === "number"));
    this.floats = { ...nums, ...(rec.ints || {}), ...(rec.floats || {}) };
    const sheet = { ...this.floats };
    for (const [k, c] of Object.entries(rec.colors || {})) sheet[k] = [c.r, c.g, c.b, c.a];
    for (const [k, t] of Object.entries(rec.textures || {})) {
      sheet[`${k}_ST`] = [t.scale.x, t.scale.y, t.offset.x, t.offset.y];
      if (t.texture) {
        const tex = await o.texture(t.texture);
        sheet[k] = tex;
        sheet[`${k}_TexelSize`] = [1 / tex.width, 1 / tex.height, tex.width, tex.height];
      }
    }
    this.sheet = sheet;
    this.defaults = defaults;
    this.program = lib.program(this.shader, 0, this.keywords);
    this.state = lib.state(this.shader, 0, { ...FxMaterials.ENGINE_STATE, ...this.floats });
    this.ready = true;
  }

  // One draw: mesh = {verts: Float32Array, stride (floats), attribs: {in_X: [components, offset (floats)]},
  // idx: Uint16Array | Uint32Array}; localToWorld -> unity_ObjectToWorld (through ctx.perObject); sheet = per-draw
  // properties. A program input the mesh lacks is an error, except in_COLOR0 (constant white).
  draw(ctx, mesh, localToWorld, sheet = {}) {
    const o = this.owner, gl = (ctx && ctx.gl) || o.gl;
    if (!gl) return;
    if (!this.ready) {
      if (!o.missed.has(this.name)) { o.missed.add(this.name); console.warn(`FxMaterials: ${this.name} drawn before load()`); }
      return;
    }
    const prog = this.program;
    const per = ctx.perObject ? ctx.perObject(localToWorld) : { unity_ObjectToWorld: localToWorld };
    prog.apply([sheet, per, this.sheet, this.defaults, ctx.globals, FxMaterials.ENGINE]);
    applyState(gl, this.state);
    gl.bindVertexArray(o.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STREAM_DRAW);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    const stride = mesh.stride * 4;
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      const a = mesh.attribs[name];
      if (a) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, a[0], gl.FLOAT, false, stride, a[1] * 4); }
      else if (name === "in_COLOR0") gl.vertexAttrib4f(loc, 1, 1, 1, 1);
      else throw new FxError(`${prog.label}: vertex input ${name} missing (mesh has ${Object.keys(mesh.attribs).join(" ")})`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, mesh.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
};

// ------------------------------------------------------------------------------------------------ intro lane-in stars
// A transform known only by its world matrix (host-driven nodes, e.g. the start timeline's): FxParticleSystem takes
// R from the normalised columns and S from the column lengths (_frame).
export class FxMatrixTransform {
  constructor(m = mat4.identity()) { this.m = Float32Array.from(m); }
  set(m) { this.m.set(m); }
  localToWorld() { return this.m; }
  worldPosition() { return { x: this.m[12], y: this.m[13], z: this.m[14] }; }
};

// The 7 `ef_particle_star` systems of the start timeline's LiveGameLaneInEffect
// (live_start_playable_timeline/root/LiveGameLaneInEffect/lines/lane_lineNN/star_icon/ef_particle_star,
// livescene/scene.json). The stage hands them over through
// stage.intro.stars() -> [{path, active (activeInHierarchy), localToWorld, components}] every frame.
//   new LiveIntroStars(gl, { materials /* FxMaterials(gl, "livescene") */, rng /* UnityRandom */ })
//   prepare(stars)       optional, before materials.load(): builds the systems so their material is loaded up front
//   update(stars, dt)    animation phase, after the timeline evaluation of the frame (Unity: PlayableDirector in
//                        DirectorUpdateAnimation, then ParticleSystemBeginUpdateAll): matrix, activation
//                        (playOnAwake via the clip's m_IsActive), simulate(dt)
//   submit(renderer)     renderer.submit("effect", item) for every system with particles (layer 29, LiveEffectCamera)
// sortingOrder: LiveParticleOrderInLayerSetter (_orderInLayer 60, _offset 2) -> GetOrderInLayer(60) + 2 = 6002 (the x100
// rule of LiveOrderInLayerUtility.GetOrderInLayer: 60 -> 6000, 41 -> 4100), equal to the serialized m_SortingOrder.
// An entry missing from a frame's list counts as inactive.
export class LiveIntroStars {
  constructor(gl, { materials = null, rng = null } = {}) {
    this.gl = gl;
    this.materials = materials;
    this.rng = rng || new UnityRandom(1);
    this.entries = new Map();          // path -> {ps, t}
  }

  _entry(s) {
    let e = this.entries.get(s.path);
    if (e) return e;
    const comp = (type) => s.components.find((c) => c.type === type) || null;
    const psc = comp("ParticleSystem");
    if (!psc) throw new FxError(`${s.path}: no ParticleSystem`);
    const t = new FxMatrixTransform(s.localToWorld);
    const ps = new FxParticleSystem(psc, comp("ParticleSystemRenderer"), t,
                                       { rng: this.rng, materials: this.materials, name: s.path });
    const order = s.components.find((c) => c.type === "MonoBehaviour" && c.class === "LiveParticleOrderInLayerSetter");
    if (order) ps.sortingOrder = order._orderInLayer * 100 + order._offset;
    if (ps.renderer && this.materials) for (const m of ps.renderer.materials) this.materials.get(m);
    e = { ps, t };
    this.entries.set(s.path, e);
    return e;
  }

  prepare(stars) { for (const s of stars) this._entry(s); }

  update(stars, dt) {
    const seen = new Set();
    for (const s of stars) {
      const e = this._entry(s);
      seen.add(s.path);
      e.t.set(s.localToWorld);
      e.ps.onActiveChanged(!!s.active);
      e.ps.simulate(dt);
    }
    for (const [path, e] of this.entries) if (!seen.has(path)) e.ps.onActiveChanged(false);
  }

  static cameraPosition(renderer) {
    const f = renderer && renderer.frames && renderer.frames.game;
    const m = f && (f.localToWorld || f.cameraToWorld);
    if (m) return [m[12], m[13], m[14]];
    const c = renderer && renderer.cameras && renderer.cameras.game;
    if (c && c.transform) { const p = c.transform.worldPosition(); return [p.x, p.y, p.z]; }
    return null;
  }

  submit(renderer) {
    const cam = LiveIntroStars.cameraPosition(renderer);
    for (const { ps } of this.entries.values()) {
      const it = ps.drawItem(cam);
      if (it) renderer.submit("effect", it);
    }
  }

  get systems() { return [...this.entries.values()].map((e) => e.ps); }
};
