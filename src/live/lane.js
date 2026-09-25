import { F } from "../engine/core.js";
import { applyState } from "../engine/glsl.js";
import { mat4 } from "../engine/math.js";
import { Prefab } from "../engine/prefab.js";
import { GLTex } from "../engine/texture.js";
import { liveFitSheets, liveMaterialSheets } from "./renderer.js";

// LiveLane: the 3D lane of the live screen (LiveLaneLayout, LiveGeom, render order helpers): LiveLaneView / LiveLaneLineView / LiveLaneLine with the
// default options, the lane base sprite (+ mask), the tap area and its fade-in, the judgement line (hidden by
// default). Everything renders with LiveGameCamera into the in-game RT (layer 25, sorting 4000 / 4100 / 4101).
//
// Engine geometry that is native in Unity is built here the documented way (see the ENGINE: notes):
//   LiveGeom.lineStrip  LineRenderer, alignment View, texture mode Stretch, no corner / cap vertices
//   LiveGeom.sliced     SpriteRenderer draw mode Sliced (9-slice of the sprite rect)

export const LiveGeom = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  norm(v) { const l = Math.hypot(v.x, v.y, v.z); return l ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 }; },

  // LineRenderer with LineAlignment.View (0), LineTextureMode.Stretch (0), numCornerVertices 0, numCapVertices 0.
  // points: world positions; width(t), color(t) at the normalised length t in [0, 1]; camPos: world camera position.
  // Per point two vertices p +- side * width / 2, side = normalize(cross(tangent, camPos - p)); u = t, v = 0 / 1.
  // ENGINE: LineRenderer mesh generation is native; side vector, vertex order and v edges follow Unity's docs.
  // The side vector points towards the camera position rather than along the view direction; the strip faces the
  // camera and Stretch maps u over the whole length.
  lineStrip(points, width, color, camPos) {
    const G = LiveGeom, n = points.length;
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y,
                                                               points[i].z - points[i - 1].z));
    const total = len[n - 1] || 1;
    const pos = [], col = [], uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const tan = i === 0 ? G.sub(points[1], p) : i === n - 1 ? G.sub(p, points[n - 2]) : G.sub(points[i + 1], points[i - 1]);
      const side = G.norm(G.cross(G.norm(tan), G.sub(camPos, p)));
      const t = len[i] / total, hw = width(t) / 2, c = color(t);
      pos.push(p.x + side.x * hw, p.y + side.y * hw, p.z + side.z * hw, p.x - side.x * hw, p.y - side.y * hw, p.z - side.z * hw);
      col.push(...c, ...c);
      uv.push(t, 0, t, 1);
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
    }
    return { pos: new Float32Array(pos), col: new Float32Array(col), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
  },

  // SpriteRenderer drawMode Sliced (1): 9-slice over `size` (local units) of a sprite with rect (px), pivot
  // (normalised), border [L, B, R, T] (px), ppu, uv rect [u0, v0, u1, v1] of the sprite rect in its texture.
  // ENGINE: sliced sprite generation is native; borders shrink proportionally when size < border sum (documented).
  // The 9 quads are emitted row by row from the bottom, empty rows/columns kept.
  sliced(size, rect, pivot, border, ppu, uvRect, texSize) {
    const x0 = -pivot.x * size.x, x1 = x0 + size.x, y0 = -pivot.y * size.y, y1 = y0 + size.y;
    let [bl, bb, br, bt] = border.map((b) => b / ppu);
    if (bl + br > size.x) { const s = size.x / (bl + br); bl *= s; br *= s; }
    if (bb + bt > size.y) { const s = size.y / (bb + bt); bb *= s; bt *= s; }
    const xs = [x0, x0 + bl, x1 - br, x1], ys = [y0, y0 + bb, y1 - bt, y1];
    const [u0, v0, u1, v1] = uvRect;
    const us = [u0, u0 + border[0] / texSize.x, u1 - border[2] / texSize.x, u1];
    const vs = [v0, v0 + border[1] / texSize.y, v1 - border[3] / texSize.y, v1];
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { pos.push(xs[i], ys[j], 0); uv.push(us[i], vs[j]); }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      idx.push(a, a + 4, a + 5, a + 5, a + 1, a);
    }
    return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
  },
};

