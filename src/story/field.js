import { URPPost } from "../engine/postfx.js";
import { Prefab } from "../engine/prefab.js";
import { Transform, mat4 } from "../engine/math.js";
import { EASE } from "../engine/tween.js";

// The story scene objects the commands drive: the main camera (Fwk UniversalCamera), the character field (slots,
// focus anchors), the background field, the global volume stack and the field renderer manager (per-slot alpha,
// brightness and blur, the capture crossfade). renderer.js draws them.

// AdvQualityConfig gates; BaseQualityMode Worst 0 .. Best 4.
export class AdvQuality {
  constructor(level, player) {
    this.level = level;
    const P = player;
    this.unityLighting = !!P._allowUnityLighting && level > 2;
    this.characterPhysics = !!P._allowCharacterPhysics && level > 1;
    this.characterBreathMotion = !!P._allowCharacterBreathMotion && level > 2;
    this.characterBlur = !!P._allowCharacterBlur && level > 2;
    this.backgroundBlur = !!P._allowBackgroundBlur && level > 2;
    this.stageParticleEffect = !!P._allowStageParticleEffect && level > 1;
    this.stagePostEffect = !!P._allowStagePostEffect && level > 2;
    this.cameraAntiAliasing = level > 2;
    this.additionalLightsVertex = level === 4;          // only UniversalRP_Best has per-vertex additional lights
  }
}

// Fwk.Cam.UniversalCamera behind CameraManager.MainCamera
export class AdvCamera {
  constructor(loop, cameraNode) {
    const cam = cameraNode.components.find((c) => c.type === "Camera");
    this.loop = loop;
    this.near = cam["near clip plane"];
    this.far = cam["far clip plane"];
    this.clearColor = [cam.m_BackGroundColor.r, cam.m_BackGroundColor.g, cam.m_BackGroundColor.b, cam.m_BackGroundColor.a];
    this.defaultFov = cam["field of view"];
    this.transform = new Transform("MainCamera");
    this.x = 0; this.y = 0; this.z = 0; this.zoomRatio = 1; this.fieldOfView = this.defaultFov;
    this.euler = { x: 0, y: 0, z: 0 };
    this.tweens = {};
    this.shakeOffset = null;
    this._update();
  }

  get fov() { return this.fieldOfView / this.zoomRatio; }             // UpdateZoom

  // shakeOffset (null or {x, y, z}): a position offset composed on top of the tweened position (camera shakes)
  _update() {
    const o = this.shakeOffset;
    this.transform.localPosition = o ? { x: this.x + o.x, y: this.y + o.y, z: this.z + o.z } : { x: this.x, y: this.y, z: this.z };
    this.transform.setLocalEuler(this.euler.x, this.euler.y, this.euler.z);
  }

  _axis(key, get, set, value, dur, ease) {
    if (this.tweens[key]) { this.tweens[key].kill(); this.tweens[key] = null; }
    if (!(dur > 0)) { set(value); this._update(); return Promise.resolve(); }
    const t = this.loop.tweens.to(get(), value, dur, ease, (v) => { set(v); this._update(); });
    this.tweens[key] = t;
    return t.promise;
  }

