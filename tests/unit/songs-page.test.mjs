import test from "node:test";
import assert from "node:assert/strict";

import {
  X_MAX, chartFigures, dominance, dominates, eventDominates, formatLength, joinCharts, lengthMs, meanSkill, orderRates,
  perMinute, pickText, plainKind, quantile, rank, rankThreshold, reachChance, requiredPower, scoreRate, weightSum,
} from "../../examples/songs/ranking.js";
import {
  chartRows, density, extent, histogram, matches, moenotesUrl, noteKinds, sortBy, ticks,
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
