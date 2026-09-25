# Data format

The player does not ship any game data. It plays a chart from a set of **logical files** (paths such as
`live.json` or `livescene/scene.json`) that the embedding page supplies, usually as a static **site** served over
HTTP. This document describes that data: the site layout, the chart manifest, and every logical file as far as the
player reads it. Producing the data is outside this repository.

Machine-readable schemas are in [`schema/`](../schema), and `node scripts/validate-data.mjs <site dir> [chart id ...]`
checks a whole site (see [Validation](#validation)).

Keys that are not described here are ignored by the player; producers may add their own. Where a structure comes
from the game's Unity data (scene hierarchy, prefabs, materials, animation clips, particle systems), this document
describes its shape and the conventions it follows rather than every serialized field.

Contents:
[Site layout](#site-layout) ·
[charts.json](#chartsjson) ·
[Chart manifest](#chart-manifest) ·
[Logical files](#logical-files) ·
[live.json](#livejson) ·
[Score](#score) ·
[Sounds](#sounds-audiolive-audiojson) ·
[Live scene](#live-scene-livescenescenejson) ·
[Note assets](#note-assets-livenotesnotesjson) ·
[Shaders](#shaders) ·
[Textures](#textures) ·
[Conventions](#conventions) ·
[Validation](#validation)

## Site layout

```
<site>/
  charts.json                          chart index (for listings; the player does not need it)
  charts/<musicId>_<difficulty>.json   chart manifest, one per chart
  assets/<sha256>.<ext>                file contents, content-addressed
```

- `<sha256>` is the lowercase hex SHA-256 of the asset's bytes, `<ext>` the extension of the logical file it holds
  (`json`, `glsl`, `png`, `flac`, `m4a`). Identical contents are stored once and shared between charts, so assets can
  be served with long-lived, immutable caching.
- Asset paths in a manifest are relative to the site root. When a page loads a manifest by URL, the player resolves
  asset paths against the directory above the manifest's directory (`charts/..`) unless it is given another base
  (see [docs/api.md](api.md)).
- Any static file server works. The page that embeds the player must be allowed to fetch the site (same origin, or
  CORS headers on the site).

A page can also hand the player the logical files directly, without a site; the files and their contents are the
same (see [docs/api.md](api.md)).

## charts.json

The index of the charts a site offers ([schema](../schema/charts.schema.json)). Chart listings read it; the player
does not.

```json
{ "format": 2, "charts": [ { "id": "100001_expert", "musicId": 100001, "difficulty": "expert",
                             "manifest": "charts/100001_expert.json", "title": "…", "level": 25, "notes": 768,
                             "durationMs": 99989, "audio": true, "audioFormat": "aac", "flows": ["direct", "game"],
                             "bytes": 42860517, "…": "…" } ] }
```

| Key | Type | Meaning |
|---|---|---|
| `format` | `2` | Version of this layout. |
| `charts[].id` | string | `<musicId>_<difficulty>`. |
| `charts[].musicId`, `difficulty` | integer, string | The chart. Difficulties in the current data: `easy`, `normal`, `hard`, `expert`. |
| `charts[].manifest` | string | Path of the chart manifest, relative to the site root. |
| `charts[].title`, `bands`, `bandIds`, `stageBand`, `level`, `displayLevel`, `notes`, `fullComboCount`, `durationMs`, `sortOrder` | | The chart's facts; the same values as the manifest's `chart` object. |
| `charts[].audio`, `audioFormat`, `flows` | | Copies of the manifest keys of the same name. |
| `charts[].bytes` | integer | Sum of `size` over the manifest's `files` (the download size before shared assets are deduplicated). |

## Chart manifest

`charts/<musicId>_<difficulty>.json` ([schema](../schema/manifest.schema.json)) lists the logical files of one chart
and where their bytes are.

```json
{
  "format": 2,
  "musicId": 100001,
  "difficulty": "expert",
  "chart": { "title": "…", "level": 25, "notes": 768, "durationMs": 99989, "…": "…" },
  "audio": true,
  "audioFormat": "aac",
  "flows": ["direct", "game"],
  "quality": 1,
  "files": {
    "live.json": { "asset": "assets/5203…cba0.json", "size": 466 },
    "livenotes/notes.json": { "parts": [["settings", "assets/45be…f418.json", 1691],
                                        ["prefabs", "assets/f367…e839.json", 735095], "…"], "size": 4192212 },
    "…": "…"
  }
}
```

| Key | Type | Read by the player | Meaning |
|---|---|---|---|
| `format` | `2` | no | Version of this layout. |
| `musicId`, `difficulty` | integer, string | no | The chart. |
| `chart` | object | yes | The chart's facts (title, bands, level, note count, duration, …), handed to the page as they are (see [docs/api.md](api.md)). The player does not interpret them. |
| `audio` | boolean | yes | `false`: the chart has no waveform files. The player then plays no sound and runs the chart clock from game time, as with the music switched off. |
| `audioFormat` | `"aac"` \| `"flac"` | no | Format of the music file: AAC in an MP4 container (`.m4a`) or FLAC. Sound effects are FLAC. |
| `flows` | string[] | no | Start flows the files support. The player always uses the direct start (the chart starts at the end of the live's intro timeline), which every chart supports (`"direct"`). `"game"` means the files for the game's own start sequence are included as well; this player does not use them. |
| `quality` | `0` \| `1` \| `2` | yes | The `LiveQuality` the files were prepared for (0 High, 1 Middle, 2 Low); the default quality of the player. The current data uses 1 (Middle, the game's default option). |
| `files` | object | yes | Logical path → file entry. |

### File entries

A file entry has one of two forms:

- **Whole file**: `{ "asset": "assets/<sha256>.<ext>", "size": <bytes> }`.
- **Split JSON object**: `{ "parts": [[key, asset, size], ...], "size": <bytes> }`. A large JSON file whose top level
  is an object is stored per top-level key: each part's asset holds the raw JSON text of that key's value. The file's
  text is rebuilt as

  ```
  "{" + join(parts.map(([key, asset]) => JSON.stringify(key) + ":" + text(asset)), ",") + "}"
  ```

  and its UTF-8 length must equal `size`. The parts are concatenated as text, never re-serialized, so every number
  stays exactly as written (see [Conventions](#conventions)).

Rules:

- Logical paths are relative, use `/`, and are unique. Paths ending in `.json` or `.glsl` are UTF-8 text; every other
  file is binary.
- Every asset's byte length must equal its `size`; the player checks it while loading.
- The player fetches every listed file before the chart starts (several requests at a time), so a manifest should list
  only what a chart needs. Files the player does not read (the current data includes `liveui/` and some shaders for
  the game's start sequence) are fetched but unused.

## Logical files

The files the player reads, starting from `live.json`:

| Logical file | Content |
|---|---|
| `live.json` | Index: the paths of the four files below. |
| score, e.g. `score/0001_03.notes.json` | Notes and lines of the chart. |
| `audio/live-audio.json` | Sounds: cues, waveform layers, category volumes, ducking, sound ids. |
| audio files, e.g. `audio/<sheet>/<name>.flac`, `.m4a` | Waveforms named by `audio/live-audio.json`. |
| `livescene/scene.json` | The live scene: cameras, lane, stage, background, UI canvas, post-processing settings. |
| `livescene/shaders/…`, `livescene/textures/…` | Shaders and textures of the scene. |
| `livenotes/notes.json` | Note views, note skin, hit effects, particles, judgement and combo UI, animation clips. |
| `livenotes/shaders/…`, `livenotes/textures/…` | Shaders and textures of the notes and effects. |

The directory names `livescene/` and `livenotes/` are fixed: the player looks up shaders in `livescene/shaders/` and
`livenotes/shaders/`, and texture paths inside `livescene/scene.json` and `livenotes/notes.json` are relative to
their own directory.

## live.json

([schema](../schema/live.schema.json))

```json
{ "musicId": 100001, "difficulty": "expert", "scene": "livescene/scene.json",
  "notes": "score/0001_03.notes.json", "noteAssets": "livenotes/notes.json", "liveAudio": "audio/live-audio.json" }
```

| Key | Meaning |
|---|---|
| `scene` | Path of the live scene. |
| `notes` | Path of the score. |
| `noteAssets` | Path of the note assets. |
| `liveAudio` | Path of the sound definitions. |

## Score

The file `live.json` `notes` names ([schema](../schema/score.schema.json)): the notes and lines of one chart, as the
game's music score loader produces them.

| Key | Type | Meaning |
|---|---|---|
| `laneCount` | integer | Number of lanes (24 in the current data). Lanes are numbered 0 to `laneCount - 1`. |
| `notes` | array | Every note, in the order the game's simulation updates them. The order matters. |
| `lines` | array | Hold lines and guide lines. |

A note:

| Key | Type | Meaning |
|---|---|---|
| `id` | integer | Unique note id (> 0). |
| `op` | integer | The note's `NoteOperateType` (table below). |
| `timeMs` | integer | Chart time of the note, in milliseconds from the music start. |
| `bar`, `barProgress` | integer, number | Bar index and position inside the bar (0 ≤ `barProgress` < 1). The note with the largest `bar + barProgress` is the last timing note. |
| `laneStart`, `laneEnd` | integer | First and last lane the note covers. Notes generated along a line can lie partly outside the lanes. |
| `laneStartFloat`, `laneEndFloat`, `width` | number | The same position with fractions, and the width in lanes. |
| `critical` | boolean | Critical note (a different judgement type for `op` 1 and 20). |
| `direction` | `"Normal"` \| `"Left"` \| `"Right"` | Flick direction. |
| `slideAlong` | boolean | The note lies on a line but is not one of the nodes that shape it. |
| `lineIds` | integer[] | Ids of the lines the note belongs to. |
| `lineEase`, `lineEaseR` | `"Linear"` \| `"EaseIn"` \| `"EaseOut"` | Easing of the left and right edge of the line segment that starts at this note. |
| `pairNoteId` | integer | The simultaneous note joined to this one by a pair line; 0 for none. |

`op` values (the game's names):

| op | Name | op | Name | op | Name |
|---|---|---|---|---|---|
| 1 | Normal | 42 | SlideEndFlick | 100 | GuideBegin |
| 20 | SlideBegin | 60 | Trace | 101 | GuideBeginNormal |
| 21 | SlideConnection | 61 | SlideBeginTrace | 102 | GuideBeginFlick |
| 22 | SlideEnd | 62 | SlideEndTrace | 103 | GuideEnd |
| 40 | Flick | 63 | SlideConnectionTrace | 104 | GuideBeginTrace |
| 41 | SlideBeginFlick | 80 | HiddenSlideBegin | 120 | Combo |
| | | 82 | HiddenSlideEnd | 121 | ComboSkip |
| | | | | 122 | Hidden |

The player also accepts `op` 105, which it handles like 104. Any other value is an error.

A line:

| Key | Type | Meaning |
|---|---|---|
| `lineId` | integer | Unique line id (> 0). |
| `type` | `"long"` \| `"guide"` | A hold (slide) line, or a guide line. |
| `noteIds` | integer[] | The notes of the line, in time order. |

Other keys of the score (bar lines, BPM changes, fever and skill ranges, …) are not read.

## Sounds (`audio/live-audio.json`)

([schema](../schema/live-audio.schema.json)) The sounds of one live, after the game's CRI ADX2 cue data: each sound
id names a cue made of one or more waveform layers, routed through CRI categories.

| Key | Meaning |
|---|---|
| `sounds` | Sound id (decimal string) → cue (below). |
| `categories` | CRI category name → volume. A cue plays at the product of the volumes of its categories. |
| `react` | Ducking rules (REACT): `[{src, dest, level, decrementMs, incrementMs, holdMs}]`. While a cue of category `src` plays, category `dest` goes to `level` over `decrementMs`; after the last one ends it holds for `holdMs`, then returns to 1 over `incrementMs`. |
| `music` | `{ soundId }`: the music (BGM). |
| `noteSe` | `{ types, volumes, mutes }`: `LiveNoteSeType` → sound id / volume / muted. |
| `liveSe` | `LiveSeType` → sound id. |
| `voice` | Optional: `startVoiceSoundId`, `clearVoiceSoundId`, `fullComboVoiceSoundId`, `allPerfectVoiceSoundId` (absent or -1: none). |

A cue (`sounds.<id>`):

| Key | Meaning |
|---|---|
| `sheet`, `cue` | Cue sheet and cue name (used in messages). |
| `category` | The sound's category in the game's sound master data. |
| `categories` | CRI category names the cue plays in; each must have a volume in `categories`. |
| `volume` | Cue volume. |
| `row._isRandomPitch` | Must be `false` (random pitch is not implemented). |
| `layers` | Waveforms played together (below). |

A layer:

| Key | Meaning |
|---|---|
| `file` | Logical path of the waveform: FLAC, or AAC in MP4 (`.m4a`). |
| `sampleRate` | 48000. The player decodes at 48 kHz and checks the decoded rate. |
| `channels` | Channel count. |
| `samples` | Length of the waveform in sample frames, without encoder padding. The music's first layer defines the chart's length: `floor(samples × 1000 / sampleRate)` ms. |
| `loopFlag`, `loopStart`, `loopEnd` | `loopFlag` 2 with loop points (sample frames): the waveform loops by itself. When the player loops a cue (the hold sound effect) a layer loops at its loop points, else as a whole. `loopStart` and `loopEnd` are both `null` when there are none. |
| `volume` | Layer volume (multiplied with the cue volume). |
| `encoderDelay` | Optional, AAC only: the encoder's priming samples at the start of the stream. A browser decoder that ignores the MP4 edit list returns them first; when the decoded buffer holds at least `samples + encoderDelay` frames, the player drops the first `encoderDelay` frames and keeps `samples`. |

Types and sounds the player uses:

- `noteSe` types 1–14: 1 InVain, 2 Good, 3 Great, 4 Perfect, 5 Flick, 6 FlickDirection, 7 Slide (the hold loop),
  8 Just, 9 Trace, 10 SlideConnect, 11–14 the Gekisou variants. Every type listed in `types` must have its sound in
  `sounds`.
- `liveSe`: the player's auto play ends every chart with an all perfect, so of the live sound effects it plays
  FinishCheers (10) and AllPerfectDirection (16). Their sounds must be in `sounds`; sounds of other types may be
  omitted.
- Every sound in `sounds` is decoded before the chart starts.

Other keys (cue sheet details, bus sends, timeline timings of the game's start sequence, …) are not read.

## Live scene (`livescene/scene.json`)

The live scene after Unity serialization, plus the few assets and master data rows the player needs. It is usually
large and stored as a split JSON object. Keys read:

| Key | Content |
|---|---|
| `scene` | `{ key, nodes }`: the live scene's GameObject hierarchy (a node list, below). |
| `assets.startTimeline` | The live's intro timeline prefab (node list). The direct start runs it to its end without drawing, so stage, lane and tap area start as the game leaves them when the music starts. |
| `assets.laneLinePrefab` | The lane line prefab (node list). |
| `laneSkin` | `{ lane_base, lane_tap_area, out_side_line }`: sprite descriptors of the lane skin. |
| `sprites` | `{ lightweightBackground, jacket }`: sprite descriptors of the LightWeight background and the music jacket. |
| `master.liveQualitySettings` | Rows of the game's live quality master data (`_quality`, `_effectRenderingScale`, …); the row of the active quality must exist. |
| `master.optionDefaultsPreset1` | Default option values: option name → `{ id, value }` (value as a string, as in the master data). |
| `postTextures.ForwardRendererLiveGameEffect.filmGrainTex` | Texture descriptors of the post-processing film grain textures. |

Other keys are not read.

### Node lists

A scene, prefab or effect is a node list: `{ key, nodes: [node, ...] }`, nodes in hierarchy order (every parent
before its children).

```json
{ "path": "Live/LiveGameView/Lane", "name": "Lane", "active": true, "layer": 0,
  "localPosition": {"x": 0, "y": 0, "z": 0}, "localRotation": {"x": 0, "y": 0, "z": 0, "w": 1},
  "localScale": {"x": 1, "y": 1, "z": 1}, "components": [ … ] }
```

- `path` is the `/`-joined chain of GameObject names from the root; it identifies the node and gives its parent.
- `components` are in GameObject order. Each has `type` (the Unity class, e.g. `Camera`, `MeshRenderer`, `Animator`,
  `ParticleSystem`, or `MonoBehaviour`) and, for scripts, `class` (the script class, e.g. `Image`, `Canvas`,
  `UIComboCounterView`), followed by the component's serialized fields under their Unity names.
- A reference to another component is `{ "component": <type>, "gameObject": <node path>, "class"?: <script class> }`.
- Materials are inline: `{ material, shader: { shader: <shader name> }, keywords, renderQueue, textures: { <property>:
  { texture: <texture descriptor or null>, scale, offset } }, floats, ints, colors }`.
- A reference to an animator controller is `{ "controller": <key> }`, resolved in `livenotes/notes.json` `controllers`.

## Note assets (`livenotes/notes.json`)

Note views, the note skin, hit effects, particles and the live UI's judgement and combo assets. Usually stored as a
split JSON object. Keys read:

| Key | Content |
|---|---|
| `settings` | Lane and option settings (below). |
| `prefabs` | Name → node list: the note views (`tap_note_view`, `flick_note_view`, `flick_left_note_view`, `flick_right_note_view`, `slide_note_view`, `slide_end_note_view`, `connection_note_view`, `none_note_view`), `slide_line_view`, `pair_note_line`, `judge_effect_view`. |
| `noteSkin` | The note skin asset: its serialized fields (`TapNoteAsset`, `FlickNoteAsset`, `SlideLineGradient`, …) with referenced assets, sprites and materials inline. |
| `assets` | Asset key (the game's asset path, e.g. `Effect/Live/NoteEffect/effect001/note_normal`) → a node list (effect prefabs), a ScriptableObject's serialized fields (effect and sprite settings), or `{ key, controller }`. |
| `clips` | Clip key → animation clip. |
| `controllers` | Controller key → animator controller. |

`settings`:

| Key | Meaning |
|---|---|
| `laneCount`, `laneSize` | Lane count (equal to the score's) and the lane's reference size `[width, height]`. |
| `laneTopRange`, `laneBottomRange`, `laneTopPosition`, `judgementScreenBottomPosition`, `tiltCenterLane` | Lane geometry of the game's lane settings. |
| `effect` | Name of the effect set used for asset keys (e.g. `effect001`). |
| `optionDefaults` | Option name → default value as a string (`NoteSpeed`, `SlideOpacity`, `GuideOpacity`, …). |
| `optionRanges` | Option name → `[min, max]`. |
| `liveSettings` | Live master settings: `note_speed_min`, `note_speed_max`, `note_speed_view_min`, `note_speed_view_max` (strings). |
| `noteDisplayTimeMs` | Optional: the note display time for the default note speed. When present, the player checks that its own value equals it. |

Animation clips and controllers keep the structure of Unity's `AnimationClip` and `AnimatorController`:

- A clip has `name`, `sampleRate`, `wrapMode`, `startTime`, `stopTime`, `loopTime`, `cycleOffset`, `events`,
  `bindings` (`[{ path, typeID, class, attribute, curves }]`: which property each curve animates) and the curve data
  in Unity's three forms `streamed`, `dense` and `constant`, plus `pptrCurveMapping` and `discreteCurveCount`.
- A controller has `name`, `clips` (`[{ clip: <clip key> }]`), `layers`, `stateMachines`, `parameters` and
  `defaultValues`.
- Keys are `<name>#<id>`, so that equally named clips or controllers stay distinct. Every referenced key must exist.

Particle systems (`ParticleSystem` and `ParticleSystemRenderer` components in effect prefabs) keep Unity's module
structure (`InitialModule`, `ShapeModule`, `EmissionModule`, …) with curves as serialized (`m_Curve` keys, pre / post
wrap modes).

## Shaders

The player runs the game's own compiled shaders. Each shader directory (`livescene/shaders/`, `livenotes/shaders/`)
holds an index, one parsed shader description per shader, and the GLSL programs.

`shaders.json` is an array of records:

```json
{ "name": "UI/Default", "parsed": "UI_Default.json",
  "variants": [ { "file": "UI_Default/gles3/s0p0_vertex_0.glsl", "subShader": 0, "pass": 0, "keywords": [] } ] }
```

- `name` is the Unity shader name; `parsed` and each variant's `file` are paths relative to the shader directory.
- For a draw, the player picks the variant of the requested subshader and pass whose keyword set equals the enabled
  keywords that the pass declares (keywords no variant of the pass uses are ignored). The index only needs the
  variants a chart uses, and each listed file must be present.

The parsed shader (`<parsed>`) is Unity's serialized shader description; the player reads:

- `properties`: `[{ m_Name, m_Type, "m_DefValue[0]"…"m_DefValue[3]", m_DefTexture: { m_DefaultName } }]`, the
  defaults of unset material properties (`m_Type`: 0 Color, 1 Vector, 2 Float, 3 Range, 4 Texture, 5 Int).
- `subShaders[].tags.tags`: `[[name, value], ...]`.
- `subShaders[].passes[].state`: the pass render state (blend, blend op, colour mask, culling, depth test and write,
  stencil, offset), each value as `{ val, name }`: `val` is the fixed value, and a non-empty `name` other than
  `<noninit>` names the material property that supplies it.

A program file (`.glsl`) is GLSL ES 3.00 as Unity's shader compiler emits it for OpenGL ES 3: one file holds both
stages, as top-level `#ifdef VERTEX … #endif` and `#ifdef FRAGMENT … #endif` blocks, each starting with
`#version 300 es`. The player compiles the two blocks as they are, except that it sets
`UNITY_SUPPORTS_UNIFORM_LOCATION` to 0 (WebGL2 has no explicit uniform locations). Uniform values come from Unity
property names; a matrix uniform `hlslcc_mtx4x4<name>[4]` is the property `<name>`.

## Textures

### Texture descriptors

JSON files refer to textures with a descriptor:

```json
{ "texture": "textures/lane_base-d14cea1c.png", "name": "lane_base", "width": 1024, "height": 822,
  "mipCount": 1, "settings": { "m_FilterMode": 1, "m_WrapU": 1, "m_WrapV": 1 } }
```

| Key | Meaning |
|---|---|
| `texture` | Path of the PNG, relative to the directory of the JSON file (`livescene/` or `livenotes/`). |
| `name` | Texture name (used in messages). |
| `width`, `height` | Size in pixels; the PNG must have this size. |
| `mipCount` | Must be 1 for every texture the player loads (mipmapped textures are not supported). |
| `settings` | Unity sampler settings: `m_FilterMode` (0 Point, 1 Bilinear, 2 Trilinear), `m_WrapU`, `m_WrapV` (0 Repeat, 1 Clamp, 2 Mirror). |

Descriptors may carry more keys (format, colour space, …). A descriptor can refer to a file the chart does not
include when the player never loads it (for example textures of background modes other than LightWeight).

A sprite descriptor wraps a texture descriptor with Unity's sprite data: `{ sprite, texture, rect: {x, y, width,
height}, pivot: {x, y}, border: {x, y, z, w}, pixelsToUnits, textureRect, … }`, with `rect` and `textureRect` in
texture pixels from the bottom left, `border` as (left, bottom, right, top).

### PNG files

- 8-bit RGBA PNG (the player decodes any PNG the browser decodes, but the data uses RGBA8 throughout).
- Straight (not premultiplied) alpha. Texel values are used exactly as stored: the project renders in Gamma colour
  space, and the player decodes without premultiplication or colour-space conversion. Colour-profile chunks are
  ignored.
- Row order: a PNG stores its top row first, Unity textures start at the bottom row (v = 0). The PNG holds the image
  upright, and the player flips it while decoding, so the PNG's last row is texture row 0.

## Conventions

- **Unity names.** Serialized fields keep their Unity names: engine fields with `m_` (`m_Enabled`, `m_Materials`),
  the game's script fields with `_` (`_laneWidth`), master data columns with `_` (`_quality`), and array elements in
  their serialized form (`m_DefValue[0]`). Enumerations are stored as their integer values.
- **Space.** Unity space: left-handed, Y up. Transforms are local position / rotation / scale; quaternions are
  `{x, y, z, w}`; colours are `{r, g, b, a}` floats as serialized.
- **float32.** The game computes in float32. Values from float32 fields are written either as the exact double of the
  float32 value (`0.01` appears as `0.009999999776482582`) or as a shorter decimal that rounds to the same float32;
  the player rounds with `Math.fround` where the game computes in float32, so both forms give the same result.
- **Infinity.** JSON has no literal for infinity. An infinite float is written as `1e999` (`-1e999` for negative
  infinity), which `JSON.parse` reads as `Infinity`. NaN does not occur. Tools that rewrite the files must keep these
  numbers: re-serializing with `JSON.stringify` would turn them into `null`.
- **Integers.** Ids fit in a double exactly (sound ids have 13 digits). Keys of id maps are decimal strings.
- **Encoding.** UTF-8 without BOM.

## Validation

```
node scripts/validate-data.mjs <site dir> [chart id ...]
```

Validates `charts.json` and every chart (or only the given ids) and prints the failures and a summary. Per chart:

- the manifest (schema, agreement with `charts.json`);
- every asset: present, byte size, SHA-256 equal to its name, extension matching the logical file; split JSON files
  rebuild to their `size`, and every JSON file parses;
- `live.json` and the score (schema, unique ids, line and pair references);
- `audio/live-audio.json` (schema, the sound ids above present in `sounds`, category volumes, loop points) and every
  waveform file (FLAC `STREAMINFO` sample rate, channels and length equal to the layer's; `.m4a` is an MP4 file);
- `livescene/scene.json` and `livenotes/notes.json`: the keys the player reads, node order, animation clip and
  controller references, a quality row for the manifest's `quality`;
- both shader directories: index, parsed shader files, and the `#ifdef VERTEX` / `#ifdef FRAGMENT` blocks of every
  program with `#version 300 es`;
- textures: the lane skin, background, jacket and film grain PNGs are present, and every PNG a descriptor refers to
  has the described size and `mipCount` 1.

It needs Node.js 20 or later and no dependencies. The opt-in data tests (`OURNOTES_DATA=<site dir> npm run test:data`)
go further and run charts through the player in Node (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
