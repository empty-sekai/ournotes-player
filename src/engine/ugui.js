import { F } from "./core.js";
import { applyState } from "./glsl.js";
import { AnimClip, Animator } from "./anim.js";
import { easeF } from "./tween.js";

// uGUI subset on WebGL2 with the game's UI shaders, for the live UI canvases (judgement text, combo counter,
// canvas.js) and the story's front canvas: RectTransform layout, Image simple / sliced meshes, sprites, CanvasGroup,
// CanvasScaler, layout groups, canvas drawing, Animator clips of UI nodes (UIClip, UIAnimator), DOTween UI tweens
// (UITween) and sequences, clip targets. uGUI behaviour follows the game's build
// (uGUI 2.0) where it is managed code, else the uGUI reference sources; `ENGINE:` marks Unity's native parts.
//
// Coordinates: a canvas is laid out in its own units, y up (Unity). A node's rect is in its own local space with the
// pivot at the origin (RectTransform.rect); node matrices map local space to canvas space, origin at the canvas'
// bottom-left corner. Draws use an orthographic projection over [0, W] x [0, H] with unity_ObjectToWorld = identity
// (vertices are pre-transformed, as the canvas batcher does). The UI camera (UIManager UICamera) is orthographic,
// so this P with lossyScale 1 gives the shaders the same pixel scale as the game's (camera P, canvas lossyScale)
// pair; a shader's ortho branch is taken (glstate_matrix_projection[3].w = 1).

export class UIError extends Error {};

// ------------------------------------------------------------------- 2D affine transforms
// [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
export const UIAffine = {
  identity() { return [1, 0, 0, 1, 0, 0]; },
  translate(x, y) { return [1, 0, 0, 1, x, y]; },
  mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  },
  // T(t) * Rz(deg) * S(s): a RectTransform's local matrix (z rotation only; other axes are rejected by UINode)
  trs(tx, ty, deg, sx, sy) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c * sx, s * sx, -s * sy, c * sy, tx, ty];
  },
  apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
};

// ------------------------------------------------------------------- Animator clip (Mecanim streamed curves)
// Setters of the RectTransform / CanvasGroup / Transform properties that Animator clips drive, by property name.
export const UI_CLIP_TARGET = {
  "RectTransform.m_AnchoredPosition.x": (n, v) => { n.anchoredPosition.x = v; },
  "RectTransform.m_AnchoredPosition.y": (n, v) => { n.anchoredPosition.y = v; },
  "RectTransform.m_SizeDelta.x": (n, v) => { n.sizeDelta.x = v; },
  "RectTransform.m_SizeDelta.y": (n, v) => { n.sizeDelta.y = v; },
  "RectTransform.m_AnchorMin.x": (n, v) => { n.anchorMin.x = v; },
  "RectTransform.m_AnchorMin.y": (n, v) => { n.anchorMin.y = v; },
  "RectTransform.m_AnchorMax.x": (n, v) => { n.anchorMax.x = v; },
  "RectTransform.m_AnchorMax.y": (n, v) => { n.anchorMax.y = v; },
  "RectTransform.m_Pivot.x": (n, v) => { n.pivot.x = v; },
  "RectTransform.m_Pivot.y": (n, v) => { n.pivot.y = v; },
  "CanvasGroup.m_Alpha": (n, v) => {
    if (!n.canvasGroup) throw new UIError(`${n.path}: clip drives a missing CanvasGroup`);
    n.canvasGroup.alpha = v;
  },
  "Transform.localEulerAngles.x": (n, v) => { n.setEuler("x", v); },
  "Transform.localEulerAngles.y": (n, v) => { n.setEuler("y", v); },
  "Transform.localEulerAngles.z": (n, v) => { n.setEuler("z", v); },
};

// An Animator clip of the UI data (per-property curves on the animated node, AnimClip.fromCurves). Every property must
// have a setter in UI_CLIP_TARGET; clips with a start time or animation events are not implemented.
export class UIClip extends AnimClip {
  constructor(clip) {
    if (clip.startTime !== 0) throw new UIError(`clip ${clip.name}: start time ${clip.startTime}`);
    if (clip.events && clip.events.length) throw new UIError(`clip ${clip.name}: animation events not implemented`);
    for (const prop of Object.keys(clip.curves))
      if (!UI_CLIP_TARGET[prop]) throw new UIError(`clip ${clip.name}: property ${prop} not implemented`);
    super(AnimClip.fromCurves(clip));
  }
}

// The Animator of a UI node: a one-layer AnimatorController without transitions or parameters (the story's front
// canvas views) on Animator. ctrl = {name, defaultState, states: [{name, speed, clip, cycleOffset}]} with `clip` the
// clip's name; clips: "<controller>/<clip>" -> UIClip. A state whose clip is not in `clips` is only allowed for the
// empty "Idle" clips (AdvLocation / AdvTitle); such a state writes nothing.
// ENGINE: what an empty state writes with Write Defaults is native; the states here write nothing (Write Defaults off).
export class UIAnimator extends Animator {
  constructor(node, ctrl, clips) {
    const states = ctrl.states.map((s) => {
      const key = `${ctrl.name}/${s.clip}`;
      let clip = null;
      if (s.clip && clips[key]) clip = clips[key];
      else if (s.clip && s.clip !== "Idle") throw new UIError(`${node.path}: clip ${key} not in the data`);
      if (s.cycleOffset) throw new UIError(`${ctrl.name}.${s.name}: cycle offset not implemented`);
      return { name: s.name, speed: s.speed, clip, writeDefaults: false, transitions: [] };
    });
    const defaultState = states.findIndex((s) => s.name === ctrl.defaultState);
    if (defaultState < 0) throw new UIError(`${ctrl.name}: no default state ${ctrl.defaultState}`);
    super({ name: ctrl.name, states, defaultState, anyState: [], parameters: new Map() },
          (b) => { const set = UI_CLIP_TARGET[b.prop]; return { set: (v) => set(node, v) }; });
    this.node = node;
    // Animator.speed starts at 1 (the Location / Title views' SetPlaybackSpeed changes it)
  }

  // SimpleAnimationTrigger.PlayAnimation -> Animator.CrossFade(state, _blendTime 0, layer 0, normalizedTimeOffset 0):
  // an immediate switch (Animator.play)
  play(name) {
    if (!this.ctrl.states.some((s) => s.name === name)) throw new UIError(`${this.name}: no state ${name}`);
    super.play(name);
  }
}

// UnityEngine.Color -> Color32 (inlined in the game code): round half to even of clamp01(c) * 255 (float32 multiply)
export const uiColor32 = (c) => [c.r, c.g, c.b, c.a].map((v) => {
  const x = F(Math.min(Math.max(v, 0), 1) * 255), r = Math.round(x);
  return (Math.abs(x - Math.trunc(x)) === 0.5 && r % 2) ? r - 1 : r;
});

