import { F } from "../engine/core.js";
import { clampF } from "./math.js";
import { LIP_SYNC_SOURCE } from "./lipsync.js";

// MotionSync of a Live2D character: the model's CubismMotionSyncController with its CubismMotionSyncCriProcessor and
// Live2DAnimation.Live2DMotionSyncCriAudioInput (voice PCM -> visemes -> mouth parameters), and the parts of
// Live2DAnimation.Live2DLipSyncController that post-process the result on the managed path (base capture, neutral
// values, ApplyMotionSyncOnCapturedBase, ApplyMotionSyncPostProcess).
//
// The viseme analysis itself is Live2D's Cubism MotionSync Core [CRI] (native in the game). It is not part of this
// package: the page loads Live2D's Web build (`live2dcubismmotionsynccore.min.js` of the Cubism SDK for Web MotionSync
// Plugin, under Live2D Inc.'s license), which defines the global `Live2DCubismMotionSyncCore`; motionSyncCore() waits
// until its runtime answers. Without it the analysis does not run, the mouth parameters stay at their neutral values
// on this path and the controller reports what is missing (`missing`); nothing stands in for the analysis.
//
// The audio input (Live2DMotionSyncCriAudioInput over CRI's CriAtomExOutputAnalyzer) feeds the voice's output PCM
// into the analysis ring. In the story's calm presentation (fresh PCM capture, UpdateFreshPcmCapture) each frame takes
// the samples output since the previous frame; a frame without new samples feeds silence once
// _silenceFallbackDelaySeconds have passed without any, and a gap of more than 0.5 s resets the ring. Otherwise each
// frame writes the output's last _numCapturedPcmSamples (GetPcmData).
// ENGINE: CRI's capture callback delivers the output in the audio thread's blocks; the voice source's pull() gives
//   the samples output since the previous call on the AudioContext clock. realtimeSinceStartup is the wall clock; the
//   loop's unscaled frame time stands in for it. With every output sample delivered by pull(), the polled fallback
//   (TryFeedPolledPcm: the last samples again when the callback gave none but the output changed) never feeds.
//
// This module reproduces the game's managed calls into the Core:
//   context   CubismMotionSyncCriContext.Create: CreateContext({SampleRate 48000, BitDepth 32}, mappings, count) with
//             one mapping per Mappings[i] (AudioParameterId, the Targets' parameter ids and values in Targets order)
//             and Scale / Enabled of AudioParameters[i] (same index). No ClearContext: a context keeps its analysis
//             state for the model's lifetime (created at the first analysis here; no analysis runs before it).
//   analyze   CubismMotionSyncCriProcessor.Analyze: blocks of exactly GetRequireSampleCount samples from the audio
//             input's ring while read + count < write, Analyze(ctx, samples, count, result, config{BlendRatio,
//             Smoothing, AudioLevelEffectRatio = EmphasisLevel}); each value clamped to [-1, 1] (PullData).
// ENGINE: the game runs the native build of the Core, the page its WebAssembly build of the same version; the two
//   compilers may round float expressions differently, so values can differ in the last bits.

export const MOTIONSYNC_CORE_VERSION = 0x05000004;          // Cubism MotionSync Core 5.0.4 (the game's build)
export const MOTIONSYNC_SAMPLE_RATE = 48000;                // Live2DMotionSyncCriAudioInput.Init(48000)
const CORE_WAIT_MS = 10000;
const EPS = 1.4e-45;                                        // float.Epsilon

let ready = null;

