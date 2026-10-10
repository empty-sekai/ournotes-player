import { F } from "../engine/core.js";
import { UnityProgram, applyState } from "../engine/glsl.js";
import { mat4 } from "../engine/math.js";
import { GLTex } from "../engine/texture.js";
import { UIAffine, UIDraw, UIError, UIImage, UINode, UISprite, UI_ATTRIBS, UI_STRIDE, uiCanvasSize } from "../engine/ugui.js";
import { TMPText } from "../engine/uitext.js";
import { StoryCommandError } from "./interfaces.js";
import { StoryLayout } from "./ui-layout.js";
import { StoryText } from "./ui-ruby.js";

// The phone of the chat rows as uGUI: UIAdvChatWidget's ChatCanvas (Screen Space - Camera on the ADV camera,
// CanvasScaler ScaleWithScreenSize / Expand) with AdvChatView and its Target, and the AdvChatWindow prefab instances
// (chat.json `windows`) attached under Target, laid out and drawn like the other story canvases: RectTransforms and
// the auto layout (ui-layout.js), Image meshes (engine/ugui.js), TextMesh Pro text (engine/uitext.js) with the chat
// windows' text bindings (ui/fonts.json `chatTexts`), CanvasGroup, CanvasRenderer alpha, the stencil Mask, the
// ScrollRect content position and Soft Mask for uGUI's SoftMask / SoftMaskable. features/chat.js drives it as
// AdvChatView does.
//
// Prefab records: {path, name, active, localPosition, localRotation, localScale, rect, components}, components with
// `type` (engine) or `class` (MonoBehaviour), in hierarchy order.

export const compOf = (rec, cls) => (rec.components || []).find((c) => (c.class || c.type) === cls) || null;

const LANGUAGE_ENGLISH = 1;                  // Fwk.Localization.LanguageMode.English
// components of the chat window prefabs that draw nothing and change no layout here
const PASSIVE = new Set(["CanvasRenderer", "UIText", "LocalizeText", "GraphicColorSynchronizer", "AdvChatWindow", "AdvMyChatNode",
                         "AdvOtherChatNode", "CanvasGroup", "ContentSizeFitter", "LayoutElement", "HorizontalLayoutGroup",
                         "VerticalLayoutGroup", "Image", "Mask", "SoftMask", "SoftMaskable", "ScrollRect", "TextMeshProUGUI"]);

// ------------------------------------------------------------------------------------------------ sprites
// A sprite of the chat data (the inline sprite records of chat.json: {sprite, rect, border, pixelsToUnits, pivot,
// textureRect, textureRectOffset, settingsRaw, texture: {texture, width, height, settings}}).
// ENGINE: Sprites.DataUtility.GetInnerUV is native; for a tight-packed (trimmed) sprite the inner rect is taken as the
// border measured from the sprite rect's origin in the texture (textureRect.position - textureRectOffset), which is
// the untrimmed formula of UISprite when nothing is trimmed.
export const chatSprite = (s) => {
  const tex = s.texture;
  if (!tex || !tex.texture) throw new UIError(`sprite ${s.sprite}: no texture`);
  if (s.downscaleMultiplier !== undefined && s.downscaleMultiplier !== 1) throw new UIError(`sprite ${s.sprite}: atlas variant scale`);
  if (((s.settingsRaw | 0) >> 2) & 15) throw new UIError(`sprite ${s.sprite}: packing rotation not implemented`);
  const sp = new UISprite(s.sprite, { rect: s.rect, border: s.border, pixelsPerUnit: s.pixelsToUnits, pivot: s.pivot,
                                      textureRect: s.textureRect, textureRectOffset: s.textureRectOffset },
                          { width: tex.width, height: tex.height, name: tex.texture });
  if (sp.trimmed && sp.hasBorder) {
    const tr = s.textureRect, off = s.textureRectOffset, b = s.border, W = tex.width, H = tex.height;
    const ox = tr.x - off.x, oy = tr.y - off.y;
    sp.inner = [(ox + b.x) / W, (oy + b.y) / H, (ox + s.rect.width - b.z) / W, (oy + s.rect.height - b.w) / H];
  }
  sp.desc = tex;
  return sp;
};

