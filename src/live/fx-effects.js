import { AnimClip, AnimController, AnimTargets, Animator } from "../engine/anim.js";
import { F } from "../engine/core.js";
import { Transform, mat4 } from "../engine/math.js";
import { Prefab } from "../engine/prefab.js";
import { FxParticleSystem, PS_STOP } from "../engine/particles.js";

// Note effects, slide hold loop and lane effects of the live chart player: FxPrefab (one effect prefab instance),
// FxSpriteRenderer, LiveNoteEffects (LiveAllNoteEffectView), LiveLaneEffects (LiveLaneEffectView) and the scene values
// they read (FxScene). ParticleSystems come from particles.js (FxParticleSystem / FxMaterials / PS_STOP, used at run
// time only, never at load time); every rng is an UnityRandom (engine/random.js).
//
// Sources
//   - Game code (App.Runtime.dll):
//     LiveAllNoteEffectView.FullInitialize / UpdateFrame / PlayNoteEffect /
//     GetLineEffect / OnStopEffect; LiveGameNoteEffectBase.Initialize /
//     SetWidth / SetPosition / Play / Stop / EnableAnimator /
//     RestoreDefaultValues; AnimationFinishEventTrigger..ctor (+ its Trigger component);
//     LiveViewElementContainerBase<T>.Rent / Return / AddCapacity;
//     LiveNoteJudgementRoot3D.UpdateProperties / GetNoteJudgementPosition(int),
//     (float); LiveNoteViewUtility.ClampLaneAndWidth; LiveCalculator.GetNoteLineTypeEasing;
//     MathUtility.EarlyFloatLerp; LiveLaneEffectView.FullInitialize /
//     UpdateFrame; LiveGameLaneEffectBase.Initialize / SetWidth / Play /
//     Stop / IsPlaying; Live{Renderer,Particle}OrderInLayerSetter.Awake,
//     LiveOrderInLayerUtility.GetOrderInLayer.
//   - Data: livenotes/notes.json (assets[...] prefab node lists with raw components, clips, controllers,
//     LiveNoteEffectAssetSettings, LiveLaneEffectAssetSettings); score/<file>.notes.json;
//     constants of the scene [EmbScene/Live] quoted below (as in livescene/scene.json).
//   - Engine behaviour that is native (Animator, AnimationEvent dispatch, SpriteRenderer mesh generation, GameObject
//     activation) follows Unity's documented behaviour and is marked `// ENGINE:`.
//
// Frame model: update(fr) in the `update` phase (lane effects first, then note effects),
// animate(dt) = every Animator (PreLateUpdate DirectorUpdateAnimation), simulate(dt) = every ParticleSystem after the
// Animators, submit(renderer) in the render hook. Nothing here registers loop hooks.

export class FxEffectsError extends Error {};

// ------------------------------------------------------------------------------------------ scene values
// [EmbScene/Live] values the effect views read, taken from livescene/scene.json (parsed by the caller): the lane
// width, the judgement root, and the effect containers in their serialized order. Which LiveNoteEffectAssetSettings /
// LiveLaneEffectAssetSettings field a container type uses is code: LiveAllNoteEffectViewContainer.GetEffectAsset
// (FX_NOTE_FIELD) and the lane settings fields per LiveLaneEffectType (FX_LANE_FIELD).
export const FX_NOTE_FIELD = { 10: "NormalEffect", 20: "SlideEffect", 21: "SlideLoopConnectEffect", 22: "SlideLoopEffect",
                     30: "FlickEffect", 31: "FlickLeftEffect", 32: "FlickRightEffect", 50: "FlickJustEffect" };
export const FX_LANE_FIELD = { 2: "InVainEffect", 10: "NormalEffect", 20: "SlideEffect", 30: "FlickEffect",
                     31: "FlickLeftEffect", 32: "FlickRightEffect" };
export const FxScene = {
  read(scene) {
    const byPath = new Map(scene.scene.nodes.map((n) => [n.path, n]));
    const comp = (path, cls) => {
      const n = byPath.get(path), c = n && n.components.find((x) => (x.class || x.type) === cls);
      if (!c) throw new FxEffectsError(`scene: no ${cls} on ${path}`);
      return c;
    };
    const field = (table, type, path) => {
      if (!(type in table)) throw new FxEffectsError(`scene: ${path}: effect type ${type} has no settings field`);
      return table[type];
    };
    // LiveLaneView._laneWidth (double 19.12): LiveLaneView.Initialize passes (float) of it to
    // LiveNoteJudgementRoot3D.Initialize, LiveAllNoteEffectViewContainer.Initialize (baseLaneWidth) and the lane effects.
    const laneWidth = comp("LiveGameView/root/LiveGameLane", "LiveLaneView")._laneWidth;
    // LiveGameView/root/LiveGameLane/judgement_root (local (0, 0, 9.62) under identity parents)
    const pf = new Prefab({ key: "scene", nodes: scene.scene.nodes });
    const judgementRoot = pf.transform("LiveGameView/root/LiveGameLane/judgement_root").localToWorld();
    // LiveAllNoteEffectViewContainer._containers -> LiveGameNoteEffectContainer (_effectType, capacities)
    const noteContainers = comp("LiveGameView/root/LiveGameNoteEffectView/container_root", "LiveAllNoteEffectViewContainer")
      ._containers.map((r) => {
        const k = comp(r.gameObject, "LiveGameNoteEffectContainer");
        return { name: r.gameObject.split("/").pop(), type: k._effectType, init: k._initCapacity,
                 insufficient: k._insufficientCapacity, shortage: k._shortageCapacity,
                 field: field(FX_NOTE_FIELD, k._effectType, r.gameObject) };
      });
    // LiveLaneEffectView._effectContainers in serialized order (the dictionary order the per-lane choice iterates);
    // the groove container (_grooveEffectContainer, performance) is separate and only used in gekisou.
    const laneContainers = comp("LiveGameView/root/LiveGameLaneEffectView", "LiveLaneEffectView")._effectContainers
      .map((r) => {
        const k = comp(r.gameObject, "LiveGameLaneEffectContainer");
        return { name: r.gameObject.split("/").pop(), type: k._effectType, field: field(FX_LANE_FIELD, k._effectType, r.gameObject) };
      });
    return { laneWidth, judgementRoot, noteContainers, laneContainers };
  },
};

// LiveOrderInLayerUtility.GetOrderInLayer is a switch over the order enum; the two values the effect
// prefabs use (60: note effects, 41: lane effects) with their results. Other values raise.
export const FX_ORDER_IN_LAYER = { 60: 6000, 41: 4100 };

// ------------------------------------------------------------------------------------------ game math (float32)
export const FxLiveMath = {
  // Fwk.Utility.MathUtility.EarlyFloatLerp: (b - a) * clamp01(t) + a
  earlyFloatLerp(a, b, t, clamp = true) {
    const u = clamp ? (t < 0 ? 0 : t > 1 ? 1 : t) : t;
    return F(F(F(b - a) * u) + a);
  },

  // FTLiveSimulator.LiveCalculator.GetNoteLineTypeEasing: 0 Linear t, 1 EaseIn (2 - t) t, 2 EaseOut t t
  lineEase(t, ease) {
    if (ease === 0) return t;
    if (ease === 1) return F(F(2 - t) * t);
    if (ease === 2) return F(t * t);
    throw new FxEffectsError(`noteLineEaseType ${ease}`);          // ArgumentOutOfRangeException in the game
  },

  EASE: { Linear: 0, EaseIn: 1, EaseOut: 2 },

  // App.Live.LiveNoteViewUtility.ClampLaneAndWidth, operation order as in the game
  clampLaneAndWidth(c, w, min, max) {
    const hw = F(w * 0.5);
    const l = F(c - hw), r = F(hw + c);
    let dr = F(r - max), dlh = F(F(min - l) * 0.5), dl = F(min - l);
    if (min <= l) { dl = 0; dlh = -0; }
    let drh = F(dr * 0.5);
    if (r <= max) { dr = 0; drh = 0; }
    return { center: F(F(dlh + c) - drh), width: F(F(w - dl) - dr) };
  },
};