  moveX(v, dur = 0, ease = EASE.OutQuad) { return this._axis("x", () => this.x, (a) => { this.x = a; }, v, dur, ease); }
  moveY(v, dur = 0, ease = EASE.OutQuad) { return this._axis("y", () => this.y, (a) => { this.y = a; }, v, dur, ease); }
  moveZ(v, dur = 0, ease = EASE.OutQuad) { return this._axis("z", () => this.z, (a) => { this.z = a; }, v, dur, ease); }
  move(p, dur, ease) { return Promise.all([this.moveX(p.x, dur, ease), this.moveY(p.y, dur, ease), this.moveZ(p.z, dur, ease)]); }
  rotateY(v, dur = 0, ease = EASE.OutQuad) {
    return this._axis("ry", () => this.euler.y, (a) => { this.euler.y = a; }, v, dur, ease);
  }
  rotateYNow(v) { return this.rotateY(v, 0); }
  rotateX(v, dur = 0, ease = EASE.OutQuad) {           // RotateX / RotateZ: the same form on the other Euler axes
    return this._axis("rx", () => this.euler.x, (a) => { this.euler.x = a; }, v, dur, ease);
  }
  rotateZ(v, dur = 0, ease = EASE.OutQuad) {
    return this._axis("rz", () => this.euler.z, (a) => { this.euler.z = a; }, v, dur, ease);
  }
  zoom(r, dur = 0, ease = EASE.OutQuad) {
    if (r <= 0) console.warn(`[UniversalCamera] zoom ratio ${r}`);
    return this._axis("zoom", () => this.zoomRatio, (a) => { this.zoomRatio = a; }, r, dur, ease);
  }
  setFov(fov) { this.fieldOfView = fov; }
  resetFov() { this.fieldOfView = this.defaultFov; }
  setShakeOffset(o) { this.shakeOffset = o; this._update(); }
  setPosition(p) { this.x = p.x; this.y = p.y; this.z = p.z; this._update(); }
  setRotation(e) { this.euler = { ...e }; this._update(); }
  resetPositionAndRotation() {              // ClearCameraAnimation
    for (const k of Object.keys(this.tweens)) if (this.tweens[k]) this.tweens[k].kill();
    this.tweens = {};
    this.x = this.y = this.z = 0; this.zoomRatio = 1; this.euler = { x: 0, y: 0, z: 0 };
    this._update();
  }

  // Unity worldToCameraMatrix (view space looks down -z) and a GL projection
  viewMatrix() {
    const m = mat4.inverseRigid(this.transform.localToWorld());
    return mat4.mul(mat4.scale(1, 1, -1), m);
  }
  projection(aspect) { return mat4.perspective(this.fov, aspect, this.near, this.far); }
}

// AdvCharacterField
export class AdvCharacterField {
  constructor(loop, prefab, parent) {
    this.loop = loop;
    this.prefab = new Prefab(prefab);
    this.root = this.prefab.root;
    this.root.setParent(parent);
    const c = this.prefab.component(this.root.name, "AdvCharacterField");
    const tf = (ref) => this.prefab.transform(ref.transform);
    this.field = tf(c._field);
    this.stages = c._characterStages.map(tf);
    this.anchors = c._focusAnchors.map(tf);
    this.stageY = this.stages.map(() => 0);
    this.stageYTweens = this.stages.map(() => null);
    this.moveTweens = this.stages.map(() => null);
    this.poolRoot = new Transform("ResourceParent", parent);
    this.characterRoots = new Set();
  }

  static slotIndex(pos) { return { 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pos]; }

  stageTransform(pos) {                     // GetStageTransform
    const i = AdvCharacterField.slotIndex(pos);
    if (i === undefined) { console.warn(`unsupported position type ${pos}`); return null; }
    return this.stages[i];
  }

  // ExistsCharacter: a Live2DCharacter is parented under the slot's stage (roots registered by the session)
  existsCharacter(pos) {
    const s = this.stageTransform(pos);
    return !!s && s.children.some((t) => this.characterRoots.has(t));
  }

  focusPoint(pos) {                         // GetFocusPoint: world position of anchor pos-1
    if (!(pos >= 1 && pos <= 9)) { console.warn(`Unsupported position type ${pos}`); return { x: 0, y: 0, z: 0 }; }
    return this.anchors[pos - 1].worldPosition();
  }

  _setStageY(i, y) {
    this.stageY[i] = y;
    const e = this.stages[i].localEuler || { x: 0, y: 0, z: 0 };
    this.stages[i].setLocalEuler(e.x, y, e.z);
  }

  resetCharacterStageRotations() {
    this.stages.forEach((_, i) => {
      if (this.stageYTweens[i]) { this.stageYTweens[i].kill(); this.stageYTweens[i] = null; }
      this._setStageY(i, 0);
    });
  }

  // SetStageInfo(stage, index): ResetCharacterStageRotations, ApplyFocusStagePositions, ApplyFieldPosition,
  // ApplyFieldScale
  setStageInfo(stage, index = 0) {
    this.resetCharacterStageRotations();
    this.applyFocusStagePositions(stage, index);
    this.applyFieldPosition(stage);
    this.applyFieldScale(stage);
  }

