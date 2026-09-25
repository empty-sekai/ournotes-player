import { AnimClip } from "../engine/anim.js";
import { F } from "../engine/core.js";
import { applyState } from "../engine/glsl.js";
import { mat4 } from "../engine/math.js";
import { Prefab } from "../engine/prefab.js";
import { GLTex } from "../engine/texture.js";
import { LIVE_UI_DEAD_INPUTS, LiveGeom, LiveLane } from "./lane.js";
import { liveFitSheets, liveMaterialSheets } from "./renderer.js";

// LiveIntro: the start timeline Band/{b}/timeline/live_start_playable_timeline, played by
// LiveStartTimelineDirector from MusicStartAnimationStateNode.Enter (frame F0), then the music starts. Also the
// timeline's lane-in effect (LiveLaneInEffect) and its skinned centre mesh (LiveSkinnedMesh).
//
// Timing: PlayableDirector wrap None, DirectorUpdateMode GameTime, 60 fps asset, duration 5.916667 (355/60).
//   F0 (the session's update phase): LiveStartSequenceAsync -> ReserveTapAreaFadeIn (tap alpha 0),
//   LiveGameView.SetActive(true), <Play>d__19: set_time(0), Play(), Evaluate(); then each frame at UniTask
//   Update timing: `if (state != Playing || time >= duration) break; await Yield()`; after the loop Stop() and the
//   state machine moves on to LiveStartStateNodeBase.Enter (PlayMusic, StartLive) in the same frame.
//   The director time advances by Time.deltaTime (float32 1/60, accumulated in double) in the engine's GameTime
//   update, evaluated with the Animators (loop phase `animation`).
// ENGINE: the director update is native; it already advances in F0 (Play precedes that frame's director update).
//   After frame F0+k the time is (k+1)*dt, the loop exits and the music starts at F0+355.
// ENGINE: Stop() with wrap None may revert animated properties (Unity manual); the last evaluated state is kept.
//   That state is T = duration: lane-in effect off, LW scale 1.2, lane on.
// ENGINE: timeline and Animator writes to one property resolve natively; the timeline wins here.
//   (Over LiveGameView/root's live_game_view controller, on LiveGameLane.m_IsActive while the timeline plays.)
// Tracks with a visible effect in LightWeight mode: LiveGameViewTrack (LiveGameView/root: LiveGameLane active),
// LiveGameLaneEffect (the timeline prefab's root: lane-in effect), LightWeightBackgroundStageTrack (stage image
// scale). LiveCamerasTrack / MovingLightTrack / LiveBackgroundViewTrack animate objects of the disabled
// LiveBackgroundView (no effect). Signal (PlayVoice at 1.483333) is audio (the session, through onSignal).
// Not drawn here: UILiveStartCanvasTrack's canvas (LiveMainCamera order 10002; in mode 3 a full-screen dark-blue
// gradient veil + the simple jacket panel + TMP texts, T 1.5 .. 4.4167): the player has no start canvas; the 7
// ef_particle_star ParticleSystems are drawn by the effects (LiveFx; `stars()` gives their transforms and active
// state).
// Clips are sampled with AnimClip (engine/anim.js). Bindings are resolved against each track's bound
// Animator (TimelineAsset track `boundAnimator` {key, gameObject}: the scene or the timeline prefab) and applied by
// attribute name: GameObject m_IsActive, Transform m_LocalPosition / m_LocalScale, SpriteRenderer m_Color.*,
// renderer material properties `material.<name>.<c>` (Animator material property block, typeID 137).

// TimelineClip -> clip-local time at timeline time T, or null when the clip does not drive the track at T
// (m_Start, m_Duration, m_ClipIn, m_TimeScale, Hold extrapolation (1) within the pre/post extrapolation time).
export const liveClipTime = (tc, T, stopTime) => {
  const s = tc.m_Start, e = tc.m_Start + tc.m_Duration;
  const local = (t) => Math.min((t - s) * tc.m_TimeScale + tc.m_ClipIn, stopTime);
  if (T >= s && T <= e) return local(T);
  if (T < s && T >= s - tc.m_PreExtrapolationTime) { if (tc.m_PreExtrapolationMode !== 1) throw new Error("pre-extrapolation"); return tc.m_ClipIn; }
  if (T > e && T <= e + tc.m_PostExtrapolationTime) { if (tc.m_PostExtrapolationMode !== 1) throw new Error("post-extrapolation"); return local(e); }
  return null;
};

