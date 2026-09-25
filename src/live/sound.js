import { Audio } from "../engine/audio.js";

// Live sounds: BGM, note SE, slide-hold loop, start / finish cheers, finish direction SE and character voices, with
// the game's LiveSoundPlayer rules (App.Live.LiveSoundPlayer) on Audio, routed through the CRI categories, cue layers
// and REACT of audio/live-audio.json.
//
//   liveTapSeType(note, judgement)   LiveSoundPlayer.GetTapSeType (gekisou off)
//   LiveSoundPlayer                  the per-frame SE logic; talks to a SoundManager-like `sm` (play / stop)
//   LiveSoundManager                 extends Audio: CRI category buses, layered cues, loop modes, REACT ducking
//   LiveAudio                        the session's facade: load, intro hooks, update(fr), BGM clock helper
//   LiveGameClock                    music position advanced by game time (music off or no audio files)
// LiveSoundPlayer has no WebAudio dependency (a logging stub can stand in for `sm`).
//
// Player features (not in the game): music on / off, sound effects on / off, playback speed of the music
// (AudioBufferSourceNode.playbackRate: the pitch follows the speed; note SE, cheers and voices play at their own
// rate), pause (AudioContext.suspend), seek (the BGM restarted at the position), charts without audio files.

export const LIVE_NOTE_SE = { None: 0, InVain: 1, Good: 2, Great: 3, Perfect: 4, Flick: 5, FlickDirection: 6, Slide: 7, Just: 8,
                    Trace: 9, SlideConnect: 10, GekisouTap: 11, GekisouFlick: 12, GekisouFlickDirection: 13,
                    GekisouSlide: 14 };
export const LIVE_NOTE_SE_COUNT = 15;       // Enum.GetValues(LiveNoteSeType).Length -> _playNoteSeArrayCache / _noteSeCount
export const LIVE_SE = { StartCheers: 9, FinishCheers: 10, LiveClearDirection: 13, FullComboDirection: 14,
               AssistFullComboDirection: 15, AllPerfectDirection: 16 };

// IsEnableSeJudgement: (0x78 >> j) & 1 -> Good 3, Great 4, Perfect 5, Just 6 (Miss, Bad, Pass: no SE)
export const liveSeJudgementEnabled = (j) => j >= 0 && j < 8 && ((0x78 >> j) & 1) === 1;
// GetJudgementSeType: table [2, 3, 4, 8] for judgements 3..6
export const LIVE_JUDGEMENT_SE = { 3: 2, 4: 3, 5: 4, 6: 8 };
export const LIVE_NOTE_DIRECTION = { Normal: 0, Left: 1, Right: 2 };

// GetTapSeType with isSpecialSe = false: NoteExType None (Groove only via LiveExecutor.SetGrooveNote, a
// skill path; no deck) and no gekisou parameter (gekisou disabled).
export const liveTapSeType = (note, judgement) => {
  if (!liveSeJudgementEnabled(judgement)) return 0;
  switch (note.op) {                                            // INote NoteOperateType
    case 1: case 20: case 22: case 101: return LIVE_JUDGEMENT_SE[judgement];
    case 21: return LIVE_NOTE_SE.SlideConnect;
    case 40: case 41: case 42: case 102: {                      // <GetTapSeType>g__GetFlickSeType|71_0
      const d = LIVE_NOTE_DIRECTION[note.direction];
      if (d === undefined) throw new Error(`note ${note.id}: direction ${note.direction}`);
      return d !== 0 ? LIVE_NOTE_SE.FlickDirection : LIVE_NOTE_SE.Flick;
    }
    case 60: case 61: case 62: case 63: case 104: case 105: return LIVE_NOTE_SE.Trace;
    default: return 0;
  }
};

