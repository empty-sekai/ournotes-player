import { Animator } from "../../engine/anim.js";
import { F, join } from "../../engine/core.js";
import { UIAffine, UIDraw, UIError, UIImage, UILayout, UIMesh, UINode, UISprite, UI_CLIP_TARGET, UI_STRIDE, uiColor32 } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { AnimRecords } from "./clips.js";

// uGUI prefab instances on the story's screen canvases (VideoCanvas, StillCanvas, FrameCanvas of UIAdvWidget): the
// prefab node lists of frames.json / stills.json as RectTransform trees with their graphics, CanvasGroups, layout
// components and Animators. Generic uGUI (layout, Image meshes, canvas drawing) is engine/ugui.js; this module adds
// the pieces those prefabs use beyond it: RectTransforms with a full local rotation, Image Tiled meshes, custom Image
// materials, AspectRatioFitter, Mecanim Animators on UI nodes (engine/anim.js) and the canvas scaler of the widget's
// screen canvases (Fwk.UI.ClampedCanvasScaler).
//
// A prefab record: {path, name, active, layer, localPosition, localRotation, localScale, rect, components} in
// hierarchy order (parents first), components with `type` (engine) or `class` (MonoBehaviour).

export const compOf = (rec, cls) => (rec.components || []).find((c) => (c.class || c.type) === cls) || null;
export const compsOf = (rec, cls) => (rec.components || []).filter((c) => (c.class || c.type) === cls);

// ------------------------------------------------------------------------------------------------ nodes
// UnityEngine.Quaternion -> the x / y rows of its rotation matrix (float32)
const quatRows = (q) => {
  const x2 = F(q.x * 2), y2 = F(q.y * 2), z2 = F(q.z * 2);
  const xx = F(q.x * x2), yy = F(q.y * y2), zz = F(q.z * z2), xy = F(q.x * y2), wz = F(q.w * z2);
  return [F(1 - F(yy + zz)), F(xy + wz), F(xy - wz), F(1 - F(xx + zz))];     // m00, m10, m01, m11
};

// A node's full transform in canvas units: a row-major 3 x 4 affine [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]
// (z grows away from the camera). `planar` nodes (no rotation about x / y and no z offset in their whole chain) keep
// the 2D layout matrix for drawing.
const M3_IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
const m3FromAffine = (m) => [m[0], m[2], 0, m[4], m[1], m[3], 0, m[5], 0, 0, 1, 0];
const m3Mul = (a, b) => {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
};
const m3Trs = (px, py, pz, q, sx, sy, sz) => {
  const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z, xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
  const wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy - wz) * sy, 2 * (xz + wy) * sz, px,
          2 * (xy + wz) * sx, (1 - 2 * (xx + zz)) * sy, 2 * (yz - wx) * sz, py,
          2 * (xz - wy) * sx, 2 * (yz + wx) * sy, (1 - 2 * (xx + yy)) * sz, pz];
};
export const m3Apply = (m, x, y, z = 0) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7],
                                            m[8] * x + m[9] * y + m[10] * z + m[11]];
const inPlane = (q) => Math.abs(q.x) <= 1e-7 && Math.abs(q.y) <= 1e-7;
// the 3D matrix and planarity of a node from its parent's (a plain UINode parent counts as its 2D matrix, planar)
const layout3 = (n, parentMatrix, px, py) => {
  const P = n.parent && n.parent.matrix3 ? n.parent.matrix3 : parentMatrix ? m3FromAffine(parentMatrix) : M3_IDENTITY;
  const parentPlanar = !n.parent || n.parent.planar !== false;
  n.matrix3 = m3Mul(P, m3Trs(px, py, n.localZ || 0, n.localRotation, n.localScale.x, n.localScale.y, n.localScaleZ ?? 1));
  n.planar = parentPlanar && !n.localZ && inPlane(n.localRotation);
};

// Quaternion.Euler(x, y, z) (degrees; Unity applies z, then x, then y)
export const quatEuler = (x, y, z) => {
  const r = Math.PI / 360, cx = Math.cos(x * r), sx = Math.sin(x * r), cy = Math.cos(y * r), sy = Math.sin(y * r);
  const cz = Math.cos(z * r), sz = Math.sin(z * r);
  return { x: F(cy * sx * cz + sy * cx * sz), y: F(sy * cx * cz - cy * sx * sz), z: F(cy * cx * sz - sy * sx * cz),
           w: F(cy * cx * cz + sy * sx * sz) };
};

