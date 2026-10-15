import { AssetStore } from "../data/assets.js";
import { LIVE_PRODUCT } from "./store.js";
import { LIVE_JSON_FORMAT, MUSIC_FORMAT, NOTEEFFECT_FORMAT, NOTES_FORMAT, NOTESKIN_FORMAT, SCENE_FORMAT, SOUNDS_FORMAT } from "./data.js";

// Charts of the site layout with a live directory (docs/data-format.md "Chart manifest"): a chart manifest without
// `schema` whose files are a live.json index, the score, audio/live-audio.json with its waveforms, livescene/ and
// livenotes/. legacyLive() reads such a store as the store of a live: the documents of the live, scene, notes, note
// skin, note effect, sounds and music products, and the objects they name, so ChartSession reads both through
// LiveData and LiveObjects.
//
// The chart's scene.json and notes.json hold their objects inline: prefabs as node lists, materials, sprites, meshes,
// MonoBehaviour assets and clips where they are used, textures as file descriptors, clips and controllers of the note
// assets by key, shaders as packed directories. Each becomes an object of the store: livescene/ and livenotes/ are one
// serialized file each, and an inline object becomes one object of its file per distinct content (a material, sprite,
// mesh, MonoBehaviour asset or clip), per texture file, per clip / controller key and per packed shader; a prefab's
// root GameObject gets the prefab's nodes as its prefab.json, its nodes and components numbered in the file. A
// reference between the scene's roots becomes a reference to the node or component; the effect settings' references
// to their effect prefabs become references to the effect asset component on the prefab's root. The clips' bindings
// already carry their paths and attributes: the bindings tables list them for every Animator that plays them (the
// controller's Animator, a LoopAnimationTimeSync's Animator and the flick views' for the skin's arrow clips, a
// timeline track's bound Animator).

// whether `store` holds a chart of the site layout with a live directory (no product `schema`, a live.json)
export const isLegacyLive = (store) => !!store && (!store.info || (store.info.schema === undefined && store.info.product === undefined))
  && store.has("live.json");

// A store over another one: files added in memory (`text`) and files that are another path of the inner store
// (`alias`); every other path reads the inner store as it is. `objects`: the store's objects (AssetStore); `images`:
// object id -> the inner store's file its image is (decoded as the inner store decodes it).
class OverlayStore extends AssetStore {
  constructor(inner, { text = {}, alias = {}, objects = {}, images = new Map(), info = null } = {}) {
    super({ text, objects, info });
    this.inner = inner;
    this.alias = new Map(Object.entries(alias));
    this.images = images;
  }

  objectImage(id, role = "image") {
    const p = role === "image" ? this.images.get(id) : undefined;
    return p !== undefined ? this.inner.image(p) : super.objectImage(id, role);
  }

  _path(p) { return this.alias.get(p) ?? p; }
  has(p) { return this._text.has(p) || this.inner.has(this._path(p)); }
  text(p) { return this._text.has(p) ? this._text.get(p) : this.inner.text(this._path(p)); }
  bytes(p) { return this._text.has(p) ? super.bytes(p) : this.inner.bytes(this._path(p)); }
  json(p) { return this._text.has(p) ? super.json(p) : this.inner.json(this._path(p)); }
  image(p) { return this.inner.image(this._path(p)); }
  list(prefix = "") {
    return [...new Set([...this._text.keys(), ...this.alias.keys(), ...this.inner.list()])].filter((k) => k.startsWith(prefix)).sort();
  }
}

const ref = (id) => {
  const i = id.lastIndexOf(":");
  return { $ref: { file: id.slice(0, i), pathId: id.slice(i + 1) } };
};
// JSON text of a value; infinities are written as 1e999 / -1e999 (JSON.parse reads them back as Infinity)
const INF = "\u0000inf", NEG_INF = "\u0000-inf";
const json = (v) => JSON.stringify(v, (k, x) => (x === Infinity ? INF : x === -Infinity ? NEG_INF : x))
  .replaceAll('"\\u0000inf"', "1e999").replaceAll('"\\u0000-inf"', "-1e999");
const triangles = (flat) => {
  if (flat.length % 3) throw new Error(`${flat.length} indices: not triangles`);
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push(flat.slice(i, i + 3));
  return out;
};
const hex = (bytes) => ({ $hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join("") });
const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

