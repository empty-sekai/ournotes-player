import { F } from "../../engine/core.js";
import { easeF } from "../../engine/tween.js";
import { StoryCommandError } from "../interfaces.js";
import { shakeWaypoints } from "./dotween.js";
import { featureSlot, featureState } from "./state.js";

// DOTween as the game's build compiles it (DOTween 1.2.705), for the tweens of the still prefabs: tweeners with delay,
// loops (Restart / Yoyo), callbacks and lazy start values, Sequences with inserted tweens and callbacks, the filtered
// Play / Kill by target or string id, and TweenManager.Update with its deferred kills. One DTManager per story context
// joins the loop's DOTween runner (loop.tweens) as a single entry, so its tweens update in their own creation order in
// the "tweens" phase.
//
// TweenManager.Update(dt): for the tweens active when the loop starts, in creation order (a tween created during the
// loop is first updated in the next frame): an inactive one (killed inside the loop) is marked for killing; a playing one
// gets d = dt x timeScale (skipped when |d| < 1e-6), runs out its delay (OnPlay again after a replayed delay), starts up
// (Tweener: start value from the getter, change = end - start, ease INTERNAL_Zero for duration <= 0; Sequence: stable
// sort of its objects), advances position (float32) with loop wraps and goes there (Tween.DoGoto: OnStart / OnPlay on
// the first update, the value, OnUpdate, OnRewind, OnStepComplete, OnComplete, OnPause); a completed autoKill tween is
// marked. The marked tweens are despawned at the end of the loop (OnKill, nested tweens of a Sequence despawned too).
// Kill outside the loop despawns at once; inside it only deactivates. A tween inside a Sequence cannot be played,
// paused, restarted or killed on its own, and the filtered operations never reach it.
// Defaults: DOTween..cctor (autoKill, autoPlay All, loop Restart, ease OutQuad, overshoot 1.70158, period 0).
// ENGINE: the DOTweenSettings resource of the game (which may replace those defaults) is not in the story data.

export const DT_MODE = Object.freeze({ Update: 0, Goto: 1, IgnoreOnUpdate: 2, IgnoreOnComplete: 3 });
export const DT_LOOP = Object.freeze({ Restart: 0, Yoyo: 1, Incremental: 2 });
export const DT_TYPE = Object.freeze({ Tweener: 0, Sequence: 1, Callback: 2 });
export const DT_DEFAULTS = Object.freeze({ autoKill: true, autoPlay: 3, loopType: 0, ease: 6, overshoot: F(1.70158), period: 0 });
const INT_MAX = 2147483647;
const EASE_ZERO = 36, EASE_CUSTOM = 37;
const autoPlays = (kind) => DT_DEFAULTS.autoPlay === 3 || DT_DEFAULTS.autoPlay === kind;   // 1 Sequences, 2 Tweeners

const unsupported = (what) => { throw new StoryCommandError(`DOTween: ${what} not implemented`); };

// a cancelled ToUniTask await (the playback token): the awaiting code does not continue
export class DTCancelled extends Error {}

export class DTManager {
  constructor(loop) {
    this.loop = loop;
    this.tweens = [];                   // _activeTweens, creation order
    this.isUpdateLoop = false;
    this.awaits = new Set();            // pending ToUniTask awaits with a cancellation check
    this.disposed = false;
    this._entry = { step: (dt) => this.update(dt) };
    loop.tweens.active.add(this._entry);
  }

  _add(t) { t.active = true; this.tweens.push(t); }
  _remove(t) { const i = this.tweens.indexOf(t); if (i >= 0) this.tweens.splice(i, 1); }

  // TweenManager.Despawn: OnKill, out of the active list, a Sequence's nested tweens too (their OnKill included)
  despawn(t, modifyList = true) {
    if (t.despawned) return;
    t.despawned = true;
    if (t.onKill) t.onKill();
    if (modifyList) this._remove(t);
    if (t.tweenType === DT_TYPE.Sequence) for (const c of t.sequencedTweens) this.despawn(c, false);
    t.active = false;
  }