  // ApplyFocusStagePositions: the focus anchors at the stage's focus points `index` (AdvFocusPointsCollection
  // .GetFocusPoints: an index out of range takes entry 0), the character stages at every second point; all at the
  // origin without a stage
  applyFocusStagePositions(stage, index = 0) {
    if (!stage) {
      for (const a of this.anchors) a.localPosition = { x: 0, y: 0, z: 0 };
      for (const s of this.stages) s.localPosition = { x: 0, y: 0, z: 0 };
      return;
    }
    const all = stage.focusPoints, pts = all[index >= 0 && index < all.length ? index : 0];
    pts.forEach((pt, i) => {
      if (i >= this.anchors.length) throw new RangeError(`stage ${stage.name}: ${pts.length} focus points, ${this.anchors.length} anchors`);
      this.anchors[i].localPosition = { ...pt };
    });
    this.stages.forEach((s, j) => {
      if (2 * j >= pts.length) throw new RangeError(`stage ${stage.name}: ${pts.length} focus points, ${this.stages.length} stages`);
      s.localPosition = { ...pts[2 * j] };
    });
  }

  applyFieldPosition(stage) {               // ApplyFieldPosition
    this.field.localPosition = stage ? { ...stage.characterFieldPosition } : { x: 0, y: 0, z: 0 };
  }

  applyFieldScale(stage) {                  // ApplyFieldScale: Vector3.one x the stage's scale
    const k = stage ? stage.characterFieldScale : 1;
    for (const s of this.stages) s.localScale = { x: k, y: k, z: k };
  }

  rotateCharacterStagesY(y, dur, ease) {
    return Promise.all(this.stages.map((_, i) => {
      if (this.stageYTweens[i]) { this.stageYTweens[i].kill(); this.stageYTweens[i] = null; }
      if (!(dur > 0)) { this._setStageY(i, y); return Promise.resolve(); }
      const t = this.loop.tweens.to(this.stageY[i], y, dur, ease, (v) => this._setStageY(i, v));
      this.stageYTweens[i] = t;
      return t.promise;
    }));
  }

  moveToDirection(pos, dir, dur) {          // <MoveToDirection>d__25 (DOLocalMove, OutQuad)
    const s = this.stageTransform(pos);
    if (!s) throw new Error(`MoveToDirection: position type ${pos} has no stage`);
    const p = s.localPosition, end = { x: p.x + dir.x, y: p.y + dir.y, z: p.z + dir.z };
    if (!(dur > 0)) { s.localPosition = end; return Promise.resolve(); }
    return this.loop.tweens.to({ ...p }, end, dur, EASE.OutQuad, (v) => { s.localPosition = v; }).promise;
  }
}

// AdvBackgroundField
export class AdvBackgroundField {
  constructor(prefab, parent) {
    this.prefab = new Prefab(prefab);
    this.root = this.prefab.root;
    this.root.setParent(parent);
    const c = this.prefab.component(this.root.name, "AdvBackgroundField");
    this.field = this.prefab.transform(c._field.transform);
    const srPath = c._renderer.gameObject;
    this.spriteTransform = this.prefab.transform(srPath);
    this.spriteRenderer = this.prefab.component(srPath, "SpriteRenderer");
    const planePath = `${c._field.transform}/BaseRenderer`;
    this.planeTransform = this.prefab.transform(planePath);
    this.planeRenderer = this.prefab.component(planePath, "MeshRenderer");
    this.planeMesh = this.prefab.component(planePath, "MeshFilter").m_Mesh;
    this.active = false;
    this.sprite = null;
    this.color = { r: 1, g: 1, b: 1, a: 1 };                 // the SpriteRenderer's colour
    this.originalColor = { r: 1, g: 1, b: 1, a: 1 };         // _originalColor (Refresh: white)
    this.brightness = 1;                                     // _brightness (Refresh: 1)
    this.colorTween = null;                                  // a SetBrightness tween on the renderer
  }

  // SetStageInfo: the stage's sprite and colour (none and white without a stage), its field position and scale, then
  // ApplyBrightness (the kept brightness applies to the new stage)
  setStageInfo(stage) {
    this.active = !!stage;
    this.sprite = stage ? stage.backgroundSprite : null;
    this.color = stage ? { ...stage.backgroundColor } : { r: 1, g: 1, b: 1, a: 1 };
    this.originalColor = { ...this.color };
    if (stage) {
      this.field.localPosition = { ...stage.backgroundFieldPosition };
      const k = stage.backgroundFieldScale;
      this.spriteTransform.localScale = { x: k, y: k, z: k };
    }
    this.applyBrightness();
  }

