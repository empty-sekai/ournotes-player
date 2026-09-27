// model.json (src/live2d/model.js, docs/data-format.md "model.json"), shared by the model viewer and the story sessions;
// the models of a story's Character rows (src/story/models.js: a model id with the model under live2d/<id>/, or the
// {dir, moc3, prefab} form of story manifest /1); the shaders each character draws with (StoryRenderer and
// SimpleCaptureRenderer addCharacter) and the keywords the story renderer adds to them per quality. Synthetic files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { MODEL_JSON_FORMATS, modelIndex } from "../../src/live2d/model.js";
import { AdvQuality } from "../../src/story/field.js";
import { storyModels } from "../../src/story/models.js";
import { StoryRenderer } from "../../src/story/renderer.js";
import { SimpleCaptureRenderer } from "../../src/story/simple/render.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

const MASK = "Live2D Cubism/Mask";
const resources = { cubismMask: { shader: { shader: MASK }, floats: { _Cull: 0 } }, cubismMaskCulling: { shader: { shader: MASK }, floats: { _Cull: 1 } } };
const index = (extra = {}) => ({ format: 2, motionSync: true, name: "m1", moc3: "m1.moc3", prefab: "m1.prefab.json",
                                 shaders: "shaders/shaders.json", resources, ...extra });
const store = (files) => new AssetStore({ text: Object.fromEntries(Object.entries(files).map(([p, v]) => [p, JSON.stringify(v)])) });

test("modelIndex: model.json at the store's root or in a directory, formats 1 and 2", () => {
  assert.deepEqual(MODEL_JSON_FORMATS, [1, 2]);
  const root = modelIndex(store({ "model.json": index({ prefab: "p/m1.prefab.json" }) }));
  assert.equal(root.moc3, "m1.moc3");
  assert.equal(root.prefab, "p/m1.prefab.json");
  assert.equal(root.textureDir, "p");                           // the drawables' textures are relative to the prefab
  assert.equal(root.shaderDir, "shaders");
  assert.equal(root.motionSync, true);
  assert.equal(root.resources, root.index.resources);
  const sub = modelIndex(store({ "live2d/m1/model.json": index() }), "live2d/m1");
  assert.deepEqual([sub.moc3, sub.prefab, sub.shaders, sub.textureDir, sub.shaderDir],
                   ["live2d/m1/m1.moc3", "live2d/m1/m1.prefab.json", "live2d/m1/shaders/shaders.json", "live2d/m1", "live2d/m1/shaders"]);
  const v1 = modelIndex(store({ "model.json": index({ format: 1, motionSync: undefined }) }));
  assert.equal(v1.motionSync, null);                              // not stated in format 1
  const bad = (x, re, dir = "") => assert.throws(() => modelIndex(store({ [dir ? `${dir}/model.json` : "model.json"]: x }), dir), re);
  bad(index({ format: 3 }), /^Error: model\.json: format 3 is not supported \(1 or 2 expected\)$/);
  bad(index({ format: 3 }), /live2d\/x\/model\.json: format 3/, "live2d/x");
  bad(index({ motionSync: undefined }), /"motionSync" missing/);
  bad(index({ moc3: "" }), /"moc3" missing/);
  bad(index({ shaders: "shaders/index.json" }), /"shaders" must name a shaders\.json/);
  assert.throws(() => modelIndex(store({}), "live2d/none"), /live2d\/none\/model\.json/);
});

test("storyModels: a model id (live2d/<id>/, its own shaders, one ShaderLib per id) or {dir, moc3, prefab}", () => {
  const gl = headlessGL();
  const files = {
    "live2d/m1/model.json": index(), "live2d/m1/shaders/shaders.json": [],
    "shaders/shaders.json": [],
  };
  const s = store(files);
  const story = { models: { "Character/Live2D/g/a/model/a": "m1", "Character/Live2D/g/b/model/b": "m1",
                            "Character/Live2D/g/c/model/c": { dir: "live2d/c", moc3: "c.moc3", prefab: "c.prefab.json" } } };
  const storyLib = { story: true }, sceneResources = { scene: true };
  const modelOf = storyModels(gl, s, story, "story 7", { lib: storyLib, resources: sceneResources });
  const a = modelOf("Character/Live2D/g/a/model/a"), b = modelOf("Character/Live2D/g/b/model/b");
  assert.equal(a.id, "m1");
  assert.equal(a, b);                                              // one model (and ShaderLib) per id
  assert.equal(a.lib.base, "live2d/m1/shaders");
  assert.equal(a.model.prefab, "live2d/m1/m1.prefab.json");
  assert.deepEqual(a.model.resources, resources);                  // model.json resources
  const c = modelOf("Character/Live2D/g/c/model/c");
  assert.equal(c.id, null);
  assert.equal(c.lib, storyLib);                                   // manifest /1: the story's shaders
  assert.deepEqual([c.model.prefab, c.model.moc3, c.model.textureDir], ["live2d/c/c.prefab.json", "live2d/c/c.moc3", "live2d/c"]);
  assert.equal(c.model.resources, sceneResources);                 // and scene.json resources
  assert.throws(() => modelOf("Character/Live2D/g/x/model/x"), /story 7: model Character\/Live2D\/g\/x\/model\/x is not in the story/);
  const headless = storyModels(null, s, story, "story 7")("Character/Live2D/g/a/model/a");
  assert.equal(headless.lib, null);                               // no GL: no shaders
  assert.equal(headless.model.moc3, "live2d/m1/m1.moc3");
});

test("addCharacter: each character draws with the ShaderLib, textures and mask materials it is given", () => {
  const gl = headlessGL();
  const character = { name: "c", renderers: [] };
  const lib = { model: 1 };
  const loop = new PlayerLoop(30);
  const r = new StoryRenderer(gl, { story: 1 }, { camera: null, session: { stage: null } }, { unityLighting: false }, loop, { assets: null });
  const g = r.addCharacter(character, { lib, dir: "live2d/m1", resources });
  assert.equal(g.lib, lib);
  assert.equal(g.dir, "live2d/m1");
  assert.equal(g.maskMats[1], resources.cubismMaskCulling);
  const sr = new SimpleCaptureRenderer(gl, loop, { assets: null });
  const h = sr.addCharacter(character, { lib, dir: "live2d/m1", resources });
  assert.equal(h.lib, lib);
  assert.equal(sr.drawings.get(character), h);
  assert.throws(() => sr.addCharacter(character, { lib, dir: "", resources: {} }), /resources\.cubismMask/);
});

test("the keywords the story renderer adds to character draws: _ADDITIONAL_LIGHTS_VERTEX at quality 4 only", () => {
  for (const level of [0, 1, 2, 3, 4])
    assert.deepEqual(StoryRenderer.characterKeywords(new AdvQuality(level, {})), level === 4 ? ["_ADDITIONAL_LIGHTS_VERTEX"] : []);
});
