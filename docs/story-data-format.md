# Story data format

A story is a `story` product whose `story.json` names its scene, media, models, sound sheets, UI and fonts. Each part
is a product manifest (`nnnotes.product/1`) with its own files and retained Unity objects. The format uses the
[shared object and file contracts](data-format.md#products).

The player loads one language at a time. Serialized component fields stay on their prefab nodes, while documents
name objects by `<serialized file>:<path id>`. Materials and textures resolve by identity; a display name need not
be unique. Game resources are supplied by the user.

| Document | Schema |
|---|---|
| Story product manifest | [story-manifest.schema.json](../schema/story-manifest.schema.json) |
| Part index, `story.json` | [story.schema.json](../schema/story.schema.json) |
| Command rows, `episode.json` | [episode.schema.json](../schema/episode.schema.json) |
| Scene, `scene.json` | [story-scene.schema.json](../schema/story-scene.schema.json) |
| UI, `ui.json` | [story-ui.schema.json](../schema/story-ui.schema.json) |
| Simple UI, `ui.json` | [story-simple-ui.schema.json](../schema/story-simple-ui.schema.json) |
| Host, `host.json` | [story-host.schema.json](../schema/story-host.schema.json) |
| Media, `asset.json` | [story-asset.schema.json](../schema/story-asset.schema.json) |
| Fonts, `fonts.json` | [story-fonts.schema.json](../schema/story-fonts.schema.json) |
| UI language settings | [story-language.schema.json](../schema/story-language.schema.json) |
| Listing index, `stories.json` | [stories.schema.json](../schema/stories.schema.json) |

## Site layout

```text
assets/<sha256>.<ext>
stories/<advId>.json
storyscenes/default.json
storyassets/<asset>.json
storyui/<language>.json
storyfonts/<advId>_<language>.json
storysimpleui/<language>.json
storyhosts/<host>.json
models/<model>.json
cuesheets/<sheet>.json
videos/<video>.json
crilips/default.json
rooms/<room>.json
spots/<spot>.json
stories.json
models.json
```

Manifest paths and asset paths are relative to the product layout root. A story manifest may set `root`, relative
to its URL: `../` for `stories/7.json`, `../../` for `stories/tw/7.json`. Without `root`, the loader uses `../`.
The loader's `base` option overrides that root. Content-addressed files may use gzip or brotli; their entries record
both decoded `size` and compressed `stored` length.

Part references may name immutable `products/<sha256>.json` manifests. The part's product and subject are checked
before loading, and its files remain relative to the site root. A site snapshot's `parts.ui`, `parts.fonts` and
optional `parts.simpleui` list the same set of available languages. Logical files and object JSON roles may use
the [split file-entry form](data-format.md#file-entries).

## stories.json

The optional listing index has `format: "ournotes.stories/1"` and a `stories` array. The player loads the manifest
selected from that index. Entries include `id`, `advId`, `manifest`, `playbackMode`, localized `titles`, `language`,
`languages`, and grouping information. A site can offer the same episode for several `regions`.

### Story facts

`groups` describes chapter, friendship, home spot and other listing groups. `commands` and `commandCount` describe
the episode. A listing can expose download sizes and audio/font choices for its own UI; those are presentation
metadata. Product loading follows `story.json.parts` and the file entries of the referenced manifests.

## Story manifest

A manifest has the shared product fields:

```json
{
  "schema": "nnnotes.product/1",
  "product": "story",
  "subject": "7",
  "root": "../",
  "language": "ja",
  "files": {
    "story.json": { "asset": "assets/<sha256>.json", "size": 123 },
    "episode.json": { "asset": "assets/<sha256>.json", "size": 456 }
  },
  "objects": {}
}
```

The asset names above are placeholders. `subject` is the decimal episode id; authored stories can use `0`.
`language` is optional. The public player chooses Japanese when offered, then the first available language, if
neither its options nor the manifest specifies a language. `loadStoryStore` needs an explicit `lang` when the
manifest has no default.

### Language groups

`parts.ui`, `parts.fonts` and, for simple stories, `parts.simpleui` map the same language codes to product manifests.
The loader selects one entry from each map. Codes are `ja`, `en`, `zh-Hant`, `zh-Hans` and `ko`. A partial export can
retain paths for other languages; those languages need their products before they can be loaded.

## Loading a story

```js
import { loadStoryStore, StorySession } from "ournotes-player/story";

const assets = await loadStoryStore("https://example.test/stories/7.json", { lang: "ja" });
const session = await StorySession.create(gl, assets, { autoplay: true });
```

`fetchStoryManifest` fetches the product index and episode and checks the command set before media is downloaded.
Its result can be passed to `loadStoryStore` as the `manifest` option. Downloads shared by products are reused;
compatible object roles merge, and conflicting roles or product identities are errors.

Within the store, a product's own files are under its manifest path without `.json`: the files of
`storyfonts/7_ja.json` are under `storyfonts/7_ja/`. The story's own files are under `stories/<advId>/`.
Object files are accessed by id and role. The internal `StoryData` view resolves these paths for sessions.

The Node `openStory` helper accepts a product manifest path or a layout containing exactly one manifest under
`stories/`. When several stories exist, pass the chosen manifest explicitly.

## Logical files

| Product | Document | Contents |
|---|---|---|
| `story` | `story.json`, `episode.json` | Episode and part graph |
| `story.scene` | `scene.json` | Shared scene, camera, fields, volumes and graphics settings |
| `story.asset` | `asset.json` | Media roots, animation bindings and shaders |
| `story.ui` | `ui.json` | Story UI prefabs and language settings |
| `story.fonts` | `fonts.json` | Font bindings, glyph pages and text material shaders |
| `story.simpleui` | `ui.json` | Simple talk window and system message prefabs |
| `story.host` | `host.json` | Home or live-result screen references |
| `story.sound` | `cues.json` | CRI cues and waveform files |
| `story.video` | `video.json` | Movie metadata and WebM file |
| `story.chat` | `chat.json` | Shared chat text and sound tables |
| `story.crilips` | `crilips.json`, `crilips.bin` | CRI Lips descriptor and weights |
| `live2d.model` | `model.json` | Character model and its object references |
| `room.gltf` | `room.json`, `room.glb` | Room geometry, node order and material ids |
| `spot.files` | `spot.json` | Home situation and Spine files |

## story.json

The index has `format: 1`, `advId`, `episode: "episode.json"`, `parts`, `chats` and `effects`.

- `parts.scene`, optional `parts.chat` and optional `parts.crilips` name shared products.
- `parts.assets` maps addresses such as `Adv/Stage/<name>` to media products.
- `parts.models` maps `Character/Live2D/<group>/<name>/model/<name>` to model products.
- `parts.sounds` maps cue-sheet names to sound products, and `parts.videos` maps `Cri/Video/<name>` to videos.
- `parts.ui`, `parts.fonts` and optional `parts.simpleui` select language products.
- `parts.host`, `parts.rooms` and `parts.spots` identify the simple story's host dependencies.

`chats` holds the episode's master chat rows. `effects` maps command target names to effect addresses.
Optional `host` contains the episode's host choice, including home talk kind, tap character, spot and localized title.
The reusable host product contains the screen resources and scene references.

## episode.json

The episode has command rows (`commands`, `commandCount`), localized `text`, `sounds`, `cuesheets`, `videos`, resource
addresses, a `master` row and localized `title`. Each command has `i`, `cmd`, `raw` and its serialized non-default
parameters. Text fields are `japanese`, `english`, `traditionalChinese`, `simplifiedChinese` and `korean`.

The player combines these commands with the initialize/finalize commands of `AdvPlayerSettings`. Overlay episodes
use the SimpleAdvPlayer command set. Playback behavior is described in [story.md](story.md) and
[story-simple.md](story-simple.md).

## scene.json

The scene has `format: 1`. `scene` names scene root GameObjects; `renderSettings` names the RenderSettings object.
`prefabs` names `cameraManager`, `characterField`, `backgroundField` and `globalVolume`. `settings` names the player
and master-id MonoBehaviours. `graphics` names GraphicsSettings, PlayerSettings and QualitySettings objects.

`bindings` maps prefab id → Animator node path → clip id → ordered `{path, attribute}` names. A null path leaves
that binding unbound. `shaders` maps Unity shader names to object ids; each material uses its own shader reference.
Several objects may legitimately have the same Unity name.

## Sounds

Each `cues.json` maps cue names to `file`, `sampleRate`, `samples`, `channels`, optional loop points and `categories`.
The waveform path is relative to that sound product. AAC files use `.m4a` and can include `encoderDelay`; FLAC files
use `.flac`. Loop bounds are measured in source samples and must fit within the waveform.

The episode's sound row resolves its cue sheet through `_soundCueSheetID` and its cue through `_cueName`. CRI cue
categories choose the volume bus; the sound row's category controls BGM crossfade and stop behavior.

## Live2D models

Story models are [model products](data-format.md#live2d-models) with `model.json` format 3. A model's prefab, clips,
materials, shader programs, textures and moc bytes resolve through the shared object table. The model validator
checks its standalone and story lighting variants.

## Story UI

`ui.json` has `format: 1` and references the story `widget`, `chatWidget`, `uiManager`, `talkWindows`, `dialogs`,
`letterbox`, animation `clips` and `controllers`. Native prefab components hold layout, graphics, text and behavior
fields. `settings` identifies DOTween, TMP, localization and master-id settings.

`texts` maps TMP component ids to a resolved `localized` font/material record and a style summary. `language` and
`textStyle` describe localization. The font product supplies the final font binding used to draw each text.

`story.simpleui` uses `nnnotes.story-simple-ui/1` and references `talkWindow`, `systemMessage` and `uiManager` with
the same settings, language, text and binding contracts.

## Fonts

`fonts.json` has `format: "nnnotes.story-fonts/1"`, a `language`, `source` (`open` or `game`), `fonts`, `textures`,
`materials`, `materialKeywords`, `shaders`, `texts`, `sprites`, `coverage` and `lineBreaking`.

Each `texts[componentId]` contains `font: {fontAsset, material, lineSpacing}`, `localized` and `style`; it may also
contain Korean font adjustment settings. `font` is the drawable binding. `localized` records the original localized
font selection and can name a font absent from an open-font product.

### Font assets

`fonts` maps font names to TMP face metrics, atlas dimensions and padding, render mode, style/spacing values,
character and glyph tables, fallback names, and a default material. `characters[unicode].glyph` names a glyph.
Its rect, metrics and scale control layout. A glyph with image texels has `packed: {texture, dx, dy}`; its rect plus
the offset must fit within the named page. Empty glyphs, such as spaces, do not need packed texels.

`textures` describes page PNGs under the font product. `missingGlyph` records absent code points and the substitute
TMP draws; the substitute must exist in the font or its fallbacks, or be TMP's synthesized U+0003 control glyph.
`coverage.missingGlyph` collects those substituted code points across fonts.

### Browser fonts

A font asset can have `browser: {family, weight?, style?, pageWidth?, pageHeight?, underlayOffset?, gameFont?}`.
The browser rasterizes glyphs as the text uses them, retaining the font asset's TMP layout metrics and SDF padding.
This is the font mode used by story-author for authored text. Character and glyph tables can start empty.

### Fallback font assets

Each font's `fallbacks` list names other font assets. A text material `M` drawing fallback font `F` uses material
`M + F`. It retains the text material's shader, keyword and appearance values, while taking the fallback's texture,
gradient scale and weight values; shader scale ratios are recomputed. The validator checks these relationships.

### Sprite assets

Optional `spriteAssets` contains TMP sprite characters, glyphs, sequences, face metrics and material bindings.
`emojiSpriteAsset` names the selected emoji asset. `sprites[componentId].spriteAsset` binds a TMP text to it; the
component's `m_tintAllSprites` field controls tinting. Sprite materials use `TextMeshPro/Sprite`.

## Language

`ui.json.language` has `code`, numeric `mode`, episode text `field`, `lineSpacing`, primary and additional font names,
material types and font swaps. The modes are Japanese 0, English 1, Traditional Chinese 2, Simplified Chinese 3 and
Korean 4. Language settings belong to the UI product.

## Media files

A `story.asset` document has `format: 1`, its `key`, root `objects`, animation `bindings` and `shaders`.
Frames, stills, particle effects, post effects, chat windows/icons/stamps, transitions and stages use their serialized
prefab or MonoBehaviour fields and object references. Text inside these prefabs uses the same component-id font table.

A video document has `format: 1`, its product-relative `file`, coded/display dimensions, frame rate, frame count and
track information. The player presents it on the native VideoView canvas.

A host document has `format: "nnnotes.story-host/1"`, `kind`, prefab references, capture `cameraTarget`, `overlayRoot`,
`layoutRoot`, `openedSequences`, DOTween and graphics settings, bindings and shaders. A node reference is
`{prefab, path}`; the layout root also carries its layout component `fields`.

The home host references room and spot products and a background state keyed by node path. Room summaries preserve
node order and `materialIds`, matching the GLB's primitive material indices. The host applies activation and floor
queue overrides. Spine materials are resolved from each SkeletonAnimation's skeleton and atlas object references.
The afterlive host identifies the background image/sprite, reward panel and result-screen substitutes.

## Documents and identities

The same object id must have compatible metadata wherever it appears. Products may retain different file roles of
that object, which merge into one object table. Two copies of the same role must agree. Animation bindings remain
specific to a prefab and Animator path even when clips share names.

## Validation

```sh
node scripts/validate-data.mjs <site-dir> [story-id ...]
node scripts/validate-data.mjs <site-dir> 7 --lang=ja,en
```

By default, validation checks every declared language. `--lang` explicitly restricts language validation and the
summary names that scope. Checks cover product identities, content-addressed files, shared objects, scene/UI/host
references, animation binding tables, actual material shader variants, glyph pages, font fallbacks, cue waveforms,
CRI Lips data bounds and model products. Rendered output is verified separately with a browser.