  // ApplyBrightness: DOKill on the renderer, colour = original rgb x brightness, original alpha
  applyBrightness() {
    if (this.colorTween) { this.colorTween.kill(); this.colorTween = null; }
    const o = this.originalColor, b = this.brightness, F = Math.fround;
    this.color = { r: F(b * o.r), g: F(b * o.g), b: F(o.b * b), a: o.a };
  }
}

// AdvGlobalVolume + the main camera's volume stack
export class AdvGlobalVolume {
  constructor(prefab, quality) {
    this.prefab = new Prefab(prefab);
    const root = this.prefab.root.name;
    const c = this.prefab.component(root, "AdvGlobalVolume");
    const vol = (path) => this.prefab.component(path, "Volume");
    this.all = { volume: vol(c._allVolume.gameObject), profile: null, enabled: false, weight: 1 };
    const wu = `${c._warmupObjects.gameObject}/VolumeAll`;
    this.warmup = { volume: vol(wu), profile: vol(wu).sharedProfile, enabled: true, weight: vol(wu).weight };
    this.quality = quality;
    // ENGINE: global volumes of equal priority blend in the volume manager's registration order (VolumeCollection:
    // Register appends, SortByPriority is a stable sort); a Volume registers in OnEnable and unregisters in OnDisable,
    // so one enabled again moves to the end. The warmup volume registers first (ShowWarmupObjects, nothing hides it
    // again); the stage volume registers each time ApplyStageAllVolume enables it after a stage without a profile.
    this.registered = [this.warmup];
    this.always = false;                    // main camera in the Fwk VolumeManager always-update set
    this.stack = this.evaluateStack();
  }

  _volumes() { return this.registered.filter((v) => v.enabled !== false && v.profile && v.weight > 0); }

  // Behaviour.enabled: OnEnable / OnDisable run only when the value changes
  _setEnabled(v, on) {
    if (v.enabled === on) return;
    v.enabled = on;
    const i = this.registered.indexOf(v);
    if (on && i < 0) this.registered.push(v);
    else if (!on && i >= 0) this.registered.splice(i, 1);
  }

  // v = {profile, weight, enabled}: a child volume that was enabled (registered after every volume enabled before it)
  // or disabled; the stack is evaluated again at the next PostLateUpdate
  addChildVolume(v) {
    if (!this.registered.includes(v)) this.registered.push(v);
    this.markUpdateOnce();
    return v;
  }

  removeChildVolume(v) {
    const i = this.registered.indexOf(v);
    if (i >= 0) this.registered.splice(i, 1);
    this.markUpdateOnce();
  }

  // VolumeManager.Update for the ADV volumes now: the components' defaults, then every enabled volume with a profile
  // and a weight above 0 blended in registration order (URPPost.evaluateStack). `stack` keeps the result of the last
  // PostLateUpdate evaluation (the one the main camera renders with).
  evaluateStack() {
    return URPPost.evaluateStack(this._volumes().map((v) => ({ profile: v.profile, weight: v.weight })));
  }

  markUpdateOnce() { this.always = true; }
  stopAlwaysUpdate() { this.always = false; }

  setStageInfo(stage) { this.applyStageAllVolume(stage, 0); }   // SetStageInfo

  // ApplyStageAllVolume: MarkUpdateOnceBaseCameras; the stage's volume profile `index` (TryGetVolumeProfileAll) on
  // the stage volume, enabled; without a stage or such a profile the volume is disabled
  applyStageAllVolume(stage, index = 0) {
    this.markUpdateOnce();
    const p = stage ? stage.volumeProfile(index) : null;
    this.all.profile = p;
    this._setEnabled(this.all, !!p);
  }

  // Fwk VolumeManager at PostLateUpdate
  postLateUpdate() { if (this.always) this.stack = this.evaluateStack(); }
}