// ------------------------------------------------------------------------------------------ SpriteRenderer
// UnityEngine.SpriteRenderer of the effect prefabs: mesh in the renderer's local space (units), vertex colour =
// m_Color, material = m_Materials[0] with the sprite's texture as _MainTex.
//   drawMode 0 (Simple): the sprite's own mesh (exported m_Sprite.vertices / uv / indices, units relative to the pivot).
//   drawMode 1 (Sliced): a 9-slice of m_Size: outer rectangle (-pivot * size .. (1 - pivot) * size), borders
//   (m_Sprite.border px / pixelsToUnits: x left, y bottom, z right, w top); UVs of the sprite rect in its texture.
//   drawMode 2 (Tiled) is not used by any effect prefab and raises.
// ENGINE: SpriteRenderer mesh generation is native; the documented behaviour below is implemented.
// Pivot kept at the same normalized point of m_Size; borders shrink proportionally when they do not fit (left + right >
// width); the UVs of a sliced sprite are taken from the sprite rect (every effect sprite is unpacked, settingsRaw bit 0
// = 0, so the rect is the texture region).
// ENGINE: a Tight-mesh sprite in Sliced mode (ef_tap_pillar) uses its full rect, not its textureRect.
// (ef_tap_pillar: textureRect 51..76 px of its 128 px rect; the alternative reading, geometry inset by the
// rect/textureRect padding with UVs of the textureRect like uGUI's Image, would draw the beam wider.)
// ENGINE: vertex colour is Color32 (Unity's sprite vertex format), round(clamp01(c) * 255), as for particles.
// Colour space Gamma (player.colorSpace), so no linear conversion.
// ENGINE: flipX / flipY negate the local x / y of the vertices (the shader culls nothing: Cull Off).
export class FxSpriteRenderer {
  constructor(comp, transform, { materials = null, name = "" } = {}) {
    const sp = comp.m_Sprite;
    if (!sp) throw new FxEffectsError(`${name}: SpriteRenderer without sprite`);
    if (comp.m_DrawMode !== 0 && comp.m_DrawMode !== 1)
      throw new FxEffectsError(`${name}: SpriteRenderer drawMode ${comp.m_DrawMode} not implemented`);
    if (comp.m_MaskInteraction) throw new FxEffectsError(`${name}: SpriteRenderer mask interaction ${comp.m_MaskInteraction}`);
    if (!comp.m_Materials || comp.m_Materials.length !== 1 || !comp.m_Materials[0])
      throw new FxEffectsError(`${name}: SpriteRenderer needs exactly one material`);
    this.name = name;
    this.transform = transform;
    this.enabled = !!comp.m_Enabled;
    this.drawMode = comp.m_DrawMode;
    this.sprite = {
      name: sp.sprite, texture: sp.texture, rect: { ...sp.rect }, border: { ...sp.border }, pivot: { ...sp.pivot },
      ppu: F(sp.pixelsToUnits), vertices: sp.vertices, uv: sp.uv, indices: sp.indices, packed: (sp.settingsRaw & 1) === 1,
    };
    if (this.drawMode === 1 && this.sprite.packed) throw new FxEffectsError(`${name}: sliced packed sprite not implemented`);
    this.color = [F(comp.m_Color.r), F(comp.m_Color.g), F(comp.m_Color.b), F(comp.m_Color.a)];
    this.size = { x: F(comp.m_Size.x), y: F(comp.m_Size.y) };
    this.flipX = !!comp.m_FlipX;
    this.flipY = !!comp.m_FlipY;
    this.sortingLayer = comp.m_SortingLayer | 0;
    this.sortingOrder = comp.m_SortingOrder | 0;
    this.materialRecord = comp.m_Materials[0];
    this.materials = materials;
    this.material = materials ? materials.get(this.materialRecord) : null;
    this.texture = null;                      // GL texture of the sprite (_MainTex), set by load()
    this._texPromise = null;
    this._geo = null;                         // cached local geometry (positions + uvs), rebuilt on size change
    // the upload starts at construction (shared per texture by FxMaterials); load() awaits it
    if (materials && materials.gl) this.load().catch((err) => console.error(`FxSpriteRenderer ${name}: ${err.message}`));
  }

  // sprite texture through the materials' texture cache (GL only)
  load() {
    if (!this.materials || !this.materials.gl) return Promise.resolve();
    if (!this._texPromise) this._texPromise = Promise.resolve(this.materials.texture(this.sprite.texture)).then((t) => { this.texture = t; });
    return this._texPromise;
  }

  // Animator bindings of class SpriteRenderer: m_Color.r|g|b|a, m_Size.x|y
  accessor(attr) {
    const m = /^(m_Color)\.([rgba])$|^(m_Size)\.([xy])$/.exec(attr);
    if (!m) return null;
    if (m[1]) {
      const i = "rgba".indexOf(m[2]);
      return { get: () => this.color[i], set: (v) => { this.color[i] = F(v); } };
    }
    const c = m[4];
    return { get: () => this.size[c], set: (v) => { v = F(v); if (this.size[c] !== v) { this.size[c] = v; this._geo = null; } } };
  }

  setSizeX(v) { v = F(v); if (this.size.x !== v) { this.size.x = v; this._geo = null; } }

  // local geometry: {pos: [[x, y, 0]], uv: [[u, v]], idx: [...]} (no colour)
  geometry() {
    if (this._geo) return this._geo;
    const s = this.sprite;
    let g;
    if (this.drawMode === 0) {
      g = { pos: s.vertices.map((v) => [F(v[0]), F(v[1]), F(v[2] || 0)]), uv: s.uv.map((u) => [F(u[0]), F(u[1])]), idx: s.indices.slice() };
    } else {
      const W = this.size.x, H = this.size.y, ppu = s.ppu;
      const tw = s.texture.width, th = s.texture.height;
      let L = F(s.border.x / ppu), R = F(s.border.z / ppu), B = F(s.border.y / ppu), T = F(s.border.w / ppu);
      if (L + R > W && L + R > 0) { const k = W / (L + R); L = F(L * k); R = F(R * k); }       // border shrink
      if (B + T > H && B + T > 0) { const k = H / (B + T); B = F(B * k); T = F(T * k); }
      const x0 = F(-s.pivot.x * W), x3 = F(x0 + W), y0 = F(-s.pivot.y * H), y3 = F(y0 + H);
      const xs = [x0, F(x0 + L), F(x3 - R), x3], ys = [y0, F(y0 + B), F(y3 - T), y3];
      const r = s.rect;
      const us = [r.x, r.x + s.border.x, r.x + r.width - s.border.z, r.x + r.width].map((p) => F(p / tw));
      const vs = [r.y, r.y + s.border.y, r.y + r.height - s.border.w, r.y + r.height].map((p) => F(p / th));
      const pos = [], uv = [], idx = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        if (!(xs[i + 1] > xs[i]) || !(ys[j + 1] > ys[j])) continue;       // empty cell (zero border / zero size)
        const b = pos.length;
        for (const [a, c] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { pos.push([xs[a], ys[c], 0]); uv.push([us[a], vs[c]]); }
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      g = { pos, uv, idx };
    }
    if (this.flipX || this.flipY) g.pos = g.pos.map(([x, y, z]) => [this.flipX ? -x : x, this.flipY ? -y : y, z]);
    this._geo = g;
    return g;
  }

  // vertex buffer for FxMaterial.draw: POSITION float3, COLOR float4 (Color32 values), TEXCOORD0 float2
  mesh() {
    const g = this.geometry(), n = g.pos.length, stride = 9, verts = new Float32Array(n * stride);
    const c32 = (x) => Math.round(Math.min(Math.max(x, 0), 1) * 255) / 255;
    const col = this.color.map(c32);
    for (let k = 0; k < n; k++) {
      const o = k * stride;
      verts[o] = g.pos[k][0]; verts[o + 1] = g.pos[k][1]; verts[o + 2] = g.pos[k][2];
      verts[o + 3] = col[0]; verts[o + 4] = col[1]; verts[o + 5] = col[2]; verts[o + 6] = col[3];
      verts[o + 7] = g.uv[k][0]; verts[o + 8] = g.uv[k][1];
    }
    return { verts, stride, attribs: { in_POSITION0: [3, 0], in_COLOR0: [4, 3], in_TEXCOORD0: [2, 7] },
             idx: n > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx) };
  }

