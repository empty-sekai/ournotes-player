import { ShaderLib } from "../engine/glsl.js";
import { modelIndex } from "../live2d/model.js";

// The models of a story's Character rows. story.json `models` maps a model address (Character/Live2D/<group>/<name>/
// model/<name>) to a model id: the store holds the model's model.json under live2d/<id>/ and its objects in the
// store's object table (loadStoryStore). Returns model(address) -> {id, model (its model.json, model.js modelIndex),
// lib (the ShaderLib of its shaders: one per model id; null without gl)}; `what` names the story in errors.
export const storyModels = (gl, store, story, what) => {
  const byId = new Map();
  return (address) => {
    const id = story.models[address];
    if (typeof id !== "string" || !id) throw new Error(`${what}: model ${address} is not in the story`);
    if (!byId.has(id)) {
      const model = modelIndex(store, `live2d/${id}`);
      byId.set(id, { id, model, lib: gl ? ShaderLib.fromObjects(gl, model.shaders, store) : null });
    }
    return byId.get(id);
  };
};