// App.Live.LiveSoundPlayer over a SoundManager-like `sm`:
//   sm.play(soundId, { loop, volume }) -> unique sound id (>= 0) or -1   (Fwk.Sound.SoundManager.Play with
//                                                                        isAutoCrossFade false, crossFade 0.3, start 0)
//   sm.stop(uniqueId, fadeOut, duration)                                 (SoundManager.Stop)
export class LiveSoundPlayer {
  constructor(data, sm) {
    this.sm = sm;
    const ns = data.noteSe;
    const num = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
    this.noteSe = num(ns.types);                 // _noteSeDictionary
    this.noteSeVolume = num(ns.volumes);         // _noteSeVolumeMap
    this.noteSeMute = num(ns.mutes);             // _noteSeMuteMap
    this.se = num(data.liveSe);                  // _seDictionary
    this.cache = new Array(LIVE_NOTE_SE_COUNT).fill(false);  // _playNoteSeArrayCache
    this.longSePlaying = false;                  // the looped Slide SE is playing
    this.longSeId = 0;                           // its unique sound id
    this.currentLongSeType = 0;                  // its LiveNoteSeType
    this.startCheerId = -1;
    this.finishCheerId = -1;
    this.musicId = -1;
    // ILiveDataContainer.Confirm*CharacterVoice ids; -1 when the container has none (Initialize)
    const v = data.voice || {};
    this.voice = { start: v.startVoiceSoundId ?? -1, clear: v.clearVoiceSoundId ?? -1,
                   fullCombo: v.fullComboVoiceSoundId ?? -1, allPerfect: v.allPerfectVoiceSoundId ?? -1 };
    this.musicSoundId = data.music.soundId;
  }

  // PlayNoteSe (the gekisou-trace branch needs _traceIsGekisouThisFrame, never set with gekisou off)
  playNoteSe(type, loop = false) {
    if (type === 0) return -1;
    if (this.noteSeMute.get(type) === true) return -1;
    const volume = this.noteSeVolume.has(type) ? this.noteSeVolume.get(type) : 1.0;
    const id = this.noteSe.get(type);
    if (id === undefined) return -1;
    return this.sm.play(id, { loop, volume, kind: "noteSe", type });
  }

  // PlayNoteSeFromLaneState: one SE per LiveNoteSeType per frame, played in type order after the scan.
  playNoteSeFromFrame(fr) {
    this.cache.fill(false);
    for (const j of fr.judgedNotes) this.cache[liveTapSeType(j.note, j.judgement)] = true;
    // CurrentLaneResultStates == InVain(1) -> cache[1]: empty-lane taps; auto play has none.
    const played = [];
    for (let i = 0; i < LIVE_NOTE_SE_COUNT; i++) {
      if (!this.cache[i]) continue;
      const uid = this.playNoteSe(i, false);
      if (i !== 0) played.push({ type: i, uid });
    }
    return played;
  }

  // UpdateLongLineSe: a looped Slide SE while any long line is held (Playing, Enabled, s <= t < e).
  updateLongLineSe(t, fr) {
    let held = false;
    for (const id of fr.updateLineIds) {
      const L = fr.lineState(id);
      if (L.state !== 1 || !L.enabled || L.line.type !== "long") continue;
      const s = L.tStart, e = L.tEnd;
      held = held || ((s <= t && e !== t) && (t < s || t <= e));
    }
    const type = LIVE_NOTE_SE.Slide;          // GekisouSlide(14) when CurrentPlayingGekisouRangeIndex > 0
    const playing = this.longSePlaying;
    if (!(playing && held) || this.currentLongSeType === type) {
      if (playing && !held) {
        this.stopSe(this.longSeId);
        this.longSePlaying = false;
        this.currentLongSeType = 0;
        return "stop";
      }
      if (!(held && !playing)) return null;
      this.currentLongSeType = type;
      this.longSeId = this.playNoteSe(type, true);
      this.longSePlaying = true;
      return "start";
    }
    this.stopSe(this.longSeId);
    this.longSeId = this.playNoteSe(type, true);
    this.currentLongSeType = type;
    return "restart";
  }

  stopSe(uid) { this.sm.stop(uid, false, 0); }  // StopSe (no fade)

  // player: the SE handles after every non-music sound was stopped (music / sound effects switch, seek)
  forgetSe() {
    this.longSePlaying = false; this.longSeId = 0; this.currentLongSeType = 0;
    this.startCheerId = -1; this.finishCheerId = -1;
  }

  // LivePlayingStateNodeBase.OnUpdateSE (OnUpdateGekisouSE returns: _isEnabledGekisou false)
  onUpdateSE(fr) {
    const se = this.playNoteSeFromFrame(fr);
    const loop = this.updateLongLineSe(fr.timeMs, fr);
    return { se, loop };
  }

