// A synthetic Live2D model for the model viewer's tests: a stand-in for Live2D Cubism Core (a few parameters, three
// drawables whose vertices follow ParamAngleX, one of them masked) and one model in two forms, in memory:
//   modelFiles()    the product form: the model's objects (a prefab with the components the runtime reads, clips, fade
//                   motions, expressions, materials, a texture, shaders with their GLES3 programs) and model.json
//                   format 3 (live2d-objects.mjs)
//   legacyFiles()   the files of a model manifest of format 2: the same model with its clips, fade motions,
//                   expressions and materials inline in the prefab, a shader directory and model.json format 1
import { AssetStore } from "../../src/data/assets.js";
import { ModelObjects, component, mb, node, ref } from "./live2d-objects.mjs";
import { headlessImages } from "../../scripts/lib/headless.mjs";

export const IDS = ["ParamAngleX", "ParamEyeLOpen", "ParamMouthOpenY", "ParamBreath"];
const MIN = [-30, 0, 0, 0], MAX = [30, 1, 1, 1], DEF = [0, 1, 0, 0];
export const DRAWABLES = ["ArtMesh0", "ArtMesh1", "ArtMesh2"];
const QUAD = [-0.1, -0.1, 0.1, -0.1, 0.1, 0.1, -0.1, 0.1];

// the stand-in Core: Moc / Model with parameter, part and drawable arrays; update() moves every drawable by
// ParamAngleX / 300 in x (and reports its vertices as changed on every update, as a model in motion does) and sets
// drawable 1's opacity to ParamEyeLOpen
export const fakeCore = () => {
  const made = [];
  const core = {
    Version: { csmGetVersion: () => 0x05010000, csmGetLatestMocVersion: () => 5 },
    Moc: { fromArrayBuffer: () => ({ _release() { core.releasedMocs++; } }) },
    Model: {
      fromMoc() {
        const n = DRAWABLES.length;
        const d = {
          count: n, ids: DRAWABLES.slice(), constantFlags: new Uint8Array([4, 4, 4]), dynamicFlags: new Uint8Array([1, 1, 1]),
          opacities: new Float32Array([1, 1, 1]), renderOrders: new Int32Array([2, 0, 1]), maskCounts: new Int32Array([0, 0, 1]),
          masks: [new Int32Array(0), new Int32Array(0), new Int32Array([0])],
          vertexPositions: DRAWABLES.map((_, i) => Float32Array.from(QUAD, (v, k) => v + (k % 2 ? 0 : i * 0.2))),
          vertexUvs: DRAWABLES.map(() => new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])),
          indices: DRAWABLES.map(() => new Uint16Array([0, 1, 2, 0, 2, 3])),
          multiplyColors: new Float32Array(4 * n).fill(1), screenColors: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
          resetDynamicFlags() { for (let i = 0; i < n; i++) this.dynamicFlags[i] &= 1; },
        };
        const m = {
          parameters: { count: IDS.length, ids: IDS.slice(), minimumValues: Float32Array.from(MIN),
                        maximumValues: Float32Array.from(MAX), defaultValues: Float32Array.from(DEF), values: Float32Array.from(DEF) },
          parts: { count: 1, ids: ["Part0"], opacities: new Float32Array([1]) },
          drawables: d,
          canvasinfo: { CanvasWidth: 600, CanvasHeight: 900, CanvasOriginX: 300, CanvasOriginY: 450, PixelsPerUnit: 600 },
          updates: 0,
          update() {
            this.updates++;
            const ax = this.parameters.values[0] / 300;
            for (let i = 0; i < n; i++) {
              d.vertexPositions[i].set(Float32Array.from(QUAD, (v, k) => v + (k % 2 ? 0 : i * 0.2 + ax)));
              d.dynamicFlags[i] |= 32;
            }
            const o = Math.fround(this.parameters.values[1]);
            if (o !== d.opacities[1]) { d.opacities[1] = o; d.dynamicFlags[1] |= 4; }
          },
          release() { core.releasedModels++; },
        };
        made.push(m);
        return m;
      },
    },
    made, releasedModels: 0, releasedMocs: 0,
  };
  return core;
};

export const MOC = new Uint8Array([0x4d, 0x4f, 0x43, 0x33, 5, 0, 0, 0, 0, 0, 0, 0]);