  update(dt) {
    for (const a of [...this.awaits]) if (a.cancelled()) a.cancel();
    if (!this.tweens.length) return;
    this.isUpdateLoop = true;
    const kill = [];
    for (const t of this.tweens.slice()) {
      if (t.isSequenced || t.despawned) continue;
      if (!t.active) { kill.push(t); continue; }
      if (!t.isPlaying) continue;
      t.creationLocked = true;
      let d = F(dt * t.timeScale);
      if (d < 1e-6 && d > -1e-6) continue;
      if (!t.delayComplete) {
        d = t._updateDelay(F(t.elapsedDelay + d));
        if (d <= 0) continue;
        if (t.playedOnce && t.onPlay) t.onPlay();
      }
      if (!t.startupDone && !t.startup()) { t.active = false; kill.push(t); continue; }
      let pos = t.position, loops = t.completedLoops;
      const wasEnd = pos >= t.duration;
      if (t.duration <= 0) { pos = 0; loops = t.loops === -1 ? loops + 1 : t.loops; }
      else {
        if (t.isBackwards) unsupported("backwards playback");
        pos = F(pos + d);
        while (pos >= t.duration && (t.loops === -1 || loops < t.loops)) { pos = F(pos - t.duration); loops++; }
        if (wasEnd) loops--;
        if (t.loops !== -1 && loops >= t.loops) pos = t.duration;
      }
      if (t.doGoto(pos, loops, DT_MODE.Update)) { t.active = false; kill.push(t); }
    }
    for (const t of kill) this.despawn(t);
    this.isUpdateLoop = false;
  }

  // TweenManager.FilteredOperation over the top-level active tweens, newest first: a string matches Tween.stringId,
  // another object Tween.target
  _filtered(key, fn) {
    const isId = typeof key === "string";
    let n = 0;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      if (!t || !t.active || t.isSequenced) continue;
      if (isId ? t.stringId !== null && t.stringId === key : key !== null && t.target === key) { if (fn(t)) n++; }
    }
    return n;
  }

  // DOTween.Play(targetOrId)
  play(key) { return this._filtered(key, (t) => t._play()); }

  // DOTween.Kill(targetOrId, complete = false)
  kill(key) {
    const hit = [];
    this._filtered(key, (t) => { hit.push(t); return true; });
    for (const t of hit) { if (this.isUpdateLoop) t.active = false; else this.despawn(t); }
    return hit.length;
  }

  // ToUniTask(tween, TweenCancelBehaviour.KillAndCancelAwait, token): completes when the tween is killed (completion
  // included); a cancelled token kills it and the await throws. cancelled() is checked at each update.
  toUniTask(t, cancelled = () => false) {
    return new Promise((resolve, reject) => {
      if (!t || !t.active) { resolve(); return; }
      const prev = t.onKill;
      const a = { cancelled, cancel: () => { this.awaits.delete(a); a.dead = true; t.kill(); reject(new DTCancelled("cancelled")); } };
      this.awaits.add(a);
      t.onKill = () => {
        if (prev) prev();
        this.awaits.delete(a);
        if (a.dead) return;
        if (this.disposed) reject(new DTCancelled("disposed")); else resolve();
      };
    });
  }

  dispose() {
    this.disposed = true;
    this.loop.tweens.active.delete(this._entry);
    for (const t of [...this.tweens]) this.despawn(t);
  }
}

// DG.Tweening.Tween (Tweener and Sequence)
export class DTween {
  constructor(mgr, type) {
    Object.assign(this, {
      mgr, tweenType: type, timeScale: 1, isBackwards: false, stringId: null, target: null,
      onStart: null, onPlay: null, onUpdate: null, onStepComplete: null, onComplete: null, onKill: null, onRewind: null,
      onPause: null, isFrom: false, isRelative: false, isSpeedBased: false, autoKill: DT_DEFAULTS.autoKill, duration: 0,
      loops: 1, loopType: DT_DEFAULTS.loopType, delay: 0, easeType: DT_DEFAULTS.ease, overshoot: DT_DEFAULTS.overshoot,
      period: DT_DEFAULTS.period, active: false, isSequenced: false, sequenceParent: null, creationLocked: false,
      startupDone: false, playedOnce: false, position: 0, fullDuration: 0, completedLoops: 0, isPlaying: false,
      isComplete: false, elapsedDelay: 0, delayComplete: true, sequencedPosition: 0, sequencedEndPosition: 0,
      despawned: false,
    });
  }