// ------------------------------------------------------------------- RectTransform node
export class UINode {
  constructor(rec, parent) {
    this.path = rec.path;
    this.name = rec.name;
    this.parent = parent;
    this.children = [];
    if (parent) parent.children.push(this);
    this.activeSelf = !!rec.active;
    const r = rec.rect;
    if (!r) throw new UIError(`${rec.path}: no RectTransform`);
    const v = (p) => ({ x: p.x, y: p.y });
    this.anchorMin = v(r.m_AnchorMin); this.anchorMax = v(r.m_AnchorMax);
    this.anchoredPosition = v(r.m_AnchoredPosition); this.sizeDelta = v(r.m_SizeDelta); this.pivot = v(r.m_Pivot);
    const q = rec.localRotation;
    if (Math.abs(q.x) > 1e-7 || Math.abs(q.y) > 1e-7) throw new UIError(`${rec.path}: rotation outside the canvas plane`);
    this.rotationZ = 2 * Math.atan2(q.z, q.w) * 180 / Math.PI;
    this.euler = null;                  // set by an Animator (Transform.localEulerAngles)
    this.localScale = { x: rec.localScale.x, y: rec.localScale.y };
    this.canvasGroup = rec.canvasGroup && rec.canvasGroup.m_Enabled
      ? { alpha: rec.canvasGroup.m_Alpha, ignoreParentGroups: !!rec.canvasGroup.m_IgnoreParentGroups } : null;
    this.rec = rec;
    this.rect = null;                   // {x, y, w, h} in own local space (after layout)
    this.matrix = null;                 // local -> canvas space
  }

  setEuler(axis, v) {
    if (!this.euler) this.euler = { x: 0, y: 0, z: this.rotationZ };
    this.euler[axis] = v;
    if (Math.abs(this.euler.x) > 1e-6 || Math.abs(this.euler.y) > 1e-6)
      throw new UIError(`${this.path}: euler rotation outside the canvas plane`);
    this.rotationZ = this.euler.z;      // Quaternion.Euler(0, 0, z)
  }

  get activeInHierarchy() {
    for (let n = this; n; n = n.parent) if (!n.activeSelf) return false;
    return true;
  }

  // RectTransform: the anchor rectangle in the parent's rect, size = anchor extent + sizeDelta, pivot position =
  // lerp(anchorMin, anchorMax, pivot) + anchoredPosition (Unity RectTransform semantics).
  layoutIn(pr, parentMatrix) {
    const aMinX = F(pr.x + F(this.anchorMin.x * pr.w)), aMaxX = F(pr.x + F(this.anchorMax.x * pr.w));
    const aMinY = F(pr.y + F(this.anchorMin.y * pr.h)), aMaxY = F(pr.y + F(this.anchorMax.y * pr.h));
    const w = F(F(aMaxX - aMinX) + this.sizeDelta.x), h = F(F(aMaxY - aMinY) + this.sizeDelta.y);
    const px = F(F(aMinX + F(F(aMaxX - aMinX) * this.pivot.x)) + this.anchoredPosition.x);
    const py = F(F(aMinY + F(F(aMaxY - aMinY) * this.pivot.y)) + this.anchoredPosition.y);
    this.rect = { x: F(-this.pivot.x * w), y: F(-this.pivot.y * h), w, h };
    this.matrix = UIAffine.mul(parentMatrix,
      UIAffine.trs(px, py, this.rotationZ, this.localScale.x, this.localScale.y));
    for (const c of this.children) c.layoutIn(this.rect, this.matrix);
  }

  // RectTransform.SetSizeWithCurrentAnchors(axis, size): sizeDelta = size - anchor extent in the parent rect
  setSizeWithCurrentAnchors(axis, size) {
    const k = axis === 0 ? "x" : "y", pr = this.parent.rect, ext = axis === 0 ? pr.w : pr.h;
    this.sizeDelta[k] = F(size - F(F(this.anchorMax[k] - this.anchorMin[k]) * ext));
  }

  // canvas-space bounding box of the rect: [x0, y0, x1, y1], y up
  canvasBox() {
    const r = this.rect, m = this.matrix;
    const ps = [[r.x, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h], [r.x + r.w, r.y]].map(([x, y]) => UIAffine.apply(m, x, y));
    return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])),
            Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
  }

  find(rel) {
    let n = this;
    for (const part of rel.split("/")) {
      n = n.children.find((c) => c.name === part);
      if (!n) throw new UIError(`ui node not found: ${this.path}/${rel}`);
    }
    return n;
  }
};

// ------------------------------------------------------------------- uGUI meshes (VertexHelper)
// Vertices in the graphic's local rect space: {x, y, c: Color32 [r, g, b, a], u, v}; indices are triangles.
export class UIMesh {
  constructor() { this.verts = []; this.idx = []; }
  addVert(x, y, c, u, v) { this.verts.push({ x, y, c, u, v }); }
  addTriangle(a, b, c) { this.idx.push(a, b, c); }

  // Image.AddQuad: (min.x,min.y) (min.x,max.y) (max,max) (max.x,min.y); triangles 0,1,2 / 2,3,0
  addQuad(x0, y0, x1, y1, c, u0, v0, u1, v1) {
    const s = this.verts.length;
    this.addVert(x0, y0, c, u0, v0); this.addVert(x0, y1, c, u0, v1);
    this.addVert(x1, y1, c, u1, v1); this.addVert(x1, y0, c, u1, v0);
    this.addTriangle(s, s + 1, s + 2); this.addTriangle(s + 2, s + 3, s);
  }

  // VertexHelper.GetUIVertexStream: the triangle list with one vertex per index
  stream() { return this.idx.map((i) => ({ ...this.verts[i] })); }

  static fromStream(tri) {             // VertexHelper.AddUIVertexTriangleStream
    const m = new UIMesh();
    m.verts = tri; m.idx = tri.map((_, i) => i);
    return m;
  }
};

// Sprite geometry from the sprite data (textureRect already in packed-texture texels).
// ENGINE: Sprites.DataUtility.GetOuterUV / GetInnerUV / GetPadding are native; these are Unity's sprite data formulas.
// outer = textureRect / texture size, padding = textureRectOffset and the trimmed rest of the sprite rect,
// inner = outer inset by the border (implemented for untrimmed sprites only).
export class UISprite {
  constructor(name, s, tex) {
    this.name = name; this.texture = tex; this.rect = s.rect; this.border = s.border;
    this.pixelsPerUnit = s.pixelsPerUnit; this.pivot = s.pivot;
    const tr = s.textureRect, off = s.textureRectOffset, W = tex.width, H = tex.height;
    this.outer = [tr.x / W, tr.y / H, (tr.x + tr.width) / W, (tr.y + tr.height) / H];
    this.padding = [off.x, off.y, s.rect.width - tr.width - off.x, s.rect.height - tr.height - off.y];
    this.trimmed = off.x !== 0 || off.y !== 0 || tr.width !== s.rect.width || tr.height !== s.rect.height;
    const b = s.border;
    this.hasBorder = b.x + b.y + b.z + b.w > 0;
    this.inner = this.trimmed ? null
      : [(tr.x + b.x) / W, (tr.y + b.y) / H, (tr.x + tr.width - b.z) / W, (tr.y + tr.height - b.w) / H];
  }
};

