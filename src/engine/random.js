import { F } from "./core.js";

// UnityEngine.Random: the engine's Rand class (xorshift128 seeded like Random.InitState: x = seed,
// y = 1812433253 x + 1, z = 1812433253 y + 1, w = 1812433253 z + 1), value = low 23 bits / 8388607,
// Range(min, max) = min * t + (1 - t) * max.
// ENGINE: Rand is native; this is the generator family and float mapping Unity is known to use.
//
// random is the global stream (UnityEngine.Random.*). AppMain.InitializeBasicSystems seeds it once with
// Environment.TickCount; this module seeds it from the clock the same way, so sequences differ between runs as
// they do in the game. random.initState(seed) makes them reproducible.

export class UnityRandom {
  constructor(seed = 0) { this.initState(seed); }

  initState(seed) {
    this.x = seed >>> 0;
    this.y = (Math.imul(1812433253, this.x) + 1) >>> 0;
    this.z = (Math.imul(1812433253, this.y) + 1) >>> 0;
    this.w = (Math.imul(1812433253, this.z) + 1) >>> 0;
  }

  nextU32() {
    const t = (this.x ^ (this.x << 11)) >>> 0;
    this.x = this.y; this.y = this.z; this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }

  value() { return F((this.nextU32() & 0x7FFFFF) / 8388607); }            // Random.value, [0, 1]

  range(min, max) { const t = this.value(); return F(F(min * t) + F(F(1 - t) * max)); }   // Random.Range(float, float)
};

export const random = new UnityRandom(Date.now() >>> 0);