// AdvFieldRendererManager / AdvFieldRendererFeature state
export const ADV_BLUR_RADIUS_MAX = [0.75, 2.25, 3.75, 5.5, 7.75, 9.75, 12.0];     // by CameraDistance 0..6
export const ADV_CURVED_LENS_RATE = [1.0, 0.85, 0.65, 0.45, 0.30, 0.15, 0.0];
export class AdvFieldRendererManager {
  constructor(loop, quality) {
    this.loop = loop; this.quality = quality;
    this.entries = [0, 1, 2, 3, 4].map((i) => ({
      index: i, target: null, sortingOrder: -1, renderIndex: -1, alpha: 1, brightness: 1, blur: 0, blurRate: 1,
      fade: null, blurTween: null, layer: 6 + i }));
    this.defaultOrder = [4, 0, 3, 1, 2];
    this.priority = {};
    this.defaultOrder.forEach((e, i) => { this.priority[e] = i; });
    this.background = { active: false, alpha: 1, blur: 0, blurRate: 1, blurTween: null };
    this.foreground = { count: 0 };         // AdvForegroundFieldRendererEntry (the chat phone's layer, 11)
    this.capture = { rt: null, alpha: 1, tween: null, pending: null };
    this._orderListeners = [];
    this.blurRadiusMax = 12; this.blurRadiusTween = null;
    this.curvedLensRate = 1; this.curvedLensTween = null;
  }

  static entryIndex(pos) { return { 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pos] ?? -1; }

  registerCharacter(ch, layerName) {        // RegisterCharacterEntry
    const idx = ["Camera1", "Camera2", "Camera3", "Camera4", "Camera5"].indexOf(layerName);
    if (idx < 0) throw new Error(`layer ${layerName}`);
    const e = this.entries[idx];
    e.target = ch; e.sortingOrder = ch.root.worldPosition().z; e.brightness = ch.brightness; e.blurRate = 1;
    ch.setDisableLightingForMultiplyBlendDrawables(true);
    ch.setUsePostCompositeBrightness(true);
    ch.setLayer(e.layer);
    this.setCharacterEntries();
  }

  unregisterCharacter(ch) {                 // UnregisterCharacterEntry
    const e = this.entries.find((x) => x.target === ch);
    if (!e) return;
    ch.setDisableLightingForMultiplyBlendDrawables(false);
    ch.setUsePostCompositeBrightness(false);
    ch.setLayer(0);
    Object.assign(e, { target: null, sortingOrder: -1, renderIndex: -1, alpha: 1, brightness: 1, blur: 0, blurRate: 1 });
    this.setCharacterEntries();
  }

  setCharacterEntries() {                   // SetCharacterEntries, then OnCharacterOrderChanged
    const shown = this.entries.filter((e) => e.target && e.target.isShowing);
    shown.sort((a, b) => (b.sortingOrder - a.sortingOrder) || (this.priority[a.index] - this.priority[b.index]));
    shown.forEach((e, i) => { e.renderIndex = i; e.target.setSortingOrder(i); });
    for (const fn of [...this._orderListeners]) fn();
  }

  // OnCharacterOrderChanged: fn() after every SetCharacterEntries (register, unregister, sort); returns the unsubscribe
  onCharacterOrderChanged(fn) {
    this._orderListeners.push(fn);
    return () => { const i = this._orderListeners.indexOf(fn); if (i >= 0) this._orderListeners.splice(i, 1); };
  }

  // AddForegroundEntry / RemoveForegroundEntry (never below 0); the entry is active while its count is above 0
  addForegroundEntry() { this.foreground.count++; }
  removeForegroundEntry() { this.foreground.count = Math.max(this.foreground.count - 1, 0); }
  get isForegroundActive() { return this.foreground.count > 0; }

  sortCharacters() {                        // SortCharacterEntries
    for (const e of this.entries) if (e.target && e.target.isShowing) e.sortingOrder = e.target.root.worldPosition().z;
    this.setCharacterEntries();
  }

  // FadeCharacterAsync d__35
  async fadeCharacter(pos, dur, from, to) {
    const i = AdvFieldRendererManager.entryIndex(pos);
    if (i < 0) { console.warn(`PositionType ${pos} has no field renderer entry`); return; }
    const e = this.entries[i];
    if (e.fade) { e.fade.kill(); e.fade = null; }
    const token = {};
    e.fadeToken = token;
    if (!(dur > 0)) { e.alpha = to; return; }
    e.alpha = from;
    await this.loop.delayFrame(3);
    if (e.fadeToken !== token) return;
    e.fade = this.loop.tweens.to(from, to, dur, EASE.OutQuad, (v) => { e.alpha = v; });
    await e.fade.promise;
    if (e.fadeToken === token) e.alpha = to;
  }

