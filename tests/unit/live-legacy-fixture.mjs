// A synthetic chart of the site layout (docs/data-format.md "Chart manifest"): live.json, the score, live-audio.json
// with its waveforms, livescene/ and livenotes/ with their objects inline and their packed shaders. Every kind of
// inline object the live's reader converts appears once: prefabs with references between the scene's roots, materials
// (one of a shader the chart does not pack), sprites, textures with and without their image, a mesh, MonoBehaviour
// assets, a timeline whose track binds an Animator, clips and controllers of the note assets by key, the note skin
// with a flick arrow clip, the lane and note effect sets, the live UI sprite assets.
// chartFiles(extra) -> {text: {path: text}, bytes: {path: Uint8Array}}; `extra` is merged into live.json.

const V0 = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, V1 = { x: 1, y: 1, z: 1 };
const node = (path, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 0, tag: "Untagged",
                                           localPosition: V0, localRotation: Q, localScale: V1, components });
export const texture = (name) => ({ texture: `textures/${name}.png`, name, width: 4, height: 4, mipCount: 1, colorSpace: 1,
                                    settings: { m_FilterMode: 1, m_WrapU: 1, m_WrapV: 1 } });
export const sprite = (name) => ({
  sprite: name, texture: texture(name), rect: { x: 0, y: 0, width: 4, height: 4 }, pivot: { x: 0.5, y: 0.5 },
  border: { x: 0, y: 0, z: 0, w: 0 }, pixelsToUnits: 100, offset: { x: 0, y: 0 }, textureRect: { x: 0, y: 0, width: 4, height: 4 },
  textureRectOffset: { x: 0, y: 0 }, settingsRaw: 0, uvTransform: { x: 100, y: 2, z: 100, w: 2 },
});
const material = (name, shader = "Sprites/Default") => ({
  material: name, shader: { shader }, keywords: [], ints: {}, floats: { _Z: 1 }, colors: {},
  textures: { _MainTex: { texture: texture("white"), scale: { x: 1, y: 1 }, offset: { x: 0, y: 0 } } },
});
const clip = (name, path, attribute, extra = {}) => ({
  name, streamed: { curves: [] }, length: 1, loopTime: true,
  bindings: [{ path, attribute, pathCrc: 11, attributeCrc: 22, typeID: 4, class: "Transform", ...extra }],
});
const sr = (m, s) => ({ type: "SpriteRenderer", m_Enabled: 1, m_Materials: [m], m_Sprite: s, m_Size: V1,
                        m_Color: { r: 1, g: 1, b: 1, a: 1 }, m_SortingOrder: 0, m_SortingLayer: 0, m_DrawMode: 0 });
const effectPrefab = (key, cls) => ({ key, nodes: [node(key, [{ type: "MonoBehaviour", class: cls, _duration: 1 }]),
  node(`${key}/ps`, [{ type: "ParticleSystemRenderer", m_UseCustomVertexStreams: 1, m_VertexStreams: [0, 1, 3, 4] }])] });

