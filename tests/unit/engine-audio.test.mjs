// engine/audio.js additions over a stand-in AudioContext: the playback speed rule, the option ("<Cat>Config") volumes,
// a voice played time-stretched and the movie bus of the videos' sound; engine/timestretch.js on synthetic PCM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Audio, SOUND_CATEGORY, busOf, playbackSpeed } from "../../src/engine/audio.js";
import { timeStretch } from "../../src/engine/timestretch.js";

const F = Math.fround;

const fakeContext = () => {
  const param = (v) => ({ value: v, setValueAtTime(x) { this.value = x; } });
  const buffer = (chs, len, sampleRate) => {
    const data = Array.from({ length: chs }, () => new Float32Array(len));
    return { numberOfChannels: chs, length: len, sampleRate, duration: len / sampleRate, getChannelData: (i) => data[i],
             copyToChannel: (x, i) => data[i].set(x) };
  };
  return {
    sampleRate: 48000, currentTime: 0, state: "running", destination: {},
    createGain() { return { gain: param(1), to: null, connect(n) { this.to = n; return n; } }; },
    createMediaElementSource(el) {
      const n = { el, to: null, connect(x) { n.to = x; return x; }, disconnect() { n.to = null; } };
      this.media.push(n);
      return n;
    },
    media: [],
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

test("episode sound preload uses the cue product's resolved waveform path", async () => {
  const meta = { file: "sounds/sheet-a/waveforms/voice.flac", sampleRate: 48000, samples: 48000, categories: ["Voice"] };
  const episode = { sounds: { 7: { _soundCueSheetID: 3, _cueName: "hello", _category: 0 } },
    cuesheets: { 3: { _cueSheetName: "sheet-a" } } };
  const reads = [], context = fakeContext();
  context.decodeAudioData = async () => context.buffer(1, 48000, 48000);
  const resolve = Audio.episodeResolver(episode, { cues: (name) => {
    assert.equal(name, "sheet-a"); return { hello: meta };
  } });
  const audio = new Audio(resolve, { time: 0 }, { context, assets: {
    arrayBuffer: (path) => { reads.push(path); return new ArrayBuffer(0); },
  } });
  await audio.preload([7, 7]);
  assert.deepEqual(reads, [meta.file]);
  assert.equal(audio.buffers.get("sheet-a/hello").meta, meta);
  const id = audio.play(7);
  assert.equal(audio.get(id).gain.to, audio.buses[SOUND_CATEGORY.Voice]);
  assert.equal(audio.get(id).category, SOUND_CATEGORY.Bgm);
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

test("a cue plays on the bus of its sheet's CRI categories; its row's category decides what stopAll reaches", () => {
  const ctx = fakeContext(), loop = { time: 0 };
  const cue = { sheet: "s", cue: "c", category: SOUND_CATEGORY.Bgm, row: {} };     // a voice cue whose row says Bgm
  const a = new Audio(() => cue, loop, { context: ctx });
  const put = (categories) => a.buffers.set("s/c", { buf: ctx.buffer(1, 48000, 48000),
    meta: { sampleRate: 48000, samples: 48000, ...(categories ? { categories } : {}) } });
  put(["Voice", "VoiceConfig"]);
  const voice = a.get(a.play(1, { crossFade: 0 }));
  put(null);
  const row = a.get(a.play(1, { crossFade: 0 }));
  assert.deepEqual([voice.gain.to === a.buses[SOUND_CATEGORY.Voice], row.gain.to === a.buses[SOUND_CATEGORY.Bgm]], [true, true]);
  assert.deepEqual([voice.category, row.category], [SOUND_CATEGORY.Bgm, SOUND_CATEGORY.Bgm]);
  a.stopAll(SOUND_CATEGORY.Bgm);
  assert.deepEqual([a.isPlaying(voice.id), a.isPlaying(row.id)], [false, false]);
  a.setOptionVolume("Bgm", 0);
  put(["Voice", "VoiceConfig"]);
  a.play(1, { crossFade: 0 });
  assert.equal(a.buses[SOUND_CATEGORY.Voice].gain.value, 1);
  assert.equal(busOf({ categories: ["Other", "Se"] }, SOUND_CATEGORY.Bgm), SOUND_CATEGORY.Se);
  assert.equal(busOf({ categories: ["Other"] }, SOUND_CATEGORY.Voice), SOUND_CATEGORY.Voice);
});

test("a video's sound: on the movie bus at the movie volume, which no category or option volume changes", () => {
  const ctx = fakeContext();
  const a = new Audio(() => null, { time: 0 }, { context: ctx });
  const el = {}, media = a.connectMedia(el);
  assert.deepEqual([ctx.media[0].el === el, ctx.media[0].to === a.movieBus, a.movieBus.gain.value], [true, true, 1]);
  a.setOptionVolume("All", 0); a.changeVolume("All", 0);
  assert.equal(a.movieBus.gain.value, 1);
  a.setMovieVolume(0.25);
  assert.deepEqual([a.movieVolume, a.movieBus.gain.value], [0.25, 0.25]);
  a.setMovieVolume(3);
  assert.equal(a.movieBus.gain.value, 1);
  media.disconnect();
  assert.equal(ctx.media[0].to, null);
});

test("a fast-forward: muted, sounds end by game time; after it the sounds still playing restart at their game position", () => {
  const ctx = fakeContext(), loop = { time: 10 };
  const cue = { sheet: "s", cue: "c", category: 1, row: {} };
  const a = new Audio(() => cue, loop, { context: ctx });
  a.buffers.set("s/c", { buf: ctx.buffer(1, 48000 * 4, 48000), meta: { sampleRate: 48000, samples: 48000 * 4 } });
  a.setFastForward(true);
  assert.equal(a.master.gain.value, 0);
  const early = a.play(1, { crossFade: 0 });                              // 4 s long, started at 10 s
  loop.time = 12;
  const late = a.play(1, { crossFade: 0, startSec: 1 });                  // 3 s left, started at 12 s
  const looped = a.play(1, { crossFade: 0, loop: true });
  ctx.sources[0].onended();                                               // the audio clock: no effect in a fast-forward
  a.update();
  assert.deepEqual([a.isPlaying(early), a.isPlaying(late)], [true, true]);
  loop.time = 14;                                                         // its 4 s have passed: over before the update
  assert.deepEqual([a.isPlaying(early), a.playing.has(early)], [false, true]);
  loop.time = 14.5;
  a.update();
  assert.deepEqual([a.isPlaying(early), a.playing.has(early), a.isPlaying(late), a.isPlaying(looped)], [false, false, true, true]);
  ctx.currentTime = 0.4;
  a.setFastForward(false);
  assert.equal(a.master.gain.value, 1);
  const n = ctx.sources.length;
  assert.deepEqual(ctx.sources.slice(n - 2).map((s) => s.started), [[0.4, 3.5], [0.4, 2.5]]);   // 1 + 2.5 s; 2.5 s looped
  assert.equal(a.get(late).startOffsetSec, 3.5);
  loop.time = 16.5;                                                       // 5.5 s into the cue: past its end
  a.setFastForward(true); a.setFastForward(false);
  assert.equal(a.isPlaying(late), false);
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

test("a PCM source made in onPlayStart outputs nothing before the start, then the samples from the play position", () => {
  const ctx = fakeContext();
  const src = ctx.buffer(1, 48000, 48000);
  const x = src.getChannelData(0);
  for (let i = 0; i < x.length; i++) x[i] = i + 1;
  const cue = { sheet: "s", cue: "c", category: 2, row: {} };
  const a = new Audio(() => cue, { time: 0 }, { context: ctx });
  a.buffers.set("s/c", { buf: src, meta: { sampleRate: 48000, samples: 48000 } });
  ctx.currentTime = 4;
  for (const speed of [1, 2]) {
    let pcm = null, drained = null;
    const id = a.play(1, { speed, startSec: 0.25, crossFade: 0,
                           onPlayStart: (info) => { pcm = a.pcmSource(info); drained = pcm.pull(); } });
    assert.equal(drained.length, 0);                          // the lip sync's drain before the cue starts
    const info = a.get(id);
    assert.equal(pcm.sampleRate, 48000);
    ctx.currentTime += 0.125;
    const got = pcm.pull();
    assert.equal(got.length, 6000);
    const played = info.playBuf.getChannelData(0);
    assert.equal(got[0], played[info.playStart]);
    assert.equal(info.playBuf.length, speed === 1 ? 48000 : 24000);
    if (speed === 1) assert.equal(got[0], 12001);              // 0.25 s into the waveform
    assert.equal(pcm.pull().length, 0);
    assert.deepEqual(Array.from(pcm.latest(2)), [played[info.playStart + 5998], played[info.playStart + 5999]]);
    a.stop(id);
  }
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
