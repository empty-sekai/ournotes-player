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

`host.json` in the `story.host` product names the host screen:

| Host | Screen | Reproduced | Not reproduced (runtime data) |
|---|---|---|---|
| `home` | the home spot | the 3D spot (cardboard room with the game's shaders, Spine characters holding the end of their entrance animation), the camera's default pose, the main camera's post-processing with the spot's volume, for a tap talk the 0.5 s move toward the tapped character and back, the 0.2 s blur of the scene, for an area talk the title message, the spot widget's darkening layer | the home header and menu buttons (player data), the home BGM and ambient sound, the letterbox bands beyond 13:6 |
| `afterlive` | the live result screen's reward phase | the fixed result background, the reward panel's talk area and its layout | the music, score, rank, reward items, navigation and member card of the played live |

Without host data the talk plays alone on black with the default layout.

A home tap talk starts when the player taps a character of the spot that the talk is listed for. A talk whose
character has no tap target in its spot (the spot does not place that character) is never started by the game;
the session plays it as a tap talk without the camera's move and lists
`"no tap target for the talk's character in the spot (camera focus not played)"` in `missing`.

A room material with the Universal Render Pipeline/Lit shader is drawn with URP's lighting state for the main camera
in the spot: the lighting keywords of the quality level's pipeline asset (spherical harmonics per vertex, and at `best`
the per-vertex additional lights keyword), no main or additional light (the spot has none), the ambient of the spot
scene's render settings (a white flat ambient) and a black default reflection. A session that draws refuses, before it
starts, a spot whose lighting the host does not reproduce (a light, fog, lightmaps, another ambient or reflection,
shadows); a headless session plays it.

The spot is drawn by the game's main camera with the Spot scene camera's projection, clear colour and clip planes, in
HDR, with post-processing on and its volume mask on the HomeView layer. Its volume stack is the default profile
blended with the spot's global volumes on that layer, by priority and weight; the spot backgrounds of the current data
carry one, with bloom and split toning at weight 0.05. The main camera's post chain (colour grading LUT, bloom, uber
pass) runs on the spot alone; the talk's blur and the UI are drawn after it. The film grain option applies as in other
stories; the spot volumes of the current data have no film grain. A session that draws refuses a spot volume the chain
does not draw (a local volume, depth of field, motion blur, a component or texture parameter it does not know) and a
main camera with antialiasing or dithering.

## Data

The [story part index](story-data-format.md#storyjson) names the reusable host and language products.

- `story.host` contains `host.json` (`nnnotes.story-host/1`), prefab ids, capture camera, overlay and layout references,
  opened animation sequences, graphics and DOTween settings. Node references are `{prefab, path}`. Home hosts also
  reference room and spot products, background activation/queue state and scene roots. Afterlive hosts identify the
  background image/sprite and reward panel.
- `story.simpleui` contains `ui.json` (`nnnotes.story-simple-ui/1`), referencing the simple talk window and system
  message prefabs. Native components hold their text, layout and animation fields.
- `story.fonts` supplies the selected language's TMP component-id bindings and glyph pages. The episode's own
  `story.json.host` selects the home talk kind, tap character and localized area title.

The loader merges these products' compatible object roles. Room geometry and material order come from `room.json`
and `room.glb`; Spine files come from the spot product, with page materials resolved from its skeleton/atlas objects.

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

`missing` lists what the session does not draw for this episode: `"Spine runtime missing"` and the tap target entry
above.