// ------------------------------------------------------------------------------------------------ nodes
// One RectTransform of a chat window (or of the widget) with the uGUI parts it uses. `src` = the node's path in its
// prefab (the key of its text binding and of the prefab's references); clones keep the template's. host: {sprite(rec),
// binding(src), textHost, languageMode, requireTexts, visual}; `visual` false: the objects only (no sprites, texts or
// component checks), for a session without the chat layout data.
export class ChatUINode extends UINode {
  constructor(rec, parent, host, src = rec.path) {
    super({ ...rec, canvasGroup: compOf(rec, "CanvasGroup") }, parent);
    this.src = src;
    this.raw = rec;
    this.rendererAlpha = 1;                                // CanvasRenderer.GetAlpha (SetAlpha on the read label)
    const lg = compOf(rec, "HorizontalLayoutGroup") || compOf(rec, "VerticalLayoutGroup");
    const lgClass = lg ? (compOf(rec, "HorizontalLayoutGroup") ? "HorizontalLayoutGroup" : "VerticalLayoutGroup") : null;
    const le = compOf(rec, "LayoutElement"), csf = compOf(rec, "ContentSizeFitter");
    // the node record the auto layout reads (layout group / element present, enabled or not)
    this.rec = { ...rec, layoutGroup: lg ? { ...lg, class: lgClass } : undefined, layoutElement: le || undefined };
    if (lg && lg.m_Enabled) this.layoutGroup = { ...lg, class: lgClass, m_Padding: { ...lg.m_Padding } };
    if (le && le.m_Enabled) this.layoutElement = { ...le };
    if (csf && csf.m_Enabled) this.contentSizeFitter = csf;
    if (host.visual === false) return;
    for (const c of rec.components || []) {
      const cls = c.class || c.type;
      if (!PASSIVE.has(cls) && c.m_Enabled !== 0) throw new UIError(`${rec.path}: ${cls} not implemented`);
    }
    const im = compOf(rec, "Image");
    if (im) {
      if (im.m_Material) throw new UIError(`${rec.path}: custom Image material not implemented`);
      this.image = { m_Enabled: !!im.m_Enabled, m_Color: { ...im.m_Color }, m_Type: im.m_Type, m_PreserveAspect: im.m_PreserveAspect,
                     m_FillCenter: im.m_FillCenter, m_PixelsPerUnitMultiplier: im.m_PixelsPerUnitMultiplier,
                     m_UseSpriteMesh: im.m_UseSpriteMesh, spriteObj: im.m_Sprite ? host.sprite(im.m_Sprite) : null };
    }
    const mask = compOf(rec, "Mask");
    if (mask && mask.m_Enabled) this.mask = { showGraphic: !!mask.m_ShowMaskGraphic };
    const soft = compOf(rec, "SoftMask");
    if (soft && soft.m_Enabled) {
      const w = soft._channelWeights;
      if (soft._source !== 0 || soft._separateMask) throw new UIError(`${rec.path}: SoftMask source other than its Graphic not implemented`);
      this.softMask = { weights: [w.r, w.g, w.b, w.a], invertMask: !!soft._invertMask, invertOutsides: !!soft._invertOutsides };
    }
    const sm = compOf(rec, "SoftMaskable");
    if (sm && sm.m_Enabled) this.softMaskable = true;
    const sr = compOf(rec, "ScrollRect");
    if (sr && sr.m_Enabled) this.scrollRect = sr;
    const tmp = compOf(rec, "TextMeshProUGUI");
    if (tmp) {
      const b = host.binding(src);
      if (b) {
        this.text = new TMPText(host.textHost, this, b);
        this.text.enabled = !!b.enabled;
        // LocalizeText.OnFontChanged, English only: word wrapping on unless the object's name contains "nowrap"
        const loc = compOf(rec, "LocalizeText");
        if (loc && loc.m_Enabled && loc._localizeEnabled && host.languageMode === LANGUAGE_ENGLISH &&
            !this.name.toLowerCase().includes("nowrap")) this.text.setWrapping(1);
        // UIText.Awake: LocalizeManager's emoji sprite asset (UIText.SetText: CombineEmojiSequences)
        this.storyText = new StoryText(this.text, b, host.textHost ? host.textHost.emojiSpriteAsset || null : null);
        this.pendingText = b.m_text ?? "";                   // the serialized text, laid out as is when first used
      } else if (host.requireTexts) throw new StoryCommandError(`${src}: no text binding for the chat window text`);
    }
  }

  // UIText.SetText
  setText(s) { this.pendingText = undefined; this.textSource = s; this.storyText.setText(s); }

  // the enabled text component, its serialized text (TMP_Text.m_text, no text setter) applied on first use
  liveText() {
    const t = this.text;
    if (!t || !t.enabled) return null;
    if (this.pendingText !== undefined) {
      const s = this.pendingText;
      this.pendingText = undefined;
      this.textSource = s;
      try { t.setText(s); this.storyText.text = s; } catch (e) {
        if (e instanceof UIError) throw new StoryCommandError(`${this.src}: its serialized text cannot be laid out (${e.message})`);
        throw e;
      }
    }
    return t;
  }

  // Transform.SetParent(parent, false) + SetAsLastSibling
  setParentLast(parent) {
    if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); }
    this.parent = parent;
    if (parent) parent.children.push(this);
  }

  setAsLastSibling() {
    const s = this.parent.children;
    s.splice(s.indexOf(this), 1); s.push(this);
  }
}

// The nodes of a prefab record list (hierarchy order) under `parent`: {root, nodes (Map path -> node), bySrc}.
// `rename(rec)` gives a clone its own path.
export const buildChatNodes = (records, parent, host, rename = null) => {
  const nodes = new Map(), bySrc = new Map();
  let root = null;
  for (const rec of records) {
    const path = rename ? rename(rec.path) : rec.path;
    const cut = path.lastIndexOf("/");
    const p = root ? nodes.get(path.slice(0, cut)) : parent;
    if (root && !p) throw new UIError(`${rec.path}: parent not in the prefab`);
    if (!rec.rect) throw new UIError(`${rec.path}: no RectTransform`);
    const n = new ChatUINode({ ...rec, path }, p, host, rec.path);
    nodes.set(path, n); bySrc.set(rec.path, n);
    if (!root) root = n;
  }
  return { root, nodes, bySrc };
};