// Mathf.RoundToInt (round half to even)
export const uiRoundToInt = (x) => {
  const r = Math.round(x);
  return (Math.abs(x - Math.trunc(x)) === 0.5 && r % 2) ? r - 1 : r;
};

export const UIImage = {
  // Image.OnPopulateMesh for Simple (m_UseSpriteMesh 0) and Sliced; no sprite -> Graphic.OnPopulateMesh
  build(node, img, sprite, canvasRefPPU) {
    const c = uiColor32(img.m_Color);
    if (!sprite) {                                   // Graphic.OnPopulateMesh: rect quad, uv 0..1
      const m = new UIMesh(), r = node.rect;
      m.addQuad(r.x, r.y, r.x + r.w, r.y + r.h, c, 0, 0, 1, 1);
      return m;
    }
    if (img.m_Type === 0) {
      if (img.m_UseSpriteMesh) throw new UIError(`${node.path}: sprite mesh images not implemented`);
      return UIImage.simple(node, sprite, c, !!img.m_PreserveAspect);
    }
    if (img.m_Type === 1) return UIImage.sliced(node, img, sprite, c, canvasRefPPU);
    throw new UIError(`${node.path}: image type ${img.m_Type} not implemented`);
  },

  // GetDrawingDimensions + PreserveSpriteAspectRatio
  drawingDimensions(node, sprite, preserveAspect) {
    const pad = sprite.padding, size = { x: sprite.rect.width, y: sprite.rect.height };
    let { x, y, w, h } = node.rect;
    const sw = uiRoundToInt(size.x), sh = uiRoundToInt(size.y);
    const v = [pad[0] / sw, pad[1] / sh, (sw - pad[2]) / sw, (sh - pad[3]) / sh];
    if (preserveAspect && size.x * size.x + size.y * size.y > 0) {
      const a = size.x / size.y;
      if (a <= w / h) { const w2 = a * h; x += (w - w2) * node.pivot.x; w = w2; }
      else { const h2 = w / a; y += (h - h2) * node.pivot.y; h = h2; }
    }
    return [x + w * v[0], y + h * v[1], x + w * v[2], y + h * v[3]];
  },

  // GenerateSimpleSprite
  simple(node, sprite, c, preserveAspect) {
    const m = new UIMesh(), v = UIImage.drawingDimensions(node, sprite, preserveAspect), o = sprite.outer;
    m.addVert(v[0], v[1], c, o[0], o[1]); m.addVert(v[0], v[3], c, o[0], o[3]);
    m.addVert(v[2], v[3], c, o[2], o[3]); m.addVert(v[2], v[1], c, o[2], o[1]);
    m.addTriangle(0, 1, 2); m.addTriangle(2, 3, 0);
    return m;
  },

  // GenerateSlicedSprite with GetAdjustedBorders; ppu = multipliedPixelsPerUnit
  // (sprite ppu / canvas referencePixelsPerUnit * m_PixelsPerUnitMultiplier)
  sliced(node, img, sprite, c, canvasRefPPU) {
    if (!sprite.hasBorder) return UIImage.simple(node, sprite, c, false);
    if (!sprite.inner) throw new UIError(`${node.path}: sliced trimmed sprite ${sprite.name} not implemented`);
    const r = node.rect, ppu = sprite.pixelsPerUnit / canvasRefPPU * img.m_PixelsPerUnitMultiplier;
    const b = sprite.border, border = [b.x / ppu, b.y / ppu, b.z / ppu, b.w / ppu];
    // GetAdjustedBorders: the pixel-adjusted rect is the rect itself (canvas not pixel perfect,
    // GetPixelAdjustedRect), so only the fit clause can change the borders
    for (let axis = 0; axis <= 1; axis++) {
      const size = axis === 0 ? r.w : r.h, sum = border[axis] + border[axis + 2];
      if (size < sum && sum !== 0) { const k = size / sum; border[axis] *= k; border[axis + 2] *= k; }
    }
    const pad = sprite.padding.map((p) => p / ppu);
    const xs = [pad[0], border[0], r.w - border[2], r.w - pad[2]].map((x) => x + r.x);
    const ys = [pad[1], border[1], r.h - border[3], r.h - pad[3]].map((y) => y + r.y);
    const us = [sprite.outer[0], sprite.inner[0], sprite.inner[2], sprite.outer[2]];
    const vs = [sprite.outer[1], sprite.inner[1], sprite.inner[3], sprite.outer[3]];
    const m = new UIMesh();
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++) {
        if (!img.m_FillCenter && x === 1 && y === 1) continue;
        if (xs[x + 1] - xs[x] <= 0 || ys[y + 1] - ys[y] <= 0) continue;   // uGUI 2.0 skips empty cells
        m.addQuad(xs[x], ys[y], xs[x + 1], ys[y + 1], c, us[x], vs[y], us[x + 1], vs[y + 1]);
      }
    return m;
  },
};

// ------------------------------------------------------------------- CanvasScaler
// ScaleWithScreenSize / Expand (m_UiScaleMode 1, m_ScreenMatchMode 1): scaleFactor = min(w / refW, h / refH);
// canvas = pixel size / scale
export const uiCanvasSize = (scaler, width, height) => {
  const ref = scaler.m_ReferenceResolution, s = Math.min(width / ref.x, height / ref.y);
  return { W: width / s, H: height / s, scale: s };
};

