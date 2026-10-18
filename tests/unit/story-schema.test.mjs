// Product schemas and validation of synthetic story graphs, fonts, audio and model dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";
import { ADV_COMMAND } from "../../src/story/interfaces.js";
import { validationFixture, writeFixture, withMissingGlyph, withFallback, GL_SOURCE } from "./story-validation-fixture.mjs";
import { png } from "./site-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(here, "../../scripts/validate-data.mjs");
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, `../../schema/${name}.schema.json`), "utf8")));
const validate = (edit = () => {}, after = null, args = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-validation-"));
  try {
    const fixture = validationFixture(); edit(fixture);
    const manifests = writeFixture(dir, fixture);
    after?.(dir, manifests, fixture);
    const r = spawnSync(process.execPath, [validator, dir, ...args], { encoding: "utf8" });
    return { status: r.status, text: r.stdout + r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const passes = (edit, args) => { const r = validate(edit, null, args); assert.equal(r.status, 0, r.text); return r; };
const fails = (edit, message, after = null) => { const r = validate(edit, after); assert.equal(r.status, 1, r.text); assert.match(r.text, message); };
const editObject = (f, id, fn) => {
  const value = JSON.parse(f.o.objects[id].files.json); fn(value); f.o.objects[id].files.json = JSON.stringify(value);
};
const fontEdit = (fn) => (f) => fn(f.fonts.ja, f);

test("schemas describe the product index, scene, UI, font bindings and episode", () => {
  const f = validationFixture();
  for (const [name, value] of [["story", f.story], ["story-scene", f.scene], ["story-ui", f.ui.ja], ["story-fonts", f.fonts.ja], ["episode", f.episode]])
    assert.deepEqual(schema(name)(value), [], name);
  assert.ok(schema("story")({ ...f.story, format: 99 }).length);
  assert.ok(schema("story-fonts")({ ...f.fonts.ja, texts: { [f.textId]: { localized: {}, style: {} } } }).some((e) => e.includes("font")));
});

test("valid story products validate in every language", () => {
  assert.match(passes().text, /1\/1 stories valid/);
  assert.match(passes(undefined, ["--lang=ja"]).text, /languages: ja/);
});

test("language selection is explicit and product subjects match each language", () => {
  fails(f => { f.manifest.language = "ko"; }, /default language ko/);
  fails(f => { delete f.story.parts.fonts.en; }, /languages differ/);
  fails(f => { f.products.get(f.story.parts.ui.ja).subject = "en"; }, /expected story.ui product of ja/);
  const onlyJa = f => { f.products.delete(f.story.parts.ui.en); f.products.delete(f.story.parts.fonts.en); };
  fails(onlyJa, /ENOENT/);
  passes(onlyJa, ["--lang", "ja"]);
  assert.equal(validate(undefined, null, ["--lang=xx"]).status, 2);
});

test("scene and UI references identify objects of their expected classes", () => {
  fails(f => { f.scene.prefabs.cameraManager = "missing:1"; }, /object missing:1 not in the store/);
  fails(f => { f.scene.prefabs.cameraManager = f.texture; }, /a Texture2D, not a GameObject/);
  fails(f => { f.ui.ja.settings.tmpSettings = f.texture; }, /a Texture2D, not a MonoBehaviour/);
  fails(f => { f.ui.en.language.field = "japanese"; }, /language code\/field differs/);
  fails(f => { f.ui.en.language.mode = 0; }, /language code\/field differs/);
});

test("episode subjects, row counts and executed commands are checked", () => {
  fails(f => { f.episode.advId = 8; }, /subject disagree/);
  fails(f => { f.episode.commandCount++; }, /commandCount differs/);
  fails(f => { f.episode.commands.push({ i: 2, cmd: "UnknownCommand", raw: 999 }); f.episode.commandCount++; }, /unsupported commands: UnknownCommand/);
  passes(f => { f.episode.commands.push({ i: 2, cmd: "UnknownCommand", raw: 999, IgnoreData: 1 }); f.episode.commandCount++; });
  fails(f => editObject(f, f.player, x => { x._initializeEpisodes = [{ Command: 999 }]; }), /AdvCommand 999/);
});

test("cue sheets and waveforms agree with episode sound rows", () => {
  fails(f => { f.episode.sounds[1]._soundCueSheetID = 9; }, /cue sheet not in parts.sounds/);
  passes(f => { f.episode.sounds[1]._cueName = "missing"; });
  fails(f => { delete f.products.get(f.story.parts.sounds.sheet_a).files["a.flac"]; }, /a.flac missing/);
  fails(f => { f.cues.bgm_a.samples = 49; }, /FLAC total samples 48/);
  fails(f => { f.cues.bgm_a.sampleRate = 44100; }, /FLAC sample rate 48000/);
  fails(f => { f.cues.bgm_a.loopStart = 10; f.cues.bgm_a.loopEnd = 100; }, /loop points outside/);
  fails(f => { f.cues.bgm_a.encoderDelay = 1; }, /invalid encoderDelay/);
  fails(f => { f.cues.bgm_a.categories = "Bgm"; }, /categories must be an array/);
});

test("audio-disabled products retain valid cue metadata without waveform files", () => {
  const silent = f => {
    f.manifest.audio = false;
    delete f.products.get(f.story.parts.sounds.sheet_a).files["a.flac"];
  };
  passes(silent);
  fails(f => { silent(f); f.cues.bgm_a.categories = "Bgm"; }, /categories must be an array/);
  fails(f => { f.manifest.audio = "false"; }, /audio/);
});

test("fonts bind TMP component ids to the selected font and material", () => {
  fails(f => { delete f.fonts.ja.texts[f.textId]; }, /has no font binding/);
  fails(f => { f.fonts.ja.texts["missing:1"] = f.fonts.ja.texts[f.textId]; }, /not a TMP component/);
  fails(fontEdit((d, f) => { d.texts[f.textId].font.fontAsset = "Absent"; }), /font asset Absent not in fonts/);
  fails(fontEdit((d, f) => { d.texts[f.textId].font.material = "Absent"; }), /material Absent not in materials/);
  passes(fontEdit((d, f) => { d.texts[f.textId].localized = { fontAsset: "Source", material: "Source", lineSpacing: 0 }; }));
  passes(fontEdit((d, f) => { d.texts[f.textId].localized = null; }));
});

test("font glyphs fit their declared PNG pages", () => {
  fails(fontEdit(d => { d.fonts["Test SDF"].characters[72].glyph = 99; }), /glyph 99 not in glyphs/);
  fails(fontEdit(d => { d.fonts["Test SDF"].glyphs[3].packed.dx = 16; }), /rect \+ offset leaves page/);
  fails(fontEdit(d => { delete d.fonts["Test SDF"].glyphs[3].packed; }), /rect without packed texels/);
  fails(fontEdit(d => { Object.values(d.textures)[0].width = 32; }), /dimensions\/mip count differ/);
  fails(f => { delete f.products.get(f.story.parts.fonts.ja).files["fonts/font_Test ja_0.png"]; }, /missing/);
});

test("font shader variants and selected program files are present", () => {
  fails(fontEdit(d => { d.materials["Test - Outline"].shader.shader = "Absent"; }), /Absent not in the index/);
  fails(fontEdit(d => { delete d.materialKeywords["Test - Outline"]; }), /no materialKeywords/);
  fails(f => { const object = f.o.objects[f.shader]; delete object.files[Object.keys(object.files).find(k => k.startsWith("program:") && k.endsWith("1"))]; }, /selected shader program missing/);
  fails(f => { const object = f.o.objects[f.shader]; object.files[Object.keys(object.files).find(k => k.startsWith("program:"))] = "invalid"; }, /VERTEX/);
});

test("missing glyph records describe absent characters and the configured substitute", () => {
  passes(withMissingGlyph);
  const edit = fn => f => { withMissingGlyph(f); fn(f.fonts.ja, f); };
  fails(edit(d => { d.fonts["Test SDF"].missingGlyph.characters = [72]; d.coverage.missingGlyph = ["H"]; }), /held by the asset/);
  fails(edit(d => { delete d.fonts["Test SDF"].characters[0x25a1]; }), /held by neither/);
  fails(edit(d => { d.fonts["Test SDF"].missingGlyph.characters.reverse(); }), /not ascending/);
  fails(edit(d => { delete d.coverage.missingGlyph; }), /coverage.missingGlyph differs/);
  fails(edit(d => { d.fonts["Test SDF"].missingGlyph.unicode = 32; }), /TextMeshPro draws U\+25A1/);
  passes(edit((d, f) => { editObject(f, f.tmp, x => { x.m_missingGlyphCharacter = 32; }); for (const x of Object.values(f.fonts)) x.fonts["Test SDF"].missingGlyph.unicode = 32; }));
});

test("fallback font materials preserve inherited properties and recomputed ratios", () => {
  passes(withFallback);
  const edit = fn => f => { withFallback(f); fn(f.fonts.ja); };
  const name = "Test - Outline + Fb SDF";
  fails(edit(d => { delete d.materials[name]; delete d.materialKeywords[name]; }), /fallback Fb SDF.*not in materials/);
  fails(edit(d => { d.materials[name].floats._GradientScale = 5; }), /_GradientScale/);
  fails(edit(d => { d.materials[name].floats._ScaleRatioA = 0.8; }), /_ScaleRatioA not as/);
  fails(edit(d => { d.materials[name].floats._OutlineWidth = 0.3; }), /_OutlineWidth not as/);
  fails(edit(d => { d.materials[name].textures._MainTex.texture.name = "wrong"; }), /_MainTex not as/);
  fails(edit(d => { d.fonts["Test SDF"].fallbacks.push("Test SDF"); }), /fallbacks list the asset itself/);
});

const withSprites = f => {
  const name = "TextMeshPro/Sprite", shader = f.o.shader(name, { properties: [], subShaders: [{ passes: [{ state: {} }] }] }, [[[], GL_SOURCE]]);
  for (const [lang, d] of Object.entries(f.fonts)) {
    const page = "sprite", source = f.products.get(f.story.parts.fonts[lang]); source.objects[shader] = f.o.objects[shader];
    d.shaders[name] = shader;
    d.materials.Sprite = { material: "Sprite", shader: { shader: name }, keywords: [], textures: {}, floats: {}, colors: {} };
    d.materialKeywords.Sprite = [];
    const glyph = structuredClone(d.fonts["Test SDF"].glyphs[3]); glyph.packed.texture = page;
    d.spriteAssets = { Emoji: { faceInfo: { m_PointSize: 0, m_Scale: 1, m_Baseline: 0, m_AscentLine: 0, m_DescentLine: 0 },
      material: "Sprite", sequences: [], characters: [{ index: 0, unicode: 0x1f600, name: "1f600", glyph: 0, scale: 1 }], glyphs: { 0: glyph } } };
    d.emojiSpriteAsset = "Emoji"; d.sprites[f.textId] = { spriteAsset: "Emoji" }; d.coverage.sprites = { characters: 1, missing: [] };
    d.textures[page] = { texture: "fonts/sprite.png", name: page, width: 16, height: 12, mipCount: 1, settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } };
    source.files["fonts/sprite.png"] = png(16, 12);
  }
};
test("emoji assets, glyphs, materials and text references are checked", () => {
  passes(withSprites);
  const edit = fn => f => { withSprites(f); fn(f.fonts.ja, f); };
  fails(edit((d, f) => { d.sprites[f.textId].spriteAsset = "Absent"; }), /not the emoji sprite asset/);
  fails(edit(d => { d.spriteAssets.Emoji.material = "Absent"; }), /material Absent not in materials/);
  fails(edit(d => { d.spriteAssets.Emoji.characters[0].glyph = 1; }), /glyph 1 missing/);
  fails(edit(d => { d.coverage.sprites.characters = 2; }), /coverage.sprites.characters differs/);
  fails(edit(d => { d.coverage.sprites.missing = ["1f600"]; }), /not a missing sprite/);
});

test("all text sources share component-id font bindings", () => {
  for (const source of ["dialog", "chat", "frame"]) passes(f => {
    const id = f.o.prefab([{ path: source, name: source, localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, active: true,
      components: [{ type: "MonoBehaviour", pathId: "1001", script: "Test||TextMeshProUGUI", fields: {} }] }]);
    const doc = JSON.parse(f.o.objects[id].files.json); doc.nodes[0].components[0].pathId = "1001"; f.o.objects[id].files.json = JSON.stringify(doc);
    for (const [lang, d] of Object.entries(f.fonts)) {
      d.texts["fixture:1001"] = structuredClone(d.texts[f.textId]);
      f.ui[lang].texts["fixture:1001"] = structuredClone(f.ui[lang].texts[f.textId]);
      if (source === "dialog") f.ui[lang].dialogs.Dialog = id;
    }
    if (source !== "dialog") { const key = source === "chat" ? "Adv/ChatWindow/chat" : "Adv/Frame/frame";
      f.story.parts.assets[key] = `storyassets/${source}.json`; f.add(`storyassets/${source}.json`, "story.asset", key, { "asset.json": { format: 1, key, objects: [id], bindings: {}, shaders: {} } }); }
  });
});

const withOverlay = f => {
  f.episode.master._playbackMode = 1; f.story.host = { kind: "afterlive" };
  const r = { prefab: f.prefab, path: "Widget" };
  f.story.parts.host = { afterlive: "storyhosts/afterlive.json" };
  f.add("storyhosts/afterlive.json", "story.host", "afterlive", { "host.json": { format: "nnnotes.story-host/1", kind: "afterlive",
    cameraTarget: f.prefab, dotween: f.ui.ja.settings.dotween, prefabs: {}, overlayRoot: r, layoutRoot: { ...r, fields: {} }, openedSequences: [], home: null,
    afterlive: { rewardPanel: r, backgroundImage: r, backgroundSprite: f.sprite }, graphics: { graphics: f.graphics }, bindings: {}, shaders: {} } });
  f.story.parts.simpleui = {};
  for (const lang of Object.keys(f.fonts)) { const u = f.ui[lang], file = `storysimpleui/${lang}.json`; f.story.parts.simpleui[lang] = file;
    f.add(file, "story.simpleui", lang, { "ui.json": { format: "nnnotes.story-simple-ui/1", language: u.language, settings: u.settings,
      graphics: u.graphics, texts: u.texts, textStyle: {}, bindings: {}, shaders: {}, talkWindow: f.prefab, systemMessage: f.prefab, uiManager: f.prefab } }); }
};
test("Overlay products reference their host nodes and simple UI", () => {
  passes(withOverlay);
  fails(f => { withOverlay(f); delete f.story.parts.simpleui; }, /requires parts.simpleui/);
  fails(f => { withOverlay(f); f.products.get("storyhosts/afterlive.json").files["host.json"].overlayRoot = { prefab: f.prefab, path: "Gone" }; }, /node Gone not in/);
  fails(f => { withOverlay(f); f.story.host.kind = "home"; }, /kind differs from the episode host/);
});

test("CRI Lips weights match their typed descriptor and block bounds", () => {
  const add = f => { f.story.parts.crilips = "crilips/default.json"; f.add(f.story.parts.crilips, "story.crilips", "default", {
    "crilips.json": { dtype: "float32", order: "LE", total_floats: 2, constants: {}, frontend: {}, blocks: [{ name: "weights", offset: 0, count: 2 }] }, "crilips.bin": Buffer.alloc(8) }); };
  passes(add);
  fails(f => { add(f); f.products.get(f.story.parts.crilips).files["crilips.json"].blocks[0].count = 3; }, /outside weights/);
  fails(f => { add(f); f.products.get(f.story.parts.crilips).files["crilips.json"].total_floats = 3; }, /differs from total_floats/);
});

test("model dependencies are validated and Character rows must name them", () => {
  passes(f => { f.modelOptions = {}; });
  fails(f => { f.episode.commands.push({ i: 2, cmd: "Character", raw: ADV_COMMAND.indexOf("Character"), TargetAssetName: "g/m/model/m" }); f.episode.commandCount++; }, /not in parts.models/);
  fails(f => { f.modelOptions = { storyLights: false }; }, /no variant|story renderer|_ADDITIONAL_LIGHTS_VERTEX/);
  fails(f => { f.modelOptions = {}; }, /expected live2d.model product/, (dir) => {
    const file = path.join(dir, "models/m1.json"), m = JSON.parse(fs.readFileSync(file, "utf8")); m.subject = "wrong"; fs.writeFileSync(file, JSON.stringify(m));
  });
});

test("assets are present and checked against their byte counts and content names", () => {
  fails(undefined, /missing|ENOENT/, (dir, manifests) => { fs.unlinkSync(path.join(dir, manifests.get("stories/7.json").files["episode.json"].asset)); });
  fails(undefined, /bytes|size/, (dir, manifests) => { const m = manifests.get("stories/7.json"); m.files["episode.json"].size++; fs.writeFileSync(path.join(dir, "stories/7.json"), JSON.stringify(m)); });
  fails(undefined, /SHA|hash|name/, (dir, manifests) => { const file = path.join(dir, manifests.get("stories/7.json").files["episode.json"].asset); const b = fs.readFileSync(file); b[1] ^= 1; fs.writeFileSync(file, b); });
});

test("gzip and brotli product files retain decoded and stored byte checks", () => {
  for (const encoding of ["gzip", "br"]) {
    passes(f => { f.encoding = encoding; });
    fails(f => { f.encoding = encoding; }, /stored/, (dir, manifests) => { const m = manifests.get("stories/7.json"); m.files["episode.json"].stored++; fs.writeFileSync(path.join(dir, "stories/7.json"), JSON.stringify(m)); });
  }
});

test("regional story manifests resolve from their explicit site root", () => {
  passes(f => { f.where = "stories/tw/7.json"; f.manifest.root = "../../"; });
  fails(f => { f.where = "stories/tw/7.json"; }, /expected \.\.\/\.\.\//);
});
