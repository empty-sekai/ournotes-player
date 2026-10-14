# Story author (experimental)

`scripts/story-author.mjs` makes dialogue stories from the assets of a story site: an author writes a JSON script that
names a base story (its backgrounds, music, talk window and player settings), Live2D models of the site and the beats
of the story; the tool checks the script, draws it with the story player into PNG pictures, and builds it into the
site as a story the player plays. It is made for programs and agents: every command prints one JSON object on
stdout, progress goes to stderr, and the pictures are files whose paths the JSON names.

The tool is experimental: the script format and the commands may change between versions.

## Requirements

- Node.js 22 or later.
- A story site with stories in the model manifest format (`ournotes.story-manifest/2`) and its `models.json`
  ([story-data-format.md](story-data-format.md)). Pass it with `--site <dir>` or set `OURNOTES_SITE`.
- For pictures (`render`, `base --out`, `model --out`): Chrome, Chromium or Edge. The tool starts a headless browser
  of its own with a temporary profile and ends it when the command ends. It draws with SwiftShader (WebGL2 on the
  CPU), so the pictures are the same on machines with and without a GPU; `--gpu` uses the GPU instead. `--chrome
  <path>` or `CHROME_PATH` names the browser.
- Live2D Cubism Core, which this package does not include: by default the page loads Live2D's distribution
  (network access); `--core <file or URL>` names another copy.

## The loop

```sh
S=--site=path/to/site
node scripts/story-author.mjs bases $S                             # 1. stories to take the scene from
node scripts/story-author.mjs base stories/10002.json $S --out shots   # 2. its stages (stages.png), music, characters
node scripts/story-author.mjs models $S --search soyo              # 3. models
node scripts/story-author.mjs model <model id> $S --out shots      #    a model's motions and expressions, with pictures
node scripts/story-author.mjs new stories/10002.json $S > story.json   # 4. a starter script
#    edit story.json
node scripts/story-author.mjs check story.json $S                  # 5. errors and warnings with JSON pointers
node scripts/story-author.mjs render story.json $S --out shots     # 6. one picture per line, and a contact sheet
#    look at shots/sheet.png (and shots/line-*.png), fix, repeat 5-6
#    (--fix <file> on check and render writes the script with the fixes the tool knows applied)
node scripts/story-author.mjs build story.json $S --name my-story  # 7. into the site
node scripts/story-author.mjs serve $S                             # 8. URLs to watch it in examples/story
```

Look at the pictures after each render: the contact sheet shows every line with its speaker and text, and each
`line-<n>.png` is the whole frame at the size given by `--width`. `--from` and `--to` render a part of a long story.

## Commands

All commands take `--site <dir>`. The commands that draw pictures take `--chrome`, `--gpu` and `--core` (see
[Requirements](#requirements)) and give up a picture job that has not finished after `--timeout <s>` seconds (default
600). Exit status: 0 done, 1 the script has errors or the job failed (the JSON has `"ok": false` and the errors, or
`error`), 2 a usage error (message on stderr).

### bases

`bases [--search <text>] [--limit <n>] [--lang <language>]`: the stories of `stories.json` a script can take its scene
from (Normal episodes; home spot talks and live result talks cannot be bases).

```json
{ "count": 1, "bases": [{ "manifest": "stories/10002.json", "title": "…", "languages": ["zh-Hans"], "groups": ["…"] }] }
```

### base

`base <manifest> [--lang <language>] [--out <dir>]`: what a script can use from that base story.

```json
{
  "manifest": "stories/10002.json", "language": "zh-Hans", "languages": ["zh-Hans"],
  "stages": [{ "id": "adv_bkg_stage_000139", "caption": "…" }, "…"],
  "music": [{ "cue": "sound_bgm_adv_…", "label": "…" }],
  "cast": ["adv_live2d_…", "…"],
  "fonts": ["sans", "serif", "rounded"],
  "sheets": ["shots/stages.png"]
}
```

- `stages[].id` is what a scene's `scene` names: the last segment of the stage key (the whole key where two stages
  end alike). `caption` is the location caption the base story shows on that stage, empty when it has none.
