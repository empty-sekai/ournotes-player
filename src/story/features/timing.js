import { F } from "../../engine/core.js";

// Waits of the ADV helpers that the loop's UniTask.Delay does not cover.

// AdvPlayerHelper.DelayWithSpeedAdjustment(duration): while time remains, the remaining time is scaled by previous /
// current speed when the playback speed changed, then UniTask.NextFrame, then the frame's unscaled delta time is
// subtracted (the calling frame subtracts nothing). Resolves true when the time has run out, false when the playback
// stopped or stop() became true (observed after the NextFrame, as the cancelled token is).
// WaitWhileVideoSeekRespeedingAsync (before the speed check) returns at once: no video seek re-speed runs here.
export const delayWithSpeedAdjustment = async (p, duration, stop = null) => {
  const loop = p.ctx.loop;
  let remaining = F(duration), prev = p.speedRate();
  for (;;) {
    if (remaining <= 0) return true;
    const s = p.speedRate();
    if (s !== prev) { remaining = F(remaining * F(prev / s)); prev = s; }
    await loop.yield("Update");
    if (p.cancelled || (stop && stop())) return false;
    remaining = F(remaining - F(loop.deltaTime));
  }
};

// UniTask.WaitUntil(predicate) at PlayerLoopTiming.Update: checked once per frame from the next Update on
export const loopWaitUntil = async (loop, predicate, stop = null) => {
  for (;;) {
    await loop.yield("Update");
    if (stop && stop()) return false;
    if (predicate()) return true;
  }
};

export const waitUntil = (p, predicate, stop = null) =>
  loopWaitUntil(p.ctx.loop, predicate, () => p.cancelled || !!(stop && stop()));
