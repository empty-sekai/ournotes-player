import { EASE } from "../../engine/tween.js";
import { floatParam } from "../params.js";

// Angle (AdvAngleCommand): a character's head / body angle override (additive), eased over the row's Duration after
// DelaySeconds. No Overlay check: it also runs in Overlay episodes.
export const Angle = (c, p) => p.noWait(c, (async () => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (!ch) return;
  const angle = floatParam(c.Parameter1), body = floatParam(c.Parameter2);
  ch.setOverrideAngleEnabled(true, true);                               // SetOverrideAngleEnabled(true, isAdditive: true)
  if (!await p.delay(p.calcDuration(c.DelaySeconds || 0, 0))) return;
  if (!ch.isAlive) return;
  const dur = p.calcDuration(c.Duration || 0, 0);
  // Live2DCharacterController.SmoothRotateToAngle(angle, body, duration, RefreshAngleCancellationToken(), InOutQuad):
  // a running rotation of the character ends first
  await ch.smoothRotateToAngle(angle, body, dur, EASE.InOutQuad);
})());
