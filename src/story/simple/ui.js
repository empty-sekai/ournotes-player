import { AnimClip, Animator } from "../../engine/anim.js";
import { F, join } from "../../engine/core.js";
import { ShaderLib } from "../../engine/glsl.js";
import { GLTex } from "../../engine/texture.js";
import { UI_CLIP_TARGET, UIDraw, UIError, UIImage, UILayout, UIMesh, UINode, UISprite, uiCanvasSize, uiColor32 } from "../../engine/ugui.js";
import { TMPText, UIGradientMod } from "../../engine/uitext.js";
import { StoryText } from "../ui-ruby.js";

// The uGUI documents of the simple player: the simple talk window (UISimpleAdvTalkWindow, ui/simple/ui.json with its
// fonts) and the host screen's widgets (host/ui/ui.json), in the record format the story UI data uses. A document
// builds its RectTransform nodes (engine/ugui.js), images, gradients, TMP texts (engine/uitext.js) with their text
// components (`storyText`: ui-ruby.js StoryText over the font data's binding, as the story UI), animators and layout
// groups; SimpleCanvas lays out and draws node trees that mix nodes of several documents (the view reparents the talk
// window under the host's talk root and adds its own slot images), each drawn with its own document's textures,
// materials and shaders.

export const DEFAULT_UI_MATERIAL = "Default UI Material";
const LANGUAGE_ENGLISH = 1;                  // Fwk.Localization.LanguageMode.English
const LANGUAGE_KOREAN = 4;                   // Fwk.Localization.LanguageMode.Korean
const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 };

// ------------------------------------------------------------------------------------------------ animation
// An Animator clip of the host UI data. Curves are keyed "<path>:<Class>.<property>", the path relative to the
// Animator's node ("" or no path: the node itself; "#<hash>": a path the game data does not resolve, which the
// Animator binds to nothing), each {keys: [[time, c0, c1, c2, c3]]} (streamed Hermite segments), {discrete:
// [[time, value]]} (a step curve: the value of the last key at or before the time) or {constant}. A discrete
// Image.m_Sprite value indexes `pptrCurveMapping` (sprite names).
export class SimpleUIClip extends AnimClip {
  constructor(clip) {
    if (clip.startTime) throw new UIError(`clip ${clip.name}: start time ${clip.startTime}`);
    if (clip.events && clip.events.length) throw new UIError(`clip ${clip.name}: animation events not implemented`);
    const curves = Object.entries(clip.curves).map(([key, c]) => {
      const i = key.lastIndexOf(":"), path = i < 0 ? "" : key.slice(0, i), prop = key.slice(i + 1);
      const cut = prop.indexOf(".");
      const binding = { path, cls: prop.slice(0, cut), attr: prop.slice(cut + 1), prop };
      if ("constant" in c) return { binding, constant: F(c.constant) };
      const t = [], k = [];
      if (c.discrete) for (const [time, v] of c.discrete) { t.push(F(time)); k.push(0, 0, 0, F(v)); }
      else if (c.keys) for (const [time, c0, c1, c2, c3] of c.keys) { t.push(F(time)); k.push(F(c0), F(c1), F(c2), F(c3)); }
      else throw new UIError(`clip ${clip.name}: curve ${key} in a form not implemented (${Object.keys(c).join(", ")})`);
      return { binding, t, k };
    });
    super({ name: clip.name, length: clip.stopTime, loopTime: clip.loopTime, curves, events: [] });
    this.pptr = clip.pptrCurveMapping || [];
  }
}

// The properties a host UI clip drives besides UI_CLIP_TARGET: Image.m_Sprite (a PPtr curve of the playing state's
// clip) and GameObject.m_IsActive
const SIMPLE_CLIP_TARGET = {
  "Image.m_Sprite": (n, v, anim) => {
    const name = anim.state.clip.pptr[Math.round(v)], sp = name ? n.doc.sprites.get(name) : null;
    if (!n.image) throw new UIError(`${n.path}: clip drives the sprite of a node without an Image`);
    if (!sp) throw new UIError(`${n.path}: clip sprite ${name ?? v} not in the data`);
    n.image.spriteObj = sp;
  },
  "GameObject.m_IsActive": (n, v) => { setActive(n, v !== 0); },
};

