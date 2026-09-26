import { F } from "../engine/core.js";
import { UIError } from "../engine/ugui.js";

// Text setters of the story UI: Fwk.UI.UIText / UIRubyText.SetText, the ruby rewrite of the ruby text classes
// (TMPro.RubyTextMeshProUGUI and Fwk.UI.RubyEmojiTextMeshProUGUI: ReplaceRubyTags -> RubyTextConstants.ReplaceRubyTags)
// and the text preprocessing of TMP_EmojiTextUGUI. `t` = the node's TMPText (engine/uitext.js), `b` = its text
// binding (ui/fonts.json `texts[path]`: `class`, `ruby`, `uiRubyText`).

export const RUBY_CLASSES = new Set(["RubyTextMeshProUGUI", "RubyEmojiTextMeshProUGUI"]);
const EMOJI_TEXT_CLASSES = new Set(["RubyEmojiTextMeshProUGUI"]);           // TMP_EmojiTextUGUI subclasses

// RubyTextConstants RUBY_REGEX (case sensitive): <r="reading">base</r> | <ruby="reading">base</ruby> (the quotes are
// optional) | <ruby>base<rt>reading</rt></ruby> | <r>base<rt>reading</rt></r>. Groups: 2 reading, 3 base; 5 / 7 base,
// 6 / 8 reading (the .NET regex names both base groups "base" and both reading groups "rubyText").
const RUBY_REGEX = /<r(uby)?="?([\s\S]*?)"?>([\s\S]*?)<\/r(uby)?>|<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/ruby>|<r>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/r>/g;

