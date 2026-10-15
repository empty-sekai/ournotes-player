// Loading a story from a site (src/story/assets.js): the model manifests (product manifests of live2d.model) fetched,
// their model.json merged under live2d/<id>/ and their objects into the store's object table, the site root from the
// manifest's `root`; and the Node openers of scripts/lib/headless.mjs (a manifest on disk with encoded assets, a
// story directory with its models directory). Synthetic sites only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { modelIndex } from "../../src/live2d/model.js";
import { MODEL_PRODUCT, STORY_MANIFEST_FORMAT, STORY_MANIFEST_FORMATS, fetchStoryManifest, loadStoryStore }
  from "../../src/story/assets.js";
import { nodeDecode, openStory, storyDirStore } from "../../scripts/lib/headless.mjs";
import { modelObjects, modelProduct, putFiles, sha256 } from "./site-fixture.mjs";

const enc = new TextEncoder();
const ROOT = "https://example.test/site/";
const size = (s) => enc.encode(s).byteLength;

// URL -> contents (string, bytes or JSON value); fetch records the requested URLs
const site = (files) => {
  const requested = [];
  const fetch = async (u) => {
    requested.push(String(u));
    const v = files[String(u)];
    if (v === undefined) return { ok: false, status: 404 };
    const bytes = v instanceof Uint8Array ? v : enc.encode(typeof v === "string" ? v : JSON.stringify(v));
    return { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(bytes)),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  return { fetch, requested };
};

// a product manifest of model `id` whose model.json is `doc` (gzip-encoded with `gz`) and whose one object, a
// Texture2D `oid` (default: one of its own), has a json file: [manifest, {URL: contents}]
const product = (id, doc, { gz = false, oid = `CAB-${id}:1` } = {}) => {
  const text = JSON.stringify(doc), z = new Uint8Array(gzipSync(enc.encode(text))), tj = JSON.stringify({ m_Name: oid });
  const asset = `assets/${sha256(Buffer.from(text))}.json`, tasset = `assets/${sha256(Buffer.from(tj))}.json`;
  const man = { schema: "nnnotes.product/1", product: MODEL_PRODUCT, subject: `Character/Live2D/g/${id}/model/${id}`,
                files: { "model.json": gz ? { asset: `${asset}.gz`, size: size(text), stored: z.byteLength } : { asset, size: size(text) } },
                objects: { [oid]: { class: "Texture2D", name: "t", files: { json: { asset: tasset, size: size(tj) } } } } };
  return [man, { [`${ROOT}${gz ? `${asset}.gz` : asset}`]: gz ? z : text, [`${ROOT}${tasset}`]: tj }];
};

// a site of one region's story (stories/tw/7.json) using models m1 (its model.json gzip-encoded) and m2, which share
// the object CAB-s:1
const fixture = () => {
  const story = JSON.stringify({ advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1", "Character/Live2D/g/m2/model/m2": "m2" } });
  const [m1, f1] = product("m1", { name: "m1" }, { gz: true, oid: "CAB-s:1" }), [m2, f2] = product("m2", { name: "m2" }, { oid: "CAB-s:1" });
  const man = {
    format: STORY_MANIFEST_FORMAT, advId: 7, root: "../../", language: "en", story: { advId: 7, playbackMode: 0 },
    requires: { commands: [] }, models: { m1: "models/m1.json", m2: "models/m2.json" },
    files: { "story.json": { asset: "assets/story.json", size: size(story) } },
    languages: { en: { files: { "ui/languages.json": { asset: "assets/en.json", size: 13 } } },
                 ja: { files: { "ui/languages.json": { asset: "assets/ja.json", size: 13 } } } },
  };
  const files = {
    [`${ROOT}stories/tw/7.json`]: man, [`${ROOT}models/m1.json`]: m1, [`${ROOT}models/m2.json`]: m2, ...f1, ...f2,
    [`${ROOT}assets/story.json`]: story, [`${ROOT}assets/en.json`]: '{"lang":"en"}', [`${ROOT}assets/ja.json`]: '{"lang":"ja"}',
  };
  return { man, files, m1, m2 };
};

test("formats: story manifest /2; model manifests are products of live2d.model", () => {
  assert.equal(STORY_MANIFEST_FORMAT, "ournotes.story-manifest/2");
  assert.deepEqual(STORY_MANIFEST_FORMATS, [STORY_MANIFEST_FORMAT]);
  assert.equal(MODEL_PRODUCT, "live2d.model");
});

test("the models' model.json merged under live2d/<id>/ and their objects into one table, every path from the manifest's root", async () => {
  const { files } = fixture();
  const { fetch, requested } = site(files);
  const progress = [];
  const store = await loadStoryStore(`${ROOT}stories/tw/7.json`, { fetch, onProgress: (a, b) => progress.push([a, b]) });
  assert.deepEqual(store.list().sort(), ["live2d/m1/model.json", "live2d/m2/model.json", "story.json", "ui/languages.json"]);
  assert.deepEqual(store.json("live2d/m1/model.json"), { name: "m1" });          // decoded by the player
  assert.deepEqual(store.objectJson("CAB-s:1"), { m_Name: "CAB-s:1" });          // one object of both models
  assert.equal(store.json("ui/languages.json").lang, "en");
  assert.equal(store.info.loadedLanguage, "en");
  assert.deepEqual(store.info.models, { m1: "models/m1.json", m2: "models/m2.json" });
  assert.deepEqual(Object.keys(store.info.languages), ["en", "ja"]);
  assert.equal(store.info.files, undefined);
  assert.equal(store.info.objects, undefined);
  // the region's manifest resolves against the site root (../../), not stories/
  assert.ok(requested.includes(`${ROOT}models/m1.json`) && requested.includes(`${ROOT}models/m2.json`));
  assert.ok(requested.filter((u) => u.includes("/assets/")).every((u) => u.startsWith(`${ROOT}assets/`)), requested.join("\n"));
  const shared = `${ROOT}assets/${sha256(Buffer.from(JSON.stringify({ m_Name: "CAB-s:1" })))}.json`;
  assert.equal(requested.filter((u) => u === shared).length, 1);              // a shared object's file fetched once
  assert.equal(progress.at(-1)[0], progress.at(-1)[1]);
  // the other language; an explicit base
  assert.equal((await loadStoryStore(`${ROOT}stories/tw/7.json`, { fetch, lang: "ja" })).json("ui/languages.json").lang, "ja");
  const moved = Object.fromEntries(Object.entries(files).map(([u, v]) => [u.startsWith(`${ROOT}stories/`) ? u.replace(ROOT, "https://cdn.example.test/m/") : u, v]));
  const b = await loadStoryStore("https://cdn.example.test/m/stories/tw/7.json", { ...site(moved), base: ROOT });
  assert.deepEqual(b.json("live2d/m1/model.json"), { name: "m1" });
});

test("a model manifest missing or not a product of live2d.model, a model of another id, an object two models differ on", async () => {
  const url = `${ROOT}stories/tw/7.json`;
  const rejects = async (edit, re) => {
    const f = fixture();
    edit(f);
    await assert.rejects(loadStoryStore(url, site(f.files)), re);
  };
  await rejects((f) => { delete f.files[`${ROOT}models/m2.json`]; }, /models\/m2\.json: HTTP 404/);
  await rejects((f) => { f.m2.product = "live2d.cubism"; }, /models\/m2\.json: not a model manifest \(nnnotes\.product\/1 of live2d\.model\)/);
  await rejects((f) => { delete f.m2.objects; }, /models\/m2\.json: not a model manifest/);
  await rejects((f) => { f.m2.subject = "Character/Live2D/g/m3/model/m3"; }, /model m3, the story names it m2/);
  await rejects((f) => { f.m2.objects["CAB-s:1"].class = "Material"; }, /story 7: object CAB-s:1 differs between the manifests of its models/);
  await rejects((f) => { f.man.files["live2d/m1/model.json"] = f.man.files["story.json"]; }, /live2d\/m1\/model\.json: live2d\/ holds the models' files/);
  await rejects((f) => { delete f.man.root; }, /without root \/ models/);
  const { man, files } = fixture();
  man.format = "ournotes.story-manifest/1";
  await assert.rejects(fetchStoryManifest(url, site(files)), /not a story manifest \(ournotes\.story-manifest\/2\)/);
});

// ------------------------------------------------------------------------------------------------ Node openers
test("openStory: a manifest on disk with encoded assets (node:zlib), its models' objects loaded", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-story-open-"));
  try {
    const m = modelObjects("m1");
    fs.mkdirSync(path.join(dir, "models"));
    const mm = modelProduct(dir, m, "br");
    assert.ok(Object.values(mm.objects).some((o) => Object.values(o.files).some((f) => f.asset.endsWith(".json.br"))));
    fs.writeFileSync(path.join(dir, "models", "m1.json"), JSON.stringify(mm));
    const sf = putFiles(dir, { "story.json": { advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1" }, pad: "q".repeat(200) } }, "gzip");
    const lf = putFiles(dir, { "ui/languages.json": { language: "en" } });
    fs.mkdirSync(path.join(dir, "stories", "tw"), { recursive: true });
    const manifest = path.join(dir, "stories", "tw", "7.json");
    fs.writeFileSync(manifest, JSON.stringify({ format: STORY_MANIFEST_FORMAT, advId: 7, root: "../../", language: "en",
                                                story: { playbackMode: 0 }, requires: { commands: [] }, models: { m1: "models/m1.json" },
                                                files: sf, languages: { en: { files: lf } } }));
    const store = await openStory(manifest);
    assert.deepEqual(modelIndex(store, "live2d/m1"), m.model);
    assert.equal(store.prefab(m.model.prefab).nodes[0].name, "m1");
    assert.equal(store.json("story.json").advId, 7);
    assert.equal(typeof store.image, "function");
    assert.equal(Buffer.from(await nodeDecode(gzipSync(Buffer.from("abc")), "gzip")).toString(), "abc");
    await assert.rejects(nodeDecode(Buffer.from("x"), "zstd"), /unknown content encoding/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("storyDirStore: a story directory with its models directory mounted at live2d/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-story-dir-"));
  try {
    // DIR/story.json with modelsDir, the models in DIR/../live2d/<id>/; DIR's own live2d/ hidden
    const sdir = path.join(dir, "out", "7"), mdir = path.join(dir, "out", "live2d", "m1");
    fs.mkdirSync(path.join(sdir, "live2d", "stale"), { recursive: true });
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, "story.json"), JSON.stringify({ advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1" }, modelsDir: "../live2d" }));
    fs.writeFileSync(path.join(sdir, "live2d", "stale", "model.json"), "{}");
    fs.writeFileSync(path.join(mdir, "model.json"), JSON.stringify({ name: "m1" }));
    const ds = storyDirStore(sdir);
    assert.equal(ds.has("live2d/m1/model.json"), true);
    assert.equal(ds.has("live2d/stale/model.json"), false);
    assert.deepEqual(ds.list(), ["live2d/m1/model.json", "story.json"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
