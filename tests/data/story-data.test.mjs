// Opt-in: a story site (stories.json, stories/, assets/) against docs/story-data-format.md, through the validator and
// the player's story loader in Node.
//
//   OURNOTES_STORY_SITE=<site dir>     a site with stories (skipped without it)
//   OURNOTES_STORY_IDS=<id>,...|all    the stories loaded per language (default: the first three of stories.json); an
//                                      id is the manifest path below stories/ without .json (10462, tw/10462)
//
// Checks: scripts/validate-data.mjs passes every story of the site; per chosen story and language, loadStoryStore
// (src/story/assets.js) with a file fetch holds exactly the common files and that language's files with their
// manifest sizes, the paths story.json names resolve in it, and ui/fonts.json and ui/languages.json are of that
// language. The stories whose required commands this player lacks are reported (a diagnostic, not a failure).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchStoryManifest, loadStoryStore } from "../../src/story/assets.js";

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
  test(`story ${idOf(e.manifest)}: every language through loadStoryStore`, async (t) => {
    const url = pathToFileURL(path.join(SITE, e.manifest)).href;
    const man = JSON.parse(fs.readFileSync(path.join(SITE, e.manifest), "utf8"));
    try { await fetchStoryManifest(url, { fetch: fileFetch }); }
    catch (err) { t.diagnostic(`refused by this player: ${err.message}`); }
    for (const lang of Object.keys(man.languages)) {
      const store = await loadStoryStore(url, { lang, fetch: fileFetch, manifest: { url, manifest: man } });
      const files = { ...man.files, ...man.languages[lang].files };
      assert.deepEqual(store.list().sort(), Object.keys(files).sort(), `${lang}: the store's files`);
      for (const [p, f] of Object.entries(files)) {
        const size = /\.(json|glsl)$/.test(p) ? Buffer.byteLength(store.text(p)) : store.bytes(p).byteLength;
        assert.equal(size, f.size, `${lang}: ${p}`);
      }
      const story = store.json("story.json");
      for (const p of [story.episode, story.scene, story.ui]) assert.ok(store.has(p), `${lang}: ${p}`);
      for (const [key, m] of Object.entries(story.models))
        for (const f of [m.moc3, m.prefab]) assert.ok(store.has(`${m.dir}/${f}`), `${lang}: ${key}: ${f}`);
      for (const dir of Object.values(story.audio)) assert.ok(store.has(`${dir}/cues.json`), `${lang}: ${dir}/cues.json`);
      assert.equal(store.json("ui/fonts.json").language, lang);
      assert.equal(store.json("ui/languages.json").language, lang);
      assert.equal(store.info.loadedLanguage, lang);
    }
  });
}
