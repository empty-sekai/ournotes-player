// A story site on disk as the story author reads it: the story index, the model index, base stories, models, and the
// story manifest of a compiled script (ournotes.story-manifest/2 with the base story's files, the script's own
// story.json, episode.json and ui/fonts.json, and the model manifests of its cast).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AssetStore } from "../../../src/data/assets.js";
import { MODEL_MANIFEST_FORMATS, STORY_MANIFEST_FORMAT } from "../../../src/story/assets.js";
import { StoryPlayerCore } from "../../../src/story/player-core.js";
import "../../../src/story/features/index.js";
import { fileFetch, nodeDecode } from "../headless.mjs";
import { modelActions, musicChoices, stageBackground, stageChoices, withBrowserFonts } from "./script.js";

export class SiteError extends Error {}

// the common files of a base story a script does not play: the media of the base episode's own rows, its videos and
// CRI Lips data, and the host screen of an Overlay episode
const MEDIA = new Set(["frames.json", "effects.json", "posteffects.json", "stills.json", "talkwindows.json", "chat.json"]);
const skipped = (p) => MEDIA.has(p) || /^(videos|crilips|host)\//.test(p) || p.startsWith("ui/simple/");
const textureRefs = (text) => [...text.matchAll(/"(textures\/[^"]+)"/g)].map((m) => m[1]);

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

export class Site {
  constructor(dir) {
    this.dir = path.resolve(dir);
    if (!fs.existsSync(this.dir) || !fs.statSync(this.dir).isDirectory()) throw new SiteError(`${dir}: not a directory`);
    this._json = new Map();
    this._bases = new Map();
    this._models = new Map();
  }

  file(rel) { return path.join(this.dir, ...rel.split("/")); }
  has(rel) { return fs.existsSync(this.file(rel)); }

  json(rel) {
    if (!this._json.has(rel)) {
      if (!this.has(rel)) throw new SiteError(`${rel}: not in the site ${this.dir}`);
      this._json.set(rel, JSON.parse(fs.readFileSync(this.file(rel), "utf8")));
    }
    return this._json.get(rel);
  }

  // the stories.json entries of Normal episodes ([] for a site without stories.json)
  stories() {
    if (!this.has("stories.json")) return [];
    return (this.json("stories.json").stories || []).filter((s) => s.playbackMode !== 1);
  }

  // the models.json entries (format 2)
  models() {
    const doc = this.json("models.json");
    if (!doc || doc.format !== 2 || !Array.isArray(doc.models)) throw new SiteError("models.json: not a model index (format 2)");
    return doc.models;
  }

  // An AssetStore of `files` (logical path -> file entry, asset paths relative to the site root)
  store(files) {
    const url = pathToFileURL(path.join(this.dir, ".story-author-files.json")).href, body = { files };
    const fetch = (u) => (String(u) === url ? Promise.resolve({ ok: true, status: 200, json: async () => body }) : fileFetch(u));
    return AssetStore.fromManifest(url, { fetch, base: pathToFileURL(this.dir + path.sep).href, decode: nodeDecode });
  }

  // The base story `manifestPath` (relative to the site root) in `language` (default: its own):
  // {path, manifest, language, languages, story, episode, scene, fonts, stages: [{id, key, caption, background}],
  //  music: musicChoices, cast: the model ids of its Character rows}
  base(manifestPath, language = null) {
    const key = `${manifestPath}\n${language || ""}`;
    if (!this._bases.has(key)) this._bases.set(key, this._loadBase(manifestPath, language));
    return this._bases.get(key);
  }

  async _loadBase(manifestPath, lang) {
    const manifest = this.json(manifestPath);
    if (manifest.format !== STORY_MANIFEST_FORMAT)
      throw new SiteError(`${manifestPath}: a base story needs a story manifest of format ${STORY_MANIFEST_FORMAT}` +
                          ` (this one is ${manifest.format})`);
    if (manifest.story && manifest.story.playbackMode === 1)
      throw new SiteError(`${manifestPath}: an Overlay episode (home talk, live result) cannot be a base story`);
    const languages = Object.keys(manifest.languages || {});
    const language = lang || manifest.language;
    if (!manifest.languages[language]) throw new SiteError(`${manifestPath}: no language ${language} (${languages.join(", ")})`);
    const files = {};
    for (const p of ["story.json", "episode.json", "scene.json"]) {
      if (!manifest.files[p]) throw new SiteError(`${manifestPath}: no ${p}`);
      files[p] = manifest.files[p];
    }
    const lf = manifest.languages[language].files;
    if (!lf["ui/fonts.json"]) throw new SiteError(`${manifestPath}: no ui/fonts.json in ${language}`);
    files["ui/fonts.json"] = lf["ui/fonts.json"];
    const store = await this.store(files);
    const story = store.json("story.json"), episode = store.json("episode.json"), scene = store.json("scene.json");
    const stages = stageChoices(scene, episode, language)
      .map((s) => ({ ...s, background: stageBackground(scene.stages[s.key]) }));
    return { path: manifestPath, manifest, language, languages, story, episode, scene, fonts: store.json("ui/fonts.json"),
             stages, music: musicChoices(episode, story), cast: Object.values(story.models || {}) };
  }

