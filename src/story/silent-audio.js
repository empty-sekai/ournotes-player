import { SOUND_CATEGORY, SoundCategoryVolumes } from "../engine/audio.js";

// SilentAudio: the SoundManager of a story session without Web Audio (Node, or a page that plays the story muted).
// It keeps the sounds' timing on the player loop's clock and plays nothing: a cue lasts its length in cues.json
// (samples / sampleRate; a looped cue until stopped), fades end after their duration, and lip sync gets no samples.
// Same interface as Audio (engine/audio.js) as far as the story uses it.
// sounds: false: a story without its sound files; nothing is read and every play finds no sound (SoundManager.Play
// returns -1, onPlayStart is not called).

export class SilentAudio {
  constructor(resolve, loop, { assets, sounds = true }) {
    this.resolve = resolve; this.loop = loop; this.assets = assets; this.sounds = sounds;
    this.playing = new Map();
    this.nextId = 1;
    this.lastBgmOrSeFrame = -1;
    this.categoryVolumes = new SoundCategoryVolumes(null);
  }

  getVolume(name) { return this.categoryVolumes.get(name); }
  changeVolume(name, v) { this.categoryVolumes.change(name, v); }
  restoreVolume(name) { this.categoryVolumes.change(name, 1); }
  async resume() {}
  async suspend() {}

  cueOf(soundId) {
    const c = this.resolve(soundId);
    const meta = this.assets.json(`audio/${c.sheet}/cues.json`)[c.cue];
    if (!meta) throw new Error(`cue ${c.cue} not in ${c.sheet}`);
    return { ...c, meta };
  }

  async preload(soundIds) { if (this.sounds) for (const id of soundIds) this.cueOf(id); }

  play(soundId, { isAutoCrossFade = false, crossFade = 0.3, startSec = 0, speed = 1, onPlayStart = null, loop = false } = {}) {
    if (!this.sounds) return -1;
    const c = this.cueOf(soundId);
    if (isAutoCrossFade && c.category === SOUND_CATEGORY.Bgm)
      for (const i of [...this.playing.values()]) if (i.category === SOUND_CATEGORY.Bgm) this._stopInfo(i, true, crossFade);
    const length = Math.max(0, c.meta.samples / c.meta.sampleRate - Math.trunc(startSec * 1000) / 1000) / speed;
    const info = { id: this.nextId++, soundId, category: c.category, cue: c, meta: c.meta, onFinished: [],
                   stopped: false, end: loop ? Infinity : this.loop.time + length, t0: this.loop.time };
    if (onPlayStart) onPlayStart(info);
    this.playing.set(info.id, info);
    return info.id;
  }

  get(id) { return this.playing.get(id) || null; }
  isPlaying(id) { return this.playing.has(id); }
  whenFinished(info) { return info.stopped ? Promise.resolve() : new Promise((res) => info.onFinished.push(res)); }

  _stopInfo(info, fadeOut, dur) {
    if (fadeOut && dur > 0) { info.end = Math.min(info.end, this.loop.time + dur); return; }
    this._kill(info);
  }

  _kill(info) {
    if (info.stopped) return;
    info.stopped = true;
    this.playing.delete(info.id);
    for (const fn of info.onFinished) fn();
  }

  stop(id, fadeOut = false, dur = 0.3) { const i = this.playing.get(id); if (i) this._stopInfo(i, fadeOut, dur); }

  stopAll(category, fadeOut = false, dur = 0.3) {
    for (const i of [...this.playing.values()])
      if (category === SOUND_CATEGORY.All || i.category === category) this._stopInfo(i, fadeOut, dur);
  }

  // once per frame (Update phase): sounds past their end finish
  update() { for (const i of [...this.playing.values()]) if (this.loop.time >= i.end) this._kill(i); }

  pcmSource() { return { sampleRate: 48000, pull: () => new Float32Array(0) }; }
}