// A RectTransform with its full localRotation and local z. Layout runs in the canvas plane (the x / y rows of the
// rotation); the 3D matrix places the node's mesh for drawing: projected by the canvas camera (orthographic: along the
// canvas normal, a half turn about x or y mirrors the mesh; perspective: see ScreenCanvas.drawItems).
export class CanvasNode extends UINode {
  constructor(rec, parent) {
    super({ ...rec, localRotation: { x: 0, y: 0, z: 0, w: 1 } }, parent);
    this.localRotation = { ...rec.localRotation };
    this.localScaleZ = rec.localScale.z;
    this.localZ = rec.localPosition ? rec.localPosition.z : 0;
    this.components = rec.components || [];
  }

  setEuler(axis, v) {                    // Transform.localEulerAngles.<axis> (an Animator curve)
    if (!this.euler) this.euler = { x: 0, y: 0, z: this.rotationZ };
    this.euler[axis] = v;
    this.localRotation = quatEuler(this.euler.x, this.euler.y, this.euler.z);
  }

  // UINode.layoutIn with the rotation's x / y rows in place of the z rotation
  layoutIn(pr, parentMatrix) {
    if (this.fitter) this.fitter(this, pr);
    const aMinX = F(pr.x + F(this.anchorMin.x * pr.w)), aMaxX = F(pr.x + F(this.anchorMax.x * pr.w));
    const aMinY = F(pr.y + F(this.anchorMin.y * pr.h)), aMaxY = F(pr.y + F(this.anchorMax.y * pr.h));
    if (this.zeroPending) {
      this.anchoredPosition = { x: F(-F(aMinX + F(F(aMaxX - aMinX) * this.pivot.x))), y: F(-F(aMinY + F(F(aMaxY - aMinY) * this.pivot.y))) };
      this.zeroPending = false;
    }
    const w = F(F(aMaxX - aMinX) + this.sizeDelta.x), h = F(F(aMaxY - aMinY) + this.sizeDelta.y);
    const px = F(F(aMinX + F(F(aMaxX - aMinX) * this.pivot.x)) + this.anchoredPosition.x);
    const py = F(F(aMinY + F(F(aMaxY - aMinY) * this.pivot.y)) + this.anchoredPosition.y);
    this.rect = { x: F(-this.pivot.x * w), y: F(-this.pivot.y * h), w, h };
    const [m00, m10, m01, m11] = quatRows(this.localRotation), sx = this.localScale.x, sy = this.localScale.y;
    this.matrix = UIAffine.mul(parentMatrix, [F(m00 * sx), F(m10 * sx), F(m01 * sy), F(m11 * sy), px, py]);
    layout3(this, parentMatrix, px, py);
    for (const c of this.children) c.layoutIn(this.rect, this.matrix);
  }

  // Transform.SetParent(parent, worldPositionStays: false) + SetAsLastSibling
  setParentLast(parent) {
    if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
    this.parent = parent;
    parent.children.push(this);
  }

  // Transform.localPosition = (0, 0, 0): the anchored position that puts the pivot at the parent's pivot, resolved
  // with the parent rect of the next layout pass (the canvas size does not change in between)
  zeroLocalPosition() { this.zeroPending = true; this.localZ = 0; }
}

// AspectRatioFitter.UpdateRect (uGUI): 1 WidthControlsHeight, 2 HeightControlsWidth, 3 FitInParent, 4 EnvelopeParent.
// Applied while the node is laid out, with the parent rect of that pass (the settled state of the driven rect).
export const aspectFitter = (f) => (n, pr) => {
  const ratio = f.m_AspectRatio, mode = f.m_AspectMode;
  const ext = (axis) => (axis === 0 ? pr.w : pr.h), key = (axis) => (axis === 0 ? "x" : "y");
  const sizeDeltaFor = (size, axis) => F(size - F(ext(axis) * F(n.anchorMax[key(axis)] - n.anchorMin[key(axis)])));
  const own = (axis) => F(F(ext(axis) * F(n.anchorMax[key(axis)] - n.anchorMin[key(axis)])) + n.sizeDelta[key(axis)]);
  if (mode === 1) n.sizeDelta.y = sizeDeltaFor(F(own(0) / ratio), 1);
  else if (mode === 2) n.sizeDelta.x = sizeDeltaFor(F(own(1) * ratio), 0);
  else if (mode === 3 || mode === 4) {
    n.anchorMin = { x: 0, y: 0 }; n.anchorMax = { x: 1, y: 1 }; n.anchoredPosition = { x: 0, y: 0 };
    const sd = { x: 0, y: 0 };
    if ((F(pr.h * ratio) < pr.w) !== (mode === 3)) sd.y = sizeDeltaFor(F(pr.w / ratio), 1);
    else sd.x = sizeDeltaFor(F(pr.h * ratio), 0);
    n.sizeDelta = sd;
  } else if (mode !== 0) throw new UIError(`${n.path}: aspect mode ${mode}`);
};

