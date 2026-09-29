import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCENARIO, MEASURES, MISSION_MEASURE, X_MAX, aptitudeFigures, aptitudeRate, aptitudeSe, aptitudeShapes, chartVariants, zeroGain, chartFigures, dominance, dominates, eventDominates, formatLength,
  formatRanks, greatFactor, joinCharts, lengthMs, meanSkill, masterSkillFactor, orderRates, parseRanks, perMinute, pickText, plainKind,
  quantile, rangeMeasures, rank, rankPercent, rankThreshold, reachChance, requiredPower, roomThreshold, scenarioData,
  scoreRate, weightSum,
} from "../../examples/songs/ranking.js";
import {
  chartRows, density, extent, gekisouSkill, histogram, matches, moenotesUrl, noteKinds, refigure, shapeSkills, shapeBands, sortBy, ticks,
} from "../../examples/songs/catalog.js";

// music-data.json: kind 0 is a judgement score up, kind 1 the plain score up the page models
const W13 = [0.1, 0.3, 0.2, 0.25, 0.15];
const seed = (seed, score, w1, w0 = [9, 9, 9, 9, 9]) => ({ seed, score, weights: [w0, w1], ranges: [] });
const deck = (seeds, extra = {}) => ({ positions: 5, skip: 3, unplayable: null, events: [[0, 1000], [1, 2000], [2, 3000], [3, 4000], [4, 5000]], seeds, ...extra });
const songs = {
  deck: {
    model: { power: 1000 },
    kinds: [
      { id: 0, effectType: 2004, durationMs: 5000, skillTargetIds: [41, 46], skillConditionGroup: 0 },
      { id: 1, effectType: 2000, durationMs: 5000, skillTargetIds: [], skillConditionGroup: 0, skillReleaseConditionGroup: 0,
        effectLimitCount: 0, effectExecuteLimitCount: 0 },
    ],
  },
  songs: [
    { id: 1, title: { ja: "一", en: "One" }, bandIds: [1], bandName: null, musicType: 1,
      bgm: { length: { lengthMs: 120000, durationMs: 119990 } },
      charts: [{ difficulty: "hard", scoreId: 12, level: 20, displayLevel: 20, notes: { judged: 500 },
                 bpm: { main: 180, min: 90, max: 180 }, musicLengthMs: 110000, deck: null },
               { difficulty: "expert", scoreId: 13, level: 26, displayLevel: 26.5, notes: { judged: 800 },
                 bpm: { main: 180, min: 180, max: 180 }, musicLengthMs: 111000,
                 // two seeds: base 3.9 and 4.1, position 0 weighs 0.05 and 0.15
                 deck: deck([seed(0, 3900, [0.05, ...W13.slice(1)]), seed(1, 4100, [0.15, ...W13.slice(1)])]) }] },
    { id: 2, title: { ja: "二" }, bandIds: [2], bgm: null,
      charts: [{ difficulty: "expert", scoreId: 23, level: 25, notes: { judged: 700 }, musicLengthMs: 90000,
                 deck: deck([seed(0, 3800, [0.2, 0.2, 0.2, 0.2, 0.2])]) },
               { difficulty: "hard", scoreId: 22, level: 20, notes: { judged: 600 }, musicLengthMs: 90000,
                 deck: deck([], { unplayable: "4 fevers" }) }] },
  ],
};

test("joinCharts takes the plain kind's weights and the seed means per performance position", () => {
  const rows = joinCharts(songs);
  assert.deepEqual(rows.map((r) => r.scoreId), [13, 23]);   // no deck statistics, unplayable: left out
  const [a, b] = rows;
  assert.deepEqual(a.weights, W13);
  assert.ok(Math.abs(a.base - 4) < 1e-12);
  assert.deepEqual(a.baseRange, [3.9, 4.1]);
  assert.equal(a.seeds, 2);
  assert.equal(a.skip, 3);
  assert.equal(a.bgmMs, 119990);
  assert.equal(a.chartMs, 111000);
  assert.equal(a.displayLevel, 26.5);
  assert.equal(a.notes, 800);
  assert.deepEqual(a.bpmRange, [180, 180]);
  assert.equal(b.bgmMs, null);
  assert.equal(b.displayLevel, 25);
  assert.equal(b.seeds, 1);
  assert.equal(plainKind(songs), 1);
  assert.equal(plainKind({ deck: { kinds: [songs.deck.kinds[0]] } }), null);
  assert.equal(plainKind({ deck: null }), null);
  assert.deepEqual(joinCharts({ ...songs, deck: null }), []);   // made with --no-deck
  assert.equal(chartFigures(null, 1), null);
  assert.equal(chartFigures(songs.songs[1].charts[0].deck, null), null);
  assert.ok(Math.abs(chartFigures(songs.songs[1].charts[0].deck, 1).base - 3800 / 300000) < 1e-12);   // default power 300000
});

test("lengths, texts and formatting", () => {
  const [a, b] = joinCharts(songs);
  assert.equal(lengthMs(a, "bgm"), 119990);
  assert.equal(lengthMs(a, "chart"), 111000);
  assert.equal(lengthMs(b, "bgm"), 90000);                 // no BGM: the chart's length
  assert.equal(lengthMs({ bgmMs: null, chartMs: 0 }, "bgm"), null);
  assert.equal(pickText({ ja: "一", en: "One" }, "en"), "One");
  assert.equal(pickText({ ja: "一", en: "" }, "en"), "一");
  assert.equal(pickText({ en: "x" }, "ko"), "x");
  assert.equal(pickText(null, "ja"), "");
  assert.equal(formatLength(119990), "2:00.0");
  assert.equal(formatLength(119940), "1:59.9");
  assert.equal(formatLength(0), "0:00.0");
  assert.equal(formatLength(65000), "1:05.0");
  assert.equal(formatLength(null), "");
});

