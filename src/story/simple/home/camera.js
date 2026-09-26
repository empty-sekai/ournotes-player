import { mat4 } from "../../../engine/math.js";
import { EASE } from "../../../engine/tween.js";

// The home spot's main camera as SpotCameraController drives it during a talk (CameraManager.MainCamera): the default
// pose (SetDefaultPosition / CalculateOrbitPosition), the focus tween to a tapped character (FocusCharacterAsync), the
// return tween (ReturnToDefaultPosition), Reset, StopUiFadeAndShow and the field of view the controller reapplies
// every frame (OnUpdate: SpotPinchZoomController fov + zoom offset, clamped to the zoom limits). The swipe, gyro and
// pinch state (SpotAttitudeOrchestrator, SpotPinchZoomController input) is runtime state that a talk freezes; it is
// not reproduced, so the zoom offset is 0 and the pose before a talk is the default pose.
//
// Positions are world positions (Transform.position); the camera has no parent. Managed Vector3 / Quaternion
// arithmetic is float32 in source order.

const f = Math.fround;
const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const EPSILON = 0.00001;                  // Vector3f::epsilon of the native LookRotation

export const vec3 = (v) => ({ x: f(v.x), y: f(v.y), z: f(v.z) });

// UnityEngine.Quaternion * Vector3 (the managed operator)
export const rotateVector = (q, p) => {
  const x = f(q.x * 2), y = f(q.y * 2), z = f(q.z * 2);
  const xx = f(q.x * x), yy = f(q.y * y), zz = f(q.z * z);
  const xy = f(q.x * y), xz = f(q.x * z), yz = f(q.y * z);
  const wx = f(q.w * x), wy = f(q.w * y), wz = f(q.w * z);
  return {
    x: f(f(f(f(1 - f(yy + zz)) * p.x) + f(f(xy - wz) * p.y)) + f(f(xz + wy) * p.z)),
    y: f(f(f(f(xy + wz) * p.x) + f(f(1 - f(xx + zz)) * p.y)) + f(f(yz - wx) * p.z)),
    z: f(f(f(f(xz - wy) * p.x) + f(f(yz + wx) * p.y)) + f(f(1 - f(xx + yy)) * p.z)),
  };
};

// Transform.forward = rotation * Vector3.forward
export const forwardOf = (q) => rotateVector(q, { x: 0, y: 0, z: 1 });

// Quaternion.LookRotation(forward, up); null where the native call fails (zero forward, forward parallel to up) and
// leaves the rotation unchanged.
// ENGINE: LookRotationToQuaternion is native; basis z = forward, x = up x z, y = z x x, trace method, in double, stored as float32.
export const lookRotation = (fwd, up = UP) => {
  let m = Math.hypot(fwd.x, fwd.y, fwd.z);
  if (m < EPSILON) return null;
  const z = [fwd.x / m, fwd.y / m, fwd.z / m];
  let x = [up.y * z[2] - up.z * z[1], up.z * z[0] - up.x * z[2], up.x * z[1] - up.y * z[0]];
  m = Math.hypot(x[0], x[1], x[2]);
  if (m < EPSILON) return null;
  x = [x[0] / m, x[1] / m, x[2] / m];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const M = (r, c) => [x, y, z][c][r];                    // basis vectors as columns
  const q = [0, 0, 0];
  let w;
  const tr = M(0, 0) + M(1, 1) + M(2, 2);
  if (tr > 0) {
    let r = Math.sqrt(tr + 1);
    w = 0.5 * r; r = 0.5 / r;
    q[0] = (M(2, 1) - M(1, 2)) * r; q[1] = (M(0, 2) - M(2, 0)) * r; q[2] = (M(1, 0) - M(0, 1)) * r;
  } else {
    const next = [1, 2, 0];
    let i = 0;
    if (M(1, 1) > M(0, 0)) i = 1;
    if (M(2, 2) > M(i, i)) i = 2;
    const j = next[i], k = next[j];
    let r = Math.sqrt(M(i, i) - M(j, j) - M(k, k) + 1);
    q[i] = 0.5 * r; r = 0.5 / r;
    w = (M(k, j) - M(j, k)) * r;
    q[j] = (M(j, i) + M(i, j)) * r;
    q[k] = (M(k, i) + M(i, k)) * r;
  }
  const n = Math.hypot(q[0], q[1], q[2], w);
  return { x: f(q[0] / n), y: f(q[1] / n), z: f(q[2] / n), w: f(w / n) };
};

