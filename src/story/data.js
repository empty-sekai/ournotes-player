import { productDir } from "../data/products.js";
import { STORY_PRODUCT } from "./store.js";

const FORMATS = { scene: 1, ui: 1, fonts: "nnnotes.story-fonts/1", simpleui: "nnnotes.story-simple-ui/1",
  host: "nnnotes.story-host/1" };

export class StoryData {
  constructor(assets) {
    if (assets?.info?.product !== STORY_PRODUCT || !assets.info.dir || !assets.info.products)
      throw new Error("not the store of a story product (loadStoryProducts)");
    this.assets = assets;
    this.dir = assets.info.dir;
    this.products = assets.info.products;
    this.language = assets.info.loadedLanguage;
    this.story = assets.json(`${this.dir}/story.json`);
    this.episode = assets.json(`${this.dir}/${this.story.episode}`);
    this.parts = this.story.parts;
    this._docs = new Map();
  }

  document(manifest, file, format = null) {
    const path = `${productDir(manifest)}/${file}`;
    if (!this._docs.has(path)) {
      const doc = this.assets.json(path);
      if (format !== null && doc?.format !== format) throw new Error(`${path}: expected format ${format}`);
      this._docs.set(path, doc);
    }
    return this._docs.get(path);
  }

  file(manifest, file) { return `${productDir(manifest)}/${file}`; }
  get scene() { return this.document(this.parts.scene, "scene.json", FORMATS.scene); }
  get playerSettings() { return this.assets.mono(this.scene.settings.playerSettings); }
  get masterIds() { return this.assets.mono(this.scene.settings.masterIdSettings); }
  get chat() { return this.parts.chat ? this.document(this.parts.chat, "chat.json", 1) : null; }
  get crilips() {
    const path = this.parts.crilips;
    return path ? { descriptor: this.document(path, "crilips.json"), data: this.assets.arrayBuffer(this.file(path, "crilips.bin")) } : null;
  }
  get ui() { return this.document(this.parts.ui[this.language], "ui.json", FORMATS.ui); }
  get fonts() { return this.document(this.parts.fonts[this.language], "fonts.json", FORMATS.fonts); }
  get fontDir() { return productDir(this.parts.fonts[this.language]); }
  get simpleui() { return this.parts.simpleui ? this.document(this.parts.simpleui[this.language], "ui.json", FORMATS.simpleui) : null; }
  get host() {
    const paths = Object.values(this.parts.host || {});
    if (paths.length > 1) throw new Error("a story can have only one host product");
    return paths.length ? this.document(paths[0], "host.json", FORMATS.host) : null;
  }

  resourceOptions() {
    const docs = [this.scene, this.ui, this.fonts, this.simpleui, this.host,
      ...Object.keys(this.parts.assets || {}).map((key) => this.asset(key))].filter(Boolean);
    const shaders = {};
    // Shader.Find uses the scene's registered name first. Materials always use their own shader object id,
    // including bundle-local shaders whose Unity name is also registered by the scene.
    for (const doc of docs) for (const [name, id] of Object.entries(doc.shaders || {})) shaders[name] ??= id;
    return { shaders, bindings: docs.map((doc) => doc.bindings || {}) };
  }

  asset(address) {
    const path = this.parts.assets?.[address];
    if (!path) throw new Error(`story asset ${address}: not listed`);
    return this.document(path, "asset.json", 1);
  }

  model(address) {
    const path = this.parts.models?.[address];
    if (!path) throw new Error(`story model ${address}: not listed`);
    return { dir: productDir(path), doc: this.document(path, "model.json", 3) };
  }

  cues(sheet) {
    const path = this.parts.sounds?.[sheet];
    if (!path) throw new Error(`story cue sheet ${sheet}: not listed`);
    const cues = this.document(path, "cues.json");
    return Object.fromEntries(Object.entries(cues).map(([name, cue]) =>
      [name, { ...cue, file: this.file(path, cue.file) }]));
  }

  video(address) {
    const path = this.parts.videos?.[address];
    if (!path) throw new Error(`story video ${address}: not listed`);
    const doc = this.document(path, "video.json", 1);
    return { ...doc, file: this.file(path, doc.file) };
  }

  videoFor(id) {
    const master = this.episode.videos[id];
    if (!master) throw new Error(`story video ${id}: no master row`);
    return master._assetName?.trim() ? { ...this.video(`Cri/Video/${master._assetName}`), master } : { master };
  }
}
