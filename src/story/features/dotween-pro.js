import { F } from "../../engine/core.js";
import { StoryCommandError } from "../interfaces.js";
import { quatEuler } from "./canvas.js";
import { quat } from "../../engine/math.js";
import { DT_PLUGIN, DTSequence, dtPunch, dtRotate, dtShake, dtTo } from "./dotween-core.js";

// DOTween Pro's DOTweenAnimation (DOTweenPro.Scripts) and Fwk.Tween.DOTweenSequence (Fwk) on the nodes of a uGUI prefab
// instance, with the UnityEvent persistent calls their callbacks run.
//
// host: {mgr: DTManager, random: UnityRandom, node(path) -> CanvasNode, go(node) -> the node's GameObject identity
// (tween target), abs(path) -> the ABSAnimationComponents of that GameObject in component order}.
//
// DOTweenAnimation.CreateTween(regenerateIfExists, andPlay): an existing active tween is kept (or killed when
// regenerating); the tween of the (animationType, targetType) pair on `target` (Scale on targetGO's transform), then
// SetTarget(targetGO or the own GameObject), SetDelay, SetLoops, SetAutoKill, OnKill(tween = null), SetEase, SetId,
// SetUpdate, the callbacks of the hasOn* flags, Play or Pause, onTweenCreated. Awake creates the tween paused (autoPlay
// is off in the data). DOPlay / DOKill / DOPlayAllById / DOKillAllById act on top-level tweens only (DOTween.Play /
// Kill by target or id) and never create a tween.
// Fwk.Tween.DOTweenSequence.CreateSequence: one Sequence (autoKill off) per play; each command at the sum of the
// earlier commands' positive _duration: TweenAnimation -> the selected animation's tween (re-created, autoKill off)
// inserted, CustomEvent -> a callback invoking _tweenEvent, Wait -> time only; a command selecting the sequence itself
// is skipped (no time advance); an OnCompleted callback at the end (_isLoop: Restart of the same Sequence); timeScale =
// the playback rate. DOPlay = DOKill + CreateSequence + Play; DOKill kills the Sequence and the tweens of every
// command's GameObject animations; OnDisable (killOnDisable) = DOKill.

const unsupported = (what) => { throw new StoryCommandError(`still animation: ${what} not implemented`); };

// UnityEvent.Invoke of the persistent calls: calls that are off, without a method or with a null target are skipped
// (PersistentCall.GetRuntimeCall); the DOTween methods run by name.
export const invokeUnityEvent = (host, ev) => {
  const calls = (ev && ev.m_PersistentCalls && ev.m_PersistentCalls.m_Calls) || [];
  for (const call of calls) {
    if (call.m_CallState === 0 || !call.m_MethodName || !call.m_Target) continue;
    const t = call.m_Target;
    if (!t.component) unsupported(`a persistent call on a GameObject (${call.m_MethodName})`);
    const target = host.componentOf(t);
    if (!target) unsupported(`a persistent call target ${t.class || t.component}`);
    const arg = call.m_Mode === 1 ? undefined : call.m_Mode === 5 ? call.m_Arguments.m_StringArgument
      : unsupported(`persistent call mode ${call.m_Mode}`);
    const fn = target.persistentMethods()[call.m_MethodName];
    if (!fn) unsupported(`${target.className}.${call.m_MethodName}`);
    fn(arg);
  }
};

// the tween target accessors of a node: RectTransform / Transform / CanvasGroup / Graphic properties
const nodeProps = {
  anchoredPosition3D: (n) => [() => ({ x: n.anchoredPosition.x, y: n.anchoredPosition.y, z: n.localZ }),
                              (v) => { n.anchoredPosition = { x: v.x, y: v.y }; n.localZ = v.z; }],
  anchoredPosition: (n) => [() => ({ x: n.anchoredPosition.x, y: n.anchoredPosition.y, z: 0 }),
                            (v) => { n.anchoredPosition = { x: v.x, y: v.y }; }],
  sizeDelta: (n) => [() => ({ ...n.sizeDelta }), (v) => { n.sizeDelta = { x: v.x, y: v.y }; }],
  localScale: (n) => [() => ({ x: n.localScale.x, y: n.localScale.y, z: n.localScaleZ }),
                      (v) => { n.localScale = { x: v.x, y: v.y }; n.localScaleZ = v.z; }],
  color: (n) => [() => ({ ...n.image.m_Color }), (v) => { n.image.m_Color = { ...v }; }],
  alpha: (n) => [() => n.canvasGroup.alpha, (v) => { n.canvasGroup.alpha = v; }],
};