// Unity Gradient (serialized key0..7 / ctime / atime, m_Mode 0 Blend) evaluated at t (stored gamma values).
// ENGINE: Gradient.Evaluate is native; linear blending between neighbouring keys, clamped outside (Blend mode).
export const LiveGradient = {
  evaluate(g, t) {
    const pick = (n, time, get) => {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push({ t: g[`${time}${i}`] / 65535, v: get(g[`key${i}`]) });
      if (t <= keys[0].t) return keys[0].v;
      for (let i = 1; i < n; i++) if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.v.map((x, k) => x + (b.v[k] - x) * f);
      }
      return keys[n - 1].v;
    };
    const rgb = pick(g.m_NumColorKeys, "ctime", (k) => [k.r, k.g, k.b]);
    const [a] = pick(g.m_NumAlphaKeys, "atime", (k) => [k.a]);
    return [rgb[0], rgb[1], rgb[2], a];
  },
};

// ------------------------------------------------------------------------------------------ lane layout (no GL)
// LiveLaneView.Initialize -> LiveLaneLineView.Initialize / UpdateProperties /
// GetSettings / LiveLaneLine.SetLine / SetColor, with the default options
// (GuidelineCount 302 -> LaneSplitCountType, GuidelineOpacity 301 -> lineAlpha, LaneOpacity 300 -> lane base alpha).
// Returns every active line with its world end points, widths and end colours.
export const LiveLaneLayout = {
  LANE_COUNT: 24,                           // LiveDataCreator.CreateBootData
  SPLIT_MAIN: [0, 4, 6, 8, 12],             // constant table of the game code, by LiveLaneSplitCountType
  SPLIT_SUB: [12, 12, 12, 0, 0],            // constant table of the game code

  option(scene, name) {
    const o = scene.master.optionDefaultsPreset1[name];
    if (!o) throw new Error(`option ${name} missing`);
    return o.value;
  },

  build(scene, prefab) {
    const L = LiveLaneLayout, n = L.LANE_COUNT;
    const view = prefab.component("LiveGameView/root/LiveGameLane/lines", "LiveLaneLineView");
    const width = F(view._laneWidth), length = F(view._lineLength), spaceLen = F(view._spaceLineLength);
    const judgementZ = F(prefab.transform("LiveGameView/root/LiveGameLane/judgement_root").localPosition.z);
    const split = Number(L.option(scene, "GuidelineCount"));
    const lineAlpha = F(Number(L.option(scene, "GuidelineOpacity")) / 100);
    const main = L.SPLIT_MAIN[split], sub = L.SPLIT_SUB[split];
    // TrySetupSettingDictionary: OutSide widths = out_side_line texture height / 100
    const outW = F(scene.laneSkin.out_side_line.texture.height / 100);
    const settings = new Map(view._settings.map((s) => [s.LineType,
      s.LineType === 1 ? { ...s, LineWidthFrom: outW, LineWidthTo: outW } : s]));
    const lines = [];
    let x = F(width * -0.5);
    for (let i = 0; i <= n; i++) {
      let type = null;
      if (i === 0 || i === n) type = 1;
      else if (main && i % (n / main) === 0) type = 0;
      else if (sub && i % (n / sub) === 0) type = 2;
      if (type !== null) {
        const s = settings.get(type);
        const z0 = type === 2 ? F(judgementZ + F(spaceLen * -0.5)) : 0;
        const z1 = type === 2 ? F(z0 + spaceLen) : length;
        const w0 = F(s.LineWidthFrom);
        const w1 = i === n / 2 && type !== 2 ? F(s.LineWidthTo + s.LineWidthTo) : F(s.LineWidthTo);
        const anchor = i === 0 ? 2 : i === n ? 1 : 0;           // lane_line_left _anchor 2, right 1, prefab 0
        const lx = anchor === 2 ? F(x - F(w0 * 0.5)) : anchor === 1 ? F(x + F(w0 * 0.5)) : x;
        const g = s.LineColor;
        let c0 = LiveGradient.evaluate(g, 0), c1 = LiveGradient.evaluate(g, 1);
        // Normal / Space lines are in `lines`' LiveLineRendererAlphaController (base = lineAlpha, animation 1):
        // startColor.a = base * anim, endColor.a = base * anim, rgb kept.
        // OutSide lines keep their gradient (both_lines_alpha_controller never writes them).
        const controlled = type !== 1;
        if (controlled) { c0 = [c0[0], c0[1], c0[2], lineAlpha]; c1 = [c1[0], c1[1], c1[2], lineAlpha]; }
        lines.push({ index: i, type, x: lx, z0, z1, w0, w1, c0, c1, controlled,
                     material: type === 1 ? "outside" : "line" });
      }
      x = F(F(width / n) + x);
    }
    return { width, length, judgementZ, lineAlpha, split, lines,
             laneBaseAlpha: F(Number(L.option(scene, "LaneOpacity")) / 100),
             showJudgementLine: L.option(scene, "JudgePositionDisplay") === "TRUE" };
  },
};

