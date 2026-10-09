import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aptitudeFigures, aptitudeRadius, aptitudeRate, aptitudeSe, chartFigures, modelPower,
  plainKind, rangeMeasures, scenarioData,
} from "../../examples/songs/ranking.js";
import { hasNominalExpectation, isEstimate, scenarioExpectation } from "../../examples/songs/expectation.js";
import { chartRows, refigure } from "../../examples/songs/catalog.js";
import { GUIDE, UI } from "../../examples/songs/text.js";

// Unmodified exported rows for the mixed Just/Luck/Combo chart 10007600 and two aptitude variants.
// Source: native chart-stats/3 at bca2fdde8cf45f440243d1c408889135bc538c23, master version in the fixture.
// This fixture preserves the real nested estimate format; the arithmetic edge cases below are deliberately synthetic.
const native = JSON.parse(readFileSync(new URL("../fixtures/chart-stats-v3.json", import.meta.url), "utf8"));
const nativeChart = native.charts[0];
const { charts: _, ...header } = native;
const nativeData = {
  format: "nnnotes.music-data/2", deck: header,
  songs: [{ id: nativeChart.musicId, charts: [{ ...nativeChart, deck: nativeChart }] }],
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11, `${actual} != ${expected}`);
const range = { mission: 2, rankBonusPercent: 250, rankBonusPercents: [250, 190, 160, 100, 50] };
const ranges = [range, { ...range, mission: 3 }];
const estimate = {
  score: [100.75, 0.125], scorePerfect: [80.5, 0.25],
  ranges: [
    { rangeScore: [20.25, 0.01], rangeScorePerfect: [15.25, 0.01], rankBonus: [49.6, 0.01],
      rankBonusPerfect: [37.3, 0.01], maxCombo: 8, justCount: 0, luckPoints: [3.25, 0.125] },
    { rangeScore: [11.875, 0.01], rangeScorePerfect: [6.125, 0.01], rankBonus: [29.2, 0.01],
      rankBonusPerfect: [14.2, 0.01], maxCombo: 9, justCount: 4, luckPoints: [0, 0] },
  ],
  weights: [[[0.5, 1e-10], [0.25, 1e-10]]],
  rangeWeights: [[[[0.1, 1e-10], [0.05, 1e-10]], [[0.05, 1e-10], [0.025, 1e-10]]]],
};
const deck = {
  positions: 2, skip: 0.1, ranges, expectation: estimate, replaySeeds: [11, 22],
  offSeeds: [{ seed: 0, score: 70, weights: [[0.4, 0.2]] }],
};
const sample = { seed: 9, score: 999, scorePerfect: 888, weights: [[9, 9]],
  rangeWeights: [[[9, 9], [9, 9]]], ranges: [{ luckPoints: 999 }, { luckPoints: 999 }] };

test("a real chart-stats/3 export feeds the catalog and scenario availability", () => {
  assert.equal(native.format, "ournotes-deck.chart-stats/3");
  assert.deepEqual(nativeChart.missions, [3, 2, 1]);
  const kind = plainKind(nativeData), power = modelPower(nativeData);
  assert.equal(kind, 0);
  const f = chartFigures(nativeChart, kind, power);
  assert.equal(f.base, nativeChart.expectation.score[0] / power);
  assert.deepEqual(f.weights, nativeChart.expectation.weights[kind].map(([center]) => center));
  assert.equal(f.nominal, true);
  assert.equal(f.seeds, 0);
  assert.deepEqual(f.baseRange, nativeChart.expectation.score.map((_, i) =>
    (nativeChart.expectation.score[0] + (i ? 1 : -1) * nativeChart.expectation.score[1]) / power));
  assert.deepEqual(scenarioData(nativeData), { free: true, ranks: true, just: true, aptitude: true });
  const rows = chartRows(nativeData);
  assert.equal(rows[0].base, f.base);
  assert.equal(rows[0].nominal, true);
  refigure(rows, nativeData, { ranks: [2, 1, 1] });
  assert.equal(rows[0].baseRange, null, "a transformed value has no raw numerical enclosure");
  refigure(rows, nativeData, { mode: "free" });
  assert.equal(rows[0].nominal, false, "scenario changes clear nominal figure metadata");
  assert.equal(rows[0].base, nativeChart.offSeeds[0].score / power);
});

test("real replay seeds and stale legacy seed rows never alter nominal expectations", () => {
  const f = chartFigures(nativeChart, 0);
  const measures = rangeMeasures(nativeChart);
  for (const replaySeeds of [[], [0], [42, -1, 99, 12345]]) {
    const changed = { ...nativeChart, replaySeeds, seeds: [sample] };
    assert.deepEqual(chartFigures(changed, 0), f);
    assert.deepEqual(rangeMeasures(changed), measures);
  }
  const lucky = nativeChart.expectation.ranges[1].luckPoints;
  assert.deepEqual(measures[1].values.luckPoints,
    { mean: lucky[0], min: lucky[0] - lucky[1], max: lucky[0] + lucky[1] });
  assert.ok(nativeChart.replaySeeds.every(Number.isInteger));
});