  setBackgroundActive(flag) { this.background.active = flag; }
  setBackgroundAlpha(a) { this.background.alpha = a; }

  // tweens holder[key] to target (DOTween.To; the previous tween in holder[tkey] is killed); used for the entries'
  // alpha / brightness / blur and the manager's rates
  tweenValue(holder, key, tkey, target, dur, ease) { return this._tweenValue(holder, key, tkey, target, dur, ease); }

  // the entry of a PositionType (1/3/5/7/9), or null
  entryOf(pos) { const i = AdvFieldRendererManager.entryIndex(pos); return i < 0 ? null : this.entries[i]; }

  _tweenValue(holder, key, tkey, target, dur, ease) {
    if (holder[tkey]) { holder[tkey].kill(); holder[tkey] = null; }
    if (!(dur > 0)) { holder[key] = target; return Promise.resolve(); }
    const t = this.loop.tweens.to(holder[key], target, dur, ease, (v) => { holder[key] = v; });
    holder[tkey] = t;
    return t.promise;
  }

  setBackgroundBlur(dur, v, ease) {         // SetBackgroundBlurAsync d__39
    const target = this.quality.backgroundBlur ? Math.min(1, Math.max(0, v)) : 0;
    return this._tweenValue(this.background, "blur", "blurTween", target, dur, ease);
  }

  setCharacterBlur(pos, dur, v, ease) {     // SetCharacterBlurAsync d__36
    const i = AdvFieldRendererManager.entryIndex(pos);
    if (i < 0) return Promise.resolve();
    const target = this.quality.characterBlur ? Math.min(1, Math.max(0, v)) : 0;
    return this._tweenValue(this.entries[i], "blur", "blurTween", target, dur, ease);
  }

  applyBlurRadiusByCameraDistance(cd, dur, ease) {          //
    const v = Math.min(12, Math.max(0, ADV_BLUR_RADIUS_MAX[cd] ?? 0.75));
    return this._tweenValue(this, "blurRadiusMax", "blurRadiusTween", v, dur, ease);
  }

  applyCurvedLensIntensityRateByCameraDistance(cd, dur, ease) {   //
    const v = Math.min(1, Math.max(0, ADV_CURVED_LENS_RATE[cd] ?? 1));
    return this._tweenValue(this, "curvedLensRate", "curvedLensTween", v, dur, ease);
  }

  // ScreenCapture.Capture(AdvBack): the renderer fills the RT in the next rendered frame
  captureAdvBack() {
    return new Promise((res) => { this.capture.pending = res; });
  }

  setCaptureTexture(rt) { this.capture.rt = rt; }
  resetCaptureTexture() { this.capture.rt = null; }

  fadeCapture(dur, from, to) {              // FadeCaptureAsync d__69
    if (this.capture.tween) { this.capture.tween.kill(); this.capture.tween = null; }
    if (!(dur > 0)) { this.capture.alpha = to; return Promise.resolve(); }
    this.capture.alpha = from;
    const t = this.loop.tweens.to(from, to, dur, EASE.OutQuad, (v) => { this.capture.alpha = v; });
    this.capture.tween = t;
    return t.promise;
  }

  // NeedsOffscreenPass
  needsOffscreen() {
    if (this.background.blur > 0 || this.capture.rt) return true;
    return this.entries.some((e) => e.target && e.target.isShowing && (e.blur > 0 || e.alpha < 1 || e.brightness < 1));
  }

  // BuildCharacterGroups: consecutive entries with equal blur/alpha/brightness
  groups() {
    const shown = this.entries.filter((e) => e.target && e.target.isShowing).sort((a, b) => a.renderIndex - b.renderIndex);
    const approx = (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1.401298e-45 * 8);
    const out = [];
    for (const e of shown) {
      const g = out[out.length - 1];
      if (g && approx(g.blur, e.blur) && approx(g.alpha, e.alpha) && approx(g.brightness, e.brightness)) g.entries.push(e);
      else out.push({ entries: [e], blur: e.blur, blurSize: e.blur * e.blurRate, alpha: e.alpha, brightness: e.brightness });
    }
    return out;
  }
}
