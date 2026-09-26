// The story (ADV) modules meet here: the game's enums, the command registry, and the two interfaces every story
// module is written against: StoryContext (what a command sees of the scene) and StoryUI (the front canvas the
// commands drive). The interpreter (player-core.js) implements the command side, ui*.js the StoryUI side;
// feature modules register further commands and attach views to the canvas layers.

export const STORY_FRAME_RATE = 30;             // AdvPlayerSettings target frame rate (Application.targetFrameRate)

// AdvSystem.AdvCommand (8 and 22 are not assigned)
export const ADV_COMMAND = ["In", "Out", "Talk", "Delay", "Shake", "FadeOut", "FadeIn", "Focus", null, "Forward", "Back",
  "Flash", "Brightness", "MoveToRight", "MoveToLeft", "Bgm", "SoundVolume", "Expression", "Pause", "Resume", "Location",
  "Motion", null, "Character", "Costume", "Stage", "Movie", "Clip", "Subtitles", "Wait", "Still", "Se", "Angle", "Pan",
  "Tilt", "TalkWindow", "ChatWindow", "ChatTalk", "ChatStamp", "ChatRead", "ChoiceSet", "ChoiceShow", "GoTo",
  "PostEffect", "Frame", "Timeline", "Look", "Pedestal", "Track", "DoF", "Role", "CameraShake", "Voice", "Zoom", "Effect",
  "Alpha", "ForceAuto", "StageEnv", "RimLight", "CancelDelay", "MoveToUp", "MoveToDown", "MoveToForward", "MoveToBack",
  "MoveToDirection", "ChatTyping", "LookTarget", "PanV2", "MotionLoop", "EyeBlink"];
const COMMAND_NAMES = new Set(ADV_COMMAND.filter(Boolean));

// AdvSystem.AdvPlaybackSpeed; the rate is value / 10 (AdvPlaybackSpeedExtensions.ToRate)
export const ADV_PLAYBACK_SPEED = { Normal: 10, OnePointFive: 15, OnePointSeven: 17, Double: 20 };
export const ADV_PLAYBACK_SPEEDS = Object.freeze([10, 15, 17, 20]);

// AdvSystem.AdvPlaybackMode (MasterAdv._playbackMode)
export const ADV_PLAYBACK_MODE = { Normal: 0, Overlay: 1 };

// AdvSystem.AdvCanvasLayer: the canvases of the story screen, back to front
export const ADV_CANVAS_LAYER = { Background: 0, Overlay: 1, Character: 2, Foreground: 3, Chat: 4, Frame: 5, Video: 6,
                                  Still: 7, Front: 8, Talk: 9 };

// An episode the player cannot play as the game does (an unregistered command, a mode or resource it does not
// reproduce). Raised before loading where it can be known then.
export class StoryCommandError extends Error {}

// ------------------------------------------------------------------------------------------------ command registry
// One handler per AdvCommand name: handler(c, player) runs the command record `c` (a row of episode.json `commands`,
// or of the player settings' initialize / finalize lists) on the StoryPlayerCore `player` (its `ctx` is the
// StoryContext) and returns what the game's Execute returns: a promise the interpreter awaits before the next row
// (resolved at once for a command that does not block, IsNoWait included: player.noWait(c, task)).
const registry = new Map();

// Registers the handler of an AdvCommand name. A name is registered once: a second registration raises (the
// built-in commands register when player-core.js loads).
export const registerCommand = (name, fn) => {
  if (!COMMAND_NAMES.has(name)) throw new StoryCommandError(`registerCommand: "${name}" is not an AdvCommand`);
  if (typeof fn !== "function") throw new TypeError(`registerCommand: the handler of ${name} is not a function`);
  if (registry.has(name)) throw new StoryCommandError(`registerCommand: ${name} is already registered`);
  registry.set(name, fn);
};

export const commandHandler = (name) => registry.get(name);

// the registered command names in AdvCommand order
export const registeredCommands = () => ADV_COMMAND.filter((n) => n && registry.has(n));

