// The story schemas (schema/stor*.schema.json, episode.schema.json) and the story checks of scripts/validate-data.mjs
// on a synthetic story site built here: two language groups, one cue sheet with a FLAC waveform, one glyph page per
// language, a UI shader directory with the distance-field shader; variants with a host (an Overlay story), with chat
// window, dialog and frame texts, with a missing glyph, with a fallback font asset and with an emoji sprite asset.
// No game data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";
import { encode, modelFiles, modelManifest, putFiles, sha256 } from "./site-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "..", "scripts", "validate-data.mjs");
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, "..", "..", "schema", `${name}.schema.json`), "utf8")));

// ------------------------------------------------------------------------------------------------ file contents
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
};
const flac = (sampleRate, channels, samples) => {
  const b = Buffer.alloc(42);
  b.write("fLaC", 0, "latin1"); b[4] = 0; b[7] = 34;
  const s = b.subarray(8);
  s[10] = sampleRate >> 12; s[11] = (sampleRate >> 4) & 0xff; s[12] = ((sampleRate & 0xf) << 4) | ((channels - 1) << 1);
  s[13] = (15 << 4) | Math.floor(samples / 2 ** 32); s.writeUInt32BE(samples % 2 ** 32, 14);
  return b;
};
const glsl = "#ifdef VERTEX\n#version 300 es\nvoid main() {}\n#endif\n#ifdef FRAGMENT\n#version 300 es\nvoid main() {}\n#endif\n";
const TMP = "TextMeshPro/Mobile/Distance Field";

const texts = (s) => ({ japanese: s, english: s, traditionalChinese: s, simplifiedChinese: s, korean: s });
const episode = () => ({
  advId: 7, asset: "adv_script_7", commandCount: 3,
  commands: [{ i: 0, cmd: "Bgm", raw: 15, BgmID: 1 }, { i: 1, cmd: "Talk", raw: 2, TargetName: "a", AdvTextID: "t1", VoiceIDs: [2] },
             { i: 2, cmd: "Shake", raw: 4, IgnoreData: 1 }],
  text: { t1: texts("Hi") }, sounds: { 1: { _soundCueSheetID: 5, _cueName: "bgm_a" }, 2: { _soundCueSheetID: 5, _cueName: "voice_a" } },
  cuesheets: { 5: { _cueSheetName: "sheet_a" } }, videos: {}, resources: [{ kind: "episode", address: "adv_script_7", present: true }],
  master: { _id: 7, _sheetName: "s", _advEpisodeAsset: "adv_script_7", _titleTextId: "t0", _rubyTitleTextId: "", _playbackMode: 0 },
  title: texts("T"),
});
const scene = () => ({ player: {}, settings: { playerSettings: { _initializeEpisodes: [{ Command: 35 }], _finalizeEpisodes: [] } } });
const shaderIndex = (names) => names.map((n, i) => ({ name: n, parsed: `s${i}.json`,
  variants: [{ file: `s${i}_0.glsl`, subShader: 0, pass: 0, keywords: [] }, { file: `s${i}_1.glsl`, subShader: 0, pass: 0, keywords: ["OUTLINE_ON"] }] }));
const shaderFiles = (dir, names) => {
  const out = { [`${dir}/shaders.json`]: shaderIndex(names) };
  names.forEach((n, i) => { out[`${dir}/s${i}.json`] = { subShaders: [{ passes: [{ state: {} }] }] }; out[`${dir}/s${i}_0.glsl`] = glsl; out[`${dir}/s${i}_1.glsl`] = glsl; });
  return out;
};
const ui = () => ({ nodes: [{ path: "W" }, { path: "W/Talk", textStyle: { fontRole: "primary" } }],
                    textures: { sprites: { texture: "textures/sprites.png", name: "sprites", width: 8, height: 4, mipCount: 1 } },
                    materials: { "Default UI Material": { material: "Default UI Material", shader: { shader: "UI/Default" } } },
                    materialKeywords: { "Default UI Material": [] } });