// The Animator of a host UI node: one layer, no transitions or parameters, Write Defaults off (the prefab
// controllers), each state playing its clip; curve bindings resolve against the node's subtree. Bindings to a
// "#<hash>" path or a node outside the exported tree bind to nothing (Unity skips a binding whose object is
// missing); the latter are listed in doc.unbound.
export class SimpleUIAnimator extends Animator {
  constructor(node, ctrl, clips, doc) {
    const states = ctrl.states.map((s) => {
      const key = `${ctrl.name}/${s.clip}`;
      const clip = s.clip ? clips[key] || null : null;
      if (s.clip && !clip) throw new UIError(`${node.path}: clip ${key} not in the data`);
      if (s.cycleOffset) throw new UIError(`${ctrl.name}.${s.name}: cycle offset not implemented`);
      return { name: s.name, speed: s.speed ?? 1, clip, writeDefaults: false, transitions: [] };
    });
    const defaultState = states.findIndex((s) => s.name === ctrl.defaultState);
    if (defaultState < 0) throw new UIError(`${ctrl.name}: no default state ${ctrl.defaultState}`);
    const self = {};
    super({ name: ctrl.name, states, defaultState, anyState: [], parameters: new Map() }, (b) => {
      if (b.path.startsWith("#")) return null;
      const target = b.path ? doc.nodes.get(`${node.path}/${b.path}`) : node;
      if (!target) { doc.unbound.push(`${ctrl.name}: ${b.path}`); return null; }
      const ui = UI_CLIP_TARGET[b.prop], own = SIMPLE_CLIP_TARGET[b.prop];
      if (!ui && !own) throw new UIError(`${ctrl.name}: clip property ${b.prop} not implemented`);
      return { set: ui ? (v) => ui(target, v) : (v) => own(target, v, self.animator) };
    });
    self.animator = this;
    this.node = node;
  }

  // SimpleAnimationTrigger.PlayAnimation -> Animator.CrossFade(state, 0): an immediate switch. A state the controller
  // does not have leaves the Animator as it is (a warning); returns whether the state was found.
  // ENGINE: CrossFade to a missing state is native: Unity logs "State could not be found" and changes nothing.
  play(name) {
    if (!this.ctrl.states.some((s) => s.name === name)) {
      console.warn(`${this.node.path}: Animator ${this.name} has no state ${name}`);
      return false;
    }
    super.play(name);
    return true;
  }
}

// a RectTransform record of a node the view creates at runtime (new GameObject(name, typeof(RectTransform)))
export const runtimeNodeRecord = (path, name, { min = { x: 0, y: 0 }, max = { x: 1, y: 1 }, pivot = { x: 0.5, y: 0.5 },
                                              pos = { x: 0, y: 0 }, size = { x: 0, y: 0 }, active = true } = {}) => ({
  path, name, active, localPosition: { x: 0, y: 0, z: 0 }, localRotation: IDENTITY_Q, localScale: { x: 1, y: 1, z: 1 },
  rect: { m_AnchorMin: { ...min }, m_AnchorMax: { ...max }, m_AnchoredPosition: { ...pos }, m_SizeDelta: { ...size },
          m_Pivot: { ...pivot } },
});

export class SimpleUIDoc {
  // gl may be null (layout and timing only). doc = the ui.json record document; fonts = its fonts.json (texts need
  // it); language = the story's ui/languages.json; assets = the story's AssetStore; dir = the document's directory
  constructor(gl, loop, doc, { assets, dir, fonts = null, language = null }) {
    this.gl = gl; this.loop = loop; this.doc = doc; this.assets = assets; this.dir = dir;
    this.fonts = fonts; this.language = language;
    const byPath = new Map(), roots = [];
    for (const rec of doc.nodes) {                  // hierarchy order (parents first)
      const i = rec.path.lastIndexOf("/");
      const parent = i < 0 ? null : byPath.get(rec.path.slice(0, i)) || null;
      if (i >= 0 && !parent) throw new UIError(`ui node ${rec.path} has no parent in the data`);
      const n = new UINode(rec, parent);
      n.doc = this;
      byPath.set(rec.path, n);
      if (!parent) roots.push(n);
    }
    this.nodes = byPath; this.roots = roots;
    this.sprites = new Map(Object.entries(doc.sprites || {}).map(([name, s]) => {
      const t = doc.textures[s.texture];
      if (!t) throw new UIError(`sprite ${name}: texture ${s.texture} not in the data`);
      return [name, new UISprite(name, s, t)];
    }));
    this._fonts = new Map();
    const clips = Object.fromEntries(Object.entries(doc.clips || {}).map(([k, c]) => [k, new SimpleUIClip(c)]));
    this.animators = [];
    this.unbound = [];
    for (const n of byPath.values()) this._setupNode(n, clips);
  }

