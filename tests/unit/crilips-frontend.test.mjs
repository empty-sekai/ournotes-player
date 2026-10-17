// CRI Lips front end and core over SYNTHETIC signals and weights only (no game data): CriWare's
// polynomial trig, the FFT, the low-pass biquad, the resampler, the mel analyzer, the discretizer,
// and the pipeline block structure. Bit-for-bit parity with the native library is checked separately.
import assert from "node:assert/strict";
import { test } from "node:test";
import { criSin, criCos, criSin4Lane, criCos4Lane } from "../../src/live2d/crilips/crimath.js";
import { CriFft } from "../../src/live2d/crilips/fft.js";
import { CriBiquadLpf } from "../../src/live2d/crilips/biquad.js";
import { CriResampler } from "../../src/live2d/crilips/resample.js";
import { CriMelAnalyzer } from "../../src/live2d/crilips/mel.js";
import { CriDiscretizer } from "../../src/live2d/crilips/discretizer.js";
import { CriLipsData } from "../../src/live2d/crilips/data.js";
import { CriLipsPipeline } from "../../src/live2d/crilips/pipeline.js";

const F = Math.fround;

test("CriWare polynomial sin/cos are float32 truncated series (close near 0, loose at pi)", () => {
  for (let i = -40; i <= 40; i++) {
    const x = F(i * Math.PI / 40), tol = Math.abs(x) <= Math.PI / 2 ? 1e-3 : 3e-2;
    for (const [f, g] of [[criSin, Math.sin], [criCos, Math.cos], [criSin4Lane, Math.sin], [criCos4Lane, Math.cos]]) {
      const y = f(x);
      assert.equal(y, F(y));
      assert.ok(Math.abs(y - g(x)) < tol, `${f.name}(${x}) = ${y}`);
    }
  }
  assert.equal(criSin(0), 0);
  assert.equal(criCos(0), 1);
});

test("FFT matches a direct DFT closely and is linear", () => {
  const n = 64, fft = new CriFft(n);
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) { re[i] = F(Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1)); im[i] = 0; }
  const ore = new Float32Array(n), oim = new Float32Array(n);
  fft.transform(re, im, ore, oim, -1);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) { const a = -2 * Math.PI * k * t / n; sr += re[t] * Math.cos(a); si += re[t] * Math.sin(a); }
    assert.ok(Math.abs(ore[k] - sr) < 2e-2 && Math.abs(oim[k] - si) < 2e-2, `bin ${k}: ${ore[k]},${oim[k]} vs ${sr},${si}`);
  }
  const z = new Float32Array(n), a = new Float32Array(n), b = new Float32Array(n);
  fft.transform(z, z, a, b, -1);
  assert.ok(a.every((v) => v === 0) && b.every((v) => v === 0));
  assert.throws(() => new CriFft(12));
});

test("biquad low-pass: unit DC gain, processes whole blocks of 8, flushes tiny states", () => {
  const f = new CriBiquadLpf(48000, 16000);
  const x = new Float32Array(4096).fill(0.5), y = new Float32Array(4096);
  assert.equal(f.process(x, y, 4096), 4096);
  assert.ok(Math.abs(y[4095] - 0.5) < 1e-4, `dc ${y[4095]}`);
  const g = new CriBiquadLpf(48000, 16000), yy = new Float32Array(16);
  assert.equal(g.process(new Float32Array(13), yy, 13), 8);
  g.state.set([0, 0, 1e-30, -1e-30]);
  g.process(new Float32Array(8), yy, 8);
  assert.deepEqual(Array.from(g.state.subarray(2)), [0, 0]);
});

test("resampler 48k -> 16k: 488 samples first, then 480 per 10 ms, every third sample", () => {
  const r = new CriResampler(48000, 16000);
  assert.equal(r.needNumSamples(160), 488);
  const x = new Float32Array(488).map((_, i) => F(i * 0.001)), out = new Float32Array(200);
  const n = r.process(x, 488, out, 0, 200);
  assert.equal(n, 162);
  for (let i = 0; i < n; i++) assert.equal(out[i], x[3 * i]);
  assert.equal(r.needNumSamples(158), 480);
});