// ------------------------------------------------------------------------------------------------ Image Tiled
// Image.GenerateTiledSprite (uGUI): a sprite without border whose texture repeats and is not packed tiles through the
// uv scale of one quad; otherwise quads per tile (fill centre), clipped at the far edges. Borders of tiled sprites are
// outside the subset.
export const tiledImage = (node, img, sprite, canvasRefPPU) => {
  const c = uiColor32(img.m_Color), r = node.rect;
  const ppu = sprite ? F(F(sprite.pixelsPerUnit / canvasRefPPU) * img.m_PixelsPerUnitMultiplier) : 1;
  if (sprite && sprite.hasBorder) throw new UIError(`${node.path}: tiled sprite with a border not implemented`);
  const inner = sprite ? (sprite.inner || (() => { throw new UIError(`${node.path}: tiled trimmed sprite`); })()) : [0, 0, 0, 0];
  const size = sprite ? { x: sprite.rect.width, y: sprite.rect.height } : { x: 100, y: 100 };
  let tw = F(size.x / ppu), th = F(size.y / ppu);
  const xMin = 0, xMax = r.w, yMin = 0, yMax = r.h;
  if (tw <= 0) tw = F(xMax - xMin);
  if (th <= 0) th = F(yMax - yMin);
  const m = new UIMesh();
  if (!img.m_FillCenter) return m;
  const repeat = sprite && sprite.texture.wrapU === 0 && sprite.texture.wrapV === 0 && !sprite.packed;
  if (!sprite || repeat) {
    const su = F(F(xMax - xMin) / tw), sv = F(F(yMax - yMin) / th);
    m.addQuad(r.x + xMin, r.y + yMin, r.x + xMax, r.y + yMax, c, F(inner[0] * su), F(inner[1] * sv), F(inner[2] * su), F(inner[3] * sv));
    return m;
  }
  const nW = Math.ceil((xMax - xMin) / tw), nH = Math.ceil((yMax - yMin) / th);
  if (nW * nH * 4 > 65000) throw new UIError(`${node.path}: too many sprite tiles`);
  for (let j = 0; j < nH; j++) {
    const y1 = F(yMin + j * th);
    let y2 = F(yMin + (j + 1) * th), v1 = inner[3];
    if (y2 > yMax) { v1 = F(inner[1] + F(F(inner[3] - inner[1]) * F(yMax - y1) / F(y2 - y1))); y2 = yMax; }
    for (let i = 0; i < nW; i++) {
      const x1 = F(xMin + i * tw);
      let x2 = F(xMin + (i + 1) * tw), u1 = inner[2];
      if (x2 > xMax) { u1 = F(inner[0] + F(F(inner[2] - inner[0]) * F(xMax - x1) / F(x2 - x1))); x2 = xMax; }
      m.addQuad(r.x + x1, r.y + y1, r.x + x2, r.y + y2, c, inner[0], inner[1], u1, v1);
    }
  }
  return m;
};

