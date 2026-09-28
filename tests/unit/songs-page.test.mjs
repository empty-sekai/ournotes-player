import test from "node:test";
import assert from "node:assert/strict";

import {
  dominance, dominates, formatLength, joinCharts, lengthMs, perMinute, pickText, rank, scoreRate, sortedSkills,
} from "../../examples/songs/ranking.js";
import {
  chartRows, density, extent, histogram, matches, moenotesUrl, noteKinds, sortBy, ticks,
} from "../../examples/songs/catalog.js";

const songs = {
  songs: [
    { id: 1, title: { ja: "一", en: "One" }, bandIds: [1], bandName: null, musicType: 1,
      bgm: { length: { lengthMs: 120000, durationMs: 119990 } },
      charts: [{ difficulty: "hard", scoreId: 12, level: 20, displayLevel: 20, notes: { judged: 500 },
                 bpm: { main: 180, min: 90, max: 180 }, musicLengthMs: 110000 },
               { difficulty: "expert", scoreId: 13, level: 26, displayLevel: 26.5, notes: { judged: 800 },
                 bpm: { main: 180, min: 180, max: 180 }, musicLengthMs: 111000 }] },
    { id: 2, title: { ja: "二" }, bandIds: [2], bgm: null,
      charts: [{ difficulty: "expert", scoreId: 23, level: 25, notes: { judged: 700 }, musicLengthMs: 90000 }] },
  ],
};
const stats = {
  charts: [
    { scoreId: 13, musicLengthMs: 111000, base: 4, skip: 3, durationsMs: [5000, 10000],
      positions: [[0.1, 0.3, 0.2, 0.25, 0.15], [0.2, 0.6, 0.4, 0.5, 0.3]] },
    { scoreId: 23, musicLengthMs: 90000, base: 3.8, skip: 3, durationsMs: [5000], positions: [[0.2, 0.2, 0.2, 0.2, 0.2]] },
    { scoreId: 99, musicLengthMs: 1, base: 1, skip: 1, durationsMs: [5000], positions: [[1]] },
  ],
};

test("joinCharts joins by score id and sorts the position weights", () => {
  const rows = joinCharts(songs, stats);
  assert.deepEqual(rows.map((r) => r.scoreId), [13, 23]);
  const [a, b] = rows;
  assert.deepEqual(a.weights, [0.3, 0.25, 0.2, 0.15, 0.1]);
  assert.equal(a.bgmMs, 119990);
  assert.equal(a.chartMs, 111000);
  assert.equal(a.displayLevel, 26.5);
  assert.equal(a.notes, 800);
  assert.deepEqual(a.bpmRange, [180, 180]);
  assert.equal(b.bgmMs, null);
  assert.equal(b.displayLevel, 25);
  assert.deepEqual(joinCharts(songs, stats, 10000)[0].weights, [0.6, 0.5, 0.4, 0.3, 0.2]);
});

test("lengths, texts and formatting", () => {
  const [a, b] = joinCharts(songs, stats);
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

test("the score rate puts the strongest skill on the heaviest position", () => {
  const [a] = joinCharts(songs, stats);
  assert.deepEqual(sortedSkills([1, 1.4, "0.5", -1, NaN]), [1.4, 1, 0.5]);
  const x = [0.5, 1.4, 1, 0, 0.8];
  const best = 4 + 1.4 * 0.3 + 1 * 0.25 + 0.8 * 0.2 + 0.5 * 0.15;
  assert.ok(Math.abs(scoreRate(a, x) - best) < 1e-12);
  assert.ok(Math.abs(perMinute(a, x, "chart", 30000) - best / (141000 / 60000)) < 1e-12);
  assert.equal(scoreRate(a, []), 4);
});

// a deterministic generator
const rng = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const randomRow = (r, i) => ({
  scoreId: i, base: 3.7 + r() * 0.6, chartMs: 80000 + Math.floor(r() * 60000), bgmMs: null,
  weights: Array.from({ length: 5 }, () => r() * 0.4).sort((p, q) => q - p),
});

const gap = (a, b, x, c) => scoreRate(a, x) / (a.chartMs + c) - scoreRate(b, x) / (b.chartMs + c);

test("dominance holds for every skill value and overhead, and fails at an extreme case when it does not", () => {
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
        for (let k = 0; k < 50; k++) {
          const x = Array.from({ length: 5 }, () => r() * 3);
          const c = [0, r() * 120000, 1e9][k % 3];
          assert.ok(gap(a, b, x, c) >= -1e-12, `${a.scoreId} > ${b.scoreId} fails at ${x} ${c}`);
        }
      } else {
        // extreme rays: x = M * (1..1, 0..0) for k = 0..5, c = 0 or huge
        let violated = false;
        let strict = false;
        for (let k = 0; k <= 5; k++) {
          for (const M of [0, 1, 1e6]) {
            const x = Array.from({ length: 5 }, (_, i) => (i < k ? M : 0));
            for (const c of [0, 1e12]) {
              const g = gap(a, b, x, c) * (c ? c : 1);
              if (g < -1e-9) violated = true;
              if (g > 1e-9) strict = true;
            }
          }
        }
        assert.ok(violated || !strict, `${a.scoreId} vs ${b.scoreId}: no counterexample`);
      }
    }
  }
  assert.ok(dominated >= 5);
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

test("chart rows join songs and chart stats", () => {
  const rows = chartRows(songs, stats);
  assert.deepEqual(rows.map((r) => r.scoreId), [12, 13, 23]);
  const [hard, expert, other] = rows;
  assert.equal(hard.weights, null);                         // no chart stats: no efficiency figures
  assert.equal(hard.base, null);
  assert.deepEqual([hard.bpm, hard.bpmMin, hard.bpmMax], [180, 90, 180]);
  assert.deepEqual(expert.weights, [0.3, 0.25, 0.2, 0.15, 0.1]);
  assert.equal(expert.stats.scoreId, 13);
  assert.equal(expert.bgmMs, 119990);
  assert.equal(other.bgmMs, null);
  assert.equal(chartRows(songs, null).every((r) => r.weights === null), true);
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
