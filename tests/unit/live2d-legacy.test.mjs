// Models of a model manifest of format 2 (src/live2d/legacy.js): read as a product of live2d.model, and played like
// the same model in the product form (live2d-fixture.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_KEY, LIT, MASK, MOC, legacyFiles, modelFiles, withCore } from "./live2d-fixture.mjs";
import { AssetStore } from "../../src/data/assets.js";
import { componentClass } from "../../src/engine/prefab.js";
import { isLegacyModel, legacyModel } from "../../src/live2d/legacy.js";
import { modelIndex } from "../../src/live2d/model.js";
import { ModelSession } from "../../src/live2d/session.js";
import { headlessGL, headlessImages } from "../../scripts/lib/headless.mjs";

const PRODUCT = { schema: "nnnotes.product/1", product: "live2d.model", subject: LEGACY_KEY };

test("a model manifest of format 2 is recognised by its info", () => {
  assert.equal(isLegacyModel(legacyFiles().info), true);
  assert.equal(isLegacyModel({ format: 3, id: "model" }), false);
  assert.equal(isLegacyModel({ schema: "nnnotes.product/1", product: "live2d.model", format: 2 }), false);
  assert.equal(isLegacyModel(null), false);
});

test("its files become an object table and model.json format 3", () => {
  const store = legacyModel(legacyFiles());
  assert.deepEqual(store.info, PRODUCT);
  const m = modelIndex(store);
  assert.equal(m.key, LEGACY_KEY);
  assert.equal(m.motionSync, false);
  assert.deepEqual(Object.keys(m.shaders).sort(), [LIT, MASK]);
  assert.deepEqual([...store.objectBytes(m.moc, "blob:_bytes")], [...MOC]);
  // the prefab's inline objects are references: the moc, the clips, the fade list, the expressions
  const root = store.prefab(m.prefab).nodes[0];
  const fields = (cls) => root.components.find((c) => componentClass(c) === cls).fields;
  assert.equal(store.ref(fields("CubismModel")._moc, "MonoBehaviour"), m.moc);
  const clips = fields("Live2DCharacter")._motionList.map((r) => store.ref(r, "AnimationClip"));
  assert.deepEqual(clips.map((id) => store.clip(id).name), ["mtn_idle", "mtn_turn"]);
  assert.deepEqual(Object.keys(m.bindings), clips);
  assert.deepEqual(m.bindings[clips[0]], [{ path: "Parameters/ParamAngleX", attribute: "Value" }]);
  assert.deepEqual(store.clip(clips[0]).bindings, [{ typeID: 114, class: "MonoBehaviour", scriptClass: "||CubismParameter" }]);
  const fades = store.mono(store.ref(fields("CubismFadeController").CubismFadeMotionList, "MonoBehaviour"));
  assert.deepEqual(fades.CubismFadeMotionObjects.map((r) => store.mono(store.ref(r)).m_Name), ["mtn_idle.fade", "mtn_turn.fade"]);
  const exprs = store.mono(store.ref(fields("CubismExpressionController").ExpressionsList, "MonoBehaviour"));
  assert.deepEqual(exprs.CubismExpressionObjects.map((r) => store.mono(store.ref(r)).m_Name), ["exp_idle.exp3", "exp_closed.exp3"]);
  // one Texture2D per atlas page, one Material per distinct material (two drawables share Lit)
  const ofClass = (cls) => [...store._objects.keys()].filter((id) => store.object(id).class === cls);
  assert.deepEqual(m.textures, ofClass("Texture2D"));
  assert.deepEqual(store.texture(m.textures[0]),
                   { id: m.textures[0], name: "texture_00", width: 4, height: 4, mipCount: 1, colorSpace: 1,
                     settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } });
  assert.deepEqual(ofClass("Material").map((id) => store.material(id).material).sort(), ["Lit", "LitMasked", "Mask", "MaskCulling"]);
  assert.equal(store.ref(store.material(m.resources.cubismMask).shader, "Shader"), m.shaders[MASK]);
  // the shader directory's variants are programs of the Shader objects
  const index = store.objectJson(m.shaders[LIT], "index");
  assert.deepEqual(index.variants.map((v) => [v.role, v.keywords]),
                   [["program:gles3/s0p0_vertex_0", []], ["program:gles3/s0p0_vertex_1", ["CUBISM_MASK_ON"]]]);
  assert.match(store.objectText(m.shaders[LIT], "program:gles3/s0p0_vertex_1"), /#ifdef VERTEX/);
  assert.equal(store.objectJson(m.shaders[LIT]).name, LIT);
});