// The global Live2DCubismMotionSyncCore once its runtime is up and the engine is initialised
// (CubismMotionSyncEngine_CRI.InitializeEngine). Rejects when the page has not loaded it.
export const motionSyncCore = () => {
  const MS = globalThis.Live2DCubismMotionSyncCore;
  if (!MS || !MS.CubismMotionSyncEngine || !MS.Context || !MS.ToPointer)
    return Promise.reject(new Error("Live2D Cubism MotionSync Core is not loaded: the page must load Live2D's " +
      "live2dcubismmotionsynccore.min.js (Cubism SDK for Web MotionSync Plugin, CRI) for voice lip sync; " +
      "ournotes-player does not include it"));
  if (ready && ready.core === MS) return ready.promise;
  const promise = (async () => {
    const t0 = Date.now();
    for (;;) {
      let v = 0;
      try { v = MS.CubismMotionSyncEngine.csmMotionSyncGetEngineVersion(); } catch (_) { /* runtime not started yet */ }
      if (v) {
        if (v !== MOTIONSYNC_CORE_VERSION) throw new Error(`MotionSync Core version ${v.toString(16)}: 5.0.4 expected`);
        break;
      }
      if (Date.now() - t0 > CORE_WAIT_MS) throw new Error("Live2D Cubism MotionSync Core did not start");
      await new Promise((r) => setTimeout(r, 5));
    }
    if (MS.CubismMotionSyncEngine.csmMotionSyncInitializeEngine(0) !== MS.csmMotionSyncTrue)
      throw new Error("csmMotionSyncInitializeEngine failed");
    return MS;
  })();
  ready = { core: MS, promise };
  return promise;
};

// One CubismMotionSyncCriContext for a MotionSync setting. The Web build keeps its structs in 4-byte fields (the
// helpers of ToPointer); memory views are re-read on every access because the WebAssembly heap may grow.
class MotionSyncContext {
  constructor(MS, setting, paramId) {
    if (setting.AnalysisType !== 0) throw new Error(`MotionSync analysis type ${setting.AnalysisType} not implemented (CRI only)`);
    const T = MS.ToPointer, maps = setting.Mappings, audio = setting.AudioParameters;
    if (audio.length < maps.length) throw new Error("MotionSync: fewer AudioParameters than Mappings");
    this.MS = MS; this.T = T;
    this.valueCount = setting.CubismParameters.length;
    const list = T.Malloc(maps.length * 6 * 4);
    maps.forEach((m, i) => {
      const ids = m.Targets.map((t) => (t.Parameter ? paramId(t.Parameter) : ""));
      const vals = m.Targets.map((t) => F(t.Value));
      const info = T.ConvertMappingInfoCriToFloat32Array(new Float32Array(6), T.Malloc(24), m.AudioParameterId, ids, vals,
        ids.length, F(audio[i].Scale), audio[i].Enabled ? 1 : 0);
      for (let j = 0; j < 6; j++) (j === 4 ? T.AddValuePtrFloat : T.AddValuePtrInt32)(list, (i * 6 + j) * 4, info[j]);
    });
    const cfg = T.Malloc(8);
    T.ConvertContextConfigCriToInt32Array(new Int32Array(2), cfg, MOTIONSYNC_SAMPLE_RATE, 32);
    this.context = new MS.Context();
    this.context.csmMotionSyncCreate(cfg, list, maps.length);
    this.result = T.Malloc(12);
    T.ConvertAnalysisResultToInt32Array(new Int32Array(3), this.result, this.valueCount);
    this.config = T.Malloc(12);
    this.samples = 0; this.samplesCap = 0;
  }

  requireSampleCount() { return this.context.csmMotionSyncGetRequireSampleCount(); }

  // CubismMotionSyncCriAnalysisConfig.CommitChanges: {BlendRatio, Smoothing (int), AudioLevelEffectRatio}
  setConfig(blendRatio, smoothing, audioLevelEffectRatio) {
    const T = this.T;
    T.AddValuePtrFloat(this.config, 0, blendRatio);
    T.AddValuePtrInt32(this.config, 4, smoothing);
    T.AddValuePtrFloat(this.config, 8, audioLevelEffectRatio);
  }

  // samples: Float32Array of exactly requireSampleCount() values -> the raw values (not clamped)
  analyze(samples) {
    const T = this.T, n = samples.length;
    if (n > this.samplesCap) {
      if (this.samples) T.Free(this.samples);
      this.samples = T.Malloc(n * 4); this.samplesCap = n;
    }
    for (let i = 0; i < n; i++) T.AddValuePtrFloat(this.samples, i * 4, samples[i]);
    if (this.context.csmMotionSyncAnalyze(this.samples, n, this.result, this.config) !== this.MS.csmMotionSyncTrue)
      throw new Error("csmMotionSyncAnalyze failed");
    return T.GetValuesFromAnalysisResult(T.GetProcessedSampleCountFromAnalysisResult(this.result), this.valueCount);
  }
}