// ------------------------------------------------------------------------------------------------ Animator bindings
// The properties the screen-canvas clips animate, as {get, set} on a node. Returns null for a curve Unity skips (no
// such object or component); raises for a property this module does not drive.
// ENGINE: Mecanim writes a bool property (GameObject.m_IsActive, Behaviour.m_Enabled) from its float curve as
// value > 0.5.
const UI_GETTERS = {
  "RectTransform.m_AnchoredPosition.x": (n) => n.anchoredPosition.x, "RectTransform.m_AnchoredPosition.y": (n) => n.anchoredPosition.y,
  "RectTransform.m_SizeDelta.x": (n) => n.sizeDelta.x, "RectTransform.m_SizeDelta.y": (n) => n.sizeDelta.y,
  "RectTransform.m_AnchorMin.x": (n) => n.anchorMin.x, "RectTransform.m_AnchorMin.y": (n) => n.anchorMin.y,
  "RectTransform.m_AnchorMax.x": (n) => n.anchorMax.x, "RectTransform.m_AnchorMax.y": (n) => n.anchorMax.y,
  "RectTransform.m_Pivot.x": (n) => n.pivot.x, "RectTransform.m_Pivot.y": (n) => n.pivot.y,
  "Transform.m_LocalScale.x": (n) => n.localScale.x, "Transform.m_LocalScale.y": (n) => n.localScale.y,
  "Transform.m_LocalScale.z": (n) => n.localScaleZ,
};

export const bindCanvasProperty = (root, b, extra = null) => {
  let n = root;
  if (b.path !== "") { try { n = root.find(b.path); } catch (e) { return null; } }
  const prop = `${b.cls}.${b.attr}`;
  if (extra) { const acc = extra(n, prop, b); if (acc !== undefined) return acc; }
  if (UI_GETTERS[prop]) {
    const set = UI_CLIP_TARGET[prop];
    return { get: () => UI_GETTERS[prop](n), set: (v) => set(n, v) };
  }
  if (prop === "CanvasGroup.m_Alpha")
    return n.canvasGroup ? { get: () => n.canvasGroup.alpha, set: (v) => { n.canvasGroup.alpha = v; } } : null;
  if (prop === "GameObject.m_IsActive")
    return { get: () => (n.activeSelf ? 1 : 0), set: (v) => { n.activeSelf = v > 0.5; } };
  const col = /^Image\.m_Color\.([rgba])$/.exec(prop);
  if (col) return n.image ? { get: () => n.image.m_Color[col[1]], set: (v) => { n.image.m_Color[col[1]] = v; } } : null;
  const eul = /^Transform\.localEulerAngles(?:Raw)?\.([xyz])$/.exec(prop);
  if (eul) return { get: () => (n.euler ? n.euler[eul[1]] : eul[1] === "z" ? n.rotationZ : 0), set: (v) => n.setEuler(eul[1], v) };
  throw new UIError(`${n.path}: animated property ${prop} not implemented`);
};

// The Mecanim Animator of a prefab node (layer 0 of its controller, one clip per state; engine/anim.js) with the
// normalized time of the current state. records: the file's AnimRecords (clips.js), which resolves controllers and
// clips written once per file. A missing controller (m_Controller null) gives an Animator without states: HasState
// is false for every state.
// ENGINE: a state whose motion is missing or has zero length advances its normalized time as if one second long.
export class CanvasAnimator {
  constructor(node, comp, bind, name = node.path, records = new AnimRecords({}, UIError)) {
    this.node = node; this.comp = comp;
    const raw = records.controller(comp.m_Controller, node.path);
    this.animator = null;
    if (raw) {
      if (comp.m_UpdateMode !== 0 || comp.m_CullingMode !== 0 || comp.m_ApplyRootMotion)
        throw new UIError(`${node.path}: Animator settings outside the implemented subset`);
      this.animator = new Animator(records.controllerOf(raw, node.path), bind, name);
    }
    this.enabled = !!comp.m_Enabled;
    this.keepStateOnDisable = !!comp.m_KeepAnimatorStateOnDisable;
  }

  get speed() { return this.animator ? this.animator.speed : 1; }
  set speed(v) { if (this.animator) this.animator.speed = v; }

  // Animator.HasState(0, hash of the short name)
  hasState(name) { return !!this.animator && this.animator.ctrl.states.some((s) => s.name === name); }

  // Animator.Play(state, 0, normalizedTime)
  play(name, normalizedTime = 0) { this.animator.play(name, normalizedTime); }

  // GetCurrentAnimatorStateInfo(0): during a cross-fade the source state
  currentState() {
    const a = this.animator;
    if (!a) return null;
    if (a.fade) return { state: a.ctrl.states[a.fade.from], time: a.fade.fromTime };
    return { state: a.state, time: a.time };
  }

