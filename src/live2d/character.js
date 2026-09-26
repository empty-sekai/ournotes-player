import { F } from "../engine/core.js";
import { quat } from "../engine/math.js";
import { Prefab } from "../engine/prefab.js";
import { UnityRandom } from "../engine/random.js";
import { EASE } from "../engine/tween.js";
import { CUBISM, CubismModel } from "./cubism.js";
import { Live2DLipSyncController, lipSyncProfile } from "./lipsync.js";
import { Live2DParameterStore, Live2DParameters, clampF, easeSine, hermite } from "./math.js";
import { Live2DClip, Live2DFadeMotion } from "./motion.js";
import { CubismMotionSyncController } from "./motionsync.js";
import { Live2DParameterLoopController } from "./paramloop.js";
import { Live2DPhysics } from "./physics.js";

// Live2DCharacter: one Live2D model as the game's ADV runs it. The game layer (Live2DAnimation.Live2DCharacter and
// Live2DCharacterController) over its fork of Cubism SDK for Unity: parameters, motions (the Animator's clip output
// and CubismFadeController), expressions, auto eye blink, harmonic breath, physics, the model update with its
// double-buffered meshes, sorting, colours and the mask layout. Simulation only; drawing is in drawing.js.
//
// One frame, driven by the owner through a PlayerLoop (hooks in Unity phase order):
//   update       update()          Live2DCharacterController.OnUpdate: parameter loop time, eye-blink stop transition,
//                                  motion end, model read-back, voice PCM for lip sync, idle replay
//   animation    animatorUpdate()  the PlayableGraph (DirectorUpdateAnimation) writes the newest clip's values
//   lateUpdate   lateUpdate()      Live2DCharacter.OnLateUpdate: the CubismUpdateController chain, auto eye blink,
//                                  lip sync, the angle and look overrides
//   preLateEnd   modelUpdate()     CubismModel.OnModelUpdate: parameters to the Core, csmUpdateModel
// A frame displays the Core result of the parameters finished two LateUpdates earlier (the game's latency).
//
// The story's calls into the game layer are here too: lip sync (lipsync.js; voice MotionSync through motionsync.js,
// timed pseudo lip sync, CRI Lips, manual mouth opening), the angle and look overrides with their tweens, the
// eye-blink stop override, the parameter loop (paramloop.js), pause / resume with the requests made while paused,
// motion speed, seeking the playing motion, sorting order, layer, parent and brightness. Each is inert until called:
// the model viewer calls none of them.
//
// The managed math is float32 without FMA; F (Math.fround) is applied in source order.

export class Live2DCharacter {
  // prefab: the exported model prefab; mocBytes: the moc3 (ArrayBuffer); loop: the PlayerLoop that drives the model.
  // opts.random: the UnityRandom stream (UnityEngine.Random) of the auto eye blink and the pseudo lip sync (default:
  // a stream seeded from the clock). opts.motionSync: the MotionSync Core (motionsync.js motionSyncCore()) for voice
  // lip sync, or null.
  constructor(prefab, mocBytes, loop, { random = null, motionSync = null } = {}) {
    this.loop = loop;
    this.random = random || new UnityRandom(Date.now() >>> 0);
    this.motionSyncCore = motionSync;
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
      // CubismPlayingExpression.Create: FindById is null for an id the model lacks; UpdateExpression and
      // ResetExpressionParametersToDefault skip such a destination
      dest: e.Parameters.filter((p) => this.params.index.has(p.Id))
        .map((p) => ({ i: this.params.idx(p.Id), v: p.Value, blend: p.Blend })),
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
    // baseTimescale: the Timescale that SetBlinkingSpeed scales
    this.blink = { mean: blink.Mean, dev: blink.MaximumDeviation, timescale: blink.Timescale,
                   baseTimescale: blink.Timescale,
                   isBlinking: true, phase: 0, nbt: 0, closing: 1.0, closed: 0.5, opening: 1.5, ut: 0, ss: 0 };
    if (comp("CubismEyeBlinkController").BlendMode !== 2) throw new Error("eye blink blend mode not implemented");
    this.eyeOpening = comp("CubismEyeBlinkController").EyeOpening;
    const mouth = comp("CubismMouthController");
    if (mouth.BlendMode !== 0) throw new Error("mouth blend mode not implemented");
    this.mouthOpening = mouth.MouthOpening;
    this.mouthOpenY = this.params.index.has("ParamMouthOpenY") ? this.params.idx("ParamMouthOpenY") : -1;
    // CubismMouthController.Destinations (Refresh: the parameters tagged CubismMouthParameter) once
    // Live2DCharacter.Init ran RemoveMouthParametersExceptMouthOpenY, which destroys the tag on every other parameter:
    // ParamMouthOpenY when it carries the tag, else none. (EnsureMouthParameter, which adds the tag, is called by the
    // live stage's background characters only.)
    this.mouthDestinations = tagged("CubismMouthParameter").filter((x) => x.id === "ParamMouthOpenY")
      .map((x) => this.params.idx(x.id));
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
    // the viewer's motion notifications: onMotion("start", {name, loop}) / onMotion("end", {name}) (_motionEvent)
    this.onMotion = null;
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
    this._initGameLayer(rootPath, tagged, fl, ch);
  }