// ------------------------------------------------------------------- layout (RectTransforms + LayoutRebuilder)
export const UILayout = {
  // A root canvas rect is its size in canvas units; node matrices map to canvas space with the origin at the
  // bottom-left corner (the canvas' own pivot is irrelevant to its children's layout). `rebuild(n)` runs for every
  // active node with a layout group, parents first.
  layoutRoot(root, W, H, rebuild) {
    root.rect = { x: F(-W / 2), y: F(-H / 2), w: F(W), h: F(H) };
    root.matrix = UIAffine.translate(W / 2, H / 2);
    for (const c of root.children) c.layoutIn(root.rect, root.matrix);
    const walk = (n) => {
      if (!n.activeSelf) return;
      if (n.layoutGroup) rebuild(n);
      for (const c of n.children) walk(c);
    };
    walk(root);
  },

  // ILayoutElement values of one node, only enabled components (LayoutUtility.GetLayoutProperty).
  // `extra(n)` = the elements of other components, listed first.
  elements(n, refPPU, extra = null) {
    const out = extra ? extra(n) : [];
    if (n.image && n.image.m_Enabled) {
      // Image.preferredWidth: Sliced / Tiled -> DataUtility.GetMinSize(sprite).x / ppu, else rect.w / ppu;
      // minWidth 0, flexibleWidth -1, priority 0.
      // ENGINE: DataUtility.GetMinSize is native; taken as border.x + border.z (Unity's definition for bordered sprites).
      const sp = n.image.spriteObj;
      const ppu = sp ? sp.pixelsPerUnit / refPPU * n.image.m_PixelsPerUnitMultiplier : 1;
      const sliced = n.image.m_Type === 1 || n.image.m_Type === 2;
      const pw = !sp ? 0 : (sliced ? (sp.border.x + sp.border.z) / ppu : sp.rect.width / ppu);
      out.push({ priority: 0, minWidth: 0, preferredWidth: pw, flexibleWidth: -1 });
    }
    if (n.layoutElement) {
      const e = n.layoutElement;
      if (e.m_IgnoreLayout) throw new UIError(`${n.path}: ignoreLayout not implemented`);
      out.push({ priority: e.m_LayoutPriority, minWidth: e.m_MinWidth, preferredWidth: e.m_PreferredWidth,
                 flexibleWidth: e.m_FlexibleWidth });
    }
    if (n.layoutGroup && n._lgTotals) {
      const t = n._lgTotals;
      out.push({ priority: 0, minWidth: t.min, preferredWidth: t.preferred, flexibleWidth: t.flexible });
    }
    return out;
  },

  // GetLayoutProperty: highest priority wins, negative values are ignored, ties take the max, default otherwise
  property(elems, key, def) {
    let v = def, maxPriority = -Infinity;
    for (const e of elems) {
      if (e.priority < maxPriority) continue;
      const p = e[key];
      if (p < 0) continue;
      if (e.priority > maxPriority) { v = p; maxPriority = e.priority; }
      else if (p > v) v = p;
    }
    return v;
  },

  minWidth(e) { return UILayout.property(e, "minWidth", 0); },
  preferredWidth(e) {                               // LayoutUtility.GetPreferredWidth
    return Math.max(UILayout.property(e, "minWidth", 0), UILayout.property(e, "preferredWidth", 0));
  },
  flexibleWidth(e) { return UILayout.property(e, "flexibleWidth", 0); },

  // HorizontalLayoutGroup (CalcAlongAxis, SetChildrenAlongAxis, GetStartOffset,
  // SetChildAlongAxisWithScale: anchors forced to (0,1), x = pos + size * pivot.x,
  // y = -pos - size * (1 - pivot.y)) with a ContentSizeFitter on the same object (HandleSelfFittingAlongAxis
  // -> SetSizeWithCurrentAnchors, no rounding). LayoutRebuilder order: horizontal input (children first),
  // horizontal control (self fitter, then the group), then the vertical pass. elems(n) = the node's layout elements.
  rebuildHorizontal(n, elems) {
    const L = UILayout;
    const lg = n.layoutGroup;
    if (lg.class !== "HorizontalLayoutGroup") throw new UIError(`${n.path}: ${lg.class} not implemented`);
    if (lg.m_ChildScaleWidth || lg.m_ChildScaleHeight || lg.m_ReverseArrangement || lg.m_ChildForceExpandWidth ||
        lg.m_ChildForceExpandHeight || lg.m_ChildControlHeight || !lg.m_ChildControlWidth)
      throw new UIError(`${n.path}: layout group options outside the implemented subset`);
    const pad = lg.m_Padding, spacing = lg.m_Spacing;
    const children = n.children.filter((c) => c.activeInHierarchy && !(c.layoutElement && c.layoutElement.m_IgnoreLayout));
    const align = [(lg.m_ChildAlignment % 3) * 0.5, Math.floor(lg.m_ChildAlignment / 3) * 0.5];
    // CalculateLayoutInputHorizontal -> CalcAlongAxis(0)
    let totalMin = pad.m_Left + pad.m_Right, totalPref = totalMin, totalFlex = 0;
    const sizes = children.map((c) => {
      const e = elems(c);
      const s = { min: L.minWidth(e), pref: L.preferredWidth(e), flex: L.flexibleWidth(e) };
      totalMin += s.min + spacing; totalPref += s.pref + spacing; totalFlex += s.flex;
      return s;
    });
    if (children.length) { totalMin -= spacing; totalPref -= spacing; }
    totalPref = Math.max(totalMin, totalPref);
    n._lgTotals = { min: totalMin, preferred: totalPref, flexible: totalFlex };
    // ContentSizeFitter.SetLayoutHorizontal
    const csf = n.contentSizeFitter;
    if (csf) {
      if (csf.m_VerticalFit !== 0) throw new UIError(`${n.path}: vertical fit not implemented`);
      if (csf.m_HorizontalFit === 2) n.setSizeWithCurrentAnchors(0, L.preferredWidth(elems(n)));
      else if (csf.m_HorizontalFit === 1) n.setSizeWithCurrentAnchors(0, L.minWidth(elems(n)));
    }
    n.layoutIn(n.parent.rect, n.parent.matrix);
    // SetLayoutHorizontal -> SetChildrenAlongAxis(0): along the axis, sizes controlled
    const size = n.rect.w;
    let pos = pad.m_Left, flexMul = 0;
    const surplus = size - totalPref;
    if (surplus > 0) {
      if (totalFlex === 0) pos = pad.m_Left + surplus * align[0];
      else flexMul = surplus / totalFlex;
    }
    const lerp = totalMin !== totalPref ? Math.min(Math.max((size - totalMin) / (totalPref - totalMin), 0), 1) : 0;
    children.forEach((c, i) => {
      const s = sizes[i];
      const childSize = s.min + (s.pref - s.min) * lerp + s.flex * flexMul;
      c.anchorMin = { x: 0, y: 1 }; c.anchorMax = { x: 0, y: 1 };
      c.sizeDelta.x = F(childSize);
      c.anchoredPosition.x = F(pos + childSize * c.pivot.x);
      pos += childSize + spacing;
    });
    // SetLayoutVertical -> SetChildrenAlongAxis(1): the other axis, heights not controlled (min = pref = sizeDelta.y)
    const inner = n.rect.h - (pad.m_Top + pad.m_Bottom);
    for (const c of children) {
      const h = c.sizeDelta.y;
      const req = Math.min(Math.max(inner, h), h);                   // Mathf.Clamp(inner, min, preferred)
      const start = pad.m_Top + (n.rect.h - (req + pad.m_Top + pad.m_Bottom)) * align[1];
      c.anchoredPosition.y = F(-(start + (req - h) * align[1]) - h * (1 - c.pivot.y));
    }
    n.layoutIn(n.parent.rect, n.parent.matrix);
  },
};

