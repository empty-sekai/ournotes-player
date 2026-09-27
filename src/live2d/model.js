// model.json: the index of one Live2D model's files (docs/data-format.md "model.json"). The model viewer reads it at the
// root of its store; a story reads the model of each character from live2d/<model id>/ of the story's store.

export const MODEL_JSON_FORMATS = Object.freeze([1, 2]);

const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// The model whose model.json is at `dir`/model.json of `assets` (dir "" for the store's root):
//   index       model.json as it is
//   moc3, prefab, shaders   the store paths of the moc3, the prefab and the shader index
//   textureDir  the prefab's directory (the drawables' texture paths are relative to it)
//   shaderDir   the shader index's directory (the ShaderLib base of the model's shaders)
//   resources   the Cubism mask materials (resources.cubismMask / cubismMaskCulling)
//   motionSync  format 2: the prefab's root has a MotionSync controller with a CRI audio input; format 1: null (not
//               stated). The characters take their MotionSync controller from the prefab either way.
export const modelIndex = (assets, dir = "") => {
  const at = (p) => (dir ? `${dir}/${p}` : p);
  const where = at("model.json");
  const index = assets.json(where);
  if (!index || !MODEL_JSON_FORMATS.includes(index.format))
    throw new Error(`${where}: format ${index && index.format} is not supported (${MODEL_JSON_FORMATS.join(" or ")} expected)`);
  for (const k of ["moc3", "prefab", "shaders"])
    if (typeof index[k] !== "string" || !index[k]) throw new Error(`${where}: "${k}" missing`);
  if (!/(^|\/)shaders\.json$/.test(index.shaders)) throw new Error(`${where}: "shaders" must name a shaders.json`);
  if (index.format >= 2 && typeof index.motionSync !== "boolean") throw new Error(`${where}: "motionSync" missing`);
  const moc3 = at(index.moc3), prefab = at(index.prefab), shaders = at(index.shaders);
  return { index, moc3, prefab, shaders, textureDir: dirname(prefab), shaderDir: dirname(shaders),
           resources: index.resources, motionSync: index.format >= 2 ? index.motionSync : null };
};
