// Constants of the game's simple ADV presentation (App.Adv.SimpleAdvPlayer, SimpleAdvView and their helpers): the
// player the game uses for every Overlay episode (MasterAdv._playbackMode 1), the home spot talks and the talks of
// the live result screen.

const F = Math.fround;

// SimpleAdvAdvanceMode / SimpleAdvCompleteBehavior
export const SIMPLE_ADVANCE = Object.freeze({ Manual: 0, Auto: 1 });
export const SIMPLE_COMPLETE = Object.freeze({ CleanupAll: 0, HideTalkWindowKeepCharacters: 1 });

// SimpleAdvView.Slot.EnsureInitialized: new RenderTexture(1536, 1536, R8G8B8A8_UNorm, D16_UNorm) per slot, the stage
// at s_stageLocalPosition (0, 0, -0.25) under the CameraTargetRenderer
export const SIMPLE_RT_SIZE = 1536;
export const SIMPLE_STAGE_POSITION = Object.freeze({ x: 0, y: 0, z: -0.25 });

// SimpleAdvView.s_talkWindowDesignSize and CalculateTalkWindowScale's clamp
export const TALK_WINDOW_SIZE = Object.freeze({ x: 960, y: 320 });
export const TALK_WINDOW_SCALE_MIN = F(0.1);
export const TALK_WINDOW_SCALE_MAX = F(3);

// SimpleAdvView.Show / FadeOutAndHideAsync: CanvasGroup.DOFade over 0.2 s, OutQuad in, InQuad out
export const VIEW_FADE_DURATION = F(0.2);

// SimpleAdvLayoutResolver: the talk root created when the host root has none, anchors (0, 0)-(1, 0.38)
export const DEFAULT_TALK_ROOT = Object.freeze({ min: { x: 0, y: 0 }, max: { x: 1, y: F(0.38) } });

// SimpleAdvView.CalculateAspectScaleBoost: up to +15 % over an aspect range of 0.85 below the design aspect
export const ASPECT_BOOST_MAX = F(0.15);
export const ASPECT_BOOST_RANGE = F(0.85);

// SimpleAdvLayoutProfile.Default (the SimpleAdvLayoutRoot field defaults)
export const LAYOUT_DEFAULT = Object.freeze({
  referenceSize: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, viewport: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
  designAspect: F(2.1666667), slotCount: 5, slotWidth: F(0.3), slotHeight: 1, slotCenterY: 0.5,
  captureBaseScale: F(0.52), displayScale: F(1.85), displayOffset: { x: 0, y: F(0.23) },
});

// SimpleAdvCharacterSlotLayout: per slot count the (PositionType, centre x) of each slot, left to right
export const SLOT_LAYOUT = Object.freeze({
  1: [[5, 0.5]],
  2: [[3, F(0.34)], [7, F(0.66)]],
  3: [[3, F(0.34)], [5, 0.5], [7, F(0.66)]],
  4: [[1, F(0.18)], [3, F(0.34)], [7, F(0.66)], [9, F(0.82)]],
  5: [[1, F(0.18)], [3, F(0.34)], [5, 0.5], [7, F(0.66)], [9, F(0.82)]],
});

// SimpleAdvLayoutDefinitions.Slots: per PositionType the slot's root and image object names and its capture layer
export const SLOT_DEFINITIONS = Object.freeze({
  1: { root: "Position1Root", image: "Position1Image", layer: "Camera1" },
  3: { root: "Position2Root", image: "Position2Image", layer: "Camera2" },
  5: { root: "Position3Root", image: "Position3Image", layer: "Camera3" },
  7: { root: "Position4Root", image: "Position4Image", layer: "Camera4" },
  9: { root: "Position5Root", image: "Position5Image", layer: "Camera5" },
});

// AdvPositionTypeExtensions.CanPlaceCharacter
export const canPlaceCharacter = (pos) => pos === 1 || pos === 3 || pos === 5 || pos === 7 || pos === 9;

// SimpleAdvCharacterCommandHandler.ResolveStageX and LookStageDiffToParamScale
export const STAGE_X = Object.freeze({ 1: F(-1.6), 3: F(-0.8), 5: 0, 7: F(0.8), 9: F(1.6) });
export const LOOK_STAGE_DIFF_TO_PARAM_SCALE = F(0.2);

// SimpleAdvCharacterCommandHandler.EffectSortOrderForCharacter
export const EFFECT_SORT_ORDER = 10000;

// SimpleAdvTextCommandHandler.ResolveTalkLipSyncMode
export const TALK_LIP_SYNC = Object.freeze({ Default: 0, Air: 1, AirHoldOpen: 2, Everyone: 3 });

// AdvCanvasLayer.Character
export const CANVAS_LAYER_CHARACTER = 2;
