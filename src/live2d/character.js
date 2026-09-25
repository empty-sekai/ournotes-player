import { F } from "../engine/core.js";
import { quat } from "../engine/math.js";
import { Prefab } from "../engine/prefab.js";
import { UnityRandom } from "../engine/random.js";
import { CUBISM, CubismModel } from "./cubism.js";
import { Live2DParameterStore, Live2DParameters, clampF, easeSine, hermite } from "./math.js";
import { Live2DClip, Live2DFadeMotion } from "./motion.js";
import { Live2DPhysics } from "./physics.js";

// Live2DCharacter: one Live2D model as the game's ADV runs it. The game layer (Live2DAnimation.Live2DCharacter and
// Live2DCharacterController) over its fork of Cubism SDK for Unity: parameters, motions (the Animator's clip output
// and CubismFadeController), expressions, auto eye blink, harmonic breath, physics, the model update with its
// double-buffered meshes, sorting, colours and the mask layout. Simulation only; drawing is in drawing.js.
//
// One frame, driven by the owner through a PlayerLoop (hooks in Unity phase order):
//   update       update()          Live2DCharacterController.OnUpdate: motion end, model read-back, idle replay
//   animation    animatorUpdate()  the PlayableGraph (DirectorUpdateAnimation) writes the newest clip's values
//   lateUpdate   lateUpdate()      Live2DCharacter.OnLateUpdate: the CubismUpdateController chain, auto eye blink
//   preLateEnd   modelUpdate()     CubismModel.OnModelUpdate: parameters to the Core, csmUpdateModel
// A frame displays the Core result of the parameters finished two LateUpdates earlier (the game's latency).
//
// Lip sync and MotionSync (voice-driven mouth), the look / angle overrides and the eye-blink stop override are not
// part of this runtime; ParamMouthOpenY follows CubismMouthController.MouthOpening as it does without lip sync.
//
// The managed math is float32 without FMA; F (Math.fround) is applied in source order.

export class Live2DCharacter {
  // prefab: the exported model prefab; mocBytes: the moc3 (ArrayBuffer); loop: the PlayerLoop that drives the model.
  // opts.random: the UnityRandom stream of the auto eye blink (default: a stream seeded from the clock).
  constructor(prefab, mocBytes, loop, { random = null } = {}) {
    this.loop = loop;
    this.random = random || new UnityRandom(Date.now() >>> 0);
    this.name = prefab.nodes[0].name;
    this.core = new CubismModel(mocBytes);
    try {
      this._build(prefab);
    } catch (e) {
      this.core.release();
      throw e;
    }
  }

