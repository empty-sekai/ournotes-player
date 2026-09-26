// Public API of ournotes-player/story: the story (ADV) player.
//   StoryPlayer            a story in a host element (canvas, control bar, requestAnimationFrame, events)
//   defineOurnotesStory    defines the <ournotes-story> custom element (the "ournotes-player/story/element" entry
//                          defines it on import)
//   StorySession           the DOM-free story session over a WebGL2 context, or headless (gl = null); an Overlay
//                          episode gets a SimpleStorySession (the game's simple player in its host screen)
//   AssetStore             the files of one story (loadStoryStore: from a story manifest and one language)
//   registerCommand        adds the handler of an AdvCommand (interfaces.js: the command registry, StoryContext,
//                          StoryUI)
// The page must load Live2D Cubism Core (Live2D's live2dcubismcore.min.js) itself, and for the voices' lip sync
// Live2D's MotionSync Core; neither is part of this package.
export { AssetStore } from "../data/assets.js";
export { STORY_MANIFEST_FORMAT, fetchStoryManifest, loadStoryStore } from "./assets.js";
export { ADV_CANVAS_LAYER, ADV_COMMAND, ADV_PLAYBACK_MODE, ADV_PLAYBACK_SPEED, ADV_PLAYBACK_SPEEDS, STORY_FRAME_RATE,
         StoryCommandError, StoryUILayer, checkStoryUI, createStoryUILayers, registerCommand, registeredCommands,
         unregisteredCommands } from "./interfaces.js";
export { StoryPlayerCore } from "./player-core.js";
export { STORY_LANGUAGES, StorySession, advViewport, storyLines } from "./session.js";
export { SimpleStorySession } from "./simple/session.js";
export { StoryPlayer } from "./player.js";
export { STORY_STRINGS, storyStrings } from "./strings.js";
export { OurnotesStoryElement, defineOurnotesStory, parseStorySpeed } from "./element.js";