// FIFO of PCM samples (the audio input's ring; the game's ring holds 48000 samples, never filled in one analysis step)
class SampleQueue {
  constructor() { this.buf = new Float32Array(4096); this.head = 0; this.tail = 0; }
  get length() { return this.tail - this.head; }
  clear() { this.head = this.tail = 0; }
  push(a) {
    const n = a.length;
    if (!n) return;
    if (this.tail + n > this.buf.length) {
      const live = this.tail - this.head;
      if (live + n > this.buf.length) {
        const b = new Float32Array(Math.max(this.buf.length * 2, (live + n) * 2));
        b.set(this.buf.subarray(this.head, this.tail), 0);
        this.buf = b;
      } else this.buf.copyWithin(0, this.head, this.tail);
      this.head = 0; this.tail = live;
    }
    this.buf.set(a, this.tail); this.tail += n;
  }
  shift(n) { const out = this.buf.slice(this.head, this.head + n); this.head += n; return out; }
}

// CubismParameter normalisations of Live2DLipSyncController
const normSigned = (P, i, v) => {                         // NormalizeSigned
  const lim = Math.abs(v < 0 ? P.min[i] : P.max[i]);
  return lim <= EPS ? 0 : Math.min(1, Math.max(-1, F(v / lim)));
};
const norm01 = (P, i, v) => {                             // Normalize01
  const r = F(P.max[i] - P.min[i]);
  return r === 0 ? 0 : Math.min(1, Math.max(0, F(F(v - P.min[i]) / r)));
};
// Mathf.Approximately
const approximately = (a, b) => Math.abs(F(b - a)) < Math.max(F(1e-6 * Math.max(Math.abs(a), Math.abs(b))), F(1.1754944e-38 * 8));

const ID_OPEN_Y = "ParamMouthOpenY", ID_FORM = "ParamMouthForm";
const VOWELS = new Set(["A", "I", "U", "E", "O"]);

export class CubismMotionSyncController {
  // The controller of a model prefab, or null when the model has none (no CubismMotionSyncController, or no
  // Live2DMotionSyncCriAudioInput next to it: Live2DLipSyncController.SetMotionSyncController drops it then).
  // comps(cls) -> the root's components of a class; params: Live2DParameters; loop: the PlayerLoop (deltaTime);
  // core: motionSyncCore()'s result, or null when the page has not loaded the MotionSync Core
  static fromPrefab(comps, params, loop, core) {
    const [ctrl] = comps("CubismMotionSyncController");
    const [input] = comps("Live2DMotionSyncCriAudioInput");
    if (!ctrl || !input) return null;
    const S = (ctrl._motionSyncData && ctrl._motionSyncData.Settings) || [];
    if (S.length !== 1) throw new Error(`${S.length} MotionSync settings not implemented`);
    if (input.ListeningChannel !== 0) throw new Error(`MotionSync listening channel ${input.ListeningChannel} not implemented`);
    return new CubismMotionSyncController(ctrl, S[0], params, loop, core, input);
  }

