import { UIError } from "../engine/ugui.js";
import { TMP_SYNTHESIZED } from "../engine/uitext.js";

// Glyphs of a font the browser draws, as a TextMeshPro SDF font asset: the glyph records, the metrics and the SDF page
// TMPText lays text out with and the text shader samples, made when a character is first looked up (ui/fonts.json font
// entries with `browser`). Layout stays TextMeshPro's: only the source of the glyph data differs.
//
// Per glyph (the method of the open-font data, nnnotes `story` fonts):
// - metrics: the glyph's box at the font asset's point size (bearings, size, advance with 1/64 precision);
// - cell: the box with each edge rounded to the nearest pixel (ties outwards), grown by `margin` texels on every side
//   (ceil(gradientScale) + ceil(max underlay offset x gradientScale) + 1);
// - raster: the glyph drawn k x larger (k from the render mode: 8 for SDF8 and above, else 1), a pixel set when its
//   alpha reaches one half;
// - field: d = distance to the nearest outside pixel for an inside pixel, minus the distance to the nearest inside pixel
//   for an outside one (centre to centre, exact Euclidean); for k > 1 the mean of the central 2 x 2 fine pixels of each
//   texel, divided by k;
// - texel: alpha = floor(255 x clamp(0.5 + d / (2 x spread), 0, 1) + 0.5), spread = padding + 1 (the material's
//   _GradientScale); the other channels are 0.
// Cells are packed in shelves on one page (U+005F first: TMP's underline and highlight quads sample it), origin at the
// bottom left like the rects of the glyph records.

export const RENDER_MODE = Object.freeze({ SDF: 4134, SDFAA: 4165, SDFAAHinted: 4169, SDF8: 8230, SDF16: 16422, SDF32: 32806 });
export const MAX_OVERSAMPLE = 8;

// the oversampling of an atlas render mode: the SDF8, SDF16 and SDF32 modes sample 8 x, the others once
export const oversampleOf = (mode) => ((mode & 0x2000) || (mode & 0x4000) || (mode & 0x8000) ? MAX_OVERSAMPLE : 1);

// the box in whole pixels of a glyph box (bearing x / y, width, height): each edge to the nearest pixel, ties outwards
// -> [x, y, width, height] with y the bottom edge
export function pixelBox(bearingX, bearingY, width, height) {
  const x0 = bearingX, x1 = bearingX + width, y1 = bearingY, y0 = bearingY - height;
  const x = Math.ceil(x0 - 0.5) + 0, y = Math.ceil(y0 - 0.5) + 0;       // + 0: no negative zero
  return [x, y, Math.floor(x1 + 0.5) - x, Math.floor(y1 + 0.5) - y];
}

const FAR = 1e20;

// the squared distance of every pixel to the nearest one with bg[i] set (exact, two passes of the 1-D lower envelope)
function squaredDistance(bg, cols, rows) {
  const n = cols * rows, out = new Float64Array(n), len = Math.max(cols, rows);
  const f = new Float64Array(len), d = new Float64Array(len), v = new Int32Array(len), z = new Float64Array(len + 1);
  const line = (m) => {
    let k = 0;
    v[0] = 0; z[0] = -FAR; z[1] = FAR;
    for (let q = 1; q < m; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = FAR;
    }
    k = 0;
    for (let q = 0; q < m; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) f[y] = bg[y * cols + x] ? 0 : FAR;
    line(rows);
    for (let y = 0; y < rows; y++) out[y * cols + x] = d[y];
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) f[x] = out[y * cols + x];
    line(cols);
    for (let x = 0; x < cols; x++) out[y * cols + x] = d[x];
  }
  return out;
}

// the signed distance of every pixel of `mask` (1 inside) to the outline: positive inside, negative outside, +-1 next to
// the edge
export function signedDistance(mask, cols, rows) {
  const n = cols * rows, inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
  const toOutside = squaredDistance(inv, cols, rows), toInside = squaredDistance(mask, cols, rows);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] ? Math.sqrt(toOutside[i]) : -Math.sqrt(toInside[i]);
  return out;
}

