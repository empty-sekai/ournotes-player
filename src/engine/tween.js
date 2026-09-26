
export let EASE_K;
export let bounceEaseOut;
export let elasticShift;

// DOTween-compatible easing (ease), the Ease name parser (tryGetEase) and a frame-driven tween runner (Tweens).
//
// Ease ids follow DG.Tweening.Ease (0 Unset, 1 Linear, 2 InSine ... 37 INTERNAL_Custom).
// Formulas are DOTween's EaseManager.Evaluate (Bounce.EaseOut, Bounce.EaseInOut).
// Its `default` branch is OutQuad and also serves Unset (0). The Flash eases (32-35) are not implemented
// and raise; INTERNAL_Custom (37) has no custom function after SetEase(Ease) and raises (the game throws there too).
// Overshoot / amplitude and period are the tween's values: DOTweenSettings defaults 1.70158 and 0.
// easeF is the same function in the float32 arithmetic of the game's build (EaseManager.Evaluate as compiled); the
// tweens (Tween, FloatTween) run on it with DOTween's float32 position and plugin arithmetic.

export const EASE = { Unset: 0, Linear: 1, InSine: 2, OutSine: 3, InOutSine: 4, InQuad: 5, OutQuad: 6, InOutQuad: 7,
            InCubic: 8, OutCubic: 9, InOutCubic: 10, InQuart: 11, OutQuart: 12, InOutQuart: 13, InQuint: 14,
            OutQuint: 15, InOutQuint: 16, InExpo: 17, OutExpo: 18, InOutExpo: 19, InCirc: 20, OutCirc: 21,
            InOutCirc: 22, InElastic: 23, OutElastic: 24, InOutElastic: 25, InBack: 26, OutBack: 27, InOutBack: 28,
            InBounce: 29, OutBounce: 30, InOutBounce: 31, Flash: 32, InFlash: 33, OutFlash: 34, InOutFlash: 35,
            INTERNAL_Zero: 36, INTERNAL_Custom: 37 };

// float literals of the DOTween code
export const EASE_DEFAULT_OVERSHOOT = Math.fround(1.70158);
export const EASE_DEFAULT_PERIOD = 0;
{
  const f = Math.fround, K = EASE_K = {
    twoPi: f(6.2831855), p03: f(0.3), p045: f(f(0.3) * f(1.5)), back: f(1.525),
    b1: f(1 / f(2.75)), b2: f(2 / f(2.75)), b3: f(f(2.5) / f(2.75)),
    c1: f(f(1.5) / f(2.75)), c2: f(f(2.25) / f(2.75)), c3: f(f(2.625) / f(2.75)),
  };
  // DG.Tweening.Core.Easing.Bounce.EaseOut
  bounceEaseOut = (time, duration) => {
    const t = time / duration;
    if (t < K.b1) return 7.5625 * t * t;
    if (t < K.b2) return 7.5625 * (t - K.c1) * (t - K.c1) + 0.75;
    if (t < K.b3) return 7.5625 * (t - K.c2) * (t - K.c2) + 0.9375;
    return 7.5625 * (t - K.c3) * (t - K.c3) + 0.984375;
  };
  // elastic phase shift: an amplitude below 1 is replaced by 1 with s = p / 4
  elasticShift = (a, p) => (a >= 1 ? { a, s: p / K.twoPi * Math.asin(1 / a) } : { a: 1, s: p * 0.25 });
}

