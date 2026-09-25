# Live2D models

`ournotes-player/live2d` shows one Live2D character of BanG Dream! Our Notes in a web page, the way the game's story
(ADV) screen runs it: its idle motion replayed, auto eye blink, breath and physics, with motions and expressions on
request. It is a model viewer; the story's stage, camera and text are not part of it.

## Live2D Cubism Core

The model viewer needs **Live2D Cubism Core for Web**, which this package does not contain. The page loads Live2D's
own file `live2dcubismcore.min.js` itself, before a model is created, for example from Live2D's distribution:

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
```

or from a copy taken from the Cubism SDK for Web. The file defines the global `Live2DCubismCore`; the player uses that
global and throws `Live2D Cubism Core is not loaded: …` when it is missing. The Core is Live2D Inc.'s software and its
own license applies to it (Live2D Proprietary Software License Agreement); using it is between the page and Live2D.
ournotes-player's license does not cover it, and nothing in this repository, its npm package or its bundles includes
it. Cubism Core 5.x is needed for the current models (moc3 version 5).

## Entry points

| Import | Contents |
|---|---|
| `ournotes-player/live2d` | `ModelPlayer`, `ModelSession`, `AssetStore`, `defineOurnotesLive2D`, `OurnotesLive2DElement`, `MODEL_FRAME_RATE` |
| `ournotes-player/live2d/element` | the same exports; importing it defines `<ournotes-live2d>` |

Browser bundles in `dist/`: `ournotes-player.live2d.js` (ESM, the API), `ournotes-player.live2d.element.js` (ESM,
defines the element) and `ournotes-player.live2d.global.js` (a classic script: defines the element and exposes the
API as the global `OurnotesLive2D`), each also as `.min.js`. The chart player's entry points do not include the
model viewer.

## `<ournotes-live2d>`

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player/dist/ournotes-player.live2d.element.min.js"></script>

<ournotes-live2d src="https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json"
                 style="width: 360px"></ournotes-live2d>
```

| Attribute | Property | Meaning |
|---|---|---|
| `src` | `src` | URL of a model manifest. Setting it loads that model (the previous one is disposed). |
| `motion` | `motion` | A motion shown when the model loads and played whenever the attribute changes; removing it plays the default motion. The property reads the current motion once loaded. |
| `expression` | `expression` | The same for the expression. |
| `loop` | `loop` | The motion named by `motion` is replayed whenever it ends (boolean attribute, read when the motion starts). Without it the default motion follows. |
| `paused` | `paused` | No frame advances (boolean attribute). |
| `physics`, `breath` | `physics`, `breath` | `"off"` (or `false`, `0`) switches the physics / the breath motion off; absent: on. |
| `seed` | | Seed of the eye blink intervals, read when the model loads. |