  _build(prefab) {
    this.core.update();
    this.params = new Live2DParameters(this.core);
    this.parts = Float32Array.from(this.core.parts.opacities);
    this.store = new Live2DParameterStore(this.params, this.parts);
    this.prefab = new Prefab(prefab);
    this.root = this.prefab.root;
    const rootPath = this.root.name;
    const comp = (cls) => this.prefab.component(rootPath, cls);
    const ch = comp("Live2DCharacter");
    this.defaultMotionName = ch.DefaultMotionName;
    this.defaultExpressionName = ch.DefaultExpressionName;
    this.basePosition = ch.BasePosition;
    this.baseScale = ch.BaseScale;

    // motions: clips by name; fade data by instance id
    this.clips = new Map(ch._motionList.map((c) => [c.clip, new Live2DClip(c, this.params)]));
    const fl = comp("CubismFadeController").CubismFadeMotionList;
    this.fadeById = new Map(fl.MotionInstanceIds.map((id, k) =>
      [id, new Live2DFadeMotion(fl.CubismFadeMotionObjects[k], this.params)]));
    for (const c of this.clips.values())
      if (!this.fadeById.has(c.instanceId)) throw new Error(`${c.name}: no fade motion for id ${c.instanceId}`);

    // expressions
    const el = comp("CubismExpressionController");
    if (el.UseLegacyBlendCalculation) throw new Error("legacy expression blend not implemented");
    // a model without expressions has no ExpressionsList (null); its CurrentExpressionIndex stays -1
    const eo = (el.ExpressionsList && el.ExpressionsList.CubismExpressionObjects) || [];
    this.expressions = eo.map((e) => ({
      name: e.name.replace(/\.exp3$/, ""), fadeIn: e.FadeInTime, fadeOut: e.FadeOutTime,
      dest: e.Parameters.map((p) => ({ i: this.params.idx(p.Id), v: p.Value, blend: p.Blend })),
    }));
    this.expressionIndex = new Map(this.expressions.map((e, i) => [e.name, i]));
    if (ch._expressionList.some((n, i) => !this.expressions[i] || this.expressions[i].name !== n))
      throw new Error("Live2DCharacter._expressionList order differs from ExpressionsList");
    this.expr = { list: [], current: el.CurrentExpressionIndex, last: -1, fadeIn: el.CurrentFadeInTime, epv: [] };
    this.exprParams = [...new Set(this.expressions.flatMap((e) => e.dest.map((d) => d.i)))];

    // tagged parameters
    const tagged = (cls) => [...this.prefab.nodes.values()]
      .filter((e) => e.node.components.some((c) => c.class === cls))
      .map((e) => ({ id: e.node.name, c: e.node.components.find((c) => c.class === cls) }));
    this.eyeBlinkParams = tagged("CubismEyeBlinkParameter").map((x) => this.params.idx(x.id));
    this.harmonic = tagged("CubismHarmonicMotionParameter").map((x) => {
      if (x.c.Direction !== 2) throw new Error("harmonic direction other than Centric not implemented");
      return { i: this.params.idx(x.id), channel: x.c.Channel, origin: x.c.NormalizedOrigin,
               range: x.c.NormalizedRange, duration: x.c.Duration, t: 0 };
    });
    const hc = comp("CubismHarmonicMotionController");
    if (hc.BlendMode !== 1) throw new Error("harmonic blend mode not implemented");
    this.harmonicTimescales = hc.ChannelTimescales.slice();

    const blink = comp("CubismAutoEyeBlinkInput");
    this.blink = { mean: blink.Mean, dev: blink.MaximumDeviation, timescale: blink.Timescale,
                   isBlinking: true, phase: 0, nbt: 0, closing: 1.0, closed: 0.5, opening: 1.5, ut: 0, ss: 0 };
    if (comp("CubismEyeBlinkController").BlendMode !== 2) throw new Error("eye blink blend mode not implemented");
    this.eyeOpening = comp("CubismEyeBlinkController").EyeOpening;
    const mouth = comp("CubismMouthController");
    if (mouth.BlendMode !== 0) throw new Error("mouth blend mode not implemented");
    this.mouthOpening = mouth.MouthOpening;
    this.mouthOpenY = this.params.index.has("ParamMouthOpenY") ? this.params.idx("ParamMouthOpenY") : -1;
    if ([...this.prefab.nodes.values()].some((e) => e.node.components.some((c) => c.class === "CubismPosePart")))
      throw new Error("pose parts not implemented");

    // a model without CubismPhysicsController has no physics (the update controller's chain has no order 800)
    const pc = this.prefab.components(rootPath, "CubismPhysicsController");
    if (pc.length > 1) throw new Error(`${pc.length} CubismPhysicsController components`);
    this.physics = pc.length ? new Live2DPhysics(pc[0]._rig, this.params) : null;

    // state
    this.showing = false; this.pausing = false; this.ignoreAllUpdate = false;
    this.warmupState = 0; this.initialized = false;
    this.motionSpeed = 1; this.isAutoEyeBlinking = true; this.isCurrentMotionDefault = false;
    this.lightingEnabled = false; this.disableLightingForMultiply = false; this.postCompositeBrightness = false;
    this.brightness = 1;
    this.maskEnabled = true;
    // Live2DCharacterController
    this.ctl = { currentMotion: "", currentExpression: "", nextMotion: "", loopMotion: false, motionFade: -1,
                 exprFade: -1, hasAppliedExpression: false, nextMotionFade: -1 };
    // motion layer + Animator
    this.layer = { list: [], finished: true, paused: false };
    this.anim = null;                   // { clip, time, speed }
    // CubismRenderController.SetMultiplyTexture(null, 0.3): the call the game makes without a stage (white texture)
    this.multiplyTexture = { texture: null, uv: { x: 1, y: 1, z: 0, w: 0 }, intensity: 0.3, amplitude: { x: 0, y: 0 },
                             frequency: 0.5 };

    this.model = { ignore: false, wasJustEnabled: false, lastTick: -1, didExecute: false, dyn: null };
    this._initRender(comp("CubismRenderController"));
    this._initMasks();
  }

