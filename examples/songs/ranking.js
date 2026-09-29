// Chart efficiency ranking: pure functions over a site's music-data.json (nnnotes.music-data/1, whose deck
// statistics are ournotes-deck.chart-stats/2).
//
// Score model (music-data.json `deck`, checked per seed against the whole-live simulation): on the theoretical best
// play with Gekisou on (the chart's fevers with the song's missions, rank 1 in every range), a deck of power P whose
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
//
// Play scenarios (see scenarioSeed): "battle" is Gekisou Live (撃奏ライブ, up to 5 players, Gekisou on) with a rank
// r_i in 1..5 per Gekisou range; the seeds are its rank-1 simulations, and the other ranks follow from them linearly
// (the rank bonus trunc(rangeScore * p / 100) is added at the range's end and changes nothing else):
//
//   base_r = (score - sum_i rankBonus_i + sum_i trunc(rangeScore_i * p_i(r_i) / 100)) / power
//   w_r[k] = w[k] + sum_i (p_i(r_i) - p_i(1)) / 100 * rangeWeights[k][i]
//
// "free" is Free Live (solo, Gekisou off), its own simulation (`offSeeds`). Two accuracy approximations, without
// combo breaks: a Great share q scales every score by 1 - 0.2 q; a Just rate j (battle only) interpolates between the
// all-Just seeds and the all-Perfect run of the Just ranges (`scorePerfect`, `rangeScorePerfect`), with the rank
// bonuses recomputed on the interpolated range scores and the skill weights inside a range scaled by the same ratio.

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

// ---------------------------------------------------------------- play scenarios
// The Great judgement's score percent against the Perfect's (MasterLiveJudgementParameter: 80 and 100).
export const GREAT_SCORE = 0.8;
// Gekisou Live seats up to 5 players; a chart has 3 Gekisou ranges (more fevers are unplayable with Gekisou on).
export const RANK_MAX = 5;
export const RANGES = 3;
// The Just mission (music-data.json `gekisouMissions`, deck `ranges[i].mission`): Just judgements are on only there.
const JUST_MISSION = 3;
// mode "battle" | "free"; ranks[i] the rank in range i; just and great as fractions (0..1)
export const DEFAULT_SCENARIO = Object.freeze({ mode: "battle", ranks: Object.freeze([1, 1, 1]), just: 1, great: 0 });

// The score factor of a Great share q (0..1) over every note: 1 - 0.2 q.
export const greatFactor = (q) => 1 - (1 - GREAT_SCORE) * (Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 0);

const clampRank = (r) => (Number.isInteger(r) && r >= 1 && r <= RANK_MAX ? r : 1);

// "r" or "r1,r2,r3" (the query's rk) as three ranks; a bad or missing value is rank 1.
export const parseRanks = (text) => {
  const v = String(text ?? "").split(",").slice(0, RANGES).map((x) => clampRank(Number(x)));
  return v.length === 1 ? Array(RANGES).fill(v[0]) : [...v, ...Array(RANGES - v.length).fill(1)];
};

// The query form of three ranks: "" for all rank 1, "r" for one rank everywhere, else "r1,r2,r3".
export const formatRanks = (ranks) => {
  const r = [...Array(RANGES).keys()].map((i) => clampRank((ranks || [])[i]));
  if (r.every((x) => x === r[0])) return r[0] === 1 ? "" : String(r[0]);
  return r.join(",");
};

// Range i's rank bonus percent at rank r (music-data.json deck `ranges[i]`: rankBonusPercents for ranks 1..5,
// rankBonusPercent for rank 1); null when the data has no such rank.
export const rankPercent = (range, r) => {
  const list = range && range.rankBonusPercents;
  if (Array.isArray(list) && Number.isFinite(list[r - 1])) return list[r - 1];
  return r === 1 && range && Number.isFinite(range.rankBonusPercent) ? range.rankBonusPercent : null;
};

// Which scenarios music-data.json can show: free (offSeeds), ranks other than 1 (rankBonusPercents and
// rangeWeights), a Just rate below 100 % (scorePerfect, with rangeWeights for the skill weights).
export const scenarioData = (data) => {
  const has = { free: false, ranks: false, just: false };
  for (const song of (data && data.songs) || []) {
    for (const chart of song.charts || []) {
      const d = chart.deck;
      if (!d) continue;
      const seeds = d.seeds || [];
      if ((d.offSeeds || []).length) has.free = true;
      if ((d.ranges || []).length && d.ranges.every((r) => Array.isArray(r.rankBonusPercents) && r.rankBonusPercents.length >= RANK_MAX)
        && seeds.some((s) => s.rangeWeights)) has.ranks = true;
      if (seeds.some((s) => Number.isFinite(s.scorePerfect) && s.rangeWeights)) has.just = true;
    }
  }
  return has;
};

