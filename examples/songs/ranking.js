// Chart efficiency ranking: pure functions over a site's music-data.json (nnnotes.music-data/1, whose deck
// statistics are ournotes-deck.chart-stats/2).
//
// Score model (music-data.json `deck`, checked per seed against the whole-live simulation): on the theoretical best
// play with Gekisou on (the chart's fevers with the song's missions, a solo player at rank 1), a deck of power P whose
// live skills are plain score-up skills (effect type 2000 for 5 s on the whole deck, no targets or conditions) raising
// the note score by x_1 .. x_n scores
//
//   P * (base + sum_k x_pi(k) * w_k)
//
// where `base` (the no-skill score per unit of power, rank bonuses included) and the skill event weights `w_k` (the
// score a factor-1 plain skill at performance position k adds, per unit of power) are the chart's own and pi is the
// skill order of the live. Luck ranges draw from the play's random seed, so the deck statistics are per seed of a
// seed set; the page takes the mean over those seeds, which is not the game's own expectation (its seed law is
// unknown). The client draws pi at the start of every live: `MemberDataContainer` fills the skill order with 0..n-1
// and Fisher-Yates shuffles it with the MemberShuffle random stream, seeded from the client clock (a solo retry keeps
// the seed, so the order). pi is uniform over the n! orders, and so
//
//   E[score] = P * (base + xbar * W),   xbar = mean skill value,   W = sum_k w_k,
//
// whatever the deck's skills are otherwise; the n! orders give the spread around it. A play takes T = length + c,
// with `length` the BGM or the chart's music length and c the time spent outside the live (loading, results).
//
// Dominance (expected score per time): chart a beats chart b when
//   S_a(xbar) / (L_a + c) >= S_b(xbar) / (L_b + c)   for all 0 <= xbar <= X_MAX and all c >= 0
// (strictly somewhere). The difference is linear in c for a fixed xbar and linear in xbar for a fixed c, so the four
// corners xbar in {0, X_MAX}, c in {0, infinity} decide it: S_a >= S_b and S_a / L_a >= S_b / L_b at both ends.
// The deck power must be the same on both charts: song type and tag bonuses change a deck's power per song.

export const DIFFICULTIES = ["easy", "normal", "hard", "expert"];
export const EPS = 1e-12;
// The largest score-up value of one live skill (MasterLiveSkillEffect, types 2000 / 2004 at level 5: 15000 = 150 %).
export const X_MAX = 1.5;
// ournotes-deck's measurement power and the plain skill's window, when music-data.json does not say.
const POWER = 300000;
const PLAIN_MS = 5000;

// The text of a {language: text} object in `lang`, else Japanese, else the first non-empty one; "" for none.
export const pickText = (t, lang) => {
  if (!t || typeof t !== "object") return "";
  if (lang && typeof t[lang] === "string" && t[lang]) return t[lang];
  if (typeof t.ja === "string" && t.ja) return t.ja;
  for (const v of Object.values(t)) if (typeof v === "string" && v) return v;
  return "";
};