  constructor(ctrl, setting, params, loop, core, input = {}) {
    this.params = params;
    this.loop = loop;
    this.core = core || null;
    this.setting = setting;
    this.isMotionSyncEnabled = !!ctrl.IsMotionSyncEnabled;   // CubismMotionSyncController.IsMotionSyncEnabled
    const paramId = (ref) => (ref && ref.gameObject ? ref.gameObject.split("/").pop() : null);
    this.paramId = paramId;
    const idx = (ref) => { const id = paramId(ref); return id !== null && params.index.has(id) ? params.idx(id) : -1; };
    // CubismMotionSyncCriProcessor target parameters (null entries skipped) with the post-processor's Smooth / Damper
    this.targets = setting.CubismParameters.map((p) => ({ i: idx(p.Parameter), smooth: p.Smooth, damper: p.Damper }));
    for (const m of setting.Mappings)
      if (m.Targets.map((t) => paramId(t.Parameter)).join() !== setting.CubismParameters.map((p) => paramId(p.Parameter)).join())
        throw new Error("MotionSync mapping targets differ from CubismParameters (not implemented)");
    const id = (t) => (t.i >= 0 ? params.ids[t.i] : null);
    this.isMouth = this.targets.map((t) => id(t) === ID_OPEN_Y || id(t) === ID_FORM);
    this.rate = Math.min(120, Math.max(1, setting.PostProcessing.SampleRate));   // clamped into the settings
    this.config = [F(setting.PostProcessing.BlendRatio), setting.PostProcessing.Smoothing, F(setting.EmphasisLevel)];
    const n = this.targets.length;
    this.neutral = new Float32Array(n);                     // _motionSyncNeutralValues
    this.base = new Float32Array(n);                        // _motionSyncBaseValues
    this.sm = new Float32Array(n);                          // post-processor LastSmoothed
    this.dm = new Float32Array(n);                          // post-processor LastDamped
    this.result = new Float32Array(n);                      // the analysis result's values (raw)
    this.remain = 0;                                        // processor time accumulator
    this.ring = new SampleQueue();
    // Live2DMotionSyncCriAudioInput (Init(48000)): its prefab settings and the fresh-capture state
    this.input = {
      enablePcmCapture: !!input._enablePcmCapture, numCaptured: input._numCapturedPcmSamples | 0,
      silenceDelay: F(input._silenceFallbackDelaySeconds ?? 0), fresh: false,
      lastPump: 0, timeSinceFresh: 0, carry: 0,             // _lastPumpRealtime, _timeSinceFreshPcm, _silenceFeedCarry
    };
    this.source = null;                                     // the voice: {pull(), latest?(n), paused?, sampleRate}
    this.context = null;
    this.neutralCaptured = false; this.canBlend = false; this.speechHint = 0;
    this.hasFormDelta = false; this.formDelta = 0;
    this.missing = null;
  }

  // Live2DMotionSyncCriAudioInput.SetCriAtomExPlayer (ResetAnalysisBuffer, DrainPcmCaptureCallback) for a voice, and
  // ResetCriAtomExPlayer (drain, detach, ResetAnalysisBuffer) for null
  setSource(source) {
    if (source) { this.source = source; this._resetAnalysisBuffer(); this._drain(); return; }
    this._drain();
    this.source = null;
    this._resetAnalysisBuffer();
  }

  _realtime() { return this.loop.frameCount * this.loop.fixedDelta; }

  // DrainPcmCaptureCallback: the pending output samples are taken and dropped
  _drain() { if (this.source) this.source.pull(); }

  // ResetAnalysisBuffer: the ring emptied (its read and write positions 0), the fresh-capture timers cleared
  _resetAnalysisBuffer() {
    const I = this.input;
    I.timeSinceFresh = 0; I.carry = 0;
    this.ring.clear();
    I.lastPump = this._realtime();
  }

  // Live2DMotionSyncCriAudioInput.SetFreshPcmCaptureEnabled
  setFreshPcmCapture(on) {
    const I = this.input;
    if (I.fresh === on) return;
    I.fresh = on;
    I.timeSinceFresh = 0; I.carry = 0;
    I.lastPump = this._realtime();
    this._drain();
  }

  get freshCapture() { return this.input.fresh; }

  // Live2DMotionSyncCriAudioInput.OnUpdate (lip sync on, MotionSyncVoice): the voice's output PCM into the ring
  // (channel 0 at 48 kHz). The source is the playing voice's PCM (engine/audio.js pcmSource).
  capture() {
    const src = this.source, I = this.input;
    if (!src) return;
    if (src.sampleRate !== undefined && src.sampleRate !== MOTIONSYNC_SAMPLE_RATE) {
      this.missing = `voice PCM at ${MOTIONSYNC_SAMPLE_RATE} Hz (got ${src.sampleRate} Hz)`;
      src.pull();
      return;
    }
    if (I.fresh) { this._updateFreshPcmCapture(); return; }
    if (!I.enablePcmCapture) return;
    this._drain();                                          // the callback's data dropped, the last samples polled
    if (typeof src.latest !== "function") { this.missing = "the voice's last output samples (GetPcmData)"; return; }
    this.ring.push(src.latest(I.numCaptured));
  }