export const ease = (id, time, duration, overshoot = EASE_DEFAULT_OVERSHOOT, period = EASE_DEFAULT_PERIOD) => {
  const H = Math.PI / 2, K = EASE_K;
  let t = time;
  switch (id) {
    case 1: return t / duration;
    case 2: return -Math.cos(t / duration * H) + 1;
    case 3: return Math.sin(t / duration * H);
    case 4: return -0.5 * (Math.cos(Math.PI * t / duration) - 1);
    case 5: t /= duration; return t * t;
    case 6: t /= duration; return -t * (t - 2);
    case 7: t /= duration * 0.5; if (t < 1) return 0.5 * t * t; t--; return -0.5 * (t * (t - 2) - 1);
    case 8: t /= duration; return t * t * t;
    case 9: t = t / duration - 1; return t * t * t + 1;
    case 10: t /= duration * 0.5; if (t < 1) return 0.5 * t * t * t; t -= 2; return 0.5 * (t * t * t + 2);
    case 11: t /= duration; return t * t * t * t;
    case 12: t = t / duration - 1; return -(t * t * t * t - 1);
    case 13: t /= duration * 0.5; if (t < 1) return 0.5 * t * t * t * t; t -= 2; return -0.5 * (t * t * t * t - 2);
    case 14: t /= duration; return t * t * t * t * t;
    case 15: t = t / duration - 1; return t * t * t * t * t + 1;
    case 16: t /= duration * 0.5; if (t < 1) return 0.5 * t * t * t * t * t; t -= 2; return 0.5 * (t * t * t * t * t + 2);
    case 17: return t === 0 ? 0 : Math.pow(2, 10 * (t / duration - 1));
    case 18: return t === duration ? 1 : -Math.pow(2, -10 * t / duration) + 1;
    case 19:
      if (t === 0) return 0;
      if (t === duration) return 1;
      t /= duration * 0.5;
      if (t < 1) return 0.5 * Math.pow(2, 10 * (t - 1));
      t--; return 0.5 * (-Math.pow(2, -10 * t) + 2);
    case 20: t /= duration; return -(Math.sqrt(1 - t * t) - 1);
    case 21: t = t / duration - 1; return Math.sqrt(1 - t * t);
    case 22: t /= duration * 0.5; if (t < 1) return -0.5 * (Math.sqrt(1 - t * t) - 1); t -= 2;
      return 0.5 * (Math.sqrt(1 - t * t) + 1);
    case 23: {
      if (time === 0) return 0;
      if (time / duration === 1) return 1;
      const p = period !== 0 ? period : duration * K.p03, e = elasticShift(overshoot, p);
      t = time / duration - 1;
      return -(e.a * Math.pow(2, 10 * t) * Math.sin((t * duration - e.s) * K.twoPi / p));
    }
    case 24: {
      if (time === 0) return 0;
      t = time / duration;
      if (t === 1) return 1;
      const p = period !== 0 ? period : duration * K.p03, e = elasticShift(overshoot, p);
      return e.a * Math.pow(2, -10 * t) * Math.sin((t * duration - e.s) * K.twoPi / p) + 1;
    }
    case 25: {
      if (time === 0) return 0;
      t = time / (duration * 0.5);
      if (t === 2) return 1;
      const p = period !== 0 ? period : duration * K.p045, e = elasticShift(overshoot, p);
      const u = t - 1;
      if (t < 1) return -0.5 * (e.a * Math.pow(2, 10 * u) * Math.sin((u * duration - e.s) * K.twoPi / p));
      return e.a * Math.pow(2, -10 * u) * Math.sin((u * duration - e.s) * K.twoPi / p) * 0.5 + 1;
    }
    case 26: t /= duration; return t * t * ((overshoot + 1) * t - overshoot);
    case 27: t = t / duration - 1; return t * t * ((overshoot + 1) * t + overshoot) + 1;
    case 28: {
      const s = overshoot * K.back;
      t /= duration * 0.5;
      if (t < 1) return 0.5 * (t * t * ((s + 1) * t - s));
      t -= 2; return 0.5 * (t * t * ((s + 1) * t + s) + 2);
    }
    case 29: return 1 - bounceEaseOut(duration - time, duration);
    case 30: return bounceEaseOut(time, duration);
    case 31:
      if (time < duration * 0.5) return (1 - bounceEaseOut(duration - time * 2, duration)) * 0.5;
      return bounceEaseOut(time * 2 - duration, duration) * 0.5 + 0.5;
    case 32: case 33: case 34: case 35: throw new Error(`ease ${id} (Flash) not implemented`);
    case 36: return 1;                                          // INTERNAL_Zero
    case 37: throw new Error("ease 37 (INTERNAL_Custom) has no custom ease function");
    default: t /= duration; return -t * (t - 2);               // OutQuad: 0 Unset and any other value
  }
};

