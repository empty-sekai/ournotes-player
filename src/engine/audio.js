// Audio: sound playback with the game's SoundManager semantics over decoded CRI cues
// (audio/<cueSheet>/<cue>.flac + cues.json), and SoundCategoryVolumes (the CRI category volumes).
//
// A master sound id resolves to {sheet, cue, category, row} through the resolver
// passed to the constructor (LiveSoundManager: the sounds of live-audio.json). The row
// is a MasterSound record ({_category, _soundCueSheetID, _cueName, ...}).
// Fades are linear on the source volume and advanced once per
// frame from the player loop's time (SoundPlayer.UpdateSound / UpdateFade).
// Category bus gains are SoundVolumeSettings.DefaultVolume x option volume
// (Bgm 0.7, Se 1.0, Voice 1.0 with default options).

export const SOUND_CATEGORY = { Bgm: 0, Se: 1, Voice: 2, NotesSe: 3, All: 9999 };

// Sample frames at another sample rate. The cue data counts frames at the waveform's own rate (48 kHz in the data);
// decodeAudioData resamples to the AudioContext's rate, so n frames at `from` are n x to / from frames of the decoded
// buffer (rounded by `round`). At equal rates the count is n itself. Times in seconds (loop points, start offsets, the
// audio-synced time) do not depend on the rate.
export const framesAt = (n, from, to, round = Math.round) => (from === to ? n : round(n * to / from));
export const SOUND_BUS_GAIN = { 0: 0.7, 1: 1.0, 2: 1.0 };

// Fwk.Sound.SoundVolume over the CRI category volumes. SoundVolumeSettings gives each category name its
// DefaultVolume; SoundManager.Boot calls ChangeVolume("All", 1.0), so every category starts at DefaultVolume.
//   ChangeVolume: "All" (SoundCategoryNames.All) -> ChangeVolumeAll (every settings entry);
//     a settings name (exact, case-sensitive dictionary lookup, SoundVolumeSettings.Get) ->
//     CriAtomExCategory.SetVolume(name, DefaultVolume x v); any other name -> LogWarning, no change.
//   GetVolume = CriAtomExCategory.GetVolume(name): the category's current volume, i.e. DefaultVolume x v.
//   RestoreVolume = ChangeVolume(name, 1).
// ENGINE: CriAtomExCategory keeps its volumes in the native CRI library; GetVolume returns the float last set.
// The bus of a category plays at category volume x the option volume ("<Cat>Config", 1.0 with default options).
// ENGINE: CRI combines the category and option volumes natively; they are multiplied here.
export const SOUND_VOLUME_SETTINGS = { Bgm: 0.7, Se: 1.0, Voice: 1.0, LiveBgm: 1.0, LiveSe: 1.0, LiveNotesSe: 1.0, LiveVoice: 1.0 };
export const SOUND_CATEGORY_NAME = { 0: "Bgm", 1: "Se", 2: "Voice" };        // SoundCategory enum names
export class SoundCategoryVolumes {
  constructor(onChange) {
    this.onChange = onChange;               // (name, volume) after a CRI category volume changed
    this.volumes = {};
    for (const [name, d] of Object.entries(SOUND_VOLUME_SETTINGS)) this.volumes[name] = Math.fround(d);
  }

  // an unknown name has no managed value (the native getter's result for it is unknown): NaN; its only
  // caller (the SoundVolume fade) hands it back to change(), which ignores unknown names
  get(name) { return Object.prototype.hasOwnProperty.call(this.volumes, name) ? this.volumes[name] : NaN; }

  change(name, v) {
    if (name === "All") { for (const n of Object.keys(SOUND_VOLUME_SETTINGS)) this._set(n, v); return; }
    if (!Object.prototype.hasOwnProperty.call(SOUND_VOLUME_SETTINGS, name)) {
      console.warn(`Sound category ${name} not found in settings`);
      return;
    }
    this._set(name, v);
  }

  _set(name, v) {
    this.volumes[name] = Math.fround(Math.fround(SOUND_VOLUME_SETTINGS[name]) * Math.fround(v));
    if (this.onChange) this.onChange(name, this.volumes[name]);
  }
};