// world rotation of a canvas node (the canvas itself unrotated): the product of the local rotations up the chain
const worldRotation = (n) => {
  let q = quat.identity();
  for (let p = n; p && p.localRotation; p = p.parent) q = quat.mul(p.localRotation, q);
  return q;
};
// Quaternion.eulerAngles.
// ENGINE: Unity converts through the rotation matrix in Z, X, Y order (x = asin(-m12) away from the poles
// |m12| >= 0.999, where z is 0) and brings each angle into [0, 360) with a -0.0001 rad tolerance.
const TAU = 2 * Math.PI;
const sanitize = (a) => (a < -0.0001 ? a + TAU : a > TAU - 0.0001 ? a - TAU : a);
export const eulerAngles = (q) => {
  const m01 = 2 * (q.x * q.y - q.w * q.z), m02 = 2 * (q.x * q.z + q.w * q.y), m00 = 1 - 2 * (q.y * q.y + q.z * q.z);
  const m10 = 2 * (q.x * q.y + q.w * q.z), m11 = 1 - 2 * (q.x * q.x + q.z * q.z), m12 = 2 * (q.y * q.z - q.w * q.x);
  const m22 = 1 - 2 * (q.x * q.x + q.y * q.y);
  let x, y, z;
  if (m12 < 0.999) {
    if (m12 > -0.999) { x = Math.asin(-m12); y = Math.atan2(m02, m22); z = Math.atan2(m10, m11); }
    else { x = Math.PI / 2; y = Math.atan2(m01, m00); z = 0; }
  } else { x = -Math.PI / 2; y = Math.atan2(-m01, m00); z = 0; }
  const deg = (a) => F(sanitize(a) * 180 / Math.PI);
  return { x: deg(x), y: deg(y), z: deg(z) };
};
// Transform.rotation getter (eulerAngles) / setter from Euler angles: localRotation = Inverse(parent rotation) * value
const rotationProps = (n) => [
  () => eulerAngles(worldRotation(n)),
  (v) => {
    const world = quatEuler(v.x, v.y, v.z), p = n.parent ? worldRotation(n.parent) : quat.identity();
    const l = quat.mul({ x: -p.x, y: -p.y, z: -p.z, w: p.w }, world);
    n.localRotation = { x: F(l.x), y: F(l.y), z: F(l.z), w: F(l.w) };
    n.euler = null;
  },
];

const EVENTS = [["onStart", "hasOnStart"], ["onPlay", "hasOnPlay"], ["onUpdate", "hasOnUpdate"],
                ["onStepComplete", "hasOnStepComplete"], ["onComplete", "hasOnComplete"], ["onRewind", "hasOnRewind"]];

export class DOTweenAnimation {
  constructor(host, node, comp) {
    this.host = host; this.node = node; this.comp = comp; this.className = "DOTweenAnimation";
    this.tween = null;
    this.autoGenerationCalled = false;
    const c = comp;
    if (c.isFrom) unsupported("isFrom");
    if (c.isRelative) unsupported("isRelative");
    if (c.isSpeedBased) unsupported("isSpeedBased");
    if (c.useTargetAsV3) unsupported("useTargetAsV3");
    if (c.isIndependentUpdate || c.updateType) unsupported("an update type other than Normal");
    if (!c.autoKill) unsupported("autoKill off");
    if (c.autoPlay) unsupported("autoPlay");
    if (c.easeType === 37) unsupported("a custom ease curve");
    if (c.forcedTargetType) unsupported("forcedTargetType");
    this.targetGO = c.targetIsSelf ? node : (c.targetGO ? host.node(c.targetGO.gameObject) : null);
  }

  get tweenTarget() {                    // GetTweenTarget: targetGO when not self and tweenTargetIsTargetGO
    const c = this.comp;
    return this.host.go(!c.targetIsSelf && c.tweenTargetIsTargetGO ? this.targetGO : this.node);
  }

  // Awake: isActive && autoGenerate (and not Move from a target transform) -> CreateTween(false, autoPlay)
  awake() {
    const c = this.comp;
    if (c.isActive && c.autoGenerate) { this.createTween(false, !!c.autoPlay); this.autoGenerationCalled = true; }
  }

