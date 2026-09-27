import { ShaderLib } from "../engine/glsl.js";
import { modelIndex } from "../live2d/model.js";

const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");

// The models of a story's Character rows. story.json `models` maps a model address (Character/Live2D/<group>/<name>/
// model/<name>) to
//   a model id (story manifest /2): the store holds the model under live2d/<id>/ (model.json and the files it names);
//     the character draws with the model's own shaders and Cubism mask materials (model.json resources);
//   {dir, moc3, prefab} (story manifest /1): the model's files in `dir` among the story's files; the character draws
//     with the story's shaders (`lib`) and scene.json resources (`resources`).
// Returns model(address) -> {id (null for /1), model: {prefab, moc3 (store paths), textureDir, resources}, lib (the
// ShaderLib to draw with: one per model id; null without gl)}; `what` names the story in errors.
export const storyModels = (gl, store, story, what, { lib = null, resources = null } = {}) => {
  const byId = new Map();
  return (address) => {
    const m = story.models[address];
    if (typeof m === "string" && m) {
      if (!byId.has(m)) {
        const model = modelIndex(store, `live2d/${m}`);
        byId.set(m, { id: m, model, lib: gl ? new ShaderLib(gl, model.shaderDir, store) : null });
      }
      return byId.get(m);
    }
    if (m && typeof m === "object" && typeof m.dir === "string" && typeof m.moc3 === "string" && typeof m.prefab === "string")
      return { id: null, lib, model: { prefab: join(m.dir, m.prefab), moc3: join(m.dir, m.moc3), textureDir: m.dir, resources } };
    throw new Error(`${what}: model ${address} is not in the story`);
  };
};