// One seed's no-skill score (points at the measurement power) and the position weights of `kind` in a scenario
// (see the top of the file; `ranges` is the chart's deck `ranges`); null when the seed lacks a field the scenario
// needs. Battle at rank 1 everywhere with j = 1 is the seed itself; free is an `offSeeds` entry as it is.
export const scenarioSeed = (seed, ranges, kind, scenario) => {
  const sc = { ...DEFAULT_SCENARIO, ...(scenario || {}) };
  const w0 = seed && seed.weights && seed.weights[kind];
  if (!Array.isArray(w0) || !Number.isFinite(seed.score)) return null;
  const g = greatFactor(sc.great);
  const plain = () => ({ score: seed.score * g, weights: w0.map((v) => (v ?? 0) * g) });
  if (sc.mode === "free") return plain();
  const rs = seed.ranges || [];
  const ranks = rs.map((_, i) => clampRank((sc.ranks || [])[i]));
  const j = Number.isFinite(sc.just) ? Math.min(1, Math.max(0, sc.just)) : 1;
  const partial = j < 1;
  if (!partial && ranks.every((r) => r === 1)) return plain();
  const rw = seed.rangeWeights && seed.rangeWeights[kind];
  if (!Array.isArray(rw)) return null;
  const p1 = rs.map((_, i) => rankPercent(ranges[i], 1));
  const pr = rs.map((_, i) => rankPercent(ranges[i], ranks[i]));
  if ([...p1, ...pr].some((p) => p === null) || rs.some((x) => !Number.isFinite(x.rangeScore) || !Number.isFinite(x.rankBonus))) return null;
  // the all-Perfect range score: a range without Just judgements scores the same either way
  const perfect = rs.map((x, i) => (Number.isFinite(x.rangeScorePerfect) ? x.rangeScorePerfect
    : ranges[i] && ranges[i].mission !== JUST_MISSION ? x.rangeScore : null));
  if (partial && (!Number.isFinite(seed.scorePerfect) || perfect.some((v) => v === null))) return null;
  const lerp = (p, just) => (partial ? p + j * (just - p) : just);
  // the score without the rank bonuses, all Just and all Perfect (scorePerfect holds the rank-1 bonuses of its ranges)
  const rest = seed.score - rs.reduce((a, x) => a + x.rankBonus, 0);
  const restP = partial ? seed.scorePerfect - perfect.reduce((a, v, i) => a + Math.trunc((v * p1[i]) / 100), 0) : rest;
  const rangeJ = rs.map((x, i) => lerp(perfect[i], x.rangeScore));
  const score = lerp(restP, rest) + rangeJ.reduce((a, v, i) => a + Math.trunc((v * pr[i]) / 100), 0);
  const weights = w0.map((v, k) => (v ?? 0) + rs.reduce((a, x, i) => {
    const d = (rw[k] && rw[k][i]) ?? 0;
    const ratio = x.rangeScore > 0 ? rangeJ[i] / x.rangeScore : 1;         // the Just rate's, on the range's part
    return a + ((pr[i] - p1[i]) / 100) * d + (ratio - 1) * (1 + pr[i] / 100) * d;
  }, 0));
  return { score: score * g, weights: weights.map((v) => v * g) };
};

// A chart's figures from its deck statistics (`chart.deck`) in a scenario (default: battle, rank 1, all Just, no
// Great): `base` and `weights[k]` (performance position k's, of kind `kind`) as means over the seeds (`offSeeds` in
// free), `baseRange` the seeds' [min, max] base, `seeds` their number. null without statistics, for a chart
// unplayable with Gekisou on (battle), without the kind or without the scenario's fields.
export const chartFigures = (deck, kind, power = POWER, scenario = null) => {
  const free = Boolean(scenario && scenario.mode === "free");
  const seeds = (deck && (free ? deck.offSeeds : !deck.unplayable && deck.seeds)) || [];
  if (!seeds.length || kind === null || kind === undefined) return null;
  const figs = seeds.map((s) => scenarioSeed(s, deck.ranges || [], kind, scenario));
  if (figs.some((f) => !f)) return null;
  const bases = figs.map((f) => f.score / power);
  const n = deck.positions ?? figs[0].weights.length;
  return {
    base: mean(bases),
    baseRange: [Math.min(...bases), Math.max(...bases)],
    seeds: seeds.length,
    skip: deck.skip ?? null,
    weights: [...Array(n).keys()].map((k) => mean(figs.map((f) => f.weights[k] ?? 0))),
  };
};

