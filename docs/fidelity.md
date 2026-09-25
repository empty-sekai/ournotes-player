# Fidelity

What the player reproduces from the game, under which fixed settings, what it adds as a viewer, and where it relies on
the documented behaviour of the engine rather than on the game's own code.

## Source of the behaviour

The player follows the game's own managed code; comments in `src/` name the game class and method each piece
follows. That covers the live flow (the states of the live state machine from `FullInitialize` to the end of the
music), the auto-play simulation (`LiveExecutor` and the chart simulator: note and line states, judgements, combo),
the note and line views (`LiveAllNoteView`), the lane and note effects, the live UI (judgement and combo counter), the
live sound rules (`LiveSoundPlayer`: note sound effects per frame, the hold loop, the finish cheer and direction sound
effect), the LightWeight background composite, the cameras, render targets and sorting of the live screen, and URP's
post-processing chain as the game configures it.

What the game leaves to the engine's native code (Unity: Animator, particle systems, sprite and line meshes, canvas
rendering, …; CRI: category volumes, ducking, the audio-synced timer) cannot be read from the game. It is implemented
from the engine's documented semantics, and every such place carries a comment starting `ENGINE:`; the
[list](#engine-behaviour) is at the end of this document.

The shaders are the game's own: the player runs the GLSL ES 3.00 programs Unity compiled for OpenGL ES 3, read from
the chart data, with the pass render states and material values the game sets.

## Fixed settings

The player shows one live the way the game's auto play does, with these settings:

| Setting | Value |
|---|---|
| Play mode | Auto play, every judgement Perfect. No skills (there is no deck), no Gekisou. |
| Options | The game's defaults, from the chart data (`optionDefaults`, `optionDefaultsPreset1`): note speed 5, input timing offset 0, no mirror, default opacities and line displays. |
| Background | LightWeight mode: the composited background image the game builds once when the live loads. The 3D stage, stage video and characters of the other background modes are not drawn. |
| Live quality | The manifest's `quality` (Middle in the current data), or the value the page passes. |
| Frame rate | 60 frames per second of game time. Each frame runs the game's order: UniTask waits, the live update (sound manager, state machine, simulation, views, effects, UI), DOTween, Animators and the timeline, particles, then rendering. |
| Arithmetic | float32 where the game's managed code computes in float32 (`Math.fround` in source order, no fused multiply-add). |
| Chart clock | The music's audio-synced time in whole milliseconds, as the game reads it; with the music off, the game time since the music start. |
| Particle randomness | A seeded stream (`seed`). The game seeds its effects from the clock, so their random details differ between runs in the game too. |

With these settings the chart side (judgements, combo, note and line views, the UI's state) follows the game frame by
frame at 60 fps.

## Viewer features

These are not in the game; they are kept apart from the reproduced code and documented as viewer features:

- **Direct start.** The player starts at the chart. The game's start sequence (start canvas, start cheer, start voice)
  is not shown: the live's intro timeline runs to its end once without drawing and without sound, so stage, lane and
  tap area are as the game leaves them when the music starts.
- **Pause and resume.** The loop stops stepping and the audio is suspended.
- **Seek.** The chart state is re-simulated frame by frame on the 60 fps grid without drawing, from the chart start (or
  the current position when seeking forward); judgements, combo, note views and UI equal an uninterrupted run at the
  time reached. Effects and particles are cleared and sounds other than the music stop.
- **Late frames.** When the chart clock has moved on by more than one frame (a slow device, a background tab), the
  missed frames are simulated without drawing and without sound, so no judgement is lost; up to 12 missed frames the
  effects are advanced too, beyond that they are cleared, and a jump of more than 2 s is handled as a seek.
- **Speed** (0.5–1.5). Game time is scaled (effects, tweens, animations) and the music plays at that rate, with its
  pitch; the chart follows the music.
- **Music and sound effect switches.** With the music off, the chart runs on game time.
- **Any size.** The render targets follow the drawing buffer as they follow the screen size in the game.

## Not reproduced

- The game's start sequence (see above), the result screens after the music, and everything outside the live.
- Real input: there is no touch play and no judgement other than auto play's Perfect.
- Background modes other than LightWeight, and skill and Gekisou effects.
- Options other than the defaults (note speed, mirror, opacity, …).
- Sound details: the CRI reverb bus is not rendered and cue pitch commands are not applied (see the `ENGINE:` notes of
  `src/live/sound.js`).
- The HDR format of the camera target depends on a player setting of the game; RGBA16F is used.

## Live2D models

The model viewer ([live2d.md](live2d.md)) runs one character the way the game's story screen does. Its code follows
the game's Live2D layer (`Live2DAnimation.Live2DCharacter`, `Live2DCharacterController`) and the game's build of
Cubism SDK for Unity (`CubismParameterStore`, `CubismFadeController`, `CubismExpressionController`,
`CubismAutoEyeBlinkInput`, `CubismHarmonicMotionController`, `CubismPhysicsController`, `CubismRenderController`,
`CubismMaskController`, `CubismModel`), with Live2D Cubism Core (loaded by the page) evaluating the moc3. The drawing
uses the game's own shaders "Live2D Cubism/Lit-URP-ADV-optimize" and "Live2D Cubism/Mask" from the data, with the
material values of the prefab and the property values the Cubism renderer sets.

Reproduced: the loader's initialisation and warmup and the story's `In`; the update order of one frame (the
controller's Update, the Animator, the update controller's chain in execution order, the model update at the end of
PreLateUpdate) and the resulting display latency of two model updates; motion fades (recursive, from the parameter
store's snapshot), the replay of the default motion, expression blending, the game's eye blink phases and intervals,
the breath motion, physics with its fixed-rate steps and interpolation, the double-buffered meshes, sorting, vertex
colours, the mask groups, tiles and mask texture. Arithmetic is float32 in source order, as for the chart player.

Fixed settings:

| Setting | Value |
|---|---|
| Frame rate | 30 frames per second of game time (the story screen's target frame rate). |
| Physics, breath | On (the game enables physics from its Middle quality level and the breath motion from High); either can be switched off. |
| Lighting | Off: `_LightingEnabled` 0, as the game draws characters without Unity lighting (quality levels up to Middle) and for an `unlit` In. |
| Eye blink randomness | A seeded stream (`seed`); the game draws the intervals from Unity's global random stream, so they differ between runs in the game too. |

Viewer choices (not the game's):

- **View.** The model's canvas (moc3 canvas info) is fitted into the drawing buffer and centred by an orthographic
  camera at (centre, −10) looking along +z (near 0.3, far 1000), on a transparent background. The story's stage,
  character slots, cameras, field compositing, blur and post-processing are not drawn.
- **Neutral scene values** for the Lit shader, which the story's stage would provide: no main light
  (`_MainLightPosition` (0, 0, 1, 0), `_MainLightColor` 0), the ambient probe of a flat white environment
  (`unity_SH*`: SH(N) = 1), no additional lights, and the multiply texture of the game's call without a stage
  (`Texture2D.whiteTexture`, intensity 0.3, UV (1, 1, 0, 0), amplitude 0, frequency 0.5). With lighting off the
  first three do not change a pixel, and the white multiply texture leaves the colour as it is.
- **Returning to the default motion.** The game plays the next motion when the story asks for one; the viewer sets the
  controller's next motion (`NextMotionName`) to the default motion, with its own fade-in time, whenever it plays
  another motion without `loop` (`LoopMotion` replays it instead).
- **Requests** (motions, expressions, switches) run at the next frame's Update, where the game runs story commands.
- **Pause** stops the frame loop; **any size**: the canvas fit follows the drawing buffer.
- **Mip levels.** A mipmapped model texture is drawn with its level 0 from the data and the other levels generated
  from it by WebGL (`generateMipmap`), not with the game's stored levels.

Not reproduced:

- Lip sync and motion sync from voice (the managed lip sync policy and Live2D's MotionSync Core); the mouth follows
  `CubismMouthController.MouthOpening` as it does without lip sync.
- The story's look and angle commands, the eye blink stop override, rim light, brightness, motion speed and the
  character's own pause; pose parts, dense clip curves and legacy expression blending (models that use them fail to
  load with an error naming the feature).

## Engine behaviour

Every `ENGINE:` note in `src/`, by file. `npm test` checks that this list matches the sources
(`node scripts/engine-notes.mjs --write` regenerates it).

<!-- engine-notes:start (generated by scripts/engine-notes.mjs) -->

**`src/engine/anim.js`**

- Mecanim samples streamed clips natively; this is the cubic form of the stored keys.
- Mecanim's wrap of negative state time is native; positive modulo is the documented looping behaviour.
- AnimationEvent dispatch is native; (prev, cur] window, fired after the frame's pose (documented).
- the Animator update is native; advance-then-sample is the order assumed here.
- Mecanim's state machine is native; transition order, carried-over time and cross-fade weights follow the docs.
- the parameter reset on re-enable is native; parameters return to their defaults here.
- Play / CrossFade are native; a zero-length cross-fade is an immediate switch, also to the playing state.
- Mecanim's quaternion normalisation of a single sampled clip is native; it is not applied here.
- an untouched transform's starting euler triple is m_LocalEulerAnglesHint; here `localEuler` or (0, 0, 0).
- Gradient.Evaluate is native; this is its documented blend on the stored values.
- AnimationCurve.Evaluate is native; this is Unity's documented Hermite form.

**`src/engine/audio.js`**

- CriAtomExCategory keeps its volumes in the native CRI library; GetVolume returns the float last set.
- CRI combines the category and option volumes natively; they are multiplied here.
- CRI's audio-synced timer is native; the AudioContext output timestamp stands in for it.

**`src/engine/loop.js`**

- two order-0 MonoBehaviour Updates run in an unspecified order; GameMain runs first here.

**`src/engine/postfx.js`**

- Unity's Random is native (see random.js); the offsets match the game's only in distribution.

**`src/engine/random.js`**

- Rand is native; this is the generator family and float mapping Unity is known to use.

**`src/engine/ugui.js`**

- Sprites.DataUtility.GetOuterUV / GetInnerUV / GetPadding are native; these are Unity's sprite data formulas.
- DataUtility.GetMinSize is native; taken as border.x + border.z (Unity's definition for bordered sprites).
- CanvasRenderer applies the inherited CanvasGroup alpha natively; here a float multiply of Color32 alpha / 255.
- unity_GUIZTestMode is set by Unity's native canvas render path (values as above).

**`src/live/background.js`**

- Graphics.Blit draws a quad (0,0)..(1,1), uv = position, ObjectToWorld identity, VP = ortho [0,1] -> clip.
- Unity's built-in blit-copy shader is replaced by a same-size texel copy (exact up to RGB565 conversion).

**`src/live/canvas.js`**

- URP's final blit shader (CoreBlit) is replaced by a same-size texel copy (gamma project: no conversion).

**`src/live/fx-effects.js`**

- SpriteRenderer mesh generation is native; the documented behaviour below is implemented.
- a Tight-mesh sprite in Sliced mode (ef_tap_pillar) uses its full rect, not its textureRect.
- vertex colour is Color32 (Unity's sprite vertex format), round(clamp01(c) * 255), as for particles.
- flipX / flipY negate the local x / y of the vertices (the shader culls nothing: Cull Off).
- activation is native; OnEnable / OnDisable run immediately inside SetActive and m_IsActive writes, parent first.
- GameObject.m_IsActive from a float curve: active when the value is > 0.5.
- Play with normalizedTime -Infinity does not restart a state that is already the current one.
- AddCapacityAsync (Object.InstantiateAsync) completes in a later frame chosen by the engine; here at the next update().
- the native TRS chain rounds in float32; here M * p in double, rounded to float32.
- the first Animator evaluation after Animator.Play in Update is taken at t = deltaTime (engine/anim.js convention).

**`src/live/fx-ui.js`**

- Canvas.referencePixelsPerUnit of the nested UILiveJudgement canvas is native; taken as 100.
- Mecanim transition interruption is native; the Animator (engine/anim.js) checks no transition during a cross-fade.
- GameMain and DOTweenComponent are both order-0 MonoBehaviour Updates; GameMain is taken to run first.
- RectTransform placement is native; UINode follows the documented anchor / pivot rules.
- the nested Canvases of UILiveCombo / UILiveJudgement (overrideSorting off) are taken to draw in hierarchy order.
- unity_GUIZTestMode 4 (LEqual) for a camera canvas; the depth test does not reject canvas fragments here.

**`src/live/fx.js`**

- particle jobs start at ParticleSystemBeginUpdateAll and sync before rendering; one simulate(dt) per frame here.
- effect ParticleSystems use autoRandomSeed, so the game's values are not reproducible; deterministic per seed here.

**`src/live/intro.js`**

- the director update is native; it already advances in F0 (Play precedes that frame's director update).
- Stop() with wrap None may revert animated properties (Unity manual); the last evaluated state is kept.
- timeline and Animator writes to one property resolve natively; the timeline wins here.
- a GameTime director's player-loop slot and the notification dispatch are native; `animation` phase here.
- active at >= 0.5
- SortingGroup sorting is native; the group sorts as one renderer at its transform's distance.
- skinning, influence cut / renormalisation and bounds culling are native; documented behaviour, float64.
- the mesh has no colour channel; the missing COLOR input is taken as (1, 1, 1, 1).

**`src/live/lane.js`**

- LineRenderer mesh generation is native; side vector, vertex order and v edges follow Unity's docs.
- sliced sprite generation is native; borders shrink proportionally when size < border sum (documented).
- Gradient.Evaluate is native; linear blending between neighbouring keys, clamped outside (Blend mode).
- a ScreenSpaceCamera canvas transform is set natively; this is the documented placement, in float64.
- Unity 6 passes the sprite colour via unity_SpriteColor (SRP-batched) or vertex colour; multiplied once.
- unity_GUIZTestMode outside a canvas is native global state; 0 here, LEqual would draw the same pixels.

**`src/live/notegeo.js`**

- Sprite.bounds is native; these skin sprites use Tight meshes, the rect size is assumed (not the vertex box).

**`src/live/noteview.js`**

- a SpriteRenderer's colour and flip reach the shader as per-draw values, with white vertex colours.
- the SpriteRenderer mesh is native; rebuilt here from the sprite's mesh (Simple) or a 9-slice of its rect (Sliced).
- Texture2D.SetPixels float -> RGBA32 conversion is native; rounded to nearest here.
- the graph's time origin (first OnEnable) is taken as the first animation phase after a flick view is rented.

**`src/live/particles.js`**

- which draws the native particle code makes, and in which order, is not known.
- AnimationCurve.Evaluate is native; Hermite form, Bezier solve (Newton + bisection to 1e-7), float32 rounding.
- random MinMax values use the managed Lerp(min, max, t) form, not the native Random.Range mapping.
- Fixed gradient mode: the colour of the first key at or after t (documented "no interpolation").
- the particle 3D rotation order is native; Quaternion.Euler order (z, x, y) is assumed.
- Unity's noise field is native (function, per-axis offsets, seed, range, octave normalisation); gradient noise here.
- Unity derives these from the particle's randomSeed with module offsets; separate factors per axis here.
- stream packing follows the renderer inspector ("UV (TEXCOORD0.xy)", "Custom1.x (TEXCOORD0.z)").
- isPlaying stays true while a stopped system still has live particles (observed engine behaviour).
- Play on a playing system does nothing; on a stopping / finished one it restarts at time 0, keeping particles.
- startDelay is counted in simulated time (dt * simulationSpeed) and drawn once per Play.
- prewarm simulates one full loop in 60 equal steps before the first frame (native step size not known).
- the transition to stopped (and the stop action) happens in the next simulate(), not inside Stop.
- deactivation removes the particles and resets the system to stopped without a stop action.
- the lossy-scale extraction ignores shear from non-uniform parent scale under rotation.
- the order inside a step follows the documented module order (native order not visible):
- noise scroll: the offset advances by scrollSpeed (at the normalized system time) per simulated second
- dead particles are swap-removed (buffer order)
- the stop action runs inside the update in which the system is found dead (no live particles, not emitting).
- rate over distance uses the world displacement since the last update, not scaled by simulationSpeed.
- a burst fires in the step whose time window contains it (start inclusive), aged by the rest of the step.
- the native sampling point of the rate curve, the carry across Play / loops and float precision are not known.
- the shape sampling formulas below follow the manual (the native sampling is not visible):
- disabled shape module: emit at origin along +Z
- the order of random draws at emission is native and not known; the order below is this port's.
- randomizeRotationDirection: the fraction of particles whose rotation (and spin) is mirrored
- world-space sub-frame emission: emitter position interpolated linearly between the last and this update
- start velocity = shape direction (rotated, not scaled) x speed, into World space by system rotation and scale.
- velocity over lifetime, limit, drag, dampen and gravity follow the manual; the native forms are not visible:
- module vectors in local space enter a World-space simulation through R S v; world vectors a Local one via S^-1 R^T.
- drag by size uses the largest size axis
- drag by velocity uses the total speed
- the Noise module is native; the steps above are the documented semantics, not Unity's exact field.
- noise size mapping (see _noise)
- Unity's renderer bounds are native (computed in the update, own margin); only the centre is used here.
- constant tangent (1, 0, 0, 1)
- tie order and the native sort keys (e.g. whether Distance uses the camera position or plane) are not known.
- non-uniform transform scale on billboards / World-space particles is undocumented; extents scale along system axes.
- vertex colour Color32 rounding
- horizontal billboard: u +X, v +Z
- rotation sign (positive = clockwise on screen) and normalDirection blend are native conventions
- which viewport dimension, and whether Horizontal / Vertical billboards are included, is native.
- mesh particles with View alignment: mesh axes = camera axes
- submeshes beyond the material count are not drawn (MeshRenderer rule)
- _TextureSampleAdd / _ClipRect / _UIMaskSoftnessX|Y are set by uGUI's CanvasRenderer only; 0 outside a canvas.
- unity_GUIZTestMode (ZTest of UI/Additive and MobileAddHdrColor) comes from canvas rendering; LessEqual (4) here.
- the first subshader is taken as the one the GLES3 device runs.

**`src/live/renderer.js`**

- Unity's sort keys (2, 3) are native; the documented priority is used, ties in submission order.
- tanf / atanf are the device libm's; here double precision rounded to float32 (within one float ulp).
- the probe / lightmap members are set natively; Unity's defaults for a renderer without probes are used.
- world-to-object of a zero-scale transform is native; zeros are passed (the draw covers no pixel).
- the depth-stencil format is device dependent; D24S8 here.

**`src/live/sound.js`**

- CRI's DSP buses are native; the Reverb_short send (a CRIWARE/Reverb bus) is not rendered.
- CRI's REACT curve shapes and HoldType semantics are native; the ramps here are linear.

**`src/live2d/character.js`**

- Mesh.RecalculateBounds is native; centre = (max + min) * 0.5, extents = (max - min) * 0.5 in float32.
- a clip playable created in Update is first sampled after one advance (at t = deltaTime x speed).

**`src/live2d/drawing.js`**

- the values bound for a mesh's missing NORMAL / TANGENT channels are native; (0, 0, 1, 0) / (1, 0, 0, 1) here.
- the mask RenderTexture's filter and wrap modes are never set (engine defaults); bilinear and clamped here.
- _ProjectionParams while a command buffer draws into a render texture is set natively; x = 1 here.

**`src/live2d/math.js`**

- AnimationCurve.Evaluate is native; Unity's documented Hermite form, float32 in source order.

**`src/live2d/motion.js`**

- Mecanim samples streamed clips natively; this is the cubic form of the stored keys, float32 in source order.
- the Animator leaves a binding without a transform at its path unbound.
- what the Animator samples past a clip playable's duration is native; wrapped around the length here.

**`src/live2d/physics.js`**

- Mathf.Sin / Cos / Atan2 / Sqrt use the device's libm; here double precision rounded to float32 (within one float ulp).

**`src/live2d/session.js`**

- the renderer sort is native; sorting order first, equal distances keep the submission (Core index) order.

<!-- engine-notes:end -->