test("nominal rank 1 retains the exported bonus and its original enclosure", () => {
  const f = chartFigures(deck, 0, 10);
  assert.equal(f.base, 10.075);
  assert.deepEqual(f.baseRange, [10.0625, 10.0875]);
  assert.deepEqual(f.weights, [0.5, 0.25]);
  assert.equal(scenarioExpectation(estimate, ranges, 0, null).score, 100.75);
  assert.notEqual(estimate.ranges[0].rankBonus[0], Math.trunc(estimate.ranges[0].rangeScore[0] * 2.5));
});

test("nominal rank substitution uses the real product, preserving untouched rank-1 bonuses", () => {
  const f = scenarioExpectation(estimate, ranges, 0, { ranks: [1, 2] });
  near(f.score, 100.75 - 29.2 + 11.875 * 1.9);
  assert.notEqual(f.score, 100.75 - 29.2 + Math.trunc(11.875 * 1.9));
  near(f.weights[0], 0.5 + (1.9 - 2.5) * 0.05);
  near(f.weights[1], 0.25 + (1.9 - 2.5) * 0.025);
  assert.equal(f.scoreBounds, null);
});

test("Perfect and partial Just retain the measured rank-1 endpoint bonuses", () => {
  assert.equal(scenarioExpectation(estimate, ranges, 0, { just: 0 }).score, 80.5);
  assert.equal(scenarioExpectation(estimate, ranges, 0, { just: 0.5 }).score, 90.625);
  near(scenarioExpectation(estimate, ranges, 0, { ranks: [1, 2], just: 0 }).score,
    80.5 - 14.2 + 6.125 * 1.9);
  near(scenarioExpectation(estimate, ranges, 0, { ranks: [1, 2], just: 0.5 }).score,
    90.625 - (29.2 + 14.2) / 2 + (11.875 + 6.125) / 2 * 1.9);
  const great = scenarioExpectation(estimate, ranges, 0, { great: 0.5 });
  near(great.score, 100.75 * 0.9);
  assert.equal(great.scoreBounds, null);
  assert.equal(chartFigures(deck, 0, 10, { mode: "free" }).base, 7);
  const unplayable = { ...deck, unplayable: "four ranges", expectation: null };
  assert.equal(chartFigures(unplayable, 0), null);
  assert.equal(chartFigures(unplayable, 0, 10, { mode: "free" }).base, 7);
});

test("nominal range measures use numerical enclosures or exact counters", () => {
  assert.deepEqual(rangeMeasures(deck)[0].values, {
    maxCombo: { mean: 8, min: 8, max: 8 }, justCount: { mean: 0, min: 0, max: 0 },
    luckPoints: { mean: 3.25, min: 3.125, max: 3.375 },
  });
  const missing = { ...deck, expectation: null, seeds: [sample] };
  assert.ok(rangeMeasures(missing).every((r) => Object.values(r.values).every((v) => v === null)));
});