  get hasLoops() { return this.loops === -1 || this.loops > 1; }

  // ---------------------------------------------------------------------------- settings (TweenSettingsExtensions)
  setAutoKill(v = true) { if (this.active && !this.creationLocked) this.autoKill = !!v; return this; }
  setId(id) { if (this.active) this.stringId = id; return this; }
  setTarget(o) { if (this.active) this.target = o; return this; }
  setLoops(loops, loopType = null) {
    if (!this.active || this.creationLocked) return this;
    if (loops < -1) loops = -1; else if (loops === 0) loops = 1;
    this.loops = loops;
    if (loopType !== null) this.loopType = loopType;
    if (this.loopType === DT_LOOP.Incremental) unsupported("LoopType.Incremental");
    if (this.tweenType === DT_TYPE.Tweener) this.fullDuration = loops > -1 ? F(this.duration * loops) : Infinity;
    return this;
  }
  setEase(e) {
    if (!this.active) return this;
    if (e >= 32 && e <= 35) unsupported(`Flash ease ${e}`);
    if (e === EASE_CUSTOM) unsupported("custom ease curves");
    this.easeType = e;
    return this;
  }
  setDelay(d) {
    if (!this.active || this.creationLocked) return this;
    if (this.tweenType === DT_TYPE.Sequence) unsupported("Sequence delay");
    this.delay = F(d); this.delayComplete = this.delay <= 0;
    return this;
  }
  setRelative(v = true) {
    if (!this.active || this.creationLocked || this.isFrom) return this;
    if (v) unsupported("relative tweens");
    return this;
  }
  setUpdate(independent) { if (independent) unsupported("independent update"); return this; }
  on(name, fn) { if (this.active) this[name] = fn; return this; }

  // ---------------------------------------------------------------------------- control (TweenExtensions)
  _nested(op) { console.warn(`DOTween: ${op} on a tween inside a Sequence has no effect`); }

  play() { if (!this.active) return this; if (this.isSequenced) { this._nested("Play"); return this; } this._play(); return this; }

  // TweenManager.Play
  _play() {
    if (!this.isPlaying && (!this.isBackwards && !this.isComplete || this.isBackwards && (this.completedLoops > 0 || this.position > 0))) {
      this.isPlaying = true;
      if (this.playedOnce && this.delayComplete && this.onPlay) this.onPlay();
      return true;
    }
    return false;
  }

  pause() {
    if (!this.active) return this;
    if (this.isSequenced) { this._nested("Pause"); return this; }
    if (this.isPlaying) { this.isPlaying = false; if (this.onPause) this.onPause(); }
    return this;
  }

  kill(complete = false) {
    if (!this.active) return;
    if (this.isSequenced) { this._nested("Kill"); return; }
    if (complete) unsupported("Kill(complete: true)");
    if (this.mgr.isUpdateLoop) this.active = false; else this.mgr.despawn(this);
  }

  // TweenManager.Restart(t, includeDelay = true, changeDelayTo = -1)
  restart(includeDelay = true) {
    if (!this.active) return;
    if (this.isSequenced) { this._nested("Restart"); return; }
    const wasPaused = !this.isPlaying;
    this.isBackwards = false;
    this._rewind(includeDelay);
    this.isPlaying = true;
    if (wasPaused && this.playedOnce && this.delayComplete && this.onPlay) this.onPlay();
  }

  // TweenManager.Rewind
  _rewind(includeDelay) {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (this.delay > 0) {
      if (includeDelay) { this.elapsedDelay = 0; this.delayComplete = false; }
      else { this.elapsedDelay = this.delay; this.delayComplete = true; }
    }
    if (this.position > 0 || this.completedLoops > 0 || !this.startupDone) {
      const needsKilling = this.doGoto(0, 0, DT_MODE.Goto);
      if (!needsKilling && wasPlaying && this.onPause) this.onPause();
    }
  }