  // The model `id` of models.json: {entry, manifest, actions: modelActions}
  model(id) {
    if (!this._models.has(id)) this._models.set(id, this._loadModel(id));
    return this._models.get(id);
  }

  async _loadModel(id) {
    const entry = this.models().find((m) => m.id === id);
    if (!entry) throw new SiteError(`model ${id} is not in models.json`);
    const manifest = this.json(entry.manifest);
    if (!manifest || !MODEL_MANIFEST_FORMATS.includes(manifest.format) || !manifest.files)
      throw new SiteError(`${entry.manifest}: not a model manifest`);
    const index = (await this.store({ "model.json": manifest.files["model.json"] })).json("model.json");
    const prefab = (await this.store({ [index.prefab]: manifest.files[index.prefab] })).json(index.prefab);
    return { entry, manifest, actions: modelActions(prefab) };
  }

  // the bytes of logical files of a base story (path -> Buffer), from its common files
  async baseFiles(base, paths) {
    const files = {};
    for (const p of paths) if (base.manifest.files[p]) files[p] = base.manifest.files[p];
    const store = await this.store(files);
    return new Map(Object.keys(files).map((p) => [p, Buffer.from(store.bytes(p))]));
  }

  // The story manifest of a compiled script (compileScript) on the base story `base`, played in `language` with its
  // texts drawn in the CSS font family `family`, placed where `root` is the site root seen from the manifest.
  // -> {manifest, assets: Map(asset path -> Buffer)}: the assets it adds to the site (assets/<sha256>.json)
  async compose(base, compiled, { language, family, title, root = "../" }) {
    const assets = new Map();
    const entry = (doc) => {
      const b = Buffer.from(JSON.stringify(doc), "utf8"), asset = `assets/${sha256(b)}.json`;
      assets.set(asset, b);
      return { asset, size: b.length };
    };
    const sheets = Object.values(compiled.story.audio);
    const keep = (p) => !skipped(p) && (!p.startsWith("audio/") || sheets.some((d) => p.startsWith(`${d}/`)));
    // textures: the ones the kept JSON files name
    const lang = base.manifest.languages[language].files;
    const kept = { ...Object.fromEntries(Object.entries(base.manifest.files).filter(([p]) => keep(p))), ...lang };
    const jsonStore = await this.store(Object.fromEntries(Object.entries(kept)
      .filter(([p]) => p.endsWith(".json") && !["story.json", "episode.json", "ui/fonts.json"].includes(p))));
    const textures = new Set();
    for (const p of jsonStore.list()) for (const t of textureRefs(jsonStore.text(p))) textures.add(t);
    const files = {};
    for (const [p, f] of Object.entries(base.manifest.files))
      if (keep(p) && (!p.startsWith("textures/") || textures.has(p))) files[p] = f;
    files["story.json"] = entry(compiled.story);
    files["episode.json"] = entry(compiled.episode);
    const langFiles = { ...lang, "ui/fonts.json": entry(withBrowserFonts(base.fonts, family)) };

    const models = {};
    for (const id of Object.values(compiled.story.models)) models[id] = (await this.model(id)).entry.manifest;
    const commands = StoryPlayerCore.requiredCommands(compiled.episode, base.scene.settings.playerSettings);
    const audio = sheets.length > 0;
    const facts = { advId: 0, asset: "", playbackMode: 0, titles: title ? { [language]: title } : {}, groups: [], commands,
                    commandCount: compiled.episode.commandCount, language, languages: [language] };
    const manifest = {
      format: STORY_MANIFEST_FORMAT, advId: 0, root, story: facts, language, audio,
      audioFormat: audio ? base.manifest.audioFormat : null, fonts: base.manifest.fonts,
      requires: { commands, cubismCore: true, motionSync: false },
      files: sortKeys(files), models: sortKeys(models), languages: { [language]: { files: sortKeys(langFiles) } },
    };
    return { manifest, assets };
  }
}
