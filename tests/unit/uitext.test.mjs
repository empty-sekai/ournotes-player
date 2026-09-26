// TextMesh Pro layout (src/engine/uitext.js) on a synthetic font asset: glyph placement, spacing, line feeds,
// alignment, rich-text tags, word wrapping, line offset adjustment, autosize, visibility, meshes, and the
// UIGradientImage mesh modifier. Synthetic inputs only; the expected values are TMP's formulas worked by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { UIMesh } from "../../src/engine/ugui.js";
import { TMPText, TMP_H, TMP_V, UIGradientMod, tmpConvertToFloat, tmpIsBaseGlyph, tmpIsCJK, tmpIsHangul, tmpMarkColor, tmpTokens,
         tmpUnsupported } from "../../src/engine/uitext.js";

const close = (a, b, eps = 1e-4, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

// point size 100, ascent 90, descent -30, line height 120 (line gap 0); every glyph 50 x 70, bearing (5, 70),
// advance 60; space: advance 30, no outline
const glyphsOf = (chars) => {
  const characters = {}, glyphs = {};
  [...chars].forEach((ch, i) => {
    const u = ch.codePointAt(0), gi = i + 1, space = ch === " ";
    characters[String(u)] = { glyph: gi, scale: 1, elementType: 1 };
    glyphs[String(gi)] = {
      metrics: space ? { m_Width: 0, m_Height: 0, m_HorizontalBearingX: 0, m_HorizontalBearingY: 0, m_HorizontalAdvance: 30 }
                     : { m_Width: 50, m_Height: 70, m_HorizontalBearingX: 5, m_HorizontalBearingY: 70, m_HorizontalAdvance: 60 },
      rect: space ? { m_X: 0, m_Y: 0, m_Width: 0, m_Height: 0 } : { m_X: (i % 16) * 64 + 8, m_Y: Math.floor(i / 16) * 96 + 8, m_Width: 50, m_Height: 70 },
      scale: 1, atlasIndex: 0, packed: { texture: "page0", dx: 0, dy: 0 },
    };
  });
  return { characters, glyphs };
};
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 <>=!?.,一二三。「」_- ，";
const font = {
  name: "Test SDF",
  faceInfo: { m_PointSize: 100, m_Scale: 1, m_LineHeight: 120, m_AscentLine: 90, m_DescentLine: -30, m_Baseline: 0, m_TabWidth: 25 },
  normalStyle: 0, normalSpacingOffset: 0, boldStyle: 0.75, boldSpacing: 7, tabSize: 10,
  ...glyphsOf(CHARS), glyphPairAdjustmentRecords: 0,
  textureSize: { page0: { width: 1024, height: 1024 } },
  lineBreaking: { leading: "「", following: "」。", useModernHangulLineBreakingRules: false },   // leading: never ends a line; following: never starts one
};
const material = { material: "Test - Default", keywords: [],
                   floats: { _GradientScale: 10, _ScaleRatioA: 1, _ScaleRatioC: 1, _FaceDilate: 0, _OutlineWidth: 0, _OutlineSoftness: 0 } };
const host = { fontAsset: () => font, material: () => material };

const record = (over = {}) => ({
  class: "TextMeshProUGUI", enabled: 1, m_fontSize: 36, m_fontSizeBase: 36, m_enableAutoSizing: 0, m_fontSizeMin: 18,
  m_fontSizeMax: 72, m_charWidthMaxAdj: 0, m_lineSpacingMax: 0, m_fontStyle: 0, m_HorizontalAlignment: TMP_H.Left,
  m_VerticalAlignment: TMP_V.Top, m_characterSpacing: 0, m_wordSpacing: 0, m_paragraphSpacing: 0, m_TextWrappingMode: 0,
  m_overflowMode: 0, m_isRichText: 1, m_parseCtrlCharacters: 1, m_overrideHtmlColors: 0, m_useMaxVisibleDescender: 1,
  m_margin: { x: 0, y: 0, z: 0, w: 0 }, m_fontColor: { r: 1, g: 1, b: 1, a: 1 }, m_ActiveFontFeatures: [],
  m_isOrthographic: 1, m_isRightToLeft: 0, m_enableVertexGradient: 0, m_characterHorizontalScale: 1,
  m_horizontalMapping: 0, m_verticalMapping: 0, m_enableExtraPadding: 0,
  localized: { fontAsset: "Test SDF", material: "Test - Default", lineSpacing: 0 }, ...over,
});
const make = (text, over = {}, rect = { x: 0, y: -200, w: 1000, h: 200 }) => {
  const t = new TMPText(host, { path: "Test/Text", rect }, record(over));
  t.setText(text);
  t.generate();
  return t;
};

test("material padding and glyph quads (size 36, top left)", () => {
  const t = make("AB");
  assert.equal(t.padding, 1.25);                              // (0 + 0) * GS + 1.25
  const [a, b] = t.chars;
  close(a.x0, F(3.75 * F(0.36)));                              // (bearingX - padding) * scale
  close(a.y1, F(71.25 * F(0.36)));                             // (bearingY + padding) * scale
  close(a.y0, F(a.y1 - F(72.5 * F(0.36))));
  close(a.x1 - a.x0, F(52.5 * F(0.36)));
  close(a.xAdvance, 21.6); close(b.xAdvance, 43.2);
  close(t.anchor.y, -32.4);                                    // rect top - max ascender (90 * 0.36)
  close(t.chars[0].quad[1], F(a.y0 - 32.4));
  // uv: glyph rect grown by the padding
  close(a.uv[0], (8 - 1.25) / 1024, 1e-7); close(a.uv[3], (8 + 70 + 1.25) / 1024, 1e-7);
  assert.equal(a.xScale, a.scale);
});

test("character spacing and bold advance", () => {
  const t = make("AB", { m_characterSpacing: 2 });
  close(t.chars[1].xAdvance - t.chars[0].xAdvance, 21.6 + 0.72);
  const b = make("AB", { m_fontStyle: 1 });
  close(b.chars[0].xAdvance, 21.6 + 7 * 0.36);                // boldSpacing 7 / 100 em
  assert.ok(b.chars[0].xScale < 0);                            // bold flag in the SDF scale sign
  close(b.chars[0].SP, F(F(0.75 / 4) * 10));                   // style padding
});

test("line feed: line pitch, paragraph spacing and localized line spacing", () => {
  const t = make("A\nB");
  assert.equal(t.lines.length, 2);
  close(t.lines[0].baseline - t.lines[1].baseline, 43.2);      // -desc + asc + gap
  const s = make("A\nB", { localized: { fontAsset: "Test SDF", material: "Test - Default", lineSpacing: 5 } });
  close(s.lines[0].baseline - s.lines[1].baseline, 43.2 + 1.8);
  const p = make("A\nB", { m_paragraphSpacing: 10 });
  close(p.lines[0].baseline - p.lines[1].baseline, 43.2 + 3.6);
  const e = make("A\\nB");                                     // parseCtrlCharacters: \n is a line feed
  assert.equal(e.lines.length, 2);
  const br = make("A<br>B");
  assert.equal(br.lines.length, 2);
});

test("horizontal alignment uses the line's max advance", () => {
  const c = make("AB", { m_HorizontalAlignment: TMP_H.Center });
  close(c.chars[0].offset.x, 500 - 43.2 / 2, 1e-3);         // width of the text area = rect width + 0.0001
  const r = make("AB", { m_HorizontalAlignment: TMP_H.Right });
  close(r.chars[0].offset.x, 1000.0001 - 43.2, 1e-3);
  const m = make("AB", { m_VerticalAlignment: TMP_V.Middle });
  close(m.anchor.y, -100 - (32.4 + -10.8) / 2);
});

test("rich text: colour, size, voffset, cspace, align, bold", () => {
  const col = make("<color=#FF000080>A</color>B");
  assert.deepEqual(col.chars[0].color, [255, 0, 0, 128]);
  assert.deepEqual(col.chars[1].color, [255, 255, 255, 255]);
  const sz = make("A<size=200%>B</size>C");
  close(sz.chars[1].scale, 0.72); close(sz.chars[2].scale, 0.36);
  close(sz.anchor.y, -64.8);                                   // the larger ascender sets the first line
  const caseless = make("<Size=200%>A");
  close(caseless.chars[0].scale, 0.72);
  const vo = make("A<voffset=0.5em>B");
  close(vo.chars[1].y1 - vo.chars[0].y1, 18);                  // 0.5 em at size 36
  const cs = make("<cspace=1em>AB");
  close(cs.chars[0].xAdvance, 21.6 + 36);
  const al = make("<align=\"right\">A</align>\nB");
  assert.equal(al.lines[0].alignment, TMP_H.Right);
  assert.equal(al.lines[1].alignment, TMP_H.Left);
  const b = make("<b>A</b>B");
  assert.ok(b.chars[0].xScale < 0 && b.chars[1].xScale > 0);
  const sp = make("A<space=10>B");
  close(sp.chars[1].xAdvance - sp.chars[0].xAdvance, 21.6 + 10);
  const pos = make("A<pos=1em>B");
  close(pos.chars[1].x0, F(36 + F(3.75 * F(0.36))));
  const rot = make("<rotate=90>A");
  const [bl, tl] = rot.chars[0].corners;
  close(tl[1], bl[1], 1e-3);                                   // a quarter turn lays the left edge flat
});

test("tags TMP does not know are text; known tags outside the subset raise", () => {
  assert.equal(make("<3").chars.length, 2);
  assert.equal(make("<ABC>").chars.length, 5);
  assert.throws(() => make("<i>A"), /not implemented/);
  assert.throws(() => make("<mark=#FF000080 padding=1,1,1,1>A"), /mark attributes/);
  assert.deepEqual(tmpUnsupported("<size=150%>A"), []);
  assert.equal(tmpUnsupported("<u>A</u>").length, 1);
  assert.equal(tmpTokens("<color=#FFF>A").length, 2);
  assert.equal(tmpConvertToFloat("175"), 175);
  close(tmpConvertToFloat("-0.25"), -0.25, 1e-6);
});

test("word wrap at a space (Normal wrapping)", () => {
  const rect = { x: 0, y: -200, w: 120, h: 200 };             // "AAA" = 64.8 wide, "AAA AAA" = 140.4
  const t = make("AAA AAA", { m_TextWrappingMode: 1 }, rect);
  assert.equal(t.lines.length, 2);
  assert.equal(t.lines[0].last, 3);                            // the space ends the first line
  assert.equal(t.chars[4].lineNumber, 1);
  close(t.chars[4].x0, F(3.75 * F(0.36)));                    // the new line starts at x 0
  close(t.lines[0].baseline - t.lines[1].baseline, 43.2);
  const nowrap = make("AAA AAA", {}, rect);
  assert.equal(nowrap.lines.length, 1);                        // NoWrap: overflow
  const word = make("AAAAAAA", { m_TextWrappingMode: 1 }, rect);
  assert.equal(word.lines.length, 2);                          // a word longer than the line breaks per character
  assert.equal(word.lines[0].last, 4);                         // 5 x 21.6 fits in 120, 6 do not
  const cjk = make("一二三。一二三", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 70, h: 200 });
  assert.ok(cjk.lines.length > 1);
  for (const ln of cjk.lines) assert.notEqual(cjk.chars[ln.first].u, 0x3002);   // "。" never starts a line
});