// the inline object kinds of the chart's files
const isMaterial = (v) => typeof v.material === "string" && !!v.shader && typeof v.shader.shader === "string";
const isSprite = (v) => typeof v.sprite === "string" && !!v.texture && typeof v.texture === "object" && !!v.rect;
const isTexture = (v) => typeof v.texture === "string" && typeof v.width === "number";
const isMesh = (v) => typeof v.mesh === "string" && Array.isArray(v.vertices);
const isClip = (v) => Array.isArray(v.bindings) && !!v.streamed;
const isMono = (v) => typeof v.asset === "string";
const isNodeRef = (v) => typeof v.gameObject === "string" || typeof v.transform === "string";
const only = (v, k) => { const ks = Object.keys(v); return ks.length === 1 && ks[0] === k && typeof v[k] === "string"; };

// The objects of one directory of the chart (livescene/ or livenotes/), one serialized file `file`, added to `out`.
// `notes`: notes.json (the clips and controllers by key) of the file that has them, `peer`: that file for the other
// one (its Animators' controllers); `names`: clip id -> [{path, attribute}] of its bindings, `images`: Texture2D id ->
// its image file, both shared by the files.
class LegacyFile {
  constructor(store, base, file, out, { notes = null, peer = null, names = new Map(), images = new Map() } = {}) {
    this.store = store; this.base = base; this.file = file; this.out = out; this.images = images;
    this.notes = notes; this.peer = peer;
    this.n = 0;
    this.memo = new Map();
    this.names = names;
    this.tracks = [];                   // timeline tracks with their bound Animator: {id, name, bound, clips}
    this._shaders = null;
  }

  pathId() { this.n += 1; return String(this.n); }

  // an object of the file (once per memo key): files() -> {role: text | bytes}
  add(cls, name, files, key = null) {
    if (key !== null && this.memo.has(key)) return this.memo.get(key);
    const id = `${this.file}:${this.pathId()}`;
    if (key !== null) this.memo.set(key, id);
    this.out[id] = { class: cls, name, files: files() };
    return id;
  }

  // the packed shaders of the directory as Shader objects: name -> object id
  shaders() {
    if (this._shaders) return this._shaders;
    const dir = `${this.base}/shaders`, S = this.store;
    this._shaders = {};
    for (const r of S.json(`${dir}/shaders.json`)) {
      this._shaders[r.name] = this.add("Shader", r.name, () => {
        const files = { json: S.text(`${dir}/${r.parsed}`) };
        const variants = r.variants.map(({ file, ...v }) => {
          const role = `program:${file.slice(file.indexOf("/") + 1)}`;
          files[role] = S.text(`${dir}/${file}`);
          return { ...v, role };
        });
        files.index = json({ name: r.name, variants });
        return files;
      });
    }
    return this._shaders;
  }

  // a Shader by name; a shader the directory does not pack is a reference to no object of the store
  shader(name) {
    const id = this.shaders()[name], k = `shader:${name}`;
    if (id) return id;
    if (!this.memo.has(k)) this.memo.set(k, `${this.file}:${this.pathId()}`);
    return this.memo.get(k);
  }

  // a texture descriptor {texture (path under the directory), name, width, height, mipCount, colorSpace, settings}; a
  // texture whose image the chart does not carry has no image file
  texture(d) {
    const path = `${this.base}/${d.texture}`, has = this.store.has(path);
    const id = this.add("Texture2D", d.name, () => ({
      json: json({ m_Name: d.name, m_Width: d.width, m_Height: d.height, m_MipCount: d.mipCount, m_ColorSpace: d.colorSpace,
                   m_TextureSettings: d.settings }),
      ...(has ? { image: this.store.bytes(path) } : {}),
    }), `texture:${d.texture}`);
    if (has) this.images.set(id, path);
    return id;
  }

  // a sprite record {sprite, texture, rect, pivot, border, pixelsToUnits, offset, textureRect, textureRectOffset,
  // atlasRectOffset, downscaleMultiplier, settingsRaw, uvTransform, vertices, indices}
  sprite(s) {
    const { key: _key, ...rec } = s;
    return this.add("Sprite", s.sprite, () => ({ json: json({
      sprite: { m_Name: s.sprite, m_Rect: s.rect, m_Pivot: s.pivot, m_Border: s.border, m_PixelsToUnits: s.pixelsToUnits,
                m_Offset: s.offset },
      renderData: { texture: ref(this.texture(s.texture)), textureRect: s.textureRect, textureRectOffset: s.textureRectOffset,
                    ...(s.atlasRectOffset ? { atlasRectOffset: s.atlasRectOffset } : {}),
                    downscaleMultiplier: s.downscaleMultiplier ?? 1, settingsRaw: s.settingsRaw, uvTransform: s.uvTransform },
      mesh: s.vertices ? { positions: s.vertices, submeshes: [triangles(s.indices)] } : null,
    }) }), `sprite:${json(rec)}`);
  }

