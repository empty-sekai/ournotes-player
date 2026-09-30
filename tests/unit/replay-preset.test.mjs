import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyAccuracyPreset, applySegmentPreset, parseJustJudgementTypes } from "../../examples/songs/replay-preset.js";

function fixture() {
  const notes = Array.from({ length: 8 }, (_, i) => ({ noteId: 20 - i, noteMs: i * 10,
    judgementType: i === 2 ? 2 : 1, defaultJudgement: 5 }));
  notes.push({ noteId: 99, noteMs: 20, judgementType: 1, defaultJudgement: 7 });
  const description = { notes, fevers: [[10, 50]], missions: [3] };
  const request = { format: "ournotes.replay/1", mode: { kind: "soloGekisou" }, seed: 4,
    frames: Array.from({ length: 8 }, (_, i) => ({ timeMs: i * 10, deltaSeconds: .01, judgements: [
      { noteId: notes[i].noteId, judgement: 5, judgementTimeMs: i * 10, rawResult: null },
      ...(i === 2 ? [{ noteId: 99, judgement: 7, judgementTimeMs: 20 }] : []),
    ] })) };
  return { request, description };
}
const grades = request => request.frames.flatMap(frame => frame.judgements.map(j => j.judgement));
const segment = (changes = {}) => ({ startMs: null, endMs: null, great: 0, good: 0, bad: 0, miss: 0, just: 0, ...changes });

test("segment endpoints are half-open chart times and later overlapping segments win", () => {
  const { request, description } = fixture();
  request.mode = { kind: "normal" };
  for (const frame of request.frames) frame.timeMs += 1000;
  const counts = applySegmentPreset(request, description, [1], [segment({ miss: 1 }),
    segment({ startMs: 10, endMs: 30, great: 1 }), segment({ startMs: 20, endMs: 40, good: 1 }),
    segment({ startMs: 30, endMs: 40, bad: 1 })], 0);
  assert.deepEqual(grades(request), [1, 4, 3, 7, 2, 1, 1, 1, 1]);
  assert.deepEqual(counts, { great: 1, good: 1, bad: 1, miss: 5, just: 0, perfect: 0, total: 8 });
});

test("segment probabilities 0 and 100 cover every grade and eligible Just only", () => {
  for (const [name, grade] of [["great", 4], ["good", 3], ["bad", 2], ["miss", 1]]) {
    const { request, description } = fixture();
    const counts = applySegmentPreset(request, description, [1], [segment({ [name]: 1, just: 1 })], 0xffffffff);
    assert.equal(counts[name], 8);
    assert.equal(counts.just, 0);
    assert.deepEqual(grades(request).filter(g => g !== 7), Array(8).fill(grade));
  }
  const { request, description } = fixture();
  assert.deepEqual(applySegmentPreset(request, description, [1], [segment({ just: 1 })], 0),
    { great: 0, good: 0, bad: 0, miss: 0, just: 3, perfect: 5, total: 8 });
  request.mode = { kind: "normal" };
  assert.equal(applySegmentPreset(request, description, [1], [segment({ just: 1 })], 0).perfect, 8);
});

test("LCG32 plan seeds reproduce inputs independently of the game seed and preserve the stream", () => {
  const { request, description } = fixture();
  const original = structuredClone(request), copy = structuredClone(request), other = structuredClone(request);
  const rules = [segment({ great: .25, good: .25, bad: .25, miss: .25 })];
  const counts = applySegmentPreset(request, description, [1], rules, 123);
  assert.deepEqual(applySegmentPreset(copy, description, [1], rules, 123), counts);
  assert.deepEqual(copy, request);
  applySegmentPreset(other, description, [1], rules, 124);
  assert.notDeepEqual(grades(other), grades(request));
  assert.equal(request.seed, original.seed);
  for (let f = 0; f < request.frames.length; f++) {
    const current = request.frames[f], before = original.frames[f];
    assert.deepEqual({ ...current, judgements: before.judgements }, before);
    current.judgements.forEach((j, k) => {
      assert.deepEqual({ ...j, judgement: before.judgements[k].judgement }, before.judgements[k]);
      if (before.judgements[k].judgement === 7) assert.deepEqual(j, before.judgements[k]);
    });
  }
});

