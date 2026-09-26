# Simple story player (Overlay episodes)

The game plays the episodes of `MasterAdv._playbackMode` 1 (the home spot talks and the talks of the live result
screen) through a reduced player of its own, `SimpleAdvPlayer`, inside the screen that opens them, not through the
full story player. `src/story/simple/` reproduces that presentation. `StorySession.create` hands such an episode to
`SimpleStorySession`, which has the same interface (`create`, `step`, `render`, `play`, `tap`, `skip`, `dispose`,
`line`, `lineCount`, `speaker`, `text`, `ended`), so `<ournotes-story>` and page code play both kinds alike.

## What plays

- **Commands.** The simple runner executes In, Out, Talk, Delay, Brightness, Expression, Pause, Resume, Motion,
  Character, Costume, Wait, Se, Angle, TalkWindow, Look, Voice, RimLight, LookTarget, MotionLoop and EyeBlink. Every
  other row (Stage, Bgm, camera and transition commands, CancelDelay, ...) is skipped, as the game logs and skips it.
  The shared commands run the same handlers as the full player. A row that the game's validator rejects (a malformed
  LookTarget, MotionLoop, EyeBlink, Brightness or Effect row) makes the episode play nothing. An Effect row is refused
  when the story loads.
- **Characters.** Each shown character is a Live2D model rendered into its own 1536 x 1536 texture by a perspective
  capture camera, lighting off, and shown as an image in one of the slots of the host's layout (up to five, by
  PositionType). The images fade in over the In row's Duration after three frames; Out removes a character at once.
  When several characters appear together, the idle motion and breathing of each later one start one frame per slot
  later, as in the game.
- **Talk window.** `UISimpleAdvTalkWindow`: a text panel and a speaker plate, centred in the host's talk area at its
  960 x 320 design size and scaled to fit. The typewriter, speaker names and lip sync modes are the full player's.
- **Advance.** Home talks advance by tap (a tap while a line types reveals it); at the end the presentation fades out
  over 0.2 s. Live result talks advance on their own (the text-length and minimum display times of the player
  settings, or the voice's end); at the end the talk window hides and the characters stay on screen, still animating.
  Neither has auto, fast-forward, log or skip controls in the game; `setAuto` and `setSpeed` do nothing and `skip`
  ends the talk.
- **End.** `endReason` (and the `onEnded` reason) is numbered as for other stories: 0 when the talk played to its end,
  1 when it was stopped, and 2 when the game's validator refused the episode and nothing was shown.

## Hosts

`host/host.json` (written by the data exporter for Overlay episodes) names the host screen:

| Host | Screen | Reproduced | Not reproduced (runtime data) |
|---|---|---|---|
| `home` | the home spot | the 3D spot (cardboard room with the game's shaders, Spine characters holding the end of their entrance animation), the camera's default pose, for a tap talk the 0.5 s move toward the tapped character and back, the 0.2 s blur of the scene, for an area talk the title message, the spot widget's darkening layer | the home header and menu buttons (player data), the home BGM and ambient sound, the spot's post-processing volume, the letterbox bands beyond 13:6 |
| `afterlive` | the live result screen's reward phase | the fixed result background, the reward panel's talk area and its layout | the music, score, rank, reward items, navigation and member card of the played live |

Without host data the talk plays alone on black with the default layout.

A home tap talk starts when the player taps a character of the spot that the talk is listed for. A talk whose
character has no tap target in its spot (the spot does not place that character) is never started by the game;
the session plays it as a tap talk without the camera's move and lists
`"no tap target for the talk's character in the spot (camera focus not played)"` in `missing`.

A spot whose room has a material with the Universal Render Pipeline/Lit shader needs URP's lighting state (the
per-camera lighting keywords and the light uniforms), which the host does not set: a session that draws refuses
such an episode before it starts, naming the material; a headless session plays it.

## Data

Besides the story files of `docs/story-data-format.md`:

- `host/host.json` (`ournotes.story-host/1`): the host kind, the capture camera prefab values (`cameraTarget`), the
  host's overlay root and its layout component (`overlayRoot`, `layoutRoot`), the host UI document (`ui`:
  `host/ui/ui.json`), the sequences the host screen has played when a talk can start (`openedSequences`: the talk
  starts with their Animator states at their end), and per host its scene data (`home`: the spot export, the room
  glTF with the background root's transform, per-node visibility after the situation, materials, Spine materials and
  sorting, shaders, blur parameters, ambient sound; `afterlive`: the background node and sprite, the reward panel,
  the list of runtime parts not drawn).
- `ui/simple/ui.json`, `ui/simple/fonts.json` (per language): the talk window (and, for area talks, the system message
  widget and its title text) in the story UI record format, with the fonts of its texts.
- Animator clips of the host UI key their curves by the path below the Animator (`"<path>:<Class>.<property>"`);
  sprite curves index the clip's sprite names. A curve whose object is not in the exported part of the screen is
  bound to nothing, as Unity does for a missing object.

## Page requirements

- Live2D Cubism Core, as for every story.
- Home talks: a Spine runtime for the spot's characters. It is not part of this package; the page loads Esoteric
  Software's own spine-core build (Spine Runtimes license) before the story, like the Cubism Core, either as the
  global `spine` or passed as the session option `spine`. Its major.minor version must match the skeleton data's
  (Spine runtimes do not read other versions), and it must provide `TextureAtlas`, `AtlasAttachmentLoader`,
  `SkeletonJson`, `SkeletonBinary`, `Skeleton`, `AnimationState`, `AnimationStateData`, `Physics`,
  `SkeletonClipping`, `RegionAttachment`, `MeshAttachment`, `ClippingAttachment` and `BlendMode`. Without a usable
  runtime the spot renders without its Spine characters, the talk still plays, and the session lists
  `"Spine runtime missing"` in `missing`.

`missing` lists what the session does not draw for this episode: `"Spine runtime missing"`,
`"spot Volume post-processing"` when the spot has a post-processing volume, and the tap target entry above.