// Object.Instantiate(template, parent): a copy of the template's subtree as the last child of `parent`, built from its
// prefab records and given the template's current state (object activity, CanvasRenderer alpha, RectTransform
// position and size, Image, text). `copy.root.lookup` resolves the prefab paths of the template's references in the copy.
let cloneCount = 0;
export const cloneChatNode = (template, records, parent, host) => {
  const base = template.src, sub = records.filter((r) => r.path === base || r.path.startsWith(`${base}/`));
  const prefix = `${parent.path}/${template.name}(Clone)#${++cloneCount}`;
  const copy = buildChatNodes(sub, parent, host, (p) => prefix + p.slice(base.length));
  copy.root.name = `${template.name}(Clone)`;
  copyState(template, copy.root);
  copy.root.lookup = copy.bySrc;
  return copy;
};
const copyState = (s, c) => {
  if (s.children.length !== c.children.length) throw new UIError(`${s.path}: the copy's hierarchy differs from its template`);
  c.activeSelf = s.activeSelf; c.rendererAlpha = s.rendererAlpha;
  c.anchoredPosition = { ...s.anchoredPosition }; c.sizeDelta = { ...s.sizeDelta };
  if (s.image) c.image = { ...s.image, m_Color: { ...s.image.m_Color } };
  if (s.layoutGroup) c.layoutGroup = { ...s.layoutGroup, m_Padding: { ...s.layoutGroup.m_Padding } };
  if (s.layoutElement) c.layoutElement = { ...s.layoutElement };
  if (s.text && c.text) {
    if (s.pendingText !== undefined) c.pendingText = s.pendingText;
    else c.setText(s.textSource);
    c.text.setMaxVisible(s.text.maxVisibleCharacters);
  }
  s.children.forEach((k, i) => copyState(k, c.children[i]));
};

export const isUnder = (n, p) => { for (let x = n.parent; x; x = x.parent) if (x === p) return true; return false; };

// ------------------------------------------------------------------------------------------------ ScrollRect
// UnityEngine.UI.ScrollRect of the chat timelines: vertical only, Clamped, no scrollbars, never dragged (velocity 0).
// Bounds are the viewport rect and the content rect in viewport space; content smaller than the view counts as the
// view's size around its pivot (AdjustBounds). layout() = Canvas.ForceUpdateCanvases (the auto layout, now).
// ENGINE: the uGUI ScrollRect (UpdateBounds, normalizedPosition, SetNormalizedPosition, LateUpdate / CalculateOffset).
export class ChatScrollRect {
  constructor(scroll, content, viewport, layout) {
    const s = scroll.scrollRect;
    if (s.m_Horizontal || !s.m_Vertical || s.m_MovementType !== 2 || s.m_HorizontalScrollbar || s.m_VerticalScrollbar)
      throw new UIError(`${scroll.path}: ScrollRect settings outside the implemented subset`);
    this.node = scroll; this.content = content; this.viewport = viewport; this.layout = layout;
  }

  // UpdateBounds: {view: [min, max], content: [min, max]} along y in viewport space
  bounds() {
    const v = this.viewport, c = this.content, r = v.rect;
    const inv = invAffine(v.matrix), m = UIAffine.mul(inv, c.matrix), cr = c.rect;
    const ys = [[cr.x, cr.y], [cr.x, cr.y + cr.h], [cr.x + cr.w, cr.y + cr.h], [cr.x + cr.w, cr.y]].map(([x, y]) => UIAffine.apply(m, x, y)[1]);
    let min = Math.min(...ys), max = Math.max(...ys);
    const vmin = r.y, vmax = F(r.y + r.h);
    let size = F(max - min), center = F(F(min + max) * 0.5);
    const excess = F(r.h - size);
    if (excess > 0) { center = F(center - F(excess * F(c.pivot.y - 0.5))); size = r.h; }
    min = F(center - F(size * 0.5)); max = F(center + F(size * 0.5));
    return { vmin, vmax, vsize: r.h, cmin: min, cmax: max, csize: size };
  }

  // verticalNormalizedPosition (getter: UpdateBounds on the current layout)
  get normalized() {
    this.layout();
    const b = this.bounds();
    if (b.csize <= b.vsize || approximately(b.csize, b.vsize)) return b.vmin > b.cmin ? 1 : 0;
    return F(F(b.vmin - b.cmin) / F(b.csize - b.vsize));
  }

  // SetNormalizedPosition(value, 1): EnsureLayoutHasRebuilt, then the content moved when the change exceeds 0.01
  set normalized(value) {
    this.layout();
    const b = this.bounds();
    const hidden = F(b.csize - b.vsize), minPos = F(b.vmin - F(value * hidden));
    const y = this.content.anchoredPosition.y, next = F(F(y + minPos) - b.cmin);
    if (Math.abs(y - next) > 0.01) this.content.anchoredPosition.y = next;
  }

