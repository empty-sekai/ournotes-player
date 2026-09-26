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
`hasPhysics`, `info` (the manifest without `files`), `name`, `motionPlaying`, `looping`, `time`, `seed` (as on
`ModelPlayer`; `""`, `false`, `false`, `0` until loaded, and `seed` the attribute's value or `null`), `player` (the
`ModelPlayer`, `null` until loaded) and `ready` (a promise of the player of the current `src`). Methods: `playMotion(name, {fade, loop})`, `setExpression(name, {fade})` (both wait
for the model to load), `play()`, `pause()`.

Events (they do not bubble): `ready`, `error`, `progress`, `play`, `pause`, `motionstart`, `motionend`, with the
`detail` of the `ModelPlayer` events.

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
| `looping` | The current motion is replayed when it ends (a `loop` request). |
| `name` | The model's name (the root of its prefab). |
| `time` | Game time in seconds since the model was loaded. |
| `seed` | The seed of the eye blink intervals in use. |
| `playMotion(name, {fade = -1, loop = false})` | Plays a motion. `fade`: fade-in time in seconds, -1 for the motion's own. With `loop` it is replayed whenever it ends; otherwise the default motion follows it. Throws for an unknown name. |
| `setExpression(name, {fade = -1})` | Sets an expression; `fade` as above. |
| `physics`, `breath` | Read / write. |
| `hasPhysics` | The model has physics (a `CubismPhysicsController`); without it `physics` stays `false`. |
| `play()`, `pause()`, `paused` | While paused no frame advances; the last frame stays shown. |
| `info` | The manifest without `files`. |
| `session`, `root`, `canvas` | The `ModelSession`, the appended div and the canvas. |
| `dispose()` | Stops the player, releases the WebGL context and the model and removes the div. |

Events (`CustomEvent`): `progress` `{loaded, total}` (bytes, while loading), `ready`, `play`, `pause`, `error`
`{error}`, `motionstart` `{name, loop}`, `motionend` `{name}`.

`motionstart` and `motionend` follow the motion layer:

- `motionstart` fires when a motion starts: one you asked for (at the next frame), a `loop` motion replayed, or the
  default motion returning after a motion ends or replayed while idle. `loop` is `true` when the motion will be
  replayed as it ends (a `loop` request, or the default motion). The motion shown on load fires one before `ready`.
- `motionend` fires in the frame where a playing motion reaches its end. A motion that runs to its length ends
  there. A motion replaced by a newer one keeps playing as it fades out under it, and ends when that fade-out is over,
  so `motionstart` of the new motion comes first.
- When a motion ends and another follows (the default motion, or the replay), `motionend` comes first, then
  `motionstart`, in the same frame.

