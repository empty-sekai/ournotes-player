import { AnimTargets, Animator } from "../../engine/anim.js";
import { F } from "../../engine/core.js";
import { mat4, quat, Transform } from "../../engine/math.js";
import { Prefab } from "../../engine/prefab.js";
import { FxMaterials, FxParticleSystem, PS_STOP } from "../../engine/particles.js";
import { FxSpriteRenderer } from "../../live/fx-effects.js";
import { StoryCommandError } from "../interfaces.js";
import { AnimRecords } from "./clips.js";
import { featureSlot, featureState } from "./state.js";

// Particle / Animator effects of the Effect command (AdvParticleEffect instances of effects.json, one per TargetName:
// AdvEpisodeResourceLoader.LoadParticleEffect) and their placement (AdvEffectPlacer.TryPlace). The same component
// drives the particle groups of stages (AdvStage.ChangeParticleEffects / PlayParticleEffects / StopParticleEffects).
//
// GameObject activity: activeSelf per node, activeInHierarchy propagated; a change reaches the particle systems
// (FxParticleSystem.onActiveChanged) and the Animator.
// ENGINE: activation is native; OnEnable / OnDisable run inside SetActive, parent first.

export const LAYER = { UI: 5, Camera1: 6, AdvBack: 12, AdvFront: 13 };
const CAMERA_LAYER = { 1: 6, 3: 7, 5: 8, 7: 9, 9: 10 };          // AdvPositionTypeExtensions.ToLayerName: Camera1..5

// A MeshRenderer with its MeshFilter inside an effect prefab: the mesh drawn with each of its materials (submesh i
// with material i), in the renderer list like the other renderers (GetComponentsInChildren<Renderer>).
// ENGINE: a mesh without vertex colours reads colour (1, 1, 1, 1) (FxMaterial's constant white).
export class EffectMeshRenderer {
  constructor(filter, renderer, transform, { materials = null, name = "" } = {}) {
    const m = filter.m_Mesh;
    if (!m || !m.vertices || !m.submeshes) throw new StoryCommandError(`${name}: MeshFilter without mesh data`);
    const mats = renderer.m_Materials || [];
    if (!mats.length || mats.some((x) => !x)) throw new StoryCommandError(`${name}: MeshRenderer without its materials`);
    if (m.submeshes.length > mats.length) throw new StoryCommandError(`${name}: more submeshes than materials`);
    this.name = name;
    this.transform = transform;
    this.enabled = !!renderer.m_Enabled;
    this.sortingLayer = renderer.m_SortingLayer | 0;
    this.sortingOrder = renderer.m_SortingOrder | 0;
    this.materialRecords = mats.slice(0, m.submeshes.length);
    this.materials = materials;
    if (materials) for (const r of this.materialRecords) materials.get(r);
    const n = m.vertices.length, has = (k) => Array.isArray(m[k]) && m[k].length === n;
    const streams = [["in_POSITION0", 3, m.vertices], has("normals") && ["in_NORMAL0", 3, m.normals],
                     has("colors") && ["in_COLOR0", 4, m.colors], has("uv0") && ["in_TEXCOORD0", 2, m.uv0]].filter(Boolean);
    const stride = streams.reduce((a, [, k]) => a + k, 0), verts = new Float32Array(n * stride), attribs = {};
    let off = 0;
    for (const [attr, k, data] of streams) {
      attribs[attr] = [k, off];
      for (let i = 0; i < n; i++) {
        const v = data[i], vals = Array.isArray(v) ? v : [v.x, v.y, v.z, v.w].filter((x) => x !== undefined);
        if (attr === "in_COLOR0" && !Array.isArray(v)) vals.splice(0, 4, v.r, v.g, v.b, v.a);
        for (let j = 0; j < k; j++) verts[i * stride + off + j] = F(vals[j]);
      }
      off += k;
    }
    this.parts = m.submeshes.map((idx) => ({ verts, stride, attribs, idx: n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) }));
    this.localPoints = m.vertices.map((v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v));
  }

  // world-space AABB centre of the mesh (the sorting distance, as for the sprites)
  worldCenter(M) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.localPoints) {
      const w = mat4.transformPoint(M, p), a = [w.x, w.y, w.z];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); }
    }
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  }

  drawItem(camPos = null) {
    if (!this.enabled) return null;
    const M = this.transform.localToWorld(), c = this.worldCenter(M);
    const distance = camPos ? Math.hypot(c[0] - camPos[0], c[1] - camPos[1], c[2] - camPos[2]) : 0;
    const mat = this.materials ? this.materials.get(this.materialRecords[0]) : null;
    const rq = this.materialRecords[0].renderQueue;
    return { sortingLayer: this.sortingLayer, sortingOrder: this.sortingOrder, queue: mat ? mat.queue : (rq >= 0 ? rq : null),
             distance, name: this.name, draw: (ctx) => this.draw(ctx, M) };
  }

  draw(ctx, M = this.transform.localToWorld()) {
    if (!this.materials) return;
    this.parts.forEach((part, i) => this.materials.get(this.materialRecords[i]).draw(ctx, part, M, {}));
  }
}

