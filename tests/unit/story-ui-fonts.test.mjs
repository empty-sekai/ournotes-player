// StoryFontAssets (src/story/ui-fonts.js): font data made from open fonts lays lines out with the line height, ascent
// and descent of the game's font of each role (ui.json textStyle.roles), found through the language document's roles
// and the text nodes' fontRole; game fonts, data without roles and fonts of no role keep their own face info.
// Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { StoryFontAssets } from "../../src/story/ui-fonts.js";

// Noto Sans CJK at 40 px per em: line height 1.448 em, no line gap
const face = (size = 40) => ({ m_PointSize: size, m_Scale: 1, m_LineHeight: F(1.448 * size), m_AscentLine: F(1.16 * size),
                               m_DescentLine: F(-0.288 * size), m_CapLine: 29 });
const fontsDoc = (source) => ({
  source, textures: {}, fonts: { Talk: { faceInfo: face() }, Simple: { faceInfo: face(47) }, Digits: { faceInfo: face(80) } },
  texts: { "W/TalkText": { localized: { fontAsset: "Simple" } } },
});
const uiDoc = { textStyle: { roles: { primary: { lineHeightEm: 2, ascentEm: 0.88, descentEm: -0.12 },
                                      number: { lineHeightEm: 1.2, ascentEm: 0.83, descentEm: -0.17 } } },
                nodes: [{ path: "W" }, { path: "W/TalkText", textStyle: { fontRole: "primary" } }] };
const language = { lineSpacing: -100, roles: { primary: { fontAsset: "Talk" } } };

test("open fonts: the game's line metrics of the role, by the language's roles and by the text nodes' fontRole", () => {
  const a = new StoryFontAssets(fontsDoc("open"), uiDoc, language);
  const t = a.get("Talk");
  assert.deepEqual([t.faceInfo.m_LineHeight, t.faceInfo.m_AscentLine, t.faceInfo.m_DescentLine], [80, F(35.2), F(-4.8)]);
  assert.equal(t.faceInfo.m_CapLine, 29);                               // the rest of the face as it is
  assert.equal(t.name, "Talk");
  assert.equal(a.get("Talk"), t);                                       // one record per asset
  const s = a.get("Simple").faceInfo;                                   // the talk text's binding, role primary
  assert.deepEqual([s.m_LineHeight, s.m_AscentLine, s.m_DescentLine], [94, F(F(0.88) * 47), F(F(-0.12) * 47)]);
  assert.deepEqual(a.get("Digits").faceInfo, face(80));                // no text of the role: its own
  assert.equal(a.get("Missing"), null);
  // English line spacing -100 at 36 px: lineHeight x scale - 36 is one em, not 0.448 em
  const pitch = F(t.faceInfo.m_LineHeight * F(36 / 40)) + language.lineSpacing * F(36 * 0.01);
  assert.ok(Math.abs(pitch - 36) < 1e-4, String(pitch));
});

test("game fonts, and data without textStyle roles, keep the font assets' own face info", () => {
  assert.deepEqual(new StoryFontAssets(fontsDoc("game"), uiDoc, language).get("Talk").faceInfo, face());
  assert.deepEqual(new StoryFontAssets(fontsDoc("open"), { nodes: uiDoc.nodes }, language).get("Talk").faceInfo, face());
  assert.deepEqual(new StoryFontAssets(fontsDoc("open"), uiDoc, null).get("Talk").faceInfo, face());   // by fontRole only
  assert.equal(new StoryFontAssets(fontsDoc("open"), uiDoc, null).get("Simple").faceInfo.m_LineHeight, 94);
});
