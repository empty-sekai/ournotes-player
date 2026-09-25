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

  // UniTask.Delay(sec) (scaled delta time): the frame it is created in does not
  // count; each later Update tick adds deltaTime until elapsed >= sec.
  // Resolves true on completion, false when cancelled.
  delay(sec) {
    if (!(sec > 0)) return Promise.resolve(true);
    return new Promise((res) => this._delays.push({ sec, elapsed: 0, created: this.frameCount, res }));
  }

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
      if (d.created === this.frameCount) { keep.push(d); continue; }
      d.elapsed += this.deltaTime;
      if (d.elapsed >= d.sec) d.res(true); else keep.push(d);
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
