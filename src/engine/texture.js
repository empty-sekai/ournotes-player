import { assetsOf } from "../data/assets.js";
import { join } from "./core.js";

// GLTex (textures) and GLTarget (render targets) with Unity's sampler settings.
//
// Exported PNGs are stored top row first; Unity textures start at the bottom row
// (uv v = 0), so images are decoded flipped (assets.image) and uploaded as is.
// The project is in Gamma colour space: 8-bit textures are plain RGBA8 (no sRGB
// decode) and blending happens on the stored values.

export class GLTex {
  constructor(gl, tex, width, height, label) {
    this.gl = gl; this.glTexture = tex; this.width = width; this.height = height; this.label = label;
  }

  // UnityEngine.FilterMode 0 Point / 1 Bilinear / 2 Trilinear; TextureWrapMode 0 Repeat / 1 Clamp / 2 Mirror
  static sampler(gl, settings, mipCount = 1) {
    const wrap = [gl.REPEAT, gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT];
    const fm = settings ? settings.m_FilterMode : 1;
    const mag = fm === 0 ? gl.NEAREST : gl.LINEAR;
    let min = mag;
    if (mipCount > 1) min = fm === 0 ? gl.NEAREST_MIPMAP_NEAREST : (fm === 1 ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR);
    const ws = settings ? wrap[settings.m_WrapU] : gl.CLAMP_TO_EDGE, wt = settings ? wrap[settings.m_WrapV] : gl.CLAMP_TO_EDGE;
    if (ws === undefined || wt === undefined) throw new Error(`wrap mode ${JSON.stringify(settings)}`);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, ws);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wt);
  }

  // An exported texture descriptor ({texture, width, height, mipCount, settings}).
  static async load(gl, base, desc, assets = assetsOf(gl)) {
    if (desc.mipCount > 1) throw new Error(`${desc.name}: mipmapped textures not implemented`);
    const bmp = await assets.image(join(base, desc.texture));
    if (bmp.width !== desc.width || bmp.height !== desc.height) throw new Error(`${desc.name}: size mismatch`);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    GLTex.sampler(gl, desc.settings, 1);
    bmp.close();
    return new GLTex(gl, t, desc.width, desc.height, desc.name);
  }

  static solid(gl, rgba, label) {       // Texture2D.whiteTexture etc. (4x4)
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const px = new Uint8Array(4 * 16);
    for (let i = 0; i < 16; i++) px.set(rgba, i * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 }, 1);
    return new GLTex(gl, t, 4, 4, label);
  }
};

// A colour render target (optionally with depth) for offscreen passes.
export class GLTarget {
  constructor(gl, width, height, { internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE,
                                   filter = gl.LINEAR, depth = false, label = "rt" } = {}) {
    this.gl = gl; this.width = width; this.height = height; this.label = label;
    this.glTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.glTexture, 0);
    if (depth) {
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`${label}: framebuffer incomplete 0x${st.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.width, this.height); }

  release() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fb); gl.deleteTexture(this.glTexture);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
  }
};
