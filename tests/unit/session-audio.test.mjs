// The live audio on a page's AudioContext at any sample rate (src/live/sound.js, src/engine/audio.js) and the
// session's audio at the end of the chart (src/live/session.js). A fake AudioContext decodes as browsers do: into its
// own sample rate, the length scaled from the file's rate; its buffers hold each frame's position at the file's rate,
// so the frames a trim keeps can be read back. Synthetic sounds only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { framesAt } from "../../src/engine/audio.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { ChartSession } from "../../src/live/session.js";
import { LiveAudio } from "../../src/live/sound.js";
import { HeadlessAudioContext, headlessGL } from "../../scripts/lib/headless.mjs";

const param = (v) => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = (extra = {}) => ({ connect(d) { return d; }, disconnect() {}, ...extra });
const buffer = (channels, length, sampleRate) => {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
           getChannelData: (ch) => data[ch], copyToChannel: (src, ch) => data[ch].set(src) };
};

// files: first byte of the file -> { rate, frames } (the frames a decoder returns, at the file's rate)
class FakeAudioContext {
  constructor(sampleRate, files) {
    this.sampleRate = sampleRate; this.files = files; this.state = "running"; this.t = 0; this.destination = node();
    this.sources = []; this.calls = [];
  }
  get currentTime() { return this.t; }
  resume() { this.calls.push("resume"); this.state = "running"; return Promise.resolve(); }
  suspend() { this.calls.push("suspend"); this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  getOutputTimestamp() { return { contextTime: this.t, performanceTime: performance.now() + 1e6 }; }   // no extrapolation
  createGain() { return node({ gain: param(1) }); }
  createBuffer(channels, length, rate) { return buffer(channels, length, rate); }
  createBufferSource() {
    const s = node({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), onended: null,
                     start(when, offset) { this.started = [when, offset]; }, stop() {} });
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(ab) {
    const f = this.files[new Uint8Array(ab)[0]], R = this.sampleRate;
    const n = f.rate === R ? f.frames : Math.floor(f.frames * R / f.rate);    // resampled into the context's rate
    const b = buffer(2, n, R);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = i * f.rate / R; }
    return b;
  }
}

const MUSIC = { file: "audio/M/music.m4a", sampleRate: 48000, channels: 2, samples: 96000, loopFlag: 0, loopStart: null,
                loopEnd: null, volume: 1, encoderDelay: 2112 };
const HOLD = { file: "audio/S/hold.flac", sampleRate: 48000, channels: 2, samples: 48000, loopFlag: 2, loopStart: 12000,
               loopEnd: 36000, volume: 1 };
const data = {
  sounds: {
    1: { sheet: "M", cue: "music", category: 0, categories: ["LiveBgm"], volume: 1, row: { _isRandomPitch: false }, layers: [MUSIC] },
    2: { sheet: "S", cue: "hold", category: 1, categories: ["LiveSe"], volume: 1, row: { _isRandomPitch: false }, layers: [HOLD] },
  },
  categories: { LiveBgm: 1, LiveSe: 1 }, react: [], music: { soundId: 1 },
  noteSe: { types: { 7: 2 }, volumes: {}, mutes: {} }, liveSe: {}, timeline: { startCheerDelaySec: 1 },
};
const assets = () => new AssetStore({ bytes: { [MUSIC.file]: new Uint8Array([1]), [HOLD.file]: new Uint8Array([2]) } });

// a decoder that ignores the MP4 edit list returns the priming frames and the last frame's padding too
const PRIMED = { 1: { rate: 48000, frames: 96000 + 2112 + 704 }, 2: { rate: 48000, frames: 48000 } };
const TRIMMED = { 1: { rate: 48000, frames: 96000 }, 2: { rate: 48000, frames: 48000 } };

const open = async (rate, files = PRIMED) => {
  const ctx = new FakeAudioContext(rate, files);
  const audio = new LiveAudio(new PlayerLoop(60), data, { assets: assets(), context: ctx });
  await audio.load();
  return { ctx, audio, music: audio.sm.layerBuffers.get(MUSIC.file), hold: audio.sm.layerBuffers.get(HOLD.file) };
};

test("framesAt: frame counts between sample rates, unchanged at equal rates", () => {
  assert.equal(framesAt(96000, 48000, 48000), 96000);
  assert.equal(framesAt(2112, 48000, 44100), 1940);                      // 1940.4
  assert.equal(framesAt(98112, 48000, 44100, Math.floor), 90140);        // 90140.4
  assert.equal(framesAt(96000, 48000, 96000), 192000);
});

test("48 kHz context: the encoder delay is dropped and `samples` frames are kept, as before", async () => {
  const { music, hold } = await open(48000);
  assert.equal(music.sampleRate, 48000);
  assert.equal(music.length, MUSIC.samples);
  const d = music.getChannelData(1);
  assert.equal(d[0], MUSIC.encoderDelay);                                 // the frame after the priming frames
  assert.equal(d[MUSIC.samples - 1], MUSIC.encoderDelay + MUSIC.samples - 1);
  assert.equal(hold.length, HOLD.samples);                                // no encoder delay: kept as decoded
});