// SignalReceiver persistent-call methods of LivePlayableTimeline -> LiveIntro.onSignal names
// (LivePlayableTimeline.NotifyPlayVoice -> LiveStartTimelineDirector.OnPlayLiveStartCharacterVoice)
export const LIVE_SIGNAL_METHODS = { NotifyPlayVoice: "PlayVoice" };

export class LiveIntro {
  constructor(stage) {
    this.stage = stage; this.r = stage.r; this.scene = stage.scene; this.prefab = stage.r.prefab;
    this.tl = new Prefab(this.scene.assets.startTimeline);
    const rootPath = this.tl.roots[0].name;
    this.director = this.tl.component(rootPath, "PlayableDirector");
    const ta = this.director.m_PlayableAsset;
    this.tracks = new Map(ta.m_Tracks.map((t) => [t.m_Name, {
      bound: t.boundAnimator || null,
      clips: t.m_Clips.map((c) => ({ tc: c, clip: AnimClip.fromMecanim(c.m_Asset.m_Clip, c.m_Asset.m_Clip.clip) })) }]));
    this.duration = Math.max(...ta.m_Tracks.flatMap((t) => t.m_Clips.map((c) => c.m_Start + c.m_Duration)));   // BasedOnClips
    this.effectRoot = `${rootPath}/root`;
    this.time = 0; this.playing = false; this.done = false; this.onEnd = null; this.n = 0; this.ignored = 0;
    this.onSignal = null;                    // onSignal(name): Signal track markers (see _signalMarkers)
    this.signals = this._signalMarkers(ta, rootPath);
    this.dt = F(1 / 60);
    this.effect = new LiveLaneInEffect(this);
  }

  async load() {
    await this.effect.load();
    this.evaluate(0);                        // LiveStartTimelineDirector.ApplyInitialFrame at FullInitialize
  }

  attach(loop) {
    this.loop = loop;
    loop.on("animation", () => {             // director GameTime update + evaluation
      if (!this.playing) return;
      const prev = this.time;
      this.time += this.dt;
      this.n++;
      this.evaluate(this.time);
      this._emitSignals(prev, this.time);
    });
  }

  // Signal track markers: SignalEmitter {m_Time, m_Retroactive, m_EmitOnce, m_Asset (SignalAsset)} resolved through the
  // timeline prefab's SignalReceiver (LivePlayableTimeline._signalReceiver): the asset's reaction is a UnityEvent
  // whose persistent call names the LivePlayableTimeline method, mapped to the callback name here.
  _signalMarkers(ta, rootPath) {
    const recv = this.tl.component(rootPath, "SignalReceiver").m_Events;
    const out = [];
    for (const tr of ta.m_Tracks) {
      if (tr.asset !== "SignalTrack" || tr.m_Muted) continue;
      for (const m of (tr.m_Markers && tr.m_Markers.m_Objects) || []) {
        if (m.asset !== "SignalEmitter" || !m.m_Enabled) continue;
        const k = recv.m_Signals.findIndex((a) => a && a.name === m.m_Asset.name);
        if (k < 0) continue;                 // no reaction for this signal on the receiver
        for (const c of recv.m_Events[k].m_PersistentCalls.m_Calls) {
          const name = LIVE_SIGNAL_METHODS[c.m_MethodName];
          if (!name) throw new Error(`signal ${m.m_Asset.name}: receiver method ${c.m_MethodName}`);
          out.push({ time: m.m_Time, retroactive: !!m.m_Retroactive, emitOnce: !!m.m_EmitOnce, asset: m.m_Asset.name, name, fired: false });
        }
      }
    }
    return out;
  }

