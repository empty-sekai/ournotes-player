// scripts/validate-data.mjs on the manifest keys of a site of several regions / languages and on model manifests:
// the schemas describe regions, language, titles and bandNames, a model manifest is a product manifest of live2d.model;
// without charts.json the region manifests charts/<region>/<id>.json are validated too; a models.json entry agrees
// with its model. Synthetic sites (the chart manifests list no files, so their content checks fail; the lines checked
// here are the schema and index ones).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";
import { modelObjects, modelProduct, productSize } from "./site-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "..", "scripts", "validate-data.mjs");
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, "..", "..", "schema", `${name}.schema.json`), "utf8")));

// validates a site of the JSON files `files` (path -> value; a function: called with the site directory first)
const site = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-site-"));
  if (typeof files === "function") files = files(dir);
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

test("without charts.json the region manifests are validated too", () => {
  const r = site({ "charts/1_easy.json": manifest({ regions: ["tw"] }), "charts/kr/1_easy.json": manifest({ regions: ["K R"] }) });
  assert.equal(r.status, 1);
  assert.equal(r.lines.filter((l) => l === "FAIL 1_easy").length, 2);
  assert.ok(r.lines.includes("0/2 charts valid"));
  assert.equal(r.lines.filter((l) => l.startsWith("manifest:") && l.includes("/regions/0")).length, 1);
});

const KEY = "Character/Live2D/g/m1/model/m1";

test("a models.json entry agrees with its model: id, key and group of the subject; canvas and textures of model.json; bytes and files", () => {
  const lines = (entry, edit = (m) => m) => site((dir) => {
    const m = modelObjects("m1"), man = edit(modelProduct(dir, m));
    const files = Object.keys(man.files).length + Object.values(man.objects).reduce((n, o) => n + Object.keys(o.files).length, 0);
    const full = { id: "m1", manifest: "models/m1.json", key: KEY, group: "g", canvas: m.model.canvas, textures: 1,
                   bytes: productSize(man), files };
    return { "models.json": { format: 2, models: [{ ...full, ...entry }] }, "models/m1.json": man };
  });
  const ok = lines({});
  assert.equal(ok.status, 0, ok.lines.join("\n"));
  assert.deepEqual(ok.lines, ["1/1 models valid"]);
  const bad = lines({ key: "other", group: "h", textures: 2, bytes: 1, files: 1, canvas: {} });
  assert.equal(bad.status, 1);
  for (const l of [`models.json: key other, manifest subject ${KEY}`, "models.json: group h, the manifest subject's g",
                   "models.json: textures 2, model.json 1", "models.json: canvas differs from model.json canvas"])
    assert.ok(bad.lines.includes(l), `${l} in\n${bad.lines.join("\n")}`);
  assert.ok(bad.lines.some((l) => l.startsWith("models.json: bytes 1, manifest files total")), bad.lines.join("\n"));
  assert.ok(bad.lines.some((l) => l.startsWith("models.json: files 1, manifest")), bad.lines.join("\n"));
});

test("models.json: display names of the models", () => {
  const names = { ja: "ア", en: "A" };
  assert.deepEqual(schema("models")({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", character: 3, names, label: "A" }] }), []);
  assert.ok(schema("models")({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", character: 1.5 }] })
    .some((e) => e.includes("/models/0/character")));
  assert.ok(schema("models")({ format: 2, models: [{ id: "m1", manifest: "models/m1.json", names: { ja: "" } }] })
    .some((e) => e.includes("/models/0/names/ja")));
});

test("chart manifests: formats 2 and 3, file entries stored as they are or encoded", () => {
  const a = "a".repeat(64);
  const files = { "live.json": { asset: `assets/${a}.json.gz`, size: 100, stored: 60 },
                  "x.glsl": { asset: `assets/${a}.glsl.br`, size: 100, stored: 40 },
                  "t.png": { asset: `assets/${a}.png`, size: 10 },
                  "n.json": { parts: [["k", `assets/${a}.json.gz`, 50, 20], ["l", `assets/${a}.json`, 5]], size: 63 } };
  for (const format of [2, 3]) assert.deepEqual(schema("manifest")(manifest({ format, files })), []);
  for (const format of [1, 4]) assert.ok(schema("manifest")(manifest({ format })).some((e) => e.includes("/format")));
  assert.ok(schema("manifest")(manifest({ files: { "live.json": { asset: `assets/${a}.json.gz`, size: 100 } } })).length > 0);
});

test("product manifests and model.json: whole, encoded and split files; model.json format 3", () => {
  const a = "a".repeat(64), S = schema("product");
  const man = { schema: "nnnotes.product/1", product: "live2d.model", subject: KEY,
                files: { "model.json": { asset: `assets/${a}.json.gz`, size: 100, stored: 60 } },
                objects: { "CAB-x:-12": { class: "Texture2D", name: "t", files: { json: { asset: `assets/${a}.json`, size: 9 },
                                                                                 image: { asset: `assets/${a}.png`, size: 10 } } } } };
  assert.deepEqual(S(man), []);
  assert.ok(S({ ...man, schema: "nnnotes.product/2" }).some((e) => e.includes("/schema")));
  assert.ok(S({ ...man, objects: { "CAB-x": man.objects["CAB-x:-12"] } }).length > 0);              // not an object id
  assert.deepEqual(S({ ...man, files: { "n.json": { parts: [["k", `assets/${a}.json`, 5]], size: 11 } } }), []);
  assert.deepEqual(S({ ...man, files: { "n.json": { parts: [["k", `assets/${a}.json.gz`, 5, 3]], size: 11 } } }), []);
  assert.ok(S({ ...man, files: { "n.json": { parts: [["k", `assets/${a}.json`]], size: 11 } } }).length > 0);
  const { model } = modelObjects("m1");
  assert.deepEqual(schema("model-json")(model), []);
  assert.ok(schema("model-json")({ ...model, format: 2 }).some((e) => e.includes("/format")));
  const { motionSync, ...noSync } = model;
  assert.equal(motionSync, false);
  assert.ok(schema("model-json")(noSync).length > 0);
  assert.ok(schema("model-json")({ ...model, moc: "m1.moc3" }).some((e) => e.includes("/moc")));
});

test("a model manifest's subject names the model of the manifest's name", () => {
  const r = site((dir) => ({ "models/m2.json": modelProduct(dir, modelObjects("m1")) }));
  assert.equal(r.status, 1);
  assert.ok(r.lines.includes("manifest: subject: model m1, expected m2 (the manifest's name)"), r.lines.join("\n"));
});