  // world-space AABB centre of the mesh (sorting distance)
  worldCenter(M = this.transform.localToWorld()) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.geometry().pos) {
      const w = mat4.transformPoint(M, { x: p[0], y: p[1], z: p[2] });
      const a = [w.x, w.y, w.z];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); }
    }
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  }

  // Submission item for renderer.submit or null. camPos: [x, y, z] of the camera (Euclidean distance to the bounds centre,
  // as the particle items compute it) or null.
  drawItem(camPos = null) {
    if (!this.enabled || !this.geometry().idx.length) return null;
    const M = this.transform.localToWorld();
    const c = this.worldCenter(M);
    const distance = camPos ? Math.hypot(c[0] - camPos[0], c[1] - camPos[1], c[2] - camPos[2]) : 0;
    const queue = this.material ? this.material.queue
      : (this.materialRecord.renderQueue >= 0 ? this.materialRecord.renderQueue : null);
    const mesh = this.mesh();
    return { sortingLayer: this.sortingLayer, sortingOrder: this.sortingOrder, queue, distance, name: this.name, sprite: this,
             draw: (ctx) => this.draw(ctx, mesh, M) };
  }

  // Unity binds the sprite texture as _MainTex through a MaterialPropertyBlock (the material's _MainTex_ST stays).
  draw(ctx, mesh = this.mesh(), M = this.transform.localToWorld()) {
    if (!this.material) return;
    if (!this.texture) {
      if (!this._warned) { this._warned = true; console.warn(`FxSpriteRenderer ${this.name}: sprite texture not loaded`); }
      return;
    }
    const t = this.texture;
    this.material.draw(ctx, mesh, M, { _MainTex: t, _MainTex_TexelSize: [1 / t.width, 1 / t.height, t.width, t.height] });
  }
};

// ------------------------------------------------------------------------------------------ prefab instance
// One instance of an exported effect prefab (notes.json assets[key].nodes) inside its pool element: the element
// GameObject (clone of the scene placeholder container_root/prefabs/<name>, identity, the LiveGameNoteEffectBase /
// LiveGameLaneEffectBase host) -> placeholder child `root` (identity, _prefabAssetRoot) -> the prefab root.
//   Components: Animator (controller from notes.controllers, clips from notes.clips, shared between instances like
//   Unity's assets), SpriteRenderers (FxSpriteRenderer), ParticleSystems (FxParticleSystem, children filled in
//   hierarchy order), Live{Renderer,Particle}OrderInLayerSetter, LiveNoteEffectAsset / LiveLaneEffectAsset (width
//   fitting, Play / Stop), AnimationFinishEventTrigger (event at clip.length -> onStop).
//   GameObject activity: activeSelf per node, activeInHierarchy propagated; a change of activeInHierarchy calls
//   FxParticleSystem.onActiveChanged and enables / disables the Animator (OnEnable resets it:
//   keepAnimatorStateOnDisable false on every effect Animator).
// ENGINE: activation is native; OnEnable / OnDisable run immediately inside SetActive and m_IsActive writes, parent first.
// The order among siblings has no visible effect here.
export class FxPrefab {
  // exported: notes.assets[key]; opts {notes (livenotes/notes.json), materials (FxMaterials | null),
  // rng (UnityRandom), parent (Transform of the pool container), cache ({clips: Map, ctrls: Map}, shared), name}
  constructor(exported, { notes, materials = null, rng = null, parent = null, cache = null, name = "" } = {}) {
    this.key = exported.key;
    this.name = name || exported.key;
    this.notes = notes;
    this.cache = cache || { clips: new Map(), ctrls: new Map() };
    const pf = new Prefab(exported);
    this.prefab = pf;
    // element (placeholder clone) and its `root` child: identity transforms (as in the scene)
    this.element = new Transform(`${pf.root.name}(element)`, parent);
    this.placeholderRoot = new Transform("root", this.element);
    pf.root.setParent(this.placeholderRoot);
    this.parentActive = true;                 // container chain LiveGameView/.../container_root/<type>: always active
    const mk = (path, transform, activeSelf, parentEntry) => {
      const e = { path, transform, activeSelf, aih: false, parent: parentEntry, children: [], node: null,
                  system: null, sprite: null };
      if (parentEntry) parentEntry.children.push(e);
      return e;
    };
    // the element starts inactive (pool: LiveViewElementBase.SetActive(false) after the clone, AddCapacity)
    this.elementEntry = mk("", this.element, false, null);
    const placeholder = mk("", this.placeholderRoot, true, this.elementEntry);
    this.entries = new Map();                 // prefab path -> entry
    this.order = [];                          // hierarchy order
    for (const [path, { node, transform }] of pf.nodes) {
      const cut = path.lastIndexOf("/");
      const pe = cut < 0 ? placeholder : this.entries.get(path.slice(0, cut));
      const e = mk(path, transform, !!node.active, pe);
      e.node = node;
      this.entries.set(path, e);
      this.order.push(e);
    }
    // components
    this.systems = []; this.sprites = [];
    this.asset = null; this.assetClass = null;
    this.animatorEntry = null; this.animatorComp = null;
    const setters = [];
    const cls = (c) => c.class || c.type;
    for (const e of this.order) {
      const comps = e.node.components;
      for (const c of comps) {
        const k = cls(c);
        if (k === "ParticleSystem") {
          const r = comps.find((x) => cls(x) === "ParticleSystemRenderer") || null;
          e.system = new FxParticleSystem(c, r, e.transform, { rng, materials, name: `${this.key}:${e.path}` });
          this.systems.push(e.system);
        } else if (k === "SpriteRenderer") {
          e.sprite = new FxSpriteRenderer(c, e.transform, { materials, name: `${this.key}:${e.path}` });
          this.sprites.push(e.sprite);
        } else if (k === "Animator") {
          if (this.animatorEntry) throw new FxEffectsError(`${this.key}: two Animators`);
          this.animatorEntry = e; this.animatorComp = c;
        } else if (k === "LiveNoteEffectAsset" || k === "LiveLaneEffectAsset") {
          if (this.asset) throw new FxEffectsError(`${this.key}: two effect assets`);
          this.asset = c; this.assetClass = k;
        } else if (k === "LiveRendererOrderInLayerSetter" || k === "LiveParticleOrderInLayerSetter") {
          setters.push(c);
        } else if (k === "LiveGameParticleCallback") {
          e.particleCallback = true;
        } else if (k !== "ParticleSystemRenderer") {
          throw new FxEffectsError(`${this.key}:${e.path}: component ${k} not implemented`);
        }
      }
    }
    // ParticleSystem.Play/Stop/Clear(withChildren): the nearest ParticleSystems below each system, hierarchy order
    const below = (e, out) => { for (const c of e.children) { if (c.system) out.push(c.system); else below(c, out); } return out; };
    for (const e of this.order) if (e.system) e.system.children = below(e, []);
    // Live*OrderInLayerSetter.Awake: sortingOrder = GetOrderInLayer(_orderInLayer) + _offset.
    // Awake runs at the first activation; the result equals the serialized m_SortingOrder of every effect
    // renderer (checked), so applying it at construction is equivalent.
    for (const c of setters) {
      const base = FX_ORDER_IN_LAYER[c._orderInLayer];
      if (base === undefined) throw new FxEffectsError(`${this.key}: GetOrderInLayer(${c._orderInLayer}) not tabulated`);
      const ref = c._renderer || c._particleSystemRenderer;
      const e = this.entries.get(ref.gameObject);
      if (!e) throw new FxEffectsError(`${this.key}: order setter target ${ref.gameObject}`);
      if (ref.component === "SpriteRenderer") e.sprite.sortingOrder = base + c._offset;
      else e.system.sortingOrder = base + c._offset;
    }
    // every system starts inactive with its element
    for (const s of this.systems) s.onActiveChanged(false);
    // Animator
    this.animator = null;
    this.animatorComponentEnabled = false;
    this.animatorOn = false;
    if (this.animatorEntry) this._buildAnimator(this.animatorComp);
    // effect base state (LiveGameNoteEffectBase / LiveGameLaneEffectBase)
    this.isPlaying = false;                   // _isPlaying
    this.onStop = null;                       // _onStopCallback (Action<effect>)
    this.viewType = 0;
    this.baseLaneWidth = 0;
    this.finishTriggers = 0;
  }

