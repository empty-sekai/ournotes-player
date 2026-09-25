// UnityRandom (src/engine/random.js) against the algorithm the module states: xorshift128 seeded as
// Random.InitState (x = seed, y = 1812433253 x + 1, z = 1812433253 y + 1, w = 1812433253 z + 1, all mod 2^32),
// value = low 23 bits / 8388607, Range(min, max) = min t + (1 - t) max in float32. The reference below is an
// independent BigInt implementation of that statement. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UnityRandom } from "../../src/engine/random.js";

const M = (1n << 32n) - 1n;
function* reference(seed) {
  let x = BigInt(seed >>> 0);
  let y = (1812433253n * x + 1n) & M;
  let z = (1812433253n * y + 1n) & M;
  let w = (1812433253n * z + 1n) & M;
  for (;;) {
    const t = (x ^ (x << 11n)) & M;
    x = y; y = z; z = w;
    w = (w ^ (w >> 19n) ^ (t ^ (t >> 8n))) & M;
    yield Number(w);
  }
}

test("nextU32 is xorshift128 seeded as InitState", () => {
  for (const seed of [0, 1, 42, 123456789, 0x7fffffff, 0xffffffff]) {
    const r = new UnityRandom(seed), ref = reference(seed);
    for (let i = 0; i < 1000; i++) assert.equal(r.nextU32(), ref.next().value, `seed ${seed}, draw ${i}`);
  }
});

test("value = low 23 bits / 8388607 (float32), in [0, 1]", () => {
  const r = new UnityRandom(7), ref = reference(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.value();
    assert.equal(v, Math.fround((ref.next().value & 0x7fffff) / 8388607));
    assert.ok(v >= 0 && v <= 1);
  }
});

test("range(min, max) = min t + (1 - t) max in float32", () => {
  const r = new UnityRandom(99), ref = reference(99);
  const F = Math.fround;
  for (let i = 0; i < 200; i++) {
    const t = F((ref.next().value & 0x7fffff) / 8388607);
    assert.equal(r.range(-2, 5), F(F(-2 * t) + F(F(1 - t) * 5)));
  }
});

test("initState restarts the sequence", () => {
  const r = new UnityRandom(5);
  const a = [r.nextU32(), r.nextU32(), r.nextU32()];
  r.initState(5);
  assert.deepEqual([r.nextU32(), r.nextU32(), r.nextU32()], a);
});