  // a material record {material, shader: {shader}, keywords, ..., textures {slot: {texture: descriptor | null, scale,
  // offset}}, ints, floats, colors}
  material(m) {
    return this.add("Material", m.material, () => ({ json: json({
      ...m, shader: ref(this.shader(m.shader.shader)),
      textures: Object.fromEntries(Object.entries(m.textures || {}).map(([k, t]) =>
        [k, { ...t, texture: t.texture ? ref(this.texture(t.texture)) : null }])),
    }) }), `material:${json(m)}`);
  }

  // a mesh record {mesh, vertices, normals, uv0, submeshes (flat indices), m_Skin, m_BindPose, ...}
  mesh(m) {
    return this.add("Mesh", m.mesh, () => {
      const arrays = { positions: m.vertices, normals: m.normals ?? null, uv0: m.uv0 ?? null, submeshes: m.submeshes.map(triangles) };
      if (m.m_Skin) {
        arrays.joints = m.m_Skin.map((w) => w.boneIndex);
        arrays.weights = m.m_Skin.map((w) => w.weight);
      }
      return { json: json(without(m, ["mesh", "vertices", "normals", "uv0", "submeshes", "m_Skin"])), arrays: json(arrays) };
    }, `mesh:${json(m)}`);
  }

  // an exported clip (bindings with path and attribute); its bindings' names are kept for the bindings tables
  clip(c) {
    const { clip: _key, ...raw } = c;
    const k = `clip:${json(raw)}`;
    if (this.memo.has(k)) return this.memo.get(k);
    const id = this.add("AnimationClip", raw.name, () => ({ json: json({
      ...raw,
      bindings: raw.bindings.map((b) => ({
        pathCrc: b.pathCrc ?? 0, attributeCrc: b.attributeCrc ?? 0, typeID: b.typeID, class: b.class,
        customType: b.customType ?? 0, pptr: !!b.pptr, int: !!b.isIntCurve, serializeReference: false,
        ...(b.curves ? { curves: b.curves } : {}),
      })),
    }) }), k);
    // a PPtr curve on m_Sprite is stored without attribute
    this.names.set(id, raw.bindings.map((b) => ({
      path: b.path, attribute: b.pptr && b.attribute == null && !b.attributeCrc ? "m_Sprite" : b.attribute })));
    return id;
  }

  // a clip / controller of notes.json by key
  clipKey(key) {
    const c = this.notes && this.notes.clips[key];
    if (!c) throw new Error(`livenotes: clip ${key} not exported`);
    return this.clip(c);
  }

  controllerKey(key) {
    const c = this.notes && this.notes.controllers[key];
    if (!c) throw new Error(`livenotes: controller ${key} not exported`);
    return this.add("AnimatorController", c.name, () => ({
      json: json({ ...c, clips: c.clips.map((e) => ref(this.clipKey(e.clip))) }),
    }), `controller:${key}`);
  }

  // Animator.m_Controller: {controller: key} of notes.json, or {name} of a controller notes.json has under that name
  // (one only); else as it is (a controller the chart does not carry)
  controller(v) {
    if (!v) return v;
    if (!this.notes) return this.peer ? this.peer.controller(v) : v;
    if (only(v, "controller")) return ref(this.controllerKey(v.controller));
    const ctrls = Object.entries(this.notes.controllers).filter(([, c]) => c.name === v.name);
    return ctrls.length === 1 ? ref(this.controllerKey(ctrls[0][0])) : v;
  }

  // a MonoBehaviour asset {asset: class, name, m_Name, ...fields}; a timeline track's bound Animator is kept aside
  mono(v, cx) {
    const fields = this.value(without(v, ["asset", "name", "key", "boundAnimator"]), cx);
    const id = this.add("MonoBehaviour", v.m_Name ?? v.name ?? v.asset, () => ({ json: json({ $script: v.asset, ...fields }) }),
                        `mono:${json(v)}`);
    if (v.boundAnimator && !this.tracks.some((t) => t.id === id))
      this.tracks.push({ id, name: v.m_Name, bound: v.boundAnimator,
                         clips: (v.m_Clips || []).map((c) => this.clip(c.m_Asset.m_Clip)) });
    return id;
  }

