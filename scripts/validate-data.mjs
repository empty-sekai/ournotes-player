#!/usr/bin/env node
// Validates a directory of products and chart sites against docs/data-format.md and the schemas in schema/.
//
//   node scripts/validate-data.mjs <site dir> [live id | chart id | model id | story id ...]
//
// Lives (lives/<id>.json of a product layout): the manifest (schema, the product live, a subject of the manifest's
// name), every asset of its files and its objects' files (present, byte size, SHA-256 of the decoded bytes matching its
// name; an encoded asset's stored length, its decoded size), live.json (schema) and each product its `parts` names,
// checked once (manifest, assets, its document: schema, the classes of the objects it names, its bindings and shader
// tables; its objects: JSON files, Texture2D images, Shader forms and the GLES3 programs of the shaders its Materials
// use, Mesh arrays, drawable Sprites), then the live as a whole through LiveData: the scores, the jacket, the band, the
// quality rows, the sounds and their waveform files (FLAC / MP4 headers).
// Charts (charts.json, charts/<id>.json, charts/<region>/<id>.json of a chart site): the manifest (schema, agreement
// with charts.json), every asset, the rebuilt text of split JSON files, then the chart read as a live (legacy.js) and
// checked as a live's products are.
// Live2D models (models.json, models/<id>.json, product manifests of live2d.model): the manifest (schema, subject,
// agreement with models.json), every asset of its files and of its objects' files, model.json (the classes of the
// objects it names, its motionSync against the prefab, the names of every motion's bindings), the moc (a CubismMoc,
// its moc3 header), the prefab (the components the model viewer reads), the motions and their fade motions, the
// expressions, the drawables' materials and textures, the mask materials, the shaders' parsed forms, variant indexes
// and GLES3 programs (also the variants the story renderer adds a keyword to), and that the manifest lists exactly the
// files the viewer and the story player read.
// charts.json of a site of several regions: an id at most once per region (an entry without `regions` serves every
// region, so its id only once), every entry's regions among the index's `regions`, text languages among `languages`.
// Without charts.json the manifests are charts/*.json and charts/<region>/*.json. A models.json entry's id, key and
// group must be those of its manifest's subject, its canvas and textures those of model.json, its bytes and files those
// of the manifest's files and its objects' files.
// Stories (stories/<id>.json): story products and their part graph, every selected language's UI and font bindings,
// scene and media object references, cue waveforms, CRI Lips bounds, and model products. Products share objects;
// their files and checks are cached by content while each language is validated against its own bindings.
// Prints the failures and a summary; exits 1 when a live, a chart, a model or a story fails. No dependencies.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { AssetStore, TEXT_ASSET, TEXT_FILE } from "../src/data/assets.js";
import { LiveData } from "../src/live/data.js";
import { legacyLive } from "../src/live/legacy.js";
import { LiveOptionContext } from "../src/live/settings.js";
import { LIVE_PARTS, LIVE_PRODUCT, LIVE_VARIANTS, liveManifest, productDir } from "../src/live/store.js";
import { storyPartRequests } from "../src/story/store.js";
import { StoryData } from "../src/story/data.js";
import { StoryPlayerCore } from "../src/story/player-core.js";
import { simpleUnsupportedCommands } from "../src/story/simple/validator.js";
import { ObjectResources } from "../src/engine/objects.js";
import { HomeScene } from "../src/story/simple/home/objects.js";
import { spotLighting } from "../src/story/simple/home/host.js";
import { hostUIRoots } from "../src/story/simple/objects.js";
import { SimpleUIDoc } from "../src/story/simple/ui.js";
import { mergeProductManifests } from "../src/data/products.js";
import { compile } from "./lib/json-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, "..", "schema", `${name}.schema.json`), "utf8")));
const S = {
  prefab: schema("prefab"),
  room: schema("room"), spot: schema("spot"), video: schema("story-video"), sound: schema("story-sound"), crilips: schema("crilips"),
  charts: schema("charts"), manifest: schema("manifest"), live: schema("live"), score: schema("score"),
  scene: schema("live-scene"), notes: schema("live-notes"), noteskin: schema("live-noteskin"),
  noteeffect: schema("live-noteeffect"), sounds: schema("live-sounds"), music: schema("live-music"), models: schema("models"), product: schema("product"), modelJson: schema("model-json"),
  stories: schema("stories"), storyManifest: schema("story-manifest"), story: schema("story"), episode: schema("episode"),
  storyFonts: schema("story-fonts"), storyLanguage: schema("story-language"),
  storyScene: schema("story-scene"), storyUI: schema("story-ui"), storySimpleUI: schema("story-simple-ui"),
  storyHost: schema("story-host"), storyAsset: schema("story-asset"), uiPack: schema("ui-pack"), uiLibrary: schema("ui-library"),
};

const SCHEMA_STORY_FONTS = S.storyFonts;
const STORY_DOCS = { "story.scene": ["scene.json", "storyScene"], "story.ui": ["ui.json", "storyUI"],
  "story.simpleui": ["ui.json", "storySimpleUI"], "story.host": ["host.json", "storyHost"], "story.asset": ["asset.json", "storyAsset"] };
const GRAPHICS_CLASSES = { graphics: "GraphicsSettings", player: "PlayerSettings", quality: "QualitySettings" };
const STORY_REFS = { "story.scene": { scene: "GameObject", renderSettings: "RenderSettings", prefabs: "GameObject" },
  "story.ui": { widget: "GameObject", chatWidget: "GameObject", uiManager: "GameObject", talkWindows: "GameObject", dialogs: "GameObject",
    letterbox: "Sprite", clips: "AnimationClip", controllers: "AnimatorController" },
  "story.simpleui": { talkWindow: "GameObject", systemMessage: "GameObject", uiManager: "GameObject" },
  "story.host": { cameraTarget: "GameObject", dotween: "MonoBehaviour", prefabs: "GameObject" } };
