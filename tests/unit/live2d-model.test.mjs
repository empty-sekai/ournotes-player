// model.json (src/live2d/model.js, docs/data-format.md "model.json"), shared by the model viewer and the story sessions;
// the models of a story's Character rows (src/story/models.js: a model id, the model's model.json under live2d/<id>/
// and its objects in the store's object table); the drawing each character is given (StoryRenderer and
// SimpleCaptureRenderer addCharacter) and the keywords the story renderer adds to character draws per quality.
// Synthetic objects (live2d-objects.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { MODEL_JSON_FORMAT, modelIndex } from "../../src/live2d/model.js";
import { AdvQuality } from "../../src/story/field.js";
import { storyModels } from "../../src/story/models.js";
import { StoryRenderer } from "../../src/story/renderer.js";
import { SimpleCaptureRenderer } from "../../src/story/simple/render.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";
import { ModelObjects, node } from "./live2d-objects.mjs";

const LIT = "Live2D Cubism/Lit-URP-ADV-optimize", MASK = "Live2D Cubism/Mask";

// the objects of a model (its prefab, moc, two shaders, the mask materials, a clip) and the options of its model.json
const objects = () => {
  const o = new ModelObjects();
  const lit = o.shader(LIT, { properties: [], subShaders: [] }, []);
  const mask = o.shader(MASK, { properties: [], subShaders: [] }, []);
  const clip = o.clip({ name: "idle", bindings: [{ cls: "CubismParameter", path: "Parameters/A", attribute: "Value" }],
                        constant: [0] });
  const model = { prefab: o.prefab([node("m1")]), moc: o.moc(new Uint8Array(4)), shaders: [lit, mask], motionSync: true,
                  resources: { cubismMask: o.material("Mask", { shader: mask, floats: { _Cull: 0 } }),
                               cubismMaskCulling: o.material("MaskCulling", { shader: mask, floats: { _Cull: 1 } }) } };
  return { o, lit, clip, model };
};

test("modelIndex: model.json at the store's root or in a directory, the classes of its objects checked", () => {
  assert.equal(MODEL_JSON_FORMAT, 3);
  const { o, clip, model } = objects();
  const root = modelIndex(o.store(model));
  assert.deepEqual(root, o.modelJson(model));
  assert.deepEqual(Object.keys(root.bindings), [clip]);
  assert.equal(modelIndex(o.store({ dir: "live2d/m1", ...model }), "live2d/m1").moc, model.moc);
  const bad = (edit, re, dir = "") => {
    const text = { [dir ? `${dir}/model.json` : "model.json"]: JSON.stringify(edit(o.modelJson(model))) };
    assert.throws(() => modelIndex(new AssetStore({ text, objects: o.objects }), dir), re);
  };
  bad((m) => ({ ...m, format: 2 }), /^Error: model\.json: format 2 is not supported \(3 expected\)$/);
  bad((m) => ({ ...m, format: 2 }), /live2d\/x\/model\.json: format 2/, "live2d/x");
  bad(({ motionSync, ...m }) => m, /model\.json: "motionSync" missing/);
  bad(({ shaders, ...m }) => m, /model\.json: "shaders" missing/);
  bad((m) => ({ ...m, prefab: m.moc }), /model\.json: CAB-test:\d+: a MonoBehaviour, not a GameObject/);
  const list = o.mono("CubismFadeMotionList", "common.fadeMotionList");
  bad((m) => ({ ...m, moc: list }), new RegExp(`model\\.json: ${list}: not a CubismMoc`));
  bad((m) => ({ ...m, resources: { ...m.resources, cubismMask: "CAB-test:999" } }), /model\.json: object not found: CAB-test:999/);
  bad((m) => ({ ...m, bindings: { [m.moc]: [] } }), /model\.json: CAB-test:\d+: a MonoBehaviour, not a AnimationClip/);
  assert.throws(() => modelIndex(o.store(model), "live2d/none"), /live2d\/none\/model\.json/);
});

test("storyModels: a model id names the model.json under live2d/<id>/; one model and ShaderLib per id", () => {
  const gl = headlessGL();
  const { o, model } = objects();
  const s = o.store({ dir: "live2d/m1", ...model });
  const story = { models: { "Character/Live2D/g/a/model/a": "m1", "Character/Live2D/g/b/model/b": "m1",
                            "Character/Live2D/g/c/model/c": "" } };
  const modelOf = storyModels(gl, s, story, "story 7");
  const a = modelOf("Character/Live2D/g/a/model/a");
  assert.equal(a, modelOf("Character/Live2D/g/b/model/b"));      // one model (and ShaderLib) per id
  assert.equal(a.id, "m1");
  assert.deepEqual(a.model, o.modelJson(model));
  assert.equal(a.lib.info(LIT).name, LIT);                        // the ShaderLib of model.json shaders
  assert.throws(() => modelOf("Character/Live2D/g/x/model/x"), /story 7: model Character\/Live2D\/g\/x\/model\/x is not in the story/);
  assert.throws(() => modelOf("Character/Live2D/g/c/model/c"), /story 7: model Character\/Live2D\/g\/c\/model\/c is not in the story/);
  const headless = storyModels(null, s, story, "story 7")("Character/Live2D/g/a/model/a");
  assert.equal(headless.lib, null);                               // no GL: no shaders
  assert.equal(headless.model.moc, model.moc);
});

test("addCharacter: each character draws with the ShaderLib it is given and the mask materials of its model.json", () => {
  const gl = headlessGL();
  const { o, lit, model } = objects();
  const assets = o.store(model), m = o.modelJson(model);
  const character = { name: "c", renderers: [] };
  const lib = { model: 1 };
  const loop = new PlayerLoop(30);
  const r = new StoryRenderer(gl, { story: 1 }, { camera: null, session: { stage: null } }, { unityLighting: false }, loop, { assets });
  const g = r.addCharacter(character, { lib, model: m });
  assert.equal(g.lib, lib);
  assert.deepEqual(g.maskMats[1], assets.material(m.resources.cubismMaskCulling));
  assert.equal(g.maskMats[1].floats._Cull, 1);
  const sr = new SimpleCaptureRenderer(gl, loop, { assets });
  const h = sr.addCharacter(character, { lib, model: m });
  assert.equal(h.lib, lib);
  assert.equal(sr.drawings.get(character), h);
  assert.throws(() => sr.addCharacter(character, { lib, model: { ...m, shaders: { ...m.shaders, [MASK]: lit } } }),
                /mask material Mask: not drawn with Live2D Cubism\/Mask/);
  const masked = { name: "d", renderers: [{ name: "ArtMesh0", material: assets.material(m.resources.cubismMask) }] };
  assert.throws(() => sr.addCharacter(masked, { lib, model: m }), /ArtMesh0: material Mask is not drawn with Live2D Cubism\/Lit-URP-ADV-optimize/);
});

test("the keywords the story renderer adds to character draws: _ADDITIONAL_LIGHTS_VERTEX at quality 4 only", () => {
  for (const level of [0, 1, 2, 3, 4])
    assert.deepEqual(StoryRenderer.characterKeywords(new AdvQuality(level, {})), level === 4 ? ["_ADDITIONAL_LIGHTS_VERTEX"] : []);
});
