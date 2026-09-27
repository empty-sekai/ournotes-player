// Loading a story from a site (src/story/assets.js): manifest format /2 (the model manifests fetched and their files
// merged under live2d/<id>/, the site root from the manifest's `root`), format /1 (the models among the story's own
// files), and the Node openers of scripts/lib/headless.mjs (a manifest on disk with encoded assets, a story directory
// with its models directory). Synthetic sites only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { modelIndex } from "../../src/live2d/model.js";
import { MODEL_MANIFEST_FORMATS, STORY_MANIFEST_FORMAT, STORY_MANIFEST_FORMATS, fetchStoryManifest, loadStoryStore }
  from "../../src/story/assets.js";
import { nodeDecode, openStory, storyDirStore } from "../../scripts/lib/headless.mjs";
import { putFiles } from "./site-fixture.mjs";

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

const modelJson = (name) => JSON.stringify({ format: 2, motionSync: false, name, moc3: `${name}.moc3`, prefab: `${name}.prefab.json`,
                                             shaders: "shaders/shaders.json", resources: { cubismMask: {}, cubismMaskCulling: {} } });

// a site of one region's story (stories/tw/7.json, format /2) using models m1 (format 3, its model.json gzip-encoded)
// and m2 (format 2)
const fixture = () => {
  const story = JSON.stringify({ advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1", "Character/Live2D/g/m2/model/m2": "m2" } });
  const m1 = modelJson("m1"), z = new Uint8Array(gzipSync(enc.encode(m1))), m2 = modelJson("m2");
  const man = {
    format: STORY_MANIFEST_FORMAT, advId: 7, root: "../../", language: "en", story: { advId: 7, playbackMode: 0 },
    requires: { commands: [] }, models: { m1: "models/m1.json", m2: "models/m2.json" },
    files: { "story.json": { asset: "assets/story.json", size: size(story) } },
    languages: { en: { files: { "ui/languages.json": { asset: "assets/en.json", size: 13 } } },
                 ja: { files: { "ui/languages.json": { asset: "assets/ja.json", size: 13 } } } },
  };
  const files = {
    [`${ROOT}stories/tw/7.json`]: man,
    [`${ROOT}models/m1.json`]: { format: 3, id: "m1", files: {
      "model.json": { asset: "assets/m1.json.gz", size: size(m1), stored: z.byteLength },
      "m1.moc3": { asset: "assets/m1.moc3", size: 4 } } },
    [`${ROOT}models/m2.json`]: { format: 2, id: "m2", files: { "model.json": { asset: "assets/m2.json", size: size(m2) } } },
    [`${ROOT}assets/story.json`]: story, [`${ROOT}assets/en.json`]: '{"lang":"en"}', [`${ROOT}assets/ja.json`]: '{"lang":"ja"}',
    [`${ROOT}assets/m1.json.gz`]: z, [`${ROOT}assets/m1.moc3`]: new Uint8Array([77, 79, 67, 51]), [`${ROOT}assets/m2.json`]: m2,
  };
  return { man, files, m1, z };
};

test("formats: story manifest /2 (current) and /1; model manifests 2 and 3", () => {
  assert.equal(STORY_MANIFEST_FORMAT, "ournotes.story-manifest/2");
  assert.deepEqual(STORY_MANIFEST_FORMATS, ["ournotes.story-manifest/1", "ournotes.story-manifest/2"]);
  assert.deepEqual(MODEL_MANIFEST_FORMATS, [2, 3]);
});

test("format /2: the model manifests' files merged under live2d/<id>/, every path from the manifest's root", async () => {
  const { files, m1, z } = fixture();
  const { fetch, requested } = site(files);
  const progress = [];
  const store = await loadStoryStore(`${ROOT}stories/tw/7.json`, { fetch, onProgress: (a, b) => progress.push([a, b]) });
  assert.deepEqual(store.list().sort(), ["live2d/m1/m1.moc3", "live2d/m1/model.json", "live2d/m2/model.json", "story.json",
                                         "ui/languages.json"]);
  assert.equal(store.text("live2d/m1/model.json"), m1);         // decoded by the player
  assert.deepEqual([...store.bytes("live2d/m1/m1.moc3")], [77, 79, 67, 51]);
  assert.equal(store.json("ui/languages.json").lang, "en");
  assert.equal(store.info.loadedLanguage, "en");
  assert.deepEqual(store.info.models, { m1: "models/m1.json", m2: "models/m2.json" });
  assert.deepEqual(Object.keys(store.info.languages), ["en", "ja"]);
  assert.equal(store.info.files, undefined);
  // the region's manifest resolves against the site root (../../), not stories/
  assert.ok(requested.includes(`${ROOT}models/m1.json`) && requested.includes(`${ROOT}models/m2.json`));
  assert.ok(requested.filter((u) => u.includes("/assets/")).every((u) => u.startsWith(`${ROOT}assets/`)), requested.join("\n"));
  const total = size(files[`${ROOT}assets/story.json`]) + 13 + z.byteLength + 4 + size(files[`${ROOT}assets/m2.json`]);
  assert.deepEqual(progress.at(-1), [total, total]);
  const m = modelIndex(store, "live2d/m1");
  assert.equal(m.moc3, "live2d/m1/m1.moc3");
  assert.equal(m.shaderDir, "live2d/m1/shaders");
  // the other language; an explicit base
  assert.equal((await loadStoryStore(`${ROOT}stories/tw/7.json`, { fetch, lang: "ja" })).json("ui/languages.json").lang, "ja");
  const moved = Object.fromEntries(Object.entries(files).map(([u, v]) => [u.startsWith(`${ROOT}stories/`) ? u.replace(ROOT, "https://cdn.example.test/m/") : u, v]));
  const b = await loadStoryStore("https://cdn.example.test/m/stories/tw/7.json", { ...site(moved), base: ROOT });
  assert.equal(b.text("live2d/m1/model.json"), m1);
});

test("format /2: a model manifest missing or of another format, a model of another id, a story file under live2d/", async () => {
  const url = `${ROOT}stories/tw/7.json`;
  {
    const { files } = fixture();
    delete files[`${ROOT}models/m2.json`];
    await assert.rejects(loadStoryStore(url, site(files)), /models\/m2\.json: HTTP 404/);
  }
  {
    const { files } = fixture();
    files[`${ROOT}models/m2.json`].format = 4;
    await assert.rejects(loadStoryStore(url, site(files)), /models\/m2\.json: not a model manifest \(format 2 or 3\)/);
  }
  {
    const { files } = fixture();
    files[`${ROOT}models/m2.json`].id = "m3";
    await assert.rejects(loadStoryStore(url, site(files)), /model m3, the story names it m2/);
  }
  {
    const { man, files } = fixture();
    man.files["live2d/m1/model.json"] = man.files["story.json"];
    await assert.rejects(loadStoryStore(url, site(files)), /live2d\/m1\/model\.json: live2d\/ holds the models' files/);
  }
  {
    const { man, files } = fixture();
    delete man.root;
    await assert.rejects(loadStoryStore(url, site(files)), /without root \/ models/);
  }
  {
    const { man, files } = fixture();
    man.format = "ournotes.story-manifest/3";
    await assert.rejects(fetchStoryManifest(url, site(files)), /not a story manifest \(ournotes\.story-manifest\/1 or ournotes\.story-manifest\/2\)/);
  }
});

test("format /1: the models' files among the story's, assets from the directory above the manifest's", async () => {
  const story = JSON.stringify({ advId: 7, models: { "Character/Live2D/g/m1/model/m1": { dir: "live2d/m1", moc3: "m1.moc3", prefab: "m1.prefab.json" } } });
  const man = { format: "ournotes.story-manifest/1", advId: 7, language: "en", story: { advId: 7, playbackMode: 0 }, requires: { commands: [] },
                files: { "story.json": { asset: "assets/story.json", size: size(story) }, "live2d/m1/m1.moc3": { asset: "assets/m1.moc3", size: 4 } },
                languages: { en: { files: {} } } };
  const { fetch, requested } = site({ [`${ROOT}stories/7.json`]: man, [`${ROOT}assets/story.json`]: story,
                                      [`${ROOT}assets/m1.moc3`]: new Uint8Array([77, 79, 67, 51]) });
  const store = await loadStoryStore(`${ROOT}stories/7.json`, { fetch });
  assert.deepEqual(store.list().sort(), ["live2d/m1/m1.moc3", "story.json"]);
  assert.ok(!requested.some((u) => u.includes("/models/")));
  assert.equal(store.info.format, "ournotes.story-manifest/1");
});

// ------------------------------------------------------------------------------------------------ Node openers
test("openStory: a manifest on disk with encoded assets (node:zlib); storyDirStore: a story directory with modelsDir", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-story-open-"));
  try {
    const m1 = { format: 2, motionSync: false, name: "m1", moc3: "m1.moc3", prefab: "m1.prefab.json", shaders: "shaders/shaders.json",
                 resources: {}, pad: "p".repeat(200) };
    const mf = putFiles(dir, { "model.json": m1 }, "br");
    assert.ok(mf["model.json"].asset.endsWith(".json.br"));
    fs.mkdirSync(path.join(dir, "models"));
    fs.writeFileSync(path.join(dir, "models", "m1.json"), JSON.stringify({ format: 3, id: "m1", files: mf }));
    const sf = putFiles(dir, { "story.json": { advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1" }, pad: "q".repeat(200) } }, "gzip");
    const lf = putFiles(dir, { "ui/languages.json": { language: "en" } });
    fs.mkdirSync(path.join(dir, "stories", "tw"), { recursive: true });
    const manifest = path.join(dir, "stories", "tw", "7.json");
    fs.writeFileSync(manifest, JSON.stringify({ format: STORY_MANIFEST_FORMAT, advId: 7, root: "../../", language: "en",
                                                story: { playbackMode: 0 }, requires: { commands: [] }, models: { m1: "models/m1.json" },
                                                files: sf, languages: { en: { files: lf } } }));
    const store = await openStory(manifest);
    assert.deepEqual(store.json("live2d/m1/model.json"), m1);
    assert.equal(store.json("story.json").advId, 7);
    assert.equal(typeof store.image, "function");
    assert.equal(Buffer.from(await nodeDecode(gzipSync(Buffer.from("abc")), "gzip")).toString(), "abc");
    await assert.rejects(nodeDecode(Buffer.from("x"), "zstd"), /unknown content encoding/);

    // a story directory: DIR/story.json with modelsDir, the models in DIR/../live2d/<id>/; DIR's own live2d/ hidden
    const sdir = path.join(dir, "out", "7"), mdir = path.join(dir, "out", "live2d", "m1");
    fs.mkdirSync(path.join(sdir, "live2d", "stale"), { recursive: true });
    fs.mkdirSync(path.join(mdir, "shaders"), { recursive: true });
    fs.writeFileSync(path.join(sdir, "story.json"), JSON.stringify({ advId: 7, models: { "Character/Live2D/g/m1/model/m1": "m1" }, modelsDir: "../live2d" }));
    fs.writeFileSync(path.join(sdir, "live2d", "stale", "model.json"), "{}");
    fs.writeFileSync(path.join(mdir, "model.json"), JSON.stringify(m1));
    fs.writeFileSync(path.join(mdir, "shaders", "shaders.json"), "[]");
    const ds = storyDirStore(sdir);
    assert.equal(ds.has("live2d/m1/model.json"), true);
    assert.equal(ds.has("live2d/stale/model.json"), false);
    assert.deepEqual(ds.list(), ["live2d/m1/model.json", "live2d/m1/shaders/shaders.json", "story.json"]);
    assert.equal(modelIndex(ds, "live2d/m1").shaderDir, "live2d/m1/shaders");
    const opened = await openStory(sdir);
    assert.deepEqual(opened.json("live2d/m1/model.json"), m1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
