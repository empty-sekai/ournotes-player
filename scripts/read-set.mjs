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
// Serve mode (--serve): one process answers many requests, one chart at a time, each read as a process of its own
// would read it: every chart gets a new store, context and session, and the player keeps no state between sessions
// that decides what a session reads.
//
// Settings (--settings): the read set of a session booted with those Live options (ChartSession `settings`, the
// game's option names and units, src/live/settings.js), in either mode; values the chart's files do not offer are an
// error. Options that select other files (MirrorChart, NoteDesignId, NoteEffectId, LiveQuality, the note sound sets)
// give the read set of that variant. A live directory has no manifest, whose `options` would list the qualities its
// files serve: there every LiveQuality (0..2) is accepted, and the files the directory holds decide whether the session
// loads.
//
//   node scripts/read-set.mjs <chart> [--plan] [--files=<json list of paths>] [--keys] [--frames=<n>] [--quality=<0..2>]
//                             [--settings=<json object>]
//   node scripts/read-set.mjs --serve
//   node scripts/read-set.mjs --features
//     <chart>     a chart manifest (site/charts/<musicId>_<difficulty>.json) or a directory holding live.json
//     --plan      plan mode (above)
//     --files     compare with a list of paths: exit 1 when the session read a path outside it (missing) or the list
//                 holds a path it never read (extra)
//     --keys      also list the top-level keys read of every JSON file, and the keys read of its top-level objects
//                 ("<path>#<key>", "<path>#<key>.<subkey>"); in plan mode the keys read by the load and the plan
//     --frames    full mode: stop after n frames instead of at the end of the chart (not with --plan)
//     --settings  the Live options of the session, a JSON object ({"MirrorChart": true, "NoteSpeed": 9})
//     --serve     requests on stdin, one JSON object per line: {"chart": <chart>, "plan"?, "files"?, "keys"?,
//                 "frames"?, "quality"?, "settings"?} (the options above; "settings" as an object); one answer per
//                 request on stdout, one JSON object per line: {"ok": true, "result": <the object below>, "cpuSeconds"}
//                 or {"ok": false, "error", "cpuSeconds"} (cpuSeconds: CPU time of the process for the request); exits at
//                 the end of stdin
//     --features  prints {"features": [...]}: the modes beyond the full simulation ("plan", "serve", "settings")
// Prints one JSON object: {chart, mode, frames, state, readAfterLoad, read, seconds, settings?, files | listed +
// missing + extra, keys?}; mode "full" (state "ended" at the end of the chart) or "plan" (state "planned", frames 0);
// settings: the options asked for, when given. Exit 2 for a usage error or settings the chart does not accept.
import fs from "node:fs";
import readline from "node:readline";
import { ChartSession } from "../src/live/session.js";
import { LiveSettingsError } from "../src/live/settings.js";
import { HeadlessAudioContext, headlessGL, openChart } from "./lib/headless.mjs";

const FEATURES = ["plan", "serve", "settings"];
const USAGE = "usage: node scripts/read-set.mjs <chart manifest | live dir> [--plan] [--files=<json>] [--keys] [--frames=<n>] " +
              "[--quality=<n>] [--settings=<json object>] | --serve | --features";

class UsageError extends Error {}
class NoPlan extends Error {}

// the settings option: a JSON object on the command line, an object in a serve request; absent / null: none
const settingsOf = (v) => {
  if (v === undefined || v === null) return undefined;
  let o = v;
  if (typeof v === "string") {
    try { o = JSON.parse(v); } catch (e) { throw new UsageError(`--settings: ${e.message}`); }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new UsageError("--settings must be a JSON object");
  return o;
};

// the read set of one chart: {out, bad}; bad: a --files comparison found a difference
const readSet = async (where, opt) => {
  if (opt.plan && opt.frames !== undefined) throw new UsageError("--frames has no meaning with --plan");
  const settings = settingsOf(opt.settings);
  const t0 = Date.now();
  const assets = await openChart(where);
  if (!assets.info) assets.info = { options: { LiveQuality: [0, 1, 2] } };   // a live directory (see the header)
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
                                              quality: opt.quality !== undefined ? Number(opt.quality) : undefined, settings });
  const readAfterLoad = reads.size;
  let frames = 0, state;
  try {
    if (opt.plan) {
      const empty = [...session.fx.note.pools.values()].filter((p) => !p.created.length).map((p) => p.name);
      if (empty.length) {
        throw new NoPlan(`${where}: no plan: note effect containers without initial capacity (${empty.join(", ")}) ` +
                         "create their effects during the chart; use the full mode");
      }
      session.render();                                      // the start state: what every frame of the chart draws
      const notes = session.notes;
      for (const m of notes.plannedMaterials()) notes.gl_.prepare(m);
      state = "planned";
    } else {
      session.setMusic(false);                               // the music-off clock: game time since the music start
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
  } catch (e) {
    await session.dispose().catch(() => {});
    throw e;
  }
  await session.dispose();

  const read = [...reads].sort();
  const out = { chart: where, mode: opt.plan ? "plan" : "full", frames, state, readAfterLoad, read: read.length,
                seconds: (Date.now() - t0) / 1000 };
  if (settings) out.settings = settings;
  let bad = false;
  if (opt.files) {
    const list = new Set(JSON.parse(fs.readFileSync(opt.files, "utf8")));
    out.listed = list.size;
    out.missing = read.filter((p) => !list.has(p));
    out.extra = [...list].filter((p) => !reads.has(p)).sort();
    bad = out.missing.length > 0 || out.extra.length > 0;
  } else out.files = read;
  if (opt.keys) out.keys = [...keyReads].sort();
  return { out, bad };
};

// --serve: requests in order, one at a time; stdout carries the answers only
const serve = async () => {
  const write = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  console.log = console.error;
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const c0 = process.cpuUsage();
    const cpuSeconds = () => { const c = process.cpuUsage(c0); return (c.user + c.system) / 1e6; };
    try {
      let req;
      try { req = JSON.parse(line); } catch (e) { throw new UsageError(`bad request: ${e.message}`); }
      if (!req || typeof req !== "object" || typeof req.chart !== "string") {
        throw new UsageError("bad request: a request is a JSON object with a chart path");
      }
      const { chart, ...opt } = req;
      const { out } = await readSet(chart, opt);
      write({ ok: true, result: out, cpuSeconds: cpuSeconds() });
    } catch (e) {
      const error = e instanceof UsageError || e instanceof NoPlan || e instanceof LiveSettingsError || !e.stack
        ? String(e.message || e) : e.stack;
      write({ ok: false, error, cpuSeconds: cpuSeconds() });
    }
  }
};

const args = process.argv.slice(2);
// --name=value (the value up to the end: a JSON object may hold "=") or --name
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => {
  const i = a.indexOf("=");
  return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
if (opt.features) { console.log(JSON.stringify({ features: FEATURES })); process.exit(0); }
if (opt.serve) { await serve(); process.exit(0); }
const where = args.find((a) => !a.startsWith("--"));
if (!where) { console.error(USAGE); process.exit(2); }
if (opt.plan && opt.frames !== undefined) { console.error("--frames has no meaning with --plan"); process.exit(2); }
let result;
try {
  result = await readSet(where, opt);
} catch (e) {
  if (e instanceof UsageError || e instanceof LiveSettingsError) { console.error(e.message); process.exit(2); }
  if (!(e instanceof NoPlan)) throw e;
  console.error(e.message);
  process.exit(1);
}
console.log(JSON.stringify(result.out, null, 1));
process.exit(result.bad ? 1 : 0);
