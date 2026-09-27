// Synthetic site pieces for the validator tests: content-addressed assets, stored as they are or gzip- / brotli-encoded
// (docs/data-format.md "File entries"), and a Live2D model whose files validate as a model (docs/data-format.md
// "Live2D models"). No game data.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const LIT = "Live2D Cubism/Lit-URP-ADV-optimize", MASK = "Live2D Cubism/Mask";
export const STORY_LIGHTS = "_ADDITIONAL_LIGHTS_VERTEX";
// the extensions an asset may be encoded for
export const COMPRESSIBLE = new Set(["json", "glsl", "moc3", "atlas", "skel", "bin", "wav", "glb"]);

export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
export const bufferOf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
export const encode = (b, encoding) => (encoding === "gzip" ? zlib.gzipSync(b, { level: 9 })
  : zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));

// Stores the contents `v` (Buffer, string or JSON value) of logical file `p` under dir/assets and returns its file
// entry: {asset, size}, or with `encoding` ("gzip" | "br") and a compressible extension, when that is smaller,
// {asset: <sha256>.<ext>.gz | .br, size, stored}.
export const putAsset = (dir, p, v, encoding = null) => {
  const b = bufferOf(v), ext = p.split(".").pop();
  let asset = `assets/${sha256(b)}.${ext}`, data = b;
  if (encoding && COMPRESSIBLE.has(ext)) {
    const z = encode(b, encoding);
    if (z.length < b.length) { asset += encoding === "gzip" ? ".gz" : ".br"; data = z; }
  }
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, asset), data);
  return data === b ? { asset, size: b.length } : { asset, size: b.length, stored: data.length };
};

// logical path -> contents  =>  logical path -> file entry
export const putFiles = (dir, files, encoding = null) =>
  Object.fromEntries(Object.entries(files).map(([p, v]) => [p, putAsset(dir, p, v, encoding)]));

export const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
};
export const glsl = "#ifdef VERTEX\n#version 300 es\nvoid main() {}\n#endif\n#ifdef FRAGMENT\n#version 300 es\nvoid main() {}\n#endif\n";

const node = (p, components = []) => ({ path: p, name: p.split("/").pop(), active: true, layer: 0,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
const mb = (cls, fields = {}) => ({ type: "MonoBehaviour", class: cls, ...fields });
const material = (keywords) => ({ material: "Lit", shader: { shader: LIT }, keywords,
                                  floats: { _SrcColor: 1, _DstColor: 10, _SrcAlpha: 1, _DstAlpha: 10, _Cull: 0 }, colors: {} });
const maskMaterial = (cull) => ({ material: cull ? "MaskCulling" : "Mask", shader: { shader: MASK }, keywords: [],
                                  floats: { _Cull: cull }, colors: {} });

// the model prefab: the root components the viewer reads, one clip with its fade motion, two drawables (the second
// masked when `masked`), and with `motionSync` the MotionSync controller with its CRI audio input
const prefab = (name, { masked, motionSync }) => ({ key: name, canvas: {}, nodes: [
  node(name, [
    mb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: 0, z: 0 },
                            BaseScale: 1, _motionList: [{ clip: "mtn_idle", stopTime: 1, loopTime: true, startTime: 0, cycleOffset: 0,
                                                          events: [{ functionName: "InstanceId", intParameter: -1 }] }],
                            _expressionList: ["exp_idle"] }),
    mb("CubismFadeController", { CubismFadeMotionList: { MotionInstanceIds: [-1], CubismFadeMotionObjects: [{ MotionName: "mtn_idle" }] } }),
    mb("CubismExpressionController", { UseLegacyBlendCalculation: 0,
                                       ExpressionsList: { CubismExpressionObjects: [{ name: "exp_idle.exp3", Parameters: [] }] } }),
    mb("CubismHarmonicMotionController", { BlendMode: 1 }), mb("CubismAutoEyeBlinkInput"), mb("CubismEyeBlinkController"),
    mb("CubismMouthController"), mb("CubismRenderController"),
    ...(motionSync ? [mb("CubismMotionSyncController", { _motionSyncData: { Settings: [{}] } }),
                      mb("Live2DMotionSyncCriAudioInput", { ListeningChannel: 0 })] : []),
  ]),
  node(`${name}/Drawables`),
  ...[0, 1].map((i) => node(`${name}/Drawables/ArtMesh${i}`, [
    mb("CubismDrawable", { _unmanagedIndex: i }),
    { type: "MeshRenderer", m_Materials: [material(masked && i === 1 ? ["CUBISM_MASK_ON"] : [])] },
    mb("CubismRenderer", { _mainTexture: { texture: "textures/texture_00.png", name: "texture_00", width: 4, height: 4, mipCount: 1 } }),
  ])),
] });

// The logical files of a model (model.json at the root):
//   format       model.json format (2: with motionSync)
//   motionSync   the prefab's MotionSync controller (and model.json motionSync with format 2)
//   storyLights  the Lit variants with _ADDITIONAL_LIGHTS_VERTEX (the story renderer's at quality 4) are packed
//   masked       one drawable is masked (CUBISM_MASK_ON; the mask shader is packed)
export const modelFiles = (name = "m1", { format = 2, motionSync = false, storyLights = true, masked = true } = {}) => {
  const sets = [[], ...(masked ? [["CUBISM_MASK_ON"]] : [])];
  const litSets = sets.flatMap((k) => (storyLights ? [k, [...k, STORY_LIGHTS]] : [k]));
  const shaders = [{ name: LIT, parsed: "lit.json", variants: litSets.map((k, i) => ({ file: `lit/${i}.glsl`, subShader: 0, pass: 0, keywords: k })) },
                   ...(masked ? [{ name: MASK, parsed: "mask.json", variants: [{ file: "mask/0.glsl", subShader: 0, pass: 0, keywords: [] }] }] : [])];
  const files = {
    "model.json": { format, ...(format >= 2 ? { motionSync } : {}), name, key: `Character/Live2D/g/${name}`,
                    moc3: `${name}.moc3`, prefab: `${name}.prefab.json`, textures: ["textures/texture_00.png"],
                    shaders: "shaders/shaders.json", resources: { cubismMask: maskMaterial(0), cubismMaskCulling: maskMaterial(1) } },
    [`${name}.moc3`]: Buffer.concat([Buffer.from("MOC3", "latin1"), Buffer.alloc(252, 5)]),
    [`${name}.prefab.json`]: prefab(name, { masked, motionSync }),
    "textures/texture_00.png": png(4, 4),
    "shaders/shaders.json": shaders,
    "shaders/lit.json": { properties: [], subShaders: [{ passes: [{ state: {} }] }] },
  };
  litSets.forEach((_, i) => { files[`shaders/lit/${i}.glsl`] = glsl; });
  if (masked) { files["shaders/mask.json"] = { properties: [], subShaders: [{ passes: [{ state: {} }] }] }; files["shaders/mask/0.glsl"] = glsl; }
  return files;
};

// a model manifest (format 3) over stored files
export const modelManifest = (id, files) => ({ format: 3, id, key: `Character/Live2D/g/${id}`, model: { group: "g", textures: 1 }, files });
