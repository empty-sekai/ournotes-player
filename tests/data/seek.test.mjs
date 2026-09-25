// Opt-in: the viewer controls keep the chart-side state exact (one chart, OURNOTES_SEEK_CHART).
//   seek      after a seek (forward, backward, from the end, between two frames) the state equals the continuous run's
//             state at the chart time reached, the reached time is the last frame at or before the target, and the
//             frames that follow equal the continuous run's
//   speed     the chart clock is the sum of the game time of the steps; a seek at speed 0.75 equals a run at 0.75
//   pause     the audio context is suspended and the clock continues from where it stopped
//   stalls    the chart clock runs on for 6 / 30 / 180 frames without a step (a late frame, a background tab): every
//             following frame equals the continuous run at the same chart time, no note is missed; after the short
//             stall (within the catch-up's effect window) the effects equal too
// All runs use the music-off clock (chart time advances by the game time of each step). Skipped when OURNOTES_DATA is
// not set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SKIP, differences, effectsState, openSession, pickCharts, snapshot } from "./harness.mjs";

const [chart] = pickCharts("OURNOTES_SEEK_CHART", ["100082_expert"]);
const STALLS = [[6, 0.3], [30, 0.5], [180, 0.7]];   // [frames the clock runs on, position as a share of the chart]

const stepState = async (s) => { await s.step({ draw: false }); };

test(`${chart || "(no chart)"}: seek, speed, pause and stalls keep the chart state exact`, { skip: SKIP }, async (t) => {
  // continuous run to the end; every frame's state kept (hashed)
  const A = (await openSession(chart)).session;
  const frames = [], byMs = new Map(), fxByMs = new Map();
  const nSteps = Math.ceil(A.durationMs() / (1000 / 60));
  const fxWindows = STALLS.filter(([n]) => n <= 12).map(([n, q]) => [Math.floor(q * nSteps) + n, Math.floor(q * nSteps) + n + 150]);
  for (let f = 0; A.state !== "ended"; f++) {
    await stepState(A);
    if (A.chartMs === null || A.state !== "playing") continue;
    const s = snapshot(A);
    frames.push(s); byMs.set(s.t, s);
    if (fxWindows.some(([a, b]) => f >= a && f <= b)) fxByMs.set(s.t, effectsState(A));
    assert.ok(f < nSteps + 60 * 60, "the chart did not end");
  }
  const end = snapshot(A);
  await A.dispose();

  await t.test("seek", async () => {
    const { session: B } = await openSession(chart);
    try {
      const pick = (q) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))].t;
      for (const q of [0.5, 0.2, 0.35, 0.8, 0.07, 0.93, 0.995, 1.2, 0.66]) {
        const target = q > 1 ? B.durationMs() : pick(q);
        await B.seek(target);
        const s = snapshot(B), a = q > 1 ? end : byMs.get(s.t);
        assert.ok(a, `seek ${target}: no continuous frame at chart time ${s.t}`);
        assert.deepEqual(differences(a, s), [], `seek ${target} (reached ${s.t})`);
        if (q <= 1) assert.equal(s.t, target, `seek ${target}`);
      }
      let followed = 0;
      for (let i = 0; i < 600 && B.state === "playing"; i++) {
        await stepState(B);
        if (B.chartMs === null || B.state !== "playing") continue;
        const s = snapshot(B), a = byMs.get(s.t);
        assert.ok(a, `after the seeks: no continuous frame at ${s.t}`);
        assert.deepEqual(differences(a, s), [], `after the seeks, chart ${s.t}`);
        followed++;
      }
      assert.ok(followed > 0);
      const k = Math.floor(frames.length * 0.4);
      assert.equal(await B.seek(frames[k].t + 1), frames[k].t, "a seek between two frames reaches the earlier one");
    } finally { await B.dispose(); }
  });

  await t.test("speed and pause", async () => {
    const { session: C } = await openSession(chart);
    try {
      await stepState(C);                                    // the music start frame (the clock starts at 0)
      let sum = 0;
      for (const sp of [0.5, 1.5, 0.75, 1.25, 1]) {
        C.setSpeed(sp);
        for (let i = 0; i < 120; i++) {
          await stepState(C);
          sum += C.loop.deltaTime;
          assert.ok(Math.abs(C.loop.deltaTime - C.loop.fixedDelta * sp) < 1e-15, `deltaTime at speed ${sp}`);
          assert.equal(C.chartMs, Math.trunc(C.audio.game.sec * 1000), `chart clock at speed ${sp}`);
        }
      }
      assert.ok(Math.abs(C.audio.game.sec - sum) < 1e-9, "the clock is the sum of the steps' game time");
      const before = C.positionMs();
      await C.pause();
      assert.equal(C.audioContext.state, "suspended");
      assert.equal(C.positionMs(), before);
      await C.play();
      await stepState(C);
      assert.equal(C.chartMs, Math.trunc(C.audio.game.sec * 1000), "the clock continues after pause");
      assert.ok(C.chartMs > before);
    } finally { await C.dispose(); }

    const { session: D } = await openSession(chart, { speed: 0.75 });
    const slow = new Map();
    try {
      await stepState(D);
      while (D.state === "playing" && slow.size < 3000) {
        await stepState(D);
        if (D.chartMs !== null) { const s = snapshot(D); slow.set(s.t, s); }
      }
    } finally { await D.dispose(); }
    const { session: E } = await openSession(chart, { speed: 0.75 });
    try {
      const keys = [...slow.keys()];
      for (const k of [keys[2500], keys[900], keys[1800]]) {
        await E.seek(k);
        const s = snapshot(E);
        assert.equal(s.t, k);
        assert.deepEqual(differences(slow.get(k), s), [], `speed 0.75, seek ${k}`);
      }
    } finally { await E.dispose(); }
  });

  for (const [n, q] of STALLS) {
    await t.test(`stall of ${n} frames`, async () => {
      const { session: G } = await openSession(chart);
      try {
        const at = Math.floor(q * nSteps);
        for (let i = 0; i < at; i++) await stepState(G);
        const before = G.chartMs, dt = G.loop.stepDelta();
        for (let i = 0; i < n; i++) G.audio.game.advance(dt);   // the clock runs on without a step
        let compared = 0, fxCompared = 0;
        for (let i = 0; i < 150 && G.state === "playing"; i++) {
          await stepState(G);
          if (G.chartMs === null || G.state !== "playing" || G.chartMs === before) continue;
          const s = snapshot(G), a = byMs.get(s.t);
          assert.ok(a, `no continuous frame at chart time ${s.t}`);
          assert.deepEqual(differences(a, s), [], `chart ${s.t}`);
          if (fxByMs.has(s.t)) { fxCompared++; assert.equal(effectsState(G), fxByMs.get(s.t), `effects at ${s.t}`); }
          compared++;
        }
        assert.ok(compared > 0);
        if (n <= 12) assert.ok(fxCompared > 0, "effects compared after a short stall");
        const ex = G.exec;
        assert.equal(ex.comboEntries.filter((e) => e.j === 1 || e.j === 2).length, 0, "no Miss / Bad");
        assert.equal(ex.appFC, true, "full combo kept");
      } finally { await G.dispose(); }
    });
  }
});
