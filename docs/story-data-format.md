# Story data format

The story player plays one story episode (a scripted scene with Live2D characters, stages, talk text, voices and
music) from a set of **logical files** that the embedding page supplies, usually as a static **site** served over
HTTP, the same kind of site that serves charts and Live2D models ([data-format.md](data-format.md)). This document
describes the story part of that data: the site layout, the story index, the story manifest with its per-language file
groups, the Live2D models it uses, and every logical file as far as the player reads it. Producing the data is outside
this repository; the [nnnotes](https://github.com/MetaSekaiLab/nnnotes) toolkit produces it from game files the user
supplies (`nnnotes web SITE --story <id>` / `--all-stories`).

Machine-readable schemas are in [`schema/`](../schema): [stories.schema.json](../schema/stories.schema.json),
[story-manifest.schema.json](../schema/story-manifest.schema.json), [story.schema.json](../schema/story.schema.json),
[episode.schema.json](../schema/episode.schema.json), [story-fonts.schema.json](../schema/story-fonts.schema.json) and
[story-language.schema.json](../schema/story-language.schema.json). `node scripts/validate-data.mjs <site dir>` checks
the stories of a site along with its charts and models (see [Validation](#validation)).

Keys that are not described here are ignored by the player; producers may add their own. The conventions of the chart
data apply unchanged ([Conventions](data-format.md#conventions): Unity names, Unity space, float32 values, `1e999`
for infinity, UTF-8). Where a structure comes from the game's Unity data (prefabs, materials, clips, volume profiles),
this document names it and the keys the player reads rather than every serialized field.

Contents:
[Site layout](#site-layout) ·
[stories.json](#storiesjson) ·
[Story manifest](#story-manifest) ·
[Loading a story](#loading-a-story) ·
[Logical files](#logical-files) ·
[story.json](#storyjson) ·
[episode.json](#episodejson) ·
[scene.json](#scenejson) ·
[Sounds](#sounds) ·
[Live2D models](#live2d-models) ·
[Story UI](#story-ui-uiuijson) ·
[Fonts](#fonts-uifontsjson) ·
[Language](#language-uilanguagesjson) ·
[Media files](#media-files) ·
[Documents and identities](#documents-and-identities) ·
[Validation](#validation)

## Site layout

```
<site>/
  stories.json                     story index (for listings; the player does not need it)
  stories/<advId>.json             story manifest, one per story
  stories/<region>/<advId>.json    a region's own manifest of a story (a site of several regions)
  models.json, models/<id>.json    the Live2D models, the stories' among them (data-format.md "Live2D models")
  story/                           the story page and the story bundle, when the site was built with them
  assets/<sha256>.<ext>[.gz|.br]   file contents, content-addressed, shared with the charts and models
```

- Assets follow the rules of the chart site ([Site layout](data-format.md#site-layout)): `<sha256>` is the lowercase
  hex SHA-256 of the (decoded) bytes, `<ext>` the extension of the logical file, identical contents are stored once,
  and an asset may be stored gzip- or brotli-encoded. Stories share the shaders, stage textures, cue sheets, UI
  textures and glyph pages they have in common, and the model manifests of the models they use.
- Asset and model manifest paths in a story manifest are relative to the site root. A player that loads a manifest by
  URL finds the site root through the manifest's `root` (format `/2`: `../` for `stories/<advId>.json`, `../../` for
  `stories/<region>/<advId>.json`); for a manifest of format `/1` it takes the directory above the manifest's
  directory.
- `<advId>` is the story's episode id (a decimal integer, the game's `MasterAdv` id).

## stories.json

The index of the stories a site offers ([schema](../schema/stories.schema.json)). Story listings read it; the player
does not.

```json
{ "format": "ournotes.stories/1", "language": "en", "languages": ["ja", "en", "zh-Hant", "zh-Hans", "ko"],
  "regions": [ { "id": "tw", "name": "…" } ],
  "stories": [ { "id": "10462", "advId": 10462, "manifest": "stories/10462.json",
                 "asset": "adv_script_…", "sheetName": "adv_script_…", "playbackMode": 0,
                 "titles": { "ja": "…", "en": "…", "…": "…" },
                 "groups": [ { "kind": "chapter", "id": 1001, "episodeNumber": 1,
                               "chapter": { "id": 10, "names": { "ja": "…", "…": "…" }, "bandId": 1 },
                               "characters": [] } ],
                 "commands": ["Bgm", "Character", "…"], "commandCount": 412,
                 "language": "en", "languages": ["ja", "en", "zh-Hant", "zh-Hans", "ko"],
                 "audio": true, "audioFormat": "aac", "fonts": "open",
                 "size": { "common": 20413220, "models": 9741091, "languages": { "ja": 410233, "…": 0 } },
                 "regions": ["tw"] } ] }
```

| Key | Type | Meaning |
|---|---|---|
| `format` | `"ournotes.stories/1"` | Version of this document. |
| `language` | string | Optional. The default language of a listing. |
| `languages` | string[] | Optional. The languages the entries' `titles` and language groups are in, in the order `ja`, `en`, `zh-Hant`, `zh-Hans`, `ko`. |
| `regions` | object[] | Optional. The regions the site serves (as in [charts.json](data-format.md#chartsjson): `id`, `name`, `languages`). |
| `stories` | object[] | One entry per manifest, sorted by `advId`, then `manifest`. |

An entry holds the manifest's [story facts](#story-facts) and:

| Key | Type | Meaning |
|---|---|---|
| `id` | string | The `advId` as a decimal string. |
| `manifest` | string | Path of the story manifest, relative to the site root. |
| `size` | object | `common`: the sum of `size` over the manifest's `files`; `models` (a manifest of format `/2`): the sum of `size` over the `files` of the model manifests it lists; `languages`: per language, the sum over that language group's `files` (decoded sizes, before shared assets are deduplicated). |
| `regions` | string[] | Optional. The regions the manifest serves (the manifest's `regions`). An entry without it serves every region. |
| `audio`, `audioFormat`, `fonts` | | Copies of the manifest keys of the same name. |

Languages are the game's text languages: `ja`, `en`, `zh-Hant`, `zh-Hans`, `ko`. A site of several regions follows
the chart rules ([Several regions](data-format.md#several-regions)): a story id appears at most once per region, a
listing shows the entries whose `regions` include the chosen region (and those without `regions`). The story list page
of this repository ([examples/story-list](../examples/story-list)) switches with `?region=<id>&lang=<language>`.

### Story facts

The manifest's `story` object and every stories.json entry carry these facts (the player does not interpret them; a
page gets them as `info.story`):

| Key | Type | Meaning |
|---|---|---|
| `advId` | integer | The episode id. |
| `asset`, `sheetName` | string | The episode asset and the sheet name of its `MasterAdv` row (`_advEpisodeAsset`, `_sheetName`). |
| `playbackMode` | `0` \| `1` | `AdvPlaybackMode`: 0 Normal (the story draws its own stage), 1 Overlay (the game plays the episode in its simple ADV player, `SimpleAdvPlayer`, over the screen that opened it). |
| `titles` | object | The episode title per language (`{ "<language>": "…" }`, the languages whose text is not empty). |
| `groups` | object[] | Where the game lists the episode (below); empty when no story table names it. |
| `commands` | string[] | The command names the player runs for the episode, sorted: the rows of the episode without `IgnoreData`, and the initialize and finalize rows of the player settings. |
| `commandCount` | integer | Number of rows of the episode. |
| `language` | string | The manifest's default language (below). |
| `languages` | string[] | The languages of the manifest's language groups. |

A group comes from one row of the game's story tables that names the episode (`_advId`), in this order:
`MasterStoryEpisode` (kind `chapter`), `MasterStoryFriendshipEpisode` (`friendship`),
`MasterStoryHomeSpotTapTalkEpisode` (`spotTalk`), `MasterStoryLiveResultEpisode` (`liveResult`), `MasterHomeSpot`
(`spot`: the spot's own episode); rows of one table by id.

| Key | Type | Meaning |
|---|---|---|
| `kind` | string | `chapter`, `friendship`, `spotTalk`, `liveResult` or `spot`. |
| `id` | integer | The row's id in its table. |
| `episodeNumber` | integer | Optional (`chapter`, `friendship`): the episode's number in its chapter or friendship story. |
| `chapter` | object | Optional (`chapter`): `id` (`MasterStoryChapter` id), `names` (per language), `bandId` (0: none), `special` (`_isSpecialStory`). |
| `characters` | object[] | The characters the row names (`chapter`: its character when it has one; `friendship`: the two characters of the friendship; `spotTalk`: the character; `liveResult`: the characters; `spot`: none), each `{ id, names }` with `id` the `MasterCharacter` id. |
| `spot` | object | Optional (`spotTalk`, `spot`): `id` (`MasterHomeSpot` id), `names` (per language). |

`names` objects hold the languages with a non-empty text.

## Story manifest

`stories/<advId>.json`, or `stories/<region>/<advId>.json` on a site of several regions
([schema](../schema/story-manifest.schema.json)), lists the logical files of one story, where their bytes are, and
the Live2D models the story uses.

```json
{
  "format": "ournotes.story-manifest/2",
  "advId": 10462,
  "root": "../",
  "story": { "advId": 10462, "titles": { "…": "…" }, "commands": ["…"], "…": "…" },
  "language": "en",
  "audio": true,
  "audioFormat": "aac",
  "fonts": "open",
  "requires": { "commands": ["Bgm", "Character", "…"], "cubismCore": true, "motionSync": true },
  "files": {
    "story.json": { "asset": "assets/2f0c…91aa.json.gz", "size": 1155, "stored": 402 },
    "scene.json": { "parts": [["player", "assets/b1d2…77e0.json.gz", 36212, 3810], "…"], "size": 171904 },
    "…": "…"
  },
  "models": { "adv_live2d_rana_003_casual_spring_01": "models/adv_live2d_rana_003_casual_spring_01.json" },
  "languages": {
    "en": { "files": { "ui/ui.json": { "parts": ["…"], "size": 68113 },
                       "ui/fonts.json": { "asset": "assets/…", "size": 52011 },
                       "ui/fonts/font_Noto Sans CJK JP Regular SDF_0.png": { "asset": "assets/…", "size": 88120 },
                       "ui/languages.json": { "asset": "assets/…", "size": 402 } } },
    "…": "…"
  }
}
```

| Key | Type | Read by the player | Meaning |
|---|---|---|---|
| `format` | `"ournotes.story-manifest/2"` \| `"ournotes.story-manifest/1"` | yes | Version of this document. `/2`: the Live2D models are model manifests of the site (`models`); `/1`, the earlier version: the models' files are among the story's common files (below). The player reads both and refuses other values. |
| `advId` | integer | no | The episode id. |
| `root` | string | yes | Format `/2`: the site root relative to the manifest, `"../"` for `stories/<advId>.json`, `"../../"` for `stories/<region>/<advId>.json`. |
| `story` | object | no | The [story facts](#story-facts), handed to the page as they are. |
| `regions` | string[] | no | Optional. The regions this manifest serves. |
| `language` | string | yes | The default language: the language the player loads when the page names none. One of the keys of `languages`. |
| `audio` | boolean | yes | `false`: the story has no sound files (`story.json` `audio` is empty); the player plays it without its sounds (videos keep their own sound track). |
| `audioFormat` | `"aac"` \| `"flac"` \| `null` | no | Format of every waveform file: AAC-LC in an MP4 container (`.m4a`) or FLAC; `null` without audio. |
| `fonts` | `"open"` \| `"game"` | no | Where the glyphs of the [font assets](#fonts-uifontsjson) come from: font files of the producer's choice (`open`) or the game's own font assets (`game`). The format is the same; the player does not distinguish them. |
| `requires` | object | yes | What the player needs to play the story: `commands` (equal to the facts' `commands`; a player that lacks one of them refuses the story before loading its files, naming them), `cubismCore` (`true`: the page must provide Live2D Cubism Core), `motionSync` (`true`: a Talk row maps a voice onto a character's lip sync, which needs Live2D's MotionSync Core with voices on). |
| `files` | object | yes | The common files: logical path → [file entry](data-format.md#file-entries). With format `/2` none of them is under `live2d/`. |
| `models` | object | yes | Format `/2`: model id → the path of its [model manifest](data-format.md#model-manifest) relative to the site root (`models/<id>.json`), keys sorted: the models of the story's Character rows (the ids of `story.json` `models`). |
| `host` | object | no | Optional. An Overlay episode (`playbackMode` 1) with open fonts: the screen the game plays it over and the simple talk window ([story-simple.md](story-simple.md)): `kind` (`home`: a home spot talk; `afterlive`: the reward phase of a live result), `doc` (`host/host.json`), `ui` (`ui/simple/ui.json`). The player finds these files by path. Absent for a Normal episode and for an Overlay episode with game fonts, which then has no host data and no simple talk window (the simple player refuses it). |
| `languages` | object | yes | Language → `{ files }`: the files of that language (below). At least one language. |

File entries are exactly those of a chart manifest ([File entries](data-format.md#file-entries)): whole files
`{ asset, size }`, encoded whole files `{ asset, size, stored }` and split JSON objects `{ parts, size }`, with the
same rules (paths relative with `/`, `.json` and `.glsl` are UTF-8 text, encoded assets decoded, every size checked).
The producer stores `scene.json` and `ui/ui.json` split per top-level key whatever their size, so the parts that
stories and languages share are stored once; other JSON files are split as in the chart sites (above 512 KiB).

### Language groups

`languages.<language>.files` holds the files whose contents differ between the languages of the story: in the current
data `ui/ui.json` (the localized text records and line spacing), `ui/fonts.json` and its glyph pages `ui/fonts/*.png`,
`ui/languages.json` and, with a `host`, `ui/simple/ui.json`, `ui/simple/fonts.json` and its pages
`ui/simple/fonts/*.png`. A file whose bytes are the same in every language of the manifest is a common file instead;
the fonts documents and glyph pages are always language files. Rules:

- The paths of a language group and of `files` are disjoint. A player builds its file set from `files` and one group,
  so a path that only some groups list (a glyph page named after its font) is never left over from another language.
- A language group lists `ui/fonts.json`, `ui/languages.json` and every page that `ui/fonts.json` names; with a
  `host`, also `ui/simple/fonts.json` and every page it names.
- `language` is one of the keys of `languages`.

## Loading a story

A player plays a story from one language at a time. Its file set is the union of

- `files`,
- `languages[<language>].files`,
- with format `/2`, for every model of `models`, the `files` of its model manifest under `live2d/<id>/` (the model's
  `model.json` is `live2d/<id>/model.json`).

The logical paths are the same in every language, so the reader code does not change with the language. The model
manifests are fetched together once the story manifest is read; their paths, like the asset paths, are relative to the
site root (`root`). Loading with the chart loader works on that union: `AssetStore.fromManifest` reads the `files` of
the manifest it fetches, so a story loader passes it the manifest with `files` replaced by the union (for example
through its `fetch` option), or fetches the entries itself; the entry forms and checks are the same. A language switch
loads the other language's group and keeps the common files and the models.

Every listed file is fetched before the story starts. A manifest lists the files the player's data (this document)
names: shader directories keep only the GLES3 programs (GLSL ES 3.00) of the shaders they list; SPIR-V containers,
GLSL ES 3.10 programs and the `streams.json` of the sound directories are left out.

## Logical files

| Logical file | Content | Group |
|---|---|---|
| `story.json` | Index: the paths of the files below. | common |
| `episode.json` | The episode: command rows, texts, sounds, cue sheets, videos, master data row, title. | common |
| `scene.json` | Player graphics, cameras, ADV fields, volumes, player settings, stages. | common |
| `shaders/shaders.json`, `shaders/…` | Shaders of the scene, the stages and the media files (format `/1`: also of the models) ([Shaders](data-format.md#shaders)). | common |
| `textures/*.png` | Textures of the scene and the media files ([Textures](data-format.md#textures)); paths relative to the story root. | common |
| `live2d/<id>/…` | The Live2D models ([Live2D models](#live2d-models)): format `/2`, the files of the model manifests; format `/1`, `live2d/<model>/…` among the common files. | model manifests (`/2`), common (`/1`) |
| `audio/<sheet>/cues.json`, `audio/<sheet>/<cue>.m4a` or `.flac` | Sounds per cue sheet ([Sounds](#sounds)). | common |
| `ui/ui.json` | The story UI: front canvas nodes, sprites, materials, clips, controllers, transitions, text records ([Story UI](#story-ui-uiuijson)). | language (common when equal) |
| `ui/textures/*.png`, `ui/shaders/…` | Packed UI textures and the UI shaders, including the TextMeshPro distance-field shader. | common |
| `ui/fonts.json`, `ui/fonts/*.png` | TextMeshPro font assets, text materials and text bindings of the language ([Fonts](#fonts-uifontsjson)). | language |
| `ui/languages.json` | The language settings ([Language](#language-uilanguagesjson)). | language |
| `frames.json`, `effects.json`, `posteffects.json`, `stills.json`, `talkwindows.json`, `chat.json` | Media of the episode, each only when the episode uses it ([Media files](#media-files)). | common |
| `videos/videos.json`, `videos/*.webm` | Movie and Clip videos (VP9 + Opus in WebM). | common |
| `crilips/crilips.json`, `crilips/crilips.bin` | The CRI Lips analysis data (descriptor and float32 weights, [crilips.md](crilips.md#data-section-for-the-story-data-format)), only when a voice of the episode reaches the analysis. | common |
| `host/host.json`, `host/ui/ui.json`, `host/spot/…`, `host/shaders/…` | With a `host`: the host screen (`ournotes.story-host/1`, [story-simple.md](story-simple.md#data)); the home spot's files under `host/spot/`. | common |
| `ui/simple/ui.json`, `ui/simple/fonts.json`, `ui/simple/fonts/*.png`, `ui/simple/shaders/…` | With a `host`: the simple talk window in the story UI record format, its fonts and glyph pages in the format of `ui/fonts.json` and its text shader (paths relative to `ui/simple/`). | language (`ui.json` and the shaders common when equal) |

The directory names are fixed: `ui/fonts.json` and `ui/languages.json` are found by path, the UI's texture and
shader paths are relative to `ui/`, a model's paths to its directory (`live2d/<id>/`, or the `dir` of a format `/1`
model), the scene's and the media files' texture paths to the story root.

## story.json

([schema](../schema/story.schema.json)) The index of the story directory.

```json
{ "advId": 10462, "episode": "episode.json", "scene": "scene.json", "ui": "ui/ui.json",
  "models": { "Character/Live2D/003_adv/…/model/…": "adv_live2d_rana_003_casual_spring_01" },
  "audio": { "sound_bgm_adv_…": "audio/sound_bgm_adv_…" },
  "frames": null, "effects": null, "postEffects": null, "stills": null, "talkWindows": null, "chat": null,
  "videos": null, "crilips": null }
```

| Key | Meaning |
|---|---|
| `advId` | The episode id. |
| `episode`, `scene`, `ui` | Paths of [episode.json](#episodejson), [scene.json](#scenejson) and [ui/ui.json](#story-ui-uiuijson). |
| `models` | Model key (the address the episode's Character rows name, `Character/Live2D/<group>/<name>/model/<name>`) → the model. Format `/2`: its model id (the files under `live2d/<id>/`, [Live2D models](#live2d-models)). Format `/1`: `{ dir, moc3, prefab }`, the model directory among the common files and the file names of the moc3 and the prefab in it. |
| `modelsDir` | Only in a story directory (a story's logical files as files on disk, outside a site): the directory holding its models, `<modelsDir>/<id>/model.json` and the files it names, relative to the story directory with `/`. A reader of the directory maps `live2d/<id>/…` there. Not in a site. |
| `audio` | Cue sheet name → its directory. Empty when the manifest's `audio` is `false`. |
| `frames`, `effects`, `postEffects`, `stills`, `talkWindows`, `chat` | Path of the media file of that kind, `null` when the episode does not use it. |
| `videos` | `videos/videos.json`, or `null` when the episode has no video. |
| `crilips` | `{ "descriptor": "crilips/crilips.json", "data": "crilips/crilips.bin" }`: the CRI Lips analysis data, present when a voice of the episode reaches the analysis (a lip-synced voice while a model has no MotionSync controller, or a voice that other speakers follow); else `null`. Absent in sites built before it; the player then gives those speakers no analysis (`lipSyncMissing` `"CRI Lips analysis"`). |

## episode.json

([schema](../schema/episode.schema.json)) The episode after the game's episode asset and its text, sound, cue sheet and
video tables.

| Key | Meaning |
|---|---|
| `advId`, `asset` | The episode id and its episode asset name. |
| `commands` | The rows in order: `i` (the row's `Index`), `cmd` (the `AdvCommand` name; `Cmd<n>` for a value without a name), `raw` (the `AdvCommand` value), and every field of the row whose value is not empty, zero or false, under its serialized name: `TargetName`, `TargetAssetName`, `TargetAssetIndex`, `PositionType`, `CameraDistance`, `Duration`, `DelaySeconds`, `IsNoWait`, `IgnoreData`, `IgnoreLipSync` (flags as 0 / 1), `Parameter1` … `Parameter4`, `TargetTextIDs`, `TargetTextColors`, `TargetStatus`, `AdvTextID`, `VoiceIDs`, `MotionName`, `MotionFadeIn`, `MotionWait`, `ExpressionName`, `BgmID`, `SeID`, `Key`, `VideoID`, `TargetChatID`, …. A missing field has its default (empty, 0, false). Added: `lines` (the text of `AdvTextID` per text field, below) and `voiceCues` (the cue names of `VoiceIDs`). |
| `commandCount` | Number of rows. |
| `text` | Text id → text per text field. |
| `sounds` | Sound id → the episode's sound row (`_soundCueSheetID`, `_cueName`, …). |
| `cuesheets` | Cue sheet id → the episode's cue sheet row (`_cueSheetName`, …). |
| `videos` | Video id → the episode's video row (`_assetName`, …). |
| `resources` | The episode's asset closure: `[{ kind, address, present }]`. |
| `master` | The `MasterAdv` row: `_id`, `_sheetName`, `_advEpisodeAsset`, `_titleTextId`, `_rubyTitleTextId`, `_playbackMode`. |
| `title` | The title text per text field, or `null`. |

Text fields are the columns of the game's text tables without the underscore: `japanese` (ja), `english` (en),
`traditionalChinese` (zh-Hant), `simplifiedChinese` (zh-Hans), `korean` (ko); a language's UI data names its field
(`ui/languages.json` `field`). Ids of the id maps are decimal strings or the game's text ids.

## scene.json

The story scene after Unity serialization (the same node, component, material and texture conventions as the live
scene, [Live scene](data-format.md#live-scene-livescenescenejson)). Keys read:

| Key | Content |
|---|---|
| `player` | Player graphics: the quality levels, URP assets, renderers and renderer features. |
| `cameraManager` | `{ nodes }`: the camera hierarchy (`CameraManager/MainCamera`). |
| `advScene`, `characterField`, `backgroundField`, `globalVolume` | The ADV scene objects: node lists with their components (fields, volumes and profiles inline). |
| `settings.playerSettings` | `AdvPlayerSettings`: `_initializeEpisodes`, `_finalizeEpisodes` (rows with `Command` values, run before and after the episode), `_focusDataSettingsMap`, `_defaultFocusDataSettingsKey`, `_defaultPanV2FocusSlideRate`, `_defaultTransitionAssetAddress`, `_waitTalkTextUnitTime`, `_minTalkDisplayTime`, `_waitAfterVoiceTime`, `_targetNameSplitKey`, the `_allow*` flags, wait and shake values. |
| `settings.masterIdSettings` | `AdvMasterIdSettings`: `_unknownCharacterNameTextId`, `_splitCharacterNameTextId`. |
| `stages` | Stage key (the address after `Adv/Stage/`) → the stage prefab (node list) of every stage the episode uses. |
| `resources` | Format `/1`: `cubismMask`, `cubismMaskCulling`, the Cubism mask materials of the story's models (as in [model.json](data-format.md#modeljson)). Not read with format `/2`: each model has its own in its `model.json`. |
| `postTextures` | Renderer name → post-processing textures (`filmGrainTex`, …) as texture descriptors. |
| `shaders.cameraRenderers` | The shader names each camera renderer draws with. |

Other keys are not read.

## Sounds

`audio/<sheet>/cues.json` per cue sheet the episode's cue sheet table names: cue name → the cue's first waveform.

```json
{ "adv_voice_…_001": { "file": "adv_voice_…_001.m4a", "sampleRate": 48000, "channels": 1, "samples": 120960,
                       "encoderDelay": 1024 },
  "sound_bgm_adv_…": { "file": "sound_bgm_adv_….m4a", "sampleRate": 48000, "channels": 2, "samples": 4608000,
                       "loopStart": 96000, "loopEnd": 4608000, "encoderDelay": 1024 } }
```

| Key | Meaning |
|---|---|
| `file` | The waveform file, relative to the sheet's directory: AAC in MP4 (`.m4a`) or FLAC, as the manifest's `audioFormat`. |
| `sampleRate`, `channels`, `samples` | As in a live's [sound layers](data-format.md#sounds-audiolive-audiojson): `samples` counts frames at `sampleRate`, without encoder padding. |
| `loopStart`, `loopEnd` | Optional: loop points in sample frames. |
| `encoderDelay` | Optional, AAC only: the priming samples at the start of the stream, handled as for a live's layers. |

A sound id of a row (`BgmID`, `SeID`, `VoiceIDs`) resolves through `episode.json`: `sounds[id]` gives the cue name (`_cueName`) and
the cue sheet id (`_soundCueSheetID`), `cuesheets[<cue sheet id>]._cueSheetName` the directory `story.json` `audio` names. Lip sync reads the
decoded PCM of the voice file; with AAC data its samples differ from the game's in the last bits (a lossy codec).

## Live2D models

Format `/2`: each model is a model of the site ([Live2D models](data-format.md#live2d-models)): its manifest
`models/<id>.json`, listed in `models.json`, and its files, which the player loads under `live2d/<id>/`. The story
player reads them as the model viewer does: `model.json` names the moc3, the prefab (texture paths relative to the
prefab's directory) and the shader index; a character draws with its model's own shaders and with the Cubism mask
materials of its `model.json` `resources`. The story renderer adds `_ADDITIONAL_LIGHTS_VERTEX` to every character draw
at quality 4, so each model's shaders hold, for every keyword set its drawables use, the set and the set with
`_ADDITIONAL_LIGHTS_VERTEX` ([Model shaders](data-format.md#model-shaders)). A model the stories share is one
manifest.

Format `/1`: `live2d/<model>/` among the story's common files holds per model the moc3, the prefab
(`<name>.prefab.json`) and the atlas pages under `textures/`, in the form of a model site's files (texture paths
relative to the model directory, atlas pages may be mipmapped). The shaders the drawables use are in the story's
`shaders/`, the mask materials in `scene.json` `resources`.

In both formats a character's MotionSync controller comes from its prefab.

## Story UI (`ui/ui.json`)

The parts of the game's ADV widget (`UIAdvWidget`) the story draws: the front canvas (talk window, speaker plate,
episode title, location caption, rule transition cover, curtains, flash, subtitles caption, next indicator, menu
entry button, menu panel and video buttons, backlog, choices, the next and cancel-full-screen tap areas), the screen
canvases of videos, stills and frames with the screen image of the video-and-still camera, and the letterbox bands;
the phone of the chat rows (`UIAdvChatWidget`) and the text records of the episode's chat windows; the dialogs of the
ADV screen. Keys read:

| Key | Content |
|---|---|
| `nodes` | The RectTransform hierarchy (node order: every parent before its children): `path`, `name`, `active`, `localPosition`, `localRotation`, `localScale`, `rect`, and the uGUI parts the story draws: `canvas`, `canvasScaler`, `canvasGroup`, `image`, `rawImage`, `gradient`, `layoutGroup`, `contentSizeFitter`, `layoutElement`, `safeAreaEdgeAnchor`, `animator`, `tweenSequence`, `animationTrigger`, `talkWindow`, `buttonImageState`, `outline`, `ruleTransition`, `localizeText`, the view records and `behaviours` (below); a text node has `textStyle` (below). A node whose parent is not listed is a child of the widget root. The talk windows are children of `UIAdvWidget/FrontCanvas/UISafeArea/UIContainer/TalkView`, each with its prefab's nodes and a `talkWindow` record on its root (`_typingDelay`, `_safeAreaTalkBackgroundExpansionFactor`, `_useBackdropFilter`, `_backdropFilterColor`, `_talkTextColor`, `_talkTextOutlineColor`): `UIDefaultTalkWindow` first, then by name every other window the episode's `TalkWindow` rows attach (such as `UICenterTalkWindow`). When one of them has `_useBackdropFilter` set, the nodes also hold the front canvas' `CenterTalkBackdrop` (`canvasGroup` and `image`: the backdrop behind that window's talk). |
| `frontCanvasOrder` | Sibling order of the front canvas' children. |
| `widget` | `canvasSortOrder` (`UIWidget._canvasSortOrder`) and `canvases`: the widget's canvases in `UIWidget._canvases` order, each `{ path, sortingOrder }` (the canvas' `m_SortingOrder`; `UIWidget.TrueCanvasSortOrder` is the first one's, 99999 without canvases). The paths may name canvases that are not in `nodes`. |
| `videoAndStillCamera` | The camera the video and still canvases render with (`UIAdvWidget._videoAndStillCamera`): `path` (its node, not in `nodes`), `active`, `camera` (`m_ClearFlags`, `m_BackGroundColor`, `m_NormalizedViewPortRect`, `near clip plane`, `far clip plane`, `field of view`, `orthographic`, `orthographic size`, `m_Depth`, `m_CullingMask`, `m_HDR`, `m_AllowMSAA`) and `additionalCameraData` (URP: `m_RenderPostProcessing`, `m_VolumeLayerMask`, `m_RendererIndex`, antialiasing, shadow and texture options, `m_CameraType`, `m_VolumeFrameworkUpdateModeOption`, `m_Dithering`, `m_StopNaN`). |
| `uiCamera` | The UI camera of the `UIManager` prefab (`UIManager._cameraController` → `UICameraController._uiCamera`, with its `_uiCameraData`), in the form of `videoAndStillCamera`. The frame canvas has no camera in the widget prefab; this camera renders it at run time, and the canvas particle graphics are baked with it. |
| `videoAndStillScreenImage` | The node of the raw image that shows that camera's output (`UIAdvWidget._videoAndStillScreenImage`). |
| `masterIdTexts` | The `AdvMasterIdSettings` texts of the dialogs in the language: `_skipVideoMessageTextId`, `_skipButtonTextId`, `_cancelButtonTextId` (the video skip dialog), `_skipMessageTextId`, `_continuousSkipMessageTextId`, `_backEpisodeListButtonTextId`, `_continueEpisodeButtonTextId` (the skip confirm dialog), `_interruptionTitleTextId`, `_interruptionMessageTextId`, `_interruptionButtonTextId` (the interruption dialog) → `{ id, text }` (the `MasterText` id and its text). |
| `dialogs` | Dialog name → `{ key, nodes }`: the prefab of the dialog (`UIAdvSkipConfirmDialogWidget`, the skip confirm dialog; `UICommonDialogWidget`, the dialog `CommonDialogManager` opens) and its nodes as node records (paths start with the dialog name); text nodes have `textStyle`. |
| `chatWidget` | `{ nodes }`: the phone the chat windows attach to (`UIAdvChatWidget`), as node records: `ChatCanvas` (`canvas`, `canvasScaler`), `ChatCanvas/AdvChatView` (rect and the `chatView` record) and its `Target` (rect, `canvasGroup`). Paths start with `UIAdvChatWidget/`. |
| `chatTexts` | Optional, an episode with chat windows: window name (the prefab after `Adv/Chat/Prefabs/`, as `chat.json` `windows`) → text node path (as in that window's node list) → `{ textStyle, localizeText }`: the text record of each TextMeshPro text of the window in the language (below; a localized text with the font and material `LocalizeText` gives it, its `fontRole` the slot of the Japanese lookup table, `font2` and up for the additional fonts) and the node's `LocalizeText` flags (`null` without one). |
| `chatStatusTexts` | Optional, with chat windows and the master data: `MasterText` id → its text in the language, for the incoming call and lock screen status keys of the windows (`AdvChatWindow._incomingCallStatusTextKey`, `_lockScreenStatusTextKey`). |
| `sprites`, `letterBoxSprite` | Sprite name → sprite descriptor on a packed texture; the letterbox band sprite's name. |
| `textures` | Packed texture name → texture descriptor (paths relative to `ui/`). |
| `materials`, `materialKeywords` | The UI materials (the rule transition's, `Default UI Material`, the materials the drawn images name, such as the video mask's) and the GLES3 keyword set of each. |
| `blur` | Optional, with a talk window whose `talkWindow._useBackdropFilter` is set: the UI blur the game runs while that window's talk area is shown (`UIManager.UseBlur`: everything drawn before the front canvas is blurred). `renderer` and `active`, then the renderer feature's pass settings `iterations`, `offset`, `downsample` and `blendRateMax`, and `shader`, the Dual Kawase blur shader (in `shaders`). |
| `clips`, `controllers` | Animation clips and animator controllers of the indicators, title and location animations. |
| `transitions` | Transition address → `RuleTransitionSettings` with its rule texture. |
| `playerSettings` | `_defaultTransitionAssetAddress`, `_waitAfterVoiceTime`, `_waitTalkTextUnitTime`, `_minTalkDisplayTime`, `_isAdvViewportFollowOnResolutionChanged`. |
| `dotween` | The game's DOTween defaults. |
| `shaders` | `{ index: "shaders/shaders.json", names }`: the UI shader directory, relative to `ui/`. |
| `language` | `mode` (`LanguageMode`), `field` (the text field), `lineSpacing` (the line spacing localized texts get). |
| `textStyle` | `language`, `units`, `roles`: the line metrics per font role of the game's fonts. The layout uses the font assets of `ui/fonts.json`; with open fonts it takes the line height, ascent and descent of their role from here ([Fonts](#fonts-uifontsjson)). |

Node records beyond the uGUI component fields:

- `canvas`: `m_Enabled`, `m_RenderMode`, `m_SortingOrder`, `m_OverrideSorting`, `m_PixelPerfect`,
  `m_VertexColorAlwaysGammaSpace`, `m_AdditionalShaderChannelsFlag`; a screen-space-camera canvas (`m_RenderMode` 1)
  also `m_PlaneDistance` and, when it has a camera, `camera` (the camera's node path, `videoAndStillCamera` `path`).
- `canvasScaler`: the `CanvasScaler` fields (`m_UiScaleMode`, `m_ReferenceResolution`, `m_ScreenMatchMode`,
  `m_MatchWidthOrHeight`, `m_ReferencePixelsPerUnit`, `m_ScaleFactor`, `m_Enabled`); for the game's
  `ClampedCanvasScaler` also `class` and `_maxAspectThreshold` (the aspect ratio past which the scale stops growing).
- `rawImage`: `m_Enabled`, `m_Color`, `m_UVRect`, `m_RaycastTarget`, `m_Maskable`, `texture` (null: set at run
  time), `material`.
- `buttonImageState`: `normal` (the sprite of the normal state) and, for a button with a selected state, `selected`
  and `target` (the node of the image whose sprite changes). A node with several `ButtonImageState` components has
  them in `behaviours` instead.
- `behaviours`: class → one record per component of that class on the node, in component order, for the game and
  uGUI components that have no record of their own: `UIButton`, `ButtonActiveState`, `ButtonAnimationScale`,
  `ButtonSound`, `ButtonImageState` (several on a node), `SimpleRaycastTarget`, `GraphicColorSynchronizer`,
  `UIText`, `AspectRatioFitter`, `UIToggle`, `UIToggleGroup`, `UIToggleButtonFrame`, `UIDecoratedNormalButton`,
  `UIDecoratedNormalButtonFrame`, `UIAddressableImage`, `UISafeArea`, `AdvViewportSafeArea`, `EnhancedScrollRect`,
  `EnhancedScroller`, `ScrollRect`, `RectMask2D`, `Scrollbar`, `DOTweenAnimation`, `LocalizeSpriteEvent`,
  `AdvTalkLogEntryView`, `AdvChoiceItem`, `DialogButtons`, `DialogAnimation`, `DialogSizeFitter` and the dialog
  widgets. A record holds every serialized field of the component (without the object header): references as node
  paths (a reference outside the exported nodes keeps its path), sprites as sprite names (each in `sprites`),
  assets, materials and textures as names. `UIPictogram` records hold `m_Enabled`, `_key`, `_image`, `_setNativeSize`,
  `catalog` and the catalog's `sprite` for the key (`null` when the catalog has none) with its `defaultSprite`.
  Localized sprites (`LocalizeSpriteEvent`, the menu's per-language button sprites) are not resolved; their records
  name the table entry.
- `safeAreaEdgeAnchor`: `enabled` and `_left`, `_right`, `_top`, `_bottom` (`_target`, `_anchor`, `_offset`): the
  node's edges anchored to the safe area or the screen (`UISafeAreaEdgeAnchor`).
- View records, their serialized references as node paths: `videoView` (`AdvVideoView`: `_video`, `_maskArea`,
  `_curtainCanvasGroup`, `_videoCanvasGroup`), `stillView` (`AdvStillView`: `_overlay`, `_background`, `_target`),
  `frameView` (`AdvFrameView`), `flashView` (`AdvFlashView`: `_flash`), `subtitlesView` (`AdvSubtitlesView`:
  `_subtitles`, `_subtitlesText`), `frontScreenView` (`AdvFrontScreenView`: `_nextButton`, `_nextIndicator`,
  `_cancelFullScreenButton`, `_uiContainer`), `talkLogView` and `choiceView` (`AdvTalkLogView`, `AdvChoiceView`:
  every serialized field, such as `_scroller`, `_entryViewOrigin`, `_fadeDuration`, `_choiceItems`,
  `_animationIntervalIn`), `menuView` (`AdvMenuView`: `_menuButtonsParent`, `_menuEntryButton`,
  `_skipButton`, `_autoButton`, `_fastForwardButton`, `_logButton`, `_continuousButton`, `_fullScreenButton`,
  `_interruptionButton`, `_menuButtonsBackground`, `_canvasGroup`, `_skipVideoButton`, `_pauseVideoButton`,
  `_subtitlesButton`, `_videoButtonParent`, `_videoFilterButton`, `_fastForwardButtonImage`; also the sprite names of
  the fast-forward speeds `_fastForwardNormalSprite`, `_fastForwardOnePointFiveSprite`,
  `_fastForwardOnePointSevenSprite`, `_fastForwardDoubleSprite`, in `sprites`, and `_fadeDuration`), `chatView`
  (`AdvChatView`, in `chatWidget`: `_showEaseDuration`, `_hideEaseDuration`, `_showEase`, `_hideEase`,
  `_scrollDuration`, `_typingDelay`, `_typingTextBoxMinHeight`, `_screenModeTransitionDuration`,
  `_screenModeTransitionEase`, `_incomingCallPositionOffset`, `_windowParentRect`); each with `enabled`. A reference
  may name a node that is not in `nodes`.

A text node's `textStyle` is its TextMeshPro text record in plain values: `fontRole` (`primary` or `number`),
`materialType`, `localized`, `textKey`, `text`, `richText`, `fontSize`, `autoSize`, `fontStyle`, `alignment`,
`wrapping`, `overflow`, `margin`, `lineSpacing` (`serialized`, `applied`, `byLanguage`), spacing values, `color`,
`colorMode`, and the look of its material in em (`face`, `outline`, `underlay`). The layout itself uses the serialized
TextMeshPro fields and the bindings of `ui/fonts.json` `texts`.

## Fonts (`ui/fonts.json`)

([schema](../schema/story-fonts.schema.json)) The TextMeshPro data the story's texts are laid out and drawn with in one
language: font assets holding exactly the characters the episode shows in that language, their glyph pages, the text
materials and, per text node, the font asset and material it uses. The player lays text out with TextMeshPro's rules
using these glyph metrics and draws it with the distance-field shader the material names (in `ui/shaders/`). The
format is the same whether the glyphs were generated from a font file (`source` `open`) or taken from the game's font
assets (`game`). With open fonts, a font asset that the texts of a font role use (the role's `fontAsset` in
`ui/languages.json`, or the font asset of a text node of the UI, a dialog or a chat window whose `textStyle.fontRole`
names the role) is laid out with the line height, ascent and descent of the game's font of that role (`ui.json`
`textStyle.roles`) in place of its own face info's. Any other open asset named `<open font> (<game font asset>)` (a
fallback, such as the Japanese font behind the untranslated Japanese labels of the Korean chat window) takes those of
the game font asset it stands in for, where the player knows them (A-OTF-ShinGoPr6N, VibeMOPro, FZLTH_GB18030L2_R,
Pretendard SemiBold). The language's line spacing is set for the game's fonts: English's -100 takes one em off the
pitch of a font whose line height is 2 em, and would put the lines of a 1.448 em face 0.448 em apart.

```json
{ "format": "ournotes.story-fonts/1", "language": "en", "source": "open",
  "fonts": { "Noto Sans CJK JP Regular SDF": { "faceInfo": { "m_PointSize": 40, "…": "…" }, "characters": { "…": "…" },
                                              "glyphs": { "…": "…" }, "…": "…" } },
  "textures": { "font_Noto Sans CJK JP Regular SDF_0": { "texture": "fonts/font_Noto Sans CJK JP Regular SDF_0.png",
                                                         "width": 2048, "height": 312, "…": "…" } },
  "materials": { "Noto Sans CJK JP Regular - OutlineAdvCommon": { "shader": { "shader": "TextMeshPro/Mobile/Distance Field" }, "…": "…" } },
  "materialKeywords": { "Noto Sans CJK JP Regular - OutlineAdvCommon": ["OUTLINE_ON"] },
  "texts": { "UIAdvWidget/…/TalkText": { "m_fontSize": 42, "…": "…",
                                         "localized": { "fontAsset": "Noto Sans CJK JP Regular SDF",
                                                        "material": "Noto Sans CJK JP Regular - OutlineAdvCommon",
                                                        "lineSpacing": -100 } } },
  "coverage": { "characters": 61, "missing": [] } }
```

| Key | Type | Meaning |
|---|---|---|
| `format` | `"ournotes.story-fonts/1"` | Version of this document. |
| `language` | string | The language (`ja`, `en`, `zh-Hant`, `zh-Hans`, `ko`). |
| `source` | `"open"` \| `"game"` | Where the glyphs come from (the manifest's `fonts`). |
| `fonts` | object | Font asset name → [font asset](#font-assets). |
| `textures` | object | Glyph page name → texture descriptor ([Texture descriptors](data-format.md#texture-descriptors)): `texture` (the PNG, relative to `ui/`, under `ui/fonts/`), `name`, `width`, `height`, `mipCount` (1), `settings`. |
| `materials` | object | Material name → the TextMeshPro material in the inline material form of the scene files ([Node lists](data-format.md#node-lists)): `material`, `shader` (`{ shader: "TextMeshPro/Mobile/Distance Field" }` in the current data), `keywords`, `textures` (`_MainTex`: the glyph page it samples, `{ name, width, height, format }`), `floats` (`_GradientScale`, `_ScaleRatioA` … `_ScaleRatioC`, `_FaceDilate`, `_OutlineWidth`, `_OutlineSoftness`, `_UnderlayOffsetX`, `_UnderlayOffsetY`, `_UnderlayDilate`, `_UnderlaySoftness`, `_WeightNormal`, `_WeightBold`, `_TextureWidth`, `_TextureHeight`, …), `ints`, `colors` (`_FaceColor`, `_OutlineColor`, `_UnderlayColor`). The text materials of `texts` and the default material of every font asset. |
| `materialKeywords` | object | Material name → the keywords of its GLES3 program (the material's keywords that the shader's GLES3 variants use). |
| `texts` | object | Text node path (as in `ui/ui.json` `nodes`) → the node's text binding (below). Every text node of `ui/ui.json`. |
| `dialogTexts` | object | Optional, open fonts: dialog name → text node path → text binding, one per text node of `ui/ui.json` `dialogs`. Game-font data has no dialog bindings. |
| `chatTexts` | object | Optional, open fonts and an episode with chat windows: window name → text node path → text binding, one per text of `ui/ui.json` `chatTexts`. A text without `LocalizeText` keeps its serialized font asset, material and line spacing in `localized`. Game-font data has no chat bindings. |
| `frameTexts` | object | Optional, open fonts and an episode whose frames have text nodes: frame name (a key of the story's `frames.json` `frames`) → text node path → text binding, one per node of the frame's prefab with a TextMeshPro text component (`TextMeshProUGUI`, `RubyTextMeshProUGUI`, `RubyEmojiTextMeshProUGUI`). A text without `LocalizeText` keeps its serialized font asset, material and line spacing in `localized`. Game-font data has no frame bindings. |
| `spriteAssets` | object | Optional: sprite asset name → [sprite asset](#sprite-assets), present when the episode's texts draw sprites (the game's emoji sprite asset). |
| `emojiSpriteAsset` | string | With `spriteAssets`: the sprite asset `LocalizeManager.EmojiSpriteAsset` is (a key of `spriteAssets`): the one a `UIText` gives its text, and the one `TmpTextHelper.CombineEmojiSequences` reads for a text without a sprite asset. |
| `coverage` | object | `characters` (distinct characters shown), `missing` (as strings, not the characters a sprite draws: with game fonts the characters no font asset of the chain has, which TextMeshPro draws as its missing glyph (`missingGlyph`); with open fonts the characters the game's font assets have and no font file of the open chain has, which the player does not lay out: a text that shows one fails), `missingGlyph` (optional: the characters of the font assets' `missingGlyph`, as strings, ascending), with sprites `sprites` (`characters`: the sprite characters held, `missing`: the names of those without an image), and producer details. |
| `tmpSettings` | object | Optional (game): the game's TMP Settings values (`m_missingGlyphCharacter`, …). |
| `lineBreaking` | object | Optional: TextMeshPro's line breaking rules of the game's TMP Settings: `leading` and `following` (the text of its leading and following characters files, as stored) and `useModernHangulLineBreakingRules`. A layout that breaks a line next to a character of these sets needs it. |

A text binding holds the text component's serialized TextMeshPro fields (`m_fontSize`, `m_fontSizeBase`,
`m_fontStyle`, `m_fontWeight`, `m_HorizontalAlignment`, `m_VerticalAlignment`, `m_characterSpacing`,
`m_wordSpacing`, `m_lineSpacing`, `m_paragraphSpacing`, `m_characterHorizontalScale`, `m_TextWrappingMode`,
`m_overflowMode`, `m_enableAutoSizing`, `m_fontSizeMin`, `m_fontSizeMax`, `m_enableKerning`, `m_ActiveFontFeatures`,
`m_enableExtraPadding`, `m_isRichText`, `m_parseCtrlCharacters`, `m_isOrthographic`, `m_overrideHtmlColors`,
`m_margin`, `m_fontColor`, `m_Color`, `m_colorMode`, `m_enableVertexGradient`, `m_TextStyleHashCode`,
`m_useMaxVisibleDescender`, `m_horizontalMapping`, `m_verticalMapping`, `m_charWidthMaxAdj`, `m_lineSpacingMax`,
`m_isRightToLeft`, `m_text`, and `m_monospaceDistEm` for the emoji text class), `class` (`TextMeshProUGUI`,
`RubyTextMeshProUGUI`, `RubyEmojiTextMeshProUGUI`),
`enabled`, `fontAsset` and `material` (the serialized font asset and material names), `localized`: what the text
uses in this language after `LocalizeText` — `fontAsset` (a key of `fonts`), `material` (a key of `materials`) and
`lineSpacing` (the line spacing it gets) — and, optionally, the ruby settings: `ruby` for a ruby text class
(`RubyTextMeshProUGUI`, `RubyEmojiTextMeshProUGUI`: the serialized `_rubyVerticalOffset`, `_rubyScale`,
`_rubyLineHeight`, `_rubyShowType`, `_rubyMargin`) and `uiRubyText` for a node with a `UIRubyText` component
(`_rubyMarginTop`); `localizeKoreanAdjust` for a node with a `LocalizeKoreanAdjust` component (`_koreanFontStyle`: in
Korean, 1 clears and 2 sets the bold style of `m_fontStyle`; `m_Enabled`). A text a `UIText` (or `UIRubyText`) drives
has `spriteAsset` (a key of `spriteAssets`: `UIText.Awake` gives the text `LocalizeManager.EmojiSpriteAsset`) and its
serialized `m_tintAllSprites`, when `spriteAssets` is present; any other text has no sprite asset.

### Font assets

A font asset is a TextMeshPro font asset reduced to the characters the episode shows:

| Key | Meaning |
|---|---|
| `faceInfo` | TMP `m_FaceInfo`: `m_FamilyName`, `m_StyleName`, `m_FaceIndex`, `m_PointSize` (the sampling point size, px per em), `m_Scale`, `m_UnitsPerEM`, `m_LineHeight`, `m_AscentLine`, `m_CapLine`, `m_MeanLine`, `m_Baseline`, `m_DescentLine`, `m_SuperscriptOffset`, `m_SuperscriptSize`, `m_SubscriptOffset`, `m_SubscriptSize`, `m_UnderlineOffset`, `m_UnderlineThickness`, `m_StrikethroughOffset`, `m_StrikethroughThickness`, `m_TabWidth` (lengths in px at `m_PointSize`). |
| `atlasWidth`, `atlasHeight`, `atlasPadding`, `atlasRenderMode`, `atlasPopulationMode` | The atlas the glyph rects refer to: its size, the padding (texels of distance field around each glyph, `_GradientScale` = padding + 1), the `GlyphRenderMode` and the population mode (0 static, 1 dynamic). |
| `atlases` | The atlas page names (`atlasIndex` of a glyph indexes them). |
| `normalStyle`, `normalSpacingOffset`, `boldStyle`, `boldSpacing`, `italicStyle`, `tabSize` | TMP font asset style settings. |
| `material` | The asset's default material (a key of `materials`). |
| `fallbacks` | Names of the fallback font assets (keys of `fonts`), in search order: TextMeshPro's depth-first search over the fallback tables (each asset once), reduced to the assets in `fonts`. A character the asset lacks is taken from the first of them that has it ([Fallback font assets](#fallback-font-assets)). |
| `characters` | Code point (decimal string) → `{ glyph, scale, elementType }`: the glyph index (a key of `glyphs`). |
| `missingGlyph` | Optional: `{ unicode, characters }`: the code points of the episode's texts that the game's font asset lacks with its fallbacks (`characters`, ascending), which TextMeshPro draws as its missing glyph: the character `unicode`, `TMP_Settings.missingGlyphCharacter` (0: U+25A1) when the game's font asset or a fallback has it, else U+0020, else U+0003. The asset or one of its `fallbacks` holds `unicode`, except U+0003, a control character TextMeshPro synthesizes; none of them holds a code point of `characters`. A text with a sprite asset draws those of them its sprite asset has as sprites. A variation selector (U+FE00–U+FE0F, U+E0100–U+E01EF) right after a character of a font asset is not drawn (TextMeshPro replaces it by U+001A, which it skips); after a sprite or a tag it is a character like any other. |
| `glyphs` | Glyph index (decimal string) → `{ metrics, rect, scale, atlasIndex, packed, runtime }`: `metrics` (`m_Width`, `m_Height`, `m_HorizontalBearingX`, `m_HorizontalBearingY`, `m_HorizontalAdvance`, px at the point size), `rect` (`m_X`, `m_Y`, `m_Width`, `m_Height`, texels of the atlas, origin bottom left), `scale`, `atlasIndex` (page, or `null` for a glyph a dynamic asset adds at runtime), `packed` (`{ texture, dx, dy }`: the glyph page of `textures` holding the glyph's texels and the integer offset from `rect` to them; absent for an empty rect), `runtime` (optional, `true`: generated as a dynamic font asset adds it). |
| `glyphPairAdjustmentRecords`, `glyphPairAdjustments` | The number of glyph pair adjustment records of the asset and, when it is not 0, the lookup reduced to the exported glyphs: key (`first | second << 16`) → `{ first, second, flags }` with value records `{ xPlacement, yPlacement, xAdvance, yAdvance }`. |
| `runtimeCharacters`, `runtimeGlyphs` | Game data: the characters a dynamic asset generates at runtime and how (else `[]` and `null`). |
| `sourceFont` | Game data: the asset's source font file (`name`, `bytes`, `sha256`), or `null`. |
| `source` | Open data: the font file the glyphs were generated from: `family`, `style`, `version`, `license` (the font's license name or URL as the file states it), `file` (file name), `faceIndex`, `bytes`, `sha256`, and `generator` (how the glyphs were rasterized). |
| `subset` | Which characters the asset holds. |

Every font asset a binding names in `localized.fontAsset` holds U+005F `_` when its font has it: TextMeshPro's
underline and `<mark>` highlight draw with the `_` glyph of the text's own font asset (no fallback), sampled on the
asset's first page. Open data put it on page 0; game data keep the game asset's glyph and record in
`coverage.underline` (`font`, `character`, `inAsset`) whether the full game asset has it, so that a missing `_` is
told apart from a reduced glyph set.

### Fallback font assets

A text finds a character as `TMP_Text.GetTextElement` does: in its font asset, then in the asset's `fallbacks` in
order, then in its sprite asset; a character none has takes the missing glyph (`missingGlyph`), which is looked up the
same way. A character from a fallback asset is laid out with that asset's face info, glyph metrics and style
settings, and drawn from that asset's pages with the fallback material of the text's material:
`TMP_MaterialManager.GetFallbackMaterial` (TMP Settings' `matchMaterialPreset`), a material named
`<text material> + <fallback asset>` in `materials`, which holds the text material's shader, keywords and values
except `_MainTex`, `_GradientScale`, `_TextureWidth`, `_TextureHeight`, `_WeightNormal` and `_WeightBold`,
which are those of the fallback asset's default material, and `_ScaleRatioA` / `_ScaleRatioC`, which are
`ShaderUtilities.UpdateShaderRatios` of the result (float32). Every text material of a binding has one per fallback
of its font asset.

Open data mirror the game's chains. The open asset standing for a game font asset has as fallbacks the open assets
standing for the game asset's fallbacks: the one for a game asset is drawn from the font file of the language
`LocalizeManager` lists that asset for (the language of the document when it lists it, else the first in
LanguageMode order); the game's own fallback assets that no language lists have none. A fallback asset holds the
characters of the texts that the assets before it in the chain lack and its font file has, and U+005F only when a
text shows it there; an asset that would hold no character is left out.

A glyph's texels are the texels `rect` + (`dx`, `dy`) of its page (the same sampling as the full atlas: the page holds
each glyph with the texels a draw can sample around it). A material's `_TextureWidth` / `_TextureHeight` are those of
the atlas; a renderer that samples a page instead uses the page's size for the texel-space terms, as TextMeshPro does
for its atlas.

Open font assets (`source` `open`) hold the characters of the episode's text table, its title, the static labels of
the UI, the chat windows' status texts, the serialized texts of the chat windows' text nodes (shown until a row sets
them) and the texts the chat windows format at run time (battery percentages, member counts, read counts, the ellipsis
of a shortened name) and the texts the frames that receive texts get at run time (`AdvFrameCommand.SetFrameTexts`:
the texts of the Frame rows' `TargetTextIDs`, normalized to NFC, with `@` and line feeds). They keep TextMeshPro's
scale relations: each takes the point
size, padding and style settings of the game font asset the text uses in that language, its face info and glyph metrics come from the font
file at that point size, and its materials are the game's text materials of that language with the page as
`_MainTex`. A game asset of an anti-aliased distance-field render mode (`SDFAA`) gets a distance field of the same
spread, recorded as `SDF` in `atlasRenderMode` (the game render mode is in `source.generator`). A character the
language's font file lacks is taken from the fallback chain ([Fallback font assets](#fallback-font-assets)); one no
font file of the chain has is in `coverage.missing`. Line breaks can differ from the game where the font's advances
differ; the layout rules are the same.

### Sprite assets

A sprite asset is a TextMeshPro sprite asset (`TMP_SpriteAsset`) reduced to the sprites the episode's texts can draw:
TextMeshPro draws a character a text's font assets lack from the text's sprite asset when it has a sprite of that code
point, and a `<sprite name="...">` tag from the sprite of that name; the emoji search of the emoji texts
(`TMP_EmojiSearchEngine`) turns emoji sequences into such tags.

| Key | Meaning |
|---|---|
| `faceInfo` | TMP `m_FaceInfo` of the sprite asset. A point size of 0 (the game's emoji asset) scales a sprite by the face of the text's font asset: element scale = font scale × ascent line / glyph height × character scale × glyph scale. |
| `characters` | The sprite character table in its order: `{ index, unicode, name, glyph, scale }` (`index` = the position in the game asset's table; `glyph` a key of `glyphs`). By code point the first character of the table counts, by name the first whose name has the tag value's hash (`TMP_TextUtilities.GetHashCode`, case-insensitive). |
| `glyphs` | Glyph index → `{ metrics, rect, scale, atlasIndex, packed }` as for font assets; `rect` and `packed` locate the sprite's texels in its page (a sprite without an image has an empty `rect` and no `packed`: it keeps its place and draws nothing). |
| `sequences` | The entries of the asset's legacy sprite list whose name holds a `-` (`{ name, unicode }`, in order): the emoji search builds its sequence table from them (`TryUpdateSequenceLookupTable`). |
| `material` | The sprite material (a key of `materials`, shader `TextMeshPro/Sprite`, `_MainTex` the page). |
| `source` | Open data: the emoji font the images were drawn from (as for font assets), or `null` without one. |
| `subset` | Open data: which sprites the asset holds. |

A sprite quad's uvs are its glyph rect over its page size; its colour is white with the text's font colour alpha
(sprites are not tinted); the sprites of a text draw after its glyphs, as the sub mesh of the sprite material. Open
data draw each image from the emoji font at the game glyph's size (the bitmap centred in a square, resampled) into one
page with a transparent texel around each sprite; game data keep the game's sprite sheet.

## Language (`ui/languages.json`)

([schema](../schema/story-language.schema.json)) The settings of the group's language.

```json
{ "format": "ournotes.story-language/1", "language": "en", "mode": 1, "field": "english", "lineSpacing": -100,
  "fonts": "open", "roles": { "primary": { "fontAsset": "Noto Sans CJK JP Regular SDF", "lineHeightEm": 1.448,
                                            "ascentEm": 1.16, "descentEm": -0.288, "spacingOffset": 0,
                                            "boldSpacing": 7 } } }
```

| Key | Meaning |
|---|---|
| `format` | `"ournotes.story-language/1"`. |
| `language` | The language code. |
| `mode` | `Fwk.Localization.LanguageMode` (0 ja, 1 en, 2 zh-Hant, 3 zh-Hans, 4 ko). |
| `field` | The text field of the language in `episode.json` (`english`, …). |
| `lineSpacing` | The line spacing localized texts get in this language (`LocalizeManager`). |
| `fonts` | `open` or `game`, as the manifest. |
| `roles` | Font role → `fontAsset` (the asset of `ui/fonts.json` the role's texts use) and its line metrics in em (`lineHeightEm`, `ascentEm`, `descentEm`) with `spacingOffset` and `boldSpacing` (1/100 em). |

The typewriter timing is not language data: `_waitTalkTextUnitTime` and the other talk timings are in the player
settings.

## Media files

`frames.json`, `effects.json`, `posteffects.json`, `stills.json`, `talkwindows.json` and `chat.json` hold the episode's
frames, particle effects, post-effect volume profiles, stills, talk windows and chat assets, each keyed by the asset
name the rows name; their textures are in `textures/` and their shaders in `shaders/`. Their text components keep
their layout and style; their fonts are the story UI's (the chat windows' text records and bindings are in
`ui/ui.json` and `ui/fonts.json` `chatTexts`). `videos/videos.json` lists the videos (`VideoID` → file, size,
duration) with the WebM files (VP9 video, Opus audio) next to it. The player reads `frames.json` (Frame rows),
`effects.json` (Effect), `posteffects.json` (PostEffect), `stills.json` (Still), `chat.json` (the chat rows) and the
videos (Movie, Clip); `talkwindows.json` is not read yet (the story UI's default talk window is used).

An `Animator` component of these prefabs names its controller in `m_Controller` (`null`: none). A file holds each
controller and each clip in full once, where it first uses it: an `AnimatorController` record (`controller` its name,
`clips`, `layers`, `stateMachines` with the states, their motions as indices into `clips` and their transitions,
`parameters`, `defaultValues`) whose clips are [Mecanim clips](data-format.md#note-assets-livenotesnotesjson) (`clip`
their name). Every later use in the same file, in the same prefab or another one, is a reference by name:
`{"controller": <name>}` for a controller, `{"clip": <name>}` for a clip in a controller's `clips`. A reference
resolves to the full record of that name in the same file; when the file holds two different full records under one
name, a reference to that name is ambiguous and the player refuses it. Of two frames that share a controller, only
the first one in the file carries it in full.

Particle systems (in `effects.json`, `frames.json`, `stills.json` and the stage prefabs of `scene.json`) keep the module
structure of the live's particle systems ([Note assets](data-format.md#note-assets-livenotesnotesjson)), with two
references of their own:

- A Sub Emitters entry (`SubModule.subEmitters[].emitter`) names its system as
  `{"component": "ParticleSystem", "gameObject": <node path>}`, a node of the same prefab; the host resolves it once
  every system of the prefab exists (`linkSubEmitters`).
- A Mesh shape (`ShapeModule.type` 6) carries its mesh in `ShapeModule.m_Mesh` as `{vertices, normals, uv0, submeshes}`:
  vertex positions, normals and the first UV set as arrays of vectors, and one triangle index list per submesh.

## Documents and identities

`stories.json`, the manifests, `ui/fonts.json` and `ui/languages.json` are written as canonical JSON: UTF-8, LF, one
trailing newline, keys sorted, indent 1, non-ASCII characters as they are, `1e999` / `-1e999` for infinity. Asset
names are SHA-256 content ids. The documents hold no timestamps and no absolute paths: the same inputs give the same
bytes. `format` strings name the document and its version (`ournotes.<document>/<version>`); a reader refuses a
version it does not know.

## Validation

```
node scripts/validate-data.mjs <site dir> [chart id | model id | story id ...]
```

Besides the charts and models, validates `stories.json` and every story (or the given story ids; a story id is the
`advId`, or `<region>/<advId>` for a region's own manifest). Per story:

- the manifest (schema, the language group rules above, agreement with `stories.json`: facts, sizes, `regions`;
  with format `/2`, `root` as the manifest's place in the site gives it and no file under `live2d/`);
- every asset of `files` and of every language group, as for charts (present, an encoded asset's stored length and
  decoding, byte size, SHA-256 of the decoded bytes equal to its name, extension matching the logical file, split JSON
  rebuilt to its `size`, JSON parses);
- `story.json` and `episode.json` (schemas; every path `story.json` names is in the common files; every cue sheet the
  episode's cue sheet table names has its `cues.json` when `audio` is true, and every file a `cues.json` names is
  present with the manifest's `audioFormat`, FLAC `STREAMINFO` or MP4 header agreeing with the cue; without audio no
  cue sheet and no waveform file); `story.json` `crilips`, when set, only with audio, both files common, the
  descriptor float32 little-endian with every block inside `crilips.bin`;
- the models. Format `/2`: `models` keys sorted, each path `models/<id>.json`, the same ids as `story.json` `models`
  (which names them by id), each Character row's model among them, each model manifest present (in `models.json` when
  the site has one) and valid as a model ([Validation](data-format.md#validation)), and its shaders holding the
  variants the story renderer draws with at every quality (each keyword set, and with `_ADDITIONAL_LIGHTS_VERTEX`; the
  mask shader's without keywords). Format `/1`: `story.json` `models` in the `{ dir, moc3, prefab }` form, each
  model's moc3 header, its prefab as the model viewer reads it, its atlas pages, and a `shaders/` variant for every
  drawable material;
- `requires.commands` equal to the facts' `commands` and to the command names of the episode's rows without
  `IgnoreData` together with the player settings' initialize and finalize rows; `requires.motionSync` as the
  episode's rows give it;
- `host` present exactly for an Overlay episode with open fonts; `host/host.json` a common file of format
  `ournotes.story-host/1` with the manifest's `kind`, its `ui` document a common file;
- in each media file, every controller and clip reference resolves to a full record of its name in the file, and no
  two different full records share that name ([Media files](#media-files));
- per language: `ui/ui.json` (node order), `ui/languages.json` and `ui/fonts.json` (schemas; `language` equal to the
  group's, `mode` and `field` those of the language; every text node of that language's `ui/ui.json` has a binding
  whose `localized` font asset and material exist, and every binding is a text node; with open fonts the same for
  the text nodes of `dialogs` (`dialogTexts`), the texts of `chatTexts` and the text nodes of the frames of
  `frames.json` (`frameTexts`), with game fonts none of them; fallbacks, material keys, `characters` → `glyphs`
  references, glyph pages named by `packed` present in the group with their described size; every glyph's `rect` +
  offset inside its page; `fallbacks` without the asset itself and without repeats, and the fallback material of
  every binding's text material per fallback of its font asset, with the values `GetFallbackMaterial` gives; a font
  asset's `missingGlyph` as described above (with `tmpSettings`, also which character
  `unicode` is) and `coverage.missingGlyph` equal to the characters of all of them; with `spriteAssets`:
  `emojiSpriteAsset` one of them, each sprite asset's material of shader `TextMeshPro/Sprite`, its characters in index
  order with their glyphs, its glyph pages as for font assets, `coverage.sprites` (the characters held, the missing
  names those of sprites without an image), and the sprite asset of every binding that has one equal to
  `emojiSpriteAsset`, with `m_tintAllSprites`; without `spriteAssets` no binding has one); with a `host`,
  `ui/simple/ui.json` and `ui/simple/fonts.json` checked the same way;
- the shader directories `shaders/` and `ui/shaders/` (index, parsed files, GLSL ES 3.00 blocks), that `ui/shaders/`
  has a variant for every UI and text material's `materialKeywords`, and that every PNG a texture descriptor of the
  scene, the media files or the UI names has the described size.