  // a field value with its inline objects as references; cx: {root, layout} of the prefab being converted
  value(v, cx) {
    if (Array.isArray(v)) return v.map((x) => this.value(x, cx));
    if (!v || typeof v !== "object" || v.$ref !== undefined) return v;
    if (isMaterial(v)) return ref(this.material(v));
    if (isSprite(v)) return ref(this.sprite(v));
    if (isTexture(v)) return ref(this.texture(v));
    if (isMesh(v)) return ref(this.mesh(v));
    if (isClip(v)) return ref(this.clip(v));
    if (only(v, "clip") && this.notes) return ref(this.clipKey(v.clip));
    if (isMono(v)) return ref(this.mono(v, cx));
    if (isNodeRef(v) && cx && cx.layout) return this.nodeRef(v, cx);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.value(x, cx)]));
  }

  // a node / component reference {gameObject | transform, component?, class?}: as it is inside its root, a reference to
  // the node or component in another root of the layout
  nodeRef(v, cx) {
    const p = v.gameObject ?? v.transform, n = cx.layout.get(p);
    if (p.split("/")[0] === cx.root || !n) return v;
    if (v.transform !== undefined) return ref(`${this.file}:${n.transformPathId}`);
    if (v.component === undefined) return ref(`${this.file}:${n.pathId}`);
    const c = n.components.find((x) => x.type === v.component && (v.class === undefined || x.class === v.class));
    if (!c) throw new Error(`${p}: no ${v.class || v.component}`);
    return ref(`${this.file}:${c.pathId}`);
  }

  // node path -> {pathId, transformPathId, components: [{type, class, pathId}]} of prefabs' nodes, numbered in the file
  layout(prefabs, into = new Map()) {
    for (const nodes of prefabs) for (const n of nodes) {
      into.set(n.path, { pathId: this.pathId(), transformPathId: this.pathId(),
                         components: n.components.map((c) => ({ type: c.type, class: c.class, pathId: this.pathId() })) });
    }
    return into;
  }

  // a prefab's node list as its root GameObject (prefab.json); `layout` numbers its nodes (layout())
  prefab(nodes, layout) {
    const root = nodes[0].path, cx = { root, layout };
    const out = nodes.map((n) => {
      const L = layout.get(n.path);
      return {
        ...without(n, ["components"]), pathId: L.pathId, transformPathId: L.transformPathId,
        components: n.components.map((c, i) => {
          let fields = without(c, ["type", "class"]);
          if (c.type === "Animator") fields = { ...fields, m_Controller: this.controller(fields.m_Controller) };
          if (c.type === "ParticleSystemRenderer")
            for (const k of ["m_VertexStreams", "m_TrailVertexStreams"]) if (Array.isArray(fields[k])) fields = { ...fields, [k]: hex(fields[k]) };
          return { type: c.type, pathId: L.components[i].pathId, ...(c.class ? { script: c.class } : {}), fields: this.value(fields, cx) };
        }),
      };
    });
    const id = `${this.file}:${layout.get(root).pathId}`;
    this.out[id] = { class: "GameObject", name: nodes[0].name, files: { json: json({ name: nodes[0].name, nodes: out }) } };
    return id;
  }

  // a prefab {key, nodes} with a layout of its own (once per key)
  prefabOf(p) {
    const k = `prefab:${p.key}`;
    if (!this.memo.has(k)) this.memo.set(k, this.prefab(p.nodes, this.layout([p.nodes])));
    return this.memo.get(k);
  }
}

// the root of the first path segment's nodes: the node lists of the roots of a flat hierarchy, in order
const roots = (nodes) => {
  const by = new Map();
  for (const n of nodes) {
    const r = n.path.split("/")[0];
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(n);
  }
  return [...by.values()];
};

// prefab id -> animator path -> clip id -> names
const addBindings = (table, prefab, animator, clip, names) => {
  ((table[prefab] ??= {})[animator] ??= {})[clip] = names;
};