  playSe(type) {                                // PlaySe
    const id = this.se.get(type);
    if (id === undefined) return -1;
    return this.sm.play(id, { loop: false, volume: 1.0, kind: "se", type });
  }
  playStartCheer() { this.startCheerId = this.playSe(LIVE_SE.StartCheers); return this.startCheerId; }   // PlayStartCheer
  stopStartCheer(fade = 1) {                                                                                // StopStartCheer
    if (this.startCheerId > -1) { this.sm.stop(this.startCheerId, fade > 0, fade); this.startCheerId = -1; }
  }
  playFinishCheer() { this.finishCheerId = this.playSe(LIVE_SE.FinishCheers); return this.finishCheerId; } // PlayFinishCheer
  stopFinishCheer(fade = 1) {                                                                                 // StopFinishCheer
    if (this.finishCheerId > -1) { this.sm.stop(this.finishCheerId, fade > 0, fade); this.finishCheerId = -1; }
  }
  playVoice(id) { return this.sm.play(id, { loop: false, volume: 1.0, kind: "voice" }); }
  playLiveStartVoice() { return this.playVoice(this.voice.start); }                  // PlayLiveStartVoice
  // LiveSoundPlayer.PlayMusic: SoundManager.Play(id, start 0, speed -1, volume 1)
  playMusic() { this.musicId = this.sm.play(this.musicSoundId, { loop: false, volume: 1.0, kind: "music" }); return this.musicId; }

  // LiveStartStateNodeBase.Enter: StopStartCheer(1), StopFinishCheer(0), then PlayMusic
  startMusic() { this.stopStartCheer(1.0); this.stopFinishCheer(0.0); return this.playMusic(); }

  // PlayFinishVoiceAndCheer (from OnFinishedAllNoteUpdate): voice, finish cheer, direction SE
  playFinishVoiceAndCheer(fr, life = 1) {
    const ap = fr.isAllPerfect, fc = fr.isFullCombo, assist = false;       // assist FC: assist settings off
    if (ap) this.playVoice(this.voice.allPerfect);
    else if (fc || assist) this.playVoice(this.voice.fullCombo);
    else if (life >= 1) this.playVoice(this.voice.clear);
    this.playFinishCheer();
    let t = ap ? 16 : fc ? 14 : assist ? 15 : 13;                          // GetClearDirectionSeType
    if (life < 1) t = 0;
    return this.playSe(t);
  }
};

// Audio with the live's CRI routing. A cue = sequence volume x layers (track x synth volume), each layer one decoded
// waveform; its output goes through the bus of its CRI categories (gain = product of the category volumes, x REACT
// ducking). Only the MasterOut send is rendered.
// ENGINE: CRI's DSP buses are native; the Reverb_short send (a CRIWARE/Reverb bus) is not rendered.
export class LiveSoundManager extends Audio {
  constructor(data, loop, opts) {
    const sounds = data.sounds;
    super((soundId) => {
      const s = sounds[String(soundId)];
      if (!s) throw new Error(`sound ${soundId} not in live-audio.json`);
      return { sheet: s.sheet, cue: s.cue, category: s.category, row: s.row, entry: s };
    }, loop, opts);
    this.data = data;
    this.catBuses = new Map();                  // "A+B" -> GainNode
    this.duck = new Map();                      // dest category -> { level, state, t0 }
    this.layerBuffers = new Map();              // file -> AudioBuffer
    this.musicOff = false;                      // player: the music is not played
    this.seOff = false;                         // player: no sound other than the music is played
    this.musicRate = 1;                         // player: playbackRate of the music
  }

  _catBus(cats) {
    const key = cats.join("+");
    let b = this.catBuses.get(key);
    if (!b) {
      b = this.ctx.createGain();
      b.gain.value = this._catGain(cats);
      b.connect(this.ctx.destination);
      b.cats = cats;
      this.catBuses.set(key, b);
    }
    return b;
  }

  _catGain(cats) {
    let g = 1;
    for (const c of cats) {
      const v = this.data.categories[c];
      if (v === undefined) throw new Error(`CRI category ${c} has no volume`);
      g *= v * (this.duck.has(c) ? this.duck.get(c).level : 1);
    }
    return g;
  }

