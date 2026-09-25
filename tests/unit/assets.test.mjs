// AssetStore (src/data/assets.js): in-memory files, and loading a chart manifest with whole and split files
// (docs/data-format.md "File entries"). A fake fetch serves a synthetic site; no game data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore, TEXT_FILE } from "../../src/data/assets.js";

const enc = new TextEncoder();

// a fake site: URL -> bytes, and a fetch over it that records the requested URLs
const site = (files) => {
  const requested = [];
  const fetch = async (u) => {
    requested.push(String(u));
    const b = files[String(u)];
    if (b === undefined) return { ok: false, status: 404 };
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    return { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(bytes)),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  return { fetch, requested };
};

const ROOT = "https://example.test/site/";
const size = (s) => enc.encode(s).byteLength;

// a manifest with a whole text file, a binary file and a JSON file split into parts
const fixture = () => {
  const parts = { settings: '{"laneCount":24}', big: '{"inf":1e999,"f":0.009999999776482582}', list: "[1,2,3]" };
  const rebuilt = `{"settings":${parts.settings},"big":${parts.big},"list":${parts.list}}`;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const man = {
    format: 2, musicId: 1, difficulty: "easy", quality: 1, chart: { title: "t" },
    files: {
      "live.json": { asset: "assets/a.json", size: size('{"scene":"s.json"}') },
      "tex/x.png": { asset: "assets/b.png", size: png.byteLength },
      "notes.json": { parts: Object.entries(parts).map(([k, v]) => [k, `assets/${k}.json`, size(v)]), size: size(rebuilt) },
    },
  };
  const files = {
    [`${ROOT}charts/1_easy.json`]: JSON.stringify(man),
    [`${ROOT}assets/a.json`]: '{"scene":"s.json"}',
    [`${ROOT}assets/b.png`]: png,
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [`${ROOT}assets/${k}.json`, v])),
  };
  return { man, files, parts, rebuilt, png };
};

test("in-memory store: text, bytes, json, list, missing paths", () => {
  const s = new AssetStore({ text: { "a.json": '{"x":1}', "p.glsl": "void main(){}" }, bytes: { "b.png": new Uint8Array([1, 2]) } });
  assert.equal(s.has("a.json"), true);
  assert.equal(s.has("nope"), false);
  assert.deepEqual(s.json("a.json"), { x: 1 });
  assert.equal(s.text("p.glsl"), "void main(){}");
  const b = s.bytes("b.png");
  b[0] = 9;                                          // a copy: the store keeps its bytes
  assert.deepEqual([...s.bytes("b.png")], [1, 2]);
  assert.equal(s.arrayBuffer("b.png").byteLength, 2);
  assert.deepEqual(s.list("").sort(), ["a.json", "b.png", "p.glsl"]);
  assert.throws(() => s.text("missing.json"), /missing\.json/);
  assert.throws(() => s.bytes("missing.png"), /missing\.png/);
});

test("text files are .json and .glsl", () => {
  assert.ok(TEXT_FILE.test("live.json") && TEXT_FILE.test("x/y.glsl"));
  assert.ok(!TEXT_FILE.test("a.png") && !TEXT_FILE.test("a.flac") && !TEXT_FILE.test("a.m4a"));
});

test("fromManifest: whole files, split parts rebuilt verbatim, info without files", async () => {
  const { files, rebuilt, png } = fixture();
  const { fetch, requested } = site(files);
  const progress = [];
  const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { fetch, onProgress: (a, b) => progress.push([a, b]) });
  assert.equal(s.text("notes.json"), rebuilt);
  const notes = s.json("notes.json");
  assert.equal(notes.big.inf, Infinity);             // 1e999 kept as written, parsed as Infinity
  assert.equal(notes.big.f, 0.009999999776482582);
  assert.deepEqual(notes.list, [1, 2, 3]);
  assert.deepEqual([...s.bytes("tex/x.png")], [...png]);
  assert.deepEqual(s.json("live.json"), { scene: "s.json" });
  assert.equal(s.info.files, undefined);
  assert.equal(s.info.quality, 1);
  assert.deepEqual(s.info.chart, { title: "t" });
  // asset paths resolve against the directory above charts/; every asset fetched once
  assert.equal(requested[0], `${ROOT}charts/1_easy.json`);
  assert.equal(new Set(requested).size, requested.length);
  assert.ok(requested.slice(1).every((u) => u.startsWith(`${ROOT}assets/`)));
  const total = Object.entries(files).filter(([u]) => u.includes("/assets/"))
    .reduce((n, [, b]) => n + (typeof b === "string" ? size(b) : b.byteLength), 0);
  assert.deepEqual(progress.at(-1), [total, total]);
});

test("fromManifest: a shared asset is fetched once", async () => {
  const { man, files } = fixture();
  man.files["copy.json"] = { ...man.files["live.json"] };
  files[`${ROOT}charts/1_easy.json`] = JSON.stringify(man);
  const { fetch, requested } = site(files);
  const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { fetch });
  assert.equal(s.text("copy.json"), s.text("live.json"));
  assert.equal(requested.filter((u) => u.endsWith("assets/a.json")).length, 1);
});

test("fromManifest rejects a wrong asset size, a wrong rebuilt size and HTTP errors", async () => {
  {
    const { man, files } = fixture();
    man.files["live.json"].size += 1;
    files[`${ROOT}charts/1_easy.json`] = JSON.stringify(man);
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /live\.json/);
  }
  {
    const { man, files } = fixture();
    man.files["notes.json"].size += 1;
    files[`${ROOT}charts/1_easy.json`] = JSON.stringify(man);
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /notes\.json/);
  }
  {
    const { files } = fixture();
    delete files[`${ROOT}assets/b.png`];
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /404/);
  }
});

test("fromManifest: an explicit base for asset paths", async () => {
  const { man, files } = fixture();
  const moved = { [`https://cdn.example.test/m/1_easy.json`]: JSON.stringify(man) };
  for (const [u, b] of Object.entries(files)) if (u.includes("/assets/")) moved[u.replace(ROOT, "https://cdn.example.test/data/")] = b;
  const s = await AssetStore.fromManifest("https://cdn.example.test/m/1_easy.json",
                                          { ...site(moved), base: "https://cdn.example.test/data/" });
  assert.deepEqual(s.json("live.json"), { scene: "s.json" });
});