// the alpha texels of a cell: `mask` is cols x rows fine pixels (k per texel, top row first); -> Uint8Array of
// (cols / k) x (rows / k) texels, top row first; zeros for an empty raster
export function sdfTexels(mask, cols, rows, k, spread) {
  const tc = cols / k, tr = rows / k, out = new Uint8Array(tc * tr);
  if (!mask.some((m) => m)) return out;
  const d = signedDistance(mask, cols, rows), lo = (k - 1) >> 1, hi = (k >> 1) + 1, cnt = (hi - lo) * (hi - lo);
  for (let i = 0; i < tr; i++) {
    for (let j = 0; j < tc; j++) {
      let s = 0;
      for (let a = lo; a < hi; a++) for (let b = lo; b < hi; b++) s += d[(i * k + a) * cols + j * k + b];
      const v = s / cnt / k;
      out[i * tc + j] = Math.floor(255 * Math.min(1, Math.max(0, 0.5 + v / (2 * spread))) + 0.5);
    }
  }
  return out;
}

// A rasterizer over Canvas 2D (OffscreenCanvas, else a canvas element): metrics(cp) -> {advance, xMin, xMax, yMin, yMax}
// of the glyph at the point size in pixels (y up from the baseline), mask(cp, grid) -> Uint8Array of grid.cols x
// grid.rows pixels (top row first, 1 where the glyph's alpha reaches one half). grid = {k, x0, yTop, cols, rows}: the
// pixels cover x from x0 on and y from yTop down, k pixels per unit, the glyph's origin and baseline at (0, 0).
export function canvasRasterizer({ family, weight = "normal", style = "normal", pointSize, createCanvas }) {
  const make = createCanvas || ((w, h) => {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
    throw new UIError("a browser font needs OffscreenCanvas or a document to draw its glyphs");
  });
  const font = (px) => `${style} ${weight} ${px}px ${family}`;
  const measure = make(1, 1).getContext("2d");
  const surface = make(1, 1), ctx = surface.getContext("2d", { willReadFrequently: true });
  return {
    metrics(cp) {
      measure.font = font(pointSize);
      const t = measure.measureText(String.fromCodePoint(cp));
      return { advance: Math.round(t.width * 64) / 64, xMin: -t.actualBoundingBoxLeft, xMax: t.actualBoundingBoxRight,
               yMin: -t.actualBoundingBoxDescent, yMax: t.actualBoundingBoxAscent };
    },
    mask(cp, g) {
      surface.width = g.cols; surface.height = g.rows;
      ctx.font = font(pointSize * g.k);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.fillStyle = "#fff";
      ctx.clearRect(0, 0, g.cols, g.rows);
      ctx.fillText(String.fromCodePoint(cp), -g.x0 * g.k, g.yTop * g.k);
      const px = ctx.getImageData(0, 0, g.cols, g.rows).data, out = new Uint8Array(g.cols * g.rows);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
      return out;
    },
  };
}

// The font asset data of one browser font: `characters` and `glyphs` (TextMeshPro's records) grow as ensure(cp) is
// called, `textureSize` names the one page they are on.
export class BrowserGlyphFont {
  // spec: {name, pointSize, padding, renderMode, underlayOffset?, pageWidth?, pageHeight?}; raster = canvasRasterizer's shape
  constructor(spec, raster) {
    if (!(spec.pointSize > 0) || !Number.isInteger(spec.pointSize)) throw new UIError(`${spec.name}: browser font point size ${spec.pointSize} is not a whole number`);
    this.name = spec.name;
    this.raster = raster;
    this.pointSize = spec.pointSize;
    this.k = oversampleOf(spec.renderMode);
    this.spread = spec.padding + 1;
    this.margin = Math.ceil(this.spread) + Math.ceil((spec.underlayOffset || 0) * this.spread) + 1;
    this.page = `${spec.name}#browser`;
    this.width = spec.pageWidth || 2048;
    this.height = spec.pageHeight || 2048;
    this.alpha = new Uint8Array(this.width * this.height);          // bottom row first
    this.textureSize = { [this.page]: { width: this.width, height: this.height } };
    this.characters = {};
    this.glyphs = {};
    this.listeners = new Set();
    this.shelf = { x: 0, y: 0, h: 0 };
    this.used = 0;                                                  // rows of the page in use
    this.nextGlyph = 1;
    this.ensure(0x5F);                                              // the underline and highlight glyph, first on the page
  }

