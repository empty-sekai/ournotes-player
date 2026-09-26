import { floatParam } from "../params.js";
import { postEffects, toggleVolume } from "../features/posteffect.js";

// PostEffect (AdvPostEffectCommand.Execute): fade = CalcDuration(Parameter1), or CalcDuration(Duration) when that is
// <= 0; the preloaded VolumeProfile of TargetAssetName (null when not loaded: every post effect fades out) goes to
// AdvGlobalVolume.ToggleVolume. Never waits (IsNoWait, DelaySeconds and the playback mode are not read).
export const PostEffect = (c, p) => {
  let fade = p.calcDuration(floatParam(c.Parameter1), 0);
  if (fade <= 0) fade = p.calcDuration(c.Duration || 0, 0);
  const profile = postEffects(p.ctx).profiles.get(c.TargetAssetName ?? "") || null;
  toggleVolume(p.ctx, profile, fade);
  return Promise.resolve();
};