export const SCENE = {
  scene: { key: "scene", nodes: [
    node("Live", [{ type: "Animator", m_Controller: { controller: "UILiveCombo#5" } }]),
    node("Live/judge", [sr(material("JudgeMat"), sprite("judge"))]),
    node("Stage", [{ type: "MonoBehaviour", class: "StageView",
                     _judge: { gameObject: "Live/judge", component: "SpriteRenderer" }, _self: { gameObject: "Stage/mesh" } }]),
    node("Stage/mesh", [{ type: "MeshRenderer", m_Materials: [material("Unpacked", "Hidden/NotPacked")] },
                        { type: "MeshFilter", m_Mesh: { mesh: "quad", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uv0: [[0, 0], [1, 0], [0, 1]],
                                                        submeshes: [[0, 1, 2]], m_LocalAABB: {} } }]),
  ] },
  assets: {
    startTimeline: { key: "start_timeline", nodes: [node("StartTimeline", [
      { type: "PlayableDirector", m_PlayableAsset: { asset: "TimelineAsset", m_Name: "Start", m_Tracks: [{
        asset: "AnimationTrack", m_Name: "Band", boundAnimator: { key: "start_timeline", gameObject: "StartTimeline/band" },
        m_Clips: [{ m_Start: 0, m_Duration: 2, m_PostExtrapolationTime: Infinity,
                    m_Asset: { m_Clip: clip("band_in", "body", "m_LocalPosition.x") } }] }] } }]),
      node("StartTimeline/band", [{ type: "Animator", m_Controller: null }])] },
    laneLinePrefab: { key: "lane_line", nodes: [node("lane_line", [sr(material("LaneMat"), sprite("lane_line"))])] },
  },
  player: {
    pipelines: { URP: { m_Name: "URP", m_RendererDataList: ["Forward", null] } }, defaultPipeline: "URP",
    renderers: { Forward: { m_Name: "Forward", postProcessData: "Post" } },
    postProcessData: { Post: { m_Name: "Post", textures: { filmGrainTex: [] } } },
    qualityLevels: [{ name: "Low" }], colorSpace: "Linear",
  },
  postTextures: { Forward: { filmGrainTex: [texture("grain")] } },
  slice: { band: 3, laneSkin: "lane01" },
  laneSkin: { base: sprite("lane_base") },
  sprites: { lightweightBackground: sprite("bg"), jacket: sprite("jacket") },
  master: { liveLaneSkin: [{ _id: 1, _assetName: "lane01" }], optionDefaultsPreset1: { LaneOpacity: { value: "80" } },
            optionRanges: { LaneOpacity: [0, 100] }, liveQualitySettings: [] },
};

export const NOTES = {
  settings: { skin: "skin001", effect: "effect001", skins: { 1: "skin001" }, effects: { 1: "effect001" },
              judgementSprites: { perfect: "judge_perfect" }, optionDefaults: { NoteSpeed: "5.00" },
              optionRanges: { NoteSpeed: [100, 1200] }, liveSettings: {}, noteDisplayTimeMs: 1000 },
  prefabs: {
    tap_note_view: { key: "tap_note_view", nodes: [node("tap_note_view", [{ type: "MonoBehaviour", class: "LiveNoteView" }])] },
    flick_note_view: { key: "flick_note_view", nodes: [
      node("flick_note_view", [{ type: "MonoBehaviour", class: "LiveFlickNoteView",
                                 _loopAnimationTimeSync: { gameObject: "flick_note_view/arrow", component: "MonoBehaviour" } }]),
      node("flick_note_view/arrow", [{ type: "MonoBehaviour", class: "LoopAnimationTimeSync",
                                       _animator: { gameObject: "flick_note_view/arrow/anim_root", component: "Animator" },
                                       _loopAnim: { clip: "arrow_loop#1" } }]),
      node("flick_note_view/arrow/anim_root", [{ type: "Animator", m_Controller: null }])] },
    judge_effect_view: { key: "judge_effect_view", nodes: [node("judge_effect_view", [sr(material("JudgeMat"), sprite("judge"))])] },
  },
  noteSkin: { asset: "LiveNoteSkinAsset", m_Name: "skin001",
              TapNoteAsset: { asset: "NoteSkinAssetUnit", m_Name: "tap", _mainSprite: sprite("tap"), _centerMarkSprite: null },
              FlickNoteAsset: { asset: "NoteSkinAssetUnit", m_Name: "flick", _mainSprite: sprite("flick"),
                                _arrowLoopAnimation: { clip: "arrow_skin#2" } } },
  assets: {
    "Effect/Live/LaneEffect/effect001/LiveLaneEffectAssetSettings": { asset: "LiveLaneEffectAssetSettings", m_Name: "lane",
      _tap: { class: "LiveLaneEffectAsset", gameObject: "lane_tap" } },
    "Effect/Live/LaneEffect/effect001/lane_tap": effectPrefab("lane_tap", "LiveLaneEffectAsset"),
    "Effect/Live/NoteEffect/effect001/LiveNoteEffectAssetSettings": { asset: "LiveNoteEffectAssetSettings", m_Name: "note",
      _tap: { class: "LiveNoteEffectAsset", gameObject: "note_tap" } },
    "Effect/Live/NoteEffect/effect001/note_tap": effectPrefab("note_tap", "LiveNoteEffectAsset"),
    "Live/UiSpriteAssets/LiveComboSpriteAsset": { asset: "LiveComboSpriteAsset", m_Name: "combo", _digits: [sprite("digit0")] },
    "Live/UiSpriteAssets/LiveJudgementSpriteAsset": { asset: "LiveJudgementSpriteAsset", m_Name: "judgement",
                                                      _perfect: sprite("judge_perfect") },
  },
  clips: {
    "arrow_loop#1": clip("arrow_loop", "arrow", "m_LocalPosition.y"),
    "arrow_skin#2": clip("arrow_skin", "arrow", null, { class: "SpriteRenderer", typeID: 212, pptr: true, attributeCrc: 0 }),
    "combo#3": clip("combo", "Live/judge", "m_IsActive"),
  },
  controllers: { "UILiveCombo#5": { name: "UILiveCombo", clips: [{ clip: "combo#3" }], layers: [] } },
};