  async preload(soundIds) {
    for (const id of soundIds) {
      const c = this.cueOf(id);
      for (const L of c.entry.layers) {
        if (this.layerBuffers.has(L.file)) continue;
        let buf = await this.ctx.decodeAudioData(this.assets.arrayBuffer(L.file));
        if (buf.sampleRate !== L.sampleRate) throw new Error(`${L.file}: decoded at ${buf.sampleRate} Hz`);
        // AAC layers: a decoder that does not apply the MP4 edit list returns the encoder's priming samples
        // first; with at least samples + encoderDelay decoded, the first encoderDelay samples are dropped
        const d = L.encoderDelay || 0;
        if (d > 0 && buf.length >= L.samples + d) {
          const t = this.ctx.createBuffer(buf.numberOfChannels, L.samples, buf.sampleRate);
          for (let ch = 0; ch < buf.numberOfChannels; ch++) t.copyToChannel(buf.getChannelData(ch).subarray(d, d + L.samples), ch);
          buf = t;
        }
        this.layerBuffers.set(L.file, buf);
      }
    }
  }

  // SoundManager.Play -> SoundPlayer.Play (isAutoCrossFade false, forceFadeIn false: no fade) ->
  // SoundInfo.Play: ChangeVolume(volume); SoundSource.Play(start 0). CriAtomExPlayer.Loop(loop): true =
  // FORCE_LOOP (every waveform loops: loop points, else whole); false = the waveform's own loop (LoopFlag 2 + points).
  // Player additions: kind "music" is not played while musicOff, every other kind while seOff; startSec starts the
  // waveforms at that position (seek); the music plays at musicRate.
  play(soundId, { loop = false, volume = 1, kind = null, startSec = 0 } = {}) {
    if (!(soundId > 0)) return -1;              // no master row (e.g. an unset voice id -1): SoundManager.Play fails
    if (kind === "music" ? this.musicOff : this.seOff) return -1;
    const c = this.cueOf(soundId), s = c.entry;
    const info = { id: this.nextId++, soundId, category: c.category, cue: c, cats: s.categories, kind, loop,
                   fade: 0, fadeStart: 0, fadeDur: 0, finished: false, stopped: false, onFinished: [],
                   gain: this.ctx.createGain(), sources: [], startCtx: this.ctx.currentTime, startOffsetSec: startSec,
                   rate: kind === "music" ? this.musicRate : 1 };
    info.gain.gain.value = volume;
    info.gain.connect(this._catBus(s.categories));
    this._startSources(info);
    info.src = { stop: () => { for (const x of info.sources) { try { x.stop(); } catch (_) { /* ended */ } } } };
    this.playing.set(info.id, info);
    this._react();
    return info.id;
  }

  // one source per layer of the cue, started at info.startCtx from info.startOffsetSec
  _startSources(info) {
    const s = info.cue.entry, loop = info.loop;
    let live = 0;
    for (const L of s.layers) {
      const buf = this.layerBuffers.get(L.file);
      if (!buf) throw new Error(`${L.file} not preloaded`);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const own = L.loopFlag === 2 && L.loopStart != null;
      if (loop || own) {
        src.loop = true;
        if (L.loopStart != null) { src.loopStart = L.loopStart / L.sampleRate; src.loopEnd = L.loopEnd / L.sampleRate; }
      }
      if (info.rate !== 1) src.playbackRate.value = info.rate;
      const lg = this.ctx.createGain();
      lg.gain.value = s.volume * L.volume;      // pitch commands (track 5 / synth 121) are not applied
      src.connect(lg).connect(info.gain);
      live++;
      src.onended = () => { if (--live === 0) info.finished = true; };
      if (info.startOffsetSec > 0) src.start(info.startCtx, info.startOffsetSec); else src.start(info.startCtx);
      info.sources.push(src);
    }
  }

  // player seek: the sources of a playing sound restarted now at `sec`
  restart(uid, sec) {
    const info = this.playing.get(uid);
    if (!info) return false;
    for (const x of info.sources) { x.onended = null; try { x.stop(); } catch (_) { /* ended */ } }
    info.sources = [];
    info.finished = false;
    info.startCtx = this.ctx.currentTime; info.startOffsetSec = sec;
    this._startSources(info);
    return true;
  }

