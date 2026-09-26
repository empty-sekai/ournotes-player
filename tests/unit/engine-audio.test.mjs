// engine/audio.js additions over a stand-in AudioContext: the playback speed rule, the option ("<Cat>Config") volumes
// and a voice played time-stretched; engine/timestretch.js on synthetic PCM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Audio, playbackSpeed } from "../../src/engine/audio.js";
import { timeStretch } from "../../src/engine/timestretch.js";

const F = Math.fround;

const fakeContext = () => {
  const param = (v) => ({ value: v, setValueAtTime(x) { this.value = x; } });
  const buffer = (chs, len, sampleRate) => {
    const data = Array.from({ length: chs }, () => new Float32Array(len));
    return { numberOfChannels: chs, length: len, sampleRate, getChannelData: (i) => data[i], copyToChannel: (x, i) => data[i].set(x) };
  };
  return {
    sampleRate: 48000, currentTime: 0, state: "running", destination: {},
    createGain() { return { gain: param(1), connect(n) { return n; } }; },
    createBuffer: buffer,
    createBufferSource() {
      const s = { buffer: null, loop: false, playbackRate: param(1), started: null,
                  connect(n) { return n; }, start(t, off) { s.started = [t, off]; }, stop() {} };
      this.sources.push(s);
      return s;
    },
    sources: [],
    buffer,
  };
};

test("playbackSpeed: [0.25, 3], within max(|s|, 1) x 1e-6 of 1 plays as is", () => {
  assert.equal(playbackSpeed(1), 1);
  assert.equal(playbackSpeed(1.0000001), 1);
  assert.equal(playbackSpeed(1.5), 1.5);
  assert.equal(playbackSpeed(2), 2);
  assert.equal(playbackSpeed(0.25), 0.25);
  assert.equal(playbackSpeed(3), 3);
  assert.throws(() => playbackSpeed(3.5), /outside/);
  assert.throws(() => playbackSpeed(0.2), /outside/);
  assert.throws(() => playbackSpeed(NaN), /outside/);
});

test("option volumes multiply the category bus; All scales by DefaultVolume, a name sets it as is", () => {
  const ctx = fakeContext();
  const a = new Audio(() => null, { time: 0 }, { context: ctx });
  assert.equal(a.buses[0].gain.value, 0.7);                  // Bgm default, option 1
  a.setOptionVolume("Bgm", 0.5);
  assert.equal(a.getOptionVolume("Bgm"), 0.5);
  assert.equal(a.buses[0].gain.value, F(F(0.7) * 0.5));
  a.changeVolume("Bgm", 0.5);                                // the SoundVolume command's category volume
  assert.equal(a.buses[0].gain.value, F(F(F(0.7) * 0.5) * 0.5));
  a.setOptionVolume("All", 1);
  assert.equal(a.getOptionVolume("Bgm"), F(0.7));            // ChangeConfigVolumeAll: DefaultVolume x v
  assert.equal(a.getOptionVolume("Voice"), 1);
  a.restoreOptionVolume("Bgm");
  assert.equal(a.getOptionVolume("Bgm"), 1);
  assert.equal(a.buses[0].gain.value, F(F(0.7) * 0.5));
  assert.ok(Number.isNaN(a.getOptionVolume("Nope")));
});

test("a cue at playback speed 2 plays a time-stretched buffer; the synced time runs at the speed", () => {
  const ctx = fakeContext();
  const src = ctx.buffer(1, 48000, 48000);
  const x = src.getChannelData(0);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
  const cue = { sheet: "s", cue: "c", category: 2, row: {} };
  const a = new Audio(() => cue, { time: 0 }, { context: ctx });
  a.buffers.set("s/c", { buf: src, meta: { sampleRate: 48000, samples: 48000 } });
  const id = a.play(1, { speed: 2, crossFade: 0 });
  const info = a.get(id);
  assert.equal(info.rate, 2);
  assert.equal(ctx.sources[0].buffer.length, 24000);
  assert.equal(ctx.sources[0].playbackRate.value, 1);         // the pitch is kept
  const same = a.play(1, { speed: 2, crossFade: 0 });
  assert.equal(ctx.sources[1].buffer, ctx.sources[0].buffer); // made once per cue and speed
  a.stop(same);
  const pcm = a.pcmSource(info);
  ctx.currentTime = 0.1;
  assert.equal(pcm.pull().length, 4800);
  const plain = a.play(1, { crossFade: 0 });
  assert.equal(ctx.sources[2].buffer, src);
  assert.equal(a.get(plain).rate, 1);
});

test("timeStretch keeps the length ratio and the pitch of a sine", () => {
  const sr = 48000, n = sr, f = 300;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / sr);
  for (const speed of [0.5, 1.5, 2]) {
    const [y] = timeStretch([x], sr, speed);
    assert.equal(y.length, Math.round(n / speed));
    // zero crossings per second stay at 2 f (the pitch), counted away from the edges
    let z = 0;
    const a = Math.round(0.1 * sr), b = y.length - Math.round(0.1 * sr);
    for (let i = a + 1; i < b; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) z++;
    const rate = z / ((b - a) / sr);
    assert.ok(Math.abs(rate - 2 * f) < 0.05 * 2 * f, `speed ${speed}: ${rate} crossings/s`);
  }
});
