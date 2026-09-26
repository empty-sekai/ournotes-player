import { F } from "../../engine/core.js";
import { UITween } from "../../engine/ugui.js";

// DOTween pieces the story features use beyond the loop's value tweens (engine/tween.js Tweens): DOTween.Shake
// (DOShakePosition) as the game's DOTween build compiles it. A tween joins the loop's DOTween runner
// (loop.tweens.active), so it is stepped in the "tweens" phase in creation order with every other tween.
//
// DOTween.Shake(getter, setter, duration, strength, vibrato, randomness, ignoreZAxis, vectorBased, fadeOut, Full):
//   magnitude = vectorBased ? |strength| : strength.x; n = (int)(vibrato x duration), at least 2 (2 when the product is
//   +Infinity); segment durations (i + 1) / n x duration (fadeOut) or duration / n, rescaled to sum to duration;
//   ang = Random.Range(0, 360); per segment but the last: ang += -180 + Random.Range(-r, r) (not for the first),
//   q = AngleAxis(Random.Range(-r, r), up) unless ignoreZAxis and not vectorBased, v = q x (m cos ang, m sin ang, 0);
//   vectorBased: v clamped per axis to the strength (ClampMagnitude on the running vector), normalised, x magnitude, then
//   magnitude -= decay and strength = ClampMagnitude(strength, magnitude); else magnitude -= decay; the last waypoint 0.
//   SetSpecialStartupMode(SetShake): at startup the waypoints are offset by the getter's value (SpecialPluginsUtils.SetPunch)
//   and the ease is Linear; Vector3ArrayPlugin walks the segments (value = segment start + ease x segment change).
// ENGINE: UnityEngine.Random is the engine's global stream; `random` is the session's UnityRandom (engine/random.js).
// ENGINE: Quaternion.AngleAxis is native: (axis sin(a / 2), cos(a / 2)).

const DEG2RAD = F(0.017453292);

// UnityEngine.Quaternion * Vector3
export const quatRotate = (q, p) => {
  const x2 = F(q.x * 2), y2 = F(q.y * 2), z2 = F(q.z * 2);
  const xx = F(q.x * x2), yy = F(q.y * y2), zz = F(q.z * z2), xy = F(q.x * y2), xz = F(q.x * z2), yz = F(q.y * z2);
  const wx = F(q.w * x2), wy = F(q.w * y2), wz = F(q.w * z2);
  return {
    x: F(F(F(F(1 - F(yy + zz)) * p.x) + F(F(xy - wz) * p.y)) + F(F(xz + wy) * p.z)),
    y: F(F(F(F(xy + wz) * p.x) + F(F(1 - F(xx + zz)) * p.y)) + F(F(yz - wx) * p.z)),
    z: F(F(F(F(xz - wy) * p.x) + F(F(yz + wx) * p.y)) + F(F(1 - F(xx + yy)) * p.z)),
  };
};

const angleAxisUp = (deg) => {
  const h = F(F(deg * DEG2RAD) * 0.5);
  return { x: 0, y: F(Math.sin(h)), z: 0, w: F(Math.cos(h)) };
};

const len = (v) => F(Math.sqrt(F(F(F(v.x * v.x) + F(v.y * v.y)) + F(v.z * v.z))));

// Vector3.ClampMagnitude
const clampMagnitude = (v, max) => {
  const sq = F(F(F(v.x * v.x) + F(v.y * v.y)) + F(v.z * v.z));
  if (sq <= F(max * max)) return { ...v };
  const m = F(Math.sqrt(sq));
  return { x: F(max * F(v.x / m)), y: F(max * F(v.y / m)), z: F(max * F(v.z / m)) };
};

// the waypoints and segment durations of DOTween.Shake: randomness mode Full (Random.Range(-randomness, randomness))
// or Harmonic (Random.Range(0, randomness)) for the angle step and the rotation about up
export const shakeWaypoints = (duration, strength, vibrato, randomness, ignoreZAxis, vectorBased, fadeOut, random, harmonic = false) => {
  let str = { ...strength };
  let magnitude = vectorBased ? len(str) : str.x;
  const prod = F(vibrato * duration);
  let n = Math.trunc(prod);
  if (n < 2) n = 2;
  if (prod === Infinity) n = 2;
  const decay = fadeOut ? F(magnitude / n) : 0;
  const durations = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = fadeOut ? F(F((i + 1) / n) * duration) : F(duration / n);
    sum = F(sum + d); durations.push(d);
  }
  const k = F(duration / sum);
  for (let i = 0; i < n; i++) durations[i] = F(k * durations[i]);
  let ang = random.range(0, 360);
  const ends = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1) { ends.push({ x: 0, y: 0, z: 0 }); break; }
    let q = { x: 0, y: 0, z: 0, w: 1 };
    const lo = harmonic ? 0 : -randomness;                           // Harmonic: Random.Range(0, randomness)
    if (i > 0) ang = F(F(ang - 180) + random.range(lo, randomness));
    if (!ignoreZAxis || vectorBased) q = angleAxisUp(random.range(lo, randomness));
    const a = F(ang * DEG2RAD);
    let v = quatRotate(q, { x: F(magnitude * F(Math.cos(a))), y: F(magnitude * F(Math.sin(a))), z: 0 });
    if (vectorBased) {
      v.x = clampMagnitude(v, str.x).x;
      v.y = clampMagnitude(v, str.y).y;
      v.z = clampMagnitude(v, str.z).z;
      const m = len(v);
      v = m > 1e-5 ? { x: F(F(v.x / m) * magnitude), y: F(F(v.y / m) * magnitude), z: F(F(v.z / m) * magnitude) }
        : { x: 0, y: 0, z: 0 };
      magnitude = F(magnitude - decay);
      str = clampMagnitude(str, magnitude);
    } else magnitude = F(magnitude - decay);
    ends.push(v);
  }
  return { ends, durations };
};