export class Audio {
  constructor(resolve, loop, { context = null, assets = null } = {}) {
    this.ownsContext = !context;
    this.assets = assets;
    // the cues are 48 kHz: an own context at that rate decodes without resampling; a given context may run at any rate
    this.ctx = context || new AudioContext({ sampleRate: 48000 });
    this.resolve = resolve;
    this.loop = loop;
    this.buffers = new Map();
    this.buses = {};
    for (const [cat, g] of Object.entries(SOUND_BUS_GAIN)) {
      const n = this.ctx.createGain();
      n.gain.value = g;
      n.connect(this.ctx.destination);
      this.buses[cat] = n;
    }
    this.nextId = 1;
    this.playing = new Map();         // uniqueSoundId -> info
    this.lastBgmOrSeFrame = -1;
    this.categoryVolumes = new SoundCategoryVolumes((name, v) => {
      const cat = Object.keys(SOUND_CATEGORY_NAME).find((k) => SOUND_CATEGORY_NAME[k] === name);
      if (cat !== undefined && this.buses[cat]) this.buses[cat].gain.setValueAtTime(v, this.ctx.currentTime);
    });
  }

  // ISoundVolumeManager slots 0 / 1 / 2 (SoundManager.GetVolume, ChangeVolume, RestoreVolume)
  getVolume(name) { return this.categoryVolumes.get(name); }
  changeVolume(name, v) { this.categoryVolumes.change(name, v); }
  restoreVolume(name) { this.categoryVolumes.change(name, 1); }

  async resume() {
    if (this.ctx.state === "running") return;
    await this.ctx.resume();
    this.resumedAt = performance.now();        // output timestamps taken before this are stale (see syncedTime)
  }

  // AudioContext.suspend: every source and the context clock stop together (the player's pause)
  async suspend() { if (this.ctx.state === "running") await this.ctx.suspend(); }

  cueOf(soundId) {
    const c = this.resolve(soundId);
    if (c.row._isRandomPitch) throw new Error(`${c.cue}: random pitch not implemented`);
    return c;
  }

  async preload(soundIds) {
    for (const id of soundIds) {
      const c = this.cueOf(id), key = `${c.sheet}/${c.cue}`;
      if (this.buffers.has(key)) continue;
      const meta = this.assets.json(`audio/${c.sheet}/cues.json`)[c.cue];
      if (!meta) throw new Error(`cue ${c.cue} not decoded in ${c.sheet}`);
      // decoded at the context's rate; the loop points below are converted to seconds with the cue's own rate
      const buf = await this.ctx.decodeAudioData(this.assets.arrayBuffer(`audio/${c.sheet}/${meta.file}`));
      this.buffers.set(key, { buf, meta });
    }
  }

  // SoundPlayer.Play; returns the unique sound id (synchronous)
  play(soundId, { isAutoCrossFade = false, crossFade = 0.3, startSec = 0, speed = 1, onPlayStart = null, loop = false,
                  forceFadeIn = false, volume = 1 } = {}) {
    const c = this.cueOf(soundId);
    const entry = this.buffers.get(`${c.sheet}/${c.cue}`);
    if (!entry) throw new Error(`cue ${c.cue} not preloaded`);
    if (speed !== 1) throw new Error("playback speed other than 1 not implemented");
    if (isAutoCrossFade && c.category === SOUND_CATEGORY.Bgm) {
      forceFadeIn = true;
      for (const i of [...this.playing.values()]) if (i.category === SOUND_CATEGORY.Bgm) this._stopInfo(i, true, crossFade);
    }
    const bus = this.buses[c.category];
    if (!bus) throw new Error(`sound category ${c.category}`);
    const info = { id: this.nextId++, soundId, category: c.category, cue: c, meta: entry.meta, buf: entry.buf,
                   fade: 0, fadeStart: 0, fadeDur: 0, finished: false, stopped: false, onFinished: [],
                   gain: this.ctx.createGain(), src: null, startCtx: 0, startSample: 0, startOffsetSec: 0 };
    if (crossFade > 0 && forceFadeIn) { info.fade = 1; info.fadeStart = this.loop.time; info.fadeDur = crossFade; }
    if (onPlayStart) onPlayStart(info);
    // SoundInfo.Play -> ChangeVolume(volume) -> SoundSource.Play(start ms truncated)
    const src = this.ctx.createBufferSource();
    src.buffer = entry.buf;
    if (loop) {                         // FORCE_LOOP: the waveform's loop region, else the whole waveform
      src.loop = true;
      if (entry.meta.loopStart != null) {
        src.loopStart = entry.meta.loopStart / entry.meta.sampleRate;
        src.loopEnd = entry.meta.loopEnd / entry.meta.sampleRate;
      }
    }
    info.gain.gain.value = volume;
    src.connect(info.gain).connect(bus);
    src.onended = () => { info.finished = true; };
    const start = Math.trunc(startSec * 1000) / 1000;
    info.startCtx = this.ctx.currentTime;
    info.startSample = Math.round(start * entry.meta.sampleRate);   // in frames at the cue's own rate
    info.startOffsetSec = start;
    src.start(info.startCtx, start);
    info.src = src;
    this.playing.set(info.id, info);
    return info.id;
  }