  _setupNode(n, clips) {
    const r = n.rec, doc = this.doc;
    if (r.image) {
      const sp = r.image.sprite;
      if (sp && !this.sprites.has(sp)) throw new UIError(`${n.path}: sprite ${sp} not in the data`);
      n.image = { ...r.image, spriteObj: sp ? this.sprites.get(sp) : null, material: r.image.material || DEFAULT_UI_MATERIAL };
      if (!doc.materials[n.image.material]) throw new UIError(`${n.path}: material ${n.image.material} not in the data`);
    }
    if (r.rawImage) n.rawImage = { ...r.rawImage, material: r.rawImage.material || DEFAULT_UI_MATERIAL,
                                   textureName: r.rawImage.texture || null, texture: null };
    if (r.gradient && r.gradient.enabled) n.gradient = r.gradient;
    if (r.textStyle) {
      if (!this.fonts) throw new UIError(`${n.path}: a text node without font data`);
      let t = this.fonts.texts[n.path];
      if (!t) throw new UIError(`${n.path}: no text binding in the font data`);
      const mode = this.language ? this.language.mode : 0;
      // LocalizeKoreanAdjust.Apply: in the Korean language mode ForceNormal (1) clears and ForceBold (2) sets Bold
      const ko = t.localizeKoreanAdjust;
      if (ko && ko.m_Enabled && mode === LANGUAGE_KOREAN && (ko._koreanFontStyle === 1 || ko._koreanFontStyle === 2))
        t = { ...t, m_fontStyle: ko._koreanFontStyle === 2 ? t.m_fontStyle | 1 : t.m_fontStyle & ~1 };
      n.text = new TMPText(this, n, t);
      n.text.enabled = !!t.enabled;
      // LocalizeText.OnFontChanged, English only: word wrapping on unless the object's name contains "nowrap"
      if (mode === LANGUAGE_ENGLISH && !n.name.toLowerCase().includes("nowrap")) n.text.setWrapping(1);
      n.storyText = new StoryText(n.text, t);
    }
    if (r.animator) {
      const a = r.animator, ctrl = (doc.controllers || {})[a.controller];
      if (!ctrl) throw new UIError(`${n.path}: controller ${a.controller} not in the data`);
      if (a.updateMode !== 0 || !a.enabled || a.keepStateOnDisable)
        throw new UIError(`${n.path}: animator settings outside the prefab values`);
      n.animator = new SimpleUIAnimator(n, ctrl, clips, this);
      this.animators.push(n.animator);
    }
    if (r.layoutGroup && r.layoutGroup.m_Enabled) n.layoutGroup = r.layoutGroup;
    if (r.contentSizeFitter && r.contentSizeFitter.m_Enabled) n.contentSizeFitter = r.contentSizeFitter;
    if (r.layoutElement && r.layoutElement.m_Enabled) n.layoutElement = r.layoutElement;
    if (r.outline && r.outline.enabled) throw new UIError(`${n.path}: enabled Outline effect not implemented`);
  }

  node(path) {
    const n = this.nodes.get(path);
    if (!n) throw new UIError(`ui node ${path} not in the data`);
    return n;
  }

  // ------------------------------------------------------------ text host (engine/uitext.js)
  fontAsset(name) {
    if (!this._fonts.has(name)) {
      const f = this.fonts.fonts[name];
      if (!f) throw new UIError(`font asset ${name} not in the font data`);
      this._fonts.set(name, { name, ...f, textureSize: this.fonts.textures, lineBreaking: this.fonts.lineBreaking || null });
    }
    return this._fonts.get(name);
  }

  material(name) { return this.fonts ? this.fonts.materials[name] || null : null; }