  // LateUpdate with no velocity: CalculateOffset(0) moves a content outside the Clamped range back
  lateUpdate() {
    if (!this.node.activeInHierarchy) return;
    this.layout();
    const b = this.bounds();
    let off = 0;
    if (b.cmax < b.vmax) off = F(b.vmax - b.cmax);
    else if (b.cmin > b.vmin) off = F(b.vmin - b.cmin);
    if (off !== 0) this.content.anchoredPosition.y = F(this.content.anchoredPosition.y + off);
  }
}
const approximately = (a, b) => Math.abs(b - a) < Math.max(F(1e-6 * Math.max(Math.abs(a), Math.abs(b))), F(1.401298464324817e-45 * 8));
export const invAffine = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};

// ------------------------------------------------------------------------------------------------ stencil
// Mask.GetModifiedMaterial / MaskableGraphic.GetModifiedMaterial / TMP (StencilMaterial.Add): the stencil state of a
// graphic at mask depth d (the enabled Masks with an active graphic above it, up to the canvas), for its own mask when it
// has one. Values: {ref, comp (CompareFunction), op (StencilOp), read, write, colorMask, alphaClip}.
export const STENCIL_NONE = Object.freeze({ ref: 0, comp: 8, op: 0, read: 255, write: 255, colorMask: 15, alphaClip: false });
export const maskedStencil = (d) => (d > 0 ? { ref: (1 << d) - 1, comp: 3, op: 0, read: (1 << d) - 1, write: 0, colorMask: 15, alphaClip: false } : STENCIL_NONE);
export const maskStencil = (d, showGraphic) => {
  const bit = 1 << d, cm = showGraphic ? 15 : 0;
  if (bit === 1) return { push: { ref: 1, comp: 8, op: 2, read: 255, write: 255, colorMask: cm, alphaClip: true },
                          pop: { ref: 1, comp: 8, op: 1, read: 255, write: 255, colorMask: 0, alphaClip: true } };
  return { push: { ref: bit | (bit - 1), comp: 3, op: 2, read: bit - 1, write: bit | (bit - 1), colorMask: cm, alphaClip: true },
           pop: { ref: bit - 1, comp: 3, op: 2, read: bit - 1, write: bit | (bit - 1), colorMask: 0, alphaClip: true } };
};
const stencilFloats = (s) => ({ _Stencil: s.ref, _StencilComp: s.comp, _StencilOp: s.op, _StencilReadMask: s.read,
                                _StencilWriteMask: s.write, _ColorMask: s.colorMask, _UseUIAlphaClip: s.alphaClip ? 1 : 0 });

