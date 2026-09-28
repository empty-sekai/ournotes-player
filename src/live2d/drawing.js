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
    this.textures = new Map();
    // The meshes of all drawables in shared buffers: a drawable's vertices at a fixed place (from its vertex `base`),
    // its indices rebased onto them (from index `first`). The positions and vertex colours of the displayed meshes are
    // copied in when they changed and uploaded once (_sync); a draw only picks its range of the indices.
    let verts = 0, indices = 0;
    this.slots = character.renderers.map((r) => {
      const s = { base: verts, first: indices, count: r.indices.length, pos: null, color: null };
      verts += r.uvs.length / 2; indices += r.indices.length;
      return s;
    });
    const wide = verts > 0x10000;
    this.indexType = wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; this.indexSize = wide ? 4 : 2;
    const idx = wide ? new Uint32Array(indices) : new Uint16Array(indices), uv = new Float32Array(verts * 2);
    for (const r of character.renderers) {
      const s = this.slots[r.index];
      for (let i = 0; i < r.indices.length; i++) idx[s.first + i] = s.base + r.indices[i];
      uv.set(r.uvs, s.base * 2);
    }
    this.positions = new Float32Array(verts * 2);
    this.colors = new Float32Array(verts * 4);
    const buffer = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; };
    this.buf = { pos: buffer(this.positions, gl.DYNAMIC_DRAW), color: buffer(this.colors, gl.DYNAMIC_DRAW),
                 uv: buffer(uv, gl.STATIC_DRAW), constant: buffer(new Float32Array([...MISSING_NORMAL, ...MISSING_TANGENT, 1, 1, 1, 1]), gl.STATIC_DRAW),
                 idx: gl.createBuffer() };
    this.vaos = new Map();                   // program -> the vertex array of its inputs (_vao)
    this.last = { prog: null, state: null, vao: null };   // what the drawing's last draw set (_drawSlot)
    gl.bindVertexArray(this._vao(null));     // the element buffer is vertex array state: filled on a vertex array of ours
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
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

  // copies the displayed meshes that changed (CubismRenderer swaps in a new mesh, or gives it new vertex colours) into
  // the shared buffers and uploads them; called before the draws of a frame (renderMasks, items)
  _sync() {
    const gl = this.gl, P = this.positions, C = this.colors;
    let pos = false, color = false;
    for (const r of this.ch.renderers) {
      const s = this.slots[r.index], m = r.meshes[r.front];
      if (s.pos !== m.pos) { P.set(m.pos, s.base * 2); s.pos = m.pos; pos = true; }
      const c = m.color, k = s.base * 4, f = Math.fround;    // Mesh.colors: the renderer's colour on every vertex
      if (s.color !== c && (!s.color || C[k] !== f(c[0]) || C[k + 1] !== f(c[1]) || C[k + 2] !== f(c[2]) || C[k + 3] !== f(c[3]))) {
        for (let i = k, e = k + (m.pos.length >> 1) * 4; i < e; i += 4) { C[i] = c[0]; C[i + 1] = c[1]; C[i + 2] = c[2]; C[i + 3] = c[3]; }
        color = true;
      }
      s.color = c;
    }
    if (pos) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, P, gl.DYNAMIC_DRAW); }
    if (color) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.color); gl.bufferData(gl.ARRAY_BUFFER, C, gl.DYNAMIC_DRAW); }
  }

  // the vertex array of a program's inputs over the shared buffers: positions (z = 0, w = 1), UVs and vertex colours
  // from arrays, NORMAL / TANGENT constant (one value with divisor 1: every vertex of a draw reads it); a mask draw's
  // colour is constant white. `prog` null: a vertex array with the element buffer only.
  _vao(prog, mask = false) {
    let vao = this.vaos.get(prog);
    if (vao) return vao;
    const gl = this.gl, b = this.buf;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const array = (buf, loc, n, offset = 0, divisor = 0) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, offset);
      gl.vertexAttribDivisor(loc, divisor);
      gl.enableVertexAttribArray(loc);
    };
    if (prog) for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      if (name === "in_POSITION0") array(b.pos, loc, 2);
      else if (name === "in_TEXCOORD0") array(b.uv, loc, 2);
      else if (name === "in_COLOR0") { if (mask) array(b.constant, loc, 4, 32, 1); else array(b.color, loc, 4); }
      else if (name === "in_NORMAL0") array(b.constant, loc, 4, 0, 1);
      else if (name === "in_TANGENT0") array(b.constant, loc, 4, 16, 1);
      else throw new Error(`${prog.label}: attribute ${name}`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
    this.vaos.set(prog, vao);
    return vao;
  }

  // One draw of a drawable. `cont`: the previous draw on the context was this drawing's, with nothing between, so the
  // context holds what that draw set; the program, pass state and vertex array it had are not set again.
  _drawSlot(prog, sheets, state, r, mask, cont) {
    const gl = this.gl, s = this.slots[r.index], vao = this._vao(prog, mask), last = this.last;
    prog.apply(sheets, cont && last.prog === prog);
    if (!(cont && last.state === state)) applyState(gl, state);
    if (!(cont && last.vao === vao)) gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, s.count, this.indexType, s.first * this.indexSize);
    last.prog = prog; last.state = state; last.vao = vao;
  }

  // Draws items in order; frameOf(item, prev) gives the frame of a draw, `prev` the item drawn just before.
  static drawItems(items, frameOf) {
    let prev = null;
    for (const it of items) { it.draw(frameOf(it, prev)); prev = it; }
  }

  // CubismMaskCommandBuffer: clear and redraw the mask texture when it is flagged. The mask meshes are the displayed
  // buffers, drawn in model space (identity matrix), each into its junction's tile and channel.
  renderMasks() {
    const ch = this.ch, gl = this.gl;
    if (!ch.maskDirty) return;
    ch.maskDirty = false;
    this._sync();
    this.maskRT.bind();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = this.lib.program(MASK_SHADER, 0, []);
    let cont = false;
    for (const j of ch.junctions)
      for (const mi of j.masks) {
        const r = ch.renderers[mi];
        const mat = this.maskMats[r.doubleSided ? 0 : 1];
        const tex = this.textures.get(r.textureDesc.texture);
        // ENGINE: _ProjectionParams while a command buffer draws into a render texture is set natively; x = 1 here.
        this._drawSlot(prog, [{ _ProjectionParams: [1, 0.3, 1000, 1 / 1000], cubism_MaskTile: j.tile,
                                cubism_MaskTransform: j.transform, _MainTex: tex }, mat.floats, mat.colors],
                       this.lib.state(MASK_SHADER, 0, mat.floats), r, true, cont);
        cont = true;
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

  // draw items of the visible drawables: {sortingOrder, transform, drawing, draw(frame)}; `frame` carries the camera
  // and light globals, the per-object engine values (perObject(transform)) and `prev`, the item drawn just before on
  // the context (none: something else may have drawn)
  items(extraKeywords) {
    const ch = this.ch;
    if (!ch.isShowing) return [];
    this._sync();
    return ch.renderers.filter((r) => r.enabled).map((r) => ({
      sortingOrder: r.sortingOrder,
      transform: r.transform,
      drawing: this,
      draw: (frame) => this._draw(r, frame, extraKeywords),
    }));
  }

  _draw(r, frame, extraKeywords) {
    const mat = r.material;
    const kw = extraKeywords.length ? mat.keywords.concat(extraKeywords) : mat.keywords;
    const prog = this.lib.program(LIT_SHADER, 0, kw);
    const sheets = [this._mpb(r), mat.floats, mat.colors, frame.perObject(r.transform), frame.globals];
    this._drawSlot(prog, sheets, this.lib.state(LIT_SHADER, 0, mat.floats), r, false,
                   !!frame.prev && frame.prev.drawing === this);
  }
}
