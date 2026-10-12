// Browser fonts (src/story/browser-font.js): the SDF glyph data TMPText lays out, made from a rasterizer. Synthetic
// inputs only: the rasterizer draws filled boxes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { TMPText } from "../../src/engine/uitext.js";
import { BrowserGlyphFont, oversampleOf, pixelBox, sdfTexels, signedDistance } from "../../src/story/browser-font.js";
import { StoryFontAssets } from "../../src/story/ui-fonts.js";

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// every glyph a 50 x 70 box at (5, 0) with advance 60, the space an empty box of advance 30
const boxRaster = () => ({
  metrics: (cp) => (cp === 0x20 ? { advance: 30, xMin: 0, xMax: 0, yMin: 0, yMax: 0 }
                                : { advance: 60, xMin: 5, xMax: 55, yMin: 0, yMax: 70 }),
  mask(cp, g) {
    const out = new Uint8Array(g.cols * g.rows);
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const x = g.x0 + (c + 0.5) / g.k, y = g.yTop - (r + 0.5) / g.k;
      out[r * g.cols + c] = x >= 5 && x < 55 && y >= 0 && y < 70 ? 1 : 0;
    }
    return out;
  },
});

test("pixel boxes round each edge to the nearest pixel, ties outwards", () => {
  assert.deepEqual(pixelBox(0.4, 10.4, 5.2, 10.4), [0, 0, 6, 10]);
  assert.deepEqual(pixelBox(-0.5, 7.5, 3, 8), [-1, -1, 4, 9]);             // -0.5 -> -1, 7.5 -> 8, 2.5 -> 3: outwards
  assert.deepEqual(pixelBox(1.5, 3, 2, 3), [1, 0, 3, 3]);                  // x1 3.5 -> 4 outwards
});

test("render modes: SDF8 and above sample 8 x, the others once", () => {
  assert.deepEqual([4134, 4165, 4169, 8230, 16422, 32806].map(oversampleOf), [1, 1, 1, 8, 8, 8]);
});

test("signed distance: centre to centre, +-1 next to the edge", () => {
  const m = new Uint8Array(25);
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3]]) m[y * 5 + x] = 1;
  const d = signedDistance(m, 5, 5);
  assert.equal(d[2 * 5 + 2], 2);                                           // centre: two pixels to the outside
  assert.equal(d[2 * 5 + 1], 1);                                           // edge pixel inside
  assert.equal(d[2 * 5 + 0], -1);                                          // next to it outside
  close(d[0], -Math.SQRT2);                                                // the corner, diagonal
});

test("texel encoding: 0.5 on the edge, spread = padding + 1, an empty raster is zeros", () => {
  const m = new Uint8Array(25);
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3]]) m[y * 5 + x] = 1;
  const t = sdfTexels(m, 5, 5, 1, 5);
  assert.equal(t[2 * 5 + 2], Math.floor(255 * (0.5 + 2 / 10) + 0.5));
  assert.equal(t[2 * 5 + 0], Math.floor(255 * (0.5 - 1 / 10) + 0.5));
  assert.ok(sdfTexels(new Uint8Array(25), 5, 5, 1, 5).every((v) => v === 0));
  // k = 2: the central 2 x 2 fine pixels of a texel, mean / k
  const f = new Uint8Array(16).fill(1);
  assert.ok(sdfTexels(f, 4, 4, 2, 5).every((v) => v === 255));
});

test("glyph records: metrics, rect on the page with the margin, U+005F first", () => {
  const f = new BrowserGlyphFont({ name: "B", pointSize: 100, padding: 4, renderMode: 4134, pageWidth: 256, pageHeight: 256 }, boxRaster());
  const us = f.glyphs[f.characters[0x5F].glyph];
  assert.deepEqual(us.rect, { m_X: 6, m_Y: 6, m_Width: 50, m_Height: 70 });   // margin ceil(5) + 1
  assert.deepEqual(us.packed, { texture: "B#browser", dx: 0, dy: 0 });
  assert.equal(f.ensure(0x41), true);
  const a = f.glyphs[f.characters[0x41].glyph];
  assert.deepEqual(a.metrics, { m_Width: 50, m_Height: 70, m_HorizontalBearingX: 5, m_HorizontalBearingY: 70, m_HorizontalAdvance: 60 });
  assert.deepEqual(a.rect, { m_X: 62 + 6, m_Y: 6, m_Width: 50, m_Height: 70 });   // right of the 62 texel wide cell
  assert.equal(a.atlasIndex, 0);
  f.ensure(0x20);
  const s = f.glyphs[f.characters[0x20].glyph];
  assert.equal(s.metrics.m_HorizontalAdvance, 30);
  assert.equal(s.packed, undefined);                                      // empty box: advance only
  assert.equal(f.ensure(0x0A), false);                                    // TMP's synthesized control characters
  assert.equal(f.characters[0x0A], undefined);
  // texels: the page is bottom row first; the cell's row 0 (top) is the page's row y + rows - 1
  const a0 = us.rect.m_X, y0 = us.rect.m_Y;
  assert.equal(f.alpha[(y0 + 35) * 256 + a0 + 25], 255);                  // deep inside: clamped to 1
  assert.equal(f.alpha[(y0 - 6) * 256 + a0 - 6], 0);                      // far outside the glyph in the margin corner
  const edge = f.alpha[(y0 + 0) * 256 + a0 + 25];                         // bottom row of the box, just inside
  assert.equal(edge, Math.floor(255 * (0.5 + 1 / 10) + 0.5));
});

test("a full page raises", () => {
  const f = new BrowserGlyphFont({ name: "B", pointSize: 100, padding: 4, renderMode: 4134, pageWidth: 130, pageHeight: 90 }, boxRaster());
  assert.equal(f.ensure(0x41), true);                                     // beside U+005F on the first shelf
  assert.throws(() => f.ensure(0x42), /glyph page is full/);
});

