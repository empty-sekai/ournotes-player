import { StoryCommandError } from "../interfaces.js";

// Timeline (AdvTimelineCommand): a Unity Timeline asset on the scene's AdvPlayableDirector, with ADV rows delivered by
// its markers. Timeline assets are not part of the story data (no episode names one), so a row that reaches the
// player fails instead of being skipped.
export const Timeline = (c) => Promise.reject(new StoryCommandError(`Timeline: timeline ${c.TargetAssetName ?? ""} is not in the story data`));