test("word wrap rules of the game's TMP: CJK ranges, Latin before CJK, '-' after a space, U+00A0, U+0003", () => {
  assert.equal(tmpIsCJK(0x4E00), true); assert.equal(tmpIsCJK(0xFF0C), false);   // full-width comma: not CJK
  assert.equal(tmpIsCJK(0x3001), true); assert.equal(tmpIsCJK(0x20000), true); assert.equal(tmpIsCJK(0x41), false);
  assert.equal(tmpIsHangul(0xAC00), true); assert.equal(tmpIsHangul(0xD7B0), true); assert.equal(tmpIsHangul(0x3131), true);
  assert.equal(tmpIsBaseGlyph(0x301), false); assert.equal(tmpIsBaseGlyph(0x41), true); assert.equal(tmpIsBaseGlyph(0x5C0), true);
  // "A AA一": after the first word, a Latin character before a CJK one is a break opportunity (一 ends at 97.2 > 90)
  const lc = make("A AA一", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 90, h: 200 });
  assert.equal(lc.lines.length, 2); assert.equal(lc.lines[0].last, 3);
  // "A，一": the full-width comma is no CJK character: no break after it, the first word breaks per character
  const fw = make("AA，一", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 70, h: 200 });
  assert.equal(fw.lines[0].last, 2);
  // "A -BB": no break opportunity at a '-' after a space: the line breaks at the space, "-BB" moves down
  const hy = make("AA -BB", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 100, h: 200 });
  assert.equal(hy.lines.length, 2); assert.equal(hy.chars[hy.lines[1].first].u, 0x2D);
  // U+00A0 is no soft break of the first word: a long first word breaks per character
  const nb = make("AA AAA", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 100, h: 200 });
  assert.equal(nb.lines[0].last, 3);
  // "AA。" in the first word of a line: before a following character a Latin one is still a first-word break
  // opportunity ("。" ends at 64.8 > 60: the line breaks before it)
  const fo = make("AA\u3002", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 60, h: 200 });
  assert.equal(fo.lines.length, 2); assert.equal(fo.lines[0].last, 1);
  // U+0003 ends the text
  assert.equal(make("ABCD").chars.length, 3);
  assert.throws(() => make("A", { m_TextWrappingMode: 3 }), /wrapping mode 3/);
});

