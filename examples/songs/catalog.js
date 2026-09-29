// Chart data page: pure functions over a site's music-data.json (nnnotes.music-data/1): one row per chart with the
// facts the page lists, ranks and plots.

import { DIFFICULTIES, joinCharts, pickText } from "./ranking.js";

export { DIFFICULTIES, pickText };

// Judged notes by kind (NoteOperateType); hidden notes, guide ends and slide ticks that are not judged are left out.
export const NOTE_KINDS = [
  ["tap", [1, 101]],
  ["flick", [40, 41, 42, 102]],
  ["slide", [20, 21, 22]],
  ["trace", [60, 61, 62, 63, 104, 105]],
  ["combo", [120]],
];

// {kind: count} of a chart's `notes.byOperateType`.
export const noteKinds = (byOp) => {
  const out = Object.fromEntries(NOTE_KINDS.map(([k]) => [k, 0]));
  for (const [k, ops] of NOTE_KINDS) for (const op of ops) out[k] += Number((byOp || {})[op]) || 0;
  return out;
};

// Judged notes per second of play: from the first to the last judged note.
export const density = (chart) => {
  const span = (chart.lastJudgedNoteMs ?? 0) - (chart.firstNoteMs ?? 0);
  const n = chart.notes && chart.notes.judged;
  return span > 0 && n ? n / (span / 1000) : null;
};

// A row's deck figures (ranking.js chartFigures) from a joinCharts row, null ones without it.
const figures = (e) => ({
  base: e ? e.base : null,
  baseRange: e ? e.baseRange : null,
  seeds: e ? e.seeds : null,
  weights: e ? e.weights : null,
});

// One row per chart of music-data.json, in song order then difficulty order, with the deck figures in a scenario
// (ranking.js chartFigures; default: Gekisou Live at rank 1) when the chart has them; `stats` is the chart's own deck
// statistics (null in a file made without the deck model).
export const chartRows = (data, scenario = null) => {
  const eff = new Map(joinCharts(data, scenario).map((r) => [r.scoreId, r]));
  const out = [];
  for (const song of (data && data.songs) || []) {
    const bgm = song.bgm && song.bgm.length;
    for (const chart of song.charts || []) {
      const e = eff.get(chart.scoreId);
      out.push({
        scoreId: chart.scoreId,
        musicId: song.id,
        song,
        chart,
        stats: chart.deck || null,
        difficulty: chart.difficulty,
        level: chart.level,
        displayLevel: chart.displayLevel ?? chart.level,
        title: song.title || null,
        bandIds: song.bandIds || [],
        bandName: song.bandName || null,
        scoreRanks: song.scoreRanks || [],
        notes: chart.notes ? chart.notes.judged : null,
        kinds: noteKinds(chart.notes && chart.notes.byOperateType),
        bpm: chart.bpm ? chart.bpm.main : null,
        bpmMax: chart.bpm ? chart.bpm.max : null,
        bpmMin: chart.bpm ? chart.bpm.min : null,
        bpmChanges: chart.bpm && chart.bpm.changes ? chart.bpm.changes.length : 0,
        density: density(chart),
        bgmMs: bgm ? (bgm.durationMs ?? bgm.lengthMs ?? null) : null,
        chartMs: chart.musicLengthMs ?? null,
        ...figures(e),
        skip: chart.deck && !chart.deck.unplayable ? chart.deck.skip ?? null : null,
        unplayable: chart.deck ? chart.deck.unplayable ?? null : null,
      });
    }
  }
  return out;
};

// Puts the deck figures of another scenario into chartRows' rows, in place (the page keeps its rows).
export const refigure = (rows, data, scenario) => {
  const eff = new Map(joinCharts(data, scenario).map((r) => [r.scoreId, r]));
  for (const r of rows) Object.assign(r, figures(eff.get(r.scoreId)));
  return rows;
};

// music-data.json's `gekisouCatalog` tables by id, built once per file.
const CATALOGS = new WeakMap();
const catalogOf = (data) => {
  if (data && CATALOGS.has(data)) return CATALOGS.get(data);
  const cat = (data && data.gekisouCatalog) || {};
  const out = {};
  for (const [k, list] of Object.entries(cat)) {
    if (Array.isArray(list)) out[k] = new Map(list.filter((x) => x && x.id !== undefined).map((x) => [x.id, x]));
  }
  if (data && typeof data === "object") CATALOGS.set(data, out);
  return out;
};

