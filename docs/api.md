# API

ournotes-player plays one chart of BanG Dream! Our Notes in a browser: the live's 3D scene, lane, notes, effects and
live UI, with the chart's music and sound effects, auto-played at Perfect. The data it reads is described in
[data-format.md](data-format.md); how to put it on a page is in [embedding.md](embedding.md).

## Entry points

| Import | Contents |
|---|---|
| `ournotes-player` | `ChartPlayer`, `ChartSession`, `AssetStore`, `defineOurnotesPlayer`, `OurnotesPlayerElement`, `LIVE_SPEEDS`, `LIVE_OPTIONS`, `LIVE_OPTION_GROUPS`, `LiveSettingsError`, `PLAYER_LANGUAGES`, `formatTime` |
| `ournotes-player/element` | the same exports; importing it defines `<ournotes-player>` |

Every time in the API is in milliseconds of chart time.

## `<ournotes-player>`

```html
<script type="module">import "ournotes-player/element";</script>
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

| Attribute | Property | Meaning |
|---|---|---|
| `src` | `src` | URL of a chart manifest. Setting it loads that chart (the previous one is disposed). |
| `controls` | `controls` | Shows the control bar (boolean attribute). |
| `autoplay` | `autoplay` | Starts playing once loaded (boolean attribute). See [Audio](#audio). |
| `speed` | `speed` | Playback speed, default `1`. |
| `music` | `music` | `music="off"` (or `false`, `0`) switches the music off; absent: on. The property is a boolean. |
| `se` | `se` | The same for the sound effects. |
| `settings` | `settings` | The game's Live options as a JSON object, e.g. `settings='{"NoteSpeed": 9, "LaneOpacity": 40}'` (see [Live settings](#live-settings)). Changing it replaces them: the names it does not give take their defaults. The property reads the options in effect once loaded; setting it writes the attribute. |
| `lang` | | Language of the controls: the element's own or inherited `lang` (English, Japanese, Korean, Simplified and Traditional Chinese; English otherwise). |
| `quality`, `seed` | | Passed to the session when the chart loads (see `ChartSession`). |

Properties and methods: `play()`, `pause()`, `seek(ms)`, `setSettings(values, {reset})`, `currentTime`, `duration`,
`paused`, `ended`, `chart`, as on `ChartPlayer`; `player` (the `ChartPlayer`, `null` until loaded) and `ready` (a
promise of the player of the current `src`). `play()`, `seek()` and `setSettings()` wait for the chart to load.

Events (they do not bubble): `ready`, `play`, `pause`, `seeked`, `timeupdate`, `ended`, `error`, `progress`,
`settingschange`, with the `detail` of the `ChartPlayer` events. An invalid `settings` attribute fires `error` and
changes nothing.

The element is `display: block` and 16:9 at its width (CSS `aspect-ratio`) unless it is given a height. Its content
is in a shadow root; page styles do not reach it. `defineOurnotesPlayer(tagName = "ournotes-player")` defines the
element under another name and returns its class.

## `ChartPlayer`

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.querySelector("#stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
  on: { progress: (e) => console.log(e.detail.loaded, e.detail.total) },
});
button.onclick = () => player.play();      // from a user gesture
```

`ChartPlayer.create(host, options)` appends one `<div>` to `host` (an `Element` or a `ShadowRoot`) and puts the canvas,
the loading line and the control bar in that div's shadow root. The div fills the host (`width` / `height` 100%); a
host without a height gets a 16:9 box at its width. It resolves once the chart is loaded and at its start (paused),
after the `ready` event; it rejects when loading fails (after an `error` event), and the div is removed.

Options:

| Option | Default | |
|---|---|---|
| `src` | | URL of a chart manifest. |
| `assets` | | An `AssetStore` to use instead of `src`. |
| `controls` | `true` | Shows the control bar. |
| `autoplay` | `false` | Calls `play()` once loaded. |
| `speed` | `1` | Playback speed (> 0). The control bar offers `LIVE_SPEEDS`: 0.5, 0.75, 1, 1.25, 1.5. |
| `music`, `se` | `true` | Music and sound effects on. |
| `settings` | chart defaults | The game's Live options by name (see [Live settings](#live-settings)). |
| `lang` | page | Language of the controls (a BCP 47 tag); default: the nearest `lang` attribute around the host, else the document's. |
| `quality` | manifest | LiveQuality 0..2 when `settings.LiveQuality` is not given. |
| `seed` | clock | Seed of the particle random stream (a fixed seed gives the same effects every run). |
| `audioContext` | | An `AudioContext` for this player, at any sample rate: the audio files are decoded into its rate. `pause()` and the end of the chart suspend it, `play()` resumes it. By default the player creates its own at 48 kHz, the rate of the audio files, and closes it on `dispose()`. |
| `pixelRatio` | `devicePixelRatio` | Device pixels per CSS pixel of the drawing buffer. |
| `signal` | | An `AbortSignal` that cancels the loading. |
| `on` | | `{type: listener}`: listeners added before loading starts (for `progress`, `ready`, `error`). |

