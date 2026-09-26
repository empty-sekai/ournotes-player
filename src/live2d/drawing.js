import { applyState } from "../engine/glsl.js";
import { GLTarget, GLTex } from "../engine/texture.js";

// Drawing a Live2DCharacter with the game's own shaders. Every drawable is one draw of
// "Live2D Cubism/Lit-URP-ADV-optimize" with its prefab material (keywords, blend floats) plus the values the Cubism
// renderer puts into its MaterialPropertyBlock. The model owns a 1024 x 1024 RGBA8 mask texture, redrawn with
// "Live2D Cubism/Mask" (the Mask / MaskCulling materials of Resources/Live2D/Cubism/Materials) whenever the mask
// controller flagged it in LateUpdate (CubismMaskCommandBuffer, before the cameras render).
//
// Cubism meshes have no normals or tangents; the shaders still read them.
// ENGINE: the values bound for a mesh's missing NORMAL / TANGENT channels are native; (0, 0, 1, 0) / (1, 0, 0, 1) here.
export const MISSING_NORMAL = [0, 0, 1, 0];
export const MISSING_TANGENT = [1, 0, 0, 1];
export const LIT_SHADER = "Live2D Cubism/Lit-URP-ADV-optimize";
export const MASK_SHADER = "Live2D Cubism/Mask";
export const MASK_SIZE = 1024;

// A drawable's main texture (a mipmapped one as GLTex.load describes).
const loadTexture = (gl, dir, d, assets) => GLTex.load(gl, dir, d, assets);

