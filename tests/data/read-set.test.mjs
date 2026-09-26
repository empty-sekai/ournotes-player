// Opt-in: the read-set plan (scripts/read-set.mjs --plan, no frame stepped) lists exactly the files the full simulation
// (every frame drawn to the end of the chart) reads, for every chart named by OURNOTES_READSET_CHARTS ("all": every
// chart of the site), OURNOTES_JOBS charts at a time. Both modes run as the command line runs them (one process each).
// Then the same charts through `--serve` (OURNOTES_JOBS processes, both modes of every chart in a shuffled order): each
// answer equals the one of the chart's own process. Skipped when OURNOTES_DATA is not set.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
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

const own = new Map();                     // "<id> <mode>" -> the answer of the chart's own process

test(`read-set plan equals the full simulation (${charts.length} charts)`, { skip: SKIP }, async () => {
  const bad = [], queue = [...charts];
  let full = 0, plan = 0;
  const worker = async () => {
    for (let id; (id = queue.shift()) !== undefined;) {
      const [f, p] = await Promise.all([readSet(id), readSet(id, "--plan")]);
      own.set(`${id} full`, f).set(`${id} plan`, p);
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

// one `read-set.mjs --serve` process: ask(request) -> its answer
const server = () => {
  const p = spawn(process.execPath, [script, "--serve"], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  readline.createInterface({ input: p.stdout }).on("line", (l) => waiting.shift()(JSON.parse(l)));
  const exited = new Promise((resolve) => p.on("exit", resolve));
  return {
    ask: (req) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${JSON.stringify(req)}\n`); }),
    close: () => { p.stdin.end(); return exited; },
  };
};

test(`read sets served by one process equal those of one process per chart (${charts.length} charts)`, { skip: SKIP },
     async () => {
  const requests = charts.flatMap((id) => [[id, "full"], [id, "plan"]]);
  let s = 0x9e3779b9;                                    // a fixed shuffle (xorshift32)
  for (let i = requests.length - 1; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    [requests[i], requests[j]] = [requests[j], requests[i]];
  }
  const bad = [];
  const worker = async () => {
    const srv = server();
    for (let r; (r = requests.shift()) !== undefined;) {
      const [id, mode] = r, want = own.get(`${id} ${mode}`);
      if (!want) { bad.push({ id, mode, error: "no answer of its own process" }); continue; }
      const a = await srv.ask({ chart: path.join(DATA, "charts", `${id}.json`), plan: mode === "plan" });
      if (!a.ok) bad.push({ id, mode, error: a.error.slice(0, 500) });
      else if (JSON.stringify([a.result.state, a.result.frames, a.result.files]) !==
               JSON.stringify([want.state, want.frames, want.files])) bad.push({ id, mode, served: a.result.files.length });
    }
    assert.equal(await srv.close(), 0);
  };
  await Promise.all(Array.from({ length: Math.min(jobs, charts.length) }, worker));
  assert.deepEqual(bad, []);
});
