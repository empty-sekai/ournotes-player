import { Tweens } from "./tween.js";

// PlayerLoop: a fixed-step frame loop with Unity's phase order, the UniTask waits (Delay, DelayFrame, Yield)
// and the DOTween runner.
//
// One step = one player-loop frame at a fixed delta time (1 / frameRate; the live session
// steps at 60). Phases, in order:
//   Update       UniTask PlayerLoopTiming.Update: the yield queue, then the runner
//                (delays, frame waits). PlayerLoopHelper.Initialize inserts
//                both with injectOnFirst = true, i.e. before ScriptRunBehaviourUpdate.
//                Waiters added while it runs start on the next frame.
//   update       GameMain.Update chain (LiveManager.OnUpdate -> the live state machine's
//                current node)
//   tweens       DOTween Update (DOTweenComponent.Update, scaled delta time), plus
//                "tweens" hooks for tween runners kept outside Tweens
//   animation    PreLateUpdate DirectorUpdateAnimation (Animators, PlayableDirectors),
//                then the ParticleSystem update
//   lateUpdate   GameMain.LateUpdate chain
//   preLateEnd   end of PreLateUpdate
//   PostLateUpdate UniTask continuations, then the render hooks
// GameMain (Fwk.GameLoop) and DOTweenComponent are both MonoBehaviour Updates with
// execution order 0 (GameMain MonoScript m_ExecutionOrder 0; DOTweenComponent is
// added at runtime with no order).
// ENGINE: two order-0 MonoBehaviour Updates run in an unspecified order; GameMain runs first here.
//
// Continuations resumed in a phase run before the next phase starts: every phase
// ends with a drain that waits for the microtask queue to empty.

export const drain = () => new Promise((res) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); res(); };
  ch.port2.postMessage(0);
});

// (float)TimeSpan.FromSeconds(sec).TotalSeconds: TimeSpan.Interval(sec, 1000) rounds to whole milliseconds (half away
// from zero, then truncated), TotalSeconds = ticks x 1e-7 in double. NaN (ArgumentException) and a value outside
// Int64.MaxValue / 10000 milliseconds (OverflowException) throw.
export const uniTaskDelaySeconds = (sec) => {
  if (typeof sec !== "number") throw new TypeError(`delay seconds must be a number (got ${sec})`);
  if (Number.isNaN(sec)) throw new RangeError("TimeSpan does not accept floating point Not-a-Number values.");
  const millis = 1000 * sec + (0 <= sec ? 0.5 : -0.5);
  if (!(millis <= 922337203685477 && -922337203685477 <= millis))
    throw new RangeError("TimeSpan overflowed because the duration is too long.");
  return Math.fround(Math.trunc(millis) * 10000 * 1e-7);
};

export class PlayerLoop {
  constructor(frameRate = 30) {
    this.fixedDelta = 1 / frameRate;
    this.timeScale = 1;               // Time.timeScale: deltaTime = fixedDelta x timeScale (playback speed)
    this.time = 0;                    // Time.time
    this.deltaTime = 0;               // Time.deltaTime
    this.frameCount = 0;              // Time.frameCount
    this.tweens = new Tweens();
    this.hooks = { update: [], tweens: [], animation: [], lateUpdate: [], preLateEnd: [], postLate: [], render: [] };
    this._delays = [];                // UniTask.Delay (DeltaTime) at PlayerLoopTiming.Update
    this._yields = { Update: [], PostLateUpdate: [] };
    this._frameWaits = [];            // UniTask.DelayFrame at PlayerLoopTiming.Update
  }

  on(phase, fn) { this.hooks[phase].push(fn); }

  // UniTask.Delay(TimeSpan.FromSeconds(sec)) (DelayType.DeltaTime, PlayerLoopTiming.Update; DelayPromise): the wait is
  // (float)TimeSpan.FromSeconds(sec).TotalSeconds, i.e. whole milliseconds (uniTaskDelaySeconds); the frame it is
  // created in does not count (elapsed still 0 in that frame); each later Update tick adds Time.deltaTime to a float32
  // elapsed until wait <= elapsed. A zero wait has no shortcut: it completes at the first Update tick after the
  // creating frame. A negative wait throws (ArgumentOutOfRangeException). Resolves true on completion, false when
  // cancelled.
  delay(sec) {
    if (uniTaskDelaySeconds(sec) < 0)
      throw new RangeError(`Delay does not allow minus delayTimeSpan. delayTimeSpan:${sec} s`);
    return new Promise((res) => this._delays.push(this._delayEntry(sec, res)));
  }

  // an entry of the delay queue ({sec, elapsed, created, res}); queued by delay(), or by a caller that cancels its
  // own entries
  _delayEntry(sec, res) { return { sec, elapsed: 0, created: this.frameCount, res }; }

  delayFrame(n) {
    return new Promise((res) => this._frameWaits.push({ target: this.frameCount + n, res }));
  }

  yield(phase) { return new Promise((res) => this._yields[phase].push(res)); }

  cancelDelays() {
    for (const d of this._delays) d.res(false);
    this._delays = [];
  }

  _tickUpdateWaiters() {
    const ys = this._yields.Update; this._yields.Update = [];     // UniTaskLoopRunnerYieldUpdate
    for (const r of ys) r();
    const keep = [];                                                 // UniTaskLoopRunnerUpdate
    for (const d of this._delays) {
      if (d.elapsed === 0 && d.created === this.frameCount) { keep.push(d); continue; }
      d.elapsed = Math.fround(d.elapsed + Math.fround(this.deltaTime));
      if (uniTaskDelaySeconds(d.sec) <= d.elapsed) d.res(true); else keep.push(d);
    }
    this._delays = keep;
    const fw = [];
    for (const w of this._frameWaits) (this.frameCount >= w.target ? w.res() : fw.push(w));
    this._frameWaits = fw;
  }

  // deltaTime of the next step
  stepDelta() { return this.timeScale === 1 ? this.fixedDelta : this.fixedDelta * this.timeScale; }

  async step() {
    const dt = this.stepDelta();
    this.frameCount++;
    this.deltaTime = dt;
    this.time = Math.fround(this.time + dt);
    this._tickUpdateWaiters();
    await drain();
    for (const h of this.hooks.update) h(this);
    await drain();
    this.tweens.update(dt);
    for (const h of this.hooks.tweens) h(this);
    await drain();
    for (const h of this.hooks.animation) h(this);
    for (const h of this.hooks.lateUpdate) h(this);
    for (const h of this.hooks.preLateEnd) h(this);
    for (const h of this.hooks.postLate) h(this);
    const ys = this._yields.PostLateUpdate; this._yields.PostLateUpdate = [];
    for (const r of ys) r();
    await drain();
    for (const h of this.hooks.render) h(this);
  }
};
