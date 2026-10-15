// Synthetic site pieces for the validator tests: content-addressed assets, stored as they are or gzip- / brotli-encoded
// (docs/data-format.md "File entries"), and a Live2D model whose product validates as a model (docs/data-format.md
// "Live2D models"). No game data.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ModelObjects, component, mb, node, ref } from "./live2d-objects.mjs";

export const LIT = "Live2D Cubism/Lit-URP-ADV-optimize", MASK = "Live2D Cubism/Mask";
export const STORY_LIGHTS = "_ADDITIONAL_LIGHTS_VERTEX";
// the extensions an asset may be encoded for
export const COMPRESSIBLE = new Set(["json", "glsl", "moc3", "atlas", "skel", "bin", "wav", "glb"]);

export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
export const bufferOf = (v) => (Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.length)
  : Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
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

const PARSED = { properties: [], subShaders: [{ passes: [{ state: {} }] }] };

// The objects of a Live2D model (live2d-objects.mjs) and its model.json:
//   motionSync   the prefab's MotionSync controller with its CRI audio input (model.json motionSync)
//   storyLights  the Lit programs with _ADDITIONAL_LIGHTS_VERTEX (the story renderer's at quality 4)
//   masked       the second drawable is masked (CUBISM_MASK_ON; the mask shader's program draws the mask)
// The prefab has the root components the model viewer reads, one clip with its fade motion, one expression and two
// drawables. -> {objects: ModelObjects, model: model.json}
export const modelObjects = (name = "m1", { motionSync = false, storyLights = true, masked = true } = {}) => {
  const o = new ModelObjects(`CAB-${name}`);
  const sets = [[], ...(masked ? [["CUBISM_MASK_ON"]] : [])];
  const lit = o.shader(LIT, PARSED, sets.flatMap((k) => (storyLights ? [k, [...k, STORY_LIGHTS]] : [k])).map((k) => [k, glsl]));
  const mask = o.shader(MASK, PARSED, masked ? [[[], glsl]] : []);
  const material = (keywords) => o.material(keywords.length ? "LitMasked" : "Lit", {
    shader: lit, keywords, floats: { _SrcColor: 1, _DstColor: 10, _SrcAlpha: 1, _DstAlpha: 10, _Cull: 0 } });
  const mats = sets.map(material);
  const tex = o.texture("texture_00", { image: png(4, 4) });
  const clip = o.clip({ name: "mtn_idle", loopTime: true, events: [{ functionName: "InstanceId", intParameter: -1 }] });
  const fades = o.mono("CubismFadeMotionList", "common.fadeMotionList", { MotionInstanceIds: [-1], CubismFadeMotionObjects: [
    ref(o.mono("CubismFadeMotionData", "mtn_idle.fade", { MotionName: "mtn_idle", FadeInTime: 0.5, FadeOutTime: 0.5, MotionLength: 1,
      ParameterIds: [], ParameterCurves: [], ParameterFadeInTimes: [], ParameterFadeOutTimes: [] }))] });
  const expressions = o.mono("CubismExpressionList", "common.expressionList", { CubismExpressionObjects: [
    ref(o.mono("CubismExpressionData", "exp_idle.exp3", { FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [] }))] });
  const prefab = o.prefab([
    node(name, [
      mb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: 0, z: 0 },
                              BaseScale: 1, _motionList: [ref(clip)], _expressionList: ["exp_idle"] }),
      mb("CubismFadeController", { CubismFadeMotionList: ref(fades) }),
      mb("CubismExpressionController", { UseLegacyBlendCalculation: 0, CurrentExpressionIndex: -1, ExpressionsList: ref(expressions) }),
      mb("CubismHarmonicMotionController", { BlendMode: 1, ChannelTimescales: [1] }), mb("CubismAutoEyeBlinkInput"),
      mb("CubismEyeBlinkController"), mb("CubismMouthController"), mb("CubismRenderController", { Opacity: 1 }),
      ...(motionSync ? [mb("CubismMotionSyncController", { _motionSyncData: { Settings: [{}] } }),
                        mb("Live2DMotionSyncCriAudioInput", { ListeningChannel: 0 })] : []),
    ]),
    node(`${name}/Drawables`),
    ...[0, 1].map((i) => node(`${name}/Drawables/ArtMesh${i}`, [
      mb("CubismDrawable", { _unmanagedIndex: i }),
      component("MeshRenderer", { m_Materials: [ref(mats[masked && i === 1 ? 1 : 0])] }),
      mb("CubismRenderer", { _localSortingOrder: 0, _color: { r: 1, g: 1, b: 1, a: 1 }, _mainTexture: ref(tex) }),
    ])),
  ]);
  const resources = { cubismMask: o.material("Mask", { shader: mask, floats: { _Cull: 0 } }),
                      cubismMaskCulling: o.material("MaskCulling", { shader: mask, floats: { _Cull: 1 } }) };
  const moc = o.moc(Buffer.concat([Buffer.from("MOC3", "latin1"), Buffer.alloc(252, 5)]), name);
  return { objects: o, model: o.modelJson({ prefab, moc, shaders: [lit, mask], resources, motionSync, name, group: "g" }) };
};

// the extension of an object's file of `role` (as a product layout names its asset)
const roleExt = (role) => (role === "image" ? "png" : role.startsWith("program:") ? "glsl" : role === "blob:_bytes" ? "moc3" : "json");

// The product manifest (nnnotes.product/1 of live2d.model) of a model (modelObjects), its files and the files of its
// objects stored under dir/assets (`encoding` as putFiles)
export const modelProduct = (dir, { objects, model }, encoding = null) => ({
  schema: "nnnotes.product/1", product: "live2d.model", subject: model.key,
  files: { "model.json": putAsset(dir, "model.json", model, encoding) },
  objects: Object.fromEntries(Object.entries(objects.objects).map(([id, o]) => [id, { class: o.class, name: o.name,
    files: Object.fromEntries(Object.entries(o.files).map(([role, v]) => [role, putAsset(dir, `x.${roleExt(role)}`, v, encoding)])) }])),
});

// the sum of size over the files of a product manifest and of its objects
export const productSize = (man) => [man.files, ...Object.values(man.objects).map((o) => o.files)]
  .reduce((n, files) => n + Object.values(files).reduce((k, f) => k + f.size, 0), 0);