- `music[].cue` is what a scene's `music` names. A base story without sound files has none.
- `cast`: the models the base story itself uses (any model of `models.json` can be cast).
- With `--out`: `stages.png`, the background picture of each stage with its id and caption.

### models

`models [--search <text>]`: the models of `models.json`, with their character names where the site has them.

### model

`model <id> [--out <dir>]`: a model's motions (by stem, with the sides it has: `L` left, `C` centre, `R` right) and
expressions. With `--out`: `<id>-expressions.png` (the face with each expression) and `<id>-motions.png` (the
model 0.8 s into each motion, its centre variant).

```json
{ "id": "adv_live2d_…", "motions": [{ "stem": "mtn_smile01", "sides": "LCR" }, "…"],
  "expressions": ["exp_idle01", "exp_smile01", "…"], "defaultMotion": "mtn_idle01_C", "defaultExpression": "exp_idle01",
  "sheets": ["shots/adv_live2d_…-expressions.png", "shots/adv_live2d_…-motions.png"] }
```

### new

`new <manifest> [--lang <language>]`: prints a starter script on that base story (two of its characters, its first
stage, three lines). Redirect it to a file and edit it.

### check

`check <script> [--fix <file>]`: the script's errors and warnings. A script without errors also reports its number of
lines and scenes and the CSS font family its text is drawn with.

```json
{
  "ok": false, "language": "zh-Hans",
  "errors": [{ "path": "/beats/2/motion", "code": "unknownMotion",
               "message": "motion \"mtn_nodd01\" does not exist in adv_live2d_…; did you mean \"mtn_nod01\"?",
               "expected": ["mtn_angry01", "…"], "suggestion": "mtn_nod01",
               "fix": [{ "op": "replace", "path": "/beats/2/motion", "value": "mtn_nod01" }] }],
  "warnings": [{ "path": "/beats/0/say", "code": "speakerOffStage", "message": "tomori speaks from off stage" }]
}
```

Every problem has `path`, a JSON pointer to the value in the script, `code` and `message`. A name that does not exist
comes with `expected` (the names that do, or `expectedCount` when there are more than 40) and, when one is close,
`suggestion`.

### Fixes

