# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player reproduces three kinds of BanG Dream! Our Notes screens in a web page: the auto play of a live chart,
story episodes (ADV, home spot talks and live result talks included), and the Live2D characters. It draws with the
game's own shaders, running the GLSL ES 3.00 programs that Unity compiled from the data in WebGL2. Sound goes
through WebAudio. Each of the three can be embedded in other pages as a custom element, as a JavaScript module or in
an iframe.

This is an unofficial fan project, not affiliated with the game's developer, publisher or operator. The repository
and the npm package contain no game assets: the player reads data prepared in the data formats
([live and Live2D](docs/data-format.md), [stories](docs/story-data-format.md)), supplied by the user; the
[nnnotes](https://github.com/MetaSekaiLab/nnnotes) toolkit produces that data from the user's own game files.
BanG Dream! and related names and trademarks belong to their respective owners.

## Components

| | Live charts | Stories | Live2D models |
|---|---|---|---|
| Custom element | `<ournotes-player>` | `<ournotes-story>` | `<ournotes-live2d>` |
| Modules | `ournotes-player`, `ournotes-player/element` | `ournotes-player/story`, `ournotes-player/story/element` | `ournotes-player/live2d`, `ournotes-player/live2d/element` |
| Main class | `ChartPlayer` | `StoryPlayer` | `ModelPlayer` |
| Browser bundles (`dist/`) | `ournotes-player.*` | `ournotes-player.story.*` | `ournotes-player.live2d.*` |
| The page loads | — | Live2D Cubism Core; the MotionSync Core for lip sync; a Spine runtime for home spot talks | Live2D Cubism Core |
| Docs | [api.md](docs/api.md) | [story.md](docs/story.md) | [live2d.md](docs/live2d.md) |

Importing a `…/element` module defines its custom element; it exports the same API as the module without
`/element`. Every browser bundle comes in three forms: the ESM API, an ESM module that defines the element, and a
classic script that defines the element and exposes a global (`OurnotesPlayer`, `OurnotesStory`, `OurnotesLive2D`).
Each form also comes as `.min.js`, with source maps. The live chart entry points do not include the story and
Live2D code.

Live2D Cubism Core, the MotionSync Core and the Spine runtime belong to their owners and come under their own
licenses. The repository, the npm package and the bundles do not include them; the page loads them before it creates
a player.

## Quick start

```sh
npm install ournotes-player
```

Installing from GitHub (`npm install github:empty-sekai/ournotes-player`) builds `dist/` during the install.

A live chart. With a bundler, use `import "ournotes-player/element";`. Without one, load the bundle from a CDN:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.element.min.js"></script>
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

A story:

```html
<script src="live2dcubismcore.min.js"></script>
<script src="live2dcubismmotionsynccore.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.story.element.min.js"></script>
<ournotes-story src="https://example.org/site/stories/10462.json" lang="ja"></ournotes-story>
```

A Live2D model:

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.live2d.element.min.js"></script>
<ournotes-live2d src="https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json"
                 style="width: 360px"></ournotes-live2d>
```

JavaScript module:

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.getElementById("stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
});
button.onclick = () => player.play();   // browsers start audio only from a user gesture
```

Example pages. Open them with any static server at the repository root:

| Page | Contents |
|---|---|
| [examples/basic.html](examples/basic.html) | one `<ournotes-player>` |
| [examples/iframe.html](examples/iframe.html) | a page holding one player, ready to embed with an `<iframe>` (`?src=`) |
| [examples/chart-list](examples/chart-list) | lists a site's `charts.json` and plays the chosen chart; a site of several regions or languages switches with `?region=&lang=` |
| [examples/songs](examples/songs) | chart data: reads a site's `songs.json` (nnnotes songs), `chart-stats.json` (ournotes-deck chart-stats, optional) and `jackets/` (optional); rankings by efficiency, speed, level, notes, length and skip score, a scatter plot and level distribution, chart details (BPM, density, fever and skill timeline, notes by kind, skill position weights) and a guide to every figure; song pages link to moenotes |
| [examples/story-list](examples/story-list) | lists a site's `stories.json` and plays the chosen episode |
| [examples/story](examples/story) | plays one episode (`?story=` or `?src=`). Live2D's two files come from `?core=` and `?motionsync=`, the Spine runtime for home talks from `?spine=` |
| [examples/live2d](examples/live2d) | lists a site's `models.json`, shows the chosen model and plays its motions and expressions |

## Live charts

`<ournotes-player>` plays one chart the way the game's auto play does. It draws:

- the 3D lane and stage (the game's LightWeight background mode), notes, hold lines, guide lines and
  simultaneous-note lines;
- hit effects and particles;
- the judgement and combo UI;
- the URP post-processing.

It plays the music and the note sound effects, and the chart clock follows the audio clock. The run matches the
game's auto play: every judgement Perfect, default options, a 60 fps simulation in float32 arithmetic.

The control bar has:

- play / pause, the position with seeking, and the playback speed (0.5–1.5×);
- the note speed: − / + step it by 0.1, with Shift by 1, and the value can also be typed;
- a settings panel with the game's own Live settings (note speed, judgement and note timing, lane and UI display,
  volumes, ...). The settings are in the game's groups, with the game's ranges and defaults, and the panel lists only
  those the chart's data supports.

The controls are in five languages (English, Japanese, Korean, Simplified and Traditional Chinese) and follow the
page's language; the keyboard shortcuts are in [docs/api.md](docs/api.md).

A seek re-simulates the chart frame by frame to the target. Judgements, combo, notes and UI are those of an
uninterrupted run at that time.

What matches the game frame for frame and what is a feature of the player is listed in
[docs/fidelity.md](docs/fidelity.md).

## Stories

`<ournotes-story>` plays one episode the way the game's story screen does: it runs the episode's command rows on the
game's playback loop. It draws:

- the stage: background, lights and volumes;
- the Live2D characters, with their motions, expressions, look and lip sync;
- the camera, focus, blur and post-processing;
- frames, stills, particle effects, flashes and the chat phone;
- the talk window, with its typewriter, speaker names, location caption and title;
- the rule transitions.

It plays the music, sound effects and voices. Every one of the game's 68 story commands has a handler. The player
also covers:

- **Home spot talks and live result talks.** They play through the game's simple story player in their host screen:
  the 3D spot room with its Spine characters for a home talk, the reward phase of the result screen for a live result
  talk ([docs/story-simple.md](docs/story-simple.md)).
- **Videos.** The videos of Movie and Clip rows play with their own sound at the game's movie volume; the music,
  sound effect and voice volumes do not change it. A video can be paused, and its bar seeks it.
- **The control bar**, with two kinds of item:
  - the story menu's items: next, auto, fast-forward (×1 → ×1.5 → ×1.7 → ×2), skip (with a confirmation) and the
    three volumes;
  - the player's own items: play / pause, a line bar that seeks by line, and a video bar.
- **Languages.** The story text comes in the languages the data holds (Japanese, English, Traditional and Simplified
  Chinese, Korean). The language can change during playback; the episode then restarts at the current line. The
  control bar follows the story's language unless `ui-lang` sets it.
- **Film grain.** It is off by default; the `film-grain` attribute draws it at the game's intensity
  ([#1](https://github.com/empty-sekai/ournotes-player/issues/1)).

An episode that uses a part the player does not reproduce is refused before it starts, with an error that names that
part; it never plays halfway. The one exception is a UIParticle graphic on a still. It is found only while drawing,
and the episode stops at that frame ([docs/story.md](docs/story.md#episodes-the-player-refuses)).

Checked on the 946 episodes of one region's data, without sound files (English text unless stated):

- Headless, on a faster clock: all 946 play to their end.
- Drawn at normal speed, a sample of 57 episodes covering every kind of drawn feature, the canvas particles of frames,
  the centered talk window, the chat phone and the spot rooms lit by URP among them: all 57 play to their end.
- The 9 episodes with emoji, in Japanese and in English, drawn on the faster clock: all 18 play to their end.
- Drawn twice, the 20 sampled episodes and the 18 emoji runs give the same commands, lines and per-frame state in
  both runs.
- Every file a story reads is listed in its manifest.

## Live2D models

`<ournotes-live2d>` shows one character the way the game's story screen runs it: idle motion, auto eye blink, breath
and physics. It plays the model's motions and sets its expressions, drawing with the game's own Live2D shaders from
the data. It is a model viewer; the story's stage, camera and text are not part of it. See
[docs/live2d.md](docs/live2d.md).

## Data

The player reads a static site:

- `charts.json` and `charts/`: the charts;
- `models.json` and `models/`: the Live2D models, shared by the model viewer and the stories;
- `stories.json` and `stories/`: the stories, each manifest listing the models it uses;
- the content-addressed asset files: JSON, GLSL, moc3 and a few other kinds are stored gzip- (or brotli-) encoded
  where that makes them smaller, and the player decodes them.

nnnotes builds such a site from the user's own game files, for example:

```sh
nnnotes web out/site --all --all-live2d --all-stories --player <ournotes-player dir>
```

- The player also reads data in the earlier formats: assets stored as they are, and story manifests that hold the
  models' files inside each story (`ournotes.story-manifest/1`).
- Hosting (paths, CORS, encoded assets, caching): [docs/embedding.md](docs/embedding.md#hosting-the-data). A site
  encoded with brotli plays in Chromium-based browsers only when its `.br` assets are served with
  `Content-Encoding: br`.
- Validation: `npm run validate-data -- <site dir>` checks the charts, models and stories against the data formats and
  the schemas in `schema/`, including each story against its models.

## Documentation

| Topic | Documents |
|---|---|
| Embedding and hosting, several players, mobile | [embedding.md](docs/embedding.md) |
| Live charts: API / data format / fidelity | [api.md](docs/api.md) / [data-format.md](docs/data-format.md) / [fidelity.md](docs/fidelity.md) |
| Stories: API and fidelity / feature modules / simple story player / data format | [story.md](docs/story.md) / [story-features.md](docs/story-features.md) / [story-simple.md](docs/story-simple.md) / [story-data-format.md](docs/story-data-format.md) |
| The mouths of models without a MotionSync controller (CRI Lips analysis) | [crilips.md](docs/crilips.md) |
| Live2D models: API and behaviour / data format / fidelity | [live2d.md](docs/live2d.md) / [data-format.md](docs/data-format.md#live2d-models) / [fidelity.md](docs/fidelity.md#live2d-models) |
| Performance | [performance.md](docs/performance.md) |

## Browser support

WebGL2, WebAudio and ES2022 modules; the custom elements also need Custom Elements and ResizeObserver. Audio needs
`decodeAudioData` support for FLAC and AAC in MP4, and the story videos need WebM playback (VP9 and Opus). Tested in
Chromium-based browsers.

## Development

Node.js 22 or later.

```sh
npm ci
npm test                  # unit tests (node --test, synthetic inputs only)
npm run build             # browser bundles in dist/
npm run typecheck         # checks the type declarations in types/
npm run validate-data -- <site dir> [chart id ...]              # validates a site against the data format
OURNOTES_DATA=<site dir> npm run test:data                      # opt-in: runs the player in Node on real chart data
```

Branches, commit conventions, tests and the data policy are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The repository is licensed under AGPL-3.0-only (see [LICENSE](LICENSE)). The browser bundles under `dist/` distributed
through npm carry the additional browser linking permission in [LICENSE-EXCEPTION](LICENSE-EXCEPTION): loading an
unmodified bundle in an end user's browser and linking it with your own front-end code does not by itself make that
front-end code subject to the AGPL. Modifying the player, or running it on a server or in any other non-browser
environment, remains under the full AGPL, including the source-disclosure obligation for network use.