  // Tweener.DoUpdateDelay
  _updateDelay(elapsed) {
    if (elapsed > this.delay) { this.elapsedDelay = this.delay; this.delayComplete = true; return F(elapsed - this.delay); }
    this.elapsedDelay = elapsed;
    return 0;
  }

  // TweenManager.Goto(t, to, andPlay, mode): the driver of a nested tween
  goto(to, andPlay, mode) {
    const wasPlaying = this.isPlaying;
    this.isPlaying = andPlay;
    this.delayComplete = true;
    this.elapsedDelay = this.delay;
    let loops = this.duration <= 0 ? 1 : Math.floor(F(to / this.duration));
    let pos = this.duration <= 0 ? NaN : F(to % this.duration);
    if (this.loops !== -1 && loops >= this.loops) { loops = this.loops; pos = this.duration; }
    else if (pos >= this.duration) pos = 0;
    const needsKilling = this.doGoto(pos, loops, mode);
    if (!andPlay && wasPlaying && !needsKilling && this.onPause) this.onPause();
    return needsKilling;
  }

  // Tween.DoGoto: true when the tween must be killed
  doGoto(toPosition, toCompletedLoops, mode) {
    if (!this.startupDone && !this.startup()) return true;
    if (!this.playedOnce && mode === DT_MODE.Update) {
      this.playedOnce = true;
      if (this.onStart) { this.onStart(); if (!this.active) return true; }
      if (this.onPlay) { this.onPlay(); if (!this.active) return true; }
    }
    const prevPosition = this.position, prevCompletedLoops = this.completedLoops;
    this.completedLoops = toCompletedLoops;
    const wasRewinded = this.position <= 0 && prevCompletedLoops <= 0;
    const wasComplete = this.isComplete;
    if (this.loops !== -1) this.isComplete = this.completedLoops === this.loops;
    let steps = 0;
    if (mode === DT_MODE.Update) {
      if (this.isBackwards) {
        steps = this.completedLoops < prevCompletedLoops ? prevCompletedLoops - this.completedLoops : (toPosition <= 0 && !wasRewinded ? 1 : 0);
      } else steps = this.completedLoops > prevCompletedLoops ? this.completedLoops - prevCompletedLoops : 0;
    } else if (this.tweenType === DT_TYPE.Sequence) steps = Math.abs(prevCompletedLoops - toCompletedLoops);
    if (toPosition > this.duration) toPosition = this.duration;
    else if (toPosition <= 0) toPosition = this.completedLoops > 0 || this.isComplete ? this.duration : 0;
    this.position = toPosition;
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) this.isPlaying = !this.isBackwards ? !this.isComplete : !(this.completedLoops === 0 && this.position <= 0);
    const useInverse = this.hasLoops && this.loopType === DT_LOOP.Yoyo &&
      (this.position < this.duration ? this.completedLoops % 2 !== 0 : this.completedLoops % 2 === 0);
    if (this.applyTween(prevPosition, prevCompletedLoops, steps, useInverse, mode)) return true;
    if (this.onUpdate && mode !== DT_MODE.IgnoreOnUpdate) this.onUpdate();
    if (this.position <= 0 && this.completedLoops <= 0 && !wasRewinded && this.onRewind) this.onRewind();
    if (steps > 0 && mode === DT_MODE.Update && this.onStepComplete) for (let i = 0; i < steps; i++) this.onStepComplete();
    if (this.isComplete && !wasComplete && mode !== DT_MODE.IgnoreOnComplete && this.onComplete) this.onComplete();
    if (!this.isPlaying && wasPlaying && (!this.isComplete || !this.autoKill) && this.onPause) this.onPause();
    return this.autoKill && this.isComplete;
  }
}

