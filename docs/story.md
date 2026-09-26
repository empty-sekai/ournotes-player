# Stories

`ournotes-player/story` plays one story episode (ADV) of BanG Dream! Our Notes in a web page the way the game's
story screen does: the episode's command rows on the game's playback loop, the stage with its background, lights and
volumes, the Live2D characters with their motions, expressions, look and lip sync, the camera, focus, blur and
post-processing, the talk window with its typewriter, speaker names, location caption and title, the rule
transitions, music, sound effects and voices. The data of a story comes from a site that serves it
([story-data-format.md](story-data-format.md)).

## What the page provides

The story player needs two files of Live2D's, which this package does not contain; the page loads them itself, before
a story is created:

| File | Needed for | Global |
|---|---|---|
| `live2dcubismcore.min.js` (Live2D Cubism Core for Web, 5.x) | every story (the characters) | `Live2DCubismCore` |
| `live2dcubismmotionsynccore.min.js` (the CRI Core of the Cubism SDK for Web MotionSync Plugin, 5.0.4) | the voices' lip sync | `Live2DCubismMotionSyncCore` |

```html
<script src="live2dcubismcore.min.js"></script>
<script src="live2dcubismmotionsynccore.min.js"></script>
```

Both are Live2D Inc.'s software under its own licenses; using them is between the page and Live2D. ournotes-player's
license does not cover them, and nothing in this repository, its npm package or its bundles includes them. Without
Cubism Core a story does not load (`Live2D Cubism Core is not loaded: …`). Without the MotionSync Core the story plays,
and the characters' mouths do not follow the voices; the player does not replace the analysis with anything else.

## Entry points

| Import | Contents |
|---|---|
| `ournotes-player/story` | `StoryPlayer`, `StorySession`, `AssetStore`, `loadStoryStore`, `fetchStoryManifest`, `defineOurnotesStory`, `OurnotesStoryElement`, `registerCommand`, `registeredCommands`, `STORY_FRAME_RATE` (30), the game's enums (`ADV_COMMAND`, `ADV_PLAYBACK_SPEED`, `ADV_PLAYBACK_MODE`, `ADV_CANVAS_LAYER`) |
| `ournotes-player/story/element` | the same exports; importing it defines `<ournotes-story>` |

Browser bundles in `dist/`: `ournotes-player.story.js` (ESM, the API), `ournotes-player.story.element.js` (ESM, defines
the element) and `ournotes-player.story.global.js` (a classic script: defines the element and exposes the API as the
global `OurnotesStory`), each with a `.min.js` and source maps. Types: `types/story.d.ts`.

## `<ournotes-story>`

```html
<script src="live2dcubismcore.min.js"></script>
<script src="live2dcubismmotionsynccore.min.js"></script>
<script type="module" src="ournotes-player.story.element.min.js"></script>
<ournotes-story src="stories/10462.json" lang="en"></ournotes-story>
```

