import { AssetStore, decodeAsset } from "../data/assets.js";
import { ADV_PLAYBACK_MODE, StoryCommandError } from "./interfaces.js";
import { StoryPlayerCore } from "./player-core.js";
import { simpleUnsupportedCommands } from "./simple/validator.js";

// Loading a story from a site: the story manifest (stories/<advId>.json, stories/<region>/<advId>.json) and the files
// of one language; with manifest format /2 also the manifests of the Live2D models it uses (models/<id>.json).

// the current story manifest format, and the formats this player reads: /2 (the models in model manifests of the
// site) and /1 (the models' files among the story's own)
export const STORY_MANIFEST_FORMAT = "ournotes.story-manifest/2";
export const STORY_MANIFEST_FORMATS = Object.freeze(["ournotes.story-manifest/1", STORY_MANIFEST_FORMAT]);
// the model manifest formats this player reads
export const MODEL_MANIFEST_FORMATS = Object.freeze([2, 3]);

const here = () => (globalThis.document ? globalThis.document.baseURI : globalThis.location ? globalThis.location.href : undefined);

const checkFormat = (man, href) => {
  if (!man || !STORY_MANIFEST_FORMATS.includes(man.format))
    throw new Error(`${href}: not a story manifest (${STORY_MANIFEST_FORMATS.join(" or ")})`);
};

// Fetches a story manifest. Refuses (StoryCommandError) a story whose commands this player lacks, before any other
// file is fetched: an Overlay episode (playbackMode 1) against the simple player's set (simple/validator.js), any
// other against the command registry.
export const fetchStoryManifest = async (url, { fetch = globalThis.fetch, signal = null } = {}) => {
  if (!url) throw new Error("no story manifest URL");
  if (typeof fetch !== "function") throw new Error("no fetch function");
  const href = new URL(String(url), here()).href;
  const r = await fetch(href, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`${href}: HTTP ${r.status}`);
  const man = await r.json();
  checkFormat(man, href);
  const commands = (man.requires && man.requires.commands) || [];
  const overlay = !!man.story && man.story.playbackMode === ADV_PLAYBACK_MODE.Overlay;
  const missing = overlay ? simpleUnsupportedCommands(commands)
    : commands.filter((c) => !StoryPlayerCore.supportedCommands().includes(c));
  if (missing.length)
    throw new StoryCommandError(`story ${man.advId}: commands not supported by this player: ${missing.join(", ")}`);
  return { url: href, manifest: man };
};

// The AssetStore of one language of a story: the manifest's common files and the language group's files; with format
// /2 also, under live2d/<id>/, the files of every model the manifest lists (their manifests fetched in parallel).
// `lang` defaults to the manifest's language. The store's `info` is the manifest without its file lists, plus
// `loadedLanguage`.
// `base`: the site root the asset and model manifest paths are relative to (default: format /2, the manifest's
// `root`, relative to the manifest; format /1, the directory above the manifest's directory). `decode`,
// `concurrency`: as AssetStore.fromManifest.
export const loadStoryStore = async (url, { lang = null, fetch = globalThis.fetch, signal = null, onProgress = null,
                                            manifest = null, base = null, decode = decodeAsset, concurrency } = {}) => {
  const m = manifest || await fetchStoryManifest(url, { fetch, signal });
  const man = m.manifest, language = lang || man.language;
  checkFormat(man, m.url);
  const sited = man.format === STORY_MANIFEST_FORMAT;          // the models in model manifests of the site
  if (sited && (typeof man.root !== "string" || !man.models || typeof man.models !== "object"))
    throw new Error(`${m.url}: a story manifest without root / models`);
  if (!man.languages || !man.languages[language])
    throw new Error(`story ${man.advId}: no language ${language} (${Object.keys(man.languages || {}).join(", ")})`);
  const root = base ? new URL(String(base), here()) : new URL(sited ? man.root : "../", m.url);
  const files = { ...man.files, ...man.languages[language].files };
  if (sited) {
    const models = await Promise.all(Object.entries(man.models).map(async ([id, p]) => {
      const u = new URL(p, root).href;
      if (signal) signal.throwIfAborted();
      const r = await fetch(u, signal ? { signal } : undefined);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      const mm = await r.json();
      if (!mm || !MODEL_MANIFEST_FORMATS.includes(mm.format) || !mm.files || typeof mm.files !== "object")
        throw new Error(`${u}: not a model manifest (format ${MODEL_MANIFEST_FORMATS.join(" or ")})`);
      if (mm.id !== undefined && mm.id !== id) throw new Error(`${u}: model ${mm.id}, the story names it ${id}`);
      return [id, mm.files];
    }));
    for (const p of Object.keys(files))
      if (p.startsWith("live2d/")) throw new Error(`story ${man.advId}: ${p}: live2d/ holds the models' files`);
    for (const [id, mf] of models) for (const [p, f] of Object.entries(mf)) files[`live2d/${id}/${p}`] = f;
  }
  const merged = { ...man, loadedLanguage: language, files };
  delete merged.languages;
  merged.languages = Object.fromEntries(Object.keys(man.languages).map((k) => [k, {}]));   // the codes only
  const inner = (u, init) => (String(u) === m.url
    ? Promise.resolve(new Response(JSON.stringify(merged), { headers: { "content-type": "application/json" } }))
    : fetch(u, init));
  return AssetStore.fromManifest(m.url, { fetch: inner, signal, onProgress, base: root.href, decode, concurrency });
};