// ------------------------------------------------------------------- canvas geometry and drawing
export const UI_STRIDE = 16;                        // floats per vertex: position 3, colour 4, uv0 4, uv1 2, normal 3
export const UI_ATTRIBS = { in_POSITION0: [3, 0], in_COLOR0: [4, 3], in_TEXCOORD0: [4, 7], in_TEXCOORD1: [2, 11], in_NORMAL0: [3, 13] };

export const UIDraw = {
  // Paint order = hierarchy order (depth first, parent before children). Inherited alpha = product of the
  // CanvasGroup alphas up to a group with ignoreParentGroups. itemsOf(n, alpha) -> the node's draw items.
  // ENGINE: CanvasRenderer applies the inherited CanvasGroup alpha natively; here a float multiply of Color32 alpha / 255.
  // No byte re-quantisation (UI/Default re-rounds alpha to 1/255 itself).
  list(root, itemsOf) {
    const out = [];
    const walk = (n, alpha) => {
      if (!n.activeSelf) return;
      if (n.canvasGroup) alpha = n.canvasGroup.ignoreParentGroups ? n.canvasGroup.alpha : F(alpha * n.canvasGroup.alpha);
      out.push(...itemsOf(n, alpha));
      for (const c of n.children) walk(c, alpha);
    };
    walk(root, 1);
    return out.filter((it) => it.idx.length);
  },

  pack(verts, n, alpha, uvw = null) {                // local-space verts -> interleaved canvas-space floats
    const m = n.matrix, out = new Float32Array(verts.length * UI_STRIDE);
    verts.forEach((v, i) => {
      const [x, y] = UIAffine.apply(m, v.x, v.y), o = i * UI_STRIDE;
      out[o] = x; out[o + 1] = y; out[o + 2] = 0;
      out[o + 3] = v.c[0] / 255; out[o + 4] = v.c[1] / 255; out[o + 5] = v.c[2] / 255; out[o + 6] = v.c[3] / 255 * alpha;
      out[o + 7] = v.u; out[o + 8] = v.v; out[o + 9] = 0; out[o + 10] = uvw ? v.w : 0;
      out[o + 11] = v.u1 || 0; out[o + 12] = v.v1 || 0;
      out[o + 13] = 0; out[o + 14] = 0; out[o + 15] = -1;          // TMP_MeshInfo default normal (0,0,-1)
    });
    return out;
  },

  // Orthographic P over [0, W] x [0, H] canvas units, V = identity, unity_ObjectToWorld = identity (vertices are in
  // canvas space). unity_GUIZTestMode: LEqual (4) for camera canvases, Always (8) for overlay canvases.
  // ENGINE: unity_GUIZTestMode is set by Unity's native canvas render path (values as above).
  // Neither target has a depth buffer, so the depth test passes either way.
  globals(W, H, pxW, pxH, zTest) {
    const P = [2 / W, 0, 0, 0, 0, 2 / H, 0, 0, 0, 0, -0.002, 0, -1, -1, 0, 1];
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return { unity_MatrixVP: P, glstate_matrix_projection: P, unity_ObjectToWorld: I, unity_WorldToObject: I,
             _WorldSpaceCameraPos: [W / 2, H / 2, -10], _ScreenParams: [pxW, pxH, 1 + 1 / pxW, 1 + 1 / pxH],
             _UIMaskSoftnessX: 0, _UIMaskSoftnessY: 0, unity_GUIZTestMode: zTest };
  },

  // one indexed triangle list: mat = {shader, keywords, floats, colors, defaults}, sheet = per-draw properties,
  // buf = {vao, vbo, ibo}
  draw(gl, lib, buf, mat, sheet, globals, verts, idx) {
    const prog = lib.program(mat.shader, 0, mat.keywords);
    prog.apply([sheet, mat.floats, mat.colors, mat.defaults, globals]);
    applyState(gl, lib.state(mat.shader, 0, { ...mat.floats, unity_GUIZTestMode: globals.unity_GUIZTestMode }));
    gl.bindVertexArray(buf.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    const used = new Set();
    for (const [name, loc] of Object.entries(prog.attribs)) {
      const a = UI_ATTRIBS[name];
      if (!a) throw new UIError(`${prog.label}: vertex input ${name} not provided`);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, a[0], gl.FLOAT, false, UI_STRIDE * 4, a[1] * 4);
      used.add(loc);
    }
    for (let loc = 0; loc < 16; loc++) if (!used.has(loc)) gl.disableVertexAttribArray(loc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  },
};

// ------------------------------------------------------------------- DOTween tweens and sequences of the story UI
// One class for CanvasGroup.DOFade (a value tween, default ease) and a DOTweenSequence of callbacks only. Stepped by
// the UI's own runner in the loop's "tweens" phase (DOTweenComponent.Update): UniTask's Update runner is injected first
// in Unity's Update phase (PlayerLoopHelper.Initialize -> InsertRunner with injectOnFirst), so a tween started by a
// command continuation gets its first DOTween update later in the same frame.
// The position accumulates the scaled delta in float32 (DOTween keeps float positions) and completes when position >=
// duration. Callbacks at position 0 fire on the first update after Play (Sequence.ApplyInternalCycle); the start value
// of a value tween is read on that first update (startup).
// runner: {active: Set} (stepped by its owner: for (const t of [...runner.active]) t.step(dt)).
export class UITween {
  constructor(runner, { duration, timeScale = 1, getFrom = null, to = 0, ease: easeId = 6, apply = null, at0 = [],
                        onComplete = null }) {
    this.runner = runner;
    this.duration = F(duration); this.timeScale = timeScale;
    this.getFrom = getFrom; this.from = 0; this.change = 0; this.to = to; this.ease = easeId; this.apply = apply; this.at0 = at0;
    this.onComplete = onComplete;
    this.position = 0; this.started = false; this.done = false;
    this.promise = new Promise((res) => { this._resolve = res; });
    runner.active.add(this);
  }

  get isActive() { return !this.done; }

  step(dt) {
    if (this.done) return;
    const first = !this.started;
    this.started = true;
    if (first && this.getFrom) this.from = this.getFrom();
    if (first) { this.from = F(this.from); this.change = F(F(this.to) - this.from); }     // SetChangeValue
    this.position = F(this.position + F(F(dt) * this.timeScale));
    const complete = this.position >= this.duration;
    if (complete) this.position = this.duration;
    if (first) for (const cb of this.at0) cb();
    if (this.apply) {                                        // FloatPlugin: start + change x ease, INTERNAL_Zero for 0
      const k = this.duration > 0 ? easeF(this.ease, this.position, this.duration) : 1;
      this.apply(F(this.from + F(this.change * k)));
    }
    if (complete) { if (this.onComplete) this.onComplete(); this.finish(true); }
  }

  finish(completed) {
    if (this.done) return;
    this.done = true;
    this.runner.active.delete(this);
    this._resolve(completed);
  }

  kill() { this.finish(false); }
}

// =================================================================== live UI canvas
// Scale clip targets, uncontrolled layout groups and the DOTween Sequence / Tweener model used by the judgement text
// and the combo counter.

// Transform.m_LocalScale on a RectTransform (Mecanim clips of the live combo counter). z is kept on the node for the
// Animator's write-defaults bookkeeping only: canvas vertices have z = 0, so a z scale changes nothing drawn.
Object.assign(UI_CLIP_TARGET, {
  "Transform.m_LocalScale.x": (n, v) => { n.localScale.x = v; },
  "Transform.m_LocalScale.y": (n, v) => { n.localScale.y = v; },
  "Transform.m_LocalScale.z": (n, v) => { n.localScaleZ = v; },
});

// HorizontalOrVerticalLayoutGroup whose child sizes are not controlled (m_ChildControlWidth = m_ChildControlHeight
// = 0), both axes, as the game's uGUI 2.0 build does it: CalcAlongAxis, SetChildrenAlongAxis
// (other axis: required = Clamp(inner, min, flexible > 0 ? size : preferred), start = GetStartOffset(axis, required),
// pos = start + alignment * (required - sizeDelta); layout axis: pos from GetStartOffset(axis, totalPreferred -
// padding) when there is surplus and no flexible size, childSize = Lerp(min, preferred, t) + flexible * multiplier,
// pos + alignment * (childSize - sizeDelta), then pos += (childSize + spacing)), GetStartOffset, GetChildSizes
// (not controlled: min = preferred = sizeDelta[axis], flexible = forceExpand ? 1 : 0),
// SetChildAlongAxisWithScale (anchors forced to (0,1), x = pos + sizeDelta.x * pivot.x,
// y = -pos - sizeDelta.y * (1 - pivot.y)). Alignment on an axis = (m_ChildAlignment % 3 | / 3) / 2.
// Children = active in hierarchy and not ignoring layout (LayoutGroup.rectChildren). Child scale, reverse
// arrangement and a ContentSizeFitter on the group are outside this subset and raise.
UILayout.rebuildUncontrolled = (n) => {
  const lg = n.layoutGroup;
  const vertical = lg.class === "VerticalLayoutGroup";
  if (!vertical && lg.class !== "HorizontalLayoutGroup") throw new UIError(`${n.path}: ${lg.class} not implemented`);
  if (lg.m_ChildControlWidth || lg.m_ChildControlHeight || lg.m_ChildScaleWidth || lg.m_ChildScaleHeight || lg.m_ReverseArrangement)
    throw new UIError(`${n.path}: layout group options outside the uncontrolled subset`);
  if (n.contentSizeFitter) throw new UIError(`${n.path}: ContentSizeFitter with an uncontrolled layout group not implemented`);
  const pad = lg.m_Padding, spacing = lg.m_Spacing;
  const children = n.children.filter((c) => c.activeInHierarchy && !(c.layoutElement && c.layoutElement.m_IgnoreLayout));
  const align = [F((lg.m_ChildAlignment % 3) / 2), F(Math.floor(lg.m_ChildAlignment / 3) / 2)];
  const padSum = [pad.m_Left + pad.m_Right, pad.m_Top + pad.m_Bottom], padStart = [pad.m_Left, pad.m_Top];
  const expand = [!!lg.m_ChildForceExpandWidth, !!lg.m_ChildForceExpandHeight];
  const sd = (c, axis) => (axis === 0 ? c.sizeDelta.x : c.sizeDelta.y);
  const sizes = (c, axis) => ({ min: sd(c, axis), pref: sd(c, axis), flex: expand[axis] ? 1 : 0 });
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);       // Mathf.Clamp
  n.layoutIn(n.parent.rect, n.parent.matrix);
  const size = [n.rect.w, n.rect.h];
  const totals = [0, 1].map((axis) => {                               // CalcAlongAxis(axis, isVertical)
    const other = vertical !== (axis === 1);
    let min = padSum[axis], pref = padSum[axis], flex = 0;
    for (const c of children) {
      const s = sizes(c, axis);
      if (other) { min = Math.max(F(s.min + padSum[axis]), min); pref = Math.max(F(s.pref + padSum[axis]), pref); flex = Math.max(s.flex, flex); }
      else { min = F(min + F(s.min + spacing)); pref = F(pref + F(s.pref + spacing)); flex = F(flex + s.flex); }
    }
    if (!other && children.length) { min = F(min - spacing); pref = F(pref - spacing); }
    return { min, pref: Math.max(min, pref), flex };
  });
  n._lgTotals = { min: totals[0].min, preferred: totals[0].pref, flexible: totals[0].flex };
  const startOffset = (axis, req) => F(padStart[axis] + F(F(size[axis] - F(req + padSum[axis])) * align[axis]));
  const place = (c, axis, pos) => {                                   // SetChildAlongAxisWithScale (no size, scale 1)
    c.anchorMin = { x: 0, y: 1 }; c.anchorMax = { x: 0, y: 1 };
    if (axis === 0) c.anchoredPosition.x = F(pos + F(c.sizeDelta.x * c.pivot.x));
    else c.anchoredPosition.y = F(-pos - F(c.sizeDelta.y * F(1 - c.pivot.y)));
  };
  for (const axis of [0, 1]) {                                        // SetLayoutHorizontal, then SetLayoutVertical
    const other = vertical !== (axis === 1), t = totals[axis];
    if (other) {
      const inner = F(size[axis] - padSum[axis]);
      for (const c of children) {
        const s = sizes(c, axis);
        const req = clamp(inner, s.min, s.flex > 0 ? size[axis] : s.pref);
        place(c, axis, F(startOffset(axis, req) + F(align[axis] * F(req - sd(c, axis)))));
      }
    } else {
      let pos = padStart[axis], flexMul = 0;
      const surplus = F(size[axis] - t.pref);
      if (surplus > 0) {
        if (t.flex === 0) pos = startOffset(axis, F(t.pref - padSum[axis]));
        else if (t.flex > 0) flexMul = F(surplus / t.flex);
      }
      let lerp = 0;
      if (t.min !== t.pref) lerp = clamp(F(F(size[axis] - t.min) / F(t.pref - t.min)), 0, 1);
      for (const c of children) {
        const s = sizes(c, axis);
        const childSize = F(F(s.min + F(F(s.pref - s.min) * lerp)) + F(s.flex * flexMul));
        place(c, axis, F(pos + F(align[axis] * F(childSize - sd(c, axis)))));
        pos = F(pos + F(childSize + spacing));                   // pos += scale * childSize + spacing (scale 1)
      }
    }
  }
  n.layoutIn(n.parent.rect, n.parent.matrix);
};