test("44.1 kHz context: the trim is scaled to the context's rate; the kept audio spans the same time", async () => {
  const { music, hold } = await open(44100);
  assert.equal(music.sampleRate, 44100);
  assert.equal(music.length, 88200);                                      // 96000 x 44100 / 48000
  assert.equal(music.duration, MUSIC.samples / MUSIC.sampleRate);         // 2 s at either rate
  const d = music.getChannelData(0);
  assert.ok(Math.abs(d[0] - MUSIC.encoderDelay) < 1, `first kept frame at ${d[0]} (48 kHz frames)`);
  assert.ok(Math.abs(d[music.length - 1] - (MUSIC.encoderDelay + MUSIC.samples - 1)) < 2);
  assert.equal(hold.length, 44100);
});

test("a decoder that applies the edit list: nothing is dropped at either rate", async () => {
  for (const rate of [48000, 44100]) {
    const { music } = await open(rate, TRIMMED);
    assert.equal(music.getChannelData(0)[0], 0, `${rate} Hz`);
    assert.equal(music.length, framesAt(MUSIC.samples, 48000, rate, Math.floor));
  }
});

test("loop points, start offsets and the music clock are the same at 48 and 44.1 kHz", async () => {
  const seen = [];
  for (const rate of [48000, 44100]) {
    const { ctx, audio } = await open(rate);
    audio.startMusic();
    ctx.t = 5;
    audio.seek(1.5, false);                                              // the music restarted at 1.5 s, now
    ctx.t = 6;
    const uid = audio.sm.play(2, { loop: true, kind: "noteSe" });
    const hold = ctx.sources.at(-1);
    seen.push({ lengthMs: audio.musicLengthMs(), sec: audio.musicSec(), ms: audio.musicTimeMs(),
                loop: [hold.loop, hold.loopStart, hold.loopEnd], start: ctx.sources.at(-2).started, uid: uid > 0 });
  }
  assert.deepEqual(seen[0], { lengthMs: 2000, sec: 2.5, ms: 2500, loop: [true, 0.25, 0.75], start: [5, 1.5], uid: true });
  assert.deepEqual(seen[1], seen[0]);
});

test("the headless AudioContext decodes into its own sample rate", async () => {
  const flac = new Uint8Array(42);
  flac.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);                     // "fLaC", last metadata block STREAMINFO
  const s = flac.subarray(8), rate = 48000, samples = 96000;
  s[10] = rate >> 12; s[11] = (rate >> 4) & 0xff; s[12] = ((rate & 15) << 4) | (1 << 1) | 1;   // 2 channels, 16 bits
  s[13] = 15 << 4; s[14] = samples >>> 24; s[15] = (samples >> 16) & 0xff; s[16] = (samples >> 8) & 0xff; s[17] = samples & 0xff;
  const at = async (r) => new HeadlessAudioContext({ sampleRate: r }).decodeAudioData(flac.buffer.slice(0));
  assert.deepEqual(await at(48000).then((b) => [b.sampleRate, b.length, b.numberOfChannels]), [48000, 96000, 2]);
  assert.deepEqual(await at(44100).then((b) => [b.sampleRate, b.length]), [44100, 88200]);
});

test("ChartSession accepts an AudioContext at any sample rate", async () => {
  for (const rate of [44100, 48000, 96000]) {
    const ctx = new FakeAudioContext(rate, PRIMED);
    // an empty store: the session fails on its first file, not on the context
    await assert.rejects(ChartSession.create({ gl: headlessGL(), assets: new AssetStore(), audioContext: ctx }),
                         /asset not found: live\.json/);
  }
});

// the finish cheer of the chart: a looping sound still playing when the chart ends
const audioPlays = (s) => { s.audio.sm.play(2, { loop: true, kind: "se" }); };

// the session's own step / play over a stand-in for the chart: `_step` ends the chart, `seek` restarts it
const endingSession = async () => {
  const { ctx, audio } = await open(48000);
  const s = Object.create(ChartSession.prototype);
  Object.assign(s, { disposed: false, paused: false, holdStart: false, state: "playing", chartMs: 1000, audio });
  s._step = async () => { s.steps = (s.steps || 0) + 1; if (s.steps === 3) s.state = "ended"; };
  s.seek = async () => { s.state = "playing"; s.steps = 0; return 0; };
  return { s, ctx };
};

test("the AudioContext is suspended by the step that ends the chart, and resumed by play()", async () => {
  const { s, ctx } = await endingSession();
  audioPlays(s);
  await s.step();
  await s.step();
  assert.equal(ctx.state, "running", "playing: the context runs");
  assert.deepEqual(ctx.calls, []);
  await s.step();                                                         // the chart ends
  assert.equal(s.state, "ended");
  assert.equal(ctx.state, "suspended");
  await s.step();                                                         // further steps: it stays suspended
  assert.deepEqual(ctx.calls, ["suspend"]);
  await s.play();                                                         // from the start again
  assert.equal(s.state, "playing");
  assert.equal(ctx.state, "running");
  assert.equal(s.paused, false);
});