  // Timeline TimeNotificationBehaviour.PrepareFrame -> TriggerNotificationsInRange(previousTime, time): a marker
  // fires once when previousTime <= markerTime <= time (inclusive; not yet fired this play), during the director
  // evaluation of the frame (loop phase `animation`, where this player evaluates the GameTime director, after the
  // MonoBehaviour Update / DOTween phases).
  // ENGINE: a GameTime director's player-loop slot and the notification dispatch are native; `animation` phase here.
  // (Update.DirectorUpdate or PreLateUpdate DirectorUpdateAnimation.)
  _emitSignals(prev, cur) {
    for (const g of this.signals) {
      if (g.fired || !(g.time >= prev && g.time <= cur)) continue;
      g.fired = true;
      if (this.onSignal) this.onSignal(g.name);
    }
  }

  // F0: called from the session's update phase (MusicStartAnimationStateNode.Enter)
  start() {
    const lane = this.stage.lane;
    lane.tapArea.animationAlpha = 0;         // ReserveTapAreaFadeIn (view inactive -> reserved)
    this.fadeReserved = true;
    this.prefab.transform("LiveGameView").activeSelf = true;           // LiveGameView.SetActive(true)
    this.time = 0; this.n = 0; this.playing = true; this.done = false;
    for (const g of this.signals) g.fired = false;   // Play from time 0: retroactive emission has nothing before it
    this.evaluate(0);
    this._emitSignals(0, 0);
    this._play();
  }

  async _play() {                            // <Play>d__19 loop at UniTask Update timing
    while (this.playing && this.time < this.duration) await this.loop.yield("Update");
    this.playing = false; this.done = true;  // PlayableDirector.Stop (last evaluated state kept, see above)
    if (this.onEnd) this.onEnd();
  }

  // node of a binding: the bound Animator's GameObject + binding path, in the scene or the timeline prefab
  _target(bound, b) {
    const pf = bound.key === this.scene.scene.key ? this.prefab : bound.key === this.tl.key ? this.tl : null;
    if (!pf) throw new Error(`timeline binding in ${bound.key}`);
    const path = b.path ? `${bound.gameObject}/${b.path}` : bound.gameObject;
    if (!pf.nodes.has(path)) throw new Error(`timeline binding: no node ${path}`);
    return { pf, path };
  }

  // evaluate one track at T: the clip covering T (with Hold extrapolation) writes every curve to its target
  _track(name, T) {
    const tr = this.tracks.get(name);
    for (const { tc, clip } of tr.clips) {
      const c = liveClipTime(tc, T, clip.length);
      if (c === null) continue;
      clip.sample(c, (i, v) => {
        const b = clip.curves[i].binding;
        // one SpriteRenderer m_Color.a binding of both lane-effect clips matches no object (path null): skipped
        if (b.path === null || b.path === undefined) { this.ignored++; return; }
        const { pf, path } = this._target(tr.bound, b);
        this._apply(pf, path, b, v);
      });
      return;
    }
  }

  _apply(pf, path, b, v) {
    const attr = b.attr;
    if (b.cls === "GameObject" && attr === "m_IsActive") { pf.transform(path).activeSelf = v >= 0.5; return; }   // ENGINE: active at >= 0.5
    let m = /^m_LocalPosition\.([xyz])$/.exec(attr);
    if (b.cls === "Transform" && m) { pf.transform(path).localPosition[m[1]] = v; return; }
    m = /^m_LocalScale\.([xyz])$/.exec(attr);
    if (b.cls === "Transform" && m) {
      const ui = pf === this.prefab ? this.r.canvas.nodes.get(path) : null;
      if (ui) { if (m[1] !== "z") ui.localScale[m[1]] = v; return; }  // z scale does not move a flat canvas graphic
      pf.transform(path).localScale[m[1]] = v; return;
    }
    if (pf === this.tl && this.effect.applyRenderer(path, b.cls, attr, v)) return;
    throw new Error(`timeline binding ${b.cls}.${attr} on ${path}`);
  }