// ------------------------------------------------------------------- DOTween Sequence / Tweener model
// The subset the live judgement text uses (UILiveNoteJudgeEffectView.CreateTween): a Sequence of
// zero-duration CanvasGroup.DOFade tweeners, a DOPunchScale and an interval; Pause / Restart / Complete and the
// per-frame TweenManager update. As compiled in the game: DOTween.Punch (segment count, durations,
// waypoints), SpecialPluginsUtils.SetPunch (at startup: endValues += current value, isRelative and
// isSpeedBased off, customEase null, easeType := 6 OutQuad, i.e. an earlier SetEase is overridden),
// Vector3ArrayPlugin.EvaluateAndApply (segment = first with elapsed <= running sum, value = start[i] +
// ease(segmentElapsed, segmentDuration) * change[i]) and Sequence.ApplyInternalCycle (forward window
// pos <= to && (pos <= 0 || from < end) && (pos > 0 || from <= end), goto = max(0, to - pos) forced to the full
// duration once end <= to; backward window to <= end && pos <= from, started tweens only).
// The rest follows DOTween's public source: TweenManager.Update (position += dt in float,
// wrap at the duration, complete at loops), TweenManager.Goto / Rewind / Restart / Complete, Tween.DoGoto (loop and
// position clamps, isComplete, OnComplete), Tweener.DoStartup (start value read at the first goto, ease :=
// INTERNAL_Zero (value = end) for duration <= 0), Sequence.DoStartup / DoApplyTween, EaseManager formulas.
export const DOT = { UPDATE: 0, GOTO: 1, EASE_ZERO: -1 };