// TweenerCore<T1, T2, TPlugOptions>: plugin {start(t, value) -> start value, change(t), apply(t, elapsed), special(t)}
export class DTweener extends DTween {
  constructor(mgr, get, set, end, duration, plugin) {
    super(mgr, DT_TYPE.Tweener);
    this.getter = get; this.setter = set; this.endValue = end; this.plugin = plugin;
    this.duration = F(duration);
    this.specialStartupMode = 0;          // 2 SetShake, 3 SetPunch
    this.isPlaying = autoPlays(2);
    mgr._add(this);
  }

  ease(elapsed, duration = this.duration) { return easeF(this.easeType, elapsed, duration, this.overshoot, this.period); }

  // Tweener.DoStartup
  startup() {
    this.startupDone = true;
    if (this.specialStartupMode && !this.plugin.special(this)) return false;
    this.startValue = this.plugin.start(this, this.getter());
    this.plugin.change(this);
    this.fullDuration = this.loops > -1 ? F(this.duration * this.loops) : Infinity;
    if (this.duration <= 0) this.easeType = EASE_ZERO;
    return true;
  }

  applyTween(prevPosition, prevLoops, steps, useInverse) {
    this.plugin.apply(this, useInverse ? F(this.duration - this.position) : this.position);
    return false;
  }
}

// Sequence
export class DTSequence extends DTween {
  constructor(mgr) {
    super(mgr, DT_TYPE.Sequence);
    this.objs = [];                      // _sequencedObjs: tweens and callbacks
    this.sequencedTweens = [];
    this.lastTweenInsertTime = 0;
    this.easeType = 1;                   // Linear
    this.isPlaying = autoPlays(1);
    mgr._add(this);
  }

  ease(position) { return easeF(this.easeType, position, this.duration, this.overshoot, this.period); }

  _validate(t, ignoreTween = false) {
    if (!this.active) { console.warn("DOTween: the Sequence is not active"); return false; }
    if (this.creationLocked) { console.warn("DOTween: the Sequence has started and is locked"); return false; }
    if (ignoreTween) return true;
    if (!t) { console.warn("DOTween: a null tween cannot be inserted"); return false; }
    if (!t.active) { console.warn("DOTween: an inactive tween cannot be inserted"); return false; }
    if (t.isSequenced) { console.warn("DOTween: the tween is already inside a Sequence"); return false; }
    return true;
  }

  // Sequence.Insert -> DoInsert: the tween's delay becomes an offset, loops -1 become int.MaxValue, autoKill off
  insert(at, t) {
    if (!this._validate(t)) return this;
    this.mgr._remove(t);
    at = F(at + t.delay);
    this.lastTweenInsertTime = at;
    t.isSequenced = t.creationLocked = true;
    t.sequenceParent = this;
    if (t.loops === -1) { t.loops = INT_MAX; console.warn("DOTween: infinite loops are not allowed inside a Sequence"); }
    const full = F(t.duration * t.loops);
    t.autoKill = false;
    t.delay = t.elapsedDelay = 0;
    t.delayComplete = true;
    if (t.isSpeedBased) unsupported("speed-based tweens in a Sequence");
    t.sequencedPosition = at;
    t.sequencedEndPosition = F(at + full);
    if (t.sequencedEndPosition > this.duration) this.duration = t.sequencedEndPosition;
    this.objs.push(t);
    this.sequencedTweens.push(t);
    return this;
  }

  // Sequence.InsertCallback -> DoInsertCallback
  insertCallback(at, fn) {
    if (!this._validate(null, true)) return this;
    at = F(at);
    this.lastTweenInsertTime = at;
    this.objs.push({ tweenType: DT_TYPE.Callback, sequencedPosition: at, sequencedEndPosition: at, onStart: fn });
    if (this.duration < at) this.duration = at;
    return this;
  }

  // Sequence.DoStartup: an empty Sequence without callbacks fails; stable insertion sort by start position
  startup() {
    if (!this.sequencedTweens.length && !this.objs.length && !this.onStart && !this.onComplete && !this.onUpdate) return false;
    this.startupDone = true;
    this.fullDuration = this.loops > -1 ? F(this.duration * this.loops) : Infinity;
    const o = this.objs;
    for (let i = 1; i < o.length; i++) {
      const x = o[i];
      let j = i - 1;
      while (j >= 0 && o[j].sequencedPosition > x.sequencedPosition) { o[j + 1] = o[j]; j--; }
      o[j + 1] = x;
    }
    return true;
  }