// Live2DCharacterController.SortingOrderStride
export const CHARACTER_SORT_STRIDE = 1000;

// AdvParticleEffect with its prefab instance
export class AdvParticleEffect {
  // exported: the prefab record ({key, nodes}); opts {materials: FxMaterials | null, rng: UnityRandom, parent: Transform,
  // records: AnimRecords of the data file}. A stage's particle group effect is a GameObject inside the stage prefab:
  // opts.prefab (the stage's engine/prefab.js Prefab) and opts.rootPath (the effect's GameObject path) build it over
  // that subtree; setParentActive() then carries the activity of the GameObjects above it.
  constructor(name, exported, { materials = null, rng = null, parent = null, records = null, prefab = null, rootPath = null } = {}) {
    this.name = name;
    const pf = this.prefab = prefab || new Prefab(exported);
    const rootKey = rootPath ?? pf.root.name;
    const root = pf.transform(rootKey);
    if (parent) root.setParent(parent);
    this.root = root;
    const up = rootKey.lastIndexOf("/");
    this.parentActive = up < 0 ? true : pf.activeInHierarchy(rootKey.slice(0, up));
    this.entries = new Map();
    this.order = [];
    for (const [path, { node, transform }] of pf.nodes) {
      if (path !== rootKey && !path.startsWith(`${rootKey}/`)) continue;
      const cut = path.lastIndexOf("/");
      const pe = path === rootKey ? null : this.entries.get(path.slice(0, cut));
      const e = { path, node, transform, activeSelf: !!node.active, aih: null, parent: pe, children: [], layer: node.layer,
                  system: null, sprite: null, mesh: null };
      if (pe) pe.children.push(e);
      this.entries.set(path, e);
      this.order.push(e);
    }
    this.rootEntry = this.entries.get(rootKey);
    const cls = (c) => c.class || c.type;
    this.systems = []; this.renderers = [];
    let comp = null, animatorComp = null;
    for (const e of this.order) {
      const comps = e.node.components;
      for (const c of comps) {
        const k = cls(c);
        if (k === "ParticleSystem") {
          const r = comps.find((x) => cls(x) === "ParticleSystemRenderer") || null;
          e.system = new FxParticleSystem(c, r, e.transform, { rng, materials, name: `${name}:${e.path}` });
          this.systems.push(e.system);
          if (r) this.renderers.push({ kind: "particle", entry: e, target: e.system });
        } else if (k === "SpriteRenderer") {
          e.sprite = new FxSpriteRenderer(c, e.transform, { materials, name: `${name}:${e.path}` });
          this.renderers.push({ kind: "sprite", entry: e, target: e.sprite });
        } else if (k === "MeshFilter") {
          const r = comps.find((x) => cls(x) === "MeshRenderer");
          if (!r) throw new StoryCommandError(`${name}:${e.path}: MeshFilter without a MeshRenderer not implemented`);
          e.mesh = new EffectMeshRenderer(c, r, e.transform, { materials, name: `${name}:${e.path}` });
          this.renderers.push({ kind: "mesh", entry: e, target: e.mesh });
        } else if (k === "MeshRenderer") {
          if (!comps.some((x) => cls(x) === "MeshFilter")) throw new StoryCommandError(`${name}:${e.path}: MeshRenderer without a MeshFilter`);
        } else if (k === "Animator") {
          if (!animatorComp) { animatorComp = c; this.animatorEntry = e; }      // GetComponentInChildren<Animator>(true)
        } else if (k === "AdvParticleEffect") {
          comp = c;
        } else if (k !== "ParticleSystemRenderer") {
          throw new StoryCommandError(`${name}:${e.path}: component ${k} not implemented`);
        }
      }
    }
    if (!comp) throw new StoryCommandError(`${name}: no AdvParticleEffect`);
    // ParticleSystem.Play / Stop (withChildren): the nearest systems below each system, hierarchy order
    const below = (e, out) => { for (const c of e.children) { if (c.system) out.push(c.system); else below(c, out); } return out; };
    for (const e of this.order) if (e.system) e.system.children = below(e, []);
    for (const e of this.order) if (e.system && e.system.subEmitters.length) e.system.linkSubEmitters((ref) => { const x = this.entries.get(ref.gameObject); return x ? x.system : null; });
    const main = this.entries.get(comp._particleSystem && comp._particleSystem.gameObject);
    if (!main || !main.system) throw new StoryCommandError(`${name}: _particleSystem missing`);
    this.particleSystem = main.system;
    // CacheParticleSystems: every system (inactive included) with its serialized simulation speed
    this.defaultSpeeds = this.systems.map((s) => s.main.simulationSpeed);
    // CacheAnimator
    this.animator = null; this.animatorOn = false; this.defaultAnimatorSpeed = 1;
    if (animatorComp) this._buildAnimator(animatorComp, records || new AnimRecords(exported || {}, StoryCommandError));
    // CacheRenderers: default sort orders and their relative ranks
    this.defaultSortOrders = this.renderers.map((r) => r.target.sortingOrder);
    const pos = [...new Set(this.defaultSortOrders.filter((o) => o >= 1))].sort((a, b) => a - b);
    const neg = [...new Set(this.defaultSortOrders.filter((o) => o < 1))].sort((a, b) => a - b);
    this.relativeSortOrders = this.defaultSortOrders.map((o) => (o < 1 ? neg.indexOf(o) - neg.length : pos.indexOf(o) + 1));
    this.appliedBand = null;
    this.isPlaying = false;
    this.placedPositionType = 0;
    this.hideToken = 0;
    for (const e of this.order) this._propagate(e);
  }

