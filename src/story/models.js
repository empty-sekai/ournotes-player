import { ShaderLib } from "../engine/glsl.js";
import { modelIndex } from "../live2d/model.js";

// The model products of a story's Character rows, shared by product directory.
export const storyModels = (gl, data) => {
  const store = data.assets;
  const byId = new Map();
  return (address) => {
    const { dir: id } = data.model(address);
    if (!byId.has(id)) {
      const model = modelIndex(store, id);
      byId.set(id, { id, model, lib: gl ? ShaderLib.fromObjects(gl, model.shaders, store) : null });
    }
    return byId.get(id);
  };
};