  // ------------------------------------------------------------ GL resources
  async load() {
    const gl = this.gl;
    if (!gl) return;
    const assets = this.assets || undefined;
    this.lib = new ShaderLib(gl, join(this.dir, this.doc.shaders.index.replace(/\/shaders\.json$/, "")), assets);
    this.fontLib = this.fonts && this.fonts.shaders
      ? new ShaderLib(gl, join(this.dir, this.fonts.shaders.index.replace(/\/shaders\.json$/, "")), assets) : this.lib;
    this.solid = { white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
                   gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump") };
    this.tex = {};
    const texs = [...Object.entries(this.doc.textures || {}), ...Object.entries(this.fonts ? this.fonts.textures : {})];
    for (const [name, desc] of texs) {
      if (this.tex[name]) throw new UIError(`texture name ${name} used twice`);
      this.tex[name] = await GLTex.load(gl, this.dir, desc, assets);
    }
    this.materials = {};
    const add = (lib, mats, keywords) => {
      for (const [name, m] of Object.entries(mats || {})) {
        const shader = m.shader.shader, defaults = lib.defaults(shader, this.solid);
        const num = Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v === "number"));
        this.materials[name] = { lib, shader, keywords: (keywords || {})[name] || [], floats: { ...num, ...m.floats },
                                 colors: m.colors || {}, defaults };
        lib.program(shader, 0, this.materials[name].keywords);         // compile up front
      }
    };
    add(this.lib, this.doc.materials, this.doc.materialKeywords);
    if (this.fonts) add(this.fontLib, this.fonts.materials, this.fonts.materialKeywords);
    this.buf = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
  }

  dispose() {
    const gl = this.gl;
    if (!gl || !this.buf) return;
    for (const t of Object.values(this.tex)) gl.deleteTexture(t.glTexture);
    for (const t of Object.values(this.solid)) gl.deleteTexture(t.glTexture);
    gl.deleteVertexArray(this.buf.vao); gl.deleteBuffer(this.buf.vbo); gl.deleteBuffer(this.buf.ibo);
    this.buf = null;
  }

  // ------------------------------------------------------------ geometry
  imageItem(n, alpha, refPPU) {
    const img = n.image, sp = img.spriteObj;
    let mesh = UIImage.build(n, img, sp, refPPU);
    if (n.gradient) mesh = UIGradientMod.apply(mesh, n.gradient);
    return { doc: this, node: n, kind: "image", material: img.material, texture: sp && this.tex ? this.tex[sp.texture.name] : null,
             verts: UIDraw.pack(mesh.verts, n, alpha), idx: Uint32Array.from(mesh.idx) };
  }

  // RawImage.OnPopulateMesh: a quad over GetPixelAdjustedRect with the uvRect's corners and the colour
  rawImageItem(n, alpha) {
    const ri = n.rawImage, r = n.rect, uv = ri.m_UVRect || { x: 0, y: 0, width: 1, height: 1 };
    const mesh = new UIMesh(), c = uiColor32(ri.color || ri.m_Color);
    mesh.addQuad(r.x, r.y, r.x + r.w, r.y + r.h, c, uv.x, uv.y, uv.x + uv.width, uv.y + uv.height);
    const texture = ri.texture || (ri.textureName && this.tex ? this.tex[ri.textureName] : null);
    return { doc: this, node: n, kind: "image", material: ri.material, texture,
             verts: UIDraw.pack(mesh.verts, n, alpha), idx: Uint32Array.from(mesh.idx) };
  }

  textItems(n, alpha) {
    const t = n.text;
    return t.meshes().map((m) => ({ doc: this, node: n, kind: "text", material: t.materialName, texture: this.tex ? this.tex[m.texture] : null,
                                    verts: UIDraw.pack(m.verts, n, alpha, true), idx: Uint32Array.from(m.idx) }));
  }

  draw(it, globals) {
    const mat = this.materials[it.material];
    if (!mat) throw new UIError(`${it.node.path}: material ${it.material} not loaded`);
    const tex = it.texture || this.solid.white;
    const sheet = it.kind === "text"
      ? { _MainTex: tex, _TextureWidth: tex.width, _TextureHeight: tex.height }
      : { _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0], _ClipRect: [-32767, -32767, 32767, 32767] };
    UIDraw.draw(this.gl, mat.lib, this.buf, mat, sheet, globals, it.verts, it.idx);
  }

  // Animators of active nodes (Normal update mode: scaled delta x Animator.speed)
  animate(dt) { for (const a of this.animators) if (a.node.activeInHierarchy) a.update(dt); }
}

