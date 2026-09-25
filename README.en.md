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

The control bar has play / pause, the position with seeking, the speed (0.5–1.5×), and music and sound effect
switches; it hides while playing and shows on pointer movement, a tap or a key. Keyboard, while the player has the
focus: Space or K play / pause, Left / Right back / forward 5 s, Up / Down speed, M music, S sound effects.

A seek re-simulates the chart frame by frame from the start (or from the current position) to the target: judgements,
combo, notes and UI are those of an uninterrupted run at that time.

## Quick start

```sh
npm install ournotes-player
```

Custom element, with a bundler:

```js
import "ournotes-player/element";
```

```html
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

Without a bundler, from a CDN:

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

- API: [docs/api.md](docs/api.md)
- Embedding and hosting the data: [docs/embedding.md](docs/embedding.md)
- Data format: [docs/data-format.md](docs/data-format.md)

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
