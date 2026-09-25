import { AnimClip, AnimTargets, Gradient } from "../engine/anim.js";
import { F } from "../engine/core.js";
import { ShaderLib, applyState } from "../engine/glsl.js";
import { Transform, mat4 } from "../engine/math.js";
import { GLTex } from "../engine/texture.js";
import { NoteGeo } from "./notegeo.js";

// Live note views on WebGL2: the port of LiveAllNoteView and its note head, flick arrow, slide / guide body and
// pair-line views with their per-frame view state. Geometry: NoteGeo (notegeo.js). Frame input: the frame result of
// LiveExecutor (simulator.js). Drawing goes through the renderer's submit("game", item).
//
// Every renderer here is a layer-25 SpriteRenderer or MeshRenderer of the in-game camera; its item carries the Unity
// sorting keys (sorting layer 0, sortingOrder, render queue 3000 of the Transparent shaders) and the camera distance of
// its bounds centre (TransparencySortMode Perspective); the renderer does the sort.
// ENGINE: a SpriteRenderer's colour and flip reach the shader as per-draw values, with white vertex colours.
// (Sprites/Default `_RendererColor` / `_Flip`, URP Sprite-Unlit-Default `unity_SpriteColor` / `unity_SpriteProps`)
// ENGINE: the SpriteRenderer mesh is native; rebuilt here from the sprite's mesh (Simple) or a 9-slice of its rect (Sliced).

// ------------------------------------------------------------------ SpriteRenderer meshes
export const SpriteMesh = {
  // DrawMode Simple: the sprite's own mesh (exported vertices / uv / indices, atlas packing already resolved)
  simple(sp) {
    return { pos: Float32Array.from(sp.vertices.flatMap((v) => [v[0], v[1], v[2] ?? 0])), uv: Float32Array.from(sp.uv.flat()),
             idx: Uint16Array.from(sp.indices) };
  },

  // DrawMode Sliced: 4 x 4 vertex grid over the rect at `size`, borders shrunk proportionally when they do not fit
  sliced(sp, sx, sy) {
    const ppu = sp.pixelsToUnits, r = sp.rect, tr = sp.textureRect, b = sp.border, tex = sp.texture;
    if (((sp.settingsRaw >> 2) & 15) !== 0) throw new Error(`${sp.sprite}: rotated atlas packing with sliced draw mode`);
    if (Math.abs(tr.width - r.width) > 1e-3 || Math.abs(tr.height - r.height) > 1e-3)
      throw new Error(`${sp.sprite}: trimmed texture rect with sliced draw mode`);
    const axis = (size, lo, hi, pivot, t0, tw, texSize) => {
      let a = lo / ppu, c = hi / ppu;
      if (a + c > size) { const k = size / (a + c); a *= k; c *= k; }
      const o = -pivot * size;
      return { p: [o, o + a, o + size - c, o + size], t: [t0, t0 + lo, t0 + tw - hi, t0 + tw].map((x) => x / texSize) };
    };
    const X = axis(sx, b.x, b.z, sp.pivot.x, tr.x, tr.width, tex.width);
    const Y = axis(sy, b.y, b.w, sp.pivot.y, tr.y, tr.height, tex.height);
    const pos = new Float32Array(48), uv = new Float32Array(32), idx = new Uint16Array(54);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const k = j * 4 + i;
      pos[k * 3] = X.p[i]; pos[k * 3 + 1] = Y.p[j]; uv[k * 2] = X.t[i]; uv[k * 2 + 1] = Y.t[j];
    }
    let o = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      idx.set([a, a + 4, a + 1, a + 1, a + 4, a + 5], o); o += 6;
    }
    return { pos, uv, idx };
  },
};

// ------------------------------------------------------------------ GL drawing of note renderers
export class NoteGL {
  constructor(gl, base) {
    this.gl = gl;
    this.base = base;                                   // packed livenotes directory ("livenotes")
    this.lib = new ShaderLib(gl, `${base}/shaders`);
    this.vao = gl.createVertexArray();
    this.tex = new Map();                               // texture path -> GLTex
    this.meshes = new Map();                            // key -> {buffers, count, bounds}
    this.defTex = { white: GLTex.solid(gl, [255, 255, 255, 255], "white"),
                    black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
                    gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"),
                    bump: GLTex.solid(gl, [128, 128, 255, 255], "bump") };
    this.buf = { pos: gl.createBuffer(), col: gl.createBuffer(), uv: [0, 1, 2, 3, 4].map(() => gl.createBuffer()),
                 idx: gl.createBuffer() };
  }

  async texture(desc) {
    if (!this.tex.has(desc.texture)) this.tex.set(desc.texture, await GLTex.load(this.gl, this.base, desc));
    return this.tex.get(desc.texture);
  }