  // The rest of Live2DCharacter.Init: the override parameters (a parameter the model lacks is skipped wherever it
  // would be written), the lip sync controller over the model's MotionSync controller, the eye-blink stop targets,
  // the parameter loop controller, the rim light and shadow values and the state of the game layer's overrides.
  _initGameLayer(rootPath, tagged, fadeList, ch) {
    const opt = (id) => (this.params.index.has(id) ? this.params.idx(id) : -1);
    this.mouthForm = opt("ParamMouthForm");
    this.angleXParam = opt("ParamAngleX");
    this.bodyAngleXParam = opt("ParamBodyAngleX");
    this.bodyAngleXAddParam = opt("ParamBodyAngleXAdd");
    this.eyeBallXParam = opt("ParamEyeBallX");
    this.eyeBallYParam = opt("ParamEyeBallY");
    const head = `${rootPath}/Anchors/Head`;
    this.headAnchor = this.prefab.nodes.has(head) ? this.prefab.transform(head) : null;
    this.mouthControllerEnabled = true;            // CubismMouthController.enabled
    this.motionSync = CubismMotionSyncController.fromPrefab((cls) => this.prefab.components(rootPath, cls), this.params,
                                                            this.loop, this.motionSyncCore);
    // ResolveAdvLipSyncPresentationProfile counts the CubismMouthParameter components before
    // RemoveMouthParametersExceptMouthOpenY keeps the one on ParamMouthOpenY
    this.lip = new Live2DLipSyncController(this, lipSyncProfile(tagged("CubismMouthParameter").length));
    this.lip.initMotionSync();                     // SetMotionSyncController
    // CollectEyeBlinkStopNeutralizeTargets: the eye-blink parameters, then ParamEyeLOpen and ParamEyeROpen, once each
    const eb = [...this.eyeBlinkParams, opt("ParamEyeLOpen"), opt("ParamEyeROpen")].filter((i) => i >= 0);
    this.eyeBlinkStop = { stopped: false, wasAuto: false, start: 0, elapsed: 0, duration: 0, targets: [...new Set(eb)] };
    this.defaultFadeMotionName = `${this.defaultMotionName}.fade`;
    this.paramLoop = new Live2DParameterLoopController(fadeList.CubismFadeMotionObjects, this.params, this.store);
    this.breathEnabled = true;                     // _playingHarmonicMotion
    // Live2DCharacter _isOverrideRotate, _isAdditiveOverrideRotate, _angleX, _bodyAngleX and the additive amounts
    // applied last (_appliedAdditiveAngleX, _appliedAdditiveBodyAngleX); the controller's angle tweens
    this.angle = { override: false, additive: false, x: 0, bodyX: 0, appliedX: 0, appliedBodyX: 0, tweens: [] };
    // _isLookEnabled, _lookX, _lookY, _originalLookX, _originalLookY; the controller's look tweens
    this.look = { enabled: false, x: 0, y: 0, ox: 0, oy: 0, tweens: [] };
    // SetPendingMotion / SetPendingExpression / SetPendingParameterLoop: requests made while paused
    this.pending = { motion: null, expression: null, paramLoop: null };
    this.active = this.root.activeSelf !== false;  // the GameObject's activeSelf (Show / Hide)
    this.alive = true;
    // Init: SetRimLightEnabled, SetRimLightIntensity, SetRimLightThreshold, SetRimLightSmoothness and
    // SetShadowIntensity with the component's values (each clamped to [0, 1]). The intensity and the threshold both
    // go to CubismRenderController.SetRimIntensity, so the renderers keep the threshold. _RimColor stays the
    // material's until SetRimLightColor.
    this.rim = { enabled: !!ch._isRimLightEnabled, intensity: clamp01(F(ch._rimLightIntensity ?? 0)),
                 threshold: clamp01(F(ch._rimLightThreshold ?? 0)), smoothness: clamp01(F(ch._rimLightSmoothness ?? 0)),
                 color: null };
    this.shadowIntensity = clamp01(F(ch._shadowIntensity ?? 0));   // not serialised: 0
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
    // renderOpacity: CubismRenderController.Opacity (clips may animate it); rc.opacity: the value last passed to the
    // renderers (_lastOpacity, cubism_ModelOpacity)
    this.renderOpacity = rc.Opacity;
    this.rc = { sortingOrder: rc._sortingOrder, opacity: rc._lastOpacity ?? rc.Opacity };
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

  // Live2DCharacter.PlayMotion (a request while paused is kept and played by Resume)
  _charPlayMotion(name, fade) {
    const clip = this.clips.get(name);
    if (!clip || !this.showing) return;
    if (this.pausing) { this.pending.motion = { name, fade }; return; }
    if (this.angle.override && this.angle.additive) this._restoreAdditiveOverrideAngles();
    this._playAnimation(clip, fade);
    this.isCurrentMotionDefault = name === this.defaultMotionName;
    this.blink.isBlinking = false;
    this._motionEvent("start", name);
  }

  // Live2DCharacter.Idle
  _idle(fade) {
    const clip = this.clips.get(this.defaultMotionName);
    if (!clip || !this.showing) return;
    if (this.angle.override && this.angle.additive) this._restoreAdditiveOverrideAngles();
    this._playAnimation(clip, fade);
    this.isCurrentMotionDefault = true;
    this.blink.isBlinking = this.isAutoEyeBlinking;
    this._motionEvent("start", this.defaultMotionName);
  }

  // A motion started on the motion layer (Live2DCharacter.PlayMotion / Idle; a request made while paused starts on
  // resume), and a playing motion reached its end time (CubismMotionLayer.Update -> OnPlayMotionFinished: its length,
  // or the end of its fade-out under a newer motion). `loop`: it is replayed when it ends (LoopMotion, or the default
  // motion, which HandlingLoopMotion replays).
  _motionEvent(type, name) {
    if (!this.onMotion) return;
    if (type === "start") this.onMotion(type, { name, loop: name === this.defaultMotionName || this.ctl.loopMotion });
    else this.onMotion(type, { name });
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
        this._motionEvent("end", pm.clip.name);
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

  // Live2DCharacter.ForceEvaluateMotionGraph: PlayableGraph.Evaluate() writes the newest clip at its current time
  _forceEvaluateMotionGraph() {
    if (this.anim) this.anim.clip.write(this.anim.time, this.params.value, this);
  }

  // Live2DCharacter.SeekPlayingMotion: the newest clip playable moves forward to min(seconds, length - 0.0001) (never
  // back), and AdvanceMotionFadeElapsedTime moves the newest fade motion's fade-in start back to match
  _seekPlayingMotion(seconds) {
    if (!(0 < seconds) || !this.anim) return;
    const a = this.anim, end = F(a.clip.length + F(-0.0001));
    const s = end <= seconds ? end : seconds;
    if (!(a.time < s)) return;
    a.time = s;
    const L = this.layer.list;
    if (!L.length) return;
    const pm = L[L.length - 1];
    const v = F(this.loop.time - F(s / (pm.speed <= 0 ? 1 : pm.speed)));
    if (v < pm.fadeInStartTime) pm.fadeInStartTime = v;
  }

  // CubismMotionLayer.PauseAnimation (Time.time kept; the root playable's speed 0)
  _pauseLayer() {
    const Y = this.layer;
    if (Y.paused || Y.finished) return;
    Y.paused = true;
    Y.pauseTime = this.loop.time;
  }

  // CubismMotionLayer.ResumeAnimation: every playing motion's times move by the paused time
  _resumeLayer() {
    const Y = this.layer;
    if (!Y.paused || Y.finished) return;
    const d = F(this.loop.time - Y.pauseTime);
    for (const pm of Y.list) {
      pm.startTime = F(d + pm.startTime);
      pm.endTime = F(d + pm.endTime);
      pm.fadeInStartTime = F(d + pm.fadeInStartTime);
    }
    Y.paused = false;
  }

  // CubismMotionLayer.SetStateSpeed for every playing motion (CubismMotionController.SetAnimationSpeed): end and
  // fade-in start rescaled around Time.time, unless the motion has run its length; the newest state plays at the
  // new speed
  _setLayerSpeed(speed) {
    const t = this.loop.time;
    for (const pm of this.layer.list) {
      const M = pm.motion, old = pm.speed;
      if (0 < M.length && M.length <= F(old * F(t - pm.startTime))) continue;
      pm.endTime = F(t + F(F(old * F(pm.endTime - t)) / speed));
      pm.fadeInStartTime = F(t - F(F(old * F(t - pm.fadeInStartTime)) / speed));
      pm.speed = speed;
      if (this.anim) this.anim.speed = speed;
    }
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

  // Live2DCharacter.PlayExpression (a request while paused is kept and played by Resume)
  _charPlayExpression(name, fade) {
    const idx = this.expressionIndex.get(name);
    if (idx === undefined || !this.showing) return;
    if (this.pausing) { this.pending.expression = { name, fade }; return; }
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

  // --------------------------------------------------------------------------------------------- eye-blink stop
  // The eye-blink stop override: the auto eye blink off, EyeOpening eased from its value at the stop to open over the
  // transition, and (order 149) the eye parameters pulled to their defaults while only the default motion plays.
  _eyeBlinkStopRate() {
    const S = this.eyeBlinkStop;
    if (!(0 < S.duration)) return 1;
    const r = F(S.elapsed / S.duration);
    return 0 <= r ? (r <= 1 ? r : 1) : 0;
  }

  _advanceEyeBlinkStopTransition() {    // Live2DCharacter.AdvanceEyeBlinkStopTransition
    const S = this.eyeBlinkStop;
    if (S.stopped && S.elapsed < S.duration) S.elapsed = F(S.elapsed + F(this.loop.deltaTime * this.motionSpeed));
  }

  _applyEyeBlinkStopOverride() {        // Live2DCharacter.ApplyEyeBlinkStopOverride
    const S = this.eyeBlinkStop;
    if (!S.stopped) return;
    const a = this._eyeBlinkStopRate(), w = 0 <= a ? a : 0;
    this.eyeOpening = F(S.start + F(w * F(1 - S.start)));
  }

  _clearEyeBlinkStopOverride() {        // Live2DCharacter.ClearEyeBlinkStopOverride
    const S = this.eyeBlinkStop;
    if (!S.stopped) return;
    S.stopped = false; S.elapsed = 0; S.duration = 0;
    this.isAutoEyeBlinking = S.wasAuto;
    this.blink.isBlinking = (this.anyMotionPlaying() && !this.isCurrentMotionDefault) ? false : this.isAutoEyeBlinking;
  }

  // Live2DCharacter.IsDefaultFadeMotion: the fade motion object named DefaultMotionName + ".fade" (ordinal)
  _isDefaultFadeMotion(M) { return !!M && M.objectName === this.defaultFadeMotionName; }

  // Live2DCharacter.HasLatestDefaultMotionOverriddenNeutralizeTargets: the newest motion is the default one and
  // every neutralize target has finished its fade-in and is not fading out
  _latestDefaultOverridesTargets(latest) {
    const M = latest.motion;
    if (!this._isDefaultFadeMotion(M)) return false;
    const pfit = M.pfit, pfot = M.pfot;
    if (!pfit || !pfot) return false;
    const t = this.loop.time;
    const el = F(F(t - latest.fadeInStartTime) * latest.speed), fin = latest.fadeInTime;
    const outDone = (M.fadeOutTime <= 0 || latest.endTime < 0) ? true : M.fadeOutTime <= F(latest.endTime - t);
    for (const i of this.eyeBlinkStop.targets) {
      const k = M.parameterIds.indexOf(this.params.ids[i]);     // CubismFadeMotionData.GetParameterIdIndex
      if (k < 0 || k >= pfit.length || k >= pfot.length) return false;
      const pf = pfit[k];
      let lim = fin;
      if ((pf < 0 || ((lim = pf), 1.4e-45 <= pf)) && el < lim) return false;
      const po = pfot[k];
      if (0 <= po) {
        if (1.4e-45 <= po) { const d = F(latest.endTime - el); if (0 <= d && d < po) return false; }
      } else if (!outDone) return false;
    }
    return true;
  }

  // Live2DCharacter.HasNonDefaultMotionFadeContribution
  _hasNonDefaultMotionFadeContribution() {
    const L = this.layer.list;
    if (!L.length || this._latestDefaultOverridesTargets(L[L.length - 1])) return false;
    return L.some((pm) => pm.motion && !this._isDefaultFadeMotion(pm.motion));
  }

  _neutralizeDefaultMotionEyeBlink() {  // Live2DCharacter.NeutralizeDefaultMotionEyeBlink (order 149)
    const S = this.eyeBlinkStop;
    if (!S.stopped || !this.isCurrentMotionDefault || !S.targets.length || this._hasNonDefaultMotionFadeContribution()) return;
    const a = this._eyeBlinkStopRate(), w = 0 <= a ? a : 0, P = this.params;
    for (const i of S.targets) { const v = P.value[i]; P.override(i, F(v + F(w * F(P.def[i] - v))), 1); }
  }

  // ------------------------------------------------------------------------------------------ angle and look
  // Live2DCharacter.ClampParameter after a raw Value write (a parameter the model lacks is skipped)
  _setParam(i, v) {
    const P = this.params;
    P.value[i] = v;
    P.value[i] = clampF(P.value[i], P.min[i], P.max[i]);
  }

  // Live2DCharacter.RestoreAdditiveOverrideAngles: the additive amounts applied last are taken back
  _restoreAdditiveOverrideAngles() {
    const A = this.angle, v = this.params.value, ax = this.angleXParam, bx = this.bodyAngleXParam;
    if (A.appliedX !== 0 && ax >= 0) { this._setParam(ax, F(v[ax] - A.appliedX)); A.appliedX = 0; }
    if (this.bodyAngleXAddParam < 0) {
      if (A.appliedBodyX === 0 || bx < 0) return;
      this._setParam(bx, F(v[bx] - A.appliedBodyX));
    }
    A.appliedBodyX = 0;
  }

  _updateAngle() {                      // Live2DCharacter.OnUpdateAngle
    const A = this.angle, v = this.params.value;
    const ax = this.angleXParam, bx = this.bodyAngleXParam, add = this.bodyAngleXAddParam;
    if (!A.override) return;
    if (!A.additive) {
      if (ax >= 0) this._setParam(ax, A.x);
      if (bx >= 0) this._setParam(bx, A.bodyX);
      if (add >= 0) this._setParam(add, A.bodyX);
      return;
    }
    this._restoreAdditiveOverrideAngles();
    if (ax >= 0) { A.appliedX = A.x; this._setParam(ax, F(A.x + v[ax])); }
    if (add < 0) {
      if (bx < 0) return;
      A.appliedBodyX = A.bodyX;
      this._setParam(bx, F(A.bodyX + v[bx]));
    } else {
      A.appliedBodyX = 0;
      this._setParam(add, A.bodyX);
    }
  }

  _updateLook() {                       // Live2DCharacter.OnUpdateLook
    const L = this.look;
    if (!L.enabled) return;
    if (this.eyeBallXParam >= 0) this._setParam(this.eyeBallXParam, L.x);
    if (this.eyeBallYParam >= 0) this._setParam(this.eyeBallYParam, L.y);
  }

  _setOverrideRotate(value) {           // Live2DCharacter.set_IsOverrideRotate
    const A = this.angle;
    if (A.override === value) return;
    if (!value) {
      if (A.additive) this._restoreAdditiveOverrideAngles();
      A.appliedX = 0; A.appliedBodyX = 0;
    }
    A.override = value;
  }

  // the controller's angle / look cancellation token: a new request or a reset kills the running tweens
  // (TweenCancelBehaviour.KillAndCancelAwait)
  _killTweens(s) { const ts = s.tweens; s.tweens = []; for (const t of ts) t.kill(); }

  // the controller's angle / look tweens: DOTween.To on the float fields (FloatPlugin)
  _tweenPair(state, [getA, setA, toA], [getB, setB, toB], duration, ease) {
    const tw = this.loop.tweens;
    const a = tw.toFloat(getA, toA, duration, ease, setA), b = tw.toFloat(getB, toB, duration, ease, setB);
    state.tweens = [a, b].filter((t) => !t.done);
    return Promise.all([a.promise, b.promise]).then(([x, y]) => x && y);
  }

  // ------------------------------------------------------------------------------------------------- frame phases
  _gate() { return !(this.ignoreAllUpdate || this.pausing || !this.showing || this.warmupState <= 1); }

  _onUpdateInternal() {                 // Live2DCharacter.OnUpdateInternal
    if (this.angle.override && this.angle.additive) this._restoreAdditiveOverrideAngles();
    this._layerUpdate();
    this._modelOnUpdate();
    this.lip.onUpdate();
  }

  _onLateUpdateInternal() {             // Live2DCharacter.OnLateUpdateInternal
    const P = this.params;
    this.lip.onPreUpdate();
    this._applyEyeBlinkStopOverride();
    // the CubismUpdateController chain in execution order
    this._fade();                                                  // 100
    this._neutralizeDefaultMotionEyeBlink();                       // 149 (eye-blink stop neutralizer)
    this.store.save();                                             // 150
    this._expressionUpdate();                                      // 300
    this.paramLoop.lateUpdate();                                   // 350
    for (const i of this.eyeBlinkParams) P.multiply(i, this.eyeOpening, 1);   // 400
    if (this.mouthControllerEnabled) for (const i of this.mouthDestinations) P.override(i, this.mouthOpening, 1);   // 500
    if (this.motionSync) this.motionSync.lateUpdate();             // 501
    this._harmonicUpdate();                                        // 600
    if (!this.pausing) this.lip.managedLateUpdate(P, this.mouthOpenY, this.mouthForm);   // 799 (AdvLipSyncLateApplier)
    if (this.physics) this.physics.evaluate(this.loop.deltaTime); // 800
    this._renderLateUpdate();                                      // 10000
    this._maskLateUpdate();                                        // 10100
    if (!this.pausing) {
      this._blinkUpdate();                                         // CubismAutoEyeBlinkInput.OnLateUpdate
      this.lip.lateUpdate();                                       // Live2DLipSyncController.OnLateUpdate
    }
    this._updateAngle();
    this._updateLook();
  }

  _renderLateUpdate() {                 // _LightingEnabled per renderer (ApplyLightingState)
    // CubismRenderController.UpdateOpacity: a change of Opacity is clamped to [0, 1] and passed to every renderer
    // (OnModelOpacityDidChange; the prefabs have no opacity handler)
    const o = this.renderOpacity;
    if (Math.abs(F(o - this.rc.opacity)) >= 1.4e-45) this.renderOpacity = this.rc.opacity = o > 1 ? 1 : (o >= 0 ? o : 0);
    for (const r of this.renderers) {
      const light = this.lightingEnabled && !(this.disableLightingForMultiply && r.multiplyBlend);
      r.lightingEnabled = light ? 1 : 0;
    }
  }

  // Live2DCharacterController.OnUpdate (Update phase) with Live2DCharacter.OnUpdate
  update() {
    if (!this.initialized || !this.showing) return;
    if (!this._gate()) return;
    this.paramLoop.advanceTime(F(this.loop.deltaTime * this.motionSpeed));
    this._advanceEyeBlinkStopTransition();
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
    this.setBreathMotionEnabled(true);
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

  // Live2DCharacter.Show: ShowRenderer, the GameObject activated (the components' OnEnable rebuild the motion graph
  // when it was inactive), ClearPauseState(true)
  _show() {
    this.showing = true;
    if (!this.active) { this.layer = { list: [], finished: true, paused: false }; this.anim = null; this.active = true; }
    this._clearPauseState(true);
  }

  // Live2DCharacter.ClearPauseState: a pause ends without playing the requests made during it
  _clearPauseState(resumeHarmonicMotion) {
    if (this.pausing) {
      this.pausing = false;
      this._resumeLayer();
      this.model.ignore = this.ignoreAllUpdate;
    }
    if (resumeHarmonicMotion && this.breathEnabled) this.harmonicTimescales[0] = 1;
    this.pending = { motion: null, expression: null, paramLoop: null };
  }

  // Live2DCharacterController.Show: the motion (default if empty) and the expression (default if empty)
  show(motion, expression, fade) {
    this._show();
    if (!motion) this.playMotion(this.defaultMotionName, fade); else this.playMotion(motion, fade);
    if (!expression) this.playDefaultExpression(fade); else this.playExpression(expression, fade);
  }

  hide() {                              // Live2DCharacterController.Hide -> Live2DCharacter.Hide
    this._clearPauseState(false);
    this.paramLoop.stopImmediately();
    this._clearEyeBlinkStopOverride();
    this.isCurrentMotionDefault = false;
    this._resetExpressionParameters();
    const ig = this.model.ignore;       // FlushExpressionResetToDrawableState
    this.forceModelUpdate();
    this.model.ignore = ig;
    this.showing = false;               // HideRenderer
    this.active = false;                // SetActive(false): OnDisable destroys the motion graph
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
  // Live2DCharacter.SetBreathMotionEnabled: CubismHarmonicMotionController.Play(0) / Stop(0) (ChannelTimescales[0])
  setBreathMotionEnabled(flag) { this.breathEnabled = flag; this.harmonicTimescales[0] = flag ? 1 : 0; }
  get physicsEnabled() { return !!this.physics && this.physics.allow; }
  get hasPhysics() { return !!this.physics; }
  get breathMotionEnabled() { return this.harmonicTimescales[0] !== 0; }

  // ------------------------------------------------------------------------------------------ story (ADV) calls
  // Live2DCharacterController.get_IsAlive: the character exists (false after release())
  get isAlive() { return this.alive; }
  // Live2DCharacter.DrawablePartsCount: CubismRenderController.Renderers.Length (0 without a model)
  get drawablePartsCount() { return this.core ? this.core.drawables.count : 0; }

  // Live2DCharacterController.SetBrightness(float): clamped to [0, 1]; the colour is applied unless the brightness
  // is composited after drawing
  setBrightness(brightness) {
    const b = 0 <= brightness ? (brightness <= 1 ? brightness : 1) : 0;
    this.brightness = b;
    if (!this.postCompositeBrightness) this._applyBrightness();
  }

  // rim light: Live2DCharacter.SetRimLightEnabled (CubismRenderController.Enable/DisableRimLighting), the controller's
  // SetRimLightColor (CubismRenderController.SetRimColor -> CubismRenderer.SetRimColor: MaterialPropertyBlock.SetColor
  // of _RimColor on every renderer, the value as given: the project uses the gamma colour space, so no conversion) and
  // SetShadowIntensity (clamped to [0, 1]: every renderer's _ShadowIntensity). Before the first SetRimLightColor the
  // renderers draw with their material's _RimColor.
  get isRimLightingEnabled() { return this.rim.enabled; }
  setRimLightEnabled(flag) { this.rim.enabled = !!flag; }
  setRimLightColor(color) { this.rim.color = { r: color.r, g: color.g, b: color.b, a: color.a }; }
  setShadowIntensity(intensity) { this.shadowIntensity = clamp01(F(intensity)); }

  // Live2DCharacterController.SetMultiplyTexture: a stage's shadow {texture, uv, intensity, amplitude, frequency},
  // or null for SetMultiplyTexture(null, 0.3) (the white texture with uv (1, 1, 0, 0), amplitude 0, frequency 0.5)
  setMultiplyTexture(shadow) {
    this.multiplyTexture = shadow
      ? { texture: shadow.texture, uv: shadow.uv, intensity: shadow.intensity, amplitude: shadow.amplitude,
          frequency: shadow.frequency }
      : { texture: null, uv: { x: 1, y: 1, z: 0, w: 0 }, intensity: 0.3, amplitude: { x: 0, y: 0 }, frequency: 0.5 };
  }

  // Live2DCharacterController.SetSortingOrder(n): CubismRenderController.SortingOrder = n x SortingOrderRate (1000)
  setSortingOrder(sortingOrder) {
    const v = Math.imul(sortingOrder, 1000);
    if (this.rc.sortingOrder === v) return;
    this.rc.sortingOrder = v;
    for (const r of this.renderers) this._applySorting(r);
  }

  // Live2DCharacter.SetLayer(int): GameObjectExtension.SetLayerRecursively on the model's GameObject
  setLayer(layer) { for (const e of this.prefab.nodes.values()) e.transform.layer = layer; }
  getLayer() { return this.root.layer ?? 0; }                // Live2DCharacter.GetLayer
  get gameObjectLayer() { return this.getLayer(); }

  // Live2DCharacterController.SetParent(parent, worldPositionStays = false): the local position, rotation and scale
  // are kept
  setParent(parent) { this.root.setParent(parent); }

  // Live2DCharacter.GetHeadPosition: the world position of Anchors/Head (Vector3.zero without the anchor)
  headPosition() { return this.headAnchor ? this.headAnchor.worldPosition() : { x: 0, y: 0, z: 0 }; }

  // Live2DCharacter.Pause: the motion layer paused at Time.time, the model's update skipped, breath stopped
  pause() {
    this.pausing = true;
    this._pauseLayer();
    this.model.ignore = true;
    if (this.breathEnabled) this.harmonicTimescales[0] = 0;
  }

  // Live2DCharacter.Resume: the layer resumed (its times moved by the pause), breath restarted, the expression
  // parameters reset and the motion, expression and parameter loop requested while paused played
  resume() {
    this.pausing = false;
    this._resumeLayer();
    this.model.ignore = this.ignoreAllUpdate;
    if (this.breathEnabled) this.harmonicTimescales[0] = 1;
    this._resetExpressionParameters();
    const q = this.pending;                                  // PlayPendingMotionAndExpression
    if (q.motion) { const m = q.motion; q.motion = null; this._charPlayMotion(m.name, m.fade); }
    if (q.expression) { const e = q.expression; q.expression = null; this._charPlayExpression(e.name, e.fade); }
    if (q.paramLoop) {                                       // PlayPendingParameterLoop
      const l = q.paramLoop; q.paramLoop = null;
      if (!l.name) this.paramLoop.stop(l.fade); else this.paramLoop.play(l.name, l.fade);
    }
  }

  // Live2DCharacter.SetMotionSpeed: the auto eye blink's speed (SetBlinkingSpeed) and, while showing, every playing
  // motion's speed
  setMotionSpeed(speed) {
    this.motionSpeed = speed;
    this.blink.timescale = F(this.blink.baseTimescale * speed);
    if (!this.showing || !this.anyMotionPlaying()) return;
    this._setLayerSpeed(speed);
  }

  // Live2DCharacter.CanApplyStateImmediately / ApplyCurrentStateImmediately: one update and late update outside the
  // frame (the motion graph evaluated at its current time), then the model updated at once
  get canApplyStateImmediately() { return this._gate(); }

  applyCurrentStateImmediately() {
    if (!this._gate()) return;
    this._onUpdateInternal();
    this._forceEvaluateMotionGraph();
    this._onLateUpdateInternal();
    this.forceModelUpdate();
  }

  // Live2DCharacter.ApplyStateAtMotionTime: the playing motion sought to `seconds`, then the state applied twice
  applyStateAtMotionTime(seconds) {
    if (!this._gate()) return;
    this._seekPlayingMotion(seconds);
    this.applyCurrentStateImmediately();
    this.applyCurrentStateImmediately();
  }

  // Live2DCharacterController.PlayParameterLoop / StopParameterLoop (Live2DParameterLoopController); requests while
  // paused are played by Resume; a request while hidden is dropped
  playParameterLoop(motionName, fadeInTime) {
    if (!motionName) { this.paramLoop.warnings.push(`${this.name}: loop motion name is empty`); return; }
    if (!this.showing) return;
    if (this.pausing) { this.pending.paramLoop = { name: motionName, fade: fadeInTime }; return; }
    this.paramLoop.play(motionName, fadeInTime);
  }

  stopParameterLoop(fadeOutTime) {
    if (this.pausing) { this.pending.paramLoop = { name: null, fade: fadeOutTime }; return; }
    this.paramLoop.stop(fadeOutTime);
  }

  // Live2DCharacter.SetEyeBlinkStopped(stopped, transitionDuration)
  setEyeBlinkStopped(stopped, transitionDuration = 0) {
    const S = this.eyeBlinkStop;
    if (!stopped) { this._clearEyeBlinkStopOverride(); return; }
    if (!S.stopped) {
      S.wasAuto = this.isAutoEyeBlinking;
      this.isAutoEyeBlinking = false;
      this.blink.isBlinking = false;
      S.stopped = true;
      S.start = this.eyeOpening;                           // CubismEyeBlinkController.EyeOpening
      S.elapsed = 0;
      S.duration = transitionDuration;
    } else {
      if (transitionDuration <= 0) { S.elapsed = 0; S.duration = 0; }
      this.blink.isBlinking = false;
    }
  }

  // Live2DCharacter.SetEyeBlinkEnabled (while stopped, the state restored by the stop's end)
  setEyeBlinkEnabled(flag) {
    if (this.eyeBlinkStop.stopped) { this.eyeBlinkStop.wasAuto = flag; return; }
    this.isAutoEyeBlinking = flag;
    this.blink.isBlinking = flag;
  }

  get isEyeBlinkStopped() { return this.eyeBlinkStop.stopped; }

  // angle override: Live2DCharacterController.SetOverrideAngleEnabled(flag, isAdditive)
  setOverrideAngleEnabled(flag, isAdditive = false) {
    const A = this.angle;
    if (A.additive !== isAdditive) {
      if (A.additive) this._restoreAdditiveOverrideAngles();
      A.appliedX = 0; A.appliedBodyX = 0;
      A.additive = isAdditive;
    }
    this._setOverrideRotate(flag);
  }

  get angleX() { return this.angle.x; }
  get bodyAngleX() { return this.angle.bodyX; }
  setAngleX(v) { this.angle.x = F(v); }
  setBodyAngleX(v) { this.angle.bodyX = F(v); }

  // Live2DCharacterController.SmoothRotateToAngle: DOTween.To on the angle and body angle (from their values when
  // the tweens start) with the ease; a running rotation is killed first (RefreshAngleCancellationToken). Resolves
  // true when both finish, false when killed.
  smoothRotateToAngle(angle, bodyAngle, duration, ease = EASE.InOutQuad) {
    const A = this.angle;
    this._killTweens(A);
    return this._tweenPair(A, [() => A.x, (v) => { A.x = F(v); }, angle],
                           [() => A.bodyX, (v) => { A.bodyX = F(v); }, bodyAngle], duration, ease);
  }

  // look override: Live2DCharacter.SetLookEnabled (turning it on takes the eye ball parameters' current values)
  setLookEnabled(flag) {
    const L = this.look, v = this.params.value;
    if (flag) {
      if (!L.enabled) {
        if (this.eyeBallXParam >= 0) L.ox = L.x = v[this.eyeBallXParam];
        if (this.eyeBallYParam >= 0) L.oy = L.y = v[this.eyeBallYParam];
      }
    } else { L.ox = 0; L.oy = 0; }
    L.enabled = flag;
  }

  get lookEnabled() { return this.look.enabled; }
  get lookX() { return this.look.x; }
  get lookY() { return this.look.y; }
  get originalLookX() { return this.look.ox; }
  get originalLookY() { return this.look.oy; }
  setLookX(v) { this.look.x = F(v); }
  setLookY(v) { this.look.y = F(v); }

  // Live2DCharacterController.SmoothChangeToLook: a running look tween is killed; duration <= 0 sets the look and
  // applies the state at once, otherwise DOTween.To on x and y (InOutSine). Resolves true when finished, false when
  // killed.
  smoothChangeToLook(x, y, duration) {
    const L = this.look;
    this._killTweens(L);
    if (duration <= 0) {
      L.x = F(x); L.y = F(y);
      this.applyCurrentStateImmediately();
      return Promise.resolve(true);
    }
    return this._tweenPair(L, [() => L.x, (v) => { L.x = F(v); }, x], [() => L.y, (v) => { L.y = F(v); }, y],
                           duration, EASE.InOutSine);
  }

  // Live2DCharacterController.ResetAngleLook: both token sources cancelled (running tweens killed), then
  // Live2DCharacter.ResetAngleLook
  resetAngleLook() {
    this._killTweens(this.angle);
    this._killTweens(this.look);
    const A = this.angle, L = this.look;
    if (A.override) {
      if (A.additive) this._restoreAdditiveOverrideAngles();
      A.appliedX = 0; A.appliedBodyX = 0;
      A.override = false;
    }
    if (A.additive) {
      this._restoreAdditiveOverrideAngles();
      A.appliedX = 0; A.appliedBodyX = 0;
      A.additive = false;
    }
    A.x = 0; A.bodyX = 0; A.appliedX = 0; A.appliedBodyX = 0;
    L.x = 0; L.y = 0; L.ox = 0; L.oy = 0; L.enabled = false;
  }

  // lip sync (Live2DLipSyncController through Live2DCharacterController)
  // Live2DCharacterController.get_IsMotionSyncEnabled: the model has a MotionSync controller (with its audio input)
  get isMotionSyncEnabled() { return !!this.motionSync; }
  get isLipSyncEnabled() { return this.lip.enabled; }
  get lipSyncMode() { return this.lip.mode; }
  // what a requested lip-sync path needed and did not have (the MotionSync Core, the CRI Lips analysis), or null
  get lipSyncMissing() { return this.lip.missing || (this.motionSync && this.motionSync.missing) || null; }

  setLipSyncEnabled(flag, usePseudo = false) { this.lip.setEnabled(flag, usePseudo); }
  setLipSyncPresentationMode(mode) { this.lip.setPresentationMode(mode); }
  setLipSyncParameter(defaultMouthOpening = 0, scale = 1) { this.lip.setLipSyncParameter(defaultMouthOpening, scale); }
  // the playing voice's PCM for the MotionSync audio input ({pull(): Float32Array, sampleRate}; engine/audio.js
  // pcmSource), or null
  setMotionSyncSource(source) { if (this.motionSync) this.motionSync.setSource(source); }
  clearMotionSyncSource() { if (this.motionSync) this.motionSync.setSource(null); }
  // Live2DCharacterController.SetMouthOpening -> Live2DLipSyncController.MoveLipManual
  setMouthOpening(mouthOpening) { this.lip.moveLipManual(mouthOpening); }
  // SetCriLipsAtomAnalyzer: the CRI Lips analysis of a playing voice, or null (ClearCriLipsAtomAnalyzer)
  setLipsAnalyzer(analyzer) { this.lip.setLipsAnalyzer(analyzer); }

  // Live2DCharacterController.StartTimedPseudoLipSync(talkLength, speed, multiplier): the time is
  // _pseudoLipSyncUnitTime (0.14) x talkLength
  startTimedPseudoLipSync(talkLength, speed = 1, multiplier = 1) {
    this.lip.startTimed(F(PSEUDO_LIP_SYNC_UNIT_TIME * talkLength), speed, multiplier);
  }

  startTimedHoldOpenPseudoLipSync(mouthOpening, talkLength, speed = 1) {
    this.lip.startTimedHoldOpen(mouthOpening, F(PSEUDO_LIP_SYNC_UNIT_TIME * talkLength), speed);
  }

  stopTimedPseudoLipSync() { this.lip.stopTimed(); }
  setPseudoLipSyncSpeed(speed) { this.lip.setPseudoSpeed(speed); }

  release() {
    this._killTweens(this.angle);
    this._killTweens(this.look);
    this.alive = false;
    this.core.release();
  }
}

// Live2DCharacterController._pseudoLipSyncUnitTime
const PSEUDO_LIP_SYNC_UNIT_TIME = F(0.14);

// Mathf.Clamp01 as compiled (NaN -> 0)
const clamp01 = (x) => (0 <= x ? (x <= 1 ? x : 1) : 0);