test("the expected score uses the mean skill value; the orders give its spread", () => {
  const [a] = joinCharts(songs);
  const x = [0.5, 1.4, 1, 0, 0.8];
  assert.ok(Math.abs(meanSkill(x) - 0.74) < 1e-12);
  assert.equal(meanSkill([1, -1, "x"], 5), 0.2);                  // bad values count as 0, missing members too
  assert.ok(Math.abs(weightSum(a) - 1) < 1e-12);
  const mean = 4 + 0.74 * 1;
  assert.ok(Math.abs(scoreRate(a, x) - mean) < 1e-12);
  assert.ok(Math.abs(perMinute(a, x, "chart", 30000) - mean / (141000 / 60000)) < 1e-12);
  assert.equal(scoreRate(a, []), 4);
  const v = orderRates(a, x);
  assert.equal(v.length, 120);
  assert.ok(v.every((y, i) => i === 0 || v[i - 1] <= y));
  const avg = v.reduce((p, q) => p + q, 0) / v.length;
  assert.ok(Math.abs(avg - mean) < 1e-12);                         // the expectation over the uniform order
  const best = 4 + 1.4 * 0.3 + 1 * 0.25 + 0.8 * 0.2 + 0.5 * 0.15;  // rearrangement: the best order
  assert.ok(Math.abs(v[119] - best) < 1e-12);
  // Var = sum (x - xbar)^2 * sum (w - wbar)^2 / (n - 1)
  const variance = v.reduce((p, q) => p + (q - avg) ** 2, 0) / v.length;
  const sx = x.reduce((p, q) => p + (q - 0.74) ** 2, 0);
  const sw = a.weights.reduce((p, q) => p + (q - 0.2) ** 2, 0);
  assert.ok(Math.abs(variance - (sx * sw) / 4) < 1e-12);
  assert.ok(orderRates(a, [1, 1, 1, 1, 1]).every((y) => Math.abs(y - 5) < 1e-12));  // equal skills: no spread
  assert.equal(quantile(v, 0), v[0]);
  assert.equal(quantile(v, 0.1), v[12]);
  assert.equal(quantile([], 0.5), null);
});

// a deterministic generator
const rng = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const randomRow = (r, i) => ({
  scoreId: i, base: 3.7 + r() * 0.6, chartMs: 80000 + Math.floor(r() * 60000), bgmMs: null,
  weights: Array.from({ length: 5 }, () => r() * 0.4),
});

const gap = (a, b, xbar, c) => {
  const x = Array(5).fill(xbar);
  return scoreRate(a, x) / (a.chartMs + c) - scoreRate(b, x) / (b.chartMs + c);
};

test("dominance holds for every mean skill up to X_MAX and every overhead, with a counterexample otherwise", () => {
  const r = rng(42);
  const rows = Array.from({ length: 40 }, (_, i) => randomRow(r, i));
  // a few pairs that surely dominate: a copy with more base and weight, the same length
  for (let i = 0; i < 5; i++) {
    const w = rows[i];
    rows.push({ ...w, scoreId: 100 + i, base: w.base + 0.01, weights: w.weights.map((x) => x + 0.001) });
  }
  let dominated = 0;
  for (const a of rows) {
    for (const b of rows) {
      if (a === b) continue;
      if (dominates(a, b, "chart")) {
        dominated++;
        for (let k = 0; k < 40; k++) {
          const xbar = r() * X_MAX;
          const c = [0, r() * 120000, 1e9][k % 3];
          assert.ok(gap(a, b, xbar, c) >= -1e-12, `${a.scoreId} > ${b.scoreId} fails at ${xbar} ${c}`);
        }
      } else {
        // the corners: xbar = 0 or X_MAX, c = 0 or huge
        let violated = false;
        let strict = false;
        for (const xbar of [0, X_MAX]) {
          for (const c of [0, 1e12]) {
            const g = gap(a, b, xbar, c) * (c ? c : 1);
            if (g < -1e-9) violated = true;
            if (g > 1e-9) strict = true;
          }
        }
        assert.ok(violated || !strict, `${a.scoreId} vs ${b.scoreId}: no counterexample`);
      }
    }
  }
  assert.ok(dominated >= 5);
  // a chart that only wins beyond the bound is not beaten
  const lo = { scoreId: 1, base: 4, chartMs: 100000, bgmMs: null, weights: [0.1, 0.1, 0.1, 0.1, 0.1] };
  const hi = { ...lo, scoreId: 2, base: 3.9, weights: [0.2, 0.2, 0.2, 0.2, 0.2] };   // better once xbar > 0.2
  assert.equal(dominates(lo, hi, "chart"), false);
  assert.equal(dominates(lo, hi, "chart", 0.1), true);
});