const font = (lang) => {
  const page = `font_Test ${lang}_0`;
  const face = Object.fromEntries(["m_PointSize", "m_Scale", "m_UnitsPerEM", "m_LineHeight", "m_AscentLine", "m_CapLine", "m_MeanLine", "m_Baseline",
    "m_DescentLine", "m_SuperscriptOffset", "m_SuperscriptSize", "m_SubscriptOffset", "m_SubscriptSize", "m_UnderlineOffset",
    "m_UnderlineThickness", "m_StrikethroughOffset", "m_StrikethroughThickness", "m_TabWidth"].map((k) => [k, 1]));
  return {
    page,
    doc: {
      format: "ournotes.story-fonts/1", language: lang, source: "open",
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
const language = (lang, mode, field) => ({ format: "ournotes.story-language/1", language: lang, mode, field, lineSpacing: 0, fonts: "open",
  roles: { primary: { fontAsset: "Test SDF", lineHeightEm: 1, ascentEm: 0.8, descentEm: -0.2, spacingOffset: 0, boldSpacing: 7 } } });

// ------------------------------------------------------------------------------------------------ the site
// logical files -> a content-addressed site with stories/7.json and stories.json; `edit(parts)` changes the pieces
// before they are stored:
//   common, groups, man   the story's common files, language groups and manifest keys
//   models                model id -> its logical files (models/<id>.json; the manifest's models list them all)
//   modelsIndex           write models.json listing the models (true), or the ids of a list
//   encoding              "gzip" | "br": every compressible asset encoded where that is smaller
//   where                 the manifest's path (stories/7.json; stories/<region>/7.json for a region's own)
//   index                 false: no stories.json; a function: edits the stories.json entry
function buildSite(edit = () => {}) {
  const common = {
    "story.json": { advId: 7, episode: "episode.json", scene: "scene.json", ui: "ui/ui.json", models: {}, audio: { sheet_a: "audio/sheet_a" },
                    frames: null, effects: null, postEffects: null, stills: null, talkWindows: null, chat: null, videos: null },
    "episode.json": episode(), "scene.json": scene(),
    "audio/sheet_a/cues.json": { bgm_a: { file: "bgm_a.flac", sampleRate: 48000, channels: 2, samples: 96000, loopStart: 0, loopEnd: 96000 },
                                 voice_a: { file: "voice_a.flac", sampleRate: 48000, channels: 1, samples: 4800 } },
    "audio/sheet_a/bgm_a.flac": flac(48000, 2, 96000), "audio/sheet_a/voice_a.flac": flac(48000, 1, 4800),
    "ui/ui.json": ui(), "ui/textures/sprites.png": png(8, 4),
    ...shaderFiles("ui/shaders", [TMP, "UI/Default"]),
  };
  const groups = {};
  for (const [lang, mode, field] of [["ja", 0, "japanese"], ["en", 1, "english"]]) {
    const f = font(lang);
    groups[lang] = { "ui/fonts.json": f.doc, [`ui/fonts/${f.page}.png`]: png(16, 12), "ui/languages.json": language(lang, mode, field) };
  }
  const facts = { advId: 7, asset: "adv_script_7", sheetName: "s", playbackMode: 0, titles: { ja: "T", en: "T" }, groups: [],
                  commands: ["Bgm", "TalkWindow", "Talk"].sort(), commandCount: 3, language: "en", languages: ["ja", "en"] };
  const man = { format: "ournotes.story-manifest/2", advId: 7, root: "../", story: facts, language: "en", audio: true, audioFormat: "flac",
                fonts: "open", requires: { commands: facts.commands, cubismCore: true, motionSync: true } };
  const parts = { common, groups, man, index: true, models: {}, modelsIndex: false, encoding: null, where: "stories/7.json" };
  edit(parts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-story-"));
  const entries = (files) => putFiles(dir, files, parts.encoding);
  const ids = Object.keys(parts.models).sort(), modelSize = {};
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  for (const id of ids) {
    const mm = modelManifest(id, entries(parts.models[id]));
    modelSize[id] = Object.values(mm.files).reduce((n, f) => n + f.size, 0);
    fs.writeFileSync(path.join(dir, "models", `${id}.json`), JSON.stringify(mm));
  }
  if (parts.modelsIndex) {
    const listed = Array.isArray(parts.modelsIndex) ? parts.modelsIndex : ids;
    fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify({ format: 2, models: listed.map((id) => ({ id, manifest: `models/${id}.json` })) }));
  }
  const sited = parts.man.format === "ournotes.story-manifest/2";           // format /1: no models of the site
  const m = { ...(sited ? { models: Object.fromEntries(ids.map((id) => [id, `models/${id}.json`])) } : {}), ...parts.man,
              files: entries(parts.common),
              languages: Object.fromEntries(Object.entries(parts.groups).map(([l, g]) => [l, { files: entries(g) }])) };
  fs.mkdirSync(path.dirname(path.join(dir, parts.where)), { recursive: true });
  fs.writeFileSync(path.join(dir, parts.where), JSON.stringify(m));
  if (parts.index) {
    const size = (files) => Object.values(files).reduce((n, f) => n + f.size, 0);
    const entry = { id: "7", manifest: parts.where, audio: m.audio, audioFormat: m.audioFormat, fonts: m.fonts, ...m.story,
                    size: { common: size(m.files), ...(sited ? { models: ids.reduce((n, id) => n + modelSize[id], 0) } : {}),
                            languages: Object.fromEntries(Object.entries(m.languages).map(([l, g]) => [l, size(g.files)])) } };
    if (typeof parts.index === "function") parts.index(entry);
    fs.writeFileSync(path.join(dir, "stories.json"), JSON.stringify({ format: "ournotes.stories/1", language: "en", languages: ["ja", "en"], stories: [entry] }));
  }
  return { dir, man: m };
}

// the ja fonts document of a site built with `edit`
const buildSiteFonts = (edit) => {
  let doc = null;
  const { dir } = buildSite((p) => { edit(p); doc = p.groups.ja["ui/fonts.json"]; });
  fs.rmSync(dir, { recursive: true, force: true });
  return doc;
};

// validates the site built with `edit`, after `after(dir, man)` changed the stored site (files on disk)
const validateBuilt = (edit, after = null, ...args) => {
  const { dir, man } = buildSite(edit);
  try {
    if (after) after(dir, man);
    const r = spawnSync(process.execPath, [script, dir, ...args], { encoding: "utf8" });
    return { status: r.status, lines: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean), stderr: r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

const validate = (edit, ...args) => {
  const { dir } = buildSite(edit);
  try {
    const r = spawnSync(process.execPath, [script, dir, ...args], { encoding: "utf8" });
    return { status: r.status, lines: r.stdout.split("\n").map((l) => l.trim()).filter(Boolean), stderr: r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const failsWith = (edit, text) => {
  const r = validate(edit);
  assert.equal(r.status, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.includes(text)), `"${text}" in:\n${r.lines.join("\n")}`);
};

// an Overlay story with its host: host/host.json (common), ui/simple/ui.json and per language ui/simple/fonts.json
const withHost = (p, kind = "home") => {
  p.common["episode.json"].master._playbackMode = 1;
  p.man.story.playbackMode = 1;
  p.man.host = { kind, doc: "host/host.json", ui: "ui/simple/ui.json" };
  p.common["host/host.json"] = { format: "ournotes.story-host/1", kind, ui: "host/ui/ui.json" };
  p.common["host/ui/ui.json"] = { nodes: [] };
  p.common["ui/simple/ui.json"] = { nodes: [{ path: "S" }, { path: "S/Text", textStyle: { fontRole: "primary" } }] };
  for (const lang of ["ja", "en"]) {
    const f = font(lang);
    f.doc.texts = { "S/Text": f.doc.texts["W/Talk"] };
    p.groups[lang]["ui/simple/fonts.json"] = f.doc;
    p.groups[lang][`ui/simple/fonts/${f.page}.png`] = png(16, 12);
  }
};
// chat window texts: a text record per text in ui.json chatTexts, a binding per text in each fonts.json chatTexts
const withChat = (p) => {
  p.common["ui/ui.json"].chatTexts = { Line: { "Line/Top/Name": { textStyle: { fontRole: "font2" }, localizeText: null } } };
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"];
    f.chatTexts = { Line: { "Line/Top/Name": { ...f.texts["W/Talk"], fontAsset: "Chat SDF", m_monospaceDistEm: 0 } } };
  }
};

// a dialog of the ADV screen: its text node in ui.json dialogs, a binding per language in fonts.json dialogTexts
const withDialog = (p) => {
  p.common["ui/ui.json"].dialogs = { Skip: { key: "EmbUI/Prefab/Skip", nodes: [{ path: "Skip" }, { path: "Skip/Message", textStyle: {} }] } };
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"];
    f.dialogTexts = { Skip: { "Skip/Message": f.texts["W/Talk"] } };
  }
};

// frames.json with a frame whose prefab has a text node (and one without), a binding per language in frameTexts
const withFrames = (p) => {
  p.common["story.json"].frames = "frames.json";
  p.common["frames.json"] = { frames: {
    Comment: { nodes: [{ path: "Comment", components: [{ class: "AdvFrame" }] },
                       { path: "Comment/Body", components: [{ type: "RectTransform" }, { class: "TextMeshProUGUI", m_text: "" }] }] },
    Plain: { nodes: [{ path: "Plain", components: [{ class: "AdvFrame" }] }] } } };
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"];
    f.frameTexts = { Comment: { "Comment/Body": structuredClone(f.texts["W/Talk"]) } };
  }
};

// the missing glyph: U+2661 and U+FE0F drawn as U+25A1, which the font asset holds
const HEART = 0x2661, VS16 = 0xFE0F, SQUARE = 0x25A1;
const withMissingGlyph = (p) => {
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"], a = f.fonts["Test SDF"];
    a.characters[SQUARE] = { glyph: 3, scale: 1, elementType: 1 };
    a.missingGlyph = { unicode: SQUARE, characters: [HEART, VS16] };
    f.coverage.missingGlyph = [HEART, VS16].map((u) => String.fromCodePoint(u));
  }
};

// a fallback font asset: "Fb SDF" (gradient scale 16) behind "Test SDF" (5), its page and default material, and the
// fallback material of the text material "Test - Outline"; U+53E3 drawn from it
const withFallback = (p) => {
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"], page = `font_Fb ${lang}_0`, test = f.fonts["Test SDF"];
    const tex = (name, w, h) => ({ _MainTex: { texture: { name, width: w, height: h, format: 4 } } });
    f.fonts["Fb SDF"] = { ...structuredClone(test), atlases: [page], atlasPadding: 15, material: "Fb SDF Material", fallbacks: [],
                          characters: { 21475: { glyph: 3, scale: 1, elementType: 1 } } };
    f.fonts["Fb SDF"].glyphs = { 3: { ...structuredClone(test.glyphs[3]), packed: { texture: page, dx: 0, dy: 0 } } };
    test.fallbacks = ["Fb SDF"];
    f.textures[page] = { texture: `fonts/${page}.png`, name: page, width: 16, height: 12, mipCount: 1,
                         settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
    p.groups[lang][`ui/fonts/${page}.png`] = png(16, 12);
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

// the emoji sprite asset: two sprites (one without an image), its page and sprite material, the talk text driven by
// a UIText; the sprite shader in ui/shaders
const SPRITE = "TextMeshPro/Sprite";
const withSprites = (p) => {
  Object.assign(p.common, shaderFiles("ui/shaders", [TMP, "UI/Default", SPRITE]));
  const metrics = { m_Width: 4, m_Height: 4, m_HorizontalBearingX: 0, m_HorizontalBearingY: 4, m_HorizontalAdvance: 4 };
  for (const lang of ["ja", "en"]) {
    const f = p.groups[lang]["ui/fonts.json"], page = "sprite_Emoji";
    f.spriteAssets = { Emoji: {
      faceInfo: { m_PointSize: 0, m_Scale: 1, m_Baseline: 0, m_AscentLine: 0, m_DescentLine: 0 },
      characters: [{ index: 3, unicode: 0x1F600, name: "1f600", glyph: 0, scale: 1 }, { index: 5, unicode: 0x2764, name: "2764", glyph: 1, scale: 1 }],
      glyphs: { 0: { metrics, rect: { m_X: 1, m_Y: 1, m_Width: 4, m_Height: 4 }, scale: 1, atlasIndex: 0, packed: { texture: page, dx: 0, dy: 0 } },
                1: { metrics, rect: { m_X: 0, m_Y: 0, m_Width: 0, m_Height: 0 }, scale: 1, atlasIndex: 0 } },
      sequences: [{ name: "1f469-200d-1f4bb", unicode: 0 }], material: "Emoji Material", source: null, subset: "the sprites shown" } };
    f.emojiSpriteAsset = "Emoji";
    f.materials["Emoji Material"] = { material: "Emoji Material", shader: { shader: SPRITE }, keywords: [], textures: {}, floats: {}, colors: {} };
    f.materialKeywords["Emoji Material"] = [];
    f.textures[page] = { texture: `fonts/${page}.png`, name: page, width: 8, height: 8, mipCount: 1, settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
    p.groups[lang][`ui/fonts/${page}.png`] = png(8, 8);
    f.coverage.sprites = { characters: 2, missing: ["2764"] };
    Object.assign(f.texts["W/Talk"], { spriteAsset: "Emoji", m_tintAllSprites: 0 });
  }
};

// ------------------------------------------------------------------------------------------------ tests
test("the story schemas accept the synthetic documents", () => {
  const { dir, man } = buildSite();
  try {
    assert.deepEqual(schema("story-manifest")(man), []);
    assert.deepEqual(schema("stories")(JSON.parse(fs.readFileSync(path.join(dir, "stories.json"), "utf8"))), []);
    assert.deepEqual(schema("episode")(episode()), []);
    assert.deepEqual(schema("story-fonts")(font("ja").doc), []);
    assert.deepEqual(schema("story-language")(language("ja", 0, "japanese")), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(schema("story-manifest")({ ...man, format: "ournotes.story-manifest/3" }).some((e) => e.includes("/format")));
  assert.ok(schema("story-manifest")({ ...man, audioFormat: "ogg" }).some((e) => e.includes("/audioFormat")));
  assert.ok(schema("episode")({ ...episode(), commands: [{ i: 0, cmd: "Bgm" }] }).some((e) => e.includes("raw")));
  const f = font("ja").doc;
  f.texts["W/Talk"].localizeKoreanAdjust = { _koreanFontStyle: 1, m_Enabled: 1 };
  assert.ok(schema("story-fonts")(f).some((e) => e.includes("localizeKoreanAdjust/m_Enabled")));
});

test("a valid story site validates", () => {
  const r = validate();
  assert.equal(r.status, 0, r.lines.join("\n") + r.stderr);
  assert.deepEqual(r.lines, ["1/1 stories valid"]);
  assert.deepEqual(validate((p) => { p.index = false; }).lines, ["1/1 stories valid"]);     // manifests without stories.json
  assert.equal(validate(undefined, "7").status, 0);
  const missing = validate(undefined, "8");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /chart, model or story 8 not found/);
});

test("language groups: disjoint from the common files, with fonts.json and languages.json, default language among them", () => {
  failsWith((p) => { p.common["ui/languages.json"] = language("en", 1, "english"); }, "languages.ja: ui/languages.json is also a common file");
  failsWith((p) => { delete p.groups.en["ui/languages.json"]; }, "languages.en: ui/languages.json missing");
  failsWith((p) => { p.man.language = "ko"; p.man.story.language = "ko"; }, "language ko is not a key of languages");
  failsWith((p) => { p.groups.en["ui/fonts.json"].textures[`font_Test en_0`].texture = "fonts/other.png"; }, "not in the language group");
  failsWith((p) => { p.common["ui/ui.json"].nodes.reverse(); }, "[ja] ui/ui.json: parent of W/Talk is not listed before it");
});

test("stories.json agrees with the manifest", () => {
  failsWith((p) => { p.index = (e) => { e.size.common += 1; }; }, "stories.json: size");
  failsWith((p) => { p.index = (e) => { e.titles = { ja: "X" }; }; }, "stories.json: titles differs");
  failsWith((p) => { p.index = (e) => { e.audioFormat = "aac"; }; }, "stories.json: audioFormat");
});

test("commands and lip sync follow the episode", () => {
  failsWith((p) => { p.man.requires.commands = ["Bgm", "Talk"]; p.man.story.commands = ["Bgm", "Talk"]; p.index = false; }, "the episode runs [\"Bgm\",\"Talk\",\"TalkWindow\"]");
  failsWith((p) => { p.man.requires.motionSync = false; }, "requires.motionSync false");
});

test("sounds: cue sheets, waveform files and their headers", () => {
  failsWith((p) => { p.common["audio/sheet_a/bgm_a.flac"] = flac(44100, 2, 96000); }, "FLAC sample rate 44100, described 48000");
  failsWith((p) => { delete p.common["audio/sheet_a/voice_a.flac"]; }, "voice_a: audio/sheet_a/voice_a.flac is not a common file");
  failsWith((p) => { p.common["episode.json"].cuesheets[6] = { _cueSheetName: "sheet_b" }; }, "cue sheet sheet_b of the episode has no audio directory");
  failsWith((p) => { p.common["audio/sheet_a/cues.json"].bgm_a.loopEnd = 96001; }, "bgm_a: loop points outside the waveform");
});

test("fonts: bindings, font assets, glyph pages and text material shaders", () => {
  failsWith((p) => { p.groups.ja["ui/fonts.json"].texts = {}; }, "[ja] ui/fonts.json: text node W/Talk has no binding in texts");
  failsWith((p) => { p.groups.ja["ui/fonts.json"].texts["W/Talk"].localized.material = "Nope"; }, "material Nope not in materials");
  failsWith((p) => { p.groups.en["ui/fonts.json"].fonts["Test SDF"].glyphs[3].rect.m_Y = 9; }, "glyph 3: rect + offset leaves page");
  failsWith((p) => { p.groups.en["ui/fonts/font_Test en_0.png"] = png(16, 16); }, "PNG is 16x16, descriptor font_Test en_0 says 16x12");
  // the shader uses OUTLINE_ON, but only together with UNDERLAY_ON: no variant draws [OUTLINE_ON] alone
  failsWith((p) => {
    p.common["ui/shaders/shaders.json"] = shaderIndex([TMP, "UI/Default"])
      .map((r) => ({ ...r, variants: [r.variants[0], { ...r.variants[1], keywords: ["OUTLINE_ON", "UNDERLAY_ON"] }] }));
  }, "material Test - Outline: ui/shaders/shaders.json: TextMeshPro/Mobile/Distance Field: no variant for [OUTLINE_ON]");
  failsWith((p) => { p.groups.ja["ui/languages.json"].mode = 1; }, "[ja] ui/languages.json: mode 1 / field japanese, ja is 0 / japanese");
});

test("assets: present, sized and named by their content", () => {
  const { dir, man } = buildSite();
  try {
    const a = man.files["episode.json"].asset;
    fs.appendFileSync(path.join(dir, a), " ");
    const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes(`episode.json: ${a}:`), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("host: an Overlay story with open fonts has host/host.json and the simple talk window per language", () => {
  const { dir, man } = buildSite(withHost);
  try {
    assert.deepEqual(schema("story-manifest")(man), []);
    assert.ok(schema("story-manifest")({ ...man, host: { ...man.host, kind: "live" } }).some((e) => e.includes("/host/kind")));
    assert.ok(schema("story-manifest")({ ...man, host: { ...man.host, doc: "host.json" } }).some((e) => e.includes("/host/doc")));
    assert.ok(schema("story-manifest")({ ...man, host: { ...man.host, extra: 1 } }).some((e) => e.includes("/host")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const r = validate(withHost);
  assert.equal(r.status, 0, r.lines.join("\n") + r.stderr);
  assert.equal(validate((p) => withHost(p, "afterlive")).status, 0);
  failsWith((p) => { p.common["episode.json"].master._playbackMode = 1; p.man.story.playbackMode = 1; }, "an Overlay story (playbackMode 1) with open fonts has no host");
  failsWith((p) => { withHost(p); p.common["episode.json"].master._playbackMode = 0; p.man.story.playbackMode = 0; }, "host on a story of playbackMode 0");
  failsWith((p) => { withHost(p); p.common["host/host.json"].kind = "afterlive"; }, "host/host.json: kind afterlive, manifest host.kind home");
  failsWith((p) => { withHost(p); p.common["host/host.json"].format = "ournotes.story-host/2"; }, "expected ournotes.story-host/1");
  failsWith((p) => { withHost(p); delete p.groups.en["ui/simple/fonts.json"]; }, "languages.en: ui/simple/fonts.json missing (the story has a host)");
  failsWith((p) => { withHost(p); p.groups.ja["ui/simple/fonts.json"].texts = {}; }, "[ja] ui/simple/fonts.json: text node S/Text has no binding in texts");
  failsWith((p) => { withHost(p); delete p.groups.ja["ui/simple/fonts/font_Test ja_0.png"]; }, "[ja] ui/simple/fonts.json: textures.font_Test ja_0: ui/simple/fonts/font_Test ja_0.png not in the language group");
});

test("chat window texts: a binding per text with open fonts, none with game fonts", () => {
  assert.equal(validate(withChat).status, 0, validate(withChat).lines.join("\n"));
  assert.deepEqual(schema("story-fonts")(buildSiteFonts(withChat)), []);
  failsWith((p) => { withChat(p); delete p.groups.ja["ui/fonts.json"].chatTexts.Line["Line/Top/Name"]; }, "[ja] ui/fonts.json: chat window Line: text Line/Top/Name has no binding in chatTexts");
  failsWith((p) => { withChat(p); p.groups.en["ui/fonts.json"].chatTexts.Line["Line/Top/Name"].localized.fontAsset = "Gone SDF"; }, "chatTexts.Line.Line/Top/Name: font asset Gone SDF not in fonts");
  failsWith((p) => { withChat(p); p.groups.en["ui/fonts.json"].chatTexts.Other = { "O/T": p.groups.en["ui/fonts.json"].texts["W/Talk"] }; }, "chatTexts.Other.O/T: not a text of ui/ui.json chatTexts");
  const game = (p) => {
    withChat(p);
    p.man.fonts = "game";
    for (const lang of ["ja", "en"]) { p.groups[lang]["ui/fonts.json"].source = "game"; p.groups[lang]["ui/languages.json"].fonts = "game"; }
  };
  failsWith(game, "[ja] ui/fonts.json: chatTexts in game-font data");
  assert.equal(validate((p) => { game(p); for (const lang of ["ja", "en"]) delete p.groups[lang]["ui/fonts.json"].chatTexts; }).status, 0);
});

test("dialog texts: a binding per text node of ui.json dialogs", () => {
  const r = validate(withDialog);
  assert.equal(r.status, 0, r.lines.join(" | "));
  failsWith((p) => { withDialog(p); delete p.groups.en["ui/fonts.json"].dialogTexts; }, "[en] ui/fonts.json: dialog Skip: text Skip/Message has no binding in dialogTexts");
  failsWith((p) => { withDialog(p); p.groups.ja["ui/fonts.json"].dialogTexts.Skip["Skip/Other"] = p.groups.ja["ui/fonts.json"].texts["W/Talk"]; }, "dialogTexts.Skip.Skip/Other: not a text of ui/ui.json dialogs");
});

test("frame texts: a binding per text node of the frames with open fonts, none with game fonts", () => {
  const r = validate(withFrames);
  assert.equal(r.status, 0, r.lines.join(" | "));
  assert.deepEqual(schema("story-fonts")(buildSiteFonts(withFrames)), []);
  failsWith((p) => { withFrames(p); delete p.groups.ja["ui/fonts.json"].frameTexts; }, "[ja] ui/fonts.json: frame Comment: text Comment/Body has no binding in frameTexts");
  failsWith((p) => { withFrames(p); p.groups.en["ui/fonts.json"].frameTexts.Plain = { "Plain": p.groups.en["ui/fonts.json"].texts["W/Talk"] }; }, "[en] ui/fonts.json: frameTexts.Plain.Plain: not a text of frames.json frames");
  failsWith((p) => { withFrames(p); p.groups.en["ui/fonts.json"].frameTexts.Comment["Comment/Body"].localized.fontAsset = "Gone SDF"; }, "frameTexts.Comment.Comment/Body: font asset Gone SDF not in fonts");
  failsWith((p) => { withFrames(p); p.common["story.json"].frames = null; delete p.common["frames.json"]; }, "frameTexts.Comment.Comment/Body: not a text of frames.json frames");
  const game = (p) => {
    withFrames(p);
    p.man.fonts = "game";
    for (const lang of ["ja", "en"]) { p.groups[lang]["ui/fonts.json"].source = "game"; p.groups[lang]["ui/languages.json"].fonts = "game"; }
  };
  failsWith(game, "[ja] ui/fonts.json: frameTexts in game-font data");
  assert.equal(validate((p) => { game(p); for (const lang of ["ja", "en"]) delete p.groups[lang]["ui/fonts.json"].frameTexts; }).status, 0);
});

test("missing glyph: characters the font assets lack, drawn as a character the asset holds", () => {
  const r = validate(withMissingGlyph);
  assert.equal(r.status, 0, r.lines.join(" | "));
  const doc = buildSiteFonts(withMissingGlyph);
  assert.deepEqual(schema("story-fonts")(doc), []);
  const a = doc.fonts["Test SDF"];
  assert.ok(schema("story-fonts")({ ...doc, fonts: { "Test SDF": { ...a, missingGlyph: { ...a.missingGlyph, extra: 1 } } } }).some((e) => e.includes("missingGlyph")));
  assert.ok(schema("story-fonts")({ ...doc, fonts: { "Test SDF": { ...a, missingGlyph: { unicode: SQUARE, characters: [] } } } }).some((e) => e.includes("missingGlyph/characters")));
  const edit = (fn) => (p) => { withMissingGlyph(p); fn(p.groups.ja["ui/fonts.json"]); };
  failsWith(edit((f) => { f.fonts["Test SDF"].missingGlyph.characters = [0x48, HEART, VS16]; f.coverage.missingGlyph.unshift("H"); }),
    "[ja] ui/fonts.json fonts.Test SDF: missingGlyph.characters U+0048 held by the asset or its fallbacks");
  failsWith(edit((f) => { delete f.fonts["Test SDF"].characters[SQUARE]; }), "missingGlyph.unicode U+25A1 held by neither the asset nor its fallbacks");
  failsWith(edit((f) => { f.fonts["Test SDF"].missingGlyph.characters.reverse(); }), "missingGlyph.characters not ascending");
  failsWith(edit((f) => { delete f.coverage.missingGlyph; }), "coverage.missingGlyph [], the font assets' missingGlyph characters U+2661 U+FE0F");
  // U+0003: synthesized, no asset holds it
  assert.equal(validate(edit((f) => { f.fonts["Test SDF"].missingGlyph.unicode = 3; delete f.fonts["Test SDF"].characters[SQUARE]; })).status, 0);
  // with the game's TMP settings: the first of the settings' character (0: U+25A1), U+0020, U+0003 the asset holds
  const settings = (unicode, ch = 0) => edit((f) => { f.tmpSettings = { m_missingGlyphCharacter: ch }; f.fonts["Test SDF"].missingGlyph.unicode = unicode; });
  assert.equal(validate(settings(SQUARE)).status, 0);
  failsWith(settings(0x20), "missingGlyph.unicode U+0020, TextMeshPro draws U+25A1");
  failsWith(settings(SQUARE, 0x20), "missingGlyph.unicode U+25A1, TextMeshPro draws U+0020");
});

test("sprite assets: the emoji sprite asset, its material, glyphs and pages, the texts that draw it", () => {
  const r = validate(withSprites);
  assert.equal(r.status, 0, r.lines.join(" | "));
  const doc = buildSiteFonts(withSprites);
  assert.deepEqual(schema("story-fonts")(doc), []);
  const sa = doc.spriteAssets.Emoji;
  assert.ok(schema("story-fonts")({ ...doc, spriteAssets: { Emoji: { ...sa, sequences: [{ name: "1f600", unicode: 0 }] } } }).some((e) => e.includes("sequences/0/name")));
  assert.ok(schema("story-fonts")({ ...doc, spriteAssets: { Emoji: { ...sa, material: undefined } } }).some((e) => e.includes("material")));
  const edit = (fn) => (p) => { withSprites(p); fn(p.groups.en["ui/fonts.json"]); };
  const E = "[en] ui/fonts.json";
  failsWith(edit((f) => { f.texts["W/Talk"].spriteAsset = "Nope"; }), `${E}: texts.W/Talk: sprite asset Nope not in spriteAssets`);
  failsWith(edit((f) => { f.spriteAssets.Other = f.spriteAssets.Emoji; f.texts["W/Talk"].spriteAsset = "Other"; f.coverage.sprites.characters = 4; }),
    `${E}: texts.W/Talk: sprite asset Other, emojiSpriteAsset Emoji`);
  failsWith(edit((f) => { delete f.texts["W/Talk"].m_tintAllSprites; }), `${E}: texts.W/Talk: a sprite asset without m_tintAllSprites`);
  failsWith(edit((f) => { f.emojiSpriteAsset = "Other"; }), `${E}: emojiSpriteAsset Other not in spriteAssets`);
  failsWith(edit((f) => { f.materials["Emoji Material"].shader.shader = TMP; }), `${E} spriteAssets.Emoji: material Emoji Material: shader ${TMP}, not ${SPRITE}`);
  failsWith(edit((f) => { f.spriteAssets.Emoji.characters[0].glyph = 9; }), `${E} spriteAssets.Emoji: character 1f600: glyph 9 not in glyphs`);
  failsWith(edit((f) => { f.spriteAssets.Emoji.characters.reverse(); }), `${E} spriteAssets.Emoji: characters not in the order of their index`);
  failsWith(edit((f) => { f.spriteAssets.Emoji.glyphs[0].rect.m_X = 6; }), `${E} spriteAssets.Emoji: glyph 0: rect + offset leaves page sprite_Emoji (8x8)`);
  failsWith(edit((f) => { f.spriteAssets.Emoji.glyphs[1].rect.m_Width = 2; f.spriteAssets.Emoji.glyphs[1].rect.m_Height = 2; }), `${E} spriteAssets.Emoji: glyph 1: a rect without packed texels`);
  failsWith(edit((f) => { f.coverage.sprites.characters = 3; }), `${E}: coverage.sprites.characters 3, the sprite assets hold 2`);
  failsWith(edit((f) => { f.coverage.sprites.missing = ["1f600"]; }), `${E}: coverage.sprites.missing: 1f600 has an image`);
  failsWith(edit((f) => { f.coverage.sprites.missing = ["263a"]; }), `${E}: coverage.sprites.missing: 263a is not a sprite character`);
  failsWith(edit((f) => { delete f.coverage.sprites; }), `${E}: spriteAssets without coverage.sprites`);
  const bare = (f) => { delete f.spriteAssets; delete f.emojiSpriteAsset; delete f.coverage.sprites; };
  failsWith(edit((f) => { bare(f); }), `${E}: W/Talk: a sprite asset without spriteAssets`);
  failsWith(edit((f) => { bare(f); delete f.texts["W/Talk"].spriteAsset; f.emojiSpriteAsset = "Emoji"; }), `${E}: emojiSpriteAsset without spriteAssets`);
});

test("fallback font assets: the fallback material of each text material (GetFallbackMaterial)", () => {
  const r = validate(withFallback);
  assert.equal(r.status, 0, r.lines.join(" | "));
  assert.deepEqual(schema("story-fonts")(buildSiteFonts(withFallback)), []);
  const edit = (fn) => (p) => { withFallback(p); fn(p.groups.ja["ui/fonts.json"]); };
  const M = "Test - Outline + Fb SDF", E = "[ja] ui/fonts.json";
  failsWith(edit((f) => { delete f.materials[M]; delete f.materialKeywords[M]; }),
    `${E}: material ${M} (fallback Fb SDF of Test SDF) not in materials`);
  failsWith(edit((f) => { f.materials[M].floats._GradientScale = 5; }), `${E}: material ${M}: _GradientScale, _ScaleRatioA, _ScaleRatioC not as GetFallbackMaterial(Test - Outline, Fb SDF Material)`);
  failsWith(edit((f) => { f.materials[M].floats._ScaleRatioA = 0.8; }), `material ${M}: _ScaleRatioA not as`);
  failsWith(edit((f) => { f.materials[M].floats._OutlineWidth = 0.3; f.materials[M].floats._ScaleRatioA = Math.fround(15 / 16); }),
    `material ${M}: _OutlineWidth not as`);
  failsWith(edit((f) => { f.materials[M].textures._MainTex.texture.name = "font_Test ja_0"; }), `material ${M}: _MainTex not as`);
  failsWith(edit((f) => { f.materials[M].keywords = []; }), `material ${M}: shader / keywords not as`);
  failsWith(edit((f) => { f.fonts["Test SDF"].fallbacks.push("Test SDF"); }), `${E} fonts.Test SDF: fallbacks list the asset itself or an asset twice`);
});

// ------------------------------------------------------------------------------------------------ models
// a Live2D model m1 used by a Character row: its files in models/m1.json, story.json naming it, the story's shaders
const ADDRESS = "Character/Live2D/g/m1/model/m1";
const withModel = (p, opts = {}) => {
  p.models.m1 = modelFiles("m1", opts);
  p.common["story.json"].models = { [ADDRESS]: "m1" };
  const ep = p.common["episode.json"];
  ep.commands.push({ i: 3, cmd: "Character", raw: 1, TargetName: "a", TargetAssetName: "g/m1/model/m1" });
  ep.commandCount = ep.commands.length;
  p.man.story.commandCount = ep.commands.length;
  p.man.story.commands = p.man.requires.commands = [...p.man.story.commands, "Character"].sort();
  Object.assign(p.common, shaderFiles("shaders", ["Adv/AlphaBlend"]));
};

const expectLine = (r, text) => {
  assert.equal(r.status, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.includes(text)), `"${text}" in:\n${r.lines.join("\n")}`);
};

test("models: the manifest's model manifests, valid as models; live2d/ holds their files alone", () => {
  const ok = validate(withModel);
  assert.equal(ok.status, 0, ok.lines.join("\n") + ok.stderr);
  assert.deepEqual(ok.lines, ["1/1 models valid", "1/1 stories valid"]);
  assert.equal(validate((p) => { withModel(p); p.modelsIndex = true; }).status, 0);
  assert.equal(validate((p) => { withModel(p); p.index = false; }).status, 0);
  assert.equal(validate((p) => { withModel(p, { masked: false, motionSync: true }); }).status, 0);
  // the manifest's models and story.json's
  failsWith((p) => { withModel(p); p.man.models = {}; p.index = false; }, `story.json: models.${ADDRESS}: model m1 is not in the manifest's models`);
  failsWith((p) => { withModel(p); p.common["story.json"].models = {}; }, "manifest: models.m1: no model address of story.json names it");
  failsWith((p) => { withModel(p); p.common["story.json"].models = {}; }, `episode.json: row 3: model ${ADDRESS} is not in story.json models`);
  failsWith((p) => { withModel(p); p.man.models = { m1: "models/other.json" }; p.index = false; }, "manifest: models.m1: models/other.json, expected models/m1.json");
  failsWith((p) => {
    withModel(p);
    p.man.models = { m1: "models/m1.json", m2: "models/m2.json" };
    p.index = false;
    p.common["story.json"].models["Character/Live2D/g/m2/model/m2"] = "m2";
  }, "manifest: models.m2: models/m2.json missing");
  failsWith((p) => {
    withModel(p);
    p.models.m0 = modelFiles("m0");
    p.man.models = { m1: "models/m1.json", m0: "models/m0.json" };
    p.common["story.json"].models["Character/Live2D/g/m0/model/m0"] = "m0";
  }, "manifest: models: keys not sorted");
  failsWith((p) => { withModel(p); p.modelsIndex = []; }, "manifest: models.m1: not in models.json");
  failsWith((p) => { withModel(p); p.index = (e) => { e.size.models += 1; }; }, "stories.json: size");
  // no story file under live2d/
  failsWith((p) => { withModel(p); p.common["live2d/m1/model.json"] = {}; }, "manifest: files: live2d/m1/model.json: live2d/ holds the files of the models");
  failsWith((p) => { withModel(p); p.groups.en["live2d/m1/x.json"] = {}; }, "manifest: languages.en: live2d/m1/x.json: live2d/ holds");
  // a model manifest that is not a valid model fails the model and the story
  const bad = validate((p) => { withModel(p); p.models.m1["extra.json"] = {}; });
  assert.equal(bad.status, 1);
  assert.ok(bad.lines.includes("FAIL m1") && bad.lines.includes("FAIL 7"), bad.lines.join("\n"));
  assert.ok(bad.lines.some((l) => l.startsWith("models/m1.json: not a valid model (1 problem): extra.json: listed but read by neither")),
            bad.lines.join("\n"));
  failsWith((p) => { withModel(p); p.models.m1["model.json"].motionSync = true; },
            "model.json: motionSync true, the prefab's root has no MotionSync controller with a CRI audio input");
});

test("root: the site root seen from the manifest, ../../ for a region's own", () => {
  const r = validate((p) => { withModel(p); p.where = "stories/tw/7.json"; p.man.root = "../../"; });
  assert.equal(r.status, 0, r.lines.join("\n") + r.stderr);
  failsWith((p) => { withModel(p); p.where = "stories/tw/7.json"; }, 'manifest: root "../", the site root from stories/tw/7.json is "../../"');
  failsWith((p) => { p.man.root = "../../"; }, 'manifest: root "../../", the site root from stories/7.json is "../"');
});

test("models: the variants the story renderer draws with at every quality", () => {
  // model.json format 1: valid for the model viewer without the quality-4 variants, but not for a story
  const r = validate((p) => withModel(p, { format: 1, storyLights: false }));
  assert.equal(r.status, 1);
  assert.ok(r.lines.includes("1/1 models valid") && r.lines.includes("0/1 stories valid"), r.lines.join("\n"));
  const lit = "Live2D Cubism/Lit-URP-ADV-optimize";
  assert.ok(r.lines.includes(`models/m1.json: shaders/shaders.json: ${lit}: no variant for [_ADDITIONAL_LIGHTS_VERTEX] (the story renderer's keywords at quality 4)`),
            r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.includes("no variant for [CUBISM_MASK_ON _ADDITIONAL_LIGHTS_VERTEX]")), r.lines.join("\n"));
  assert.equal(validate((p) => withModel(p, { format: 1 })).status, 0);
  // model.json format 2 needs them for the model itself
  const m = validate((p) => withModel(p, { storyLights: false }));
  assert.ok(m.lines.includes("FAIL m1") && m.lines.includes("0/1 models valid"), m.lines.join("\n"));
});

test("encoded assets: gzip and brotli, decoded and checked against their name, size and stored length", () => {
  for (const encoding of ["gzip", "br"]) {
    const { dir, man } = buildSite((p) => { withModel(p); p.encoding = encoding; });
    fs.rmSync(dir, { recursive: true, force: true });
    const ext = encoding === "gzip" ? ".gz" : ".br";
    assert.ok(Object.values(man.files).some((f) => f.asset && f.asset.endsWith(`.json${ext}`) && f.stored < f.size));
    assert.ok(!Object.values(man.files).some((f) => /\.(png|flac)\.(gz|br)$/.test(f.asset || "")));
    assert.deepEqual(schema("story-manifest")(man), []);
    const r = validate((p) => { withModel(p); p.encoding = encoding; });
    assert.equal(r.status, 0, r.lines.join("\n") + r.stderr);
    assert.deepEqual(r.lines, ["1/1 models valid", "1/1 stories valid"]);
  }
  const gz = (p) => { withModel(p); p.encoding = "gzip"; };
  const rewrite = (dir, man) => fs.writeFileSync(path.join(dir, "stories", "7.json"), JSON.stringify(man));
  const epi = (man) => man.files["episode.json"];
  // the stored length is the file's
  expectLine(validateBuilt(gz, (dir, man) => { epi(man).stored += 1; rewrite(dir, man); }), "bytes, manifest stored");
  // the bytes are gzip data that decodes to the named content of `size` bytes
  expectLine(validateBuilt(gz, (dir, man) => { fs.writeFileSync(path.join(dir, epi(man).asset), Buffer.alloc(epi(man).stored, 7)); }),
             "not gzip data");
  expectLine(validateBuilt(gz, (dir, man) => {
    const f = epi(man), other = encode(Buffer.alloc(f.size, 0x20), "gzip");
    fs.writeFileSync(path.join(dir, f.asset), other); f.stored = other.length; rewrite(dir, man);
  }), "content SHA-256 is");
  expectLine(validateBuilt(gz, (dir, man) => {
    const f = epi(man), other = encode(Buffer.alloc(f.size + 1, 0x20), "gzip");
    fs.writeFileSync(path.join(dir, f.asset), other); f.stored = other.length; rewrite(dir, man);
  }), "bytes decoded, manifest");
  // stored exactly on encoded assets, less than size, of a compressible extension
  expectLine(validateBuilt(undefined, (dir, man) => { epi(man).stored = epi(man).size - 1; rewrite(dir, man); }),
             "on an asset that is not encoded");
  expectLine(validateBuilt(undefined, (dir, man) => {
    const text = Buffer.from("{}"), z = encode(text, "gzip"), asset = `assets/${sha256(text)}.json.gz`;
    fs.writeFileSync(path.join(dir, asset), z);
    man.files["extra.json"] = { asset, size: text.length, stored: z.length }; rewrite(dir, man);
  }), "is not less than size 2");
  expectLine(validateBuilt(undefined, (dir, man) => {
    const b = Buffer.concat([fs.readFileSync(path.join(dir, man.files["ui/textures/sprites.png"].asset)), Buffer.alloc(4096)]);
    const z = encode(b, "gzip"), asset = `assets/${sha256(b)}.png.gz`;
    fs.writeFileSync(path.join(dir, asset), z);
    man.files["ui/textures/big.png"] = { asset, size: b.length, stored: z.length }; rewrite(dir, man);
  }), ".png files are stored as they are, not encoded");
  expectLine(validateBuilt(undefined, (dir, man) => {
    const f = epi(man), z = encode(fs.readFileSync(path.join(dir, f.asset)), "gzip");
    fs.writeFileSync(path.join(dir, `${f.asset}.gz`), z);
    man.files["episode.json"] = { asset: `${f.asset}.gz`, size: f.size }; rewrite(dir, man);
  }), "an encoded asset without stored");
});

test("the schemas: stored exactly with a .gz / .br asset, parts of four items, manifest root and models, story.json models", () => {
  const S = schema("story-manifest"), { dir, man } = buildSite(withModel);
  const story = JSON.parse(fs.readFileSync(path.join(dir, man.files["story.json"].asset), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  const a = "a".repeat(64), withFiles = (files) => ({ ...man, files });
  assert.deepEqual(S(man), []);
  assert.deepEqual(S(withFiles({ "x.json": { asset: `assets/${a}.json.gz`, size: 10, stored: 5 },
                                 "y.moc3": { asset: `assets/${a}.moc3.br`, size: 10, stored: 5 },
                                 "z.json": { parts: [["k", `assets/${a}.json`, 3], ["l", `assets/${a}.json.gz`, 30, 20]], size: 40 } })), []);
  for (const bad of [{ "x.json": { asset: `assets/${a}.json.gz`, size: 10 } },
                     { "x.json": { asset: `assets/${a}.json`, size: 10, stored: 5 } },
                     { "x.json": { asset: `assets/${a}.json.zst`, size: 10, stored: 5 } },
                     { "z.json": { parts: [["k", `assets/${a}.json`, 3, 2]], size: 3 } },
                     { "z.json": { parts: [["k", `assets/${a}.json.gz`, 3]], size: 3 } }])
    assert.ok(S(withFiles(bad)).length > 0, JSON.stringify(bad));
  assert.ok(S({ ...man, root: "./" }).some((e) => e.includes("/root")));
  assert.ok(S({ ...man, models: { m1: "live2d/m1.json" } }).some((e) => e.includes("/models/m1")));
  const { root, models, ...legacy } = man;
  assert.equal(root, "../");
  assert.ok(S({ ...legacy, models }).length > 0);                          // format /2 needs root and models
  assert.ok(S({ ...legacy, root }).length > 0);
  assert.deepEqual(S({ ...legacy, format: "ournotes.story-manifest/1" }), []);
  assert.deepEqual(schema("story")(story), []);
  assert.deepEqual(schema("story")({ ...story, modelsDir: "../live2d" }), []);
  assert.ok(schema("story")({ ...story, models: { [ADDRESS]: { dir: "live2d/m1" } } }).some((e) => e.includes("/models/")));
});

// ------------------------------------------------------------------------------------------------ manifest format /1
// a story of manifest format /1: the model's files among its common files (live2d/m1/), story.json models naming them
// by {dir, moc3, prefab}, the story's shaders holding the Lit and mask variants, scene.json resources
const withEmbeddedModel = (p) => {
  withModel(p);
  const files = p.models.m1;
  delete p.models.m1;
  p.man.format = "ournotes.story-manifest/1";
  delete p.man.root;
  for (const k of ["m1.moc3", "m1.prefab.json", "textures/texture_00.png"]) p.common[`live2d/m1/${k}`] = files[k];
  for (const [k, v] of Object.entries(files)) if (k.startsWith("shaders/")) p.common[k] = v;
  const sh = p.common["shaders/shaders.json"];
  p.common["shaders/shaders.json"] = [...sh, ...shaderIndex(["Adv/AlphaBlend"])];
  p.common["story.json"].models = { [ADDRESS]: { dir: "live2d/m1", moc3: "m1.moc3", prefab: "m1.prefab.json" } };
  p.common["scene.json"].resources = files["model.json"].resources;
};

test("manifest format /1: the models' files among the story's, drawn with the story's shaders", () => {
  const { dir, man } = buildSite(withEmbeddedModel);
  const index = JSON.parse(fs.readFileSync(path.join(dir, "stories.json"), "utf8"));
  const story = JSON.parse(fs.readFileSync(path.join(dir, man.files["story.json"].asset), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(schema("story-manifest")(man), []);
  assert.deepEqual(schema("stories")(index), []);
  assert.deepEqual(Object.keys(index.stories[0].size), ["common", "languages"]);
  assert.deepEqual(schema("story")(story), []);
  const r = validate(withEmbeddedModel);
  assert.equal(r.status, 0, r.lines.join("\n") + r.stderr);
  assert.deepEqual(r.lines, ["1/1 stories valid"]);
  assert.equal(validate((p) => { withEmbeddedModel(p); p.encoding = "gzip"; }).status, 0);
  // the story's shaders hold a variant per drawable material
  failsWith((p) => {
    withEmbeddedModel(p);
    const lit = p.common["shaders/shaders.json"][0];
    lit.variants = lit.variants.filter((v) => v.keywords.join(" ") !== "CUBISM_MASK_ON");
  }, "shaders/shaders.json: Live2D Cubism/Lit-URP-ADV-optimize: no variant for [CUBISM_MASK_ON]");
  failsWith((p) => { withEmbeddedModel(p); delete p.common["live2d/m1/m1.moc3"]; }, `story.json: models.${ADDRESS}: live2d/m1/m1.moc3 is not a common file`);
  failsWith((p) => { withEmbeddedModel(p); delete p.common["live2d/m1/textures/texture_00.png"]; }, "live2d/m1/textures/texture_00.png: texture of a drawable not in the manifest");
  // each format names its models in its own form
  failsWith((p) => { withEmbeddedModel(p); p.common["story.json"].models = { [ADDRESS]: "m1" }; }, `story.json: models.${ADDRESS}: not {dir, moc3, prefab}`);
  failsWith((p) => { withModel(p); p.common["story.json"].models = { [ADDRESS]: { dir: "live2d/m1", moc3: "m1.moc3", prefab: "m1.prefab.json" } }; },
            `story.json: models.${ADDRESS}: not a model id`);
  failsWith((p) => { withEmbeddedModel(p); p.index = (e) => { e.size.models = 0; }; }, "stories.json: size");
});