// A Gekisou skill (`table` "skills") or Gekisou support skill ("supportSkills") of `gekisouCatalog` by id: its name in
// a language (pickText: else Japanese, else any language; "#id" without one), mission and maxLevel (null when the
// catalog lacks them, as in older data).
export const gekisouSkill = (data, table, id, lang) => {
  const e = (catalogOf(data)[table] || new Map()).get(id);
  return {
    id,
    name: pickText(e && e.name, lang) || `#${id}`,
    mission: e ? e.mission ?? null : null,
    maxLevel: e ? e.maxLevel ?? null : null,
  };
};

// The skills of an aptitude shape (music-data.json deck.gekisouAptitude.shapes[]: member Gekisou skills or snap
// Gekisou support skills with the same score effects) with their names (gekisouSkill, "#id" without one) and levels,
// each skill once.
export const shapeSkills = (data, shape, lang) => {
  const table = shape && shape.source === "support" ? "supportSkills" : "skills";
  const seen = new Set();
  const out = [];
  for (const s of (shape && Array.isArray(shape.skills) ? shape.skills : [])) {
    const key = `${s.id}:${s.level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...gekisouSkill(data, table, s.id, lang), level: s.level ?? null });
  }
  return out;
};

// The bands a shape's band condition names (skills[].bandIds), by music-data.json's `bands` ("#id" without one).
export const shapeBands = (data, shape, lang) => {
  const bands = new Map(((data && data.bands) || []).map((b) => [b.id, b]));
  const ids = [...new Set((shape && Array.isArray(shape.skills) ? shape.skills : []).flatMap((s) => s.bandIds || []))].sort((a, b) => a - b);
  return ids.map((id) => pickText(bands.get(id) && bands.get(id).name, lang) || `#${id}`);
};

// Whether a row matches a search text: any language of the title, reading, credits, or the music id.
export const matches = (row, text) => {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  const s = row.song || {};
  const fields = [s.title, s.ruby, s.phonetic, s.lyricist, s.composer, s.arranger, s.bandName];
  return fields.some((x) => x && Object.values(x).some((v) => String(v).toLowerCase().includes(t)))
    || String(row.musicId).includes(t);
};

// Rows sorted by a numeric getter, descending (ascending with `asc`); rows without a value last, ties by score id.
export const sortBy = (rows, get, asc = false) => [...rows].sort((a, b) => {
  const x = get(a), y = get(b);
  const nx = x === null || x === undefined || Number.isNaN(x), ny = y === null || y === undefined || Number.isNaN(y);
  if (nx || ny) return nx === ny ? a.scoreId - b.scoreId : nx ? 1 : -1;
  if (x === y) return a.scoreId - b.scoreId;
  return asc ? x - y : y - x;
});

// "Nice" axis ticks covering [lo, hi]: about `n` round steps (1, 2, 2.5, 5 x 10^k).
export const ticks = (lo, hi, n = 5) => {
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return [];
  if (hi === lo) return [lo];
  const raw = (hi - lo) / Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
};

// [min, max] of the finite values, padded by `pad` of the range on each side; null when there are none.
export const extent = (values, pad = 0.05) => {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  if (lo === hi) { lo -= 1; hi += 1; }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
};

// Counts of the rows' values bucketed by `get` (rounded down to `step`), as [[bucket, {difficulty: count}], ...]
// in ascending bucket order.
export const histogram = (rows, get, step = 1) => {
  const m = new Map();
  for (const r of rows) {
    const v = get(r);
    if (!Number.isFinite(v)) continue;
    const b = +(Math.floor(v / step + 1e-9) * step).toFixed(6);
    if (!m.has(b)) m.set(b, Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])));
    m.get(b)[r.difficulty] = (m.get(b)[r.difficulty] || 0) + 1;
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
};

// moenotes (bdon.moe) has the song pages (credits, vocals, audio, jacket, chart previews); this page links to them.
export const MOENOTES = "https://bdon.moe/";
const MOENOTES_PREFIX = { "zh-Hans": "", "zh-Hant": "zh-tw", ja: "ja", en: "en", ko: "ko" };

// The moenotes page of a song in the language nearest to `lang` (default: Simplified Chinese, its root).
export const moenotesUrl = (musicId, lang, base = MOENOTES) => {
  const p = MOENOTES_PREFIX[lang] ?? "";
  return new URL(`${p ? `${p}/` : ""}music/${encodeURIComponent(musicId)}`, base.endsWith("/") ? base : `${base}/`).href;
};