  entry(path) {
    const e = this.entries.get(path);
    if (!e) throw new FxEffectsError(`${this.key}: no node ${path}`);
    return e;
  }

  // entry below `base` by an Animator binding path ("" = base itself); null when there is no such object
  _entryAt(base, rel) {
    if (rel === "") return base;
    return this.entries.get(`${base.path}/${rel}`) || null;
  }

  // referenced component -> entry ({component, gameObject} / {transform})
  _ref(ref) {
    const path = ref && (ref.gameObject || ref.transform);
    if (!path) throw new FxEffectsError(`${this.key}: bad reference ${JSON.stringify(ref)}`);
    return this.entry(path);
  }

  // ----------------------------------------------------------------------------------------- activity
  get activeInHierarchy() { return this.elementEntry.aih; }

  isActive(path) { return this.entry(path).aih; }

  setActive(e, v) {
    v = !!v;
    if (e.activeSelf === v) return;
    e.activeSelf = v;
    this._propagate(e);
  }

  // GameObject.SetActive of the element (effect.gameObject)
  setElementActive(v) { this.setActive(this.elementEntry, v); }

  _propagate(e) {
    const aih = e.activeSelf && (e.parent ? e.parent.aih : this.parentActive);
    if (aih === e.aih) return;
    e.aih = aih;
    if (e.system) e.system.onActiveChanged(aih);
    if (e === this.animatorEntry) this._syncAnimator();
    for (const c of e.children) this._propagate(c);
  }

  // ----------------------------------------------------------------------------------------- Animator
  _clip(key) {
    const cs = this.cache.clips;
    if (!cs.has(key)) {
      const raw = this.notes.clips[key];
      if (!raw) throw new FxEffectsError(`clip ${key} not exported`);
      const clip = AnimClip.fromMecanim(raw, key);
      clip.rawName = raw.name;                // AnimationClip.name (AnimationFinishEventTrigger matches it)
      cs.set(key, clip);
    }
    return cs.get(key);
  }

  _buildAnimator(comp) {
    if (comp.m_KeepAnimatorStateOnDisable || comp.m_WriteDefaultValuesOnDisable || comp.m_UpdateMode !== 0 || comp.m_ApplyRootMotion)
      throw new FxEffectsError(`${this.key}: Animator settings not implemented`);
    const key = comp.m_Controller && comp.m_Controller.controller;
    if (!key || !this.notes.controllers[key]) throw new FxEffectsError(`${this.key}: controller ${key} not exported`);
    let ctrl = this.cache.ctrls.get(key);
    if (!ctrl) {
      ctrl = AnimController.fromMecanim(this.notes.controllers[key], (k) => this._clip(k));
      ctrl.clipList = this.notes.controllers[key].clips.map((c) => this._clip(c.clip));   // runtimeAnimatorController.animationClips
      this.cache.ctrls.set(key, ctrl);
    }
    this.controller = ctrl;
    this.unresolved = [];
    this.animator = new Animator(ctrl, (b) => {
      const acc = this._bind(b);
      if (!acc) this.unresolved.push(`${b.path}:${b.cls}.${b.attr}`);
      return acc;
    }, `${this.key}:${ctrl.name}`);
    this.animator.enabled = false;
    this.animator.onEvent = (ev) => this._animationEvent(ev);
    this.animatorComponentEnabled = !!comp.m_Enabled;
  }

  // Animator binding (path relative to the Animator's GameObject) -> accessor | null (Unity skips the curve).
  // ENGINE: GameObject.m_IsActive from a float curve: active when the value is > 0.5.
  // (Every effect key is exactly 0 or 1 with constant segments, so any threshold in (0, 1) gives the same result.)
  _bind(b) {
    const e = this._entryAt(this.animatorEntry, b.path);
    if (!e) return null;
    if (b.cls === "GameObject") {
      if (b.attr !== "m_IsActive") return null;
      return { get: () => (e.activeSelf ? 1 : 0), set: (v) => this.setActive(e, v > 0.5) };
    }
    if (b.cls === "Transform") return AnimTargets.transform(e.transform, b.attr);
    if (b.cls === "SpriteRenderer") return e.sprite ? e.sprite.accessor(b.attr) : null;
    if (b.cls === "ParticleSystem") return e.system ? e.system.accessor(b.attr) : null;
    return null;
  }

  // effective Animator activity = component enabled && GameObject active in hierarchy. OnEnable with
  // keepAnimatorStateOnDisable false: default state at time 0, parameters reset (Animator.reset).
  // Nothing is written back on disable (writeDefaultValuesOnDisable false); the bound default values are the ones
  // captured when the Animator is built here (the prefab values). The properties SetWidth changes before the first
  // activation (frame size, localScale / localPosition x, shape scale) are bound by no effect clip, so capturing the
  // defaults at the first OnEnable instead (Unity) gives the same values.
  _syncAnimator() {
    const on = this.animatorComponentEnabled && !!this.animatorEntry && this.animatorEntry.aih;
    if (on === this.animatorOn) return;
    this.animatorOn = on;
    this.animator.enabled = on;
    if (on) this.animator.reset();
  }

  setAnimatorEnabled(v) {
    if (!this.animator) return;
    this.animatorComponentEnabled = !!v;
    this._syncAnimator();
  }

  // PreLateUpdate DirectorUpdateAnimation (update mode Normal: scaled delta time)
  animate(dt) { if (this.animator && this.animatorOn) this.animator.update(dt); }

  // AnimationEvent "OnFinishAnimationTrigger": Unity sends it to every component of the Animator's GameObject that
  // has the method, i.e. to each AnimationFinishEventTrigger.Trigger added by Initialize (one per _animSetArray entry);
  // each calls LiveGameNoteEffectBase.OnStopCallback -> _onStopCallback(this).
  // AnimationEvent dispatch is native; whether the remaining receivers still get the message after the first one
  // deactivated the GameObject does not matter: OnStopEffect is idempotent (HashSet remove, pool HashSet).
  _animationEvent(ev) {
    if (ev.functionName !== "OnFinishAnimationTrigger") return;
    for (let i = 0; i < this.finishTriggers; i++) this._onStopCallback();
  }

  _onStopCallback() { if (this.onStop) this.onStop(this); }

