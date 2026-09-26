import { StoryCommandError } from "../interfaces.js";

// MotionLoop (AdvMotionLoopCommand): a character's parameter loop (Live2DCharacterController.PlayParameterLoop /
// StopParameterLoop); synchronous. Parameter1 "stop" (ordinal, ignore case) stops it, else MotionName plays; the fade
// is MotionFadeIn (0 while shortcutting). The game dereferences the controller unchecked: a TargetName without a loaded
// character fails the row.
export const MotionLoop = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (!ch) throw new StoryCommandError(`MotionLoop: character ${c.TargetName} is not loaded`);
  const fade = p.shortcut ? 0 : (c.MotionFadeIn || 0);
  if ((c.Parameter1 ?? "").toLowerCase() === "stop") ch.stopParameterLoop(fade);
  else ch.playParameterLoop(c.MotionName ?? "", fade);
  return Promise.resolve();
};