Read-only properties: `motions`, `expressions` (names in the model's order), `defaultMotion`, `defaultExpression`,
`hasPhysics`, `info` (the manifest without `files`), `player` (the `ModelPlayer`, `null` until loaded) and `ready` (a promise of the
player of the current `src`). Methods: `playMotion(name, {fade, loop})`, `setExpression(name, {fade})` (both wait
for the model to load), `play()`, `pause()`.

Events (they do not bubble): `ready`, `error`, `progress`, `play`, `pause`, with the `detail` of the `ModelPlayer`
events.

The element is `display: block`, transparent (the page's background shows around the model) and 2:3 at its width
unless it is given a height. The model's canvas is fitted into the element and centred.

## `ModelPlayer`

```js
import { ModelPlayer } from "ournotes-player/live2d";

const player = await ModelPlayer.create(document.querySelector("#model"), {
  src: "https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json",
});
console.log(player.motions, player.expressions);
player.playMotion("mtn_smile01_L");
player.setExpression("exp_smile01", { fade: 0.5 });
```

`ModelPlayer.create(host, options)` appends one `<div>` to `host` (an `Element` or a `ShadowRoot`) with the canvas in
its shadow root; the div fills the host, and a host without a height gets a box of the model canvas' proportions at
its width. It resolves once the model is shown, after the `ready` event, and rejects when loading fails (after an
`error` event).

Options: `src` (a model manifest URL) or `assets` (an `AssetStore`); `motion`, `expression`, `loop`, `physics`,
`breath`, `seed` as for `ModelSession`; `paused` (start paused); `pixelRatio` (device pixels per CSS pixel, default
`devicePixelRatio`); `signal` (an `AbortSignal` that cancels the loading); `on` (`{type: listener}` added before
loading starts).

| | |
|---|---|
| `motions`, `expressions` | Names, in the model's order. |
| `defaultMotion`, `defaultExpression` | The model's own (its idle motion and expression; a model without expressions has an empty list and `""`). |
| `motion`, `expression` | The motion last started (the default motion while idle) and the expression last set. |
| `motionPlaying` | A motion other than the default one is playing. |
| `playMotion(name, {fade = -1, loop = false})` | Plays a motion. `fade`: fade-in time in seconds, -1 for the motion's own. With `loop` it is replayed whenever it ends; otherwise the default motion follows it. Throws for an unknown name. |
| `setExpression(name, {fade = -1})` | Sets an expression; `fade` as above. |
| `physics`, `breath` | Read / write. |
| `hasPhysics` | The model has physics (a `CubismPhysicsController`); without it `physics` stays `false`. |
| `play()`, `pause()`, `paused` | While paused no frame advances; the last frame stays shown. |
| `info` | The manifest without `files`. |
| `session`, `root`, `canvas` | The `ModelSession`, the appended div and the canvas. |
| `dispose()` | Stops the player, releases the WebGL context and the model and removes the div. |

Events (`CustomEvent`): `progress` `{loaded, total}` (bytes, while loading), `ready`, `play`, `pause`, `error`
`{error}`.

Requests take effect at the next frame, where the game runs story commands.

## `ModelSession`

The model itself, without DOM access: it draws into a WebGL2 context you give it and advances when you call `step()`.

```js
import { AssetStore, ModelSession } from "ournotes-player/live2d";

const assets = await AssetStore.fromManifest("https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json");
const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
const session = await ModelSession.create({ gl, assets, width: canvas.width, height: canvas.height });
for (;;) {                                   // one step = 1/30 s of game time
  await session.step();
  await new Promise(requestAnimationFrame);
}
```

`ModelSession.create(options)`: `gl` and `assets` are required; `motion`, `expression` (shown first; default the
model's own), `loop`, `physics`, `breath` (default `true`), `seed` (default from the clock), `width`, `height` (the
drawing buffer size, default the canvas size). It resolves with the model shown. The context serves this session
alone while it lives.

| | |
|---|---|
| `step({draw = true})` | Advances one frame of game time (1/30 s) and draws it unless `draw` is false. To keep game time on real time, run as many steps as 30 Hz × elapsed time asks for and draw only the last. |
| `render()` | Draws the current state. |
| `resize(width, height)` | Drawing buffer size in pixels, applied by the next `render()`. |
| `playMotion`, `setExpression`, `setPhysics(on)`, `setBreath(on)` | As on `ModelPlayer`; applied at the next step. |
| `name`, `motions`, `expressions`, `defaultMotion`, `defaultExpression`, `motion`, `expression`, `looping`, `motionPlaying`, `physics`, `hasPhysics`, `breath`, `info`, `seed` | Read only. |
| `time` | Game time in seconds since the session was created. |
| `busy` | A step is in progress (no other step may start). |
| `dispose()` | Waits for a step in progress, deletes the GL objects it created, releases the Cubism model. The context and canvas stay yours. |

The drawing is premultiplied alpha on a transparent background: give the context `alpha: true, premultipliedAlpha:
true` for the page to show through, or draw over an opaque background of your own.

## Behaviour

- **Loading** is the story loader's: the model is initialised and warmed up with the frame loop running (about ten
  frames of game time), hidden, then shown as the story's `In` command shows a character: the chosen motion and
  expression (or the defaults) without a fade.
- **Idle**: the default motion is replayed whenever it ends; the eyes blink at random intervals (the game's timing,
  from a seeded random stream); the breath parameter oscillates; physics follows the head and body parameters. A
  model without a `CubismPhysicsController` has no physics; the `physics` switch has no effect on it.
- **Motions** fade in over their own fade-in time unless another is given, and the previous motion fades out under it,
  as in the game. The game plays the next story motion when the story asks for it; the viewer returns to the default
  motion after a motion ends, unless `loop` is set.
- **Frame rate**: 30 frames per second of game time, the story screen's rate. A frame shows the model as computed two
  updates earlier, as the game does.

What differs from the game and what is not reproduced is in [fidelity.md](fidelity.md#live2d-models); the data the
viewer reads is described in [data-format.md](data-format.md#live2d-models).

## Not included

- **Lip sync and motion sync from voice.** The game moves the mouth from the voice audio through Live2D's separate
  Cubism MotionSync Core; the viewer plays no voice and does not use it. The mouth follows the model's own mouth
  controller value, as in the game while no lip sync runs.
- Eye and head tracking (the story's look commands), rim light, brightness and blur commands, the story's lights,
  stage shadows, character compositing and post-processing.

## Example

[examples/live2d/](../examples/live2d/) lists the models of a site (`models.json`) and shows the chosen one with its
motions and expressions. A model with a character name in `models.json` is listed by that name and its id
(`?lang=<language>` picks the name from `names`, else `label` is shown).
