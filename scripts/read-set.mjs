#!/usr/bin/env node
// Read set of the player: the logical paths (live.json, livescene/..., audio/..., ...) a chart session reads over a
// whole chart. The session runs headless (scripts/lib/headless.mjs): loaded, started, stepped at 60 fps to the end of
// the chart with every frame drawn (so every lazily loaded texture and shader is requested), music on the game clock.
//
//   node scripts/read-set.mjs <chart> [--files=<json list of paths>] [--keys] [--frames=<n>] [--quality=<0..4>]
//     <chart>   a chart manifest (site/charts/<musicId>_<difficulty>.json) or a directory holding live.json
//     --files   compare with a list of paths: exit 1 when the session read a path outside it (missing) or the list
//               holds a path it never read (extra)
//     --keys    also list the top-level keys read of every JSON file, and the keys read of its top-level objects
//               ("<path>#<key>", "<path>#<key>.<subkey>")
//     --frames  stop after n frames instead of at the end of the chart
// Prints one JSON object: {chart, frames, state, readAfterLoad, read, seconds, files | missing + extra, keys?}.
import fs from "node:fs";
import { ChartSession } from "../src/live/session.js";
import { HeadlessAudioContext, headlessGL, openChart } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const where = args.find((a) => !a.startsWith("--"));
if (!where) { console.error("usage: node scripts/read-set.mjs <chart manifest | live dir> [--files=<json>] [--keys] [--frames=<n>]"); process.exit(2); }

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
session.setMusic(false);                                   // the music-off clock: game time since the music start
await session.play();
const limit = Number(opt.frames || 0);
let frames = 0;
while (session.state !== "ended" && !(limit && frames >= limit)) {
  audioContext.t = session.loop.time;
  await session.step();
  frames++;
  if (frames > 60 * 60 * 20) throw new Error("the chart did not end within 20 minutes of game time");
}
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));   // lazily started texture loads settle
const state = session.state;
await session.dispose();

const read = [...reads].sort();
const out = { chart: where, frames, state, readAfterLoad, read: read.length, seconds: (Date.now() - t0) / 1000 };
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