  // UpdateFreshPcmCapture
  _updateFreshPcmCapture() {
    const src = this.source, I = this.input;
    const now = this._realtime(), dt = F(now - I.lastPump);
    I.lastPump = now;
    if (0.5 < dt) { this._drain(); this._resetAnalysisBuffer(); return; }
    if (src.paused) { this._drain(); I.timeSinceFresh = 0; I.carry = 0; return; }
    const data = src.pull();                                // ExecutePcmCaptureCallback -> OnPcmCaptured
    if (data.length > 0) { this.ring.push(data); I.timeSinceFresh = 0; I.carry = 0; return; }
    I.timeSinceFresh = F(I.timeSinceFresh + dt);
    if (I.timeSinceFresh < I.silenceDelay) return;
    const n = F(I.carry + F(dt * MOTIONSYNC_SAMPLE_RATE));
    const k = n !== Infinity ? Math.trunc(n) : -0x80000000;
    I.carry = F(n - k);
    if (k >= 1) this.ring.push(new Float32Array(k));       // silence
  }

  // CubismMotionSyncCriProcessor.ResetProcessorState(neutral): time accumulator 0, post-processor state = neutral
  resetProcessorState() {
    this.remain = 0;
    this.sm.set(this.neutral); this.dm.set(this.neutral);
  }

  // Live2DLipSyncController.TryResolveMotionSyncNeutralValuesFromSilenceMapping
  resolveNeutrals() {
    this.neutral.fill(0);
    const silence = this.setting.Mappings.find((m) => m.AudioParameterId === "Silence");
    if (!silence || !silence.Targets.length) return false;
    let hits = 0;
    for (const t of silence.Targets) {
      const id = this.paramId(t.Parameter);
      if (id === null) continue;
      const k = this.targets.findIndex((x) => x.i >= 0 && this.params.ids[x.i] === id);
      if (k >= 0) { this.neutral[k] = F(t.Value); hits++; }
    }
    return hits > 0;
  }

  // Live2DLipSyncController.CanBlendMouthFormBaseToDefaultForModel: a vowel's mapped mouth form differs from Silence's
  canBlendFormBaseToDefault() {
    const S = this.setting, P = this.params;
    const enabled = (k, id) => {                              // IsEnabledAudioParameter
      const a = S.AudioParameters[k];
      return !!a && a.Id === id && !!a.Enabled && !approximately(a.Scale, 0);
    };
    const mappedForm = (m) => {                               // TryGetMappedMouthForm
      for (const t of m.Targets) {
        const id = this.paramId(t.Parameter);
        if (id === ID_FORM && P.index.has(id)) return normSigned(P, P.idx(id), F(t.Value));
      }
      return null;
    };
    const si = S.Mappings.findIndex((m) => m.AudioParameterId === "Silence");
    if (si < 0 || !enabled(si, "Silence")) return false;
    const s = mappedForm(S.Mappings[si]);
    if (s === null) return false;
    return S.Mappings.some((m, k) => {
      if (!VOWELS.has(m.AudioParameterId) || !enabled(k, m.AudioParameterId)) return false;
      const v = mappedForm(m);
      return v !== null && !approximately(s, v);
    });
  }

  // CubismMotionSyncController.OnLateUpdate (execution order 501): the processor, while IsMotionSyncEnabled
  lateUpdate() { if (this.isMotionSyncEnabled) this._updateProcessor(); }

  // CubismMotionSyncCriProcessor.UpdateParameterToProcessor: analysis at the setting's rate (30 per second), then
  // the damped values written as absolute parameter values (targets whose last analysis value is not NaN)
  _updateProcessor() {
    const dt = this.loop.deltaTime;
    const step = F(1 / this.rate), acc = F(dt + this.remain);
    this.remain = acc;
    if (step <= acc) {
      this._analyze();
      this.remain = F(this.remain % step);                    // CubismMath.ModF
    }
    const v = this.params.value;
    this.targets.forEach((t, k) => { if (t.i >= 0 && !Number.isNaN(this.result[k])) v[t.i] = this.dm[k]; });
  }