test("score ranks: thresholds, the power needed, the chance over the orders, event dominance", () => {
  const ranks = [{ rank: "D", requiredScore: 0 }, { rank: "S", requiredScore: 800 }, { rank: "SS", requiredScore: 1000 }];
  const a = { scoreId: 1, base: 4, chartMs: 100000, bgmMs: null, weights: [0.5, 0.1, 0.1, 0.1, 0.2], scoreRanks: ranks };
  assert.equal(rankThreshold(a, "SS"), 1000);
  assert.equal(rankThreshold(a, "A"), null);
  const x = [1, 0, 0, 0, 0];                                       // one skill: where it lands decides
  assert.ok(Math.abs(requiredPower(a, x, "SS") - 1000 / 4.2) < 1e-9);
  assert.equal(requiredPower(a, x, "D"), 0);
  assert.equal(requiredPower(a, x, "A"), null);
  // at power 1000 / 4.3 the skill must land on a position of weight >= 0.3: position 0 only, 24 of 120 orders
  assert.ok(Math.abs(reachChance(a, x, 1000 / 4.3, "SS") - 0.2) < 1e-12);
  assert.equal(reachChance(a, x, 1000, "SS"), 1);
  assert.equal(reachChance(a, x, 1, "SS"), 0);
  assert.equal(reachChance(a, x, 1, "D"), 1);
  assert.ok(Math.abs(reachChance(a, x, 1000 / 4.3 / 0.9, "SS", 0.9) - 0.2) < 1e-12);  // the judgement factor
  // event dominance: thresholds no higher and no longer
  const harder = [{ rank: "D", requiredScore: 0 }, { rank: "S", requiredScore: 800 }, { rank: "SS", requiredScore: 1100 }];
  const b = { ...a, scoreId: 2, scoreRanks: harder };
  assert.equal(eventDominates(a, b, "chart"), true);
  assert.equal(eventDominates(b, a, "chart"), false);
  assert.equal(eventDominates(a, { ...b, chartMs: 90000 }, "chart"), false);        // b shorter
  assert.equal(eventDominates(a, { ...a, scoreId: 3 }, "chart"), false);            // equal
});

test("rank marks the frontier and sorts", () => {
  const a = { scoreId: 1, base: 4, chartMs: 100000, bgmMs: null, weights: [0.3, 0.2], notes: 500, displayLevel: 26 };
  const b = { ...a, scoreId: 2, base: 3.9, weights: [0.3, 0.1], notes: 400, displayLevel: 27 };  // a beats b
  const c = { ...a, scoreId: 3, base: 3, chartMs: 60000, weights: [0.1, 0.1], notes: 300, displayLevel: 24 };
  assert.deepEqual(dominance([a, b, c], "chart"), [[], [0], []]);
  const out = rank([a, b, c], { skills: [1, 1], source: "chart", overheadMs: 60000 });
  assert.deepEqual(out.map((r) => r.scoreId), [1, 2, 3]);
  assert.deepEqual(out.map((r) => r.frontier), [true, false, true]);
  assert.equal(out[0].notesPerSecond, 5);
  // a short chart wins per minute when the overhead is small
  assert.deepEqual(rank([a, b, c], { skills: [0, 0], source: "chart", overheadMs: 0 }).map((r) => r.scoreId), [3, 1, 2]);
  assert.deepEqual(rank([a, b, c], { skills: [], source: "chart", overheadMs: 0, key: "level" }).map((r) => r.scoreId), [2, 1, 3]);
  // equal charts dominate neither way
  assert.equal(dominates(a, { ...a, scoreId: 9 }, "chart"), false);
});

// ---------------------------------------------------------------- play scenarios

// chartFigures before the scenarios: the seeds' own score and weights
const statusQuo = (deck, kind, power) => {
  const seeds = (deck && !deck.unplayable && deck.seeds) || [];
  if (!seeds.length || !seeds.every((s) => Array.isArray(s.weights && s.weights[kind]))) return null;
  const bases = seeds.map((s) => s.score / power);
  const n = deck.positions ?? seeds[0].weights[kind].length;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { base: avg(bases), baseRange: [Math.min(...bases), Math.max(...bases)], seeds: seeds.length, skip: deck.skip ?? null,
    weights: [...Array(n).keys()].map((k) => avg(seeds.map((s) => s.weights[kind][k] ?? 0))) };
};

// three ranges: combo, Just, luck; rank 1 bonus = trunc(rangeScore * p(1) / 100); the no-bonus score 20000 all Just,
// 19198 all Perfect (range 1 scores 2003 all Just, 1201 all Perfect)
const RANGES3 = [
  { index: 0, mission: 1, rankBonusPercent: 250, rankBonusPercents: [250, 200, 160, 130, 100] },
  { index: 1, mission: 3, rankBonusPercent: 250, rankBonusPercents: [250, 200, 160, 130, 100] },
  { index: 2, mission: 2, rankBonusPercent: 370, rankBonusPercents: [370, 300, 230, 160, 100] },
];
const W1 = [0.1, 0.2, 0.3, 0.4, 0.5];
const RW1 = [[0.01, 0.02, 0], [0, 0.03, 0.01], [0.02, 0, 0.04], [0, 0, 0], [0.05, 0.01, 0.02]];   // [k][i]
const battleSeed = (extra = {}) => ({
  seed: 0,
  score: 20000 + 2502 + 5007 + 5575,
  scorePerfect: 19198 + 2502 + 3002 + 5575,
  weights: [[9, 9, 9, 9, 9], W1],
  rangeWeights: [RW1.map((w) => w.map(() => 1)), RW1],
  ranges: [
    { rangeScore: 1001, rankBonus: 2502, justCount: 0 },
    { rangeScore: 2003, rankBonus: 5007, rangeScorePerfect: 1201, justCount: 40 },
    { rangeScore: 1507, rankBonus: 5575, justCount: 0 },
  ],
  ...extra,
});
const deck3 = (extra = {}) => ({
  positions: 5, skip: 2, unplayable: null, ranges: RANGES3,
  seeds: [battleSeed(), battleSeed({ seed: 1, score: battleSeed().score + 300, scorePerfect: battleSeed().scorePerfect + 300 })],
  offSeeds: [{ seed: 0, score: 9000, weights: [[1, 1, 1, 1, 1], [0.05, 0.06, 0.07, 0.08, 0.09]], check: null }],
  ...extra,
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const nearAll = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => near(v, b[i], `${msg}[${i}]`)); };

