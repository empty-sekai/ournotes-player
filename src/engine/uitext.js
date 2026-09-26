import { F } from "./core.js";
import { Gradient } from "./anim.js";
import { UIError, UIMesh, uiColor32 } from "./ugui.js";

// TextMesh Pro text layout and vertex generation (TMPText) and Fwk.UI.UIGradientImage's mesh modifier
// (UIGradientMod), for the story's front canvas (story/ui.js) and any other uGUI canvas with TMP texts.
//
// TMP is reproduced as the layout engine only: the glyph metrics, the atlas pages and the distance-field materials come
// from the font asset a text is given, in TMP's own form (face info, character table, glyph table, atlas pages,
// material properties). The same code lays out and draws a text with the game's font assets or with font assets built
// from an open-source font; line breaks and widths follow whatever advances the asset has.
//
// TMP behaviour follows the game's build (TMP in uGUI 2.0, managed code) where it was read, else the TextMesh Pro
// reference sources (TMP_Text / TextMeshProUGUI: GenerateTextMesh, CalculatePreferredValues, ValidateHtmlTag,
// InsertNewLine, AdjustLineOffset, Save/RestoreWordWrappingState). Arithmetic is float32 in source order (the game's
// GenerateTextMesh has no fused multiply-add). Settings outside the implemented subset raise UIError.
//
// new TMPText(host, node, t): host = { fontAsset(name) -> font asset record (below), material(name) -> text material
// record {material, floats, colors, keywords} }; node = the UINode owning the text (its rect is laid out before
// generate()); t = the TMP text record (serialized TextMeshProUGUI fields) with `localized` = { fontAsset, material,
// lineSpacing } (LocalizeText.OnFontChanged: the font asset, material and line spacing of the current language).
// Font asset record: { name, faceInfo (TMP FaceInfo), normalStyle, normalSpacingOffset, boldStyle, boldSpacing,
// tabSize, characters {"<code point>": {glyph, scale}}, glyphs {"<index>": {metrics, rect, scale, atlasIndex,
// packed {texture, dx, dy}, runtime?}}, glyphPairAdjustmentRecords, glyphPairAdjustments?, textureSize {page: {width,
// height}}, lineBreaking? {leading, following, useModernHangulLineBreakingRules} (TMP_Settings) }.

// ------------------------------------------------------------------- Fwk.UI.UIGradientImage
// ModifyMesh -> CreateGradientMesh -> SetVertexColor. On the vertex stream (triangle list): project every vertex on
// dir = (cos a, sin a); when the gradient is axis aligned and _splitAtKeysWhenAxisAligned is set, triangles are cut at
// every key time (DivideCheck) so the vertex colours reproduce the piecewise-linear gradient exactly; then colour =
// Evaluate(s) (Overwrite) or Evaluate(s) * vertex colour (Multiply), s = clamp01((dot - min) / (max - min)).
// The cut here is an exact triangle / line split; the game's DivideCheck re-uses fixed stream slots per quad. Both put
// vertices on the key lines with linearly interpolated position and uv, so the rasterised colours agree; only the
// triangle order can differ (no overlap inside one image).
export const UIGradientMod = {
  apply(mesh, grad) {
    const rad = grad.angleDeg * Math.PI / 180, dir = [Math.cos(rad), Math.sin(rad)];
    const G = new Gradient(grad.gradient);
    let tri = mesh.stream();
    const dot = (v) => v.x * dir[0] + v.y * dir[1];
    let lo = Infinity, hi = -Infinity;
    for (const v of tri) { const d = dot(v); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    const aligned = Math.abs(dir[0]) < 1e-5 || Math.abs(dir[1]) < 1e-5;
    if (grad.splitAtKeysWhenAxisAligned && aligned && hi > lo)
      for (const t of G.keyTimes()) tri = UIGradientMod.split(tri, dot, lo + (hi - lo) * t);
    for (const v of tri) {
      const s = hi > lo ? Math.min(Math.max((dot(v) - lo) / (hi - lo), 0), 1) : 0;
      let c = G.evaluate(s);
      if (grad.blendMode === 1) c = c.map((x, j) => x * (v.c[j] / 255));
      else if (grad.blendMode !== 0) throw new UIError(`gradient blend mode ${grad.blendMode} not implemented`);
      v.c = uiColor32({ r: c[0], g: c[1], b: c[2], a: c[3] });
    }
    return UIMesh.fromStream(tri);
  },

  // cut each triangle of a triangle list by the line dot(p) = k (winding kept)
  split(tri, dot, k) {
    const out = [], eps = 1e-6;
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, u: a.u + (b.u - a.u) * t,
                                  v: a.v + (b.v - a.v) * t, c: a.c.map((x, j) => x + (b.c[j] - x) * t) });
    for (let i = 0; i < tri.length; i += 3) {
      const p = [tri[i], tri[i + 1], tri[i + 2]], d = p.map((v) => dot(v) - k);
      if (d.every((x) => x >= -eps) || d.every((x) => x <= eps)) { out.push(...p); continue; }
      let j = 0;                                     // the vertex alone on its side of the line
      for (; j < 3; j++) {
        const a = d[j], b = d[(j + 1) % 3], c = d[(j + 2) % 3];
        if (Math.abs(a) > eps && Math.sign(a) !== Math.sign(b) && Math.sign(a) !== Math.sign(c)) break;
      }
      if (j === 3) { out.push(...p); continue; }
      const A = p[j], B = p[(j + 1) % 3], C = p[(j + 2) % 3], dA = d[j], dB = d[(j + 1) % 3], dC = d[(j + 2) % 3];
      // an edge from A to a vertex lying on the line has its cut at that vertex
      const AB = Math.abs(dB) <= eps ? { ...B } : lerp(A, B, dA / (dA - dB));
      const AC = Math.abs(dC) <= eps ? { ...C } : lerp(A, C, dA / (dA - dC));
      out.push(A, AB, AC, AB, B, C, AB, C, AC);      // (A,B,C) -> (A,AB,AC) (AB,B,C) (AB,C,AC)
    }
    return out;
  },
};

// ------------------------------------------------------------------- TMP constants
// TMP_FontAsset.AddSynthesizedCharacter: control characters get a zero-metric glyph (index 0) when the font lacks them
export const TMP_SYNTHESIZED = new Set([0x03, 0x09, 0x0A, 0x0B, 0x0D, 0x061C, 0x200B, 0x200E, 0x200F, 0x2028, 0x2029, 0x2060]);
export const TMP_ZERO_GLYPH = { metrics: { m_Width: 0, m_Height: 0, m_HorizontalBearingX: 0, m_HorizontalBearingY: 0,
                                           m_HorizontalAdvance: 0 }, rect: { m_X: 0, m_Y: 0, m_Width: 0, m_Height: 0 }, scale: 1 };
export const TMP_KERN = 1801810542;                  // OTL_FeatureTag 'kern'
export const TMP_UNSUPPORTED_FEATURES = { 1835102827: "mark", 1835756907: "mkmk", 1818847073: "liga" };
export const TMP_IGNORE_SPACING = 0x100;             // FontFeatureLookupFlags.IgnoreSpacingAdjustments
export const TMP_H = { Left: 1, Center: 2, Right: 4, Justified: 8, Flush: 16, Geometry: 32 };
export const TMP_V = { Top: 256, Middle: 512, Bottom: 1024, Baseline: 2048, Geometry: 4096, Capline: 8192 };
export const TMP_WRAP = { NoWrap: 0, Normal: 1, PreserveWhitespace: 2, PreserveWhitespaceNoWrap: 3 };
export const TMP_LARGE = 32767;                      // TMP_Text.k_LargePositiveFloat
export const TMP_AUTOSIZE_MAX_ITERATIONS = 100;      // TMP_Text m_AutoSizeMaxIterationCount
export const TMP_AUTOSIZE_MIN_STEP = F(0.05);
export const TMP_AUTOSIZE_DONE = F(0.051);
export const TMP_BOUNDS_EPSILON = F(0.0001);
const HTML_TAG_MAX = 128;                            // TMP_Text.m_htmlTag length

// char.IsWhiteSpace for one UTF-16 unit / BMP code point
export const isWhiteSpace = (u) => (u >= 0x09 && u <= 0x0D) || u === 0x20 || u === 0x85 || u === 0xA0 || u === 0x1680 ||
  (u >= 0x2000 && u <= 0x200A) || u === 0x2028 || u === 0x2029 || u === 0x202F || u === 0x205F || u === 0x3000;

const isLineFeed = (u) => u === 10 || u === 11 || u === 0x2028 || u === 0x2029;
// TMP_Math.Approximately: (b - 0.0001) < a && a < (b + 0.0001)
const tmpApproximately = (a, b) => F(b - TMP_BOUNDS_EPSILON) < a && a < F(b + TMP_BOUNDS_EPSILON);

// TMP_TextParsingUtilities.IsCJK / IsHangul / IsBaseGlyph (closed ranges)
const inRanges = (u, rs) => rs.some(([a, b]) => u >= a && u <= b);
const CJK_RANGES = [[0x2E80, 0x2FDF], [0x2FF0, 0x2FFF], [0x3000, 0x303F], [0x3040, 0x30FF], [0x3100, 0x312F],
  [0x3190, 0x319F], [0x31A0, 0x31BF], [0x31C0, 0x31EF], [0x31F0, 0x31FF], [0x3400, 0x4DBF], [0x4E00, 0x9FFF],
  [0xF900, 0xFAFF], [0xFE10, 0xFE1F], [0xFE30, 0xFE6F], [0xFF65, 0xFF9F], [0x16FE0, 0x16FFF], [0x1AFF0, 0x1AFFF],
  [0x1B000, 0x1B12F], [0x1B130, 0x1B16F], [0x20000, 0x2A6DF], [0x2A700, 0x2EBE0], [0x2F800, 0x2FA1F],
  [0x30000, 0x3134A], [0x31350, 0x323AF]];
const HANGUL_RANGES = [[0x1100, 0x11FF], [0x3130, 0x318F], [0xA960, 0xA97F], [0xAC00, 0xD7AF], [0xD7B0, 0xD7FF],
  [0xFFA0, 0xFFDC]];
