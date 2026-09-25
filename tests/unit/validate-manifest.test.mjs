// scripts/validate-data.mjs on the manifest keys of a site of several regions / languages and on model manifests:
// the schemas describe regions, language, titles, bandNames and the model facts; without charts.json the region
// manifests charts/<region>/<id>.json are validated too; models.json facts must equal the manifest's. Synthetic sites
// (the manifests list no files, so the content checks fail; the lines checked here are the schema and index ones).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "..", "scripts", "validate-data.mjs");
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, "..", "..", "schema", `${name}.schema.json`), "utf8")));

const site = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-site-"));
  for (const [p, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), JSON.stringify(v));
  }
  try {
    const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    return { status: r.status, lines: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

const manifest = (extra = {}, chart = {}) => ({ format: 2, musicId: 1, difficulty: "easy", audio: false, flows: ["direct"],
                                                 chart: { title: "t", ...chart }, files: {}, ...extra });

test("manifest schema: regions, language, titles and bandNames; a manifest without them stays valid", () => {
  const S = schema("manifest");
  assert.deepEqual(S(manifest()), []);
  assert.deepEqual(S(manifest({ regions: ["tw", "kr"] },
                              { language: "zh-Hant", titles: { ja: "a", en: "b" }, bandNames: { ja: ["x", "y"] } })), []);
  assert.ok(S(manifest({ regions: ["T W"] })).some((e) => e.includes("/regions/0")));
  assert.ok(S(manifest({ regions: [] })).some((e) => e.includes("/regions")));
  assert.ok(S(manifest({}, { titles: { ja: 1 } })).some((e) => e.includes("/chart/titles/ja")));
  assert.ok(S(manifest({}, { bandNames: { ja: "x" } })).some((e) => e.includes("/chart/bandNames/ja")));
  assert.ok(S(manifest({}, { language: "" })).some((e) => e.includes("/chart/language")));
});

test("model manifest schema: the model facts", () => {
  const S = schema("model");
  const m = (model) => ({ format: 2, id: "m1", files: {}, ...(model === undefined ? {} : { model }) });
  assert.deepEqual(S(m()), []);
  assert.deepEqual(S(m({ group: "003_adv", textures: 2, nodes: 525, extra: true,
                         canvas: { pixelsPerUnit: 6000, originX: 3000, originY: 4500, width: 6000, height: 9000, mocVersion: 5 } })), []);
  assert.ok(S(m({ textures: -1 })).some((e) => e.includes("/model/textures")));
  assert.ok(S(m({ canvas: { mocVersion: 5.5 } })).some((e) => e.includes("/model/canvas/mocVersion")));
});

test("without charts.json the region manifests are validated too", () => {
  const r = site({ "charts/1_easy.json": manifest({ regions: ["tw"] }), "charts/kr/1_easy.json": manifest({ regions: ["K R"] }) });
  assert.equal(r.status, 1);
  assert.equal(r.lines.filter((l) => l === "FAIL 1_easy").length, 2);
  assert.ok(r.lines.includes("0/2 charts valid"));
  assert.equal(r.lines.filter((l) => l.startsWith("manifest:") && l.includes("/regions/0")).length, 1);
});

test("a models.json entry's key and facts equal its manifest's", () => {
  const man = { format: 2, id: "m1", key: "Character/Live2D/g/m1", model: { group: "g", textures: 2 }, files: {} };
  const ok = site({ "models.json": { format: 2, models: [{ id: "m1", manifest: "models/m1.json", key: man.key, group: "g", textures: 2 }] },
                    "models/m1.json": man });
  assert.ok(!ok.lines.some((l) => l.startsWith("models.json:")), ok.lines.join("\n"));
  const bad = site({ "models.json": { format: 2, models: [{ id: "m1", manifest: "models/m1.json", key: "other", group: "h", textures: 2 }] },
                     "models/m1.json": man });
  assert.equal(bad.status, 1);
  assert.ok(bad.lines.includes("models.json: key differs from the manifest"));
  assert.ok(bad.lines.includes("models.json: group differs from the manifest's model.group"));
  assert.ok(!bad.lines.some((l) => l.includes("model.textures")));
});

test("model display names: schemas, and equal in models.json and the manifest when either has them", () => {
  const names = { ja: "エー", "zh-Hant": "A" };
  assert.deepEqual(schema("model")({ format: 2, id: "m1", files: {}, model: { character: 3, names, label: "A" } }), []);
  assert.deepEqual(schema("models")({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", character: 3, names, label: "A" }] }), []);
  assert.ok(schema("model")({ format: 2, id: "m1", files: {}, model: { names: { ja: "" } } }).some((e) => e.includes("/model/names/ja")));
  assert.ok(schema("models")({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", character: 1.5 }] })
    .some((e) => e.includes("/models/0/character")));
  const man = (model) => ({ format: 2, id: "m1", key: "k", model: { group: "g", ...model }, files: {} });
  const entry = (extra) => ({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", ...extra }] });
  const lines = (index, m) => site({ "models.json": index, "models/m1.json": m }).lines.filter((l) => l.startsWith("models.json:"));
  assert.deepEqual(lines(entry({ character: 3, names, label: "A" }), man({ character: 3, names, label: "A" })), []);
  assert.deepEqual(lines(entry({}), man({})), []);
  assert.deepEqual(lines(entry({ character: 3, label: "A" }), man({ names })), [
    "models.json: character differs from the manifest's model.character",
    "models.json: names differs from the manifest's model.names",
    "models.json: label differs from the manifest's model.label",
  ]);
});