// System.String.Trim(): the Char.IsWhiteSpace characters, removed at both ends
export const NET_WS = "\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000";
const NET_TRIM = new RegExp(`^[${NET_WS}]+|[${NET_WS}]+$`, "g");
export const netTrim = (s) => s.replace(NET_TRIM, "");

// AdvEaseHelper.TryGetEase: Enum.TryParse<Ease>(s, out e) (ignoreCase false) && Enum.IsDefined(Ease, e); the Ease id,
// or null when the string is not an Ease. Enum.TryParseEnum trims the string; a leading digit / '-' / '+' converts it
// as an Int32 (invariant culture), anything else is split at ',' and every trimmed part must equal a name exactly
// (ordinal, case-sensitive), the parts' values ORed.
export const tryGetEase = (s) => {
  if (s === undefined || s === null) return null;
  const t = netTrim(String(s));
  if (t === "") return null;
  let v;
  if (/^[+-]?[0-9]+$/.test(t)) {                           // Int32.Parse(NumberStyles.Integer, invariant)
    const n = Number(t);
    if (n < -2147483648 || n > 2147483647) return null;     // OverflowException
    v = n;
  } else {
    v = 0;
    for (const part of t.split(",")) {
      const name = netTrim(part);
      if (!Object.prototype.hasOwnProperty.call(EASE, name)) return null;
      v |= EASE[name];
    }
  }
  return v >= 0 && v <= 37 ? v : null;                     // Enum.IsDefined
};

// A DOTween tween (DOTween.To(getter, setter, end, duration).SetEase(ease)) in the game's float32 arithmetic: FloatPlugin
// for a number, the Vector2 / Vector3 / Vector4 / Color plugins (component-wise) for an object of numbers. The start
// value is read at the first update (Tweener.DoStartup) and change = end - start (SetChangeValue); each update the
// position advances by the frame's delta time in float32 and the setter gets start + change x ease(position,
// duration); the update that reaches the duration clamps the position to it and completes (the value applied there is
// start + change x ease(duration, duration), as DOTween computes it, not the end value).
export class Tween {
  constructor(runner, from, to, duration, ease, apply) {
    this.runner = runner;
    this.from = from; this.to = to;
    this.duration = Math.fround(duration); this.ease = ease; this.apply = apply;
    this.elapsed = 0;
    this.position = 0;
    this.start = null;
    this.change = null;
    this.done = false;
    this.promise = new Promise((res) => { this._resolve = res; });
  }

  // Tweener.DoStartup: the getter (a lazy start value), then SetChangeValue
  _startup() {
    const f = Math.fround;
    if (typeof this.from === "function") this.from = this.from();
    const s = this.from, e = this.to;
    if (typeof s === "number") { this.start = f(s); this.change = f(f(e) - this.start); return; }
    this.start = {}; this.change = {};
    for (const c of Object.keys(s)) { this.start[c] = f(s[c]); this.change[c] = f(f(e[c]) - this.start[c]); }
  }

  // the plugin's EvaluateAndApply value at the current position
  value() {
    const f = Math.fround, k = easeF(this.ease, this.position, this.duration), s = this.start, c = this.change;
    return typeof s === "number" ? f(s + f(c * k))
      : Object.fromEntries(Object.keys(s).map((n) => [n, f(s[n] + f(c[n] * k))]));
  }

  step(dt) {
    if (this.start === null) this._startup();
    let p = Math.fround(this.position + Math.fround(dt));
    const end = this.duration <= p;
    if (end) p = this.duration;
    this.position = p;
    this.elapsed = p;
    this.apply(this.value());
    if (end) this.finish(true);
  }

  finish(completed) {
    if (this.done) return;
    this.done = true;
    this.runner.active.delete(this);
    this._resolve(completed);
  }

  kill() { this.finish(false); }
};

export class Tweens {
  constructor() { this.active = new Set(); }

