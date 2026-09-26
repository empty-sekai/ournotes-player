import { F } from "../engine/core.js";

// Lip sync of a Live2D character as the game runs it: Live2DAnimation.Live2DLipSyncController (the lip modes, the
// timed pseudo lip sync, the CRI Lips path, manual mouth opening) and AdvLipSyncPolicy (the ADV's "calm"
// presentation of the mouth opening). The managed MotionSync path (voice PCM -> MotionSync visemes -> mouth
// parameters) is in motionsync.js; this module decides when it runs and post-processes its result.
//
// The controller writes CubismMouthController.MouthOpening (the character's `mouthOpening`) in the modes 2-6 and
// enables or disables the mouth controller (`mouthControllerEnabled`); the managed MotionSync path writes the mouth
// parameters itself at execution order 799 with the mouth controller disabled.
//
// The managed math is float32 without FMA; F (Math.fround) is applied in source order.

// Live2DAnimation.LipMode
export const LIP_MODE = { None: 0, MotionSyncVoice: 1, CriSyncVoice: 2, Manual: 3, Pseudo: 4, TimedPseudo: 5,
                          HoldOpenTimedPseudo: 6 };
// Live2DAnimation.LipSyncPresentationMode
export const LIP_SYNC_PRESENTATION = { Default: 0, AdvCalm: 1 };
// Live2DAnimation.LipSyncPolicySourceType
export const LIP_SYNC_SOURCE = { None: 0, MotionSync: 1, CriFallback: 2, TimedPseudo: 3, HoldOpenTimedPseudo: 4 };

// AdvLipSyncPolicy AdvCalm presets (.cctor): the MotionSync preset for source MotionSync, the Fallback preset for the
// other sources
export const LIP_SYNC_PRESETS = {
  motionSync: { attack: 0.028, release: 0.085, hold: 0.05, hfs: 0.018, speakingThr: 0.022, silenceFloor: 0.0125,
                speechFloor: 0.10, minSpeech: 0.145, onset: 0.12, openScale: 0.94, comp: 0.06, openCap: 0.82,
                formScale: 0.82, formOpenSupp: 0.16, baseToDefault: 1 },
  fallback: { attack: 0.032, release: 0.10, hold: 0.06, hfs: 0.022, speakingThr: 0.026, silenceFloor: 0.015,
              speechFloor: 0.11, minSpeech: 0.17, onset: 0.13, openScale: 1.03, comp: 0.07, openCap: 0.88,
              formScale: 1, formOpenSupp: 0, baseToDefault: 0 },
};

