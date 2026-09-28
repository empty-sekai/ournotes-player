# Embedding

Three ways to put a chart on a page: the custom element, the JavaScript API, or an iframe of a page that holds the
player. All of them read a chart from a site laid out as below.

## Custom element

With a bundler:

```sh
npm install ournotes-player
```

```js
import "ournotes-player/element";
```

Installing from GitHub (`npm install github:empty-sekai/ournotes-player`) builds `dist/` during the install.

From a CDN, without a build step (the jsDelivr npm URL works once the package is on npm; until then, serve
`dist/ournotes-player.element.min.js` of the installed package, or of a checkout after `npm run build`, with the page):

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.element.min.js"></script>

<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls
                 style="max-width: 960px"></ournotes-player>
```

A classic script (`dist/ournotes-player.global.min.js`) defines the element too and exposes the API as the global
`OurnotesPlayer`.

The element is 16:9 at its width unless it has a height. Changing `src` loads another chart. See [api.md](api.md) for
its attributes, properties and events.

## JavaScript

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.getElementById("stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
});
player.addEventListener("ended", () => console.log("done"));
```

`host` can be any element; the player appends one `<div>` (with a shadow root) that fills it. Call `player.dispose()`
to remove it and release its WebGL context and audio. For a player without its own canvas management, use
`ChartSession` (see [api.md](api.md)).

## iframe

A page that holds one player can be embedded from another origin with an iframe; hosted next to the site, it needs no
CORS setup. [examples/iframe.html](../examples/iframe.html) is such a page: it plays the manifest named by `?src=`
(relative to the page), filling the frame; `speed`, `music=off`, `se=off` and `autoplay` are read from the query
too.

```html
<iframe src="https://example.org/player/iframe.html?src=../site/charts/100001_expert.json"
        style="width: 100%; aspect-ratio: 16 / 9; border: 0" allow="autoplay; fullscreen"></iframe>
```

`allow="autoplay"` lets the frame start audio without a gesture inside it where the browser supports the permission.

## Hosting the data

A site is a directory served over HTTP(S):

```
charts.json                  list of the charts (the chart-list example reads it)
charts/<musicId>_<difficulty>.json    one manifest per chart
models.json, models/<id>.json         the Live2D models (the model viewer and the stories read them)
stories.json, stories/<advId>.json    the stories
assets/<sha256>.<ext>        every file of every chart, model and story, named by its content hash
assets/<sha256>.<ext>.gz     the same, stored gzip-encoded (.br: brotli-encoded)
```

A manifest lists the files of one chart and the asset that holds each one; the format is in
[data-format.md](data-format.md) (stories: [story-data-format.md](story-data-format.md)). The player fetches the
manifest, then every asset it lists, before the chart starts. A chart is about 40–45 MB; charts share most of their
assets (stage, notes, effects), so a browser that caches them downloads much less for the second chart.

Serving notes:

- **Paths.** Asset paths in a manifest are relative to the site root. For a chart or model manifest the player takes
  the directory above the manifest's directory (`charts/..`, `models/..`). A story manifest of format `/2` names the
  site root in its `root`, so `stories/<region>/<advId>.json` works too, and the model manifests it uses are found
  from there; for one of format `/1` the player takes the directory above the manifest's directory. A manifest served
  from somewhere else needs `AssetStore.fromManifest(url, { base })` (`loadStoryStore(url, { base })` for a story).
- **CORS.** A page on another origin than the site needs `Access-Control-Allow-Origin` (for example `*`) on the
  manifests and the assets. No credentials are sent, and the requests are simple GETs (no preflight).
- **Encoded assets.** The JSON, GLSL and moc3 assets (and the other kinds listed in
  [data-format.md](data-format.md#site-layout)) are stored encoded where that makes them smaller: `.gz`, or `.br` in a
  site built with brotli. The manifest gives each one's stored and decoded byte counts. Served as plain files, they
  are decoded by the player with the browser's `DecompressionStream`: gzip in current browsers, brotli where
  `DecompressionStream("brotli")` exists (Firefox and Safari; not Chromium-based browsers). The server may instead
  send them with the matching `Content-Encoding` (`gzip` for `.gz`, `br` for `.br`) and a type of the logical file;
  the browser then decodes them and the player takes them as they arrive. A brotli site that Chromium-based browsers
  must play has to be served that way, with `Content-Encoding: br` on the `.br` assets. A server must not compress
  the encoded assets again.
- **Compression of the other files.** Manifests, index files and plain `.json` / `.glsl` assets compress well with
  the server's own `Content-Encoding`; the PNG and audio files are already compressed. The manifest's sizes are those
  of the decoded files.
- **Caching.** Assets never change under their name: `Cache-Control: public, max-age=31536000, immutable`. Manifests
  and the index files change when the site is rebuilt: a short max-age or revalidation.
- **Types.** `application/json`, `image/png`, `audio/flac`, `audio/mp4` (`.m4a`), `text/plain` (`.glsl`); an encoded
  asset served as a plain file can be `application/octet-stream` (`application/gzip` for `.gz`).

## Browser requirements

WebGL2, WebAudio, `ResizeObserver`, ES2022 modules; custom elements for the element. The audio files are AAC (MP4) and
FLAC; current desktop and mobile browsers decode both.

## Mobile

The player works at phone width (the control bar compacts below 480 px) and with touch: a tap shows or hides the
control bar, the buttons and the seek bar take taps. Audio starts on the first tap of the play button. The drawing
buffer follows `devicePixelRatio`; on a slow device pass `pixelRatio: 1` (or a lower value) to `ChartPlayer.create`.
A story draws at the screen the game renders at for its quality (at most 1920 pixels on the longer side at Best and
High, 1440 at Middle) rather than at every device pixel ([story.md](story.md), `resolution`); on a slow phone
`quality="middle"` also turns off what the game turns off at Middle (the character and background blur, the stage post
effect, Unity lighting, the breath motion, FXAA).

## Several players on one page

Each player has its own WebGL context, `AudioContext` and state; players do not interfere. Browsers limit the number of
live WebGL contexts per page (16 in Chromium), and every loaded chart holds its files in memory: dispose players that
are no longer shown.