// ------------------------------------------------------------------------------------------------ Soft Mask
// The shader of Soft Mask for uGUI's SoftMaskable graphics over UI/Default (premultiplied alpha): the UI/Default
// fragment (vertex colour with its alpha rounded to 1/255, times the texture plus _TextureSampleAdd), its alpha
// multiplied by the mask, then premultiplied. The mask: the mask graphic's sprite sampled at the fragment's position in
// the mask's local space, mapped to the sprite's uv piecewise linearly (Simple: rect -> outer uv; Sliced: rect, border,
// border, rect -> outer, inner, inner, outer, per axis), weighted by the channel weights, inverted when set, 1 or 0
// outside the rect by invertOutsides.
const SOFT_MASK_SRC = `#ifdef VERTEX
#version 300 es
uniform vec4 hlslcc_mtx4x4unity_ObjectToWorld[4];
uniform vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform vec4 hlslcc_mtx4x4_SoftMask_WorldToMask[4];
uniform mediump vec4 _Color;
uniform vec4 _MainTex_ST;
in highp vec4 in_POSITION0;
in highp vec4 in_COLOR0;
in highp vec2 in_TEXCOORD0;
out mediump vec4 vs_COLOR0;
out highp vec2 vs_TEXCOORD0;
out highp vec2 vs_MASK;
void main() {
  vec4 w = hlslcc_mtx4x4unity_ObjectToWorld[0] * in_POSITION0.x + hlslcc_mtx4x4unity_ObjectToWorld[1] * in_POSITION0.y
         + hlslcc_mtx4x4unity_ObjectToWorld[2] * in_POSITION0.z + hlslcc_mtx4x4unity_ObjectToWorld[3];
  gl_Position = hlslcc_mtx4x4unity_MatrixVP[0] * w.x + hlslcc_mtx4x4unity_MatrixVP[1] * w.y
              + hlslcc_mtx4x4unity_MatrixVP[2] * w.z + hlslcc_mtx4x4unity_MatrixVP[3] * w.w;
  vs_COLOR0 = in_COLOR0 * _Color;
  vs_TEXCOORD0 = in_TEXCOORD0 * _MainTex_ST.xy + _MainTex_ST.zw;
  vec4 m = hlslcc_mtx4x4_SoftMask_WorldToMask[0] * in_POSITION0.x + hlslcc_mtx4x4_SoftMask_WorldToMask[1] * in_POSITION0.y
         + hlslcc_mtx4x4_SoftMask_WorldToMask[2] * in_POSITION0.z + hlslcc_mtx4x4_SoftMask_WorldToMask[3];
  vs_MASK = m.xy;
}
#endif
#ifdef FRAGMENT
#version 300 es
precision highp float;
precision highp int;
uniform mediump vec4 _TextureSampleAdd;
uniform vec4 _SoftMask_Rect;
uniform vec4 _SoftMask_UVRect;
uniform vec4 _SoftMask_BorderRect;
uniform vec4 _SoftMask_UVBorderRect;
uniform vec4 _SoftMask_ChannelWeights;
uniform float _SoftMask_Sliced;
uniform float _SoftMask_InvertMask;
uniform float _SoftMask_InvertOutsides;
uniform mediump sampler2D _MainTex;
uniform mediump sampler2D _SoftMask;
in mediump vec4 vs_COLOR0;
in highp vec2 vs_TEXCOORD0;
in highp vec2 vs_MASK;
layout(location = 0) out mediump vec4 SV_Target0;
float seg(float a, float a1, float a2, float u1, float u2) {
  float w = a2 - a1;
  return mix(u1, u2, w != 0.0 ? (a - a1) / w : 0.0);
}
float axis(float a, float a1, float a2, float a3, float a4, float u1, float u2, float u3, float u4) {
  if (a >= a3 && a >= a2) return seg(a, a3, a4, u3, u4);
  if (a >= a2) return seg(a, a2, a3, u2, u3);
  return seg(a, a1, a2, u1, u2);
}
void main() {
  vec2 p = vs_MASK, uv;
  if (_SoftMask_Sliced > 0.5)
    uv = vec2(axis(p.x, _SoftMask_Rect.x, _SoftMask_BorderRect.x, _SoftMask_BorderRect.z, _SoftMask_Rect.z,
                   _SoftMask_UVRect.x, _SoftMask_UVBorderRect.x, _SoftMask_UVBorderRect.z, _SoftMask_UVRect.z),
              axis(p.y, _SoftMask_Rect.y, _SoftMask_BorderRect.y, _SoftMask_BorderRect.w, _SoftMask_Rect.w,
                   _SoftMask_UVRect.y, _SoftMask_UVBorderRect.y, _SoftMask_UVBorderRect.w, _SoftMask_UVRect.w));
  else
    uv = vec2(seg(p.x, _SoftMask_Rect.x, _SoftMask_Rect.z, _SoftMask_UVRect.x, _SoftMask_UVRect.z),
              seg(p.y, _SoftMask_Rect.y, _SoftMask_Rect.w, _SoftMask_UVRect.y, _SoftMask_UVRect.w));
  float m = dot(texture(_SoftMask, uv) * _SoftMask_ChannelWeights, vec4(1.0));
  float inside = step(_SoftMask_Rect.x, p.x) * step(_SoftMask_Rect.y, p.y) * step(p.x, _SoftMask_Rect.z) * step(p.y, _SoftMask_Rect.w);
  float mask = mix(_SoftMask_InvertOutsides, _SoftMask_InvertMask > 0.5 ? 1.0 - m : m, inside);
  mediump vec4 c = vs_COLOR0;
  c.w = roundEven(c.w * 255.0) * 0.00392156886;
  vec4 color = (texture(_MainTex, vs_TEXCOORD0) + _TextureSampleAdd) * c;
  color.w *= mask;
  SV_Target0 = vec4(color.xyz * color.w, color.w);
}
#endif
`;

// SoftMask.CalculateSpriteBased for a Graphic source (an Image with a sprite; Simple or Sliced by the Image type), in the
// mask node's local space: {rect, uvRect, border, uvBorder, sliced, texture}. A mask image without a sprite is a solid
// fill (the white texture over the rect).
export const softMaskParams = (maskNode, refPPU) => {
  const img = maskNode.image, r = maskNode.rect, sp = img ? img.spriteObj : null;
  const full = [r.x, r.y, F(r.x + r.w), F(r.y + r.h)];
  if (!sp) return { rect: full, uvRect: [0, 0, 1, 1], border: full, uvBorder: [0, 0, 1, 1], sliced: false, texture: null };
  if (img.m_Type !== 0 && img.m_Type !== 1) throw new UIError(`${maskNode.path}: SoftMask over image type ${img.m_Type} not implemented`);
  const pad = sp.padding, outer = sp.outer;
  if (img.m_Type === 0) {
    if (img.m_PreserveAspect) throw new UIError(`${maskNode.path}: SoftMask with preserveAspect not implemented`);
    const sw = sp.rect.width, sh = sp.rect.height, w = full[2] - full[0], h = full[3] - full[1];
    const rect = [full[0] + pad[0] / sw * w, full[1] + pad[1] / sh * h, full[2] - pad[2] / sw * w, full[3] - pad[3] / sh * h];
    return { rect, uvRect: outer, border: rect, uvBorder: outer, sliced: false, texture: sp.texture.name };
  }
  if (!sp.inner) throw new UIError(`${maskNode.path}: SoftMask sprite without inner uv`);
  const scale = refPPU / (sp.pixelsPerUnit * img.m_PixelsPerUnitMultiplier);
  const rect = [full[0] + pad[0] * scale, full[1] + pad[1] * scale, full[2] - pad[2] * scale, full[3] - pad[3] * scale];
  const b = [sp.border.x * scale, sp.border.y * scale, sp.border.z * scale, sp.border.w * scale];
  const size = [full[2] - full[0], full[3] - full[1]];
  for (let axis = 0; axis <= 1; axis++) {                  // AdjustBorders (Image.GetAdjustedBorders)
    const sum = b[axis] + b[axis + 2];
    if (size[axis] < sum && sum !== 0) { const k = size[axis] / sum; b[axis] *= k; b[axis + 2] *= k; }
  }
  const border = [full[0] + b[0], full[1] + b[1], full[2] - b[2], full[3] - b[3]];
  return { rect, uvRect: outer, border, uvBorder: sp.inner, sliced: true, texture: sp.texture.name };
};

