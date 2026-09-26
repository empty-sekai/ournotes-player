import { StoryCommandError } from "../interfaces.js";
import { floatParam, intParam } from "../params.js";
import { DTCancelled } from "../features/dotween-core.js";
import { stillView } from "../features/still.js";

const clamp01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v);

// Still (AdvStillCommand.Execute / SetStill): fade = CalcDuration(Parameter1) (Duration is not read); the still of
// TargetAssetName is set on the view (reparented, last sibling) before the toggle: a showing still hides with the
// view's fade to 0; a hidden one shows at alpha Parameter2 (<= 0 or unparsable: 1, at most 1) playing sequence
// Parameter3, with the view's overlay fading to Clamp01(Parameter4). The row awaits both fades (IsNoWait: not). No
// pre-delay, playback-mode or quality check. A TargetAssetName that is not loaded fails the row (the game dereferences
// null). A playback stop cancels the fades; the still then stays as it was.
export const Still = (c, p) => p.noWait(c, (async () => {
  const fade = p.calcDuration(floatParam(c.Parameter1), 0);
  const view = stillView(p.ctx), still = view.loaded(c.TargetAssetName);
  if (!still) throw new StoryCommandError(`Still: ${c.TargetAssetName ?? ""} is not loaded`);
  view.setStill(still);
  const cancelled = () => p.cancelled;
  try {
    if (still.isShowing) {
      await Promise.all([still.hide(fade, cancelled), view.fadeToStill(0, fade, false, cancelled)]);
    } else {
      const p2 = floatParam(c.Parameter2);
      const alpha = p2 <= 0 ? 1 : Math.min(p2, 1);
      const screenAlpha = clamp01(floatParam(c.Parameter4));
      await Promise.all([still.show(alpha, fade, intParam(c.Parameter3), cancelled), view.fadeToStill(screenAlpha, fade, true, cancelled)]);
    }
  } catch (e) {
    if (!(e instanceof DTCancelled)) throw e;
  }
})());
