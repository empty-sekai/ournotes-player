// Loading a live (src/live/store.js), its documents (src/live/data.js) and charts of the site layout read as lives
// (src/live/legacy.js), over a product layout and a chart site in memory. Synthetic data only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore, PRODUCT_MANIFEST } from "../../src/data/assets.js";
import { LiveData } from "../../src/live/data.js";
import { isLegacyLive, legacyLive } from "../../src/live/legacy.js";
import { LIVE_PARTS, loadLiveStore, productDir } from "../../src/live/store.js";
import { chartFiles } from "./live-legacy-fixture.mjs";

const ROOT = "https://example.org/out/";

// a product layout in memory: path -> JSON document or bytes; a product's files are assets named by their path
const layout = () => {
  const files = new Map();
  const product = (manifest, product, subject, own, objects = {}) => {
    const entries = {};
    for (const [p, body] of Object.entries(own)) {
      const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
      const asset = `assets/${manifest.replace(/[/.]/g, "_")}_${p.replace(/[/.]/g, "_")}${p.endsWith(".json") ? ".json" : ".bin"}`;
      files.set(asset, bytes);
      entries[p] = { asset, size: bytes.byteLength };
    }
    files.set(manifest, { schema: PRODUCT_MANIFEST, product, subject, files: entries, objects });
  };
  const fetch = async (u) => {
    const p = String(u).slice(ROOT.length), v = files.get(p);
    if (v === undefined) return { ok: false, status: 404 };
    const bytes = v instanceof Uint8Array ? v : new TextEncoder().encode(JSON.stringify(v));
    return { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(bytes)),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  return { files, product, fetch };
};

const TEX = { class: "Texture2D", name: "t", files: { json: { asset: "assets/tex.json", size: 2 } } };
const PARTS = { scene: "scenes/default.json", notes: "notes/default.json", noteskin: "noteskins/skin001.json",
                noteeffect: "noteeffects/effect001.json", sounds: "sounds/default.json", music: "music/7.json" };
const layer = (file) => ({ file, sampleRate: 48000, channels: 2, samples: 4800, loopFlag: 0, loopStart: null,
                           loopEnd: null, volume: 1 });
const cue = (sheet, file, cats) => ({ sheet, cue: sheet, category: 1, categories: cats, volume: 1,
                                      row: { _isRandomPitch: false }, layers: [layer(file)] });

const live = () => {
  const L = layout();
  L.files.set("assets/tex.json", new TextEncoder().encode("{}"));
  L.product("lives/7_expert.json", "live", "7/expert",
            { "live.json": { format: 1, musicId: 7, difficulty: "expert", notes: "notes.json",
                             notesMirror: "notes.mirror.json", parts: PARTS },
              "notes.json": { notes: [1] }, "notes.mirror.json": { notes: [2] } }, { "a:1": TEX });
  L.product("scenes/default.json", "live.scene", "default", { "scene.json": { format: 1 } }, { "a:1": TEX });
  L.product("notes/default.json", "live.notes", "default", { "notes.json": { format: 1 } });
  for (const s of ["skin001", "skin002"]) L.product(`noteskins/${s}.json`, "live.noteskin", s, { "noteskin.json": { name: s } });
  L.product("noteeffects/effect001.json", "live.noteeffect", "effect001", { "noteeffect.json": {} });
  L.product("sounds/default.json", "live.sounds", "default", {
    "sounds.json": { format: 1, sounds: { 10: cue("se1", "audio/se1/a.flac", ["LiveSe"]) }, categories: { LiveSe: 1 },
                     noteSe: { types: { 1: 10 }, patternId: 1 } },
    "audio/se1/a.flac": new Uint8Array([1]) });
  L.product("sounds/NoteSePatternId=1,3.json", "live.sounds", "NoteSePatternId=1,3", {
    "sounds.json": { format: 1, sounds: { 10: cue("se1", "audio/se1/a.flac", ["LiveSe"]), 30: cue("se3", "audio/se3/a.flac", ["LiveSe"]) },
                     categories: { LiveSe: 1 }, noteSe: { types: { 1: 10 }, patternId: 1, groups: { 1: { 1: 10 }, 3: { 1: 30 } } } },
    "audio/se1/a.flac": new Uint8Array([1]), "audio/se3/a.flac": new Uint8Array([3]) });
  L.product("music/7.json", "live.music", "7", {
    "music.json": { format: 1, musicId: 7, music: { soundId: 1 }, sounds: { 1: cue("bgm_7", "audio/bgm_7/bgm_7.m4a", ["LiveBgm"]) } },
    "audio/bgm_7/bgm_7.m4a": new Uint8Array([7]) });
  return L;
};

test("a regional live manifest resolves products against its declared root", async () => {
  const L = live(), man = L.files.get("lives/7_expert.json");
  L.files.set("lives/region/7_expert.json", { ...man, root: "../../" });
  const store = await loadLiveStore(`${ROOT}lives/region/7_expert.json`, { fetch: L.fetch });
  assert.equal(store.info.dir, "lives/region/7_expert");
  assert.deepEqual(new LiveData(store).score().notes, [1]);
  assert.deepEqual(new LiveData(store).audio().sounds[10].layers[0].file, "sounds/default/audio/se1/a.flac");
});

test("a live manifest loads its offered variant products", async () => {
  const L = live();
  L.files.get("lives/7_expert.json").variants = ["noteskins/skin002.json"];
  const store = await loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch });
  assert.ok(store.info.products["live.noteskin"].skin002);
});

