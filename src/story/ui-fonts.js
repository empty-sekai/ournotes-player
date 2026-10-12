import { F } from "../engine/core.js";
import { BrowserGlyphFont, canvasRasterizer } from "./browser-font.js";

// The font asset records a story UI lays its texts out with (the text host's fontAsset, engine/uitext.js).
//
// Font data made from open fonts (ui/fonts.json `source` "open") has glyphs with the metrics of the open font, and
// with them its face's line height, ascent and descent. The game lays text out with the line metrics of its own font
// assets, and the language's line spacing (LocalizeManager.ApplyLanguageLineSpacing) is set for them: English's -100
// (one em less) takes the line gap of the game's primary font (A-OTF-ShinGoPr6N: line height 2 em, ascent 0.88,
// descent -0.12) out. An open face without that gap (Noto Sans CJK: 1.448 em with no gap) would put the lines 0.448 em
// apart, over each other. So an open font asset standing in for a font of the game gets that font's line height,
// ascent and descent in place of its own: the lines are as far apart and sit where the game has them, in every
// language. The glyphs keep their own metrics (the open CJK faces share the game's ideographic em box, 0.88 / -0.12).
//
// The game font of an open font asset, in this order:
// - its font role: the fontRole of the text nodes whose bindings (localized.fontAsset) use it (the story UI's nodes,
//   its dialogs' and chat windows'), or the role ui/languages.json `roles` names it for; the role's line metrics are
//   ui.json `textStyle.roles` (read from the game's font assets of the language);
// - else the game font asset its name stands in for ("<open font> (<game font asset>)", a fallback of another asset
//   such as the Japanese font behind Korean text) when GAME_FONT_LINES has it.
// Data from the game's fonts is taken as it is.

// Line metrics in em of the game's font assets (TMP FaceInfo line height, ascent line, descent line / point size),
// as their data has them: A-OTF-ShinGoPr6N (ja / en primary, the fallback of the Korean and Chinese fonts),
// VibeMOPro (the number role), FZLTH_GB18030L2_R (zh primary), Pretendard SemiBold (ko primary).
export const GAME_FONT_LINES = Object.freeze({
  "A-OTF-ShinGoPr6N-Regular SDF": Object.freeze({ lineHeightEm: 2, ascentEm: 0.88, descentEm: -0.12 }),
  "VibeMOPro-Medium SDF": Object.freeze({ lineHeightEm: 1.2, ascentEm: 0.83, descentEm: -0.17 }),
  "FZLTH_GB18030L2_R SDF": Object.freeze({ lineHeightEm: 1.155, ascentEm: 0.892, descentEm: -0.263 }),
  "Pretendard-SemiBold SDF": Object.freeze({ lineHeightEm: 1.192871, ascentEm: 0.95166, descentEm: -0.241211 }),
});

export class StoryFontAssets {
  // fonts = ui/fonts.json (or ui/simple/fonts.json); doc = the ui.json record document laid out with them;
  // language = ui/languages.json (may be null)
  // options.rasterizer(spec) -> the glyph rasterizer of a browser font (browser-font.js; Canvas 2D by default)
  constructor(fonts, doc, language, options = {}) {
    this.fonts = fonts;
    this.rasterizer = options.rasterizer || canvasRasterizer;
    this.browser = new Map();                         // font asset name -> its BrowserGlyphFont
    this.cache = new Map();
    this.lines = new Map();                           // font asset name -> the game's line metrics
    // a browser font stands in for a game font asset (browser.gameFont) with that font's line metrics
    for (const [name, f] of Object.entries((fonts && fonts.fonts) || {})) {
      const m = f.browser && GAME_FONT_LINES[f.browser.gameFont];
      if (m) this.lines.set(name, m);
    }
    if (!fonts || fonts.source !== "open") return;
    const roles = (doc && doc.textStyle && doc.textStyle.roles) || {};
    const add = (asset, m) => { if (typeof asset === "string" && m && !this.lines.has(asset)) this.lines.set(asset, m); };
    for (const [role, r] of Object.entries((language && language.roles) || {})) add(r && r.fontAsset, roles[role]);
    const byNodes = (nodes, bindings) => {
      for (const n of nodes || []) {
        const t = n.textStyle && bindings ? bindings[n.path] : null;
        if (t && t.localized) add(t.localized.fontAsset, roles[n.textStyle.fontRole]);
      }
    };
    byNodes(doc && doc.nodes, fonts.texts);
    for (const [name, d] of Object.entries((doc && doc.dialogs) || {})) byNodes(d && d.nodes, (fonts.dialogTexts || {})[name]);
    for (const [name, w] of Object.entries((doc && doc.chatTexts) || {}))
      byNodes(Object.entries(w || {}).map(([path, r]) => ({ path, textStyle: r && r.textStyle })), (fonts.chatTexts || {})[name]);
    for (const name of Object.keys(fonts.fonts || {})) {
      const m = /\(([^()]+)\)$/.exec(name);
      if (m) add(name, GAME_FONT_LINES[m[1]]);
    }
  }

  // -> the font asset record of `name`, or null when ui/fonts.json has none
  get(name) {
    if (!this.cache.has(name)) {
      const f = this.fonts.fonts[name];
      if (!f) return null;
      const rec = { name, ...f, faceInfo: this.faceInfo(name, f.faceInfo), textureSize: this.fonts.textures,
                    lineBreaking: this.fonts.lineBreaking || null };
      if (f.browser) {
        // glyphs the browser draws: characters and glyphs grow on lookup, on the one page of the asset
        const g = new BrowserGlyphFont({ name, pointSize: f.faceInfo.m_PointSize, padding: f.atlasPadding,
                                         renderMode: f.atlasRenderMode, ...f.browser },
                                       this.rasterizer({ pointSize: f.faceInfo.m_PointSize, ...f.browser }));
        this.browser.set(name, g);
        Object.assign(rec, { provider: g, characters: g.characters, glyphs: g.glyphs, textureSize: { ...g.textureSize } });
      }
      this.cache.set(name, rec);
    }
    return this.cache.get(name);
  }

  // the browser fonts of the data (every font asset with `browser`), made: name -> BrowserGlyphFont
  browserFonts() {
    for (const [name, f] of Object.entries(this.fonts.fonts || {})) if (f.browser) this.get(name);
    return this.browser;
  }

  // the face info of the font asset `name`: with the line metrics of its game font, else its own
  faceInfo(name, fi) {
    const m = this.lines.get(name);
    if (!m || !fi) return fi;
    const em = F(fi.m_PointSize / (fi.m_Scale || 1));
    return { ...fi, m_LineHeight: F(m.lineHeightEm * em), m_AscentLine: F(m.ascentEm * em),
             m_DescentLine: F(m.descentEm * em) };
  }
}