  normalizedTime() {
    const s = this.currentState();
    if (!s) return 0;
    const L = s.state.clip && s.state.clip.length > 0 ? s.state.clip.length : 1;
    return s.time / L;
  }

  // the object became active: without keepAnimatorStateOnDisable the Animator starts again from its default state
  onEnable() { if (this.animator && !this.keepStateOnDisable) this.animator.reset(); }

  update(dt) { if (this.animator && this.enabled && this.node.activeInHierarchy) this.animator.update(dt); }
}

// ------------------------------------------------------------------------------------------------ prefab instance
// One instance of a prefab node list under `parent` (a CanvasNode or null for a root of its own). Keeps the nodes by
// prefab path; `sprite(record)` resolves the inline sprite records (textures registered for the GL load).
// A plain Transform (no RectTransform) inside a canvas prefab (a holder of components such as DOTween animations): laid
// out by its local position, rotation and scale; it draws nothing itself. A layout group over it and RectTransform
// properties on it are refused.
// ENGINE: a RectTransform under a plain Transform is laid out against a zero-size parent rect at the Transform's
// origin (anchors at that point, the size from sizeDelta).
export class TransformNode {
  constructor(rec, parent) {
    this.path = rec.path; this.name = rec.name; this.parent = parent; this.children = [];
    if (parent) parent.children.push(this);
    this.activeSelf = !!rec.active;
    this.rec = rec; this.components = rec.components || [];
    this.transformOnly = true;
    this.localPosition = { x: F(rec.localPosition.x), y: F(rec.localPosition.y) };
    this.localZ = rec.localPosition.z;
    this.localRotation = { ...rec.localRotation };
    this.localScale = { x: rec.localScale.x, y: rec.localScale.y };
    this.localScaleZ = rec.localScale.z;
    this.canvasGroup = null; this.rect = null; this.matrix = null;
  }

  get activeInHierarchy() {
    for (let n = this; n; n = n.parent) if (!n.activeSelf) return false;
    return true;
  }

  get anchoredPosition() { throw new UIError(`${this.path}: not a RectTransform`); }
  get sizeDelta() { throw new UIError(`${this.path}: not a RectTransform`); }

  layoutIn(pr, parentMatrix) {
    const [m00, m10, m01, m11] = quatRows(this.localRotation), sx = this.localScale.x, sy = this.localScale.y;
    this.matrix = UIAffine.mul(parentMatrix, [F(m00 * sx), F(m10 * sx), F(m01 * sy), F(m11 * sy), this.localPosition.x, this.localPosition.y]);
    layout3(this, parentMatrix, this.localPosition.x, this.localPosition.y);
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    for (const c of this.children) c.layoutIn(this.rect, this.matrix);
  }
}

// Coffee.UIParticle (a MaskableGraphic that bakes its ParticleSystems into canvas meshes) and the particle systems it
// draws: not drawn by this player, so a node with one of them raises when it would be drawn
const PARTICLE_COMPONENTS = ["UIParticle", "ParticleSystem", "ParticleSystemRenderer"];

export class CanvasPrefab {
  constructor(nodes, parent, canvas) {
    this.canvas = canvas;
    this.nodes = new Map();
    for (const rec of nodes) {
      const cut = rec.path.lastIndexOf("/");
      const p = cut < 0 ? parent : this.nodes.get(rec.path.slice(0, cut));
      if (cut >= 0 && !p) throw new UIError(`${rec.path}: parent not in the prefab`);
      let n;
      if (!rec.rect) {
        if (!p) throw new UIError(`${rec.path}: a prefab root without a RectTransform`);
        if (p.layoutGroup) throw new UIError(`${rec.path}: a plain Transform under a layout group`);
        n = new TransformNode(rec, p);
      } else {
        n = new CanvasNode({ ...rec, canvasGroup: compOf(rec, "CanvasGroup") }, p || null);
        this._components(n, rec);
      }
      const particles = PARTICLE_COMPONENTS.filter((cls) => compOf(rec, cls));
      if (particles.length) n.particleComponents = particles;
      this.nodes.set(rec.path, n);
    }
    this.root = this.nodes.get(nodes[0].path);
  }