test("line max advance: the cspace of the line end is taken off with the spacing", () => {
  const t = make("<cspace=10>AB", { m_HorizontalAlignment: TMP_H.Right });
  close(t.lines[0].maxAdvance, F(F(F(21.6 + 10) * 2) - 10), 1e-3);
});

test("a larger line after the first moves down (AdjustLineOffset)", () => {
  const t = make("A\n<size=200%>B");
  close(t.lines[0].baseline - t.lines[1].baseline, 43.2 + 32.4);  // extra ascender 64.8 - 32.4
});

test("maxVisibleCharacters hides the rest; meshes carry four vertices per visible glyph", () => {
  const t = new TMPText(host, { path: "T", rect: { x: 0, y: -200, w: 1000, h: 200 } }, record());
  t.setText("AB C");
  t.setMaxVisible(2);
  const [m] = t.meshes();
  assert.equal(m.verts.length, 8); assert.equal(m.idx.length, 12); assert.equal(m.texture, "page0");
  assert.equal(t.chars[3].hiddenByMaxVisible, true);
});

test("autosize shrinks to fit and the preferred width rounds up to 0.01", () => {
  const rect = { x: 0, y: -60, w: 100, h: 60 };
  const t = make("AAAAAA", { m_enableAutoSizing: 1, m_fontSizeBase: 40, m_fontSizeMin: 10, m_fontSizeMax: 40 }, rect);
  assert.ok(t.renderedFontSize < 40 && t.renderedFontSize >= 10);
  const last = t.chars[t.chars.length - 1];
  assert.ok(last.xAdvance <= 100.001);
  const p = new TMPText(host, { path: "T", rect }, record());
  p.setText("AB");
  assert.equal(p.preferredWidth(), F(43.21));                  // trunc((43.2 * 100) + 1) / 100
});