// ScreenSpaceCamera canvas placement (the lane `base` canvas on LiveGameCamera): the canvas sits planeDistance in
// front of the camera with the camera's rotation, origin at the view centre, uniform scale
// s = 2 d tan(fov / 2) / (H / scaleFactor), CanvasScaler ScaleWithScreenSize Expand: scaleFactor = min(W/refW, H/refH).
// ENGINE: a ScreenSpaceCamera canvas transform is set natively; this is the documented placement, in float64.
LiveLaneLayout.canvasMatrix = (camTransform, fov, W, H, planeDistance, scaler) => {
  const L = camTransform.localToWorld();
  const fwd = { x: L[8], y: L[9], z: L[10] };
  const sf = Math.min(W / scaler.m_ReferenceResolution.x, H / scaler.m_ReferenceResolution.y);
  const s = 2 * planeDistance * Math.tan(fov * Math.PI / 360) / (H / sf);
  const t = { x: L[12] + fwd.x * planeDistance, y: L[13] + fwd.y * planeDistance, z: L[14] + fwd.z * planeDistance };
  return { matrix: mat4.trs(t, camTransform.localRotation, { x: s, y: s, z: s }), scale: s, scaleFactor: sf };
};

// LiveLaneView.UpdateMaskSizeAndPosition (mask height 0 with NoteStartPosition 0 -> the SpriteMask draws
// nothing and the lane renderers' VisibleOutsideMask stencil test passes everywhere: the stencil is not modelled).
LiveLaneLayout.maskHeight = (scene, W, H) => {
  const ratio = Number(LiveLaneLayout.option(scene, "NoteStartPosition")) / 100;
  const a = F(F(W) / F(H));
  const extra = a < F(1.7777778) ? F(F(1920 / a) - 1080) : 0;
  return { height: F(0 + F(F(extra + 1080 - 224) * ratio)), y: F(540 + extra) };
};

// ------------------------------------------------------------------------------------------ lane renderers
// Draws into the in-game RT through renderer.submit("game", ...). State driven from outside (LiveStage / intro):
//   laneTransform activeSelf (timeline / Animator), tapArea.animationAlpha (fade-in), laneBase.animationAlpha,
//   lines.animationStart/EndAlpha, sideLines.animationStart/EndAlpha (live_game_view clips hold them at 1).
export class LiveLane {
  constructor(renderer, scene) {
    this.r = renderer; this.scene = scene; this.prefab = renderer.prefab;
    this.layout = LiveLaneLayout.build(scene, this.prefab);
    const P = "LiveGameView/root/LiveGameLane";
    this.paths = { lane: P, base: `${P}/base`, laneBase: `${P}/base/lane_base`, tapArea: `${P}/judgement_root/tap_area` };
    this.laneBaseSR = this.prefab.component(this.paths.laneBase, "SpriteRenderer");
    this.tapSR = this.prefab.component(this.paths.tapArea, "SpriteRenderer");
    this.baseCanvas = this.prefab.component(this.paths.base, "Canvas");
    this.baseScaler = this.prefab.component(this.paths.base, "CanvasScaler");
    const lv = this.prefab.component(`${P}/lines`, "LiveLaneLineView");
    this.outsideMat = lv._outSideLineMaterial;
    // inner lines: instances of LiveLaneLineView._linePrefab EmbLive/Prefabs/LiveGame/lane_line (scene.assets.laneLinePrefab)
    const lp = new Prefab(scene.assets.laneLinePrefab), lpRoot = lp.root.name;
    const lineLR = lp.component(lpRoot, "LineRenderer");
    this.lineMat = lineLR.m_Materials[0];
    // LineRenderer parameters of the three line kinds must be what LiveGeom.lineStrip builds (world space,
    // alignment View, texture mode Stretch, no corner / cap vertices); width and colour come from the setters.
    const renderers = [[lp, lpRoot, lineLR], [this.prefab, `${P}/lines/lane_line_left`, null], [this.prefab, `${P}/lines/lane_line_right`, null]];
    for (const [pf, path, lr0] of renderers) {
      const lr = lr0 || pf.component(path, "LineRenderer"), q = lr.m_Parameters;
      if (!lr.m_UseWorldSpace || q.alignment !== 0 || q.textureMode !== 0 || q.numCornerVertices || q.numCapVertices ||
          q.textureScale.x !== 1 || lr.m_Loop)
        throw new Error(`${path}: LineRenderer parameters outside LiveGeom.lineStrip`);
    }
    // sorting orders: LiveRendererOrderInLayerSetter of each line (LiveLane 41 + 0 -> 4100)
    const innerOrder = LiveLane.sortingOrder(lp, lpRoot, lineLR.m_SortingOrder);
    for (const l of this.layout.lines)
      l.sortingOrder = l.index === 0 ? LiveLane.sortingOrder(this.prefab, `${P}/lines/lane_line_left`, 4100)
        : l.index === LiveLaneLayout.LANE_COUNT ? LiveLane.sortingOrder(this.prefab, `${P}/lines/lane_line_right`, 4100)
          : innerOrder;
    // LiveSpriteRendererAlphaController (a = base * animation): lane base base = LaneBaseAlpha, tap area base 1
    this.laneBase = { baseAlpha: this.layout.laneBaseAlpha, animationAlpha: 1 };
    this.tapArea = { baseAlpha: 1, animationAlpha: 1 };
    // LiveLineRendererAlphaController animation alphas (base already folded into the layout colours)
    this.lines = { animationStartAlpha: 1, animationEndAlpha: 1 };
    this.sideLines = { animationStartAlpha: 1, animationEndAlpha: 1 };
  }

