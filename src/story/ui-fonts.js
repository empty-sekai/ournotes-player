import { F } from "../engine/core.js";

// The font asset records a story UI lays its texts out with (the text host's fontAsset, engine/uitext.js).
//
// Font data made from open fonts (ui/fonts.json `source` "open") has glyphs with the metrics of the open font, and
// with them its face's line height, ascent and descent. The game lays text out with the line metrics of its own font
// assets, and the language's line spacing (LocalizeManager.ApplyLanguageLineSpacing) is set for them: English's -100
// (one em less) takes the line gap of the game's primary font (A-OTF-ShinGoPr6N: line height 2 em, ascent 0.88,
// descent -0.12) out. An open face without that gap (Noto Sans CJK: 1.448 em with no gap) would put the lines 0.448 em
// apart, over each other. So an open font asset standing in for a font role of the game gets the game's line height,
// ascent and descent of that role (ui.json `textStyle.roles`, per role in em) in place of its own: the lines are as
// far apart and sit where the game has them, in every language. The glyphs keep their own metrics (the open CJK
// faces share the game's ideographic em box, 0.88 / -0.12).
//
// The role of a font asset: the fontRole of the text nodes whose bindings (fonts.texts[path].localized) use it, and
// the font asset the language document names per role (ui/languages.json `roles`, which also covers the texts of the
// chat window and the frames). Data from the game's fonts, or without textStyle roles, is taken as it is.
export class StoryFontAssets {
  // fonts = ui/fonts.json (or ui/simple/fonts.json); doc = the ui.json record document laid out with them;
  // language = ui/languages.json (may be null)
  constructor(fonts, doc, language) {
    this.fonts = fonts;
    this.cache = new Map();
    this.roleOf = new Map();                          // font asset name -> the game's line metrics of its role
    const roles = doc && doc.textStyle && doc.textStyle.roles;
    if (!fonts || fonts.source !== "open" || !roles) return;
    const add = (asset, role) => {
      const m = roles[role];
      if (typeof asset === "string" && m && !this.roleOf.has(asset)) this.roleOf.set(asset, m);
    };
    for (const [role, r] of Object.entries((language && language.roles) || {})) add(r && r.fontAsset, role);
    for (const n of doc.nodes || []) {
      const t = n.textStyle && fonts.texts ? fonts.texts[n.path] : null;
      if (t && t.localized) add(t.localized.fontAsset, n.textStyle.fontRole);
    }
  }

  // -> the font asset record of `name`, or null when ui/fonts.json has none
  get(name) {
    if (!this.cache.has(name)) {
      const f = this.fonts.fonts[name];
      if (!f) return null;
      this.cache.set(name, { name, ...f, faceInfo: this.faceInfo(name, f.faceInfo), textureSize: this.fonts.textures,
                             lineBreaking: this.fonts.lineBreaking || null });
    }
    return this.cache.get(name);
  }

  // the face info of the font asset `name`: with the line metrics of the game's font of its role, else its own
  faceInfo(name, fi) {
    const m = this.roleOf.get(name);
    if (!m || !fi) return fi;
    const em = F(fi.m_PointSize / (fi.m_Scale || 1));
    return { ...fi, m_LineHeight: F(m.lineHeightEm * em), m_AscentLine: F(m.ascentEm * em),
             m_DescentLine: F(m.descentEm * em) };
  }
}
