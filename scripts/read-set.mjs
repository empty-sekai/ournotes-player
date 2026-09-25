#!/usr/bin/env node
// Read set of the player: the logical paths (live.json, livescene/..., audio/..., ...) a chart session reads over a
// whole chart. The session runs headless (scripts/lib/headless.mjs).
//
// Full mode (the default, the reference): the session is loaded, started and stepped at 60 fps to the end of the chart
// with every frame drawn (so every lazily loaded texture and shader is requested), music on the game clock.
//
// Plan mode (--plan): the same set without stepping a frame. The session is loaded (every file its load reads: scene,
// notes, note assets, sounds and waveforms, the textures and programs of the lane, stage, effects, particles and live
// UI) and draws its start state once (the renderer's passes, background, canvas, lane and stage, whose programs are
// compiled at their first draw, and which the chart draws in every frame); the note views, compiled at their first
// draw too, are planned from the score (LiveNotes.plannedMaterials: the head renderers of every note that is spawned,
// the pair line, the line body). A chart whose effects are not all created when the session loads (a note effect
// container without initial capacity) has no plan: exit 1 with the reason.
//
//   node scripts/read-set.mjs <chart> [--plan] [--files=<json list of paths>] [--keys] [--frames=<n>] [--quality=<0..4>]
//   node scripts/read-set.mjs --features
//     <chart>     a chart manifest (site/charts/<musicId>_<difficulty>.json) or a directory holding live.json
//     --plan      plan mode (above)
//     --files     compare with a list of paths: exit 1 when the session read a path outside it (missing) or the list
//                 holds a path it never read (extra)
//     --keys      also list the top-level keys read of every JSON file, and the keys read of its top-level objects
//                 ("<path>#<key>", "<path>#<key>.<subkey>"); in plan mode the keys read by the load and the plan
//     --frames    full mode: stop after n frames instead of at the end of the chart (not with --plan)
//     --features  prints {"features": [...]}: the modes beyond the full simulation ("plan")
// Prints one JSON object: {chart, mode, frames, state, readAfterLoad, read, seconds, files | listed + missing + extra,
// keys?}; mode "full" (state "ended" at the end of the chart) or "plan" (state "planned", frames 0).
import fs from "node:fs";
import { ChartSession } from "../src/live/session.js";
import { HeadlessAudioContext, headlessGL, openChart } from "./lib/headless.mjs";

const FEATURES = ["plan"];
const USAGE = "usage: node scripts/read-set.mjs <chart manifest | live dir> [--plan] [--files=<json>] [--keys] [--frames=<n>] " +
              "[--quality=<n>] | --features";

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
if (opt.features) { console.log(JSON.stringify({ features: FEATURES })); process.exit(0); }
const where = args.find((a) => !a.startsWith("--"));
if (!where) { console.error(USAGE); process.exit(2); }
if (opt.plan && opt.frames !== undefined) { console.error("--frames has no meaning with --plan"); process.exit(2); }

const t0 = Date.now();
const assets = await openChart(where);
const reads = new Set(), keyReads = new Set();
const recorded = (name) => { const f = assets[name].bind(assets); assets[name] = (p, ...a) => { reads.add(p); return f(p, ...a); }; };
for (const m of ["text", "bytes", "arrayBuffer", "image"]) recorded(m);
const json = assets.json.bind(assets);
assets.json = (p) => {
  const v = json(p);
  if (!opt.keys || !v || typeof v !== "object" || Array.isArray(v)) return v;
  const wrap = (o, pre) => new Proxy(o, { get(t, k) { if (typeof k === "string" && k in t) keyReads.add(`${pre}${k}`); return t[k]; } });
  for (const k of Object.keys(v)) if (v[k] && typeof v[k] === "object" && !Array.isArray(v[k])) v[k] = wrap(v[k], `${p}#${k}.`);
  return wrap(v, `${p}#`);
};

const audioContext = new HeadlessAudioContext();
const session = await ChartSession.create({ gl: headlessGL(), assets, audioContext, seed: 1,
                                            quality: opt.quality !== undefined ? Number(opt.quality) : undefined });
const readAfterLoad = reads.size;
let frames = 0, state;
if (opt.plan) {
  const empty = [...session.fx.note.pools.values()].filter((p) => !p.created.length).map((p) => p.name);
  if (empty.length) {
    await session.dispose();
    console.error(`${where}: no plan: note effect containers without initial capacity (${empty.join(", ")}) create their ` +
                  "effects during the chart; use the full mode");
    process.exit(1);
  }
  session.render();                                        // the start state: what every frame of the chart draws
  const notes = session.notes;
  for (const m of notes.plannedMaterials()) notes.gl_.prepare(m);
  state = "planned";
} else {
  session.setMusic(false);                                 // the music-off clock: game time since the music start
  await session.play();
  const limit = Number(opt.frames || 0);
  while (session.state !== "ended" && !(limit && frames >= limit)) {
    audioContext.t = session.loop.time;
    await session.step();
    frames++;
    if (frames > 60 * 60 * 20) throw new Error("the chart did not end within 20 minutes of game time");
  }
  state = session.state;
}
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));   // lazily started texture loads settle
await session.dispose();

const read = [...reads].sort();
const out = { chart: where, mode: opt.plan ? "plan" : "full", frames, state, readAfterLoad, read: read.length,
              seconds: (Date.now() - t0) / 1000 };
let bad = false;
if (opt.files) {
  const list = new Set(JSON.parse(fs.readFileSync(opt.files, "utf8")));
  out.listed = list.size;
  out.missing = read.filter((p) => !list.has(p));
  out.extra = [...list].filter((p) => !reads.has(p)).sort();
  bad = out.missing.length > 0 || out.extra.length > 0;
} else out.files = read;
if (opt.keys) out.keys = [...keyReads].sort();
console.log(JSON.stringify(out, null, 1));
process.exit(bad ? 1 : 0);