test("rank 1 everywhere, all Just and no Great is the seeds themselves, value for value", () => {
  const decks = [deck3(), songs.songs[0].charts[1].deck, songs.songs[1].charts[0].deck, songs.songs[1].charts[1].deck, null];
  for (const d of decks) {
    for (const sc of [undefined, null, DEFAULT_SCENARIO, { mode: "battle", ranks: [1, 1, 1], just: 1, great: 0 }, { mode: "battle" }]) {
      assert.deepEqual(chartFigures(d, 1, 1000, sc), statusQuo(d, 1, 1000));
    }
  }
  assert.deepEqual(joinCharts(songs, DEFAULT_SCENARIO), joinCharts(songs));
  // the rows' figures too, and back after another scenario
  const rows = chartRows(songs);
  const before = structuredClone(rows.map(({ song, chart, stats, ...r }) => r));
  refigure(rows, songs, { mode: "battle", ranks: [5, 5, 5], great: 0.5 });
  assert.notDeepEqual(rows.find((r) => r.scoreId === 13).base, before.find((r) => r.scoreId === 13).base);
  refigure(rows, songs, DEFAULT_SCENARIO);
  assert.deepEqual(rows.map(({ song, chart, stats, ...r }) => r), before);
  assert.equal(greatFactor(0), 1);
  near(greatFactor(0.25), 0.95, "g(0.25)");
  assert.equal(greatFactor(2), greatFactor(1));
});

test("the linear rank formula against the hand computation", () => {
  const d = deck3({ seeds: [battleSeed()] });
  // ranks 2, 5, 3: percents 200, 100, 230; bonuses trunc(1001 * 2) = 2002, trunc(2003 * 1) = 2003, trunc(1507 * 2.3) = 3466
  const f = chartFigures(d, 1, 1000, { mode: "battle", ranks: [2, 5, 3] });
  near(f.base, (20000 + 2002 + 2003 + 3466) / 1000, "base");
  // w[k] + (-0.5 rw[k][0] - 1.5 rw[k][1] - 1.4 rw[k][2])
  nearAll(f.weights, [0.1 - 0.005 - 0.03, 0.2 - 0.045 - 0.014, 0.3 - 0.01 - 0.056, 0.4, 0.5 - 0.025 - 0.015 - 0.028], "weights");
  assert.equal(rankPercent(RANGES3[2], 3), 230);
  assert.equal(rankPercent({ rankBonusPercent: 250 }, 1), 250);             // older data: rank 1 only
  assert.equal(rankPercent({ rankBonusPercent: 250 }, 2), null);
  // the rank bonus is floored on the range score: 1001 * 160 / 100 = 1601.6
  near(chartFigures(d, 1, 1000, { ranks: [3, 1, 1] }).base, (20000 + 1601 + 5007 + 5575) / 1000, "floor");
  // a single rank moves only its own range
  const g = chartFigures(d, 1, 1000, { ranks: [1, 1, 5] });
  near(g.base, (20000 + 2502 + 5007 + 1507) / 1000, "rank 5 in range 2");
  nearAll(g.weights, W1.map((w, k) => w + ((100 - 370) / 100) * RW1[k][2]), "rank 5 weights");
  // the mean over the seeds
  const two = chartFigures(deck3(), 1, 1000, { ranks: [2, 5, 3] });
  near(two.base, f.base + 0.15, "two seeds");
  assert.deepEqual(two.baseRange.map((x) => +x.toFixed(9)), [f.base, f.base + 0.3].map((x) => +x.toFixed(9)));
  // without rangeWeights or rankBonusPercents the other ranks have no figures; rank 1 still has
  const bare = deck3({ seeds: [battleSeed({ rangeWeights: undefined })] });
  assert.equal(chartFigures(bare, 1, 1000, { ranks: [2, 1, 1] }), null);
  assert.deepEqual(chartFigures(bare, 1, 1000, { ranks: [1, 1, 1] }), statusQuo(bare, 1, 1000));
  assert.equal(chartFigures(deck3({ ranges: RANGES3.map(({ rankBonusPercents, ...r }) => r) }), 1, 1000, { ranks: [2, 2, 2] }), null);
});

