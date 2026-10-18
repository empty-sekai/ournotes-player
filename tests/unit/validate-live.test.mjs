// scripts/validate-data.mjs on synthetic live charts: a complete chart of the site layout (charts/7_expert.json), the same
// chart as a product layout (lives/7_expert.json and the products its live.json names), and mutations of that layout.
// The chart's documents are the fixture's (live-legacy-fixture.mjs) completed here, so the validator reads them as a live.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AssetStore } from "../../src/data/assets.js";
import { legacyLive } from "../../src/live/legacy.js";
import { AUDIO, NOTES, SCENE, chartFiles, node, sprite } from "./live-legacy-fixture.mjs";
import { glsl, png, putAsset, putFiles, sha256 } from "./site-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "..", "scripts", "validate-data.mjs");

// the chart manifest without its files: the chart's info in the store (format 2, the site layout's chart)
const INFO = { format: 2, musicId: 7, difficulty: "expert", audio: true, quality: 1, flows: ["direct"], chart: {} };

// a score of `laneCount` lanes: one tap note on lane 0, no lines (the schema's minimum)
const score = (laneCount) => ({ laneCount, notes: [{ id: 1, op: 1, timeMs: 1000, bar: 0, barProgress: 0, laneStart: 0, laneEnd: 0,
  laneStartFloat: 0, laneEndFloat: 0, width: 1, critical: false, direction: "Normal", slideAlong: false, lineIds: [],
  lineEase: "Linear", lineEaseR: "Linear", pairNoteId: 0 }], lines: [] });

// an MP4 file: its ftyp box at bytes 4..8
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypM4A ", "latin1"), Buffer.alloc(12)]);
// a FLAC file with its STREAMINFO block: 48 kHz, 2 channels, 16 bits, `samples` samples (STREAMINFO at bytes 8..42)
const flac = (samples) => {
  const b = Buffer.alloc(42);
  b.write("fLaC", 0, "latin1");
  b.writeUIntBE(34, 5, 3);
  b.writeBigUInt64BE((48000n << 44n) | (1n << 41n) | (15n << 36n) | BigInt(samples), 18);
  return b;
};
// a 4x4 PNG for each texture name of a chart directory
const pngs = (dir, names) => Object.fromEntries(names.map((n) => [`${dir}/textures/${n}.png`, png(4, 4)]));
const SCENE_TEXTURES = ["bg", "grain", "jacket", "judge", "lane_base", "lane_line", "lane_tap_area", "out_side_line", "white"];
const NOTES_TEXTURES = ["digit0", "flick", "judge", "judge_perfect", "tap"];

// the fixture's documents completed: the lane skin's sprites, the scene's option and quality settings, the note prefabs,
// the notes' settings, the sounds of the notes (volumes, mutes, the live SEs) and the files the waveforms need
const simple = (key) => ({ key, nodes: [node(key, [{ type: "MonoBehaviour", class: "LiveNoteView" }])] });
const scene = {
  ...SCENE,
  laneSkin: { lane_base: sprite("lane_base"), lane_tap_area: sprite("lane_tap_area"), out_side_line: sprite("out_side_line") },
  master: { ...SCENE.master,
            optionDefaultsPreset1: { LaneOpacity: { value: "80" }, JudgePositionDisplay: { value: "0" }, NoteStartPosition: { value: "0" } },
            liveQualitySettings: [0, 1, 2].map((q) => ({ _quality: q, _effectRenderingScale: 1 })) },
};
const notes = {
  ...NOTES,
  prefabs: { ...NOTES.prefabs, ...Object.fromEntries(["flick_left_note_view", "flick_right_note_view", "slide_note_view",
    "slide_end_note_view", "connection_note_view", "none_note_view", "slide_line_view", "pair_note_line"].map((k) => [k, simple(k)])) },
  settings: { ...NOTES.settings, laneCount: 4, laneSize: [1, 1], laneTopRange: 1, laneBottomRange: 1, laneTopPosition: 0,
              judgementScreenBottomPosition: 0,
              optionDefaults: { ...NOTES.settings.optionDefaults, SlideOpacity: "60", GuideOpacity: "60" },
              optionRanges: { ...NOTES.settings.optionRanges, SlideOpacity: [10, 100], GuideOpacity: [10, 100] },
              liveSettings: { note_speed_min: "1", note_speed_max: "10", note_speed_view_min: "1", note_speed_view_max: "10" } },
};
const audio = { ...AUDIO, noteSe: { types: { 1: 10 }, volumes: { 1: 1 }, mutes: { 1: false } }, liveSe: { 10: 10, 16: 10 } };
const bytes = { "audio/bgm_7/bgm_7.m4a": MP4, "audio/se1/a.flac": flac(4800), ...pngs("livescene", SCENE_TEXTURES),
                ...pngs("livenotes", NOTES_TEXTURES) };

// a complete chart of the site layout (the fixture's text and bytes); `over` replaces documents
const chart = (over = {}) => chartFiles({}, { scene, notes, audio, glsl, score: score(4), mirror: score(4), bytes, ...over });