test("productDir: a product manifest path without .json", () => {
  assert.equal(productDir("scenes/default.json"), "scenes/default");
  assert.equal(productDir("sounds/NoteSePatternId=1,3.json"), "sounds/NoteSePatternId=1,3");
  assert.equal(productDir("region/scenes/default.json"), "region/scenes/default");
  for (const bad of ["scene.json", "a/../c.json", "scenes/default"])
    assert.throws(() => productDir(bad), /not a product manifest path/);
});

test("LiveData accepts language-indexed UI parts beside shared parts", async () => {
  const L = live();
  const manifest = L.files.get("lives/7_expert.json"), path = manifest.files["live.json"].asset;
  const doc = JSON.parse(new TextDecoder().decode(L.files.get(path)));
  doc.parts.ui = { ja: "liveui/7_expert_ja.json", en: "liveui/7_expert_en.json" };
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  L.files.set(path, bytes);
  manifest.files["live.json"].size = bytes.byteLength;
  const data = new LiveData(await loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch }));
  assert.equal(data.scene.format, 1);
  assert.deepEqual(data.score().notes, [1]);
  assert.equal(data.live.parts.ui.ja, "liveui/7_expert_ja.json");
});

test("loadLiveStore: the live, its parts and the variants, each under its directory, one object table", async () => {
  const L = live();
  const store = await loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch, variants: ["noteskins/skin002.json"] });
  assert.equal(store.info.dir, "lives/7_expert");
  assert.deepEqual(store.info.products, {
    live: { "7/expert": "lives/7_expert" }, "live.scene": { default: "scenes/default" },
    "live.notes": { default: "notes/default" }, "live.noteskin": { skin001: "noteskins/skin001", skin002: "noteskins/skin002" },
    "live.noteeffect": { effect001: "noteeffects/effect001" }, "live.sounds": { default: "sounds/default" },
    "live.music": { 7: "music/7" } });
  assert.deepEqual(store.json("noteskins/skin002/noteskin.json"), { name: "skin002" });
  assert.deepEqual([...store.bytes("music/7/audio/bgm_7/bgm_7.m4a")], [7]);
  assert.deepEqual(store.object("a:1", "Texture2D"), { id: "a:1", class: "Texture2D", name: "t" });   // in two products
  assert.equal(Object.keys(LIVE_PARTS).length, 6);
});

test("loadLiveStore refuses a manifest of another product, a part of the wrong product and differing objects", async () => {
  const L = live();
  await assert.rejects(loadLiveStore(`${ROOT}scenes/default.json`, { fetch: L.fetch }), /not a live manifest/);
  await assert.rejects(loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch, variants: ["scenes/default.json"] }),
                       /not a manifest of live\.noteskin or live\.noteeffect or live\.sounds/);
  L.files.get("scenes/default.json").objects["a:1"] = { ...TEX, name: "other" };
  await assert.rejects(loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch }), /object a:1 differs/);
  L.files.delete("music/7.json");
  await assert.rejects(loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch }), /music\/7\.json: HTTP 404/);
});