  async load() {
    const gl = this.r.gl, base = this.r.base, sk = this.scene.laneSkin;
    const T = (d) => GLTex.load(gl, base, d);
    this.tex = { laneBase: await T(sk.lane_base.texture), tapArea: await T(sk.lane_tap_area.texture),
                 outside: await T(sk.out_side_line.texture),                 // Material.SetTexture(_MainTex, out_side_line)
                 line: await T(this.lineMat.textures._MainTex.texture) };
    this.vbo = { pos: gl.createBuffer(), uv: gl.createBuffer(), col: gl.createBuffer(), idx: gl.createBuffer() };
    // sliced meshes in sprite local units (LiveGeom.sliced: uv from the sprite rect)
    const sliced = (sr, sp) => {
      const tw = sp.texture.width, th = sp.texture.height, r = sp.rect;
      return LiveGeom.sliced(sr.m_Size, r, sp.pivot, [sp.border.x, sp.border.y, sp.border.z, sp.border.w], sp.pixelsToUnits,
                                [r.x / tw, r.y / th, (r.x + r.width) / tw, (r.y + r.height) / th], { x: tw, y: th });
    };
    this.meshes = { laneBase: sliced(this.laneBaseSR, sk.lane_base), tapArea: sliced(this.tapSR, sk.lane_tap_area) };
  }

  get active() { return this.prefab.activeInHierarchy(this.paths.lane); }

  _bind(prog, mesh, colConst) { LiveLane.bindMesh(this.r.gl, this.r.vao, this.vbo, prog, mesh, colConst); }