// runs the validator on a site directory: `build(dir)` returns the site's JSON documents (path -> value; the site's
// assets are written under dir by then); -> {status, lines, stderr}
const run = (build) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-live-"));
  try {
    for (const [p, v] of Object.entries(build(dir))) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), JSON.stringify(v));
    }
    const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    return { status: r.status, lines: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean), stderr: r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

// asserts that a line of the validator's output contains `text`
const hasLine = (r, text) => assert.ok(r.lines.some((l) => l.includes(text)), `no line with ${JSON.stringify(text)} in:\n${r.lines.join("\n")}`);

// the chart of the site layout: charts/7_expert.json over the chart's files, stored under dir/assets
const chartSite = (dir, c) => ({ "charts/7_expert.json": { ...INFO, files: putFiles(dir, { ...c.text, ...c.bytes }) } });

const roleExt = (role) => (role === "image" ? "png" : role.startsWith("program:") ? "glsl" : role.startsWith("blob:") ? "bin"
  : role === "json" || role === "index" || role === "arrays" ? "json" : "bin");

// The product layout of a chart read through legacyLive (docs/data-format.md "Products"): one manifest per product
// directory with the files under it and the store's objects, each product's manifest named by its directory (or by
// `manifests`: directory -> path without .json); live.json names its parts by those paths (`parts` overrides them). `edit`
// maps an overlay path to replacement contents; `objectEdit(id, object)` returns the object to store.
const productDocs = (dir, c, { manifests = {}, parts = {}, edit = {}, objectEdit = (id, o) => o } = {}) => {
  const overlay = legacyLive(new AssetStore({ text: c.text, bytes: c.bytes, info: INFO }));
  const liveDir = overlay.info.products.live[`${overlay.info.musicId}/${overlay.info.difficulty}`];
  const liveFile = `${liveDir}/live.json`, live = JSON.parse(overlay.text(liveFile));
  for (const [part, p] of Object.entries(live.parts)) live.parts[part] = `${manifests[p.slice(0, -5)] ?? p.slice(0, -5)}.json`;
  Object.assign(live.parts, parts);
  const contents = { ...edit, [liveFile]: JSON.stringify(live) };
  const contentOf = (p) => (contents[p] !== undefined ? contents[p] : overlay.bytes(p));
  const objects = {};
  for (const id of overlay._objects.keys()) {
    const { class: cls, name } = overlay.object(id);
    const o = objectEdit(id, { class: cls, name, files: Object.fromEntries(overlay.roles(id).map((r) => [r, overlay.objectBytes(id, r)])) });
    objects[id] = { class: o.class, ...(o.name != null ? { name: o.name } : {}),
                    files: Object.fromEntries(Object.entries(o.files).map(([r, b]) => [r, putAsset(dir, `x.${roleExt(r)}`, b)])) };
  }
  const docs = {};
  for (const [product, subjects] of Object.entries(overlay.info.products))
    for (const [subject, directory] of Object.entries(subjects)) {
      const prefix = `${directory}/`;
      const files = Object.fromEntries(overlay.list(prefix).map((p) => [p.slice(prefix.length),
        putAsset(dir, p.slice(prefix.length), contentOf(p))]));
      docs[`${manifests[directory] ?? directory}.json`] = { schema: "nnnotes.product/1", product, subject, files, objects };
    }
  return docs;
};

test("a valid chart of the site layout validates", () => {
  const r = run((dir) => chartSite(dir, chart()));
  assert.equal(r.status, 0, `${r.lines.join("\n")}\n${r.stderr}`);
  assert.deepEqual(r.lines, ["1/1 charts valid"]);
});

test("a chart whose live.json has no scene is reported as not readable as a live", () => {
  const c = chart();
  const live = JSON.parse(c.text["live.json"]);
  delete live.scene;
  c.text["live.json"] = JSON.stringify(live);
  const r = run((dir) => chartSite(dir, c));
  assert.equal(r.status, 1);
  assert.ok(r.lines.some((l) => l.startsWith("live.json: not readable as a live")), r.lines.join("\n"));
});

test("the same chart as a product layout validates", () => {
  const r = run((dir) => productDocs(dir, chart()));
  assert.equal(r.status, 0, `${r.lines.join("\n")}\n${r.stderr}`);
  assert.deepEqual(r.lines, ["1/1 lives valid"]);
});

const indexedProduct = (dir) => {
  const docs = productDocs(dir, chart(), { manifests: { "lives/7_expert": "charts/7_expert" } });
  const manifest = "charts/7_expert.json", root = docs[manifest];
  const unique = new Map();
  for (const doc of Object.values(docs))
    for (const files of [doc.files, ...Object.values(doc.objects).map((o) => o.files)])
      for (const f of Object.values(files)) unique.set(f.asset, f.size);
  const facts = { title: "Example", level: 1, notes: 4, durationMs: 100 };
  const metadata = { musicId: 7, difficulty: "expert", audio: true, audioFormat: "aac", quality: 1,
    flows: ["direct"], regions: ["one"] };
  Object.assign(root, metadata, { chart: facts });
  docs["charts.json"] = { format: 2, language: "en", regions: [{ id: "one" }], charts: [
    { id: "7_expert", manifest, ...facts, ...metadata, bytes: [...unique.values()].reduce((a, b) => a + b, 0) },
  ] };
  return docs;
};