const extOf = (p) => (p.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() ?? "";
// encoded assets (assets/<sha256>.<ext>.gz / .br): the encoding, the logical file's extension, the extensions that may
// be encoded (every other file is stored as it is)
const encodingOf = (asset) => ({ gz: "gzip", br: "br" })[(String(asset).match(/\.(gz|br)$/) || [])[1]] ?? null;
const assetExt = (asset) => extOf(String(asset).replace(/\.(gz|br)$/, ""));
const COMPRESSIBLE = new Set(["json", "glsl", "moc3", "atlas", "skel", "bin", "wav", "glb"]);
const decodeSync = (b, encoding) => (encoding === "gzip" ? zlib.gunzipSync(b) : zlib.brotliDecompressSync(b));
const has = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------ binary headers
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngInfo = (b) => {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString("latin1", 12, 16) !== "IHDR") throw new Error("not a PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), depth: b[24], colorType: b[25] };
};
// FLAC STREAMINFO: sample rate (20 bits), channels - 1 (3), bits per sample - 1 (5), total samples (36)
const flacInfo = (b) => {
  if (b.length < 42 || b.toString("latin1", 0, 4) !== "fLaC" || (b[4] & 0x7f) !== 0) throw new Error("not FLAC (no STREAMINFO)");
  const s = b.subarray(8, 42);
  return { sampleRate: (s[10] << 12) | (s[11] << 4) | (s[12] >> 4), channels: ((s[12] >> 1) & 7) + 1,
           samples: (s[13] & 0x0f) * 2 ** 32 + s.readUInt32BE(14) };
};
const isMp4 = (b) => b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp";

// GLSL file of one variant: top-level `#ifdef VERTEX` and `#ifdef FRAGMENT` blocks, each starting with
// `#version 300 es` (the stage split the player's shader loader performs)
const glslStages = (src) => {
  const out = {};
  let depth = 0, cur = null, buf = [];
  for (const ln of src.split("\n")) {
    const t = ln.trim();
    if (depth === 0 && (t === "#ifdef VERTEX" || t === "#ifdef FRAGMENT")) { cur = t.slice(7).toLowerCase(); depth = 1; buf = []; continue; }
    if (!cur) continue;
    if (/^#\s*if/.test(t)) depth++;
    else if (/^#\s*endif/.test(t) && --depth === 0) { out[cur] = buf.join("\n"); cur = null; continue; }
    buf.push(ln);
  }
  const errs = [];
  for (const k of ["vertex", "fragment"]) {
    if (out[k] === undefined) errs.push(`no ${k.toUpperCase()} block`);
    else if (!out[k].replace(/^\s+/, "").startsWith("#version 300 es")) errs.push(`${k} stage does not start with #version 300 es`);
  }
  return errs;
};

// ------------------------------------------------------------------------------------------------ site
class Site {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.assetCheck = new Map();      // asset -> error string | null
    this.bufCache = new Map();        // asset -> Buffer (small binaries only)
    this.derived = new Map();         // "<kind>|<signature>" -> cached per-file result
    this.models = new Map();          // model manifest path -> {model, errs, missing} (the models stories use)
    this.parts = new Map();           // "<product> <manifest path>" -> {man, errs, shown} (the parts of lives)
    this.modelIds = null;             // the ids of models.json (null without it)
  }

  file(rel) { return path.join(this.dir, ...rel.split("/")); }

  // present; an encoded asset (.gz / .br) with `stored` equal to its length, less than `size`, of an extension that may
  // be encoded; the decoded bytes of `size` bytes, their SHA-256 the asset's name
  checkAsset(asset, size, stored) {
    const key = `${asset}|${size}|${stored}`;
    if (!this.assetCheck.has(key)) {
      let err = null;
      try {
        const raw = fs.readFileSync(this.file(asset)), enc = encodingOf(asset);
        if (enc && stored === undefined) err = `${asset}: an encoded asset without stored`;
        else if (!enc && stored !== undefined) err = `${asset}: stored ${stored} on an asset that is not encoded (.gz / .br)`;
        else if (enc && raw.length !== stored) err = `${asset}: ${raw.length} bytes, manifest stored ${stored}`;
        else if (enc && !(stored < size)) err = `${asset}: stored ${stored} is not less than size ${size}`;
        else if (enc && !COMPRESSIBLE.has(assetExt(asset))) err = `${asset}: .${assetExt(asset)} files are stored as they are, not encoded`;
        else {
          let b = raw;
          if (enc) try { b = decodeSync(raw, enc); } catch (e) { b = null; err = `${asset}: not ${enc} data (${e.message})`; }
          if (b) {
            const sha = crypto.createHash("sha256").update(b).digest("hex");
            if (b.length !== size) err = `${asset}: ${b.length} bytes${enc ? " decoded" : ""}, manifest ${size}`;
            else if (path.basename(asset).split(".")[0] !== sha) err = `${asset}: content SHA-256 is ${sha}`;
          }
        }
      } catch (e) { err = `${asset}: ${e.code === "ENOENT" ? "missing" : e.message}`; }
      this.assetCheck.set(key, err);
    }
    return this.assetCheck.get(key);
  }

  // the decoded bytes of an asset
  bytes(asset) {
    const raw = fs.readFileSync(this.file(asset)), enc = encodingOf(asset);
    return enc ? decodeSync(raw, enc) : raw;
  }

  // the bytes of a file entry: its asset's, or a split JSON file's rebuilt text
  content(f) {
    if (!f.parts) return this.bytes(f.asset);
    return Buffer.from(`{${f.parts.map(([k, a]) => `${JSON.stringify(k)}:${this.bytes(a).toString("utf8")}`).join(",")}}`);
  }

  // cached result of fn() per kind and content signature
  once(kind, sig, fn) {
    const k = `${kind}|${sig}`;
    if (!this.derived.has(k)) this.derived.set(k, fn());
    return this.derived.get(k);
  }

  // the product manifest at `manifest` that a live names as its part of `product`, validated once as that product:
  // {man, errs, shown (its errors have been printed)}
  part(manifest, product) {
    const k = `${product} ${manifest}`;
    if (!this.parts.has(k)) {
      let man = null, errs;
      try {
        man = JSON.parse(fs.readFileSync(this.file(manifest), "utf8"));
        errs = new Part(this, manifest, man, manifest).run(product);
      } catch (e) { errs = [e.code === "ENOENT" ? "missing" : e.message]; }
      this.parts.set(k, { man, errs, shown: false });
    }
    return this.parts.get(k);
  }

  // the model of a model manifest a story lists, validated once (without its models.json entry)
  model(id, manifest) {
    if (!this.models.has(manifest)) {
      let r, model = null;
      try {
        model = new Model(this, id, JSON.parse(fs.readFileSync(this.file(manifest), "utf8")), manifest);
        r = { model, errs: model.run(), missing: false };
      } catch (e) { r = { model, errs: [e.code === "ENOENT" ? "missing" : e.message], missing: e.code === "ENOENT" }; }
      this.models.set(manifest, r);
    }
    return this.models.get(manifest);
  }
}

// ------------------------------------------------------------------------------------------------ one chart
// A chart manifest of the site layout (charts/<id>.json): its files are read as a live through legacy.js, then
// checked as a live's products are (LiveChecks).
class Chart {
  constructor(site, id, man, where = null) {
    this.site = site; this.id = id; this.man = man; this.errs = [];
    this.where = where;             // the manifest's path in the site
    this.files = isObj(man.files) ? man.files : {};
    this.checked = new Set();       // logical files already parsed by a check
  }

  err(where, msg) { this.errs.push(`${where}: ${msg}`); }

  has(p) { return has(this.files, p); }

  sig(p) { return sigOf(this.files[p]); }

  // the logical file's text (split JSON files rebuilt from their parts)
  text(p) { return this.site.content(this.files[p]).toString("utf8"); }

  // per-file check with cross-chart caching: fn(parsedJson) -> result; parse errors are reported
  json(kind, p, fn) {
    if (!this.has(p)) { this.err(p, "not in the manifest"); return null; }
    this.checked.add(p);
    const r = this.site.once(kind, this.sig(p), () => {
      let v;
      try { v = JSON.parse(this.text(p)); } catch (e) { return { errs: [`not valid JSON (${e.message})`] }; }
      return fn(v);
    });
    for (const e of r.errs || []) this.err(p, e);
    return r;
  }

  run(entry) {
    const m = this.man;
    for (const e of S.manifest(m)) this.err("manifest", e);
    if (!isObj(m.files)) return this.errs;
    if (entry) this.crossCheck(entry);
    this.checkAssets();
    if (this.errs.length) return this.errs;       // content checks need every asset in place

    const { files: _files, ...info } = m;
    const files = new SiteStore(this.site, this.files, {}, info);
    let store;
    try { store = legacyLive(files); } catch (e) { this.err("live.json", `not readable as a live (${e.message})`); return this.errs; }
    const C = new LiveChecks(this.site, store, (w, msg) => this.err(w, msg));
    for (const [product, subjects] of Object.entries(store.info.products))
      if (product !== LIVE_PRODUCT) for (const dir of Object.values(subjects)) C.part(product, dir);
    C.objects();
    C.live();
    // every other JSON file of the chart must parse (the player may not read it, but it is fetched)
    for (const p of Object.keys(this.files)) if (p.endsWith(".json") && !files.loaded(p)) this.json("parse", p, () => ({ errs: [] }));
    return this.errs;
  }

  crossCheck(e) {
    const m = this.man;
    for (const k of ["musicId", "difficulty", "audio", "audioFormat"])
      if (has(e, k) && has(m, k) && e[k] !== m[k]) this.err("manifest", `${k} ${JSON.stringify(m[k])}, charts.json ${JSON.stringify(e[k])}`);
    if (has(e, "flows") && JSON.stringify(e.flows) !== JSON.stringify(m.flows)) this.err("manifest", "flows differ from charts.json");
    if ((has(e, "regions") || has(m, "regions")) && JSON.stringify(e.regions) !== JSON.stringify(m.regions))
      this.err("manifest", "regions differ from charts.json");
    if (isObj(m.chart))
      for (const [k, v] of Object.entries(m.chart))
        if (has(e, k) && JSON.stringify(e[k]) !== JSON.stringify(v)) this.err("manifest", `chart.${k} differs from charts.json`);
    const total = Object.values(this.files).reduce((n, f) => n + (f.size || 0), 0);
    if (has(e, "bytes") && e.bytes !== total) this.err("charts.json", `bytes ${e.bytes}, manifest files total ${total}`);
    if (e.id !== `${m.musicId}_${m.difficulty}`) this.err("charts.json", `id ${e.id} does not match the manifest`);
  }

  // the extension the asset of logical file `p` must have (null: any)
  extOfFile(p) { return extOf(p); }

  checkAssets() {
    for (const [p, f] of Object.entries(this.files)) {
      if (f.parts) {
        if (this.extOfFile(p) !== "json") this.err(p, "only JSON files may be split into parts");
        const keys = new Set();
        let total = 2 + f.parts.length - 1;        // braces and commas
        for (const [k, a, size, stored] of f.parts) {
          if (keys.has(k)) this.err(p, `part key ${k} twice`);
          keys.add(k);
          if (assetExt(a) !== "json") this.err(p, `part ${k}: ${a} is not a .json asset`);
          const e = this.site.checkAsset(a, size, stored);
          if (e) this.err(p, e);
          total += Buffer.byteLength(JSON.stringify(k)) + 1 + size;
        }
        if (total !== f.size) this.err(p, `rebuilt text is ${total} bytes, manifest ${f.size}`);
      } else {
        const want = this.extOfFile(p);
        if (want !== null && assetExt(f.asset) !== want) this.err(p, `asset extension .${assetExt(f.asset)}, expected .${want}`);
        const e = this.site.checkAsset(f.asset, f.size, f.stored);
        if (e) this.err(p, e);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ live stores
// The files of a manifest (or of the merged manifests of a live) as an AssetStore that reads each file from the site
// when it is first asked for: `files` path -> file entry, `objects` id -> {class, name, files: role -> file entry}.
class SiteStore extends AssetStore {
  constructor(site, files, objects, info = null) {
    super({ info });
    this.site = site;
    this.entries = new Map(Object.entries(files));
    this.objectEntries = new Map();
    for (const [id, o] of Object.entries(objects)) {
      this.objectEntries.set(id, new Map(Object.entries(o.files)));
      this._objects.set(id, { class: o.class, name: o.name ?? null, files: new Map(Object.entries(o.files)) });
    }
  }

  // the file entry of a file / of an object's file (null: none)
  entry(p) { return this.entries.get(p) ?? null; }
  objectEntry(id, role) { const m = this.objectEntries.get(id); return (m && m.get(role)) ?? null; }
  // the ids of the objects
  ids() { return [...this.objectEntries.keys()]; }
  // whether a file was read
  loaded(p) { return this._text.has(p) || this._bin.has(p); }

  _load(p) {
    const f = this.entries.get(p);
    if (!f || this.loaded(p)) return;
    const b = this.site.content(f);
    if (TEXT_FILE.test(p)) this._text.set(p, b.toString("utf8"));
    else this._bin.set(p, new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  }

  has(p) { return this.entries.has(p); }
  text(p) { this._load(p); return super.text(p); }
  bytes(p) { this._load(p); return super.bytes(p); }

  _file(id, role) {
    const f = super._file(id, role);
    if (typeof f === "string" || f instanceof Uint8Array) return f;
    const b = this.site.content(f);
    const c = f.parts || TEXT_ASSET.test(f.asset) ? b.toString("utf8") : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    this._objects.get(id).files.set(role, c);
    return c;
  }
}

// The site file a store's file is read from: a SiteStore's entry, or for a chart read through legacy.js (an
// OverlayStore over a SiteStore) the chart's file it is; null for a file made in memory. Checks of a file with an
// entry are cached per asset.
const entryOf = (store, p) => (store instanceof SiteStore ? store.entry(p)
  : store.inner instanceof SiteStore && store.source(p) !== null ? store.inner.entry(store.source(p)) : null);
const objectEntryOf = (store, id, role) => (store instanceof SiteStore ? store.objectEntry(id, role)
  : role === "image" && store.inner instanceof SiteStore && store.images.has(id) ? store.inner.entry(store.images.get(id)) : null);
// the ids of a store's objects (a SiteStore's, or those legacy.js made)
const objectIds = (store) => (store instanceof SiteStore ? store.ids() : [...store._objects.keys()]);
// a file entry's content signature
const sigOf = (f) => (f.parts ? f.parts.map((x) => `${x[0]}=${x[1]}`).join(",") : f.asset);

// a score file: {errs, laneCount}
const scoreCheck = (s) => {
  const errs = S.score(s);
  if (errs.length) return { errs };
  const ids = new Map(), lines = new Map();
  for (const n of s.notes) { if (ids.has(n.id)) errs.push(`note id ${n.id} twice`); ids.set(n.id, n); }
  for (const l of s.lines) { if (lines.has(l.lineId)) errs.push(`line id ${l.lineId} twice`); lines.set(l.lineId, l); }
  for (const n of s.notes) {
    for (const id of n.lineIds) if (!lines.has(id)) errs.push(`note ${n.id}: line ${id} not in lines`);
    if (n.pairNoteId && !ids.has(n.pairNoteId)) errs.push(`note ${n.id}: pair note ${n.pairNoteId} not in notes`);
  }
  for (const l of s.lines) for (const id of l.noteIds) if (!ids.has(id)) errs.push(`line ${l.lineId}: note ${id} not in notes`);
  return { errs: errs.slice(0, 20), laneCount: s.laneCount };
};

// a waveform file against its layer: the problem found, or null
const waveCheck = (b, L) => {
  if (extOf(L.file) === "m4a") return isMp4(b) ? null : "not an MP4 file";
  try {
    const i = flacInfo(b);
    if (i.sampleRate !== L.sampleRate) return `FLAC sample rate ${i.sampleRate}, described ${L.sampleRate}`;
    if (L.channels !== undefined && i.channels !== L.channels) return `FLAC channels ${i.channels}, described ${L.channels}`;
    if (i.samples !== L.samples) return `FLAC total samples ${i.samples}, described ${L.samples}`;
    return null;
  } catch (err) { return err.message; }
};

// the document of each product a live plays with, and its schema
const PART_DOCS = {
  "live.scene": ["scene.json", "scene"], "live.notes": ["notes.json", "notes"], "live.noteskin": ["noteskin.json", "noteskin"],
  "live.noteeffect": ["noteeffect.json", "noteeffect"], "live.sounds": ["sounds.json", "sounds"], "live.music": ["music.json", "music"],
};
const LANE_SPRITES = ["lane_base", "lane_tap_area", "out_side_line"];

// The checks of a live's documents and of the objects they use, in a store of the live: a SiteStore of product
// manifests, or a chart of the site layout read through legacy.js. err(where, message) reports a problem.
class LiveChecks {
  constructor(site, store, err) { this.site = site; this.S = store; this.err = err; }

  // fn(content) of a file of the store (path `p`), cached per asset when it is a site file
  ofFile(kind, p, fn) {
    const f = entryOf(this.S, p);
    if (f) return this.site.once(kind, sigOf(f), () => fn(this.site.content(f)));
    return fn(Buffer.from(this.S.bytes(p)));
  }

  // fn(content) of an object's file, cached per asset when it is a site file
  ofObject(kind, id, role, fn) {
    const f = objectEntryOf(this.S, id, role);
    if (f) return this.site.once(kind, sigOf(f), () => fn(this.site.content(f)));
    return fn(Buffer.from(this.S.objectBytes(id, role)));
  }

  // the parsed JSON file `p` of the store, checked by `check` (a schema): the value, or null
  doc(p, check) {
    if (!this.S.has(p)) { this.err(p, "missing"); return null; }
    let v;
    try { v = this.S.json(p); } catch (e) { this.err(p, `not valid JSON (${e.message})`); return null; }
    const errs = check(v);
    for (const e of errs.slice(0, 20)) this.err(p, e);
    return errs.length ? null : v;
  }

  // the object `id` is in the store, of class `cls`
  object(id, cls, where) {
    if (typeof id !== "string" || !this.S.hasObject(id)) { this.err(where, `object ${id} not in the store`); return false; }
    const c = this.S.object(id).class;
    if (cls !== null && c !== cls) { this.err(where, `${id}: a ${c}, not a ${cls}`); return false; }
    return true;
  }

  // a MonoBehaviour of script class `script`
  mono(id, script, where) {
    if (!this.object(id, "MonoBehaviour", where)) return false;
    const s = this.ofObject("script", id, "json", (b) => { try { return { script: scriptOf(JSON.parse(b)) }; } catch (e) { return { errs: [e.message] }; } });
    if (s.script !== script) { this.err(where, `${id}: a ${s.script ?? "MonoBehaviour"}, not a ${script}`); return false; }
    return true;
  }

  // a Sprite the player can draw: its render data (its own, or its atlas's) names a Texture2D with an image
  sprite(id, where) {
    if (!this.object(id, "Sprite", where)) return;
    let s;
    try { s = this.S.sprite(id); } catch (e) { this.err(where, e.message); return; }
    if (!this.S.roles(s.texture.id).includes("image")) this.err(where, `sprite ${s.name}: its texture ${s.texture.id} has no image`);
  }

  // a GameObject's prefab document: {errs, animators: the node paths with an Animator}
  prefab(id, where) {
    if (!this.object(id, "GameObject", where)) return null;
    const r = this.ofObject("prefab", id, "json", (b) => {
      const errs = [];
      let pf;
      try { pf = JSON.parse(b); } catch (e) { return { errs: [`not valid JSON (${e.message})`] }; }
      nodeList(pf, "prefab", errs);
      if (errs.length) return { errs };
      return { errs, animators: pf.nodes.filter((n) => n.components.some((c) => c.type === "Animator")).map((n) => n.path) };
    });
    for (const e of r.errs) this.err(`${where} ${id}`, e);
    return r.errs.length ? null : r;
  }

  // the bindings and shaders tables of a document
  tables(where, doc) {
    for (const [pf, animators] of Object.entries(doc.bindings)) {
      const p = this.prefab(pf, `${where} bindings`);
      for (const [path, clips] of Object.entries(animators)) {
        if (p && !p.animators.includes(path)) this.err(where, `bindings.${pf}: ${path} is no node of the prefab with an Animator`);
        for (const [clip, names] of Object.entries(clips)) {
          if (!this.object(clip, "AnimationClip", `${where} bindings.${pf}`)) continue;
          const c = this.ofObject("clip", clip, "json", (b) => {
            try { const v = JSON.parse(b); return Array.isArray(v.bindings) ? { n: v.bindings.length } : { errs: ["no bindings"] }; } catch (e) { return { errs: [e.message] }; }
          });
          if (c.errs) this.err(`clip ${clip}`, c.errs[0]);
          else if (names.length !== c.n) this.err(where, `bindings.${pf}.${path}.${clip}: ${names.length} names, the clip has ${c.n} bindings`);
        }
      }
    }
    for (const [name, id] of Object.entries(doc.shaders))
      if (this.object(id, "Shader", `${where} shaders.${name}`)) {
        const r = this.ofObject("shadername", id, "index", (b) => { try { return { name: JSON.parse(b).name }; } catch (e) { return { name: null }; } });
        if (r.name !== name) this.err(where, `shaders.${name}: the shader ${id} is ${r.name}`);
      }
  }

  // the document of the product `product` in directory `dir`
  part(product, dir) {
    const [file, schemaName] = PART_DOCS[product];
    const where = `${dir}/${file}`, doc = this.doc(where, S[schemaName]);
    if (!doc) return;
    if (has(doc, "bindings")) this.tables(where, doc);
    if (product === "live.scene") this.scene(where, doc);
    else if (product === "live.notes") this.notes(where, doc);
    else if (product === "live.noteskin") this.mono(doc.skin, "LiveNoteSkinAsset", `${where} skin`);
    else if (product === "live.noteeffect") this.mono(doc.settings, "LiveNoteEffectAssetSettings", `${where} settings`);
    else this.sounds(where, dir, doc, product === "live.music");
  }

  scene(where, d) {
    for (const id of d.scene) this.prefab(id, `${where} scene`);
    for (const [k, cls] of [["graphics", "GraphicsSettings"], ["quality", "QualitySettings"], ["player", "PlayerSettings"]])
      if (has(d.graphics, k)) this.object(d.graphics[k], cls, `${where} graphics.${k}`);
    if (d.renderSettings != null) this.object(d.renderSettings, "RenderSettings", `${where} renderSettings`);
    for (const [skin, sprites] of Object.entries(d.laneSkins)) for (const k of LANE_SPRITES) this.sprite(sprites[k], `${where} laneSkins.${skin}.${k}`);
    for (const [k, id] of Object.entries(d.prefabs)) if (id !== null) this.prefab(id, `${where} prefabs.${k}`);
    for (const [k, id] of Object.entries(d.spriteAssets)) this.object(id, "MonoBehaviour", `${where} spriteAssets.${k}`);
    for (const [band, b] of Object.entries(d.bands)) {
      const w = `${where} bands.${band}`;
      this.prefab(b.timeline, `${w} timeline`);
      this.sprite(b.background, `${w} background`);
      for (const [track, t] of Object.entries(b.tracks)) {
        this.object(track, "MonoBehaviour", `${w} tracks`);
        const p = this.prefab(t.prefab, `${w} tracks.${track}`);
        if (p && !p.animators.includes(t.animator)) this.err(w, `tracks.${track}: ${t.animator} is no node of its prefab with an Animator`);
      }
    }
    if (!has(d.laneSkins, d.settings.laneSkin)) this.err(where, `settings.laneSkin ${d.settings.laneSkin} not in laneSkins`);
  }

  notes(where, d) {
    for (const [k, id] of Object.entries(d.prefabs)) this.prefab(id, `${where} prefabs.${k}`);
    this.mono(d.laneEffect, "LiveLaneEffectAssetSettings", `${where} laneEffect`);
  }

  // sounds.json or music.json: the sound ids it uses are in `sounds`, every category has a volume, the loop points lie
  // in the waveform, the waveform files are in the product and of the described format and length
  sounds(where, dir, a, music) {
    const errs = [], snd = (id) => has(a.sounds, String(id));
    if (music) {
      if (!snd(a.music.soundId)) errs.push(`music.soundId ${a.music.soundId} not in sounds`);
    } else {
      for (const [t, id] of Object.entries(a.noteSe.types)) if (!snd(id)) errs.push(`noteSe.types.${t}: sound ${id} not in sounds`);
      for (const [g, types] of Object.entries(a.noteSe.groups || {}))
        for (const [t, id] of Object.entries(types)) if (!snd(id)) errs.push(`noteSe.groups.${g}.${t}: sound ${id} not in sounds`);
      // auto play ends every chart with an all perfect: of the live SE, FinishCheers (10) and AllPerfectDirection (16)
      // are played; the other types need no sound
      for (const t of [10, 16]) if (!has(a.liveSe, String(t)) || !snd(a.liveSe[t])) errs.push(`liveSe.${t}: no sound in sounds`);
      for (const [k, id] of Object.entries(a.voice || {})) if (/SoundId$/.test(k) && id > 0 && !snd(id)) errs.push(`voice.${k}: sound ${id} not in sounds`);
      for (const [id, s] of Object.entries(a.sounds))
        for (const c of s.categories) if (!has(a.categories, c)) errs.push(`sounds.${id}: category ${c} has no volume in categories`);
    }
    for (const e of errs) this.err(where, e);
    if (this.S.info && this.S.info.audio === false) return;     // a chart without waveforms
    for (const [id, s] of Object.entries(a.sounds))
      for (const L of s.layers) {
        if ((L.loopStart === null) !== (L.loopEnd === null)) this.err(where, `sounds.${id}: loopStart and loopEnd must both be set or both null`);
        if (L.loopStart !== null && !(L.loopStart < L.loopEnd && L.loopEnd <= L.samples)) this.err(where, `sounds.${id}: loop points outside the waveform`);
        const p = `${dir}/${L.file}`;
        if (!this.S.has(p)) { this.err(where, `sounds.${id}: ${p} missing`); continue; }
        const e = this.ofFile(`wave|${L.sampleRate}|${L.channels}|${L.samples}`, p, (b) => waveCheck(b, L));
        if (e) this.err(p, e);
      }
  }

  // every object of the store: its JSON files parse; a Texture2D's image is a PNG of its size; a Shader's parsed form
  // and variant index, and the GLES3 programs of the shaders its Materials use; a Mesh's arrays
  objects({ selectedPrograms = false, materialKeywords = new Map() } = {}) {
    const drawn = new Set();
    const materials = new Map();
    for (const id of objectIds(this.S)) {
      if (this.S.object(id).class !== "Material") continue;
      const r = this.ofObject("materialshader", id, "json", (b) => { try { const m = JSON.parse(b); return { shader: refOf(m.shader), keywords: m.keywords || [] }; } catch { return {}; } });
      if (r.shader) { drawn.add(r.shader); if (!materials.has(r.shader)) materials.set(r.shader, []); materials.get(r.shader).push(...(materialKeywords.get(id) || [r.keywords])); }
    }
    for (const id of objectIds(this.S)) {
      const o = this.S.object(id), roles = this.S.roles(id), where = `${o.class} ${id}${o.name ? ` (${o.name})` : ""}`;
      if (!roles.includes("json")) { this.err(where, "no json file"); continue; }
      const json = (role, check = () => []) => this.ofObject(`json:${o.class}:${role}`, id, role, (b) => {
        let v;
        try { v = JSON.parse(b); } catch (e) { return { errs: [`${role}: not valid JSON (${e.message})`] }; }
        return { errs: check(v), v: o.class === "Shader" && role === "index" ? v : undefined };
      });
      const report = (r) => { for (const e of r.errs) this.err(where, e); return r.errs.length ? null : r; };
      if (o.class === "Texture2D") {
        const t = report(this.ofObject("texture", id, "json", (b) => {
          const v = JSON.parse(b);
          return ["m_Width", "m_Height", "m_MipCount"].every((k) => Number.isInteger(v[k]))
            ? { errs: [], w: v.m_Width, h: v.m_Height, mips: v.m_MipCount } : { errs: ["m_Width, m_Height, m_MipCount missing"] };
        }));
        if (!t || !roles.includes("image")) continue;
        const info = this.ofObject("png", id, "image", (b) => { try { return pngInfo(b); } catch (e) { return { error: e.message }; } });
        if (info.error) this.err(where, `image: ${info.error}`);
        else if (info.width !== t.w || info.height !== t.h) this.err(where, `image: PNG is ${info.width}x${info.height}, the texture ${t.w}x${t.h}`);
        const full = Math.floor(Math.log2(Math.max(t.w, t.h, 1))) + 1;
        if (!(t.mips >= 1 && t.mips <= full)) this.err(where, `m_MipCount ${t.mips} (1 to ${full})`);
      } else if (o.class === "Shader") {
        report(json("json", parsedShaderErrors));
        const ix = report(json("index", (v) => (isObj(v) && typeof v.name === "string" && Array.isArray(v.variants) ? [] : ["index: not a variant index"])));
        if (!ix || !drawn.has(id)) continue;
        if (selectedPrograms) for (const keywords of materials.get(id) || []) {
          const selected = variantFor([{ name: ix.v.name, variants: ix.v.variants.filter((v) => v.platform === SHADER_PLATFORM && v.type === SHADER_PROGRAM_TYPE && v.stage === "vertex") }], ix.v.name, keywords);
          if (selected.error) this.err(where, selected.error);
          else if (!roles.includes(selected.variant.role)) this.err(where, `material [${keywords.join(" ")}]: no ${selected.variant.role} file`);
        }
        for (const v of ix.v.variants) {
          if (v.platform !== SHADER_PLATFORM || v.type !== SHADER_PROGRAM_TYPE) continue;
          if (selectedPrograms && !roles.includes(v.role)) continue;
          if (!roles.includes(v.role)) { this.err(where, `no ${v.role} file`); continue; }
          for (const e of this.ofObject("glsl", id, v.role, (b) => glslStages(b.toString("utf8")))) this.err(`${where} ${v.role}`, e);
        }
      } else if (o.class === "Mesh") {
        report(json("json"));
        if (!roles.includes("arrays")) {
          const mesh = this.S.objectJson(id);
          if (mesh.m_VertexData?.m_VertexCount !== 0 || mesh.m_SubMeshes?.some((s) => s.indexCount > 0)) this.err(where, "no arrays file");
          continue;
        }
        report(json("arrays", (v) => (isObj(v) && Array.isArray(v.positions) && Array.isArray(v.submeshes)
          && v.submeshes.every((s) => isObj(s) && typeof s.topology === "string" && (s.indices === null || Array.isArray(s.indices)))
          ? [] : ["arrays: needs positions and submeshes [{topology, indices}]"])));
      } else report(json("json"));
    }
  }

  // the live: live.json (schema, through LiveData), its scores, its jacket and band, and its parts against each other
  live() {
    let data;
    try { data = new LiveData(this.S); } catch (e) { this.err("live", e.message); return; }
    const where = `${data.dir}/live.json`, live = this.doc(where, S.live);
    if (!live) return;
    const score = (f) => {
      const p = `${data.dir}/${f}`;
      if (!this.S.has(p)) { this.err(p, "missing"); return null; }
      const r = this.ofFile("score", p, (b) => { try { return scoreCheck(JSON.parse(b)); } catch (e) { return { errs: [`not valid JSON (${e.message})`] }; } });
      for (const e of r.errs) this.err(p, e);
      return r.errs.length ? null : { ...r, path: p };
    };
    const sc = score(live.notes), mirror = live.notesMirror ? score(live.notesMirror) : null;
    this.sprite(live.jacket, `${where} jacket`);
    let scene, notes, audio;
    try {
      scene = data.scene; notes = data.notes; audio = data.audio(); data.noteskin(); data.noteeffect();
    } catch (e) { this.err("live", e.message); return; }
    for (const s of [sc, mirror]) if (s && notes.settings.laneCount !== s.laneCount)
      this.err(s.path, `laneCount ${s.laneCount}, notes.json settings.laneCount ${notes.settings.laneCount}`);
    if (!has(scene.bands, String(live.band.band))) this.err(where, `band ${live.band.band}: no start timeline in scene.json bands`);
    // a quality row for every LiveQuality the live offers (the store's `options`, else its default)
    const info = this.S.info, ctx = new LiveOptionContext({ live, scene, notes, audio, info, skins: data.noteskins, effects: data.noteeffects });
    for (const q of (info.options && info.options.LiveQuality) || [ctx.defaults.LiveQuality])
      if (!scene.settings.qualitySettings.some((r) => r._quality === q)) this.err(where, `scene.json settings.qualitySettings: no row for quality ${q}`);
    const fmt = info.audioFormat, music = audio.sounds[String(audio.music.soundId)];
    if (!music) this.err(where, `the music's sound ${audio.music.soundId} is in no sounds`);
    else if (fmt && extOf(music.layers[0].file) !== WAVE_EXT[fmt]) this.err(where, `music file ${music.layers[0].file} does not match audioFormat ${fmt}`);
  }
}


// a prefab / scene node list: hierarchy order (parent before child), local TRS, components
function nodeList(pf, where, errs) {
  if (!Array.isArray(pf.nodes)) { errs.push(`${where}.nodes is not an array`); return; }
  const paths = new Set();
  for (const n of pf.nodes) {
    if (!isObj(n) || typeof n.path !== "string" || !Array.isArray(n.components)) { errs.push(`${where}: a node needs path and components`); return; }
    const cut = n.path.lastIndexOf("/");
    if (cut >= 0 && !paths.has(n.path.slice(0, cut))) { errs.push(`${where}: parent of ${n.path} is not listed before it`); return; }
    for (const k of ["localPosition", "localRotation", "localScale"]) if (!isObj(n[k])) { errs.push(`${where}: ${n.path} has no ${k}`); return; }
    paths.add(n.path);
  }
  errs.push(...S.prefab(pf).map((error) => `${where}: ${error}`));
}

// ------------------------------------------------------------------------------------------------ one Live2D model
const LIT_SHADER = "Live2D Cubism/Lit-URP-ADV-optimize", MASK_SHADER = "Live2D Cubism/Mask";
const ROOT_COMPONENTS = ["Live2DCharacter", "CubismFadeController", "CubismExpressionController", "CubismRenderController",
  "CubismAutoEyeBlinkInput", "CubismEyeBlinkController", "CubismMouthController", "CubismHarmonicMotionController"];
const MODEL_PRODUCT = "live2d.model";
const MODEL_KEY = /^Character\/Live2D\/([^/]+)\/([^/]+)\/model\/\2$/;
// the programs the player draws with (ShaderLib.fromObjects)
const SHADER_PLATFORM = "gles3", SHADER_PROGRAM_TYPE = "GLES3";
// a prefab component's class: a MonoBehaviour's script class, else its type
const classOf = (c) => (typeof c.script === "string" ? c.script.slice(c.script.lastIndexOf("|") + 1) : c.type);
// the script class of a MonoBehaviour's document (mono.json $script)
const scriptOf = (v) => (isObj(v) && typeof v.$script === "string" ? v.$script.slice(v.$script.lastIndexOf("|") + 1) : null);
// the object id a reference names ({"$ref": {file, pathId}}): null for null, undefined for anything else
const refOf = (v) => (v === null ? null
  : isObj(v) && isObj(v.$ref) && typeof v.$ref.file === "string" && typeof v.$ref.pathId === "string" ? `${v.$ref.file}:${v.$ref.pathId}`
  : undefined);

// the prefab as the model viewer reads it: {errs, ch (the Live2DCharacter's fields), clips, fadeList, expressionList
// (object ids; expressionList null without one), drawables: [{path, texture, material}], motionSync}
function modelPrefab(pf) {
  const errs = [];
  if (!isObj(pf)) return { errs: ["not an object"] };
  nodeList(pf, "prefab", errs);
  if (errs.length) return { errs };
  const root = pf.nodes[0], comp = (cls) => root.components.filter((c) => classOf(c) === cls);
  for (const cls of ROOT_COMPONENTS) if (comp(cls).length !== 1) errs.push(`root ${root.path}: ${comp(cls).length} ${cls}`);
  if (comp("CubismPhysicsController").length > 1) errs.push(`root ${root.path}: more than one CubismPhysicsController`);
  if (errs.length) return { errs };
  const fields = (cls) => (isObj(comp(cls)[0].fields) ? comp(cls)[0].fields : {});
  const ch = fields("Live2DCharacter");
  const clips = (Array.isArray(ch._motionList) ? ch._motionList : []).map(refOf);
  if (!clips.length) errs.push("Live2DCharacter._motionList is empty");
  if (clips.some((c) => !c)) errs.push("Live2DCharacter._motionList: an entry is not a reference");
  const fadeList = refOf(fields("CubismFadeController").CubismFadeMotionList);
  if (!fadeList) errs.push("CubismFadeController.CubismFadeMotionList is not a reference");
  const ex = fields("CubismExpressionController");
  if (ex.UseLegacyBlendCalculation) errs.push("legacy expression blend is not supported");
  const expressionList = refOf(ex.ExpressionsList);
  if (expressionList === undefined) errs.push("CubismExpressionController.ExpressionsList is not a reference");
  const drawables = [];
  let nodes = 0;
  for (const n of pf.nodes) {
    if (!n.components.some((c) => classOf(c) === "CubismDrawable")) continue;
    nodes++;
    const r = n.components.find((c) => classOf(c) === "CubismRenderer"), mr = n.components.find((c) => c.type === "MeshRenderer");
    const texture = r && isObj(r.fields) ? refOf(r.fields._mainTexture) : undefined;
    const mats = mr && isObj(mr.fields) && Array.isArray(mr.fields.m_Materials) ? mr.fields.m_Materials : [];
    if (!texture) errs.push(`${n.path}: CubismRenderer._mainTexture is not a reference`);
    else if (mats.length !== 1 || !refOf(mats[0])) errs.push(`${n.path}: needs one material`);
    else drawables.push({ path: n.path, texture, material: refOf(mats[0]) });
  }
  if (!nodes) errs.push("no CubismDrawable nodes");
  if (pf.nodes.some((n) => n.components.some((c) => classOf(c) === "CubismPosePart"))) errs.push("pose parts are not supported");
  // a MotionSync controller with a CRI audio input on the root (CubismMotionSyncController.fromPrefab's test)
  const motionSync = comp("CubismMotionSyncController").length > 0 && comp("Live2DMotionSyncCriAudioInput").length > 0;
  return { errs, ch, clips, fadeList, expressionList, drawables, motionSync };
}

// a parsed shader (a Shader object's json, the parsed file of a shader directory): the problems found
const parsedShaderErrors = (s) => {
  if (!isObj(s) || !Array.isArray(s.subShaders) || !s.subShaders.every((x) => Array.isArray(x.passes) && x.passes.every((y) => isObj(y.state))))
    return ["subShaders[].passes[].state missing"];
  return s.properties !== undefined && !Array.isArray(s.properties) ? ["properties is not an array"] : [];
};

// the keyword the story renderer adds to every character draw at Best (StoryRenderer.characterKeywords); a model's
// Lit programs hold each material keyword set with and without it
const STORY_LIGHTS = "_ADDITIONAL_LIGHTS_VERTEX";

// A product manifest (nnnotes.product/1). Its files are the product's own and, as "<object id>#<role>", the files of
// its objects (the AssetStore's names for them).
class Product extends Chart {
  constructor(site, id, man, where = null) {
    super(site, id, man, where);
    this.objects = isObj(man.objects) ? man.objects : {};
    this.files = { ...(isObj(man.files) ? man.files : {}) };
    for (const [oid, o] of Object.entries(this.objects))
      if (isObj(o) && isObj(o.files)) for (const [role, f] of Object.entries(o.files)) this.files[`${oid}#${role}`] = f;
    this.read = new Set();            // the files a reader of the product reads
    this.immutable = /^products\/[0-9a-f]{64}\.json$/.test(this.where || "");
    if (this.immutable) {
      const actual = crypto.createHash("sha256").update(fs.readFileSync(site.file(this.where))).digest("hex");
      if (path.posix.basename(this.where, ".json") !== actual) this.err("manifest", "content id differs from the immutable manifest path");
    }
  }

  // the manifest's name (its path without the directory and .json) is its subject with "/" as "_"
  checkName() {
    if (this.immutable) return;
    const name = path.posix.basename(this.where, ".json");
    const subject = this.man.product === LIVE_PRODUCT && this.where.startsWith("charts/")
      ? String(this.man.subject).split("/").slice(0, 2).join("/") : String(this.man.subject);
    const want = subject.replaceAll("/", "_");
    if (name !== want) this.err("manifest", `subject ${this.man.subject}: the manifest's name is ${name}, not ${want}`);
  }

  // an object's file by role: json and index JSON, image PNG, a program GLSL, a blob any
  extOfFile(p) {
    const cut = p.indexOf("#");
    if (cut < 0) return extOf(p);
    const role = p.slice(cut + 1);
    return ["json", "index", "arrays"].includes(role) ? "json" : role === "image" ? "png" : role.startsWith("program:") ? "glsl" : null;
  }

  // the object `id` is in the manifest, of class `cls` (`where`: the reference's place, for errors)
  object(id, cls, where) {
    const o = this.objects[id];
    if (!isObj(o)) { this.err(where, `object ${id} not in the manifest`); return false; }
    if (o.class !== cls) { this.err(where, `${id}: a ${o.class}, not a ${cls}`); return false; }
    return true;
  }

  // the file of `role` of object `id`, read: its name, null when the object has none
  role(id, role, where) {
    const p = `${id}#${role}`;
    if (!this.has(p)) { this.err(where, `${id}: no ${role} file`); return null; }
    this.read.add(p);
    return p;
  }

  // the parsed JSON of the file of `role` of object `id`, read and checked by `check` (cached per asset and `kind`),
  // or null
  doc(kind, id, role, where, check = () => []) {
    const p = this.role(id, role, where);
    if (!p) return null;
    const r = this.json(`product:${kind}`, p, (v) => { const errs = check(v); return { errs, v: errs.length ? null : v }; });
    return r ? r.v : null;
  }
}

// A model's product manifest (models/<id>.json): the product live2d.model.
class Model extends Product {
  constructor(site, id, man, where = null) {
    super(site, id, man, where);
    this.index = null;                // model.json, once the model is valid
  }

  // a models.json entry against the manifest: the problems found (not added to the model's own)
  entryErrors(entry) {
    const m = this.man, out = [], key = MODEL_KEY.exec(String(m.subject)), idx = this.index;
    const e = (msg) => out.push(`models.json: ${msg}`);
    if (key && entry.id !== key[2]) e(`id ${entry.id}, the manifest's model ${key[2]}`);
    if (has(entry, "key") && entry.key !== m.subject) e(`key ${entry.key}, manifest subject ${m.subject}`);
    if (has(entry, "group") && key && entry.group !== key[1]) e(`group ${entry.group}, the manifest subject's ${key[1]}`);
    if (idx && has(entry, "canvas") && !sameJson(entry.canvas, idx.canvas)) e("canvas differs from model.json canvas");
    if (idx && has(entry, "textures") && entry.textures !== idx.textures.length) e(`textures ${entry.textures}, model.json ${idx.textures.length}`);
    const total = sizeOf(this.files), count = Object.keys(this.files).length;
    if (has(entry, "bytes") && entry.bytes !== total) e(`bytes ${entry.bytes}, manifest files total ${total}`);
    if (has(entry, "files") && entry.files !== count) e(`files ${entry.files}, manifest ${count}`);
    return out;
  }

  run() {
    const m = this.man;
    for (const e of S.product(m)) this.err("manifest", e);
    if (this.errs.length) return this.errs;
    if (m.product !== MODEL_PRODUCT) this.err("manifest", `product ${m.product}, a model is ${MODEL_PRODUCT}`);
    const key = MODEL_KEY.exec(m.subject);
    if (!key) this.err("manifest", `subject ${m.subject} is not a model key (Character/Live2D/<group>/<name>/model/<name>)`);
    const name = this.where ? path.posix.basename(this.where, ".json") : null;
    if (key && name !== null && !this.immutable && key[2] !== name) this.err("manifest", `subject: model ${key[2]}, expected ${name} (the manifest's name)`);
    if (Object.keys(m.files).join("\n") !== "model.json") this.err("manifest", "files: model.json is the one file of a model");
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const mj = this.json("modeljson", "model.json", (v) => ({ errs: S.modelJson(v), v: S.modelJson(v).length ? null : v }));
    const idx = mj && mj.v;
    if (!idx) return this.errs;
    this.read.add("model.json");
    if (idx.key !== m.subject) this.err("model.json", `key ${idx.key}, manifest subject ${m.subject}`);
    if (key && idx.name !== key[2]) this.err("model.json", `name ${idx.name}, the key's model ${key[2]}`);
    const named = [[idx.prefab, "GameObject", "prefab"], [idx.moc, "MonoBehaviour", "moc"],
      ...idx.textures.map((id) => [id, "Texture2D", "textures"]),
      ...Object.entries(idx.shaders).map(([n, id]) => [id, "Shader", `shaders.${n}`]),
      ...Object.entries(idx.resources).map(([n, id]) => [id, "Material", `resources.${n}`]),
      ...Object.keys(idx.bindings).map((id) => [id, "AnimationClip", "bindings"])];
    for (const [id, cls, what] of named) this.object(id, cls, `model.json ${what}`);
    if (this.errs.length) return this.errs;

    // the moc: a CubismMoc whose blob:_bytes is a moc3
    this.doc("mocjson", idx.moc, "json", "model.json moc", (v) => (scriptOf(v) === "CubismMoc" ? [] : ["not a CubismMoc"]));
    const mp = this.role(idx.moc, "blob:_bytes", "model.json moc");
    const moc3 = (asset) => { const b = this.site.bytes(asset); return b.length >= 8 && b.toString("latin1", 0, 4) === "MOC3"; };
    if (mp && !this.site.once("moc3", this.files[mp].asset, () => moc3(this.files[mp].asset))) this.err(mp, "not a moc3 file");
    const pp = this.role(idx.prefab, "json", "model.json prefab");
    const pf = pp && this.json("prefab", pp, modelPrefab);
    if (!pf || pf.errs.length) return this.errs;
    if (idx.motionSync !== pf.motionSync)
      this.err("model.json", `motionSync ${idx.motionSync}, the prefab's root ${pf.motionSync ? "has" : "has no"} MotionSync controller with a CRI audio input`);

    // motions: each clip of the motion list with the names of its bindings and a fade motion for its InstanceId
    const fadeIds = new Set();
    const fl = this.object(pf.fadeList, "MonoBehaviour", "CubismFadeController.CubismFadeMotionList")
      ? this.doc("fadelist", pf.fadeList, "json", "fade motion list", (v) => (Array.isArray(v.MotionInstanceIds) && Array.isArray(v.CubismFadeMotionObjects)
        && v.MotionInstanceIds.length === v.CubismFadeMotionObjects.length ? [] : ["MotionInstanceIds and CubismFadeMotionObjects are not lists of one length"]))
      : null;
    for (const [i, r] of (fl ? fl.CubismFadeMotionObjects : []).entries()) {
      const id = refOf(r);
      if (!id) { this.err("fade motion list", `CubismFadeMotionObjects[${i}] is not a reference`); continue; }
      if (!this.object(id, "MonoBehaviour", "fade motion list")) continue;
      if (this.doc("fade", id, "json", "fade motion list", (v) => (scriptOf(v) === "CubismFadeMotionData" ? [] : ["not a CubismFadeMotionData"])))
        fadeIds.add(fl.MotionInstanceIds[i]);
    }
    const clipNames = [];
    for (const id of pf.clips) {
      if (!this.object(id, "AnimationClip", "Live2DCharacter._motionList")) continue;
      const c = this.doc("clip", id, "json", "Live2DCharacter._motionList",
                         (v) => (isObj(v) && typeof v.name === "string" && Array.isArray(v.bindings) && Array.isArray(v.events) ? [] : ["not a clip (name, bindings, events)"]));
      if (!c) continue;
      clipNames.push(c.name);
      const names = idx.bindings[id];
      if (!Array.isArray(names)) this.err("model.json", `bindings: clip ${c.name} (${id}) missing`);
      else if (names.length !== c.bindings.length) this.err("model.json", `bindings.${id}: ${names.length} names, clip ${c.name} has ${c.bindings.length} bindings`);
      const ev = c.events.filter((e) => e.functionName === "InstanceId");
      if (!ev.length || !fadeIds.has(ev[ev.length - 1].intParameter)) this.err(`clip ${c.name}`, "no fade motion for its InstanceId");
    }
    for (const id of Object.keys(idx.bindings)) if (!pf.clips.includes(id)) this.err("model.json", `bindings.${id}: not a clip of Live2DCharacter._motionList`);
    if (!clipNames.includes(pf.ch.DefaultMotionName)) this.err("prefab", `default motion ${pf.ch.DefaultMotionName} is not a clip`);

    // expressions
    const exprNames = [];
    if (pf.expressionList !== null && this.object(pf.expressionList, "MonoBehaviour", "CubismExpressionController.ExpressionsList")) {
      const el = this.doc("exprlist", pf.expressionList, "json", "expression list",
                          (v) => (Array.isArray(v.CubismExpressionObjects) ? [] : ["CubismExpressionObjects is not a list"]));
      for (const [i, r] of (el ? el.CubismExpressionObjects : []).entries()) {
        const id = refOf(r);
        if (!id) { this.err("expression list", `CubismExpressionObjects[${i}] is not a reference`); continue; }
        if (!this.object(id, "MonoBehaviour", "expression list")) continue;
        const e = this.doc("expr", id, "json", "expression list",
                           (v) => (scriptOf(v) === "CubismExpressionData" && typeof v.m_Name === "string" ? [] : ["not a CubismExpressionData"]));
        if (e) exprNames.push(e.m_Name.replace(/\.exp3$/, ""));
      }
    }
    if (pf.ch.DefaultExpressionName && !exprNames.includes(pf.ch.DefaultExpressionName))
      this.err("prefab", `default expression ${pf.ch.DefaultExpressionName} is not in ExpressionsList`);

    // materials: the drawables' draw with the Lit shader (their keyword sets), the mask materials with the mask shader
    const material = (id, where) => (this.object(id, "Material", where)
      ? this.doc("material", id, "json", where, (v) => (isObj(v) && Array.isArray(v.keywords) && refOf(v.shader) ? [] : ["not a material (shader, keywords)"]))
      : null);
    const kw = new Map();
    let masked = false;
    for (const d of pf.drawables) {
      const mat = material(d.material, d.path);
      if (!mat) continue;
      if (refOf(mat.shader) !== idx.shaders[LIT_SHADER]) { this.err(d.path, `material ${mat.material} is not drawn with ${LIT_SHADER} (model.json shaders)`); continue; }
      const k = [...mat.keywords].sort();
      kw.set(k.join(" "), k);
      if (k.includes("CUBISM_MASK_ON")) masked = true;
    }
    for (const [n, id] of Object.entries(idx.resources)) {
      const mat = material(id, `model.json resources.${n}`);
      if (mat && refOf(mat.shader) !== idx.shaders[MASK_SHADER]) this.err("model.json", `resources.${n}: material ${mat.material} is not drawn with ${MASK_SHADER}`);
    }

    // textures: model.json's are the drawables' main textures, each a PNG of its size
    const pages = [...new Set(pf.drawables.map((d) => d.texture))].sort();
    if (!sameJson([...idx.textures].sort(), pages)) this.err("model.json", "textures differ from the drawables' main textures");
    for (const id of pages) {
      if (!this.object(id, "Texture2D", "a drawable's main texture")) continue;
      const t = this.doc("texture", id, "json", `texture ${id}`,
                         (v) => (["m_Width", "m_Height", "m_MipCount"].every((k) => Number.isInteger(v[k])) ? [] : ["m_Width, m_Height, m_MipCount missing"]));
      const p = this.role(id, "image", `texture ${id}`);
      if (!t || !p) continue;
      const asset = this.files[p].asset;
      if (assetExt(asset) !== "png") { this.err(p, "not a .png asset"); continue; }
      const info = this.site.once("png", asset, () => { try { return pngInfo(this.site.bytes(asset)); } catch (e) { return { error: e.message }; } });
      if (info.error) this.err(p, info.error);
      else if (info.width !== t.m_Width || info.height !== t.m_Height) this.err(p, `PNG is ${info.width}x${info.height}, the texture ${t.m_Width}x${t.m_Height}`);
      const full = Math.floor(Math.log2(Math.max(t.m_Width, t.m_Height))) + 1;
      if (!(t.m_MipCount >= 1 && t.m_MipCount <= full)) this.err(p, `m_MipCount ${t.m_MipCount} (1 to ${full})`);
    }

    // shaders: of each, the parsed form and the variant index (ShaderLib reads both), and the GLES3 programs read: the
    // model viewer's (each material keyword set of the Lit shader, the mask shader's without keywords when a drawable is
    // masked) and the story renderer's at Best (each set with STORY_LIGHTS)
    const list = [];
    for (const [n, id] of Object.entries(idx.shaders)) {
      this.doc("shaderinfo", id, "json", `shader ${n}`, parsedShaderErrors);
      const index = this.doc("shaderindex", id, "index", `shader ${n}`,
                             (v) => (isObj(v) && v.name === n && Array.isArray(v.variants) ? [] : [`not the variant index of ${n}`]));
      if (index) list.push({ name: n, id, variants: index.variants.filter((v) => v.platform === SHADER_PLATFORM && v.type === SHADER_PROGRAM_TYPE) });
    }
    const program = (rec, v) => {
      const p = this.role(rec.id, v.role, `shader ${rec.name}`);
      if (p) for (const e of this.site.once("glsl", this.files[p].asset, () => glslStages(this.text(p)))) this.err(p, e);
    };
    for (const [n, sets] of [[LIT_SHADER, [...kw.values()]], ...(masked ? [[MASK_SHADER, [[]]]] : [])]) {
      const rec = list.find((r) => r.name === n);
      if (!rec) { this.err("model.json", `shaders: ${n} missing`); continue; }
      for (const set of sets) {
        const v = variantFor(list, n, set);
        if (v.error) this.err(`shader ${n}`, v.error);
        else program(rec, v.variant);
        if (n !== LIT_SHADER) continue;
        const sv = storyVariant(list, set);
        if (sv.error) this.err(`shader ${n}`, sv.error);
        else program(rec, sv.variant);
      }
    }
    for (const p of Object.keys(this.files)) if (!this.read.has(p)) this.err(p, "listed but read by neither the model viewer nor the story player");
    if (!this.errs.length) this.index = idx;
    return this.errs;
  }
}

// ------------------------------------------------------------------------------------------------ one live
// A product manifest a live names in its live.json `parts`, checked with the store of its own files and objects.
class Part extends Product {
  run(product) {
    const m = this.man;
    for (const e of S.product(m)) this.err("manifest", e);
    if (this.errs.length) return this.errs;
    if (m.product !== product) this.err("manifest", `product ${m.product}, live.json names a ${product}`);
    this.checkName();
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const dir = productDir(this.where);
    const files = Object.fromEntries(Object.entries(m.files).map(([p, f]) => [`${dir}/${p}`, f]));
    const C = new LiveChecks(this.site, new SiteStore(this.site, files, m.objects, { audio: m.audio }), (w, msg) => this.err(w, msg));
    C.part(product, dir);
    C.objects();
    return this.errs;
  }
}

// A UI product and the library entries that select its prefabs and controllers.
class UI extends Product {
  run(entry) {
    for (const e of S.product(this.man)) this.err("manifest", e);
    if (this.man.product !== "ui.pack") this.err("manifest", "expected ui.pack");
    if (this.errs.length) return this.errs;
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const store = new SiteStore(this.site, this.man.files, this.man.objects);
    const C = new LiveChecks(this.site, store, (where, message) => this.err(where, message));
    const ui = C.doc("ui.json", S.uiPack);
    if (!ui) return this.errs;
    if (ui.key !== this.man.subject) this.err("ui.json", "key differs from product subject");
    for (const [field, cls] of [["roots", null], ["prefabs", "GameObject"], ["controllers", "AnimatorController"]]) {
      if (new Set(ui[field]).size !== ui[field].length) this.err("ui.json", `${field}: duplicate object id`);
      for (const id of ui[field]) C.object(id, cls, `ui.json ${field}`);
    }
    for (const id of ui.prefabs) C.prefab(id, "ui.json prefabs");
    C.tables("ui.json", ui);
    // Canvas 2D preview reads object data and images; it selects no GPU material variants.
    C.objects({ selectedPrograms: true, materialKeywords: new Map(Object.entries(this.man.objects)
      .filter(([, o]) => o.class === "Material").map(([id]) => [id, []])) });
    if (entry && (entry.key !== ui.key || !sameJson(entry.roots, ui.roots))) this.err("index.json", "entry differs from UI product roots");
    for (const [group, cls, ids] of [["embedded", "GameObject", ui.prefabs], ["controllers", "AnimatorController", ui.controllers]])
      for (const row of this.site.uiIndex?.[group] || []) if (row.manifest === this.where) {
        C.object(row.id, cls, `index.json ${group}`);
        if (!ids.includes(row.id)) this.err("index.json", `${group}: ${row.id} not listed in the UI product`);
        if (group === "embedded" && !sameJson(row.roots, [row.id])) this.err("index.json", `embedded: ${row.id} roots differ from its object id`);
      }
    return this.errs;
  }
}

// A live manifest with the products its live.json parts name, each checked once (Site.part).
class Live extends Product {
  run() {
    const m = this.man;
    for (const e of S.product(m)) this.err("manifest", e);
    if (this.errs.length) return this.errs;
    if (m.product !== LIVE_PRODUCT) this.err("manifest", `product ${m.product}, a live is ${LIVE_PRODUCT}`);
    this.checkName();
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const live = this.json("livejson", "live.json", (v) => ({ errs: S.live(v), v: S.live(v).length ? null : v }));
    if (!live || !live.v) return this.errs;
    const loaded = [[productDir(this.where), m]];
    for (const [part, product] of Object.entries(LIVE_PARTS)) {
      const p = live.v.parts[part], r = this.site.part(p, product);
      if (r.errs.length) {
        if (r.shown) this.err(p, "not valid (reported above)");
        else for (const e of r.errs) this.err(p, e);
        r.shown = true;
      } else loaded.push([productDir(p), r.man]);
    }
    for (const p of m.variants || []) {
      try {
        const variant = JSON.parse(fs.readFileSync(this.site.file(p), "utf8"));
        if (!LIVE_VARIANTS.includes(variant.product)) { this.err(p, "not a live variant product"); continue; }
        const r = this.site.part(p, variant.product);
        for (const e of r.errs) this.err(p, e);
        if (!r.errs.length) loaded.push([productDir(p), r.man]);
      } catch (e) { this.err(p, e.code === "ENOENT" ? "missing" : e.message); }
    }
    if (this.errs.length) return this.errs;
    let merged;
    try { merged = liveManifest(loaded); } catch (e) { this.err("live", e.message); return this.errs; }
    const { files, objects, ...info } = merged;
    new LiveChecks(this.site, new SiteStore(this.site, files, objects, info), (w, msg) => this.err(w, msg)).live();
    return this.errs;
  }
}

// ------------------------------------------------------------------------------------------------ one story
// LanguageMode and text field per language (ui/languages.json)
const STORY_LANGUAGES = { ja: [0, "japanese"], en: [1, "english"], "zh-Hant": [2, "traditionalChinese"],
  "zh-Hans": [3, "simplifiedChinese"], ko: [4, "korean"] };
const TMP_TEXT_CLASSES = new Set(["TextMeshProUGUI", "RubyTextMeshProUGUI", "RubyEmojiTextMeshProUGUI"]);
const TMP_SPRITE_SHADER = "TextMeshPro/Sprite";
// TMP_Text.SetArraySizes: TMP_Settings.missingGlyphCharacter 0 is U+25A1; without it U+0020, then U+0003 (a control
// character TextMeshPro synthesizes: no font asset needs to hold it)
const TMP_MISSING_GLYPH = 0x25A1, TMP_SPACE = 0x20, TMP_END_OF_TEXT = 0x03;
const hexU = (u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`;
// TMP_MaterialManager.GetFallbackMaterial: the values a fallback material takes from the fallback asset's material
// (_TextureWidth / _TextureHeight too, which the player sets per page) and the ratios UpdateShaderRatios recomputes
const FALLBACK_OWN = new Set(["_GradientScale", "_TextureWidth", "_TextureHeight", "_WeightNormal", "_WeightBold",
  "_ScaleRatioA", "_ScaleRatioB", "_ScaleRatioC"]);
// ShaderUtilities.UpdateShaderRatios in float32 -> {a, c (null without the underlay properties)}, null without
// _FaceDilate (the material's ratios then stay)
const scaleRatios = (fl, keywords) => {
  if (!("_FaceDilate" in fl)) return null;
  const F = Math.fround, on = !keywords.includes("RATIOS_OFF");
  const gs = F(fl._GradientScale), dilate = F(fl._FaceDilate);
  const w = F(Math.max(F(fl._WeightNormal ?? 0), F(fl._WeightBold ?? 0)) / 4);
  let t = Math.max(1, F(F(F(w + dilate) + F(fl._OutlineWidth ?? 0)) + F(fl._OutlineSoftness ?? 0)));
  const a = on ? F(F(gs - 1) / F(gs * t)) : 1;
  let c = null;
  if ("_UnderlayOffsetX" in fl) {
    const range = F(F(w + dilate) * F(gs - 1));
    t = Math.max(1, F(F(Math.max(Math.abs(F(fl._UnderlayOffsetX)), Math.abs(F(fl._UnderlayOffsetY ?? 0))) + F(fl._UnderlayDilate ?? 0)) + F(fl._UnderlaySoftness ?? 0)));
    c = on ? F(Math.max(0, F(F(gs - 1) - range)) / F(gs * t)) : 1;
  }
  return { a, c };
};
const mainTexName = (m) => (isObj(m.textures) && isObj(m.textures._MainTex) && isObj(m.textures._MainTex.texture) ? m.textures._MainTex.texture.name : null);
const WAVE_EXT = { aac: "m4a", flac: "flac" };
// JSON text with object keys sorted (comparison independent of key order)
const canon = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
const sameJson = (a, b) => canon(a) === canon(b);
const sizeOf = (files) => Object.values(files).reduce((n, f) => n + (isObj(f) && Number.isInteger(f.size) ? f.size : 0), 0);

// the variant of shader `name` in a parsed shader index that draws a material with `keywords`: the variant of sub
// shader 0, pass 0 whose keywords equal the material's keywords that the shader's variants use
function variantFor(list, name, keywords) {
  const rec = list.find((r) => r.name === name);
  if (!rec) return { error: `${name} not in the index` };
  const vs = rec.variants.filter((v) => v.subShader === 0 && v.pass === 0);
  const known = new Set(vs.flatMap((v) => v.keywords));
  const want = keywords.filter((k) => known.has(k)).sort().join(" ");
  const v = vs.find((x) => [...x.keywords].sort().join(" ") === want);
  return v ? { variant: v } : { error: `${name}: no variant for [${want}]` };
}

// the Lit variant the story renderer draws a material keyword set with at Best (quality 4): the set with STORY_LIGHTS,
// which the variant must hold (the pick drops keywords no variant uses: without it the draw would lack the additional
// lights)
function storyVariant(list, keywords) {
  const r = variantFor(list, LIT_SHADER, [...keywords, STORY_LIGHTS]);
  if (!r.error && r.variant.keywords.includes(STORY_LIGHTS)) return r;
  const want = [...new Set([...keywords, STORY_LIGHTS])].sort().join(" ");
  return { error: `${LIT_SHADER}: no variant for [${want}] (the story renderer's keywords at quality 4)` };
}

// A story and the products its part index selects. Each language is checked through the same StoryData view as playback.
class Story extends Product {
  constructor(...args) { super(...args); this.lang = null; this.fallbackSeen = new Set(); this.partCache = new Map(); }

  err(where, message) { this.errs.push(`${this.lang ? `[${this.lang}] ` : ""}${where}: ${message}`); }

  readDoc(path, check = () => []) {
    const r = this.json("story-document", path, (v) => ({ v, errs: check(v) }));
    return r && !r.errs.length ? r.v : null;
  }

  part(path, identity) {
    if (this.partCache.has(path)) {
      const m = this.partCache.get(path);
      if (m && (m.product !== identity.product || m.subject !== identity.subject)) {
        this.err(path, `expected ${identity.product} product of ${identity.subject}`); return null;
      }
      return m;
    }
    let product;
    try {
      const m = JSON.parse(fs.readFileSync(this.site.file(path), "utf8"));
      product = new Product(this.site, identity.subject, m, path);
      for (const e of S.product(m)) product.err("manifest", e);
      if (m.product !== identity.product || m.subject !== identity.subject)
        product.err("manifest", `expected ${identity.product} product of ${identity.subject}`);
      if (!product.errs.length) product.checkAssets();
      for (const e of product.errs) this.err(path, e);
    } catch (e) { this.err(path, e.message); }
    const result = product && !product.errs.length ? product.man : null;
    this.partCache.set(path, result);
    return result;
  }

  run(entry) {
    for (const e of S.storyManifest(this.man)) this.err("manifest", e);
    if (this.errs.length) return this.errs;
    const root = "../".repeat(this.where.split("/").length - 1);
    if ((this.man.root || "../") !== root) this.err("manifest", `root ${this.man.root || "../"}, expected ${root}`);
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const story = this.readDoc("story.json", S.story), episode = this.readDoc("episode.json", S.episode);
    if (!story || !episode) return this.errs;
    if (String(story.advId) !== this.man.subject || episode.advId !== story.advId)
      this.err("story.json", "story index, episode and product subject disagree");
    if (episode.commands.length !== episode.commandCount) this.err("episode.json", "commandCount differs from the number of rows");
    const languages = Object.keys(story.parts.ui);
    if (!languages.length) this.err("story.json", "no UI language");
    for (const name of ["fonts", ...(story.parts.simpleui ? ["simpleui"] : [])])
      if (!sameJson(Object.keys(story.parts[name]).sort(), [...languages].sort())) this.err("story.json", `parts.${name}: languages differ from parts.ui`);
    if (this.man.language && !languages.includes(this.man.language)) this.err("manifest", `default language ${this.man.language} not in parts.ui`);
    if (entry) {
      if (entry.id !== String(story.advId) || entry.advId !== story.advId) this.err("stories.json", "id differs from the story product");
      if (entry.playbackMode !== (episode.master?._playbackMode || 0)) this.err("stories.json", "playbackMode differs from the episode");
      if (!sameJson([...(entry.languages || [])].sort(), [...languages].sort())) this.err("stories.json", "languages differ from parts.ui");
    }
    const dir = productDir(`stories/${story.advId}.json`);
    const selected = this.site.storyLanguages || languages;
    for (const lang of selected) {
      this.lang = lang;
      if (!languages.includes(lang)) { this.err("story.json", `no UI language ${lang}`); continue; }
      try {
        const requests = storyPartRequests(story, lang), loaded = [[dir, this.man]];
        for (const [path, identity] of requests) {
          const m = this.part(path, identity);
          if (m) loaded.push([productDir(path), m]);
        }
        if (loaded.length !== requests.size + 1) continue;
        const merged = mergeProductManifests(loaded);
        const store = new SiteStore(this.site, merged.files, merged.objects, { ...merged, loadedLanguage: lang });
        const data = new StoryData(store), objects = new ObjectResources(store, data.resourceOptions());
        const checks = new LiveChecks(this.site, store, (w, m) => this.err(w, m));
        this.store = store; this.data = data; this.objectsView = objects; this.checks = checks;
        this.checkParts(requests);
        checks.objects({ selectedPrograms: true, materialKeywords: this.materialKeywords() });
        this.checkEpisode();
        this.checkFonts(data.fonts, data.ui);
        this.checkModels();
        if (entry?.commands) {
          const commands = StoryPlayerCore.requiredCommands(episode, data.playerSettings).sort();
          if (!sameJson([...entry.commands].sort(), commands)) this.err("stories.json", "commands differ from the episode and player settings");
        }
      } catch (e) { this.err("story", e.message); }
    }
    this.lang = null;
    return this.errs;
  }

  checkParts(requests) {
    const C = this.checks, data = this.data, objects = this.objectsView;
    for (const [path, { product }] of requests) {
      const spec = STORY_DOCS[product];
      if (!spec) continue;
      const [file, check] = spec, where = `${productDir(path)}/${file}`, doc = C.doc(where, S[check]);
      if (!doc) continue;
      if (doc.bindings) C.tables(where, doc);
      for (const [key, cls] of Object.entries(STORY_REFS[product] || {})) {
        const value = doc[key];
        for (const id of typeof value === "string" ? [value] : Array.isArray(value) ? value : Object.values(value || {}))
          if (cls === "GameObject") C.prefab(id, `${where} ${key}`); else C.object(id, cls, `${where} ${key}`);
      }
      for (const [key, id] of Object.entries(doc.settings || {})) {
        if (this.store.hasObject(id)) C.object(id, "MonoBehaviour", `${where} settings.${key}`);
        else {
          const cut = id.lastIndexOf(":"), ref = { $ref: { file: id.slice(0, cut), pathId: id.slice(cut + 1) } };
          try { if (this.store.contained(ref).component?.type !== "MonoBehaviour") this.err(where, `settings.${key}: not a MonoBehaviour`); }
          catch (e) { this.err(where, `settings.${key}: ${e.message}`); }
        }
      }
      for (const [key, id] of Object.entries(doc.graphics || {})) C.object(id, GRAPHICS_CLASSES[key], `${where} graphics.${key}`);
      if (doc.language) {
        if (doc.language.code !== this.lang || doc.language.field !== STORY_LANGUAGES[this.lang][1] || doc.language.mode !== STORY_LANGUAGES[this.lang][0]) this.err(where, "language code/field differs from selected language");
        for (const id of Object.keys(doc.texts || {})) if (!has(data.fonts.texts, id)) this.err(where, `text ${id} has no font binding`);
      }
      if (product === "story.asset") {
        if (doc.key !== this.partCache.get(path).subject) this.err(where, "key differs from product subject");
        for (const id of doc.objects) if (!this.store.hasObject(id)) this.err(where, `object ${id} missing`);
      }
      if (product === "story.host") {
        const node = (ref) => {
          if (!C.object(ref.prefab, "GameObject", where)) return;
          const prefab = objects.prefab(ref.prefab);
          if (!prefab.nodes.has(ref.path)) this.err(where, `node ${ref.path} not in ${ref.prefab}`);
        };
        for (const ref of [doc.overlayRoot, doc.layoutRoot, ...doc.openedSequences]) node(ref);
        if (doc.kind !== data.story.host?.kind) this.err(where, "kind differs from the episode host");
        if (doc.kind === "home") {
          if (!doc.home) { this.err(where, "home settings missing"); continue; }
          for (const key of ["background", "situation"]) C.prefab(doc.home[key], `${where} home.${key}`);
          for (const [key, names] of [["room", "rooms"], ["spot", "spots"]])
            if (!Object.values(data.parts[names] || {}).includes(doc.home.parts[key])) this.err(where, `home.parts.${key} not in story.parts.${names}`);
        } else if (!doc.afterlive) this.err(where, "afterlive settings missing");
        else { node(doc.afterlive.rewardPanel); node(doc.afterlive.backgroundImage); C.sprite(doc.afterlive.backgroundSprite, where); }
      }
    }
  }

  checkEpisode() {
    const d = this.data, e = d.episode, C = this.checks;
    const names = StoryPlayerCore.requiredCommands(e, d.playerSettings);
    const unsupported = e.master?._playbackMode === 1 ? simpleUnsupportedCommands(names)
      : names.filter((n) => !StoryPlayerCore.supportedCommands().includes(n));
    if (unsupported.length) this.err("episode.json", `unsupported commands: ${unsupported.join(", ")}`);
    if (e.master?._playbackMode === 1 && !d.simpleui) this.err("story.json", "Overlay episode requires parts.simpleui");
    if (d.story.host && !d.host) this.err("story.json", "episode host has no host product");
    for (const row of e.commands) if (!row.IgnoreData && row.cmd === "Character") {
      const address = `Character/Live2D/${row.TargetAssetName}`;
      if (!d.parts.models[address]) this.err("episode.json", `row ${row.i}: model ${address} not in parts.models`);
    }
    for (const [id, row] of Object.entries(e.sounds)) {
      const sheet = e.cuesheets[row._soundCueSheetID]?._cueSheetName;
      if (!sheet || !d.parts.sounds[sheet]) this.err("episode.json", `sound ${id}: cue sheet not in parts.sounds`);
    }
    for (const sheet of Object.keys(d.parts.sounds)) for (const error of S.sound(d.cues(sheet))) this.err(`cues.json ${sheet}`, error);
    for (const [sheet, path] of Object.entries(d.parts.sounds)) for (const [name, cue] of Object.entries(d.cues(sheet))) {
      const where = `${productDir(path)}/cues.json ${name}`;
      if (!Number.isInteger(cue.sampleRate) || !Number.isInteger(cue.samples) || !(cue.sampleRate > 0) || cue.samples < 0) { this.err(where, "invalid sampleRate/samples"); continue; }
      if (!Array.isArray(cue.categories) || cue.categories.some((c) => typeof c !== "string")) this.err(where, "categories must be an array of names");
      if ((cue.loopStart == null) !== (cue.loopEnd == null) || (cue.loopStart != null && !(cue.loopStart >= 0 && cue.loopStart < cue.loopEnd && cue.loopEnd <= cue.samples))) this.err(where, "loop points outside the waveform");
      if (cue.encoderDelay !== undefined && (extOf(cue.file) !== "m4a" || !Number.isInteger(cue.encoderDelay) || cue.encoderDelay < 0)) this.err(where, "invalid encoderDelay");
      if (!d.hasSounds) continue;
      if (!this.store.has(cue.file)) this.err(where, `${cue.file} missing`);
      else { const error = C.ofFile(`story-wave|${cue.sampleRate}|${cue.samples}|${cue.channels}`, cue.file, (b) => waveCheck(b, cue)); if (error) this.err(where, error); }
    }
    if (d.parts.crilips) {
      const { descriptor: desc, data } = d.crilips, floats = data.byteLength / 4;
      for (const error of S.crilips(desc)) this.err("crilips.json", error);
      if (desc.dtype !== "float32" || desc.order !== "LE") this.err("crilips.json", "expected float32 LE");
      if (floats !== desc.total_floats) this.err("crilips.bin", `length ${floats} differs from total_floats ${desc.total_floats}`);
      for (const block of desc.blocks || []) if (!Number.isInteger(block.offset) || !Number.isInteger(block.count) || block.offset < 0 || block.count < 0 || block.offset + block.count > floats)
        this.err("crilips.json", `block ${block.name} outside weights`);
      if (!Array.isArray(desc.blocks) || !isObj(desc.constants) || !isObj(desc.frontend)) this.err("crilips.json", "blocks/constants/frontend missing");
    }
    for (const [id, row] of Object.entries(e.videos)) if (row._assetName?.trim()) {
      try {
        const v = d.videoFor(id);
        for (const error of S.video(v)) this.err("video.json", error);
        if (!this.store.has(v.file)) this.err("video.json", `${v.file} missing`);
      } catch (error) { this.err("episode.json", error.message); }
    }
  }

  // The home camera contributes its pipeline's lighting keywords to the room and Spine materials at each quality.
  materialKeywords() {
    const data = this.data, objects = this.objectsView, result = new Map();
    if (data.host?.kind !== "home") return result;
    for (const name of ["room", "spot"]) {
      const doc = data.document(data.host.home.parts[name], `${name}.json`);
      for (const error of S[name](doc)) this.err(`${name}.json`, error);
    }
    const scene = new HomeScene(data, objects), home = data.host.home, graphics = data.scene.graphics;
    const hostManifest = this.partCache.get(Object.values(data.parts.host)[0]);
    // The host retains the prefab dependency graph. Only room renderers and selected UI subtrees are drawn.
    for (const [id, object] of Object.entries(hostManifest.objects)) if (object.class === "Material") result.set(id, []);
    const ui = new SimpleUIDoc(null, null, data.host, { objects, roots: hostUIRoots(data.host, objects) });
    for (const [id, material] of ui.uiMaterials) if (this.store.hasObject(id)) result.set(id, [material.keywords || []]);
    const materials = new Map(data.document(home.parts.room, "room.json").materialIds.map((id) => [id, objects.material(id)]));
    const spot = data.document(home.parts.spot, "spot.json");
    for (const c of spot.spineCharacters) if (c.skeletonData && c.animation && c.world)
      for (const m of scene.spine(c.path).pages.values()) materials.set(m.id, m);
    for (const quality of this.store.objectJson(graphics.quality).m_QualitySettings) {
      const pipeline = objects.mono(quality.customRenderPipeline || this.store.objectJson(graphics.graphics).m_CustomRenderPipeline);
      const renderer = objects.mono(pipeline.m_RendererDataList[0]);
      const lighting = spotLighting({ pipeline, renderer: { ...renderer, m_RendererFeatures: renderer.m_RendererFeatures.map((id) => objects.mono(id)) },
        renderSettings: scene.renderSettings, lights: scene.lights, lightmaps: scene.lightmaps });
      for (const [id, m] of materials) {
        if (!result.has(id)) result.set(id, []);
        result.get(id).push([...(m.keywords || []), ...lighting.keywords]);
      }
    }
    return result;
  }

  checkModels() {
    for (const [key, path] of Object.entries(this.data.parts.models)) {
      const id = key.split("/").at(-1), result = this.site.model(id, path);
      if (this.site.modelIds && !this.site.modelIds.has(id)) this.err(path, `model ${id} not in models.json`);
      for (const e of result.errs) this.err(path, e);
    }
  }

  checkFonts(fonts, ui) {
    const F = `${this.data.fontDir}/fonts.json`, C = this.checks, S = this.store;
    const schemaErrors = C.doc(F, SCHEMA_STORY_FONTS);
    if (!schemaErrors) return;
    if (fonts.language !== this.lang) this.err(F, `language ${fonts.language}`);
    const texts = new Map();
    for (const id of S.ids()) if (S.object(id).class === "GameObject") {
      const pf = S.prefab(id), file = id.slice(0, id.lastIndexOf(":"));
      for (const node of pf.nodes) for (const component of node.components)
        if (TMP_TEXT_CLASSES.has(classOf(component))) texts.set(`${file}:${component.pathId}`, component);
    }
    for (const [id, binding] of Object.entries(fonts.texts)) {
      if (!texts.has(id)) this.err(F, `text ${id} is not a TMP component of the story's prefabs`);
      const loc = binding.font;
      if (!has(fonts.fonts, loc.fontAsset)) this.err(F, `text ${id}: font asset ${loc.fontAsset} not in fonts`);
      if (!has(fonts.materials, loc.material)) this.err(F, `text ${id}: material ${loc.material} not in materials`);
      this.fallbackMaterials(F, loc, fonts);
    }
    for (const [name, tex] of Object.entries(fonts.textures)) {
      const path = `${this.data.fontDir}/${tex.texture}`;
      if (!S.has(path)) { this.err(F, `texture ${name}: ${path} missing`); continue; }
      const info = C.ofFile("png", path, (b) => { try { return pngInfo(b); } catch (e) { return { error: e.message }; } });
      if (info.error) this.err(path, info.error);
      else if (info.width !== tex.width || info.height !== tex.height || tex.mipCount !== 1) this.err(path, "glyph page dimensions/mip count differ from descriptor");
    }
    const shaderIndex = Object.entries(fonts.shaders).map(([name, id]) => ({ name, variants: S.objectJson(id, "index").variants.filter((v) => v.platform === "gles3" && v.type === "GLES3" && v.stage === "vertex") }));
    for (const [name, mat] of Object.entries(fonts.materials)) {
      if (!has(fonts.materialKeywords, name)) this.err(F, `material ${name}: no materialKeywords`);
      const selected = variantFor(shaderIndex, mat.shader.shader, fonts.materialKeywords[name] || []);
      if (selected.error) this.err(F, `material ${name}: ${selected.error}`);
      else if (!S.roles(fonts.shaders[mat.shader.shader]).includes(selected.variant.role)) this.err(F, `material ${name}: selected shader program missing`);
      else for (const error of C.ofObject("glsl", fonts.shaders[mat.shader.shader], selected.variant.role, (b) => glslStages(b.toString("utf8")))) this.err(F, `material ${name}: ${error}`);
    }
    for (const name of Object.keys(fonts.materialKeywords)) if (!has(fonts.materials, name)) this.err(F, `materialKeywords.${name}: not in materials`);
    const tmp = this.objectsView.mono(ui.settings.tmpSettings);
    for (const [name, font] of Object.entries(fonts.fonts)) {
      const where = `${F} fonts.${name}`;
      if (!has(fonts.materials, font.material)) this.err(where, `material ${font.material} not in materials`);
      for (const f of font.fallbacks) if (!has(fonts.fonts, f)) this.err(where, `fallback ${f} not in fonts`);
      if (font.fallbacks.includes(name) || new Set(font.fallbacks).size !== font.fallbacks.length) this.err(where, "fallbacks list the asset itself or an asset twice");
      for (const [u, char] of Object.entries(font.characters)) if (!has(font.glyphs, char.glyph)) this.err(where, `character ${u}: glyph ${char.glyph} not in glyphs`);
      this.glyphPages(where, font.glyphs, fonts.textures);
      if (font.missingGlyph) this.missingGlyph(where, font, { ...fonts, tmpSettings: tmp });
    }
    const substituted = [...new Set(Object.values(fonts.fonts).flatMap((f) => f.missingGlyph?.characters || []))].sort((a,b) => a-b).map((u) => String.fromCodePoint(u));
    if (!sameJson(fonts.coverage.missingGlyph || [], substituted)) this.err(F, "coverage.missingGlyph differs from the font assets' missingGlyph characters");
    for (const [name, asset] of Object.entries(fonts.spriteAssets || {})) {
      if (!has(fonts.materials, asset.material)) this.err(F, `sprite asset ${name}: material ${asset.material} not in materials`);
      else if (fonts.materials[asset.material].shader.shader !== TMP_SPRITE_SHADER) this.err(F, `sprite asset ${name}: material is not TextMeshPro/Sprite`);
      this.glyphPages(`${F} spriteAssets.${name}`, asset.glyphs, fonts.textures);
      for (const char of asset.characters) if (!has(asset.glyphs, char.glyph)) this.err(F, `sprite ${char.name}: glyph ${char.glyph} missing`);
    }
    for (const [id, binding] of Object.entries(fonts.sprites)) {
      if (!has(fonts.texts, id)) this.err(F, `sprites.${id}: no text binding`);
      if (!has(fonts.spriteAssets || {}, binding.spriteAsset) || binding.spriteAsset !== fonts.emojiSpriteAsset) this.err(F, `sprites.${id}: not the emoji sprite asset`);
      if (texts.has(id) && texts.get(id).fields.m_tintAllSprites === undefined) this.err(F, `sprites.${id}: TMP component has no m_tintAllSprites`);
    }
    if (fonts.coverage.sprites) {
      const all = Object.values(fonts.spriteAssets || {}).flatMap((a) => a.characters.map((c) => [c, a.glyphs[c.glyph]]));
      if (fonts.coverage.sprites.characters !== all.length) this.err(F, "coverage.sprites.characters differs from sprite assets");
      for (const name of fonts.coverage.sprites.missing) if (!all.some(([c,g]) => c.name === name && !g?.packed)) this.err(F, `coverage.sprites.missing: ${name} is not a missing sprite`);
    }
  }

  fallbackMaterials(F, loc, fj) {
    const f = fj.fonts[loc.fontAsset], m = fj.materials[loc.material];
    if (!isObj(f) || !isObj(m)) return;
    for (const fb of f.fallbacks) {
      const key = `${this.lang}|${F}|${loc.material}|${fb}`;
      if (this.fallbackSeen.has(key)) continue;
      this.fallbackSeen.add(key);
      const name = `${loc.material} + ${fb}`, x = fj.materials[name];
      const target = isObj(fj.fonts[fb]) ? fj.materials[fj.fonts[fb].material] : null;
      if (!isObj(x)) { this.err(F, `material ${name} (fallback ${fb} of ${loc.fontAsset}) not in materials`); continue; }
      if (!isObj(target)) continue;
      const bad = [];
      if (x.shader.shader !== m.shader.shader || !sameJson(x.keywords, m.keywords)) bad.push("shader / keywords");
      if (mainTexName(x) !== mainTexName(target)) bad.push("_MainTex");
      for (const k of ["_GradientScale", "_WeightNormal", "_WeightBold"]) if (x.floats[k] !== target.floats[k]) bad.push(k);
      for (const k of new Set([...Object.keys(m.floats), ...Object.keys(x.floats)]))
        if (!FALLBACK_OWN.has(k) && x.floats[k] !== m.floats[k]) bad.push(k);
      const r = scaleRatios(x.floats, x.keywords);
      if (r && x.floats._ScaleRatioA !== r.a) bad.push("_ScaleRatioA");
      if (r && r.c !== null && x.floats._ScaleRatioC !== r.c) bad.push("_ScaleRatioC");
      if (bad.length) this.err(F, `material ${name}: ${bad.join(", ")} not as GetFallbackMaterial(${loc.material}, ${fj.fonts[fb].material}) gives`);
    }
  }

  // glyph records (font or sprite asset) against the glyph pages: a rect with texels has `packed`, whose page is in
  // `textures`, and the rect + offset lies inside the page; at most 5 errors per asset
  glyphPages(where, glyphs, textures) {
    let bad = 0;
    for (const [gi, g] of Object.entries(glyphs)) {
      if (!has(g, "packed")) {
        if (g.rect.m_Width > 0 && g.rect.m_Height > 0 && bad++ < 5) this.err(where, `glyph ${gi}: a rect without packed texels`);
        continue;
      }
      const t = textures[g.packed.texture];
      if (!t) { if (bad++ < 5) this.err(where, `glyph ${gi}: page ${g.packed.texture} not in textures`); continue; }
      const x = g.rect.m_X + g.packed.dx, y = g.rect.m_Y + g.packed.dy;
      if (x < 0 || y < 0 || x + g.rect.m_Width > t.width || y + g.rect.m_Height > t.height)
        if (bad++ < 5) this.err(where, `glyph ${gi}: rect + offset leaves page ${g.packed.texture} (${t.width}x${t.height})`);
    }
  }

  // a font asset's missingGlyph: `characters` ascending, held neither by the asset nor by its fallbacks; `unicode`
  // held by the asset or a fallback (U+0003 is synthesized); with the game's TMP settings, `unicode` is the first of
  // the settings' missing glyph character, U+0020 and U+0003 that the asset or a fallback holds
  missingGlyph(where, f, fj) {
    const { unicode, characters } = f.missingGlyph;
    const chain = [f, ...f.fallbacks.map((n) => fj.fonts[n]).filter(isObj)];
    const holds = (u) => u === TMP_END_OF_TEXT || chain.some((a) => has(a.characters, String(u)));
    if (characters.some((u, i) => i > 0 && u <= characters[i - 1])) this.err(where, "missingGlyph.characters not ascending");
    const held = characters.filter(holds);
    if (held.length) this.err(where, `missingGlyph.characters ${held.slice(0, 5).map(hexU).join(" ")} held by the asset or its fallbacks`);
    if (!holds(unicode)) this.err(where, `missingGlyph.unicode ${hexU(unicode)} held by neither the asset nor its fallbacks`);
    const tmp = fj.tmpSettings;
    if (isObj(tmp) && Number.isInteger(tmp.m_missingGlyphCharacter)) {
      const want = [tmp.m_missingGlyphCharacter || TMP_MISSING_GLYPH, TMP_SPACE, TMP_END_OF_TEXT].find(holds);
      if (unicode !== want) this.err(where, `missingGlyph.unicode ${hexU(unicode)}, TextMeshPro draws ${hexU(want)}`);
    }
  }

}

// ------------------------------------------------------------------------------------------------ main
// charts.json (or stories.json: list `stories`, name "stories.json") beyond its schema: ids per region, the regions
// and languages the entries name.
function indexErrors(index, list = index.charts, name = "charts.json") {
  const out = [];
  const byId = new Map();
  for (const e of list) byId.set(e.id, [...(byId.get(e.id) || []), e]);
  for (const [id, es] of byId) {
    if (es.length < 2) continue;
    if (es.some((e) => !Array.isArray(e.regions))) { out.push(`${name}: id ${id} twice`); continue; }
    const seen = new Set();
    for (const r of es.flatMap((e) => e.regions)) {
      if (seen.has(r)) out.push(`${name}: id ${id} twice in region ${r}`);
      seen.add(r);
    }
  }
  if (Array.isArray(index.regions)) {
    const known = new Set(index.regions.map((r) => r.id));
    if (known.size !== index.regions.length) out.push(`${name}: a region id twice in regions`);
    for (const e of list) for (const r of e.regions || [])
      if (!known.has(r)) out.push(`${name}: ${e.manifest}: region ${r} not in regions`);
  }
  if (Array.isArray(index.languages)) {
    const known = new Set(index.languages);
    for (const e of list) for (const l of Object.keys(e.titles || {}))
      if (!known.has(l)) out.push(`${name}: ${e.manifest}: title language ${l} not in languages`);
  }
  return out;
}

// stories.json beyond indexErrors: every entry's languages among `languages`, the default language one of them
function storyIndexErrors(index) {
  const out = indexErrors(index, index.stories, "stories.json");
  if (Array.isArray(index.languages)) {
    const known = new Set(index.languages);
    for (const e of index.stories) for (const l of e.languages)
      if (!known.has(l)) out.push(`stories.json: ${e.manifest}: language ${l} not in languages`);
    if (has(index, "language") && !known.has(index.language)) out.push(`stories.json: language ${index.language} not in languages`);
  }
  return out;
}

const storyId = (manifest) => manifest.replace(/^stories\//, "").replace(/\.json$/, "");

// run one kind of manifest: prints the failures, returns the number valid. Models run once (Site.model: the stories
// that use a model share its result), their models.json entries checked beside.
function runAll(site, list, Kind) {
  let ok = 0;
  for (const { id, manifest, entry } of list) {
    let errs;
    if (Kind === Model) {
      const r = site.model(id, manifest);
      errs = !r.model ? [`${manifest}: ${r.errs[0]}`] : entry ? [...r.model.entryErrors(entry), ...r.errs] : r.errs;
    } else {
      try {
        const man = JSON.parse(fs.readFileSync(site.file(manifest), "utf8"));
        const Reader = Kind === Chart && man.schema === "nnnotes.product/1" ? Live : Kind;
        errs = new Reader(site, id, man, manifest).run(entry);
      } catch (e) { errs = [`${manifest}: ${e.message}`]; }
    }
    if (errs.length) {
      console.log(`FAIL ${id}`);
      for (const e of errs.slice(0, 30)) console.log(`  ${e}`);
      if (errs.length > 30) console.log(`  ... ${errs.length - 30} more`);
    } else ok++;
  }
  return ok;
}

function main(argv) {
  const [dir, ...args] = argv, only = [], languages = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lang") languages.push(...String(args[++i] || "").split(","));
    else if (args[i].startsWith("--lang=")) languages.push(...args[i].slice(7).split(","));
    else only.push(args[i]);
  }
  if (languages.some((lang) => !Object.hasOwn(STORY_LANGUAGES, lang))) { console.error("--lang: unknown story language"); return 2; }
  if (!dir) { console.error("usage: node scripts/validate-data.mjs <site dir> [live id | chart id | model id | story id ...]"); return 2; }
  const site = new Site(dir);
  site.storyLanguages = languages.length ? [...new Set(languages)] : null;
  const out = [];
  let entries;
  const indexPath = site.file("charts.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const errs = S.charts(index);
    if (errs.length) { console.log("FAIL charts.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    out.push(...indexErrors(index));
    entries = index.charts.map((e) => ({ id: e.id, manifest: e.manifest, entry: e }));
  } else if (fs.existsSync(site.file("charts"))) {
    // charts/<id>.json, then the region manifests charts/<region>/<id>.json
    const list = (dir) => fs.readdirSync(site.file(dir), { withFileTypes: true });
    const files = (dir) => list(dir).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name).sort()
      .map((f) => ({ id: f.slice(0, -5), manifest: `${dir}/${f}`, entry: null }));
    entries = [...files("charts"), ...list("charts").filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .flatMap((r) => files(`charts/${r}`))];
  } else entries = [];
  // lives/<musicId>_<difficulty>[_<band>].json of a product layout
  const lives = !fs.existsSync(site.file("lives")) ? [] : fs.readdirSync(site.file("lives")).filter((f) => f.endsWith(".json")).sort()
    .map((f) => ({ id: f.slice(0, -5), manifest: `lives/${f}`, entry: null }));
  let models = [];
  const modelsPath = site.file("models.json");
  if (fs.existsSync(modelsPath)) {
    const index = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    const errs = S.models(index);
    if (errs.length) { console.log("FAIL models.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    const ids = new Set();
    for (const e of index.models) { if (ids.has(e.id)) out.push(`models.json: id ${e.id} twice`); ids.add(e.id); }
    models = index.models.map((e) => ({ id: e.id, manifest: e.manifest, entry: e }));
    site.modelIds = ids;
  } else if (fs.existsSync(site.file("models"))) {
    models = fs.readdirSync(site.file("models")).filter((f) => f.endsWith(".json")).sort()
      .map((f) => ({ id: f.slice(0, -5), manifest: `models/${f}`, entry: null }));
  }
  let stories = [];
  const storiesPath = site.file("stories.json");
  if (fs.existsSync(storiesPath)) {
    const index = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
    const errs = S.stories(index);
    if (errs.length) { console.log("FAIL stories.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    out.push(...storyIndexErrors(index));
    stories = index.stories.map((e) => ({ id: storyId(e.manifest), manifest: e.manifest, entry: e }));
  } else if (fs.existsSync(site.file("stories"))) {
    // stories/<advId>.json, then the region manifests stories/<region>/<advId>.json
    const list = (dir) => fs.readdirSync(site.file(dir), { withFileTypes: true });
    const files = (dir) => list(dir).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name).sort()
      .map((f) => ({ id: storyId(`${dir}/${f}`), manifest: `${dir}/${f}`, entry: null }));
    stories = [...files("stories"), ...list("stories").filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .flatMap((r) => files(`stories/${r}`))];
  }
  let uiPacks = !fs.existsSync(site.file("uipacks")) ? [] : fs.readdirSync(site.file("uipacks")).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ id: f.slice(0, -5), manifest: `uipacks/${f}`, entry: null }));
  if (fs.existsSync(site.file("index.json"))) {
    const index = JSON.parse(fs.readFileSync(site.file("index.json"), "utf8"));
    if (index.format === "nnnotes.ui-library/1") {
      site.uiIndex = index;
      out.push(...S.uiLibrary(index).map(e => `index.json: ${e}`));
      if (!out.length) {
        for (const group of [index.assets, index.embedded, index.controllers]) {
          const ids = new Set();
          for (const entry of group) {
            if (ids.has(entry.id)) out.push(`index.json: duplicate id ${entry.id}`);
            ids.add(entry.id);
            if (!uiPacks.some(p => p.manifest === entry.manifest)) out.push(`index.json: missing product ${entry.manifest}`);
          }
        }
        uiPacks = uiPacks.map(p => ({ ...p, entry: index.assets.find(e => e.manifest === p.manifest) || null }));
      }
    }
  }
  let liveList = lives;
  if (only.length) {
    const want = new Set(only), kinds = `${lives.length ? "live, " : ""}chart, model${stories.length ? " or story" : ""}`;
    uiPacks = uiPacks.filter(e => want.has(e.id));
    liveList = lives.filter((e) => want.has(e.id));
    entries = entries.filter((e) => want.has(e.id));
    models = models.filter((e) => want.has(e.id));
    stories = stories.filter((e) => want.has(e.id));
    for (const id of want)
      if (![liveList, entries, models, stories, uiPacks].some((l) => l.some((e) => e.id === id))) { console.error(`${kinds} ${id} not found`); return 2; }
  }
  const okUI = runAll(site, uiPacks, UI);
  const okLives = runAll(site, liveList, Live);
  const ok = runAll(site, entries, Chart);
  const okModels = runAll(site, models, Model);
  const okStories = runAll(site, stories, Story);
  for (const e of out) console.log(e);
  if (uiPacks.length) console.log(`${okUI}/${uiPacks.length} UI products valid`);
  if (liveList.length) console.log(`${okLives}/${liveList.length} lives valid`);
  if (entries.length || (!liveList.length && !models.length && !stories.length && !uiPacks.length)) console.log(`${ok}/${entries.length} charts valid`);
  if (models.length) console.log(`${okModels}/${models.length} models valid`);
  if (stories.length) console.log(`${okStories}/${stories.length} stories valid${site.storyLanguages ? ` (languages: ${site.storyLanguages.join(", ")})` : ""}`);
  return okUI === uiPacks.length && okLives === liveList.length && ok === entries.length && okModels === models.length && okStories === stories.length
    && !out.length ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