// ournotes-deck's measurement power of music-data.json.
export const modelPower = (data) => (data && data.deck && data.deck.model && data.deck.model.power) || POWER;

// One row per chart of music-data.json with deck figures in a scenario (see chartFigures), with the song's facts;
// `weights[k]` is performance position k's.
export const joinCharts = (data, scenario = null) => {
  const kind = plainKind(data);
  const power = modelPower(data);
  const out = [];
  for (const song of (data && data.songs) || []) {
    for (const chart of song.charts || []) {
      const f = chartFigures(chart.deck, kind, power, scenario);
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
// Free Live rates a player's score against the song's `requiredScore`. Gekisou Live rates the room: the sum of the
// scores of its n players against trunc(sqrt(5 / n) * battleRequiredScore * n). With every player scoring the same,
// one player needs trunc(sqrt(5 / n) * R_battle * n) / n, about sqrt(5 / n) * R_battle (`room` = n below; 0 for solo).
//
// Event dominance (expected score): a beats b when L_a <= L_b and, for every rank r with thresholds R_a, R_b > 0,
//   S_a(xbar) / R_a(r) >= S_b(xbar) / R_b(r)   for all 0 <= xbar <= X_MAX
// (linear in xbar: both ends decide), strictly somewhere: a deck reaches every rank on a at a power no higher than on
// b, and a takes no longer.

export const SCORE_RANKS = ["D", "C", "B", "A", "S", "SS"];

// One player's share of a Gekisou Live room threshold R_battle among n players who all score the same.
export const roomThreshold = (R, n) => Math.trunc(Math.sqrt(5 / n) * R * n) / n;

// The score one player needs for a rank on a row's song: solo (`room` 0) the song's requiredScore, in a Gekisou Live
// room of `room` players scoring the same its roomThreshold; null when the song has no such rank.
export const rankThreshold = (row, rank, room = 0) => {
  const hit = (row.scoreRanks || []).filter((r) => r.rank === rank).pop();
  if (!hit) return null;
  if (!room) return Number.isFinite(hit.requiredScore) ? hit.requiredScore : null;
  return Number.isFinite(hit.battleRequiredScore) ? roomThreshold(hit.battleRequiredScore, room) : null;
};

// The power at which the expected score reaches a rank's threshold; 0 for a rank needing no score, null without
// the rank or the chart's figures. `factor` scales the score (the page folds its accuracy into the figures).
export const requiredPower = (row, skills, rank, factor = 1, room = 0) => {
  const R = rankThreshold(row, rank, room);
  if (R === null || !row.weights) return null;
  return R <= 0 ? 0 : R / (scoreRate(row, skills) * factor);
};

// The chance over the random skill order that a deck of `power` reaches at least `rank` on the chart.
export const reachChance = (row, skills, power, rank, factor = 1, room = 0) => {
  const R = rankThreshold(row, rank, room);
  if (R === null || !row.weights) return null;
  if (R <= 0) return 1;
  const rates = orderRates(row, skills);
  return rates.filter((v) => power * v * factor >= R).length / rates.length;
};

// Whether `a` beats `b` for events (see above), strictly somewhere.
export const eventDominates = (a, b, source, xMax = X_MAX, room = 0) => {
  const La = lengthMs(a, source);
  const Lb = lengthMs(b, source);
  if (La === null || Lb === null || La > Lb + EPS || !a.weights || !b.weights) return false;
  let any = La < Lb - EPS;
  for (const rank of SCORE_RANKS) {
    const Ra = rankThreshold(a, rank, room), Rb = rankThreshold(b, rank, room);
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
export const eventDominance = (rows, source, xMax = X_MAX, room = 0) => rows.map((b) => {
  const by = [];
  rows.forEach((a, i) => { if (a !== b && eventDominates(a, b, source, xMax, room)) by.push(i); });
  return by;
});
