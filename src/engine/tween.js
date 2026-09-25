
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

export class Tween {
  constructor(runner, from, to, duration, ease, apply) {
    this.runner = runner;
    this.from = from; this.to = to;
    this.duration = duration; this.ease = ease; this.apply = apply;
    this.elapsed = 0;
    this.done = false;
    this.promise = new Promise((res) => { this._resolve = res; });
  }

  value(k) {
    const e = ease(this.ease, Math.min(this.elapsed, this.duration), this.duration);
    return typeof this.from === "number"
      ? this.from + (this.to - this.from) * e
      : Object.fromEntries(Object.keys(this.from).map((c) => [c, this.from[c] + (this.to[c] - this.from[c]) * e]));
  }

  step(dt) {
    if (typeof this.from === "function") this.from = this.from();   // a lazy start value: read at the first update
    this.elapsed += dt;
    if (this.elapsed >= this.duration) { this.apply(this.to); this.finish(true); }
    else this.apply(this.value());
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

  // DOTween.To(getter, setter, end, duration).SetEase(ease); duration <= 0 completes at once. `from` is the start
  // value, or a function returning it at the tween's first update (DOTween reads the getter at startup)
  to(from, to, duration, ease, apply) {
    const t = new Tween(this, from, to, duration, ease, apply);
    if (duration <= 0) { apply(to); t.finish(true); return t; }
    this.active.add(t);
    return t;
  }

  update(dt) { for (const t of [...this.active]) t.step(dt); }
};
