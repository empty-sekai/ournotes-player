# Story data format

The story player plays one story episode (a scripted scene with Live2D characters, stages, talk text, voices and
music) from a set of **logical files** that the embedding page supplies, usually as a static **site** served over
HTTP, the same kind of site that serves charts and Live2D models ([data-format.md](data-format.md)). This document
describes the story part of that data: the site layout, the story index, the story manifest with its per-language file
groups, and every logical file as far as the player reads it. Producing the data is outside this repository; the
[nnnotes](https://github.com/MetaSekaiLab/nnnotes) toolkit produces it from game files the user supplies
(`nnnotes web SITE --story <id>` / `--all-stories`).

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
  story/                           the story page and the story bundle, when the site was built with them
  assets/<sha256>.<ext>            file contents, content-addressed, shared with the charts and models
```

- Assets follow the rules of the chart site ([Site layout](data-format.md#site-layout)): `<sha256>` is the lowercase
  hex SHA-256 of the bytes, `<ext>` the extension of the logical file, identical contents are stored once. Stories
  share the models, shaders, stage textures, cue sheets, UI textures and glyph pages they have in common.
- Asset paths in a manifest are relative to the site root. A player that loads a manifest by URL resolves them
  against the directory above the manifest's directory (`stories/..`), as for charts.
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
                 "size": { "common": 30154311, "languages": { "ja": 410233, "…": 0 } }, "regions": ["tw"] } ] }
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
| `size` | object | `common`: the sum of `size` over the manifest's `files`; `languages`: per language, the sum over that language group's `files` (download sizes before shared assets are deduplicated). |
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
([schema](../schema/story-manifest.schema.json)), lists the logical files of one story and where their bytes are.

```json
{
  "format": "ournotes.story-manifest/1",
  "advId": 10462,
  "story": { "advId": 10462, "titles": { "…": "…" }, "commands": ["…"], "…": "…" },
  "language": "en",
  "audio": true,
  "audioFormat": "aac",
  "fonts": "open",
  "requires": { "commands": ["Bgm", "Character", "…"], "cubismCore": true, "motionSync": true },
  "files": {
    "story.json": { "asset": "assets/2f0c…91aa.json", "size": 1155 },
    "scene.json": { "parts": [["player", "assets/b1d2…77e0.json", 36212], "…"], "size": 171904 },
    "…": "…"
  },
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
| `format` | `"ournotes.story-manifest/1"` | yes | Version of this document; the player refuses other values. |
| `advId` | integer | no | The episode id. |
| `story` | object | no | The [story facts](#story-facts), handed to the page as they are. |
| `regions` | string[] | no | Optional. The regions this manifest serves. |
| `language` | string | yes | The default language: the language the player loads when the page names none. One of the keys of `languages`. |
| `audio` | boolean | yes | `false`: the story has no sound files (`story.json` `audio` is empty); the player plays it without its sounds (videos keep their own sound track). |
| `audioFormat` | `"aac"` \| `"flac"` \| `null` | no | Format of every waveform file: AAC-LC in an MP4 container (`.m4a`) or FLAC; `null` without audio. |
| `fonts` | `"open"` \| `"game"` | no | Where the glyphs of the [font assets](#fonts-uifontsjson) come from: font files of the producer's choice (`open`) or the game's own font assets (`game`). The format is the same; the player does not distinguish them. |
| `requires` | object | yes | What the player needs to play the story: `commands` (equal to the facts' `commands`; a player that lacks one of them refuses the story before loading its files, naming them), `cubismCore` (`true`: the page must provide Live2D Cubism Core), `motionSync` (`true`: a Talk row maps a voice onto a character's lip sync, which needs Live2D's MotionSync Core with voices on). |
| `files` | object | yes | The common files: logical path → [file entry](data-format.md#file-entries). |
| `host` | object | no | Optional. An Overlay episode (`playbackMode` 1) with open fonts: the screen the game plays it over and the simple talk window ([story-simple.md](story-simple.md)): `kind` (`home`: a home spot talk; `afterlive`: the reward phase of a live result), `doc` (`host/host.json`), `ui` (`ui/simple/ui.json`). The player finds these files by path. Absent for a Normal episode and for an Overlay episode with game fonts, which then has no host data and no simple talk window (the simple player refuses it). |
| `languages` | object | yes | Language → `{ files }`: the files of that language (below). At least one language. |

File entries are exactly those of a chart manifest ([File entries](data-format.md#file-entries)): whole files
`{ asset, size }` and split JSON objects `{ parts, size }`, with the same rules (paths relative with `/`, `.json` and
`.glsl` are UTF-8 text, every size checked). The producer stores `scene.json` and `ui/ui.json` split per top-level key
whatever their size, so the parts that stories and languages share are stored once; other JSON files are split as in
the chart sites (above 512 KiB).

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

A player plays a story from one language at a time: the union of `files` and `languages[<language>].files`. The
logical paths are the same in every language, so the reader code does not change with the language. Loading with the
chart loader works on that union: `AssetStore.fromManifest` reads the `files` of the manifest it fetches, so a story
loader passes it the manifest with `files` replaced by the union (for example through its `fetch` option), or fetches
the entries itself; the entry forms and checks are the same. A language switch loads the other language's group and
keeps the common files.

Every listed file is fetched before the story starts. A manifest lists the files the player's data (this document)
names: shader directories keep only the GLES3 programs (GLSL ES 3.00) of the shaders they list; SPIR-V containers,
GLSL ES 3.10 programs and the `streams.json` of the sound directories are left out.

## Logical files

| Logical file | Content | Group |
|---|---|---|
| `story.json` | Index: the paths of the files below. | common |
| `episode.json` | The episode: command rows, texts, sounds, cue sheets, videos, master data row, title. | common |
| `scene.json` | Player graphics, cameras, ADV fields, volumes, player settings, stages. | common |
| `shaders/shaders.json`, `shaders/…` | Shaders of the scene, the stages, the models and the media files ([Shaders](data-format.md#shaders)). | common |
| `textures/*.png` | Textures of the scene and the media files ([Textures](data-format.md#textures)); paths relative to the story root. | common |
| `live2d/<model>/…` | The Live2D models ([Live2D models](#live2d-models)). | common |
| `audio/<sheet>/cues.json`, `audio/<sheet>/<cue>.m4a` or `.flac` | Sounds per cue sheet ([Sounds](#sounds)). | common |
| `ui/ui.json` | The story UI: front canvas nodes, sprites, materials, clips, controllers, transitions, text records ([Story UI](#story-ui-uiuijson)). | language (common when equal) |
| `ui/textures/*.png`, `ui/shaders/…` | Packed UI textures and the UI shaders, including the TextMeshPro distance-field shader. | common |
| `ui/fonts.json`, `ui/fonts/*.png` | TextMeshPro font assets, text materials and text bindings of the language ([Fonts](#fonts-uifontsjson)). | language |
| `ui/languages.json` | The language settings ([Language](#language-uilanguagesjson)). | language |
| `frames.json`, `effects.json`, `posteffects.json`, `stills.json`, `talkwindows.json`, `chat.json` | Media of the episode, each only when the episode uses it ([Media files](#media-files)). | common |
| `videos/videos.json`, `videos/*.webm` | Movie and Clip videos (VP9 + Opus in WebM). | common |
| `host/host.json`, `host/ui/ui.json`, `host/spot/…`, `host/shaders/…` | With a `host`: the host screen (`ournotes.story-host/1`, [story-simple.md](story-simple.md#data)); the home spot's files under `host/spot/`. | common |
| `ui/simple/ui.json`, `ui/simple/fonts.json`, `ui/simple/fonts/*.png`, `ui/simple/shaders/…` | With a `host`: the simple talk window in the story UI record format, its fonts and glyph pages in the format of `ui/fonts.json` and its text shader (paths relative to `ui/simple/`). | language (`ui.json` and the shaders common when equal) |

The directory names are fixed: `ui/fonts.json` and `ui/languages.json` are found by path, the UI's texture and
shader paths are relative to `ui/`, a model's paths to its directory, the scene's and the media files' texture paths
to the story root.

## story.json

([schema](../schema/story.schema.json)) The index of the story directory.

```json
{ "advId": 10462, "episode": "episode.json", "scene": "scene.json", "ui": "ui/ui.json",
  "models": { "Character/Live2D/001_adv/…/model/…": { "dir": "live2d/…", "moc3": "….moc3", "prefab": "….prefab.json" } },
  "audio": { "sound_bgm_adv_…": "audio/sound_bgm_adv_…" },
  "frames": null, "effects": null, "postEffects": null, "stills": null, "talkWindows": null, "chat": null,
  "videos": null }
```

| Key | Meaning |
|---|---|
| `advId` | The episode id. |
| `episode`, `scene`, `ui` | Paths of [episode.json](#episodejson), [scene.json](#scenejson) and [ui/ui.json](#story-ui-uiuijson). |
| `models` | Model key (the address the episode's Character rows name, `Character/Live2D/<group>/<name>/model/<name>`) → `dir` (the model directory), `moc3` and `prefab` (file names in it). |
| `audio` | Cue sheet name → its directory. Empty when the manifest's `audio` is `false`. |
| `frames`, `effects`, `postEffects`, `stills`, `talkWindows`, `chat` | Path of the media file of that kind, `null` when the episode does not use it. |
| `videos` | `videos/videos.json`, or `null` when the episode has no video. |

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
| `resources` | `cubismMask`, `cubismMaskCulling`: the Cubism mask materials (as in [model.json](data-format.md#modeljson)). |
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

`live2d/<model>/`: per model the moc3, the prefab (`<name>.prefab.json`) and the atlas pages under `textures/`, in the
form of a model site's files ([The model prefab](data-format.md#the-model-prefab); texture paths relative to the
model directory, atlas pages may be mipmapped). The shaders the drawables use are in the story's `shaders/`. The same
model in two stories is stored once.

## Story UI (`ui/ui.json`)

The parts of the game's ADV widget (`UIAdvWidget`) the story draws: the front canvas (talk window, speaker plate,
episode title, location caption, rule transition cover, curtains, flash, subtitles caption, next indicator, menu
entry button, menu panel and video buttons, backlog, choices, the next and cancel-full-screen tap areas), the screen
canvases of videos, stills and frames with the screen image of the video-and-still camera, and the letterbox bands;
the phone of the chat rows (`UIAdvChatWidget`) and the text records of the episode's chat windows; the dialogs of the
ADV screen. Keys read:

| Key | Content |
|---|---|
| `nodes` | The RectTransform hierarchy (node order: every parent before its children): `path`, `name`, `active`, `localPosition`, `localRotation`, `localScale`, `rect`, and the uGUI parts the story draws: `canvas`, `canvasScaler`, `canvasGroup`, `image`, `rawImage`, `gradient`, `layoutGroup`, `contentSizeFitter`, `layoutElement`, `safeAreaEdgeAnchor`, `animator`, `tweenSequence`, `animationTrigger`, `talkWindow`, `buttonImageState`, `outline`, `ruleTransition`, `localizeText`, the view records and `behaviours` (below); a text node has `textStyle` (below). A node whose parent is not listed is a child of the widget root. |
| `frontCanvasOrder` | Sibling order of the front canvas' children. |
| `widget` | `canvasSortOrder` (`UIWidget._canvasSortOrder`) and `canvases`: the widget's canvases in `UIWidget._canvases` order, each `{ path, sortingOrder }` (the canvas' `m_SortingOrder`; `UIWidget.TrueCanvasSortOrder` is the first one's, 99999 without canvases). The paths may name canvases that are not in `nodes`. |
| `videoAndStillCamera` | The camera the video and still canvases render with (`UIAdvWidget._videoAndStillCamera`): `path` (its node, not in `nodes`), `active`, `camera` (`m_ClearFlags`, `m_BackGroundColor`, `m_NormalizedViewPortRect`, `near clip plane`, `far clip plane`, `field of view`, `orthographic`, `orthographic size`, `m_Depth`, `m_CullingMask`, `m_HDR`, `m_AllowMSAA`) and `additionalCameraData` (URP: `m_RenderPostProcessing`, `m_VolumeLayerMask`, `m_RendererIndex`, antialiasing, shadow and texture options, `m_CameraType`, `m_VolumeFrameworkUpdateModeOption`, `m_Dithering`, `m_StopNaN`). |
| `videoAndStillScreenImage` | The node of the raw image that shows that camera's output (`UIAdvWidget._videoAndStillScreenImage`). |
| `masterIdTexts` | The `AdvMasterIdSettings` texts of the dialogs in the language: `_skipVideoMessageTextId`, `_skipButtonTextId`, `_cancelButtonTextId` (the video skip dialog), `_skipMessageTextId`, `_continuousSkipMessageTextId`, `_backEpisodeListButtonTextId`, `_continueEpisodeButtonTextId` (the skip confirm dialog), `_interruptionTitleTextId`, `_interruptionMessageTextId`, `_interruptionButtonTextId` (the interruption dialog) → `{ id, text }` (the `MasterText` id and its text). |
| `dialogs` | Dialog name → `{ key, nodes }`: the prefab of the dialog (`UIAdvSkipConfirmDialogWidget`, the skip confirm dialog; `UICommonDialogWidget`, the dialog `CommonDialogManager` opens) and its nodes as node records (paths start with the dialog name); text nodes have `textStyle`. |
| `chatWidget` | `{ nodes }`: the phone the chat windows attach to (`UIAdvChatWidget`), as node records: `ChatCanvas` (`canvas`, `canvasScaler`), `ChatCanvas/AdvChatView` (rect and the `chatView` record) and its `Target` (rect, `canvasGroup`). Paths start with `UIAdvChatWidget/`. |
| `chatTexts` | Optional, an episode with chat windows: window name (the prefab after `Adv/Chat/Prefabs/`, as `chat.json` `windows`) → text node path (as in that window's node list) → `{ textStyle, localizeText }`: the text record of each TextMeshPro text of the window in the language (below; a localized text with the font and material `LocalizeText` gives it, its `fontRole` the slot of the Japanese lookup table, `font2` and up for the additional fonts) and the node's `LocalizeText` flags (`null` without one). |
| `chatStatusTexts` | Optional, with chat windows and the master data: `MasterText` id → its text in the language, for the incoming call and lock screen status keys of the windows (`AdvChatWindow._incomingCallStatusTextKey`, `_lockScreenStatusTextKey`). |
| `emoji` | The emoji sprite asset the emoji texts use (their `m_spriteAsset`, else `LocalizeManager.EmojiSpriteAsset`): `spriteAsset` (its name), `address`, `sequences` (`TMP_EmojiSearchEngine`'s lookup table: the text of a multi-code-point emoji → its sprite name) and `characters` (the code points of its sprite characters). The sprites themselves are not exported; a player that does not draw them can refuse texts that contain them. |
| `sprites`, `letterBoxSprite` | Sprite name → sprite descriptor on a packed texture; the letterbox band sprite's name. |
| `textures` | Packed texture name → texture descriptor (paths relative to `ui/`). |
| `materials`, `materialKeywords` | The UI materials (the rule transition's, `Default UI Material`, the materials the drawn images name, such as the video mask's) and the GLES3 keyword set of each. |
| `clips`, `controllers` | Animation clips and animator controllers of the indicators, title and location animations. |
| `transitions` | Transition address → `RuleTransitionSettings` with its rule texture. |
| `playerSettings` | `_defaultTransitionAssetAddress`, `_waitAfterVoiceTime`, `_waitTalkTextUnitTime`, `_minTalkDisplayTime`, `_isAdvViewportFollowOnResolutionChanged`. |
| `dotween` | The game's DOTween defaults. |
| `shaders` | `{ index: "shaders/shaders.json", names }`: the UI shader directory, relative to `ui/`. |
| `language` | `mode` (`LanguageMode`), `field` (the text field), `lineSpacing` (the line spacing localized texts get). |
| `textStyle` | `language`, `units`, `roles`: the line metrics per font role of the game's fonts (informative; the layout uses the font assets of `ui/fonts.json`). |

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
assets (`game`).

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
| `coverage` | object | `characters` (distinct characters shown), `missing` (characters no font asset of the chain has, as strings; drawn as TextMeshPro draws a missing character), and producer details. |
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
Korean, 1 clears and 2 sets the bold style of `m_fontStyle`; `m_Enabled`).

### Font assets

A font asset is a TextMeshPro font asset reduced to the characters the episode shows:

| Key | Meaning |
|---|---|
| `faceInfo` | TMP `m_FaceInfo`: `m_FamilyName`, `m_StyleName`, `m_FaceIndex`, `m_PointSize` (the sampling point size, px per em), `m_Scale`, `m_UnitsPerEM`, `m_LineHeight`, `m_AscentLine`, `m_CapLine`, `m_MeanLine`, `m_Baseline`, `m_DescentLine`, `m_SuperscriptOffset`, `m_SuperscriptSize`, `m_SubscriptOffset`, `m_SubscriptSize`, `m_UnderlineOffset`, `m_UnderlineThickness`, `m_StrikethroughOffset`, `m_StrikethroughThickness`, `m_TabWidth` (lengths in px at `m_PointSize`). |
| `atlasWidth`, `atlasHeight`, `atlasPadding`, `atlasRenderMode`, `atlasPopulationMode` | The atlas the glyph rects refer to: its size, the padding (texels of distance field around each glyph, `_GradientScale` = padding + 1), the `GlyphRenderMode` and the population mode (0 static, 1 dynamic). |
| `atlases` | The atlas page names (`atlasIndex` of a glyph indexes them). |
| `normalStyle`, `normalSpacingOffset`, `boldStyle`, `boldSpacing`, `italicStyle`, `tabSize` | TMP font asset style settings. |
| `material` | The asset's default material (a key of `materials`). |
| `fallbacks` | Names of the fallback font assets (keys of `fonts`), in search order. |
| `characters` | Code point (decimal string) → `{ glyph, scale, elementType }`: the glyph index (a key of `glyphs`). |
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

A glyph's texels are the texels `rect` + (`dx`, `dy`) of its page (the same sampling as the full atlas: the page holds
each glyph with the texels a draw can sample around it). A material's `_TextureWidth` / `_TextureHeight` are those of
the atlas; a renderer that samples a page instead uses the page's size for the texel-space terms, as TextMeshPro does
for its atlas.

Open font assets (`source` `open`) hold the characters of the episode's text table, its title, the static labels of
the UI, the chat windows' status texts and the texts the chat windows format at run time (battery percentages, member
counts, read counts, the ellipsis of a shortened name). They keep TextMeshPro's scale relations: each takes the point
size, padding and style settings of the game font asset the text uses in that language, its face info and glyph metrics come from the font
file at that point size, and its materials are the game's text materials of that language with the page as
`_MainTex`. A game asset of an anti-aliased distance-field render mode (`SDFAA`) gets a distance field of the same
spread, recorded as `SDF` in `atlasRenderMode` (the game render mode is in `source.generator`). Line breaks can differ from the game where the font's advances differ; the layout rules are the same.

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

- the manifest (schema, the language group rules above, agreement with `stories.json`: facts, sizes, `regions`);
- every asset of `files` and of every language group, as for charts (present, byte size, SHA-256 equal to its name,
  extension matching the logical file, split JSON rebuilt to its `size`, JSON parses);
- `story.json` and `episode.json` (schemas; every path `story.json` names is in the common files; the models' moc3
  header, their prefabs as the model viewer reads them, their atlas pages, and a `shaders/` variant for every
  drawable material; every cue sheet the episode's cue sheet table names has its `cues.json` when `audio` is true, and
  every file a `cues.json` names is present with the manifest's `audioFormat`, FLAC `STREAMINFO` or MP4 header
  agreeing with the cue; without audio no cue sheet and no waveform file);
- `requires.commands` equal to the facts' `commands` and to the command names of the episode's rows without
  `IgnoreData` together with the player settings' initialize and finalize rows; `requires.motionSync` as the
  episode's rows give it;
- `host` present exactly for an Overlay episode with open fonts; `host/host.json` a common file of format
  `ournotes.story-host/1` with the manifest's `kind`, its `ui` document a common file;
- per language: `ui/ui.json` (node order), `ui/languages.json` and `ui/fonts.json` (schemas; `language` equal to the
  group's, `mode` and `field` those of the language; every text node of that language's `ui/ui.json` has a binding
  whose `localized` font asset and material exist, and every binding is a text node; with open fonts the same for
  the text nodes of `dialogs` (`dialogTexts`) and the texts of `chatTexts`, with game fonts neither; fallbacks, material keys, `characters` →
  `glyphs` references, glyph pages named by `packed` present in the group with their described size; every glyph's
  `rect` + offset inside its page); with a `host`, `ui/simple/ui.json` and `ui/simple/fonts.json` checked the same
  way;
- the shader directories `shaders/` and `ui/shaders/` (index, parsed files, GLSL ES 3.00 blocks), that `ui/shaders/`
  has a variant for every UI and text material's `materialKeywords`, and that every PNG a texture descriptor of the
  scene, the media files or the UI names has the described size.