// The bindings of the Animators of a prefab that play clips: an Animator's controller clips, a LoopAnimationTimeSync's
// clip on its Animator, and `extra(sync)` clips on a LoopAnimationTimeSync's Animator (the skin's arrow clips).
const prefabBindings = (F, id, table, extra = null) => {
  for (const n of JSON.parse(F.out[id].files.json).nodes) for (const c of n.components) {
    if (c.type === "Animator" && c.fields.m_Controller && c.fields.m_Controller.$ref) {
      const ctrl = JSON.parse(F.out[`${ref2id(c.fields.m_Controller)}`].files.json);
      for (const r of ctrl.clips) addBindings(table, id, n.path, ref2id(r), F.names.get(ref2id(r)));
    }
    if (c.script === "LoopAnimationTimeSync") {
      const at = c.fields._animator.gameObject;
      if (c.fields._loopAnim) addBindings(table, id, at, ref2id(c.fields._loopAnim), F.names.get(ref2id(c.fields._loopAnim)));
      for (const clip of extra ? extra() : []) addBindings(table, id, at, clip, F.names.get(clip));
    }
  }
};
const ref2id = (v) => `${v.$ref.file}:${v.$ref.pathId}`;

const SCENE_FILE = "livescene", NOTES_FILE = "livenotes";