// ---- the model's objects
export const LIT = "Live2D Cubism/Lit-URP-ADV-optimize", MASK = "Live2D Cubism/Mask";
const fadeData = (name, len, value) => ({
  MotionName: name, FadeInTime: 1, FadeOutTime: 1, MotionLength: len, ParameterFadeInTimes: [-1], ParameterFadeOutTimes: [-1],
  ParameterIds: ["ParamAngleX"], ParameterCurves: [{ m_Curve: [{ time: 0, value, inSlope: 0, outSlope: 0 },
                                                               { time: len, value, inSlope: 0, outSlope: 0 }] }],
});
const clip = (o, name, id, len, value, opacity) => o.clip({
  name, stopTime: len, loopTime: true, events: [{ functionName: "InstanceId", intParameter: id }],
  bindings: [{ cls: "CubismParameter", path: "Parameters/ParamAngleX", attribute: "Value" },
             ...(opacity === undefined ? [] : [{ cls: "CubismRenderController", path: "", attribute: "Opacity" }])],
  constant: [value, ...(opacity === undefined ? [] : [opacity])],
});

// ---- shaders: the parsed forms and GLES3 programs
const program = "#ifdef VERTEX\n#version 300 es\nvoid main() {}\n#endif\n#ifdef FRAGMENT\n#version 300 es\nvoid main() {}\n#endif\n";
const V = (val, name = "") => ({ val, name });
const pass = (blend) => ({ state: {
  rtBlend0: { srcBlend: blend[0], destBlend: blend[1], srcBlendAlpha: blend[2], destBlendAlpha: blend[3], blendOp: V(0),
              blendOpAlpha: V(0), colMask: V(15) },
  zTest: V(4), zWrite: V(0), culling: V(0, "_Cull"), offsetFactor: V(0), offsetUnits: V(0), stencilRef: V(0),
  stencilReadMask: V(255), stencilWriteMask: V(255), rtSeparateBlend: false, alphaToMask: V(0),
  stencilOp: { comp: V(8), pass: V(0), fail: V(0), zFail: V(0) },
  stencilOpFront: { comp: V(8), pass: V(0), fail: V(0), zFail: V(0) }, stencilOpBack: { comp: V(8), pass: V(0), fail: V(0), zFail: V(0) },
} });
const litPass = pass([V(1, "_SrcColor"), V(10, "_DstColor"), V(1, "_SrcAlpha"), V(10, "_DstAlpha")]);
const maskPass = pass([V(1), V(1), V(1), V(1)]);
const parsed = (p) => ({ properties: [], subShaders: [{ tags: { tags: [] }, passes: [p] }] });

// a 4 x 4 PNG as far as its header goes
const PNG = new Uint8Array(24);
PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4]);

export const modelFiles = ({ motionSync = false, physics = true, mipCount = 1, opacity, missing = false, json = null } = {}) => {
  const o = new ModelObjects();
  const lit = o.shader(LIT, parsed(litPass), [[[], program], [["CUBISM_MASK_ON"], program]]);
  const mask = o.shader(MASK, parsed(maskPass), [[[], program]]);
  const material = (keywords) => o.material(keywords.length ? "LitMasked" : "Lit", {
    shader: lit, keywords, floats: { _SrcColor: 1, _DstColor: 10, _SrcAlpha: 1, _DstAlpha: 10, _Cull: 0 } });
  const lits = [material([]), material(["CUBISM_MASK_ON"])];
  const tex = o.texture("texture_00", { mipCount, image: PNG });
  const fades = o.mono("CubismFadeMotionList", "common.fadeMotionList", { MotionInstanceIds: [-1, -2],
    CubismFadeMotionObjects: [o.mono("CubismFadeMotionData", "mtn_idle.fade", fadeData("mtn_idle", 2, 0)),
                              o.mono("CubismFadeMotionData", "mtn_turn.fade", fadeData("mtn_turn", 1, 30))].map(ref) });
  const expressions = o.mono("CubismExpressionList", "common.expressionList", { CubismExpressionObjects: [
    o.mono("CubismExpressionData", "exp_idle.exp3", { FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [] }),
    o.mono("CubismExpressionData", "exp_closed.exp3", { FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [
      ...(missing ? [{ Id: "ParamMissing", Value: 1, Blend: 1 }] : []), { Id: "ParamEyeLOpen", Value: 0, Blend: 2 }] }),
  ].map(ref) });
  const root = "model";
  const prefab = o.prefab([
    node(root, [
      mb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: -0.41, z: 0 },
                              BaseScale: 1.6, _motionList: [clip(o, "mtn_idle", -1, 2, 0), clip(o, "mtn_turn", -2, 1, 30, opacity)].map(ref),
                              _expressionList: ["exp_idle", "exp_closed"] }),
      mb("CubismFadeController", { CubismFadeMotionList: ref(fades) }),
      mb("CubismExpressionController", { UseLegacyBlendCalculation: 0, CurrentExpressionIndex: -1, CurrentFadeInTime: -1,
                                         ExpressionsList: ref(expressions) }),
      mb("CubismHarmonicMotionController", { BlendMode: 1, ChannelTimescales: [1] }),
      mb("CubismAutoEyeBlinkInput", { Mean: 2.5, MaximumDeviation: 2, Timescale: 10 }),
      mb("CubismEyeBlinkController", { BlendMode: 2, EyeOpening: 1 }),
      mb("CubismMouthController", { BlendMode: 0, MouthOpening: 0 }),
      ...(physics ? [mb("CubismPhysicsController", { _rig: { Fps: 60, Gravity: { x: 0, y: -1 }, Wind: { x: 0, y: 0 }, SubRigs: [] } })] : []),
      mb("CubismRenderController", { _sortingOrder: 0, Opacity: 1 }),
    ]),
    node(`${root}/Parameters`),
    ...IDS.map((id) => node(`${root}/Parameters/${id}`, [mb("CubismParameter"),
      ...(id === "ParamEyeLOpen" ? [mb("CubismEyeBlinkParameter")] : []),
      ...(id === "ParamBreath" ? [mb("CubismHarmonicMotionParameter", { Channel: 0, Direction: 2, NormalizedOrigin: 0.5,
                                                                         NormalizedRange: 0.5, Duration: 3 })] : [])])),
    node(`${root}/Drawables`),
    ...DRAWABLES.map((id, i) => node(`${root}/Drawables/${id}`, [
      mb("CubismDrawable", { _unmanagedIndex: i }),
      component("MeshRenderer", { m_Materials: [ref(lits[i === 2 ? 1 : 0])] }),
      mb("CubismRenderer", { _localSortingOrder: 0, _color: { r: 1, g: 1, b: 1, a: 1 }, _mainTexture: ref(tex) }),
    ])),
  ]);
  const resources = { cubismMask: o.material("Mask", { shader: mask, floats: { _Cull: 0 } }),
                      cubismMaskCulling: o.material("MaskCulling", { shader: mask, floats: { _Cull: 1 } }) };
  const store = o.store({ prefab, moc: o.moc(MOC), shaders: [lit, mask], resources, motionSync,
                          info: { schema: "nnnotes.product/1", product: "live2d.model", subject: "model" } });
  if (json) store._text.set("model.json", JSON.stringify(json(JSON.parse(store.text("model.json")))));
  return headlessImages(store);
};