  static bindMesh(gl, vao, vbo, prog, mesh, colConst) {
    gl.bindVertexArray(vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    const up = (buf, data, target = gl.ARRAY_BUFFER) => { gl.bindBuffer(target, buf); gl.bufferData(target, data, gl.STREAM_DRAW); };
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      if (name === "in_POSITION0") { up(vbo.pos, mesh.pos); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
      else if (name === "in_TEXCOORD0") { up(vbo.uv, mesh.uv); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
      else if (name === "in_COLOR0") {
        if (mesh.col) { up(vbo.col, mesh.col); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); }
        else gl.vertexAttrib4f(loc, ...colConst);
      } else throw new Error(`${prog.label}: vertex input ${name}`);
    }
    up(vbo.idx, mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  }

  _spriteItem(sr, mesh, M, tex, alpha, order) {
    const c = sr.m_Color;
    return LiveLane.spriteItem(this.r, this.vbo, sr, mesh, M, tex, [c.r, c.g, c.b, F(c.a * alpha)], order);
  }

  // A SpriteRenderer draw: `color` = SpriteRenderer.color as the renderer holds it. Programs with a unity_SpriteColor
  // constant (URP 2D Sprite-Unlit-Default) get it there with vertex colour 1; other sprite shaders (e.g.
  // Custom/Mobile/MobileAddHdrColor) read it from the vertex colour. unity_SpriteProps = (flipX ? -1 : 1, flipY ?
  // -1 : 1, 0, 0).
  // ENGINE: Unity 6 passes the sprite colour via unity_SpriteColor (SRP-batched) or vertex colour; multiplied once.
  // unity_GUIZTestMode (a ZTest property of UI-style shaders drawn outside a canvas): 0 = no depth test.
  // ENGINE: unity_GUIZTestMode outside a canvas is native global state; 0 here, LEqual would draw the same pixels.
  // (Nothing writes depth in the live cameras' lists.)
  static spriteItem(r, vbo, sr, mesh, M, tex, color, order) {
    const mat = sr.m_Materials[0], shader = mat.shader.shader;
    const cen = mat4.transformPoint(M, LiveLane._center(mesh.pos));
    return {
      sortingLayer: sr.m_SortingLayer || 0, sortingOrder: order, queue: LiveLane.queue(r.lib, mat), center: cen,
      draw: (ctx) => {
        const gl = ctx.gl, prog = ctx.lib.program(shader, 0, mat.keywords), ms = liveMaterialSheets(ctx.lib, mat, ctx.tex);
        const constant = prog.blocks.some((b) => b.members.some((m) => m.name === "unity_SpriteColor")) ||
                         prog.uniforms.some((u) => u.name === "unity_SpriteColor");
        prog.apply(liveFitSheets(prog, [{ _MainTex: tex, unity_SpriteColor: constant ? color : [1, 1, 1, 1],
                      unity_SpriteProps: [sr.m_FlipX ? -1 : 1, sr.m_FlipY ? -1 : 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0],
                      ...LIVE_UI_DEAD_INPUTS },
                    ctx.perObject(M), ms.floats, ms.colors, ms.defaults, ctx.globals]));
        applyState(gl, ctx.lib.state(shader, 0, { unity_GUIZTestMode: 0, ...ms.floats }));
        LiveLane.bindMesh(gl, ctx.vao, vbo, prog, mesh, constant ? [1, 1, 1, 1] : color);
        gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
      },
    };
  }

  _queue(mat) { return LiveLane.queue(this.r.lib, mat); }

  static _center(pos) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
      z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
  }

  // one LineRenderer (world space, identity object matrix) with Sirius/Live/Sprite/Default
  _lineItem(l, camPos) {
    const mat = l.material === "outside" ? this.outsideMat : this.lineMat, shader = mat.shader.shader;
    const tex = l.material === "outside" ? this.tex.outside : this.tex.line;
    const an = l.controlled ? this.lines : this.sideLines;
    const c0 = [l.c0[0], l.c0[1], l.c0[2], F(l.c0[3] * an.animationStartAlpha)];
    const c1 = [l.c1[0], l.c1[1], l.c1[2], F(l.c1[3] * an.animationEndAlpha)];
    const mesh = LiveGeom.lineStrip([{ x: l.x, y: 0, z: l.z0 }, { x: l.x, y: 0, z: l.z1 }],
      (t) => l.w0 + (l.w1 - l.w0) * t, (t) => (t < 0.5 ? c0 : c1), camPos);
    const I = mat4.identity();
    return {
      sortingLayer: 0, sortingOrder: l.sortingOrder, queue: this._queue(mat), center: LiveLane._center(mesh.pos),
      draw: (ctx) => {
        const gl = ctx.gl, prog = ctx.lib.program(shader, 0, mat.keywords), ms = liveMaterialSheets(ctx.lib, mat, ctx.tex);
        prog.apply(liveFitSheets(prog, [{ _MainTex: tex }, ctx.perObject(I), ms.floats, ms.colors, ms.defaults, ctx.globals]));
        applyState(gl, ctx.lib.state(shader, 0, ms.floats));
        this._bind(prog, mesh);
        gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
      },
    };
  }

  // world matrices of the two sprites for the current screen size
  matrices() {
    const S = this.r.size, cam = this.r.cameras.game;
    const cm = LiveLaneLayout.canvasMatrix(cam.transform, cam.fov, S.W, S.H, this.baseCanvas.m_PlaneDistance, this.baseScaler);
    const lb = this.prefab.transform(this.paths.laneBase);
    return { canvas: cm, laneBase: mat4.mul(cm.matrix, lb.localMatrix()),
             tapArea: this.prefab.transform(this.paths.tapArea).localToWorld() };
  }

  // renderer.submit for this frame (LiveGameCamera, layer 25). Sorting orders: lane_base 4000 (40+0), lines 4100
  // (41+0), tap_area 4101 (41+1); distance = camera position to the renderer's bounds centre.
  submit() {
    if (!this.active) return;
    const cam = this.r.cameras.game, camPos = cam.transform.worldPosition(), m = this.matrices();
    const dist = (p) => Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z);
    const items = [];
    if (this.prefab.activeInHierarchy(this.paths.laneBase))
      items.push(this._spriteItem(this.laneBaseSR, this.meshes.laneBase, m.laneBase, this.tex.laneBase,
                                  F(this.laneBase.baseAlpha * this.laneBase.animationAlpha),
                                  LiveLane.sortingOrder(this.prefab, this.paths.laneBase, this.laneBaseSR.m_SortingOrder)));
    for (const l of this.layout.lines) items.push(this._lineItem(l, camPos));
    if (this.prefab.activeInHierarchy(this.paths.tapArea))
      items.push(this._spriteItem(this.tapSR, this.meshes.tapArea, m.tapArea, this.tex.tapArea,
                                  F(this.tapArea.baseAlpha * this.tapArea.animationAlpha),
                                  LiveLane.sortingOrder(this.prefab, this.paths.tapArea, this.tapSR.m_SortingOrder)));
    for (const it of items) this.r.submit("game", { ...it, distance: dist(it.center) });
  }
};
// UI-style shaders drawn outside a canvas (Custom/Mobile/MobileAddHdrColor) read the RectMask2D clip inputs only into
// a dead local in their no-keyword variant; any value gives the same output (UI defaults here).
export const LIVE_UI_DEAD_INPUTS = { _ClipRect: [-32767, -32767, 32767, 32767], _UIMaskSoftnessX: 0, _UIMaskSoftnessY: 0 };
LiveLane.QUEUE = { Background: 1000, Geometry: 2000, AlphaTest: 2450, Transparent: 3000, Overlay: 4000 };