// DG.Tweening.Core.Easing.EaseManager.Evaluate (float32; tween.js easeF), INTERNAL_Zero (DOT.EASE_ZERO) = 1
export const dotEase = (id, time, duration, overshoot = 1.70158) =>
  (id === DOT.EASE_ZERO ? 1 : easeF(id, time, duration, overshoot));

export class DOTTween {                     // fields shared by Tweener and Sequence (DG.Tweening.Tween)
  constructor(duration) {
    this.duration = F(duration); this.loops = 1; this.fullDuration = this.duration;
    this.position = 0; this.completedLoops = 0; this.isComplete = false; this.isBackwards = false;
    this.isPlaying = true;                // DOTween.defaultAutoPlay All
    this.startupDone = false; this.autoKill = true; this.onComplete = null;
    this.sequencedPosition = 0; this.sequencedEndPosition = 0;
  }

  // Tween.DoGoto (loops != -1, LoopType.Restart, no delay)
  doGoto(toPosition, toCompletedLoops, mode) {
    if (!this.startupDone) this.startup();
    const prevPosition = this.position, prevCompletedLoops = this.completedLoops;
    this.completedLoops = toCompletedLoops;
    const wasComplete = this.isComplete;
    this.isComplete = this.completedLoops === this.loops;
    let steps = 0;
    if (mode === DOT.UPDATE) {
      if (this.isBackwards) throw new UIError("DOTween backwards update not implemented");
      steps = this.completedLoops > prevCompletedLoops ? this.completedLoops - prevCompletedLoops : 0;
    } else if (this.isSequence) steps = Math.abs(prevCompletedLoops - toCompletedLoops);
    this.position = toPosition;
    if (this.position > this.duration) this.position = this.duration;
    else if (this.position <= 0) this.position = this.completedLoops > 0 || this.isComplete ? this.duration : 0;
    if (this.isPlaying) this.isPlaying = this.isBackwards ? !(this.completedLoops === 0 && this.position <= 0) : !this.isComplete;
    this.applyTween(prevPosition, steps, mode);
    if (this.isComplete && !wasComplete && this.onComplete) this.onComplete();
  }

  // TweenManager.Goto(t, to, andPlay = false) for a sequenced tween
  gotoNested(to, mode) {
    this.isPlaying = false;
    let loops = this.duration <= 0 ? 1 : Math.floor(F(to / this.duration));
    let pos = this.duration <= 0 ? 0 : F(to % this.duration);
    if (loops >= this.loops) { loops = this.loops; pos = this.duration; } else if (pos >= this.duration) pos = 0;
    this.doGoto(pos, loops, mode);
  }
};

// Tweener: plugin = { startup(t), apply(t, elapsed) }; ease = the id set by SetEase (default OutQuad)
export class DOTTweener extends DOTTween {
  constructor({ duration, plugin, ease = 6 }) {
    super(duration);
    this.plugin = plugin; this.ease = ease; this.overshoot = 1.70158;
  }

  startup() {                             // Tweener.DoStartup
    this.startupDone = true;
    this.plugin.startup(this);
    if (this.duration <= 0) this.ease = DOT.EASE_ZERO;
  }

  applyTween() { this.plugin.apply(this, this.position); }
};

// DOTween.To(getter, setter, end, duration) on a float (CanvasGroup.DOFade): value = start + change * ease
export const dotFloat = (get, set, end, duration) => new DOTTweener({ duration, plugin: {
  startup(t) { t.start = get(); t.change = F(end - t.start); },
  apply(t, elapsed) { set(F(t.start + F(t.change * dotEase(t.ease, elapsed, t.duration, t.overshoot)))); },
} });