const NOT_BASE_RANGES = [[0x300, 0x36F], [0x591, 0x5BD], [0x610, 0x61A], [0x64B, 0x65F], [0x670, 0x670],
  [0x6D6, 0x6DC], [0x6DF, 0x6E4], [0x6E7, 0x6E8], [0x6EA, 0x6ED], [0x8D3, 0x8E1], [0x8E3, 0x8FF], [0xE31, 0xE31],
  [0xE34, 0xE3A], [0xE47, 0xE4E], [0x1AB0, 0x1AFF], [0x1DC0, 0x1DFF], [0x20D0, 0x20FF], [0xFBB2, 0xFBC1],
  [0xFE20, 0xFE2F]];
const NOT_BASE_HEBREW = new Set([0x5BF, 0x5C1, 0x5C2, 0x5C4, 0x5C5, 0x5C7]);
export const tmpIsCJK = (u) => inRanges(u, CJK_RANGES);
export const tmpIsHangul = (u) => inRanges(u, HANGUL_RANGES);
export const tmpIsBaseGlyph = (u) => !inRanges(u, NOT_BASE_RANGES) && !NOT_BASE_HEBREW.has(u);

// char.IsSeparator: Unicode categories Zs, Zl, Zp
const isSeparator = (u16) => /\p{Z}/u.test(String.fromCharCode(u16));

// ------------------------------------------------------------------- rich text
// TMP_Text.ValidateHtmlTag: the tag between '<' and the next '>' (no '<' inside, at most 128 characters). The tag
// name is hashed with ToUpperFast, i.e. matched case-insensitively (as are string values); a value is numerical (sign,
// digits, '.', then an optional unit 'px' / 'em' / '%'), a colour (#...) or a string (quotes stripped). A tag TMP does
// not know is no tag: its characters are text. Tags TMP knows but this port does not implement raise.
const TAGS_IMPLEMENTED = new Set(["color", "/color", "size", "/size", "voffset", "/voffset", "cspace", "/cspace",
  "align", "/align", "b", "/b", "nobr", "/nobr", "space", "pos", "rotate", "/rotate", "mark", "/mark"]);
const TAGS_KNOWN = new Set(["i", "u", "s", "sub", "sup", "font", "material", "sprite", "link", "indent",
  "line-indent", "line-height", "margin", "margin-left", "margin-right", "mspace", "width", "allcaps", "uppercase",
  "lowercase", "smallcaps", "gradient", "style", "noparse", "page", "action", "a", "font-weight", "alpha",
  "strikethrough", "underline", "zwsp", "zwj", "nbsp", "shy", "cr", "table", "tr", "th", "td", "dir"]);
const tagName = (s) => s.replace(/[a-z]/g, (c) => c.toUpperCase()).toLowerCase();

// TMP_Text.ConvertToFloat (float32 digit accumulation): integer digits value * 10 + d, decimals value + d * m with
// m = 0.1, 0.01, ... (m *= 0.1 in float)
export const tmpConvertToFloat = (s) => {
  let i = 0, sign = 1, value = 0, integer = true, mult = 0;
  if (s[0] === "+") i = 1; else if (s[0] === "-") { sign = -1; i = 1; }
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 46) { integer = false; mult = F(0.1); continue; }
    if (c < 48 || c > 57) break;
    const d = c - 48;
    if (integer) value = F(F(value * 10) + d * sign);
    else { value = F(value + F(F(d * mult) * sign)); mult = F(mult * F(0.1)); }
  }
  return value;
};

// one tag's content (between '<' and '>') -> {name, value: {kind: "number" | "color" | "string", text, unit}} or null
const parseTag = (body) => {
  if (body[0] === "#") return { name: "color", closing: false, value: { kind: "color", text: body } };
  const eq = body.indexOf("=");
  const rawName = (eq < 0 ? body : body.slice(0, eq)).split(" ")[0];
  const name = tagName(rawName);
  if (eq < 0) return { name, value: null };
  let v = body.slice(eq + 1);
  if (v[0] === "\"") { const end = v.indexOf("\"", 1); return { name, value: { kind: "string", text: v.slice(1, end < 0 ? v.length : end) } }; }
  if (v[0] === "#") return { name, value: { kind: "color", text: v.split(" ")[0] } };
  const m = /^[+\-.0-9][.0-9]*/.exec(v);
  if (m) {
    const rest = v.slice(m[0].length);
    const unit = rest[0] === "e" ? "em" : rest[0] === "%" ? "%" : "px";
    return { name, value: { kind: "number", text: m[0], unit } };
  }
  return { name, value: { kind: "string", text: v.split(" ")[0] } };
};

