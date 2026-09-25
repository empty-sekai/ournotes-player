// Shared parts of the opt-in data tests: the site from OURNOTES_DATA, headless chart sessions and state snapshots.
// The tests run the player in Node over real chart data (not part of this repository): no pixels are drawn and no
// sound is played (scripts/lib/headless.mjs provides a no-op WebGL2 context and a no-op AudioContext), but the whole
// session runs: simulation, note views, effects, live UI and every draw call.
//
//   OURNOTES_DATA=<site dir>           the site (charts.json, charts/, assets/); the tests are skipped without it
//   OURNOTES_CHARTS=<id>,<id>,...      charts for the full-run test (default: 100001_expert and 100040_expert when
//                                      present, else the first chart of the site)
//   OURNOTES_SEEK_CHART=<id>           chart for the seek / speed / stall test (default: 100082_expert when present)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ChartSession } from "../../src/live/session.js";
import { HeadlessAudioContext, headlessGL, openChart } from "../../scripts/lib/headless.mjs";

export const DATA = process.env.OURNOTES_DATA || "";
export const SKIP = DATA ? false : "OURNOTES_DATA is not set (path of a chart site)";

const siteCharts = () => {
  const index = path.join(DATA, "charts.json");
  if (fs.existsSync(index)) return JSON.parse(fs.readFileSync(index, "utf8")).charts.map((c) => c.id);
  return fs.readdirSync(path.join(DATA, "charts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
};

// the chart ids named by `env`, else the defaults the site has, else its first chart
export const pickCharts = (env, defaults) => {
  if (!DATA) return [];
  if (process.env[env]) return process.env[env].split(",").map((s) => s.trim()).filter(Boolean);
  const all = siteCharts(), have = defaults.filter((id) => all.includes(id));
  return have.length ? have : all.slice(0, 1);
};

// A session at the start of the chart, playing, on the music-off clock (the chart clock advances by the game time of
// each step, so runs are reproducible). Returns { session, audioContext }.
export const openSession = async (id, { speed = 1, seed = 1 } = {}) => {
  const assets = await openChart(path.join(DATA, "charts", `${id}.json`));
  const audioContext = new HeadlessAudioContext();
  const session = await ChartSession.create({ gl: headlessGL(), assets, audioContext, seed, width: 320, height: 180 });
  session.setMusic(false);
  if (speed !== 1) session.setSpeed(speed);
  await session.play();
  return { session, audioContext };
};

export const hash = (x) => crypto.createHash("sha1").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex").slice(0, 16);
const arr = (a) => (a && typeof a.length === "number" ? Array.from(a) : a);

const nodeState = (n) => (n ? [n.t && n.t.localPosition, n.t && n.t.localScale, n.t && n.t.localRotation, n.active, n.enabled,
                                n.color, n.size, n.order, n.flipX, n.sprite && (n.sprite.name || n.sprite.sprite)] : null);
const meshState = (m) => (m ? hash(Object.entries(m).map(([k, v]) => [k, arr(v)])) : null);

// The chart-side state (what a seek re-simulates), hashed per part:
//   exec    every note's state / progress / offset / result, every line, the combo entries and counters, the frame
//   views   note heads with their prefab nodes, held heads, line bodies (meshes), pair lines, flick graph time
//   ui      the live UI's drawn items after layout, the combo Animator, the combo counter
export const snapshot = (s) => {
  const ex = s.exec, n = s.notes, ui = s.fx.ui, fr = s.frame;
  const exec = {
    notes: ex.notes.map((r) => [r.state, r.progress, r.offset, r.res.judgement, r.res.time, r.res.timing, r.res.origin]),
    lines: ex.lines.map((L) => [L.state, L.enabled, L.missed]),
    combo: ex.comboEntries.map((e) => [e.time, e.j, e.combo, e.max, e.ap, e.fc]),
    app: [ex.appCombo, ex.appMax, ex.appAP, ex.appFC, ex._prevSimCombo, ex._done],
    fr: fr ? [fr.timeMs, fr.updateNoteIds, fr.stateNoteIds, fr.judgedNotes.map((j) => [j.id, j.judgement]), fr.updateLineIds,
              fr.combo, fr.maxCombo, fr.simCombo, fr.isAllPerfect, fr.isFullCombo, fr.isUpdatedCombo, fr.addCombo,
              fr.resetCombo, fr.finishedAllNoteUpdate] : null,
  };
  const views = {
    heads: [...n.spawned].map(([id, v]) => [id, v.type, v.v, v.width, v.laneCenter, [...v.p.nodes.values()].map(nodeState)]),
    held: [...n.held].map(([id, x]) => [id, x.visible, x.view.v, x.view.width, x.view.laneCenter, [...x.view.p.nodes.values()].map(nodeState)]),
    lines: [...n.lineViews].map(([id, l]) => [id, l.kind, l.gradientState, meshState(l.mesh)]),
    pairs: [...n.pairs].map(([id, p]) => [id, p.ids, nodeState(p.r), p.p.root.t.localPosition]),
    graph: [n.graphTime, !!n._flickSeen],
  };
  ui.layout(1920, 1080);
  const uiState = {
    items: ui.drawItems().map((it) => [it.node.path, it.texture, it.alpha, hash(arr(it.verts))]),
    animator: [ui.animator.state && ui.animator.state.name, ui.animator.time, !!ui.animator.fade],
    combo: [ui.combo.currentCombo, ui.combo.currentTier, ui.combo.isAllPerfect, ui.combo.isFullCombo],
  };
  return { t: s.chartMs, state: s.state, exec: hash(exec), views: hash(views), ui: hash(uiState) };
};

export const differences = (a, b) => ["state", "exec", "views", "ui"].filter((k) => a[k] !== b[k]);

// the effects: every note / lane effect element (activity, Animator, particle systems), hold loops, the intro stars and
// the particle random stream
export const effectsState = (s) => {
  const f = s.fx;
  const el = (e) => [e.name, e.activeInHierarchy, e.isPlaying, !!e.animatorOn,
                     e.animator ? [e.animator.si, e.animator.time, e.animator.fade ? e.animator.fade.elapsed : null] : null,
                     e.order.filter((x) => x.system).map((x) => {
                       const q = x.system;
                       return [q.state, q.time, q.particles.length, q.particles.length ? JSON.stringify(q.particles[0]) : null];
                     })];
  return hash([[...f.note.elements()].map(el), [...f.lane.elements()].map(el), [...f.note.lineEffects.keys()],
               [...f.stars.entries.values()].map(({ ps }) => [ps.state, ps.particles.length]), JSON.stringify(f.rng)]);
};
