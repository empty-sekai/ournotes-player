import { AssetStore, PRODUCT_MANIFEST } from "../data/assets.js";
import { join } from "../engine/core.js";
import { componentClass } from "../engine/prefab.js";
import { MODEL_JSON_FORMAT, MODEL_PRODUCT } from "./model.js";

// Live2D models of the site layout with inline objects (docs/data-format.md "Model manifests of format 2"): a model
// manifest of format 2 (no `schema`) whose files are the moc3, the prefab with the clips, the fade motions, the
// expressions and the materials inline, the atlas pages and a shader directory, indexed by a model.json of format 1.
// legacyModel() reads such a store as a product of live2d.model: the same data as an object table and a model.json of
// format 3, so the viewer reads both through one path.

export const LEGACY_MODEL_MANIFEST_FORMAT = 2, LEGACY_MODEL_JSON_FORMAT = 1;

// whether `info` (a store's manifest without its files) is a model manifest of format 2
export const isLegacyModel = (info) => !!info && info.schema === undefined && info.format === LEGACY_MODEL_MANIFEST_FORMAT;

const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);

// The store of a model manifest of format 2 read as a product of live2d.model (a new AssetStore):
//   model.json   format 3 of the objects below; `motionSync` from the root's components
//   objects      "<model name>:<n>": the prefab's GameObject, the CubismMoc (its moc3 as blob:_bytes), a Texture2D per
//                atlas page the drawables use (the descriptor's fields as its typetree, the PNG as its image), a
//                Material per distinct inline material (its shader a reference), the Shaders of the shader directory
//                (parsed form, variant index, GLES3 programs) and of the materials, the clips (model.json bindings: the paths and attributes
//                the inline clips name), the fade motion list and its fade motions, the expression list and its
//                expressions
//   info         {schema: nnnotes.product/1, product: live2d.model, subject: the model's key}
export const legacyModel = (store) => {
  const m = store.json("model.json");
  if (!m || m.format !== LEGACY_MODEL_JSON_FORMAT)
    throw new Error(`model.json: format ${m && m.format} is not supported (${LEGACY_MODEL_JSON_FORMAT} expected)`);
  const objects = {};
  let next = 1;
  const add = (cls, name, files) => {
    const id = `${m.name}:${next++}`;
    objects[id] = { class: cls, name, files };
    return id;
  };
  const ref = (id) => {
    if (id === null) return null;
    const i = id.lastIndexOf(":");
    return { $ref: { file: id.slice(0, i), pathId: id.slice(i + 1) } };
  };
  const json = (v) => JSON.stringify(v);

  // the shader directory: per shader its parsed form, its variant index (a role per GLES3 program) and the programs
  const shaderDir = dirOf(m.shaders), shaders = {};
  for (const r of store.json(m.shaders)) {
    const files = { json: store.text(shaderDir + r.parsed) };
    const variants = r.variants.map((v) => {
      const role = `program:${v.platform}/${v.file.slice(v.file.lastIndexOf("/") + 1).replace(/\.glsl$/, "")}`;
      if (files[role] !== undefined) throw new Error(`${m.shaders}: ${r.name}: two variants of ${role}`);
      files[role] = store.text(shaderDir + v.file);
      return { ...v, role };
    });
    files.index = json({ name: r.name, variants });
    shaders[r.name] = add("Shader", r.name, files);
  }
  // an inline material; equal ones are one object. A shader the directory lacks (the mask shader of a model without
  // masked drawables) is a Shader object with its name and no programs.
  const materials = new Map();
  const material = (mat) => {
    const name = mat.shader && mat.shader.shader;
    if (typeof name !== "string") throw new Error(`material ${mat.material}: no shader`);
    if (!shaders[name]) shaders[name] = add("Shader", name, { json: json({ name }), index: json({ name, variants: [] }) });
    const doc = json({ ...mat, shader: ref(shaders[name]) });
    if (!materials.has(doc)) materials.set(doc, add("Material", mat.material, { json: doc }));
    return materials.get(doc);
  };
  // a texture descriptor (its path relative to the prefab's directory); one object per path
  const textures = new Map();
  const texture = (d) => {
    const path = join(dirOf(m.prefab), d.texture);
    if (!textures.has(path)) {
      textures.set(path, add("Texture2D", d.name, {
        json: json({ m_Name: d.name, m_Width: d.width, m_Height: d.height, m_TextureFormat: d.format,
                     m_MipCount: d.mipCount, m_ColorSpace: d.colorSpace, m_TextureSettings: d.settings }),
        image: store.bytes(path),
      }));
    }
    return textures.get(path);
  };
  // an inline MonoBehaviour asset ({asset: its class, name, ...its fields}) with the fields `refs` replaces
  const mono = ({ asset, name, ...fields }, refs = {}) =>
    add("MonoBehaviour", fields.m_Name ?? name, { json: json({ $script: `||${asset}`, ...fields, ...refs }) });
  // an inline clip; a binding of a MonoBehaviour (type id 114) names its class as its script class
  const bindings = {};
  const clip = ({ clip: name, bindings: bs, ...fields }) => {
    const stored = bs.map(({ path: _path, attribute: _attribute, class: cls, ...b }) => (b.typeID === 114
      ? { ...b, class: "MonoBehaviour", scriptClass: cls ? `||${cls}` : null } : { ...b, class: cls }));
    const id = add("AnimationClip", name, { json: json({ name, ...fields, bindings: stored }) });
    bindings[id] = bs.map((b) => ({ path: b.path, attribute: b.attribute }));
    return id;
  };
  const moc = add("MonoBehaviour", m.name, { json: json({ $script: "||CubismMoc", m_Name: m.name }),
                                             "blob:_bytes": store.bytes(m.moc3) });

  // the fields of a component with its inline objects replaced by references
  const fields = (cls, f) => {
    switch (cls) {
      case "CubismModel": return { ...f, _moc: ref(moc) };
      case "Live2DCharacter": return { ...f, _motionList: f._motionList.map((c) => ref(clip(c))) };
      case "CubismFadeController": {
        const l = f.CubismFadeMotionList;
        return { ...f, CubismFadeMotionList: ref(mono(l, { CubismFadeMotionObjects: l.CubismFadeMotionObjects.map((o) => ref(mono(o))) })) };
      }
      case "CubismExpressionController": {
        const l = f.ExpressionsList;
        return { ...f, ExpressionsList: l === null ? null
          : ref(mono(l, { CubismExpressionObjects: l.CubismExpressionObjects.map((o) => ref(mono(o))) })) };
      }
      case "CubismRenderer": return { ...f, _mainTexture: f._mainTexture === null ? null : ref(texture(f._mainTexture)) };
      case "MeshRenderer": return { ...f, m_Materials: f.m_Materials.map((x) => ref(material(x))) };
      default: return f;
    }
  };
  const { nodes } = store.json(m.prefab);
  const converted = nodes.map((n) => ({ ...n, components: n.components.map(({ type, class: cls, ...f }) =>
    (cls === undefined ? { type, fields: fields(type, f) } : { type, class: cls, fields: fields(cls, f) })) }));
  const prefab = add("GameObject", m.name, { json: json({ name: m.name, nodes: converted }) });
  const root = new Set(converted[0].components.map(componentClass));

  const model = {
    format: MODEL_JSON_FORMAT, name: m.name, key: m.key, prefab, moc, canvas: m.canvas, textures: [...textures.values()],
    shaders, resources: { cubismMask: material(m.resources.cubismMask), cubismMaskCulling: material(m.resources.cubismMaskCulling) },
    motionSync: root.has("CubismMotionSyncController") && root.has("Live2DMotionSyncCriAudioInput"), bindings,
  };
  return new AssetStore({ text: { "model.json": json(model) }, objects,
                          info: { schema: PRODUCT_MANIFEST, product: MODEL_PRODUCT, subject: m.key } });
};