  // the node the Component field `target` references (null when unset)
  _targetNode() {
    const t = this.comp.target;
    if (!t) return null;
    return this.host.node(t.transform || t.gameObject);
  }

  _make() {
    const c = this.comp, h = this.host, mgr = h.mgr, n = this._targetNode(), d = c.duration;
    const pair = `${c.animationType},${c.targetType}`;
    const need = (what) => { if (!n[what]) unsupported(`${n.path}: no ${what}`); };
    switch (pair) {
      case "1,5": {                      // DOAnchorPos3D
        if (c.optionalBool0) unsupported("snapping");
        const [g, s] = nodeProps.anchoredPosition3D(n);
        return dtTo(mgr, g, s, { ...c.endValueV3 }, d, DT_PLUGIN.vector3).setTarget(n);
      }
      case "5,11": {                     // DOScale on targetGO's transform
        const tn = this.targetGO, [g, s] = nodeProps.localScale(tn);
        const e = c.optionalBool0 ? { x: c.endValueFloat, y: c.endValueFloat, z: c.endValueFloat } : { ...c.endValueV3 };
        return dtTo(mgr, g, s, e, d, DT_PLUGIN.vector3).setTarget(tn);
      }
      case "6,3": {                      // DOColor on the Graphic
        need("image");
        const [g, s] = nodeProps.color(n);
        return dtTo(mgr, g, s, { ...c.endValueColor }, d, DT_PLUGIN.color).setTarget(n.image);
      }
      case "7,3": {                      // DOFade on the Graphic (alpha only)
        need("image");
        const [g, s] = nodeProps.color(n);
        return dtTo(mgr, g, s, c.endValueFloat, d, DT_PLUGIN.alpha).setTarget(n.image);
      }
      case "7,2": {                      // DOFade on the CanvasGroup
        need("canvasGroup");
        const [g, s] = nodeProps.alpha(n);
        return dtTo(mgr, g, s, c.endValueFloat, d, DT_PLUGIN.float).setTarget(n.canvasGroup);
      }
      case "21,5": {                     // DOSizeDelta (snapping off)
        const [g, s] = nodeProps.sizeDelta(n);
        const e = c.optionalBool0 ? { x: c.endValueFloat, y: c.endValueFloat } : { ...c.endValueV2 };
        return dtTo(mgr, g, s, e, d, DT_PLUGIN.vector2).setTarget(n);
      }
      case "9,5": {                      // DOPunchAnchorPos(endValueV3 as Vector2, vibrato, elasticity)
        if (c.optionalBool0) unsupported("snapping");
        const [g, s] = nodeProps.anchoredPosition(n);
        return dtPunch(mgr, g, s, { x: F(c.endValueV3.x), y: F(c.endValueV3.y), z: 0 }, d, c.optionalInt0, c.optionalFloat0).setTarget(n);
      }
      case "12,5": {                     // DOShakeAnchorPos(duration, strength as Vector2, ...): no tween for duration <= 0
        if (c.optionalBool0) unsupported("snapping");
        if (!(d > 0)) { console.warn("DOShakeAnchorPos: duration can't be 0, no tween"); return null; }
        const [g, s] = nodeProps.anchoredPosition(n);
        return dtShake(mgr, h.random, g, s, d, { x: F(c.endValueV3.x), y: F(c.endValueV3.y), z: 0 }, c.optionalInt0,
                       c.optionalFloat0, !!c.optionalBool1, c.optionalShakeRandomnessMode).setTarget(n);
      }
      case "3,11": {                     // DORotate(endValueV3, duration, RotateMode): world rotation
        if (c.optionalRotationMode !== 0) unsupported(`RotateMode ${c.optionalRotationMode}`);
        const [g, s] = rotationProps(n);
        return dtRotate(mgr, g, s, { ...c.endValueV3 }, d).setTarget(n);
      }
      default: unsupported(`animation type ${c.animationType} on target type ${c.targetType}`);
    }
    return null;
  }