test("a model without masked drawables has a mask shader without programs", () => {
  const store = legacyModel(legacyFiles({ masked: false }));
  const m = modelIndex(store);
  assert.deepEqual(store.roles(m.shaders[MASK]).sort(), ["index", "json"]);
  assert.deepEqual(store.objectJson(m.shaders[MASK], "index"), { name: MASK, variants: [] });
  assert.equal(store.ref(store.material(m.resources.cubismMaskCulling).shader, "Shader"), m.shaders[MASK]);
});

test("model.json other than format 1 is refused", () => {
  const files = legacyFiles();
  files._text.set("model.json", JSON.stringify({ ...files.json("model.json"), format: 2 }));
  assert.throws(() => legacyModel(files), /model\.json: format 2 is not supported \(1 expected\)/);
});

test("the model plays as the same model in the product form does", () => withCore(async () => {
  const open = (assets) => ModelSession.create({ gl: headlessGL(), assets, seed: 3 });
  const a = await open(headlessImages(legacyModel(legacyFiles()))), b = await open(modelFiles());
  for (const k of ["name", "motions", "expressions", "defaultMotion", "defaultExpression", "hasPhysics"]) assert.deepEqual(a[k], b[k], k);
  // what the character made of the objects: clips, fades, expressions, the drawables' materials and textures
  const built = (s) => {
    const ch = s.character, plain = (v) => JSON.parse(JSON.stringify(v));
    return plain({
      clips: [...ch.clips.values()].map((c) => ({ name: c.name, instanceId: c.instanceId, streamed: c.streamed, constants: c.constants,
                                                  fieldCurves: c.fieldCurves, fieldConstants: c.fieldConstants })),
      fades: [...ch.fadeById.entries()].map(([id, f]) => [id, f.name, f.objectName, f.length, [...f.curveOf.entries()]]),
      expressions: ch.expressions,
      renderers: ch.renderers.map((r) => {
        const { shader: _s, ...mat } = r.material, { id: _id, ...tex } = s.assets.texture(r.texture);
        return { mat, tex };
      }),
    });
  };
  assert.deepEqual(built(a), built(b));
  const state = (s) => ({ params: [...s.character.params.value], shown: s.character.renderers.map((r) => [...s.character.displayed(r).pos]),
                          junctions: s.character.junctions.map((j) => j.tile) });
  for (const [motion, expression] of [["mtn_turn", "exp_closed"], ["mtn_idle", "exp_idle"]]) {
    for (const s of [a, b]) { s.playMotion(motion, { fade: 0 }); s.setExpression(expression); }
    for (let k = 0; k < 40; k++) {
      await a.step(); await b.step();
      assert.deepEqual(state(a), state(b), `${motion} step ${k}`);
    }
  }
  await a.dispose(); await b.dispose();
}));

test("ModelSession reads the files of a model manifest of format 2 itself", () => withCore(async () => {
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
  try {
    const files = legacyFiles();
    assert.ok(files instanceof AssetStore);
    const s = await ModelSession.create({ gl: headlessGL(), assets: files, seed: 1 });
    assert.deepEqual(s.info, PRODUCT);
    assert.deepEqual(s.motions, ["mtn_idle", "mtn_turn"]);
    assert.equal(s.motion, "mtn_idle");
    await s.dispose();
  } finally {
    if (saved) globalThis.createImageBitmap = saved; else delete globalThis.createImageBitmap;
  }
}));
