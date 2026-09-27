// AssetStore (src/data/assets.js): in-memory files, and loading a chart manifest with whole and split files, stored
// as they are or gzip / brotli encoded (docs/data-format.md "File entries"). A fake fetch serves a synthetic site; no
// game data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { AssetStore, TEXT_FILE, assetEncoding, decodeAsset } from "../../src/data/assets.js";

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

// ------------------------------------------------------------------------------------------------ encoded assets
// a manifest with an encoded whole file, an encoded part and a file stored as it is; `served`: what the server sends
// for the encoded assets ("encoded": the stored bytes; "decoded": the file, as with Content-Encoding)
const encodedFixture = (encoding = "gzip", served = "encoded") => {
  const ext = encoding === "gzip" ? "gz" : "br";
  const zip = (s) => new Uint8Array(encoding === "gzip" ? gzipSync(enc.encode(s)) : brotliCompressSync(enc.encode(s)));
  const scene = JSON.stringify({ scene: "x".repeat(400) }), part = JSON.stringify({ list: Array(200).fill(1) });
  const rebuilt = `{"settings":${part},"small":[1]}`;
  const z1 = zip(scene), z2 = zip(part);
  const man = {
    format: 3, musicId: 1, difficulty: "easy",
    files: {
      "live.json": { asset: `assets/a.json.${ext}`, size: size(scene), stored: z1.byteLength },
      "notes.json": { parts: [["settings", `assets/p.json.${ext}`, size(part), z2.byteLength], ["small", "assets/s.json", 3]],
                      size: size(rebuilt) },
      "tex/x.png": { asset: "assets/b.png", size: 3 },
    },
  };
  const files = {
    [`${ROOT}charts/1_easy.json`]: JSON.stringify(man),
    [`${ROOT}assets/a.json.${ext}`]: served === "encoded" ? z1 : scene,
    [`${ROOT}assets/p.json.${ext}`]: served === "encoded" ? z2 : part,
    [`${ROOT}assets/s.json`]: "[1]",
    [`${ROOT}assets/b.png`]: new Uint8Array([1, 2, 3]),
  };
  return { man, files, scene, rebuilt, z1, z2 };
};

test("fromManifest: gzip assets decoded by the player, progress in stored bytes", async () => {
  const { files, scene, rebuilt, z1, z2 } = encodedFixture("gzip");
  const progress = [];
  const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { ...site(files), onProgress: (a, b) => progress.push([a, b]) });
  assert.equal(s.text("live.json"), scene);
  assert.equal(s.text("notes.json"), rebuilt);                 // an encoded part (4 items) and a plain one
  assert.deepEqual([...s.bytes("tex/x.png")], [1, 2, 3]);
  const total = z1.byteLength + z2.byteLength + 3 + 3;
  assert.deepEqual(progress.at(-1), [total, total]);
  assert.equal(assetEncoding("assets/a.json.gz"), "gzip");
  assert.equal(assetEncoding("assets/a.moc3.br"), "br");
  assert.equal(assetEncoding("assets/a.json"), null);
});

test("fromManifest: an asset the server already decoded (Content-Encoding) is used as it is", async () => {
  for (const encoding of ["gzip", "br"]) {
    const { files, scene, rebuilt } = encodedFixture(encoding, "decoded");
    let calls = 0;
    const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { ...site(files), decode: async () => { calls++; throw new Error("no"); } });
    assert.equal(s.text("live.json"), scene);
    assert.equal(s.text("notes.json"), rebuilt);
    assert.equal(calls, 0);
  }
});

test("fromManifest: a length that is neither the stored nor the decoded size fails; so does a wrong decoded size", async () => {
  {
    const { files, z1 } = encodedFixture("gzip");
    files[`${ROOT}assets/a.json.gz`] = z1.slice(0, z1.byteLength - 1);
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /live\.json: \d+ bytes, manifest \d+ stored, \d+/);
  }
  {
    const { man, files } = encodedFixture("gzip");
    man.files["live.json"].size += 1;
    files[`${ROOT}charts/1_easy.json`] = JSON.stringify(man);
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /live\.json: \d+ bytes decoded, manifest \d+/);
  }
  {
    const { man, files } = encodedFixture("gzip");
    man.files["tex/x.png"].stored = 3;                          // a stored count on an asset that is not encoded
    man.files["tex/x.png"].size = 9;
    files[`${ROOT}charts/1_easy.json`] = JSON.stringify(man);
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)), /no \.gz \/ \.br name/);
  }
});

test("fromManifest: brotli without DecompressionStream(\"brotli\") needs Content-Encoding: br; an injected decoder", async () => {
  const { files, scene, rebuilt } = encodedFixture("br");
  const Saved = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class extends Saved {
    constructor(format) { if (format === "brotli") throw new TypeError("unsupported"); super(format); }
  };
  try {
    await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, site(files)),
                         /a \.br asset must be served with Content-Encoding: br/);
    await assert.rejects(decodeAsset(new Uint8Array(1), "br"), /Content-Encoding: br/);
  } finally { globalThis.DecompressionStream = Saved; }
  const seen = [];
  const decode = async (bytes, encoding) => { seen.push(encoding); return brotliDecompressSync(bytes); };   // a Node Buffer
  const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { ...site(files), decode });
  assert.deepEqual(seen, ["br", "br"]);
  assert.equal(s.text("live.json"), scene);
  assert.equal(s.text("notes.json"), rebuilt);
  await assert.rejects(AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { ...site(files), decode: async () => { throw new Error("bad data"); } }),
                       /live\.json: assets\/a\.json\.br: bad data/);
});

test("decodeAsset: gzip through DecompressionStream; an unknown encoding", async () => {
  const text = "y".repeat(1000);
  assert.equal(new TextDecoder().decode(await decodeAsset(new Uint8Array(gzipSync(enc.encode(text))), "gzip")), text);
  await assert.rejects(decodeAsset(new Uint8Array(1), "zstd"), /unknown content encoding zstd/);
});

test("fromManifest: bytes from a decoder that returns a Node Buffer are copied by bytes()", async () => {
  const bin = new Uint8Array(300).fill(7), z = new Uint8Array(gzipSync(bin));
  const man = { format: 3, files: { "x.bin": { asset: "assets/x.bin.gz", size: 300, stored: z.byteLength } } };
  const files = { [`${ROOT}charts/1_easy.json`]: JSON.stringify(man), [`${ROOT}assets/x.bin.gz`]: z };
  const s = await AssetStore.fromManifest(`${ROOT}charts/1_easy.json`, { ...site(files), decode: async (b) => gunzipSync(b) });
  const a = s.bytes("x.bin");
  a[0] = 1;
  assert.equal(s.bytes("x.bin")[0], 7);
});
