// Opt-in: Live2D models of a site through the model viewer in Node, with Live2D Cubism Core. Nothing is drawn (the
// no-op WebGL2 context of scripts/lib/headless.mjs), but the whole runtime runs: load, warmup, frames, draw calls.
//
//   OURNOTES_DATA=<site dir>        a site with models.json and models/ (skipped without it)
//   CUBISM_CORE=<file>              Live2D's live2dcubismcore.min.js (skipped without it; not part of this repository)
//   OURNOTES_MODELS=<id>,<id>,...   models to run, or all (default: the first two of models.json)
//
// Per model: the files the viewer reads equal the manifest's files; a run over 300 frames with a motion, an expression
// and the physics / breath switches keeps every parameter finite; two runs with the same seed give the same state.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { ModelSession } from "../../src/live2d/session.js";
import { headlessGL, openChart } from "../../scripts/lib/headless.mjs";

const DATA = process.env.OURNOTES_DATA || "", CORE = process.env.CUBISM_CORE || "";
const SKIP = !DATA ? "OURNOTES_DATA is not set (path of a site)"
  : !CORE ? "CUBISM_CORE is not set (path of Live2D's live2dcubismcore.min.js)"
  : !fs.existsSync(path.join(DATA, "models.json")) ? "the site has no models.json" : false;

// the Core in its own context, as a page's classic <script> would run it
const loadCore = () => {
  const c = { console, setTimeout, clearTimeout, WebAssembly, TextDecoder, TextEncoder, performance, atob, btoa, Math, Promise };
  c.window = c; c.self = c; c.globalThis = c; c.document = { currentScript: { src: "" } }; c.location = { href: "" };
  vm.createContext(c);
  vm.runInContext(`${fs.readFileSync(CORE, "utf8")}\n;globalThis.Live2DCubismCore = Live2DCubismCore;`, c);
  return c.Live2DCubismCore;
};

const models = () => {
  if (SKIP) return [];
  const all = JSON.parse(fs.readFileSync(path.join(DATA, "models.json"), "utf8")).models;
  if (process.env.OURNOTES_MODELS === "all") return all;
  if (process.env.OURNOTES_MODELS) {
    const want = process.env.OURNOTES_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
    return all.filter((m) => want.includes(m.id));
  }
  return all.slice(0, 2);
};

const hash = (a) => crypto.createHash("sha1").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

const run = async (entry, { frames = 300, seed = 1 } = {}) => {
  const assets = await openChart(path.join(DATA, entry.manifest));
  const reads = new Set();
  for (const m of ["text", "bytes", "arrayBuffer", "image"]) {
    const f = assets[m].bind(assets);
    assets[m] = (p, ...a) => { reads.add(p); return f(p, ...a); };
  }
  const s = await ModelSession.create({ gl: headlessGL({ width: 300, height: 450 }), assets, seed });
  const others = s.motions.filter((m) => m !== s.defaultMotion);
  const exprs = s.expressions.filter((e) => e !== s.defaultExpression);
  const states = [];
  for (let f = 0; f < frames; f++) {
    if (f === 30 && others.length) s.playMotion(others[0]);
    if (f === 90 && exprs.length) s.setExpression(exprs[0]);
    if (f === 150) { s.setPhysics(false); s.setBreath(false); }
    if (f === 180) { s.setPhysics(true); s.setBreath(true); }
    if (f === 200 && others.length > 1) s.playMotion(others[1], { loop: true, fade: 0.5 });
    await s.step({ draw: f % 10 === 0 });
    const v = s.character.params.value;
    for (let i = 0; i < v.length; i++) assert.ok(Number.isFinite(v[i]), `${entry.id}: ${s.character.params.ids[i]} = ${v[i]} at frame ${f}`);
    states.push(hash(v));
  }
  const files = Object.keys(JSON.parse(fs.readFileSync(path.join(DATA, entry.manifest), "utf8")).files).sort();
  await s.dispose();
  return { reads: [...reads].sort(), files, states };
};

test("Live2D models: read set, finite parameters, reproducible runs", { skip: SKIP }, async (t) => {
  globalThis.Live2DCubismCore = loadCore();
  for (const entry of models()) {
    await t.test(entry.id, async () => {
      const a = await run(entry), b = await run(entry);
      assert.deepEqual(a.reads.filter((p) => !a.files.includes(p)), [], "read but not in the manifest");
      assert.deepEqual(a.files.filter((p) => !a.reads.includes(p)), [], "in the manifest but not read");
      assert.deepEqual(a.states, b.states, "same seed, same parameters every frame");
    });
  }
});
