// Synthetic Live2D models in the product form (docs/data-format.md "Objects" and "model.json"): objects in memory that
// name each other by reference, and model.json format 3, for the tests of the model viewer and the story's characters.
//
//   const o = new ModelObjects();
//   const clip = o.clip({ name: "idle", bindings: [{ cls: "CubismParameter", path: "Parameters/ParamAngleX",
//                                                     attribute: "Value" }], constant: [0], ... });
//   const prefab = o.prefab([node("model", [mb("Live2DCharacter", { _motionList: [ref(clip)], ... })]), ...]);
//   const store = o.store({ prefab, moc: o.moc(bytes), shaders: [lit, mask], resources: {...}, motionSync: false });
import { AssetStore } from "../../src/data/assets.js";

export const FILE = "CAB-test";

// a reference to an object id
export const ref = (id) => {
  const i = id.lastIndexOf(":");
  return { $ref: { file: id.slice(0, i), pathId: id.slice(i + 1) } };
};

// prefab.json nodes and components
export const node = (path, components = [], extra = {}) => ({
  path, name: path.split("/").pop(), pathId: "0", transformPathId: "0", active: true, layer: 0,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  ...extra, components,
});
export const mb = (cls, fields = {}) => ({ type: "MonoBehaviour", pathId: "0", script: `Test||${cls}`, fields });
export const component = (type, fields = {}) => ({ type, pathId: "0", fields });

export class ModelObjects {
  constructor(file = FILE) {
    this.file = file;
    this.next = 1;
    this.objects = {};          // id -> {class, name, files}
    this.bindings = {};         // clip id -> [{path, attribute}] (model.json bindings)
  }

  add(cls, name, files) {
    const id = `${this.file}:${this.next++}`;
    this.objects[id] = { class: cls, name, files };
    return id;
  }

  // a MonoBehaviour outside the hierarchy (mono.json)
  mono(cls, name, fields = {}) {
    return this.add("MonoBehaviour", name, { json: JSON.stringify({ $script: `Test||${cls}`, m_Name: name, ...fields }) });
  }

  // an AnimationClip whose bindings are {cls, path, attribute}: clip.json (a MonoBehaviour binding names its script
  // class) and the names model.json gives them
  clip({ name, bindings = [], events = [], stopTime = 1, loopTime = false, startTime = 0, cycleOffset = 0,
         streamed = { curveCount: 0, frames: [] }, dense = { curveCount: 0 }, constant = [] }) {
    const doc = {
      name, sampleRate: 30, wrapMode: 0, startTime, stopTime, loopTime, cycleOffset, events,
      bindings: bindings.map((b) => ({ pathCrc: 0, attributeCrc: 0, typeID: 114, class: "MonoBehaviour", customType: 0,
                                       pptr: false, int: false, serializeReference: false, scriptClass: `Test||${b.cls}` })),
      streamed, dense, constant, pptrCurveMapping: [],
    };
    const id = this.add("AnimationClip", name, { json: JSON.stringify(doc) });
    this.bindings[id] = bindings.map((b) => ({ path: b.path, attribute: b.attribute }));
    return id;
  }

  // a Texture2D: its typetree (size, mip count, settings) and its image
  texture(name, { width = 4, height = 4, mipCount = 1, settings = { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 },
                  image = new Uint8Array(0) } = {}) {
    const json = { m_Name: name, m_Width: width, m_Height: height, m_MipCount: mipCount, m_ColorSpace: 1,
                   m_TextureSettings: settings };
    return this.add("Texture2D", name, { json: JSON.stringify(json), image });
  }

  material(name, { shader, keywords = [], floats = {}, colors = {} }) {
    const doc = { material: name, shader: ref(shader), keywords, invalidKeywords: [], renderQueue: -1, tags: {},
                  disabledPasses: [], textures: {}, ints: {}, floats, colors };
    return this.add("Material", name, { json: JSON.stringify(doc) });
  }

  // a Shader: its parsed form (`parsed`), and per variant [keywords, GLSL] a GLES3 program of sub shader 0, pass 0
  shader(name, parsed, variants) {
    const files = { json: JSON.stringify({ name, ...parsed }) };
    const index = { name, variants: variants.map(([keywords], i) => ({
      file: `x/gles3/s0p0_vertex_${i}.glsl`, platform: "gles3", subShader: 0, pass: 0, stage: "vertex", type: "GLES3",
      keywords, role: `program:gles3/s0p0_vertex_${i}` })) };
    files.index = JSON.stringify(index);
    variants.forEach(([, glsl], i) => { files[`program:gles3/s0p0_vertex_${i}`] = glsl; });
    return this.add("Shader", name, files);
  }

  // the CubismMoc MonoBehaviour holding the moc3
  moc(bytes, name = "model") {
    return this.add("MonoBehaviour", name, { json: JSON.stringify({ $script: "Test||CubismMoc", m_Name: name }),
                                             "blob:_bytes": bytes });
  }

  // a root GameObject's prefab.json
  prefab(nodes, name = nodes[0].name) {
    return this.add("GameObject", name, { json: JSON.stringify({ name, nodes }) });
  }

  // model.json format 3 of these objects (shaders: Shader ids)
  modelJson({ prefab, moc, shaders, resources, motionSync = false, name = "model", group = "test" }) {
    return {
      format: 3, name, key: `Character/Live2D/${group}/${name}/model/${name}`, prefab, moc,
      canvas: { pixelsPerUnit: 600, originX: 300, originY: 450, width: 600, height: 900, mocVersion: 5 },
      textures: Object.entries(this.objects).filter(([, o]) => o.class === "Texture2D").map(([id]) => id),
      shaders: Object.fromEntries(shaders.map((id) => [this.objects[id].name, id])),
      resources, motionSync, bindings: this.bindings,
    };
  }

  // an AssetStore with model.json at `dir` (modelJson's options), the objects, and the other files `text` / `bytes`
  store({ dir = "", text = {}, bytes = {}, info = null, ...model }) {
    const where = dir ? `${dir}/model.json` : "model.json";
    return new AssetStore({ text: { ...text, [where]: JSON.stringify(this.modelJson(model)) }, bytes,
                            objects: this.objects, info });
  }
}
