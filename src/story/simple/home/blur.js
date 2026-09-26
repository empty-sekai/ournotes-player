import { applyState } from "../../../engine/glsl.js";
import { GLTarget } from "../../../engine/texture.js";

// The home talk's UI blur: UIBlurController (ExecBlur, ChangeBlurRateOverTime, StopBlur) setting the renderer
// feature's parameter (UIRendererFeatureParameter.ExecBlur / BlurRate), and the full-screen pass UIRenderPass runs
// with it ("CaptureAndBlur": AddFullScreenBlurPass -> AddBlur -> DualKawaseBlurChain.Record, then the write-back
// copy). The pass settings are the renderer's UIRendererFeature values (host.json home.blur), clamped as
// UIRenderPass.Setup clamps them.

const f = Math.fround;
export const BLUR_SHADER = "Hidden/UI/DualKawaseBlur";
export const PASS_DOWNSAMPLE = 0, PASS_UPSAMPLE = 1, PASS_COMPOSITE = 2;     // DualKawaseBlurChain constants
export const MAX_ITERATIONS = 8;                                              // UIRenderPass.MaxIterations

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// UIRenderPass.Setup: Weight clamp01(rate), Iterations clamp(1, 8), Offset max(0), Downsample max(0),
// BlendRateMax clamp(0.01, 1)
export const blurSettings = (params, rate) => {
  if (!params) throw new Error("home.blur missing");
  const it = params.iterations | 0, bm = f(params.blendRateMax);
  return {
    weight: f(clamp01(f(rate))),
    iterations: it > MAX_ITERATIONS - 1 ? MAX_ITERATIONS : it < 2 ? 1 : it,
    offset: f(Math.max(0, f(params.offset))),
    downsample: Math.max(0, params.downsample | 0),
    blendRateMax: bm < 0.01 ? f(0.01) : Math.min(bm, 1),
  };
};

// The Record arguments of UIRenderPass.AddBlur for a blur rate, or null when the pass is skipped (weight <= 0 or
// blend rate <= 0): offset = weight x Offset, blendRate = clamp01(weight / BlendRateMax) (GetBlendRate)
export const blurPass = (params, rate) => {
  const s = blurSettings(params, rate);
  if (!(s.weight > 0)) return null;
  const blendRate = f(clamp01(f(s.weight / s.blendRateMax)));
  if (!(blendRate > 0)) return null;
  return { iterations: s.iterations, downsample: s.downsample, offset: f(s.weight * s.offset), blendRate };
};

// DualKawaseBlurChain.Record level sizes: base = max(1, (W, H) >> downsample), level i = max(1, base >> i)
export const blurLevels = (width, height, iterations, downsample) => {
  const bw = Math.max(1, width >> downsample), bh = Math.max(1, height >> downsample);
  return Array.from({ length: iterations }, (_, i) => ({ width: Math.max(1, bw >> i), height: Math.max(1, bh >> i) }));
};

// UIBlurController with the feature parameter it drives: `enabled` = UIRendererFeatureParameter.ExecBlur,
// `rate` = BlurRate, `stopping` = _isBlurStopping (set only by the timed StopBlur, which the home talk does not use).
export class UIBlur {
  constructor(loop) {
    this.loop = loop;
    this.enabled = false;
    this.rate = 0;
    this.stopping = false;
    this.cts = 0;                         // _cancellationTokenSource generation (RefreshCancellationTokenSource)
    this.running = null;                  // the running ChangeBlurRateOverTime (a promise)
  }

  // UIBlurController.ExecBlur(duration): duration <= 0 -> ExecBlur() (rate 1 at once). A blur already on and not
  // stopping is left as it is; else the rate ramps from 0 (or, while stopping, from the current rate) to 1 with
  // ChangeBlurRateOverTime, fire and forget.
  exec(duration) {
    if (!(duration > 0)) {
      if (this.enabled) {
        if (!this.stopping) return;
        this.stopping = false; this.cts++;
      }
      this.enabled = true; this.rate = 1;
      return;
    }
    let start;
    if (!this.enabled) { this.rate = 0; start = 0; this.enabled = true; }
    else {
      if (!this.stopping) return;
      start = this.rate; this.stopping = false;
    }
    this.running = this._changeRateOverTime(f(duration), f(start), 1);
  }

  // UIBlurController.ChangeBlurRateOverTime(duration, startRate, targetRate): RefreshCancellationTokenSource; then
  // until elapsed >= duration: elapsed += Time.deltaTime, BlurRate = start + (target - start) x clamp01(elapsed /
  // duration), UniTask.Yield(Update, token); then BlurRate = target. The first step runs in the caller's frame with that
  // frame's delta time; a cancelled token ends the loop at its next yield.
  async _changeRateOverTime(duration, start, target) {
    const token = ++this.cts, loop = this.loop;
    let elapsed = 0;
    while (elapsed < duration) {
      elapsed = f(elapsed + f(loop.deltaTime));
      const t = clamp01(f(elapsed / duration));
      this.rate = f(start + f(f(target - start) * t));
      await loop.yield("Update");
      if (token !== this.cts) return false;
    }
    this.rate = target;
    return true;
  }

