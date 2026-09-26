// The story schemas (schema/stor*.schema.json, episode.schema.json) and the story checks of scripts/validate-data.mjs
// on a synthetic story site built here: two language groups, one cue sheet with a FLAC waveform, one glyph page per
// language, a UI shader directory with the distance-field shader; variants with a host (an Overlay story) and with
// chat window texts. No game data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";

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
// before they are stored
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
  const man = { format: "ournotes.story-manifest/1", advId: 7, story: facts, language: "en", audio: true, audioFormat: "flac", fonts: "open",
                requires: { commands: facts.commands, cubismCore: true, motionSync: true } };
  const parts = { common, groups, man, index: true };
  edit(parts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-story-"));
  const put = (p, v) => {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : JSON.stringify(v));
    const asset = `assets/${crypto.createHash("sha256").update(b).digest("hex")}.${p.split(".").pop()}`;
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, asset), b);
    return { asset, size: b.length };
  };
  const entries = (files) => Object.fromEntries(Object.entries(files).map(([p, v]) => [p, put(p, v)]));
  const m = { ...parts.man, files: entries(parts.common),
              languages: Object.fromEntries(Object.entries(parts.groups).map(([l, g]) => [l, { files: entries(g) }])) };
  fs.mkdirSync(path.join(dir, "stories"), { recursive: true });
  fs.writeFileSync(path.join(dir, "stories", "7.json"), JSON.stringify(m));
  if (parts.index) {
    const size = (files) => Object.values(files).reduce((n, f) => n + f.size, 0);
    const entry = { id: "7", manifest: "stories/7.json", audio: m.audio, audioFormat: m.audioFormat, fonts: m.fonts, ...m.story,
                    size: { common: size(m.files), languages: Object.fromEntries(Object.entries(m.languages).map(([l, g]) => [l, size(g.files)])) } };
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
  assert.ok(schema("story-manifest")({ ...man, format: "ournotes.story-manifest/2" }).some((e) => e.includes("/format")));
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