test("the Just rate interpolates to the all-Perfect run, then the Great share scales", () => {
  const d = deck3({ seeds: [battleSeed()] });
  // j = 0: all Perfect at rank 1 is scorePerfect itself
  near(chartFigures(d, 1, 1000, { just: 0 }).base, (19198 + 2502 + 3002 + 5575) / 1000, "all Perfect");
  // j = 0.5, q = 0.25, ranks 2, 5, 3: no-bonus score 19198 + 0.5 * 802 = 19599; range 1 scores 1201 + 0.5 * 802 = 1602
  const f = chartFigures(d, 1, 1000, { ranks: [2, 5, 3], just: 0.5, great: 0.25 });
  near(f.base, ((19599 + 2002 + 1602 + 3466) * 0.95) / 1000, "base");
  // the weights of range 1 scale by 1602 / 2003, with its rank bonus (100 %) on top
  const rho = 1602 / 2003;
  const wr = [0.065, 0.141, 0.234, 0.4, 0.432];
  nearAll(f.weights, wr.map((w, k) => (w + (rho - 1) * 2 * RW1[k][1]) * 0.95), "weights");
  // the Great share alone
  const q = chartFigures(d, 1, 1000, { great: 0.5 });
  near(q.base, (battleSeed().score * 0.9) / 1000, "Great base");
  nearAll(q.weights, W1.map((w) => w * 0.9), "Great weights");
  // without scorePerfect, or a Just range without its Perfect score, no figures below 100 %
  assert.equal(chartFigures(deck3({ seeds: [battleSeed({ scorePerfect: undefined })] }), 1, 1000, { just: 0.5 }), null);
  const noJustPerfect = battleSeed();
  noJustPerfect.ranges = noJustPerfect.ranges.map(({ rangeScorePerfect, ...x }) => x);
  assert.equal(chartFigures(deck3({ seeds: [noJustPerfect] }), 1, 1000, { just: 0.5 }), null);
});

test("Free Live reads offSeeds, also on charts unplayable with Gekisou", () => {
  const d = deck3();
  const f = chartFigures(d, 1, 1000, { mode: "free" });
  near(f.base, 9, "base");
  assert.equal(f.seeds, 1);
  assert.deepEqual(f.weights, [0.05, 0.06, 0.07, 0.08, 0.09]);
  // ranks and the Just rate do not apply; the Great share does
  assert.deepEqual(chartFigures(d, 1, 1000, { mode: "free", ranks: [5, 5, 5], just: 0 }), f);
  near(chartFigures(d, 1, 1000, { mode: "free", great: 1 }).base, 7.2, "Great");
  const four = deck3({ unplayable: "4 fevers", seeds: [] });
  assert.equal(chartFigures(four, 1, 1000), null);
  near(chartFigures(four, 1, 1000, { mode: "free" }).base, 9, "unplayable");
  assert.equal(chartFigures(deck3({ offSeeds: undefined }), 1, 1000, { mode: "free" }), null);
  // a kind the Gekisou-off run could not model is null there
  assert.equal(chartFigures(deck3({ offSeeds: [{ seed: 0, score: 9000, weights: [[1, 1, 1, 1, 1], null] }] }), 1, 1000, { mode: "free" }), null);
});

test("what the data can show, the ranks in the query", () => {
  const data = (d) => ({ songs: [{ id: 1, charts: [{ scoreId: 1, deck: d }] }] });
  assert.deepEqual(scenarioData(data(deck3())), { free: true, ranks: true, just: true, aptitude: false });
  assert.deepEqual(scenarioData(songs), { free: false, ranks: false, just: false, aptitude: false });   // the current data
  assert.deepEqual(scenarioData(data(deck3({ offSeeds: [], ranges: RANGES3.map(({ rankBonusPercents, ...r }) => r) }))),
    { free: false, ranks: false, just: true, aptitude: false });
  assert.deepEqual(parseRanks(null), [1, 1, 1]);
  assert.deepEqual(parseRanks("5"), [5, 5, 5]);
  assert.deepEqual(parseRanks("2,5,3"), [2, 5, 3]);
  assert.deepEqual(parseRanks("2,x"), [2, 1, 1]);
  assert.deepEqual(parseRanks("9,0,4,2"), [1, 1, 4]);
  assert.equal(formatRanks([1, 1, 1]), "");
  assert.equal(formatRanks([5, 5, 5]), "5");
  assert.equal(formatRanks([2, 5, 3]), "2,5,3");
  for (const t of ["", "4", "1,2,3", "3,3,1"]) assert.equal(formatRanks(parseRanks(t)), t);
});

test("Gekisou Live rates the room: every player at sqrt(5 / n) of the battle threshold", () => {
  assert.equal(roomThreshold(1000, 5), 1000);
  assert.equal(roomThreshold(1000, 1), 2236);                        // trunc(sqrt(5) * 1000)
  assert.equal(roomThreshold(1000, 2), 1581);                        // trunc(sqrt(2.5) * 2000) / 2 = 3162 / 2
  assert.equal(roomThreshold(0, 3), 0);
  const ranks = [{ rank: "D", requiredScore: 0, battleRequiredScore: 0 }, { rank: "SS", requiredScore: 800, battleRequiredScore: 1000 }];
  const a = { scoreId: 1, base: 4, chartMs: 100000, bgmMs: null, weights: [0.25, 0.25, 0.25, 0.25, 0], scoreRanks: ranks };
  assert.equal(rankThreshold(a, "SS"), 800);                          // solo: requiredScore
  assert.equal(rankThreshold(a, "SS", 5), 1000);
  assert.equal(rankThreshold(a, "SS", 1), 2236);
  assert.equal(rankThreshold(a, "D", 2), 0);
  assert.equal(rankThreshold({ scoreRanks: [{ rank: "SS", requiredScore: 800 }] }, "SS", 5), null);
  const x = [1, 1, 1, 1, 1];                                          // 4 + 1 per power
  near(requiredPower(a, x, "SS"), 160, "solo power");
  near(requiredPower(a, x, "SS", 1, 5), 200, "room of 5");
  near(requiredPower(a, x, "SS", 1, 1), 447.2, "room of 1");
  assert.equal(reachChance(a, x, 199, "SS", 1, 5), 0);
  assert.equal(reachChance(a, x, 200, "SS", 1, 5), 1);
  // solo compares requiredScore (equal here), a room battleRequiredScore (a lower on a)
  const b = { ...a, scoreId: 2, scoreRanks: [ranks[0], { rank: "SS", requiredScore: 800, battleRequiredScore: 1100 }] };
  for (const n of [0, 1, 3, 5]) assert.equal(eventDominates(a, b, "chart", X_MAX, n), n !== 0);
});