  // player speed: playbackRate of the music; the synced-time anchor moves to now so the position stays continuous
  setMusicRate(r) {
    this.musicRate = r;
    const now = this.ctx.currentTime;
    for (const info of this.playing.values()) {
      if (info.kind !== "music" || info.rate === r) continue;
      info.startOffsetSec += (now - info.startCtx) * info.rate;
      info.startCtx = now; info.rate = r;
      for (const x of info.sources) x.playbackRate.setValueAtTime(r, now);
    }
  }

  // every sound except `keepUid` stopped at once
  stopOthers(keepUid) { for (const i of [...this.playing.values()]) if (i.id !== keepUid) this._kill(i); }

  update() {
    super.update();
    this._react();
  }

  // REACT (ACF React_LiveBgm_from_LiveSe): while a cue of `src` plays, `dest` drops to `level` over decrementMs;
  // after the last one ends: hold holdMs, then back to 1 over incrementMs.
  // ENGINE: CRI's REACT curve shapes and HoldType semantics are native; the ramps here are linear.
  _react() {
    const now = this.ctx.currentTime, t = this.loop.time;
    for (const r of this.data.react) {
      let active = false;
      for (const i of this.playing.values()) if (!i.finished && i.cats.includes(r.src)) { active = true; break; }
      let d = this.duck.get(r.dest);
      if (!d) { d = { level: 1, state: "idle", t0: 0 }; this.duck.set(r.dest, d); }
      let target = null, ramp = 0;
      if (active && d.state !== "ducked") { d.state = "ducked"; target = r.level; ramp = r.decrementMs / 1000; }
      else if (!active && d.state === "ducked") { d.state = "hold"; d.t0 = t; }
      else if (!active && d.state === "hold" && t - d.t0 >= r.holdMs / 1000) {
        d.state = "idle"; target = 1; ramp = r.incrementMs / 1000;
      }
      if (target === null) continue;
      d.level = target;
      for (const b of this.catBuses.values()) {
        if (!b.cats.includes(r.dest)) continue;
        const g = this._catGain(b.cats);
        b.gain.cancelScheduledValues(now);
        b.gain.setValueAtTime(b.gain.value, now);
        if (ramp > 0) b.gain.linearRampToValueAtTime(g, now + ramp); else b.gain.setValueAtTime(g, now);
      }
    }
  }

};

// Music position in seconds advanced by game time (deltaTime per frame after PlayMusic): the chart clock when the music
// is not played (music off, or a chart without audio files).
export class LiveGameClock {
  constructor(sec = 0) { this.sec = sec; }
  advance(dt) { this.sec += dt; }
  timeMs() { return Math.trunc(this.sec * 1000); }
  isPlaying(lengthMs) { return this.sec * 1000 < lengthMs; }
};

// LiveAudio: the chart session's audio facade (called in the order the session's frame steps give).
export class LiveAudio {
  constructor(loop, data, { assets = null, context = null } = {}) {
    this.loop = loop;
    this.data = data;
    this.sm = new LiveSoundManager(data, loop, { assets, context });
    this.player = new LiveSoundPlayer(data, this.sm);
    this.finished = false;                      // LivePlayingStateNodeBase._isAllNoteUpdateFinished
    this.log = null;                            // optional array of { t, what, ... } for tests
    // a chart without audio files (manifest "audio": false) plays nothing; the chart clock is then the
    // game clock, as with the music switched off
    this.available = !!assets && !(assets.info && assets.info.audio === false);
    this.musicOn = this.available;
    this.seOn = this.available;
    this.sm.musicOff = !this.musicOn; this.sm.seOff = !this.seOn;
    this.game = new LiveGameClock();
    this.musicStarted = false;
  }
  async load() { if (this.available) await this.sm.preload(Object.keys(this.data.sounds).map(Number)); }
  resume() { return this.sm.resume(); }
  suspend() { return this.sm.suspend(); }