  // DOTween.To(getter, setter, end, duration).SetEase(ease); duration <= 0 applies the end value and completes at once
  // (the callers' shortcut for no tween; toFloat runs a zero-duration DOTween tween). `from` is the start value, or a
  // function returning it at the tween's first update (DOTween reads the getter at startup)
  to(from, to, duration, ease, apply) {
    const t = new Tween(this, from, to, duration, ease, apply);
    if (duration <= 0) { apply(to); t.finish(true); return t; }
    this.active.add(t);
    return t;
  }

  // DOTween.To on a float getter / setter (FloatPlugin), a duration <= 0 included: run from the next update
  toFloat(from, to, duration, ease, apply) {
    const t = new FloatTween(this, from, to, duration, ease, apply);
    this.active.add(t);
    return t;
  }

  update(dt) { for (const t of [...this.active]) t.step(dt); }
};

// DG.Tweening.Core.Easing.EaseManager.Evaluate in float32 as the game's build computes it (the cosine, sine, power
// and arcsine in double on float arguments, every other step in float32)
export const easeF = (id, time, duration, overshoot = EASE_DEFAULT_OVERSHOOT, period = EASE_DEFAULT_PERIOD) => {
  const f = Math.fround, t = f(time), d = f(duration), a0 = f(overshoot), per = f(period);
  const PI = f(3.1415927), HALF_PI = f(1.5707964), TWO_PI = f(6.2831855);
  const r = () => f(t / d), h = () => f(t / f(d * 0.5));
  const bounceOut = (x, dd) => {                            // Bounce.EaseOut
    const u = f(x / dd);
    if (u < f(0.36363637)) return f(f(u * u) * 7.5625);
    let c, k;
    if (f(0.72727275) <= u) {
      if (f(0.90909094) <= u) { c = f(0.95454544); k = 0.984375; } else { c = f(0.8181818); k = 0.9375; }
    } else { c = f(0.54545456); k = 0.75; }
    const v = f(u - c);
    return f(f(f(v * v) * 7.5625) + k);
  };
  const elastic = (dd, p0) => {                             // the period and phase shift of the elastic eases
    const p = per !== 0 ? per : p0;
    if (1 <= a0) return { a: a0, p, s: f(f(p / TWO_PI) * f(Math.asin(f(1 / a0)))) };
    return { a: 1, p, s: f(p * 0.25) };
  };
  switch (id) {
    case 1: return r();
    case 2: return f(1 - f(Math.cos(f(r() * HALF_PI))));
    case 3: return f(Math.sin(f(r() * HALF_PI)));
    case 4: return f(f(f(Math.cos(f(f(t * PI) / d))) + -1) * -0.5);
    case 5: { const u = r(); return f(u * u); }
    case 7: {
      const u = h();
      if (u < 1) return f(u * f(u * 0.5));
      const v = f(u + -1);
      return f(f(f(v * f(v + -2)) + -1) * -0.5);
    }
    case 8: { const u = r(); return f(u * f(u * u)); }
    case 9: { const u = f(r() + -1); return f(f(u * f(u * u)) + 1); }
    case 10: {
      const u = h();
      if (u < 1) return f(u * f(f(u * u) * 0.5));
      const v = f(u + -2);
      return f(f(f(v * f(v * v)) + 2) * 0.5);
    }
    case 11: { const u = r(); return f(u * f(u * f(u * u))); }
    case 12: { const u = f(r() + -1); return f(-f(f(f(f(u * u) * u) * u) + -1)); }
    case 13: {
      const u = h();
      if (1 <= u) { const v = f(u + -2); return f(f(f(v * f(f(v * v) * v)) + -2) * -0.5); }
      return f(u * f(u * f(u * f(u * 0.5))));
    }
    case 14: { const u = r(); return f(u * f(u * f(u * f(u * u)))); }
    case 15: { const u = f(r() + -1); return f(f(u * f(f(f(u * u) * u) * u)) + 1); }
    case 16: {
      const u = h();
      if (1 <= u) { const v = f(u + -2); return f(f(f(v * f(f(f(v * v) * v) * v)) + 2) * 0.5); }
      return f(u * f(f(u * u) * f(f(u * u) * 0.5)));
    }
    case 17: if (t === 0) return 0; return f(Math.pow(2, f(f(r() + -1) * 10)));
    case 18: if (t === d) return 1; return f(1 - f(Math.pow(2, f(f(t * -10) / d))));
    case 19: {
      if (t === 0) return 0;
      if (t === d) return 1;
      const u = h();
      const v = 1 <= u ? f(2 - f(Math.pow(2, f(f(u + -1) * -10)))) : f(Math.pow(2, f(f(u + -1) * 10)));
      return f(v * 0.5);
    }
    case 20: { const u = r(); return f(-f(f(Math.sqrt(f(1 - f(u * u)))) + -1)); }
    case 21: { const u = f(r() + -1); return f(Math.sqrt(f(1 - f(u * u)))); }
    case 22: {
      const u = h();
      if (1 <= u) { const v = f(u + -2); return f(f(f(Math.sqrt(f(1 - f(v * v)))) + 1) * 0.5); }
      return f(f(f(Math.sqrt(f(1 - f(u * u)))) + -1) * -0.5);
    }
    case 23: {
      if (t === 0) return 0;
      if (r() === 1) return 1;
      const e = elastic(d, f(d * f(0.3)));
      const u = f(r() + -1);
      const pw = f(Math.pow(2, f(u * 10)));
      const sn = f(Math.sin(f(f(f(f(u * d) - e.s) * -TWO_PI) / e.p)));
      return f(f(e.a * pw) * sn);
    }
    case 24: {
      if (t === 0) return 0;
      const u = r();
      if (u === 1) return 1;
      const e = elastic(d, f(d * f(0.3)));
      const pw = f(Math.pow(2, f(u * -10)));
      const sn = f(Math.sin(f(f(f(f(u * d) - e.s) * TWO_PI) / e.p)));
      return f(f(f(e.a * pw) * sn) + 1);
    }
    case 25: {
      if (t === 0) return 0;
      const u = h();
      if (u === 2) return 1;
      const e = elastic(d, f(d * f(0.45000002)));
      const v = f(u + -1);
      const pw = f(Math.pow(2, f(v * (1 <= u ? -10 : 10))));
      const sn = f(Math.sin(f(f(f(f(v * d) - e.s) * TWO_PI) / e.p)));
      const w = f(f(e.a * pw) * sn);
      return 1 <= u ? f(f(w * 0.5) + 1) : f(w * -0.5);
    }
    case 26: { const u = r(); return f(f(u * u) * f(f(u * f(a0 + 1)) - a0)); }
    case 27: { const u = f(r() + -1); return f(f(f(u * u) * f(f(f(a0 + 1) * u) + a0)) + 1); }
    case 28: {
      const s = f(a0 * f(1.525)), u = h();
      if (1 <= u) { const v = f(u + -2); return f(f(f(f(v * v) * f(s + f(f(s + 1) * v))) + 2) * 0.5); }
      return f(f(f(u * u) * f(f(u * f(s + 1)) - s)) * 0.5);
    }
    case 29: return f(1 - bounceOut(f(d - t), d));
    case 30: return bounceOut(t, d);
    case 31: {
      const t2 = f(t + t);
      if (f(d * 0.5) <= t) return f(f(bounceOut(f(t2 - d), d) * 0.5) + 0.5);
      return f(f(1 - bounceOut(f(d - t2), d)) * 0.5);
    }
    case 32: case 33: case 34: case 35: throw new Error(`ease ${id} (Flash) not implemented`);
    case 36: return 1;
    case 37: throw new Error("ease 37 (INTERNAL_Custom) has no custom ease function");
    default: { const u = r(); return f(-f(u * f(u + -2))); }   // OutQuad: 0 Unset and any other value
  }
};

// A DOTween float tween (TweenerCore<float, float, FloatOptions> with FloatPlugin) that also runs a duration <= 0 as
// DOTween does: completed at the first update with the ease INTERNAL_Zero (start + change).
export class FloatTween extends Tween {
  step(dt) {
    if (0 < this.duration) { super.step(dt); return; }
    if (this.start === null) this._startup();
    this.apply(Math.fround(this.start + this.change));
    this.finish(true);
  }
}