// A Vector3 array tween with SetShake startup: runner = the loop's Tweens; get() / set(v) on {x, y, z};
// onUpdate() after each applied value (TweenSettingsExtensions.OnUpdate).
export class ShakeTween {
  constructor(runner, { ends, durations }, get, set, onUpdate = null) {
    this.runner = runner;
    this.ends = ends; this.durations = durations;
    let total = 0;
    for (const d of durations) total = F(total + d);
    this.duration = total;
    this.get = get; this.set = set; this.onUpdate = onUpdate;
    this.position = 0; this.started = false; this.done = false;
    this.promise = new Promise((res) => { this._resolve = res; });
    runner.active.add(this);
  }

  // SpecialPluginsUtils.SetShake: waypoints += the value at startup; segment starts / changes (Vector3ArrayPlugin)
  _startup() {
    this.started = true;
    const v = this.get();
    this.ends = this.ends.map((e) => ({ x: F(e.x + v.x), y: F(e.y + v.y), z: F(e.z + v.z) }));
    this.starts = this.ends.map((e, i) => (i === 0 ? { ...v } : { ...this.ends[i - 1] }));
    this.changes = this.ends.map((e, i) => ({ x: F(e.x - this.starts[i].x), y: F(e.y - this.starts[i].y),
                                              z: F(e.z - this.starts[i].z) }));
  }

  // Vector3ArrayPlugin.EvaluateAndApply, Linear ease
  _apply(elapsed) {
    let count = 0, segElapsed = 0, idx = this.durations.length - 1, segDur = this.durations[idx];
    for (let i = 0; i < this.durations.length; i++) {
      segDur = this.durations[i]; count = F(count + segDur);
      if (elapsed <= count) { segElapsed = F(elapsed - segElapsed); idx = i; break; }
      segElapsed = F(segElapsed + segDur);
    }
    const e = segDur > 0 ? F(segElapsed / segDur) : 1, s = this.starts[idx], c = this.changes[idx];
    this.set({ x: F(s.x + F(e * c.x)), y: F(s.y + F(e * c.y)), z: F(s.z + F(e * c.z)) });
  }

  step(dt) {
    if (this.done) return;
    if (!this.started) this._startup();
    this.position = F(this.position + F(dt));
    const complete = this.position >= this.duration;
    if (complete) this.position = this.duration;
    this._apply(this.position);
    if (this.onUpdate) this.onUpdate();
    if (complete) this.finish(true);
  }

  finish(completed) {
    if (this.done) return;
    this.done = true;
    this.runner.active.delete(this);
    this._resolve(completed);
  }

  kill() { this.finish(false); }
}

// ShortcutExtensions.DOShakePosition: null (no tween) for duration <= 0. strength: a number (float overload:
// (s, s, s), vectorBased false, ignoreZAxis false) or {x, y, z} (Vector3 overload: vectorBased true).
export const doShakePosition = (runner, random, get, set, duration, strength, vibrato = 10, randomness = 90,
                                fadeOut = true, onUpdate = null) => {
  if (!(duration > 0)) return null;
  const vector = typeof strength !== "number";
  const s = vector ? strength : { x: strength, y: strength, z: strength };
  const wp = shakeWaypoints(F(duration), s, vibrato, randomness, false, vector, fadeOut, random);
  return new ShakeTween(runner, wp, get, set, onUpdate);
};

// DOTween.To(getter, setter, end, duration) and the module shortcuts built on it (CanvasGroup.DOFade, Image.DOFade,
// Graphic.DOColor), awaited with UniTask's ToUniTask(TweenCancelBehaviour.KillAndCancelAwait): the await ends when the
// tween is killed, by completing (autoKill) or by DOKill. A UITween (engine/ugui.js: float32 position, start value read
// at the first update, DOTween ease; default ease OutQuad from the game's DOTweenSettings) in the loop's DOTween runner.
// onKill(completed) runs synchronously at the kill, as UniTask continues the awaiting method inside the Kill callback.
// ENGINE: DOTween and UniTask are library code; their documented behaviour as used by the game.
export class DOFloat {
  constructor(runner, get, set, end, duration, { ease = 6, onKill = null } = {}) {
    this.onKill = onKill;
    this.tween = new UITween(runner, { duration, getFrom: get, to: end, ease, apply: set,
                                       onComplete: () => this._killed(true) });
    this.promise = this.tween.promise;
  }

  get isActive() { return !this.tween.done; }

  _killed(completed) {
    const f = this.onKill;
    this.onKill = null;
    if (f) f(completed);
  }

  // Tween.Kill(complete: false)
  kill() {
    if (this.tween.done) return;
    this.tween.kill();
    this._killed(false);
  }
}

// DOTween targets: DOKill(target) kills every tween registered on the target (ShortcutExtensions.DOKill)
export class DOTargets {
  constructor() { this.byTarget = new Map(); }

  add(target, t) {
    let s = this.byTarget.get(target);
    if (!s) { s = new Set(); this.byTarget.set(target, s); }
    s.add(t);
    t.promise.then(() => { s.delete(t); });
    return t;
  }

  kill(target) {
    const s = this.byTarget.get(target);
    if (!s) return 0;
    const ts = [...s];
    s.clear();
    for (const t of ts) t.kill();
    return ts.length;
  }

  killAll() { for (const k of [...this.byTarget.keys()]) this.kill(k); }
}
