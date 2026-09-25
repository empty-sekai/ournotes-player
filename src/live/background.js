import { F } from "../engine/core.js";
import { applyState } from "../engine/glsl.js";
import { mat4 } from "../engine/math.js";
import { GLTarget, GLTex } from "../engine/texture.js";

// LiveLightWeightBackground: the LightWeight background composite, the RT the game builds once at
// LiveViewPresenter.FullInitialize (screen mode 3, no support-card snap) and shows on
// Live/RenderCanvas/LightWeightBackgroundStageImage. LiveCopyProgram: a plain same-size texel copy.
//
// TryCreateLightWeightCompositedRenderTexture -> LightWeightCompositeBackgroundView.CreateCompositedRenderTexture
// -> RuntimeCompositeBackgroundGenerator.CreateCompositeBlurredBackgroundRenderTexture:
//   composite_bg = GetTemporary(1536, 1212, 0, ARGB32), GL.Clear(false, true, (0,0,0,0));
//   per layer (JacketLarge, BaseWhite, JacketSmall, StageBg; skipped when Tint.a <= 0; null texture -> white):
//     Graphics.Blit(tex, composite_bg, Hidden/CompositeRectBlit, 0) with _Tint, _RectMin, _RectMax;
//   RuntimeBlurGenerator.CreateBlurredRenderTexture: blur_result = new RenderTexture(1536, 1212, 0, RGB565)
//     (bilinear, clamp), temp = GetTemporary(1536, 1212, 0, RGB565); Graphics.Blit(composite_bg, blur_result) (plain
//     copy); 2 x { Blit(blur_result, temp, SimpleGaussianBlur, 0); Blit(temp, blur_result, SimpleGaussianBlur, 1) },
//     _BlurSize 1; returns blur_result.
// Layer rects: ComputeNormalizedRect = the layer's world corners in the root's local space, normalised by
// the root rect (y from the bottom).

