import { F } from "../../engine/core.js";
import { componentClass } from "../../engine/prefab.js";
import { FxMaterials, FxParticleSystem, FxV, PS_STOP } from "../../engine/particles.js";
import { UnityRandom } from "../../engine/random.js";
import { UI_STRIDE } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { CanvasNode, compOf } from "./canvas.js";
import { featureSlot } from "./state.js";

// Coffee.UIParticle (v4) on the frame canvas: the particle systems of a prefab simulated and baked by their UIParticle
// and drawn as canvas graphics in hierarchy order (UIParticle, UIParticleRenderer and UIParticleUpdater of the
// Coffee.UIParticle assembly the game ships).
//
// Coordinates: the frame canvas (Screen Space - Camera) is rendered by the UI camera (orthographic, the story UI data's
// `uiCamera`). The canvas sits at its plane distance on the camera axis with the lossy scale s = 2 x orthographic size /
// canvas height, so the canvas point c is the world point s (c - (W / 2, H / 2)) + (0, 0, planeDistance) with the
// camera at the origin looking along +z.
// ENGINE: the UI camera's world placement is not in the data; the origin with no rotation stands for it. Only
// World-space particles across a change of the canvas scale (a viewport resize) depend on its position.
//
// Per drawn frame, after the canvas layout and before its draw: GameObject activity changes (the systems' activation,
// then UIParticle.OnEnable / OnDisable, each in hierarchy order), the particle update of the systems that still play by
// themselves, then UIParticleUpdater.Refresh (UIExtraCallbacks.onLateAfterCanvasRebuild): UpdateTransformScale and
// UpdateRenderers per active UIParticle in registration order (mesh sharing off).
// ENGINE: activating a hierarchy wakes its native components before its scripts, so the systems already play (Play on
// Awake, prewarm included) when UIParticle.OnEnable runs, and UIParticleRenderer.Set clears and pauses them.
// ENGINE: activity is sampled once per drawn frame; a GameObject turned off and on again between two draws counts as
// staying active.
// A headless session draws nothing and does not update the UIParticles (they only feed the canvas renderers).
// ENGINE: the particle systems draw their random numbers natively (every system of these frames has autoRandomSeed on:
// a new seed per Play), not from UnityEngine.Random. The managed Random is the native scripting generator
// (GetScriptingRand), seeded once at start and left to the scripts (Unity 2022.3 Random docs); Coffee.UIParticle calls
// Random.Range only when m_GroupId differs from m_GroupMaxId (ResetGroupId, OnEnable), which is refused below. How an
// automatic seed is chosen is not known: the frame particles here draw from one stream of their own per story, with a
// fixed seed, so UnityEngine.Random (DOTween shakes, eye blinks) stays the scripts' alone, drawn or headless.
const PARTICLE_SEED = 0x55495053;
const particleRandom = (ctx) => featureSlot(ctx, "uiParticleRandom", () => new UnityRandom(PARTICLE_SEED));

const SHARING_NONE = 0;
const AUTO_SCALING_UIPARTICLE = 1, AUTO_SCALING_TRANSFORM = 2;
const POSITION_ABSOLUTE = 1;
const MAX_VERTICES = 65534;
const MAIN_TEX = "_MainTex";
const BAKED_STREAMS = ["in_POSITION0", "in_NORMAL0", "in_COLOR0", "in_TEXCOORD0"];

const v3 = (o) => [F(o.x), F(o.y), F(o.z)];
// Vector3Extensions.Inverse: 1 / x per component, 1 for a component that is approximately 0
const inverse = (v) => v.map((x) => (Math.abs(x) < 8 * 1.401298464324817e-45 ? 1 : F(1 / x)));
const scaled = (a, b) => [F(a[0] * b[0]), F(a[1] * b[1]), F(a[2] * b[2])];
const nodeScale = (n) => [n.localScale.x, n.localScale.y, n.localScaleZ ?? 1];