  get(id) { return this.playing.get(id) || null; }

  // CriAtomExPlayback.GetTimeSyncedWithAudio (seconds): the playback position of the sample being output now.
  // ENGINE: CRI's audio-synced timer is native; the AudioContext output timestamp stands in for it.
  // getOutputTimestamp gives the context time at the output, extrapolated to now on the performance clock, so the
  // position includes the output latency as a device-synced timer does. Before the first sample is output it is < 0.
  // After a resume the timestamp keeps its pre-suspension performanceTime until the context outputs again; such a
  // timestamp is not extrapolated. i.rate: the source's playbackRate (playback speed; 1 otherwise).
  syncedTime(id) {
    const i = this.playing.get(id);
    if (!i) return null;
    const ts = this.ctx.getOutputTimestamp();
    const fresh = !(this.resumedAt > ts.performanceTime);
    const ct = ts.contextTime + (fresh ? Math.max(0, performance.now() - ts.performanceTime) / 1000 : 0);
    return i.startOffsetSec + (ct - i.startCtx) * (i.rate || 1);
  }
  isPlaying(id) { const i = this.playing.get(id); return !!i && !i.finished; }

  // ISoundInfo.RegisterPlayFinishedFunction / IsPlayFinished as a promise
  whenFinished(info) { return info.stopped ? Promise.resolve() : new Promise((res) => info.onFinished.push(res)); }

  _stopInfo(info, fadeOut, dur) {       // StopSound
    if (fadeOut && dur > 0) { info.fade = 2; info.fadeStart = this.loop.time; info.fadeDur = dur; return; }
    this._kill(info);
  }

  _kill(info) {
    if (info.stopped) return;
    info.stopped = true;
    try { info.src.stop(); } catch (_) { /* already ended */ }
    this.playing.delete(info.id);
    for (const fn of info.onFinished) fn();
  }

  stop(id, fadeOut = false, dur = 0.3) { const i = this.playing.get(id); if (i) this._stopInfo(i, fadeOut, dur); }

  stopAll(category, fadeOut = false, dur = 0.3) {
    for (const i of [...this.playing.values()])
      if (category === SOUND_CATEGORY.All || i.category === category) this._stopInfo(i, fadeOut, dur);
  }

  // SoundPlayer.UpdateSound / UpdateFade, once per frame (Update phase)
  update() {
    const t = this.loop.time;
    for (const i of [...this.playing.values()]) {
      if (i.finished) { this._kill(i); continue; }
      if (i.fade === 2) {
        const v = 1 - (t - i.fadeStart) / i.fadeDur;
        if (v <= 0) { this._kill(i); continue; }
        i.gain.gain.setValueAtTime(v, this.ctx.currentTime);
      } else if (i.fade === 1) {
        let v = (t - i.fadeStart) / i.fadeDur;
        if (v >= 1) { v = 1; i.fade = 0; }
        i.gain.gain.setValueAtTime(v, this.ctx.currentTime);
      }
    }
  }
};