test("preferred height (CalculatePreferredValues): lines, wrapping at the rect width, line spacing, margins", () => {
  const ph = (text, over = {}, w = 1000) => {
    const t = new TMPText(host, { path: "T", rect: { x: 0, y: -100, w, h: 100 } }, record(over));
    t.setText(text);
    return t.preferredHeight();
  };
  const round = (v) => F(Math.trunc(F(F(v * 100) + 1)) / 100);
  const pitch = F(F(F(0 + 10.8) + F(32.4))), one = F(F(32.4) + F(10.8));
  assert.equal(ph("A"), round(one));                            // ascender 32.4 - descender -10.8
  assert.equal(ph("A\nB"), round(F(F(32.4) - F(F(-10.8) - pitch))));
  assert.equal(ph("A\n"), round(one), "a trailing line feed adds no line: whitespace is not measured");
  const wrapped = ph("AAA AAA", { m_TextWrappingMode: 1 }, 120), nowrap = ph("AAA AAA", {}, 120);
  assert.equal(wrapped, ph("A\nB")); assert.equal(nowrap, round(one));
  assert.equal(ph("AAA AAA", { m_TextWrappingMode: 1 }, 200), round(one), "fits: one line");
  const ls = ph("A\nB", { localized: { fontAsset: "Test SDF", material: "Test - Default", lineSpacing: 5 } });
  assert.equal(ls, round(F(F(32.4) - F(F(-10.8) - F(pitch + F(1.8))))));
  // a taller second line: the height at its first character (before the line moves down), plus the move (the line
  // spacing adjustment adds it to the rendered height)
  assert.equal(ph("A\n<size=200%>B"), round(F(F(64.8 - 32.4) + F(F(32.4) - F(F(-21.6) - pitch)))));
  // the lowest descender so far counts: a smaller last character does not lower the height
  assert.equal(ph("<size=200%>A</size>B"), round(F(F(64.8) + F(21.6))));
  // positive margins add (top and bottom), negative ones do not; the wrap width is the rect less left / right
  assert.equal(ph("A", { m_margin: { x: 0, y: 5, z: 0, w: -3 } }), round(F(one + 5)));
  assert.equal(ph("AAA AAA", { m_TextWrappingMode: 1, m_margin: { x: 50, y: 0, z: 40, w: 0 } }, 200), ph("A\nB"));
  // cached per text and width
  const t = new TMPText(host, { path: "T", rect: { x: 0, y: -100, w: 120, h: 100 } }, record({ m_TextWrappingMode: 1 }));
  t.setText("AAA AAA");
  assert.equal(t.preferredHeight(), wrapped);
  t.node.rect = { x: 0, y: -100, w: 1000, h: 100 };
  assert.equal(t.preferredHeight(), round(one));
});