// ---------------------------------------------------------------- Gekisou ranges and skills

test("the rank measures per Gekisou range: the mission's measure, seed means and ranges", () => {
  assert.deepEqual(MEASURES, ["maxCombo", "justCount", "luckPoints"]);
  assert.deepEqual([1, 2, 3, 4].map((m) => MISSION_MEASURE[m]), ["maxCombo", "luckPoints", "justCount", undefined]);
  // deck3: two seeds; range 1 has Just counts, the luck points and max combos are missing (older data)
  const m = rangeMeasures(deck3());
  assert.deepEqual(m.map((x) => [x.index, x.mission, x.measure]), [[0, 1, "maxCombo"], [1, 3, "justCount"], [2, 2, "luckPoints"]]);
  assert.deepEqual(m[1].values.justCount, { mean: 40, min: 40, max: 40 });
  assert.equal(m[0].values.maxCombo, null);
  assert.equal(m[2].values.luckPoints, null);
  const d = deck3();
  d.seeds = d.seeds.map((s, k) => ({ ...s, ranges: s.ranges.map((x, i) => ({ ...x, maxCombo: 100 + i + k, luckPoints: i === 2 ? 50 + 10 * k : 0 })) }));
  const n = rangeMeasures(d);
  assert.deepEqual(n[0].values.maxCombo, { mean: 100.5, min: 100, max: 101 });
  assert.deepEqual(n[2].values.luckPoints, { mean: 55, min: 50, max: 60 });
  assert.deepEqual(n[0].values.luckPoints, { mean: 0, min: 0, max: 0 });
  // an unknown mission ranks by nothing; no seeds or unplayable: nothing
  assert.equal(rangeMeasures({ ...d, ranges: d.ranges.map((r) => ({ ...r, mission: 4 })) })[0].measure, null);
  assert.deepEqual(rangeMeasures(null), []);
  assert.deepEqual(rangeMeasures(deck3({ unplayable: "4 fevers", seeds: [] })), []);
  assert.ok(rangeMeasures(deck3({ seeds: [] })).every((x) => MEASURES.every((k) => x.values[k] === null)));
});

test("fields of other formats (the dropped best formation deck.gekisou) leave the figures alone", () => {
  const extra = { gekisou: { formation: [], objective: 1, evaluations: 1, seeds: deck3().seeds.map((s) => ({ ...s, score: s.score * 2 })) } };
  for (const sc of [null, { ranks: [2, 5, 3], just: 0.5, great: 0.25 }, { mode: "free" }]) {
    assert.deepEqual(chartFigures(deck3(extra), 1, 1000, sc), chartFigures(deck3(), 1, 1000, sc));
  }
  assert.deepEqual(scenarioData({ songs: [{ id: 1, charts: [{ scoreId: 1, deck: deck3(extra) }] }] }), { free: true, ranks: true, just: true, aptitude: false });
});

test("Gekisou skill names come from gekisouCatalog in the page language, with fallbacks", () => {
  const data = {
    gekisouCatalog: {
      skills: [{ id: 7, mission: 1, maxLevel: 5, name: { ja: "連撃", en: "Combo" } }, { id: 8, mission: 3, maxLevel: 5, name: null }],
      supportSkills: [{ id: 31, mission: 3, maxLevel: 5, name: { "zh-Hans": "JUST 得分" } }],
    },
  };
  assert.deepEqual(gekisouSkill(data, "skills", 7, "en"), { id: 7, name: "Combo", mission: 1, maxLevel: 5 });
  assert.equal(gekisouSkill(data, "skills", 7, "ko").name, "連撃");              // else Japanese
  assert.equal(gekisouSkill(data, "supportSkills", 31, "en").name, "JUST 得分");  // else any language
  assert.deepEqual(gekisouSkill(data, "skills", 8, "ja"), { id: 8, name: "#8", mission: 3, maxLevel: 5 });   // no name
  assert.deepEqual(gekisouSkill(data, "skills", 99, "ja"), { id: 99, name: "#99", mission: null, maxLevel: null });
  assert.deepEqual(gekisouSkill(data, "members", 7, "ja"), { id: 7, name: "#7", mission: null, maxLevel: null });
  assert.equal(gekisouSkill(songs, "skills", 7, "ja").name, "#7");                // older data: no catalog
  assert.equal(gekisouSkill(null, "skills", 7, "ja").name, "#7");
});

// ---------------------------------------------------------------- catalog.js

test("note kinds count the judged notes only", () => {
  const k = noteKinds({ 1: 300, 20: 80, 21: 2, 22: 80, 40: 60, 42: 20, 60: 5, 101: 1, 120: 200, 121: 40, 122: 50, 100: 3, 103: 3 });
  assert.deepEqual(k, { tap: 301, flick: 80, slide: 162, trace: 5, combo: 200 });
  assert.deepEqual(noteKinds(undefined), { tap: 0, flick: 0, slide: 0, trace: 0, combo: 0 });
});