test("missing, malformed or incomplete nominal statistics never fall back to legacy seeds", () => {
  const stale = { ...deck, expectation: null, seeds: [sample] };
  const { expectation: _, ...missing } = stale;
  assert.equal(hasNominalExpectation(missing), true);
  assert.equal(chartFigures(stale, 0), null);
  assert.equal(chartFigures(missing, 0), null);
  for (const score of [[100, -1], [NaN, 0], [100, Infinity], [100], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
    assert.equal(isEstimate(score), false);
    assert.equal(chartFigures({ ...stale, expectation: { ...estimate, score } }, 0), null);
  }
  for (const bad of [
    { ...estimate, ranges: undefined }, { ...estimate, ranges: [] },
    { ...estimate, weights: [[0.5, 0.25]] }, { ...estimate, weights: [[[0.5, -1], [0.25, 0]]] },
  ]) assert.equal(chartFigures({ ...stale, expectation: bad }, 0), null);
  for (const bad of [
    { ...estimate, rangeWeights: null }, { ...estimate, rangeWeights: [[]] },
    { ...estimate, rangeWeights: [[[[0.1, 0]], [[0.05, 0]]]] },
    { ...estimate, ranges: [null, estimate.ranges[1]] },
  ]) assert.equal(chartFigures({ ...stale, expectation: bad }, 0, 10, { ranks: [2, 1] }), null);
  assert.equal(chartFigures({ ...deck, positions: 3 }, 0), null);
  assert.equal(chartFigures({ ...deck, ranges: [null, range] }, 0), null);
  for (const power of [0, -1, NaN, Infinity, Number.MIN_VALUE]) assert.equal(chartFigures(deck, 0, power), null);
  const d = { ...nativeData, songs: [{ charts: [{ deck: { ...stale,
    gekisouAptitude: nativeChart.gekisouAptitude } }] }] };
  assert.deepEqual(scenarioData(d), { free: true, ranks: false, just: false, aptitude: false });
});

const variant = {
  shape: 0, score: [100, 0.125], scorePerfect: [80, 0.25],
  ranges: [0, 1].map(() => ({ rangeScore: [10.25, 0.01], rangeScorePerfect: [8.25, 0.01],
    rankBonus: [24.8, 0.01], rankBonusPerfect: [19.8, 0.01] })),
  weights: [[0.1, 0.001]], rangeWeights: [[[0.01, 0.0001], [0.02, 0.0001]]],
};

test("real aptitude radius remains a numerical radius, never a sampling SE", () => {
  const v = nativeChart.gekisouAptitude.variants.find((v) => v.shape === 7);
  assert.deepEqual(v.score, [2387.757, 0.451]);
  const f = aptitudeFigures(v, nativeChart.ranges, 300000, null, true);
  assert.equal(f.base, v.score[0] / 300000);
  assert.equal(f.baseSe, null);
  assert.equal(f.baseRadius, v.score[1] / 300000);
  assert.equal(aptitudeRadius(f, [0, 0, 0, 0, 0]), 0.451 / 300000);
  assert.equal(aptitudeSe(f, [0, 0, 0, 0, 0]), null);
  assert.equal(aptitudeRadius(f, [1, 0, 0, 0, 0]), null);
  assert.equal(f.seeds, null);
});

test("nominal aptitude replaces changed ranks only and does not truncate the mean", () => {
  const f = aptitudeFigures(variant, ranges, 10, { ranks: [1, 2] }, true);
  near(f.base, (100 + 10.25 * 1.9 - 24.8) / 10);
  near(f.weights[0], 0.1 + (1.9 - 2.5) * 0.02);
  assert.equal(f.baseRadius, null);
  assert.equal(aptitudeRadius(f, [0]), null);
  assert.equal(aptitudeSe(f, [0]), null);
  const just = aptitudeFigures(variant, ranges, 10, { ranks: [1, 2], just: 0.5 }, true);
  near(just.base, (90 + 9.25 * 1.9 - 22.3) / 10);
  assert.equal(just.missingPerfectCross, true);
  assert.equal(aptitudeRate(just, [1]), null);
  assert.equal(aptitudeRadius(just, [0]), null);
  const raw = aptitudeFigures(variant, ranges, 10, null, true);
  assert.equal(aptitudeRadius(raw, [0]), 0.0125);
  assert.equal(aptitudeFigures(variant, ranges, 10, { just: 0.5 }, true).base, 9);
  assert.equal(aptitudeFigures(variant, ranges, 10, { great: 0.5 }, true).baseRadius, null);
});

test("nominal aptitude rejects unsupported ranks and malformed response dimensions", () => {
  const nonlinear = { ...variant, rangeWeights: null };
  assert.ok(aptitudeFigures(nonlinear, ranges, 10, null, true), "rank 1 does not require a linear range response");
  assert.equal(aptitudeFigures(nonlinear, ranges, 10, { ranks: [1, 2] }, true), null);
  assert.equal(aptitudeFigures({ ...nonlinear, weights: null }, ranges, 10, { ranks: [1, 2] }, true), null);
  for (const bad of [
    { ...variant, score: [100, -1] }, { ...variant, ranges: [] },
    { ...variant, weights: [[0.1, -1]] }, { ...variant, rangeWeights: [] },
    { ...variant, rangeWeights: [[[0.01, 0]]] },
  ]) assert.equal(aptitudeFigures(bad, ranges, 10, null, true), null);
  const badBonus = { ...variant, ranges: [variant.ranges[0], { ...variant.ranges[1], rankBonus: null }] };
  assert.equal(aptitudeFigures(badBonus, ranges, 10, { ranks: [1, 2] }, true), null);
  assert.equal(aptitudeFigures(variant, ranges, 0, null, true), null);
  assert.equal(aptitudeFigures(variant, ranges, 10, { mode: "free" }, true), null);
});

test("Chinese and English distinguish nominal intervals, legacy SE and replay samples", () => {
  for (const lang of ["zh", "en"]) {
    const A = UI[lang].aptitude, D = UI[lang].detail;
    for (const key of ["method", "nominal", "interval", "intervalNote", "missingRank", "nominalFactorNote"])
      assert.ok(A[key]?.length, `${lang}.aptitude.${key}`);
    for (const key of ["nominal", "interval", "nominalWeightsHint", "nominalMeasuresHint"])
      assert.ok(D[key]?.length, `${lang}.detail.${key}`);
    const guide = JSON.stringify(GUIDE[lang]);
    for (const term of ["chart-stats/3", "music-data/1", "replaySeeds"]) assert.ok(guide.includes(term), `${lang}: ${term}`);
  }
  assert.match(UI.en.aptitude.intervalNote, /not a standard error/);
  assert.match(UI.zh.aptitude.intervalNote, /不是标准误/);
});
