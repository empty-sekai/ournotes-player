export const STORY_ROOT = "https://example.test/out/";
const encoder = new TextEncoder();

export const storyFixture = ({ command = "Talk", overlay = false } = {}) => {
  const files = new Map(), requested = [];
  const product = (path, name, subject, own, objects = {}) => {
    const entries = {};
    for (const [file, value] of Object.entries(own)) {
      const asset = `assets/${path.replaceAll("/", "_")}_${file.replaceAll("/", "_")}`;
      const bytes = value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value));
      files.set(asset, bytes);
      entries[file] = { asset, size: bytes.byteLength };
    }
    const manifest = { schema: "nnnotes.product/1", product: name, subject, files: entries, objects };
    files.set(path, encoder.encode(JSON.stringify(manifest)));
    return manifest;
  };
  const parts = { scene: "storyscenes/default.json", models: { "Character/Live2D/g/m/model/m": "models/m.json" },
    assets: { "Adv/Stage/a": "storyassets/a.json" }, sounds: { sheet: "cuesheets/sheet.json" },
    videos: { "Cri/Video/movie": "videos/movie.json" },
    ui: { ja: "storyui/ja.json", en: "storyui/en.json" }, fonts: { ja: "storyfonts/7_ja.json", en: "storyfonts/7_en.json" } };
  if (overlay) {
    parts.simpleui = { ja: "storysimpleui/ja.json", en: "storysimpleui/en.json" };
    parts.host = { afterlive: "storyhosts/afterlive.json" };
    product(parts.simpleui.ja, "story.simpleui", "ja", { "ui.json": { format: "nnnotes.story-simple-ui/1" } });
    product(parts.host.afterlive, "story.host", "afterlive", { "host.json": { format: "nnnotes.story-host/1", kind: "afterlive" } });
  }
  const episode = { advId: 7, master: { _playbackMode: overlay ? 1 : 0 }, title: { japanese: "Example", english: "Test" },
    commands: [{ cmd: command }] };
  product("stories/7.json", "story", "7", { "story.json": { format: 1, advId: 7, episode: "episode.json", parts }, "episode.json": episode });
  product(parts.scene, "story.scene", "default", { "scene.json": { format: 1, scene: ["cab:1"] } });
  product(parts.ui.ja, "story.ui", "ja", { "ui.json": { format: 1, language: { code: "ja" } } });
  product(parts.fonts.ja, "story.fonts", "7/ja", { "fonts.json": { format: "nnnotes.story-fonts/1", textures: {} } });
  product(parts.models["Character/Live2D/g/m/model/m"], "live2d.model", "Character/Live2D/g/m/model/m", { "model.json": { format: 3, name: "m" } });
  product(parts.assets["Adv/Stage/a"], "story.asset", "Adv/Stage/a", { "asset.json": { format: 1, prefab: "cab:2" } });
  product(parts.sounds.sheet, "story.sound", "sheet", { "cues.json": { voice: { file: "voice.m4a", categories: ["Voice", "VoiceConfig"] } },
    "voice.m4a": new Uint8Array([1, 2]) });
  product(parts.videos["Cri/Video/movie"], "story.video", "Cri/Video/movie", { "video.json": { format: 1, file: "movie.webm" },
    "movie.webm": new Uint8Array([3]) });
  const fetch = async (url) => {
    requested.push(String(url));
    const bytes = files.get(String(url).slice(STORY_ROOT.length));
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  return { files, requested, fetch, parts, product };
};