  // ----------------------------------------------------------------------------------------- effect base
  // LiveGameNoteEffectBase.Initialize (viewType, baseLaneWidth): per _animSetArray entry an
  // AnimationFinishEventTrigger(animator, clipName, OnStopCallback): AddComponent<Trigger> on the Animator's GameObject,
  // and, on the controller clip named clipName that has no "OnFinishAnimationTrigger" event yet, AddEvent(time =
  // clip.length, stringParameter = clip name). The clips are shared assets, so the event is added once per clip.
  // LiveGameLaneEffectBase.Initialize: the LiveGameParticleCallback action of `_parentParticleCallback`
  // (stopAction Callback of `base`) clears _isPlaying and calls _onStopCallback.
  initialize(viewType, baseLaneWidth = 0) {
    this.viewType = viewType;
    this.baseLaneWidth = F(baseLaneWidth);
    if (this.assetClass === "LiveNoteEffectAsset") {
      const a = this.asset;
      if (a._animator && this._ref(a._animator) !== this.animatorEntry) throw new FxEffectsError(`${this.key}: _animator`);
      for (const set of a._animSetArray) {
        this.finishTriggers++;
        const clip = this.controller.clipList.find((c) => c.rawName === set.clipName);
        if (clip && !clip.events.some((e) => e.functionName === "OnFinishAnimationTrigger"))
          clip.addEvent({ time: clip.length, functionName: "OnFinishAnimationTrigger", stringParameter: clip.rawName });
      }
    } else if (this.assetClass === "LiveLaneEffectAsset") {
      const a = this.asset;
      this.baseSystem = this._ref(a._parentParticleSystem).system;
      this.widthSystem = this._ref(a._setupWidthParticleSystem).system;
      const cb = this._ref(a._parentParticleCallback);
      if (!cb.particleCallback || cb.system !== this.baseSystem) throw new FxEffectsError(`${this.key}: particle callback`);
      this.baseSystem.onStopped = () => { this.isPlaying = false; this._onStopCallback(); };
    } else {
      throw new FxEffectsError(`${this.key}: no effect asset`);
    }
  }

  // LiveGameNoteEffectBase.SetWidth / LiveGameLaneEffectBase.SetWidth
  setWidth(width) {
    width = F(width);
    const a = this.asset, max0 = (v) => (0 <= v ? v : 0);
    if (this.assetClass === "LiveNoteEffectAsset") {
      for (const p of a._particleShapeWidthSetParams) {                 // shape.scale.x = max(0, offset + width)
        const acc = this._ref(p.particleSystem).system.accessor("ShapeModule.m_Scale.x");
        acc.set(max0(F(F(p.scaleOffset) + width)));
      }
      for (const p of a._spriteRendererWidthSetParams)                   // SpriteRenderer.size.x = max(0, offset + width)
        this._ref(p.spriteRenderer).sprite.setSizeX(max0(F(F(p.sizeOffset) + width)));
      for (const p of a._transformWidthSetParams)                        // localScale.x = max(0, offset + width)
        this._ref(p.transform).transform.localScale.x = max0(F(F(p.scaleOffset) + width));
      for (const p of a._transformWidthSetRangeParams)                   // localScale.x = max(0, lerp(min, max, w / base))
        this._ref(p.transform).transform.localScale.x =
          max0(FxLiveMath.earlyFloatLerp(F(p.min), F(p.max), F(width / this.baseLaneWidth), true));
      for (const p of a._leftCenterWidthSetParams)                       // localPosition.x = width * 0.5 + offset
        this._ref(p.transform).transform.localPosition.x = F(F(width * 0.5) + F(p.posOffset));
      for (const p of a._rightCenterWidthSetParams)                      // localPosition.x = offset - width * 0.5
        this._ref(p.transform).transform.localPosition.x = F(F(p.posOffset) - F(width * 0.5));
    } else {
      // main.startSizeX = width (MinMaxCurve constant); the left / right lists of every lane prefab are empty
      this.widthSystem.setConstant("InitialModule.startSize", width);
      if (a._leftCenterWidthSetParams.length || a._rightCenterWidthSetParams.length)
        throw new FxEffectsError(`${this.key}: lane effect centre width params not implemented`);
    }
  }

  // Transform.position of the element. Every parent of the element is identity in the scene
  // (LiveGameView/root included, its Animator `live_game_view` is not modelled), so position = localPosition.
  setPosition(p) { this.element.localPosition = { x: F(p.x), y: F(p.y), z: F(p.z) }; }

  // LiveGameNoteEffectBase.Play: stop if playing, _isPlaying = 1, animator.enabled = true,
  // animType = static table[judgement - 2] = {Bad 4, Good 3, Great 2, Perfect 1, Just 1} (0 outside 2..6),
  // Animator.Play(_playStateHashDictionary[animType]).
  // LiveGameLaneEffectBase.Play: stop if playing, _isPlaying = 1, _parentParticleSystem.Play().
  play(judgement = 5) {
    if (this.isPlaying) this.stop();
    this.isPlaying = true;
    if (this.assetClass === "LiveLaneEffectAsset") { this.baseSystem.play(true); return; }
    this.setAnimatorEnabled(true);
    const animType = judgement - 2 >= 0 && judgement - 2 < 5 ? [4, 3, 2, 1, 1][judgement - 2] : 0;
    const set = this.asset._animSetArray.find((s) => s.animType === animType);
    if (!set) throw new FxEffectsError(`${this.key}: no state for animType ${animType}`);   // KeyNotFoundException
    // Animator.Play(int stateNameHash) = Play(hash, layer -1, normalizedTime -Infinity).
    // ENGINE: Play with normalizedTime -Infinity does not restart a state that is already the current one.
    // Here the Animator was just re-enabled (default state `none`), so the state always starts at time 0.
    if (!(this.animator.state.name === set.stateName && !this.animator.fade)) this.animator.play(set.stateName, 0);
  }

  // LiveGameNoteEffectBase.Stop: _isPlaying = 0, animator.enabled = false.
  // LiveGameLaneEffectBase.Stop: _isPlaying = 0, base.Clear(), base.Stop() (withChildren, StopEmitting).
  stop() {
    this.isPlaying = false;
    if (this.assetClass === "LiveLaneEffectAsset") {
      this.baseSystem.clear(true);
      this.baseSystem.stop(true, PS_STOP.StopEmitting);           // ParticleSystem.Stop() = Stop(true, StopEmitting)
      return;
    }
    this.setAnimatorEnabled(false);
  }

  // LiveGameNoteEffectBase.EnableAnimator
  enableAnimator() { this.setAnimatorEnabled(true); }

  // LiveGameNoteEffectBase.RestoreDefaultValues = Animator.WriteDefaultValues()
  restoreDefaultValues() { if (this.animator) this.animator.writeDefaultValues(); }

  // ----------------------------------------------------------------------------------------- per frame
  simulate(dt) { for (const e of this.order) if (e.system && e.aih) e.system.simulate(dt); }

  // renderer items of this frame (active GameObjects only), hierarchy order
  drawItems(camMatrix = null) {
    const out = [];
    const camPos = camMatrix ? [camMatrix[12], camMatrix[13], camMatrix[14]] : null;
    for (const e of this.order) {
      if (!e.aih) continue;
      if (e.sprite) { const it = e.sprite.drawItem(camPos); if (it) out.push(it); }
      if (e.system) { const it = e.system.drawItem(camMatrix); if (it) out.push(it); }
    }
    return out;
  }

  load() { return Promise.all(this.sprites.map((s) => s.load())); }
};

// ------------------------------------------------------------------------------------------ element pool
// LiveViewElementContainerBase<T> (Rent, Return, AddCapacity): a Stack (LIFO) plus
// a HashSet of pooled elements. AddCapacity(n) clones n elements (initialize, SetActive(false), push). Rent: empty
// stack -> AddCapacity(_insufficientCapacity) synchronously; then, if Count < _shortageCapacity and no async
// instantiation runs, NotEnoughStacksLog + AddCapacityAsync(_insufficientCapacity).Forget(); Pop. Return: pushed only
// if the HashSet did not hold it (a second Return of the same element is a no-op).
// ENGINE: AddCapacityAsync (Object.InstantiateAsync) completes in a later frame chosen by the engine; here at the next update().
// It only changes the pool size, never what is drawn.
export class FxPool {
  constructor(create, { init, insufficient, shortage }) {
    this.create = create;
    this.insufficient = insufficient;
    this.shortage = shortage;
    this.stack = [];
    this.pooled = new Set();
    this.created = [];
    this.instantiating = false;
    this.pendingAsync = 0;
    this.notEnoughLogs = 0;
    this.addCapacity(init);
  }

  addCapacity(n) {
    for (let i = 0; i < n; i++) {
      const e = this.create(this.created.length);
      e.setElementActive(false);
      this.created.push(e);
      this.stack.push(e);
      this.pooled.add(e);
    }
  }