test("segment raw imports, invalid fractions/ranges/IDs and invalid seeds reject before any input write", () => {
  for (const variant of ["raw", "runtime", "probability", "default", "range", "id", "negativeSeed", "largeSeed", "fractionSeed"]) {
    const { request, description } = fixture();
    let rules = [segment()], seed = 0;
    if (variant === "raw") request.frames.at(-1).judgements[0].rawResult = {};
    if (variant === "runtime") request.rawRuntime = {};
    if (variant === "probability") rules = [segment({ great: .6, miss: .5 })];
    if (variant === "default") rules = [segment({ startMs: 0 })];
    if (variant === "range") rules.push(segment({ startMs: 20, endMs: 20 }));
    if (variant === "id") request.frames.at(-1).judgements[0].noteId = -1;
    if (variant === "negativeSeed") seed = -1;
    if (variant === "largeSeed") seed = 0x100000000;
    if (variant === "fractionSeed") seed = 1.5;
    const before = structuredClone(request);
    assert.throws(() => applySegmentPreset(request, description, [1], rules, seed));
    assert.deepEqual(request, before);
  }
});

test("Just types follow actual columns, deduplicate and accept parsed or JSON data", () => {
  const data = { format: "nnnotes.deck-data/1", master: { MasterLiveJudgementTiming: {
    columns: ["_afterMs", "_noteSimulateJudgement", "_noteJudgementType"], rows: [[20, 6, 1], [30, 5, 2], [5, 6, 1], [9, 6, 3]],
  } } };
  assert.deepEqual(parseJustJudgementTypes(data), [1, 3]);
  assert.deepEqual(parseJustJudgementTypes(JSON.stringify(data)), [1, 3]);
  assert.throws(() => parseJustJudgementTypes({ ...data, format: "other" }));
  assert.throws(() => parseJustJudgementTypes({ format: data.format, master: {} }));
});

test("0 and 100 percent have exact counts; Normal never presets Just", () => {
  const { request, description } = fixture();
  assert.deepEqual(applyAccuracyPreset(request, description, [1], 0, 0),
    { great: 0, just: 0, perfect: 8, total: 8, justEligible: 3 });
  assert.deepEqual(applyAccuracyPreset(request, description, [1], 0, 1),
    { great: 0, just: 3, perfect: 5, total: 8, justEligible: 3 });
  assert.deepEqual(grades(request), [5, 6, 5, 7, 6, 6, 5, 5, 5]);
  assert.deepEqual(applyAccuracyPreset(request, description, [1], 1, 1),
    { great: 8, just: 0, perfect: 0, total: 8, justEligible: 0 });
  request.mode = { kind: "normal" };
  assert.deepEqual(applyAccuracyPreset(request, description, [1], 0, 1),
    { great: 0, just: 0, perfect: 8, total: 8, justEligible: 0 });
});

test("Great is uniformly counted first, then Just on remaining eligible inputs", () => {
  const { request, description } = fixture();
  const counts = applyAccuracyPreset(request, description, new Set([1]), .25, .5);
  assert.deepEqual(counts, { great: 2, just: 1, perfect: 5, total: 8, justEligible: 2 });
  assert.deepEqual(grades(request), [5, 5, 5, 7, 4, 6, 5, 5, 4]);
  const copied = structuredClone(request);
  assert.deepEqual(applyAccuracyPreset(copied, description, [1], .25, .5), counts);
  assert.deepEqual(copied, request);
});

test("the activation frame is eligible even for equal fever start/end, and late frames stop it", () => {
  const { request, description } = fixture();
  description.fevers = [[15, 15]];
  const counts = applyAccuracyPreset(request, description, [1, 2], 0, 1);
  assert.equal(counts.just, 1);
  assert.deepEqual(grades(request), [5, 5, 6, 7, 5, 5, 5, 5, 5]);
  description.missions = [1];
  assert.equal(applyAccuracyPreset(request, description, [1, 2], 0, 1).just, 0);
});

test("a sparse clock can activate multiple ranges in one frame, each stopping on its next frame", () => {
  // FeverUpdater and JustRule advance each range independently, not one global range per frame.
  const description = { notes: [1, 2, 3].map(noteId => ({ noteId, judgementType: 1, defaultJudgement: 5 })),
    fevers: [[10, 20], [40, 60]], missions: [3, 3] };
  const request = { format: "ournotes.replay/1", mode: { kind: "soloGekisou" }, frames: [
    { timeMs: 0, judgements: [] },
    { timeMs: 100, judgements: [{ noteId: 1, judgement: 5 }, { noteId: 2, judgement: 5 }] },
    { timeMs: 200, judgements: [{ noteId: 3, judgement: 5 }] },
  ] };
  assert.deepEqual(applyAccuracyPreset(request, description, [1], 0, 1),
    { great: 0, just: 2, perfect: 1, total: 3, justEligible: 2 });
  assert.deepEqual(grades(request), [6, 6, 5]);
});