  _components(n, rec) {
    const im = compOf(rec, "Image");
    if (im) n.image = { m_Enabled: !!im.m_Enabled, m_Color: { ...im.m_Color }, m_Type: im.m_Type,
                        m_PreserveAspect: im.m_PreserveAspect, m_FillCenter: im.m_FillCenter,
                        m_PixelsPerUnitMultiplier: im.m_PixelsPerUnitMultiplier, m_UseSpriteMesh: im.m_UseSpriteMesh,
                        spriteObj: this.canvas.sprite(im.m_Sprite), material: im.m_Material ? this.canvas.material(im.m_Material) : null };
    if (compOf(rec, "RawImage")) throw new UIError(`${rec.path}: RawImage not implemented`);
    for (const cls of ["Mask", "RectMask2D", "Canvas", "AdvFrameScreenPadding"])
      if (compOf(rec, cls) && compOf(rec, cls).m_Enabled !== 0) throw new UIError(`${rec.path}: ${cls} not implemented`);
    const f = compOf(rec, "AspectRatioFitter");
    if (f && f.m_Enabled && f.m_AspectMode) n.fitter = aspectFitter(f);
    for (const cls of ["HorizontalLayoutGroup", "VerticalLayoutGroup"]) {
      const lg = compOf(rec, cls);
      if (lg && lg.m_Enabled) n.layoutGroup = { ...lg, class: cls };
    }
    const le = compOf(rec, "LayoutElement");
    if (le && le.m_Enabled) n.layoutElement = le;
    const csf = compOf(rec, "ContentSizeFitter");
    if (csf && csf.m_Enabled) n.contentSizeFitter = csf;
    const tmp = compOf(rec, "TextMeshProUGUI");
    if (tmp) n.tmp = { rec: tmp, enabled: !!tmp.m_Enabled, text: tmp.m_text || "" };
    const sp = compOf(rec, "StretchPosition");
    if (sp) n.stretch = { enabled: !!sp.m_Enabled, positionPercent: sp.positionPercent };
  }

  node(path) {
    const n = this.nodes.get(path);
    if (!n) throw new UIError(`prefab node not found: ${path}`);
    return n;
  }

  // a component reference {component, gameObject} -> the node
  ref(r) { return r ? this.node(r.gameObject) : null; }
}

// ------------------------------------------------------------------------------------------------ screen canvas
// Fwk.UI.ClampedCanvasScaler.HandleScaleWithScreenSize (MatchWidthOrHeight): scale = 2^lerp(log2(w / refX),
// log2(h / refY), match); an aspect above the threshold uses threshold / aspect instead. Canvas units = pixels / scale.
export const clampedCanvasSize = (scaler, width, height) => {
  const ref = scaler.m_ReferenceResolution, match = Math.min(Math.max(scaler.m_MatchWidthOrHeight, 0), 1);
  const aspect = width / height;
  let s;
  if (scaler.m_ScreenMatchMode === 0) s = 2 ** ((1 - match) * Math.log2(width / ref.x) + match * Math.log2(height / ref.y));
  else if (scaler.m_ScreenMatchMode === 1) s = Math.min(width / ref.x, height / ref.y);
  else if (scaler.m_ScreenMatchMode === 2) s = Math.max(width / ref.x, height / ref.y);
  else s = 1;
  if (aspect > scaler._maxAspectThreshold) s = scaler._maxAspectThreshold / aspect;
  return { W: width / s, H: height / s, scale: s };
};

// One camera canvas of UIAdvWidget: a root node laid out over the canvas units, its content drawn in hierarchy order
// with the UI shaders. `sprite(record)` / `material(record)` collect what the GL load needs.
export class ScreenCanvas {
  constructor(name, { sortingOrder, scaler }) {
    this.name = name; this.sortingOrder = sortingOrder; this.scaler = scaler;
    this.root = new CanvasNode({ path: name, name, active: true, localPosition: { x: 0, y: 0, z: 0 },
                                 localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
                                 rect: { m_AnchorMin: { x: 0, y: 0 }, m_AnchorMax: { x: 1, y: 1 }, m_AnchoredPosition: { x: 0, y: 0 },
                                         m_SizeDelta: { x: 0, y: 0 }, m_Pivot: { x: 0.5, y: 0.5 } } }, null);
    this.sprites = new Map();          // "<sprite>@<texture path>" -> UISprite
    this.textures = new Map();         // texture path -> descriptor
    this.materials = new Map();        // material name -> record
    this.size = null;
  }