  _buildAnimator(c, records) {
    if (c.m_UpdateMode !== 0 || c.m_ApplyRootMotion || c.m_KeepAnimatorStateOnDisable)
      throw new StoryCommandError(`${this.name}: Animator settings not implemented`);
    const raw = records.controller(c.m_Controller, this.name);
    if (!raw) return;                                                   // no controller: no states
    const ctrl = records.controllerOf(raw, this.name);
    this.animator = new Animator(ctrl, (b) => this._bind(b), `${this.name}:${ctrl.name}`);
    this.animator.enabled = false;
    this.animatorComponentEnabled = !!c.m_Enabled;
    this.defaultAnimatorSpeed = this.animator.speed;
  }

  // Animator binding (path relative to the Animator's GameObject) -> accessor | null (Unity skips the curve).
  // ENGINE: bool properties (GameObject.m_IsActive, ParticleSystem.looping) are written from their float curve as
  // value > 0.5.
  _bind(b) {
    const base = this.animatorEntry;
    const e = b.path === "" ? base : this.entries.get(`${base.path}/${b.path}`);
    if (!e) return null;
    if (b.cls === "GameObject") return b.attr === "m_IsActive" ? { get: () => (e.activeSelf ? 1 : 0), set: (v) => this.setActive(e, v > 0.5) } : null;
    if (b.cls === "Transform") return AnimTargets.transform(e.transform, b.attr);
    if (b.cls === "SpriteRenderer") return e.sprite ? e.sprite.accessor(b.attr) : null;
    if (b.cls === "MeshRenderer" && e.mesh) throw new StoryCommandError(`${this.name}: animated MeshRenderer property ${b.attr} not implemented`);
    if (b.cls === "ParticleSystem") {
      if (!e.system) return null;
      if (b.attr === "looping") return { get: () => (e.system.main.looping ? 1 : 0), set: (v) => { e.system.main.looping = v > 0.5; } };
      return e.system.accessor(b.attr);
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------- activity
  setActive(e, v) {
    v = !!v;
    if (e.activeSelf === v) return;
    e.activeSelf = e.transform.activeSelf = v;
    this._propagate(e);
  }

  // the activity of the GameObjects above the effect's root (a stage group effect: the stage prefab's nodes)
  setParentActive(v) {
    v = !!v;
    if (this.parentActive === v) return;
    this.parentActive = v;
    this._propagate(this.rootEntry);
  }

  _propagate(e) {
    const aih = e.activeSelf && (e.parent ? e.parent.aih : this.parentActive);
    if (aih === e.aih) return;
    e.aih = aih;
    if (e.system) e.system.onActiveChanged(aih);
    if (e === this.animatorEntry) this._syncAnimator();
    for (const c of e.children) this._propagate(c);
  }

  // Animator activity = enabled component on an active GameObject; OnEnable (keepAnimatorStateOnDisable false) resets it
  _syncAnimator() {
    if (!this.animator) return;
    const on = this.animatorComponentEnabled && this.animatorEntry.aih;
    if (on === this.animatorOn) return;
    this.animatorOn = on;
    this.animator.enabled = on;
    if (on) this.animator.reset();
  }

  get isVisible() { return this.rootEntry.activeSelf; }                // IsVisible: gameObject.activeSelf
  setActiveFast(v) { this.setActive(this.rootEntry, v); }

  // ---------------------------------------------------------------------------------------- speed
  applySimulationSpeed(r) { this.systems.forEach((s, i) => { s.main.simulationSpeed = F(this.defaultSpeeds[i] * r); }); }
  applyAnimatorSpeed(r) { if (this.animator) this.animator.speed = F(this.defaultAnimatorSpeed * r); }
  setPlaybackSpeed(r) { this.applySimulationSpeed(r); this.applyAnimatorSpeed(r); }

  // ---------------------------------------------------------------------------------------- play / stop
  // Init(token, speedRate, layer): stopped and cleared, speed applied, (layer of the root only), hidden
  init(speedRate = 1, layer = null) {
    this.particleSystem.stop(true, PS_STOP.StopEmittingAndClear);
    this.applySimulationSpeed(speedRate);
    if (layer !== null) this.rootEntry.layer = this.rootEntry.transform.layer = layer;
    this.setActiveFast(false);
  }

  // Play(speedRate) (Effect command) / Play() (stage groups: speedRate undefined): a pending hide is cancelled
  play(speedRate) {
    this.isPlaying = true;
    this.hideToken++;
    if (speedRate !== undefined) { this.applySimulationSpeed(speedRate); this.applyAnimatorSpeed(speedRate); }
    this.setActiveFast(true);
    this.particleSystem.play(true);
  }

  // Stop(immediate): immediate = stop and clear, hide; else stop emitting and hide once the system has stopped
  // (WaitParticleSystemStopAsync: checked now, then at every Update)
  stop(immediate, loop) {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (immediate) {
      this.particleSystem.stop(true, PS_STOP.StopEmittingAndClear);
      this.setActiveFast(false);
      return;
    }
    this.particleSystem.stop(true);
    const token = ++this.hideToken;
    (async () => {
      while (this.particleSystem.isPlaying) {
        await loop.yield("Update");
        if (token !== this.hideToken) return;
      }
      if (token === this.hideToken) this.setActiveFast(false);
    })();
  }

  // TryPlayAnimatorState: Animator.Play(hash, 0, 0) when layer 0 has the state
  tryPlayAnimatorState(state) {
    if (!this.animator || !this.animator.ctrl.states.some((s) => s.name === state)) return false;
    this.animator.play(state, 0);
    return true;
  }

  // ---------------------------------------------------------------------------------------- sort order
  restoreDefaultSortOrder() {
    this.appliedBand = null;
    this.renderers.forEach((r, i) => { r.target.sortingOrder = this.defaultSortOrders[i]; });
  }

  // SetSortOrder(o): defaults, then every ParticleSystemRenderer gets o (other renderers keep their defaults)
  setSortOrder(o) {
    this.restoreDefaultSortOrder();
    for (const r of this.renderers) if (r.kind === "particle") r.target.sortingOrder = o;
  }

  // SetSortOrderRelativeTo(band)
  setSortOrderRelativeTo(band) {
    if (this.appliedBand && this.appliedBand.backBase === band.backBase && this.appliedBand.frontBase === band.frontBase &&
        this.appliedBand.max === band.max) return;
    this.renderers.forEach((r, i) => {
      const rel = this.relativeSortOrders[i];
      r.target.sortingOrder = rel >= 1 ? Math.min(band.frontBase + rel, band.max) : band.backBase + rel;
    });
    this.appliedBand = { ...band };
  }

  setLayerRecursively(layer) { for (const e of this.order) e.layer = e.transform.layer = layer; }

  // ---------------------------------------------------------------------------------------- frame
  animate(dt) { if (this.animator && this.animatorOn) this.animator.update(dt); }
  simulate(dt) { for (const s of this.systems) s.simulate(dt); }

  // field items of the visible renderers ({sortingOrder, dist, layer, background, draw}). The field renderer's
  // frame.perObject(transform, layer) takes a Transform; FxMaterial.draw passes the draw's matrix, wrapped here.
  items(camera) {
    if (!this.rootEntry.aih) return [];
    const out = [], camPos = [camera.localToWorld[12], camera.localToWorld[13], camera.localToWorld[14]];
    for (const r of this.renderers) {
      if (!r.entry.aih) continue;
      const it = r.kind === "particle" ? r.target.drawItem(camera) : r.target.drawItem(camPos);
      if (!it) continue;
      const layer = r.entry.layer;
      out.push({ sortingOrder: it.sortingOrder, dist: it.distance, layer, background: layer === LAYER.AdvBack,
                 name: it.name, draw: (frame) => it.draw({ ...frame, camera,
                   perObject: (M) => frame.perObject({ localToWorld: () => M }, layer) }) });
    }
    return out;
  }

  snapshot() {
    return [this.name, this.isPlaying, this.isVisible, this.placedPositionType,
            this.systems.map((s) => [s.state, s.particles.length]), this.renderers.map((r) => r.target.sortingOrder),
            this.animator ? [this.animator.state.name, this.animator.time] : null];
  }
}

// ------------------------------------------------------------------------------------------------ placement
const worldRotation = (t) => { let q = t.localRotation; for (let p = t.parent; p; p = p.parent) q = quat.mul(p.localRotation, q); return q; };
const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const invPoint = (M, p) => {                        // world point -> local point of a TRS matrix (no shear)
  const col = (i) => [M[i * 4], M[i * 4 + 1], M[i * 4 + 2]];
  const d = [p.x - M[12], p.y - M[13], p.z - M[14]];
  return ["x", "y", "z"].reduce((o, k, i) => { const c = col(i), l2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2]; o[k] = l2 ? (d[0] * c[0] + d[1] * c[1] + d[2] * c[2]) / l2 : 0; return o; }, {});
};

// Transform.SetParent(p, false), then world position / rotation (Transform.position / rotation setters)
const placeUnder = (e, parent, worldPos, worldRot) => {
  const t = e.root;
  t.setParent(parent);
  const P = parent.localToWorld();
  t.localPosition = invPoint(P, worldPos);
  t.localRotation = quat.mul(conj(worldRotation(parent)), worldRot);
  t.localEuler = null;
};

// AdvFieldRendererFeature.TryGetCharacterSortOrderBand: the slot's entry has a showing target with a render index
export const characterSortBand = (fr, pos) => {
  const e = fr.entryOf ? fr.entryOf(pos) : null;
  if (!e || !e.target || !e.target.isShowing || !(e.renderIndex >= 0)) return null;
  const count = e.target.drawablePartsCount;
  if (typeof count !== "number") throw new StoryCommandError("character has no drawable parts count");
  const backBase = e.renderIndex * CHARACTER_SORT_STRIDE;
  return { backBase, frontBase: backBase + count, max: backBase + CHARACTER_SORT_STRIDE - 1 };
};

// AdvEffectPlacer.ApplyCharacterSortOrder
export const applyCharacterSortOrder = (effect, pos, fr) => {
  const band = characterSortBand(fr, pos);
  if (band) effect.setSortOrderRelativeTo(band); else effect.restoreDefaultSortOrder();
};

const canPlaceCharacter = (pt) => pt >= 0 && pt < 10 && (pt & 1) === 1;

// AdvEffectPlacer.TryPlace(effect, canvasLayer, positionType)
export const tryPlace = (effects, effect, canvasLayer, pt, p) => {
  const ctx = p.ctx;
  effect.placedPositionType = 0;
  if (canvasLayer >= 4 && canvasLayer <= 8) {                         // Chat .. Front: under the UI widget
    placeUnder(effect, effects.resourceParent, { x: 0, y: 0, z: 0 }, quat.identity());
    effect.setSortOrder(effects.uiCanvasSortOrder(canvasLayer));
    effect.setLayerRecursively(LAYER.UI);
    return true;
  }
  const stage = p.session.stage;
  if (!stage) { console.warn("Effect: no stage is set, the effect is not placed"); return false; }
  if (canvasLayer === 0 || canvasLayer === 1) {                       // Background / Overlay: in front of the camera
    const M = ctx.camera.transform.localToWorld(), z = stage.backgroundFieldPosition.z;
    const fwd = [M[8], M[9], M[10]], n = Math.hypot(...fwd) || 1;
    const pos = { x: M[12] + fwd[0] / n * z, y: M[13] + fwd[1] / n * z, z: M[14] + fwd[2] / n * z };
    placeUnder(effect, effects.resourceParent, pos, worldRotation(ctx.camera.transform));
    effect.setSortOrder(-50);
    effect.setLayerRecursively(LAYER.AdvBack);
    return true;
  }
  if (canPlaceCharacter(pt)) {                                        // the character slot's Stage node
    const parent = ctx.field.stageTransform(pt);
    placeUnder(effect, parent, parent.worldPosition(), quat.identity());
    applyCharacterSortOrder(effect, pt, ctx.fieldRenderer);
    effect.placedPositionType = pt;
    effect.setLayerRecursively(CAMERA_LAYER[pt]);
    return true;
  }
  placeUnder(effect, effects.resourceParent, { x: 0, y: 0, z: 0 }, quat.identity());   // front
  effect.setSortOrder(0);
  effect.setLayerRecursively(LAYER.AdvFront);
  return true;
};

// ------------------------------------------------------------------------------------------------ episode instances
// The command effects of the episode (AdvEpisodeResourceLoader particle effect map) and the particle group effects of
// its stages: advanced in the animation phase (Animator, then the particle systems), drawn with the field.
export class StoryEffects {
  constructor(ctx) {
    this.ctx = ctx;
    this.resourceParent = new Transform("ResourceParent");              // AdvEpisodeResourceLoader.ResourceParent
    this.materials = new FxMaterials(ctx.gl || null, "");
    this.byName = new Map();                                            // TargetName -> AdvParticleEffect
    this.list = [];                                                     // command effects, load order
    this.stageEffects = [];                                             // stage particle group effects
    this.records = null;
    this._hooks = [];
    this.installed = false;
  }