  rent() {
    if (!this.stack.length) this.addCapacity(this.insufficient);
    if (this.stack.length < this.shortage && !this.instantiating) {
      this.notEnoughLogs++;
      this.instantiating = true;
      this.pendingAsync = this.insufficient;
    }
    const e = this.stack.pop();
    this.pooled.delete(e);
    return e;
  }

  return(e) {
    if (this.pooled.has(e)) return;
    this.pooled.add(e);
    this.stack.push(e);
  }

  tick() {
    if (!this.instantiating) return;
    this.addCapacity(this.pendingAsync);
    this.pendingAsync = 0;
    this.instantiating = false;
  }

  get count() { return this.stack.length; }
};

// ------------------------------------------------------------------------------------------ note -> effect type
export const FxEffectTypes = {
  // NoteDirection of the runtime note (score json "Normal" / "Left" / "Right", or 0 / 1 / 2)
  dir(note) {
    const d = note.direction;
    if (d === "Normal" || d === 0) return 0;
    if (d === "Left" || d === 1) return 1;
    if (d === "Right" || d === 2) return 2;
    throw new FxEffectsError(`note ${note.id}: direction ${d}`);
  },

  // LiveNoteEffectViewUtility.ConvertToLiveNoteEffectViewType (slide table {20, 21, 20};
  // flicks FlickNoteConvertToLiveNoteEffectViewType). Gekisou checks are false outside gekisou (no
  // Performance 50). InvalidHidden 123 and unlisted values give Undefined 0 + Debug.LogError; the
  // Rent(0) that follows is not modelled, so type 0 raises in playNoteEffect.
  note(note) {
    const op = note.op;
    if (op === 1 || op === 101) return 10;
    if (op >= 20 && op <= 22) return [20, 21, 20][op - 20];
    if ((op >= 40 && op <= 42) || op === 102) return [30, 31, 32][FxEffectTypes.dir(note)];
    if ((op >= 60 && op <= 63) || op === 104 || op === 105) return 21;
    if (op === 80 || op === 82 || op === 100 || op === 103 || (op >= 120 && op <= 122)) return 1;
    return 0;
  },

  // LiveLaneEffectViewUtility.ConvertToLiveNoteEffectViewType (flicks: FlickLaneConvertToLiveNoteEffectViewType);
  // SlideConnection and every trace / hidden / guide-end kind have no lane effect.
  lane(note) {
    const op = note.op;
    if (op === 1 || op === 101) return 10;
    if (op === 20 || op === 22) return 20;
    if ((op >= 40 && op <= 42) || op === 102) return [30, 31, 32][FxEffectTypes.dir(note)];
    if (op === 21 || (op >= 60 && op <= 63) || op === 80 || op === 82 || op === 100 || op === 103 || op === 104 ||
        op === 105 || (op >= 120 && op <= 122)) return 1;
    return 0;
  },
};

// ------------------------------------------------------------------------------------------ judgement root 3D
// LiveNoteJudgementRoot3D.Initialize(24, (float)19.12) -> UpdateProperties: 24 children under pos_root with
// local x accumulated in float32: x0 = (w / n) * 0.5 - w * 0.5, x(i+1) = w / n + x(i); pos_root identity.
export class FxJudgementRoot3D {
  // rootMatrix: localToWorld of LiveGameView/root/LiveGameLane/judgement_root (renderer.frames.laneJudgementRoot3D)
  constructor(laneCount, laneWidth, rootMatrix) {
    const w = F(laneWidth), step = F(w / F(laneCount));
    this.local = [];
    let x = F(F(step * 0.5) - F(w * 0.5));
    for (let i = 0; i < laneCount; i++) { this.local.push(x); x = F(step + x); }
    this.setRoot(rootMatrix);
  }

  // children world positions (Transform.position).
  // ENGINE: the native TRS chain rounds in float32; here M * p in double, rounded to float32.
  // (Exact for the identity-rotation / unit-scale root of the scene.)
  setRoot(M) {
    this.M = M;
    this.positions = this.local.map((x) => {
      const p = mat4.transformPoint(M, { x, y: 0, z: 0 });
      return { x: F(p.x), y: F(p.y), z: F(p.z) };
    });
  }

  // GetNoteJudgementPosition(int) (out of range -> Vector3.zero)
  at(i) { return i >= 0 && i < this.positions.length ? this.positions[i] : { x: 0, y: 0, z: 0 }; }

  // GetNoteJudgementPosition(float lane): i = (int)lane (truncation), a = P[clamp(i)], b = P[clamp(i + 1)],
  // f = clamp01(lane - i), a + f (b - a) per component (float32)
  atLane(lane) {
    const n1 = this.positions.length - 1;
    const i = Math.trunc(lane);
    const ia = i >= 0 ? Math.min(i, n1) : 0, ib = i + 1 >= 0 ? Math.min(i + 1, n1) : 0;
    const d = F(lane - i), f = d <= 1 ? (d >= 0 ? d : 0) : 1;
    const a = this.at(ia), b = this.at(ib);
    return { x: F(a.x + F(f * F(b.x - a.x))), y: F(a.y + F(f * F(b.y - a.y))), z: F(a.z + F(f * F(b.z - a.z))) };
  }
};

// identity container chain of the scene (…/container_root/<name>)
export const FxContainerChain = (names) => {
  let t = null;
  for (const n of names) t = new Transform(n, t);
  return t;
};

// ------------------------------------------------------------------------------------------ note effects
// LiveAllNoteEffectView (LiveGameView/root/LiveGameNoteEffectView): one-shot note effects per judged note and the
// slide hold loop per held long line. Effects are drawn by LiveEffectCamera (layer 29): camera "effect".
export class LiveNoteEffects {
  // opts {notes (livenotes/notes.json), score (score/<file>.notes.json), materials (FxMaterials), rng (UnityRandom),
  //       sceneInfo (FxScene.read(scene)), judgementRoot3D (localToWorld of judgement_root; default = sceneInfo),
  //       effect (the effect set's asset name, NoteEffectId; default notes.settings.effect)}
  constructor(gl, { notes, score, sceneInfo, materials = null, rng = null, judgementRoot3D = null, effect = null } = {}) {
    if (!sceneInfo) throw new FxEffectsError("LiveNoteEffects: sceneInfo (FxScene.read) missing");
    this.gl = gl;
    this.notes = notes;
    this.score = score;
    this.materials = materials;
    this.rng = rng;
    this.cache = { clips: new Map(), ctrls: new Map() };
    // effect set: MasterLiveNoteEffectSkin of NoteEffectId (default 1 -> effect001), LiveQuality Middle -> not the
    // Light set (SoloLiveResourceLoadStateNode.CreateLoadParameter)
    const dir = `Effect/Live/NoteEffect/${effect || notes.settings.effect}`;
    const settings = notes.assets[`${dir}/LiveNoteEffectAssetSettings`];
    if (!settings) throw new FxEffectsError(`${dir}/LiveNoteEffectAssetSettings not exported`);
    this.laneCount = score.laneCount;                                  // _maxLaneCount (24)
    this.baseLaneWidth = F(sceneInfo.laneWidth);                     // (float)LiveLaneView._laneWidth
    // FullInitialize: judgement positions of the 3D root (LiveLaneView.noteJudgementRoot3D) cached once
    this.root3D = new FxJudgementRoot3D(this.laneCount, sceneInfo.laneWidth,
                                           judgementRoot3D || sceneInfo.judgementRoot);
    this.cachePositions = this.root3D.positions.map((p) => ({ ...p }));   // _judgePositionCache (not re-read)
    const c0 = this.cachePositions[0], c1 = this.cachePositions[1];
    this.oneWidthUnit = F(c1.x - c0.x);                                // _oneWidthUnit
    this.laneWidthVec = { x: F(c1.x - c0.x), y: F(c1.y - c0.y), z: F(c1.z - c0.z) };   // _laneWidth
    this.laneMinPointX = -0.5;                                         // _laneMinPointX
    this.laneMaxPointX = F(this.laneCount - 0.5);                      // _laneMaxPointX
    // LiveAllNoteEffectViewContainer.Initialize: one LiveGameNoteEffectContainer per type
    this.pools = new Map();
    for (const c of sceneInfo.noteContainers) {
      const ref = settings[c.field];
      if (!ref || !ref.gameObject) throw new FxEffectsError(`${dir}: ${c.field} missing`);
      const key = `${dir}/${ref.gameObject}`, exported = notes.assets[key];
      if (!exported) throw new FxEffectsError(`${key} not exported`);
      const parent = FxContainerChain(["LiveGameView", "root", "LiveGameNoteEffectView", "container_root", c.name]);
      const create = (i) => {
        const e = new FxPrefab(exported, { notes, materials, rng, parent, cache: this.cache, name: `${c.name}#${i}` });
        e.initialize(c.type, this.baseLaneWidth);                      // OnInitializeElementView
        return e;
      };
      const pool = new FxPool(create, c);
      pool.name = c.name; pool.key = key;
      this.pools.set(c.type, pool);
    }
    this.activeOneShot = new Set();                                    // _activeOneShotEffects
    this.lineEffects = new Map();                                      // _lineNoteEffectDictionary (lineId -> effect)
    // runtime lines (INoteLine): type 1 Long / 2 Guide, start / end note, connect units of consecutive nodes
    this.noteById = new Map(score.notes.map((n) => [n.id, n]));
    this.lines = new Map();
    for (const l of score.lines) this.lines.set(l.lineId, LiveNoteEffects.lineOf(l, this.noteById));
    this.log = [];                                                     // diagnostics: [{frame, what, ...}]
    this.frame = 0;
  }