  evaluate(T) {
    // LiveGameViewTrack -> LiveGameView/root: LiveGameLane m_IsActive
    const wasActive = this.prefab.activeInHierarchy("LiveGameView/root/LiveGameLane");
    this._track("LiveGameViewTrack", T);
    const nowActive = this.prefab.activeInHierarchy("LiveGameView/root/LiveGameLane");
    if (!wasActive && nowActive && this.fadeReserved) this._playTapAreaFadeIn();
    // LightWeightBackgroundStageTrack -> LightWeightBackgroundStageImage localScale (the canvas' UI node)
    this._track("LightWeightBackgroundStageTrack", T);
    // LiveGameLaneEffect -> the timeline prefab's root (lane-in effect)
    this._track("LiveGameLaneEffect", T);
  }

  // LiveLaneView.OnEnable -> PlayTapAreaFadeIn: DOVirtual.Float(0, 1, 0.6, InSine) on the tap
  // area's animation alpha (created in the animation phase; first DOTween update next frame)
  _playTapAreaFadeIn() {
    this.fadeReserved = false;
    const lane = this.stage.lane, view = this.prefab.component("LiveGameView/root/LiveGameLane", "LiveLaneView");
    const dur = view._tapAreaFadeInDuration, ease = view._tapAreaFadeInEase;
    if (typeof dur !== "number" || typeof ease !== "number") throw new Error("LiveLaneView tap-area fade fields missing");
    this.fadeTween = this.loop.tweens.to(0, 1, dur, ease, (v) => { lane.tapArea.animationAlpha = F(v); });
  }

  submit() { this.effect.submit(); }

  stars() { return this.effect.stars(); }

  debugState() {
    return { n: this.n, T: +this.time.toFixed(6), playing: this.playing, done: this.done,
             effectActive: this.effect.active, lineZ0: this.effect.lineZ(0), mesh: this.effect.meshState() };
  }
};

// LiveGameLaneInEffect of the timeline prefab (director root at the world origin, same frame as the lane).
// SpriteRenderers: `base` (layer 25 -> LiveGameCamera, Sprite-Unlit-Default, Sliced 19.12 x 217.6, order 4000),
// lane_line00..07 / lane_line_short00..05 (layer 29 -> LiveEffectCamera, Custom/Mobile/MobileAddHdrColor, order
// 4102), star_icon (layer 29, order 0); the SkinnedMeshRenderer lines/lane_line03_plus/lane_mesh/lane_mesh (layer 29,
// white_line_center, in the SortingGroup of lane_line03_plus, order 4102), LiveSkinnedMesh. Animated by the
// LiveGameLaneEffect track: GameObject m_IsActive, Transform m_LocalPosition (lines, the two bottom bones), SpriteRenderer
// m_Color.a, lane_mesh material._TintColor.r/g/b/a.
export class LiveLaneInEffect {
  constructor(intro) {
    this.intro = intro; this.r = intro.r; this.tl = intro.tl;
    this.root = intro.effectRoot;                      // bindings are relative to this node
    this.renderers = [];
    for (const [path, e] of this.tl.nodes) {
      if (!path.startsWith(`${this.root}/LiveGameLaneInEffect`)) continue;
      const sr = e.node.components.find((c) => c.type === "SpriteRenderer");
      if (sr) this.renderers.push({ path, sr, layer: e.node.layer, color: { ...sr.m_Color } });
    }
    this.byPath = new Map(this.renderers.map((x) => [x.path, x]));
    const meshPath = `${this.root}/LiveGameLaneInEffect/lines/lane_line03_plus/lane_mesh/lane_mesh`;
    this.mesh = new LiveSkinnedMesh(this.tl, meshPath, this.tl.component(meshPath, "SkinnedMeshRenderer"), this.tl.nodes.get(meshPath).node.layer);
  }

