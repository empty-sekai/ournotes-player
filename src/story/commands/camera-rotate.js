import { floatParam } from "../params.js";
import { cameraPrologue } from "./camera.js";
import { featureSlot } from "../features/state.js";

// Tilt, Role and Pan (AdvTiltCommand, AdvRoleCommand, AdvPanCommand): camera rotations after the camera commands'
// prologue (nothing in Overlay playback mode, then DelaySeconds). The game also rotates the camera manager's sub
// camera, which draws nothing of the story field; only the main camera is reproduced.

// AdvFieldBase rotation state (RotateX / RotateY): _field.localEulerAngles = (_currentX, _currentY, current z)
class FieldRotation {
  constructor(loop, t) { this.loop = loop; this.t = t; this.x = 0; this.y = 0; this.tweenY = null; }
  update() { const z = this.t.localEuler ? this.t.localEuler.z : 0; this.t.setLocalEuler(this.x, this.y, z); }
  // AdvFieldBase.RotateY(target, duration, ease): kill the running tween; DOTween.To(_currentY -> target).SetEase(ease)
  rotateY(target, dur, ease) {
    if (this.tweenY) { this.tweenY.kill(); this.tweenY = null; }
    if (!(dur > 0)) { this.y = target; this.update(); return Promise.resolve(); }
    const t = this.tweenY = this.loop.tweens.to(() => this.y, target, dur, ease, (v) => { this.y = v; this.update(); });
    return t.promise;
  }
}

export const fieldRotations = (ctx) => featureSlot(ctx, "fieldRotation", () => ({
  character: new FieldRotation(ctx.loop, ctx.field.field),
  background: new FieldRotation(ctx.loop, ctx.background.field),
}));

const camera = (ctx, method) => {
  const cam = ctx.camera;
  if (typeof cam[method] !== "function") throw new Error(`the story camera has no ${method}`);
  return cam;
};

// AdvTiltCommand.Tilt: main camera RotateX(-Parameter1) (ease Parameter2, default OutQuad)
export const Tilt = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0);
  await camera(p.ctx, "rotateX").rotateX(-floatParam(c.Parameter1), dur, ease);
})());

// AdvRoleCommand.Role: main camera RotateZ(Parameter1)
export const Role = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0);
  await camera(p.ctx, "rotateZ").rotateZ(floatParam(c.Parameter1), dur, ease);
})());

// AdvPanCommand.Pan: main camera RotateY(Parameter1) with the character and background fields' RotateY
export const Pan = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0), y = floatParam(c.Parameter1);
  const f = fieldRotations(p.ctx);
  await Promise.all([p.ctx.camera.rotateY(y, dur, ease), f.character.rotateY(y, dur, ease),
                     f.background.rotateY(y, dur, ease)]);
})());