  // NoteLine + NoteLineConnectUnit..ctor: StartCenterLane = (LaneStartFloat + LaneEndFloat) * 0.5,
  // StartWidth = Width (same for End), ease = StartNote.LineEaseType.
  static lineOf(l, noteById) {
    const nodes = l.noteIds.map((id) => {
      const n = noteById.get(id);
      if (!n) throw new FxEffectsError(`line ${l.lineId}: note ${id} missing`);
      return n;
    });
    const type = l.type === "long" ? 1 : l.type === "guide" ? 2 : 0;
    if (!type) throw new FxEffectsError(`line ${l.lineId}: type ${l.type}`);
    const center = (n) => F(F(F(n.laneStartFloat) + F(n.laneEndFloat)) * 0.5);
    const units = [];
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const ease = FxLiveMath.EASE[a.lineEase];
      if (ease === undefined) throw new FxEffectsError(`note ${a.id}: lineEase ${a.lineEase}`);
      units.push({ t0: a.timeMs, t1: b.timeMs, c0: center(a), c1: center(b), w0: F(a.width), w1: F(b.width), ease });
    }
    return { lineId: l.lineId, type, startMs: nodes[0].timeMs, endMs: nodes[nodes.length - 1].timeMs, units };
  }

  load() { return Promise.all([...this.pools.values()].flatMap((p) => p.created.map((e) => e.load()))); }

  pool(type) {
    const p = this.pools.get(type);
    if (!p) throw new FxEffectsError(`note effect type ${type}: no container`);   // type 0 (Undefined): see FxEffectTypes.note
    return p;
  }

  // LiveAllNoteEffectView.UpdateFrame
  update(fr) {
    this.frame++;
    for (const p of this.pools.values()) p.tick();
    // 1. one-shot effects in GetCurrentFrameJudgementNoteIdList order: type != None and judgement in Bad..Just
    for (const jn of fr.judgedNotes || []) {
      const note = jn.note || this.noteById.get(jn.id);
      const type = FxEffectTypes.note(note);
      if (type === 1) continue;
      const j = jn.judgement;
      if (j - 2 >= 0 && j - 2 < 5) this.playNoteEffect(type, j, note.laneStart, note.laneEnd, note.id);
    }
    const now = fr.timeMs;                                             // GetSimulatePosition().TimeMs
    // 2. new hold loops: Long line, state Playing, enabled, StartNote.TimeMs < now < EndNote.TimeMs, not yet held
    for (const id of fr.updateLineIds || []) {
      const line = this.lines.get(id);
      if (!line) throw new FxEffectsError(`line ${id} not in score`);
      if (line.type !== 1) continue;
      const st = fr.lineState(id);
      if (st.state !== 1 || !st.enabled) continue;
      if (!(line.startMs < now && now < line.endMs)) continue;
      if (this.lineEffects.has(id)) continue;
      this.lineEffects.set(id, this.getLineEffect());
      this.log.push({ frame: this.frame, what: "loop-rent", lineId: id, timeMs: now });
    }
    // 3. every held loop: follow the line while it is Playing and enabled, else release
    const remove = [];
    for (const [id, eff0] of this.lineEffects) {
      const st = fr.lineState(id);
      let eff = eff0;
      if (st.state === 1 && st.enabled) {
        if (!eff) { eff = this.getLineEffect(); eff.setElementActive(true); this.lineEffects.set(id, eff); }
        const line = this.lines.get(id);
        let u = null;
        for (const unit of line.units) if (unit.t0 <= now && now <= unit.t1) u = unit;   // the last covering unit
        if (!u) continue;
        let t = u.t1 - u.t0 !== 0 ? F(F(now - u.t0) / F(u.t1 - u.t0)) : 1;
        t = FxLiveMath.lineEase(t, u.ease);
        const c = FxLiveMath.earlyFloatLerp(u.c0, u.c1, t, true);
        const w = FxLiveMath.earlyFloatLerp(u.w0, u.w1, t, true);
        const cw = FxLiveMath.clampLaneAndWidth(c, w, this.laneMinPointX, this.laneMaxPointX);
        const pos = this.root3D.atLane(cw.center);
        eff.setWidth(F(cw.width * this.oneWidthUnit));
        eff.setPosition(pos);
        eff.setElementActive(true);
        eff.lineCenter = cw.center; eff.lineWidth = cw.width;          // diagnostics
      } else {
        eff.restoreDefaultValues();
        eff.setElementActive(false);
        this.pool(22).return(eff);
        remove.push(id);
        this.log.push({ frame: this.frame, what: "loop-return", lineId: id, timeMs: now });
      }
    }
    for (const id of remove) this.lineEffects.delete(id);
  }

  // LiveAllNoteEffectView.PlayNoteEffect.
  // ENGINE: the first Animator evaluation after Animator.Play in Update is taken at t = deltaTime (engine/anim.js convention).
  // So the children keyed on at 0.016666668 are visible on the spawn frame.
  playNoteEffect(type, judgement, fromLane, toLane, noteId = 0) {
    const from = Math.max(fromLane, 0), to = Math.min(toLane, this.laneCount - 1);
    const a = this.cachePositions[from].x, b = this.cachePositions[to].x, P = this.cachePositions[to];
    const e = this.pool(type).rent();
    e.setWidth(F(F(b - a) + this.laneWidthVec.x));
    e.setPosition({ x: FxLiveMath.earlyFloatLerp(a, b, 0.5, true), y: P.y, z: P.z });
    e.setElementActive(true);
    this.activeOneShot.add(e);
    e.onStop = (x) => this.onStopEffect(x);
    e.play(judgement);
    e.spawnFrame = this.frame; e.noteId = noteId;
    this.log.push({ frame: this.frame, what: "spawn", type, noteId, element: e.name });
    return e;
  }

  // GetLineEffect: Rent(SlideLoop 22) + EnableAnimator
  getLineEffect() {
    const e = this.pool(22).rent();
    e.enableAnimator();
    return e;
  }

  // OnStopEffect: remove, WriteDefaultValues, SetActive(false), Return(effect.ViewType)
  onStopEffect(e) {
    const was = this.activeOneShot.delete(e);
    e.restoreDefaultValues();
    e.setElementActive(false);
    this.pool(e.viewType).return(e);
    if (was) this.log.push({ frame: this.frame, what: "return", type: e.viewType, noteId: e.noteId, element: e.name });
  }

  *elements() { for (const p of this.pools.values()) yield* p.created; }

  // PreLateUpdate DirectorUpdateAnimation: every enabled, active effect Animator.
  // The order among Animators is engine-internal; no effect reads another one's output.
  animate(dt) { for (const e of this.elements()) if (e.animatorOn) e.animate(dt); }

  // ParticleSystem update after the Animators: every system of every active effect
  simulate(dt) { for (const e of this.elements()) if (e.activeInHierarchy) e.simulate(dt); }

  items(camMatrix = null) {
    const out = [];
    for (const e of this.elements()) if (e.activeInHierarchy) out.push(...e.drawItems(camMatrix));
    return out;
  }

  // SpriteRenderers and particle renderers of the active effects -> LiveEffectCamera ("effect", layer 29)
  submit(renderer) {
    const cam = renderer.frames && renderer.frames.game ? renderer.frames.game.localToWorld : null;
    for (const it of this.items(cam)) renderer.submit("effect", it);
  }
};

