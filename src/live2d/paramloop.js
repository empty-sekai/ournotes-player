import { F } from "../engine/core.js";
import { easeSine, hermite } from "./math.js";

// Live2DAnimation.Live2DParameterLoopController (update chain execution order 350): a "misc_" fade motion of the
// model's CubismFadeMotionList played in a loop on top of the other motions. Its curves are evaluated at a phase
// time that wraps at the motion length and blended from each parameter's default value by a weight that fades in
// and out (CubismFadeMath.GetEasingSine). The time advances in Live2DCharacter.OnUpdate (deltaTime x motion speed).
//
// The managed math is float32 without FMA; F (Math.fround) is applied in source order.

const MISC_PREFIX = "misc_";
const clamp01 = (x) => (0 <= x ? (x <= 1 ? x : 1) : 0);        // Mathf.Clamp01 as compiled (NaN -> 0)

export class Live2DParameterLoopController {
  // fadeMotions: CubismFadeMotionList.CubismFadeMotionObjects of the prefab; params: Live2DParameters;
  // store: the model's Live2DParameterStore (CubismParameterStore)
  constructor(fadeMotions, params, store) {
    this.fadeMotions = fadeMotions || [];
    this.params = params;
    this.store = store;
    this.current = null;            // _currentMotion: {motion, curves}
    this.targets = null;            // _targetParameters: parameter index per ParameterIds entry, -1 when missing
    this.phaseTime = 0;             // _phaseTime
    this.weight = 0;                // _currentWeight
    this.fadeStart = 0;             // _fadeStartWeight
    this.fadeTarget = 0;            // _fadeTargetWeight
    this.fadeElapsed = 0;           // _fadeElapsedTime
    this.fadeDuration = 0;          // _fadeDuration
    this.stopping = false;          // _isStopping
    this.warnings = [];             // the Debug.LogWarning messages of Play
  }

  get isPlaying() { return this.current !== null; }
  get motionName() { return this.current ? this.current.name : null; }

  // FindFadeMotion: the fade motion whose object name without ".fade" equals the name (ordinal)
  _find(name) {
    if (!name) return null;
    for (const m of this.fadeMotions) {
      if (!m) continue;
      const n = m.m_Name ?? m.name;
      if (n !== undefined && n !== null && n.split(".fade").join("") === name) return m;
    }
    return null;
  }

  // HasValidCurves: ids and curves present, as many curves as ids, none null
  static _validCurves(m) {
    const ids = m.ParameterIds, cs = m.ParameterCurves;
    if (!ids || !cs || ids.length === 0 || ids.length !== cs.length) return false;
    return cs.every((c) => c !== null && c !== undefined);
  }

  _warn(msg) { this.warnings.push(msg); }

  // Play(motionName, fadeInTime)
  play(name, fadeInTime) {
    if (!name || !name.startsWith(MISC_PREFIX)) { this._warn(`only loop motions (${MISC_PREFIX}) can play: ${name}`); return; }
    const m = this._find(name);
    if (!m) { this._warn(`loop motion not found: ${name}`); return; }
    if (m.MotionLength <= 0) { this._warn(`loop motion has no length: ${name}`); return; }
    if (!Live2DParameterLoopController._validCurves(m)) { this._warn(`loop motion has invalid curves: ${name}`); return; }
    const P = this.params;
    const targets = m.ParameterIds.map((id) => {
      if (P.index.has(id)) return P.idx(id);
      this._warn(`loop motion ${name}: parameter ${id} not in model`);
      return -1;
    });
    this._restoreTargetsToDefault();
    this.current = { name, motion: m, length: m.MotionLength, curves: m.ParameterCurves.map((c) => c.m_Curve) };
    this.targets = targets;
    this.phaseTime = 0;
    this.stopping = false;
    this.fadeStart = this.weight;
    this.fadeTarget = 1;
    this.fadeElapsed = 0;
    this.fadeDuration = fadeInTime;
    if (!(0 < fadeInTime)) this.weight = 1;
  }

  // Stop(fadeOutTime)
  stop(fadeOutTime) {
    if (!this.current) return;
    if (fadeOutTime <= 0) { this.stopImmediately(); return; }
    this.stopping = true;
    this.fadeStart = this.weight;
    this.fadeTarget = 0;
    this.fadeElapsed = 0;
    this.fadeDuration = fadeOutTime;
  }

  // StopImmediately
  stopImmediately() {
    if (!this.current) return;
    this._restoreTargetsToDefault();
    this.current = null;
    this.targets = null;
    this.phaseTime = 0;
    this.weight = 0;
    this.stopping = false;
  }

  // RestoreTargetParametersToDefault: the store's values back, the targets at their defaults, the store saved again
  _restoreTargetsToDefault() {
    if (!this.targets) return;
    this.store.restore();
    const P = this.params;
    for (const i of this.targets) if (i >= 0) P.override(i, P.def[i], 1);
    this.store.save();
  }

  // AdvanceTime(deltaTime): the phase wraps at the motion length (fmodf); the weight eases towards its target
  advanceTime(dt) {
    if (!this.current) return;
    this.phaseTime = F(F(this.phaseTime + dt) % this.current.length);
    let w;
    if (this.fadeDuration <= this.fadeElapsed) w = this.fadeTarget;
    else {
      this.fadeElapsed = F(this.fadeElapsed + dt);
      const e = 0 < this.fadeDuration ? easeSine(F(this.fadeElapsed / this.fadeDuration)) : 1;
      w = F(this.fadeStart + F(F(this.fadeTarget - this.fadeStart) * clamp01(e)));
    }
    this.weight = w;
    if (this.stopping && w <= 0) this.stopImmediately();
  }

  // OnLateUpdate (order 350): each target = default + (curve(phase) - default) x clamp01(weight)
  lateUpdate() {
    if (!this.current || !(0 < this.weight)) return;
    const P = this.params, C = this.current.curves, w = clamp01(this.weight);
    for (let k = 0; k < this.targets.length; k++) {
      const i = this.targets[k];
      if (i < 0) continue;
      const d = P.def[i];
      const keys = C[k];
      const v = keys.length ? hermite(keys, this.phaseTime) : 0;
      P.override(i, F(d + F(F(v - d) * w)), 1);
    }
  }
}