// GameObjectExtension.SetActiveFast: no-op when activeSelf already equals v; a subtree that becomes active restarts its
// Animators (keepAnimatorStateOnDisable false); on disable a running DOTweenSequence (_killOnDisable) is killed
export const setActive = (node, v) => {
  if (!node || node.activeSelf === v) return;
  const before = node.activeInHierarchy;
  node.activeSelf = v;
  const after = node.activeInHierarchy;
  if (before === after) return;
  const walk = (n) => {
    if (!n.activeSelf) return;
    if (after && n.animator) n.animator.reset();
    if (!after && n.sequence) { n.sequence.kill(); n.sequence = null; }
    for (const c of n.children) walk(c);
  };
  walk(node);
};

// Moves `node` under `parent` as its last child (Transform.SetParent(parent, false) + SetAsLastSibling), or to index i
export const reparent = (node, parent, i = null) => {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = parent;
  if (i === null || i >= parent.children.length) parent.children.push(node); else parent.children.splice(i, 0, node);
};

export const setLastSibling = (node) => reparent(node, node.parent);

// One root canvas (a ScreenSpace-Camera canvas with a CanvasScaler) and the node tree under it: layout with the
// document elements of each node, draw in hierarchy order.
export class SimpleCanvas {
  constructor(root, scaler) {
    if (!scaler || !scaler.m_Enabled || scaler.m_UiScaleMode !== 1)
      throw new UIError(`${root.path}: CanvasScaler is not ScaleWithScreenSize`);
    this.root = root; this.scaler = scaler;
    this.refPPU = scaler.m_ReferencePixelsPerUnit || 100;
    this.beforeLayout = null;                                           // (W, H) -> void, fitters run by the owner
  }

  // CanvasScaler.HandleScaleWithScreenSize: Expand (1) min of the ratios, MatchWidthOrHeight (0) log-lerp by
  // m_MatchWidthOrHeight, Shrink (2) max
  canvasSize(width, height) {
    const s = this.scaler, ref = s.m_ReferenceResolution;
    if (s.m_ScreenMatchMode === 1) return uiCanvasSize(s, width, height);
    let scale;
    if (s.m_ScreenMatchMode === 0) {
      const lw = Math.log2(width / ref.x), lh = Math.log2(height / ref.y);
      scale = 2 ** (lw + (lh - lw) * s.m_MatchWidthOrHeight);
    } else if (s.m_ScreenMatchMode === 2) scale = Math.max(width / ref.x, height / ref.y);
    else throw new UIError(`${this.root.path}: screen match mode ${s.m_ScreenMatchMode}`);
    return { W: width / scale, H: height / scale, scale };
  }

  layout(width, height) {
    const { W, H } = this.canvasSize(width, height);
    this.size = { W, H };
    if (this.beforeLayout) this.beforeLayout(W, H);
    UILayout.layoutRoot(this.root, W, H, (n) => UILayout.rebuildHorizontal(n, (x) => this._elements(x)));
    return this.size;
  }

  _elements(n) {
    return UILayout.elements(n, this.refPPU, (x) => (x.text && x.text.enabled
      ? [{ priority: 0, minWidth: 0, preferredWidth: x.text.preferredWidth(), flexibleWidth: -1 }] : []));
  }

  // paint order and inherited alpha (UIDraw.list): an image (or raw image) before the text of the same node
  drawList() {
    return UIDraw.list(this.root, (n, alpha) => {
      const out = [];
      if (n.image && n.image.m_Enabled && !n.noDraw) out.push(n.doc.imageItem(n, alpha, this.refPPU));
      // a RawImage without a texture draws nothing here (the slot images before their first capture)
      if (n.rawImage && n.rawImage.m_Enabled !== 0 && (n.rawImage.texture || n.rawImage.textureName) && !n.noDraw)
        out.push(n.doc.rawImageItem(n, alpha));
      if (n.text && n.text.enabled) out.push(...n.doc.textItems(n, alpha));
      return out;
    });
  }

  // draws onto the bound target (width x height pixels); zTest 4: a camera canvas
  render(gl, width, height) {
    this.layout(width, height);
    if (!gl) return;
    const globals = UIDraw.globals(this.size.W, this.size.H, width, height, 4);
    gl.disable(gl.SCISSOR_TEST);
    for (const it of this.drawList()) it.doc.draw(it, globals);
  }
}