  get refPPU() { return this.scaler.m_ReferencePixelsPerUnit; }

  sprite(s) {
    if (!s) return null;
    const tex = s.texture, key = `${s.sprite}@${tex.texture}`;
    if (!this.sprites.has(key)) {
      if (s.downscaleMultiplier !== undefined && s.downscaleMultiplier !== 1) throw new UIError(`sprite ${s.sprite}: atlas variant scale`);
      const sp = new UISprite(s.sprite, { rect: s.rect, border: s.border, pixelsPerUnit: s.pixelsToUnits, pivot: s.pivot,
                                          textureRect: s.textureRect, textureRectOffset: s.textureRectOffset },
                              { width: tex.width, height: tex.height, name: tex.texture,
                                wrapU: tex.settings ? tex.settings.m_WrapU : 1, wrapV: tex.settings ? tex.settings.m_WrapV : 1 });
      sp.packed = !!((s.settingsRaw | 0) & 1);                   // SpriteSettings.packed
      this.sprites.set(key, sp);
      this.textures.set(tex.texture, tex);
    }
    return this.sprites.get(key);
  }

  // a sprite of the story UI data (ui/ui.json `sprites` / `textures`, texture paths under `dir`)
  uiSprite(doc, name, dir) {
    if (!name) return null;
    const key = `ui:${name}`;
    if (!this.sprites.has(key)) {
      const s = doc.sprites[name], t = s ? doc.textures[s.texture] : null;
      if (!s || !t) throw new UIError(`sprite ${name} not in the story UI data`);
      const path = join(dir, t.texture), desc = { ...t, texture: path };
      const sp = new UISprite(name, s, { ...desc, name: path, wrapU: t.settings ? t.settings.m_WrapU : 1,
                                         wrapV: t.settings ? t.settings.m_WrapV : 1 });
      this.sprites.set(key, sp);
      this.textures.set(path, desc);
    }
    return this.sprites.get(key);
  }

  material(m) {
    if (!m.shader || !m.shader.shader) throw new UIError(`material ${m.material}: no shader`);
    if (!this.materials.has(m.material)) {
      this.materials.set(m.material, m);
      for (const t of Object.values(m.textures || {})) if (t.texture) this.textures.set(t.texture.texture, t.texture);
    }
    return this.materials.get(m.material);
  }

  canvasSize(width, height) { return clampedCanvasSize(this.scaler, width, height); }

  layout(W, H) {
    UILayout.layoutRoot(this.root, W, H, (n) => UILayout.rebuildUncontrolled(n));
    this.size = { W, H };
  }

  // paint order and inherited alpha: UIDraw.list. itemsOf(n, alpha) adds the items of other graphics (particles, video):
  // {node, material (record or null: the default UI material), texture (path) | glTex () => GLTex, verts, idx}.
  // A node off the canvas plane (rotated about x / y, or moved along z) has its mesh placed by its 3D matrix: under a
  // perspective camera (the canvas `perspective` = {fov}: Screen Space - Camera, the canvas plane filling the view at
  // its plane distance) the vertices keep their z and CanvasGL projects them (viewProjection); under an orthographic
  // camera they are projected along the canvas normal (z dropped).
  drawItems(itemsOf = null) {
    const P = this.perspective;
    return UIDraw.list(this.root, (n, alpha) => {
      const offPlane = n.planar === false;
      const out = [];
      if (n.image && n.image.m_Enabled && alpha > 0) {
        const img = n.image, sp = img.spriteObj;
        const mesh = img.m_Type === 2 ? tiledImage(n, img, sp, this.refPPU) : UIImage.build(n, img, sp, this.refPPU);
        const verts = UIDraw.pack(mesh.verts, n, alpha);
        if (offPlane) mesh.verts.forEach((v, i) => {
          const [x, y, z] = m3Apply(n.matrix3, v.x, v.y), o = i * UI_STRIDE;
          verts[o] = x; verts[o + 1] = y; verts[o + 2] = P ? z : 0;
        });
        out.push({ node: n, material: img.material, texture: sp ? sp.texture.name : null, mesh,
                   verts, idx: Uint32Array.from(mesh.idx), ...(img.glTex ? { glTex: img.glTex } : {}) });
      }
      if (n.tmp && n.tmp.enabled && n.tmp.text && alpha > 0) throw new UIError(`${n.path}: canvas text not implemented`);
      if (n.particleComponents && alpha > 0)
        throw new StoryCommandError(`${n.path}: ${n.particleComponents.join(" / ")} not drawn by this player`);
      if (itemsOf) {
        const extra = itemsOf(n, alpha);
        if (extra.length && offPlane) throw new UIError(`${n.path}: a video or particle graphic off the canvas plane`);
        out.push(...extra);
      }
      return out;
    });
  }
}