// ------------------------------------------------------------------------------------------------ the canvas
// UIAdvChatWidget's ChatCanvas with AdvChatView and Target (ui/ui.json `chatWidget`), the chat windows under Target.
// host: {textHost (fontAsset / material: the story UI), binding(window, src), languageMode}.
export class ChatCanvasUI {
  constructor(widget) {
    const byPath = new Map(widget.nodes.map((n) => [n.path, n]));
    const canvasRec = widget.nodes.find((n) => n.canvas);
    if (!canvasRec) throw new UIError("chatWidget: no canvas node");
    const c = canvasRec.canvas, s = canvasRec.canvasScaler;
    if (!c.m_Enabled || c.m_RenderMode !== 1 || c.m_PixelPerfect || c.m_OverrideSorting)
      throw new UIError("ChatCanvas: canvas settings outside the prefab values (Screen Space - Camera)");
    if (!s || !s.m_Enabled || s.m_UiScaleMode !== 1 || s.m_ScreenMatchMode !== 1)
      throw new UIError("ChatCanvas: CanvasScaler is not ScaleWithScreenSize / Expand");
    this.sortingOrder = c.m_SortingOrder; this.planeDistance = c.m_PlaneDistance; this.scaler = s;
    const viewRec = widget.nodes.find((n) => n.chatView);
    if (!viewRec) throw new UIError("chatWidget: no AdvChatView");
    this.chatView = viewRec.chatView;
    const targetPath = this.chatView._windowParentRect;
    const targetRec = byPath.get(targetPath);
    if (!targetRec) throw new UIError(`chatWidget: ${targetPath} (_windowParentRect) not in the data`);
    const host = { sprite: () => { throw new UIError("chatWidget: sprites not implemented"); }, binding: () => null };
    const plain = (rec) => ({ ...rec, components: [] });
    this.root = new ChatUINode(plain(canvasRec), null, host);
    this.view = new ChatUINode(plain(viewRec), this.root, host);
    if (targetRec.path.slice(0, targetRec.path.lastIndexOf("/")) !== viewRec.path) throw new UIError("chatWidget: Target is not a child of AdvChatView");
    this.target = new ChatUINode(plain(targetRec), this.view, host);
    const cg = targetRec.canvasGroup;
    this.target.canvasGroup = cg && cg.m_Enabled ? { alpha: cg.m_Alpha, ignoreParentGroups: !!cg.m_IgnoreParentGroups } : null;
    if (this.target.sizeDelta.x !== 0 || this.target.sizeDelta.y !== 0 || this.target.anchorMin.x !== this.target.anchorMax.x ||
        this.target.anchorMin.y !== this.target.anchorMax.y) throw new UIError("chatWidget: Target is not a point rect");
    this.refPPU = s.m_ReferencePixelsPerUnit;
    this.layoutEngine = new StoryLayout(this.refPPU, (n) => (n.liveText ? n.liveText() : null));
    this.size = null;
  }

  canvasSize(width, height) { return uiCanvasSize(this.scaler, width, height); }

  // Canvas.ForceUpdateCanvases: the RectTransforms and the auto layout of the whole canvas
  layout() {
    const { W, H } = this.size;
    this.layoutEngine.layoutRoot(this.root, W, H);
  }

  setSize(width, height) { const { W, H } = this.canvasSize(width, height); this.size = { W, H, width, height }; }