  async load() {
    const gl = this.r.gl, textures = new Map();
    this.vbo = { pos: gl.createBuffer(), uv: gl.createBuffer(), col: gl.createBuffer(), idx: gl.createBuffer() };
    await this.mesh.load(this.r);
    for (const x of this.renderers) {
      const sp = x.sr.m_Sprite, d = sp.texture;
      if (!textures.has(d.texture)) textures.set(d.texture, await GLTex.load(gl, this.r.base, d));
      x.tex = textures.get(d.texture);
      if (x.sr.m_DrawMode === 1) {                     // Sliced (LiveGeom.sliced: uv from the sprite rect)
        const r = sp.textureRect || sp.rect, tw = d.width, th = d.height;
        x.mesh = LiveGeom.sliced(x.sr.m_Size, sp.rect, sp.pivot, [sp.border.x, sp.border.y, sp.border.z, sp.border.w],
                                    sp.pixelsToUnits, [r.x / tw, r.y / th, (r.x + r.width) / tw, (r.y + r.height) / th], { x: tw, y: th });
      } else if (x.sr.m_DrawMode === 0) {              // Simple: the sprite's own mesh
        x.mesh = { pos: new Float32Array(sp.vertices.flat()), uv: new Float32Array(sp.uv.flat()), idx: new Uint16Array(sp.indices) };
      } else throw new Error(`${x.path}: draw mode ${x.sr.m_DrawMode}`);
    }
  }

  get active() { return this.tl.activeInHierarchy(`${this.root}/LiveGameLaneInEffect`); }

  lineZ(i) {
    const p = `${this.root}/LiveGameLaneInEffect/lines/lane_line0${i}`;
    return this.tl.nodes.has(p) ? +this.tl.transform(p).localPosition.z.toFixed(4) : null;
  }

  // timeline writes to renderers of the effect; false when (path, class, attribute) is not a renderer property here
  applyRenderer(path, cls, attr, v) {
    let m = /^m_Color\.([rgba])$/.exec(attr);
    if (cls === "SpriteRenderer" && m && this.byPath.has(path)) { this.byPath.get(path).color[m[1]] = v; return true; }
    m = /^material\.(\w+)\.([rgba])$/.exec(attr);
    if (cls === "SkinnedMeshRenderer" && m && this.mesh && this.mesh.path === path) { this.mesh.setProperty(m[1], "rgba".indexOf(m[2]), v); return true; }
    return false;
  }

  // the SortingGroup a renderer belongs to (nearest ancestor with an enabled SortingGroup), or null
  sortingGroup(path) {
    for (let p = path; p.includes("/"); p = p.slice(0, p.lastIndexOf("/"))) {
      const g = this.tl.nodes.get(p).node.components.find((c) => c.type === "SortingGroup" && c.m_Enabled);
      if (g) return { path: p, group: g };
    }
    return null;
  }

  // renderer.submit: layer 25 -> "game", layer 29 -> "effect"; distance = camera position to bounds centre
  submit() {
    if (!this.active) return;
    const cam = this.r.cameras.game.transform.worldPosition();
    const dist = (p) => Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    const cameraOf = (x) => {
      const c = x.layer === 25 ? "game" : x.layer === 29 ? "effect" : null;
      if (!c) throw new Error(`${x.path}: layer ${x.layer}`);
      return c;
    };
    for (const x of this.renderers) {
      if (!this.tl.activeInHierarchy(x.path) || !x.sr.m_Enabled) continue;
      const M = this.tl.transform(x.path).localToWorld(), c = x.color;
      const order = LiveLane.sortingOrder(this.tl, x.path, x.sr.m_SortingOrder);
      const it = LiveLane.spriteItem(this.r, this.vbo, x.sr, x.mesh, M, x.tex, [c.r, c.g, c.b, c.a], order);
      this.r.submit(cameraOf(x), { ...it, distance: dist(it.center) });
    }
    const m = this.mesh;
    if (m && this.tl.activeInHierarchy(m.path) && m.smr.m_Enabled) {
      const it = m.item(this.r.cameras.effect, this.r.size);
      if (it) {
        // ENGINE: SortingGroup sorting is native; the group sorts as one renderer at its transform's distance.
        // (With the group's sorting layer / order.)
        const g = this.sortingGroup(m.path);
        const sortingLayer = g ? g.group.m_SortingLayer : it.sortingLayer, sortingOrder = g ? g.group.m_SortingOrder : it.sortingOrder;
        const d = g ? dist(this.tl.transform(g.path).worldPosition()) : dist(it.center);
        this.r.submit(cameraOf(m), { ...it, sortingLayer, sortingOrder, distance: d });
      }
    }
  }

