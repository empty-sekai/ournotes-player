// charts.json checks of scripts/validate-data.mjs for a site of several regions. Synthetic indexes only (the
// manifests they name do not exist; the index-level lines are checked).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "validate-data.mjs");

const entry = (id, manifest, extra = {}) => ({ id, musicId: Number(id.split("_")[0]), difficulty: id.split("_")[1],
  manifest, title: "t", level: 1, notes: 1, durationMs: 1, audio: false, flows: ["direct"], bytes: 0, ...extra });

const validate = (index) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-site-"));
  try {
    fs.writeFileSync(path.join(dir, "charts.json"), JSON.stringify(index));
    const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    return { status: r.status, lines: r.stdout.split("\n").filter((l) => l.startsWith("charts.json") || l.startsWith("FAIL charts.json")) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("an id once per region", () => {
  const ok = validate({ format: 2, regions: [{ id: "tw" }, { id: "kr" }], languages: ["ja"], charts: [
    entry("1_easy", "charts/1_easy.json", { regions: ["tw"], titles: { ja: "t" } }),
    entry("1_easy", "charts/kr/1_easy.json", { regions: ["kr"] })] });
  assert.deepEqual(ok.lines, []);
  const bad = validate({ format: 2, regions: [{ id: "tw" }, { id: "kr" }], languages: ["ja"], charts: [
    entry("1_easy", "charts/1_easy.json", { regions: ["tw", "kr"], titles: { en: "t" } }),
    entry("1_easy", "charts/kr/1_easy.json", { regions: ["kr", "jp"] }),
    entry("2_hard", "charts/2_hard.json"), entry("2_hard", "charts/tw/2_hard.json", { regions: ["tw"] })] });
  assert.equal(bad.status, 1);
  assert.deepEqual(bad.lines.sort(), [
    "charts.json: charts/1_easy.json: title language en not in languages",
    "charts.json: charts/kr/1_easy.json: region jp not in regions",
    "charts.json: id 1_easy twice in region kr",
    "charts.json: id 2_hard twice",
  ]);
});

test("schema: region manifests and the new keys", () => {
  const bad = validate({ format: 2, regions: [{ id: "T W" }], charts: [entry("1_easy", "charts/a/b/1_easy.json")] });
  assert.equal(bad.status, 1);
  assert.ok(bad.lines.includes("FAIL charts.json"));
});