  // The draw items in canvas order: {node, kind ("image" | "text" | "sprite" | "soft"), stencil, verts, idx, texture, material,
  // soft (mask params)}; a Mask's own graphic draws with its push state, then its subtree, then the same mesh with its
  // pop state. Inherited alpha: CanvasGroups (UIDraw.list) times the node's CanvasRenderer alpha. `worldScale`: the
  // canvas' scale in world space (TMP's SDF scale uses the text's lossy scale).
  drawItems(worldScale = 1) {
    const out = [], refPPU = this.refPPU;
    const walk = (n, alpha, depth, softMask) => {
      if (!n.activeSelf) return;
      if (n.canvasGroup) alpha = n.canvasGroup.ignoreParentGroups ? n.canvasGroup.alpha : F(alpha * n.canvasGroup.alpha);
      const a = F(alpha * n.rendererAlpha);
      const masking = n.mask && n.image && n.image.m_Enabled;
      let pop = null;
      if (n.image && n.image.m_Enabled) {
        const mesh = UIImage.build(n, n.image, n.image.spriteObj, refPPU);
        const it = { node: n, kind: "image", verts: UIDraw.pack(mesh.verts, n, a), idx: Uint32Array.from(mesh.idx),
                     texture: n.image.spriteObj ? n.image.spriteObj.texture.name : null };
        if (masking) {
          const st = maskStencil(depth, n.mask.showGraphic);
          it.stencil = st.push;
          pop = { ...it, stencil: st.pop };
        } else it.stencil = maskedStencil(depth);
        if (n.softMaskable && softMask) { it.kind = "soft"; it.soft = softMask; }
        out.push(it);
      }
      const t = n.liveText();
      if (t) {
        const st = maskedStencil(depth), k = F(scaleOf(n) * worldScale);
        for (const m of t.meshes()) {
          const verts = UIDraw.pack(m.verts, n, a, true);
          for (let o = 10; o < verts.length; o += UI_STRIDE) verts[o] = F(verts[o] * k);
          out.push({ node: n, kind: m.kind === "sprite" ? "sprite" : "text", verts, idx: Uint32Array.from(m.idx), texture: m.texture,
                     material: m.material || t.materialName, stencil: st });
        }
      }
      const childSoft = n.softMask ? { node: n, params: softMaskParams(n, refPPU), weights: n.softMask.weights,
                                       invertMask: n.softMask.invertMask, invertOutsides: n.softMask.invertOutsides } : softMask;
      for (const c of n.children) walk(c, alpha, masking ? depth + 1 : depth, childSoft);
      if (pop) out.push(pop);
    };
    walk(this.root, 1, 0, null);
    return out.filter((it) => it.idx.length);
  }
}
// the canvas-relative scale of a node along its y axis (TMP's lossyScale.y below the canvas)
const scaleOf = (n) => Math.hypot(n.matrix[2], n.matrix[3]);

// ------------------------------------------------------------------------------------------------ GL
// The phone's draws onto the camera colour target: a framebuffer on the target's colour texture with a depth-stencil
// buffer of its own (cleared per draw; the canvas masks start from stencil 0), the UI shaders of the story UI (UI/Default,
// TextMesh Pro), the text materials and glyph pages of ui/fonts.json, the chat sprites' textures, the Soft Mask program.
// The canvas is drawn as the camera draws a Screen Space - Camera canvas: the canvas plane at the plane distance in front
// of the perspective camera, scaled to fill the view (UnityObjectToClipPos of the canvas vertices; TMP's SDF scale
// includes the text's world scale and its perspective filter).
export class ChatCanvasGL {
  constructor(gl, ui, assets) {
    this.gl = gl; this.ui = ui; this.assets = assets;
    this.tex = new Map(); this.buf = null; this.fbo = null; this.soft = null; this.mats = new Map();
  }

  async load(textures) {
    for (const [p, desc] of textures) if (!this.tex.has(p)) this.tex.set(p, await GLTex.load(this.gl, "", desc, this.assets));
    const gl = this.gl;
    this.buf = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
  }

  _texture(name) {
    const t = this.tex.get(name);
    if (!t) throw new UIError(`chat texture ${name} not loaded`);
    return t;
  }

  // a material of the story UI with the stencil state (UI/Default: the alpha clip variant for masks)
  _material(base, name, st) {
    const key = `${name}|${st.ref}|${st.comp}|${st.op}|${st.read}|${st.write}|${st.colorMask}|${st.alphaClip}`;
    let m = this.mats.get(key);
    if (!m) {
      const keywords = st.alphaClip ? [...new Set([...(base.keywords || []), "UNITY_UI_ALPHACLIP"])].sort() : base.keywords;
      m = { ...base, keywords, floats: { ...base.floats, ...stencilFloats(st) } };
      this.mats.set(key, m);
    }
    return m;
  }

  // the framebuffer drawing into the target's colour texture (a GLTarget), with our depth-stencil buffer
  _target(target) {
    const gl = this.gl, tex = target.glTexture, width = target.width, height = target.height;
    let f = this.fbo;
    if (!f || f.tex !== tex || f.w !== width || f.h !== height) {
      if (f) { gl.deleteFramebuffer(f.fb); gl.deleteRenderbuffer(f.depth); }
      const fb = gl.createFramebuffer(), depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new UIError("chat phone: framebuffer incomplete");
      f = this.fbo = { fb, depth, tex, w: width, h: height };
    }
    return f.fb;
  }