test("frame times, result order, Pass, seed and other request fields are preserved", () => {
  const { request, description } = fixture();
  const original = structuredClone(request);
  const frames = request.frames, judgements = frames.map(frame => frame.judgements);
  applyAccuracyPreset(request, description, [1], .5, 1);
  assert.equal(request.frames, frames);
  for (let f = 0; f < frames.length; f++) {
    assert.equal(frames[f].judgements, judgements[f]);
    for (let j = 0; j < judgements[f].length; j++) {
      const current = judgements[f][j], before = original.frames[f].judgements[j];
      assert.deepEqual({ ...current, judgement: before.judgement }, before);
      if (before.judgement === 7) assert.deepEqual(current, before);
    }
    assert.deepEqual({ ...frames[f], judgements: original.frames[f].judgements }, original.frames[f]);
  }
  assert.equal(request.seed, original.seed);
});

test("raw imports and invalid plans fail atomically, including a raw result late in the stream", () => {
  for (const variant of ["rawResult", "rawRuntime", "unknown", "fraction"]) {
    const { request, description } = fixture();
    if (variant === "rawResult") request.frames.at(-1).judgements[0].rawResult = { origin: 5, diffMs: 0 };
    if (variant === "rawRuntime") request.rawRuntime = {};
    if (variant === "unknown") request.frames.at(-1).judgements[0].noteId = -1;
    const before = structuredClone(request);
    assert.throws(() => applyAccuracyPreset(request, description, [1], variant === "fraction" ? NaN : 1, 1));
    assert.deepEqual(request, before);
  }
});

test("empty and unscored-only inputs do not divide by zero", () => {
  const request = { format: "ournotes.replay/1", mode: { kind: "normal" }, frames: [] };
  assert.deepEqual(applyAccuracyPreset(request, { notes: [] }, [], 1, 1),
    { great: 0, just: 0, perfect: 0, total: 0, justEligible: 0 });
});

const runtimeData = process.env.OURNOTES_REPLAY_DATA;
const runtimeEngine = process.env.OURNOTES_REPLAY_ENGINE;
test("a real Rust WASM template and description accept the explicit preset plan", { skip: !runtimeData || !runtimeEngine }, async () => {
  const dataJSON = await fs.readFile(runtimeData, "utf8");
  const data = JSON.parse(dataJSON);
  const types = parseJustJudgementTypes(data);
  assert.ok(types.length > 0);
  const { default: init, ReplaySession } = await import(pathToFileURL(path.join(runtimeEngine, "ournotes_replay.js")));
  await init({ module_or_path: await fs.readFile(path.join(runtimeEngine, "ournotes_replay_bg.wasm")) });
  const session = new ReplaySession(dataJSON);
  try {
    let description;
    for (const chart of data.charts) {
      const candidate = JSON.parse(session.describeChart(chart.scoreId));
      if (candidate.fevers.some((_, i) => candidate.missions[i] === 3)) { description = candidate; break; }
    }
    assert.ok(description, "fixture needs a real Just mission");
    const request = JSON.parse(session.template(description.scoreId, 300000, 60));
    request.mode = { kind: "soloGekisou" };
    const counts = applyAccuracyPreset(request, description, types, .3, .6);
    assert.ok(counts.justEligible > 0 && counts.just > 0);
    assert.equal(counts.great, Math.round(counts.total * .3));
    assert.equal(counts.just, Math.round(counts.justEligible * .6));
    const result = JSON.parse(session.run(JSON.stringify(request)));
    assert.equal(result.complete, true);
    assert.deepEqual([result.judgements.great, result.judgements.just, result.judgements.perfect],
      [counts.great, counts.just, counts.perfect]);
    const segmentRequest = JSON.parse(session.template(description.scoreId, 300000, 60));
    segmentRequest.mode = { kind: "soloGekisou" };
    const start = description.fevers.find((_, i) => description.missions[i] === 3)[0];
    const segmentCounts = applySegmentPreset(segmentRequest, description, types,
      [segment({ great: .1, good: .05, bad: .05, miss: .05, just: 1 }),
        segment({ startMs: 0, endMs: start, great: 1 })], 42);
    assert.ok(segmentCounts.just > 0 && segmentCounts.great > 0 && segmentCounts.miss > 0);
    const segmentResult = JSON.parse(session.run(JSON.stringify(segmentRequest)));
    assert.equal(segmentResult.complete, true);
    for (const key of ["great", "good", "bad", "miss", "just", "perfect"]) {
      assert.equal(segmentResult.judgements[key], segmentCounts[key]);
    }
  } finally { session.free(); }
});