  // UIAdvWidget.TrueCanvasSortOrder + canvas layer (UI-layer effects)
  uiCanvasSortOrder(layer) {
    const ui = this.ctx.ui;
    if (typeof ui.trueCanvasSortOrder !== "number") throw new StoryCommandError("Effect: the story UI has no canvas sort order");
    return ui.trueCanvasSortOrder + layer;
  }

  _install() {
    if (this.installed) return;
    this.installed = true;
    const ctx = this.ctx, loop = ctx.loop, s = featureState(ctx);
    const on = (phase, fn) => { loop.on(phase, fn); this._hooks.push([phase, fn]); };
    on("animation", (l) => {
      const all = this.all();
      for (const e of all) e.animate(l.deltaTime);
      for (const e of all) e.simulate(l.deltaTime);
    });
    const fr = ctx.fieldRenderer;
    // AdvPlayer.RefreshCharacterEffectSortOrders on AdvFieldRendererManager.OnCharacterOrderChanged
    if (fr && fr.onCharacterOrderChanged) this._unsubscribe = fr.onCharacterOrderChanged(() => this.refreshCharacterSortOrders());
    if (ctx.renderer) {
      this.source = () => {
        const camera = { localToWorld: ctx.camera.transform.localToWorld() };
        return this.all().flatMap((e) => e.items(camera));
      };
      ctx.renderer.addFieldItems(this.source);
    }
    s.disposers.push(() => this.dispose());
    (s.snapshots = s.snapshots || []).push(() => ({ effects: this.snapshot() }));
  }