```js
player.addEventListener("motionend", (e) => {
  if (e.detail.name === "mtn_smile01_L") player.playMotion("mtn_nod01_L");
});
```

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
drawing buffer size, default the canvas size), `onMotion` (the `onmotion` callback, set before the model is shown so
that the first motion's start is reported). It resolves with the model shown. The context serves this session alone
while it lives.

| | |
|---|---|
| `step({draw = true})` | Advances one frame of game time (1/30 s) and draws it unless `draw` is false. To keep game time on real time, run as many steps as 30 Hz × elapsed time asks for and draw only the last. |
| `render()` | Draws the current state. |
| `resize(width, height)` | Drawing buffer size in pixels, applied by the next `render()`. |
| `playMotion`, `setExpression`, `setPhysics(on)`, `setBreath(on)` | As on `ModelPlayer`; applied at the next step. |
| `name`, `motions`, `expressions`, `defaultMotion`, `defaultExpression`, `motion`, `expression`, `looping`, `motionPlaying`, `physics`, `hasPhysics`, `breath`, `info`, `seed` | Read only. |
| `onmotion` | `(type, detail) => void` or `null`: called during `step()` with `"motionstart"` `{name, loop}` and `"motionend"` `{name}`, as `ModelPlayer`'s events. |
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
- **Mouth**: the mouth controller sets `ParamMouthOpenY` only when the model tags that parameter
  (`CubismMouthParameter`), as in the game; on a model without the tag the mouth shows the motion's value.

What differs from the game and what is not reproduced is in [fidelity.md](fidelity.md#live2d-models); the data the
viewer reads is described in [data-format.md](data-format.md#live2d-models).

## Character runtime

The viewer and the story player share one character runtime, `Live2DCharacter` (`src/live2d/character.js`): the
game's `Live2DCharacter` and `Live2DCharacterController` over its Cubism SDK for Unity. The viewer uses only its
motion, expression, physics and breath calls. The story player also uses the calls below. Each one has no effect
until it is called.

| Call | Game counterpart |
|---|---|
| `pause()`, `resume()` | `Pause` / `Resume`: the motion layer stops at the current time and breath stops. Motion, expression and parameter-loop requests made while paused are played on resume. |
| `setMotionSpeed(speed)` | `SetMotionSpeed`: the playing motions and the auto eye blink run at `speed`. |
| `applyCurrentStateImmediately()`, `applyStateAtMotionTime(seconds)` | The state is applied outside the frame. The second call first moves the playing motion forward to `seconds`. |
| `playParameterLoop(name, fade)`, `stopParameterLoop(fade)` | `Live2DParameterLoopController`: a `misc_` fade motion loops over the other motions and fades in and out. |
| `setEyeBlinkStopped(stopped, duration)`, `setEyeBlinkEnabled(flag)` | The eye-blink stop: auto blink off and the eyes eased open over `duration`. While only the default motion plays, the eye parameters are held at their defaults. |
| `setOverrideAngleEnabled(flag, additive)`, `setAngleX(v)`, `setBodyAngleX(v)`, `smoothRotateToAngle(angle, body, duration, ease)` | The angle override, absolute or added to the motion. The tween starts from the current values. A new call or `resetAngleLook()` ends a running one; its promise then resolves `false`. |
| `setLookEnabled(flag)`, `smoothChangeToLook(x, y, duration)`, `originalLookX/Y` | The eye-ball override. Turning it on starts from the current eye-ball values. With `duration <= 0` the look is applied at once. |
| `resetAngleLook()` | Ends both overrides and their tweens. |
| `setBrightness(v)`, `setMultiplyTexture(shadow)`, `setSortingOrder(n)`, `setLayer(n)`, `gameObjectLayer`, `setParent(transform)`, `headPosition()` | Brightness (clamped to 0..1), the stage shadow texture (`null`: white), sorting order `n` x 1000, the layer of the model's objects, the parent transform (local position kept) and the world position of the head anchor. |
| `setLipSyncEnabled(flag, usePseudo)`, `setLipSyncPresentationMode(mode)`, `setMotionSyncSource(pcm)`, `clearMotionSyncSource()`, `setLipsAnalyzer(analysis)`, `setMouthOpening(v)`, `startTimedPseudoLipSync(length, speed, multiplier)`, `startTimedHoldOpenPseudoLipSync(open, length, speed)`, `stopTimedPseudoLipSync()`, `setPseudoLipSyncSpeed(speed)` | `Live2DLipSyncController`: voice lip sync through MotionSync, the timed pseudo lip sync of lines without a voice (0.14 s x the line's talk length), the manual mouth opening, and the story's "calm" presentation of the mouth. |
| `setRimLightEnabled(flag)`, `isRimLightingEnabled`, `setRimLightColor(color)`, `setShadowIntensity(v)` | The rim light on or off, its colour (`{r, g, b, a}`) and the shadow intensity (clamped to 0..1). Until these are called, the model's own rim-light settings apply and the colour is the material's. |
| `isMotionSyncEnabled`, `lipSyncMode`, `lipSyncMissing`, `isAlive` | The model has a MotionSync controller; the current lip mode (`LIP_MODE`); what a requested lip-sync path lacked, or `null`; the character is not released. |

`pcm` is a source of the playing voice's samples: an object whose `pull()` returns a `Float32Array` of the samples
output since the previous call (channel 0) and whose `sampleRate` is 48000. `latest(n)` (the last `n` samples output)
and `paused` (the output is paused) complete it for the capture modes of the game's audio input: each frame takes
either the samples output since the previous frame, feeding silence after a short gap, or the last 1024 samples. The
story player takes it from its `Audio.pcmSource`.

## Live2D Cubism MotionSync Core

Voice lip sync on models with a MotionSync controller needs **Live2D Cubism MotionSync Core for Web**, the CRI
analysis build of the Cubism SDK for Web MotionSync Plugin (`live2dcubismmotionsynccore.min.js`, engine version 5.0.4).
As with Cubism Core, the page loads it itself. It defines the global `Live2DCubismMotionSyncCore`, and
`motionSyncCore()` (`src/live2d/motionsync.js`) waits for it and passes it to the character (`{ motionSync }`).
The file is Live2D Inc.'s software under its own license, and this repository does not include it.

Without it, the voice lip-sync path does no analysis. The mouth parameters stay at their neutral values and
`lipSyncMissing` names the missing Core; nothing replaces the analysis.

### CRI Lips analysis

Models without a MotionSync controller take the mouth from the voice's CRI Lips analysis in the game
(`CriLipsAtomAnalyzer`, created at 48000 Hz on the voice's player). The runtime reads it through the object passed to
`setLipsAnalyzer(analysis)`:

| Member | Meaning |
|---|---|
| `isAvailable` | The analysis exists (the analyzer's native handle). While it is `false` the lip sync resets (the mouth goes back to its default opening). |
| `getOpenInfo()` | Returns `{ openY }`, the mouth opening from 0 to 1 (`CriLipsMouth.OpenInfo`). The runtime clamps it. |

- Once per frame, in the late update (`Live2DLipSyncController.OnLateUpdate`: after the update chain, not while the
  character is paused), a character whose lip sync is on in the CRI Lips mode reads `isAvailable`, then
  `getOpenInfo()`, and turns `openY` into the mouth opening as the game does.
- Several characters can share one analysis (the other speakers of a line follow its voice), so `getOpenInfo()` can be
  called more than once in a frame. It returns the latest analysed value each time, as the game's call reads the last
  value its audio thread stored.
- The runtime passes no audio and no time: the analysis takes the voice's output itself, for example from
  `Audio.pcmSource(info)` of the playing voice. Each call of `pcmSource` gives an independent reader: `pull()` returns
  the channel-0 samples output since its previous pull, on the AudioContext clock, at `sampleRate`; `latest(n)` and
  `paused` are as above. How far the value trails the output is the analysis's own timing.
- `setLipsAnalyzer(null)` detaches it (the voice ended or was stopped). An object without `getOpenInfo` is reported in
  `lipSyncMissing` and the lip sync stays reset. This repository does not include a CRI Lips analysis.

## Not included

- **Voice.** The viewer plays no voice, so it runs no lip sync. The mouth follows the model's own mouth controller
  value (on a model that tags `ParamMouthOpenY`), as in the game while no lip sync runs. The story player drives lip sync through the calls above.
- The story's look and angle commands, rim light, brightness and blur commands, the story's lights, stage shadows,
  character compositing and post-processing belong to the story player, not to the viewer.

## Example

[examples/live2d/](../examples/live2d/) lists the models of a site (`models.json`) and shows the chosen one with its
motions and expressions. A model with a character name in `models.json` is listed by that name and its id
(`?lang=<language>` picks the name from `names`, else `label` is shown).
