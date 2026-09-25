# API

ournotes-player plays one chart of BanG Dream! Our Notes in a browser: the live's 3D scene, lane, notes, effects and
live UI, with the chart's music and sound effects, auto-played at Perfect. The data it reads is described in
[data-format.md](data-format.md); how to put it on a page is in [embedding.md](embedding.md).

## Entry points

| Import | Contents |
|---|---|
| `ournotes-player` | `ChartPlayer`, `ChartSession`, `AssetStore`, `defineOurnotesPlayer`, `OurnotesPlayerElement`, `LIVE_SPEEDS`, `formatTime` |
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
| `quality`, `seed` | | Passed to the session when the chart loads (see `ChartSession`). |

Properties and methods: `play()`, `pause()`, `seek(ms)`, `currentTime`, `duration`, `paused`, `ended`, `chart`, as on
`ChartPlayer`; `player` (the `ChartPlayer`, `null` until loaded) and `ready` (a promise of the player of the current
`src`). `play()` and `seek()` wait for the chart to load.

Events (they do not bubble): `ready`, `play`, `pause`, `seeked`, `timeupdate`, `ended`, `error`, `progress`, with the
`detail` of the `ChartPlayer` events.

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
| `quality` | manifest | LiveQuality 0..4; a chart manifest carries the files of one quality. |
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
| `error` | `{error}` | Loading or playback failed; playback stops. |

Control bar: play / pause, time, seek bar, speed, music, sound effects. It hides while playing and shows on pointer
movement over the player, a tap, or a key. A click on the picture plays / pauses; a tap shows / hides the bar.
Keyboard, while the player has the focus (click it or tab to it): Space or K play / pause, Left / Right −5 s / +5 s,
Up / Down speed, M music, S sound effects.

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

`ChartSession.create(options)`: `gl` and `assets` are required; `audioContext`, `quality`, `seed` as for
`ChartPlayer`; `width`, `height` the drawing buffer size (default: the canvas size). It resolves paused at the start of
the chart. The context serves this session alone while it lives (one session per context).

| | |
|---|---|
| `step({draw = true})` | Advances one frame of game time (1/60 s × speed) and draws it unless `draw` is false; the step that ends the chart suspends the `AudioContext`. Do not call it while `paused` or `busy`. To keep game time on real time, run as many steps as 60 Hz × elapsed time asks for and draw only the last (`ChartPlayer` runs at most 4 per animation frame). |
| `render()` | Draws the current state. |
| `resize(width, height)` | Drawing buffer size in pixels, applied by the next `render()` (the canvas is resized when it differs, and drawn in the same task). |
| `play()`, `pause()`, `seek(ms)` | As on `ChartPlayer`. `pause()` draws the frame it stopped at; so does a seek while paused. |
| `setSpeed(r)`, `setMusic(on)`, `setSe(on)` | |
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

### Speed

The speed scales game time (effects, tweens, animations) and the music's playback rate; the chart follows the music,
whose pitch changes with the speed. With the music off, the chart runs on game time at that speed.

### Audio

Browsers start audio only after a user gesture on the page. `play()` resumes the `AudioContext`, so call it from a
click, tap or key handler (the control bar does). At the end of the chart the `AudioContext` is suspended: sounds
still playing then (the finish cheer loops by itself) stop, and `play()` resumes it and starts the chart again. With `autoplay` and no gesture yet, the player stays paused with the
play button shown until `play()` is called from a gesture. A chart whose manifest has `"audio": false` plays without
sound on game time.