A problem whose fix is known has `fix`: [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) operations on the script
document (`replace`, `add`, and `move` within one object to rename a key, which keeps the key's place). The fixes:

| Code | Fix |
|---|---|
| `unknownKey` | The key renamed to the nearest key of the format, when the object does not have that key already. |
| `unknownLanguage`, `unknownFont`, `unknownPosition`, `unknownCamera`, `unknownModel`, `unknownStage`, `unknownMusic`, `unknownMotion`, `unknownExpression` | The nearest name (`suggestion`) written in. |
| `unknownCast` | The nearest cast id written in; in `positions`, the key renamed, when the beat does not place that cast member already. |
| `duplicateId` | The id with the first free `_<n>` after it (`promise_2`). |
| `positionTaken` | The free position nearest the taken one (`suggestion`), the left one of two as near. |
| `textTooWide`, `textTooTall` | `render`: the text broken where the game's text engine wraps it in the talk window, and, where the window holds fewer lines, spread over beats after it (the same speaker, or narration), as evenly as fits. `suggestion` holds the texts. A line with both warnings has the fix on the first. |

`--fix <file>` on `check` and `render` writes the script with every fix applied to `<file>` (it may be the script
itself; the fixes of later beats go in first, so the beats a fix adds do not move the others) and checks it again:

```json
"fixed": { "file": "story.fixed.json", "applied": [{ "path": "/beats/2/motion", "code": "unknownMotion" }],
           "failed": [], "ok": true, "errors": 0, "warnings": 1 }
```

`applied` and `failed` (with `message`) list the problems whose fixes went in or could not; `ok`, `errors` and
`warnings` are how the written script checks (`render` does not render it again). A problem without `fix` needs the
author: it has no near name, or its fix is a choice of story (who stands where, who speaks).

### render

`render <script> --out <dir> [--from <line>] [--to <line>] [--width <px>] [--settle <frames>] [--columns <n>]
[--fix <file>]`: plays the script in the story player (manual advance, no sound) and saves a picture of each line from
`--from` to `--to` (line numbers from 0; default every line) once its text is fully shown and `--settle` more frames
have passed (default 8, at 30 frames per second): `line-<n>.png` at `--width` × width × 6 / 13 pixels (default 1300 ×
600), and `sheet.png` (`sheet-<n>.png` for more than 12 lines) with every line, its speaker and its text. Earlier
pictures of a render in `--out` are replaced. A start line after 0 is reached the way the game's shortcut reaches it:
the rows before it run without being shown.

```json
{
  "ok": true, "out": "shots", "sheets": ["shots/sheet.png"],
  "frames": [{ "line": 0, "path": "/beats/1", "speaker": "soyo", "text": "…", "image": "shots/line-000.png",
               "talk": { "lines": 1, "fontSize": 36, "width": 431.2, "widthLimit": 1200, "height": 41.6,
                         "heightLimit": 200, "overflow": false },
               "timing": { "characters": 11, "typing": 1.1, "autoHold": 1.6 } }],
  "warnings": [{ "path": "/beats/7", "code": "textTooWide", "message": "line 4 runs past the talk window …",
                 "suggestion": ["……", "……"], "fix": [{ "op": "replace", "path": "/beats/7/text", "value": "……" }] }],
  "seconds": 7.7
}
```

`talk` is the layout of the line's text in the talk window, in the window's units: the number of text lines, the
point size, the widest line and the height of the text against the room the window has. The talk window does not
wrap text: a line wider than the window runs past its edge (warning `textTooWide`; break it with `\n`), and more text
lines than fit run below it (`textTooTall`; split it into two lines of the script). Both come with a fix (see
[Fixes](#fixes)) when breaking the text at the game's word wrap makes it fit.

`timing` is the line's pacing in seconds of story time: `characters`, the characters the typewriter types; `typing`,
from the line's start until its text is fully shown (the game's ADV frame rate, 30 frames per second); `autoHold`, how
long auto mode then keeps the line before the next one (`_waitTalkTextUnitTime` per character, at least
`_minTalkDisplayTime`, from the base story's player settings). A line takes `typing` + `autoHold` in auto mode.

### build

`build <script> --name <name>`: writes the story into the site as `custom-stories/<name>.json`, a story manifest of
format `ournotes.story-manifest/2` (advId 0, the script's language only), and adds its own files to `assets/`: the
compiled `story.json`, `episode.json` and `ui/fonts.json`. Every other file is the base story's or a model's, already
in the site. A script with errors is not built.

### serve

`serve [--port <n>]`: serves the package and the site on 127.0.0.1 and prints the URLs that play each built story in
[examples/story](../examples/story); runs until stopped (Ctrl+C).

## Script format

```json
{
  "format": "ournotes.story-script/1",
  "base": "stories/10002.json",
  "language": "zh-Hans",
  "title": "放学后的约定",
  "font": "sans",
  "cast": {
    "soyo":   { "model": "adv_live2d_soyo_004_school_winter_hs", "name": "爽世" },
    "tomori": { "model": "adv_live2d_tomori_001_school_winter_hs_1st", "name": "灯" }
  },
  "beats": [
    { "scene": "adv_bkg_stage_000135", "location": "放学后的教室", "camera": "middle",
      "positions": { "soyo": "left", "tomori": { "at": "right", "expression": "exp_sad01" } } },
    { "say": "soyo", "text": "小灯，今天也要去练习吗？", "motion": "mtn_smile01", "expression": "exp_smile01" },
    { "say": "tomori", "text": "嗯……\n我想再试试那首歌。", "motion": "mtn_nod01" },
    { "narrate": "窗外的夕阳把桌椅的影子拉得很长。" },
    { "positions": { "soyo": "center" } },
    { "id": "promise", "say": "soyo", "text": "那我陪你一起去吧。", "expression": "exp_shy01" },
    { "scene": "adv_bkg_stage_000153", "location": "RiNG 咖啡厅", "camera": "near", "positions": { "soyo": "center" } },
    { "say": "soyo", "text": "到了。" }
  ]
}
```

| Key | Meaning |
|---|---|
| `format` | `"ournotes.story-script/1"`. |
| `base` | The path of the base story's manifest in the site (`bases`). Its stages, music, talk window and player settings are used. |
| `language` | Optional. The language of the texts, one of the base story's languages (default: its default language). |
| `title` | Optional. Shown when the story starts. |
| `font` | Optional. The font family the text is drawn with: `"sans"` (default), `"serif"`, `"rounded"` (each a list of common fonts for the language), or `{"family": "<CSS font-family list>"}` for fonts installed on the machine that draws. |
| `cast` | Cast id → `{model, name}`: a model id of `models.json` and the name shown in the talk window. A cast id is a letter followed by letters, digits or `_`. |
| `beats` | The story in order. The first beat is a scene. |

Beats (each has one of the keys `scene`, `positions`, `say`, `narrate`; any beat may have an `id`, reported with its
lines by `render`):

| Beat | Keys |
|---|---|
| scene | `scene`: a stage id. `music`: a cue of the base story, `"stop"`, or absent to keep what plays. `location`: a caption shown at the start. `camera`: `near`, `middle` (default) or `far`. `positions`: who stands where (absent: nobody). A scene after the first fades out and in, and clears the stage. |
| positions | `positions`: who stands where from now on; characters not named leave, characters on a new position leave and enter there, each with a short fade. `camera`: optional, as for a scene. |
| say | `say`: a cast id. `text`: the line. `motion`: optional, a motion of the speaker's model. `expression`: optional, an expression of the speaker's model. |
| narrate | `narrate`: a line without a speaker. |

Positions: `far-left`, `left`, `center`, `right`, `far-right`. A position is a name, or `{"at": <name>, "motion",
"expression"}` to enter (or, staying where it is, to act) with a motion and an expression. Two characters cannot share a
position.

Motions are named by stem (`mtn_smile01`): the variant that faces the character's side of the stage plays (`_L` on the
left positions, `_C` in the centre, `_R` on the right, the centre one where the model has no such variant). A full clip
name (`mtn_smile01_L`) plays as it is. A motion or an expression needs the speaker on stage; a speaker off stage still
talks (warning `speakerOffStage`).

Text is shown as written: `<` and `\` are characters, not rich text tags or escapes, and `\n` in the JSON string
breaks the line. Keep each text line within the talk window's width; `render` reports lines that do not fit.

## Error and warning codes

| Code | Meaning |
|---|---|
| `json` | The file is not JSON. |
| `format`, `type`, `missing`, `empty` | A value has the wrong format or type, is missing, or is empty. |
| `unknownKey` | A key the format does not have (often a typo: see `suggestion`). |
| `castId` | A cast id that is not a letter followed by letters, digits or `_`. |
| `beatKind` | A beat without `scene`, `positions`, `say` or `narrate`. |
| `duplicateId` | Two beats with the same `id`. |
| `unknownBase` | The base story is missing from the site or cannot be a base. |
| `unknownLanguage`, `unknownFont`, `unknownPosition`, `unknownCamera` | A name outside the lists above. |
| `unknownModel`, `unknownCast`, `unknownStage`, `unknownMusic`, `unknownMotion`, `unknownExpression` | A name the site, the script or the model does not have. |
| `beforeScene` | A beat before the first scene. |
| `positionTaken` | Two characters on one position. |
| `offStage` | A motion or an expression for a speaker who is not on stage. |
| `noLines` | `render`: the script has no line. |
| warning `speakerOffStage` | A character speaks without standing on stage. |
| warning `unusedCast` | A cast member never appears or speaks. |
| warning `textTooWide`, `textTooTall` | `render`: a line does not fit the talk window. |

Codes with a known fix are listed under [Fixes](#fixes).

## What the story is made of

The tool compiles a script into the story player's data ([story-data-format.md](story-data-format.md)): an
`episode.json` of the game's command rows (Character, Stage, Bgm, In, Out, Focus, FadeOut, FadeIn, Location, Motion,
Expression, Talk) with the texts in its text table, a `story.json` naming the models and the music it plays, and the
base story's `ui/fonts.json` with every font asset drawn by the browser
([browser fonts](story-data-format.md#browser-fonts)): every character of the font family shows, laid out by
TextMeshPro's rules with the base story's font settings. The other files (stages, talk window, shaders, the player
settings, the music) are the base story's; the media of its own rows (frames, stills, effects, chat, videos) are left
out.
