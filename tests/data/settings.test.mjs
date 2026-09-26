// Opt-in: a Live settings change during a chart gives the state of a session booted with those settings (one chart,
// OURNOTES_SEEK_CHART). For each variant: the continuous run of a session booted with it (every frame's chart state by
// chart time: executor, note views, live UI; all Perfect, full combo); a session with the default settings changed to
// it at 40 % of the chart, compared frame by frame to the end (the chart time reached is the last frame of the variant
// at or before the position, the end and the final chart time are the same), with seeks backwards and forwards; and
// the change a few frames before the end of the default run (for ChartPosition: in the post-music lead). All runs use
// the music-off clock. Skipped when OURNOTES_DATA is not set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SKIP, differences, openSession, pickCharts, snapshot } from "./harness.mjs";

const [chart] = pickCharts("OURNOTES_SEEK_CHART", ["100082_expert"]);
const VARIANTS = [
  { NoteSpeed: 12 }, { NoteTiming: -0.5 }, { NoteTiming: 0.5 }, { ChartPosition: 1.5 }, { ChartPosition: -1.5 },
  { JudgePosition: 5 }, { SimultaneousLineDisplay: false }, { ComboCountDisplay: false, ContinuationEffectDisplay: false },
  { GuidelineCount: 4, LaneOpacity: 30, SlideOpacity: 100 },
];

const step = (s) => s.step({ draw: false });
const live = (s) => s.chartMs !== null && s.state === "playing";

// the continuous run of a session booted with `settings`
const continuous = async (settings) => {
  const { session: s } = await openSession(chart, { settings });
  const byMs = new Map(), times = [];
  let steps = 0;
  try {
    for (; s.state !== "ended"; steps++) {
      await step(s);
      if (live(s)) { const sn = snapshot(s); byMs.set(sn.t, sn); times.push(sn.t); }
      assert.ok(steps < 60 * 60 * 20, "the chart did not end");
    }
    const ex = s.exec;
    return { byMs, times, steps, final: s.chartMs, end: snapshot(s), ap: ex.appAP, fc: ex.appFC };
  } finally { await s.dispose(); }
};

const same = (A, s, what) => {
  const sn = snapshot(s), a = A.byMs.get(sn.t);
  assert.ok(a, `${what}: the continuous run has no frame at chart time ${sn.t}`);
  assert.deepEqual(differences(a, sn), [], `${what} (chart time ${sn.t})`);
};
const lastAtOrBefore = (A, t) => A.times.filter((x) => x <= t).at(-1);

// `s` changed to `V` now, then compared with A to the end (seeks: shares of the chart, after 300 frames)
const follow = async (s, A, change, seeks = []) => {
  const before = s.positionMs();
  await s.setSettings(...change);
  if (live(s)) {
    assert.equal(s.chartMs, lastAtOrBefore(A, before), "the chart time reached by the change");
    same(A, s, "at the change");
  }
  for (let n = 0; s.state !== "ended"; n++) {
    if (n === 300) {
      for (const q of seeks) {
        const target = A.times[Math.floor(q * A.times.length)];
        assert.equal(await s.seek(target), target, `seek ${target}`);
        same(A, s, `seek ${q}`);
      }
    }
    await step(s);
    if (live(s)) same(A, s, "after the change");
  }
  assert.equal(s.chartMs, A.final, "final chart time");
  assert.deepEqual(differences(A.end, snapshot(s)), [], "end state");
};

test(`${chart || "(no chart)"}: a settings change during the chart equals a session booted with the settings`, { skip: SKIP }, async (t) => {
  const Z = await continuous(null);
  for (const V of VARIANTS) {
    await t.test(JSON.stringify(V), async () => {
      const A = await continuous(V);
      assert.ok(A.ap && A.fc, "all perfect full combo");
      const { session: B } = await openSession(chart);
      try {
        for (let i = 0; i < Math.floor(0.4 * Z.steps); i++) await step(B);
        await follow(B, A, [V], [0.2, 0.85]);
      } finally { await B.dispose(); }
      const { session: C } = await openSession(chart);
      try {
        for (let i = 0; i < Z.steps - 3; i++) await step(C);
        await follow(C, A, [V]);
      } finally { await C.dispose(); }
      const { session: R } = await openSession(chart, { settings: V });
      try {
        for (let i = 0; i < Math.floor(0.4 * A.steps); i++) await step(R);
        await follow(R, Z, [{}, { reset: true }]);
      } finally { await R.dispose(); }
    });
  }
});
