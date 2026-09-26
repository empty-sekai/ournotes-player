# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player is a browser player for BanG Dream! Our Notes charts. It reproduces the game's live screen in a web
page with WebGL2 and WebAudio and plays one chart with auto play. It can be embedded in other pages as the custom
element `<ournotes-player>`, as a JavaScript module, or in an iframe.

This is an unofficial fan project, not affiliated with the game's developer, publisher or operator. The repository
and the npm package contain no game assets: the player reads chart data prepared in the
[data format](docs/data-format.md), supplied by the user; the [nnnotes](https://github.com/MetaSekaiLab/nnnotes)
toolkit produces that data from the user's own game files. BanG Dream! and related names and trademarks belong to
their respective owners.

## What it reproduces

- The 3D lane and stage (the game's LightWeight background mode), notes, hold lines, guide lines and simultaneous-note
  lines;
- hit effects and particles;
- the judgement and combo UI;
- the game's own shaders: the GLSL ES 3.00 programs Unity compiled, read from the data and run in WebGL2, including
  the URP post-processing;
- the music and the note sound effects, with the chart clock following the audio clock.

It plays the way the game's auto play does: every judgement Perfect, default options, a 60 fps simulation in float32
arithmetic. What matches the game frame for frame and what is a feature of the player is listed in
[docs/fidelity.md](docs/fidelity.md).

## Viewer controls

The control bar holds the viewer controls: play / pause, the position with seeking, the playback speed (0.5–1.5×),
then the note speed (− / + step it by 0.1, with Shift by 1, as the game's note speed buttons before a live do; the value
can also be typed) and a Settings button that opens the settings panel; it hides while playing and shows on pointer movement, a tap or a key. The settings panel has the game's own Live settings (note speed, judgement and note timing, lane and UI display,
volumes, ...) in the game's groups, with the game's ranges and defaults; it lists the settings the chart's data
supports (see [docs/api.md](docs/api.md#live-settings)). The controls are in five languages (English, Japanese,
Korean, Simplified and Traditional Chinese) and follow the page's language. Keyboard, while the player has the focus:
Space or K play / pause, Left / Right back / forward 5 s, Up / Down playback speed, [ / ] note speed −0.1 / +0.1 (with
Shift ±1), Escape closes the settings panel.

A seek re-simulates the chart frame by frame from the start (or from the current position) to the target: judgements,
combo, notes and UI are those of an uninterrupted run at that time.

## Quick start

```sh
npm install github:empty-sekai/ournotes-player
```

Installing from GitHub builds `dist/` during the install. Once the package is published on npm,
`npm install ournotes-player` installs the same package.

Custom element, with a bundler:

```js
import "ournotes-player/element";
```

```html
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

Without a bundler, from a CDN (once the package is on npm; until then, serve the installed package's `dist/` file
with the page):

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player/dist/ournotes-player.element.min.js"></script>
```

JavaScript module:

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.getElementById("stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
});
button.onclick = () => player.play();   // browsers start audio only from a user gesture
```

iframe: [examples/iframe.html](examples/iframe.html) is a page holding one player, ready to embed with an `<iframe>`.

Chart list: [examples/chart-list](examples/chart-list) lists a site's `charts.json` and plays the chosen chart; a site of several regions or languages switches with `?region=&lang=`.

- API: [docs/api.md](docs/api.md)
- Embedding and hosting the data: [docs/embedding.md](docs/embedding.md)
- Data format: [docs/data-format.md](docs/data-format.md)
- Performance: [docs/performance.md](docs/performance.md)

## Live2D models

The package also holds a Live2D model viewer, `ournotes-player/live2d` (custom element `<ournotes-live2d>`): it shows
one character the way the game's story screen runs it (idle motion, auto eye blink, breath, physics), plays its motions
and sets its expressions, drawing with the game's own Live2D shaders from the data. It needs Live2D Cubism Core for Web
(Live2D's `live2dcubismcore.min.js`, under Live2D Inc.'s license), which the page loads itself; this repository, the
npm package and the bundles do not include it. See [docs/live2d.md](docs/live2d.md).

## Stories

The package also plays the game's story episodes (ADV): `ournotes-player/story` (custom element `<ournotes-story>`)
runs an episode's command rows on the game's playback loop, with the stage, the Live2D characters, the camera and
post-processing, the talk window, the rule transitions, music, sound effects and voices. Home spot talks and live
result talks play in their host screen. It needs Live2D Cubism Core for Web and, for the voices' lip sync, the CRI Core
of Live2D's MotionSync plugin; the page loads both itself. An episode that uses a part the player does not reproduce
is refused before it starts, with an error that names that part. The exception is a UIParticle graphic on a frame,
which is found only while drawing: the episode stops at that frame ([docs/story.md](docs/story.md#not-reproduced)).
The story data comes from nnnotes (`nnnotes web --all-stories`).

Checked on the 946 episodes of one region's data (English text, no sound files):

- Headless, on a faster clock: 930 play to their end. 16 are refused because they use the centered talk window.
- Drawn at normal speed, a sample of 56 episodes covering every kind of drawn feature: 44 play to their end. Of the
  others, 5 are refused before they start (the centered talk window, the chat window, a spot room lit by URP) and 7
  stop at a UIParticle frame, which the player does not draw.
- Of the 20 sampled episodes drawn twice, the 15 that play to their end give the same commands, lines and per-frame
  state in both runs.
- Every file a story reads is listed in its manifest.

## Browser support

WebGL2 and WebAudio (the custom element also needs Custom Elements and ResizeObserver), and `decodeAudioData` support
for FLAC and AAC in MP4. Tested in Chromium-based browsers.

## Development

Node.js 20 or later.

```sh
npm ci
npm test                  # unit tests (node --test, synthetic inputs only)
npm run build             # browser bundles in dist/
npm run typecheck         # checks the type declarations in types/
npm run validate-data -- <site dir> [chart id ...]              # validates a site against the data format
OURNOTES_DATA=<site dir> npm run test:data                      # opt-in: runs the player in Node on real chart data
```

Commit conventions, tests and the data policy are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The repository is licensed under AGPL-3.0-only (see [LICENSE](LICENSE)). The browser bundles under `dist/` distributed
through npm carry the additional browser linking permission in [LICENSE-EXCEPTION](LICENSE-EXCEPTION): loading an
unmodified bundle in an end user's browser and linking it with your own front-end code does not by itself make that
front-end code subject to the AGPL. Modifying the player, or running it on a server or in any other non-browser
environment, remains under the full AGPL, including the source-disclosure obligation for network use.
