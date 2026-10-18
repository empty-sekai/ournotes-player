import { AssetStore } from '../data/assets.js';
import { ObjectResources } from '../engine/objects.js';
import { componentClass } from '../engine/prefab.js';

export const UI_PRODUCT = 'ui.pack';
export const UI_FORMAT = 'nnnotes.ui-pack/1';
export const UI_LIBRARY = 'nnnotes.ui-library/1';

// A UI preview owns mutable native prefab nodes and shares the immutable product objects.
export class UIPack {
  static async load(url, { fetch = globalThis.fetch, signal, roots, decode } = {}) {
    signal?.throwIfAborted();
    const href = new URL(url, globalThis.document?.baseURI).href;
    const response = await fetch(href, { signal });
    if (!response.ok) throw Error(`UI product: ${response.status} ${href}`);
    const manifest = await response.json();
    if (manifest.schema !== 'nnnotes.product/1' || manifest.product !== UI_PRODUCT)
      throw Error(`UI product: expected ${UI_PRODUCT}`);
    const store = await AssetStore.fromManifest(href, { fetch: (u, options) => String(u) === href
      ? Promise.resolve(new Response(JSON.stringify(manifest))) : fetch(u, options),
      signal, decode, base: new URL(manifest.root || '../', href).href });
    return new UIPack(store, store.json('ui.json'), roots);
  }

  constructor(store, ui, roots = ui.roots) {
    if (ui.format !== UI_FORMAT) throw Error(`UI document: expected ${UI_FORMAT}`);
    this.store = store; this.ui = ui; this.roots = roots.slice();
    this.objects = new ObjectResources(store, { bindings: [ui.bindings], shaders: ui.shaders });
    this.nodes = this.roots.filter(id => store.object(id).class === 'GameObject').flatMap(id => {
      const file = id.slice(0, id.lastIndexOf(':'));
      return structuredClone(store.prefab(id).nodes).map(n => ({ ...n, prefabId: id, id: `${file}:${n.pathId}`,
        transformId: `${file}:${n.transformPathId}` }));
    });
    this._images = new Map(); this._clips = new Map();
  }

  clone() { return Object.assign(Object.create(UIPack.prototype), this, { nodes: structuredClone(this.nodes) }); }

  clip(ref) {
    const id = this.objects.id(ref, 'AnimationClip');
    if (!this._clips.has(id)) this._clips.set(id, { ...this.store.clip(id), id });
    return this._clips.get(id);
  }

  controller(index) {
    const component = this.nodes[index]?.components.find(c => componentClass(c) === 'Animator');
    const id = this.store.ref(component?.fields.m_Controller, 'AnimatorController');
    if (!id) throw Error('UI node has no Animator controller');
    const document = this.store.objectJson(id);
    return { id, document, clip: i => this.clip(document.clips[i]) };
  }

  bindingNames(clip, rootIndex) {
    const root = this.nodes[rootIndex], names = this.objects.bindings.names(root.prefabId, root.path, clip.id);
    if (names.length !== clip.bindings.length) throw Error(`UI clip ${clip.id}: binding count differs`);
    return names;
  }

  image(ref, role = 'image') {
    const id = this.objects.id(ref), key = `${id}#${role}`;
    if (!this._images.has(key)) this._images.set(key, createImageBitmap(
      new Blob([this.store.objectBytes(id, role)], { type: 'image/png' }),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(error => { this._images.delete(key); throw error; }));
    return this._images.get(key);
  }
}