test("product charts agree with their index and the complete asset closure", () => {
  const result = run(indexedProduct);
  assert.equal(result.status, 0, result.lines.join("\n"));
});

for (const [field, value] of [["regions", ["two"]], ["audio", false], ["audioFormat", "flac"],
  ["quality", 2], ["bytes", 1], ["title", "Changed"]]) {
  test(`product chart index rejects mismatched ${field}`, () => {
    const result = run((dir) => {
      const docs = indexedProduct(dir);
      docs["charts.json"].charts[0][field] = value;
      return docs;
    });
    assert.equal(result.status, 1);
    assert.match(result.lines.join("\n"), new RegExp(field));
  });
}

test("a live.noteskin naming a noteeffect manifest is reported", () => {
  const r = run((dir) => productDocs(dir, chart(), { parts: { noteskin: "noteeffects/effect001.json" } }));
  assert.equal(r.status, 1);
  hasLine(r, "product live.noteeffect, live.json names a live.noteskin");
  assert.deepEqual(r.lines, ["FAIL 7_expert", "noteeffects/effect001.json: manifest: product live.noteeffect, live.json names a live.noteskin",
                            "0/1 lives valid"]);
});

test("a Texture2D whose json size differs from its PNG is reported", () => {
  let done = false;
  const objectEdit = (id, o) => {
    if (done || o.class !== "Texture2D" || !o.files.image) return o;
    done = true;
    return { ...o, files: { ...o.files, json: Buffer.from(o.files.json).toString("utf8").replace('"m_Width":4', '"m_Width":8') } };
  };
  const r = run((dir) => productDocs(dir, chart(), { objectEdit }));
  assert.equal(r.status, 1);
  hasLine(r, "image: PNG is 4x4, the texture 8x4");
});

test("a score whose laneCount differs from the notes settings is reported", () => {
  const r = run((dir) => productDocs(dir, chart({ score: score(5), mirror: score(5) })));
  assert.equal(r.status, 1);
  hasLine(r, "lives/7_expert/notes.json: laneCount 5, notes.json settings.laneCount 4");
  hasLine(r, "lives/7_expert/notes.mirror.json: laneCount 5, notes.json settings.laneCount 4");
});

test("a part manifest named other than its subject is reported", () => {
  const r = run((dir) => productDocs(dir, chart(), { manifests: { "noteskins/skin001": "noteskins/other" } }));
  assert.equal(r.status, 1);
  hasLine(r, "the manifest's name is other, not skin001");
});

test("immutable part manifests are checked by content identity", () => {
  const build = damaged => dir => {
    const docs = productDocs(dir, chart()), part = docs["noteskins/skin001.json"];
    const target = `products/${sha256(JSON.stringify(part))}.json`;
    delete docs["noteskins/skin001.json"];
    docs[target] = damaged ? { ...part, root: "../" } : part;
    const root = docs["lives/7_expert.json"];
    const live = JSON.parse(fs.readFileSync(path.join(dir, root.files["live.json"].asset), "utf8"));
    live.parts.noteskin = target;
    root.files["live.json"] = putAsset(dir, "live.json", live);
    return docs;
  };
  const valid = run(build(false));
  assert.equal(valid.status, 0, valid.lines.join("\n"));
  const invalid = run(build(true));
  assert.equal(invalid.status, 1);
  hasLine(invalid, "content id differs from the immutable manifest path");
});

test("two lives sharing one broken part report its errors once", () => {
  const r = run((dir) => {
    const docs = productDocs(dir, chart(), { edit: { "noteskins/skin001/noteskin.json": "{" } });
    docs["lives/7_hard.json"] = { ...docs["lives/7_expert.json"], subject: "7/hard" };
    return docs;
  });
  assert.equal(r.status, 1);
  assert.equal(r.lines.filter((l) => l.includes("noteskins/skin001/noteskin.json: not valid JSON")).length, 1, r.lines.join("\n"));
  hasLine(r, "noteskins/skin001.json: not valid (reported above)");
});


test("a product chart alias and its offered variant products validate", () => {
  const build = missing => dir => {
    const docs = productDocs(dir, chart());
    const live = docs["lives/7_expert.json"];
    delete docs["lives/7_expert.json"];
    live.variants = [missing ? "noteskins/missing.json" : "noteskins/skin001.json"];
    docs["charts/7_expert.json"] = live;
    return docs;
  };
  const valid = run(build(false));
  assert.equal(valid.status, 0, valid.lines.join("\n"));
  assert.deepEqual(valid.lines, ["1/1 charts valid"]);
  const invalid = run(build(true));
  assert.equal(invalid.status, 1);
  hasLine(invalid, "noteskins/missing.json: missing");
});
