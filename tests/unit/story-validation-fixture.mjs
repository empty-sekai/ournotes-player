import fs from "node:fs";
import path from "node:path";
import { ModelObjects, mb, node, ref } from "./live2d-objects.mjs";
import { modelObjects, modelProduct, png, putAsset, putFiles } from "./site-fixture.mjs";

export const TMP = "TextMeshPro/Mobile/Distance Field";
export const GL_SOURCE = "#ifdef VERTEX\n#version 300 es\nvoid main() {}\n#endif\n#ifdef FRAGMENT\n#version 300 es\nvoid main() {}\n#endif\n";
export const textFields = (s) => ({ japanese: s, english: s, traditionalChinese: s, simplifiedChinese: s, korean: s });
export const flac = (sampleRate, channels, samples) => {
  const b = Buffer.alloc(42); b.write("fLaC"); b[7] = 34;
  const s = b.subarray(8);
  s[10] = sampleRate >> 12; s[11] = (sampleRate >> 4) & 0xff; s[12] = ((sampleRate & 0xf) << 4) | ((channels - 1) << 1);
  s[13] = (15 << 4) | Math.floor(samples / 2 ** 32); s.writeUInt32BE(samples % 2 ** 32, 14);
  return b;
};
const language = (code) => ({ code, mode: code === "ja" ? 0 : 1, field: code === "ja" ? "japanese" : "english",
  lineSpacing: 0, fontNames: [], additionalFontNames: [], materialTypes: [], fontSwap: {} });

export const validationFixture = () => {
  const o = new ModelObjects("fixture");
  const shader = o.shader(TMP, { properties: [], subShaders: [{ passes: [{ state: {} }] }] }, [[[], GL_SOURCE], [["OUTLINE_ON"], GL_SOURCE]]);
  const texture = o.texture("image", { image: png(4, 4) });
  const sprite = o.add("Sprite", "image", { json: JSON.stringify({ sprite: { m_Name: "image", m_Rect: { x: 0, y: 0, width: 4, height: 4 } },
    renderData: { texture: ref(texture), uvTransform: { x: 1, y: 0, z: 1, w: 0 } } }) });
  const textId = "fixture:1000";
  const text = { ...mb("TextMeshProUGUI", { m_Enabled: 1, m_fontSize: 40, m_text: "", m_tintAllSprites: true }), pathId: "1000" };
  const prefab = o.prefab([node("Widget", [mb("UIAdvWidget")]), node("Widget/Text", [text])]);
  // Keep explicit component ids for the font product's bindings.
  const pf = JSON.parse(o.objects[prefab].files.json); pf.nodes[1].components[0].pathId = "1000";
  o.objects[prefab].files.json = JSON.stringify(pf);
  const player = o.mono("AdvPlayerSettings", "settings", { _initializeEpisodes: [], _finalizeEpisodes: [] });
  const masterIds = o.mono("AdvMasterIdSettings", "ids");
  const dotween = o.mono("DOTweenSettings", "tweens", { defaultEaseType: 6 });
  const localize = o.mono("LocalizeManager", "language");
  const tmp = o.mono("TMP_Settings", "TMP", { m_missingGlyphCharacter: 0 });
  const graphics = o.add("GraphicsSettings", "graphics", { json: "{}" });
  const quality = o.add("QualitySettings", "quality", { json: "{}" });
  const settings = o.add("PlayerSettings", "player", { json: "{}" });
  const render = o.add("RenderSettings", "render", { json: "{}" });
  const products = new Map();
  const add = (file, product, subject, files, objects = {}) => {
    const p = { schema: "nnnotes.product/1", product, subject, files, objects };
    products.set(file, p); return p;
  };
  const episode = { advId: 7, asset: "episode", commandCount: 2,
    commands: [{ i: 0, cmd: "Bgm", raw: 15, BgmID: 1 }, { i: 1, cmd: "Talk", raw: 2, AdvTextID: "t1" }],
    text: { t1: textFields("Hi") }, sounds: { 1: { _soundCueSheetID: 5, _cueName: "bgm_a" } },
    cuesheets: { 5: { _cueSheetName: "sheet_a" } }, videos: {}, resources: [],
    master: { _id: 7, _sheetName: "s", _advEpisodeAsset: "episode", _titleTextId: "t0", _rubyTitleTextId: "", _playbackMode: 0 }, title: textFields("T") };
  const story = { format: 1, advId: 7, episode: "episode.json", chats: {}, effects: {}, parts: {
    scene: "storyscenes/default.json", models: {}, assets: {}, sounds: { sheet_a: "cuesheets/sheet_a.json" },
    ui: {}, fonts: {}, videos: {} } };
  const manifest = add("stories/7.json", "story", "7", { "story.json": story, "episode.json": episode });
  manifest.language = "ja";
  const scene = { format: 1, scene: [prefab], renderSettings: render,
    prefabs: Object.fromEntries(["cameraManager", "backgroundField", "characterField", "globalVolume"].map((k) => [k, prefab])),
    settings: { playerSettings: player, masterIdSettings: masterIds }, graphics: { graphics, quality, player: settings },
    bindings: {}, shaders: { [TMP]: shader } };
  add(story.parts.scene, "story.scene", "default", { "scene.json": scene }, o.objects);
  const fonts = {}, ui = {};
  for (const lang of ["ja", "en"]) {
    const f = font(lang);
    const raw = f.doc.texts["W/Talk"], binding = { font: raw.localized, localized: raw.localized, style: { class: raw.class } };
    fonts[lang] = { ...f.doc, format: "nnnotes.story-fonts/1", texts: { [textId]: binding }, shaders: { [TMP]: shader }, sprites: {} };
    ui[lang] = { format: 1, language: language(lang), widget: prefab, chatWidget: prefab, uiManager: prefab, chatStatusTexts: {},
      letterbox: sprite, talkWindows: { Window: prefab }, dialogs: {}, clips: {}, controllers: {},
      settings: { dotween, tmpSettings: tmp, localizeManager: localize, masterIdSettings: masterIds },
      graphics: { graphics }, texts: { [textId]: { localized: raw.localized, style: { class: raw.class } } },
      textStyle: {}, bindings: {}, shaders: { [TMP]: shader } };
    story.parts.ui[lang] = `storyui/${lang}.json`; story.parts.fonts[lang] = `storyfonts/7_${lang}.json`;
    add(story.parts.ui[lang], "story.ui", lang, { "ui.json": ui[lang] });
    add(story.parts.fonts[lang], "story.fonts", `7/${lang}`, { "fonts.json": fonts[lang], [`fonts/${f.page}.png`]: png(16, 12) }, { [shader]: o.objects[shader] });
  }
  const cues = { bgm_a: { file: "a.flac", sampleRate: 48000, channels: 2, samples: 48, categories: ["Bgm"] } };
  add(story.parts.sounds.sheet_a, "story.sound", "sheet_a", { "cues.json": cues, "a.flac": flac(48000, 2, 48) });
  return { o, products, add, episode, story, scene, fonts, ui, cues, manifest, textId, prefab, shader, texture, sprite,
    player, tmp, graphics, modelOptions: null, where: "stories/7.json", encoding: null };
};