  all() { return this.stageEffects.length ? [...this.list, ...this.stageEffects] : this.list; }

  // AdvEpisodeResourceLoader.LoadParticleEffect for every Effect row (one instance per TargetName; IgnoreData rows are
  // not preloaded), Init(token) with speed 1
  load(doc) {
    const s = featureState(this.ctx);
    this.records = new AnimRecords(doc, StoryCommandError);
    for (const c of this.ctx.episode.commands) {
      if (c.cmd !== "Effect" || c.IgnoreData || !(c.TargetName ?? "") || this.byName.has(c.TargetName)) continue;
      const asset = doc.instances[c.TargetName];
      if (!asset) continue;
      const ex = doc.effects[asset];
      if (!ex) throw new StoryCommandError(`effect ${asset} is not in the story data`);
      const e = new AdvParticleEffect(c.TargetName, ex, { materials: this.materials, rng: s.random, parent: this.resourceParent,
                                                          records: this.records });
      e.init(1);
      this.byName.set(c.TargetName, e);
      this.list.push(e);
    }
    this._install();
  }

  // stage particle group effects (createStageParticleGroups): updated and drawn from now on
  addStageEffects(effects) { this.stageEffects.push(...effects); this._install(); }

  // no longer updated or drawn; a pending hide is dropped
  removeStageEffects(effects) {
    const drop = new Set(effects);
    this.stageEffects = this.stageEffects.filter((e) => !drop.has(e));
    for (const e of effects) e.hideToken++;
  }

