// Story products on disk: the indexes, reusable parts, and the products of a compiled script.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AssetStore } from "../../../src/data/assets.js";
import { STORY_MANIFEST_FORMAT, checkModelManifest, loadStoryStore } from "../../../src/story/assets.js";
import { StoryData } from "../../../src/story/data.js";
import { ObjectResources } from "../../../src/engine/objects.js";
import "../../../src/story/features/index.js";
import { fileFetch, nodeDecode } from "../headless.mjs";
import { modelActions, musicChoices, stageBackground, stageChoices, withBrowserFonts } from "./script.js";

export class SiteError extends Error {}

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

  // An AssetStore of `files` (logical path -> file entry, asset paths relative to the site root) and `objects` (an
  // object table of a product manifest)
  store(files, objects = {}) {
    const url = pathToFileURL(path.join(this.dir, ".story-author-files.json")).href, body = { files, objects };
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

  languages(manifestPath) {
    const manifest = this.json(manifestPath);
    if (manifest.schema !== STORY_MANIFEST_FORMAT || manifest.product !== "story")
      throw new SiteError(`${manifestPath}: a base story needs a story product`);
    return Object.keys(this.json(manifest.files["story.json"].asset).parts.ui);
  }

  async _loadBase(manifestPath, lang) {
    const manifest = this.json(manifestPath);
    if (manifest.schema !== STORY_MANIFEST_FORMAT || manifest.product !== "story")
      throw new SiteError(`${manifestPath}: a base story needs a story product`);
    const language = lang || manifest.language || "ja";
    const store = await loadStoryStore(pathToFileURL(this.file(manifestPath)).href,
      { lang: language, fetch: fileFetch, decode: nodeDecode });
    const data = new StoryData(store), { story, episode, scene, fonts } = data;
    if (episode.master?._playbackMode === 1) throw new SiteError(`${manifestPath}: an Overlay episode cannot be a base story`);
    const objects = new ObjectResources(store, data.resourceOptions());
    const stages = stageChoices(story.parts.assets, episode, language).map((s) => {
      const asset = data.asset(`Adv/Stage/${s.key}`);
      return { ...s, background: stageBackground(objects.prefab(asset.objects[0]), objects) };
    });
    return { path: manifestPath, manifest, language, languages: Object.keys(story.parts.ui), story, episode, scene, fonts,
      stages, music: musicChoices(episode, story), cast: Object.keys(story.parts.models).map((key) => key.split("/").at(-1)), data, store };
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
    try { checkModelManifest(manifest, id, entry.manifest); } catch (e) { throw new SiteError(e.message); }
    // model.json and the objects modelActions reads: the prefab and the clips
    const { prefab } = (await this.store({ "model.json": manifest.files["model.json"] })).json("model.json");
    const objects = Object.fromEntries(Object.entries(manifest.objects).filter(([oid, o]) => oid === prefab || o.class === "AnimationClip"));
    const store = await this.store({ "model.json": manifest.files["model.json"] }, objects);
    return { entry, manifest, actions: modelActions(store, store.json("model.json")) };
  }

  // The image bytes of the background Texture2D objects selected from the base story.
  async baseFiles(base, ids) {
    return new Map(ids.map((id) => [id, Buffer.from(base.store.objectBytes(id, "image"))]));
  }

  // The story manifest of a compiled script (compileScript) on the base story `base`, played in `language` with its
  // texts drawn in the CSS font family `family`, placed where `root` is the site root seen from the manifest.
  // -> {manifest, assets: Map(asset path -> Buffer)}: the assets it adds to the site (assets/<sha256>.json)
  async compose(base, compiled, { language, family, root = "../" }) {
    const assets = new Map();
    const entry = (doc) => {
      const b = Buffer.from(JSON.stringify(doc), "utf8"), asset = `assets/${sha256(b)}.json`;
      assets.set(asset, b);
      return { asset, size: b.length };
    };
    const story = structuredClone(compiled.story), parts = story.parts;
    for (const [key, id] of Object.entries(parts.models)) parts.models[key] = (await this.model(id)).entry.manifest;
    const fonts = withBrowserFonts(base.fonts, family), source = this.json(base.story.parts.fonts[language]);
    const fontEntry = entry(fonts), fontPath = `storyfonts/0_${language}_${sha256(Buffer.from(JSON.stringify(fonts)))}.json`;
    assets.set(fontPath, Buffer.from(JSON.stringify({ schema: STORY_MANIFEST_FORMAT, product: "story.fonts", subject: `0/${language}`,
      files: { ...source.files, "fonts.json": fontEntry }, objects: source.objects })));
    parts.fonts = { [language]: fontPath };
    parts.ui = { [language]: base.story.parts.ui[language] };
    const manifest = { schema: STORY_MANIFEST_FORMAT, product: "story", subject: "0", root, language,
      files: sortKeys({ "story.json": entry(story), "episode.json": entry(compiled.episode) }), objects: {} };
    return { manifest, assets };
  }
}