  // Sequence.DoApplyTween: a Sequence ease other than Linear maps both positions (duration x ease(position)); the
  // nested tweens keep their own eases
  applyTween(prevPos, prevCompletedLoops, newCompletedSteps, useInverse, mode) {
    if (this.loopType === DT_LOOP.Yoyo && this.hasLoops) unsupported("Yoyo Sequences");
    let newPos = this.position;
    if (this.easeType !== 1) {
      prevPos = F(this.duration * this.ease(prevPos));
      newPos = F(this.duration * this.ease(newPos));
    }
    let from, to = 0;
    let isInverse = this.loopType === DT_LOOP.Yoyo && (prevPos < this.duration ? prevCompletedLoops % 2 !== 0 : prevCompletedLoops % 2 === 0);
    if (this.isBackwards) isInverse = !isInverse;
    if (newCompletedSteps > 0) {
      const cycles = this.completedLoops, cyclePos = this.position;
      from = prevPos;
      if (mode === DT_MODE.Update) {
        for (let fired = 0; fired < newCompletedSteps; fired++) {
          if (fired > 0) from = to;
          else if (isInverse && !this.isBackwards) from = F(this.duration - from);
          to = isInverse ? 0 : this.duration;
          if (this.cycle(from, to, mode, useInverse, isInverse, true)) return true;
          if (this.loopType === DT_LOOP.Yoyo) isInverse = !isInverse;
        }
        if (cycles !== this.completedLoops || cyclePos !== this.position) return !this.active;
      } else {
        if (this.loopType === DT_LOOP.Yoyo && newCompletedSteps % 2 !== 0) { isInverse = !isInverse; from = F(this.duration - from); }
        newCompletedSteps = 0;
      }
    }
    if (newCompletedSteps === 1 && this.isComplete) return false;
    if (newCompletedSteps > 0 && !this.isComplete) {
      from = useInverse ? this.duration : 0;
      if (this.loopType === DT_LOOP.Restart && to > 0) this.cycle(this.duration, 0, DT_MODE.Goto, false, false, false);
    } else from = useInverse ? F(this.duration - prevPos) : prevPos;
    return this.cycle(from, useInverse ? F(this.duration - newPos) : newPos, mode, useInverse, isInverse);
  }

