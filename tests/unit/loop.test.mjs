// PlayerLoop (src/engine/loop.js): the phase order of one step, the clock (time, deltaTime, frameCount, timeScale)
// and the UniTask waits, as the module documents them; the drain between phases. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EASE } from "../../src/engine/tween.js";
import { PlayerLoop, drain } from "../../src/engine/loop.js";

test("one step runs the phases in the documented order", async () => {
  const loop = new PlayerLoop(60);
  const log = [];
  await loop.step();                                         // frame 1: register the waiters from inside the loop
  loop.yield("Update").then(() => log.push("Update yield"));
  loop.delayFrame(1).then(() => log.push("DelayFrame"));
  loop.yield("PostLateUpdate").then(() => log.push("PostLateUpdate yield"));
  loop.tweens.to(0, 1, 10, EASE.Linear, () => log.push("DOTween"));
  for (const phase of ["update", "tweens", "animation", "lateUpdate", "preLateEnd", "postLate", "render"])
    loop.on(phase, () => log.push(phase));
  await loop.step();
  assert.deepEqual(log, ["Update yield", "DelayFrame", "update", "DOTween", "tweens", "animation", "lateUpdate",
                         "preLateEnd", "postLate", "PostLateUpdate yield", "render"]);
});

test("continuations resumed in a phase run before the next phase", async () => {
  const loop = new PlayerLoop(60);
  const log = [];
  loop.on("update", () => { Promise.resolve().then(() => log.push("continuation")); log.push("update"); });
  loop.on("tweens", () => log.push("tweens"));
  await loop.step();
  assert.deepEqual(log, ["update", "continuation", "tweens"]);
});

test("clock: fixed delta, float32 time, frame count, time scale", async () => {
  const loop = new PlayerLoop(60);
  let t = 0;
  for (let i = 0; i < 3; i++) { await loop.step(); t = Math.fround(t + 1 / 60); }
  assert.equal(loop.frameCount, 3);
  assert.equal(loop.deltaTime, 1 / 60);
  assert.equal(loop.time, t);
  loop.timeScale = 0.5;
  assert.equal(loop.stepDelta(), 0.5 / 60);
  await loop.step();
  assert.equal(loop.deltaTime, 0.5 / 60);
  assert.equal(loop.time, Math.fround(t + 0.5 / 60));
});

test("UniTask.Delay: the creating frame does not count, later frames add deltaTime", async () => {
  const loop = new PlayerLoop(60);
  let done = null;
  loop.on("update", (l) => { if (l.frameCount === 1) l.delay(2 / 60).then((ok) => { done = [l.frameCount, ok]; }); });
  for (let i = 0; i < 4 && !done; i++) await loop.step();
  assert.deepEqual(done, [3, true]);                        // created in frame 1; frames 2 and 3 add 2 / 60

  let zero = null;                                          // no shortcut: the first Update tick after this frame
  const f0 = loop.frameCount;
  loop.delay(0).then((ok) => { zero = [loop.frameCount - f0, ok]; });
  await loop.step();
  assert.deepEqual(zero, [1, true]);
  assert.throws(() => loop.delay(-1), RangeError);          // ArgumentOutOfRangeException
  const cancelled = loop.delay(1);
  loop.cancelDelays();
  assert.equal(await cancelled, false);
});

test("UniTask.DelayFrame resolves in the Update phase of the target frame", async () => {
  const loop = new PlayerLoop(60);
  let at = null;
  loop.delayFrame(2).then(() => { at = loop.frameCount; });
  for (let i = 0; i < 3; i++) await loop.step();
  assert.equal(at, 2);
});

test("a drain resolves after every microtask queued before it, however deep; drains resolve in their order", async () => {
  const log = [];
  const chain = (n) => (n ? Promise.resolve().then(() => chain(n - 1)) : log.push("chain"));
  chain(50);
  const a = drain().then(() => log.push("a")), b = drain().then(() => log.push("b"));
  queueMicrotask(() => log.push("micro"));
  await Promise.all([a, b]);
  assert.deepEqual(log, ["micro", "chain", "a", "b"]);
});

test("on a page with scheduler.postTask a drain is a user-blocking task, with the same order", async () => {
  const saved = globalThis.scheduler, priorities = [];
  // a stand-in scheduler: each task a macrotask of its own, in the order posted
  globalThis.scheduler = { postTask: (fn, { priority }) => {
    priorities.push(priority);
    return new Promise((res) => setImmediate(() => res(fn())));
  } };
  try {
    const { drain: taskDrain } = await import("../../src/engine/loop.js?postTask");
    const log = [];
    const chain = (n) => (n ? Promise.resolve().then(() => chain(n - 1)) : log.push("chain"));
    chain(50);
    const a = taskDrain().then(() => log.push("a")), b = taskDrain().then(() => log.push("b"));
    queueMicrotask(() => log.push("micro"));
    await Promise.all([a, b]);
    assert.deepEqual(log, ["micro", "chain", "a", "b"]);
    assert.deepEqual(priorities, ["user-blocking", "user-blocking"]);
  } finally {
    if (saved === undefined) delete globalThis.scheduler; else globalThis.scheduler = saved;
  }
});
