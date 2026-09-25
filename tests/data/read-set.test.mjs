// Opt-in: the read-set plan (scripts/read-set.mjs --plan, no frame stepped) lists exactly the files the full simulation
// (every frame drawn to the end of the chart) reads, for every chart named by OURNOTES_READSET_CHARTS ("all": every
// chart of the site), OURNOTES_JOBS charts at a time. Both modes run as the command line runs them (one process each).
// Skipped when OURNOTES_DATA is not set.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DATA, SKIP, pickCharts, siteCharts } from "./harness.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "read-set.mjs");
const charts = process.env.OURNOTES_READSET_CHARTS === "all" ? (DATA ? siteCharts() : [])
  : pickCharts("OURNOTES_READSET_CHARTS", ["100001_expert", "100040_expert"]);
const jobs = Math.max(1, Number(process.env.OURNOTES_JOBS || 1));

const readSet = (id, ...args) => new Promise((resolve, reject) => {
  execFile(process.execPath, [script, path.join(DATA, "charts", `${id}.json`), ...args], { maxBuffer: 1 << 26 },
           (err, stdout, stderr) => (err ? reject(new Error(`${id} ${args.join(" ")}: ${stderr || err.message}`)) : resolve(JSON.parse(stdout))));
});

test(`read-set plan equals the full simulation (${charts.length} charts)`, { skip: SKIP }, async () => {
  const bad = [], queue = [...charts];
  let full = 0, plan = 0;
  const worker = async () => {
    for (let id; (id = queue.shift()) !== undefined;) {
      const [f, p] = await Promise.all([readSet(id), readSet(id, "--plan")]);
      assert.equal(f.state, "ended", `${id}: the full simulation did not end`);
      assert.deepEqual([p.mode, p.state, p.frames], ["plan", "planned", 0]);
      full += f.seconds; plan += p.seconds;
      const F = new Set(f.files), P = new Set(p.files);
      const onlyFull = f.files.filter((x) => !P.has(x)), onlyPlan = p.files.filter((x) => !F.has(x));
      if (onlyFull.length || onlyPlan.length) bad.push({ id, onlyFull, onlyPlan });
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, charts.length) }, worker));
  console.log(`read sets of ${charts.length} charts: full ${full.toFixed(0)} s, plan ${plan.toFixed(0)} s`);
  assert.deepEqual(bad, []);
});