// Transform.LookAt(target) from `position` (world up): the new rotation, or `current` when LookRotation fails
export const lookAt = (position, target, current) => {
  const r = lookRotation({ x: f(target.x - position.x), y: f(target.y - position.y), z: f(target.z - position.z) });
  return r || current;
};

// Quaternion.Slerp(a, b, t) (t clamped to [0, 1]), what PureQuaternionPlugin.EvaluateAndApply applies with the eased
// position (its change value is the end rotation itself: SetChangeValue copies endValue).
// ENGINE: Quaternion.Internal_Slerp is native; shortest-arc slerp, normalized lerp at |dot| >= 0.95, in double, stored as float32.
export const slerp = (a, b, t) => {
  t = Math.min(1, Math.max(0, t));
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let q = b;
  if (dot < 0) { dot = -dot; q = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; }
  let r;
  if (dot < 0.95) {
    const ang = Math.acos(dot), s = 1 / Math.sin(ang), s0 = Math.sin(ang * (1 - t)), s1 = Math.sin(ang * t);
    r = { x: (a.x * s0 + q.x * s1) * s, y: (a.y * s0 + q.y * s1) * s, z: (a.z * s0 + q.z * s1) * s, w: (a.w * s0 + q.w * s1) * s };
  } else {
    r = { x: a.x * (1 - t) + q.x * t, y: a.y * (1 - t) + q.y * t, z: a.z * (1 - t) + q.z * t, w: a.w * (1 - t) + q.w * t };
    const n = Math.hypot(r.x, r.y, r.z, r.w);
    r = { x: r.x / n, y: r.y / n, z: r.z / n, w: r.w / n };
  }
  return { x: f(r.x), y: f(r.y), z: f(r.z), w: f(r.w) };
};

// SpotCameraController.OnUpdate: Camera.fieldOfView = clamp(fieldOfView + zoom offset, zoomMinFov, zoomMaxFov)
// (SpotPinchZoomController holds the three settings values; the zoom offset stays 0 without a pinch)
export const spotFieldOfView = (s, zoomOffset = 0) => {
  const v = f(f(s.fieldOfView) + zoomOffset), lo = f(s.zoomMinFov), hi = f(s.zoomMaxFov);
  return v < lo ? lo : Math.min(v, hi);
};