  // static sprite mesh, cached by sprite / draw mode / size
  spriteMesh(sp, drawMode, sx, sy) {
    const key = drawMode === 1 ? `${sp.sprite}|${sx}|${sy}` : sp.sprite;
    let m = this.meshes.get(key);
    if (!m) {
      const g = this.gl, d = drawMode === 1 ? SpriteMesh.sliced(sp, sx, sy) : SpriteMesh.simple(sp);
      if (drawMode !== 0 && drawMode !== 1) throw new Error(`sprite draw mode ${drawMode}`);
      const mk = (data, target = g.ARRAY_BUFFER) => { const b = g.createBuffer(); g.bindBuffer(target, b); g.bufferData(target, data, g.STATIC_DRAW); return b; };
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < d.pos.length; i += 3) { x0 = Math.min(x0, d.pos[i]); x1 = Math.max(x1, d.pos[i]); y0 = Math.min(y0, d.pos[i + 1]); y1 = Math.max(y1, d.pos[i + 1]); }
      m = { pos: mk(d.pos), uv: mk(d.uv), idx: mk(d.idx, g.ELEMENT_ARRAY_BUFFER), count: d.idx.length,
            center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 } };
      if (this.meshes.size > 4096) {
        // the cache is full: it starts again. The meshes dropped now may still be drawn this frame; those dropped by
        // the previous restart are no longer in use and their buffers are deleted.
        for (const o of this._droppedMeshes || []) { g.deleteBuffer(o.pos); g.deleteBuffer(o.uv); g.deleteBuffer(o.idx); }
        this._droppedMeshes = [...this.meshes.values()];
        this.meshes.clear();
      }
      this.meshes.set(key, m);
    }
    return m;
  }

  _material(mat, shader) {
    const texST = {};
    for (const [k, v] of Object.entries(mat.textures || {})) texST[`${k}_ST`] = [v.scale.x, v.scale.y, v.offset.x, v.offset.y];
    return [mat.floats, mat.colors, texST, this.lib.defaults(shader, this.defTex)];
  }

  // one SpriteRenderer: sr = serialized component (material, flip, colour), sprite + mesh, world matrix M
  drawSprite(ctx, sr, tex, mesh, M, color) {
    const gl = this.gl, mat = sr.m_Materials[0], shader = mat.shader.shader;
    const prog = this.lib.program(shader, 0, mat.keywords);
    const c = color || sr.m_Color, fx = sr.m_FlipX ? -1 : 1, fy = sr.m_FlipY ? -1 : 1;
    prog.apply([{ _MainTex: tex, _RendererColor: [c.r, c.g, c.b, c.a], _Flip: [fx, fy],
                  unity_SpriteColor: [c.r, c.g, c.b, c.a], unity_SpriteProps: [fx, fy, 0, 0] },
                ctx.perObject(M), ...this._material(mat, shader), ctx.globals]);
    applyState(gl, this.lib.state(shader, 0, mat.floats));
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      if (name === "in_POSITION0") { gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
      else if (name === "in_TEXCOORD0") { gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
      else if (name === "in_COLOR0") gl.vertexAttrib4f(loc, 1, 1, 1, 1);
      else throw new Error(`${prog.label}: attribute ${name}`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  // the shader library requests a draw with `mat` makes (drawSprite / drawBody: program, render state, property
  // defaults), without drawing: the read-set plan (scripts/read-set.mjs --plan) makes them for the materials of
  // LiveNotes.plannedMaterials(), so the files they read are read without stepping the chart
  prepare(mat) {
    const shader = mat.shader.shader;
    this.lib.program(shader, 0, mat.keywords);
    this.lib.state(shader, 0, mat.floats);
    this.lib.defaults(shader, this.defTex);
  }

  // one body mesh (Live/Unlit/SlideLine): m = NoteGeo.bodyMesh result, mpb = {_GradientTex, _Color, _GradientState}
  drawBody(ctx, mat, m, M, mpb) {
    const gl = this.gl, shader = mat.shader.shader, prog = this.lib.program(shader, 0, mat.keywords);
    prog.apply([mpb, ctx.perObject(M), ...this._material(mat, shader), ctx.globals]);
    applyState(gl, this.lib.state(shader, 0, mat.floats));
    gl.frontFace(gl.CW);                              // Unity's clockwise front faces (Cull Back in this pass)
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    const up = (b, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); };
    const streams = { in_POSITION0: [this.buf.pos, m.position, 3], in_COLOR0: [this.buf.col, m.color, 4],
                      in_TEXCOORD0: [this.buf.uv[0], m.uv0, 2], in_TEXCOORD1: [this.buf.uv[1], m.uv1, 2],
                      in_TEXCOORD2: [this.buf.uv[2], m.uv2, 2], in_TEXCOORD3: [this.buf.uv[3], m.uv3, 2],
                      in_TEXCOORD4: [this.buf.uv[4], m.uv4, 2] };
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      const s = streams[name];
      if (!s) throw new Error(`${prog.label}: attribute ${name}`);
      up(s[0], s[1]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, s[2], gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, m.indices.length, gl.UNSIGNED_INT, 0);
  }

  // LiveSlideLineViewContainer.CreateGradientTexture (256 x 3 RGBA32, clamp, bilinear; row 0 disable,
  // row 1 normal, row 2 pressed) / LiveGuideLineViewContainer.CreateGradientTexture (one colour).
  // ENGINE: Texture2D.SetPixels float -> RGBA32 conversion is native; rounded to nearest here.
  gradientTexture(rows) {
    const gl = this.gl, px = new Uint8Array(256 * 3 * 4);
    rows.forEach((f, r) => { for (let i = 0; i < 256; i++) { const c = f(i / 255); for (let k = 0; k < 4; k++) px[(r * 256 + i) * 4 + k] = Math.round(Math.min(Math.max(c[k], 0), 1) * 255); } });
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    GLTex.sampler(gl, { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 }, 1);
    return new GLTex(gl, t, 256, 3, "line gradient");
  }
};

// ------------------------------------------------------------------ view types
// LiveNoteViewUtility.ConvertToLiveNoteViewType (LocalCacheData._isShowComboNote false on a fresh install)
export const NoteViewType = {
  of(note) {
    const op = note.op;
    if (op === 0 || op === 122 || op === 120 || op === 121) return 1;          // None
    if (op === 1 || op === 101) return 10;                                        // Tap
    if (op === 20) return 20; if (op === 21) return 21; if (op === 22) return 27; // Slide / Connection / SlideEnd
    if (op === 40 || op === 41 || op === 42 || op === 102)                        // FlickNoteConvertToLiveNoteViewType
      return { Normal: 30, Left: 31, Right: 32 }[note.direction] ?? (() => { throw new Error(`flick direction ${note.direction}`); })();
    if ((op >= 60 && op <= 63) || op === 104 || op === 105) return 40;            // Trace
    if (op === 80 || op === 82 || op === 100 || op === 103) return 50;            // Guide (no renderer)
    return 0;                                                                      // Undefined: 123, 23-39
  },
  // prefab / skin unit per view type (LiveAllNoteViewContainer list; names match 1:1)
  prefab: { 1: "none_note_view", 10: "tap_note_view", 20: "slide_note_view", 21: "connection_note_view",
            27: "slide_end_note_view", 30: "flick_note_view", 31: "flick_left_note_view", 32: "flick_right_note_view",
            40: "trace_note_view", 50: "guide_note_view", 25: "slide_combo_note_view", 26: "slide_combo_skip_note_view" },
  skin: { 10: "TapNoteAsset", 20: "SlideNoteAsset", 21: "SlideConnectNoteAsset", 27: "SlideEndNoteAsset",
          30: "FlickNoteAsset", 31: "LeftFlickNoteAsset", 32: "RightFlickNote", 40: "TraceNoteAsset" },
  // LiveAllNoteView line-begin / line-end types (IsLineBeginNoteType, IsLineEndNoteType)
  isLineBegin: (op) => [20, 41, 61, 80, 82, 100, 101, 102, 104].includes(op),
  isLineEnd: (op) => [22, 42, 62, 82, 103, 105].includes(op),
  // PlayingAfterUpdateViewDictionary .cctor ({1, 20, 100, 80: true; 21, 63: false}, keyed by
  // NoteOperateType, default true)
  updateAfter: (op) => !(op === 21 || op === 63),
};

// ------------------------------------------------------------------ one prefab instance (transforms + renderers)
export class NotePrefab {
  constructor(prefab, skipPrefix) {
    this.root = null;
    this.nodes = new Map();                       // path -> {t: Transform, sr?, active}
    for (const n of prefab.nodes) {
      if (skipPrefix && skipPrefix.some((s) => n.path.includes(s))) continue;
      const cut = n.path.lastIndexOf("/"), parent = cut < 0 ? null : this.nodes.get(n.path.slice(0, cut));
      if (cut >= 0 && !parent) continue;          // below a skipped node
      const t = new Transform(n.name, parent ? parent.t : null);
      t.localPosition = { ...n.localPosition }; t.localRotation = { ...n.localRotation }; t.localScale = { ...n.localScale };
      const srC = n.components.find((c) => c.type === "SpriteRenderer" || c.type === "MeshRenderer");
      const node = { t, active: n.active && (!parent || parent.active), path: n.path, comp: srC || null,
                     sprite: null, size: srC && srC.m_Size ? { ...srC.m_Size } : null, flipX: srC ? !!srC.m_FlipX : false,
                     enabled: srC ? !!srC.m_Enabled : false, order: srC ? srC.m_SortingOrder : 0,
                     color: srC && srC.m_Color ? { ...srC.m_Color } : null };
      this.nodes.set(n.path, node);
      if (!this.root) this.root = node;
    }
  }
  get(rel) { return this.nodes.get(rel ? `${this.root.path}/${rel}` : this.root.path) || null; }
};

// ------------------------------------------------------------------ note head view (LiveSpritePartsNoteViewBase family)
export class NoteHeadView {
  constructor(owner, type) {
    this.owner = owner; this.type = type;
    const prefab = owner.ln.prefabs[NoteViewType.prefab[type]];
    if (!prefab) throw new Error(`note view type ${type}: prefab missing`);
    this.p = new NotePrefab(prefab, ["gekisou"]);
    const root = this.p.root.comp ? null : prefab.nodes[0].components.find((c) => c.type === "MonoBehaviour");
    this.mb = root || {};
    const ref = (k) => (this.mb[k] && this.mb[k].gameObject ? this.p.nodes.get(this.mb[k].gameObject) || null : null);
    this.main = ref("_mainSpriteRenderer"); this.mark = ref("_markSpriteRenderer");
    this.left = ref("_leftSpriteRenderer"); this.right = ref("_rightSpriteRenderer");
    this.arrow = ref("_flickArrowSpriteRenderer"); this.subArrow = ref("_subArrowSpriteRenderer");
    this.parts = ref("_partsRenderer");
    this.unit = NoteViewType.skin[type] ? owner.ln.noteSkin[NoteViewType.skin[type]] : null;
    this.noteId = -1;
  }

  // LiveSpritePartsNoteViewBase.SetupNoteSkin (+ flick OnSetupNoteSkin)
  setupSkin() {
    const u = this.unit;
    if (!u) return;
    if (this.main) this.main.sprite = u._mainSprite;
    if (this.mark) this.mark.sprite = u._centerMarkSprite;
    if (this.arrow) {
      if (u._arrowTiltEnabled) throw new Error("flick arrow tilt path not implemented (skin _arrowTiltEnabled)");
      if (u._gradientSettings) throw new Error("flick arrow gradient path not implemented (skin _gradientSettings)");
      this.clip = this.owner.clip(u._arrowLoopAnimation.clip);
    }
    if (this.subArrow) {
      if (u._subArrowSprite) throw new Error("flick sub arrow sprite not implemented");
      this.subArrow.enabled = false;              // renderer.enabled = false when the skin has no sub arrow sprite
    }
  }

  // LiveNoteViewBase.Setup: id, width, lane centre, time, critical (OnSetup: crit look only with
  // _isShowEaseNote, false by default -> no change)
  setup(noteId, width, laneCenter, timeMs, critical) {
    this.noteId = noteId; this.width = width; this.laneCenter = laneCenter; this.timeMs = timeMs; this.critical = critical;
    this.v = 0; this._vw = NaN; this._lc = NaN; this.dirty = false;
    this.setupSkin();
  }

  setViewProgress(v) { this.v = v; this.dirty = true; }

  // LiveNoteViewBase.UpdateView (only when dirty: a head not stepped this frame keeps its transform)
  updateView() {
    if (!this.dirty) return;
    this.dirty = false;
    const G = NoteGeo, geo = this.owner.geo, v = this.v, r = this.p.root.t;
    const pl = geo.headPlacement(this.laneCenter, v);
    r.localPosition = { x: pl.x, y: pl.y, z: 0 };
    r.localScale = { x: v, y: v, z: v };
    const order = G.orderInLayer(v);                         // SetOrderInLayer -> OnSetOrderInLayer (flick / connection)
    if (this.arrow) this.arrow.order = order + 1;
    if (this.subArrow) this.subArrow.order = order + 1;
    if (this.parts) this.parts.order = order + 1;
    const vw = F(this.width * geo.unit);
    if (vw !== this._vw || this.laneCenter !== this._lc) {
      this._vw = vw; this._lc = this.laneCenter;
      if (this.unit && this.left) {
        const lay = geo.partsLayout(this.unit, this.laneCenter, this.width, vw);
        for (const [node, e] of [[this.left, lay.left], [this.right, lay.right]]) {
          node.sprite = e.sprite; node.flipX = e.flipX; node.size = { ...e.size };
          node.t.localPosition = { ...node.t.localPosition, x: e.x };
        }
        this.main.size = { ...lay.main.size };
        this.main.t.localPosition = { ...this.main.t.localPosition, x: lay.main.x };
      }
      if (this.arrow) {                                       // LiveFlickNoteView.OnSetViewWidth
        const sp = geo.arrowSprite(this.unit, vw);
        this.arrow.sprite = sp; this.arrow.size = G.spriteSize(sp);
      }
    }
  }

  renderers() {
    return [this.main, this.left, this.right, this.mark, this.arrow, this.subArrow].filter((n) => n && n.active && n.enabled && n.sprite);
  }
};

// ------------------------------------------------------------------ pair line (LivePairNoteLineView)
export class PairLineView {
  constructor(owner) {
    this.owner = owner;
    this.p = new NotePrefab(owner.ln.prefabs.pair_note_line);
    this.r = this.p.nodes.get(this.p.root.comp ? this.p.root.path : `${this.p.root.path}/renderer`);
    this.r.sprite = this.r.comp.m_Sprite;
  }
  // LiveAllNoteView.TrySpawnPairNoteLine -> Setup(spawn, mid, w)
  setup(a, b) {
    const geo = this.owner.geo, A = geo.jPair(a.laneStart, a.laneEnd), B = geo.jPair(b.laneStart, b.laneEnd);
    this.spawn = geo.spawn; this.mid = NoteGeo.lerpU2(A, B, 0.5); this.w = F(Math.abs(F(A.x - B.x)));
    this.ids = [a.id, b.id];
  }
  // LivePairNoteLineView.SetProgress
  setProgress(v) {
    this.r.size = { x: F(this.w * v), y: this.r.comp.m_Size.y };
    const k = NoteGeo.clamp01(v);
    this.p.root.t.localPosition = { x: F(this.spawn.x + F(F(this.mid.x - this.spawn.x) * k)),
                                    y: F(this.spawn.y + F(F(this.mid.y - this.spawn.y) * k)), z: 0 };
  }
};

// ------------------------------------------------------------------ body view (LiveSlideNoteLineView / LiveGuideNoteLineView)
export class NoteLineView {
  constructor(owner, kind) {
    this.owner = owner; this.kind = kind;
    const pf = owner.ln.prefabs[kind === "slide" ? "slide_line_view" : "guide_line_view"];
    this.mr = pf.nodes[0].components.find((c) => c.type === "MeshRenderer");
    this.mb = pf.nodes[0].components.find((c) => c.type === "MonoBehaviour" && /NoteLineView$/.test(c.class));
    this.lineId = -1;
  }
  // LiveAllNoteView.TrySpawnNoteLine -> SetActiveLineView(true), SetSlideAlpha, ApplyNoteLine
  apply(lineId, units, slideAlpha) {
    const o = this.owner, c = o.lineKinds[this.kind];
    this.lineId = lineId;
    this.line = { kind: this.kind, units, widthScale: c.widthScale, glowScale: c.glowScale, slideAlpha,
                  fadeRange: F(this.mb._fadeInProgressRange),
                  guideCurve: this.mb._guideAlphaCurve ? this.mb._guideAlphaCurve.m_Curve : null,
                  fadeBeforeEndMs: this.mb._fadeStartBeforeEndMs ?? 500 };
    this.gradientState = -1;
    this._in = null; this._mesh = null;
  }
  // LiveNoteLineViewBase.UpdateView (+ UpdateGradientState). The body mesh is built from the
  // frame's inputs when it is first read (drawing, stats): NoteGeo.bodyMesh is a function of these inputs only.
  update(t, D, bpep, pressed, missed) {
    this._in = { t, D, bpep }; this._mesh = null;
    this.gradientState = pressed ? 2 : missed ? 0 : 1;
  }
  get mesh() {
    if (!this._mesh && this._in) {
      const o = this.owner, i = this._in;
      this._mesh = o.geo.bodyMesh(this.line, i.t, i.D, o.noteSpeed, i.bpep);
    }
    return this._mesh;
  }
};

// ------------------------------------------------------------------ LiveAllNoteView (container of all views)
export class LiveNotes {
  // ln = livenotes/notes.json, score = score/<chart>.notes.json, opts.base = packed livenotes directory
  constructor(gl, ln, score, opts = {}) {
    this.gl = gl; this.ln = ln; this.score = score; this.base = opts.base || "livenotes";
    const s = ln.settings, od = s.optionDefaults;
    this.geo = new NoteGeo(s);
    this.noteSpeed = F(parseFloat(od.NoteSpeed));
    this.showPairLines = od.SimultaneousLineDisplay === "TRUE";          // option 108
    this.showBarLines = od.MeasureLineDisplay === "TRUE";                // option 109 (default FALSE: not drawn)
    this.showSkillLines = od.LiveSkillActivationPositionDisplay === "TRUE"; // option 309 (default FALSE: not drawn)
    if (this.showBarLines || this.showSkillLines) throw new Error("bar / skill lines are hidden by default and not implemented");
    this.notes = new Map(score.notes.map((n) => [n.id, n]));
    this.lines = new Map(score.lines.map((l) => [l.lineId, l]));
    this._clips = new Map();
    this.gl_ = gl ? new NoteGL(gl, this.base) : null;
    // line kinds: skin + container values
    const sk = ln.noteSkin;
    const normal = new Gradient(sk.SlideLineGradient), pressed = new Gradient(sk.SlideLinePressedGradient),
          disable = new Gradient(sk.SlideLineDisableGradient);
    const maxA = (g) => { let m = 0; for (let i = 0; i < 256; i++) m = Math.max(m, g.evaluate(i / 255)[3]); return F(m); };
    const SN = maxA(normal), SMin = Math.min(SN, maxA(pressed), maxA(disable));
    const guideColor = sk.OverrideGuideLineColor ? sk.GuideLineColor : null;
    if (!guideColor) throw new Error("guide container _color (OverrideGuideLineColor 0) not exported");   // skins must override it
    const GN = F(guideColor.a);
    // option ratio r = value / default; maxRatio = 100 / 60 (UpdateNoteAndGuideOpacity, ComputeLineAlpha)
    const range = s.optionRanges, ratio = (k) => F(parseFloat(od[k]) / parseFloat(od[k]));
    const maxR = (k) => F(F(range[k][1]) / F(parseFloat(od[k])));
    const alpha = (r, n, full, mr) => (r <= 1 ? F(n * r) : F(n + F(F(full - n) * F(F(r - 1) / F(mr - 1)))));
    this.lineKinds = {
      slide: { widthScale: F(sk.SlideLineWidthScale), glowScale: F(sk.SlideLineGlowRangeScale), normalMaxAlpha: SN,
               alpha: alpha(ratio("SlideOpacity"), SN, F(SN / SMin), maxR("SlideOpacity")),
               rows: [(x) => disable.evaluate(x), (x) => normal.evaluate(x), (x) => pressed.evaluate(x)] },
      guide: { widthScale: 1, glowScale: 0, normalMaxAlpha: GN,
               alpha: alpha(ratio("GuideOpacity"), GN, 1, maxR("GuideOpacity")),
               rows: [0, 1, 2].map(() => () => [guideColor.r, guideColor.g, guideColor.b, guideColor.a]) },
    };
    this.material = sk.SlideLineMaterial;         // both slide and guide (ApplyNoteLine: _skinMaterial ?? _longMaterial)
    this.spawned = new Map();                     // _currentSpawnNoteDictionary: noteId -> NoteHeadView
    this.held = new Map();                        // _currentSpawnLineBeginNoteDictionary: noteId -> {view, lineIds}
    this.lineViews = new Map();                   // _currentSpawnNoteLineDictionary: lineId -> NoteLineView
    this.pairs = new Map();                       // noteId -> PairLineView (registered under both ids)
    this.pool = new Map();                        // view type -> [views]
    this.t = 0; this.D = s.noteDisplayTimeMs;
  }

  // every view released and the flick graph unstarted: the state after load (the loaded textures are kept)
  reset() {
    this.spawned.clear(); this.held.clear(); this.lineViews.clear(); this.pairs.clear();
    this.graphTime = undefined; this._flickSeen = false;
    this.t = 0; this.D = this.ln.settings.noteDisplayTimeMs; this.fr = undefined;
  }

  clip(id) {
    if (!this._clips.has(id)) this._clips.set(id, AnimClip.fromMecanim(this.ln.clips[id], id));
    return this._clips.get(id);
  }

  async load() {
    if (!this.gl_) return;
    const g = this.gl_, want = new Map();
    const add = (sp) => { if (sp && sp.texture) want.set(sp.texture.texture, sp.texture); };
    const walk = (x) => { if (!x || typeof x !== "object") return; if (x.sprite && x.rect && x.texture) { add(x); return; }
                          for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v); };
    walk(this.ln.noteSkin);
    add(this.ln.prefabs.pair_note_line.nodes.flatMap((n) => n.components).find((c) => c.type === "SpriteRenderer").m_Sprite);
    for (const d of want.values()) await g.texture(d);
    for (const k of ["slide", "guide"]) this.lineKinds[k].tex = g.gradientTexture(this.lineKinds[k].rows);
  }

  // animation phase: the shared LoopAnimationTimeSync PlayableGraph of all flick views (one phase for every arrow,
  // global speed 1); the graph time advances by deltaTime per frame.
  // ENGINE: the graph's time origin (first OnEnable) is taken as the first animation phase after a flick view is rented.
  animate(loop) {
    if (this.advanceGraph(loop.deltaTime)) this.sampleArrows();
  }

  // the graph time step of animate(); false while the graph has not started
  advanceGraph(dt) {
    if (this.graphTime === undefined) {
      if (!this._flickSeen) return false;
      this.graphTime = 0;
    } else this.graphTime += dt;
    return true;
  }

  // the arrow clip of every flick view sampled at the graph time (the values depend on the graph time only)
  sampleArrows() {
    if (this.graphTime === undefined) return;
    for (const v of this._heads()) {
      if (!v.arrow || !v.clip) continue;
      v.clip.sample(this.graphTime, (i, val) => {
        const b = v.clip.curves[i].binding;
        if (b.path !== "arrow") throw new Error(`flick clip binding ${b.path}`);
        if (b.cls === "Transform") AnimTargets.transform(v.arrow.t, b.attr).set(val);
        else if (b.cls === "SpriteRenderer" && b.attr === "m_Color.a") v.arrow.color = { ...v.arrow.color, a: val };
        else throw new Error(`flick clip binding ${b.cls}.${b.attr}`);
      });
    }
  }

  *_heads() { yield* this.spawned.values(); for (const h of this.held.values()) yield h.view; }

  // The materials the note views draw over the whole chart, from the score alone (the read-set plan; nothing is
  // stepped and the views' state is not touched). update() spawns every note of a view type other than Undefined and
  // None once it approaches (TrySpawnNote) and submit() draws it while it is spawned, so: the head renderers of every
  // such note (its setup width decides which part and arrow sprites it has), the pair line when pair lines are shown
  // and such a note has a pair note, and the line body material when such a note begins a line.
  plannedMaterials() {
    const T = NoteViewType, G = NoteGeo, out = new Set();
    let pair = false, body = false;
    for (const note of this.score.notes) {
      const vt = T.of(note);
      if (vt === 0 || vt === 1) continue;                            // IsEnableViewNoteViewType
      const view = new NoteHeadView(this, vt);                        // as _rent / _trySpawnNote, without their state
      const lane0 = F(note.laneStartFloat + F(F(note.laneEndFloat - note.laneStartFloat) * 0.5));
      const cw = G.clampLaneAndWidth(lane0, F(note.width), this.geo.laneMin, this.geo.laneMax);
      view.setup(note.id, cw.width, cw.center, note.timeMs, note.critical);
      view.setViewProgress(1);
      view.updateView();
      for (const n of view.renderers()) out.add(n.comp.m_Materials[0]);
      if (this.showPairLines && note.pairNoteId && this.notes.has(note.pairNoteId)) pair = true;
      if (T.isLineBegin(note.op) && note.lineIds.length) body = true;
    }
    if (pair) {
      const pl = new PairLineView(this);
      if (pl.r.enabled && pl.r.active) out.add(pl.r.comp.m_Materials[0]);
    }
    if (body) out.add(this.material);
    return [...out];
  }

  holdHeads() {
    return [...this.held.entries()].filter(([, h]) => h.visible)
      .map(([noteId, h]) => ({ noteId, lineIds: h.lineIds, laneCenter: h.view.laneCenter, width: h.view.width }));
  }

  stats() {
    let quads = 0;
    for (const l of this.lineViews.values()) quads += l.mesh ? l.mesh.quads : 0;
    return { heads: this.spawned.size, held: this.held.size, lines: this.lineViews.size, bodyQuads: quads,
             pairs: new Set(this.pairs.values()).size };
  }

  // render hook: one item per visible renderer on the in-game camera
  submit(renderer) {
    const g = this.gl_, fr = renderer.frames.game, SR = fr.screenRoot, C = fr.cameraToWorld;
    const cam = { x: C[12], y: C[13], z: C[14] };
    const at = (M, c) => { const p = mat4.transformPoint(M, c); return { p, d: Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) }; };
    const sprite = (node) => {
      const comp = node.comp, M = mat4.mul(SR, node.t.localToWorld());
      const mesh = g.spriteMesh(node.sprite, comp.m_DrawMode, node.size.x, node.size.y), tex = g.tex.get(node.sprite.texture.texture);
      if (!tex) throw new Error(`texture not loaded: ${node.sprite.texture.texture}`);
      const { p, d } = at(M, mesh.center), sr = { m_Materials: comp.m_Materials, m_FlipX: node.flipX, m_FlipY: comp.m_FlipY };
      renderer.submit("game", { sortingLayer: comp.m_SortingLayer, sortingOrder: node.order, queue: 3000, distance: d,
                                center: p, draw: (ctx) => g.drawSprite(ctx, sr, tex, mesh, M, node.color) });
    };
    for (const v of this._heads()) if (v.visible !== false) for (const n of v.renderers()) sprite(n);
    for (const pl of new Set(this.pairs.values())) if (pl.r.enabled && pl.r.active) sprite(pl.r);
    for (const lv of this.lineViews.values()) {
      const m = lv.mesh;
      if (!m || !m.quads) continue;
      const k = this.lineKinds[lv.kind], c = this.material.colors._Color;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < m.position.length; i += 3) { x0 = Math.min(x0, m.position[i]); x1 = Math.max(x1, m.position[i]); y0 = Math.min(y0, m.position[i + 1]); y1 = Math.max(y1, m.position[i + 1]); }
      const { p, d } = at(SR, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 });
      // MaterialPropertyBlock (ApplyGradientTexture): _Color = (material rgb, 1 / NormalMaxAlpha)
      const mpb = { _GradientTex: k.tex, _Color: [c.r, c.g, c.b, k.normalMaxAlpha > 0 ? F(1 / k.normalMaxAlpha) : 1],
                    _GradientState: lv.gradientState };
      renderer.submit("game", { sortingLayer: lv.mr.m_SortingLayer, sortingOrder: lv.mr.m_SortingOrder, queue: 3000,
                                distance: d, center: p, draw: (ctx) => g.drawBody(ctx, this.material, m, SR, mpb) });
    }
  }

  // ---------------------------------------------------------------- LiveAllNoteView.UpdateNoteView
  // (default options: no respawn flags, no gekisou, no view filter).
  update(fr) {
    const T = NoteViewType, G = NoteGeo, t = fr.timeMs, D = fr.displayOffsetMs;
    this.t = t; this.D = D; this.fr = fr;
    // CleanupNoteView, phase 1 (update-note list)
    for (const id of fr.updateNoteIds) {
      const r = fr.noteResult(id);
      if (r.state === 0) this._releaseNote(r.note, true);
      else if (r.state === 6) this._releaseNote(r.note, false);     // NoteViewAutoReleaseDictionary: always true
      else if (r.state === 3) this._releasePair(id);
    }
    // phase 2: held (None) heads whose begin note has a line in Wait or Done
    const rm = [];
    for (const bid of this.held.keys())
      for (const lid of fr.note(bid).lineIds) if ((fr.lineState(lid).state | 2) === 2) rm.push(bid);
    for (const id of rm) this.held.delete(id);
    // A. state actions
    for (const id of fr.updateNoteIds) {
      const r = fr.noteResult(id), note = r.note, vt = T.of(note);
      if (vt === 0 || vt === 1) continue;                            // IsEnableViewNoteViewType
      if (![10, 20, 21, 25, 26, 27, 30, 31, 32, 40, 50].includes(vt)) throw new Error(`view type ${vt}`);
      const s = r.state;
      if (s === 1 || s === 2) this._playingNote(r);
      else if (s === 3) {                                             // UpdatePlayingJust
        this._playingNote(r);
        if (T.isLineEnd(note.op)) for (const lid of note.lineIds) this._releaseLine(lid);
      } else if (s === 4 && T.updateAfter(note.op)) this._playingNote(r);   // UpdatePlayingAfter
    }
    // B. heads
    for (const v of this.spawned.values()) v.updateView();
    // C. pair lines (once per dictionary entry, last write wins)
    for (const [id, pl] of this.pairs) pl.setProgress(G.viewProgress(fr.noteProgress(id)));
    // E. lines + held heads
    for (const [lid, lv] of this.lineViews) {
      const st = fr.lineState(lid), units = lv.line.units, bpep = [];
      let sel = null;
      for (let i = 0; i < units.length; i++) {
        const cu = st.units[i], rs = fr.noteResult(cu.start.id), re = fr.noteResult(cu.end.id);
        const bp = this._unitProgress(rs, t, cu.start.timeMs, D), ep = this._unitProgress(re, t, cu.end.timeMs, D);
        bpep.push({ bp, ep });
        if (ep <= 1 && bp >= 1) sel = units[i];
      }
      lv.update(t, D, bpep, st.isPressed(t), st.missed);
      const h = sel && this.held.get(st.startNote.id);
      if (h) {                                                        // held (None) head rides the judgement line
        const c = sel.Te === sel.Tb ? 1 : F(F(t - sel.Tb) / F(sel.Te - sel.Tb));   // CalculateConnectUnitProgress
        const e = G.ease(c, sel.eL);
        const lane = F(sel.l0 + F(F(sel.l1 - sel.l0) * G.clamp01(e))), width = F(sel.w0 + F(F(sel.w1 - sel.w0) * G.clamp01(e)));
        const cw = G.clampLaneAndWidth(lane, width, this.geo.laneMin, this.geo.laneMax);
        h.view.setViewProgress(1 - 0);                                // 1 - _viewProgressOffset (0)
        h.view.width = cw.width; h.view.laneCenter = cw.center;
        h.view.updateView();
        h.visible = true;
      }
    }
  }

  // LiveNoteLineViewUtility.CalculateUnitNoteProgress
  _unitProgress(r, t, T, D) {
    const p = F(F((t - T) + D) / F(D));
    return p >= 0 && !(r.state >= 3 && r.state <= 6) ? r.progress : p;
  }

  _rent(type) {
    const v = new NoteHeadView(this, type);
    if (type >= 30 && type <= 32) this._flickSeen = true;
    return v;
  }

  // UpdatePlayingNote
  _playingNote(r) {
    this._trySpawnNote(r);
    this.spawned.get(r.id).setViewProgress(NoteGeo.viewProgress(r.progress));
  }

  // TrySpawnNote
  _trySpawnNote(r) {
    const note = r.note, id = r.id, G = NoteGeo;
    if (this.spawned.has(id)) return;
    const view = this._rent(NoteViewType.of(note));
    const lane0 = F(note.laneStartFloat + F(F(note.laneEndFloat - note.laneStartFloat) * 0.5));   // EarlyFloatLerp(.., 0.5, clamp)
    const cw = G.clampLaneAndWidth(lane0, F(note.width), this.geo.laneMin, this.geo.laneMax);
    view.setup(id, cw.width, cw.center, note.timeMs, note.critical);
    this.spawned.set(id, view);
    if (NoteViewType.isLineBegin(note.op)) for (const lid of note.lineIds) this._trySpawnLine(this.fr.lineState(lid));
    this._trySpawnPair(id);
  }

  // TryReleaseNote
  _releaseNote(note, force) {
    const T = NoteViewType, id = note.id;
    if (!this.spawned.delete(id)) return;
    this._releasePair(id);
    if (!force && T.isLineBegin(note.op)) {                           // rent a None view that rides the line
      this.held.set(id, { view: this._rent(1), lineIds: note.lineIds, visible: false });
      return;
    }
    if (T.isLineEnd(note.op))
      for (const lid of note.lineIds) if (!force || this.fr.lineState(lid).state !== 1) this._releaseLine(lid);
  }

  // TrySpawnNoteLine
  _trySpawnLine(st) {
    if (this.lineViews.has(st.lineId)) return;
    const EASE = { Linear: 0, EaseIn: 1, EaseOut: 2 };
    const ease = (s) => { if (!(s in EASE)) throw new Error(`line ease ${s}`); return EASE[s]; };
    const units = st.units.map((cu) => ({ Tb: cu.start.timeMs, Te: cu.end.timeMs, l0: cu.startCenter, l1: cu.endCenter,
                                          w0: cu.startWidth, w1: cu.endWidth, eL: ease(cu.start.lineEase), eR: ease(cu.start.lineEaseR) }));
    const op = st.startNote.op;                                       // ConvertToLiveNoteLineViewType
    const kind = [20, 41, 61, 80, 82].includes(op) ? "slide" : (op >= 100 && op <= 105) ? "guide" : null;
    if (!kind) throw new Error(`line ${st.lineId}: begin op ${op} has no line view type`);
    const lv = new NoteLineView(this, kind);
    lv.apply(st.lineId, units, this.lineKinds[kind].alpha);
    this.lineViews.set(st.lineId, lv);
  }

  // TryReleaseNoteLine
  _releaseLine(lid) {
    if (!this.lineViews.delete(lid)) return;
    this.held.delete(this.fr.lineState(lid).startNote.id);
  }

  // TrySpawnPairNoteLine
  _trySpawnPair(id) {
    if (!this.showPairLines || this.pairs.has(id)) return;
    const note = this.fr.note(id);
    if (!note.pairNoteId) return;                                     // INote.ContainsPairNote
    const rp = this.fr.noteResult(note.pairNoteId);
    if (!rp || rp.state === 6) return;
    const pl = new PairLineView(this);
    pl.setup(note, rp.note);
    this.pairs.set(id, pl); this.pairs.set(rp.id, pl);
  }

  // TryReleasePairNoteLine
  _releasePair(id) {
    if (!this.pairs.delete(id)) return;
    this.pairs.delete(this.fr.note(id).pairNoteId);
  }
};