export class Live2DDrawing {
  // lib: the ShaderLib of the model's shaders; resources: {cubismMask, cubismMaskCulling} materials;
  // dir: directory of the prefab (texture paths are relative to it); white: Texture2D.whiteTexture
  constructor(gl, lib, character, { dir = "", resources, white, assets }) {
    this.gl = gl; this.lib = lib; this.ch = character; this.dir = dir; this.white = white; this.assets = assets;
    if (!resources || !resources.cubismMask || !resources.cubismMaskCulling)
      throw new Error("model.json: resources.cubismMask / cubismMaskCulling missing");
    this.maskMats = { 0: resources.cubismMask, 1: resources.cubismMaskCulling };
    for (const m of Object.values(this.maskMats))
      if (!m.shader || m.shader.shader !== MASK_SHADER) throw new Error(`mask material shader ${m.shader && m.shader.shader}`);
    // CubismMaskTexture: new RenderTexture(1024, 1024, 0, ARGB32), RGBA8 in the gamma-space project
    // ENGINE: the mask RenderTexture's filter and wrap modes are never set (engine defaults); bilinear and clamped here.
    this.maskRT = new GLTarget(gl, MASK_SIZE, MASK_SIZE, { label: `${character.name} mask` });
    this.vao = gl.createVertexArray();
    this.textures = new Map();
    this.buffers = character.renderers.map((r) => {
      const idx = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, r.indices, gl.STATIC_DRAW);
      const uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.bufferData(gl.ARRAY_BUFFER, r.uvs, gl.STATIC_DRAW);
      return { idx, uv, count: r.indices.length, pos: [gl.createBuffer(), gl.createBuffer()], uploaded: [null, null] };
    });
  }

  async loadTextures() {
    for (const r of this.ch.renderers) {
      const d = r.textureDesc;
      if (!d || !d.texture) throw new Error(`${r.name}: no main texture`);
      if (!this.textures.has(d.texture)) this.textures.set(d.texture, await loadTexture(this.gl, this.dir, d, this.assets));
    }
  }

  // compiles every program the model draws with (the Lit variants of its materials, the mask program when it has
  // masks) and reads the pass states, so that nothing is loaded while drawing
  prepare() {
    const seen = new Set();
    for (const r of this.ch.renderers) {
      const k = r.material.keywords.join(" ");
      if (seen.has(k)) continue;
      seen.add(k);
      this.lib.program(LIT_SHADER, 0, r.material.keywords);
      this.lib.state(LIT_SHADER, 0, r.material.floats);
    }
    if (this.ch.junctions.length) {
      this.lib.program(MASK_SHADER, 0, []);
      for (const m of Object.values(this.maskMats)) this.lib.state(MASK_SHADER, 0, m.floats);
    }
  }

  _positions(r) {                        // uploads the displayed mesh buffer when it changed
    const gl = this.gl, b = this.buffers[r.index], k = r.front, m = r.meshes[k];
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos[k]);
    if (b.uploaded[k] !== m.pos) { gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.DYNAMIC_DRAW); b.uploaded[k] = m.pos; }
    return b.pos[k];
  }

  _bindAttribs(prog, r, color) {
    const gl = this.gl, b = this.buffers[r.index];
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      if (name === "in_POSITION0") {
        this._positions(r);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);          // z = 0, w = 1
      } else if (name === "in_TEXCOORD0") {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      } else if (name === "in_COLOR0") gl.vertexAttrib4fv(loc, color);
      else if (name === "in_NORMAL0") gl.vertexAttrib4fv(loc, MISSING_NORMAL);
      else if (name === "in_TANGENT0") gl.vertexAttrib4fv(loc, MISSING_TANGENT);
      else throw new Error(`${prog.label}: attribute ${name}`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
  }

  // CubismMaskCommandBuffer: clear and redraw the mask texture when it is flagged. The mask meshes are the displayed
  // buffers, drawn in model space (identity matrix), each into its junction's tile and channel.
  renderMasks() {
    const ch = this.ch, gl = this.gl;
    if (!ch.maskDirty) return;
    ch.maskDirty = false;
    this.maskRT.bind();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = this.lib.program(MASK_SHADER, 0, []);
    for (const j of ch.junctions)
      for (const mi of j.masks) {
        const r = ch.renderers[mi];
        const mat = this.maskMats[r.doubleSided ? 0 : 1];
        const tex = this.textures.get(r.textureDesc.texture);
        // ENGINE: _ProjectionParams while a command buffer draws into a render texture is set natively; x = 1 here.
        prog.apply([{ _ProjectionParams: [1, 0.3, 1000, 1 / 1000], cubism_MaskTile: j.tile,
                      cubism_MaskTransform: j.transform, _MainTex: tex }, mat.floats, mat.colors]);
        applyState(gl, this.lib.state(MASK_SHADER, 0, mat.floats));
        this._bindAttribs(prog, r, [1, 1, 1, 1]);
        gl.drawElements(gl.TRIANGLES, this.buffers[mi].count, gl.UNSIGNED_SHORT, 0);
      }
  }

  // the MaterialPropertyBlock of a renderer. The rim and shadow values are the character's (character.js rim,
  // shadowIntensity): _RimIntensity is the rim threshold, as SetRimLightThreshold passes its value to
  // CubismRenderController.SetRimIntensity after the intensity; _RimColor is set once SetRimLightColor ran.
  _mpb(r) {
    const ch = this.ch, mt = ch.multiplyTexture;
    const sheet = {
      _MainTex: this.textures.get(r.textureDesc.texture),
      cubism_ModelOpacity: ch.rc.opacity,
      cubism_MultiplyColor: r.multiplyColor,
      cubism_ScreenColor: r.screenColor,
      _LightingEnabled: r.lightingEnabled,
      _RimLightingEnabled: ch.rim.enabled ? 1 : 0, _RimIntensity: ch.rim.threshold, _RimSmooth: ch.rim.smoothness,
      _ShadowIntensity: ch.shadowIntensity,
      _UseMultiplyTex: 1, _MultiplyTex: mt.texture || this.white,
      _MultiplyUV: [mt.uv.x, mt.uv.y, mt.uv.z, mt.uv.w], _MultiplyTexIntensity: mt.intensity,
      _MultiplyTexAmplitude: [mt.amplitude.x, mt.amplitude.y, 0, 0], _MultiplyTexFrequency: mt.frequency,
    };
    if (ch.rim.color) sheet._RimColor = ch.rim.color;
    if (r.maskTile) {
      sheet.cubism_MaskTexture = this.maskRT;
      sheet.cubism_MaskTile = r.maskTile;
      sheet.cubism_MaskTransform = r.maskTransform;
    }
    return sheet;
  }

  // draw items of the visible drawables: {sortingOrder, transform, draw(frame)}; `frame` carries the camera and light
  // globals and the per-object engine values (perObject(transform))
  items(extraKeywords) {
    const ch = this.ch;
    if (!ch.isShowing) return [];
    return ch.renderers.filter((r) => r.enabled).map((r) => ({
      sortingOrder: r.sortingOrder,
      transform: r.transform,
      draw: (frame) => this._draw(r, frame, extraKeywords),
    }));
  }

  _draw(r, frame, extraKeywords) {
    const gl = this.gl, mat = r.material;
    const kw = [...mat.keywords, ...extraKeywords];
    const prog = this.lib.program(LIT_SHADER, 0, kw);
    const perObject = frame.perObject(r.transform);
    prog.apply([this._mpb(r), mat.floats, mat.colors, perObject, frame.globals]);
    applyState(gl, this.lib.state(LIT_SHADER, 0, mat.floats));
    this._bindAttribs(prog, r, this.ch.displayed(r).color);
    gl.drawElements(gl.TRIANGLES, this.buffers[r.index].count, gl.UNSIGNED_SHORT, 0);
  }
}
