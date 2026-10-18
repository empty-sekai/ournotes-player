import { createHash } from 'node:crypto';
import { AssetStore } from '../../src/data/assets.js';
import { UIPack, UI_FORMAT, UI_LIBRARY } from '../../src/ui/objects.js';
import { applyClip as applyNativeClip } from '../../src/ui/runtime.js';

const ids = new Map();
const number = name => { if (!ids.has(name)) ids.set(name, String(ids.size + 1)); return ids.get(name); };
export const id = name => `ui:${number(name)}`;
export const ref = name => ({ $ref: { file: 'ui', pathId: number(name) } });
const nativeTypes = new Set(['CanvasGroup', 'Animator', 'Canvas', 'Camera', 'SpriteRenderer', 'ParticleSystem']);
export const component = (name, fields = {}, key = name) => ({ type: nativeTypes.has(name) ? name : 'MonoBehaviour',
  pathId: number(`component:${key}`), ...(nativeTypes.has(name) ? {} : { script: `Example||${name}` }), fields });

export const node = (path, key, components = []) => ({ path, name: path.split('/').at(-1), pathId: number(key),
  transformPathId: number(`transform:${key}`), active: true, components: components.map((c, i) => {
    if (c.fields) return c;
    const { type, class: cls, ...fields } = c;
    return component(cls || type, fields, `${key}:${i}`);
  }),
  localScale: { x: 1, y: 1, z: 1 }, localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 } });
export const clip = (name, value) => ({ id: id(`clip:${name}`), name, startTime: 0, stopTime: 1,
  bindings: [{ path: '', class: 'CanvasGroup', attribute: 'm_Alpha' }], constant: [value] });

const controllerDoc = () => ({ name: 'Same', layers: [{ stateMachine: 0 }],
  parameters: [{ name: 'Go', type: 9, index: 0 }], clips: [ref('clip:A'), ref('clip:B')],
  stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: [
    { name: 'A', speed: 1, writeDefaultValues: true, blendTrees: [[{ clip: 0, children: [] }]],
      transitions: [{ destination: 1, conditions: [{ mode: 1, event: 'Go' }], duration: .5, fixedDuration: true }] },
    { name: 'B', speed: 1, writeDefaultValues: true, blendTrees: [[{ clip: 1, children: [] }]], transitions: [] },
  ] }] });

export const bind = (pack, value) => {
  for (const n of pack.nodes) pack.objects.bindings.table.set(`${n.prefabId}\0${n.path}\0${value.id}`,
    value.bindings.map(b => ({ path: b.path ?? '', attribute: b.attribute })));
};

export const pack = (nodes = [node('Root', 'root', [component('CanvasGroup', { m_Alpha: .3 })])]) => {
  const objects = {}, root = id('prefab');
  const add = (key, cls, doc) => { objects[key] = { class: cls, name: doc.name ?? doc.m_Name, files: { json: JSON.stringify(doc) } }; };
  add(root, 'GameObject', { name: 'Root', nodes });
  add(id('controller'), 'AnimatorController', controllerDoc());
  add(id('other-controller'), 'AnimatorController', controllerDoc());
  const a = clip('A', 0), b = clip('B', 1);
  add(a.id, 'AnimationClip', a); add(b.id, 'AnimationClip', b);
  const ui = { format: UI_FORMAT, key: 'EmbUI/Box', roots: [root], prefabs: [root], controllers: [id('controller')],
    entries: [], shaders: {}, bindings: { [root]: Object.fromEntries(nodes.map(n => [n.path, {
      [a.id]: a.bindings.map(({ path, attribute }) => ({ path, attribute })),
      [b.id]: b.bindings.map(({ path, attribute }) => ({ path, attribute })),
    }])) } };
  return new UIPack(new AssetStore({ objects }), ui);
};

export const controller = () => {
  const p = pack([node('Root', 'root', [component('Animator', { m_Controller: ref('controller') })])]);
  return p.controller(0);
};

// Low-level pose tests provide names alongside the synthetic curves they exercise.
export const applyClip = (p, value, root, time) => {
  const data = { id: id('clip:sample'), ...value }; bind(p, data);
  return applyNativeClip(p, data, root, time);
};

export const network = (p = pack([node('Root', 'root', [component('Animator', { m_Controller: ref('controller') })])])) => {
  const files = new Map(), encoder = new TextEncoder(), requests = [];
  const put = (path, text) => { const bytes = encoder.encode(text); files.set(path, bytes); return { asset: path, size: bytes.length }; };
  const asset = text => put(`assets/${createHash('sha256').update(text).digest('hex')}.json`, text);
  const manifest = { schema: 'nnnotes.product/1', product: 'ui.pack', subject: p.ui.key,
    files: { 'ui.json': asset(JSON.stringify(p.ui)) }, objects: {} };
  for (const [oid, object] of p.store._objects) manifest.objects[oid] = { class: object.class, name: object.name,
    files: Object.fromEntries([...object.files].map(([role, data]) => [role, asset(data)])) };
  const index = { format: UI_LIBRARY, assets: [{ id: 'one', key: p.ui.key, name: 'Box', kind: 'prefab',
    manifest: 'uipacks/one.json', roots: p.ui.roots }], embedded: [], controllers: [] };
  put('uipacks/one.json', JSON.stringify(manifest)); put('index.json', JSON.stringify(index));
  return { index, files, requests, manifest, asset, fetch: async (url, options = {}) => {
    options.signal?.throwIfAborted(); requests.push(String(url));
    const bytes = files.get(new URL(url).pathname.replace('/data/', ''));
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  } };
};