test("LiveData: the score, and the sounds of the live.sounds product with the most sets with the music", async () => {
  const L = live();
  const one = new LiveData(await loadLiveStore(`${ROOT}lives/7_expert.json`, { fetch: L.fetch }));
  assert.deepEqual([one.score().notes, one.score(true).notes], [[1], [2]]);
  assert.deepEqual(one.parts, Object.fromEntries(Object.entries(PARTS).map(([k, p]) => [k, p.slice(0, -5)])));
  const a = one.audio();
  assert.deepEqual(Object.keys(a.sounds), ["1", "10"]);
  assert.equal(a.sounds[10].layers[0].file, "sounds/default/audio/se1/a.flac");
  assert.equal(a.sounds[1].layers[0].file, "music/7/audio/bgm_7/bgm_7.m4a");
  assert.deepEqual([a.music, a.categories], [{ soundId: 1 }, { LiveSe: 1 }]);
  const two = new LiveData(await loadLiveStore(`${ROOT}lives/7_expert.json`,
                                               { fetch: L.fetch, variants: ["sounds/NoteSePatternId=1,3.json"] }));
  const b = two.audio();
  assert.deepEqual(Object.keys(b.noteSe.groups), ["1", "3"]);
  assert.equal(b.sounds[30].layers[0].file, "sounds/NoteSePatternId=1,3/audio/se3/a.flac");
  assert.throws(() => new LiveData(new AssetStore()), /not the store of a live/);
});

// a chart of the site layout (live-legacy-fixture.mjs) in memory
const chart = (extra = {}) => new AssetStore({ ...chartFiles(extra), info: { format: 3, chart: { title: "x" }, quality: 1 } });
const refId = (v) => `${v.$ref.file}:${v.$ref.pathId}`;

test("legacyLive: a chart of the site layout read as the store of a live", () => {
  const old = chart();
  assert.ok(isLegacyLive(old) && !isLegacyLive(new AssetStore({ text: { "live.json": "{}" }, info: { schema: PRODUCT_MANIFEST } })));
  const store = legacyLive(old), data = new LiveData(store);
  assert.deepEqual([data.score().notes, data.score(true).notes], [[1], [2]]);
  assert.equal(store.info.dir, "lives/7_expert");
  assert.deepEqual([store.info.chart, store.info.quality, store.info.product], [{ title: "x" }, 1, "live"]);
  assert.deepEqual([data.live.band, store.object(data.live.jacket).class], [{ band: 3 }, "Sprite"]);
  const a = data.audio();
  assert.deepEqual([a.music, Object.keys(a.sounds)], [{ soundId: 1 }, ["1", "10"]]);
  assert.deepEqual([...store.bytes(a.sounds[1].layers[0].file)], [7]);
  assert.deepEqual([...store.bytes(a.sounds[10].layers[0].file)], [1]);
  assert.deepEqual([data.noteskin().name, data.noteeffect().name], ["skin001", "effect001"]);
  assert.equal(new LiveData(legacyLive(chart({ notesMirror: undefined }))).live.notesMirror, undefined);
  assert.throws(() => legacyLive(chart({ musicId: undefined })), /live\.json: no musicId/);
});

