import { PRODUCT_MANIFEST } from "../data/assets.js";
import { MODEL_PRODUCT } from "../live2d/model.js";
import { fetchStoryProduct, loadStoryProducts } from "./store.js";

// Story products and their selected language, media and model dependencies share one object store.
export const STORY_MANIFEST_FORMAT = PRODUCT_MANIFEST;
export const STORY_MANIFEST_FORMATS = Object.freeze([STORY_MANIFEST_FORMAT]);
export { MODEL_PRODUCT };

// Checks that `mm` (fetched from `where`) is the model manifest of model `id`: a product manifest of live2d.model whose
// subject is a model key Character/Live2D/<group>/<id>/model/<id>.
export const checkModelManifest = (mm, id, where) => {
  if (!mm || mm.schema !== PRODUCT_MANIFEST || mm.product !== MODEL_PRODUCT || !mm.files || typeof mm.files !== "object"
      || !mm.objects || typeof mm.objects !== "object")
    throw new Error(`${where}: not a model manifest (${PRODUCT_MANIFEST} of ${MODEL_PRODUCT})`);
  const name = String(mm.subject).split("/").pop();
  if (name !== id) throw new Error(`${where}: model ${name}, the story names it ${id}`);
};


export const fetchStoryManifest = fetchStoryProduct;

// A fetched index can be reused across language switches through the public `manifest` option.
export const loadStoryStore = (url, { manifest = null, ...options } = {}) =>
  loadStoryProducts(url, { ...options, head: manifest });