test("density is judged notes per second of the played span", () => {
  assert.equal(density({ notes: { judged: 500 }, firstNoteMs: 5000, lastJudgedNoteMs: 105000 }), 5);
  assert.equal(density({ notes: { judged: 5 }, firstNoteMs: 100, lastJudgedNoteMs: 100 }), null);
});

test("chart rows join songs and their deck statistics", () => {
  const rows = chartRows(songs);
  assert.deepEqual(rows.map((r) => r.scoreId), [12, 13, 23, 22]);
  const [hard, expert, other, unplayable] = rows;
  assert.equal(hard.weights, null);                         // no deck statistics: no efficiency figures
  assert.equal(hard.base, null);
  assert.equal(hard.stats, null);
  assert.equal(unplayable.weights, null);
  assert.equal(unplayable.skip, null);
  assert.equal(unplayable.unplayable, "4 fevers");
  assert.deepEqual(expert.baseRange, [3.9, 4.1]);
  assert.deepEqual([hard.bpm, hard.bpmMin, hard.bpmMax], [180, 90, 180]);
  assert.deepEqual(expert.weights, [0.1, 0.3, 0.2, 0.25, 0.15]);
  assert.deepEqual(expert.stats.events[1], [1, 2000]);
  assert.equal(expert.bgmMs, 119990);
  assert.equal(other.bgmMs, null);
  assert.equal(chartRows({ ...songs, deck: null }).every((r) => r.weights === null), true);
  assert.equal(matches(expert, "one"), true);               // any language
  assert.equal(matches(expert, "二"), false);
  assert.equal(matches(other, "2"), true);                  // the music id
  assert.equal(matches(other, "  "), true);
});

test("moenotes links follow its locale prefixes", () => {
  assert.equal(moenotesUrl(100001, "zh-Hans"), "https://bdon.moe/music/100001");
  assert.equal(moenotesUrl(100001, "zh-Hant"), "https://bdon.moe/zh-tw/music/100001");
  assert.equal(moenotesUrl(100001, "ja"), "https://bdon.moe/ja/music/100001");
  assert.equal(moenotesUrl(100001, "ko", "https://mirror.example/moe"), "https://mirror.example/moe/ko/music/100001");
  assert.equal(moenotesUrl(100001, "xx"), "https://bdon.moe/music/100001");
});