// DOTween.Punch -> DOTween.ToArray (duration = float sum of the segment durations), special startup
// SetPunch; get/set on {x, y, z}
export const dotPunch = (get, set, dir, duration, vibrato = 10, elasticity = 1) => {
  const el = elasticity > 1 ? 1 : elasticity < 0 ? 0 : elasticity;
  const prod = F(vibrato * duration);
  let n = Math.trunc(prod);
  if (n < 2 || prod === Infinity) n = 2;
  const sq = F(F(F(dir.z * dir.z) + F(dir.x * dir.x)) + F(dir.y * dir.y));
  let strength = F(Math.sqrt(sq));
  const mag0 = strength, decay = F(strength / n), nx = F(dir.x / mag0), ny = F(dir.y / mag0), nz = F(dir.z / mag0);
  const durations = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const d = F(F((i + 1) / n) * duration); sum = F(sum + d); durations.push(d); }
  for (let i = 0; i < n; i++) durations[i] = F(F(duration / sum) * durations[i]);
  const clampMag = (len) => (F(len * len) < sq ? { x: F(nx * len), y: F(ny * len), z: F(nz * len) } : { ...dir });
  const ends = [];
  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      if (i === 0) ends.push({ ...dir });
      else if (i % 2) { const v = clampMag(F(strength * el)); ends.push({ x: -v.x, y: -v.y, z: -v.z }); }
      else ends.push(clampMag(strength));
      strength = F(strength - decay);
    } else ends.push({ x: 0, y: 0, z: 0 });
  }
  let total = 0;
  for (const d of durations) total = F(total + d);
  const t = new DOTTweener({ duration: total, plugin: {
    startup(tw) {
      const v = get();                    // SetPunch: forced settings, endValues += current value
      tw.ease = 6; tw.isRelative = false;
      tw.ends = ends.map((e) => ({ x: F(e.x + v.x), y: F(e.y + v.y), z: F(e.z + v.z) }));
      const v0 = get();                   // Vector3ArrayPlugin.ConvertToStartValue / SetChangeValue
      tw.starts = tw.ends.map((e, i) => (i === 0 ? { ...v0 } : { ...tw.ends[i - 1] }));
      tw.changes = tw.ends.map((e, i) => ({ x: F(e.x - tw.starts[i].x), y: F(e.y - tw.starts[i].y), z: F(e.z - tw.starts[i].z) }));
    },
    apply(tw, elapsed) {                  // Vector3ArrayPlugin.EvaluateAndApply (no axis constraint, no snapping)
      let count = 0, segElapsed = 0, idx = -1, segDur = 0;
      for (let i = 0; i < durations.length; i++) {
        segDur = durations[i]; count = F(count + segDur);
        if (elapsed <= count) { segElapsed = F(elapsed - segElapsed); idx = i; break; }
        segElapsed = F(segElapsed + segDur);
      }
      // elapsed <= the float sum of the durations always (position is clamped to that sum), so a segment is found
      if (idx < 0) throw new UIError(`punch: elapsed ${elapsed} past the last segment`);
      const e = dotEase(tw.ease, segElapsed, segDur, tw.overshoot), s = tw.starts[idx], c = tw.changes[idx];
      set({ x: F(s.x + F(e * c.x)), y: F(s.y + F(e * c.y)), z: F(s.z + F(e * c.z)) });
    },
  } });
  t.punchDurations = durations;
  return t;
};

export class DOTSequence extends DOTTween {
  constructor(runner) {
    super(0);
    this.isSequence = true; this.items = []; this.lastInsert = 0;
    if (runner) runner.add(this);
  }

  // Sequence.DoInsert (no delay, loops 1): sequenced window, the sequence grows to the end of its last item
  insert(t, at) {
    t.isPlaying = false; t.autoKill = false;
    t.sequencedPosition = F(at); t.sequencedEndPosition = F(at + F(t.duration * t.loops));
    this.lastInsert = t.sequencedPosition;
    if (t.sequencedEndPosition > this.duration) this.duration = t.sequencedEndPosition;
    this.items.push(t);
    return this;
  }
  append(t) { return this.insert(t, this.duration); }
  join(t) { return this.insert(t, this.lastInsert); }
  appendInterval(d) { this.lastInsert = this.duration; this.duration = F(this.duration + d); return this; }

  startup() {                             // Sequence.DoStartup: stable sort by start position
    this.startupDone = true;
    this.fullDuration = F(this.duration * this.loops);
    this.items = this.items.map((t, i) => [t, i]).sort((a, b) => a[0].sequencedPosition - b[0].sequencedPosition || a[1] - b[1]).map((x) => x[0]);
  }

  // Sequence.DoApplyTween (linear sequence ease, LoopType.Restart)
  applyTween(prevPosition, steps, mode) {
    let from = prevPosition;
    if (steps > 0) {
      if (mode === DOT.UPDATE) {
        const expectedLoops = this.completedLoops, expectedPos = this.position;
        for (let i = 0; i < steps; i++) { if (i > 0) from = this.duration; this.cycle(from, this.duration, mode); }
        if (expectedLoops !== this.completedLoops || expectedPos !== this.position) return;
      } else steps = 0;
    }
    if (steps === 1 && this.isComplete) return;
    if (steps > 0 && !this.isComplete) throw new UIError("DOTween sequence loops not implemented");
    this.cycle(from, this.position, mode);
  }

  // Sequence.ApplyInternalCycle (tweens only; no callbacks inserted)
  cycle(fromPos, toPos, mode) {
    if (fromPos <= toPos) {
      for (const t of this.items) {
        const pos = t.sequencedPosition, end = t.sequencedEndPosition;
        if (!(pos <= toPos && (pos <= 0 || fromPos < end) && (pos > 0 || fromPos <= end))) continue;
        let to = toPos - pos >= 0 ? F(toPos - pos) : 0;
        if (end <= toPos) {
          if (!t.startupDone) t.startup();            // TweenManager.ForceInit
          if (to < t.fullDuration) to = t.fullDuration;
        }
        t.isBackwards = false;
        t.gotoNested(to, mode);
      }
    } else {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const t = this.items[i], pos = t.sequencedPosition, end = t.sequencedEndPosition;
        if (!(toPos <= end && pos <= fromPos)) continue;
        const to = toPos - pos >= 0 ? F(toPos - pos) : 0;
        if (!t.startupDone) continue;
        t.isBackwards = true;
        t.gotoNested(to, mode);
      }
    }
  }

  pause() { this.isPlaying = false; return this; }

  // TweenManager.Restart(t, includeDelay = true, changeDelayTo = -1) -> Rewind -> DoGoto(0, 0, Goto)
  restart() {
    this.isBackwards = false;
    this.isPlaying = false;
    if (this.position > 0 || this.completedLoops > 0 || !this.startupDone) this.doGoto(0, 0, DOT.GOTO);
    this.isPlaying = true;
  }

  // TweenManager.Complete(t) (Goto mode)
  complete() {
    if (this.isComplete) return;
    this.doGoto(this.duration, this.loops, DOT.GOTO);
    this.isPlaying = false;
  }

  // one TweenManager.Update step of this tween (scaled delta time, timeScale 1)
  update(dt) {
    if (!this.isPlaying) return;
    if (!this.startupDone) this.startup();
    let to = this.position, loops = this.completedLoops;
    const wasEnd = to >= this.duration;
    if (this.duration <= 0) { to = 0; loops = this.loops; }
    else {
      to = F(to + F(dt));
      while (to >= this.duration && loops < this.loops) { to = F(to - this.duration); loops++; }
      if (wasEnd) loops--;
      if (loops >= this.loops) to = this.duration;
    }
    this.doGoto(to, loops, DOT.UPDATE);
  }
};

// The active-tween list stepped by DOTweenComponent.Update (sequences only; sequenced tweeners are driven by them)
export class DOTRunner {
  constructor() { this.tweens = []; }
  add(t) { this.tweens.push(t); }
  update(dt) { for (const t of this.tweens) t.update(dt); }
};