test("mel analyzer: 24 bands, zero frame gives the floored log spectrum, variance of a tone", () => {
  const cfg = { frameLen: 480, hop: 160, bands: 24, sampleRate: 16000, highHz: 8000, sineWeighting: true };
  for (const window of ["hamming", "blackman-harris"]) {
    const a = new CriMelAnalyzer({ ...cfg, window });
    assert.equal(a.n, 512);
    assert.equal(a.w.length, 24);
    a.clear(); a.fillZero();
    assert.ok(a.ready);
    const c = a.coefficients(new Float32Array(24), false, true);
    for (const v of c) assert.ok(Number.isFinite(v) && v < -30);
    a.shift();
    assert.equal(a.count, 320);
    const tone = new Float32Array(160).map((_, i) => F(0.5 * Math.sin(i * 0.3)));
    assert.equal(a.put(tone), 160);
    assert.ok(a.power() > -3 && a.power() < 0);
    const m = a.coefficients(new Float32Array(24), true, true);
    const mean = m.reduce((s, v) => s + v, 0) / 24;
    assert.ok(Math.abs(mean) < 1e-4);
  }
});

const disc = () => new CriDiscretizer({ rate: 100, maxWindowSec: 1, suppression: 0.5, smoothingSec: 0.1,
                                        holdSec: 0, releaseSec: 0.1, wildcard: [0.2, 0.2, 0, 0, 0, 0] });

test("discretizer: starts closed, smooths toward the dominant vowel, suppresses the runner-up", () => {
  const d = disc();
  assert.deepEqual(Array.from(d.last), [0, 0, 0, 0, 0, 1]);
  let last;
  for (let i = 0; i < 20; i++) last = d.process(new Float32Array([0.7, 0.2, 0.05, 0.03, 0.02, 0]), 0);
  assert.ok(Math.abs(last[0] - 0.7) < 1e-6, `a ${last[0]}`);
  assert.ok(Math.abs(last[1] - 0.1) < 1e-6, `i ${last[1]}`);    // runner-up * 0.5
  assert.equal(last[2], 0); assert.equal(last[3], 0); assert.equal(last[4], 0);
  for (let i = 0; i < 20; i++) last = d.process(new Float32Array(6), 4);
  assert.ok(Math.abs(last[5] - 1) < 1e-6);
});

// synthetic data object with the descriptor shape nnnotes writes
const synthParts = () => {
  let s = 99;
  const rnd = () => { s = (1103515245 * s + 12345) & 0x7fffffff; return s / 0x3fffffff - 1; };
  const shapes = { "net1.conv.w": 90, "net1.conv.b": 10, "net1.d1.w": 28160, "net1.d1.b": 128, "net1.d2.w": 16384,
    "net1.d2.b": 128, "net1.d3.w": 16384, "net1.d3.b": 128, "net1.d4.w": 3072, "net1.d4.b": 24,
    "net3.d1.w": 2880, "net3.d1.b": 40, "net3.bn1.beta": 40, "net3.bn1.gamma": 40, "net3.bn1.mean": 40,
    "net3.bn1.var": 40, "net3.d2.w": 800, "net3.d2.b": 20, "net3.bn2.beta": 20, "net3.bn2.gamma": 20,
    "net3.bn2.mean": 20, "net3.bn2.var": 20, "net3.d3.w": 100, "net3.d3.b": 5 };
  const blocks = []; let off = 0;
  for (const [name, count] of Object.entries(shapes)) { blocks.push({ name, offset: off, count, shape: [count] }); off += count; }
  const blob = new Float32Array(off);
  for (let i = 0; i < off; i++) blob[i] = F(rnd() * 0.1);
  for (const b of blocks) if (b.name.endsWith(".var")) for (let i = 0; i < b.count; i++) blob[b.offset + i] = F(0.5 + i * 0.01);
  const desc = { version: "synthetic", dtype: "float32", order: "LE", blocks,
    constants: { silence_coef: 10000, antiflap_defaults: [0.6, 0.4, 0.2, 0.2],
      motion_class_table: Array.from({ length: 24 }, (_, i) => i % 4),
      discretizer_type_table: Array.from({ length: 25 }, (_, i) => (i === 24 ? 4 : i % 4)) },
    frontend: { frame_ms: 30, hop_ms: 10, mel_bands: 24, mel_high_hz: 8000, resample_hz: 16000,
      biquad_lpf_cutoff_hz: 16000, update_rate_hz: 100, silence_threshold_db: -40,
      window_internal_class: "hamming", window_vowel: "blackman-harris", motion_class_buffer: 3,
      labial_hold_sec: 0, discretizer: { suppression: 0.5, smoothing_sec: 0.1, hold_sec: 0, release_sec: 0.1,
        max_window_sec: 1, wildcard: [0.2, 0.2, 0, 0, 0, 0] },
      mouth_open: { vowel_coef: [1, 1, 1, 1, 1], anti_shake_sec: 0.03 }, server_hz: 60 } };
  return { desc, blob };
};
const synthData = () => { const { desc, blob } = synthParts(); return new CriLipsData(desc, blob); };