  meshState() { return this.mesh ? this.mesh.state() : null; }

  // for the effects (LiveFx): the 7 star emitters (ef_particle_star under lane_lineNN/star_icon)
  stars() {
    const out = [];
    for (const [path] of this.tl.nodes)
      if (path.startsWith(`${this.root}/LiveGameLaneInEffect`) && path.endsWith("/ef_particle_star"))
        out.push({ path, active: this.tl.activeInHierarchy(path), localToWorld: this.tl.transform(path).localToWorld(),
                   components: this.tl.nodes.get(path).node.components });
    return out;
  }
};

// SkinnedMeshRenderer (the lane-in effect's centre mesh `lane_mesh`): Unity linear blend skinning on the CPU.
//   skin matrix i = bones[i].localToWorld * bindPose[i]  (m_BindPose, serialized e<row><col>)
//   world vertex  = sum_j w_j * skin[boneIndex_j] * v   over the first QualitySettings.skinWeights influences (2 at
//                   every quality level of this build), renormalised to sum 1
// Culling: SkinnedMeshRenderer bounds (m_UpdateWhenOffscreen 0) = m_AABB in the root bone's space, tested against the
// camera frustum; the renderer is not drawn when the box is outside a frustum plane.
// ENGINE: skinning, influence cut / renormalisation and bounds culling are native; documented behaviour, float64.
// The skinned vertices are drawn in world space with an identity object matrix (Unity draws them relative to the
// root bone; the same world positions).
// ENGINE: the mesh has no colour channel; the missing COLOR input is taken as (1, 1, 1, 1).
export class LiveSkinnedMesh {
  constructor(prefab, path, smr, layer) {
    this.pf = prefab; this.path = path; this.smr = smr; this.layer = layer;
    const m = smr.m_Mesh;
    if (!m || !m.m_Skin || !m.m_BindPose) throw new Error(`${path}: skinned mesh without skin data`);
    if (m.submeshes.length !== 1) throw new Error(`${path}: ${m.submeshes.length} submeshes`);
    this.vertices = m.vertices; this.uv = new Float32Array(m.uv0.flat()); this.idx = new Uint16Array(m.submeshes[0]);
    this.skin = m.m_Skin;
    this.bindPoses = m.m_BindPose.map((e) => {
      const o = new Float32Array(16);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = e[`e${r}${c}`];
      return o;
    });
    this.bones = smr.m_Bones.map((b) => b.transform);
    if (this.bones.length !== this.bindPoses.length) throw new Error(`${path}: bones / bind poses`);
    this.rootBone = smr.m_RootBone ? smr.m_RootBone.transform : path;
    this.material = smr.m_Materials[0];
    this.block = {};                         // Animator material property block (material.<name>.<c> curves)
    this.skinWeights = 2;                    // QualitySettings.skinWeights of every quality level (player data)
  }

  async load(r) {
    this.r = r;
    this.tex = await GLTex.load(r.gl, r.base, this.material.textures._MainTex.texture);
    this.vbo = { pos: r.gl.createBuffer(), uv: r.gl.createBuffer(), col: r.gl.createBuffer(), idx: r.gl.createBuffer() };
  }

  setProperty(name, comp, v) {
    if (!this.block[name]) {
      const c = this.material.colors[name];
      if (!c) throw new Error(`${this.path}: animated material property ${name} not in the material`);
      this.block[name] = [c.r, c.g, c.b, c.a];
    }
    this.block[name][comp] = v;
  }