export const writeFixture = (dir, f) => {
  if (f.modelOptions) {
    const model = modelProduct(dir, modelObjects("m1", f.modelOptions), f.encoding);
    fs.mkdirSync(path.join(dir, "models"), { recursive: true });
    fs.writeFileSync(path.join(dir, "models/m1.json"), JSON.stringify(model));
    f.story.parts.models[model.subject] = "models/m1.json";
  }
  const manifests = new Map();
  for (const [file, p] of f.products) {
    const target = file === "stories/7.json" ? f.where : file;
    const packed = { ...p, files: putFiles(dir, p.files, f.encoding), objects: Object.fromEntries(Object.entries(p.objects).map(([id, object]) =>
      [id, { ...object, files: Object.fromEntries(Object.entries(object.files).map(([role, value]) => [role,
        putAsset(dir, role === "image" ? "image.png" : role.startsWith("program:") ? "program.glsl" : `${role}.json`, value, f.encoding)])) }])) };
    fs.mkdirSync(path.dirname(path.join(dir, target)), { recursive: true });
    fs.writeFileSync(path.join(dir, target), JSON.stringify(packed));
    manifests.set(target, packed);
  }
  return manifests;
};

const font = (lang) => {
  const page = `font_Test ${lang}_0`;
  const face = Object.fromEntries(["m_PointSize", "m_Scale", "m_UnitsPerEM", "m_LineHeight", "m_AscentLine", "m_CapLine", "m_MeanLine", "m_Baseline",
    "m_DescentLine", "m_SuperscriptOffset", "m_SuperscriptSize", "m_SubscriptOffset", "m_SubscriptSize", "m_UnderlineOffset",
    "m_UnderlineThickness", "m_StrikethroughOffset", "m_StrikethroughThickness", "m_TabWidth"].map((k) => [k, 1]));
  return {
    page,
    doc: {
      format: "nnnotes.story-fonts/1", language: lang, source: "open",
      fonts: { "Test SDF": {
        faceInfo: { ...face, m_FamilyName: "Test", m_StyleName: "Regular", m_FaceIndex: 0 },
        atlasWidth: 16, atlasHeight: 16, atlasPadding: 1, atlasRenderMode: 4134, atlasPopulationMode: 0, atlases: [page],
        normalStyle: 0, normalSpacingOffset: 0, boldStyle: 0.75, boldSpacing: 7, italicStyle: 35, tabSize: 10,
        material: "Test SDF Material", fallbacks: [], glyphPairAdjustmentRecords: 0,
        characters: { 72: { glyph: 3, scale: 1, elementType: 1 }, 32: { glyph: 1, scale: 1, elementType: 1 } },
        glyphs: { 3: { metrics: { m_Width: 4, m_Height: 5, m_HorizontalBearingX: 0, m_HorizontalBearingY: 5, m_HorizontalAdvance: 5 },
                       rect: { m_X: 2, m_Y: 2, m_Width: 4, m_Height: 5 }, scale: 1, atlasIndex: 0, packed: { texture: page, dx: 0, dy: 0 } },
                  1: { metrics: { m_Width: 0, m_Height: 0, m_HorizontalBearingX: 0, m_HorizontalBearingY: 0, m_HorizontalAdvance: 3 },
                       rect: { m_X: 0, m_Y: 0, m_Width: 0, m_Height: 0 }, scale: 1, atlasIndex: 0 } },
        runtimeCharacters: [], runtimeGlyphs: null, subset: "the characters shown",
        source: { family: "Test", style: "Regular", version: "1", license: "OFL", file: "t.ttf", faceIndex: 0, bytes: 1, sha256: "0".repeat(64), generator: {} } } },
      textures: { [page]: { texture: `fonts/${page}.png`, name: page, width: 16, height: 12, mipCount: 1,
                            settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } } },
      materials: { "Test SDF Material": { material: "Test SDF Material", shader: { shader: TMP }, keywords: [], textures: {}, floats: {}, colors: {} },
                   "Test - Outline": { material: "Test - Outline", shader: { shader: TMP }, keywords: ["OUTLINE_ON"], textures: {}, floats: {}, colors: {} } },
      materialKeywords: { "Test SDF Material": [], "Test - Outline": ["OUTLINE_ON"] },
      texts: { "W/Talk": { class: "TextMeshProUGUI", enabled: 1, fontAsset: "Game SDF", material: "Game - Outline", m_fontSize: 40, m_text: "",
                           localized: { fontAsset: "Test SDF", material: "Test - Outline", lineSpacing: 0 } } },
      coverage: { characters: 2, missing: [] },
      lineBreaking: { leading: "(", following: ")", useModernHangulLineBreakingRules: false },
    },
  };
};