// Material.renderQueue: the material's custom queue (m_CustomRenderQueue >= 0), else the shader's "Queue" tag
// ("Transparent", "Geometry+1", ...) of subshader 0.
LiveLane.queue = (lib, mat) => {
  if (mat.renderQueue >= 0) return mat.renderQueue;
  const tags = lib.info(mat.shader.shader).subShaders[0].tags;
  const q = ((tags && tags.tags) || []).find(([k]) => k.toUpperCase() === "QUEUE");
  if (!q) return 2000;
  const m = /^(\w+)([+-]\d+)?$/.exec(q[1]);
  if (!m || !(m[1] in LiveLane.QUEUE)) throw new Error(`${mat.shader.shader}: queue tag ${q[1]}`);
  return LiveLane.QUEUE[m[1]] + Number(m[2] || 0);
};

// LiveOrderInLayerUtility.GetOrderInLayer (a constant table of the game code) and
// LiveRendererOrderInLayerSetter / LiveCanvasOrderInLayerSetter: sortingOrder = map(_orderInLayer) + _offset.
export const LIVE_ORDER_IN_LAYER = { 10: 1000, 25: 2500, 26: 5700, 30: 3000, 40: 4000, 41: 4100, 42: 4200, 43: 4300, 44: 4400,
                           50: 5000, 55: 5500, 60: 6000, 100: 10000, 101: 4002, 200: 10002, 750: 9464, 751: 10000,
                           752: 2600, 753: 4050, 9100: 4600, 9101: 4699 };
LiveLane.sortingOrder = (prefab, path, fallback) => {
  const s = prefab.components(path).find((c) => c.class === "LiveRendererOrderInLayerSetter" ||
                                                c.class === "LiveCanvasOrderInLayerSetter");
  if (!s) return fallback;
  const v = LIVE_ORDER_IN_LAYER[s._orderInLayer];
  if (v === undefined) throw new Error(`${path}: LiveOrderInLayer ${s._orderInLayer}`);
  return v + (s._offset || 0);
};