  // Sequence.ApplyInternalCycle: true when the Sequence must be killed
  cycle(fromPos, toPos, mode, useInverse, prevPosIsInverse) {
    const wasPlaying = this.isPlaying;
    const o = this.objs;
    const failed = (t, i) => {                // a nested tween that failed: removed (TryToPreserveSequence)
      if (this.sequencedTweens.length === 1 && o.length === 1) return true;
      this.mgr.despawn(t, false);
      o.splice(i, 1);
      this.sequencedTweens.splice(this.sequencedTweens.indexOf(t), 1);
      return false;
    };
    if (toPos < fromPos) {
      for (let i = o.length - 1; i > -1; --i) {
        if (!this.active) return true;
        if (!this.isPlaying && wasPlaying) return false;
        const s = o[i];
        if (s.sequencedEndPosition < toPos || s.sequencedPosition > fromPos) continue;
        if (s.tweenType === DT_TYPE.Callback) {
          if (mode === DT_MODE.Update && prevPosIsInverse) s.onStart();
          continue;
        }
        let g = F(toPos - s.sequencedPosition);
        if (g < 0) g = 0;
        if (!s.startupDone) continue;
        s.isBackwards = true;
        if (s.goto(g, false, mode) && failed(s, i)) return true;
      }
    } else {
      for (let i = 0; i < o.length; ++i) {
        if (!this.active) return true;
        if (!this.isPlaying && wasPlaying) return false;
        const s = o[i];
        if (s.sequencedPosition > toPos || s.sequencedPosition > 0 && s.sequencedEndPosition <= fromPos ||
            s.sequencedPosition <= 0 && s.sequencedEndPosition < fromPos) continue;
        if (s.tweenType === DT_TYPE.Callback) {
          if (mode === DT_MODE.Update && (!this.isBackwards && !useInverse && !prevPosIsInverse || this.isBackwards && useInverse && !prevPosIsInverse))
            s.onStart();
          continue;
        }
        let g = F(toPos - s.sequencedPosition);
        if (g < 0) g = 0;
        if (toPos >= s.sequencedEndPosition) {
          if (!s.startupDone) s.startup();        // TweenManager.ForceInit (nested)
          if (g < s.fullDuration) g = s.fullDuration;
        }
        s.isBackwards = false;
        if (s.goto(g, false, mode)) { if (failed(s, i)) return true; i--; }
      }
    }
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ plugins
const V = (keys) => ({
  start: (t, v) => Object.fromEntries(keys.map((k) => [k, F(v[k])])),
  change(t) { t.changeValue = Object.fromEntries(keys.map((k) => [k, F(t.endValue[k] - t.startValue[k])])); },
  apply(t, p) {
    const e = t.ease(p), s = t.startValue, c = t.changeValue;
    t.setter(Object.fromEntries(keys.map((k) => [k, F(s[k] + F(c[k] * e))])));
  },
});
export const DT_PLUGIN = {
  float: {
    start: (t, v) => F(v),
    change(t) { t.changeValue = F(t.endValue - t.startValue); },
    apply(t, p) { t.setter(F(t.startValue + F(t.changeValue * t.ease(p)))); },
  },
  vector2: V(["x", "y"]),
  vector3: V(["x", "y", "z"]),
  color: V(["r", "g", "b", "a"]),
  // ColorPlugin with ColorOptions.alphaOnly: the rgb of the current colour is kept each update
  alpha: {
    start: (t, v) => ({ r: F(v.r), g: F(v.g), b: F(v.b), a: F(v.a) }),
    change(t) { t.changeValue = { a: F(t.endValue - t.startValue.a) }; },
    apply(t, p) { const c = t.getter(); t.setter({ ...c, a: F(t.startValue.a + F(t.changeValue.a * t.ease(p))) }); },
  },
};

// Vector3ArrayPlugin (DOTween.ToArray: punch and shake waypoints) with SpecialPluginsUtils.SetPunch / SetShake
const arrayPlugin = (durations, shake) => ({
  special(t) {                            // SetPunch: endValues += current value; forced ease OutQuad (shake: Linear)
    const v = t.getter();
    t.isRelative = t.isSpeedBased = false;
    t.easeType = shake ? 1 : 6;
    t.endValue = t.endValue.map((e) => ({ x: F(e.x + v.x), y: F(e.y + v.y), z: F(e.z + v.z) }));
    return true;
  },
  start: (t, v) => t.endValue.map((e, i) => (i === 0 ? { x: F(v.x), y: F(v.y), z: F(v.z) } : { ...t.endValue[i - 1] })),
  change(t) {
    t.changeValue = t.endValue.map((e, i) => ({ x: F(e.x - t.startValue[i].x), y: F(e.y - t.startValue[i].y), z: F(e.z - t.startValue[i].z) }));
  },
  apply(t, elapsed) {
    let idx = 0, segElapsed = 0, segDur = 0, count = 0;
    for (let i = 0; i < durations.length; i++) {
      segDur = durations[i]; count = F(count + segDur);
      if (elapsed > count) { segElapsed = F(segElapsed + segDur); continue; }
      idx = i; segElapsed = F(elapsed - segElapsed);
      break;
    }
    const e = t.ease(segElapsed, segDur), s = t.startValue[idx], c = t.changeValue[idx];
    t.setter({ x: F(s.x + F(c.x * e)), y: F(s.y + F(c.y * e)), z: F(s.z + F(c.z * e)) });
  },
});

const toArray = (mgr, get, set, ends, durations, shake) => {
  let total = 0;
  for (const d of durations) total = F(total + d);
  const t = new DTweener(mgr, get, set, ends, total, arrayPlugin(durations, shake));
  t.specialStartupMode = shake ? 2 : 3;
  return t;
};

// DOTween.Punch(getter, setter, direction, duration, vibrato, elasticity)
export const dtPunch = (mgr, get, set, dir, duration, vibrato = 10, elasticity = 1) => {
  const el = elasticity > 1 ? 1 : elasticity < 0 ? 0 : elasticity;
  const prod = F(vibrato * duration);
  let n = Math.trunc(prod);
  if (n < 2 || prod === Infinity) n = 2;
  const sq = F(F(F(dir.x * dir.x) + F(dir.y * dir.y)) + F(dir.z * dir.z));
  let strength = F(Math.sqrt(sq));
  const decay = F(strength / n), m0 = strength;
  const nrm = { x: F(dir.x / m0), y: F(dir.y / m0), z: F(dir.z / m0) };
  const clampMag = (len) => (F(len * len) < sq ? { x: F(nrm.x * len), y: F(nrm.y * len), z: F(nrm.z * len) } : { ...dir });
  const durations = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const d = F(F((i + 1) / n) * duration); sum = F(sum + d); durations.push(d); }
  for (let i = 0; i < n; i++) durations[i] = F(F(duration / sum) * durations[i]);
  const ends = [];
  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      if (i === 0) ends.push({ x: F(dir.x), y: F(dir.y), z: F(dir.z) });
      else if (i % 2) { const v = clampMag(F(strength * el)); ends.push({ x: -v.x, y: -v.y, z: -v.z }); }
      else ends.push(clampMag(strength));
      strength = F(strength - decay);
    } else ends.push({ x: 0, y: 0, z: 0 });
  }
  return toArray(mgr, get, set, ends, durations, false);
};