  // make the glyph of code point `cp` when the font has none; -> true when it has one now (TextMeshPro's synthesized
  // control characters get none: its zero glyph stands in for them)
  ensure(cp) {
    if (this.characters[cp]) return true;
    if (TMP_SYNTHESIZED.has(cp)) return false;
    const m = this.raster.metrics(cp), w = m.xMax - m.xMin, h = m.yMax - m.yMin;
    const [bx, by, bw, bh] = w > 0 && h > 0 ? pixelBox(m.xMin, m.yMax, w, h) : [0, 0, 0, 0];
    const id = this.nextGlyph++;
    const glyph = {
      metrics: bw > 0 && bh > 0
        ? { m_Width: w, m_Height: h, m_HorizontalBearingX: m.xMin, m_HorizontalBearingY: m.yMax, m_HorizontalAdvance: m.advance }
        : { m_Width: 0, m_Height: 0, m_HorizontalBearingX: 0, m_HorizontalBearingY: 0, m_HorizontalAdvance: m.advance },
      rect: { m_X: 0, m_Y: 0, m_Width: 0, m_Height: 0 }, scale: 1, atlasIndex: 0,
    };
    if (bw > 0 && bh > 0) {
      const mg = this.margin, cols = bw + 2 * mg, rows = bh + 2 * mg, k = this.k;
      const mask = this.raster.mask(cp, { k, x0: bx - mg, yTop: by + bh + mg, cols: cols * k, rows: rows * k });
      const texels = sdfTexels(mask, cols * k, rows * k, k, this.spread);
      const at = this._place(cols, rows);
      for (let r = 0; r < rows; r++) {
        const row = at.y + (rows - 1 - r);
        this.alpha.set(texels.subarray(r * cols, (r + 1) * cols), row * this.width + at.x);
      }
      this._dirty(at.y, at.y + rows);
      glyph.rect = { m_X: at.x + mg, m_Y: at.y + mg, m_Width: bw, m_Height: bh };
      glyph.packed = { texture: this.page, dx: 0, dy: 0 };
    }
    this.glyphs[id] = glyph;
    this.characters[cp] = { glyph: id, scale: 1 };
    return true;
  }

  _place(w, h) {
    const s = this.shelf;
    if (w > this.width) throw new UIError(`${this.name}: a glyph cell of ${w} texels does not fit the ${this.width} texel page`);
    if (s.x + w > this.width) { s.y += s.h; s.x = 0; s.h = 0; }
    if (s.y + h > this.height)
      throw new UIError(`${this.name}: the ${this.width} x ${this.height} glyph page is full (${Object.keys(this.characters).length} characters)`);
    const at = { x: s.x, y: s.y };
    s.x += w; s.h = Math.max(s.h, h);
    return at;
  }

  _dirty(y0, y1) {
    this.used = Math.max(this.used, y1);
    for (const l of this.listeners) l.mark(y0, y1);
  }

  // A GL texture of the page that follows the glyphs made after it
  texture(gl) {
    const t = new GlyphPageTexture(gl, this);
    this.listeners.add(t);
    return t;
  }
}

// The GL texture of a browser font's page. Reading `glyphTexture` uploads the rows changed since the last read, so the
// draw code that binds it needs no knowledge of glyphs made after the texture.
export class GlyphPageTexture {
  constructor(gl, font) {
    this.gl = gl; this.font = font; this.width = font.width; this.height = font.height; this.label = font.page;
    this._t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lo = 0; this.hi = font.used;
  }

  mark(y0, y1) {
    if (this.hi <= this.lo) { this.lo = y0; this.hi = y1; } else { this.lo = Math.min(this.lo, y0); this.hi = Math.max(this.hi, y1); }
  }

  get glTexture() { this.flush(); return this._t; }

  flush() {
    if (this.hi <= this.lo) return;
    const gl = this.gl, w = this.width, rows = this.hi - this.lo, px = new Uint8Array(w * rows * 4);
    const src = this.font.alpha;
    for (let i = 0, s = this.lo * w; i < w * rows; i++) px[i * 4 + 3] = src[s + i];
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, this._t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.lo, w, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindTexture(gl.TEXTURE_2D, bound);
    this.lo = this.hi = 0;
  }

  dispose() {
    this.font.listeners.delete(this);
    this.gl.deleteTexture(this._t);
  }
}