const glMock = () => {
  const calls = [];
  const gl = { TEXTURE_2D: 1, RGBA8: 2, RGBA: 3, UNSIGNED_BYTE: 4, LINEAR: 5, CLAMP_TO_EDGE: 6, TEXTURE_MAG_FILTER: 7, TEXTURE_MIN_FILTER: 8,
               TEXTURE_WRAP_S: 9, TEXTURE_WRAP_T: 10, TEXTURE_BINDING_2D: 11, UNPACK_ALIGNMENT: 12, UNPACK_FLIP_Y_WEBGL: 13,
               UNPACK_PREMULTIPLY_ALPHA_WEBGL: 14 };
  for (const n of ["bindTexture", "texImage2D", "texParameteri", "pixelStorei", "texSubImage2D", "deleteTexture"])
    gl[n] = (...a) => calls.push([n, ...a]);
  gl.createTexture = () => ({});
  gl.getParameter = () => null;
  return { gl, calls };
};

test("the page texture uploads the rows of glyphs made after it, when it is read", () => {
  const f = new BrowserGlyphFont({ name: "B", pointSize: 100, padding: 4, renderMode: 4134, pageWidth: 256, pageHeight: 256 }, boxRaster());
  const { gl, calls } = glMock();
  const t = f.texture(gl);
  assert.equal(t.width, 256);
  void t.glTexture;
  const sub = () => calls.filter((c) => c[0] === "texSubImage2D");
  assert.equal(sub().length, 1);
  assert.deepEqual(sub()[0].slice(3, 7), [0, 0, 256, 82]);               // x, y, width, rows: U+005F's cell of 82 rows
  void t.glTexture;
  assert.equal(sub().length, 1);                                         // nothing new: no upload
  f.ensure(0x42);
  void t.glTexture;
  assert.equal(sub().length, 2);
  assert.deepEqual(sub()[1].slice(3, 7), [0, 0, 256, 82]);               // same shelf, rows 0 - 82 again
  const data = sub()[1][9];
  assert.equal(data.length, 256 * 82 * 4);
  assert.ok(data.some((v, i) => i % 4 === 3 && v === 255));
  assert.ok(data.every((v, i) => i % 4 === 3 || v === 0));               // only the alpha channel
});

// the layout is the one of a static font with the same glyph metrics
const material = { material: "Test - Default", keywords: [],
                   floats: { _GradientScale: 10, _ScaleRatioA: 1, _ScaleRatioC: 1, _FaceDilate: 0, _OutlineWidth: 0, _OutlineSoftness: 0 } };
const record = (over = {}) => ({
  class: "TextMeshProUGUI", enabled: 1, m_fontSize: 36, m_fontSizeBase: 36, m_enableAutoSizing: 0, m_fontSizeMin: 18,
  m_fontSizeMax: 72, m_charWidthMaxAdj: 0, m_lineSpacingMax: 0, m_fontStyle: 0, m_HorizontalAlignment: 1,
  m_VerticalAlignment: 256, m_characterSpacing: 0, m_wordSpacing: 0, m_paragraphSpacing: 0, m_TextWrappingMode: 0,
  m_overflowMode: 0, m_isRichText: 1, m_parseCtrlCharacters: 1, m_overrideHtmlColors: 0, m_useMaxVisibleDescender: 1,
  m_margin: { x: 0, y: 0, z: 0, w: 0 }, m_fontColor: { r: 1, g: 1, b: 1, a: 1 }, m_ActiveFontFeatures: [],
  m_isOrthographic: 1, m_isRightToLeft: 0, m_enableVertexGradient: 0, m_characterHorizontalScale: 1,
  m_horizontalMapping: 0, m_verticalMapping: 0, m_enableExtraPadding: 0,
  localized: { fontAsset: "Test SDF", material: "Test - Default", lineSpacing: 0 }, ...over,
});
const fontsDoc = () => ({
  source: "open", textures: {},
  fonts: { "Test SDF": {
    faceInfo: { m_PointSize: 100, m_Scale: 1, m_LineHeight: 120, m_AscentLine: 90, m_DescentLine: -30, m_Baseline: 0, m_TabWidth: 25 },
    atlasPadding: 9, atlasRenderMode: 4134, atlasPopulationMode: 1, normalStyle: 0, normalSpacingOffset: 0, boldStyle: 0.75,
    boldSpacing: 7, tabSize: 10, material: "Test - Default", fallbacks: [], glyphPairAdjustmentRecords: 0, characters: {}, glyphs: {},
    browser: { family: "Test", pageWidth: 512, pageHeight: 512 },
  } },
  texts: {},
});

test("TMPText lays out a browser font on demand with the glyphs' own metrics, and draws from its page", () => {
  const assets = new StoryFontAssets(fontsDoc(), null, null, { rasterizer: boxRaster });
  const host = { fontAsset: (n) => assets.get(n), material: () => material };
  const t = new TMPText(host, { path: "Test/Text", rect: { x: 0, y: -200, w: 1000, h: 200 } }, record());
  t.setText("AB <u>C</u>");
  t.generate();
  const [a, b] = t.chars;
  close(a.xAdvance, 21.6); close(b.xAdvance, 43.2);                       // 60 / 100 em x 36
  close(a.uv[0], (72 + 11 - 1.25) / 512, 1e-7);                          // right of U+005F's 72 texel cell, margin 11, padding 1.25
  const meshes = t.meshes();
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].texture, "Test SDF#browser");                    // glyphs and the underline: one page
  assert.ok(assets.browserFonts().get("Test SDF").characters[0x43]);      // made when first looked up
});
