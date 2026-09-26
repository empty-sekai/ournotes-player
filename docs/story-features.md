# Story features

The feature modules (`src/story/features/`) add the story commands beyond the core interpreter: camera and field
effects, frames, stills, videos, particle effects, post effects, flashes, choices, voices and the chat phone. Their
commands are registered when `src/story/features/index.js` loads; `installStoryFeatures(ctx, core)` prepares an
episode's feature data after its resources are loaded, and `disposeStoryFeatures(ctx)` releases it. With the core
interpreter's commands, every `AdvCommand` has a handler (`registeredCommands()` lists all 68).

## Commands

| Commands | Game classes | Module |
|---|---|---|
| Shake, CameraShake | AdvShakeCommand, AdvCameraShakeCommand (DOTween shakes of the camera, the field, the still view and the talk window) | `commands/shake.js`, `features/shake.js` |
| Tilt, Role, Pan, Angle, DoF | the camera rotation and depth-of-field commands | `commands/camera-rotate.js`, `commands/angle.js`, `commands/dof.js` |
| MoveToRight, MoveToLeft, MoveToUp, MoveToDown, MoveToForward, MoveToBack, Forward, Back | the placement commands of the character field | `commands/placement.js` |
| Brightness, RimLight, StageEnv | the field renderer's brightness, the characters' rim light, the stage environment | `commands/brightness.js`, `commands/stageenv.js` |
| MotionLoop | a character's parameter loop | `commands/motionloop.js` |
| PostEffect | the volume profiles of the post-effect prefabs | `commands/posteffect.js`, `features/posteffect.js` |
| Frame | AdvFrameView: the frame prefabs on the frame canvas, their Animators and comment texts | `commands/frame.js`, `features/frame.js` |
| Still, Alpha | AdvStillView with the stills' DOTween Pro animations and sequences | `commands/still.js`, `commands/alpha.js`, `features/still.js` |
| Movie, Clip, Subtitles | AdvVideoCommandHelper, the video loader queue, AdvVideoView, the video timeline of the Delay rows, the captions | `commands/video.js`, `commands/subtitles.js`, `features/video.js` |
| Effect | AdvParticleEffect (command and stage particle groups) | `commands/effect.js`, `features/effect.js` |
| Flash | the front canvas flash | `commands/flash.js` |
| ChoiceSet, ChoiceShow, GoTo, Timeline | the choice and jump commands | `commands/choice.js`, `commands/timeline.js` |
| Voice | AdvVoiceCommand: voices without a text window, the voice playback scope shared with Talk | `commands/voice.js` |
| ChatWindow, ChatTalk, ChatStamp, ChatRead, ChatTyping | UIAdvChatWidget / AdvChatView, AdvChatWindow, the conversation memory of the session | `commands/chat.js`, `features/chat.js` |

## Data

The features read the media files that `story.json` names (`frames`, `stills`, `videos`, `effects`, `postEffects`,
`chat`) and the story UI data (`ui/ui.json`: the video, still, frame and screen canvases, the video and still camera,
the screen image, the story UI shaders). A file is read only when the episode has rows that use it. When a record
contradicts what the player implements (a canvas with another render mode or scaler, a camera with other clear flags,
projection, volume mask or volume update mode), the episode is refused with the record's path.

## What is drawn

- **Video and still canvases.** UIAdvWidget's video and still camera (perspective, 60 degree field of view) draws the
  video canvas and the still canvas into its HDR colour target, runs the URP post chain on it into a render texture of
  the viewport size, and the screen image shows that texture. The camera blends the ADV volumes (the stage, warmup
  and PostEffect volumes, every frame) and none while a still is set. A node moved off the canvas plane (a still
  shake, a DOTween move along z, a rotation about x or y) is drawn through the camera's perspective projection. Video
  black bars come from the video view's stencil mask and curtain. In a browser the videos play through an HTML video
  element kept on the player's video clock; a headless session keeps the clock only.
- **Frames** on the frame canvas with their images and Animators, plain Transforms included.
- **Stills** with their images, canvas groups and DOTween Pro animations, rotations in three dimensions included.
- **Particle effects** of Effect rows and stages (their particle systems, sprites and meshes), in the canvas or camera
  layer of their prefab.
- **Post effects, stage environments, rim light, brightness, depth of field** through the story renderer.
- **Flashes** through the story UI.

## What is not drawn

- **The chat phone.** Its commands run completely: the phone's visibility, slides and screen modes, the bubbles and
  the lock-screen timeline, read labels, the conversation memory and its restore, the typing box, the waits and
  sounds. Its bubbles are uGUI layout groups around TextMeshPro text, which this player does not lay out, so a session
  with a GL context refuses chat episodes (`the chat window (UIAdvChatWidget) is not drawn by this player`). A
  headless session plays them.
- **Canvas text** in frames and stills: such a node raises when it is drawn.
- **Canvas particles** in frames and stills (Coffee.UIParticle and the particle systems it bakes into the canvas):
  such a node raises when it is drawn while visible. A headless session plays these frames.
- **The video seek freeze.** The game re-prepares a video with audio at a new playback speed and covers the gap with a
  copy of the video texture; here the video changes speed without the re-prepare.

## Not reproduced

- The windowed preload of stills, videos and chat assets: everything is loaded before the story starts.

## Engine behaviour

Engine behaviour the game's code does not show (DOTween settings, uGUI layout, CRI video and sound, URP render
targets, particle simulation) is marked `ENGINE:` in the sources and listed in [fidelity.md](fidelity.md).
