import { htmlColor } from "../params.js";

// AdvFadeOutCommand / AdvFadeInCommand: the rule transition of TargetAssetName (the player settings' default when
// empty) in the colour of Parameter1 over Duration (UIRuleTransitionView). FadeOut ignores IsNoWait (always awaited).

const settings = (c, p) => p.ctx.ui.transitionSettings(c.TargetAssetName || p.ctx.settings.player._defaultTransitionAssetAddress);

export const FadeOut = (c, p) => p.ctx.ui.fadeOut(settings(c, p), htmlColor(c.Parameter1), p.calcDuration(c.Duration || 0, 0));

export const FadeIn = (c, p) =>
  p.noWait(c, p.ctx.ui.fadeIn(settings(c, p), htmlColor(c.Parameter1), p.calcDuration(c.Duration || 0, 0)));