export const LiveLightWeightBackground = {
  ROOT: "Live/RenderCanvas/LightWeightCompositeRoot",
  LAYERS: ["Layer_JacketLarge", "Layer_BaseWhite", "Layer_JacketSmall", "Layer_StageBg"],   // CreateCompositedRenderTexture array order

  // normalised layer rects in the root (pure)
  layers(scene, prefab) {
    const root = prefab.nodes.get(LiveLightWeightBackground.ROOT).node;
    const rw = root.rect.m_SizeDelta.x, rh = root.rect.m_SizeDelta.y;      // root anchors 0.5/0.5: rect = sizeDelta
    // the root's rect is its sizeDelta because both its anchors are 0.5 (the RenderCanvas rect does not enter);
    // the layers' positions are their anchoredPosition (anchors 0.5, pivot 0.5, localPosition 0 in the data).
    const W = Math.round(rw), H = Math.round(rh);                          // Math.Round (half even; integral here)
    return {
      width: W, height: H,
      layers: LiveLightWeightBackground.LAYERS.map((name) => {
        const path = `${LiveLightWeightBackground.ROOT}/${name}`;
        const n = prefab.nodes.get(path).node, img = prefab.component(path, "Image");
        const r = n.rect, s = n.localScale;
        if (r.m_AnchorMin.x !== 0.5 || r.m_AnchorMax.x !== 0.5 || r.m_AnchorMin.y !== 0.5 || r.m_AnchorMax.y !== 0.5)
          throw new Error(`${path}: anchors`);
        const w = F(r.m_SizeDelta.x * s.x), h = F(r.m_SizeDelta.y * s.y);
        const cx = F(r.m_AnchoredPosition.x + F(F(0.5 - r.m_Pivot.x) * w)), cy = F(r.m_AnchoredPosition.y + F(F(0.5 - r.m_Pivot.y) * h));
        const x0 = F(F(F(cx - F(w / 2)) + F(rw / 2)) / rw), y0 = F(F(F(cy - F(h / 2)) + F(rh / 2)) / rh);
        const x1 = F(F(F(cx + F(w / 2)) + F(rw / 2)) / rw), y1 = F(F(F(cy + F(h / 2)) + F(rh / 2)) / rh);
        // texture: jacket (MusicJacket), the Image sprite's texture (whole atlas page for BaseWhite), stage sprite
        const tex = name === "Layer_StageBg" ? scene.sprites.lightweightBackground.texture
          : name.startsWith("Layer_Jacket") ? scene.sprites.jacket.texture
            : img.m_Sprite ? img.m_Sprite.texture : null;
        const c = img.m_Color;
        return { name, tint: [c.r, c.g, c.b, c.a], rectMin: [x0, y0, 0, 0], rectMax: [x1, y1, 0, 0], texture: tex };
      }),
    };
  },

  // Builds blur_result; returns an GLTarget (RGB565, bilinear, clamp). `vao` = an empty VAO.
  async build(gl, lib, scene, prefab, base, vao) {
    const L = LiveLightWeightBackground.layers(scene, prefab), W = L.width, H = L.height;
    const composite = new GLTarget(gl, W, H, { label: "composite_bg" });                  // ARGB32
    const R565 = { internal: gl.RGB565, format: gl.RGB, type: gl.UNSIGNED_SHORT_5_6_5 };
    const result = new GLTarget(gl, W, H, { ...R565, label: "blur_result" });
    const temp = new GLTarget(gl, W, H, { ...R565, label: "blur_temp" });
    // ENGINE: Graphics.Blit draws a quad (0,0)..(1,1), uv = position, ObjectToWorld identity, VP = ortho [0,1] -> clip.
    const quad = { pos: new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]), uv: new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]),
                   idx: new Uint16Array([0, 1, 2, 2, 3, 0]) };
    const bufs = { pos: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer() };
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.bufferData(gl.ARRAY_BUFFER, quad.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv); gl.bufferData(gl.ARRAY_BUFFER, quad.uv, gl.STATIC_DRAW);
    const VP = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -1, -1, 0, 1]), I = mat4.identity();
    const blit = (shader, pass, sheet, target) => {
      const prog = lib.program(shader, pass, []);
      target.bind();
      prog.apply([sheet, { unity_ObjectToWorld: I, unity_MatrixVP: VP }]);
      applyState(gl, lib.state(shader, pass, {}));
      gl.bindVertexArray(vao);
      for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
      for (const [name, loc] of Object.entries(prog.attribs)) {
        if (loc < 0) continue;
        if (name === "in_POSITION0") { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
        else if (name === "in_TEXCOORD0") { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
        else throw new Error(`${prog.label}: vertex input ${name}`);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quad.idx, gl.STREAM_DRAW);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
    composite.bind();
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const textures = new Map();
    const white = GLTex.solid(gl, [255, 255, 255, 255], "Texture2D.whiteTexture");
    for (const l of L.layers) {
      if (!(l.tint[3] > 0)) continue;
      let t = white;
      if (l.texture) {
        if (!textures.has(l.texture.texture)) textures.set(l.texture.texture, await GLTex.load(gl, base, l.texture));
        t = textures.get(l.texture.texture);
      }
      blit("Hidden/CompositeRectBlit", 0, { _MainTex: t, _Tint: l.tint, _RectMin: l.rectMin, _RectMax: l.rectMax }, composite);
    }
    // Graphics.Blit(composite_bg, blur_result): no material = the engine's copy.
    // ENGINE: Unity's built-in blit-copy shader is replaced by a same-size texel copy (exact up to RGB565 conversion).
    // The RGB565 conversion is the GPU's quantisation of the float output, alpha dropped.
    LiveLightWeightBackground._copy(gl, vao, composite, result);
    const texel = (t) => [1 / t.width, 1 / t.height, t.width, t.height];
    for (let i = 0; i < 2; i++) {
      blit("Hidden/SimpleGaussianBlur", 0, { _MainTex: result, _MainTex_TexelSize: texel(result), _BlurSize: 1 }, temp);
      blit("Hidden/SimpleGaussianBlur", 1, { _MainTex: temp, _MainTex_TexelSize: texel(temp), _BlurSize: 1 }, result);
    }
    temp.release(); composite.release();
    for (const t of textures.values()) gl.deleteTexture(t.glTexture);
    gl.deleteTexture(white.glTexture);
    for (const b of Object.values(bufs)) gl.deleteBuffer(b);
    return { target: result, layout: L };
  },

  _prog: null,
  _copy(gl, vao, src, dst) {
    const P = LiveLightWeightBackground;
    if (!P._prog || P._prog.gl !== gl) P._prog = LiveCopyProgram.create(gl);
    dst.bind();
    P._prog.draw(src.glTexture, [0, 0], vao);
  },
};

// Plain same-size texel copy (texelFetch at gl_FragCoord - offset), standing in for the engine's built-in copy
// shader (Graphics.Blit without material, URP's final blit of LiveMainCamera). Blending off.
export const LiveCopyProgram = {
  create(gl) {
    const vs = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uSrc; uniform ivec2 uOffset; out vec4 o;
void main() { o = texelFetch(uSrc, ivec2(gl_FragCoord.xy) - uOffset, 0); }`;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`copy shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`copy program: ${gl.getProgramInfoLog(p)}`);
    const uSrc = gl.getUniformLocation(p, "uSrc"), uOffset = gl.getUniformLocation(p, "uOffset");
    return {
      gl,
      draw(tex, offset, vao) {
        gl.useProgram(p);
        gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true); gl.depthMask(false);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(uSrc, 0); gl.uniform2i(uOffset, offset[0], offset[1]);
        gl.bindVertexArray(vao);
        for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  },
};