  tint() { return this.block._TintColor || (({ r, g, b, a }) => [r, g, b, a])(this.material.colors._TintColor); }

  // world-space skinned positions (Float32Array, 3 per vertex)
  skinned() {
    const S = this.bones.map((b, i) => mat4.mul(this.pf.transform(b).localToWorld(), this.bindPoses[i]));
    const out = new Float32Array(this.vertices.length * 3);
    this.vertices.forEach((v, k) => {
      const inf = this.skin[k].weight.map((w, j) => ({ w, b: this.skin[k].boneIndex[j] })).slice(0, this.skinWeights);
      const sum = inf.reduce((a, x) => a + x.w, 0);
      let x = 0, y = 0, z = 0;
      for (const { w, b } of inf) {
        if (!w) continue;
        const p = mat4.transformPoint(S[b], { x: v[0], y: v[1], z: v[2] }), f = w / sum;
        x += f * p.x; y += f * p.y; z += f * p.z;
      }
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    });
    return out;
  }

  // world AABB of m_AABB through the root bone: {min, max}
  bounds() {
    const M = this.pf.transform(this.rootBone).localToWorld(), a = this.smr.m_AABB, c = a.m_Center, e = a.m_Extent;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = mat4.transformPoint(M, { x: c.x + sx * e.x, y: c.y + sy * e.y, z: c.z + sz * e.z });
      [p.x, p.y, p.z].forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
    }
    return { min: lo, max: hi };
  }

  // AABB outside one of the six clip planes of viewProj -> culled
  static boxInFrustum(VP, b) {
    const row = (i) => [VP[i], VP[4 + i], VP[8 + i], VP[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    for (const [a, sg] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
      const p = r3.map((v, j) => v + sg * a[j]);
      const x = p[0] >= 0 ? b.max[0] : b.min[0], y = p[1] >= 0 ? b.max[1] : b.min[1], z = p[2] >= 0 ? b.max[2] : b.min[2];
      if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
  }

  state() {
    const v = this.skinned();
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 2; i < v.length; i += 3) { z0 = Math.min(z0, v[i]); z1 = Math.max(z1, v[i]); }
    return { z: [+z0.toFixed(3), +z1.toFixed(3)], tintA: +this.tint()[3].toFixed(4) };
  }

  // render item for `camera` (the LiveEffectCamera, layer 29), or null when culled
  item(camera, size) {
    const vp = camera.matrices(size.effect.w, size.effect.h).viewProj;
    const culled = !LiveSkinnedMesh.boxInFrustum(vp, this.bounds());
    this.lastCulled = culled;
    if (culled) return null;
    const pos = this.skinned(), mesh = { pos, uv: this.uv, idx: this.idx };
    const mat = this.material, shader = mat.shader.shader, tint = this.tint(), I = mat4.identity();
    return {
      sortingLayer: this.smr.m_SortingLayer || 0, sortingOrder: this.smr.m_SortingOrder, queue: LiveLane.queue(this.r.lib, mat),
      center: LiveLane._center(pos),
      draw: (ctx) => {
        const gl = ctx.gl, prog = ctx.lib.program(shader, 0, mat.keywords), ms = liveMaterialSheets(ctx.lib, mat, ctx.tex);
        prog.apply(liveFitSheets(prog, [{ _TintColor: tint }, { _MainTex: this.tex, _TextureSampleAdd: [0, 0, 0, 0], ...LIVE_UI_DEAD_INPUTS },
                                           ctx.perObject(I), ms.floats, ms.colors, ms.defaults, ctx.globals]));
        applyState(gl, ctx.lib.state(shader, 0, { unity_GUIZTestMode: 0, ...ms.floats }));
        LiveLane.bindMesh(gl, ctx.vao, this.vbo, prog, mesh, [1, 1, 1, 1]);
        gl.drawElements(gl.TRIANGLES, this.idx.length, gl.UNSIGNED_SHORT, 0);
      },
    };
  }
};
