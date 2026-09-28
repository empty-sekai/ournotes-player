// Chart efficiency ranking: pure functions over a site's songs.json (nnnotes.songs/1) and chart-stats.json
// (ournotes-deck.chart-stats/1).
//
// Score model (chart-stats.json, exact up to one point per note): on the theoretical best play with Gekisou off, a
// deck of power P whose live skills raise the note score by x_1 >= ... >= x_n scores
//
//   P * (base + sum_i x_i * w_(i))
//
// where `base` and the skill-window weights `w` are the chart's own (`positions[d]`, one weight per performance
// position) and w_(i) are the weights sorted in descending order: the player puts the strongest skill on the
// heaviest position (rearrangement inequality). A play takes T = length + c, with `length` the BGM or the chart's
// music length and c the time spent outside the live (loading, results).
//
// Dominance: chart a beats chart b for every deck (any skill values, any power) and every overhead c >= 0 when
//   S_a(x) / (L_a + c) >= S_b(x) / (L_b + c)   for all x_1 >= ... >= x_n >= 0 and all c >= 0.
// For fixed x the difference is linear in c, so c = 0 and c -> infinity suffice; for fixed c it is linear in x, and
// every descending non-negative x is a non-negative combination of the prefix indicators (1,..,1,0,..,0). So a beats
// b exactly when, for both (alpha, beta) = (1 / L_a, 1 / L_b) and (1, 1):
//   alpha * base_a - beta * base_b >= 0  and every prefix sum of alpha * w_a(i) - beta * w_b(i) >= 0.
// The deck power must be the same on both charts: song type and tag bonuses change a deck's power per song.

export const DIFFICULTIES = ["easy", "normal", "hard", "expert"];
export const EPS = 1e-12;

// The text of a {language: text} object in `lang`, else Japanese, else the first non-empty one; "" for none.
export const pickText = (t, lang) => {
  if (!t || typeof t !== "object") return "";
  if (lang && typeof t[lang] === "string" && t[lang]) return t[lang];
  if (typeof t.ja === "string" && t.ja) return t.ja;
  for (const v of Object.values(t)) if (typeof v === "string" && v) return v;
  return "";
};

// One row per chart of chart-stats.json that songs.json knows, with the song's facts. `duration` picks the window
// duration of the weights (default: the first of chart-stats.json).
export const joinCharts = (songs, stats, duration) => {
  const byScore = new Map();
  for (const s of (songs && songs.songs) || []) {
    for (const c of s.charts || []) byScore.set(c.scoreId, { song: s, chart: c });
  }
  const out = [];
  for (const st of (stats && stats.charts) || []) {
    const hit = byScore.get(st.scoreId);
    if (!hit) continue;
    const d = Math.max(0, (st.durationsMs || []).indexOf(duration ?? (st.durationsMs || [])[0]));
    const weights = [...((st.positions || [])[d] || [])].sort((a, b) => b - a);
    const bgm = hit.song.bgm && hit.song.bgm.length;
    out.push({
      scoreId: st.scoreId,
      musicId: hit.song.id,
      difficulty: hit.chart.difficulty,
      level: hit.chart.level,
      displayLevel: hit.chart.displayLevel ?? hit.chart.level,
      title: hit.song.title || null,
      bandIds: hit.song.bandIds || [],
      bandName: hit.song.bandName || null,
      musicType: hit.song.musicType,
      notes: hit.chart.notes ? hit.chart.notes.judged : st.judgedNotes,
      bpm: hit.chart.bpm ? hit.chart.bpm.main : null,
      bpmRange: hit.chart.bpm ? [hit.chart.bpm.min, hit.chart.bpm.max] : null,
      bgmMs: bgm ? (bgm.durationMs ?? bgm.lengthMs ?? null) : null,
      chartMs: st.musicLengthMs ?? hit.chart.musicLengthMs,
      base: st.base,
      skip: st.skip,
      weights,
    });
  }
  return out;
};

// Play length in ms without the overhead: the BGM's ("bgm") or the chart's music length ("chart"); the other one when
// the chosen one is missing.
export const lengthMs = (row, source) => {
  const v = source === "chart" ? row.chartMs ?? row.bgmMs : row.bgmMs ?? row.chartMs;
  return typeof v === "number" && v > 0 ? v : null;
};

// Skill values (fractions: 1 = +100 %) in descending order.
export const sortedSkills = (skills) => [...skills].map(Number).filter((x) => Number.isFinite(x) && x >= 0)
  .sort((a, b) => b - a);

// Score per unit of power: base + sum x_(i) * w_(i).
export const scoreRate = (row, skills) => {
  const x = sortedSkills(skills);
  let s = row.base;
  for (let i = 0; i < x.length && i < row.weights.length; i++) s += x[i] * row.weights[i];
  return s;
};

// Score per unit of power per minute of play (length + overhead).
export const perMinute = (row, skills, source, overheadMs) => {
  const L = lengthMs(row, source);
  return L === null ? null : scoreRate(row, skills) / ((L + overheadMs) / 60000);
};

const covers = (a, b, alpha, beta) => {
  let strict = alpha * a.base - beta * b.base;
  if (strict < -EPS) return null;
  let any = strict > EPS;
  let pa = 0;
  const n = Math.max(a.weights.length, b.weights.length);
  for (let i = 0; i < n; i++) {
    pa += alpha * (a.weights[i] || 0) - beta * (b.weights[i] || 0);
    if (pa < -EPS) return null;
    if (pa > EPS) any = true;
  }
  return any;
};

// Whether `a` beats `b` for every deck and every overhead c >= 0 (see the top of the file), and strictly for some;
// charts without a length never do.
export const dominates = (a, b, source) => {
  const La = lengthMs(a, source);
  const Lb = lengthMs(b, source);
  if (La === null || Lb === null) return false;
  const perPlay = covers(a, b, 1, 1);
  if (perPlay === null) return false;
  const perTime = covers(a, b, 1 / La, 1 / Lb);
  if (perTime === null) return false;
  return perPlay || perTime;
};

// For each row the indexes of the rows that dominate it; rows with none form the frontier.
export const dominance = (rows, source) => rows.map((b) => {
  const by = [];
  rows.forEach((a, i) => { if (a !== b && dominates(a, b, source)) by.push(i); });
  return by;
});

// The rows with their metrics under a parameter set, sorted by `key` (descending; "title" ascending).
export const rank = (rows, { skills, source, overheadMs, key = "perMinute" }) => {
  const dom = dominance(rows, source);
  const out = rows.map((r, i) => {
    const L = lengthMs(r, source);
    return {
      ...r,
      lengthMs: L,
      rate: scoreRate(r, skills),
      perMinute: perMinute(r, skills, source, overheadMs),
      notesPerSecond: L ? r.notes / (L / 1000) : null,
      dominatedBy: dom[i],
      frontier: dom[i].length === 0,
    };
  });
  const val = (r) => (key === "level" ? r.displayLevel : r[key]);
  out.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === y) return a.scoreId - b.scoreId;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return y - x;
  });
  return out;
};

// "m:ss.s" of a length in ms.
export const formatLength = (ms) => {
  if (typeof ms !== "number" || !(ms >= 0)) return "";
  const ds = Math.round(ms / 100);                           // tenths of a second, rounded before the split
  const m = Math.floor(ds / 600);
  const r = ds - m * 600;
  return `${m}:${r < 100 ? "0" : ""}${Math.floor(r / 10)}.${r % 10}`;
};