// Live2DCharacter.ResolveAdvLipSyncPresentationProfile: from the number of CubismMouthParameter components before
// RemoveMouthParametersExceptMouthOpenY (n = count - 1)
export const lipSyncProfile = (mouthParameterCount) => {
  const n = mouthParameterCount - 1;
  return n < 1 ? { openScale: 1, formScale: 1, useForm: true }
    : { openScale: F(1 + F(0.08 * n)), formScale: F(1 / F(1 + F(0.18 * n))), useForm: true };
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// AdvLipSyncPolicy: state {F FilteredOpen, P PresentedOpen, H HoldTimer} and the presentation mode. Default returns the
// raw opening clamped to [0, 1] and the mouth form unchanged; AdvCalm (Process -> ProcessAdvCalm) shapes both.
export class AdvLipSyncPolicy {
  constructor(profile) { this.profile = profile; this.presentation = LIP_SYNC_PRESENTATION.Default; this.reset(); }

  reset() { this.F = 0; this.P = 0; this.H = 0; }

  // Live2DLipSyncController.SetLipSyncPresentationMode: a change of mode clears the state
  setPresentation(mode) {
    if (this.presentation !== mode) { this.reset(); this.presentation = mode; }
  }

  // inp: {openY, form, base, hasForm, hasBase, speaking, delta, hasDelta, def, hasDefault, canBlend}
  process(source, inp, dt) {
    if (this.presentation !== LIP_SYNC_PRESENTATION.AdvCalm) return { openY: clamp01(inp.openY), form: inp.form };
    const pre = source === LIP_SYNC_SOURCE.MotionSync ? LIP_SYNC_PRESETS.motionSync : LIP_SYNC_PRESETS.fallback;
    const prof = this.profile;
    let t = clamp01(F(F(inp.openY * pre.openScale) * prof.openScale));
    if (pre.comp > 0) t = F(t / F(F(pre.comp * t) + 1));
    t = Math.min(t, pre.openCap);
    let wasOpen = this.H > 0 || this.P >= Math.max(pre.silenceFloor, F(pre.minSpeech * 0.5));
    if (inp.speaking || inp.openY >= pre.speakingThr) {
      this.H = pre.hold;
      if (t > 0 && t <= pre.speechFloor) t = pre.speechFloor;
      if (t <= pre.minSpeech) t = pre.minSpeech;
    } else {
      this.H = Math.max(0, F(this.H - dt));
      if (this.H > 0) { wasOpen = true; if (t > 0 && t <= pre.speechFloor) t = pre.speechFloor; }
      else { if (t < pre.silenceFloor) t = 0; wasOpen = true; }
    }
    let tau = t <= this.F ? pre.hfs : F(pre.hfs * 0.65);
    if (tau > 0) t = F(this.F + F(F(t - this.F) * clamp01(F(1 - Math.exp(-dt / tau)))));
    this.F = t;
    tau = t <= this.P ? pre.release : pre.attack;
    if (tau > 0) t = F(this.P + F(F(t - this.P) * clamp01(F(1 - Math.exp(-dt / tau)))));
    this.P = t;
    let out = clamp01(t);
    if (!wasOpen) { out = Math.max(out, pre.onset); this.F = Math.max(this.F, out); this.P = Math.max(this.P, out); }
    let form = inp.form;
    if (inp.hasForm && inp.hasBase && prof.useForm) {
      const d = inp.hasDelta ? inp.delta : F(inp.form - inp.base);
      const noBlend = !inp.hasDelta || !inp.hasDefault || !inp.canBlend;
      const hi = Math.max(pre.speakingThr, pre.speechFloor), lo = F(0.7 * hi);
      const w = clamp01(F(F(out - lo) / F(hi - lo)));
      let b = inp.base;
      if (!noBlend) b = F(b + F(F(inp.def - b) * clamp01(F(w * pre.baseToDefault))));
      form = F(b + F(F(F(F(w * F(1 - F(out * pre.formOpenSupp))) * d) * pre.formScale) * prof.formScale));
    }
    return { openY: out, form };
  }
}

// UnityEngine.Mathf.SmoothDamp as compiled in the game (float32); vel = {v} is the ref currentVelocity
export const smoothDamp = (current, target, vel, smoothTime, maxSpeed, deltaTime) => {
  let change = F(current - target);
  const st = 0.0001 <= smoothTime ? smoothTime : F(0.0001);
  const omega = F(2 / st), maxChange = F(st * maxSpeed);
  let c = change <= maxChange ? change : maxChange;
  const x = F(omega * deltaTime);
  if (!(F(-maxChange) <= change)) c = F(-maxChange);
  change = c;
  const v0 = vel.v;
  const exp = F(1 / F(F(F(x + 1) + F(F(x * x) * F(0.48))) + F(F(F(x * x) * x) * F(0.235))));
  const temp = F(F(F(omega * change) + v0) * deltaTime);
  let out = F(F(current - change) + F(exp * F(change + temp)));
  vel.v = F(exp * F(v0 - F(omega * temp)));
  if ((F(target - current) > 0) !== (out <= target)) {
    let nv = v0;
    if (deltaTime !== 0) nv = F(F(target - target) / deltaTime);
    vel.v = nv;
    out = target;
  }
  return out;
};

// Live2DLipSyncController.PseudoLipSyncParams
const PSEUDO = { stopDuration: F(0.3), openAgainRate: 0.75, openSmoothTime: F(0.025), closeSmoothTime: F(0.04) };

// Live2DLipSyncController over its character `ch`: ch.mouthOpening (CubismMouthController.MouthOpening),
// ch.mouthControllerEnabled, ch.loop (deltaTime), ch.random (UnityEngine.Random), ch.motionSync (the model's
// MotionSync controller of motionsync.js, or null).
//   ENGINE: Fwk AppTimeManager.GetSystemDeltaTime is Time.deltaTime; the timers here use the loop's deltaTime.
export class Live2DLipSyncController {
  constructor(ch, profile) {
    this.ch = ch;
    this.policy = new AdvLipSyncPolicy(profile);
    this.enabled = false;                       // IsLipSyncEnabled
    this.mode = LIP_MODE.None;                  // CurrentLipMode
    this.defaultMouthOpening = 0;               // _defaultMouthOpening
    this.scale = 1;                             // _lipSyncScaleRate
    this.mouth = 0;                             // _mouthOpening
    this.currentLevel = 0;                      // _currentLevel
    this.beforeLevel = 0;                       // _beforeLevel
    this.manualLevel = 0;                       // _manualLevel
    this.pseudoMultiplier = 0;                  // _pseudoLipSyncMultiplier
    this.pseudo = { speed: 1, timer: 0, openScale: 0, damp: { v: 0 }, isOpen: false };   // PseudoLipSyncParams
    this.timedTimer = 0;                        // _timedPseudoLipSyncTimer
    this.timedStopTimer = 0;                    // _timedPseudoLipSyncStopTimer
    this.lipsAnalyzer = null;                   // the voice's CRI Lips analysis: {isAvailable, getOpenInfo() -> {openY}}
    this.missing = null;                        // what a requested path needed and did not have
  }

  get motionSync() { return this.ch.motionSync; }
  get existsMotionSync() { return !!this.ch.motionSync; }                              // ExistsMotionSyncController
  get managed() { return this.existsMotionSync && this.policy.presentation === LIP_SYNC_PRESENTATION.AdvCalm; }

  _setMouth(v) { this.ch.mouthOpening = v; }

  // RefreshMouthControllerEnabledState
  _refreshMouthController() {
    this.ch.mouthControllerEnabled = !(this.enabled && this.mode === LIP_MODE.MotionSyncVoice) || !this.managed;
  }

  // SetMotionSyncEnabledIfPossible: CubismMotionSyncController.IsMotionSyncEnabled = flag && not managed
  _setMotionSyncEnabled(flag) { if (this.motionSync) this.motionSync.isMotionSyncEnabled = flag && !this.managed; }

  _modeAfterPseudo() { return this.existsMotionSync ? LIP_MODE.MotionSyncVoice : LIP_MODE.CriSyncVoice; }

  // Live2DLipSyncController.SetMotionSyncController (Live2DCharacter.Init)
  initMotionSync() {
    if (!this.motionSync) return;
    this.motionSync.setFreshPcmCapture(this.policy.presentation === LIP_SYNC_PRESENTATION.AdvCalm);
    this.mode = LIP_MODE.MotionSyncVoice;
    this._refreshMouthController();
  }

  setLipSyncParameter(defaultMouthOpening = 0, scale = 1) { this.defaultMouthOpening = defaultMouthOpening; this.scale = scale; }

  setPresentationMode(mode) {                                 // SetLipSyncPresentationMode
    this.policy.setPresentation(mode);
    if (this.motionSync) this.motionSync.setFreshPcmCapture(mode === LIP_SYNC_PRESENTATION.AdvCalm);
    this._setMotionSyncEnabled(this.enabled && this.mode === LIP_MODE.MotionSyncVoice);
    this._refreshMouthController();
  }

  _resetLip() {                                               // ResetLip
    this._setMouth(this.defaultMouthOpening);
    this.manualLevel = this.defaultMouthOpening;
    this.currentLevel = 0; this.beforeLevel = 0;
    Object.assign(this.pseudo, { speed: 1, timer: 0, openScale: F(0.8), isOpen: false });
    this.pseudo.damp.v = 0;
  }

  _setEnabledCommon(flag) {                                   // SetLipSyncEnabledCommon
    const M = this.motionSync;
    if (!flag && this.enabled && M) M.neutralCaptured = false;
    this.policy.reset();
    this.enabled = flag;
    this._resetLip();
    this._refreshMouthController();
    if (M) { M.speechHint = 0; M.canBlend = false; }
    if (flag) {
      if (this.managed) {
        M.neutralCaptured = M.resolveNeutrals();              // TryResolveMotionSyncNeutralValuesFromSilenceMapping
        M.canBlend = M.canBlendFormBaseToDefault();           // CanBlendMouthFormBaseToDefaultForModel
        M.resetProcessorState();                              // ResetMotionSyncProcessorState
      }
    } else if (this.policy.presentation !== LIP_SYNC_PRESENTATION.Default) {
      this.policy.reset(); this.policy.presentation = LIP_SYNC_PRESENTATION.Default;
    }
  }

  // SetLipSyncEnabled(flag, usePseudo): off -> Manual; on -> MotionSyncVoice (MotionSync controller) or CriSyncVoice;
  // usePseudo -> Pseudo
  setEnabled(flag, usePseudo = false) {
    this._setEnabledCommon(flag);
    if (!flag) { this._setMotionSyncEnabled(false); this.mode = LIP_MODE.Manual; }
    else if (usePseudo) { this._setMotionSyncEnabled(false); this.mode = LIP_MODE.Pseudo; }
    else if (this.existsMotionSync) { this._setMotionSyncEnabled(true); this.mode = LIP_MODE.MotionSyncVoice; }
    else { this._setMotionSyncEnabled(false); this.mode = LIP_MODE.CriSyncVoice; }
    this._refreshMouthController();
  }

  // SetLipsAtomAnalyzer: the CRI Lips analyzer of a voice (or null); forces CriSyncVoice
  setLipsAnalyzer(analyzer) {
    this.lipsAnalyzer = analyzer || null;
    if (analyzer || this.enabled) { this.mode = LIP_MODE.CriSyncVoice; this._refreshMouthController(); }
    this._setMotionSyncEnabled(false);
  }

  // StartTimedPseudoLipSync (unscaledTime = the controller's unit time x talk length)
  startTimed(unscaledTime, speed, multiplier) {
    this.timedTimer = unscaledTime;
    this.pseudo.speed = speed;
    this.pseudoMultiplier = multiplier;
    this.mode = LIP_MODE.TimedPseudo;
    this._refreshMouthController();
    this._setMotionSyncEnabled(false);
  }

  startTimedHoldOpen(mouthOpening, unscaledTime, speed) {    // StartTimedHoldOpenPseudoLipSync
    this.timedTimer = unscaledTime;
    this.pseudo.speed = speed;
    this.manualLevel = mouthOpening;
    this.mode = LIP_MODE.HoldOpenTimedPseudo;
    this._refreshMouthController();
    this._setMotionSyncEnabled(false);
  }

  stopTimed() {                                               // StopTimedPseudoLipSync
    if (this.mode !== LIP_MODE.TimedPseudo && this.mode !== LIP_MODE.HoldOpenTimedPseudo) return;
    this.timedTimer = 0;
    this.mode = this._modeAfterPseudo();
    this._refreshMouthController();
    this._setMotionSyncEnabled(true);
  }

  setPseudoSpeed(speed) { this.pseudo.speed = speed; }        // SetPseudoLipSyncSpeed

  moveLipManual(level) {                                      // MoveLipManual (SetMouthOpening)
    if (this.mode !== LIP_MODE.Manual) this.setEnabled(false, false);
    this.mode = LIP_MODE.Manual;
    this._refreshMouthController();
    this.manualLevel = level;
    this._setMouth(clamp01(F(this.scale * level)));
  }

  // OnUpdate (Update phase): the voice PCM into the MotionSync audio input (MotionSyncVoice, lip sync on)
  onUpdate() {
    if (this.mode === LIP_MODE.MotionSyncVoice && this.enabled && this.motionSync) this.motionSync.capture();
  }

  // OnPreUpdate (LateUpdate, before the update chain)
  onPreUpdate() {
    if (this.enabled && this.mode === LIP_MODE.MotionSyncVoice && this.managed) this.motionSync.isMotionSyncEnabled = false;
  }

  // AdvLipSyncLateApplier (order 799): OnManagedLateUpdate + ApplyMotionSyncPostProcess
  managedLateUpdate(params, mouthOpenY, mouthForm) {
    const M = this.motionSync;
    if (M) M.hasFormDelta = false;
    if (!(this.mode === LIP_MODE.MotionSyncVoice && this.enabled && this.managed)) return;
    M.applyOnCapturedBase();
    M.postProcess(this.policy, mouthOpenY, mouthForm);
  }

  _policyPseudo(source, raw) {                                // ApplyPseudoLipSyncPolicy
    const openY = Math.max(0, clamp01(raw));
    const out = this.policy.process(source, { openY, form: 0, base: 0, hasForm: false, hasBase: false, speaking: false,
                                              delta: 0, hasDelta: false, def: 0, hasDefault: false, canBlend: false },
                                    this.ch.loop.deltaTime);
    return clamp01(F(out.openY * this.scale));
  }

  _updatePseudo(isStop) {                                     // UpdatePseudoLipSync
    if (!this.enabled) { this._resetLip(); return; }
    const P = this.pseudo, R = this.ch.random, dt = this.ch.loop.deltaTime;
    if (isStop) P.isOpen = false;
    else {
      P.timer = F(P.timer - F(dt * P.speed));
      if (P.timer <= 0) {
        if (P.isOpen && R.value() > PSEUDO.openAgainRate) {
          P.isOpen = false;
          P.timer = R.range(F(0.05), F(0.15));
        } else {
          P.isOpen = true;
          P.timer = R.range(F(0.05), F(0.15));
          P.openScale = R.range(F(0.6), 1);
        }
      }
    }
    const target = P.isOpen ? P.openScale : 0;
    this.currentLevel = target;
    const k = this.ch.mouthOpening < target ? PSEUDO.openSmoothTime : PSEUDO.closeSmoothTime;
    this.beforeLevel = smoothDamp(this.beforeLevel, target, P.damp, F(k / P.speed), Infinity, dt);
    const v = this._policyPseudo(LIP_SYNC_SOURCE.TimedPseudo, F(this.beforeLevel * this.pseudoMultiplier));
    this.mouth = v; this._setMouth(v);
  }

  _updateHoldOpen(isStop) {                                   // UpdateHoldOpenPseudoLipSync
    if (!this.enabled) { this._resetLip(); return; }
    const P = this.pseudo, R = this.ch.random, dt = this.ch.loop.deltaTime;
    const want = isStop ? 0 : clamp01(this.manualLevel);
    P.openScale = smoothDamp(P.openScale, want, P.damp, F((isStop ? PSEUDO.closeSmoothTime : PSEUDO.openSmoothTime) / P.speed),
                             Infinity, dt);
    let target;
    if (isStop) { P.isOpen = true; target = P.openScale; }
    else {
      P.timer = F(P.timer - F(dt * P.speed));
      if (P.timer <= 0) { P.isOpen = true; P.timer = R.range(F(0.05), F(0.15)); }
      target = P.isOpen ? P.openScale : 0;
    }
    this.currentLevel = target;
    const k = this.ch.mouthOpening < target ? PSEUDO.openSmoothTime : PSEUDO.closeSmoothTime;
    this.beforeLevel = smoothDamp(this.beforeLevel, target, P.damp, F(k / P.speed), Infinity, dt);
    const v = this._policyPseudo(LIP_SYNC_SOURCE.HoldOpenTimedPseudo, this.beforeLevel);
    this.mouth = v; this._setMouth(v);
  }

  _updateCriLips() {                                          // UpdateLipSync (CriSyncVoice)
    if (!this.enabled) { this._resetLip(); return; }
    const A = this.lipsAnalyzer;
    if (!A) {
      // the game always has the voice's CRI Lips analyzer here; without one nothing drives the mouth
      this.missing = "CRI Lips analyzer";
      this.setEnabled(false, false); this.setLipsAnalyzer(null);
      this._resetLip();
      return;
    }
    if (typeof A.getOpenInfo !== "function") {
      // a voice without its CRI Lips analysis (CriLipsAtomAnalyzer.GetInfo): the mouth stays closed
      this.missing = "CRI Lips analysis";
      this._resetLip();
      return;
    }
    if (!A.isAvailable) { this._resetLip(); return; }
    const x = clamp01(A.getOpenInfo().openY);
    this.currentLevel = x;
    let lvl;
    if (this.policy.presentation === LIP_SYNC_PRESENTATION.AdvCalm) {
      lvl = this.policy.process(LIP_SYNC_SOURCE.CriFallback, { openY: Math.max(0, x), form: 0, base: 0, hasForm: false,
        hasBase: false, speaking: false, delta: 0, hasDelta: false, def: 0, hasDefault: false, canBlend: false },
        this.ch.loop.deltaTime).openY;
    } else {
      const v = F(x * F(Math.pow(F(x + 1), 6)));
      const u = 0.1 <= v ? v : 0;
      let T = 0.125 <= u ? Math.min(u, 1) : F(0.125);
      if (u <= 0) T = u;
      const prev = this.beforeLevel, d = F(prev - T);
      const rising = Math.abs(d) >= 0.1 && d <= 0.1;
      lvl = F(F(T * (rising ? F(0.7) : 0.5)) + F(prev * (rising ? F(0.3) : 0.5)));
    }
    this.beforeLevel = lvl;
    const m = clamp01(F(lvl * this.scale));
    this.mouth = m; this._setMouth(m);
  }

  // OnLateUpdate (after the update chain, not while paused): the modes 2-6 write MouthOpening, which the mouth
  // controller (order 500) applies in the next frame's chain
  lateUpdate() {
    const dt = this.ch.loop.deltaTime;
    switch (this.mode) {
      case LIP_MODE.CriSyncVoice: this._updateCriLips(); return;
      case LIP_MODE.Manual: this._setMouth(clamp01(F(this.manualLevel * this.scale))); return;
      case LIP_MODE.Pseudo: this._updatePseudo(false); return;
      case LIP_MODE.TimedPseudo:
      case LIP_MODE.HoldOpenTimedPseudo: {
        const step = F(dt * this.pseudo.speed), hold = this.mode === LIP_MODE.HoldOpenTimedPseudo;
        if (this.timedTimer < 0) {
          if (this.timedStopTimer < 0) return;
          if (hold) this._updateHoldOpen(true);
          else { this._updatePseudo(true); this._setMotionSyncEnabled(true); }
          this.timedStopTimer = F(this.timedStopTimer - step);
          if (0 < this.timedStopTimer) return;
          if (hold) this._setMotionSyncEnabled(true);
          this.mode = this._modeAfterPseudo();
          this._refreshMouthController();
          return;
        }
        if (hold) this._updateHoldOpen(false); else this._updatePseudo(false);
        this.timedTimer = F(this.timedTimer - step);
        if (this.timedTimer <= 0) this.timedStopTimer = PSEUDO.stopDuration;
        return;
      }
      default:
    }
  }
}
