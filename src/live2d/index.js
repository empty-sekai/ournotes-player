// Public API of ournotes-player/live2d: the Live2D model viewer.
//   ModelPlayer            a model in a host element (canvas, requestAnimationFrame, events)
//   defineOurnotesLive2D   defines the <ournotes-live2d> custom element (the "ournotes-player/live2d/element" entry
//                          defines it on import)
//   ModelSession           the DOM-free model session over a WebGL2 context (drive it yourself)
//   AssetStore             the files of one model (from a model manifest or in memory)
// The page must load Live2D Cubism Core (Live2D's live2dcubismcore.min.js) itself; it is not part of this package.
export { AssetStore } from "../data/assets.js";
export { MODEL_FRAME_RATE, ModelSession } from "./session.js";
export { ModelPlayer } from "./player.js";
export { OurnotesLive2DElement, defineOurnotesLive2D } from "./element.js";
