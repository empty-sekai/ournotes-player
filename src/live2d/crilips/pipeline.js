import { CriBiquadLpf } from "./biquad.js";
import { CriResampler } from "./resample.js";
import { CriLipsCore } from "./lipscore.js";
import { MouthOpen, mouthOpenParams } from "./openy.js";

// CRI Lips end to end as the game's Atom analyzer (`criLipsAtomAnalyzer`) runs it on a voice:
//   voice PCM -> blocks of (needed input + 7) & ~7 samples -> biquad low-pass -> resampler to 16 kHz
//   -> 10 ms hops -> analysis core -> the latest discretizer blend -> the mouth-open stage -> openY.
// One hop is one openY update (the mouth's update rate equals the hop rate). The native block sizes
// matter (the filter flushes its state per block and the resampler produces only inside a block), so
// `feed` accepts any chunking and cuts the same blocks. `onHop(openY, end)` is called per hop with the
// offset into the fed chunk at which the hop's input block completed.

export class CriLipsPipeline {
  // data: CriLipsData; inputRate: rate of the PCM given to feed() (the game's voices are 48 kHz)
  constructor(data, inputRate = 48000) {
    const fe = data.frontend;
    this.inputRate = inputRate;
    this.workRate = fe.resample_hz;
    this.lpf = new CriBiquadLpf(inputRate, fe.biquad_lpf_cutoff_hz);
    this.resampler = new CriResampler(inputRate, this.workRate);
    this.core = new CriLipsCore(data);
    this.mouth = new MouthOpen(mouthOpenParams(data));
    this.hop = this.core.hop;
    this.block = new Float32Array(8 * this.hop + 64);
    this.filtered = new Float32Array(this.block.length);
    this.filled = 0;
    this.out16 = new Float32Array(4 * this.hop + 64);
    this.have = 0;
    this.openY = 0;
  }

  clear() {
    this.lpf.reset(); this.resampler.reset(); this.core.clear(); this.mouth.clear();
    this.filled = 0; this.have = 0; this.openY = 0;
  }

  blockLen() { return (this.resampler.needNumSamples(this.hop - this.have) + 7) & ~7; }

  // Push voice PCM (float32 at inputRate). Returns the number of hops analysed by this call.
  feed(pcm, onHop) {
    let used = 0, hops = 0;
    for (;;) {
      const len = this.blockLen();
      const take = Math.min(len - this.filled, pcm.length - used);
      this.block.set(pcm.subarray(used, used + take), this.filled);
      this.filled += take; used += take;
      if (this.filled !== len) break;
      this.lpf.process(this.block, this.filtered, len);
      this.have += this.resampler.process(this.filtered, len, this.out16, this.have,
                                          this.out16.length - this.have);
      if (this.core.process(this.out16.subarray(0, this.hop))) this.openY = this.mouth.process(this.core.blend);
      this.out16.copyWithin(0, this.hop, this.have);
      this.have -= this.hop;
      this.filled = 0;
      hops++;
      if (onHop) onHop(this.openY, used);
    }
    return hops;
  }
}