  refreshCharacterSortOrders() {
    for (const e of this.list)
      if (e.isVisible && canPlaceCharacter(e.placedPositionType)) applyCharacterSortOrder(e, e.placedPositionType, this.ctx.fieldRenderer);
  }

  // ReapplyPlaybackSpeed: the command effects (stage groups keep the rate of the last stage SetPlaybackSpeed)
  setPlaybackSpeed(rate) { for (const e of this.list) e.setPlaybackSpeed(rate); }

  get(name) { return this.byName.get(name ?? "") || null; }

  dispose() {
    for (const [phase, fn] of this._hooks) { const hs = this.ctx.loop.hooks[phase], i = hs.indexOf(fn); if (i >= 0) hs.splice(i, 1); }
    this._hooks = [];
    if (this._unsubscribe) this._unsubscribe();
    if (this.source && this.ctx.renderer) this.ctx.renderer.removeFieldItems(this.source);
    for (const e of this.all()) e.hideToken++;
  }

  snapshot() { return this.all().map((e) => e.snapshot()); }
}

export const storyEffects = (ctx) => featureSlot(ctx, "effects", () => new StoryEffects(ctx));

export const loadEffects = (ctx) => {
  const uses = ctx.episode.commands.some((c) => c.cmd === "Effect" && !c.IgnoreData);
  if (!uses) return null;
  const file = ctx.story && ctx.story.effects;
  if (!file) throw new StoryCommandError("the story data has no effects.json");
  const fx = storyEffects(ctx);
  fx.load(ctx.assets.json(file));
  const s = featureState(ctx);
  (s.speedListeners = s.speedListeners || []).push((rate) => fx.setPlaybackSpeed(rate));
  return fx;
};

// AdvStage particle groups (AdvParticleEffectGroupCollection._groups[i]._particleEffects): one AdvParticleEffect per
// referenced component over the stage prefab's subtree, Init(token) at stage load (stopped, cleared, hidden), then
// updated and drawn with the command effects. prefab: the stage's engine/prefab.js Prefab; records: AnimRecords of the
// scene data file. Returns the groups (arrays of effects): AdvStage.PlayParticleEffects(i) = each play(),
// StopParticleEffects(i) = each stop(false, ctx.loop), SetPlaybackSpeed(r) = each setPlaybackSpeed(r) over all groups.
export const createStageParticleGroups = (ctx, stageName, prefab, collection, records, { rng = null } = {}) => {
  const fx = storyEffects(ctx), s = featureState(ctx);
  const byPath = new Map();                     // a component referenced by several groups is one effect
  const groups = collection._groups.map((g, gi) => g._particleEffects.map((ref, k) => {
    if (!ref || ref.class !== "AdvParticleEffect" || typeof ref.gameObject !== "string")
      throw new StoryCommandError(`stage ${stageName}: particle group ${gi} entry ${k} is not an AdvParticleEffect`);
    let e = byPath.get(ref.gameObject);
    if (!e) {
      e = new AdvParticleEffect(`${stageName}:${ref.gameObject}`, null, { materials: fx.materials, rng: rng || s.random,
                                                                          records, prefab, rootPath: ref.gameObject });
      byPath.set(ref.gameObject, e);
    }
    return e;
  }));
  const roots = [...byPath.keys()];
  for (const a of roots) for (const b of roots)
    if (b.startsWith(`${a}/`)) throw new StoryCommandError(`stage ${stageName}: nested particle effects ${a}, ${b} not implemented`);
  for (const e of byPath.values()) e.init();
  fx.addStageEffects([...byPath.values()]);
  return groups;
};

export const releaseStageParticleGroups = (ctx, groups) => storyEffects(ctx).removeStageEffects([...new Set(groups.flat())]);

export const loadEffectMaterials = async (ctx) => { const s = featureState(ctx); if (s.effects && ctx.gl) await s.effects.materials.load(); };