export class SpotCamera {
  // settings: spot.json situationSettings (SpotSituationSettings, copied by SpotCameraController.SetParameter);
  // near / far: the main camera's clip planes
  constructor(loop, settings, { near, far }) {
    if (!settings) throw new Error("spot camera: no situation settings");
    for (const k of ["originalOffset", "defaultPositionOffset", "orbitRatio", "fieldOfView", "zoomMinFov", "zoomMaxFov"])
      if (settings[k] === undefined) throw new Error(`spot camera: situationSettings.${k} missing`);
    if (!(near > 0) || !(far > near)) throw new Error(`spot camera: clip planes ${near} / ${far}`);
    this.loop = loop;
    this.originalOffset = vec3(settings.originalOffset);
    this.defaultPositionOffset = vec3(settings.defaultPositionOffset);
    this.orbitRatio = f(settings.orbitRatio);
    this.near = near; this.far = far;
    this.fieldOfView = spotFieldOfView(settings);
    this.position = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0, w: 1 };
    this.uiAlphaRatio = 1;                              // SpotCameraController._uiAlphaRatio
    this.isCameraOperating = false;
    this.tweens = new Set();
    this.setDefaultPosition();
  }

  // CalculateOrbitPosition: defaultPositionOffset - orbitRatio * forward
  orbitPosition(rotation) {
    const fw = forwardOf(rotation), d = this.defaultPositionOffset, k = this.orbitRatio;
    return { x: f(d.x - f(k * fw.x)), y: f(d.y - f(k * fw.y)), z: f(d.z - f(k * fw.z)) };
  }

  // the pose SetDefaultPosition sets: position = defaultPositionOffset, LookAt(originalOffset), then the orbit
  // position for that rotation (ReturnToDefaultPosition computes its end values the same way)
  defaultPose() {
    const rotation = lookAt(this.defaultPositionOffset, this.originalOffset, this.rotation);
    return { position: this.orbitPosition(rotation), rotation };
  }

  // SpotCameraController.SetDefaultPosition
  setDefaultPosition() {
    const p = this.defaultPose();
    this.position = p.position; this.rotation = p.rotation;
  }

  // SpotCameraController.FocusCharacterAsync(character, duration): P = camera position, F = the character's _focus
  // world position, target = (F - P) * _distanceRatio + P, end rotation = LookAt(F) from the target (position and
  // rotation are restored before the tweens start); DOMove(target) and DORotateQuaternion(end), both SetEase(InOutQuad),
  // awaited together (UniTask.WhenAll).
  focus(focusPosition, distanceRatio, duration) {
    const P = this.position, F = vec3(focusPosition), k = f(distanceRatio);
    const target = { x: f(f(f(F.x - P.x) * k) + P.x), y: f(f(f(F.y - P.y) * k) + P.y), z: f(f(f(F.z - P.z) * k) + P.z) };
    return this._tweenTo(target, lookAt(target, F, this.rotation), duration);
  }

  // SpotCameraController.ReturnToDefaultPosition(duration): the default pose as the end values, the same two tweens
  returnToDefault(duration) {
    const p = this.defaultPose();
    return this._tweenTo(p.position, p.rotation, duration);
  }

  // SpotCameraController.Reset: the controller's fade cancelled, SpotAttitudeOrchestrator.Reset (no input state
  // here), IsCameraOperating = false, _uiAlphaRatio = 1; the transform is not touched
  reset() { this.isCameraOperating = false; this.uiAlphaRatio = 1; }

  // SpotCameraController.StopUiFadeAndShow: the running UI fade cancelled, IsCameraOperating = false, _uiAlphaRatio = 1
  stopUiFadeAndShow() { this.isCameraOperating = false; this.uiAlphaRatio = 1; }

  // DOMove + DORotateQuaternion on the loop's DOTween runner: each reads its start value at its first update
  // (Vector3Plugin: start + (end - start) x ease per component; PureQuaternionPlugin: Slerp(start, end, ease))
  _tweenTo(position, rotation, duration) {
    const tw = this.loop.tweens;
    let start = null;
    const move = tw.to(() => ({ ...this.position }), position, duration, EASE.InOutQuad, (v) => { this.position = v; });
    const turn = tw.to(() => { start = { ...this.rotation }; return 0; }, 1, duration, EASE.InOutQuad,
                       (e) => { this.rotation = slerp(start || this.rotation, rotation, e); });
    for (const t of [move, turn]) if (!t.done) { this.tweens.add(t); t.promise.then(() => this.tweens.delete(t)); }
    return Promise.all([move.promise, turn.promise]).then(() => undefined);
  }

  kill() { for (const t of [...this.tweens]) t.kill(); this.tweens.clear(); }

  worldMatrix() { return mat4.trs(this.position, this.rotation, { x: 1, y: 1, z: 1 }); }

  // Unity worldToCameraMatrix (view space looks down -z)
  viewMatrix() { return mat4.mul(mat4.scale(1, 1, -1), mat4.inverseRigid(this.worldMatrix())); }

  projection(aspect) { return mat4.perspective(this.fieldOfView, aspect, this.near, this.far); }
}