// The perspective camera of a Screen Space - Camera canvas in canvas units (column-major): the camera on the canvas
// normal through the view centre at D = H / (2 tan(fov / 2)) in front of the plane, so a point at canvas z projects
// scaled by D / (D + z) about the centre (clip w = D + z); clip z is 0 (UI shaders test depth against the cleared
// buffer and write none).
export const viewProjection = (fov, W, H) => {
  const D = H / (2 * Math.tan(fov * Math.PI / 360));
  return [2 * D / W, 0, 0, 0, 0, 2 * D / H, 0, 0, 0, 0, 0, 1, -D, -D, 0, D];
};

// ------------------------------------------------------------------------------------------------ GL
// The UI shader programs, textures and buffers of the screen canvases (story root: shaders/, textures/).
// Graphic.defaultGraphicMaterial for images without a material: "Default UI Material" = UI/Default with its shader
// defaults. A custom Image material keeps its own properties; _MainTex is the sprite's texture (Image.mainTexture).
export class CanvasGL {
  constructor(gl, lib, assets) {
    this.gl = gl; this.lib = lib; this.assets = assets;
    this.tex = new Map(); this.mats = new Map();
    this.solid = null; this.buf = null; this.defaultMaterial = null;
  }

  async load(GLTex, canvases) {
    const gl = this.gl;
    this.solid = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
    };
    this.defaultMaterial = this._material({ material: "Default UI Material", shader: { shader: "UI/Default" }, keywords: [] });
    for (const c of canvases) {
      for (const [p, desc] of c.textures) if (!this.tex.has(p)) this.tex.set(p, await GLTex.load(gl, "", desc, this.assets));
      for (const m of c.materials.values()) if (!this.mats.has(m.material)) this.mats.set(m.material, this._material(m));
    }
    this.buf = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
  }

  _material(m) {
    const shader = m.shader.shader, defaults = this.lib.defaults(shader, this.solid);
    const num = Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v === "number"));
    const out = { shader, keywords: m.keywords || [], floats: { ...num, ...(m.floats || {}) }, colors: m.colors || {}, defaults,
                  textures: m.textures || {} };
    this.lib.program(shader, 0, out.keywords);
    return out;
  }

  draw(canvas, items, width, height) {
    const gl = this.gl, { W, H } = canvas.size;
    const globals = UIDraw.globals(W, H, width, height, 4);
    if (canvas.perspective) {
      const vp = viewProjection(canvas.perspective.fov, W, H);
      globals.unity_MatrixVP = vp; globals.glstate_matrix_projection = vp;
    }
    for (const it of items) {
      const mat = it.material ? this.mats.get(it.material.material) : this.defaultMaterial;
      const tex = it.glTex ? it.glTex() : it.texture ? this.tex.get(it.texture) : this.solid.white;
      if (!tex) continue;                   // a graphic whose texture is not there yet (a video before its first frame)
      const st = mat.textures._MainTex;
      const sheet = { _MainTex: tex, _MainTex_ST: st ? [st.scale.x, st.scale.y, st.offset.x, st.offset.y] : [1, 1, 0, 0],
                      _TextureSampleAdd: [0, 0, 0, 0], _ClipRect: [-32767, -32767, 32767, 32767] };
      UIDraw.draw(gl, this.lib, this.buf, mat, sheet, globals, it.verts, it.idx);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.tex.values()) gl.deleteTexture(t.glTexture);
    if (this.solid) for (const t of Object.values(this.solid)) gl.deleteTexture(t.glTexture);
    if (this.buf) { gl.deleteVertexArray(this.buf.vao); gl.deleteBuffer(this.buf.vbo); gl.deleteBuffer(this.buf.ibo); }
    this.buf = null;
  }
}