// ------------------------------------------------------------------------------------------ lane effects
export const LIVE_LANE_EFFECT_SET = "effect001";       // LaneEffectLoadStep.GetAssetPath
// LiveLaneEffectView (LiveGameView/root/LiveGameLaneEffectView): per container 24 permanent instances, one per
// lane; per frame the requested type per lane is played. Drawn by LiveGameCamera (layer 25): camera "game".
export class LiveLaneEffects {
  // The lane effect set does not follow NoteEffectId or LiveQuality: LaneEffectLoadStep.GetAssetPath passes the
  // constant "effect001" to LiveAddressablePath.GetLiveLaneEffectSkinAssetPath.
  constructor(gl, { notes, score, sceneInfo, materials = null, rng = null } = {}) {
    if (!sceneInfo) throw new FxEffectsError("LiveLaneEffects: sceneInfo (FxScene.read) missing");
    this.gl = gl;
    this.notes = notes;
    const dir = `Effect/Live/LaneEffect/${LIVE_LANE_EFFECT_SET}`;
    const settings = notes.assets[`${dir}/LiveLaneEffectAssetSettings`];
    if (!settings) throw new FxEffectsError(`${dir}/LiveLaneEffectAssetSettings not exported`);
    this.laneCount = score.laneCount;                                  // LiveLaneView lane count (24)
    this.noteById = new Map(score.notes.map((x) => [x.id, x]));
    this.cache = { clips: new Map(), ctrls: new Map() };
    // FullInitialize: width = (float)_laneWidth / laneCount, instance i at
    // (width * 0.5 + (width * i - (float)_laneWidth * 0.5), 0, 0) world, SetWidth(width), SetActive(true)
    const lw = F(sceneInfo.laneWidth), n = this.laneCount;
    this.width = F(lw / F(n));
    this.views = new Map();                                            // _effectViewDictionary (type -> [24])
    this.lists = new Map();                                            // _playEffectLaneIndexListDictionary
    this.pools = new Map();
    for (const c of sceneInfo.laneContainers) {
      const ref = settings[c.field];
      const key = `${dir}/${ref.gameObject}`, exported = notes.assets[key];
      if (!exported) throw new FxEffectsError(`${key} not exported`);
      const parent = FxContainerChain(["LiveGameView", "root", "LiveGameLaneEffectView", "container_root", c.name]);
      const create = (i) => {
        const e = new FxPrefab(exported, { notes, materials, rng, parent, cache: this.cache, name: `lane-${c.name}#${i}` });
        e.initialize(c.type);
        return e;
      };
      // LiveViewElementContainerBase.Initialize(laneCount) (not _initCapacity), then all of them rented
      const pool = new FxPool(create, { init: n, insufficient: 1, shortage: 0 });
      this.pools.set(c.type, pool);
      const arr = [];
      for (let i = 0; i < n; i++) {
        const e = pool.rent();
        arr.push(e);
        e.setWidth(this.width);
        e.setPosition({ x: F(F(this.width * 0.5) + F(F(this.width * F(i)) - F(lw * 0.5))), y: 0, z: 0 });
        e.setElementActive(true);
        e.onStop = (x) => this.onStopLaneEffect(x);
        e.lane = i;
      }
      this.views.set(c.type, arr);
      this.lists.set(c.type, []);
    }
    // StateInitialize: every instance Stop(), the groove container ReturnAll, lists cleared
    for (const arr of this.views.values()) for (const e of arr) e.stop();
    this.log = [];
    this.frame = 0;
  }

  load() { return Promise.all([...this.pools.values()].flatMap((p) => p.created.map((e) => e.load()))); }

  // OnStopLaneEffect: only the groove (type 50) instances are returned to their container
  onStopLaneEffect(e) { if (e.viewType === 50) throw new FxEffectsError("groove lane effect not implemented (gekisou only)"); }

  // LiveLaneEffectView.UpdateFrame
  update(fr) {
    this.frame++;
    // every list is cleared first (the dictionary enumeration at the top of UpdateFrame sets each List._size = 0)
    for (const l of this.lists.values()) l.length = 0;
    let requested = false;
    for (const jn of fr.judgedNotes || []) {
      const note = jn.note || this.noteById.get(jn.id);
      const type = FxEffectTypes.lane(note);
      if (type === 1) continue;
      const j = jn.judgement;
      if (!(j - 3 >= 0 && j - 3 <= 3)) continue;                       // Good .. Just
      if (type === 50) throw new FxEffectsError("gekisou lane effect not implemented");   // not reached (no gekisou)
      const list = this.lists.get(type);
      if (!list) throw new FxEffectsError(`lane effect type ${type}: no container`);   // KeyNotFoundException
      for (let i = note.laneStart; i <= note.laneEnd; i++) list.push(i);
      requested = true;
    }
    // per-lane input of the frame (frame result slot 14, value 1 = a tap on the lane without a note): adds the lane
    // to InVain (2). Auto play has no touch input, so no lane has value 1 and InVain stays empty.
    if (!requested) return;
    // neighbour lane i ^ 1 of every InVain lane is added to InVain (only InVain is extended)
    const inv = this.lists.get(2), n = this.laneCount;
    for (let u = 0; u < n; u++) {
      const v = (u & 1) === 0 ? u + 1 : u - 1;
      if (v < n && v >= 0 && inv.includes(u) && !inv.includes(v)) inv.push(v);
    }
    // per lane: T = first requested type (dictionary order, InVain skipped), else InVain if listed, else nothing;
    // P = first type whose instance i is playing (IsPlaying = _isPlaying); unless (T = InVain and P is a real effect):
    // Stop P (a playing groove is only stopped), Play T.
    for (let i = 0; i < n; i++) {
      let T = 1;
      for (const [k, list] of this.lists) { if (k === 2) continue; if (list.includes(i)) { T = k; break; } }
      if (T === 1) { if (inv.includes(i)) T = 2; else continue; }
      let P = 1;
      for (const [k, arr] of this.views) if (arr[i].isPlaying) { P = k; break; }
      if (T !== 2 || P === 1 || P === 2) {
        if (P !== 1) {
          this.views.get(P)[i].stop();
          if (P === 50) continue;
        }
        this.views.get(T)[i].play();
        this.log.push({ frame: this.frame, what: "lane-play", type: T, lane: i, stopped: P });
      }
    }
  }

  *elements() { for (const arr of this.views.values()) yield* arr; }

  // the lane prefabs have no Animator
  animate() {}

  simulate(dt) { for (const e of this.elements()) if (e.activeInHierarchy) e.simulate(dt); }

  items(camMatrix = null) {
    const out = [];
    for (const e of this.elements()) if (e.activeInHierarchy) out.push(...e.drawItems(camMatrix));
    return out;
  }

  // `fill` particle renderers (order 4099) -> LiveGameCamera ("game", layer 25)
  submit(renderer) {
    const cam = renderer.frames && renderer.frames.game ? renderer.frames.game.localToWorld : null;
    for (const it of this.items(cam)) renderer.submit("game", it);
  }
};
