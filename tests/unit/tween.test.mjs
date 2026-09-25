// DOTween easing (src/engine/tween.js) against the easing definitions it states it follows (DOTween's
// EaseManager.Evaluate, i.e. Robert Penner's equations with DOTween's Bounce and Elastic variants), and the Tweens
// runner. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EASE, EASE_DEFAULT_OVERSHOOT, Tweens, ease } from "../../src/engine/tween.js";

const close = (actual, expected, eps = 1e-6, msg = "") =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);

test("ease values at fixed points (duration 1)", () => {
  const s = EASE_DEFAULT_OVERSHOOT;
  const cases = [
    ["Linear", 0.25, 0.25],
    ["InSine", 0.5, 1 - Math.cos(Math.PI / 4)],
    ["OutSine", 0.5, Math.sin(Math.PI / 4)],
    ["InOutSine", 0.25, -0.5 * (Math.cos(Math.PI / 4) - 1)],
    ["InQuad", 0.5, 0.25],
    ["OutQuad", 0.5, 0.75],
    ["InOutQuad", 0.25, 0.125],
    ["InOutQuad", 0.75, 0.875],
    ["InCubic", 0.5, 0.125],
    ["OutCubic", 0.5, 0.875],
    ["InOutCubic", 0.25, 0.0625],
    ["InOutCubic", 0.75, 0.9375],
    ["InQuart", 0.5, 0.0625],
    ["OutQuart", 0.5, 0.9375],
    ["InOutQuart", 0.25, 0.03125],
    ["InQuint", 0.5, 0.03125],
    ["OutQuint", 0.5, 0.96875],
    ["InOutQuint", 0.75, 0.984375],
    ["InExpo", 0.5, 2 ** -5],
    ["OutExpo", 0.5, 1 - 2 ** -5],
    ["InOutExpo", 0.25, 0.5 * 2 ** -5],
    ["InOutExpo", 0.75, 1 - 0.5 * 2 ** -5],
    ["InCirc", 0.5, 1 - Math.sqrt(0.75)],
    ["OutCirc", 0.5, Math.sqrt(0.75)],
    ["InOutCirc", 0.25, 0.5 * (1 - Math.sqrt(0.75))],
    ["InBack", 0.5, 0.25 * ((s + 1) * 0.5 - s)],
    ["OutBack", 0.5, 0.25 * (-(s + 1) * 0.5 + s) + 1],
    // Bounce.EaseOut: 7.5625 (t - 1.5 / 2.75)^2 + 0.75 in the second segment; at t = 0.5 that is 0.765625
    ["OutBounce", 0.5, 0.765625],
    ["InBounce", 0.5, 0.234375],
    ["InOutBounce", 0.25, (1 - 0.765625) * 0.5],
    ["OutBounce", 0.2, 7.5625 * 0.04],
    ["OutBounce", 0.95, 7.5625 * (0.95 - 2.625 / 2.75) ** 2 + 0.984375],
  ];
  for (const [name, t, v] of cases) close(ease(EASE[name], t, 1), v, 1e-6, `${name}(${t})`);
});

test("ease endpoints are 0 and 1", () => {
  const skip = new Set([0, 32, 33, 34, 35, 36, 37]);
  for (const [name, id] of Object.entries(EASE)) {
    if (skip.has(id)) continue;
    close(ease(id, 0, 1), 0, 1e-6, `${name}(0)`);
    close(ease(id, 1, 1), 1, 1e-6, `${name}(1)`);
  }
});

test("ease depends on time / duration only", () => {
  for (const [name, id] of Object.entries(EASE)) {
    if (id === 0 || id >= 32) continue;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) close(ease(id, t * 2.5, 2.5), ease(id, t, 1), 1e-9, `${name}(${t})`);
  }
});

test("elastic eases follow the amplitude / period definition", () => {
  // period 0 -> duration x 0.3 (InOut: x 0.45); amplitude >= 1 -> s = p / (2 pi) asin(1 / a); below 1 -> a = 1, s = p / 4
  const a = EASE_DEFAULT_OVERSHOOT, p = Math.fround(0.3), twoPi = Math.fround(6.2831855);
  const s = p / twoPi * Math.asin(1 / a);
  const t = 0.5;
  close(ease(EASE.OutElastic, t, 1), a * 2 ** (-10 * t) * Math.sin((t - s) * twoPi / p) + 1, 1e-9, "OutElastic");
  const u = t - 1;
  close(ease(EASE.InElastic, t, 1), -(a * 2 ** (10 * u) * Math.sin((u - s) * twoPi / p)), 1e-9, "InElastic");
  const s1 = p * 0.25;
  close(ease(EASE.OutElastic, t, 1, 0.5), 2 ** (-10 * t) * Math.sin((t - s1) * twoPi / p) + 1, 1e-9, "OutElastic a < 1");
  close(ease(EASE.OutElastic, t, 1, a, 0.4),
        a * 2 ** (-10 * t) * Math.sin((t - 0.4 / twoPi * Math.asin(1 / a)) * twoPi / 0.4) + 1, 1e-9, "OutElastic period 0.4");
});

test("Unset and unknown ids evaluate as OutQuad; INTERNAL_Zero is 1; Flash and INTERNAL_Custom throw", () => {
  close(ease(EASE.Unset, 0.5, 1), 0.75);
  close(ease(99, 0.5, 1), 0.75);
  assert.equal(ease(EASE.INTERNAL_Zero, 0, 1), 1);
  for (const id of [EASE.Flash, EASE.InFlash, EASE.OutFlash, EASE.InOutFlash, EASE.INTERNAL_Custom])
    assert.throws(() => ease(id, 0.5, 1));
});

test("Tweens: values per step, completion, kill, zero duration, lazy start value", async () => {
  const r = new Tweens();
  const seen = [];
  const t = r.to(0, 10, 1, EASE.Linear, (v) => seen.push(v));
  r.update(0.25);
  r.update(0.25);
  assert.deepEqual(seen, [2.5, 5]);
  r.update(0.75);                                  // past the end: the end value, completed
  assert.equal(seen.at(-1), 10);
  assert.equal(await t.promise, true);
  assert.equal(r.active.size, 0);

  const k = r.to({ x: 0, y: 4 }, { x: 8, y: 0 }, 2, EASE.Linear, (v) => seen.push(v));
  r.update(0.5);
  assert.deepEqual(seen.at(-1), { x: 2, y: 3 });
  k.kill();
  assert.equal(await k.promise, false);
  r.update(0.5);
  assert.deepEqual(seen.at(-1), { x: 2, y: 3 });    // a killed tween applies nothing more

  let applied = null;
  const z = r.to(1, 2, 0, EASE.Linear, (v) => { applied = v; });
  assert.equal(applied, 2);
  assert.equal(await z.promise, true);

  let start = 3;
  const lazy = r.to(() => start, 5, 1, EASE.Linear, (v) => { applied = v; });
  start = 1;                                       // read at the first update, not at creation
  r.update(0.5);
  assert.equal(applied, 3);
  r.update(0.5);
  assert.equal(await lazy.promise, true);
});
