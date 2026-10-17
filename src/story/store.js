import { AssetStore, PRODUCT_MANIFEST, decodeAsset } from "../data/assets.js";
import { isProduct, mergeProductManifests, productDir } from "../data/products.js";
import { ADV_PLAYBACK_MODE, StoryCommandError } from "./interfaces.js";
import { StoryPlayerCore } from "./player-core.js";
import { STORY_LANGUAGES } from "./params.js";
import { simpleUnsupportedCommands } from "./simple/validator.js";
import "./features/index.js";

export const STORY_PRODUCT = "story";
const SINGLE_PARTS = { scene: "story.scene", chat: "story.chat", crilips: "story.crilips" };
const MAPPED_PARTS = { assets: "story.asset", models: "live2d.model", sounds: "story.sound", videos: "story.video",
  host: "story.host", spots: "spot.files", rooms: "room.gltf" };
const LANGUAGE_PARTS = { ui: "story.ui", fonts: "story.fonts", simpleui: "story.simpleui" };
const here = () => globalThis.document?.baseURI || globalThis.location?.href;

const cachedFetch = (fetch) => {
  const requests = new Map();
  return async (url, init) => {
    const key = String(url);
    if (!requests.has(key)) requests.set(key, (async () => {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    })().catch((error) => { requests.delete(key); throw error; }));
    return new Response(await requests.get(key));
  };
};

// Read the index and episode before fetching dependent products, so unsupported commands fail early.
export const fetchStoryProduct = async (url, { fetch = globalThis.fetch, signal = null, base = null,
                                              decode = decodeAsset } = {}) => {
  if (!url) throw new Error("no story manifest URL");
  if (typeof fetch !== "function") throw new Error("no fetch function");
  const href = new URL(String(url), here()).href;
  const get = cachedFetch(fetch);
  signal?.throwIfAborted();
  const manifest = await (await get(href, signal ? { signal } : undefined)).json();
  if (!isProduct(manifest, STORY_PRODUCT)) throw new Error(`${href}: not a story product (${PRODUCT_MANIFEST})`);
  const root = base ? new URL(String(base), here()).href : new URL(manifest.root || "../", href).href;
  const files = Object.fromEntries(["story.json", "episode.json"].map((name) => {
    if (!manifest.files[name]) throw new Error(`${href}: missing ${name}`);
    return [name, manifest.files[name]];
  }));
  const head = await AssetStore.fromManifest(href, { fetch: (u, init) => String(u) === href
    ? Promise.resolve(new Response(JSON.stringify({ files, objects: {} }))) : get(u, init),
    signal, base: root, decode });
  const story = head.json("story.json"), episode = head.json("episode.json");
  if (story?.format !== 1 || !story.parts || String(story.advId) !== manifest.subject || episode.advId !== story.advId)
    throw new Error(`${href}: story index and episode do not match the product subject`);
  const commands = StoryPlayerCore.requiredCommands(episode, { _initializeEpisodes: [], _finalizeEpisodes: [] });
  const overlay = episode.master?._playbackMode === ADV_PLAYBACK_MODE.Overlay;
  const unsupported = overlay ? simpleUnsupportedCommands(commands)
    : commands.filter((name) => !StoryPlayerCore.supportedCommands().includes(name));
  if (unsupported.length) throw new StoryCommandError(`story ${story.advId}: commands not supported by this player: ${unsupported.join(", ")}`);
  return { url: href, manifest, root, story, episode, fetch: get };
};

// The product identities required for one language of a story index.
export const storyPartRequests = (story, language) => {
  const parts = story.parts, wanted = new Map();
  const add = (path, product, subject = null) => {
    productDir(path);
    const existing = wanted.get(path);
    if (existing && (existing.product !== product || existing.subject !== subject))
      throw new Error(`${path}: conflicting story part identities`);
    wanted.set(path, { product, subject });
  };
  for (const [part, product] of Object.entries(SINGLE_PARTS)) {
    if (part === "scene" && !parts[part]) throw new Error("story index has no scene part");
    if (parts[part]) add(parts[part], product, "default");
  }
  for (const [part, product] of Object.entries(MAPPED_PARTS))
    for (const [subject, path] of Object.entries(parts[part] || {})) add(path, product, subject);
  for (const [part, product] of Object.entries(LANGUAGE_PARTS)) {
    if (part === "simpleui" && !parts[part]) continue;
    const path = parts[part]?.[language];
    if (typeof path !== "string") throw new Error(`story ${story.advId}: no ${part} for language ${language}`);
    add(path, product, part === "fonts" ? `${story.advId}/${language}` : language);
  }
  return wanted;
};

// Each product's files live under its manifest directory; all object roles share one AssetStore table.
export const loadStoryProducts = async (url, { lang = null, fetch = globalThis.fetch, signal = null,
  base = null, decode = decodeAsset, concurrency, onProgress = null, head = null } = {}) => {
  const first = head || await fetchStoryProduct(url, { fetch, signal, base, decode });
  const language = lang || first.manifest.language;
  if (!language) throw new Error("a story language is required (lang)");
  const wanted = storyPartRequests(first.story, language);
  const loaded = await Promise.all([...wanted].map(async ([path, identity]) => {
    signal?.throwIfAborted();
    const href = new URL(path, first.root).href;
    const manifest = await (await first.fetch(href, signal ? { signal } : undefined)).json();
    if (!isProduct(manifest, identity.product) || manifest.subject !== identity.subject)
      throw new Error(`${href}: expected ${identity.product} product of ${identity.subject}`);
    return [productDir(path), manifest];
  }));
  const dir = productDir(`stories/${first.story.advId}.json`);
  const manifest = mergeProductManifests([[dir, first.manifest], ...loaded]);
  manifest.loadedLanguage = language;
  manifest.language = language;
  manifest.languages = Object.fromEntries(Object.keys(first.story.parts.ui || {}).map((code) => [code, {}]));
  manifest.advId = first.story.advId;
  const titles = Object.fromEntries(Object.entries(STORY_LANGUAGES)
    .filter(([, field]) => typeof first.episode.title?.[field] === "string" && first.episode.title[field])
    .map(([code, field]) => [code, first.episode.title[field]]));
  manifest.story = { advId: first.story.advId, playbackMode: first.episode.master?._playbackMode || 0, titles };
  return AssetStore.fromManifest(first.url, { fetch: (u, init) => String(u) === first.url
    ? Promise.resolve(new Response(JSON.stringify(manifest))) : first.fetch(u, init), signal, decode, concurrency,
    onProgress, base: first.root });
};