// DOTween.Shake(getter, setter, duration, Vector3 strength, vibrato, randomness, fadeOut, randomnessMode): vector based;
// ShakeRandomnessMode 0 Full, 1 Harmonic
export const dtShake = (mgr, random, get, set, duration, strength, vibrato, randomness, fadeOut, mode = 0) => {
  if (mode !== 0 && mode !== 1) unsupported(`ShakeRandomnessMode ${mode}`);
  const { ends, durations } = shakeWaypoints(duration, strength, vibrato, randomness, false, true, fadeOut, random, mode === 1);
  return toArray(mgr, get, set, ends, durations, true);
};

// DOTween.To for a Transform rotation (QuaternionPlugin, RotateMode.Fast, not relative): get / set the Euler angles
// (the setter applies Quaternion.Euler); the end value adapted to 360 and the shortest way per axis.
// ENGINE: Quaternion.eulerAngles / Quaternion.Euler are native.
export const dtRotate = (mgr, get, set, end, duration) => new DTweener(mgr, get, set, end, duration, {
  start: (t, v) => ({ x: F(v.x), y: F(v.y), z: F(v.z) }),
  change(t) {
    const ev = { ...t.endValue };
    for (const k of ["x", "y", "z"]) if (ev[k] > 360) ev[k] = F(ev[k] % 360);
    t.changeValue = {};
    for (const k of ["x", "y", "z"]) {
      let c = F(ev[k] - t.startValue[k]);
      const abs = Math.abs(c);
      if (abs > 180) c = c > 0 ? F(-(360 - abs)) : F(360 - abs);
      t.changeValue[k] = c;
    }
  },
  apply(t, p) {
    const e = t.ease(p), s = t.startValue, c = t.changeValue;
    t.setter({ x: F(s.x + F(c.x * e)), y: F(s.y + F(c.y * e)), z: F(s.z + F(c.z * e)) });
  },
});

export const dtTo = (mgr, get, set, end, duration, plugin) => new DTweener(mgr, get, set, end, duration, plugin);

// the DOTween manager of a story context (the tweens of stills, the video view and the still view)
export const storyDOTween = (ctx) => featureSlot(ctx, "dotween", () => {
  const m = new DTManager(ctx.loop);
  featureState(ctx).disposers.push(() => m.dispose());
  return m;
});