test("legacyLive: the scene's roots, references between them, the graphics settings and the band's timeline", () => {
  const store = legacyLive(chart()), scene = new LiveData(store).scene;
  const [live, stage] = scene.scene.map((id) => store.prefab(id));
  assert.deepEqual([live.name, stage.name], ["Live", "Stage"]);
  // a reference into another root: the component; inside the root: the node path as it is
  const view = stage.nodes[0].components[0], judge = live.nodes.find((n) => n.path === "Live/judge");
  assert.deepEqual([view.type, view.script], ["MonoBehaviour", "StageView"]);
  assert.equal(view.fields._judge.$ref.pathId, judge.components[0].pathId);
  assert.deepEqual(view.fields._self, { gameObject: "Stage/mesh" });
  // materials name their shader by object; a shader the chart does not pack names no object
  const mat = store.material(refId(judge.components[0].fields.m_Materials[0]));
  assert.equal(refId(mat.shader), scene.shaders["Sprites/Default"]);
  assert.ok(store.roles(scene.shaders["Sprites/Default"]).includes("program:gles3/v0.glsl"));
  const mesh = stage.nodes.find((n) => n.path === "Stage/mesh");
  assert.equal(store.hasObject(refId(store.material(refId(mesh.components[0].fields.m_Materials[0])).shader)), false);
  assert.deepEqual(store.mesh(refId(mesh.components[1].fields.m_Mesh)).submeshes, [[0, 1, 2]]);
  // a texture has its image when the chart carries the file
  const tex = (sp) => refId(store.objectJson(refId(sp)).renderData.texture);
  assert.ok(store.roles(tex(judge.components[0].fields.m_Sprite)).includes("image"));
  const noteJudge = store.prefab(scene.prefabs.judgeEffectView).nodes[0].components[0].fields.m_Sprite;
  assert.deepEqual(store.roles(tex(noteJudge)), ["json"]);
  // GraphicsSettings -> the pipeline -> its renderers -> the post-process data with the renderer's film grain
  const g = store.objectJson(scene.graphics.graphics), pipe = store.mono(refId(g.m_CustomRenderPipeline));
  assert.equal(pipe.m_RendererDataList[1], null);
  const post = store.mono(refId(store.mono(refId(pipe.m_RendererDataList[0])).postProcessData));
  assert.equal(store.object(refId(post.textures.filmGrainTex[0])).class, "Texture2D");
  assert.deepEqual(scene.settings.optionDefaults, { LaneOpacity: "80" });
  // the band's timeline: its track bound to the timeline prefab's Animator, the clip's bindings under it; an infinite
  // extrapolation time stays infinite
  const band = scene.bands[3], [trackId] = Object.keys(band.tracks);
  assert.deepEqual(band.tracks[trackId], { name: "Band", prefab: band.timeline, animator: "StartTimeline/band" });
  assert.equal(store.mono(trackId).m_Clips[0].m_PostExtrapolationTime, Infinity);
  assert.deepEqual(Object.values(scene.bindings[band.timeline]["StartTimeline/band"]), [[{ path: "body", attribute: "m_LocalPosition.x" }]]);
  // the scene's Animator plays the note assets' controller
  const ctrl = refId(live.nodes[0].components[0].fields.m_Controller);
  assert.equal(store.object(ctrl).class, "AnimatorController");
  assert.deepEqual(Object.values(scene.bindings[scene.scene[0]].Live), [[{ path: "Live/judge", attribute: "m_IsActive" }]]);
});

test("legacyLive: the note assets, the skin's arrow clip and the effect sets' references to their prefabs", () => {
  const store = legacyLive(chart()), data = new LiveData(store);
  const notes = data.notes, skin = data.noteskin(), effect = data.noteeffect();
  assert.deepEqual([notes.settings.laneEffect, notes.settings.judgementSprites], ["effect001", undefined]);
  const flick = notes.prefabs.flick_note_view;
  // the LoopAnimationTimeSync's clip in the notes bindings, the skin's arrow clip (a sprite curve) in the skin's
  const anim = "flick_note_view/arrow/anim_root";
  assert.deepEqual(Object.values(notes.bindings[flick][anim]), [[{ path: "arrow", attribute: "m_LocalPosition.y" }]]);
  const unit = store.mono(refId(store.mono(skin.skin).FlickNoteAsset));
  assert.deepEqual(skin.bindings[flick][anim][refId(unit._arrowLoopAnimation)], [{ path: "arrow", attribute: "m_Sprite" }]);
  // an effect set's field: the effect asset component on the root of its prefab
  for (const [settings, cls] of [[notes.laneEffect, "LiveLaneEffectAsset"], [effect.settings, "LiveNoteEffectAsset"]]) {
    const r = store.mono(settings)._tap, root = store.prefab(store.contained(r).prefab).nodes[0];
    assert.equal(root.components.find((c) => c.pathId === r.$ref.pathId).script, cls);
    const ps = store.prefab(store.contained(r).prefab).nodes[1].components[0].fields;
    assert.deepEqual(ps.m_VertexStreams, { $hex: "00010304" });
  }
  assert.equal(store.mono(data.scene.spriteAssets.combo).$script, "LiveComboSpriteAsset");
});
