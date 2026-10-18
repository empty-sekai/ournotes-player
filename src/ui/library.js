import { UIPack, UI_LIBRARY } from './objects.js';
const defaultFetch = (...args) => globalThis.fetch(...args);

export class UILibrary {
  static async load(src, { fetch = defaultFetch, signal } = {}) {
    const url = new URL(src, globalThis.document?.baseURI), response = await fetch(url.href, { signal });
    if (!response.ok) throw Error(`UI library: ${response.status} ${url}`);
    return new UILibrary(await response.json(), new URL('.', url).href, fetch);
  }

  constructor(index, baseURL, fetch = defaultFetch) {
    if (index.format !== UI_LIBRARY || !['assets','embedded','controllers'].every(k => Array.isArray(index[k]))) throw Error(`UI library: expected ${UI_LIBRARY}`);
    this.index = index; this.baseURL = baseURL; this.fetcher = (...args) => fetch(...args); this.cache = new Map();
    this.entries = [...index.assets, ...index.embedded];
    this.controllers = index.controllers;
  }

  find(key) {
    if (key && typeof key === 'object' && key.manifest) return key;
    const exact = this.entries.filter(e => e.id === key || e.key === key);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw Error('Ambiguous UI entry: ' + key);
    const named = this.entries.filter(e => e.name === key);
    if (named.length === 1) return named[0];
    throw Error((named.length > 1 ? 'Ambiguous UI entry: ' : 'UI entry not found: ') + key);
  }

  async loadPack(entry, { signal } = {}) {
    entry = this.find(entry);
    const url = new URL(entry.manifest, this.baseURL).href;
    const request = () => UIPack.load(url, { fetch: this.fetcher, signal });
    if (!signal && !this.cache.has(url)) this.cache.set(url, request().catch(error => { this.cache.delete(url); throw error; }));
    const source = await (signal ? request() : this.cache.get(url));
    return { pack: new UIPack(source.store, source.ui, entry.roots), assetBase: this.baseURL, entry };
  }

  async loadController(pack, nodeIndex) { return pack.controller(nodeIndex); }
}