  // globals of the canvas under the camera: the canvas (W x H units, origin at its bottom-left corner) at `distance`
  // in front of a camera at the origin looking down -z with the vertical field of view `fov` (degrees)
  static globals(W, H, width, height, { fov, near, far, distance }) {
    const P = mat4.perspective(fov, width / height, near, far);
    const s = F(F(F(2 * distance) * F(Math.tan(fov * Math.PI / 360))) / H);
    const M = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, F(-s * W / 2), F(-s * H / 2), -distance, 1];
    const Mi = [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, -1 / s, 0, W / 2, H / 2, -distance / s, 1];
    return { unity_MatrixVP: P, glstate_matrix_projection: P, unity_ObjectToWorld: M, unity_WorldToObject: Mi,
             _WorldSpaceCameraPos: [0, 0, 0], _ScreenParams: [width, height, 1 + 1 / width, 1 + 1 / height],
             _UIMaskSoftnessX: 0, _UIMaskSoftnessY: 0, unity_GUIZTestMode: 4, worldScale: s, ...UIDraw.spriteGlobals() };
  }

  // the items onto `target` (the camera colour GLTarget, bound again afterwards)
  draw(items, globals, target) {
    const gl = this.gl, ui = this.ui, lib = ui.lib;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._target(target));
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true); gl.stencilMask(0xff);
    gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const base = ui.materials["Default UI Material"];
    if (!base) throw new UIError("chat phone: Default UI Material not loaded");
    for (const it of items) {
      if (it.kind === "soft") { this._drawSoft(it, globals); continue; }
      if (it.kind === "text" || it.kind === "sprite") {
        const mat = ui.materials[it.material];
        if (!mat) throw new UIError(`chat phone: text material ${it.material} not loaded`);
        const tex = ui.tex[it.texture];
        if (!tex) throw new UIError(`chat phone: text page ${it.texture} not loaded`);
        const sheet = it.kind === "sprite"                  // TextMeshPro/Sprite: the sprite page
          ? { _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0], _ClipRect: [-32767, -32767, 32767, 32767] }
          : { _MainTex: tex, _TextureWidth: tex.width, _TextureHeight: tex.height };
        UIDraw.draw(gl, lib, this.buf, this._material(mat, it.material, it.stencil), sheet, globals, it.verts, it.idx);
      } else {
        const tex = it.texture ? this._texture(it.texture) : ui.solid.white;
        UIDraw.draw(gl, lib, this.buf, this._material(base, "Default UI Material", it.stencil),
                    { _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0], _ClipRect: [-32767, -32767, 32767, 32767] },
                    globals, it.verts, it.idx);
      }
    }
    gl.disable(gl.STENCIL_TEST);
    target.bind();
  }

  _drawSoft(it, globals) {
    const gl = this.gl;
    if (!this.soft) {
      this.soft = new UnityProgram(gl, "Chat SoftMaskable UI/Default", SOFT_MASK_SRC);
    }
    const p = it.soft.params, m = invAffine(it.soft.node.matrix);
    const worldToMask = [m[0], m[1], 0, 0, m[2], m[3], 0, 0, 0, 0, 1, 0, m[4], m[5], 0, 1];
    const tex = it.texture ? this._texture(it.texture) : this.ui.solid.white;
    const maskTex = p.texture ? this._texture(p.texture) : this.ui.solid.white;
    const prog = this.soft;
    prog.apply([{ _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0], _Color: [1, 1, 1, 1], _SoftMask: maskTex,
                  _SoftMask_WorldToMask: worldToMask, _SoftMask_Rect: p.rect, _SoftMask_UVRect: p.uvRect,
                  _SoftMask_BorderRect: p.border, _SoftMask_UVBorderRect: p.uvBorder, _SoftMask_Sliced: p.sliced ? 1 : 0,
                  _SoftMask_ChannelWeights: it.soft.weights, _SoftMask_InvertMask: it.soft.invertMask ? 1 : 0,
                  _SoftMask_InvertOutsides: it.soft.invertOutsides ? 1 : 0 }, globals]);
    const st = it.stencil, ops = [st.comp, st.op, 0, 0];
    applyState(gl, { src: 1, dst: 10, srcA: 1, dstA: 10, op: 0, opA: 0, colMask: st.colorMask, zTest: 4, zWrite: 0, cull: 0,
                     offsetFactor: 0, offsetUnits: 0, stencilRef: st.ref, stencilRead: st.read, stencilWrite: st.write,
                     stencilFront: ops, stencilBack: ops });
    const buf = this.buf;
    gl.bindVertexArray(buf.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, it.verts, gl.STREAM_DRAW);
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
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, it.idx, gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, it.idx.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.tex.values()) gl.deleteTexture(t.glTexture);
    this.tex.clear();
    if (this.buf) { gl.deleteVertexArray(this.buf.vao); gl.deleteBuffer(this.buf.vbo); gl.deleteBuffer(this.buf.ibo); this.buf = null; }
    if (this.fbo) { gl.deleteFramebuffer(this.fbo.fb); gl.deleteRenderbuffer(this.fbo.depth); this.fbo = null; }
    if (this.soft && this.soft.program) gl.deleteProgram(this.soft.program);
    this.soft = null;
  }
}