  // ------------------------------------------------------------------------------------------------ CubismModel
  _execute() {                          // CubismTaskableModel.Execute
    const core = this.core, d = core.drawables;
    core.parameters.values.set(this.params.value);
    core.parts.opacities.set(this.parts);
    core.update();
    const n = d.count;
    const dyn = this.model.dyn || { flags: new Uint8Array(n), opacity: new Float32Array(n),
                                    renderOrder: new Int32Array(n), pos: new Array(n).fill(null),
                                    screen: new Array(n).fill(null) };
    for (let i = 0; i < n; i++) {
      const fl = d.dynamicFlags[i];
      dyn.flags[i] = fl;
      dyn.opacity[i] = d.opacities[i];
      dyn.renderOrder[i] = d.renderOrders[i];
      if (fl & CUBISM.VERTEX_POSITIONS_DID_CHANGE) {
        dyn.pos[i] = Float32Array.from(d.vertexPositions[i]);
        if (fl & CUBISM.BLEND_COLOR_DID_CHANGE) {
          const s = d.screenColors;
          dyn.screen[i] = [s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]];
        }
      }
    }
    core.resetDynamicFlags();
    this.model.dyn = dyn;
    this.model.didExecute = true;
  }

  // CubismModel.OnModelUpdate (end of PreLateUpdate, and forced updates): parameters written raw, csmUpdateModel
  modelUpdate() {
    const m = this.model;
    if (m.ignore) return;
    if (m.lastTick === this.loop.frameCount) return;
    m.lastTick = this.loop.frameCount;
    this._execute();
    if (m.wasJustEnabled) { m.wasJustEnabled = false; this._modelOnUpdate(); }
  }

  // CubismModel.ForceUpdateNow
  forceModelUpdate() {
    const m = this.model;
    m.ignore = false; m.wasJustEnabled = true; m.lastTick = -1;
    this.modelUpdate();
  }

  // CubismModel.OnUpdate: TryReadParameters, CubismParameterStore.RestoreParameters, OnDynamicDrawableData
  _modelOnUpdate() {
    const m = this.model;
    if (m.wasJustEnabled || !m.didExecute) return;
    this.params.value.set(this.core.parameters.values);
    this.store.restore();
    this._onDynamicDrawableData(m.dyn);
  }

  // ---------------------------------------------------------------------------------------------------- renderers
  // CubismRenderer.TryInitialize per drawable: two meshes (the displayed one and the one written next), vertex
  // colours, the material of its MeshRenderer, sorting mode 2 (BackToFrontOrder, set by Live2DCharacter.Init: every
  // drawable at z = 0, sortingOrder = controller order + local order + Core render order).
  _initRender(rc) {
    const d = this.core.drawables, n = d.count;
    const byIndex = new Array(n);
    for (const e of this.prefab.nodes.values()) {
      const dc = e.node.components.find((c) => c.class === "CubismDrawable");
      if (!dc) continue;
      if (d.ids[dc._unmanagedIndex] !== e.node.name) throw new Error(`drawable ${e.node.name} index mismatch`);
      e.transform.localPosition = { x: 0, y: 0, z: 0 };
      const r = e.node.components.find((c) => c.class === "CubismRenderer");
      const mr = e.node.components.find((c) => c.type === "MeshRenderer");
      if (!r || !mr) throw new Error(`${e.node.name}: no CubismRenderer / MeshRenderer`);
      if (mr.m_Materials.length !== 1) throw new Error(`${e.node.name}: ${mr.m_Materials.length} materials`);
      byIndex[dc._unmanagedIndex] = { node: e.node, transform: e.transform, cr: r, material: mr.m_Materials[0] };
    }
    this.rc = { sortingOrder: rc._sortingOrder, opacity: rc.Opacity };
    this.renderers = byIndex.map((x, i) => {
      if (!x) throw new Error(`drawable ${i} has no node`);
      const pos = Float32Array.from(d.vertexPositions[i]);
      const cf = d.constantFlags[i], visible = !!(d.dynamicFlags[i] & CUBISM.IS_VISIBLE);
      const mc = d.multiplyColors, sc = d.screenColors;
      const r = {
        index: i, id: d.ids[i], name: x.node.name, transform: x.transform, material: x.material,
        textureDesc: x.cr._mainTexture, localSortingOrder: x.cr._localSortingOrder,
        color: { ...x.cr._color }, opacity: d.opacities[i], renderOrder: d.renderOrders[i],
        meshes: [{ pos, color: null, bounds: null }, { pos: Float32Array.from(pos), color: null, bounds: null }],
        front: 0, thisSwap: {}, lastSwap: {}, enabled: visible, isMaskSource: false,
        doubleSided: !!(cf & CUBISM.IS_DOUBLE_SIDED), multiplyBlend: !!(cf & CUBISM.BLEND_MULTIPLICATIVE),
        additiveBlend: !!(cf & CUBISM.BLEND_ADDITIVE), invertedMask: !!(cf & CUBISM.IS_INVERTED_MASK),
        multiplyColor: [mc[i * 4], mc[i * 4 + 1], mc[i * 4 + 2], mc[i * 4 + 3]],   // frozen at the enable-time colour
        screenColor: [sc[i * 4], sc[i * 4 + 1], sc[i * 4 + 2], sc[i * 4 + 3]],
        lightingEnabled: 0, sortingOrder: 0,
        indices: d.indices[i], uvs: d.vertexUvs[i], maskTile: null, maskTransform: null, junction: -1,
      };
      for (const m of r.meshes) { m.color = this._vertexColor(r); m.bounds = Live2DCharacter.bounds(m.pos); }
      return r;
    });
    for (const r of this.renderers) this._applySorting(r);
  }

  // Mesh.RecalculateBounds of the x / y extents
  // ENGINE: Mesh.RecalculateBounds is native; centre = (max + min) * 0.5, extents = (max - min) * 0.5 in float32.
  static bounds(pos) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < pos.length; k += 2) {
      const x = pos[k], y = pos[k + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { cx: F(F(x1 + x0) * 0.5), cy: F(F(y1 + y0) * 0.5), ex: F(F(x1 - x0) * 0.5), ey: F(F(y1 - y0) * 0.5) };
  }

  _vertexColor(r) {                     // CubismRenderer.ApplyVertexColors
    const c = r.color;
    return [c.r, c.g, c.b, F(c.a * r.opacity)];
  }

  _applySorting(r) { r.sortingOrder = this.rc.sortingOrder + r.localSortingOrder + r.renderOrder; }

  _swap(r) {                            // CubismRenderer.SwapMeshes
    if (!r.enabled && !r.thisSwap.visible && !r.isMaskSource) { r.lastSwap = { ...r.thisSwap }; return; }
    const back = r.front;
    r.front = r.front === 0 ? 1 : 0;
    r.meshes[back].color = this._vertexColor(r);
    r.lastSwap = r.thisSwap; r.thisSwap = {};
  }

  // CubismRenderController.OnDynamicDrawableData
  _onDynamicDrawableData(dyn) {
    const C = CUBISM;
    const DIRTY = C.VISIBILITY_DID_CHANGE | C.OPACITY_DID_CHANGE | C.DRAW_ORDER_DID_CHANGE |
                  C.RENDER_ORDER_DID_CHANGE | C.VERTEX_POSITIONS_DID_CHANGE | C.BLEND_COLOR_DID_CHANGE;
    for (const r of this.renderers) {
      const i = r.index, fl = dyn.flags[i];
      if (r.lastSwap.visible) r.enabled = true;                 // UpdateVisibility
      if (r.lastSwap.invisible) r.enabled = false;
      if (r.lastSwap.newRenderOrder) { this._applySorting(r); r.lastSwap.newRenderOrder = false; }
      if (!(fl & DIRTY)) continue;
      let swap = false;
      if (fl & C.VISIBILITY_DID_CHANGE) {
        const v = !!(fl & C.IS_VISIBLE);
        r.thisSwap.visible = v; r.thisSwap.invisible = !v; swap = true;
      }
      if (fl & C.RENDER_ORDER_DID_CHANGE) {
        swap = true;
        if (r.renderOrder !== dyn.renderOrder[i]) { r.renderOrder = dyn.renderOrder[i]; r.thisSwap.newRenderOrder = true; }
      }
      if (fl & C.OPACITY_DID_CHANGE) { r.opacity = dyn.opacity[i]; swap = true; }
      if (fl & C.VERTEX_POSITIONS_DID_CHANGE) {
        if (r.enabled || r.thisSwap.visible || r.isMaskSource) {      // OnDrawableVertexPositionsDidChange
          const m = r.meshes[r.front];
          m.pos = dyn.pos[i];
          m.bounds = Live2DCharacter.bounds(m.pos);
        }
        this._swap(r);
      } else if (swap) this._swap(r);
      if ((fl & C.BLEND_COLOR_DID_CHANGE) && dyn.screen[i]) r.screenColor = dyn.screen[i];
    }
  }

  // the displayed mesh (MeshFilter.mesh) of a renderer
  displayed(r) { return r.meshes[r.front]; }

  _applyBrightness() {                  // Live2DCharacter.ApplyBrightnessColor -> CubismRenderController.SetColor
    const b = this.postCompositeBrightness ? 1 : this.brightness;
    for (const r of this.renderers) r.color = { r: b, g: b, b, a: 1 };
  }

  setUsePostCompositeBrightness(flag) { this.postCompositeBrightness = flag; this._applyBrightness(); }

  // -------------------------------------------------------------------------------------------------------- masks
  // CubismMaskController: one junction per distinct mask list of the masked drawables (first-seen order), each mask
  // drawable a mask source; tiles of the 1024 x 1024 mask texture from CubismMaskTilePool / ToTile (one render
  // texture, 4 channels, at most 36 junctions).
  _initMasks() {
    const d = this.core.drawables;
    const junctions = [], key = new Map();
    for (const r of this.renderers) {
      if (!(d.maskCounts[r.index] > 0)) continue;
      const masks = [...d.masks[r.index]].filter((m) => m >= 0);
      const k = masks.join(",");
      if (!key.has(k)) { key.set(k, junctions.length); junctions.push({ masks, maskeds: [] }); }
      const j = key.get(k);
      junctions[j].maskeds.push(r.index);
      r.junction = j;
    }
    for (const j of junctions) for (const m of j.masks) this.renderers[m].isMaskSource = true;
    const used = junctions.length;
    if (used > 36) throw new Error(`${used} mask junctions exceed the tile pool`);
    const perSheet = used, div = Math.floor(perSheet / 4), mod = perSheet % 4;
    const layout = [];
    let ch = -1, idx = 0;
    while (idx < used) {
      ch++;
      if (ch > 3) throw new Error("mask layout needs a second render texture");
      const n = div + (ch < mod ? 1 : 0);
      for (let k = 0; k < n && idx < used; k++) layout[idx++] = { ch, n, k };
      if (n === 0 && ch >= 3) throw new Error("mask layout overflow");
    }
    junctions.forEach((j, i) => {
      const c = layout[i];
      let col = 0, row = 0, size = 1;
      if (c.n < 2) { col = 0; row = 0; size = 1; }
      else if (c.n <= 4) { col = Math.floor(c.k / 2); row = c.k % 2; size = 0.5; }
      else if (c.n <= 9) { col = Math.floor(c.k / 3); row = c.k % 3; size = F(0.33333334); }
      else throw new Error("mask tile layout");
      j.tile = [c.ch, col, row, size];
    });
    this.junctions = junctions;
    this.maskDirty = false;
  }

  // CubismMaskController.OnLateUpdate (order 10100): junction transforms from the displayed meshes' bounds, and the
  // mask texture flagged for redraw
  _maskLateUpdate() {
    if (!this.maskEnabled || !this.junctions.length) return;
    this.maskDirty = true;
    for (const j of this.junctions) {
      let lx, ly, hx, hy;
      j.masks.forEach((m, q) => {
        const b = this.displayed(this.renderers[m]).bounds;
        const x0 = F(b.cx - b.ex), y0 = F(b.cy - b.ey), x1 = F(b.cx + b.ex), y1 = F(b.cy + b.ey);
        if (q === 0) { lx = x0; ly = y0; hx = x1; hy = y1; }
        else { lx = Math.min(lx, x0); ly = Math.min(ly, y0); hx = Math.max(hx, x1); hy = Math.max(hy, y1); }
      });
      const e1x = F(F(0 - lx) * 0.5), e1y = F(F(0 - ly) * 0.5);
      const mx = F(F(lx + e1x) - e1x), my = F(F(ly + e1y) - e1y);
      const Ex = F(F(hx - mx) * 0.5), Ey = F(F(hy - my) * 0.5);
      const Cx = F(mx + Ex), Cy = F(my + Ey);
      const sx = F(Ex + Ex), sy = F(Ey + Ey), s = sx > sy ? sx : sy;
      j.transform = [Cx, Cy, F(1 / s), 0];
      for (const i of j.maskeds) { this.renderers[i].maskTile = j.tile; this.renderers[i].maskTransform = j.transform; }
    }
  }

  // ------------------------------------------------------------------------------------------------------ motions
  // CubismMotionController.PlayAnimation (isLoop false, priority 3) with CubismMotionLayer.CreateFadePlayingMotion /
  // PlayAnimation and Live2DCharacter.KeepPreviousMotionAsFadeSourceIfNeeded
  _playAnimation(clip, fadeInTime) {
    const t = this.loop.time, M = this.fadeById.get(clip.instanceId);
    const pm = { clip, motion: M, startTime: t, fadeInStartTime: t, speed: this.motionSpeed, isLooping: false,
                 instanceId: clip.instanceId, endInvoked: false,
                 endTime: M.length > 0 ? F(F(M.length / this.motionSpeed) + t) : -1,
                 fadeInTime: fadeInTime >= 0 ? fadeInTime : M.fadeInTime };
    const L = this.layer.list;
    if (L.length) {
      const prev = L[L.length - 1];
      const nt = F(t + prev.motion.fadeOutTime);
      if (Math.max(prev.endTime, 0) > nt) prev.endTime = nt;
      prev.isLooping = false;
    }
    L.push(pm);
    this.layer.finished = false;
    this.anim = { clip, time: 0, speed: this.motionSpeed };
    if (L.length > 1 && pm.fadeInTime > 0) {
      const prev = L[L.length - 2];
      const t2 = F(t + (prev.motion.fadeOutTime >= 0 ? prev.motion.fadeOutTime : 0));
      if (prev.endTime < t2) prev.endTime = t2;
      prev.isLooping = false;
    }
  }

  // Live2DCharacter.PlayMotion
  _charPlayMotion(name, fade) {
    const clip = this.clips.get(name);
    if (!clip || !this.showing) return;
    if (this.pausing) throw new Error("a motion while paused is not implemented");
    this._playAnimation(clip, fade);
    this.isCurrentMotionDefault = name === this.defaultMotionName;
    this.blink.isBlinking = false;
  }

  // Live2DCharacter.Idle
  _idle(fade) {
    const clip = this.clips.get(this.defaultMotionName);
    if (!clip || !this.showing) return;
    this._playAnimation(clip, fade);
    this.isCurrentMotionDefault = true;
    this.blink.isBlinking = this.isAutoEyeBlinking;
  }

  // CubismMotionLayer.Update: motion end (Time.time > EndTime) -> Live2DCharacter.OnPlayMotionFinished
  _layerUpdate() {
    if (this.layer.paused) return;
    let all = true;
    for (const pm of this.layer.list) {
      if (pm.isLooping || pm.endInvoked) continue;
      if (this.loop.time > pm.endTime) {
        pm.endInvoked = true;
        this.blink.isBlinking = this.isAutoEyeBlinking;
      } else all = false;
    }
    if (all) this.layer.finished = true;
  }

  anyMotionPlaying() { return !this.layer.finished; }

  // PreLateUpdate DirectorUpdateAnimation: the newest clip playable advances and its curves are written (a model
  // curve on CubismEyeBlinkController.EyeOpening replaces the auto eye blink's value while its clip is the newest)
  // ENGINE: a clip playable created in Update is first sampled after one advance (at t = deltaTime x speed).
  animatorUpdate() {
    if (!this.showing || !this.anim) return;
    const a = this.anim;
    if (!this.layer.paused) a.time += this.loop.deltaTime * a.speed;
    a.clip.write(a.time, this.params.value, this);
  }

  // CubismFadeController.OnLateUpdate (order 100): while the newest motion fades in, every motion's curves are
  // blended onto the values restored from the order-150 snapshot of the previous frame
  _fade() {
    const t = this.loop.time, L = this.layer.list;
    if (!L.length) return;
    const last = L[L.length - 1];
    const e = (x) => F(F(t - x.fadeInStartTime) * x.speed);
    const el = e(last);
    let fading = false;
    if (L.length > 1) {
      const M = last.motion;
      for (let j = 0; j < M.pfit.length && !fading; j++)
        fading = el <= last.fadeInTime || (M.pfit[j] >= 0 && el <= M.pfit[j]);
    }
    if (!fading) {
      for (let j = L.length - 2; j >= 0; j--) if (L[j].endTime < t) L.splice(j, 1);
      return;
    }
    this.store.restore();
    const P = this.params;
    for (const pm of L) {
      const M = pm.motion;
      const ep = e(pm);
      const fi = pm.fadeInTime > 0 ? easeSine(F(ep / pm.fadeInTime)) : 1;
      const fo = (M.fadeOutTime > 0 && pm.endTime >= 0) ? easeSine(F(F(pm.endTime - t) / M.fadeOutTime)) : 1;
      const w = F(1 * F(fi * fo));
      const endArg = F(pm.endTime - ep);
      for (const [i, c] of M.curveOf) {
        const v = clampF(hermite(c.keys, ep), P.min[i], P.max[i]);
        const pfit = M.pfit[c.k], pfot = M.pfot[c.k];
        let wp = w;
        if (!(pfit < 0 && pfot < 0)) {
          const wi = pfit >= 0 ? (pfit >= 1.4e-45 ? easeSine(F(ep / pfit)) : 1) : fi;
          const wo = pfot >= 0 ? ((endArg >= 0 && pfot >= 1.4e-45) ? easeSine(F(endArg / pfot)) : 1) : fo;
          wp = F(wi * wo);
        }
        P.override(i, F(F(F(v - P.value[i]) * wp) + P.value[i]), 1);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------- expressions
  // CubismExpressionController.OnLateUpdate (order 300, non-legacy blend)
  _expressionUpdate() {
    const X = this.expr, P = this.params, dt = this.loop.deltaTime;
    if (X.current !== X.last) {        // StartExpression
      X.last = X.current;
      if (X.list.length) {
        const l = X.list[X.list.length - 1];
        const u = F(l.u + l.fadeOut);
        l.endTime = (l.endTime === 0 || u < l.endTime) ? u : l.endTime;
      }
      if (X.current >= 0 && X.current < this.expressions.length) {
        const d = this.expressions[X.current];
        X.list.push({ data: d, fadeIn: d.fadeIn < 0 ? 1 : d.fadeIn, fadeOut: d.fadeOut < 0 ? 1 : d.fadeOut,
                      weight: 1, u: 0, start: 0, endTime: 0, fw: 0 });
      }
    }
    let W = 0;
    X.list.forEach((pe, idx) => {
      for (const d of pe.data.dest)
        if (!X.epv.some((x) => x.i === d.i)) X.epv.push({ i: d.i, add: 0, mul: 1, ov: P.value[d.i] });
      const fin = X.fadeIn >= 0 ? X.fadeIn : pe.fadeIn;
      pe.u = F(pe.u + dt);
      const FI = Math.abs(fin) >= 1.4e-45 ? easeSine(F(pe.u / fin)) : 1;
      const FO = (Math.abs(pe.endTime) >= 1.4e-45 && pe.endTime >= 0) ? easeSine(F(F(pe.endTime - pe.u) / pe.fadeOut)) : 1;
      pe.fw = F(FO * F(pe.weight * FI));
      for (const x of X.epv) {
        const cur = P.value[x.i];
        const k = pe.data.dest.find((d) => d.i === x.i);
        let a = 0, m = 1, o = cur;
        if (k) { if (k.blend === 1) a = k.v; else if (k.blend === 2) m = k.v; else o = k.v; }
        if (idx === 0) { x.add = a; x.mul = m; x.ov = o; }
        else {
          const w = pe.fw, iw = F(1 - w);
          x.add = F(F(a * w) + F(x.add * iw)); x.mul = F(F(m * w) + F(x.mul * iw)); x.ov = F(F(o * w) + F(cur * iw));
        }
      }
      W = F(W + (fin !== 0 ? easeSine(F(F(pe.u - pe.start) / fin)) : 1));
    });
    if (X.list.length > 1 && X.list[X.list.length - 1].fw >= 1) X.list.splice(0, X.list.length - 1);
    W = Math.min(W, 1);
    for (const x of X.epv) P.override(x.i, F(F(x.add + x.ov) * x.mul), W);
  }

  // Live2DCharacter.ResetExpressionParametersToDefault
  _resetExpressionParameters() {
    for (const i of this.exprParams) this.params.value[i] = this.params.def[i];
    this.store.save();
  }

  // Live2DCharacter.PlayExpression
  _charPlayExpression(name, fade) {
    const idx = this.expressionIndex.get(name);
    if (idx === undefined || !this.showing) return;
    if (this.pausing) throw new Error("an expression while paused is not implemented");
    this._resetExpressionParameters();
    this.expr.fadeIn = fade;
    this.expr.current = idx;
  }

  // ------------------------------------------------------------------------------------------------ blink, breath
  // CubismAutoEyeBlinkInput.UpdateEyeBlink (the game's four linear phases; the interval from UnityEngine.Random)
  _blinkUpdate() {
    const B = this.blink, dt = this.loop.deltaTime;
    B.ut = F(B.ut + F(dt * B.timescale));
    let v;
    switch (B.phase) {
      case 0:
        if (B.isBlinking) { B.nbt = F(B.nbt - dt); if (B.nbt < 0) { B.phase = 1; B.ss = B.ut; } }
        v = 1; break;
      case 1: {
        const t = F(F(B.ut - B.ss) / B.closing);
        if (t >= 1) { B.ss = B.ut; B.phase = 2; }
        v = F(1 - t); break;
      }
      case 2:
        if (F(F(B.ut - B.ss) / B.closed) >= 1) { B.ss = B.ut; B.phase = 3; }
        v = 0; break;
      case 3: {
        const t = F(F(B.ut - B.ss) / B.opening);
        if (t >= 1) { B.phase = 0; B.nbt = F(B.mean + this.random.range(-B.dev, B.dev)); v = 1; } else v = t;
        break;
      }
      default: v = 0;
    }
    this.eyeOpening = v;
  }

  // CubismHarmonicMotionController.OnLateUpdate (order 600): Centric, additive
  _harmonicUpdate() {
    const dt = this.loop.deltaTime, P = this.params;
    for (const h of this.harmonic) {
      h.t = F(h.t + F(dt * this.harmonicTimescales[h.channel]));
      while (h.duration < h.t) h.t = F(h.t - h.duration);
      const vr = F(P.max[h.i] - P.min[h.i]);
      let origin = F(P.min[h.i] + F(h.origin * vr));
      const range = F(vr * h.range);
      origin = clampF(origin, P.min[h.i], P.max[h.i]);
      const v = F(origin + F(range * F(Math.sin(F(F(h.t * F(6.2831855)) / h.duration)))));
      P.add(h.i, v, 1);
    }
  }

  // ------------------------------------------------------------------------------------------------- frame phases
  _gate() { return !(this.ignoreAllUpdate || this.pausing || !this.showing || this.warmupState <= 1); }

  _onUpdateInternal() {                 // Live2DCharacter.OnUpdateInternal
    this._layerUpdate();
    this._modelOnUpdate();
  }

  _onLateUpdateInternal() {             // Live2DCharacter.OnLateUpdateInternal: the CubismUpdateController chain
    const P = this.params;
    this._fade();                                                  // 100
    this.store.save();                                             // 150
    this._expressionUpdate();                                      // 300
    for (const i of this.eyeBlinkParams) P.multiply(i, this.eyeOpening, 1);   // 400
    if (this.mouthOpenY >= 0) P.override(this.mouthOpenY, this.mouthOpening, 1);  // 500
    this._harmonicUpdate();                                        // 600
    if (this.physics) this.physics.evaluate(this.loop.deltaTime); // 800
    this._renderLateUpdate();                                      // 10000
    this._maskLateUpdate();                                        // 10100
    if (!this.pausing) this._blinkUpdate();                        // CubismAutoEyeBlinkInput.OnLateUpdate
  }

  _renderLateUpdate() {                 // _LightingEnabled per renderer (ApplyLightingState)
    for (const r of this.renderers) {
      const light = this.lightingEnabled && !(this.disableLightingForMultiply && r.multiplyBlend);
      r.lightingEnabled = light ? 1 : 0;
    }
  }

  // Live2DCharacterController.OnUpdate (Update phase)
  update() {
    if (!this.initialized || !this.showing) return;
    if (!this._gate()) return;
    this.model.ignore = false;
    this._onUpdateInternal();
    if (!this.anyMotionPlaying()) this._handlingLoopMotion();
  }

  // Live2DCharacterController.OnLateUpdate
  lateUpdate() {
    if (!this.initialized || !this._gate()) return;
    this._onLateUpdateInternal();
  }

  _handlingLoopMotion() {               // Live2DCharacterController.HandlingLoopMotion
    const c = this.ctl;
    if (c.nextMotion) { const n = c.nextMotion, fd = c.nextMotionFade; c.nextMotion = ""; c.nextMotionFade = -1; this.playMotion(n, fd); }
    else if (c.currentMotion === this.defaultMotionName) this._idle(0);
    else if (c.loopMotion) this.playMotion(c.currentMotion, c.motionFade);
  }

  // ---------------------------------------------------------------------------------------------------- lifecycle
  // Live2DCharacter.Init, Live2DCharacterController.Warmup (standby) and the loader's hide. Runs over frames of the
  // loop: the owner keeps stepping it until the promise resolves.
  async load() {
    this.root.localPosition = { ...this.basePosition };
    this.root.localScale = { x: this.baseScale, y: this.baseScale, z: this.baseScale };
    this.root.localRotation = quat.identity();
    this.setUsePostCompositeBrightness(false);
    this.blink.nbt = F(this.blink.mean + this.random.range(-this.blink.dev, this.blink.dev));   // Start
    this.harmonicTimescales[0] = 1;
    // Warmup
    this.warmupState = 1;
    this._show(); this._idle(-1); this._charPlayExpression(this.defaultExpressionName, -1);
    if (this.physics) this.physics.stabilize();
    this.forceModelUpdate();
    this._renderLateUpdate(); this._maskLateUpdate();
    for (let k = 0; k < 4; k++) {
      await this.loop.yield("Update"); this._onUpdateInternal();
      await this.loop.yield("PostLateUpdate"); this._onLateUpdateInternal();
    }
    await this.loop.delayFrame(3); this.warmupState = 2; await this.loop.delayFrame(3);
    this.warmupState = 3;
    this.initialized = true;
    this.hide();
    this.setIgnoreAllUpdate(true);
  }

  _show() {                             // Live2DCharacter.Show (the components' OnEnable rebuild the motion graph)
    this.showing = true; this.pausing = false;
    this.layer = { list: [], finished: true, paused: false };
    this.anim = null;
  }

  // Live2DCharacterController.Show: the motion (default if empty) and the expression (default if empty)
  show(motion, expression, fade) {
    this._show();
    if (!motion) this.playMotion(this.defaultMotionName, fade); else this.playMotion(motion, fade);
    if (!expression) this.playDefaultExpression(fade); else this.playExpression(expression, fade);
  }

  hide() {                              // Live2DCharacterController.Hide -> Live2DCharacter.Hide
    this.pausing = false;
    this.blink.isBlinking = (this.anyMotionPlaying() && !this.isCurrentMotionDefault) ? false : this.isAutoEyeBlinking;
    this.isCurrentMotionDefault = false;
    this._resetExpressionParameters();
    const ig = this.model.ignore;
    this.forceModelUpdate();
    this.model.ignore = ig;
    this.showing = false;
    this.layer = { list: [], finished: true, paused: false };
    this.anim = null;
    this.ctl.hasAppliedExpression = false;
  }

  get isShowing() { return this.showing; }

  playMotion(name, fade) {              // Live2DCharacterController.PlayMotion
    if (!name) return;
    this.ctl.currentMotion = name; this.ctl.motionFade = fade;
    this._charPlayMotion(name, fade);
  }

  playExpression(name, fade) {          // Live2DCharacterController.PlayExpression
    if (!name) return;
    const c = this.ctl;
    if (c.hasAppliedExpression && c.currentExpression.toLowerCase() === name.toLowerCase()) { c.exprFade = fade; return; }
    c.currentExpression = name; c.exprFade = fade;
    this._charPlayExpression(name, fade);
    c.hasAppliedExpression = this.showing;
  }

  playDefaultExpression(fade) {         // Live2DCharacterController.PlayDefaultExpression
    const c = this.ctl;
    c.currentExpression = this.defaultExpressionName; c.exprFade = fade;
    this._charPlayExpression(this.defaultExpressionName, fade);
    c.hasAppliedExpression = this.showing;
  }

  setIgnoreAllUpdate(flag) {            // Live2DCharacter.SetIgnoreAllUpdate
    this.ignoreAllUpdate = flag;
    this.maskEnabled = !flag;
    this.model.ignore = flag;
    if (!flag && this.showing) { this.forceModelUpdate(); this._modelOnUpdate(); this._maskLateUpdate(); }
  }

  setLightingEnabled(flag) { this.lightingEnabled = flag; this._renderLateUpdate(); }
  setDisableLightingForMultiplyBlendDrawables(flag) { this.disableLightingForMultiply = flag; this._renderLateUpdate(); }
  setPhysicsEnabled(flag) { if (this.physics) this.physics.allow = flag; }   // CubismPhysicsController.enabled
  setBreathMotionEnabled(flag) { this.harmonicTimescales[0] = flag ? 1 : 0; }   // ChannelTimescales[0]
  get physicsEnabled() { return !!this.physics && this.physics.allow; }
  get hasPhysics() { return !!this.physics; }
  get breathMotionEnabled() { return this.harmonicTimescales[0] !== 0; }

  release() { this.core.release(); }
}