// RubyTextHelper s_rubyTagRegex: the opening ruby tags HasRubyInFirstLine looks for
const RUBY_OPEN_TAG = /<ruby\s*=\s*[^"'>]+>|<r\s*=\s*[^"'>]+>/;

// characters TmpTextHelper.HasSequenceCharacter looks for: VS15, VS16, ZWJ
const EMOJI_SEQUENCE = /[︎️‍]/;

// Single.ToString() as String.Format writes a boxed float: "G" with 7 significant digits of the value as a double,
// trailing zeros dropped, fixed-point for decimal exponents -5 < e < 7, else d.ddddddE+XX; -0 prints "0".
// ENGINE: the digits are the correctly rounded 7-digit decimal of the value and the decimal separator is ".", as the runtime's invariant-like cultures give.
export const netSingleToString = (v) => {
  if (!Number.isFinite(v)) throw new UIError(`float ${v} in a ruby tag`);
  if (v === 0) return "0";
  const [mant, ex] = Math.abs(v).toExponential(6).split("e");
  const e = Number(ex), digits = mant.replace(".", "").replace(/0+$/, "");
  let s;
  if (e > -5 && e < 7) {
    if (e >= 0) {
      const int = digits.slice(0, e + 1).padEnd(e + 1, "0"), frac = digits.slice(e + 1);
      s = frac ? `${int}.${frac}` : int;
    } else s = `0.${"0".repeat(-e - 1)}${digits}`;
  } else {
    s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  return v < 0 ? `-${s}` : s;
};

// RubyTextConstants.CreateBaseAfterRubyText / CreateRubyAfterBaseText
const baseAfterRuby = (r, base, ruby, offset, comp) =>
  `<nobr>${base}<space=${netSingleToString(offset)}><voffset=${r._rubyVerticalOffset}><size=${netSingleToString(F(r._rubyScale * 100))}%>${ruby}</size></voffset><space=${netSingleToString(comp)}></nobr>`;
const rubyAfterBase = (r, base, ruby, offset, comp) =>
  `<nobr><space=${netSingleToString(-comp)}>${base}<space=${netSingleToString(offset)}><voffset=${r._rubyVerticalOffset}><size=${netSingleToString(F(r._rubyScale * 100))}%>${ruby}</size></voffset><space=${netSingleToString(comp)}></nobr>`;

// RubyTextConstants.CreateReplaceValue (dir 1: left to right). st = {cur, rubyCur} (the ref floats).
//   dB = dir * baseW, dR = dir * rubyW, offset = (baseW * 0.5 + rubyW * 0.5) * -dir, comp = ((baseW - rubyW) * 0.5) * dir
//   RUBY_ALIGNMENT (0): comp < 0 ? RubyAfterBase : BaseAfterRuby, cur += comp < 0 ? dB : dR
//   BASE_ALIGNMENT (1): BaseAfterRuby, cur += dB
//   BASE_NO_OVERRAP_RUBY_ALIGNMENT (2): x = dB + offset + cur, d = x - rubyCur; d >= 0: rubyCur = dR + x; else
//     "<space=-d>" first, rubyCur = dR + rubyCur + _rubyMargin, cur -= d; then cur += dB; BaseAfterRuby
const createReplaceValue = (r, dir, base, baseW, ruby, rubyW, st) => {
  const fd = dir, dB = F(fd * baseW), dR = F(fd * rubyW);
  const offset = F(F(F(baseW * 0.5) + F(rubyW * 0.5)) * -dir);
  const comp = F(F(F(baseW - rubyW) * 0.5) * fd);
  switch (r._rubyShowType) {
    case 0: {
      const out = comp < 0 ? rubyAfterBase(r, base, ruby, offset, comp) : baseAfterRuby(r, base, ruby, offset, comp);
      st.cur = F((comp < 0 ? dB : dR) + st.cur);
      return out;
    }
    case 1:
      st.cur = F(dB + st.cur);
      return baseAfterRuby(r, base, ruby, offset, comp);
    case 2: {
      let pre = "", c;
      const x = F(F(dB + offset) + st.cur), d = F(x - st.rubyCur);
      if (d >= 0) { st.rubyCur = F(dR + x); c = st.cur; }
      else {
        pre = `<space=${netSingleToString(-d)}>`;
        st.rubyCur = F(F(dR + st.rubyCur) + r._rubyMargin);
        c = F(st.cur - d); st.cur = c;
      }
      st.cur = F(dB + c);
      return pre + baseAfterRuby(r, base, ruby, offset, comp);
    }
  }
  throw new UIError(`ruby show type ${r._rubyShowType}`);
};

// RubyTextMeshProUGUI / RubyEmojiTextMeshProUGUI.ReplaceRubyTags(str) -> RubyTextConstants.ReplaceRubyTags(this, str,
// dir, fontSizeScale, hiddenSpaceW). Per match: the text before it is appended (its preferred width added to cur),
// then CreateReplaceValue with the preferred widths (TMP_Text.GetPreferredValues(string).x; ruby first, then base)
// of the base and of the reading x _rubyScale; the tail after the last match follows. A non-empty _rubyLineHeight
// prefixes "<line-height=H><voffset=V><size=S%> </size></voffset><space=hiddenSpaceW>" (hiddenSpaceW = fontSizeScale
// x (_rubyScale x -(W(" a") - W("a")))). Right-to-left and perspective texts raise in TMPText; fontSizeScale is 1
// without autosize (autosize with a ruby rewrite raises: its scale reads the autosize search state).
export const replaceRubyTags = (t, r, str) => {
  if (!str) return str;
  const st = { cur: 0, rubyCur: 0 };
  let out = "", idx = 0, any = false;
  RUBY_REGEX.lastIndex = 0;
  for (let m; (m = RUBY_REGEX.exec(str));) {
    let base, ruby;
    if (m[5] !== undefined || m[7] !== undefined) { base = m[5] !== undefined ? m[5] : m[7]; ruby = m[6] !== undefined ? m[6] : m[8]; }
    else { base = m[3]; ruby = m[2]; }
    any = true;
    if (t.autoSize) throw new UIError(`${t.node.path}: ruby text with autosize not implemented`);
    const len = m.index - idx;
    if (len !== 0 && idx <= m.index) {
      const head = str.substring(idx, m.index);
      st.cur = F(t.preferredWidthOf(head) + st.cur);
      out += head;
    }
    const rX = t.preferredWidthOf(ruby), bX = t.preferredWidthOf(base);
    out += createReplaceValue(r, 1, base, F(F(bX * 1) * 1), ruby, F(F(F(rX * 1) * r._rubyScale) * 1), st);
    idx = m.index + m[0].length;
  }
  if (any) str = str.substring(idx);
  out += str;
  if (!r._rubyLineHeight || !r._rubyLineHeight.trim()) return out;
  const spaceW = F(t.preferredWidthOf(" a") - t.preferredWidthOf("a"));
  const hidden = F(1 * F(r._rubyScale * -spaceW));
  return `<line-height=${r._rubyLineHeight}><voffset=${r._rubyVerticalOffset}><size=${netSingleToString(F(r._rubyScale * 100))}%> </size></voffset><space=${netSingleToString(hidden)}>${out}`;
};

// RubyTextHelper.HasRubyInFirstLine: an opening ruby tag in the text before the first '\n'
export const hasRubyInFirstLine = (text) => !!text && RUBY_OPEN_TAG.test(text.split("\n")[0]);

// TMP_EmojiTextUGUI.PreprocessText (the preprocessor TMP runs on a text set through the text property, and
// TmpTextHelper.CountRenderedCharacters on an emoji text): emoji sequences -> sprite tags (raises: the emoji sprite
// asset is not in the data), then with parseCtrlCharacters "\\n" -> "\n" and "\\t" -> "\t". m_monospaceDistEm is 0 in
// the constructor (no <mspace> prefix); no secondary preprocessor is set.
export const preprocessEmojiText = (t, text) => {
  if (t.richText && EMOJI_SEQUENCE.test(text)) throw new UIError(`${t.node.path}: emoji sequences not implemented`);
  return t.parseCtrl ? text.replaceAll("\\n", "\n").replaceAll("\\t", "\t") : text;
};

// TmpTextHelper.CombineEmojiSequences: rich text with a VS15 / VS16 / ZWJ -> TMP_EmojiSearchEngine sprite tags
const combineEmojiSequences = (t, text) => {
  if (t.richText && EMOJI_SEQUENCE.test(text)) throw new UIError(`${t.node.path}: emoji sequences not implemented`);
  return text;
};

// The text TmpTextHelper.CountRenderedCharacters counts for the component: an emoji text preprocesses it, a
// RubyTextMeshProUGUI keeps it, any other text combines emoji sequences
export const countedText = (t, b, text) => {
  if (EMOJI_TEXT_CLASSES.has(b.class)) return preprocessEmojiText(t, text);
  if (b.class === "RubyTextMeshProUGUI") return text;
  return combineEmojiSequences(t, text);
};

// The string TMP lays out after the component's text setter, without changing anything: the ruby rewrite of a ruby
// class under UIRubyText, else the text (StoryUI.checkTexts)
export const shownText = (t, b, text) => (b.uiRubyText && RUBY_CLASSES.has(b.class) ? replaceRubyTags(t, b.ruby, text || "") : text);

// The text component of a node: UIText.SetText (CombineEmojiSequences, then TMP_Text.SetCharArray: the TMP text
// preprocessor does not run) or, with a UIRubyText, UIRubyText.SetText: on a ruby class TrySetRubyText
// (RubyTextHelper.TrySetUneditedText: uneditedText = s -> SetTextCustom: text = ReplaceRubyTags(s); then
// AdjustMarginTop: margin.y = HasRubyInFirstLine(s) ? _rubyMarginTop : the margin.y captured at Awake), else
// SetTextWithoutRuby (UIText.SetText). The ForceMeshUpdate override only re-runs the rewrite with autosize.
export class StoryText {
  constructor(t, b) {
    this.t = t; this.b = b;
    this.ruby = !!b.uiRubyText && RUBY_CLASSES.has(b.class);
    if (this.ruby && !b.ruby) throw new UIError(`${t.node.path}: ruby settings of ${b.class} not in ui/fonts.json`);
    this.originMarginTop = t.margin.y;               // UIRubyText.EnsureOriginMarginTop (Awake)
    this.text = "";
  }

  // UIText.GetText / UIRubyText.GetText: the text last given to SetText (before the ruby rewrite)
  getText() { return this.text; }

  setText(s) {
    this.text = s;
    const t = this.t, b = this.b;
    if (!this.ruby) { t.setText(combineEmojiSequences(t, s)); return; }
    t.setText(EMOJI_TEXT_CLASSES.has(b.class) ? preprocessEmojiText(t, replaceRubyTags(t, b.ruby, s)) : replaceRubyTags(t, b.ruby, s));
    const top = hasRubyInFirstLine(s) ? b.uiRubyText._rubyMarginTop : this.originMarginTop;
    if (top !== t.margin.y) t.setMargin({ ...t.margin, y: top });
  }
}