// scene.json and notes.json of the chart as the documents and objects of the live.scene, live.notes, live.noteskin and
// live.noteeffect products: {docs: {scene, notes, noteskin, noteeffect}, objects, band, jacket, skin, effect}
const legacyScene = (store, sceneFile, notesFile) => {
  const objects = {}, names = new Map(), images = new Map();
  const sc = store.json(sceneFile), nt = store.json(notesFile);
  const N = new LegacyFile(store, "livenotes", NOTES_FILE, objects, { notes: nt, names, images });
  const S = new LegacyFile(store, "livescene", SCENE_FILE, objects, { peer: N, names, images });

  // the scene's roots, numbered together (references between them), then the timeline and the lane line prefab
  const rootNodes = roots(sc.scene.nodes), layout = S.layout(rootNodes);
  const scene = rootNodes.map((nodes) => S.prefab(nodes, layout));
  const rootOf = (path) => scene[rootNodes.findIndex((nodes) => nodes[0].path === path.split("/")[0])];
  const timeline = S.prefabOf(sc.assets.startTimeline), laneLine = S.prefabOf(sc.assets.laneLinePrefab);

  // the graphics settings: the default pipeline, its renderers and the film grain textures of their post data
  const P = sc.player, pipe = P.pipelines[P.defaultPipeline], renderers = {};
  for (const [name, r] of Object.entries(P.renderers)) {
    const post = r.postProcessData ? P.postProcessData[r.postProcessData] : null, grain = sc.postTextures[name];
    const postId = post ? S.add("MonoBehaviour", post.m_Name, () => ({ json: json({ $script: "PostProcessData", ...post,
      ...(grain ? { textures: { ...post.textures, filmGrainTex: grain.filmGrainTex.map((d) => ref(S.texture(d))) } } : {}) }) })) : null;
    renderers[name] = S.add("MonoBehaviour", name, () => ({ json: json({ $script: "UniversalRendererData", ...r,
      postProcessData: postId ? ref(postId) : null }) }));
  }
  const pipeId = S.add("MonoBehaviour", pipe.m_Name, () => ({ json: json({ $script: "UniversalRenderPipelineAsset", ...pipe,
    m_RendererDataList: pipe.m_RendererDataList.map((n) => (n ? ref(renderers[n]) : null)) }) }));
  const graphics = {
    graphics: S.add("GraphicsSettings", "", () => ({ json: json({ m_CustomRenderPipeline: ref(pipeId) }) })),
    quality: S.add("QualitySettings", "", () => ({ json: json({ m_QualitySettings: P.qualityLevels }) })),
    player: S.add("PlayerSettings", "", () => ({ json: json({ m_ActiveColorSpace: P.colorSpace === "Linear" ? 1 : 0 }) })),
  };

  // the band's start timeline: its tracks' bound Animators (the scene or the timeline prefab)
  const band = sc.slice.band, tracks = {}, sceneBindings = {};
  for (const t of S.tracks) {
    const prefab = t.bound.key === sc.assets.startTimeline.key ? timeline : t.bound.key === sc.scene.key ? rootOf(t.bound.gameObject) : null;
    if (!prefab) throw new Error(`timeline track ${t.name}: bound in ${t.bound.key}`);
    tracks[t.id] = { name: t.name, prefab, animator: t.bound.gameObject };
    for (const clip of t.clips) addBindings(sceneBindings, prefab, t.bound.gameObject, clip, S.names.get(clip));
  }

  // note assets: the note view prefabs, the effect prefabs, the UI prefab and sprite assets, the skin
  const ns = nt.settings, judge = N.prefabOf(nt.prefabs.judge_effect_view);
  for (const id of scene) prefabBindings(S, id, sceneBindings);
  const prefabs = {}, notesBindings = {}, skinBindings = {}, effectBindings = {};
  const skin = N.mono(nt.noteSkin, null), skinDoc = JSON.parse(objects[skin].files.json);
  const arrows = () => ["FlickNoteAsset", "LeftFlickNoteAsset", "RightFlickNote"].filter((k) => skinDoc[k])
    .map((k) => JSON.parse(objects[ref2id(skinDoc[k])].files.json))
    .filter((u) => u._arrowLoopAnimation).map((u) => ref2id(u._arrowLoopAnimation));
  for (const [name, p] of Object.entries(nt.prefabs)) {
    if (name === "judge_effect_view" || name === "bar_line_view") continue;
    prefabs[name] = N.prefabOf(p);
    prefabBindings(N, prefabs[name], notesBindings);
    prefabBindings(N, prefabs[name], skinBindings, arrows);
  }
  // an effect set's settings: each field a reference to the effect asset component on the root of its prefab
  // (<set directory>/<field's gameObject>)
  const effectSet = (kind, set, cls, table) => {
    const dir = `Effect/Live/${kind}/${set}`, s = nt.assets[`${dir}/${kind === "NoteEffect" ? "LiveNoteEffectAssetSettings" : "LiveLaneEffectAssetSettings"}`];
    if (!s) throw new Error(`livenotes: ${dir} settings not exported`);
    const v = { ...s };
    for (const [k, x] of Object.entries(s)) {
      const p = x && typeof x === "object" && x.class === cls ? nt.assets[`${dir}/${x.gameObject}`] : null;
      if (!p) continue;
      const id = N.prefabOf(p), root = JSON.parse(objects[id].files.json).nodes[0];
      prefabBindings(N, id, table);
      v[k] = { $ref: { file: NOTES_FILE, pathId: root.components.find((c) => c.script === cls).pathId } };
    }
    return N.mono(v, null);
  };
  const laneSet = "effect001";                // LaneEffectLoadStep.GetAssetPath
  const laneEffect = effectSet("LaneEffect", laneSet, "LiveLaneEffectAsset", notesBindings);
  const effect = effectSet("NoteEffect", ns.effect, "LiveNoteEffectAsset", effectBindings);
  const spriteAsset = (k) => {
    const a = nt.assets[`Live/UiSpriteAssets/${k}`];
    if (!a) throw new Error(`livenotes: Live/UiSpriteAssets/${k} not exported`);
    return N.mono(a, null);
  };

  const m = sc.master;
  const docs = {
    scene: {
      format: SCENE_FORMAT, scene, renderSettings: null, graphics,
      laneSkins: { [sc.slice.laneSkin]: Object.fromEntries(Object.entries(sc.laneSkin).map(([k, s]) => [k, S.sprite(s)])) },
      prefabs: { laneLine, judgeEffectView: judge, barLineView: nt.prefabs.bar_line_view ? N.prefabOf(nt.prefabs.bar_line_view) : null },
      spriteAssets: { combo: spriteAsset("LiveComboSpriteAsset"), judgement: spriteAsset("LiveJudgementSpriteAsset") },
      bands: { [String(band)]: { background: S.sprite(sc.sprites.lightweightBackground), timeline, tracks } },
      settings: {
        judgementSprites: ns.judgementSprites, laneSkin: sc.slice.laneSkin,
        laneSkins: Object.fromEntries(m.liveLaneSkin.map((r) => [String(r._id), r._assetName])),
        optionDefaults: Object.fromEntries(Object.entries(m.optionDefaultsPreset1).map(([k, o]) => [k, o.value])),
        optionRanges: m.optionRanges, qualitySettings: m.liveQualitySettings,
      },
      bindings: sceneBindings, shaders: S.shaders(),
    },
    notes: {
      format: NOTES_FORMAT, prefabs, laneEffect, settings: { ...without(ns, ["judgementSprites"]), laneEffect: laneSet },
      bindings: notesBindings, shaders: N.shaders(),
    },
    noteskin: { format: NOTESKIN_FORMAT, name: ns.skin, skin, bindings: skinBindings, shaders: {} },
    noteeffect: { format: NOTEEFFECT_FORMAT, name: ns.effect, settings: effect, bindings: effectBindings, shaders: {} },
  };
  return { docs, objects, images, band, jacket: S.sprite(sc.sprites.jacket), skin: ns.skin, effect: ns.effect };
};