// row-major 3 x 4 affine helpers
const m34 = {
  fromAffine: (m) => [m[0], m[2], 0, m[4], m[1], m[3], 0, m[5], 0, 0, 1, 0],       // UIAffine [a b c d tx ty]
  mul: (a, b) => {
    const o = new Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
      o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
    }
    return o;
  },
  translate: (t) => [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]],
  scale: (s) => [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0],
  point: (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
                    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]],
  dir: (m, d) => [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]],
  // column-major 4 x 4 (mat4 layout)
  colMajor: (m) => Float32Array.of(m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, m[3], m[7], m[11], 1),
};

// Transform.rotation: the local rotations down the hierarchy (the canvas and its camera add none)
const worldRotation = (n) => {
  let q = { x: 0, y: 0, z: 0, w: 1 };
  for (let p = n; p; p = p.parent) {
    const a = p.localRotation || { x: 0, y: 0, z: 0, w: 1 }, b = q;
    q = { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
          z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
  }
  return q;
};

// Transform.lossyScale: the diagonal of Inverse(world rotation) x world rotation-and-scale
const lossyScale = (world, n) => {
  const { x, y, z, w } = worldRotation(n);
  const cols = [[1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
                [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
                [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]];
  return [0, 1, 2].map((k) => F(FxV.dot(cols[k], [world[k], world[4 + k], world[8 + k]])));
};

// The UI camera of the story UI data (FrameCanvas' worldCamera at run time): orthographic size and clip planes
export const uiCamera = (c) => {
  if (!c) throw new StoryCommandError("the story UI data has no UI camera: canvas particles are not drawn without it");
  const size = c["orthographic size"], near = c["near clip plane"], far = c["far clip plane"];
  if (!c.orthographic) throw new StoryCommandError("UI camera: a perspective UI camera not implemented");
  if (!(size > 0) || !(far > near)) throw new StoryCommandError("UI camera: orthographic size or clip planes missing");
  return { size, near, far };
};

// UIParticle.GetBakeCamera (no custom view, a camera canvas): the canvas' camera, here at the origin looking along +z
// with Unity's orthographic projection (column-major; the particles' min / max size use it)
const bakeCamera = (cam, W, H) => {
  const a = W / H, n = cam.near, f = cam.far;
  const proj = Float32Array.of(1 / (cam.size * a), 0, 0, 0, 0, 1 / cam.size, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1);
  const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1;
  return { localToWorld: m, proj };
};

// The canvas' world mapping for one frame
const canvasWorld = (canvas, orthoSize) => {
  const { W, H } = canvas.size, s = F(F(2 * orthoSize) / H), pd = canvas.planeDistance;
  if (!(pd > 0)) throw new StoryCommandError(`${canvas.name}: no plane distance in the story UI data`);
  return { s, W, H, pd,
           toWorld: (m) => [s * m[0], s * m[1], s * m[2], s * (m[3] - W / 2), s * m[4], s * m[5], s * m[6], s * (m[7] - H / 2),
                            s * m[8], s * m[9], s * m[10], s * m[11] + pd],
           toCanvas: (p) => [p[0] / s + W / 2, p[1] / s + H / 2] };
};

// ------------------------------------------------------------------------------------------------ transforms
// A canvas node as the Transform of a particle system: its world matrix (moved by the UIParticle's placement while the
// system simulates), its world rotation (as a parentless local rotation, so a zero scale leaves the axes intact) and
// its localScale (Local scaling mode).
class NodeTransform {
  constructor(host, node) { this.host = host; this.node = node; this.parent = null; }
  localToWorld() { return m34.colMajor(this.host.world(this.node)); }
  get localRotation() { return worldRotation(this.node); }
  get localScale() { const [x, y, z] = nodeScale(this.node); return { x, y, z }; }
}

// ------------------------------------------------------------------------------------------------ UIParticleRenderer
// The generated child GameObject "[generated] UIParticleRenderer" of one system (UIParticle.GetRenderer /
// UIParticleRenderer.AddRenderer: the last child, local position zero, rotation identity, scale one).
class UIParticleRenderer {
  constructor(parent, index) {
    const p = parent.node;
    this.node = new CanvasNode({ path: `${p.path}/[generated] UIParticleRenderer`, name: "[generated] UIParticleRenderer",
      active: true, localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
      rect: { m_AnchorMin: { x: 0.5, y: 0.5 }, m_AnchorMax: { x: 0.5, y: 0.5 }, m_AnchoredPosition: { x: 0, y: 0 },
              m_SizeDelta: { x: 100, y: 100 }, m_Pivot: { x: 0.5, y: 0.5 } }, components: [] }, p);
    this.node.zeroLocalPosition();
    this.node.uiParticleRenderer = this;
    if (p.rect && p.matrix) this.node.layoutIn(p.rect, p.matrix);
    this.index = index;
    this.parent = parent;
    this.reset(index);
  }

  // Reset(index): references cleared, the canvas renderer cleared, disabled
  reset(index = -1) {
    this.entry = null; this.ps = null; this.mainEmitter = null; this.isTrail = false;
    if (index >= 0) this.index = index;
    this.material = null; this.texture = null; this.geometry = null;
    this.enabled = false;
  }

  // Set(parent, ps, isTrail, mainEmitter): a playing (or prewarming) system is cleared and paused with its children;
  // the material is sharedMaterials[0] (null: the default UI material). CanvasRenderer.SetTexture(null): the material's
  // own _MainTex is sampled.
  set(parent, entry, isTrail, mainEmitter) {
    const ps = entry.system;
    this.parent = parent; this.entry = entry; this.ps = ps;
    this.prewarm = ps.main.prewarm;
    if (ps.isPlaying || this.prewarm) { ps.clear(true); ps.pause(true); }
    this.isTrail = isTrail;
    this.material = entry.material;
    const t = this.material && (this.material.textures || {})[MAIN_TEX];
    this.texture = t && t.texture ? t.texture.id : null;
    this.delay = true;
    this.mainEmitter = mainEmitter;
    this.enabled = true;
  }

  // GetWorldScale
  worldScale() {
    const u = this.parent;
    let scale = scaled(u.scale3DForCalc(), u.parentScale);
    if (u.autoScalingMode === AUTO_SCALING_UIPARTICLE && this.ps.main.scalingMode === 1) {
      const s = u.host.frame.s;                                     // rootCanvas.transform.localScale
      scale = scaled(scale, [s, s, s]);
    }
    return scale;
  }

  // GetWorldMatrix(psPos, scale) by simulation space
  worldMatrix(psPos, scale) {
    const space = this.ps.main.simulationSpace;
    if (space === 2) throw new StoryCommandError(`${this.ps.name}: UIParticle with a custom simulation space not implemented`);
    const S = m34.scale(scale);
    if (space === 0) return m34.mul(m34.translate(psPos), S);
    if (!this.mainEmitter) return S;
    const host = this.parent.host;
    const about = this.mainEmitter.main.simulationSpace === 0 ? psPos
      : FxV.sub(psPos, host.position(this.parent.prefab.entryOf(this.mainEmitter).node));
    return m34.mul(m34.mul(m34.translate(about), S), m34.translate(about.map((x) => -x)));
  }

  // Simulate(scale, paused): dt = the frame's scaled delta time (0 while paused) x timeScaleMultiplier, a prewarm adds one
  // duration to the first step; the system is placed at its position (World space: divided by the scale), simulated by
  // ParticleSystem.Simulate(dt, withChildren false, restart false, fixedTimeStep false) and put back.
  // The rate-over-distance pre-step needs _isPrevStored, which only ResolveResolutionChange sets, inside a branch that
  // requires it already set: it never runs in this build.
  simulate(scale, paused, deltaTime) {
    const ps = this.ps, host = this.parent.host;
    let dt = paused ? 0 : deltaTime;
    dt = F(dt * this.parent.timeScaleMultiplier);
    if (dt > 0 && this.prewarm) { dt = F(dt + ps.main.duration); this.prewarm = false; }
    let pos = host.position(this.entry.node);
    if (ps.main.simulationSpace !== 0) pos = scaled(pos, inverse(scale));
    host.placeAt(this.entry.node, pos);
    try { ps.fastForward(dt, false, false, false); } finally { host.placeAt(null); }
  }

  // UpdateMesh(bakeCamera)
  updateMesh(camera, deltaTime) {
    this.geometry = null;
    const u = this.parent, ps = this.ps, host = u.host;
    if (!this.enabled || !ps || !this.node.activeInHierarchy || !host.onCanvas(this.node)) return;
    const lossy = host.lossy(this.node), s3 = u.scale3DForCalc();
    const vol = F(F(F(lossy[2] * s3[2]) * F(lossy[0] * s3[0])) * F(lossy[1] * s3[1]));
    if (vol === 0 || Number.isNaN(vol)) return;
    if (!ps.isAlive(true) && !ps.isPlaying) return;
    if (host.inheritedAlpha(this.node) < 0.01) return;
    const scale = this.worldScale();
    if (!this.isTrail && !this.mainEmitter) {
      // ResolveResolutionChange only records the screen size and canvas scale factor here (see simulate)
      this.simulate(scale, u.isPaused || this.delay, deltaTime);
      if (this.delay && !u.isPaused) this.simulate(scale, false, deltaTime);
      if (!ps.main.looping && ps.main.duration <= ps.time && (ps.isAlive(true) || ps.particleCount === 0))
        ps.stop(false, PS_STOP.StopEmitting);
      this.delay = false;
    }
    const R = ps.rendererConfig;
    if (!R || R.renderMode === 5 || (R.renderMode === 4 && !R.mesh)) return;          // CanBakeMesh
    validateShape(ps);
    const baked = ps.bake(camera, 1);                                                 // BakeRotationAndScale
    if (!baked) return;
    const n = baked.verts.length / baked.stride;
    if (n > MAX_VERTICES) {
      console.error(`${ps.name}: too many vertices to render (${n} > ${MAX_VERTICES})`);
      return;
    }
    // CombineMeshes transform: canvasRenderer.worldToLocalMatrix x [Relative: Translate((psPos - UIParticle position) x
    // (scale - 1))] x GetWorldMatrix. The canvas renderer maps its local space back to the world, so the vertices go
    // from this world matrix to the canvas directly.
    const psPos = host.position(this.entry.node);
    let C = this.worldMatrix(psPos, scale);
    if (u.positionMode !== POSITION_ABSOLUTE)
      C = m34.mul(m34.translate(scaled(FxV.sub(psPos, host.position(u.node)), scale.map((x) => F(x - 1)))), C);
    this.geometry = { baked, C, n };
  }

  // The canvas renderer's draw item: the baked mesh with its submeshes merged (Mesh.CombineMeshes, mergeSubMeshes).
  // ENGINE: CanvasRenderer multiplies the vertex alpha by the inherited CanvasGroup alpha; CombineMeshes transforms the
  // normals by the matrix and renormalises them; the orthographic canvas drops z.
  items(alpha) {
    const g = this.geometry;
    if (!g || !(alpha > 0)) return [];
    const { baked, C, n } = g, frame = this.parent.host.frame, st = baked.stride, A = baked.attribs, v = baked.verts;
    for (const k of Object.keys(A))
      if (!BAKED_STREAMS.includes(k)) throw new StoryCommandError(`${this.ps.name}: vertex stream ${k} on a canvas not implemented`);
    const P = A.in_POSITION0, N = A.in_NORMAL0, Cc = A.in_COLOR0, T = A.in_TEXCOORD0;
    const out = new Float32Array(n * UI_STRIDE);
    for (let i = 0; i < n; i++) {
      const b = i * st, o = i * UI_STRIDE;
      const c = frame.toCanvas(m34.point(C, [v[b + P[1]], v[b + P[1] + 1], v[b + P[1] + 2]]));
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = 0;
      if (Cc) { for (let k = 0; k < 4; k++) out[o + 3 + k] = v[b + Cc[1] + k]; out[o + 6] *= alpha; }
      else { out[o + 3] = out[o + 4] = out[o + 5] = 1; out[o + 6] = alpha; }
      if (T) for (let k = 0; k < T[0]; k++) out[o + 7 + k] = v[b + T[1] + k];
      if (N) {
        const d = FxV.norm(m34.dir(C, [v[b + N[1]], v[b + N[1] + 1], v[b + N[1] + 2]]));
        out[o + 13] = d[0]; out[o + 14] = d[1]; out[o + 15] = d[2];
      } else out[o + 15] = -1;
    }
    const idx = new Uint32Array(baked.submeshes.reduce((k, s) => k + s.length, 0));
    let k = 0;
    for (const s of baked.submeshes) { idx.set(s, k); k += s.length; }
    return [{ node: this.node, material: this.material, texture: this.texture, verts: out, idx, canvasSpace: true }];
  }
}

// ParticleSystemExtensions.ValidateShape: an aligned shape of zero volume would get a minimal scale; not implemented
const validateShape = (ps) => {
  const sh = ps.shape;
  if (sh.enabled && sh.alignToDirection && Math.abs(sh.scale[0] * sh.scale[1] * sh.scale[2]) < 1e-6)
    throw new StoryCommandError(`${ps.name}: an aligned shape of zero scale not implemented`);
};

// ------------------------------------------------------------------------------------------------ UIParticle
class UIParticle {
  constructor(prefab, node, comp) {
    this.prefab = prefab; this.host = prefab.host; this.node = node;
    this.enabled = !!comp.m_Enabled;
    // OnAfterDeserialize: the obsolete fields move to the auto scaling and position modes
    this.autoScalingMode = comp.m_AutoScalingMode;
    this.positionMode = comp.m_PositionMode;
    if (comp.m_IgnoreCanvasScaler || comp.m_AutoScaling) this.autoScalingMode = AUTO_SCALING_TRANSFORM;
    if (comp.m_AbsoluteMode) this.positionMode = POSITION_ABSOLUTE;
    const refuse = (what) => { throw new StoryCommandError(`${node.path}: UIParticle ${what} not implemented`); };
    if (comp.m_MeshSharing !== SHARING_NONE) refuse(`mesh sharing ${comp.m_MeshSharing}`);
    if (comp.m_UseCustomView) refuse("custom view");
    if ((comp.m_AnimatableProperties || []).length) refuse("animatable properties");
    if (comp.m_GroupId !== comp.m_GroupMaxId) refuse("group id range (UnityEngine.Random.Range)");
    if (![0, 1, 2].includes(this.autoScalingMode) || ![0, 1].includes(this.positionMode))
      refuse(`modes ${this.autoScalingMode} / ${this.positionMode}`);
    this.scale3D = v3(comp.m_Scale3D);
    this.timeScaleMultiplier = F(comp.m_TimeScaleMultiplier);
    this.particleRefs = comp.m_Particles || [];
    this.isPaused = false;
    this.renderers = [];
    this.isScaleStored = false; this.storedScale = null;
    this.canvasScale = [1, 1, 1]; this.parentScale = [1, 1, 1];
    this.isActiveAndEnabled = false;
  }

  // scale3DForCalc
  scale3DForCalc() {
    return this.autoScalingMode !== AUTO_SCALING_TRANSFORM ? scaled(scaled(this.scale3D, this.canvasScale), nodeScale(this.node)) : this.scale3D;
  }

  // The systems of RefreshParticles: m_Particles, or (empty list, RefreshParticles(gameObject)) every system on or under
  // the GameObject whose nearest UIParticle is this one, in hierarchy order
  systems() {
    const pf = this.prefab;
    if (!this.particleRefs.length) return pf.entries.filter((e) => pf.uiParticleOf(e.node) === this);
    return this.particleRefs.filter(Boolean).map((r) => {
      const e = pf.entryAt(r.gameObject);
      if (!e) throw new StoryCommandError(`${this.node.path}: UIParticle system ${r.gameObject} is not in the prefab`);
      return e;
    });
  }

  // OnEnable: UIParticleUpdater.Register, RefreshParticles
  onEnable() {
    this.host.register(this);
    this.refreshParticles();
  }

  // OnDisable: the driven scale given back, UIParticleUpdater.Unregister, every renderer Reset
  onDisable() {
    if (this.autoScalingMode === AUTO_SCALING_TRANSFORM && this.isScaleStored) this._setScale(this.storedScale);
    this.isScaleStored = false;
    this.host.unregister(this);
    for (const r of this.renderers) r.reset(-1);
  }

  // RefreshParticles(List<ParticleSystem>): the existing renderers reset, then one renderer per system in list order
  // with its main emitter (GetMainEmitter: the listed system whose sub-emitters include it)
  refreshParticles() {
    this.renderers.forEach((r, i) => r.reset(i));
    const list = this.systems();
    let j = 0;
    for (const e of list) {
      const main = list.find((x) => x !== e && x.system.subEmitters.some((s) => s.system === e.system)) || null;
      if (e.system.mainEmitter && (!main || main.system !== e.system.mainEmitter))
        throw new StoryCommandError(`${e.node.path}: a sub-emitter whose main system is not in its UIParticle not implemented`);
      if (e.trails) throw new StoryCommandError(`${e.node.path}: UIParticle trails not implemented`);
      this._renderer(j++).set(this, e, false, main ? main.system : null);
    }
  }

  _renderer(i) {
    while (this.renderers.length <= i) this.renderers.push(new UIParticleRenderer(this, this.renderers.length));
    return this.renderers[i];
  }

  // Transform.localScale = v: the subtree's matrices follow at once
  _setScale([x, y, z]) {
    const n = this.node;
    n.localScale = { x, y }; n.localScaleZ = z;
    const walk = (m) => {
      if (m.layoutGroup) throw new StoryCommandError(`${m.path}: a layout group under a scaled UIParticle not implemented`);
      m.children.forEach(walk);
    };
    walk(n);
    if (n.parent && n.parent.rect && n.parent.matrix) n.layoutIn(n.parent.rect, n.parent.matrix);
  }

  // UpdateTransformScale
  updateTransformScale() {
    const host = this.host, s = host.frame.s;
    this.canvasScale = inverse([s, s, s]);
    this.parentScale = host.lossy(this.node.parent);
    if (this.autoScalingMode !== AUTO_SCALING_TRANSFORM) {
      if (this.isScaleStored) this._setScale(this.storedScale);
      this.isScaleStored = false;
      return;
    }
    const cur = nodeScale(this.node);
    if (!this.isScaleStored) {
      this.storedScale = F(F(cur[2] * cur[0]) * cur[1]) === 0 ? [1, 1, 1] : cur;
      this.isScaleStored = true;
    }
    const next = inverse(this.parentScale), d = FxV.sub(cur, next);
    if (FxV.dot(d, d) < 9.9999994e-11) return;
    this._setScale(next);
  }

  // UpdateRenderers
  updateRenderers(camera, deltaTime) {
    if (!this.isActiveAndEnabled) return;
    for (const r of this.renderers) r.updateMesh(camera, deltaTime);
  }
}

// ------------------------------------------------------------------------------------------------ one prefab instance
// The particle systems of a canvas prefab instance (one FxParticleSystem per ParticleSystem with its child systems and
// sub-emitters) and its UIParticles. A system outside every UIParticle is not drawn: allowed only while it cannot draw
// (renderer disabled or emission off).
export class PrefabParticles {
  constructor(host, prefab, nodes, name) {
    this.host = host; this.prefab = prefab; this.name = name;
    const rng = particleRandom(host.ctx), materials = FxMaterials.fromObjects(null, host.ctx.objects);
    this.entries = []; this.byPath = new Map(); this.uiParticles = []; this.activity = [];
    for (const rec of nodes) {
      const node = prefab.node(rec.path);
      for (const c of rec.components || []) {
        const k = componentClass(c);
        if (k === "UIParticle") {
          const u = new UIParticle(this, node, c.fields);
          this.uiParticles.push(u);
          node.uiParticle = u;
          this.activity.push({ node, uip: u, on: false });
        } else if (k === "ParticleSystem") {
          const r = compOf(rec, "ParticleSystemRenderer");
          const system = new FxParticleSystem(c.fields, r, new NodeTransform(host, node), { rng, materials, name: `${name}:${rec.path}` });
          const e = { node, system, renderer: r, material: r?.m_Materials?.[0] ? host.canvas.material(r.m_Materials[0]) : null,
                      trails: !!(c.fields.TrailModule && c.fields.TrailModule.enabled) };
          this.entries.push(e); this.byPath.set(rec.path, e);
          this.activity.push({ node, entry: e, on: false });
        }
      }
    }
    // ParticleSystem children (withChildren): the nearest systems below each system
    const below = (n, out) => {
      for (const c of n.children) { const e = this.byPath.get(c.path); if (e && e.node === c) out.push(e.system); else below(c, out); }
      return out;
    };
    for (const e of this.entries) e.system.children = below(e.node, []);
    for (const e of this.entries) if (e.system.subEmitters.length) e.system.linkSubEmitters((ref) => { const x = this.byPath.get(prefab.ref(ref).path); return x ? x.system : null; });
    const covered = new Set(this.uiParticles.flatMap((u) => u.systems()));
    for (const e of this.entries) {
      if (covered.has(e)) {
        const cfg = e.system.rendererConfig;
        const bad = [...e.system.unsupported, ...(cfg ? FxParticleSystem._geometryUnsupported(cfg) : [])];
        if (bad.length) throw new StoryCommandError(`${e.system.name}: not implemented: ${bad.join(", ")}`);
        if (e.material) {
          for (const [k, t] of Object.entries(e.material.textures || {}))
            if (k !== MAIN_TEX && t && t.texture) throw new StoryCommandError(`${e.node.path}: particle material texture ${k} not implemented`);
        }
      } else if (e.renderer && e.renderer.m_Enabled && e.system.emission.enabled) {
        throw new StoryCommandError(`${e.node.path}: a drawing particle system outside a UIParticle not implemented`);
      }
    }
    for (const a of this.activity) a.node.particleHandled = true;
    host.addPrefab(this);
  }

  entryAt(path) { return this.byPath.get(path) || null; }
  entryOf(system) { return this.entries.find((e) => e.system === system) || null; }
  uiParticleOf(node) { for (let n = node; n; n = n.parent) if (n.uiParticle) return n.uiParticle; return null; }

  // An Animator curve on a ParticleSystem property ("ParticleSystem.<attribute>") of node n: null without a system there
  // (Unity skips the curve)
  property(n, prop) {
    const e = this.byPath.get(n.path);
    if (!e || e.node !== n) return null;
    const acc = e.system.accessor(prop.slice("ParticleSystem.".length));
    if (!acc) throw new StoryCommandError(`${n.path}: animated property ${prop} not implemented`);
    return acc;
  }

  // GameObject activity: the systems' activation, then UIParticle.OnEnable / OnDisable, each in hierarchy order
  syncActivity() {
    for (const a of this.activity) {
      if (a.uip) continue;
      const aih = a.node.activeInHierarchy;
      if (aih !== a.on || a.entry.system.activeInHierarchy === null) {
        a.on = aih;
        a.entry.system.onActiveChanged(aih);
      }
    }
    for (const a of this.activity) {
      if (!a.uip) continue;
      const on = a.node.activeInHierarchy && a.uip.enabled;
      if (on === a.on) continue;
      a.on = on; a.uip.isActiveAndEnabled = on;
      if (on) a.uip.onEnable(); else a.uip.onDisable();
    }
  }

  // the particle update of the systems that play by themselves (not paused by a UIParticle)
  nativeUpdate(dt) { for (const e of this.entries) e.system.simulate(dt); }
}

// ------------------------------------------------------------------------------------------------ one canvas
// The UIParticles of one camera canvas (UIParticleUpdater: registration order) and the canvas' world mapping.
// cameraDoc () -> the story UI data (its uiCamera is read at the first refresh).
export class CanvasParticles {
  constructor(ctx, canvas, cameraDoc) {
    this.ctx = ctx; this.canvas = canvas; this.cameraDoc = cameraDoc;
    this.prefabs = []; this.active = [];
    this.frame = null; this.placement = null; this.lastFrame = -1; this.camera = null;
  }

  addPrefab(p) { this.prefabs.push(p); }
  register(u) { if (!this.active.includes(u)) this.active.push(u); }
  unregister(u) { const i = this.active.indexOf(u); if (i >= 0) this.active.splice(i, 1); }

  // draw items of a node (the screen's item source)
  itemsOf(n, alpha) { return n.uiParticleRenderer ? n.uiParticleRenderer.items(alpha) : []; }

  // is the node on this canvas (Graphic.canvas)
  onCanvas(n) { let r = n; while (r.parent) r = r.parent; return r === this.canvas.root; }

  // world matrix (row-major 3 x 4) of a laid-out node, with the placement of the system being simulated
  world(n) {
    const local = n.matrix3 || (n.matrix ? m34.fromAffine(n.matrix) : null);
    if (!local || !this.frame) throw new StoryCommandError(`${n.path}: particle transform read before the canvas layout`);
    const m = this.frame.toWorld(local), pl = this.placement;
    if (pl) for (let p = n; p; p = p.parent) if (p === pl.node) { m[3] += pl.delta[0]; m[7] += pl.delta[1]; m[11] += pl.delta[2]; break; }
    return m;
  }
  position(n) { const m = this.world(n); return [m[3], m[7], m[11]]; }
  lossy(n) { return lossyScale(this.world(n), n); }

  // Transform.SetPositionAndRotation(pos, rotation) of a system's node, moving its subtree (null: back in place)
  placeAt(node, pos) {
    this.placement = null;
    if (node) this.placement = { node, delta: FxV.sub(pos, this.position(node)) };
  }

  // CanvasRenderer.GetInheritedAlpha: the CanvasGroup alphas down to the node
  inheritedAlpha(n) {
    const chain = [];
    for (let p = n; p; p = p.parent) chain.push(p);
    let a = 1;
    for (let i = chain.length - 1; i >= 0; i--) {
      const g = chain[i].canvasGroup;
      if (g) a = g.ignoreParentGroups ? g.alpha : F(a * g.alpha);
    }
    return a;
  }

  // once per drawn frame, after the canvas layout and before its draw
  refresh(loop) {
    if (this.lastFrame === loop.frameCount) return;
    this.lastFrame = loop.frameCount;
    if (!this.prefabs.length) return;
    if (!this.camera) this.camera = uiCamera(this.cameraDoc());
    const { W, H } = this.canvas.size;
    this.frame = canvasWorld(this.canvas, this.camera.size);
    const dt = loop.deltaTime;
    for (const p of this.prefabs) p.syncActivity();
    for (const p of this.prefabs) p.nativeUpdate(dt);
    const cam = bakeCamera(this.camera, W, H);
    for (const u of [...this.active]) {
      u.updateTransformScale();
      u.updateRenderers(cam, dt);
    }
  }
}