// The id of the plain score-up kind of music-data.json's `deck.kinds`: effect type 2000 on the whole deck for 5 s,
// without targets, conditions or limits (the most common live skill; the page models decks of it). null for none.
export const plainKind = (data) => {
  const kinds = (data && data.deck && data.deck.kinds) || [];
  const hit = kinds.find((k) => k.effectType === 2000 && !(k.skillTargetIds || []).length && !k.skillConditionGroup
    && !k.skillReleaseConditionGroup && !k.effectLimitCount && !k.effectExecuteLimitCount
    && (k.durationMs ?? PLAIN_MS) === PLAIN_MS);
  return hit ? hit.id : null;
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// A chart's figures from its deck statistics (`chart.deck`): `base` and `weights[k]` (performance position k's, of
// kind `kind`) as means over the seeds, `baseRange` the seeds' [min, max] base, `seeds` their number. null without
// statistics, for an unplayable chart or without the kind.
export const chartFigures = (deck, kind, power = POWER) => {
  const seeds = (deck && !deck.unplayable && deck.seeds) || [];
  if (!seeds.length || kind === null || kind === undefined) return null;
  if (!seeds.every((s) => Array.isArray(s.weights && s.weights[kind]))) return null;
  const bases = seeds.map((s) => s.score / power);
  const n = deck.positions ?? seeds[0].weights[kind].length;
  return {
    base: mean(bases),
    baseRange: [Math.min(...bases), Math.max(...bases)],
    seeds: seeds.length,
    skip: deck.skip ?? null,
    weights: [...Array(n).keys()].map((k) => mean(seeds.map((s) => s.weights[kind][k] ?? 0))),
  };
};

// One row per chart of music-data.json with deck figures (see chartFigures), with the song's facts; `weights[k]` is
// performance position k's.
export const joinCharts = (data) => {
  const kind = plainKind(data);
  const power = (data && data.deck && data.deck.model && data.deck.model.power) || POWER;
  const out = [];
  for (const song of (data && data.songs) || []) {
    for (const chart of song.charts || []) {
      const f = chartFigures(chart.deck, kind, power);
      if (!f) continue;
      const bgm = song.bgm && song.bgm.length;
      out.push({
        scoreId: chart.scoreId,
        musicId: song.id,
        difficulty: chart.difficulty,
        level: chart.level,
        displayLevel: chart.displayLevel ?? chart.level,
        title: song.title || null,
        bandIds: song.bandIds || [],
        bandName: song.bandName || null,
        musicType: song.musicType,
        scoreRanks: song.scoreRanks || [],
        notes: chart.notes ? chart.notes.judged : null,
        bpm: chart.bpm ? chart.bpm.main : null,
        bpmRange: chart.bpm ? [chart.bpm.min, chart.bpm.max] : null,
        bgmMs: bgm ? (bgm.durationMs ?? bgm.lengthMs ?? null) : null,
        chartMs: chart.musicLengthMs ?? null,
        ...f,
      });
    }
  }
  return out;
};

// Play length in ms without the overhead: the BGM's ("bgm") or the chart's music length ("chart"); the other one when
// the chosen one is missing.
export const lengthMs = (row, source) => {
  const v = source === "chart" ? row.chartMs ?? row.bgmMs : row.bgmMs ?? row.chartMs;
  return typeof v === "number" && v > 0 ? v : null;
};

// Skill values (fractions: 1 = +100 %) as numbers; missing, negative or non-numeric values count as 0.
export const skillValues = (skills) => [...(skills || [])].map((x) => {
  const v = Number(x);
  return Number.isFinite(v) && v > 0 ? v : 0;
});

// The mean skill value over `n` members (default: the number of values given).
export const meanSkill = (skills, n) => {
  const x = skillValues(skills);
  const m = n ?? x.length;
  return m > 0 ? x.slice(0, m).reduce((a, b) => a + b, 0) / m : 0;
};

// W: the summed weight of every performance position.
export const weightSum = (row) => (row.weights || []).reduce((a, b) => a + b, 0);

// Expected score per unit of power over the random skill order: base + xbar * W.
export const scoreRate = (row, skills) => row.base + meanSkill(skills, (row.weights || []).length) * weightSum(row);

const PERMS = new Map();
const permutations = (n) => {
  if (!PERMS.has(n)) {
    const out = [];
    const walk = (p, rest) => {
      if (!rest.length) { out.push(p); return; }
      rest.forEach((v, i) => walk([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
    };
    walk([], [...Array(n).keys()]);
    PERMS.set(n, out);
  }
  return PERMS.get(n);
};

// Score per unit of power of every skill order (n! values, ascending): member i at position perm[i].
export const orderRates = (row, skills) => {
  const w = row.weights || [];
  const x = skillValues(skills);
  return permutations(w.length).map((p) => p.reduce((s, pos, i) => s + (x[i] || 0) * w[pos], row.base))
    .sort((a, b) => a - b);
};

// The q-quantile (0..1) of an ascending list, by the nearest lower rank.
export const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

// Expected score per unit of power per minute of play (length + overhead).
export const perMinute = (row, skills, source, overheadMs) => {
  const L = lengthMs(row, source);
  return L === null ? null : scoreRate(row, skills) / ((L + overheadMs) / 60000);
};

const rateAt = (row, xbar) => row.base + xbar * weightSum(row);

// Whether `a` beats `b` in expected score per time for every mean skill value in [0, xMax] and every overhead c >= 0
// (see the top of the file), and strictly for some; charts without a length never do.
export const dominates = (a, b, source, xMax = X_MAX) => {
  const La = lengthMs(a, source);
  const Lb = lengthMs(b, source);
  if (La === null || Lb === null) return false;
  let strict = false;
  for (const xbar of [0, xMax]) {
    const sa = rateAt(a, xbar), sb = rateAt(b, xbar);
    for (const d of [sa - sb, sa / La - sb / Lb]) {
      const tol = EPS * Math.max(1, Math.abs(sa), Math.abs(sb));
      if (d < -tol) return false;
      if (d > tol) strict = true;
    }
  }
  return strict;
};

// For each row the indexes of the rows that dominate it; rows with none form the frontier.
export const dominance = (rows, source, xMax = X_MAX) => rows.map((b) => {
  const by = [];
  rows.forEach((a, i) => { if (a !== b && dominates(a, b, source, xMax)) by.push(i); });
  return by;
});

// The rows with their metrics under a parameter set, sorted by `key` (descending; "title" ascending).
export const rank = (rows, { skills, source, overheadMs, key = "perMinute", xMax = X_MAX }) => {
  const dom = dominance(rows, source, xMax);
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

// ---------------------------------------------------------------- score ranks (events)
// A live's score rank is the last of the song's `scoreRanks` (music-data.json: MasterLiveScoreRank rows of the song's
// group, every difficulty shares them) whose required score its score reaches. The client pays an event live
//   points = trunc((10000 + bonus) * boostRate * value(event, rank) / 10000)
// with the bonus from the deck's cards, boostRate = 5 per boost spent (1 without) and value from the event's point
// table: the song enters only through the rank. Whatever the table holds, as long as value grows with the rank, the
// song choice only needs the chance of each rank and the play time; a table value is recovered from one result as
// points * 10000 / ((10000 + bonus) * boostRate).
//
// Event dominance (expected score): a beats b when L_a <= L_b and, for every rank r with thresholds R_a, R_b > 0,
//   S_a(xbar) / R_a(r) >= S_b(xbar) / R_b(r)   for all 0 <= xbar <= X_MAX
// (linear in xbar: both ends decide), strictly somewhere: a deck reaches every rank on a at a power no higher than on
// b, and a takes no longer.

export const SCORE_RANKS = ["D", "C", "B", "A", "S", "SS"];

// The required score of a rank on a row's song; null when the song has no such rank.
export const rankThreshold = (row, rank) => {
  const hit = (row.scoreRanks || []).filter((r) => r.rank === rank).pop();
  return hit && Number.isFinite(hit.requiredScore) ? hit.requiredScore : null;
};

// The power at which the expected score reaches a rank's threshold; 0 for a rank needing no score, null without
// the rank or the chart's figures. `factor` scales the score (judgement accuracy).
export const requiredPower = (row, skills, rank, factor = 1) => {
  const R = rankThreshold(row, rank);
  if (R === null || !row.weights) return null;
  return R <= 0 ? 0 : R / (scoreRate(row, skills) * factor);
};

// The chance over the random skill order that a deck of `power` reaches at least `rank` on the chart.
export const reachChance = (row, skills, power, rank, factor = 1) => {
  const R = rankThreshold(row, rank);
  if (R === null || !row.weights) return null;
  if (R <= 0) return 1;
  const rates = orderRates(row, skills);
  return rates.filter((v) => power * v * factor >= R).length / rates.length;
};

// Whether `a` beats `b` for events (see above), strictly somewhere.
export const eventDominates = (a, b, source, xMax = X_MAX) => {
  const La = lengthMs(a, source);
  const Lb = lengthMs(b, source);
  if (La === null || Lb === null || La > Lb + EPS || !a.weights || !b.weights) return false;
  let any = La < Lb - EPS;
  for (const rank of SCORE_RANKS) {
    const Ra = rankThreshold(a, rank), Rb = rankThreshold(b, rank);
    if (Rb === null) continue;                               // b never gets the rank
    if (Ra === null) return false;
    if (Rb <= 0) { if (Ra > 0) return false; continue; }     // b always gets it
    if (Ra <= 0) { any = true; continue; }
    for (const xbar of [0, xMax]) {
      const d = rateAt(a, xbar) / Ra - rateAt(b, xbar) / Rb;
      const tol = EPS * Math.max(1, rateAt(a, xbar) / Ra);
      if (d < -tol) return false;
      if (d > tol) any = true;
    }
  }
  return any;
};

// For each row the indexes of the rows that beat it for events.
export const eventDominance = (rows, source, xMax = X_MAX) => rows.map((b) => {
  const by = [];
  rows.forEach((a, i) => { if (a !== b && eventDominates(a, b, source, xMax)) by.push(i); });
  return by;
});