  createTween(regenerate, andPlay) {
    const c = this.comp;
    if (!c.isValid) { if (regenerate) console.warn("DOTweenAnimation: not valid"); return; }
    if (this.tween) {
      if (this.tween.active) { if (!regenerate) return; this.tween.kill(false); }
      this.tween = null;
    }
    if (!c.target || !this.targetGO) { console.warn(`DOTweenAnimation ${this.node.path}: target is unset`); return; }
    const t = this._make();
    if (!t) return;
    this.tween = t;
    t.setRelative(false).setTarget(this.tweenTarget).setDelay(c.delay).setLoops(c.loops, c.loopType).setAutoKill(!!c.autoKill)
      .on("onKill", () => { this.tween = null; });
    t.setEase(c.easeType);
    if (c.id) t.setId(c.id);
    t.setUpdate(false);
    for (const [ev, has] of EVENTS) if (c[has] && c[ev]) t.on(ev, () => invokeUnityEvent(this.host, c[ev]));
    if (andPlay) t.play(); else t.pause();
    if (c.hasOnTweenCreated && c.onTweenCreated) invokeUnityEvent(this.host, c.onTweenCreated);
  }

  doPlay() { this.host.mgr.play(this.tweenTarget); }
  doKill() { this.host.mgr.kill(this.tweenTarget); this.tween = null; }

  persistentMethods() {
    return { DOPlay: () => this.doPlay(), DOKill: () => this.doKill(),
             DOPlayAllById: (id) => this.host.mgr.play(id), DOKillAllById: (id) => this.host.mgr.kill(id) };
  }
}

export class DOTweenSequenceComponent {
  constructor(host, node, comp) {
    this.host = host; this.node = node; this.comp = comp; this.className = "DOTweenSequence";
    this.tween = null;                   // ABSAnimationComponent.tween: never set by DOTweenSequence
    this.sequence = null;
    this.timeScale = 1;                  // _currentTimeScale
    this.enabled = !!comp.m_Enabled;
    if (comp._isAutoPlay) unsupported("_isAutoPlay");
    if (!comp._killOnDisable) unsupported("_killOnDisable off");
    this.list = comp._list.map((cmd) => ({ ...cmd, animations: undefined }));
  }

  // DOTweenCommand.Animations (the GameObject's ABSAnimationComponents, cached) and SelectedTweenAnimation
  _animations(cmd) {
    if (!cmd._tweenAnimation) return null;
    if (cmd.animations === undefined) cmd.animations = this.host.abs(cmd._tweenAnimation.gameObject);
    return cmd.animations;
  }

  _selected(cmd) {
    if (!cmd._tweenAnimation) return null;
    const list = this._animations(cmd);
    if (list.length > 1) unsupported(`${cmd._tweenAnimation.gameObject}: several animation components on one GameObject`);
    return cmd._tweenIndex < list.length ? list[cmd._tweenIndex] : this.host.componentOf(cmd._tweenAnimation);
  }

  createSequence() {
    const mgr = this.host.mgr, seq = new DTSequence(mgr).setAutoKill(false);
    let at = 0;
    this.list.forEach((cmd, i) => {
      const sel = this._selected(cmd);
      if (sel === this) return;
      if (cmd._commandType === 1) seq.insertCallback(at, () => invokeUnityEvent(this.host, this.list[i]._tweenEvent));
      else if (cmd._commandType === 0) {
        if (!sel) unsupported("a TweenAnimation command without an animation");
        if (sel instanceof DOTweenSequenceComponent) unsupported("nested DOTweenSequence");
        if (!(sel instanceof DOTweenAnimation)) unsupported(`command animation ${sel.className}`);
        sel.createTween(false, true);
        const t = sel.tween ? sel.tween.setAutoKill(false) : null;
        seq.insert(at, t);
      } else if (cmd._commandType !== 2) unsupported(`DOTweenCommand type ${cmd._commandType}`);
      if (cmd._duration > 0) at = F(at + cmd._duration);
    });
    seq.insertCallback(at, () => this.onCompleted());
    seq.timeScale = this.timeScale;
    return seq;
  }

  onCompleted() { if (this.comp._isLoop && this.sequence) this.sequence.restart(true); }

  doPlay() { this.doKill(); this.sequence = this.createSequence(); this.sequence.play(); }

  doKill() {
    if (this.sequence) this.sequence.kill(false);
    this.sequence = null;
    for (const cmd of this.list) {
      const list = this._animations(cmd);
      if (list) for (const a of list) if (a.tween) a.tween.kill(false);
    }
  }

  setTimeScale(s) {
    if (s <= 0) s = 1;
    this.timeScale = s;
    if (this.sequence) this.sequence.timeScale = s;
  }

  onDisable() { this.doKill(); }

  persistentMethods() { return { DOPlay: () => this.doPlay() }; }
}
