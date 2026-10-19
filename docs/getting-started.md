# Getting started

ournotes-player 0.2.x consumes nnnotes 0.3.x products and format 2 chart/model sites. Use Node.js 22+ for package
tools. Browser playback requires WebGL2, WebAudio and the audio/video codecs used by your data.

## Install

```sh
npm install ournotes-player@0.2.0
```

The npm package includes source modules, types, schemas, browser bundles and site tools. Use its directory,
`node_modules/ournotes-player`, as nnnotes' `--player` argument. The browser ZIP in a GitHub release is useful for
embedding bundles; a site build needs the complete package, including scripts, metadata and example pages.

## Prepare a site

Configure [nnnotes](https://metasekailab.github.io/nnnotes/quickstart/) with your own input files first:

```sh
pip install 'nnnotes[fonts]==0.3.0'
nnnotes site build --name example -o out/site --pair 100001:expert --fonts game --player node_modules/ournotes-player
node node_modules/ournotes-player/scripts/validate-data.mjs out/site
python -m http.server 8000 --directory out/site
```

Open `http://localhost:8000/` for charts. Add `--story ID` to select a story, or `--live2d KEY` for a model.
The respective pages are `story/` and `live2d/`. Use IDs available in the configured catalog and master data.

Site builds reuse the named selection's depot results. Keep its indexes, manifests and assets together when
hosting it. See [embedding](embedding.md#hosting-the-data) for paths, caching and compression headers.

## Browser runtimes

| Feature | Runtime loaded by the page |
|---|---|
| Live chart playback | Browser WebGL2 and WebAudio |
| Live2D models and story characters | Live2D Cubism Core |
| Models with MotionSync lip sync | Live2D MotionSync Core, in addition to Cubism Core |
| Home conversations | Spine runtime, in addition to the story's other requirements |

Obtain these runtimes under their respective licenses and load them before creating the relevant player.
The example story page accepts `?core=URL&motionsync=URL&spine=URL`; pass the URLs needed by that story.
The model page accepts `?core=URL`. These files are provided separately from the player package.

## Embed a chart

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.2.0/dist/ournotes-player.element.min.js"></script>
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

For stories, load the required runtime scripts and `ournotes-player.story.element.min.js`, then use
`<ournotes-story src="https://example.org/site/stories/10462.json" lang="ja"></ournotes-story>`.
For models, load Cubism Core and `ournotes-player.live2d.element.min.js`, then use `<ournotes-live2d src="...">`.
Use a language declared by the story product. The [embedding guide](embedding.md) covers JavaScript and iframe APIs.

## Validate and diagnose

Run the validator against the complete exported directory. It checks manifests, object references, asset sizes,
chart facts and declared languages. In a browser, inspect failed network requests, required runtimes and decode
errors. For a cross-origin page, return CORS headers on every manifest and asset. Chromium playback of `.br`
assets requires `Content-Encoding: br`.