// TMP_Text.PopulateTextProcessingArray + the tag scan of GenerateTextMesh: text -> tokens [{c: code point} | {tag}].
// Surrogate pairs are one character; <br> is a line feed; with parseControlCharacters \n \r \t \v are control
// characters and \\ keeps the two characters after it.
export const tmpTokens = (text, { richText = true, parseCtrl = false } = {}) => {
  const cps = Array.from(text), out = [];
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (parseCtrl && ch === "\\" && i < cps.length - 1) {
      const n = cps[i + 1];
      const ctrl = { n: 10, r: 13, t: 9, v: 11 }[n];
      if (ctrl !== undefined) { out.push({ c: ctrl }); i++; continue; }
      if (n === "u" || n === "U") throw new UIError("escaped unicode characters in a text not implemented");
      if (n === "\\" && i + 2 < cps.length) { out.push({ c: 0x5C }, { c: cps[i + 2].codePointAt(0) }); i += 2; continue; }
    }
    if (richText && ch === "<") {
      let j = i + 1;
      while (j < cps.length && cps[j] !== ">" && cps[j] !== "<" && j - i - 1 < HTML_TAG_MAX) j++;
      if (j < cps.length && cps[j] === ">") {
        const body = cps.slice(i + 1, j).join("");
        const tag = parseTag(body);
        const key = tag.name;
        if (key === "br" && !tag.value) { out.push({ c: 10 }); i = j; continue; }
        // <mark> attributes (color=, padding=) are outside the implemented subset
        if (key === "mark" && /\s\S/.test(body.slice(4)))
          throw new UIError(`rich text tag <${body}> (mark attributes) not implemented`);
        if (TAGS_IMPLEMENTED.has(key)) { out.push({ tag, body }); i = j; continue; }
        if (TAGS_KNOWN.has(key.replace(/^\//, ""))) throw new UIError(`rich text tag <${body}> not implemented`);
      }
    }
    out.push({ c: ch.codePointAt(0) });
  }
  return out;
};

// TMP_Text.HexCharsToColor (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
export const tmpHexColor = (h) => {
  let x = h.slice(1);
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join("");
  if ((x.length !== 6 && x.length !== 8) || /[^0-9a-fA-F]/.test(x)) return null;
  const v = (k) => parseInt(x.slice(k, k + 2), 16);
  return [v(0), v(2), v(4), x.length === 8 ? v(6) : 255];
};

// TMP_Text.HexCharsToColor(char[], start, length) of the <mark> value: #RRGGBB (alpha 255) or #RRGGBBAA; any other
// length gives white. HexToInt maps '0'-'9', 'A'-'F', 'a'-'f' and gives 15 outside U+0030..U+0066 (the table's
// other entries in that range raise here).
export const tmpMarkColor = (h) => {
  if (h.length !== 7 && h.length !== 9) return [255, 255, 255, 255];
  const hex = (ch) => {
    const u = ch.charCodeAt(0);
    if (u >= 0x30 && u <= 0x39) return u - 0x30;
    if (u >= 0x41 && u <= 0x46) return u - 0x37;
    if (u >= 0x61 && u <= 0x66) return u - 0x57;
    if (u < 0x30 || u > 0x66) return 15;
    throw new UIError(`mark colour ${h}: digit ${ch} not implemented`);
  };
  const v = (k) => hex(h[k]) * 16 + hex(h[k + 1]);
  return [v(1), v(3), v(5), h.length === 9 ? v(7) : 255];
};

// The rich-text features of `text` this port cannot lay out (tag bodies, in order); [] when it can
export const tmpUnsupported = (text, opts) => {
  try { tmpTokens(text, opts); return []; } catch (e) {
    if (e instanceof UIError) return [e.message];
    throw e;
  }
};

// Style state of the tag stacks (GenerateTextMesh: m_currentFontSize / m_sizeStack, m_htmlColor / m_colorStack,
// m_FontStyleInternal / m_fontStyleStack, m_baselineOffset, m_cSpacing, m_lineJustification / m_lineJustificationStack,
// m_isNonBreakingSpace, m_FXMatrix, m_HighlightState / m_HighlightStateStack: default (m_htmlColor, no padding);
// markCount = the Highlight count of the font style stack).
const HIGHLIGHT_ZERO = Object.freeze({ l: 0, r: 0, t: 0, b: 0 });
const styleState = (fontSize, color, bold, align) => ({
  size: fontSize, sizeStack: [fontSize], color, colorStack: [color], boldCount: 0, baseBold: bold,
  baselineOffset: 0, cSpacing: 0, align, alignStack: [align], nobr: false, rotate: null,
  markCount: 0, hlState: { color: [255, 255, 255, 255], pad: HIGHLIGHT_ZERO }, hlStack: [{ color, pad: HIGHLIGHT_ZERO }],
});
const cloneStyle = (s) => ({ ...s, sizeStack: [...s.sizeStack], colorStack: [...s.colorStack], alignStack: [...s.alignStack],
                             hlStack: [...s.hlStack] });
// HighlightState ==: the colour bytes and the four padding floats
const sameHighlight = (a, b) => a === b || (a.color.every((v, k) => v === b.color[k]) &&
  a.pad.l === b.pad.l && a.pad.r === b.pad.r && a.pad.t === b.pad.t && a.pad.b === b.pad.b);
// Mathf-free min / max of the highlight bounds: a < b ? a : b and a > b ? a : b
const minF = (a, b) => (a < b ? a : b), maxF = (a, b) => (a > b ? a : b);
const isBold = (s) => s.baseBold || s.boldCount > 0;

export class TMPText {
  constructor(host, node, t) {
    const loc = t.localized;
    if (!loc) throw new UIError(`${node.path}: text without its localized font binding`);
    this.node = node;
    this.cls = t.class;
    this.font = host.fontAsset(loc.fontAsset);
    this.materialName = loc.material;
    this.material = host.material(loc.material);
    if (!this.material) throw new UIError(`${node.path}: material ${loc.material} not in the data`);
    this.fontSize = t.m_fontSize;
    this.autoSize = !!t.m_enableAutoSizing;
    this.fontSizeMin = t.m_fontSizeMin; this.fontSizeMax = t.m_fontSizeMax;
    this.fontSizeBase = t.m_fontSizeBase;
    this.lineSpacingMax = t.m_lineSpacingMax; this.charWidthMaxAdj = t.m_charWidthMaxAdj;
    if (this.autoSize && ![this.fontSizeBase, this.lineSpacingMax, this.charWidthMaxAdj].every((v) => typeof v === "number"))
      throw new UIError(`${node.path}: autosize fields missing`);
    this.style = t.m_fontStyle;
    if (this.style & ~1) throw new UIError(`${node.path}: font style ${this.style} not implemented`);
    this.bold = (this.style & 1) === 1;
    this.hAlign = t.m_HorizontalAlignment; this.vAlign = t.m_VerticalAlignment;
    this.characterSpacing = t.m_characterSpacing; this.wordSpacing = t.m_wordSpacing;
    this.lineSpacing = loc.lineSpacing;  // LocalizeManager.ApplyLanguageLineSpacing
    this.paragraphSpacing = t.m_paragraphSpacing;
    this.wrapping = t.m_TextWrappingMode; this.overflow = t.m_overflowMode;
    this.richText = !!t.m_isRichText; this.parseCtrl = !!t.m_parseCtrlCharacters;
    this.overrideHtmlColors = !!t.m_overrideHtmlColors;
    this.useMaxVisibleDescender = !!t.m_useMaxVisibleDescender;
    this.margin = t.m_margin;
    this.fontColor32 = uiColor32(t.m_fontColor);
    // GenerateTextMesh: kerning = m_ActiveFontFeatures.Contains('kern'), through the font asset's pair adjustment
    // lookup; mark / mkmk / ligature features are not implemented
    const features = t.m_ActiveFontFeatures || [];
    for (const f of features)
      if (TMP_UNSUPPORTED_FEATURES[f]) throw new UIError(`${node.path}: font feature ${TMP_UNSUPPORTED_FEATURES[f]} not implemented`);
    this.kerning = features.includes(TMP_KERN);
    this.pairs = null;
    if (this.kerning && this.font.glyphPairAdjustmentRecords) {
      this.pairs = this.font.glyphPairAdjustments;
      if (!this.pairs) throw new UIError(`${this.font.name}: glyph pair adjustment records missing`);
    }
    if (!t.m_isOrthographic) throw new UIError(`${node.path}: perspective text not implemented`);
    if (t.m_isRightToLeft || t.m_enableVertexGradient || t.m_characterHorizontalScale !== 1 ||
        t.m_horizontalMapping !== 0 || t.m_verticalMapping !== 0 || t.m_overflowMode !== 0)
      throw new UIError(`${node.path}: text settings outside the implemented subset`);
    if (![TMP_H.Left, TMP_H.Center, TMP_H.Right].includes(this.hAlign) ||
        ![TMP_V.Top, TMP_V.Middle, TMP_V.Bottom].includes(this.vAlign))
      throw new UIError(`${node.path}: alignment ${this.hAlign}/${this.vAlign} not implemented`);
    if (![0, 1].includes(this.wrapping)) throw new UIError(`${node.path}: wrapping mode ${this.wrapping} not implemented`);
    this.padding = TMPText.materialPadding(this.material, !!t.m_enableExtraPadding);
    this.text = "";
    this.tokens = [];
    this.elements = [];
    this.maxVisibleCharacters = 99999;    // TMP_Text default
    this.maxVisibleLines = 99999;
    this.dirty = true;
  }

  // TMP_Text.GetPaddingForMaterial -> ShaderUtilities.GetPadding(material, extraPadding, isBold). The material's
  // ScaleRatios are ShaderUtilities.UpdateShaderRatios values (_ScaleRatioA / _ScaleRatioC of the record).
  static materialPadding(mat, extraPadding) {
    const f = mat.floats, kw = mat.keywords || [];
    if (!("_GradientScale" in f)) throw new UIError(`${mat.material}: bitmap text material not implemented`);
    const A = f._ScaleRatioA, C = f._ScaleRatioC;
    const faceDilate = F((f._FaceDilate || 0) * A), softness = F((f._OutlineSoftness || 0) * A);
    const outline = F((f._OutlineWidth || 0) * A);
    let uniform = F(F(outline + softness) + faceDilate);
    if (kw.includes("GLOW_ON")) throw new UIError(`${mat.material}: glow padding not implemented`);
    uniform = Math.max(uniform, faceDilate);
    const pad = [0, 0, 0, 0];
    if (kw.includes("UNDERLAY_ON")) {
      const ox = F(f._UnderlayOffsetX * C), oy = F(f._UnderlayOffsetY * C);
      const d = F(f._UnderlayDilate * C), s = F(f._UnderlaySoftness * C), base = F(F(faceDilate + d) + s);
      pad[0] = Math.max(pad[0], F(base - ox)); pad[1] = Math.max(pad[1], F(base - oy));
      pad[2] = Math.max(pad[2], F(base + ox)); pad[3] = Math.max(pad[3], F(base + oy));
    }
    const extra = extraPadding ? 4 : 0;
    const p = pad.map((x) => Math.min(Math.max(x, uniform) + extra, 1) * f._GradientScale);
    return F(Math.max(...p) + 1.25);
  }

  setText(s) {
    if (s === this.text) return;
    this.text = s;
    this.tokens = tmpTokens(s, { richText: this.richText, parseCtrl: this.parseCtrl });
    this.elements = this.tokens.filter((k) => k.c !== undefined).map((k) => ({ u: k.c, ...this.glyphOf(k.c) }));
    this.dirty = true;
  }

  setMaxVisible(n) { if (n !== this.maxVisibleCharacters) { this.maxVisibleCharacters = n; this.dirty = true; } }

  // TMP_Text.set_margin
  setMargin(m) { this.margin = { x: m.x, y: m.y, z: m.z, w: m.w }; this.dirty = true; }

  // TMP_Text.set_color: the vertex colour (m_fontColor, converted to Color32 at mesh generation)
  setColor(c) { this.fontColor32 = uiColor32(c); this.dirty = true; }

  // TMP_Text.set_textWrappingMode (enableWordWrapping = true sets Normal). PreserveWhitespace(NoWrap) lay whitespace
  // out as visible characters: not implemented.
  setWrapping(mode) {
    if (![0, 1].includes(mode)) throw new UIError(`${this.node.path}: wrapping mode ${mode} not implemented`);
    if (mode !== this.wrapping) { this.wrapping = mode; this.dirty = true; }
  }

  // TMP_FontAsset character lookup of the text's font asset (fallback fonts are resolved by the data: every
  // character a text shows is in its asset) -> {g: glyph record, charScale, index: glyph index}
  glyphOf(u) {
    const f = this.font, c = f.characters[String(u)];
    if (c) {
      const g = f.glyphs[String(c.glyph)];
      if (!g) throw new UIError(`${f.name}: glyph ${c.glyph} of U+${u.toString(16).toUpperCase()} missing`);
      return { g, charScale: c.scale, index: c.glyph };
    }
    if (TMP_SYNTHESIZED.has(u)) return { g: TMP_ZERO_GLYPH, charScale: 1, index: 0 };
    throw new UIError(`${f.name}: U+${u.toString(16).toUpperCase()} not in the font data`);
  }

  // One rich-text tag on the style state s (ValidateHtmlTag, the tags this port implements). `at` = the layout
  // state for the tags that move the pen (<space>, <pos>, </cspace>): {xAdvance, chars, cc, marginWidth} or null.
  // -> false when TMP rejects the tag (its characters are then text)
  _tag(s, tok, fontSize, at) {
    const { name, value } = tok.tag;
    const num = () => (value && value.kind === "number" ? tmpConvertToFloat(value.text) : null);
    switch (name) {
      case "color": {
        const c = value && value.kind === "color" ? tmpHexColor(value.text) : null;
        if (!c) {
          if (value && value.kind === "string") throw new UIError(`${this.node.path}: named colour <${tok.body}> not implemented`);
          return false;
        }
        s.color = c; s.colorStack.push(c); return true;
      }
      case "/color": if (s.colorStack.length > 1) s.colorStack.pop(); s.color = s.colorStack[s.colorStack.length - 1]; return true;
      case "size": {
        const v = num();
        if (v === null) return false;
        if (value.unit === "px") {
          const sign = value.text[0];
          s.size = sign === "+" || sign === "-" ? F(fontSize + v) : v;
        } else if (value.unit === "em") s.size = F(fontSize * v);
        else s.size = F(F(fontSize * v) / 100);
        s.sizeStack.push(s.size); return true;
      }
      case "/size": if (s.sizeStack.length > 1) s.sizeStack.pop(); s.size = s.sizeStack[s.sizeStack.length - 1]; return true;
      case "voffset": {
        const v = num();
        if (v === null || value.unit === "%") return false;
        s.baselineOffset = value.unit === "em" ? F(F(v * 1) * s.size) : F(v * 1);
        return true;
      }
      case "/voffset": s.baselineOffset = 0; return true;
      case "cspace": {
        const v = num();
        if (v === null || value.unit === "%") return false;
        s.cSpacing = value.unit === "em" ? F(F(v * 1) * s.size) : F(v * 1);
        return true;
      }
      case "/cspace":
        // removes the extra space from the last character
        if (at && at.cc > 0) { at.xAdvance = F(at.xAdvance - s.cSpacing); at.chars[at.cc - 1].xAdvance = at.xAdvance; }
        s.cSpacing = 0; return true;
      case "align": {
        const a = { left: TMP_H.Left, right: TMP_H.Right, center: TMP_H.Center, justified: TMP_H.Justified,
                    flush: TMP_H.Flush }[value ? tagName(value.text) : ""];
        if (a === undefined) return false;
        s.align = a; s.alignStack.push(a); return true;
      }
      case "/align": if (s.alignStack.length > 1) s.alignStack.pop(); s.align = s.alignStack[s.alignStack.length - 1]; return true;
      case "b": s.boldCount++; return true;
      case "/b": if (!s.baseBold && s.boldCount > 0) s.boldCount--; return true;
      case "nobr": s.nobr = true; return true;
      case "/nobr": s.nobr = false; return true;
      case "space": {
        const v = num();
        if (v === null || value.unit === "%") return false;
        if (at) at.xAdvance = F(at.xAdvance + (value.unit === "em" ? F(F(v * 1) * s.size) : F(v * 1)));
        return true;
      }
      case "pos": {
        const v = num();
        if (v === null) return false;
        if (at) at.xAdvance = value.unit === "em" ? F(F(v * 1) * s.size) : value.unit === "%" ? F(F(at.marginWidth * v) / 100) : F(v * 1);
        return true;
      }
      case "rotate": { const v = num(); if (v === null) return false; s.rotate = v; return true; }
      case "/rotate": s.rotate = null; return true;
      // <mark>: Highlight style on, colour (255, 255, 0, 64) unless the value is a colour, alpha = min(the current
      // html colour's alpha, the mark's), no padding; the state is pushed. </mark> (the base style has no Highlight):
      // pop, the state below becomes current, Highlight off when its count reaches 0.
      case "mark": {
        const c = value && value.kind === "color" ? tmpMarkColor(value.text) : [255, 255, 0, 64];
        const hs = { color: [c[0], c[1], c[2], s.color[3] < c[3] ? s.color[3] : c[3]], pad: HIGHLIGHT_ZERO };
        s.markCount++; s.hlState = hs; s.hlStack.push(hs);
        return true;
      }
      case "/mark":
        if (s.hlStack.length > 1) s.hlStack.pop();
        s.hlState = s.hlStack[s.hlStack.length - 1];
        if (s.markCount > 0) s.markCount--;
        return true;
    }
    throw new UIError(`${this.node.path}: rich text tag <${tok.body}> not implemented`);
  }

  // per-character scales (GenerateTextMesh character lookup): element scale, face baseline offset
  _charScale(size, e) {
    const fi = this.font.faceInfo;
    const adjusted = F(F(size / fi.m_PointSize) * fi.m_Scale);
    return { adjusted, scale: F(F(adjusted * e.charScale) * e.g.scale),
             faceBaseline: F(F(fi.m_Baseline * adjusted) * fi.m_Scale) };
  }

  // style padding of a character (normal / bold): style * GradientScale * ScaleRatioA / 4, with the material padding
  // clamped to the gradient scale -> {P, SP, boldSpacing}
  _stylePadding(bold) {
    const mat = this.material.floats, GS = mat._GradientScale;
    const SP = F(F(F((bold ? this.font.boldStyle : this.font.normalStyle) / 4) * GS) * mat._ScaleRatioA);
    const P = F(SP + this.padding) > GS ? F(GS - SP) : this.padding;
    return { P, SP, boldSpacing: bold ? this.font.boldSpacing : 0 };
  }

  // advance spacing after a glyph besides its own: emScale * (boldSpacing + (characterSpacing + normalSpacingOffset))
  _spacing(emScale, characterSpacing, boldSpacing) {
    return F(F(F(this.font.normalSpacingOffset + characterSpacing) + boldSpacing) * emScale);
  }

  // Kerning of character i: the first value record of the pair (i, i + 1) plus the second of (i - 1, i), key first
  // glyph | second glyph << 16. Flag IgnoreSpacingAdjustments zeroes the character spacing. Placement adjustments
  // are not implemented (raise). -> {xAdvance, characterSpacing}
  _adjust(i, els = this.elements) {
    const out = { xAdvance: 0, characterSpacing: this.characterSpacing };
    if (!this.pairs) return out;
    const base = els[i].index;
    let xPl = 0, yPl = 0;
    const take = (r, which) => {
      const v = r[which];
      out.xAdvance = F(out.xAdvance + v.xAdvance); xPl = F(xPl + v.xPlacement); yPl = F(yPl + v.yPlacement);
      if (r.flags & TMP_IGNORE_SPACING) out.characterSpacing = 0;
    };
    if (i < els.length - 1) { const r = this.pairs[String((base | (els[i + 1].index << 16)) >>> 0)]; if (r) take(r, "first"); }
    if (i >= 1) { const r = this.pairs[String((els[i - 1].index | (base << 16)) >>> 0)]; if (r) take(r, "second"); }
    if (xPl !== 0 || yPl !== 0) throw new UIError(`${this.node.path}: glyph placement adjustments not implemented`);
    return out;
  }

  static _visible(u) {
    const ws = u <= 0xFFFF && isWhiteSpace(u);
    return u === 9 || (!ws && u !== 0x200B && u !== 0xAD && u !== 0x03);
  }

  // CalculatePreferredValues end: rendered + max(margin left / top, 0) + max(margin right / bottom, 0), * 100, + 1
  // (separate float multiply and add), truncated, / 100
  static _roundPreferred(rendered, m0, m1) {
    const v = F(F(F(F(rendered + Math.max(m0, 0)) + Math.max(m1, 0)) * 100) + 1);
    return F(Math.trunc(v) / 100);
  }

  // TMP_Text.GetPreferredWidth: CalculatePreferredValues(fontSize = autosize ? max : size, k_LargePositiveFloat
  // margins, autosize off, NoWrap).x
  preferredWidth() {
    return this._preferredValues(this.tokens, this.elements, TMP_LARGE, false, TMP_WRAP.NoWrap, this._marginWidth()).x;
  }

  // m_marginWidth (ComputeMarginSize): the rect width less the left and right margins, 0 before the first layout
  _marginWidth() {
    const r = this.node.rect, mg = this.margin;
    return r ? F(F(r.w - mg.x) - mg.z) : 0;
  }

  // TMP_Text.GetPreferredValues(string).x: the preferred width of `s` with this text's settings (SetTextInternal: the
  // string is parsed without the text preprocessor; the text shown is not changed)
  preferredWidthOf(s) {
    const tokens = tmpTokens(s, { richText: this.richText, parseCtrl: this.parseCtrl });
    const elements = tokens.filter((k) => k.c !== undefined).map((k) => ({ u: k.c, ...this.glyphOf(k.c) }));
    return this._preferredValues(tokens, elements, TMP_LARGE, false, TMP_WRAP.NoWrap, this._marginWidth()).x;
  }

  // TMP_Text.GetPreferredHeight: CalculatePreferredValues(fontSize = autosize ? max : size, width = m_marginWidth (the
  // rect width less the left and right margins; k_LargePositiveFloat when 0), the text's autosize and wrapping
  // mode).y, cached per text, settings and width (m_isPreferredHeightDirty)
  preferredHeight() {
    const mg = this.margin, mw = this._marginWidth();
    const key = `${mw}|${this.wrapping}|${mg.x}|${mg.y}|${mg.z}|${mg.w}`;
    if (this._ph && this._ph.tokens === this.tokens && this._ph.key === key) return this._ph.y;
    const y = this._preferredValues(this.tokens, this.elements, mw !== 0 ? mw : TMP_LARGE, this.autoSize, this.wrapping, mw).y;
    this._ph = { tokens: this.tokens, key, y };
    return y;
  }

  // TMP_Text.CalculatePreferredValues(ref fontSize, marginSize (the width; the height is not read), autosize, wrap
  // mode) over the parsed text, as the game's build computes it: GenerateTextMesh's phase I without the geometry. The
  // lowest element descender so far (starting at 0, over every character, kept through word wrap restores) is tracked;
  // per visible character (not whitespace, U+200B, U+00AD, U+0003; a tab is visible) the rendered width
  // max(., textWidth + line margins) and the rendered height max(., maxTextAscender - that lowest descender). Word wrap
  // on a base glyph past the width restores the last hard break (its rendered sizes included) and starts a line; line
  // feeds start one (and a first word); a line after the first whose ascender grows moves down, and the rendered height
  // grows by the same amount (the line spacing adjustment after each character; at the line end the move alone). Word
  // wrap states follow _pass, except that the '-' after whitespace test reads the previous character's line from the
  // last mesh layout (m_textInfo, this.chars of the last generate(); 0 without one). Then the positive margins are added
  // and each size is rounded (_roundPreferred). `mMarginWidth` = m_marginWidth (the <pos=%> base). Autosize only
  // reaches its first pass here: a shrink it would need raises.
  _preferredValues(tokens, els, marginWidth, autoSize, wrapMode, mMarginWidth) {
    if (!els.length) return { x: 0, y: 0 };
    if (wrapMode !== TMP_WRAP.Normal && wrapMode !== TMP_WRAP.NoWrap)
      throw new UIError(`${this.node.path}: preferred values in wrapping mode ${wrapMode} not implemented`);
    const total = els.length, fi = this.font.faceInfo;
    const fontSize = autoSize ? this.fontSizeMax : this.fontSize;
    const baseScale = F(F(fontSize / fi.m_PointSize) * fi.m_Scale), emScale = F(fontSize * 0.01);
    const lineGap = F(fi.m_LineHeight - F(fi.m_AscentLine - fi.m_DescentLine));
    const widthOfTextArea = F(marginWidth + TMP_BOUNDS_EPSILON);
    const wrap = wrapMode === TMP_WRAP.Normal;
    const ci = [];                                     // m_internalCharacterInfo: character, adjustedAscender, xAdvance
    let L = {
      cc: 0, xAdvance: 0, lineOffset: 0, lineNumber: 0, firstCharOfLine: 0, maxLineAscender: -TMP_LARGE,
      maxLineDescender: TMP_LARGE, maxTextAscender: 0, startOfLineAscender: 0, elementDescender: 0,
      renderedWidth: 0, renderedHeight: 0, style: styleState(fontSize, this.fontColor32, this.bold, this.hAlign),
    };
    const save = (i) => ({ i, ...L, style: cloneStyle(L.style) });
    const restore = (st) => { const { i, ...rest } = st; L = { ...rest, style: cloneStyle(st.style), cc: st.cc + 1 }; return i; };
    let wordWrapState = save(-1), isFirstWordOfLine = true, minDescender = 0;
    const meshChars = this.chars || [];              // m_textInfo.characterInfo of the last mesh layout
    const at = { get xAdvance() { return L.xAdvance; }, set xAdvance(v) { L.xAdvance = v; }, chars: ci,
                 get cc() { return L.cc; }, marginWidth: mMarginWidth };
    const newLineOffset = (asc, extra) => F(L.lineOffset + F(F(F(F(0 - L.maxLineDescender) + asc) + F(lineGap * baseScale)) +
                                                          F(F(this.lineSpacing + extra) * emScale)));
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.c === undefined) { this._tag(L.style, tok, fontSize, at); continue; }
      const st = L.style, cc = L.cc, e = els[cc], u = e.u, m = e.g.metrics;
      if (u === 0xAD) throw new UIError(`${this.node.path}: soft hyphen not implemented`);
      const elementScale = u === 0x03 ? 0 : this._charScale(st.size, e).scale;   // end of text: scale 0
      const ws = u <= 0xFFFF && isWhiteSpace(u);
      const adj = this._adjust(cc, els);
      const { boldSpacing } = this._stylePadding(isBold(st));
      const bo = st.baselineOffset;
      const elementAscender = F(F(fi.m_AscentLine * elementScale) + bo), elementDescender = F(F(fi.m_DescentLine * elementScale) + bo);
      const isFirstOfLine = cc === L.firstCharOfLine;
      const c = ci[cc] = { u, xAdvance: 0, lineNumber: L.lineNumber, adjustedAscender: 0 };
      if (isFirstOfLine || !ws) {
        let aa = elementAscender, ad = elementDescender;
        if (bo !== 0) { aa = Math.max(F(elementAscender - bo), aa); ad = Math.min(F(elementDescender - bo), ad); }
        L.maxLineAscender = Math.max(aa, L.maxLineAscender);
        L.maxLineDescender = Math.min(ad, L.maxLineDescender);
        c.adjustedAscender = aa;
        L.elementDescender = F(elementDescender - L.lineOffset);
      } else {
        c.adjustedAscender = L.maxLineAscender;
        L.elementDescender = F(L.maxLineDescender - L.lineOffset);
      }
      if (L.elementDescender <= minDescender) minDescender = L.elementDescender;
      if (L.lineNumber === 0 && (isFirstOfLine || !ws)) L.maxTextAscender = L.maxLineAscender;
      if (TMPText._visible(u)) {
        const textWidth = F(Math.abs(L.xAdvance) + F(m.m_HorizontalAdvance * elementScale));
        if (tmpIsBaseGlyph(u) && textWidth > widthOfTextArea && wrap && cc !== L.firstCharOfLine) {
          i = restore(wordWrapState);
          if (autoSize && isFirstWordOfLine && this.fontSizeMin < fontSize)
            throw new UIError(`${this.node.path}: autosize in preferred values not implemented`);
          const delta = F(L.maxLineAscender - L.startOfLineAscender);
          if (L.lineOffset > 0 && Math.abs(delta) > 0.01) {
            L.elementDescender = F(L.elementDescender - delta);
            L.lineOffset = F(L.lineOffset + delta);
          }
          const lineDescender = F(L.maxLineDescender - L.lineOffset);
          L.elementDescender = L.elementDescender < lineDescender ? L.elementDescender : lineDescender;
          L.firstCharOfLine = L.cc;
          L.lineNumber++;
          const asc = ci[L.cc].adjustedAscender;
          L.lineOffset = newLineOffset(asc, 0);
          L.maxLineAscender = -TMP_LARGE; L.maxLineDescender = TMP_LARGE;
          L.startOfLineAscender = asc;
          L.xAdvance = 0;
          isFirstWordOfLine = true;
          continue;
        }
        L.renderedWidth = Math.max(L.renderedWidth, textWidth);
        const h = F(L.maxTextAscender - minDescender);
        L.renderedHeight = L.renderedHeight > h ? L.renderedHeight : h;
      }
      // the line spacing adjustment of a line after the first
      if (L.lineOffset > 0 && !tmpApproximately(L.maxLineAscender, L.startOfLineAscender)) {
        const d = F(L.maxLineAscender - L.startOfLineAscender);
        L.elementDescender = F(L.elementDescender - d);
        L.lineOffset = F(L.lineOffset + d);
        L.renderedHeight = F(d + L.renderedHeight);
        L.startOfLineAscender = F(L.startOfLineAscender + d);
        wordWrapState.lineOffset = L.lineOffset;
        wordWrapState.startOfLineAscender = L.startOfLineAscender;
      }
      // xAdvance: pair adjustment, spacing, <cspace>, word spacing, tab stops (no monospace)
      if (u === 9) {
        const tabSize = F(F(fi.m_TabWidth * this.font.tabSize) * elementScale);
        const tabs = F(Math.ceil(F(L.xAdvance / tabSize)) * tabSize);
        L.xAdvance = tabs > L.xAdvance ? tabs : F(L.xAdvance + tabSize);
      } else {
        const adv = adj.xAdvance === 0 ? m.m_HorizontalAdvance : F(m.m_HorizontalAdvance + adj.xAdvance);
        L.xAdvance = F(L.xAdvance + F(F(F(adv * elementScale) + this._spacing(emScale, adj.characterSpacing, boldSpacing)) + st.cSpacing));
        if (ws || u === 0x200B) L.xAdvance = F(L.xAdvance + F(this.wordSpacing * emScale));
      }
      c.xAdvance = L.xAdvance;
      if (u === 13) L.xAdvance = 0;
      // line end: line feed, end of text or the last character
      const lf = isLineFeed(u);
      if (lf || u === 0x03 || cc === total - 1) {
        const delta = F(L.maxLineAscender - L.startOfLineAscender);
        if (L.lineOffset > 0 && Math.abs(delta) > 0.01) {
          L.elementDescender = F(L.elementDescender - delta);
          L.lineOffset = F(L.lineOffset + delta);
        }
        const lineDescender = F(L.maxLineDescender - L.lineOffset);
        L.elementDescender = L.elementDescender < lineDescender ? L.elementDescender : lineDescender;
        if (lf) {
          wordWrapState = save(i);
          L.lineNumber++;
          L.firstCharOfLine = cc + 1;
          const asc = c.adjustedAscender;
          L.lineOffset = newLineOffset(asc, u === 10 || u === 0x2029 ? this.paragraphSpacing : 0);
          L.maxLineAscender = -TMP_LARGE; L.maxLineDescender = TMP_LARGE;
          L.startOfLineAscender = asc;
          L.xAdvance = 0;
          isFirstWordOfLine = true;
          L.cc++;
          continue;
        }
        if (u === 0x03) break;
      }
      // word wrapping states (Normal wrapping), the rules of _pass; only the hard break is restored here
      if (wrap) {
        let hard = false;
        const next = cc + 1 < total ? els[cc + 1].u & 0xFFFF : -1;
        if ((ws || u === 0x200B || u === 0x2D) && !st.nobr && u !== 0xA0 && u !== 0x2007 && u !== 0x2011 &&
            u !== 0x202F && u !== 0x2060) {
          const prevLine = cc > 0 && meshChars[cc - 1] ? meshChars[cc - 1].lineNumber : 0;
          if (!(u === 0x2D && cc > 0 && isWhiteSpace(els[cc - 1].u & 0xFFFF) && prevLine === L.lineNumber)) {
            isFirstWordOfLine = false; hard = true;
          }
        } else if (!st.nobr && ((tmpIsHangul(u) && !this._lineBreaking().modernHangul) || tmpIsCJK(u))) {
          const lb = this._lineBreaking();
          const leading = lb.leading.has(u), nextFollowing = next >= 0 && lb.following.has(next);
          if (!leading) {
            if (!nextFollowing) { isFirstWordOfLine = false; hard = true; }
            if (isFirstWordOfLine) hard = true;
          } else if (isFirstWordOfLine && isFirstOfLine) hard = true;
        } else if (!st.nobr && next >= 0 && tmpIsCJK(next) && !this._lineBreaking().following.has(next)) {
          hard = true;
        } else if (isFirstWordOfLine) hard = true;
        if (hard) wordWrapState = save(i);
      }
      L.cc++;
    }
    return { x: TMPText._roundPreferred(L.renderedWidth, this.margin.x, this.margin.z),
             y: TMPText._roundPreferred(L.renderedHeight, this.margin.y, this.margin.w) };
  }

  // OnPreRenderCanvas: autosize -> fontSize = Clamp(m_fontSizeBase, min, max), search bounds (min, max), iteration 0;
  // GenerateTextMesh repeats until the point size is set. Results: this.chars (per character: visible, line, quad
  // corners, uvs, colour, xScale), this.lines, this.anchor, this.renderedFontSize.
  generate() {
    this.chars = []; this.lines = []; this.highlights = []; this.dirty = false;
    if (!this.elements.length) return;
    let fontSize = this.fontSize, as = null;
    if (this.autoSize) {
      const b = this.fontSizeBase;
      fontSize = b < this.fontSizeMin ? this.fontSizeMin : (b > this.fontSizeMax ? this.fontSizeMax : b);
      as = { maxFontSize: this.fontSizeMax, minFontSize: this.fontSizeMin, iteration: 0 };
    }
    for (;;) {
      const next = this._pass(fontSize, as);
      if (next === null) break;
      fontSize = next;
      as.iteration++;
    }
    this.renderedFontSize = fontSize;
  }

  // autosize steps: d = max((a - b) * 0.5, 0.05), size = (int)((size -/+ d) * 20 + 0.5) / 20, clamped to the min /
  // max; separate float multiplies and adds
  _shrink(fontSize, as) {
    as.maxFontSize = fontSize;
    const d = Math.max(F(F(fontSize - as.minFontSize) * 0.5), TMP_AUTOSIZE_MIN_STEP);
    const v = F(Math.trunc(F(F(F(fontSize - d) * 20) + 0.5)) / 20);
    return v > this.fontSizeMin ? v : this.fontSizeMin;
  }

  _grow(fontSize, as) {
    as.minFontSize = fontSize;
    const d = Math.max(F(F(as.maxFontSize - fontSize) * 0.5), TMP_AUTOSIZE_MIN_STEP);
    const v = F(Math.trunc(F(F(F(fontSize + d) * 20) + 0.5)) / 20);
    return v < this.fontSizeMax ? v : this.fontSizeMax;
  }

  // shrink when autosize can still act on an overflow, else null. The line spacing step (multi-line texts; on the
  // word wrap path whenever m_lineSpacingMax < the delta, 0) and the character width adjustment (m_charWidthMaxAdj >
  // 0) are not implemented.
  _overflowShrink(fontSize, as, lineOffset, what) {
    if (!as || as.iteration >= TMP_AUTOSIZE_MAX_ITERATIONS) return null;
    if (((what === "vertical" && lineOffset > 0) || what === "wrapVertical") && this.lineSpacingMax < 0)
      throw new UIError(`${this.node.path}: autosize line spacing adjustment not implemented`);
    if (what === "wrapVertical" && 0 < F(this.charWidthMaxAdj / 100))
      throw new UIError(`${this.node.path}: autosize character width adjustment not implemented`);
    if (what !== "vertical" && 0 < F(this.charWidthMaxAdj / 100))
      throw new UIError(`${this.node.path}: autosize character width adjustment not implemented`);
    return this.fontSizeMin < fontSize ? this._shrink(fontSize, as) : null;
  }

  // TMP_Settings line breaking rules (leading / following characters) for CJK characters in a wrapping text
  _lineBreaking() {
    const lb = this.font.lineBreaking;
    if (!lb) throw new UIError(`${this.node.path}: CJK line breaking rules (TMP_Settings) not in the data`);
    if (!this._lb) this._lb = { leading: new Set(Array.from(lb.leading, (c) => c.codePointAt(0))),
                                following: new Set(Array.from(lb.following, (c) => c.codePointAt(0))),
                                modernHangul: !!lb.useModernHangulLineBreakingRules };
    return this._lb;
  }

  // GenerateTextMesh at one point size: phase I (tags, glyph placement, word wrapping, lines) and phase II
  // (alignment, maxVisibleCharacters, uvs). -> null when the size is final (results stored), else the next autosize
  // point size.
  _pass(fontSize, as) {
    const toks = this.tokens, els = this.elements, total = els.length, r = this.node.rect, mg = this.margin;
    const fi = this.font.faceInfo;
    const chars = [], lines = [];
    this.chars = chars; this.lines = lines;
    const baseScale = F(F(fontSize / fi.m_PointSize) * fi.m_Scale), emScale = F(fontSize * 0.01);
    const lineGap = F(fi.m_LineHeight - F(fi.m_AscentLine - fi.m_DescentLine));
    const marginWidth = Math.max(F(F(r.w - mg.x) - mg.z), 0), marginHeight = Math.max(F(F(r.h - mg.y) - mg.w), 0);
    const widthOfTextArea = F(marginWidth + TMP_BOUNDS_EPSILON), heightLimit = F(marginHeight + TMP_BOUNDS_EPSILON);
    const wrap = this.wrapping === TMP_WRAP.Normal;
    // the layout state Save/RestoreWordWrappingState keep (style stacks included)
    let L = {
      cc: 0, xAdvance: 0, lineOffset: 0, lineNumber: 0, firstCharOfLine: 0, firstVisibleOfLine: 0,
      lastVisibleOfLine: 0, maxLineAscender: -TMP_LARGE, maxLineDescender: TMP_LARGE, maxTextAscender: 0,
      startOfLineAscender: 0, elementDescender: 0, lineVisibleCount: 0,
      style: styleState(fontSize, this.fontColor32, this.bold, this.hAlign),
    };
    const save = (i) => ({ i, ...L, style: cloneStyle(L.style), line: lines[L.lineNumber] ? { ...lines[L.lineNumber] } : null });
    const restore = (s) => {
      const { i, line, ...rest } = s;
      L = { ...rest, style: cloneStyle(s.style), cc: s.cc + 1 };
      if (line) lines[L.lineNumber] = { ...line }; else lines.length = Math.min(lines.length, L.lineNumber);
      return i;
    };
    let wordWrapState = save(-1), softBreakState = { ...save(-1), i: -1, cc: -1 };
    let lastSoftLineBreak = 0, isStartOfNewLine = true, isFirstWordOfLine = true;
    let maxVisibleDescender = 0, maxVisibleDescenderSet = false;
    const at = { get xAdvance() { return L.xAdvance; }, set xAdvance(v) { L.xAdvance = v; }, chars,
                 get cc() { return L.cc; }, marginWidth };
    const line = (n) => (lines[n] || (lines[n] = { alignment: this.hAlign, marginLeft: 0, width: widthOfTextArea }));

    // AdjustLineOffset: characters first..last move down by `offset`
    const adjustLineOffset = (first, last, offset) => {
      for (let k = first; k <= last; k++) {
        const c = chars[k];
        if (!c) continue;
        c.corners = c.corners.map(([x, y]) => [x, F(y - offset)]);
        c.y0 = F(c.y0 - offset); c.y1 = F(c.y1 - offset);
        c.baselineY = F(c.baselineY - offset);
        c.ascender = F(c.ascender - offset); c.descender = F(c.descender - offset);
      }
    };

    // the line end of lines[L.lineNumber] (GenerateTextMesh line feed / last character, InsertNewLine):
    // spacing = the maxAdvance offset of the current character
    const endLine = (lastIndex) => {
      const delta = F(L.maxLineAscender - L.startOfLineAscender);
      if (L.lineOffset > 0 && Math.abs(delta) > 0.01) {
        adjustLineOffset(L.firstCharOfLine, L.cc, delta);
        L.elementDescender = F(L.elementDescender - delta);
        L.lineOffset = F(L.lineOffset + delta);
      }
      const lineAscender = F(L.maxLineAscender - L.lineOffset), lineDescender = F(L.maxLineDescender - L.lineOffset);
      L.elementDescender = Math.min(L.elementDescender, lineDescender);
      if (!maxVisibleDescenderSet) maxVisibleDescender = L.elementDescender;
      if (this.useMaxVisibleDescender && (L.cc >= this.maxVisibleCharacters || L.lineNumber >= this.maxVisibleLines))
        maxVisibleDescenderSet = true;
      L.firstVisibleOfLine = Math.max(L.firstCharOfLine, L.firstVisibleOfLine);
      L.lastVisibleOfLine = L.lastVisibleOfLine < L.firstVisibleOfLine ? L.firstVisibleOfLine : L.lastVisibleOfLine;
      const ln = line(L.lineNumber);
      Object.assign(ln, { first: L.firstCharOfLine, last: lastIndex, firstVisible: L.firstVisibleOfLine,
                          lastVisible: L.lastVisibleOfLine, ascender: lineAscender, descender: lineDescender,
                          baseline: F(-L.lineOffset), width: widthOfTextArea });
      return ln;
    };

    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (tok.c === undefined) { this._tag(L.style, tok, fontSize, at); continue; }
      const st = L.style, cc = L.cc, e = els[cc], u = e.u, m = e.g.metrics;
      if (u === 0xAD) throw new UIError(`${this.node.path}: soft hyphen not implemented`);
      const { scale, faceBaseline } = this._charScale(st.size, e);
      const bold = isBold(st), { P, SP, boldSpacing } = this._stylePadding(bold);
      const ws = u <= 0xFFFF && isWhiteSpace(u);
      const adj = this._adjust(cc);
      const bo = st.baselineOffset;
      // quad corners (phase I, before alignment)
      const x0 = F(L.xAdvance + F(F(F(m.m_HorizontalBearingX - P) - SP) * scale));
      const y1 = F(F(F(faceBaseline + F(F(m.m_HorizontalBearingY + P) * scale)) - L.lineOffset) + bo);
      const y0 = F(y1 - F(F(m.m_Height + P * 2) * scale));
      const x1 = F(x0 + F(F(F(m.m_Width + P * 2) + SP * 2) * scale));
      let corners = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];            // BL, TL, TR, BR
      if (st.rotate !== null) {                                         // <rotate>: m_FXMatrix about the quad centre
        const a = st.rotate * Math.PI / 180, cs = F(Math.cos(a)), sn = F(Math.sin(a));
        const ox = F(F(x1 + x0) / 2), oy = F(F(y1 + y0) / 2);
        corners = corners.map(([x, y]) => {
          const dx = F(x - ox), dy = F(y - oy);
          return [F(F(F(cs * dx) - F(sn * dy)) + ox), F(F(F(sn * dx) + F(cs * dy)) + oy)];
        });
      }
      const c = { u, g: e.g, scale, P, SP, bold, x0, y0, x1, y1, corners, lineNumber: L.lineNumber, visible: false, color: null,
                  baselineY: F(F(faceBaseline - L.lineOffset) + bo), origin: L.xAdvance,
                  hl: st.markCount > 0 ? st.hlState : null, rotated: st.rotate !== null, kern: adj.xAdvance };
      chars[cc] = c;
      // ascender / descender in line space
      const elementAscender = F(F(fi.m_AscentLine * scale) + bo), elementDescender = F(F(fi.m_DescentLine * scale) + bo);
      const isFirstOfLine = cc === L.firstCharOfLine;
      if (isFirstOfLine || !ws) {
        let aa = elementAscender, ad = elementDescender;
        if (bo !== 0) { aa = Math.max(F(elementAscender - bo), aa); ad = Math.min(F(elementDescender - bo), ad); }
        L.maxLineAscender = Math.max(aa, L.maxLineAscender);
        L.maxLineDescender = Math.min(ad, L.maxLineDescender);
        c.adjustedAscender = aa; c.adjustedDescender = ad;
        c.ascender = F(elementAscender - L.lineOffset); c.descender = F(elementDescender - L.lineOffset);
        L.elementDescender = c.descender;
      } else {
        c.adjustedAscender = L.maxLineAscender; c.adjustedDescender = L.maxLineDescender;
        c.ascender = F(L.maxLineAscender - L.lineOffset); c.descender = F(L.maxLineDescender - L.lineOffset);
        L.elementDescender = c.descender;
      }
      if (L.lineNumber === 0 && (isFirstOfLine || !ws)) L.maxTextAscender = L.maxLineAscender;
      const spacing = this._spacing(emScale, adj.characterSpacing, boldSpacing);
      // visible characters: bounds checks (autosize, word wrap), vertex colour
      if (TMPText._visible(u)) {
        const textWidth = F(Math.abs(L.xAdvance) + F(m.m_HorizontalAdvance * scale));
        const textHeight = F(F(L.maxTextAscender - F(L.maxLineDescender - L.lineOffset)) +
                             (L.lineOffset > 0 ? F(L.maxLineAscender - L.startOfLineAscender) : 0));
        if (textHeight > heightLimit) {
          const next = this._overflowShrink(fontSize, as, L.lineOffset, "vertical");
          if (next !== null) return next;
          // Overflow: vertical bounds ignored
        }
        if (textWidth > widthOfTextArea && tmpIsBaseGlyph(u)) {
          if (wrap && cc !== L.firstCharOfLine) {
            // word wrap: back to the last break opportunity, then a new line (InsertNewLine)
            i = restore(wordWrapState);
            const nc = chars[L.cc];
            const lineOffsetDelta = F(F(F(F(F(L.lineOffset > 0 ? F(L.maxLineAscender - L.startOfLineAscender) : 0) -
              L.maxLineDescender) + nc.adjustedAscender) + F(lineGap * baseScale)) + F(this.lineSpacing * emScale));
            const newTextHeight = F(F(F(L.maxTextAscender + lineOffsetDelta) + L.lineOffset) - nc.adjustedDescender);
            if (as && isFirstWordOfLine) {
              const next = this._overflowShrink(fontSize, as, L.lineOffset, "wrap");
              if (next !== null) return next;
            }
            if (isFirstWordOfLine && softBreakState.i !== -1 && softBreakState.i !== lastSoftLineBreak) {
              lastSoftLineBreak = softBreakState.i;
              i = restore(softBreakState);
            }
            if (newTextHeight > heightLimit && as) {
              const next = this._overflowShrink(fontSize, as, L.lineOffset, "wrapVertical");
              if (next !== null) return next;
            }
            // InsertNewLine: maxAdvance = xAdvance(last visible) - ((its pair adjustment x the overflowing character's
            // scale + that character's spacing) + cSpacing)
            const lastIndex = L.cc - 1 > 0 ? L.cc - 1 : 0;
            const ln = endLine(lastIndex);
            const lv = chars[L.lastVisibleOfLine];
            const maxAdvanceOffset = F(F(F(lv.kern * scale) + spacing) + L.style.cSpacing);
            ln.maxAdvance = F(lv.xAdvance - maxAdvanceOffset);
            lv.xAdvance = ln.maxAdvance;
            L.firstCharOfLine = L.cc;
            L.lineVisibleCount = 0;
            L.lineNumber++;
            const asc = chars[L.cc].adjustedAscender;
            L.lineOffset = F(L.lineOffset + F(F(F(F(0 - L.maxLineDescender) + asc) + F(lineGap * baseScale)) +
                                              F(this.lineSpacing * emScale)));
            L.startOfLineAscender = asc;
            L.maxLineAscender = -TMP_LARGE; L.maxLineDescender = TMP_LARGE;
            L.xAdvance = 0;
            isStartOfNewLine = true; isFirstWordOfLine = true;
            continue;
          }
          const next = this._overflowShrink(fontSize, as, L.lineOffset, "horizontal");
          if (next !== null) return next;
          // Overflow: horizontal bounds ignored
        }
        c.visible = u !== 9;
        const vc = this.overrideHtmlColors ? this.fontColor32 : st.color;
        c.color = [vc[0], vc[1], vc[2], Math.min(this.fontColor32[3], vc[3])];   // SaveGlyphVertexInfo alpha
        if (isStartOfNewLine) { isStartOfNewLine = false; L.firstVisibleOfLine = cc; }
        L.lineVisibleCount++;
        L.lastVisibleOfLine = cc;
        line(L.lineNumber).marginLeft = 0;
      }
      c.lineNumber = L.lineNumber;
      if (u !== 10 && u !== 11 && u !== 13) line(L.lineNumber).alignment = st.align;
      // xAdvance: pair adjustment, spacing, <cspace>, word spacing, tab stops (no monospace)
      if (u === 9) {
        const tabSize = F(F(fi.m_TabWidth * this.font.tabSize) * scale);
        const tabs = F(Math.ceil(F(L.xAdvance / tabSize)) * tabSize);
        L.xAdvance = tabs > L.xAdvance ? tabs : F(L.xAdvance + tabSize);
      } else {
        const adv = adj.xAdvance === 0 ? m.m_HorizontalAdvance : F(m.m_HorizontalAdvance + adj.xAdvance);
        L.xAdvance = F(L.xAdvance + F(F(F(adv * scale) + spacing) + st.cSpacing));
        if (ws || u === 0x200B) L.xAdvance = F(L.xAdvance + F(this.wordSpacing * emScale));
      }
      c.xAdvance = L.xAdvance;
      if (u === 13) L.xAdvance = 0;
      // line end: line feed or the last character
      const lf = isLineFeed(u);
      if (lf || u === 0x03 || cc === total - 1) {
        const ln = endLine(cc);
        const lastC = chars[L.lastVisibleOfLine].visible ? chars[L.lastVisibleOfLine] : c;
        ln.maxAdvance = F(lastC.xAdvance - F(spacing + st.cSpacing));
        if (ln.first === ln.last) ln.alignment = st.align;
        if (u === 0x03) { L.cc++; break; }         // end of text
        if (lf) {
          L.lineNumber++;
          isStartOfNewLine = true; isFirstWordOfLine = true;
          L.firstCharOfLine = cc + 1;
          L.lineVisibleCount = 0;
          const lastVisibleAscender = c.adjustedAscender;
          L.lineOffset = F(L.lineOffset + F(F(F(F(0 - L.maxLineDescender) + lastVisibleAscender) + F(lineGap * baseScale)) +
                                            F(F(this.lineSpacing + (u === 10 || u === 0x2029 ? this.paragraphSpacing : 0)) * emScale)));
          L.maxLineAscender = -TMP_LARGE; L.maxLineDescender = TMP_LARGE;
          L.startOfLineAscender = lastVisibleAscender;
          L.xAdvance = 0;
          wordWrapState = save(i);
          L.cc++;
          continue;
        }
      }
      // word wrapping states (GenerateTextMesh, Normal wrapping): the last hard break opportunity and the soft one of
      // the first word of a line. characterInfo.character is the UTF-16 unit, so the neighbours' tests read u & 0xFFFF.
      //   whitespace / U+200B / '-' outside <nobr>, no non-breaking space: a hard break (a '-' after whitespace on the
      //     same line saves nothing), the first word ends, the soft break is cleared
      //   CJK, or Hangul without the modern rules: TMP_Settings leading (never ends a line) / following (never starts
      //     one) characters decide
      //   any other character (outside <nobr>) followed by a CJK character that is not a following character: a hard
      //     break (before a following character the test goes on to the first-word rule)
      //   else in the first word of a line: every character is a hard break, whitespace other than U+00A0 a soft one
      if (wrap) {
        let hard = false, soft = false;
        const next = cc + 1 < total ? els[cc + 1].u & 0xFFFF : -1;
        if ((ws || u === 0x200B || u === 0x2D) && !st.nobr && u !== 0xA0 && u !== 0x2007 && u !== 0x2011 &&
            u !== 0x202F && u !== 0x2060) {
          const prev = cc > 0 ? chars[cc - 1] : null;
          if (!(u === 0x2D && prev && isWhiteSpace(prev.u & 0xFFFF) && prev.lineNumber === L.lineNumber)) {
            isFirstWordOfLine = false; hard = true;
            softBreakState = { ...softBreakState, i: -1 };
          }
        } else if (!st.nobr && ((tmpIsHangul(u) && !this._lineBreaking().modernHangul) || tmpIsCJK(u))) {
          const lb = this._lineBreaking();
          const leading = lb.leading.has(u), nextFollowing = next >= 0 && lb.following.has(next);
          if (!leading) {
            if (!nextFollowing) { isFirstWordOfLine = false; hard = true; }
            if (isFirstWordOfLine) { if (ws) soft = true; hard = true; }
          } else if (isFirstWordOfLine && isFirstOfLine) { if (ws) soft = true; hard = true; }
        } else if (!st.nobr && next >= 0 && tmpIsCJK(next) && !this._lineBreaking().following.has(next)) {
          hard = true;
        } else if (isFirstWordOfLine) {
          if (ws && u !== 0xA0) soft = true;
          hard = true;
        }
        if (hard) wordWrapState = save(i);
        if (soft) softBreakState = save(i);
      }
      L.cc++;
    }
    // autosize: grow while the search window is wider than 0.051
    if (as && F(as.maxFontSize - as.minFontSize) > TMP_AUTOSIZE_DONE && fontSize < this.fontSizeMax &&
        as.iteration < TMP_AUTOSIZE_MAX_ITERATIONS)
      return this._grow(fontSize, as);
    this.maxTextAscender = L.maxTextAscender;
    this.maxVisibleDescender = maxVisibleDescender;
    // phase II: vertical anchor (rect corners in local space) and line justification
    let ax, ay;
    const cx = r.x, cyBottom = r.y, cyTop = r.y + r.h, mta = L.maxTextAscender;
    if (this.vAlign === TMP_V.Top) { ax = F(cx + mg.x); ay = F(F(cyTop - mta) - mg.y); }
    else if (this.vAlign === TMP_V.Middle) {
      ax = F(cx + mg.x);
      ay = F(F((cyBottom + cyTop) / 2) - F(F(F(F(mta + mg.y) + maxVisibleDescender) - mg.w) / 2));
    } else { ax = F(cx + mg.x); ay = F(F(cyBottom - maxVisibleDescender) + mg.w); }
    this.anchor = { x: ax, y: ay };
    const fontTex = this.font.textureSize;
    chars.length = L.cc;
    for (const [i, c] of chars.entries()) {
      const ln = lines[c.lineNumber];
      let jx;
      if (ln.alignment === TMP_H.Left) jx = ln.marginLeft;
      else if (ln.alignment === TMP_H.Center) jx = F(F(ln.marginLeft + F(ln.width / 2)) - F(ln.maxAdvance / 2));
      else if (ln.alignment === TMP_H.Right) jx = F(F(ln.marginLeft + ln.width) - ln.maxAdvance);
      else throw new UIError(`${this.node.path}: line alignment ${ln.alignment} not implemented`);
      c.offset = { x: F(ax + jx), y: ay };
      c.baselineY = F(ay + c.baselineY);
      if (!c.visible) continue;
      if (i >= this.maxVisibleCharacters) { c.visible = false; c.hiddenByMaxVisible = true; continue; }
      c.quadCorners = c.corners.map(([x, y]) => [F(x + c.offset.x), F(y + c.offset.y)]);
      const [bl, , tr] = c.quadCorners;
      c.quad = [bl[0], bl[1], tr[0], tr[1]];
      // uvs: glyph rect grown by padding + style padding (SaveGlyphVertexInfo), moved into the page by the packed
      // integer offset
      const gr = c.g.rect, pk = c.g.packed;
      if (!pk) throw new UIError(`${this.font.name}: glyph for U+${c.u.toString(16)} has no atlas page`);
      const page = fontTex[pk.texture];
      if (!page) throw new UIError(`${this.font.name}: atlas page ${pk.texture} missing`);
      const tw = page.width, th = page.height, P2 = F(c.P + c.SP);
      c.texture = pk.texture;
      c.uv = [F(F(F(gr.m_X - P2) + pk.dx) / tw), F(F(F(gr.m_Y - P2) + pk.dy) / th),
              F(F(F(F(gr.m_X + gr.m_Width) + P2) + pk.dx) / tw), F(F(F(F(gr.m_Y + gr.m_Height) + P2) + pk.dy) / th)];
      // SDF scale packed with the bold flag in its sign; ScreenSpaceCamera with a camera: * |lossyScale| (= 1 here)
      c.xScale = c.bold ? -c.scale : c.scale;
    }
    this.highlights = chars.some((c) => c.hl) ? this._highlights(chars, lines) : [];
    return null;
  }

  // GenerateTextMesh phase II, the Highlight style (after the offsets): per character with Highlight, visible = index
  // <= maxVisibleCharacters (sic) and line <= maxVisibleLines; a run starts at such a character up to its line's last
  // visible character that is no line feed / carriage return (nor a separator at that last position), and grows over
  // x = whitespace ? origin .. xAdvance : bottomLeft.x .. topRight.x and y = descender .. ascender (the character's,
  // with the state's padding); a state change inside a run draws up to the middle and starts a new run; a run ends at
  // a single-character text, its line's last character or last visible character, a hidden character, or the first
  // character without Highlight. -> [{x0, y0, x1, y1, color}] (DrawTextHighlight calls, in order)
  _highlights(chars, lines) {
    const out = [], total = chars.length;
    const draw = (s, e, color) => out.push({ x0: s.x, y0: s.y, x1: e.x, y1: e.y, color });
    let begin = false, start = null, end = null, hs = null;
    for (const [i, c] of chars.entries()) {
      const ln = lines[c.lineNumber], u16 = c.u & 0xFFFF;
      if (!c.hl) {
        if (begin) { begin = false; draw(start, end, hs.color); }
        continue;
      }
      if (c.rotated) throw new UIError(`${this.node.path}: highlight of rotated characters not implemented`);
      const visible = !(i > this.maxVisibleCharacters || c.lineNumber > this.maxVisibleLines);
      if (!begin && visible && i <= ln.lastVisible && u16 !== 10 && u16 !== 11 && u16 !== 13 &&
          !(i === ln.lastVisible && isSeparator(u16))) {
        begin = true; start = { x: 2147483648, y: 2147483648 }; end = { x: -2147483648, y: -2147483648 }; hs = c.hl;
      }
      if (begin) {
        const cs = c.hl, ws = isWhiteSpace(u16), ox = c.offset.x, oy = c.offset.y;
        const X = ws ? F(c.origin + ox) : F(c.x0 + ox), R = ws ? F(c.xAdvance + ox) : F(c.x1 + ox);
        const asc = F(c.ascender + oy), desc = F(c.descender + oy);
        if (!sameHighlight(hs, cs)) {
          const mid = F(F(X + F(end.x - hs.pad.r)) * 0.5);
          draw({ x: start.x, y: minF(start.y, desc) }, { x: mid, y: maxF(end.y, asc) }, hs.color);
          start = { x: mid, y: F(desc - cs.pad.b) };
          end = { x: F(cs.pad.r + R), y: F(asc + cs.pad.t) };
          hs = cs;
        } else {
          start.x = minF(start.x, F(X - hs.pad.l)); end.x = maxF(end.x, F(R + hs.pad.r));
          start.y = minF(start.y, F(desc - hs.pad.b)); end.y = maxF(end.y, F(asc + hs.pad.t));
        }
      }
      if (begin && (total === 1 || i === ln.last || i >= ln.lastVisible || !visible)) { draw(start, end, hs.color); begin = false; }
    }
    return out;
  }

  // DrawTextHighlight quads: BL, TL, TR, BR of the run; uv0 = the centre of the primary font asset's underline
  // character '_' (no fallback) +- one texel, w 0; uv1 (0, 1); colour (r, g, b, min(font colour alpha, a)); into the
  // mesh of material 0 after its glyph quads. The atlas pages are repacked: the centre is taken in the page that holds
  // '_', which must be the page of material 0.
  _highlightVerts(texture) {
    const f = this.font, ch = f.characters["95"];
    if (!ch) throw new UIError(`${f.name}: U+005F (the highlight glyph) not in the font data`);
    const g = f.glyphs[String(ch.glyph)], pk = g && g.packed;
    if (!pk || (texture && pk.texture !== texture) || (g.atlasIndex || 0) !== 0)
      throw new UIError(`${f.name}: highlight glyph outside the first atlas page not implemented`);
    const page = f.textureSize[pk.texture], r = g.rect, W = page.width, H = page.height;
    const cu = F(F(F(r.m_X + r.m_Width / 2) + pk.dx) / W), cv = F(F(F(r.m_Y + r.m_Height / 2) + pk.dy) / H);
    const tx = F(1 / W), ty = F(1 / H);
    const verts = [];
    for (const h of this.highlights) {
      const c = [h.color[0], h.color[1], h.color[2], Math.min(this.fontColor32[3], h.color[3])];
      verts.push({ x: h.x0, y: h.y0, c, u: F(cu - tx), v: F(cv - ty), w: 0, u1: 0, v1: 1 },
                 { x: h.x0, y: h.y1, c, u: F(cu - tx), v: F(ty + cv), w: 0, u1: 0, v1: 1 },
                 { x: h.x1, y: h.y1, c, u: F(tx + cu), v: F(ty + cv), w: 0, u1: 0, v1: 1 },
                 { x: h.x1, y: h.y0, c, u: F(tx + cu), v: F(cv - ty), w: 0, u1: 0, v1: 1 });
    }
    return { verts, texture: pk.texture };
  }

  // TextMeshProUGUI mesh: quads BL, TL, TR, BR (FillCharacterVertexBuffers), triangles 0,1,2 / 2,3,0, uv0 = (u, v, 0,
  // xScale), uv1 = per-glyph (0,0)..(1,1). Glyphs on atlas page k > 0 draw through TMP_SubMeshUI children with a
  // fallback material per page: draw order = material index order, index 0 the first page, the others in order of
  // first appearance in the text. Glyphs a dynamic font asset adds at run time (runtime) form one more page, indexed at
  // their first appearance; only the paint order of overlapping quads depends on it.
  // -> [{chars, verts (local space; UIDraw.pack with uvw), idx, texture}], after generate()
  meshes() {
    this.generate();
    const groups = new Map([[0, []]]);
    for (const c of this.chars) {
      const key = c.g.runtime ? "runtime" : (c.g.atlasIndex || 0);
      if (!groups.has(key)) groups.set(key, []);
      if (c.visible && c.quad) groups.get(key).push(c);
    }
    const out = [];
    for (const chars of groups.values()) {
      const verts = [], idx = [];
      for (const c of chars) {
        const [bl, tl, tr, br] = c.quadCorners, [u0, v0, u1, v1] = c.uv, s = verts.length;
        verts.push({ x: bl[0], y: bl[1], c: c.color, u: u0, v: v0, w: c.xScale, u1: 0, v1: 0 },
                   { x: tl[0], y: tl[1], c: c.color, u: u0, v: v1, w: c.xScale, u1: 0, v1: 1 },
                   { x: tr[0], y: tr[1], c: c.color, u: u1, v: v1, w: c.xScale, u1: 1, v1: 1 },
                   { x: br[0], y: br[1], c: c.color, u: u1, v: v0, w: c.xScale, u1: 1, v1: 0 });
        idx.push(s, s + 1, s + 2, s + 2, s + 3, s);
      }
      let texture = chars.length ? chars[0].texture : null;
      if (chars.some((c) => c.texture !== texture)) throw new UIError(`${this.node.path}: glyphs of one page group span textures`);
      if (!out.length && this.highlights.length) {    // material 0: the highlight quads after the glyphs
        const h = this._highlightVerts(texture);
        texture = h.texture;
        for (let s = verts.length, k = 0; k < h.verts.length; k += 4, s += 4) idx.push(s, s + 1, s + 2, s + 2, s + 3, s);
        verts.push(...h.verts);
      }
      out.push({ chars, verts, idx, texture });
    }
    return out;
  }
}
