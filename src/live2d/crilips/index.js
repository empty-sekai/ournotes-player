import { CriLipsPipeline } from "./pipeline.js";

// The CRI Lips analyzer object the story hands to Live2DLipSyncController.setLipsAnalyzer for a model
// without a MotionSync controller (and for the speakers that share another voice's analysis). It
// mirrors CriLipsAtomAnalyzer: the voice's output PCM is fed to the analysis
// (CriLipsAtomAnalyzer.AttachToAtomExPlayer + the Atom server callback) and the main thread reads
// GetOpenInfo().openY each frame. Here getOpenInfo first takes the samples the voice's PCM source
// has output since the previous call and analyses them, then returns the value the game's main
// thread would see; nothing else needs to drive it.
//
// The controller path that consumes openY (Live2DLipSyncController._updateCriLips) is already the
// game's; this only supplies { isAvailable, getOpenInfo }.
//
// Readout: the Atom server runs the analysis once per server tick (data.frontend.server_hz, 60 Hz)
// on the PCM delivered so far, and GetOpenInfo returns the last stored openY, read
// `readoutOffsetMs` behind (the library default is 0). getOpenInfo therefore returns the openY of
// the last hop completed by the latest server tick at or before the played position minus the
// offset; `readoutHops` is that offset in hops (0 with the default).
// ENGINE: the game renders audio (and so analyses it) slightly ahead of what is audible; the player
//   takes the played position as the render position, so the readout lag is the tick quantization
//   alone.
// ENGINE: when the page's AudioContext sample rate differs from the game's 48 kHz, the analyzer is
//   built for the PCM source's actual rate and its resampler converts that rate to the 16 kHz work
//   rate, which changes the pre-net samples; this is an input deviation.

export class CriLipsAnalyzer {
  // data: CriLipsData | null; source: the voice PCM source ({pull(), sampleRate, paused})
  constructor(data, source) {
    this.data = data || null;
    this.source = source || null;
    this.pipeline = null;
    if (this.data && this.source) {
      this.rate = this.source.sampleRate || 48000;
      this.pipeline = new CriLipsPipeline(this.data, this.rate);
      this.tick = this.rate / this.data.frontend.server_hz;          // input samples per server tick
    }
    this.readoutOffsetMs = 0;
    this.consumed = 0;                  // input samples analysed so far
    this._ends = [];                    // input sample at which each recent hop completed
    this._ys = [];                      // openY of each recent hop
  }

  get readoutHops() { return Math.round(this.readoutOffsetMs / 10); }

  // isAvailable: the native handle is non-zero -> data and a source are present (CanLipSync). A
  // paused voice keeps its analysis; no samples are output, so the value stays.
  get isAvailable() { return !!(this.pipeline && this.source); }

  // Pulls the samples output since the previous call and runs the analysis on them (getOpenInfo does
  // this first; a caller may feed earlier).
  capture() {
    if (!this.pipeline || !this.source) return;
    const pcm = this.source.pull();
    if (!pcm || !pcm.length) return;
    const base = this.consumed;
    this.pipeline.feed(pcm, (y, end) => { this._ends.push(base + end); this._ys.push(y); });
    this.consumed += pcm.length;
    const keep = 64;
    if (this._ends.length > keep) { this._ends.splice(0, this._ends.length - keep); this._ys.splice(0, this._ys.length - keep); }
  }

  // CriLipsMouth.GetOpenInfo: the openY stored by the latest server tick, at the readout offset.
  getOpenInfo() {
    if (!this.pipeline) return { openY: 0 };
    this.capture();
    const limit = Math.floor(this.consumed / this.tick) * this.tick - (this.readoutOffsetMs * this.rate) / 1000;
    let y = 0;
    for (let i = this._ends.length - 1; i >= 0; i--) if (this._ends[i] <= limit) { y = this._ys[i]; break; }
    return { openY: y };
  }

  reset() {
    if (this.pipeline) this.pipeline.clear();
    this.consumed = 0; this._ends = []; this._ys = [];
  }
}

// Build an analyzer for a voice PCM source from the story's CRI Lips data (or null when the episode
// ships no CRI Lips data: the controller then reports lipSyncMissing and keeps the mouth closed).
export const createLipsAnalyzer = (data, source) => new CriLipsAnalyzer(data, source);

export { CriLipsData } from "./data.js";
export { CriLipsPipeline } from "./pipeline.js";