// ---- the same model as the files of a model manifest of format 2 (masked: drawable 2's material masks it, and the
// shader directory holds the mask shader)
export const LEGACY_KEY = "Character/Live2D/test/model/model/model";
export const legacyFiles = ({ masked = true } = {}) => {
  const lnode = (path, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 0,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
  const lmb = (cls, fields = {}) => ({ type: "MonoBehaviour", class: cls, ...fields });
  const inline = (asset, name, fields) => ({ asset, name, m_Name: name, ...fields });
  const material = (name, shader, keywords, floats) => ({ material: name, shader: { shader }, keywords, invalidKeywords: [],
    renderQueue: -1, tags: {}, disabledPasses: [], textures: {}, ints: {}, floats, colors: {} });
  const lit = (keywords) => material(keywords.length ? "LitMasked" : "Lit", LIT, keywords,
                                     { _SrcColor: 1, _DstColor: 10, _SrcAlpha: 1, _DstAlpha: 10, _Cull: 0 });
  const clip = (name, id, len, value) => ({
    clip: name, sampleRate: 30, wrapMode: 0, startTime: 0, stopTime: len, loopTime: true, cycleOffset: 0,
    events: [{ functionName: "InstanceId", intParameter: id }],
    bindings: [{ path: "Parameters/ParamAngleX", typeID: 114, class: "CubismParameter", attribute: "Value" }],
    streamed: { curveCount: 0, frames: [] }, dense: { curveCount: 0 }, constant: [value],
  });
  const texture = { texture: "textures/texture_00-0.png", name: "texture_00", width: 4, height: 4, format: 4, mipCount: 1,
                    colorSpace: 1, settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
  const root = "model";
  const nodes = [
    lnode(root, [
      lmb("CubismModel", { _moc: { asset: "CubismMoc", name: "model" } }),
      lmb("Live2DCharacter", { DefaultMotionName: "mtn_idle", DefaultExpressionName: "exp_idle", BasePosition: { x: 0, y: -0.41, z: 0 },
                               BaseScale: 1.6, _motionList: [clip("mtn_idle", -1, 2, 0), clip("mtn_turn", -2, 1, 30)],
                               _expressionList: ["exp_idle", "exp_closed"] }),
      lmb("CubismFadeController", { CubismFadeMotionList: inline("CubismFadeMotionList", "common.fadeMotionList", {
        MotionInstanceIds: [-1, -2],
        CubismFadeMotionObjects: [inline("CubismFadeMotionData", "mtn_idle.fade", fadeData("mtn_idle", 2, 0)),
                                  inline("CubismFadeMotionData", "mtn_turn.fade", fadeData("mtn_turn", 1, 30))] }) }),
      lmb("CubismExpressionController", { UseLegacyBlendCalculation: 0, CurrentExpressionIndex: -1, CurrentFadeInTime: -1,
        ExpressionsList: inline("CubismExpressionList", "common.expressionList", { CubismExpressionObjects: [
          inline("CubismExpressionData", "exp_idle.exp3", { FadeInTime: 0.5, FadeOutTime: 0.5, Parameters: [] }),
          inline("CubismExpressionData", "exp_closed.exp3", { FadeInTime: 0.5, FadeOutTime: 0.5,
                                                              Parameters: [{ Id: "ParamEyeLOpen", Value: 0, Blend: 2 }] }),
        ] }) }),
      lmb("CubismHarmonicMotionController", { BlendMode: 1, ChannelTimescales: [1] }),
      lmb("CubismAutoEyeBlinkInput", { Mean: 2.5, MaximumDeviation: 2, Timescale: 10 }),
      lmb("CubismEyeBlinkController", { BlendMode: 2, EyeOpening: 1 }),
      lmb("CubismMouthController", { BlendMode: 0, MouthOpening: 0 }),
      lmb("CubismPhysicsController", { _rig: { Fps: 60, Gravity: { x: 0, y: -1 }, Wind: { x: 0, y: 0 }, SubRigs: [] } }),
      lmb("CubismRenderController", { _sortingOrder: 0, Opacity: 1 }),
    ]),
    lnode(`${root}/Parameters`),
    ...IDS.map((id) => lnode(`${root}/Parameters/${id}`, [lmb("CubismParameter"),
      ...(id === "ParamEyeLOpen" ? [lmb("CubismEyeBlinkParameter")] : []),
      ...(id === "ParamBreath" ? [lmb("CubismHarmonicMotionParameter", { Channel: 0, Direction: 2, NormalizedOrigin: 0.5,
                                                                          NormalizedRange: 0.5, Duration: 3 })] : [])])),
    lnode(`${root}/Drawables`),
    ...DRAWABLES.map((id, i) => lnode(`${root}/Drawables/${id}`, [
      lmb("CubismDrawable", { _unmanagedIndex: i }),
      { type: "MeshRenderer", m_Materials: [lit(masked && i === 2 ? ["CUBISM_MASK_ON"] : [])] },
      lmb("CubismRenderer", { _localSortingOrder: 0, _color: { r: 1, g: 1, b: 1, a: 1 }, _mainTexture: texture }),
    ])),
  ];
  const variant = (dir, i, keywords) => ({ file: `${dir}/gles3/s0p0_vertex_${i}.glsl`, platform: "gles3", subShader: 0,
                                           pass: 0, stage: "vertex", type: "GLES3", keywords });
  const shaders = [{ name: LIT, source: "CAB-test", parsed: "lit.json", variants: [variant("lit", 0, []), variant("lit", 1, ["CUBISM_MASK_ON"])] },
                   ...(masked ? [{ name: MASK, source: "CAB-test", parsed: "mask.json", variants: [variant("mask", 0, [])] }] : [])];
  const text = {
    "model.json": JSON.stringify({
      format: 1, name: "model", key: LEGACY_KEY, moc3: "model.moc3", prefab: "model.prefab.json", textures: [texture.texture],
      canvas: { pixelsPerUnit: 600, originX: 300, originY: 450, width: 600, height: 900, mocVersion: 5 },
      shaders: "shaders/shaders.json",
      resources: { cubismMask: material("Mask", MASK, [], { _Cull: 0 }), cubismMaskCulling: material("MaskCulling", MASK, [], { _Cull: 1 }) },
    }),
    "model.prefab.json": JSON.stringify({ key: LEGACY_KEY, nodes, canvas: {} }),
    "shaders/shaders.json": JSON.stringify(shaders),
    "shaders/lit.json": JSON.stringify({ name: LIT, ...parsed(litPass) }),
    "shaders/lit/gles3/s0p0_vertex_0.glsl": program,
    "shaders/lit/gles3/s0p0_vertex_1.glsl": program,
    ...(masked ? { "shaders/mask.json": JSON.stringify({ name: MASK, ...parsed(maskPass) }),
                   "shaders/mask/gles3/s0p0_vertex_0.glsl": program } : {}),
  };
  return new AssetStore({ text, bytes: { "model.moc3": MOC, [texture.texture]: PNG },
                          info: { format: 2, id: "model", key: LEGACY_KEY, model: { group: "test", textures: 1 } } });
};

export const withCore = async (fn) => {
  const saved = globalThis.Live2DCubismCore, core = fakeCore();
  globalThis.Live2DCubismCore = core;
  try { return await fn(core); } finally { if (saved) globalThis.Live2DCubismCore = saved; else delete globalThis.Live2DCubismCore; }
};