| Attribute | Meaning |
|---|---|
| `src` | URL of a story manifest (`stories/<advId>.json`); changing it loads that story. |
| `lang` | `ja`, `en`, `zh-Hant`, `zh-Hans` or `ko` (default: the manifest's language). Changing it loads that language's files and restarts at the current line. |
| `auto` | Auto mode (boolean; `off` / `false` / `0` is off). Absent: off, as in a new game profile. |
| `speed` | Playback speed `1`, `1.5`, `1.7` or `2` (the story menu's fast-forward: `AdvPlaybackSpeed`). Default `1`. |
| `quality` | `best` (default), `high` or `middle`: the game's quality option. Read when the story loads. |
| `autoplay` | Start as soon as the story is loaded (boolean). Browsers may keep the sound off until the user interacts. |
| `controls` | The control bar (boolean; `off` hides it). Default shown. |
| `line` | Start at this line (0-based), read when the story loads. |
| `volume-bgm`, `volume-se`, `volume-voice` | Volumes 0–1 of music, sound effects and voices (the app's sound options). |
| `no-voice` | Play without voices (boolean), read when the story loads. |

Properties `src`, `lang`, `auto`, `speed` reflect the attributes; `line`, `lineCount`, `speaker`, `text`, `ended`,
`languages`, `info` and the methods `play()`, `pause()`, `next()`, `skip()`, `seekToLine(i)`, `setVolume(category, v)`
are `StoryPlayer`'s (below), plus `player` (the `StoryPlayer`, `null` until loaded) and `ready` (a promise of it).
Events (not bubbling) as `StoryPlayer`'s. The element is `display: block` and 13:6 at its width unless the page gives
it a height.
[examples/story/](../examples/story/) is such a page: it plays `stories/<advId>.json` of a site (`?story=<advId>`) or
the manifest named by `?src=`, with Live2D's two files from `?core=` and `?motionsync=`.

## `StoryPlayer`

```js
import { StoryPlayer } from "ournotes-player/story";
const player = await StoryPlayer.create(host, { src: "stories/10462.json", lang: "ja" });
button.onclick = () => player.play();       // from a user gesture, so that sound may start
player.addEventListener("line", (e) => console.log(e.detail.speaker, e.detail.text));
```

`StoryPlayer.create(host, options)` (or `new StoryPlayer(host, options)` and `load()`) appends a `<div>` to `host` (an
element or a shadow root) with the canvas and the control bar in its shadow root, loads the story and resolves once
it is ready. Options: `src` (or `assets`: an `AssetStore`), `lang`, `auto`, `speed` (10, 15, 17, 20), `quality`, `line`,
`autoplay`, `controls`, `uiLang` (the control labels' language), `voice`, `sound` (`false`: no Web Audio, the story
keeps its timing silently), `volumes` (`{Bgm, Se, Voice}`), `seed`, `fetch`, `signal`, `pixelRatio`, `on`
(`{type: listener}`).

| Member | Meaning |
|---|---|
| `play()` | Starts the episode (the first call) or resumes it. Call it from a user gesture. |
| `pause()` | Stops the frames and the sound (the player's own pause; the game has none). |
| `next()` | A tap on the story screen (`AdvPlayerUIEventHandler.OnNextButtonTapped`): advances a line waiting for the player, reveals a line being typed, cuts an auto-mode wait. Clicks on the story screen do the same. |
| `setAuto(on)` | The story menu's auto button: on or off; turning auto off at a speed other than ×1 resets the speed to ×1. |
| `setSpeed(s)` | The story menu's fast-forward button set to `s` (10, 15, 17, 20): a speed other than ×1 turns auto on, ×1 brings back the player's own auto choice. |
| `skip()` | The game's skip: the playback stops without the closing rows (`AdvPlayer.Skip`). |
| `seekToLine(i)` | Restarts at line `i` with the game's shortcut (below). |
| `setLanguage(lang)` | Loads another language of the story and restarts at the current line. |
| `setVolume(category, v)` | `"Bgm"`, `"Se"` or `"Voice"`, 0–1. |
| `line`, `lineCount`, `speaker`, `text` | The current line (-1 before the first), the number of lines, the current speaker and text. |
| `auto`, `speed`, `paused`, `ended`, `lang`, `languages`, `info` | State; `info` is the story manifest without its file lists. |
| `dispose()` | Stops the player, releases its WebGL context and removes it from the host. |

Events: `progress` `{loaded, total}` (bytes while loading), `ready`, `play`, `pause`, `line`
`{index, lineCount, speaker, text}`, `log` `{row, speaker, text, voiceIds}` (a talk log entry: Talk, Location,
subtitles and chat rows, also those before the start line; `speaker` is `null` for a location caption), `command`
`{index, cmd}` (before each row runs), `ended` `{reason}` (0 at the end of the episode, 1 after `skip()`), `error`
`{error}`.

### Control bar

The story menu's items with the game's behaviour and visible labels in the story's language (or `uiLang`): Next, Auto,
Fast-forward (×1 → ×1.5 → ×1.7 → ×2 → ×1), Skip (with a confirmation; the playback waits while it is open), and the
music, sound effect and voice volumes. Apart from them, the player's own items: play / pause and the line position.
Keyboard, while the player has the focus: Space or Enter next, A auto, F fast-forward, K play / pause. An Overlay
episode (the simple story player has no auto button and no fast-forward) shows neither Auto nor Fast-forward.

## `StorySession`

The DOM-free session, for pages that drive it themselves and for Node (tests, read sets):

```js
import { StorySession, loadStoryStore } from "ournotes-player/story";
const store = await loadStoryStore("stories/10462.json", { lang: "en" });
const s = await StorySession.create(gl, store, { quality: 4, autoplay: true });   // gl = null: headless
while (!s.ended) { await s.step(); }                                              // 1/30 s of game time per step
```

`StorySession.create(gl, store, options)`: `gl` is a WebGL2 context used by this session alone, or `null` (nothing is
drawn; the characters, the UI and the timing still run). `store` holds one language of the story (`loadStoryStore`
merges the manifest's common files with one language group). Options: `lang`, `quality` (0–4, the game's
`BaseQualityMode`; the quality option gives Best 4, High 3, Middle 2), `seed`, `auto`, `speed`, `line`, `voice`,
`sound`, `audioContext`, `title`, `autoplay`, `onCommand`, `onLine`, `onLog`, `onEnded`, `onLoaded`, `width`, `height`;
`ui` and `audio` replace the story UI and the sound manager (tests).

Methods: `play()`, `tap()`, `setAuto(on)`, `setSpeed(s)`, `skip()`, `setVolume(category, v)`, `step({draw})`,
`resize(w, h)`, `render()`, `dispose()`; state: `time`, `frame`, `line`, `lineCount`, `speaker`, `text`, `isAuto`,
`speed`, `started`, `ended`, `endReason`. `StorySession.requirements(store)` lists the commands the episode executes
and those this player does not support.

## Seek

`seekToLine(i)` is the game's shortcut, the way the game resumes a story: the episode restarts with the target
row's `Index` as the shortcut index. Until that row, `CalcDuration` returns 0 (every fade, tween and wait is instant),
Talk and Location rows show nothing, motions play without their waits, BGM rows are only remembered, and the screen is
covered black (`TransitionManager.FadeOutBlackImmediate`). At the target row the last remembered BGM plays, the
waiting motions play their last queued entry, and after 0.2 s the cover goes (`FadeInImmediate`); the line then shows
and the episode goes on normally. The state reached is the game's state after a resume.

## Episodes the player refuses

The player refuses an episode it cannot play as the game does, naming what is missing: a command without a handler
(the command registry below; checked from the manifest before the story's files download), a stage feature it does
not draw (stage shadow textures), a talk window the story UI does not provide, a text the story UI cannot lay out, and
in a session that draws, the chat window (checked before the characters load). Such an episode is never played
halfway. The one exception is a graphic found only while drawing: a frame or still canvas that shows a UIParticle
effect stops the session at that frame with an error that names the node and the component.

## Extending: the command registry

`registerCommand(name, handler)` adds the handler of an `AdvCommand` (once per name). A handler receives the command
row and the interpreter (`StoryPlayerCore`: `ctx` with the scene objects, the session fields, `calcDuration`, `delay`,
`noWait`, …) and returns the promise the next row waits for. `registeredCommands()` lists the supported commands.

## Fidelity

### Fixed settings

| Setting | Value |
|---|---|
| Frame rate | 30 frames per second of game time (the ADV's target frame rate). Each frame runs the game's order: UniTask waits (the commands' continuations and the motion waits), the sound manager, the character controllers, DOTween, the Animators, the late updates, the Cubism model update, the volume update, rendering. |
| Quality | `best` (`BaseQualityMode` 4, the game's default): lighting, physics, breath, blur, stage post effects, per-vertex additional lights, FXAA. `high` and `middle` apply the game's gates. |
| Auto mode, speed | Off and ×1, the game's values for a new profile; the page may set others. |
| Viewport | The ADV camera's 13:6 viewport in the page's box, with the game's letterbox bands above and below on narrower boxes. |
| Text | Laid out with the game's TextMeshPro rules and drawn with the TextMeshPro distance-field shader, with glyphs from the font assets of the data (open-source fonts in the published data: line breaks can differ from the game where the advances differ). |
| Arithmetic | float32 where the game's managed code computes in float32. |
| Randomness | UnityEngine.Random (eye blinks, pseudo lip sync, shakes) from a seeded stream (`seed`); the game seeds it from the clock. |
| Sound files | A story published without them (manifest `audio` false) plays without sound, with the voices off as in the game without voice data: the lines advance by their length and the speakers' mouths follow the text. |

### Reproduced

The playback loop (`AdvPlayer.Play`: the initialize rows, the episode's rows with `IgnoreData`, `IsNoWait` and each
command's own waits, the finalize rows, `Stop`), manual and auto advance with the game's timing, the playback speed,
the shortcut, and the commands In, Out, Talk, FadeOut, FadeIn, Focus, Bgm, Se, Location, Motion, Character, Stage,
TalkWindow, Look, LookTarget, Pedestal, Track, Zoom, MoveToDirection, PanV2, Delay, Wait, CancelDelay, ForceAuto,
SoundVolume, Expression, Costume, EyeBlink, Pause, Resume, plus those the feature modules add (`registeredCommands()`).
The stage (background sprite and plane, lights, focus points, volume profiles, particle effect groups), the character
field, the camera, the field renderer's offscreen composite (per-slot alpha, brightness, blur, the Stage capture
crossfade; the renderers of other objects routed by their layer as the game's render pass does), the background blur,
the URP post chain (LUT, bloom, uber with film grain), the curved lens and FXAA.
Overlay episodes (`playbackMode` 1: the home spot talks and the live result talks) play through the game's simple
story player in their host screen ([story-simple.md](story-simple.md)).

### Not reproduced

- The screens around the story (the episode list, the home screen, the confirmation after a skip) and the host's
  continuous playback and interruption.
- Commands without a handler in this version: the player refuses the episodes that use them (see above).
- The per-frame loading of the game (windowed preload): every file is loaded before the story starts.
- The UI camera's own renderers: an effect placed on the UI or front canvas layers (layers 5 and 13) is not drawn,
  and a frame that would draw one fails.
- The centered talk window (`UICenterTalkWindow`): an episode that switches to it is refused.
- The chat window (`UIAdvChatWidget`, the phone): it is not drawn, and a session that draws refuses an episode with chat
  rows. A headless session runs them: their timing and their talk log entries.
- UIParticle effects on the frame and still canvases (speed lines, rain, sparkles and the like): not drawn; see
  the exception above.
- The CRI Lips mouth analysis: while a voice plays, a model without a MotionSync controller keeps its mouth closed.
  Its `lipSyncMissing` is then `"CRI Lips analysis"` ([live2d.md](live2d.md)).
- The re-speed of a video after a seek (`VideoPlayingOrSeekRespeeding`): a speed change reaches the playing video at
  once.
- Home spot rooms with Universal Render Pipeline/Lit materials: a session that draws refuses them
  ([story-simple.md](story-simple.md)).
- Stage shadow textures: refused (see above).

### Engine behaviour

Behaviour of the engine (Unity, URP, CRI) that the game's code does not show is marked `ENGINE:` in the sources, as in
the rest of the player ([fidelity.md](fidelity.md)).
