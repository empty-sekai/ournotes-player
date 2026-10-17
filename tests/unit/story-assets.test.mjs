import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { STORY_MANIFEST_FORMAT, STORY_MANIFEST_FORMATS, fetchStoryManifest, loadStoryStore } from "../../src/story/assets.js";
import { StoryData } from "../../src/story/data.js";
import { nodeDecode, openStory } from "../../scripts/lib/headless.mjs";
import { STORY_ROOT as ROOT, storyFixture } from "./story-product-fixture.mjs";

const edit = (fixture, name, fn) => {
  const value = JSON.parse(new TextDecoder().decode(fixture.files.get(name)));
  fn(value);
  fixture.files.set(name, new TextEncoder().encode(JSON.stringify(value)));
};

test("public story loader reads product manifests and reuses a fetched index", async () => {
  const f = storyFixture(), progress = [];
  assert.equal(STORY_MANIFEST_FORMAT, "nnnotes.product/1");
  assert.deepEqual(STORY_MANIFEST_FORMATS, [STORY_MANIFEST_FORMAT]);
  const manifest = await fetchStoryManifest(`${ROOT}stories/7.json`, { fetch: f.fetch });
  const store = await loadStoryStore(manifest.url, { manifest, lang: "ja", onProgress: (a, b) => progress.push([a, b]) });
  const data = new StoryData(store);
  assert.equal(data.episode.advId, 7);
  assert.equal(data.model("Character/Live2D/g/m/model/m").dir, "models/m");
  assert.equal(data.fontDir, "storyfonts/7_ja");
  assert.equal(store.info.loadedLanguage, "ja");
  assert.deepEqual(Object.keys(store.info.languages), ["ja", "en"]);
  assert.equal(new Set(f.requested).size, f.requested.length);
  assert.equal(progress.at(-1)[0], progress.at(-1)[1]);
});

test("a relocated story manifest can resolve dependencies from an explicit root", async () => {
  const f = storyFixture(), relocated = "https://cdn.example.test/story.json";
  const fetch = (url, init) => f.fetch(String(url) === relocated ? `${ROOT}stories/7.json` : url, init);
  const store = await loadStoryStore(relocated, { fetch, base: ROOT, lang: "ja" });
  assert.equal(new StoryData(store).ui.language.code, "ja");
});

test("story model products validate their subject and shared object contracts", async () => {
  const reject = async (change, message) => {
    const f = storyFixture(); change(f);
    await assert.rejects(loadStoryStore(`${ROOT}stories/7.json`, { fetch: f.fetch, lang: "ja" }), message);
  };
  await reject(f => f.files.delete("models/m.json"), /models\/m\.json: HTTP 404/);
  for (const fn of [m => { m.product = "story"; }, m => { delete m.objects; }, m => { m.subject = "another"; }])
    await reject(f => edit(f, "models/m.json", fn), /expected live2d.model product/);
  await reject(f => {
    const object = { class: "Texture2D", name: "shared", files: {} };
    edit(f, "models/m.json", m => { m.objects["fixture:1"] = object; });
    edit(f, "storyassets/a.json", m => { m.objects["fixture:1"] = { ...object, class: "Material" }; });
  }, /fixture:1/);
});

test("openStory loads encoded product files from disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-product-"));
  try {
    const f = storyFixture();
    edit(f, "storyfonts/7_ja.json", m => {
      const entry = m.files["fonts.json"], bytes = gzipSync(f.files.get(entry.asset));
      f.files.set(`${entry.asset}.gz`, bytes); entry.asset += ".gz"; entry.stored = bytes.length;
    });
    for (const [file, bytes] of f.files) {
      const target = path.join(dir, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    }
    const store = await openStory(path.join(dir, "stories", "7.json"), { lang: "ja" });
    assert.equal(new StoryData(store).fonts.format, "nnnotes.story-fonts/1");
    assert.equal(new StoryData(await openStory(dir, { lang: "ja" })).episode.advId, 7);
    fs.writeFileSync(path.join(dir, "stories", "8.json"), "{}");
    await assert.rejects(openStory(dir, { lang: "ja" }), /choose a story product manifest/);
    assert.equal(Buffer.from(await nodeDecode(gzipSync(Buffer.from("abc")), "gzip")).toString(), "abc");
    await assert.rejects(nodeDecode(Buffer.from("x"), "zstd"), /unknown content encoding/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
