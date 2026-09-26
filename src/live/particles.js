import { FxError, FxMatrixTransform, FxParticleSystem } from "../engine/particles.js";
import { UnityRandom } from "../engine/random.js";

// ------------------------------------------------------------------------------------------------ intro lane-in stars
// The 7 `ef_particle_star` systems of the start timeline's LiveGameLaneInEffect
// (live_start_playable_timeline/root/LiveGameLaneInEffect/lines/lane_lineNN/star_icon/ef_particle_star,
// livescene/scene.json). The stage hands them over through
// stage.intro.stars() -> [{path, active (activeInHierarchy), localToWorld, components}] every frame.
//   new LiveIntroStars(gl, { materials /* FxMaterials(gl, "livescene") */, rng /* UnityRandom */ })
//   prepare(stars)       optional, before materials.load(): builds the systems so their material is loaded up front
//   update(stars, dt)    animation phase, after the timeline evaluation of the frame (Unity: PlayableDirector in
//                        DirectorUpdateAnimation, then ParticleSystemBeginUpdateAll): matrix, activation
//                        (playOnAwake via the clip's m_IsActive), simulate(dt)
//   submit(renderer)     renderer.submit("effect", item) for every system with particles (layer 29, LiveEffectCamera)
// sortingOrder: LiveParticleOrderInLayerSetter (_orderInLayer 60, _offset 2) -> GetOrderInLayer(60) + 2 = 6002 (the x100
// rule of LiveOrderInLayerUtility.GetOrderInLayer: 60 -> 6000, 41 -> 4100), equal to the serialized m_SortingOrder.
// An entry missing from a frame's list counts as inactive.
export class LiveIntroStars {
  constructor(gl, { materials = null, rng = null } = {}) {
    this.gl = gl;
    this.materials = materials;
    this.rng = rng || new UnityRandom(1);
    this.entries = new Map();          // path -> {ps, t}
  }

  _entry(s) {
    let e = this.entries.get(s.path);
    if (e) return e;
    const comp = (type) => s.components.find((c) => c.type === type) || null;
    const psc = comp("ParticleSystem");
    if (!psc) throw new FxError(`${s.path}: no ParticleSystem`);
    const t = new FxMatrixTransform(s.localToWorld);
    const ps = new FxParticleSystem(psc, comp("ParticleSystemRenderer"), t,
                                       { rng: this.rng, materials: this.materials, name: s.path });
    const order = s.components.find((c) => c.type === "MonoBehaviour" && c.class === "LiveParticleOrderInLayerSetter");
    if (order) ps.sortingOrder = order._orderInLayer * 100 + order._offset;
    if (ps.renderer && this.materials) for (const m of ps.renderer.materials) this.materials.get(m);
    e = { ps, t };
    this.entries.set(s.path, e);
    return e;
  }

  prepare(stars) { for (const s of stars) this._entry(s); }

  update(stars, dt) {
    const seen = new Set();
    for (const s of stars) {
      const e = this._entry(s);
      seen.add(s.path);
      e.t.set(s.localToWorld);
      e.ps.onActiveChanged(!!s.active);
      e.ps.simulate(dt);
    }
    for (const [path, e] of this.entries) if (!seen.has(path)) e.ps.onActiveChanged(false);
  }

  static cameraPosition(renderer) {
    const f = renderer && renderer.frames && renderer.frames.game;
    const m = f && (f.localToWorld || f.cameraToWorld);
    if (m) return [m[12], m[13], m[14]];
    const c = renderer && renderer.cameras && renderer.cameras.game;
    if (c && c.transform) { const p = c.transform.worldPosition(); return [p.x, p.y, p.z]; }
    return null;
  }

  submit(renderer) {
    const cam = LiveIntroStars.cameraPosition(renderer);
    for (const { ps } of this.entries.values()) {
      const it = ps.drawItem(cam);
      if (it) renderer.submit("effect", it);
    }
  }

  get systems() { return [...this.entries.values()].map((e) => e.ps); }
};
