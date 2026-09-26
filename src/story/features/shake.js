import { doShakePosition } from "./dotween.js";
import { featureSlot } from "./state.js";

// Shakes of the story screen: AdvFieldBase.Shake / StopShake (the character and background fields' roots), the still
// and talk window shakes of the front canvas (AdvStillView.Shake, AdvTalkView.ShakeTalk) and the main camera's
// CameraShakeController (Fwk.Cam), all DOTween shakes (dotween.js) on the loop's DOTween runner.

// A DOShakePosition target with the StopShake reset of its owner: get / set the shaken position, rest() the position
// StopShake restores (AdvFieldBase: localPosition = zero; the UI views: anchoredPosition = zero).
export class ShakeTarget {
  constructor(get, set, rest) { this.get = get; this.set = set; this.rest = rest; this.tween = null; }

  // AdvFieldBase.Shake / AdvStillView.Shake / AdvTalkView.ShakeTalk: StopShake, then a new shake (none for duration <= 0)
  shake(runner, random, duration, strength) {
    this.stop();
    this.tween = doShakePosition(runner, random, this.get, this.set, duration, strength, 10, 90, true);
    return this.tween;
  }

  // StopShake: DOKill (the tween does not complete) and the rest position
  stop() {
    if (this.tween) { this.tween.kill(); this.tween = null; }
    this.set(this.rest());
  }
}

// a Transform's localPosition as a shake target (the field roots rest at zero)
export const transformShakeTarget = (t) => new ShakeTarget(
  () => ({ ...t.localPosition }), (v) => { t.localPosition = { ...v }; }, () => ({ x: 0, y: 0, z: 0 }));

// Fwk.Cam.CameraShakeController on the camera manager's transform (the main camera's parent, at rest at the origin):
// the shake is an offset of the camera (ctx.camera.setShakeOffset). State Idle 0 / Playing 1 / Stopping 2.
export class CameraShakeController {
  constructor(loop, camera, random) {
    this.loop = loop; this.camera = camera; this.random = random;
    this.state = 0;
    this.position = { x: 0, y: 0, z: 0 };   // CameraManager localPosition (original: zero)
    this.run = 0;                            // cancellation generation (RefreshCameraShakeCancellationToken)
    this.tween = null;
    this.shakeDuration = 0; this.strength = null; this.vibrato = 10; this.randomness = 90;
    this.enableStart = 0; this.disableStart = 0; this.fadeDuration = 0;
  }

  get isPlaying() { return this.state === 1; }

  _apply() {
    const p = this.position;
    this.camera.setShakeOffset(p.x === 0 && p.y === 0 && p.z === 0 ? null : { ...p });
  }

  _refresh() {
    this.run++;
    if (this.tween) { this.tween.kill(); this.tween = null; }
    return this.run;
  }

  // one DOShakePosition cycle (fadeOut false, independent update) with an OnUpdate weight on the offset
  _cycle(weight) {
    const t = doShakePosition(this.loop.tweens, this.random, () => ({ ...this.position }), (v) => { this.position = v; },
                              this.shakeDuration, this.strength, this.vibrato, this.randomness, false, () => {
                                const w = weight(), p = this.position;
                                this.position = { x: w * p.x, y: w * p.y, z: w * p.z };   // original + w (p - original)
                                this._apply();
                              });
    this.tween = t;
    return t;
  }

  // EnableCameraShake(fadeDuration, shakeDuration, strength, vibrato, randomness)
  async enable(fade, shakeDuration, strength, vibrato, randomness) {
    if (this.state !== 1) {
      this.enableStart = this.loop.time; this.state = 1; this.fadeDuration = fade;
      this.shakeDuration = shakeDuration; this.strength = { ...strength }; this.vibrato = vibrato; this.randomness = randomness;
    }
    const run = this._refresh();
    const weight = () => {
      if (!(this.fadeDuration > 0)) return 1;
      const k = (this.loop.time - this.enableStart) / this.fadeDuration;
      return k > 1 ? 1 : k < 0 ? 0 : k;
    };
    while (run === this.run) {
      const t = this._cycle(weight);
      if (!t || !await t.promise || run !== this.run) return;
      await this.loop.yield("Update");                                  // UniTask.NextFrame
    }
  }

  // DisableCameraShake(fadeDuration): shake cycles with a falling weight until the fade time has passed, then rest
  async disable(fade) {
    if (this.state !== 2) { this.disableStart = this.loop.time; this.state = 2; this.fadeDuration = fade; }
    const run = this._refresh();
    const weight = () => {
      if (!(this.fadeDuration > 0)) return 0;
      const k = 1 - (this.loop.time - this.disableStart) / this.fadeDuration;
      return k > 1 ? 1 : k < 0 ? 0 : k;
    };
    const t = this._cycle(weight);
    if (t && !await t.promise) return;
    if (run !== this.run) return;
    if (this.loop.time - this.disableStart < this.fadeDuration) { await this.disable(this.fadeDuration); return; }
    this.position = { x: 0, y: 0, z: 0 }; this._apply();
    this.state = 0;
  }

  // ResetCameraShake
  reset() {
    this._refresh();
    this.state = 0; this.shakeDuration = 0; this.strength = null; this.vibrato = 0; this.randomness = 0;
    this.enableStart = 0; this.fadeDuration = 0;
    this.position = { x: 0, y: 0, z: 0 }; this._apply();
  }
}

// the shake targets of a story context
export const shakes = (ctx) => featureSlot(ctx, "shake", (s) => ({
  characterField: transformShakeTarget(ctx.field.root),
  backgroundField: transformShakeTarget(ctx.background.root),
  camera: new CameraShakeController(ctx.loop, ctx.camera, s.random),
  still: null,                    // set by the still view (AdvStillView._target)
  talk: null,                     // the talk window (AdvTalkView._talkWindow), from the UI when it offers one
  shakeGeneration: 0,             // AdvPlaybackSession.RefreshShakeCancellationToken
}));

// the talk window's shake target: StoryUI.talkShakeTarget() -> {get, set} of the window's local position offset
export const talkShakeTarget = (ctx) => {
  const sh = shakes(ctx);
  if (!sh.talk && typeof ctx.ui.talkShakeTarget === "function") {
    const t = ctx.ui.talkShakeTarget();
    if (t) sh.talk = new ShakeTarget(t.get, t.set, () => ({ x: 0, y: 0, z: 0 }));
  }
  return sh.talk;
};

// UIAdvWidget.StopShake + AdvFieldBase.StopShake of both fields + CameraManager.ResetPosition(clearCameraShake)
export const stopAllShakes = (ctx) => {
  const sh = shakes(ctx);
  sh.characterField.stop(); sh.backgroundField.stop();
  if (sh.still) sh.still.stop();
  if (sh.talk) sh.talk.stop();
  sh.camera.reset();
};
