// Opt-in: every chart named by OURNOTES_CHARTS plays from the start to the end in the headless session, drawing every
// frame: no error, the chart ends, and auto play at Perfect gives an all perfect full combo whose maximum combo equals
// the chart's fullComboCount. Skipped when OURNOTES_DATA is not set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SKIP, openSession, pickCharts } from "./harness.mjs";

const charts = pickCharts("OURNOTES_CHARTS", ["100001_expert", "100040_expert"]);

for (const id of charts.length ? charts : ["(no chart)"]) {
  test(`${id}: plays to the end`, { skip: SKIP }, async () => {
    const { session, audioContext } = await openSession(id);
    try {
      const expected = Math.ceil(session.durationMs() / (1000 / 60));
      let frames = 0;
      while (session.state !== "ended") {
        audioContext.t = session.loop.time;
        await session.step();
        frames++;
        assert.ok(frames < expected + 60 * 60, `the chart did not end after ${frames} frames`);
      }
      const ex = session.exec, chart = session.chart;
      assert.equal(ex.appAP, true, "all perfect");
      assert.equal(ex.appFC, true, "full combo");
      assert.equal(ex.comboEntries.filter((e) => e.j !== 5).length, 0, "only Perfect judgements add to the combo");
      if (chart && chart.fullComboCount !== undefined) assert.equal(ex.appMax, chart.fullComboCount, "maximum combo");
      assert.ok(session.frame && session.frame.finishedAllNoteUpdate, "every note finished");
    } finally {
      await session.dispose();
    }
  });
}
