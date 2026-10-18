import { AssetStore, PRODUCT_MANIFEST, decodeAsset } from "../data/assets.js";
import { isProduct, mergeProductManifests, productDir } from "../data/products.js";
export { productDir } from "../data/products.js";

// Loading a live: the product manifest of the live (lives/<musicId>_<difficulty>.json, the `live` product of nnnotes'
// product layout), the manifests of the products its live.json `parts` names, and any further products of note skins,
// note effect sets and note sound sets a page offers (`variants`). The store holds every product's files under the
// product's directory, its manifest path without ".json" (lives/100001_expert/live.json, scenes/default/scene.json,
// sounds/default/audio/LiveSe/<file>.flac, ...), and the objects of all of them in one table.

export const LIVE_PRODUCT = "live";
// the part of a live (live.json `parts`) -> the product it is
export const LIVE_PARTS = Object.freeze({
  scene: "live.scene", notes: "live.notes", noteskin: "live.noteskin", noteeffect: "live.noteeffect",
  sounds: "live.sounds", music: "live.music",
});
// the products a page may offer besides the parts: other note skins, note effect sets and note sound sets
export const LIVE_VARIANTS = Object.freeze(["live.noteskin", "live.noteeffect", "live.sounds"]);

const here = () => (globalThis.document ? globalThis.document.baseURI : globalThis.location ? globalThis.location.href : undefined);

// A chart manifest of the site layout (docs/data-format.md "Chart manifest"): no `schema`, a `live.json` file. Its
// store is read through legacy.js.
export const isChartManifest = (m) => !!m && m.schema === undefined && !!m.files && !!m.files["live.json"];

// The store of the live at `url`: a live product manifest, or a chart manifest (its files as they are; ChartSession
// reads them through legacy.js). `variants`: manifest paths (relative to `base`) of further products of LIVE_VARIANTS.
// `base`: the root the manifest and asset paths are relative to (default: the directory above the manifest's).
// `fetch`, `signal`, `onProgress`, `decode`, `concurrency`: as AssetStore.fromManifest. The store's `info` is the live
// manifest without its file lists, plus `dir` (the live's directory) and `products` ({product: {subject: directory}}
// of every product loaded, the live included).
export const loadLiveStore = async (url, { variants = [], fetch = globalThis.fetch, signal = null, onProgress = null,
                                          base = null, decode = decodeAsset, concurrency } = {}) => {
  if (!url) throw new Error("no live manifest URL");
  if (typeof fetch !== "function") throw new Error("no fetch function");
  const href = new URL(String(url), here()).href;
  const getJson = async (u) => {
    if (signal) signal.throwIfAborted();
    const r = await fetch(u, signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.json();
  };
  const man = await getJson(href);
  const serve = (doc) => (u, init) => (String(u) === href
    ? Promise.resolve(new Response(JSON.stringify(doc), { headers: { "content-type": "application/json" } }))
    : fetch(u, init));
  const opts = { signal, decode, concurrency };
  if (isChartManifest(man)) {
    if (variants.length) throw new Error(`${href}: a chart manifest has no variant products`);
    return AssetStore.fromManifest(href, { ...opts, fetch: serve(man), base, onProgress });
  }
  if (!isProduct(man, LIVE_PRODUCT)) throw new Error(`${href}: not a live manifest (${PRODUCT_MANIFEST} of ${LIVE_PRODUCT})`);
  const root = base ? new URL(String(base), here()) : new URL(man.root || "../", href);
  if (!href.startsWith(root.href)) throw new Error(`${href}: not under the root ${root.href}`);
  const liveDir = productDir(href.slice(root.href.length));
  // live.json names the parts: read it first (through fromManifest, which decodes and checks it)
  const head = await AssetStore.fromManifest(href, { ...opts, base: root.href,
    fetch: serve({ files: { "live.json": man.files["live.json"] } }) });
  const live = head.json("live.json");
  if (!live || !live.parts || typeof live.parts !== "object") throw new Error(`${href}: live.json without parts`);
  const wanted = [];                                       // [manifest path, the products it may be]
  for (const [part, product] of Object.entries(LIVE_PARTS)) {
    if (typeof live.parts[part] !== "string") throw new Error(`${href}: live.json names no ${part} part`);
    wanted.push([live.parts[part], [product]]);
  }
  for (const p of new Set([...(man.variants || []), ...variants])) wanted.push([String(p), LIVE_VARIANTS]);
  const loaded = await Promise.all(wanted.map(async ([p, products]) => {
    const u = new URL(p, root).href, m = await getJson(u);
    if (!products.some((x) => isProduct(m, x)))
      throw new Error(`${u}: not a manifest of ${products.join(" or ")}`);
    return [productDir(p), m];
  }));
  return AssetStore.fromManifest(href, { ...opts, fetch: serve(liveManifest([[liveDir, man], ...loaded])),
                                        base: root.href, onProgress });
};

// The manifest of a live's store from the manifests of its products, [[directory, manifest], ...] with the live's
// first: the live manifest without its file lists, `dir` and `products` (as the store's `info` of loadLiveStore), every
// product's files under its directory and the objects of all of them in one table (an object in several manifests
// must be the same in each).
export const liveManifest = mergeProductManifests;