// the command names of `commands` (records with `cmd`, or names) that have no handler, in first-use order
export const unregisteredCommands = (commands) => {
  const out = [];
  for (const c of commands) {
    const name = typeof c === "string" ? c : c.cmd;
    if (!registry.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
};

// Refuses an episode whose commands are not all registered (before anything is loaded). IgnoreData rows are never
// executed (AdvPlayer.<Play> skips them) and do not count.
export const checkEpisodeCommands = (commands, what = "episode") => {
  const missing = unregisteredCommands(commands.filter((c) => typeof c === "string" || !c.IgnoreData));
  if (missing.length)
    throw new StoryCommandError(`${what}: commands not supported by this player: ${missing.join(", ")}`);
};

// ------------------------------------------------------------------------------------------------ StoryContext
// What a command handler reaches through player.ctx (created by the session; the fields do not change while an
// episode plays):
//   loop           PlayerLoop at 30 fps: time, deltaTime, frameCount, delay(sec), delayFrame(n), yield(phase), tweens
//   camera         the main camera (Fwk UniversalCamera behind CameraManager.MainCamera)        field.js
//   field          AdvCharacterField: slots, focus anchors, the character pool                     field.js
//   background     AdvBackgroundField                                                              field.js
//   fieldRenderer  AdvFieldRendererManager: per-slot alpha / brightness / blur, capture crossfade  field.js
//   volume         AdvGlobalVolume and the main camera's volume stack                             field.js
//   characters     StoryCharacters: the loaded Live2D characters by TargetName (costume index)    player-core.js
//   stages         asset name -> AdvStageData                                                     stage.js
//   ui             the StoryUI below
//   audio          the SoundManager (engine/audio.js) with the episode's sound resolver
//   quality        AdvQuality: the gates of the ADV quality level                                 field.js
//   settings       { player: AdvPlayerSettings, masterIds: AdvMasterIdSettings } (scene.json settings)
//   localize(id)   text id -> the text in the current language ("" when the id has no text)
//   lang           the current language: "ja" "en" "zh-Hant" "zh-Hans" "ko"
//   playbackMode   ADV_PLAYBACK_MODE of the episode (MasterAdv._playbackMode)
//   titleTextId    MasterAdv._titleTextId (0: no title)
//   episode        episode.json;  story  story.json (the story's index);  assets  the AssetStore of the story
//   renderer       StoryRenderer (renderer.js; null without a WebGL2 context): addFieldItems(source) for field items
//   gl             the WebGL2 context (null when headless)
export const STORY_CONTEXT_FIELDS = Object.freeze(["loop", "camera", "field", "background", "fieldRenderer", "volume",
  "characters", "stages", "ui", "audio", "quality", "settings", "localize", "lang", "playbackMode", "titleTextId",
  "episode", "story", "assets", "renderer", "gl"]);

export const createStoryContext = (parts) => {
  const ctx = {};
  for (const k of STORY_CONTEXT_FIELDS) {
    if (!(k in parts)) throw new TypeError(`StoryContext: "${k}" missing`);
    ctx[k] = parts[k];
  }
  for (const k of Object.keys(parts))
    if (!STORY_CONTEXT_FIELDS.includes(k)) throw new TypeError(`StoryContext: unknown field "${k}"`);
  return Object.seal(ctx);
};

// ------------------------------------------------------------------------------------------------ StoryUI
// The story screen's front canvas (UIAdvWidget and its views) as the commands drive it. Durations are game seconds
// already divided by the playback speed where the game divides them; promises resolve on the player loop.
//   load()                         GL resources (nothing to do with gl = null)             -> Promise
//   setTalkWindow(name)            UIAdvWidget.SetTalkWindow (TalkWindow command; the initial "UIDefaultTalkWindow");
//                                  raises StoryCommandError for a window it does not provide
//   showTalk(duration = 0.2)       AdvTalkView.ShowTalk
//   hideTalk(duration = 0.2)       AdvTalkView.HideTalk
//   hideTalkNextIndicator()        AdvTalkView.HideTalkNextIndicator
//   setSpeakerName(text)           AdvTalkView.SetSpeakerName (rich text: <color=...> per name)
//   setTalk(text)                  AdvTalkView.SetTalk + the typewriter it starts
//                                  -> { totalLength, finished: Promise, cancel() }   (cancel reveals the whole line)
//   isTyping                       getter: the current typewriter has not ended (AdvTalkView.IsTyping)
//   setAutoMode(on)                the talk view's auto flag (auto icon shown, next indicator hidden)
//   setFastIconActive(on)          UIAdvWidget.SetTalkWindowFastIconActive
//   setPlaybackSpeed(rate)         UIAdvWidget.SetPlaybackSpeed (rate = AdvPlaybackSpeed / 10)
//   showTitle(text)                AdvTitleView.ShowTitle                                   -> Promise
//   showLocation(text)             AdvLocationView.ShowLocation                             -> Promise
//   transitionSettings(address)    the RuleTransitionSettings of a transition asset address
//   fadeOut(settings, color, dur)  UIRuleTransitionView.FadeOut; color {r, g, b, a}          -> Promise
//   fadeIn(settings, color, dur)   UIRuleTransitionView.FadeIn                               -> Promise
//   fadeInLetterBox()              UIAdvWidget.FadeInLetterBoxIfNeededAsync                  -> Promise
//   render({gl, width, height})    the front canvas onto the bound target (the ADV viewport's post target)
//   renderLetterBox({gl, screenWidth, screenHeight, viewport})   the letterbox bands onto the default framebuffer
//   layers                         array indexed by ADV_CANVAS_LAYER of StoryUILayer: add(view) / remove(view); a view
//                                  is { render({gl, width, height, canvasWidth, canvasHeight}), update?(dt) } and draws
//                                  in its layer's order (back to front, views in the order added)
//   dispose()                      releases the GL resources
export const STORY_UI_METHODS = Object.freeze(["load", "setTalkWindow", "showTalk", "hideTalk", "hideTalkNextIndicator",
  "setSpeakerName", "setTalk", "setAutoMode", "setFastIconActive", "setPlaybackSpeed", "showTitle", "showLocation",
  "transitionSettings", "fadeOut", "fadeIn", "fadeInLetterBox", "render", "renderLetterBox", "dispose"]);

// raises unless `ui` provides the StoryUI members
export const checkStoryUI = (ui) => {
  if (!ui) throw new TypeError("StoryUI: missing");
  const missing = STORY_UI_METHODS.filter((m) => typeof ui[m] !== "function");
  if (!("isTyping" in ui)) missing.push("isTyping");
  if (!Array.isArray(ui.layers) || ui.layers.length !== Object.keys(ADV_CANVAS_LAYER).length) missing.push("layers");
  if (missing.length) throw new TypeError(`StoryUI: missing ${missing.join(", ")}`);
  return ui;
};

// A canvas layer's view list (the StoryUI implementation owns one per ADV_CANVAS_LAYER)
export class StoryUILayer {
  constructor(index) { this.index = index; this.views = []; }
  add(view) { if (!this.views.includes(view)) this.views.push(view); return view; }
  remove(view) { const i = this.views.indexOf(view); if (i >= 0) this.views.splice(i, 1); }
}

export const createStoryUILayers = () => Object.values(ADV_CANVAS_LAYER).map((i) => new StoryUILayer(i));
