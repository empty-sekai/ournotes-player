# Data format

The player does not ship any game data. It plays a live from the **products** of a product layout (a live and the
products it plays with, as the [nnnotes](https://github.com/MetaSekaiLab/nnnotes) toolkit makes them from game files
the user supplies) or from a chart of a **chart site** (the site layout of chart manifests), and shows Live2D models
from model products. The embedding page supplies the data, usually as static files served over HTTP. This document
describes that data as far as the player reads it: product manifests, their files and the objects of their object
tables, the documents of a live, Live2D models, and the chart site layout.

Machine-readable schemas are in [`schema/`](../schema), and `node scripts/validate-data.mjs <site dir> [id ...]` checks
a whole directory of products and chart sites (see [Validation](#validation)).

Keys that are not described here are ignored by the player; producers may add their own. Where a structure comes
from the game's Unity data (scene hierarchy, prefabs, materials, animation clips, particle systems), this document
describes its shape and the conventions it follows rather than every serialized field.

Contents:
[Products](#products) ·
[Lives](#lives) ·
[live.json](#livejson) ·
[Score](#score) ·
[Sounds](#sounds-soundsjson-musicjson) ·
[Live scene](#live-scene-scenejson) ·
[Note highway](#note-highway-notesjson-noteskinjson-noteeffectjson) ·
[Bindings and shaders](#bindings-and-shaders) ·
[Objects of a live](#objects-of-a-live) ·
[Shader objects](#shader-objects) ·
[Textures](#textures) ·
[Live2D models](#live2d-models) ·
[Chart sites](#chart-sites) ·
[Conventions](#conventions) ·
[Validation](#validation)

## Products

A product is one result of nnnotes' product layout: a live, a part a live plays with, or a Live2D model. Each has a
product manifest ([schema](../schema/product.schema.json)) at `<directory>/<name>.json`, and its files are stored
content-addressed under `assets/`:

```
<root>/
  lives/<musicId>_<difficulty>.json   a live (live)
  scenes/default.json                 the live scene (live.scene)
  notes/default.json                  the note highway (live.notes)
  noteskins/<skin>.json               a note skin (live.noteskin)
  noteeffects/<set>.json              a note effect set (live.noteeffect)
  sounds/<sets>.json                  the note and live sounds (live.sounds)
  music/<musicId>.json                the music of a live (live.music)
  models/<id>.json                    a Live2D model (live2d.model)
  assets/<sha256>.<ext>               file contents, content-addressed
  assets/<sha256>.<ext>.gz            the same, stored gzip-encoded (or .br: brotli-encoded)
```

- `<sha256>` is the lowercase hex SHA-256 of the file's bytes (the decoded bytes of an encoded asset), `<ext>` the
  extension of the file it holds (`json`, `glsl`, `png`, `flac`, `m4a`, …). Identical contents are stored once and
  shared between products, so assets can be served with long-lived, immutable caching.
- An asset may be stored encoded: gzip (`.gz`) or brotli (`.br`) after its extension, where that makes it smaller.
  Only these kinds of file are encoded: `json` (split parts included), `glsl`, `moc3`, `atlas`, `skel`, `bin`, `wav`,
  `glb`; PNG and audio files are stored as they are. The file entry gives both byte counts
  ([File entries](#file-entries)); the player decodes an encoded asset itself unless the server already did (see
  [docs/embedding.md](embedding.md#hosting-the-data)).
- Asset and manifest paths are relative to the root. When a page loads a manifest by URL, the player resolves them
  against the directory above the manifest's directory unless it is given another base (see [docs/api.md](api.md)).
- Any static file server works. The page that embeds the player must be allowed to fetch the files (same origin, or
  CORS headers).

```json
{ "schema": "nnnotes.product/1", "product": "live.noteskin", "subject": "skin001",
  "files": { "noteskin.json": { "asset": "assets/<sha256>.json", "size": 1024 } },
  "objects": {
    "CAB-…:7903…": { "class": "MonoBehaviour", "name": "skin001",
                     "files": { "json": { "asset": "assets/<sha256>.json", "size": 4096 } } },
    "…": "…" } }
```

| Key | Meaning |
|---|---|
| `schema` | `"nnnotes.product/1"`. |
| `product` | The product: `live`, `live.scene`, `live.notes`, `live.noteskin`, `live.noteeffect`, `live.sounds`, `live.music`, `live2d.model`. |
| `subject` | What the product is of: a chart (`100001/expert`), a skin or effect set name, a sound option set, a music id, `default` for a product shared by every live, a model's key. |
| `files` | The product's own files: logical path → [file entry](#file-entries). |
| `objects` | The object table: the [objects](#objects) the product uses, object id → its `class`, `name` and `files` by role, each a file entry. |

### File entries

A file entry has one of these forms:

- **Whole file**: `{ "asset": "assets/<sha256>.<ext>", "size": <bytes> }`.
- **Whole file, encoded**: `{ "asset": "assets/<sha256>.<ext>.gz", "size": <bytes>, "stored": <stored bytes> }` (or
  `.br`). `size` is the byte count of the file, `stored` that of the asset as stored (the encoded bytes). An asset is
  encoded only when that makes it smaller, so `stored` is less than `size`; `stored` is present exactly when the
  asset name ends in `.gz` or `.br`.
- **Split JSON object** (logical files and object JSON roles): `{ "parts": [[key, asset, size], ...], "size": <bytes> }`; a
  part whose asset is encoded is `[key, asset, size, stored]`. A large JSON file whose top level is an object is
  stored per top-level key: each part's asset holds the raw JSON text of that key's value. The file's text is rebuilt
  as

  ```
  "{" + join(parts.map(([key, asset]) => JSON.stringify(key) + ":" + text(asset)), ",") + "}"
  ```

  and its UTF-8 length must equal `size`. The parts are concatenated as text, never re-serialized, so every number
  stays exactly as written (see [Conventions](#conventions)).

Encoded assets are gzip streams (RFC 1952) or brotli streams (RFC 7932) of the file's bytes; `<sha256>` is the
SHA-256 of the decoded bytes, so an asset name is the same whatever the encoding.

Rules:

- Logical paths are relative, use `/`, and are unique. Paths ending in `.json` or `.glsl` are UTF-8 text; every other
  file is binary.
- The player checks every asset while loading: an encoded asset whose fetched length is its `stored` count is decoded
  (gzip with the browser's `DecompressionStream`, brotli where the browser can construct
  `DecompressionStream("brotli")`); one whose fetched length is already `size` (the server sent it with
  `Content-Encoding`, and the browser decoded it) is used as it is; any other length fails the load. The file's byte
  length must then equal its `size`.
- The player fetches every listed file before a live or a model starts (several requests at a time), so a manifest
  should list only what is needed: files the player does not read are fetched but unused.

### Objects

Prefab object documents have a [JSON Schema](../schema/prefab.schema.json) for hierarchy nodes, transforms,
components and RectTransform fields. Data validation also checks that parents precede their children.

Several products may retain different file roles of the same object. Loading their manifests combines these
roles; overlapping roles and object metadata must agree. Product paths may include region directories, and are
relative to the layout root.

### Immutable product manifests

A site can store a product manifest at `products/<sha256>.json`, with the SHA-256 of the manifest bytes as its
name. Its parent product's `parts` fields name that exact path, so each public entry point selects a coherent
set of dependencies. Public aliases may remain at `lives/<id>.json`, `models/<id>.json` or `stories/<id>.json`.
An alias in a region directory sets `root: "../../"`; a two-level path uses `"../"`. The live and story loaders
honor that root, and a supplied `base` overrides it.

The data validator checks immutable manifest contents against their names, then applies the product, subject,
object and file checks. Ordinary product-layout manifest names continue to identify their subjects.

An object is one Unity object, converted. Its id is `<serialized file>:<path id>` (the path id as decimal digits,
possibly negative), the same in every product that uses it. An object's JSON names another object by a reference
`{ "$ref": { "file": "<serialized file>", "pathId": "<path id>" } }`, the object `<file>:<pathId>`; `null` names none.
A byte array field is `{ "$hex": "<hex digits>" }`. The roles of an object's files:

| Role | File |
|---|---|
| `json` | The object as JSON: every object has it ([Objects of a live](#objects-of-a-live), [Live2D models](#model-manifest)). |
| `image` | A Texture2D's level 0 as a PNG ([Textures](#textures)). |
| `arrays` | A Mesh's vertex channels, submeshes and skin as JSON. |
| `index` | A Shader's variant index ([Shader objects](#shader-objects)). |
| `program:<platform>/<name>` | A Shader's program of the variant whose `role` it is: GLSL ES 3.00 for `gles3`. |
| `blob:<field>` | The bytes of a byte-array field: `blob:_bytes` of a CubismMoc is the moc3. |

## Lives

A live is the product `live` of one chart and the products it plays with, its parts. Its `live.json` names the
manifest of each part:

| Part | Product | Manifest | Document |
|---|---|---|---|
| — | `live` | `lives/<musicId>_<difficulty>.json` | [`live.json`](#livejson), the [score](#score) files |
| `scene` | `live.scene` | `scenes/default.json` | [`scene.json`](#live-scene-scenejson) |
| `notes` | `live.notes` | `notes/default.json` | [`notes.json`](#note-highway-notesjson-noteskinjson-noteeffectjson) |
| `noteskin` | `live.noteskin` | `noteskins/<skin>.json` | `noteskin.json` |
| `noteeffect` | `live.noteeffect` | `noteeffects/<set>.json` | `noteeffect.json` |
| `sounds` | `live.sounds` | `sounds/<sets>.json` | [`sounds.json`](#sounds-soundsjson-musicjson) |
| `music` | `live.music` | `music/<musicId>.json` | `music.json` |

A manifest's name is its subject with `/` as `_` (`lives/100001_expert.json` is the live of subject `100001/expert`).
The scene, the note highway, the skins, the effect sets and the sounds are shared by every live that plays them; the
music by the charts of one music.

The player loads the live manifest, the manifests its `live.json` `parts` names (the defaults) and the manifests a page
gives as variants (the other note skins, note effect sets and note sound sets it offers), puts each product's files
under its manifest path without `.json` (`lives/100001_expert/live.json`, `sounds/default/audio/LiveSe/<file>.flac`)
and merges their object tables into one (an object in several manifests must be the same in each).

A chart manifest of a [chart site](#chart-sites) is read as a live as well.

## live.json

([schema](../schema/live.schema.json)) The document of the live: format 1.

```json
{ "format": 1, "musicId": 100001, "difficulty": "expert", "band": { "band": 1 }, "jacket": "CAB-…:-1723…",
  "notes": "notes.json", "notesMirror": "notes.mirror.json",
  "parts": { "scene": "scenes/default.json", "notes": "notes/default.json", "noteskin": "noteskins/skin001.json",
             "noteeffect": "noteeffects/effect001.json", "sounds": "sounds/default.json", "music": "music/100001.json" } }
```

| Key | Meaning |
|---|---|
| `format` | `1`; the player refuses other values. |
| `musicId`, `difficulty` | The chart. |
| `band` | `{ band }`: the band whose start timeline and LightWeight background the live plays, a key of `scene.json` `bands`. |
| `jacket` | The jacket Sprite. |
| `notes` | The score, a file of the live ([Score](#score)). |
| `notesMirror` | Optional. The score converted mirrored (the game's `MirrorChart` option: lanes and flick directions mirrored while the score is converted), same format as `notes`. Without it the `MirrorChart` option is not offered. |
| `parts` | Part → the manifest path of the product, relative to the root ([Lives](#lives)). |

The optional `live.json` field `parts.ui` maps language codes to UI product manifests. These entries are
language-specific resources; the shared scene, score and audio parts remain ordinary manifest paths.

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

With `MeasureLineDisplay` on, the player also reads `barLineTimeMs` (the chart time of each bar line, in bar order),
`bpmChanges` (`{ bpm, bar, barProgress, timeMs }`) and `barChanges` (`{ beatsPerBar, bar, barProgress, timeMs }`),
from which it finds the bar of each frame as the game does. Other keys of the score (fever and skill ranges, …) are
not read.

## Sounds (`sounds.json`, `music.json`)

([sounds.json](../schema/live-sounds.schema.json), [music.json](../schema/live-music.schema.json)) The sounds of a
live, after the game's CRI ADX2 cue data: each sound id names a cue made of one or more waveform layers, routed
through CRI categories. `sounds.json` of `live.sounds` (format 1) holds the note and live sounds of an option set,
`music.json` of `live.music` (format 1) the music. The player uses the `live.sounds` product that offers the most note
sound sets (one of subject `NoteSePatternId=<ids>` holds the default set and the others) with the music; a sound id is
in one of the two only.

`sounds.json`:

| Key | Meaning |
|---|---|
| `format` | `1`. |
| `sounds` | Sound id (decimal string) → cue (below). |
| `categories` | CRI category name → volume. A cue plays at the product of the volumes of its categories. `LiveBgmConfig`, `LiveSeConfig`, `LiveVoiceConfig` and `LiveNotesSeConfig` are the live volumes of a fresh profile (the game's local sound config after a fresh install, not the volume options' defaults); the volume options replace them once one of them is changed (a volume option whose category is absent is not offered). |
| `react` | Ducking rules (REACT): `[{src, dest, level, decrementMs, incrementMs, holdMs}]`. While a cue of category `src` plays, category `dest` goes to `level` over `decrementMs`; after the last one ends it holds for `holdMs`, then returns to 1 over `incrementMs`. |
| `noteSe` | `{ types, volumes, mutes }`: `LiveNoteSeType` → sound id / volume / muted, for the default options. Optional: `patternId` (the note sound set of `types`, default 1) and `groups` (note sound set id → `{ LiveNoteSeType: sound id }`, every set the page may choose; their sounds must be in `sounds`), which offer the note sound options (`NoteSePatternId`, `UseIndividualNoteSe` and the per-type sounds). |
| `liveSe` | `LiveSeType` → sound id. |
| `voice` | Optional: `startVoiceSoundId`, `clearVoiceSoundId`, `fullComboVoiceSoundId`, `allPerfectVoiceSoundId` (absent or -1: none). |
| `timeline` | `startCheerDelaySec`: the delay of the start cheers after the start timeline begins. |

`music.json`:

| Key | Meaning |
|---|---|
| `format` | `1`. |
| `musicId` | The music. |
| `music` | `{ soundId }`: the music (BGM). |
| `sounds` | The music's cue by its sound id. |

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
| `file` | Path of the waveform, relative to its product's directory: FLAC, or AAC in MP4 (`.m4a`). |
| `sampleRate` | 48000, the rate of the waveform file. `samples`, the loop points and `encoderDelay` count frames at this rate. Browsers decode into the rate of the `AudioContext` (the player's own runs at 48 kHz; a page may give one at another rate), and the player scales these counts to it. |
| `channels` | Channel count. |
| `samples` | Length of the waveform in sample frames, without encoder padding. The music's first layer defines the chart's length: `floor(samples × 1000 / sampleRate)` ms. |
| `loopFlag`, `loopStart`, `loopEnd` | `loopFlag` 2 with loop points (sample frames): the waveform loops by itself. When the player loops a cue (the hold sound effect) a layer loops at its loop points, else as a whole. `loopStart` and `loopEnd` are both `null` when there are none. |
| `volume` | Layer volume (multiplied with the cue volume). |
| `encoderDelay` | Optional, AAC only: the encoder's priming samples at the start of the stream. A browser decoder that ignores the MP4 edit list returns them first; when the decoded buffer holds at least `samples + encoderDelay` frames, the player drops the first `encoderDelay` frames and keeps `samples` (both scaled to the context's rate, see `sampleRate`). |

Types and sounds the player uses:

- `noteSe` types 1–14: 1 InVain, 2 Good, 3 Great, 4 Perfect, 5 Flick, 6 FlickDirection, 7 Slide (the hold loop),
  8 Just, 9 Trace, 10 SlideConnect, 11–14 the Gekisou variants. Every type listed in `types` must have its sound in
  `sounds`.
- `liveSe`: a chart ends with FinishCheers (10) and the finish direction of its result: AllPerfectDirection (16) after
  an all perfect, else FullComboDirection (14) after a full combo, else AssistFullComboDirection (15) after an assist
  full combo, else LiveClearDirection (13); none when the life is below 1. At the default settings the player's auto
  play ends every chart with an all perfect; a late `NoteTiming` can end it otherwise (a slide shorter than the offset
  ends before its start note is judged, and the game then judges that note a Miss; the chart ends with
  LiveClearDirection). nnnotes writes the sounds of StartCheers (9), FinishCheers (10) and every finish direction
  (13–16) into `sounds`. The sounds of 10 and 16 must be in `sounds`; sounds of other types may be omitted, and the
  player then plays nothing for them.
- Every sound of the two documents is decoded before the chart starts.

Other keys (cue sheet details, bus sends, the ACF, the names of the types, …) are not read.

## Live scene (`scene.json`)

([schema](../schema/live-scene.schema.json)) The document of `live.scene` (format 1): what exists on the live screen
before the first note, and the start timeline of each band. It names objects of the product's object table:

| Key | Content |
|---|---|
| `scene` | The root GameObjects of the live scene; their prefabs are the scene's hierarchy (cameras, lane, stage, background, render canvas, live UI). A root references a component of another root with a `$ref`, which names the component inside that root's prefab. |
| `graphics.graphics` | The GraphicsSettings: its render pipeline asset, the asset's renderer data and their post-processing data (the film grain textures of the effect camera's renderer). `graphics.quality` and `graphics.player` (QualitySettings, PlayerSettings) are not read. |
| `laneSkins` | Lane skin name → `{ lane_base, lane_tap_area, out_side_line }`: Sprites. |
| `prefabs` | `laneLine` (the inner lane lines) and `judgeEffectView`: GameObjects. `barLineView`: the bar line view the scene's bar line container instantiates, a GameObject, or `null` (no `MeasureLineDisplay`). |
| `spriteAssets` | `combo` (LiveComboSpriteAsset) and `judgement` (LiveJudgementSpriteAsset): MonoBehaviours whose fields reference the digit and judgement Sprites. |
| `bands` | Band id → `{ timeline, background, tracks }`: the GameObject of the band's start timeline (its PlayableDirector), the LightWeight background Sprite, and per AnimationTrack (a MonoBehaviour id) `{ name, prefab, animator }`, the GameObject and the node path of the Animator the track plays on. The direct start runs the timeline to its end without drawing, so stage, lane and tap area start as the game leaves them when the music starts. |
| `settings` | `optionDefaults`: option name → default value as a string (option preset 1, as in the master data; `JudgePositionDisplay` and `NoteStartPosition` are required). `optionRanges`: option name → `[min, max]`. `qualitySettings`: the rows of the game's live quality master data (`_quality`, `_effectRenderingScale`, …), a row for each `LiveQuality` the live offers. `laneSkin`: the lane skin of the default options, a key of `laneSkins`. |
| `bindings`, `shaders` | [Bindings and shaders](#bindings-and-shaders). |

Other keys (`renderSettings`, the lane skins by option value, the judgement sprite names, …) are not read.

## Note highway (`notes.json`, `noteskin.json`, `noteeffect.json`)

([notes.json](../schema/live-notes.schema.json), [noteskin.json](../schema/live-noteskin.schema.json),
[noteeffect.json](../schema/live-noteeffect.schema.json)) What a live spawns and animates per note: the note views of
`live.notes`, the note skin of `live.noteskin`, the hit effects of `live.noteeffect`. Each document has format 1.

`notes.json`:

| Key | Content |
|---|---|
| `prefabs` | View name → GameObject: the note views `tap_note_view`, `flick_note_view`, `flick_left_note_view`, `flick_right_note_view`, `slide_note_view`, `slide_end_note_view`, `connection_note_view`, `none_note_view` (and `trace_note_view`, `guide_note_view`, `slide_combo_note_view`, `slide_combo_skip_note_view` where the score uses them), the line views `slide_line_view` and `guide_line_view`, and `pair_note_line`. |
| `laneEffect` | The lane effect settings (LiveLaneEffectAssetSettings), a MonoBehaviour whose fields reference the lane effect prefabs. |
| `settings` | Lane and option settings (below). |
| `bindings`, `shaders` | [Bindings and shaders](#bindings-and-shaders). |

`settings`:

| Key | Meaning |
|---|---|
| `laneCount`, `laneSize` | Lane count (equal to the score's) and the lane's reference size `[width, height]`. |
| `laneTopRange`, `laneBottomRange`, `laneTopPosition`, `judgementScreenBottomPosition`, `tiltCenterLane` | Lane geometry of the game's lane settings (`tiltCenterLane` optional, default 11.5). |
| `optionDefaults` | Option name → default value as a string (`NoteSpeed`, `SlideOpacity`, `GuideOpacity`, …); options it lacks take the default of `scene.json`. |
| `optionRanges` | Option name → `[min, max]` (`SlideOpacity` and `GuideOpacity` required); they override those of `scene.json`. |
| `liveSettings` | Live master settings: `note_speed_min`, `note_speed_max`, `note_speed_view_min`, `note_speed_view_max` (strings). |
| `noteDisplayTimeMs` | Optional: the note display time for the default note speed. When present, the player checks that its own value equals it. |
| `skins` | Optional. `NoteDesignId` → note skin name; a design is offered when a `live.noteskin` product of that name is loaded (the live's part is the default). |
| `effects`, `effect` | Optional. `NoteEffectId` → note effect set name, and the set of the default `NoteEffectId`. At `LiveQuality` 2 the player uses the set's Light variant (`<name>Light`) when that `live.noteeffect` is loaded, else the set itself, as the game does. |

`noteskin.json`: `name`, the skin's name; `skin`, its LiveNoteSkinAsset (a MonoBehaviour: the units `TapNoteAsset`,
`FlickNoteAsset`, … with their sprites and the flick arrow loops, the slide line gradients and material); `bindings`
and `shaders`.

`noteeffect.json`: `name`, the set's name; `settings`, its LiveNoteEffectAssetSettings (a MonoBehaviour whose fields
reference the root components of the effect prefabs); `bindings` and `shaders`.

## Bindings and shaders

Every document of `live.scene`, `live.notes`, `live.noteskin` and `live.noteeffect` has

- `bindings`: `{ <prefab GameObject>: { <Animator node path>: { <AnimationClip>: [{ path, attribute }, ...] } } }`,
  the clips each Animator of the product's prefabs plays (its controller's clips, the `_loopAnim` of a
  LoopAnimationTimeSync on its `_animator`, a skin's flick arrow loops on the flick views, a timeline track's clips on
  its Animator) and, per binding of a clip in the clip's order, the node path below the Animator's node (`""` for that
  node) and the attribute it animates there; `path` null where the hierarchy has no single node of the binding's path
  (it animates nothing).
- `shaders`: Unity shader name → the Shader object a lookup by name finds. Materials name their shader by reference;
  the player looks shaders up by name for the materials it makes itself (the render canvas, the background blur, the
  post-processing passes).

## Objects of a live

The objects of a live's products, by class, as the player reads them:

| Class | `json` | Other files |
|---|---|---|
| GameObject (the root of a prefab) | the prefab: its hierarchy as a node list (below) | |
| Material | `{ material, shader (a reference), keywords, renderQueue, floats, ints, colors, textures: { <property>: { texture (a reference or null), scale, offset } } }` | |
| Texture2D | Unity's fields without the pixels: `m_Width`, `m_Height`, `m_MipCount`, `m_ColorSpace`, `m_TextureSettings` (filter and wrap modes) | `image` |
| Sprite | `sprite` (Unity's fields: `m_Name`, `m_Rect`, `m_Pivot`, `m_Border`, `m_PixelsToUnits`, `m_Offset`, `m_SpriteAtlas`, `m_RenderDataKey`), `renderData` (`texture`, a reference, `textureRect`, `textureRectOffset`, `atlasRectOffset`, `downscaleMultiplier`, `settingsRaw`, `uvTransform`) and `mesh` (`{ positions, submeshes }`, or null) | |
| SpriteAtlas | Unity's fields: `m_RenderDataMap` | |
| Mesh | Unity's fields without the vertex and index data (`m_BindPose`, …) | `arrays` |
| AnimationClip | the clip: `name`, `stopTime`, `loopTime`, `startTime`, `cycleOffset`, `events`, `bindings` (one per curve, as stored: `pathCrc`, `attributeCrc`, `typeID`, `class`, `customType`, `pptr`, …), `streamed`, `dense`, `constant` | |
| AnimatorController | `{ name, clips (references), layers, stateMachines, parameters, defaultValues }` | |
| MonoBehaviour | its fields and `$script` (the script class, `"<assembly>\|<namespace>\|<class>"`) | |
| Shader | the parsed shader ([Shader objects](#shader-objects)) | `index`, `program:` files |

- A Sprite packed by a SpriteAtlas of another file has no `renderData`: its render data is the atlas's
  `m_RenderDataMap` entry whose key equals the sprite's `m_RenderDataKey`, as the engine reads it at run time. The
  texture coordinates of a mesh vertex `p` are `((p.x × uvTransform.x + uvTransform.y) / width, (p.y × uvTransform.z +
  uvTransform.w) / height)` of the texture, in float32.
- A Mesh's `arrays` is `{ positions, normals, tangents, colors, uv0, …, uv7, submeshes, joints, weights }`: per vertex
  `[x, y, z]` positions and the other channels (`null` when the mesh has none), `submeshes` as
  `[{ topology, indices }]` (the player draws `triangles` submeshes, whose `indices` are triangles `[a, b, c]`), and the
  skin's four joints and weights per vertex (`null` without a skin).

### Prefabs

A prefab's `json` is `{ name, nodes }`: its GameObject hierarchy, nodes in hierarchy order (every parent before its
children).

```json
{ "path": "Live/LiveGameView/Lane", "name": "Lane", "pathId": "-4153…", "active": true, "layer": 0,
  "localPosition": {"x": 0, "y": 0, "z": 0}, "localRotation": {"x": 0, "y": 0, "z": 0, "w": 1},
  "localScale": {"x": 1, "y": 1, "z": 1},
  "components": [ { "type": "MonoBehaviour", "pathId": "2207…", "script": "Assembly-CSharp|Live|LiveLaneView",
                    "fields": { … } }, … ] }
```

- `path` is the `/`-joined chain of GameObject names from the root; it identifies the node and gives its parent.
  `pathId` is the GameObject's path id in its serialized file, and a component's `pathId` its own.
- `components` are in GameObject order. Each has `type` (the Unity class: `Camera`, `MeshRenderer`, `Animator`,
  `ParticleSystem`, `MonoBehaviour`, …), for a MonoBehaviour `script` (its script class), and `fields`: the
  component's serialized fields under their Unity names.
- A reference to a node or component of the same prefab is `{ "gameObject": <node path>, "component"?: <type> }`;
  references to other objects are `$ref`s. A `$ref` to a GameObject or component that is not an object of the table
  names a node or component of another root GameObject of the same serialized file (a scene's roots reference each
  other so): the player finds it by its `pathId` among those prefabs' nodes.
- Particle systems keep Unity's module structure (`InitialModule`, `ShapeModule`, `EmissionModule`, …) with curves as
  serialized (`m_Curve` keys, pre / post wrap modes); vertex streams are byte arrays (`$hex`).

## Shader objects

The player runs the game's own compiled shaders. A Shader object's files:

- `json`: Unity's serialized shader description; the player reads `properties`
  (`[{ m_Name, m_Type, "m_DefValue[0]"…"m_DefValue[3]", m_DefTexture: { m_DefaultName } }]`, the defaults of unset
  material properties; `m_Type`: 0 Color, 1 Vector, 2 Float, 3 Range, 4 Texture, 5 Int), `subShaders[].tags.tags`
  (`[[name, value], ...]`) and `subShaders[].passes[].state`, the pass render state (blend, blend op, colour mask,
  culling, depth test and write, stencil, offset), each value as `{ val, name }`: `val` is the fixed value, and a
  non-empty `name` other than `<noninit>` names the material property that supplies it.
- `index`: `{ name, variants: [{ platform, type, subShader, pass, keywords, role, … }] }`, the shader's variants.
- `program:<platform>/<name>`: the program of the variant whose `role` it is. The player draws with the `gles3`
  programs of type `GLES3`: GLSL ES 3.00 as Unity's shader compiler emits it for OpenGL ES 3, one file holding both
  stages as top-level `#ifdef VERTEX … #endif` and `#ifdef FRAGMENT … #endif` blocks, each starting with
  `#version 300 es`. The player compiles the two blocks as they are, except that it sets
  `UNITY_SUPPORTS_UNIFORM_LOCATION` to 0 (WebGL2 has no explicit uniform locations). Uniform values come from Unity
  property names; a matrix uniform `hlslcc_mtx4x4<name>[4]` is the property `<name>`.

For a draw, the player picks the variant of the requested subshader and pass whose keyword set equals the enabled
keywords that the pass declares (keywords no variant of the pass uses are ignored), and compiles its program at its
first draw.

## Textures

A texture's image is a PNG file:

- 8-bit RGBA PNG (the player decodes any PNG the browser decodes, but the data uses RGBA8 throughout).
- Straight (not premultiplied) alpha. Texel values are used exactly as stored: the project renders in Gamma colour
  space, and the player decodes without premultiplication or colour-space conversion. Colour-profile chunks are
  ignored.
- Row order: a PNG stores its top row first, Unity textures start at the bottom row (v = 0). The PNG holds the image
  upright, and the player flips it while decoding, so the PNG's last row is texture row 0.
- A Texture2D's image is its level 0, of the size of `m_Width` and `m_Height`; for `m_MipCount` above 1 the player
  generates the other levels.

## Live2D models

The model viewer ([live2d.md](live2d.md)) reads one Live2D model at a time: one manifest per model next to the other
products and chart manifests, sharing `assets/`. The story player reads the same model manifests for the
characters of a story ([story-data-format.md](story-data-format.md#live2d-models)).

```
<site>/
  models.json              model index (for listings; the viewer does not read it)
  models/<id>.json         model manifest, one per model: a product manifest of live2d.model
  assets/<sha256>.<ext>    file contents (or .gz / .br encoded), shared with the charts, stories and other models
```

`<id>` is the model's name, `[a-z0-9_]+` (e.g. `adv_live2d_rana_003_casual_spring_01`). The viewer resolves the asset
paths of a manifest against `models/..`, the root, as for the other products.

### models.json

([schema](../schema/models.schema.json))

```json
{ "format": 2, "models": [ { "id": "adv_live2d_rana_003_casual_spring_01",
                             "manifest": "models/adv_live2d_rana_003_casual_spring_01.json",
                             "key": "Character/Live2D/003_adv/…", "group": "003_adv", "bytes": 10655335,
                             "files": 210, "textures": 2, "canvas": { "pixelsPerUnit": 6000, "…": "…" } } ] }
```

| Key | Meaning |
|---|---|
| `format` | `2`, the version of this layout. |
| `models[].id`, `manifest` | The model and the path of its manifest, relative to the site root. |
| `models[].key` | The model's key (the manifest's `subject`). |
| `models[].group`, `label` | Optional: a group for listings (the `<group>` of the key) and a display text (the character's name in the site's language, when the producer knows it). |
| `models[].character`, `names` | Optional: the character's id in the game's master data, and its name per language (`{ "<language>": "…" }`, only languages with a name). |
| `models[].bytes`, `files` | Optional: the sum of `size` over the files of the manifest and of its objects, and their count. |
| `models[].textures`, `canvas` | Optional: the atlas page count and the moc3 canvas (as `model.json` has them). |

When regions provide different listing metadata for the same model content, an id can appear once per region.
Each entry names its `regions` and may use `models/<region>/<id>.json`; entries sharing an id have disjoint region
sets. The model picker selects entries by manifest path, and a `region` query parameter selects a regional alias.

### Model manifest

`models/<id>.json` is a product manifest ([schema](../schema/product.schema.json)) of the product `live2d.model`:

```json
{ "schema": "nnnotes.product/1", "product": "live2d.model",
  "subject": "Character/Live2D/003_adv/adv_live2d_rana_003_casual_spring_01/model/adv_live2d_rana_003_casual_spring_01",
  "files": { "model.json": { "asset": "assets/<sha256>.json", "size": 2048 } },
  "objects": {
    "CAB-…:-4153…": { "class": "Texture2D", "name": "texture_00",
                      "files": { "json": { "asset": "assets/<sha256>.json", "size": 512 },
                                 "image": { "asset": "assets/<sha256>.png", "size": 1048576 } } },
    "…": "…" } }
```

| Key | Meaning |
|---|---|
| `schema`, `product` | `"nnnotes.product/1"` and `"live2d.model"`; the story player refuses others, and the viewer reads others only as a [model manifest of format 2](#model-manifests-of-format-2). |
| `subject` | The model's key, `Character/Live2D/<group>/<name>/model/<name>`; `<name>` is the manifest's `<id>`. |
| `files` | The product's own files: `model.json` alone. A [file entry](#file-entries), whole or encoded. |
| `objects` | The objects the model uses: object id → its `class`, `name` and `files` by role, each a file entry, whole or encoded. |

Object ids, references and the roles of an object's files are those of every product ([Objects](#objects)).

The viewer fetches every file of the manifest and of its objects when the model loads. The objects of a model, by
class and by what reaches them:

| Object | `json` | Other files |
|---|---|---|
| The model's GameObject (`model.json` `prefab`) | the [model prefab](#the-model-prefab) | |
| The CubismMoc (`moc`), a MonoBehaviour | `{ "$script": "…\|CubismMoc", … }` | `blob:_bytes` |
| The atlas pages (`textures`), Texture2D | Unity's fields without the pixels: `m_Width`, `m_Height`, `m_MipCount`, `m_ColorSpace`, `m_TextureSettings` (filter and wrap modes) | `image` |
| The drawables' materials and the mask materials (`resources`), Material | `{ material, shader (a reference), keywords, floats, colors, … }` | |
| Their shaders (`shaders`), Shader | the parsed shader ([Shader objects](#shader-objects)) | `index`, the `program:` files below |
| The motions, AnimationClip | the clip: `name`, `stopTime`, `loopTime`, `startTime`, `cycleOffset`, `events`, `bindings` (one per curve, as stored: `typeID`, `class`, `scriptClass` for a MonoBehaviour, `pptr`, …), `streamed` (`curveCount`, `frames`), `dense`, `constant` | |
| The fade motion list, the fade motions, the expression list and the expressions, MonoBehaviour | their fields and `$script` (the script class, `"<assembly>\|<namespace>\|<class>"`) | |

A manifest lists exactly these objects and files: every texture a drawable uses, and of a shader only the programs
below (those the viewer draws with and those the story renderer draws with).

### model.json

([schema](../schema/model-json.schema.json))

```json
{ "format": 3, "name": "adv_live2d_rana_003_casual_spring_01", "key": "Character/Live2D/003_adv/…",
  "prefab": "CAB-…:-4153…", "moc": "CAB-…:2207…",
  "canvas": { "pixelsPerUnit": 6000, "originX": 3000, "originY": 4500, "width": 6000, "height": 9000, "mocVersion": 5 },
  "textures": ["CAB-…:-7312…", "CAB-…:5521…"],
  "shaders": { "Live2D Cubism/Lit-URP-ADV-optimize": "CAB-…:…", "Live2D Cubism/Mask": "unity_builtin_extra:…" },
  "resources": { "cubismMask": "resources.assets:…", "cubismMaskCulling": "resources.assets:…" },
  "motionSync": true,
  "bindings": { "CAB-…:-118…": [ { "path": "Parameters/ParamAngleX", "attribute": "Value" }, "…" ] } }
```

| Key | Read | Meaning |
|---|---|---|
| `format` | yes | `3`, the version of this file; the viewer and the story player refuse other values. |
| `prefab` | yes | The model's GameObject; its `json` is the model prefab. |
| `moc` | yes | The CubismMoc (the root's `CubismModel._moc`); the moc3 is its file `blob:_bytes`. |
| `shaders` | yes | Unity shader name → Shader object: "Live2D Cubism/Lit-URP-ADV-optimize" (the drawables' materials) and "Live2D Cubism/Mask" (the mask materials). |
| `resources.cubismMask`, `resources.cubismMaskCulling` | yes | The Cubism mask Materials (`Live2D/Cubism/Materials/Mask` and `MaskCulling` of the game's resources); their shader is "Live2D Cubism/Mask". The viewer and the story player read `shader`, `floats` and `colors`. |
| `bindings` | yes | AnimationClip object → per binding of the clip, `{path, attribute}`: the path below the model's root (`""` for the root) and the attribute it animates in the model's hierarchy; `path` null where the hierarchy has no single node of the binding's path (it animates nothing). Every clip of `_motionList` has its entry. |
| `motionSync` | no | `true` when the prefab's root has a `CubismMotionSyncController` with a `Live2DMotionSyncCriAudioInput` (a model whose mouth follows a voice through MotionSync). A fact for pages; the players take the controller from the prefab. |
| `name`, `key`, `canvas`, `textures` | no | The model's name and key, the moc3 canvas, the atlas pages. |

### The model prefab

The prefab's `json` is the hierarchy of the model as a [prefab](#prefabs) `{ name, nodes }`: the model root, its
`Parameters/<id>`, `Parts/<id>` and `Drawables/<id>` nodes and the rest of the hierarchy. A component is
`{ type, pathId, script?, fields }`: a MonoBehaviour's `script` is its script class (`"<assembly>|<namespace>|<class>"`;
the class names the component below), `fields` its serialized fields, with references to other objects as `$ref`. The
viewer reads:

| Where | Component | Fields |
|---|---|---|
| root | `Live2DCharacter` | `DefaultMotionName`, `DefaultExpressionName`, `BasePosition`, `BaseScale`, `_motionList` (references to the AnimationClips), `_expressionList` (expression names, in `ExpressionsList` order) |
| root | `CubismFadeController` | `CubismFadeMotionList`: the fade motion list (`MotionInstanceIds`, `CubismFadeMotionObjects`: references to the CubismFadeMotionData, whose fields are `MotionName`, `FadeInTime`, `FadeOutTime`, `MotionLength`, `ParameterIds`, `ParameterCurves[].m_Curve`, `ParameterFadeInTimes`, `ParameterFadeOutTimes`) |
| root | `CubismExpressionController` | `UseLegacyBlendCalculation` (must be 0), `CurrentExpressionIndex`, `CurrentFadeInTime`, `ExpressionsList`: the expression list (`CubismExpressionObjects`: references to the CubismExpressionData: `m_Name`, `FadeInTime`, `FadeOutTime`, `Parameters[]`: `Id`, `Value`, `Blend`), or null for a model without expressions |
| root | `CubismAutoEyeBlinkInput`, `CubismEyeBlinkController` | `Mean`, `MaximumDeviation`, `Timescale`; `BlendMode` (must be 2), `EyeOpening` |
| root | `CubismMouthController` | `BlendMode` (must be 0), `MouthOpening` |
| root | `CubismHarmonicMotionController` | `BlendMode` (must be 1), `ChannelTimescales` |
| root | `CubismPhysicsController` | Optional (a model without it has no physics). `_rig`: `Fps`, `Gravity`, `Wind`, `SubRigs[]` (`Input`, `Output`, `Particles`, `Normalization`) |
| root | `CubismRenderController` | `_sortingOrder`, `Opacity`, `_lastOpacity` |
| `Parameters/<id>` | `CubismEyeBlinkParameter`, `CubismHarmonicMotionParameter` | the parameters the eye blink and the breath drive (`Channel`, `Direction` (must be 2), `NormalizedOrigin`, `NormalizedRange`, `Duration`) |
| `Drawables/<id>` | `CubismDrawable` | `_unmanagedIndex`: the Core drawable index (the node's name is the Core drawable id) |
| `Drawables/<id>` | `CubismRenderer` | `_mainTexture` (the atlas page; unlike chart textures it may be mipmapped: the PNG is level 0 and the viewer generates the other `m_MipCount - 1` levels), `_color`, `_localSortingOrder` |
| `Drawables/<id>` | `MeshRenderer` | `m_Materials`: one Material of "Live2D Cubism/Lit-URP-ADV-optimize" (`keywords`, `floats`, `colors`) |

A clip of `_motionList` has streamed and constant curves only (no dense curves, `startTime` and `cycleOffset` 0), one
float curve per binding (the streamed curves, then the constant ones), and an `InstanceId` animation event whose
`intParameter` names its entry of the fade motion list. Through `model.json` `bindings`, each binding is a
`CubismParameter` `Value` at `Parameters/<id>`, a field of a root controller (path `""`:
`CubismEyeBlinkController.EyeOpening`, `CubismMouthController.MouthOpening`, `CubismRenderController.Opacity`), or
unresolved (`path` null). Expression parameters whose `Id` the moc3 lacks are skipped, as in the game. Models with
`CubismPosePart` components, other blend modes or more than 36 mask groups are not supported; loading them fails
with an error that names the feature.

### Model shaders

Of the shaders of `model.json` `shaders`, the manifest lists the parsed form (`json`), the variant index (`index`) and
only the GLES3 programs (platform `gles3`, type `GLES3`, subshader 0, pass 0) the players run:

- "Live2D Cubism/Lit-URP-ADV-optimize": for each distinct keyword set of the drawables' materials (restricted to the
  keywords its variants use), the program with exactly that set, and the program with that set plus
  `_ADDITIONAL_LIGHTS_VERTEX`. The viewer draws with the first; the story renderer adds `_ADDITIONAL_LIGHTS_VERTEX`
  at quality 4 (Best: per-vertex additional lights) and draws with the second there, with the first at the other
  qualities. No player enables `_ADDITIONAL_LIGHTS`, so the programs with it are not read.
- "Live2D Cubism/Mask": its program without keywords, when some drawable is masked (a material with `CUBISM_MASK_ON`).

### Model manifests of format 2

The model viewer also reads a model manifest of format 2, `{ "format": 2, "id": "…", "key": "…", "model": { … },
"files": { … } }` (no `schema`), whose `files` (file entries as in a [chart manifest](#file-entries)) hold one model
with its objects inline:

| Logical file | Content |
|---|---|
| `model.json` | `{ "format": 1, name, key, moc3, prefab, textures, canvas, shaders, resources }`: the paths of the moc3, the prefab and the shader index, and in `resources` the mask materials `cubismMask` and `cubismMaskCulling` inline (`{ material, shader: { shader: <shader name> }, keywords, floats, colors, … }`). |
| `<name>.moc3` | The moc3. |
| `<name>.prefab.json` | `{ key, nodes, canvas }`: the model's node list; a component is `{ type, class, …its fields }` (`class`: a MonoBehaviour's script class). Inline in it: the CubismMoc (`{ asset: "CubismMoc", name }`), the clips of `_motionList` (`{ clip: <name>, bindings: [{ path, typeID, class, attribute }], … }` and the clip's data as in an AnimationClip's `json`), the fade motion list, the expression list and their entries (`{ asset: <class>, name, …their fields }`), the drawables' materials and their main textures (a [texture descriptor](#texture-descriptors), its path relative to the prefab's directory). |
| `textures/…` | The atlas pages. |
| `shaders/shaders.json`, `shaders/…` | The shaders in the layout of a [shader directory](#shaders), the mask shader only when some drawable is masked. |

The viewer reads it as a model manifest of `live2d.model`: each inline object becomes an object `<name>:<n>` (`<name>`
the model's name) that the fields name by reference, equal materials one object, an atlas page a Texture2D whose
fields are the descriptor's (`m_Width`, `m_Height`, `m_MipCount`, `m_ColorSpace`, `m_TextureSettings`), a shader of the
directory a Shader whose programs are its variants' files, and a shader the directory lacks a Shader without programs.
The `model.json` of format 3 names them, with `bindings` from the clips' bindings and `motionSync` from the root's
components; `info` is `{ schema: "nnnotes.product/1", product: "live2d.model", subject: <key> }`. The story player
reads model manifests of `live2d.model` only.

## Chart sites

A chart site serves charts in the site layout: one chart manifest per chart, whose files are the chart's own copy of
its scene, note assets, sounds, shaders and textures with the objects inline. The player reads a chart manifest as a
live: its scene and note assets become the documents and object tables of `live.scene`, `live.notes`,
`live.noteskin` and `live.noteeffect` (each inline object an object of the table, equal objects one object, a texture
descriptor a Texture2D whose image is the PNG it names, a shader of a shader directory a Shader whose programs are its
variants' files), `audio/live-audio.json` becomes `sounds.json` and `music.json`, and `live.json` names the score.

### Site layout

```
<site>/
  charts.json                          chart index (for listings; the player does not need it)
  charts/<musicId>_<difficulty>.json   chart manifest, one per chart
  charts/<region>/<id>.json            a region's own manifest of a chart (a site of several regions, see below)
  assets/<sha256>.<ext>                file contents, content-addressed
  assets/<sha256>.<ext>.gz             the same, stored gzip-encoded (or .br: brotli-encoded)
```

Assets are named, stored and encoded as a product layout's ([Products](#products)), and a chart site may share its
`assets/` with products. When a page loads a chart manifest by URL, the player resolves its asset paths against the
directory above the manifest's directory (`charts/..`) unless it is given another base (see [docs/api.md](api.md)).

A page can also hand the player the logical files directly, without a site; the files and their contents are the
same (see [docs/api.md](api.md)).

### charts.json

The index of the charts a site offers ([schema](../schema/charts.schema.json)). Chart listings read it; the player
does not.

```json
{ "format": 2, "charts": [ { "id": "100001_expert", "musicId": 100001, "difficulty": "expert",
                             "manifest": "charts/100001_expert.json", "title": "…", "level": 25, "notes": 768,
                             "durationMs": 99989, "audio": true, "audioFormat": "aac", "flows": ["direct"],
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
| `charts[].regions` | string[] | Optional. The regions the manifest serves (the manifest's `regions`). An entry without it serves every region. |
| `charts[].language`, `titles`, `bandNames` | | Optional. The language of `title` and `bands`, the title per language (`{ "<language>": "…" }`), the band names per language (`{ "<language>": ["…"] }`); the same values as the manifest's `chart` object. |
| `language` | string | Optional. The default language of a listing (the language of most entries' `title`). |
| `languages` | string[] | Optional. The languages the entries' `titles` are in. |
| `regions` | object[] | Optional. The regions the site serves, the first one the default: `id`, `name` (a label), `languages` (optional: the languages a listing offers in that region). |

Languages are the game's text languages: `ja`, `en`, `zh-Hant`, `zh-Hans`, `ko`.

#### Several regions

A site can serve several game regions. Where the chart data of two regions is the same, they share one manifest,
`charts/<id>.json`, whose `regions` lists both; a region whose chart differs has its own manifest
`charts/<region>/<id>.json`. So an id can appear in `charts.json` several times, but at most once per region, and an
entry without `regions` only once. A listing shows the entries whose `regions` include the chosen region (and those
without `regions`), with `titles[language]` and `bandNames[language]` where present, else `title` and `bands`; it
loads the manifest of the chosen region's entry. The chart list page of this repository
([examples/chart-list](../examples/chart-list)) switches with `?region=<id>&lang=<language>`.

```json
{ "format": 2, "language": "zh-Hant", "languages": ["ja", "en", "zh-Hant", "zh-Hans", "ko"],
  "regions": [ { "id": "tw", "name": "…", "languages": ["zh-Hant", "…"] }, { "id": "kr", "name": "…" } ],
  "charts": [ { "id": "100001_expert", "manifest": "charts/100001_expert.json", "regions": ["tw", "kr"],
                "title": "…", "titles": { "ja": "…", "en": "…", "…": "…" }, "bandNames": { "ja": ["…"], "…": "…" },
                "…": "…" } ] }
```

### Chart manifest

`charts/<musicId>_<difficulty>.json`, or `charts/<region>/<musicId>_<difficulty>.json` on a site of
[several regions](#several-regions) ([schema](../schema/manifest.schema.json)), lists the logical files of one chart
and where their bytes are.

```json
{
  "format": 3,
  "musicId": 100001,
  "difficulty": "expert",
  "chart": { "title": "…", "level": 25, "notes": 768, "durationMs": 99989, "…": "…" },
  "audio": true,
  "audioFormat": "aac",
  "flows": ["direct"],
  "quality": 1,
  "files": {
    "live.json": { "asset": "assets/5203…cba0.json.gz", "size": 466, "stored": 301 },
    "livescene/textures/lane_base-d14cea1c.png": { "asset": "assets/9b1e…07aa.png", "size": 181236 },
    "livenotes/notes.json": { "parts": [["settings", "assets/45be…f418.json.gz", 1691, 612],
                                        ["prefabs", "assets/f367…e839.json.gz", 735095, 70118], "…"], "size": 4192212 },
    "…": "…"
  }
}
```

| Key | Type | Read by the player | Meaning |
|---|---|---|---|
| `format` | `3` \| `2` | no | Version of this layout: 3, whose assets may be encoded; 2, the earlier version, every asset stored as it is. The player reads both. |
| `musicId`, `difficulty` | integer, string | no | The chart. |
| `chart` | object | yes | The chart's facts (title, bands, level, note count, duration, …; on a site of several languages also `language`, `titles`, `bandNames` as in [charts.json](#chartsjson)), handed to the page as they are (see [docs/api.md](api.md)). The player does not interpret them. |
| `regions` | string[] | no | Optional. The regions this manifest serves (see [Several regions](#several-regions)). |
| `audio` | boolean | yes | `false`: the chart has no waveform files. The player then plays no sound and runs the chart clock from game time, as with the music switched off. |
| `audioFormat` | `"aac"` \| `"flac"` | no | Format of the music file: AAC in an MP4 container (`.m4a`) or FLAC. Sound effects are FLAC. |
| `flows` | string[] | no | Start flows the files support. The player uses the direct start (the chart starts at the end of the live's intro timeline), `"direct"`, which every chart supports; other values name start sequences this player does not use. |
| `quality` | `0` \| `1` \| `2` | yes | The `LiveQuality` the files were prepared for (0 High, 1 Middle, 2 Low); the default quality of the player. The current data uses 1 (Middle, the game's default option). |
| `options` | object | yes | Optional. Live option name → the values the files support, for options that select files: `{"LiveQuality": [1, 2]}`. Absent: `LiveQuality` offers `quality` only. (The other file-selecting options are offered by the data itself: `live.json` `notesMirror`, `livenotes/notes.json` `settings.skins` / `settings.effects`, `audio/live-audio.json` `noteSe.groups`.) |
| `files` | object | yes | Logical path → file entry. |

### Logical files

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

### live.json of a chart

```json
{ "musicId": 100001, "difficulty": "expert", "scene": "livescene/scene.json",
  "notes": "score/0001_03.notes.json", "noteAssets": "livenotes/notes.json", "liveAudio": "audio/live-audio.json" }
```

| Key | Meaning |
|---|---|
| `scene` | Path of the live scene. |
| `notes` | Path of the score. |
| `notesMirror` | Optional. Path of the score converted mirrored (the game's `MirrorChart` option: lanes and flick directions mirrored while the score is converted), same format as `notes`. Without it the `MirrorChart` option is not offered. |
| `noteAssets` | Path of the note assets. |
| `liveAudio` | Path of the sound definitions. |

### Sounds (`audio/live-audio.json`)

The sounds and the music of the chart in one file: the keys of [`sounds.json`](#sounds-soundsjson-musicjson), and
`music` (`{ soundId }`) with the music's cue among `sounds`. A layer's `file` is a logical path of the chart.

### Live scene (`livescene/scene.json`)

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

#### Node lists

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

### Note assets (`livenotes/notes.json`)

Note views, the note skin, hit effects, particles and the live UI's judgement and combo assets. Usually stored as a
split JSON object. Keys read:

| Key | Content |
|---|---|
| `settings` | Lane and option settings (below). |
| `prefabs` | Name → node list: the note views (`tap_note_view`, `flick_note_view`, `flick_left_note_view`, `flick_right_note_view`, `slide_note_view`, `slide_end_note_view`, `connection_note_view`, `none_note_view`), `slide_line_view`, `pair_note_line`, `judge_effect_view`; optional `bar_line_view`, the bar line view (the `LiveBarLineViewContainer` element prefab of the live scene), which offers `MeasureLineDisplay`. |
| `noteSkin` | The note skin asset: its serialized fields (`TapNoteAsset`, `FlickNoteAsset`, `SlideLineGradient`, …) with referenced assets, sprites and materials inline. |
| `noteSkins` | Optional. Skin asset name → a record like `noteSkin`, for the other note designs (`settings.skins`). |
| `assets` | Asset key (the game's asset path, e.g. `Effect/Live/NoteEffect/effect001/note_normal`) → a node list (effect prefabs), a ScriptableObject's serialized fields (effect and sprite settings), or `{ key, controller }`. |
| `clips` | Clip key → animation clip. |
| `controllers` | Controller key → animator controller. |

`settings`:

| Key | Meaning |
|---|---|
| `laneCount`, `laneSize` | Lane count (equal to the score's) and the lane's reference size `[width, height]`. |
| `laneTopRange`, `laneBottomRange`, `laneTopPosition`, `judgementScreenBottomPosition`, `tiltCenterLane` | Lane geometry of the game's lane settings. |
| `effect` | Name of the note effect set used for asset keys (e.g. `effect001`). The lane effects always come from `Effect/Live/LaneEffect/effect001/`, whatever the note effect set (the game loads that set by a constant name). |
| `skins` | Optional. `NoteDesignId` → skin asset name (`skin001`, …); a design is offered when `noteSkins` has its record. |
| `effects` | Optional. `NoteEffectId` → note effect set name (`effect001`, `effect001Simple`); the sets' assets are in `assets` under `Effect/Live/NoteEffect/<name>/`. At `LiveQuality` 2 the player uses the set's Light variant (`<name>Light`) when `assets` has its `LiveNoteEffectAssetSettings`, else the set itself, as the game does. |
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

### Shaders

A shader directory (`livescene/shaders/`, `livenotes/shaders/`) holds an index, one parsed shader description per
shader, and the GLSL programs. `shaders.json` is an array of records:

```json
{ "name": "UI/Default", "parsed": "UI_Default.json",
  "variants": [ { "file": "UI_Default/gles3/s0p0_vertex_0.glsl", "subShader": 0, "pass": 0, "keywords": [] } ] }
```

- `name` is the Unity shader name; `parsed` and each variant's `file` are paths relative to the shader directory.
- The parsed shader is the `json` of a [Shader object](#shader-objects), a variant's file one of its GLES3 programs.
  The index only needs the variants a chart uses, and each listed file must be present.

#### Texture descriptors

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
| `mipCount` | The texture's mip count (as `m_MipCount` of a [Texture2D](#textures)): above 1 the player generates the other levels from the PNG. |
| `settings` | Unity sampler settings: `m_FilterMode` (0 Point, 1 Bilinear, 2 Trilinear), `m_WrapU`, `m_WrapV` (0 Repeat, 1 Clamp, 2 Mirror). |

Descriptors may carry more keys (format, colour space, …). A descriptor can refer to a file the chart does not
include when the player never loads it (for example textures of background modes other than LightWeight).

A sprite descriptor wraps a texture descriptor with Unity's sprite data: `{ sprite, texture, rect: {x, y, width,
height}, pivot: {x, y}, border: {x, y, z, w}, pixelsToUnits, textureRect, … }`, with `rect` and `textureRect` in
texture pixels from the bottom left, `border` as (left, bottom, right, top).

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
node scripts/validate-data.mjs <site dir> [live id | chart id | model id ...]
```

Validates the lives (`lives/*.json`), the charts (`charts.json` and every chart, or the manifests in `charts/` and
`charts/<region>/` of a site without `charts.json`) and the models (`models.json` and every model) of a directory, or
only the given ids, and prints the failures and a summary.

Per live: the manifest (schema, `live`, a subject of the manifest's name), every asset of its files and of its objects'
files, `live.json` (schema), and each part it names, checked once however many lives name it: its manifest (schema,
the product `live.json` names, a subject of the manifest's name), its assets, its document (schema; the class of every
object it names; the bindings: prefabs whose Animator nodes they name, clips with as many names as bindings; the
shader table: Shaders whose variant index has the name) and its objects. Then the live as a whole: the score and the
mirrored score (schema, unique ids, line and pair references, the lane count of `notes.json`), the jacket, the band in
`scene.json` `bands`, a quality row for every `LiveQuality` the live offers, and the sounds (the sound ids used present,
category volumes, loop points, every waveform file in its product with its FLAC `STREAMINFO` sample rate, channels and
length equal to the layer's, an `.m4a` an MP4 file).

The objects of a product: every JSON file parses; a Texture2D's image is a PNG of the texture's size, with an
`m_MipCount` of at most a full chain; a Shader's parsed form and variant index, and for the Shaders the Materials use,
the `#ifdef VERTEX` / `#ifdef FRAGMENT` blocks of every GLES3 program with `#version 300 es`; a Mesh's `arrays`; a
Sprite the documents name has a texture with an image.

Per chart: the manifest (schema, agreement with `charts.json`); every asset: present; an encoded asset (`.gz`, `.br`)
of a kind that may be encoded, with `stored` equal to its length and less than `size`, that decodes; the (decoded)
bytes of `size` bytes with a SHA-256 equal to the asset's name; the extension matching the logical file; `stored` only
on encoded assets; split JSON files rebuild to their `size`, and every JSON file parses. Then the chart read as a live
is checked as the parts and the live above.

Per model: the manifest (schema, `live2d.model`, a subject of the manifest's name, agreement with `models.json`: `id`,
`key` and `group` of the subject, `canvas` and `textures` of `model.json`, `bytes`, `files`), every asset of its files
and of its objects' files as for lives (an object file's extension by its role: `json`, `index` and `arrays` JSON,
`image` PNG, a program GLSL), `model.json` (schema, the class of every object it names, its `motionSync` as the prefab
gives it, the names of every motion's bindings), the moc (a CubismMoc whose `blob:_bytes` has the moc3 header), the
prefab (the components above), the motions with a fade motion for each `InstanceId`, the expressions, one Lit material
and one atlas page per drawable (the PNG of the size the texture's JSON gives, `m_MipCount` at most a full chain), the
mask materials, every shader's parsed form and variant index and the programs above, and that the manifest lists
exactly the files the viewer and the story player read.

It needs Node.js 22 or later and no dependencies. The opt-in data tests (`OURNOTES_DATA=<dir> npm run test:data`) go
further and run lives and charts through the player in Node (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Song and replay data

The song catalog example reads `music-data.json` with format `nnnotes.music-data/1`. Replay presets read
`nnnotes.deck-data/1` for the caller-provided deck capabilities, and the replay worker accepts
`nnnotes.replay-manifest/1` references. These are separate inputs from the live, model and story product manifests.

## Site entry products

A chart entry under `charts/` can be an `nnnotes.product/1` live manifest. Its optional `variants` lists immutable note-skin, note-effect and sound products relative to its declared root; the loader combines them with the required parts. `options.LiveQuality` lists the offered qualities. `scripts/read-set.mjs --variants=<JSON array>` supplies extra manifest paths for either plan or full mode.

The live's `parts.ui` maps languages to UI products. An `audio: false` entry omits sound streams while retaining cue metadata. Story sessions use silent timing for such entries. Story listings select a playback language for which the entry includes resources.

### Scene and media document schemas

- [room](../schema/room.schema.json)
- [spot](../schema/spot.schema.json)
- [story-video](../schema/story-video.schema.json)
- [story-sound](../schema/story-sound.schema.json)
- [crilips](../schema/crilips.schema.json)
