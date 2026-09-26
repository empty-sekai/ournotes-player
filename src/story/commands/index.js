import { Focus, PanV2, Pedestal, Track, Zoom } from "./camera.js";
import { Character, In, Look, LookTarget, Motion, MoveToDirection, Out } from "./character.js";
import { MISC_COMMANDS } from "./misc.js";
import { Stage } from "./scene.js";
import { Bgm, Se } from "./sound.js";
import { Location, Talk } from "./talk.js";
import { FadeIn, FadeOut } from "./transition.js";
import { TalkWindow } from "./ui.js";

// The commands built into the story player, by AdvCommand name (registered by player-core.js).
export const BUILTIN_COMMANDS = {
  In, Out, Talk, FadeOut, FadeIn, Focus, Bgm, Location, Motion, Character, Stage, Se, TalkWindow, Look, LookTarget,
  Pedestal, Track, Zoom, MoveToDirection, PanV2, ...MISC_COMMANDS,
};