Properties and methods:

| | |
|---|---|
| `play()` | Plays or resumes. Call it from a user gesture: it resumes the `AudioContext`. At the end of the chart it starts again from the beginning. |
| `pause()` | Pauses: no frame advances, the audio is suspended. |
| `seek(ms)` | Resolves to the chart time reached: the last frame at or before `ms` (see [Seek](#seek)). |
| `currentTime` | Chart time in ms (0 before the chart starts); setting it seeks. |
| `duration` | Length of the music in ms. |
| `paused` | `true` until `play()`, while paused and after the end. |
| `ended` | The music has ended. |
| `speed`, `music`, `se` | Read / write. |
| `settings` | The Live options in effect (a frozen object by name). Setting it replaces them (the names not given take their defaults); an invalid value throws a `LiveSettingsError` (a `RangeError`). |
| `setSettings(values, {reset = false})` | Changes the given options (the others keep their values; with `reset`, their defaults) and resolves to the names that changed. Invalid values reject and change nothing. Options that select other files load the chart again at the same chart time, playing if it was. |
| `optionItems()` | Every Live option with this chart: `{name, id, group, section, type, apply, default, value, range, values, offered, hidden, mute}` (`range` in the option screen's unit, `values` the values the chart offers or `null` for any value in the range, `offered` false when the chart offers one value only). |
| `lang` | Language of the controls; setting it rebuilds them. |
| `controls` | Shows / removes the control bar. |
| `audioAvailable` | `false` for a chart without audio files (manifest `"audio": false`). |
| `chart` | The manifest's `chart` metadata (title, bands, level, notes, durationMs, …) or `null`. |
| `session` | The `ChartSession`. |
| `root`, `canvas` | The appended div and the canvas. |
| `dispose()` | Stops the player, releases the WebGL context and the audio, and removes the div. |

Events (`CustomEvent`):

| Event | `detail` | |
|---|---|---|
| `progress` | `{loaded, total}` | Bytes loaded, while loading. |
| `ready` | | The chart is loaded and at its start. |
| `play` | | After `play()` took effect. |
| `pause` | | After `pause()`, and at the end of the chart (before `ended`). |
| `seeked` | `{time}` | After a seek, with the chart time reached. |
| `timeupdate` | `{time}` | At most every 250 ms while playing, after a seek, and at the end. |
| `ended` | | The music has ended. |
| `settingschange` | `{settings, changed}` | After Live options changed (API or settings panel), with the options in effect and the names changed. |
| `error` | `{error}` | Loading or playback failed; playback stops. |

Controls: the bar holds the viewer controls (play / pause, time, seek bar, playback speed), the note speed with − / +
buttons, and a Settings button that opens the settings panel. The bar hides while playing and shows on pointer movement
over the player, a tap, or a key. A click on the picture plays / pauses; a tap shows / hides the bar. The settings panel
shows the game's Live options this chart offers, in the game's groups (Basic, Detail, Display 1, Display 2, Sound) and
sections, each with a visible label; a change applies at once (see [Live settings](#live-settings)), and "Reset all"
returns to the defaults.

The note speed in the bar is the `NoteSpeed` setting (1.00–12.00, shown with two decimals). − / + step it by 0.1, with
Shift by 1, as the game's note speed buttons before a live do (they also have a 0.01 step; exact values can be entered
in the settings panel). A change is applied as a change in the panel is: `setSettings`, a `settingschange` event, the
chart state of a live started with the new speed at the current chart time. Several steps in quick succession are
applied once, 300 ms after the last; the bar and the panel show the new value at once. The value between − and + is an
editable field: a typed value is applied on Enter or when the field loses the focus (Escape cancels), rounded to 0.01
in float32 and clamped to the range, and text that is not a number is discarded; the panel's number fields take typed
values by the same rules, and while a field has the focus the keyboard shortcuts below are off.

Keyboard, while the player has the focus (click it or tab to it): Space or K play / pause, Left / Right −5 s / +5 s,
Up / Down playback speed, `[` / `]` note speed −0.1 / +0.1 (`{` / `}`, i.e. with Shift, −1 / +1), Escape closes the
settings panel; Space and Enter on a focused button press that button. In the panel Tab moves between the controls and
Left / Right between the groups. The labels follow the player's language (`lang`).

## `ChartSession`

The chart itself, without DOM access: it draws into a WebGL2 context you give it and advances when you call `step()`.
`ChartPlayer` is a driver of it; use it directly to drive the frames yourself or to draw into a canvas you manage. It
needs `AudioContext` (window only) even for a chart without audio files.

```js
import { AssetStore, ChartSession } from "ournotes-player";

const assets = await AssetStore.fromManifest("https://example.org/site/charts/100001_expert.json");
const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
                                         premultipliedAlpha: false });
const session = await ChartSession.create({ gl, assets, width: canvas.width, height: canvas.height });
await session.play();
for (;;) {                                   // one step = 1/60 s of game time x speed
  if (!session.paused && !session.busy) await session.step();
  await new Promise(requestAnimationFrame);
}
```

`ChartSession.create(options)`: `gl` and `assets` are required; `audioContext`, `settings`, `quality`, `seed` as for
`ChartPlayer`; `width`, `height` the drawing buffer size (default: the canvas size). It resolves paused at the start of
the chart. The context serves this session alone while it lives (one session per context).

| | |
|---|---|
| `step({draw = true})` | Advances one frame of game time (1/60 s × speed) and draws it unless `draw` is false; the step that ends the chart suspends the `AudioContext`. Do not call it while `paused` or `busy`. To keep game time on real time, run as many steps as 60 Hz × elapsed time asks for and draw only the last (`ChartPlayer` runs at most 4 per animation frame). |
| `render()` | Draws the current state. |
| `resize(width, height)` | Drawing buffer size in pixels, applied by the next `render()` (the canvas is resized when it differs, and drawn in the same task). |
| `play()`, `pause()`, `seek(ms)` | As on `ChartPlayer`. `pause()` draws the frame it stopped at; so does a seek while paused. |
| `setSpeed(r)`, `setMusic(on)`, `setSe(on)` | |
| `settings`, `optionItems()` | As on `ChartPlayer`. |
| `setSettings(values, {reset = false})` | As on `ChartPlayer`, except that an option selecting other files rejects with a `LiveSettingsError` whose `reload` is true (create a new session with `settings` for it). |
| `speed`, `musicOn`, `seOn`, `audioAvailable`, `audioContext`, `chart` | Read only. |
| `positionMs()`, `durationMs()` | Chart time and music length. |
| `paused`, `playing`, `started`, `ended`, `busy`, `seeking`, `state` | `state`: `"start"` (at the chart start), `"playing"`, `"ended"`. |
| `dispose()` | Waits for a step or seek in progress, stops and disconnects every sound, closes the `AudioContext` if the session created it, deletes the GL objects it created and drops its state. The context and canvas stay yours. |

## `AssetStore`

The files of one chart, loaded before the session starts and read synchronously by it.

- `AssetStore.fromManifest(url, {fetch, onProgress, signal, base, concurrency})`: fetches the manifest, then every asset
  it lists (6 requests at a time), and checks each asset's size against the manifest. Asset paths are relative to
  `base`, by default the directory above the manifest's directory (the site layout `charts/<id>.json` +
  `assets/<sha256>.<ext>`).
- `new AssetStore({text, bytes, info})`: in memory, from `path -> string` and `path -> Uint8Array | ArrayBuffer` maps
  (`Map` or plain object) and the manifest metadata.
- `has(path)`, `text(path)`, `json(path)`, `bytes(path)` (a copy), `arrayBuffer(path)`, `image(path)` (PNG to
  `ImageBitmap`, texel values as stored), `list(prefix)`, `info` (the manifest without `files`).

## Behaviour

### Start

The session starts at the chart. The intro timeline of the live runs to its end once, without drawing and without the
intro's sounds, so the stage is as the game leaves it when the music starts; the first `play()` starts the music.

### Seek

A seek re-simulates the chart frame by frame on the 60 fps grid, without drawing: judgements, combo, note views and the
live UI are those of an uninterrupted run at the time reached. A seek backwards restarts from the chart start, a seek
forwards continues from the current state. Note and lane effects and particles are cleared, and sounds other than the
music stop. With the music on, it restarts at the position reached.

### Late frames

When the chart clock has moved on by more than one frame since the last update (a slow device, a tab in the
background), the frames in between are simulated without drawing and without sound, so no judgement is lost; up to
12 missed frames the effects are advanced too, beyond that they are cleared. A jump of more than 2 s is handled as a
seek.

### Live settings

The game's Live options, by the game's names, with the game's ranges and defaults (the chart data's preset-1 values).
Values are in the unit of the game's option screen: floats for `NoteSpeed` (1–12), `NoteTiming` and `ChartPosition`
(−3–3, i.e. ±300 ms), integers for opacities and volumes (0–100), booleans for switches, ids for choices.

| Name | Range / values | Default | Effect |
|---|---|---|---|
| `NoteSpeed` | 1.00–12.00 | 5.00 | How long a note is on screen (4 s at 1, 0.35 s at 12). |
| `NoteTiming` | −3.00–3.00 | 0.00 | Judgements, hit effects and hit sounds 100 ms later per +1.00. |
| `ChartPosition` | −3.00–3.00 | 0.00 | The chart 100 ms behind the music per +1.00. |
| `MirrorChart` | `false`, `true` | `false` | The mirrored chart (needs a mirrored score in the chart data). |
| `LiveQuality` | 0 High, 1 Middle, 2 Low | manifest | The live's quality settings (the qualities the manifest lists). |
| `JudgeResultPositionType` | 0 Center, 2 None | 0 | Judgement text in the centre, or none. |
| `JudgePosition` | −5–5 | 0 | Judgement line lower (−) or higher (+). |
| `SlideOpacity`, `GuideOpacity` | 10–100 | 60 | Opacity of slide and guide lines. |
| `SimultaneousLineDisplay` | `false`, `true` | `true` | Lines between simultaneous notes. |
| `MeasureLineDisplay` | `false`, `true` | `false` | Bar lines (needs the bar line view in the chart data). |
| `BackgroundBrightness` | 30–100 | 70 | Brightness of the background. |
| `ComboCountDisplay`, `ContinuationEffectDisplay` | `false`, `true` | `true` | The combo counter; its full combo / all perfect colours. |
| `LaneOpacity` | 0–100 | 80 | Opacity of the lane. |
| `GuidelineOpacity` | 0–100 | 25 | Opacity of the lane dividers. |
| `GuidelineCount` | 0 none, 1–4: 4, 6, 8, 12 sections | 2 | Lane dividers. |
| `NoteDesignId`, `NoteEffectId` | ids the chart data carries | 1 | Note design and hit effect set. |
| `LiveMusicVolume`, `LiveNoteSeVolume`, `LiveSeVolume`, `LiveVoiceVolume` | 0–100 | 100, 70, 50, 80 | Volumes of music, note sounds, other sound effects and voices; `LiveMusicMute`, `LiveNoteSeMute`, `LiveSeMute`, `LiveVoiceMute` mute them. While all eight are at their defaults the sounds play at the chart data's fresh-profile volumes (`categories`); once one differs, all four volumes apply, as the game's sound settings panel saves them. |
| `NoteSePatternId`, `UseIndividualNoteSe`, `TapSeId`, `FlickSeId`, `SideFlickSeId`, `SlideSeId`, `TraceSeId` | sets the chart data carries | 1, `false` | The note sound set, or one per note type. |
| `TapSeVolume`, `FlickSeVolume`, `SideFlickSeVolume`, `SlideSeVolume`, `TraceSeVolume` (+ `…SeMute`) | 0–100 | 100 | Volume of each note sound. |

`optionItems()` gives the same list with this chart's values. A change during playback gives the state a live started
with the new values has at the current chart time: simulation options re-simulate the chart to the current time (as a
seek), drawing constants and note sounds are replaced, volumes change at once, and options that select other files load
the chart again. The options the player does not reproduce are listed in [fidelity.md](fidelity.md#not-reproduced);
they are accepted at their default values only (`ScreenMode` at 3, the LightWeight mode the player shows).

```js
await player.setSettings({ NoteSpeed: 9.5, LaneOpacity: 40, LiveMusicVolume: 60 });
player.addEventListener("settingschange", (e) => localStorage.setItem("live", JSON.stringify(e.detail.settings)));
```

### Speed

The speed scales game time (effects, tweens, animations) and the music's playback rate; the chart follows the music,
whose pitch changes with the speed. With the music off, the chart runs on game time at that speed.

### Audio

Browsers start audio only after a user gesture on the page. `play()` resumes the `AudioContext`, so call it from a
click, tap or key handler (the control bar does). At the end of the chart the `AudioContext` is suspended: sounds
still playing then (the finish cheer loops by itself) stop, and `play()` resumes it and starts the chart again. With `autoplay` and no gesture yet, the player stays paused with the
play button shown until `play()` is called from a gesture. A chart whose manifest has `"audio": false` plays without
sound on game time.
