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

The features resolve `story.json.parts.assets`, `.videos` and `.chat` products. Prefab components hold the media
fields, canvas and camera settings; object ids identify textures, meshes, materials, clips and controllers.
The story UI product supplies its canvas prefabs, and the font product binds text by TMP component id.
A setting outside the implemented subset is reported with its object or node path when the feature is initialized.

## What is drawn

- **Video and still canvases.** UIAdvWidget's video and still camera (perspective, 60 degree field of view) draws the
  video canvas and the still canvas into its HDR colour target, runs the URP post chain on it into a render texture of
  the viewport size, and the screen image shows that texture. The camera blends the ADV volumes (the stage, warmup
  and PostEffect volumes, every frame) and none while a still is set. A node moved off the canvas plane (a still
  shake, a DOTween move along z, a rotation about x or y) is drawn through the camera's perspective projection. Video
  black bars come from the video view's stencil mask and curtain. In a browser the videos play through an HTML video
  element kept on the player's video clock; a headless session keeps the clock only.
- **The video seek re-speed.** A speed change while a video with audio plays stops the video at its displayed frame
  and plays it again from there at the new speed (a video without audio takes the new speed at once). Meanwhile the
  video is masked and the screen shows a copy of the last drawn frame over it at alpha 0.7, removed two frames after
  the video shows its first new frame. A change during a re-speed runs it once more. Movie rows, captions and the
  delay helpers wait while it runs, and the delays then take off the time of the frames the video advanced. A viewport
  change clears the copy. The pause and resume paths that would pick up a re-speed marked for later are not in this
  player (it pauses neither the model nor a video), so that mark is set and never read.
- **Frames** on the frame canvas with their images and Animators, plain Transforms included, and their canvas
  particles: Coffee.UIParticle simulates the frame's particle systems and bakes them with the UI camera (the story UI
  data's `uiCamera`) into canvas meshes, drawn in hierarchy order with the frame's other graphics. A session without
  a GL context does not update them, as nothing is drawn. A frame's texts: the Frame row gives the localized
  `TargetTextIDs` to the frame's text receiver (the comment frame: a pattern of comment cards per Animator state, each
  card's user name, user id and body formatted by the game's comment text rules and set through the UIText setter).
  With the story UI's frame text bindings they are laid out by TextMeshPro's rules with the story UI's fonts and the
  uGUI auto layout of the frame (layout groups, content size fitters, layout elements), and drawn with the story UI's
  text materials; the comment frame's fitter scales its cards to the frame's size. A session that draws refuses an
  episode whose Frame rows give texts to a node without a binding.
- **Stills** with their images, canvas groups and DOTween Pro animations, rotations in three dimensions included.
- **Particle effects** of Effect rows and stages (their particle systems, sprites and meshes), in the canvas or camera
  layer of their prefab.
- **Post effects, stage environments, rim light, brightness, depth of field** through the story renderer.
- **Flashes** through the story UI.
- **The chat phone.** UIAdvChatWidget's ChatCanvas (Screen Space - Camera on the ADV camera, CanvasScaler Scale With
  Screen Size / Expand) with the episode's chat windows attached under AdvChatView's Target, laid out and drawn as uGUI:
  RectTransforms, the layout groups, content size fitters and layout elements of the window, its Images (Simple and
  Sliced sprites, trimmed ones included), TextMeshPro texts with the chat windows' text bindings of the story UI
  (serialized texts until a row sets them), CanvasGroups, the read label's CanvasRenderer alpha, stencil Masks, Soft
  Mask for uGUI (a SoftMask over its Image's sprite, Simple or Sliced) and the ScrollRect positions of the main and
  lock-screen timelines. The view does to the window's objects what AdvChatView does: the screen modes and slides, the
  bubbles (new copies of the window's node templates; the lock-screen timeline pops its pre-filled nodes before it
  copies the first one), the sender identity and read labels, the typing box and its height, the typing padding of the
  timeline and the scroll to the bottom. The canvas is a layer 11 renderer of the field (sorting order 10000, at the
  canvas' plane distance): in the camera's list, or after the offscreen composite while the foreground entry is active.
  The story UI product references `chatWidget`, chat window/icon/stamp products provide their prefabs, and
  `story.fonts.texts` binds their TMP components. A missing binding is reported with the component's identity.

## What is not drawn

- **Canvas text without a text binding** (a still's text, a serialized frame text without one): such a node raises
  when it is drawn with a text.
- **Canvas particles in stills**: such a node raises when it is drawn while visible. A headless session plays these
  stills.

## Not reproduced

- The windowed preload of stills, videos and chat assets: everything is loaded before the story starts.

## Engine behaviour

Engine behaviour the game's code does not show (DOTween settings, uGUI layout, CRI video and sound, URP render
targets, particle simulation) is marked `ENGINE:` in the sources and listed in [fidelity.md](fidelity.md).
