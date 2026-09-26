// engine additions: the game-exact UniTask.Delay of PlayerLoop (float32 elapsed, millisecond waits), DOTween's
// float32 EaseManager.Evaluate (easeF) and float tween (Tweens.toFloat). Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop, uniTaskDelaySeconds } from "../../src/engine/loop.js";
import { EASE, ease, easeF } from "../../src/engine/tween.js";
import { dotEase, DOT } from "../../src/engine/ugui.js";

const F = Math.fround;

const ticks = async (sec, fps) => {
  const loop = new PlayerLoop(fps);
  let at = null;
  loop.delay(sec).then(() => { at = loop.frameCount; });
  for (let i = 0; i < 1000 && at === null; i++) await loop.step();
  return at;
};

test("uniTaskDelaySeconds: TimeSpan.FromSeconds rounds to whole milliseconds, TotalSeconds in float32", () => {
  assert.equal(uniTaskDelaySeconds(1), 1);
  assert.equal(uniTaskDelaySeconds(2 / 60), F(0.033));
  assert.equal(uniTaskDelaySeconds(0.0005), F(0.001));
  assert.equal(uniTaskDelaySeconds(0.0004), 0);
  assert.equal(uniTaskDelaySeconds(F(0.3)), F(0.3));
  assert.ok(Object.is(uniTaskDelaySeconds(-0.0004), -0));   // rounds to 0 ms: not negative
  assert.throws(() => uniTaskDelaySeconds(NaN), /Not-a-Number/);
  assert.throws(() => uniTaskDelaySeconds(Infinity), /overflowed/);
  assert.throws(() => uniTaskDelaySeconds(1e15), /overflowed/);
});

test("delay(0) completes at the first Update tick after its frame; -0.0004 s is a zero wait, -0.0005 s throws", async () => {
  assert.equal(await ticks(0, 30), 1);
  assert.equal(await ticks(-0.0004, 30), 1);
  const loop = new PlayerLoop(30);
  assert.throws(() => loop.delay(-0.0005), /minus delayTimeSpan/);
  assert.throws(() => loop.delay(NaN), /Not-a-Number/);
  assert.throws(() => loop.delay(undefined), TypeError);
});

test("delay: float32 elapsed of Time.deltaTime (1 s = 30 ticks at 30 fps, 61 at 60 fps)", async () => {
  assert.equal(await ticks(1, 30), 30);
  assert.equal(await ticks(2, 30), 61);
  assert.equal(await ticks(0.2, 30), 6);
  assert.equal(await ticks(0.5, 30), 15);
  assert.equal(await ticks(1, 60), 61);
});

test("_delayEntry keeps the queue's entry shape for callers that cancel their own delays", async () => {
  const loop = new PlayerLoop(30);
  await loop.step();
  let r = null;
  const d = loop._delayEntry(0.1, (ok) => { r = ok; });
  assert.deepEqual(Object.keys(d).sort(), ["created", "elapsed", "res", "sec"]);
  assert.equal(d.created, 1);
  loop._delays.push(d);
  for (let i = 0; i < 4; i++) await loop.step();
  assert.equal(r, true);
});

test("easeF follows the float32 EaseManager.Evaluate and agrees with the double ease to float precision", () => {
  const u = F(F(0.3) / 1);
  assert.equal(easeF(EASE.Linear, 0.3, 1), u);
  assert.equal(easeF(EASE.InOutSine, 0.25, 1), F(F(F(Math.cos(F(F(F(0.25) * F(3.1415927)) / 1))) + -1) * -0.5));
  assert.equal(easeF(EASE.OutQuad, 0.5, 1), F(-F(F(0.5) * F(F(0.5) + -2))));
  assert.equal(easeF(EASE.InOutSine, 1, 1), 1);
  assert.equal(easeF(EASE.INTERNAL_Zero, 0.1, 1), 1);
  for (let id = 0; id <= 31; id++)
    for (const t of [0, 0.1, 0.37, 0.5, 0.81, 1]) {
      const a = easeF(id, t, 1), b = ease(id, t, 1);
      assert.equal(a, F(a));
      assert.ok(Math.abs(a - b) < 2e-6, `ease ${id} at ${t}: ${a} vs ${b}`);
    }
  assert.throws(() => easeF(EASE.Flash, 0.5, 1), /Flash/);
});

test("dotEase is easeF with DOT.EASE_ZERO = 1", () => {
  assert.equal(dotEase(DOT.EASE_ZERO, 0.2, 1), 1);
  for (const id of [1, 6, 27]) assert.equal(dotEase(id, 0.4, 1.5), easeF(id, 0.4, 1.5));
});

test("Tweens.toFloat: start read at the first update, start + ease(position) x change in float32, clamped end", async () => {
  const loop = new PlayerLoop(30);
  let x = F(-0.41541097), seen = [];
  const t = loop.tweens.toFloat(() => x, 0.25, 0.2, EASE.InOutSine, (v) => { x = v; seen.push(v); });
  x = F(0.1);                                                // the getter is read at the first update
  for (let i = 0; i < 8 && !t.done; i++) await loop.step();
  const start = F(0.1), change = F(F(0.25) - start);
  let p = 0;
  const want = [];
  for (;;) {
    p = F(p + F(1 / 30));
    const end = F(0.2) <= p;
    if (end) p = F(0.2);
    want.push(F(start + F(easeF(EASE.InOutSine, p, F(0.2)) * change)));
    if (end) break;
  }
  assert.deepEqual(seen, want);
  assert.equal(await t.promise, true);
  let z = 3;
  const zero = loop.tweens.toFloat(() => z, 5, 0, EASE.OutQuad, (v) => { z = v; });
  assert.equal(z, 3);                                        // applied at the next update
  await loop.step();
  assert.equal(z, F(3 + F(5 - 3)));
  assert.equal(await zero.promise, true);
});
