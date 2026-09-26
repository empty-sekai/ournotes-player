// Time stretch of PCM without a pitch change: the CRI DSP time stretch of a voice played at a playback speed
// (Fwk.Sound.SoundSource.SetPlaybackSpeed: CriAtomExPlayer.SetDspTimeStretchRatio(1 / min(speed, 3)) on a voice pool
// with the time-stretch DSP attached).
// ENGINE: CRI's time-stretch DSP is native; WSOLA (waveform-similarity overlap-add) stands in for it: 40 ms Hann
// windows at half overlap, each placed within +-10 ms of its nominal source position where it best continues the
// previous window (cross-correlation on channel 0, every 4th sample), the same placement for every channel.

const WINDOW_SEC = 0.04, TOLERANCE_SEC = 0.01, SEARCH_STEP = 4;

// channels: Float32Array per channel (equal lengths); speed > 0 (2 plays twice as fast). Returns the stretched
// channels, round(length / speed) frames each.
export const timeStretch = (channels, sampleRate, speed) => {
  const len = channels[0].length;
  const outLen = Math.max(0, Math.round(len / speed));
  const N = Math.max(4, 2 * Math.round((WINDOW_SEC * sampleRate) / 2));
  const Hs = N / 2, Ha = Hs * speed, tol = Math.round(TOLERANCE_SEC * sampleRate);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const out = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const ref = channels[0];
  const at = (x, i) => (i >= 0 && i < len ? x[i] : 0);
  let prev = 0;                                     // source position of the previous window
  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Ha);
    let pos = nominal;
    if (k > 0) {
      // the window that best continues the previous one: its natural continuation starts at prev + Hs
      const cont = prev + Hs;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d++) {
        const p = nominal + d;
        if (p < 0) continue;
        let c = 0;
        for (let i = 0; i < N; i += SEARCH_STEP) c += at(ref, cont + i) * at(ref, p + i);
        if (c > best) { best = c; pos = p; }
      }
    }
    const o = k * Hs;
    for (let ch = 0; ch < channels.length; ch++) {
      const x = channels[ch], y = out[ch];
      for (let i = 0; i < N; i++) y[o + i] += win[i] * at(x, pos + i);
    }
    for (let i = 0; i < N; i++) norm[o + i] += win[i];
    prev = pos;
  }
  return out.map((y) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-6 ? y[i] / norm[i] : y[i];
    return r;
  });
};
