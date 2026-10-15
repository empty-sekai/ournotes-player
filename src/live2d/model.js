// model.json: one Live2D model of a product (docs/data-format.md "model.json"). The model viewer reads it at the root
// of its store; a story reads the model of each character from live2d/<model id>/ of the story's store. Its objects
// are in the store's object table.

export const MODEL_JSON_FORMAT = 3;
// the product of a model manifest (a product manifest, nnnotes.product/1)
export const MODEL_PRODUCT = "live2d.model";

// The model.json at `dir`/model.json of `assets` (dir "" for the store's root), its objects checked:
//   prefab      the model's root GameObject (its prefab.json)
//   moc         the CubismMoc MonoBehaviour (its json names the CubismMoc script); the moc3 is its blob:_bytes file
//   shaders     {Unity shader name: Shader object}: the shaders its materials and the Cubism mask materials name
//   resources   {cubismMask, cubismMaskCulling}: the Cubism mask Materials (Resources/Live2D/Cubism/Materials)
//   bindings    {AnimationClip object: [{path, attribute}]}: per binding of the clip, the path below the model's root
//               ("" for the root) and the attribute it animates, null where the hierarchy names none
//   motionSync  the root has a MotionSync controller with a CRI audio input (the characters take the controller
//               from the prefab either way)
//   name, key, canvas, textures   facts about the model
export const modelIndex = (assets, dir = "") => {
  const where = dir ? `${dir}/model.json` : "model.json";
  const m = assets.json(where);
  if (!m || m.format !== MODEL_JSON_FORMAT)
    throw new Error(`${where}: format ${m && m.format} is not supported (${MODEL_JSON_FORMAT} expected)`);
  const table = (k) => {
    if (!m[k] || typeof m[k] !== "object" || Array.isArray(m[k])) throw new Error(`${where}: "${k}" missing`);
    return m[k];
  };
  try {
    assets.object(m.prefab, "GameObject");
    assets.object(m.moc, "MonoBehaviour");
    const script = assets.objectJson(m.moc).$script;
    if (typeof script !== "string" || script.slice(script.lastIndexOf("|") + 1) !== "CubismMoc")
      throw new Error(`${m.moc}: not a CubismMoc`);
    for (const id of Object.values(table("shaders"))) assets.object(id, "Shader");
    const r = table("resources");
    for (const k of ["cubismMask", "cubismMaskCulling"]) assets.object(r[k], "Material");
    for (const id of Object.keys(table("bindings"))) assets.object(id, "AnimationClip");
  } catch (e) {
    throw new Error(`${where}: ${e.message}`, { cause: e });
  }
  if (typeof m.motionSync !== "boolean") throw new Error(`${where}: "motionSync" missing`);
  return m;
};