const SHADER = "Sprites/Default";
const json = (v) => JSON.stringify(v, (k, x) => (x === Infinity ? "\u0000inf" : x)).replaceAll('"\\u0000inf"', "1e999");
const layer = (file) => ({ file, sampleRate: 48000, channels: 2, samples: 4800, loopFlag: 0, loopStart: null,
                           loopEnd: null, volume: 1 });
const cue = (sheet, file, categories) => ({ sheet, cue: sheet, category: 1, categories, volume: 1,
                                           row: { _isRandomPitch: false }, layers: [layer(file)] });

export const chartFiles = (extra = {}) => ({
  text: {
    "live.json": JSON.stringify({ musicId: 7, difficulty: "expert", scene: "livescene/scene.json",
                                  notes: "score/m7_03.notes.json", notesMirror: "score/m7_03.mirror.notes.json",
                                  noteAssets: "livenotes/notes.json", liveAudio: "audio/live-audio.json", ...extra }),
    "score/m7_03.notes.json": JSON.stringify({ notes: [1] }), "score/m7_03.mirror.notes.json": JSON.stringify({ notes: [2] }),
    "audio/live-audio.json": JSON.stringify({
      sounds: { 1: cue("bgm_7", "audio/bgm_7/bgm_7.m4a", ["LiveBgm"]), 10: cue("se1", "audio/se1/a.flac", ["LiveSe"]) },
      categories: { LiveBgm: 1, LiveSe: 1 }, react: [], music: { soundId: 1 }, noteSe: { types: { 1: 10 } }, liveSe: {},
      timeline: { startCheerDelaySec: 1 } }),
    "livescene/scene.json": json(SCENE), "livenotes/notes.json": json(NOTES),
    "livescene/shaders/shaders.json": JSON.stringify([{ name: SHADER, parsed: "Sprites_Default.json", variants: [
      { file: "Sprites_Default/gles3/v0.glsl", platform: "gles3", type: "GLES3", subShader: 0, pass: 0, keywords: [] }] }]),
    "livescene/shaders/Sprites_Default.json": JSON.stringify({ name: SHADER, properties: [], subShaders: [] }),
    "livescene/shaders/Sprites_Default/gles3/v0.glsl": "#version 300 es\n",
    "livenotes/shaders/shaders.json": "[]",
  },
  bytes: { "audio/bgm_7/bgm_7.m4a": new Uint8Array([7]), "audio/se1/a.flac": new Uint8Array([1]),
           "livescene/textures/judge.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
});