// The store of a chart of the site layout read as the store of a live (an OverlayStore over `store`):
//   lives/<musicId>_<difficulty>/live.json, notes.json, notes.mirror.json   the live: the score files (and the mirrored
//                one when the chart has it), the band, the jacket, `parts` naming the products below
//   scenes/default/scene.json, notes/default/notes.json, noteskins/<skin>/noteskin.json,
//   noteeffects/<effect>/noteeffect.json   the scene and the note assets (legacyScene)
//   sounds/default/sounds.json   live-audio.json without the music; its waveforms under sounds/default/
//   music/<musicId>/music.json   the music's sound; its waveforms under music/<musicId>/
// `info` is the chart manifest's (chart, quality, options, audio) with the live's `product`, `subject`, `dir` and
// `products`.
export const legacyLive = (store) => {
  const old = store.json("live.json");
  for (const k of ["musicId", "difficulty", "notes", "liveAudio", "scene", "noteAssets"])
    if (old[k] === undefined) throw new Error(`live.json: no ${k}`);
  const id = `${old.musicId}_${old.difficulty}`, dir = `lives/${id}`;
  const sounds = "sounds/default", musicDir = `music/${old.musicId}`;
  const L = legacyScene(store, old.scene, old.noteAssets);
  const skinDir = `noteskins/${L.skin}`, effectDir = `noteeffects/${L.effect}`;
  const text = {}, alias = {};
  alias[`${dir}/notes.json`] = old.notes;
  if (old.notesMirror) alias[`${dir}/notes.mirror.json`] = old.notesMirror;
  const parts = { scene: "scenes/default.json", notes: "notes/default.json", noteskin: `${skinDir}.json`,
                  noteeffect: `${effectDir}.json`, sounds: `${sounds}.json`, music: `${musicDir}.json` };
  text[`${dir}/live.json`] = JSON.stringify({
    format: LIVE_JSON_FORMAT, musicId: old.musicId, difficulty: old.difficulty, band: { band: L.band }, jacket: L.jacket,
    notes: "notes.json", ...(old.notesMirror ? { notesMirror: "notes.mirror.json" } : {}), parts,
  });
  text["scenes/default/scene.json"] = json(L.docs.scene);
  text["notes/default/notes.json"] = json(L.docs.notes);
  text[`${skinDir}/noteskin.json`] = json(L.docs.noteskin);
  text[`${effectDir}/noteeffect.json`] = json(L.docs.noteeffect);
  const audio = store.json(old.liveAudio);
  const musicId = String(audio.music && audio.music.soundId);
  if (!audio.sounds || !audio.sounds[musicId]) throw new Error(`${old.liveAudio}: no sound of the music (${musicId})`);
  // a sound's waveforms under the product's directory
  const moved = (into, cue) => ({ ...cue, layers: cue.layers.map((Lr) => { alias[`${into}/${Lr.file}`] = Lr.file; return Lr; }) });
  const { music, sounds: all, ...rest } = audio;
  const se = Object.fromEntries(Object.entries(all).filter(([k]) => k !== musicId).map(([k, c]) => [k, moved(sounds, c)]));
  text[`${sounds}/sounds.json`] = JSON.stringify({ format: SOUNDS_FORMAT, ...rest, sounds: se });
  text[`${musicDir}/music.json`] = JSON.stringify({
    format: MUSIC_FORMAT, musicId: old.musicId, music, sounds: { [musicId]: moved(musicDir, all[musicId]) },
  });
  const info = {
    ...(store.info || {}), product: LIVE_PRODUCT, subject: `${old.musicId}/${old.difficulty}`, dir,
    products: { [LIVE_PRODUCT]: { [`${old.musicId}/${old.difficulty}`]: dir }, "live.scene": { default: "scenes/default" },
                "live.notes": { default: "notes/default" }, "live.noteskin": { [L.skin]: skinDir },
                "live.noteeffect": { [L.effect]: effectDir }, "live.sounds": { default: sounds },
                "live.music": { [String(old.musicId)]: musicDir } },
  };
  return new OverlayStore(store, { text, alias, objects: L.objects, images: L.images, info });
};
