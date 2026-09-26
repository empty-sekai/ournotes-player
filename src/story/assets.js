import { AssetStore } from "../data/assets.js";
import { ADV_PLAYBACK_MODE, StoryCommandError } from "./interfaces.js";
import { StoryPlayerCore } from "./player-core.js";
import { simpleUnsupportedCommands } from "./simple/validator.js";

// Loading a story from a site: the story manifest (stories/<advId>.json) and the files of one language.

export const STORY_MANIFEST_FORMAT = "ournotes.story-manifest/1";

// Fetches a story manifest. Refuses (StoryCommandError) a story whose commands this player lacks, before any other
// file is fetched: an Overlay episode (playbackMode 1) against the simple player's set (simple/validator.js), any
// other against the command registry.
export const fetchStoryManifest = async (url, { fetch = globalThis.fetch, signal = null } = {}) => {
  if (!url) throw new Error("no story manifest URL");
  if (typeof fetch !== "function") throw new Error("no fetch function");
  const here = globalThis.document ? globalThis.document.baseURI : globalThis.location ? globalThis.location.href : undefined;
  const href = new URL(String(url), here).href;
  const r = await fetch(href, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`${href}: HTTP ${r.status}`);
  const man = await r.json();
  if (!man || man.format !== STORY_MANIFEST_FORMAT) throw new Error(`${href}: not a story manifest (${STORY_MANIFEST_FORMAT})`);
  const commands = (man.requires && man.requires.commands) || [];
  const overlay = !!man.story && man.story.playbackMode === ADV_PLAYBACK_MODE.Overlay;
  const missing = overlay ? simpleUnsupportedCommands(commands)
    : commands.filter((c) => !StoryPlayerCore.supportedCommands().includes(c));
  if (missing.length)
    throw new StoryCommandError(`story ${man.advId}: commands not supported by this player: ${missing.join(", ")}`);
  return { url: href, manifest: man };
};

// The AssetStore of one language of a story: the manifest's common files and the language group's files. `lang`
// defaults to the manifest's language. The store's `info` is the manifest without its file lists, plus
// `loadedLanguage`.
// `base`: the site root the asset paths are relative to (default: the directory above the manifest's directory).
export const loadStoryStore = async (url, { lang = null, fetch = globalThis.fetch, signal = null, onProgress = null,
                                            manifest = null, base = null } = {}) => {
  const m = manifest || await fetchStoryManifest(url, { fetch, signal });
  const man = m.manifest, language = lang || man.language;
  if (!man.languages || !man.languages[language])
    throw new Error(`story ${man.advId}: no language ${language} (${Object.keys(man.languages || {}).join(", ")})`);
  const merged = { ...man, loadedLanguage: language, files: { ...man.files, ...man.languages[language].files } };
  delete merged.languages;
  merged.languages = Object.fromEntries(Object.keys(man.languages).map((k) => [k, {}]));   // the codes only
  const inner = (u, init) => (String(u) === m.url
    ? Promise.resolve(new Response(JSON.stringify(merged), { headers: { "content-type": "application/json" } }))
    : fetch(u, init));
  return AssetStore.fromManifest(m.url, { fetch: inner, signal, onProgress, base });
};