test("sorting, ticks, extents and histograms", () => {
  const rows = [{ scoreId: 3, v: 2 }, { scoreId: 1, v: null }, { scoreId: 2, v: 2 }, { scoreId: 4, v: 5 }];
  assert.deepEqual(sortBy(rows, (r) => r.v).map((r) => r.scoreId), [4, 2, 3, 1]);
  assert.deepEqual(sortBy(rows, (r) => r.v, true).map((r) => r.scoreId), [2, 3, 4, 1]);
  assert.deepEqual(ticks(20.3, 31.8), [22.5, 25, 27.5, 30]);
  assert.deepEqual(ticks(0, 1, 4), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(ticks(5, 5), [5]);
  assert.deepEqual(extent([1, 3, NaN], 0), [1, 3]);
  assert.deepEqual(extent([2, 2], 0), [1, 3]);
  assert.equal(extent([]), null);
  const hist = histogram([{ difficulty: "hard", level: 20 }, { difficulty: "expert", level: 26 }, { difficulty: "expert", level: 26.5 }], (r) => r.level);
  assert.deepEqual(hist.map(([b, c]) => [b, c.hard, c.expert]), [[20, 1, 0], [26, 0, 2]]);
});

// Synthetic aptitude samples: score gain 36 at rank 1; tail 1 + range gain 10 × 3.5.
const aptitudeVariant = (extra = {}) => ({
  shape: 0, bandMatch: null, deterministic: false, seeds: 128, crossSeeds: 64, seTargetMet: false,
  score: [36, 2], scorePerfect: [19.5, 1], tail: [1, 0.1], tailPerfect: [2, 0.1], converted: [3, 0],
  ranges: [{ rangeScore: [10, 0.5], rankBonus: [25, 1.25], rangeScorePerfect: [5, 0.25], maxCombo: [0, 0], justCount: [4, 0], luckPoints: [0, 0] }],
  weights: [[0.1, 0.01], [0.2, 0.02]], rangeWeights: [[[0.04, 0.004]], [[0.08, 0.008]]],
  ...extra,
});
const aptitudeRanges = [{ mission: 3, rankBonusPercent: 250, rankBonusPercents: [250, 200, 150, 100, 50] }];

test("single-skill aptitude: baseline is unchanged, default gain, ranks, accuracy and cross terms", () => {
  const v = aptitudeVariant();
  const f = aptitudeFigures(v, aptitudeRanges, 1000);
  near(f.base, 0.036, "raw gain");
  near(aptitudeRate(f, [1, 1]), 0.336, "plain skills");
  near(aptitudeRate(f, [2, 0]), 0.336, "random skill order uses the mean");
  near(aptitudeSe(f, [0, 0]), 0.002, "score-only SE");
  assert.equal(aptitudeSe(f, [1, 1]), null); // no covariance for the combined estimate
  assert.equal(f.seTargetMet, false);
  const r = aptitudeFigures(v, aptitudeRanges, 1000, { ranks: [5] });
  near(r.base, 0.016, "tail + delta range times rank factor");
  nearAll(r.weights, [0.02, 0.04], "rank cross terms");
  assert.equal(aptitudeSe(r, [0, 0]), null); // no SE after rank changes
  assert.equal(r.crossAtRank1, false);
  const j = aptitudeFigures(v, aptitudeRanges, 1000, { just: 0.5 });
  near(j.base, 0.02775, "Just/Perfect delta interpolation");
  assert.equal(j.weights, null);
  assert.equal(j.missingPerfectCross, true);
  assert.equal(aptitudeRate(j, [1, 1]), null);
  near(aptitudeRate(j, [0, 0]), 0.02775, "base-only interpolation remains available");
  assert.equal(aptitudeSe(j, [0, 0]), null);
  const both = aptitudeFigures(v, aptitudeRanges, 1000, { ranks: [5], just: 0.5, great: 0.5 });
  near(both.base, (1.5 + 7.5 * 1.5) * 0.9 / 1000, "tail and ranges interpolate then Great scale");
  assert.equal(both.weights, null);
  const great = aptitudeFigures(v, aptitudeRanges, 1000, { great: 0.5 });
  nearAll(great.weights, [0.09, 0.18], "Great scales measured Just cross terms");
  assert.equal(aptitudeSe(great, [0, 0]), null);
  const d = deck3({ gekisouAptitude: { variants: [v], factors: [] } });
  assert.deepEqual(chartFigures(d, 1, 1000), chartFigures(deck3(), 1, 1000));
  assert.equal(aptitudeFigures(v, aptitudeRanges, 1000, { mode: "free" }), null);
  assert.deepEqual(chartFigures(d, 1, 1000, { mode: "free" }), chartFigures(deck3(), 1, 1000, { mode: "free" }));
});

test("aptitude missing fields never silently become a measured ordinary-skill gain", () => {
  assert.equal(aptitudeFigures(null, []), null);
  assert.equal(aptitudeFigures(aptitudeVariant({ score: null }), aptitudeRanges), null);
  assert.equal(aptitudeFigures(aptitudeVariant({ scorePerfect: null }), aptitudeRanges, 1000, { just: 0 }), null);
  assert.equal(aptitudeFigures(aptitudeVariant(), [], 1000, { ranks: [5] }), null);
  const v = aptitudeVariant({ weights: null, rangeWeights: null });
  const f = aptitudeFigures(v, aptitudeRanges, 1000);
  near(aptitudeRate(f, [0, 0]), 0.036, "base without a plain kind");
  assert.equal(aptitudeRate(f, [1, 0]), null);
  assert.equal(aptitudeSe(f, [1, 0]), null);
  const noRange = aptitudeFigures(aptitudeVariant({ rangeWeights: null }), aptitudeRanges, 1000, { ranks: [5] });
  assert.equal(noRange.crossAtRank1, true);
  nearAll(noRange.weights, [0.1, 0.2], "fallback retains rank-1 cross terms");
  assert.deepEqual(chartVariants(null), []);
  assert.deepEqual(chartVariants(deck3()), []);
  assert.deepEqual(chartVariants(deck3({ unplayable: "4 fevers", gekisouAptitude: { variants: [v] } })), []);
});

test("aptitude shape names, band variants, zero effects and availability", () => {
  const shape = { id: 0, source: "support", bandCondition: true, mission: 3, skills: [
    { id: 1, level: 5, bandIds: [2] }, { id: 1, level: 4, bandIds: [2] }, { id: 9, level: 5, bandIds: [3] },
  ] };
  const data = { deck: { gekisouAptitude: { shapes: [shape] } }, bands: [{ id: 2, name: { en: "Band" } }],
    gekisouCatalog: { supportSkills: [{ id: 1, mission: 3, maxLevel: 5, name: { ja: "支援", en: "Support" } }] },
    songs: [{ charts: [{ deck: deck3({ gekisouAptitude: { variants: [aptitudeVariant({ bandMatch: true }), aptitudeVariant({ bandMatch: false })] } }) }] }],
  };
  assert.equal(aptitudeShapes(data).get(0), shape);
  assert.equal(aptitudeShapes(null).size, 0);
  assert.equal(scenarioData(data).aptitude, true);
  assert.equal(scenarioData(songs).aptitude, false);
  assert.deepEqual(shapeSkills(data, shape, "en").map((s) => [s.name, s.level]), [["Support", 5], ["Support", 4], ["#9", 5]]);
  assert.equal(shapeSkills(data, shape, "ko")[0].name, "支援");
  assert.deepEqual(shapeBands(data, shape, "ja"), ["Band", "#3"]);
  assert.deepEqual(shapeSkills(null, null, "en"), []);
  assert.equal(zeroGain(aptitudeVariant()), null);
  assert.equal(zeroGain(aptitudeVariant({ score: [0, 0], weights: [[0, 0]], converted: [0, 0] })), "measures");
  assert.equal(zeroGain(aptitudeVariant({ score: [0, 0], weights: null, converted: [0, 0], ranges: [] })), "none");
});

test("master skill factor uses float32 before truncation, unlike user percentages", () => {
  assert.equal(masterSkillFactor(0), 0);
  assert.equal(masterSkillFactor(1000), 0.1);
  assert.equal(masterSkillFactor(10000), 1);
  assert.equal(masterSkillFactor(13000), 1.29999);
  assert.equal(masterSkillFactor(15000), 1.5);
  assert.equal(meanSkill([130 / 100], 1), 1.3); // UI percent conversion must not use masterSkillFactor
});