const HEART = 0x2661, VS16 = 0xFE0F, SQUARE = 0x25A1;
export const withMissingGlyph = (p) => {
  for (const lang of ["ja", "en"]) {
    const f = p.fonts[lang], a = f.fonts["Test SDF"];
    a.characters[SQUARE] = { glyph: 3, scale: 1, elementType: 1 };
    a.missingGlyph = { unicode: SQUARE, characters: [HEART, VS16] };
    f.coverage.missingGlyph = [HEART, VS16].map((u) => String.fromCodePoint(u));
  }
};

// a fallback font asset: "Fb SDF" (gradient scale 16) behind "Test SDF" (5), its page and default material, and the
// fallback material of the text material "Test - Outline"; U+53E3 drawn from it
export const withFallback = (p) => {
  for (const lang of ["ja", "en"]) {
    const f = p.fonts[lang], page = `font_Fb ${lang}_0`, test = f.fonts["Test SDF"];
    const tex = (name, w, h) => ({ _MainTex: { texture: { name, width: w, height: h, format: 4 } } });
    f.fonts["Fb SDF"] = { ...structuredClone(test), atlases: [page], atlasPadding: 15, material: "Fb SDF Material", fallbacks: [],
                          characters: { 21475: { glyph: 3, scale: 1, elementType: 1 } } };
    f.fonts["Fb SDF"].glyphs = { 3: { ...structuredClone(test.glyphs[3]), packed: { texture: page, dx: 0, dy: 0 } } };
    test.fallbacks = ["Fb SDF"];
    f.textures[page] = { texture: `fonts/${page}.png`, name: page, width: 16, height: 12, mipCount: 1,
                         settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
    p.products.get(p.story.parts.fonts[lang]).files[`fonts/${page}.png`] = png(16, 12);
    const outline = f.materials["Test - Outline"];
    Object.assign(outline, { textures: tex(`font_Test ${lang}_0`, 16, 12),
                             floats: { _GradientScale: 5, _FaceDilate: 0, _OutlineWidth: 0.2, _OutlineSoftness: 0, _WeightNormal: 0,
                                       _WeightBold: 0.5, _UnderlayOffsetX: 0.5, _UnderlayOffsetY: -0.5, _UnderlayDilate: 0,
                                       _UnderlaySoftness: 0, _ScaleRatioA: 0.8, _ScaleRatioC: 0.7, _TextureWidth: 16, _TextureHeight: 12 } });
    f.materials["Fb SDF Material"] = { material: "Fb SDF Material", shader: { shader: TMP }, keywords: [], textures: tex(page, 16, 12),
                                       floats: { _GradientScale: 16, _WeightNormal: 0, _WeightBold: 0.75, _TextureWidth: 16, _TextureHeight: 12 },
                                       colors: {} };
    // GetFallbackMaterial: weight 0.75 / 4, t = max(1, 0.1875 + 0.2) = 1 -> A = 15 / 16; C = (15 - 0.1875 * 15) / 16
    f.materials["Test - Outline + Fb SDF"] = { ...structuredClone(outline), material: "Test - Outline + Fb SDF", textures: tex(page, 16, 12),
                                               floats: { ...outline.floats, _GradientScale: 16, _WeightBold: 0.75, _ScaleRatioA: 0.9375,
                                                         _ScaleRatioC: 0.76171875 } };
    f.materialKeywords["Fb SDF Material"] = [];
    f.materialKeywords["Test - Outline + Fb SDF"] = ["OUTLINE_ON"];
  }
};
