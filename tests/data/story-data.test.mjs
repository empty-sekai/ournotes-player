// Opt-in: a story site (stories.json, stories/, assets/) against docs/story-data-format.md, through the validator and
// the player's story loader in Node.
//
//   OURNOTES_STORY_SITE=<site dir>     a site with stories (skipped without it)
//   OURNOTES_STORY_IDS=<id>,...|all    the stories loaded per language (default: the first three of stories.json); an
//                                      id is the manifest path below stories/ without .json (10462, tw/10462)
//
// Checks: the site validator accepts each story product; the selected stories load every language with exactly
// their part files and shared object roles. File sizes, model references, UI and font languages agree with the graph.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StoryData } from "../../src/story/data.js";
import { storyPartRequests } from "../../src/story/store.js";
import { mergeProductManifests, productDir } from "../../src/data/products.js";
import { modelIndex } from "../../src/live2d/model.js";
import { fetchStoryManifest, loadStoryStore } from "../../src/story/assets.js";
import { nodeDecode } from "../../scripts/lib/headless.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.OURNOTES_STORY_SITE || "";
const SKIP = !SITE ? "OURNOTES_STORY_SITE is not set (path of a site with stories)"
  : !fs.existsSync(path.join(SITE, "stories.json")) ? "the site has no stories.json" : false;

const index = () => JSON.parse(fs.readFileSync(path.join(SITE, "stories.json"), "utf8"));
const idOf = (manifest) => manifest.replace(/^stories\//, "").replace(/\.json$/, "");
const chosen = () => {
  if (SKIP) return [];
  const all = index().stories;
  const want = process.env.OURNOTES_STORY_IDS;
  if (want === "all") return all;
  if (want) {
    const ids = want.split(",").map((s) => s.trim()).filter(Boolean);
    return all.filter((e) => ids.includes(idOf(e.manifest)));
  }
  return all.slice(0, 3);
};

// fetch over file: URLs
const fileFetch = async (u) => {
  try { return new Response(await fs.promises.readFile(fileURLToPath(String(u)))); }
  catch { return new Response(null, { status: 404 }); }
};

test("the validator passes every story of the site", { skip: SKIP }, () => {
  const r = spawnSync(process.execPath, [path.join(here, "..", "..", "scripts", "validate-data.mjs"), SITE],
                      { encoding: "utf8", maxBuffer: 64 << 20 });
  const lines = r.stdout.split("\n").filter(Boolean);
  assert.equal(r.status, 0, lines.slice(0, 40).join("\n") + r.stderr);
  const n = index().stories.length;
  assert.ok(lines.includes(`${n}/${n} stories valid`), lines.slice(-5).join("\n"));
});

for (const e of chosen()) {
  test(`story ${idOf(e.manifest)}: every language through loadStoryStore`, async () => {
    const url = pathToFileURL(path.join(SITE, e.manifest)).href;
    const head = await fetchStoryManifest(url, { fetch: fileFetch, decode: nodeDecode });
    for (const lang of Object.keys(head.story.parts.ui)) {
      const store = await loadStoryStore(url, { lang, fetch: fileFetch, manifest: head, decode: nodeDecode });
      const products = [[`stories/${head.story.advId}`, head.manifest]];
      for (const [file] of storyPartRequests(head.story, lang)) {
        const manifest = JSON.parse(fs.readFileSync(new URL(file, head.root), "utf8"));
        products.push([productDir(file), manifest]);
      }
      const expected = mergeProductManifests(products);
      assert.deepEqual(store.list().sort(), Object.keys(expected.files).sort(), `${lang}: the store's files`);
      for (const [p, f] of Object.entries(expected.files)) assert.equal(store.bytes(p).byteLength, f.size, `${lang}: ${p}`);
      for (const [id, object] of Object.entries(expected.objects)) {
        assert.equal(store.object(id).class, object.class);
        for (const [role, f] of Object.entries(object.files)) assert.equal(store.objectBytes(id, role).byteLength, f.size, `${lang}: ${id}#${role}`);
      }
      const data = new StoryData(store);
      assert.equal(data.episode.advId, head.story.advId);
      for (const key of Object.keys(data.parts.models)) {
        const m = modelIndex(store, data.model(key).dir);
        assert.ok(store.roles(m.moc).includes("blob:_bytes"), `${lang}: ${key}: the moc's bytes`);
      }
      for (const sheet of Object.keys(data.parts.sounds)) assert.ok(data.cues(sheet), `${lang}: ${sheet}`);
      assert.equal(data.fonts.language, lang);
      assert.equal(data.ui.language.code, lang);
      assert.equal(store.info.loadedLanguage, lang);
    }
  });
}