  // CubismMotionSyncCriProcessor.Analyze + CubismMotionSyncCriPostProcessor.Process
  _analyze() {
    if (!this.core) { if (this.ring.length) this.missing = "Live2D Cubism MotionSync Core"; return; }
    if (!this.context) this.context = new MotionSyncContext(this.core, this.setting, this.paramId);
    const C = this.context;
    let req = C.requireSampleCount();
    if (req === 0) throw new Error("MotionSync requireSampleCount returned 0");
    C.setConfig(...this.config);
    const available = this.ring.length;
    for (let read = 0; (read += req) < available;) {
      const raw = C.analyze(this.ring.shift(req));
      req = C.requireSampleCount();
      this.targets.forEach((t, k) => {
        this.result[k] = raw[k];
        const val = Math.min(1, Math.max(-1, raw[k]));                    // PullData
        this.sm[k] = F(F(F(val * (100 - t.smooth)) + F(t.smooth * this.sm[k])) / 100);
        if (Math.abs(F(this.sm[k] - this.dm[k])) >= t.damper) this.dm[k] = this.sm[k];
      });
    }
  }

  // Live2DLipSyncController.ApplyMotionSyncOnCapturedBase: CaptureMotionSyncBaseValues, the controller's processor
  // run (IsMotionSyncEnabled on for the call), and the result moved onto the captured base
  applyOnCapturedBase() {
    const P = this.params;
    this.targets.forEach((t, k) => { if (t.i >= 0) this.base[k] = P.ids[t.i] === ID_OPEN_Y ? 0 : P.value[t.i]; });
    this.isMotionSyncEnabled = true;
    this._updateProcessor();
    this.isMotionSyncEnabled = false;
    this.targets.forEach((t, k) => {
      if (t.i < 0) return;
      const v = P.value[t.i];
      if (P.ids[t.i] === ID_FORM) { this.formDelta = F(normSigned(P, t.i, v) - normSigned(P, t.i, this.neutral[k])); this.hasFormDelta = true; }
      P.value[t.i] = clampF(F(this.base[k] + F(v - this.neutral[k])), P.min[t.i], P.max[t.i]);
    });
  }

  // Live2DLipSyncController.ApplyMotionSyncPostProcess (with EstimateMotionSyncSupplementalOpen): the AdvCalm policy
  // on ParamMouthOpenY / ParamMouthForm (oy / fm: parameter indices, -1 when the model lacks one)
  postProcess(policy, oy, fm) {
    const P = this.params, dt = this.loop.deltaTime;
    if (oy < 0) return;
    const open01 = norm01(P, oy, P.value[oy]);
    const hasForm = fm >= 0;
    let form = 0, baseN = 0, defN = 0, hasBase = false, formDiff = 0, hasDelta = false, supp = 0;
    const fk = hasForm ? this.targets.findIndex((t) => t.i === fm) : -1;
    if (hasForm) {
      form = normSigned(P, fm, P.value[fm]);
      hasBase = fk >= 0;
      if (hasBase) baseN = normSigned(P, fm, this.base[fk]);
      defN = normSigned(P, fm, P.def[fm]);
      if (this.hasFormDelta) { formDiff = Math.abs(this.formDelta); hasDelta = true; }
      else formDiff = hasBase ? Math.abs(F(form - baseN)) : 0;
    }
    this.targets.forEach((t, k) => {                          // EstimateMotionSyncSupplementalOpen
      if (t.i < 0 || !this.isMouth[k] || t.i === oy) return;
      supp = Math.max(supp, F(Math.abs(F(norm01(P, t.i, P.value[t.i]) - norm01(P, t.i, this.base[k]))) * (t.i === fm ? F(0.35) : 1)));
    });
    let speaking;
    if (open01 >= 0.03) { this.speechHint = F(0.08); speaking = true; }
    else {
      this.speechHint = Math.max(0, F(this.speechHint - dt));
      speaking = !(formDiff < 0.16 && supp < 0.12) && this.speechHint > 0;
    }
    const out = policy.process(LIP_SYNC_SOURCE.MotionSync, { openY: Math.min(1, Math.max(0, open01)), form, base: baseN,
      hasForm, hasBase, speaking, delta: this.formDelta, hasDelta, def: defN, hasDefault: hasForm, canBlend: this.canBlend }, dt);
    P.value[oy] = F(P.min[oy] + F(Math.min(1, Math.max(0, out.openY)) * F(P.max[oy] - P.min[oy])));
    if (hasForm) {
      const f = Math.min(1, Math.max(-1, out.form));
      P.value[fm] = F(f * Math.abs(f >= 0 ? P.max[fm] : P.min[fm]));
    }
  }
}