test("pipeline: one hop per 10 ms, independent of how the PCM is chunked, silence stays closed", () => {
  const data = synthData(), sr = 48000;
  const pcm = new Float32Array(sr).map((_, i) => F(i > 9600 && i < 38400 ? 0.3 * Math.sin(i * 0.02) : 0));
  const a = new CriLipsPipeline(data, sr), ya = [];
  a.feed(pcm, (y) => ya.push(y));
  assert.equal(ya.length, 99);
  const b = new CriLipsPipeline(data, sr), yb = [];
  for (let i = 0; i < pcm.length; i += 777) b.feed(pcm.subarray(i, i + 777), (y) => yb.push(y));
  assert.deepEqual(yb, ya);
  for (const y of ya) assert.ok(y >= 0 && y <= 1 && y === F(y));
  assert.equal(ya[5], 0);
});

test("analyzer readout: the openY stored by the latest 60 Hz server tick at the played position", async () => {
  const { CriLipsAnalyzer } = await import("../../src/live2d/crilips/index.js");
  const data = synthData(), sr = 48000;
  const pcm = new Float32Array(sr / 2).map((_, i) => F(0.3 * Math.sin(i * 0.02)));
  let pos = 0;
  const chunk = 1000;                                   // not a multiple of the tick or the hop
  const source = { sampleRate: sr, paused: false,
    pull() { const c = pcm.subarray(pos, Math.min(pcm.length, pos + chunk)); pos += c.length; return c; } };
  const a = new CriLipsAnalyzer(data, source);
  const ref = [], ends = [];
  const p = new CriLipsPipeline(data, sr);
  p.feed(pcm, (y, end) => { ref.push(y); ends.push(end); });
  assert.equal(a.readoutHops, 0);
  assert.ok(a.isAvailable);
  while (pos < pcm.length) {
    const y = a.getOpenInfo().openY;                    // pulls the samples output so far first
    const limit = Math.floor(pos / 800) * 800;
    let want = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] <= limit) want = ref[i];
    assert.equal(y, want, `at ${pos}`);
  }
});

test("analyzer: shared readers in one frame and a paused voice keep the last value", async () => {
  const { CriLipsAnalyzer } = await import("../../src/live2d/crilips/index.js");
  const data = synthData(), sr = 48000;
  const pcm = new Float32Array(sr / 2).map((_, i) => F(0.3 * Math.sin(i * 0.02)));
  let pos = 0, playing = true;
  const source = { sampleRate: sr, paused: false,
    pull() { if (!playing) return new Float32Array(0); const c = pcm.subarray(pos, Math.min(pcm.length, pos + 800)); pos += c.length; return c; } };
  const a = new CriLipsAnalyzer(data, source);
  let last = 0;
  for (let f = 0; f < 20; f++) {
    const y1 = a.getOpenInfo().openY;
    playing = false;                                    // the second reader of the frame: no new output
    assert.equal(a.getOpenInfo().openY, y1);
    playing = true;
    last = y1;
  }
  source.paused = true; playing = false;
  assert.ok(a.isAvailable);
  assert.equal(a.getOpenInfo().openY, last);
});

test("story voice hook: one analyzer per voice from the CRI Lips product, the voice's PCM without it", async () => {
  const { startVoiceLipSync } = await import("../../src/story/commands/talk.js");
  const { CriLipsAnalyzer } = await import("../../src/live2d/crilips/index.js");
  const { desc, blob } = synthParts();
  const session = (crilips) => {
    const src = { sampleRate: 48000, pull: () => new Float32Array(0) };
    const p = { ctx: { data: { crilips }, audio: { pcmSource: () => src } },
                session: { activeVoiceLipSync: new Map(), motionSyncVoices: new Map() } };
    const character = () => {
      const c = { isMotionSyncEnabled: false, analyzer: undefined, setLipSyncPresentationMode() {}, setLipSyncEnabled() {} };
      c.setLipsAnalyzer = (a) => { c.analyzer = a; };
      return c;
    };
    return { p, src, character };
  };
  const on = session({ descriptor: desc, data: blob.buffer.slice(0) });
  const info = { id: 1 }, a = on.character(), b = on.character();
  startVoiceLipSync(on.p, a, info, false);
  startVoiceLipSync(on.p, b, info, false);
  assert.ok(a.analyzer instanceof CriLipsAnalyzer);
  assert.equal(b.analyzer, a.analyzer);                  // one analysis per voice
  const other = on.character();
  startVoiceLipSync(on.p, other, { id: 2 }, false);
  assert.notEqual(other.analyzer, a.analyzer);
  const off = session(null), c = off.character();
  startVoiceLipSync(off.p, c, { id: 1 }, false);
  assert.equal(c.analyzer, off.src);                     // no data: the PCM, which has no analysis
  assert.equal(typeof c.analyzer.getOpenInfo, "undefined");
});