  // UIBlurController.StopBlur(): if the blur is on: a timed stop in progress is cancelled (its token refreshed);
  // ExecBlur = false, BlurRate = 0. A ramp from ExecBlur still running keeps writing the rate, which the pass ignores
  // while ExecBlur is false.
  stop() {
    if (!this.enabled) return;
    if (this.stopping) { this.stopping = false; this.cts++; }
    this.enabled = false; this.rate = 0;
  }

  // the rate the pass sees (UIRendererFeature passes the parameter only with ExecBlur set)
  get effectiveRate() { return this.enabled ? this.rate : 0; }

  dispose() { this.cts++; this.enabled = false; this.rate = 0; }
}

// The Dual Kawase chain on WebGL2 with the game's "Hidden/UI/DualKawaseBlur" program. Each level blit draws the
// procedural full-screen triangle (Blitter.BlitTexture: _BlitTexture, _BlitScaleBias (1, 1, 0, 0), _BlitTexture_TexelSize
// of the bound source, _GlobalMipBias 0). Levels are bilinear, clamped, in the colour format of the target (the camera
// descriptor's format).
export class DualKawaseBlur {
  constructor(gl, lib) {
    this.gl = gl; this.lib = lib;
    this.vao = gl.createVertexArray();
    this.levels = [];
    this.scratch = null;
    this.key = "";
    for (const p of [PASS_DOWNSAMPLE, PASS_UPSAMPLE, PASS_COMPOSITE]) lib.program(BLUR_SHADER, p, []);
  }

  static texel(t) { return [1 / t.width, 1 / t.height, t.width, t.height]; }

  // the colour format of a target: RGBA16F when its colour attachment reads back as float, else RGBA8
  _format(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    const type = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
    return type === gl.FLOAT ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, name: "f16" }
                             : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, name: "u8" };
  }

  _targets(target, width, height, pass) {
    const fmt = this._format(target);
    const sizes = blurLevels(width, height, pass.iterations, pass.downsample);
    const key = `${fmt.name} ${width}x${height} ${sizes.map((s) => `${s.width}x${s.height}`).join(" ")}`;
    if (key !== this.key) {
      this.releaseTargets();
      const gl = this.gl, o = { internal: fmt.internal, format: fmt.format, type: fmt.type, filter: gl.LINEAR };
      this.levels = sizes.map((s, i) => new GLTarget(gl, s.width, s.height, { ...o, label: `UIBlur Down${i}` }));
      this.scratch = new GLTarget(gl, width, height, { ...o, label: "UIBlur" });
      this.key = key;
    }
  }

  _blit(pass, sheet, target) {
    const gl = this.gl, prog = this.lib.program(BLUR_SHADER, pass, []);
    target.bind();
    gl.disable(gl.SCISSOR_TEST);
    prog.apply([sheet, { _BlitScaleBias: [1, 1, 0, 0], _GlobalMipBias: [0, 0] }]);
    applyState(gl, this.lib.state(BLUR_SHADER, pass, {}));
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // framebuffer copy of the whole of `src` into the whole of `dst`
  _copy(src, dst, filter) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fb);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.COLOR_BUFFER_BIT, filter);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  // UIRenderPass.AddFullScreenBlurPass on `target` (width x height, its whole texture) in place, for `pass` from
  // blurPass(): DualKawaseBlurChain.Record(source = target, destination = the "UIBlur" texture), then the write-back
  // copy (RasterCopyPass) into the target.
  apply(target, width, height, pass) {
    const gl = this.gl;
    this._targets(target, width, height, pass);
    const L = this.levels, n = L.length, off = pass.offset;
    // downsample: source -> L0 -> L1 -> ... (pass 0)
    let src = target;
    for (let i = 0; i < n; i++) {
      this._blit(PASS_DOWNSAMPLE, { _BlitTexture: src, _BlitTexture_TexelSize: DualKawaseBlur.texel(src), _Offset: off }, L[i]);
      src = L[i];
    }
    // upsample: L[n-1] -> L[n-2] -> ... -> L0 (pass 1)
    for (let i = n - 2; i >= 0; i--) {
      this._blit(PASS_UPSAMPLE, { _BlitTexture: src, _BlitTexture_TexelSize: DualKawaseBlur.texel(src), _Offset: off }, L[i]);
      src = L[i];
    }
    if (pass.blendRate >= 1) {
      // RasterCopyPass (Blitter, bilinear) of the blurred level into the full-size destination
      // ENGINE: the Blitter copy shader is not part of the data; a bilinear framebuffer blit samples the same texels.
      this._copy(src, this.scratch, gl.LINEAR);
    } else {
      // "Composite": _BlitTexture = the original, _SourceTex = the blurred level, output lerp(original, blur, rate)
      this._blit(PASS_COMPOSITE, { _BlitTexture: target, _SourceTex: src, _BlurBlendRate: pass.blendRate }, this.scratch);
    }
    this._copy(this.scratch, target, gl.NEAREST);        // "UIBlur_WriteBack"
  }

  releaseTargets() {
    for (const t of this.levels) t.release();
    if (this.scratch) this.scratch.release();
    this.levels = []; this.scratch = null; this.key = "";
  }

  dispose() { this.releaseTargets(); this.gl.deleteVertexArray(this.vao); }
}