test("layout is deterministic", () => {
  const a = make("<size=150%>AB</size> C\nD", { m_TextWrappingMode: 1 }, { x: 0, y: -100, w: 90, h: 100 });
  const b = make("<size=150%>AB</size> C\nD", { m_TextWrappingMode: 1 }, { x: 0, y: -100, w: 90, h: 100 });
  assert.deepEqual(JSON.stringify(a.meshes()), JSON.stringify(b.meshes()));
});

test("<mark>: highlight runs from the characters' bounds, colours, state changes, line ends, visibility", () => {
  const a = make("<mark=#FF000080>AB</mark>C");
  assert.equal(a.highlights.length, 1);
  const [h] = a.highlights, [A, B] = a.chars;
  close(h.x0, F(A.x0 + A.offset.x), 1e-6); close(h.x1, F(B.x1 + B.offset.x), 1e-6);
  close(h.y0, F(-30 * 0.36) - 32.4, 1e-4); close(h.y1, F(90 * 0.36) - 32.4, 1e-4);   // the character's descender / ascender
  assert.deepEqual(h.color, [255, 0, 0, 128]);
  assert.deepEqual(make("<mark>A").highlights[0].color, [255, 255, 0, 64]);          // default yellow
  assert.deepEqual(make("<color=#FFFFFF20><mark=#00FF00>A").highlights[0].color, [0, 255, 0, 0x20]);   // html alpha
  assert.deepEqual(tmpMarkColor("#F00"), [255, 255, 255, 255]);                      // only 7 or 9 characters
  assert.deepEqual(make("<mark=\"#F00\">A").highlights[0].color, [255, 255, 0, 64]); // a string value: default
  // a state change inside a run: drawn up to the middle, a new run with the new state
  const s = make("<mark=#FF0000FF>A<mark=#00FF00FF>B</mark>C</mark>");
  assert.deepEqual(s.highlights.map((x) => x.color[1]), [0, 255, 0]);
  const [A1, B1] = s.chars, mid = F(F(F(B1.x0 + B1.offset.x) + F(A1.x1 + A1.offset.x)) * 0.5);
  close(s.highlights[0].x1, mid, 1e-6); close(s.highlights[1].x0, mid, 1e-6);
  // one run per line of a wrapped text; the trailing space of the first line is not highlighted
  const w = make("<mark>AAA AAA</mark>", { m_TextWrappingMode: 1 }, { x: 0, y: -200, w: 120, h: 200 });
  assert.equal(w.highlights.length, 2);
  close(w.highlights[0].x1, F(w.chars[2].x1 + w.chars[2].offset.x), 1e-6);
  // maxVisibleCharacters k: the characters up to index k + 1 are still inside the run
  const t = new TMPText(host, { path: "T", rect: { x: 0, y: -200, w: 1000, h: 200 } }, record());
  t.setText("<mark>ABCDE"); t.setMaxVisible(1); t.generate();
  close(t.highlights[0].x1, F(t.chars[2].x1 + t.chars[2].offset.x), 1e-6);
  // mesh: the highlight quad after the glyphs of material 0, uv0 = the centre of '_' +- a texel, w 0, uv1 (0, 1)
  const m = make("<mark=#FF000080>AB</mark>C");
  const [mesh] = m.meshes();
  assert.equal(mesh.verts.length, 16);
  const q = mesh.verts.slice(12), us = font.glyphs[font.characters["95"].glyph].rect;
  close(q[0].u, F(F(us.m_X + us.m_Width / 2) / 1024) - F(1 / 1024), 1e-7);
  close(q[2].v, F(F(us.m_Y + us.m_Height / 2) / 1024) + F(1 / 1024), 1e-7);
  assert.equal(q[0].w, 0); assert.equal(q[1].v1, 1); assert.deepEqual(q[3].c, [255, 0, 0, 128]);
  assert.deepEqual(mesh.idx.slice(18), [12, 13, 14, 14, 15, 12]);
  assert.equal(make("ABC").highlights.length, 0);
});

test("UIGradientImage: horizontal gradient split at the keys", () => {
  const m = new UIMesh();
  m.addQuad(0, 0, 100, 10, [255, 255, 255, 255], 0, 0, 1, 1);
  const grad = { angleDeg: 0, splitAtKeysWhenAxisAligned: 1, blendMode: 0,
                 gradient: { m_Mode: 0, m_ColorSpace: 0, m_NumColorKeys: 2, m_NumAlphaKeys: 3,
                             key0: { r: 1, g: 0, b: 0, a: 1 }, key1: { r: 0, g: 0, b: 1, a: 0.5 }, key2: { r: 0, g: 0, b: 0, a: 0 },
                             ctime0: 0, ctime1: 65535, atime0: 0, atime1: 32768, atime2: 65535 } };
  const out = UIGradientMod.apply(m, grad);
  const at = (x) => out.verts.find((v) => Math.abs(v.x - x) < 1e-6);
  assert.deepEqual(at(0).c, [255, 0, 0, 255]);
  assert.deepEqual(at(100).c, [0, 0, 255, 0]);
  assert.ok(at(50.0007629) || out.verts.some((v) => Math.abs(v.x - 50) < 0.01));  // a vertex on the alpha key
});