  // MusicStartAnimationStateNode.Enter (intro T = 0): PlayCheers d__8 = UniTask.Delay(1.0 s,
  // Update) then PlayStartCheer. Call in the update phase of the frame the intro timeline starts.
  introStart() {
    this.loop.delay(this.data.timeline.startCheerDelaySec).then((ok) => { if (ok) this.player.playStartCheer(); });
  }
  // Timeline signal PlayVoice (T 1.483333) -> LiveSoundPlayer.PlayLiveStartVoice
  onPlayVoiceSignal() { return this.player.playLiveStartVoice(); }
  // LiveStartStateNodeBase.Enter (intro end, T 5.916667): returns the BGM's unique sound id (-1 when the music is off)
  startMusic() { this.musicStarted = true; this.game.sec = 0; return this.player.startMusic(); }
  // MusicSyncTimeProvider.GetMusicSyncTimeMillSeconds while playing: (int) ms of GetTimeSyncedWithAudio
  // (Audio.syncedTime); the caller keeps the last value once the music stopped.
  // Music off: the game clock.
  musicTimeMs() {
    return this.musicOn ? Math.trunc(this.sm.syncedTime(this.player.musicId) * 1000) : this.game.timeMs();
  }
  // player: the music position in seconds, unrounded (the audio-synced time, or the game clock)
  musicSec() { return this.musicOn ? this.sm.syncedTime(this.player.musicId) : this.game.sec; }
  isPlayingMusic() {
    if (!this.musicOn) return this.musicStarted && this.game.isPlaying(this.musicLengthMs());
    return this.player.musicId > 0 && this.sm.isPlaying(this.player.musicId);
  }
  // LiveSoundPlayer.GetMusicLength (ms): the BGM cue's waveform length
  musicLengthMs() {
    const L = this.data.sounds[String(this.player.musicSoundId)].layers[0];
    return Math.trunc(L.samples * 1000 / L.sampleRate);
  }

  // update phase, after the executor and the views of a frame that ran the live update:
  // OnUpdateSE, then HandleFinishedAllNoteUpdate -> PlayFinishVoiceAndCheer once.
  update(fr) {
    const r = this.player.onUpdateSE(fr);
    if (!this.finished && fr.finishedAllNoteUpdate) {
      this.finished = true;
      r.finish = this.player.playFinishVoiceAndCheer(fr);
    }
    return r;
  }
  // every frame, first in the update hooks (SoundManager.OnUpdate -> SoundPlayer.UpdateSound / UpdateFade, REACT;
  // its place among the game's Update calls is assumed); music off: the game clock advances by this frame's deltaTime
  tick() {
    this.sm.update();
    if (this.musicStarted && !this.musicOn) this.game.advance(this.loop.deltaTime);
  }

  // ---- player controls (not game features)
  // music on / off at music position `sec` (the chart position the player has reached)
  setMusic(on, sec) {
    if (!this.available || on === this.musicOn) return;
    this.musicOn = on; this.sm.musicOff = !on;
    if (!this.musicStarted) return;
    if (on) this._playMusicAt(sec);
    else {
      if (this.player.musicId > 0) this.sm.stop(this.player.musicId, false, 0);
      this.player.musicId = -1;
      this.game.sec = sec;
    }
  }

  setSe(on) {
    if (!this.available) return;
    this.seOn = on; this.sm.seOff = !on;
    if (!on) this.stopSe();
  }

  // every sound but the music stopped (seek, sound effects off)
  stopSe() { this.sm.stopOthers(this.player.musicId); this.player.forgetSe(); }

  setRate(r) { this.sm.setMusicRate(r); }

  // seek to music position `sec`; `finished`: the chart's finish (voice + cheer) is already behind that position
  seek(sec, finished) {
    this.stopSe();
    this.finished = finished;
    if (!this.musicStarted) return;
    if (!this.musicOn) { this.game.sec = sec; return; }
    const id = this.player.musicId;
    if (sec * 1000 < this.musicLengthMs() && id > 0 && this.sm.restart(id, sec)) return;
    if (id > 0) this.sm.stop(id, false, 0);
    this._playMusicAt(sec);
  }

  _playMusicAt(sec) {
    this.player.musicId = sec * 1000 < this.musicLengthMs()
      ? this.sm.play(this.player.musicSoundId, { loop: false, volume: 1.0, kind: "music", startSec: sec }) : -1;
  }
};
