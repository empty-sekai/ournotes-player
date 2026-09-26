import { StoryCommandError } from "../interfaces.js";
import { storyEffects, tryPlace } from "../features/effect.js";

// Effect (AdvEffectCommand.Execute / SetEffect): synchronous; never waits (Duration, DelaySeconds and IsNoWait are not
// read). The effect of TargetName toggles: playing with a blank Parameter2 -> stop ("atonce", any case: at once);
// not playing -> placed by the first canvas layer (Character when none) and PositionType, then played at the
// playback rate; a non-blank Parameter2 then plays that Animator state (a warning when it has none). A TargetName
// without an instance fails the row (the game dereferences null).
export const Effect = (c, p) => {
  const fx = storyEffects(p.ctx), effect = fx.get(c.TargetName);
  if (!effect) throw new StoryCommandError(`Effect: ${c.TargetName ?? ""} is not loaded`);
  const state = c.Parameter2 ?? "", noState = state.trim() === "";
  if (effect.isPlaying && noState) {
    effect.stop((c.Parameter1 ?? "").toLowerCase() === "atonce", p.ctx.loop);
    return Promise.resolve();
  }
  if (!effect.isPlaying) {
    const layers = c.CanvasLayers || [];
    if (!tryPlace(fx, effect, layers.length < 1 ? 2 : layers[0], c.PositionType || 0, p)) return Promise.resolve();
    effect.play(p.speedRate());
  }
  if (!noState && !effect.tryPlayAnimatorState(state))
    console.warn(`Effect: Animator state not found, plays normally (row ${c.i}, ${c.TargetName}, ${state})`);
  return Promise.resolve();
};
