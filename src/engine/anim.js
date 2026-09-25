import { F } from "./core.js";

// Mecanim animation clips (AnimClip), a one-layer Animator state machine (AnimController, Animator), Transform
// accessors, UnityEngine.Gradient and AnimationCurve evaluation: used by the note effects, the combo counter, the flick
// arrows and the start timeline.
//
// Clip data (raw Mecanim clips): `streamed` {curveCount, frames: [[time, [[curve, c0, c1, c2, c3], ...]]]},
// `dense`, `constant`, `bindings` [{path, typeID, class, attribute, curves}] (a binding with `curves` n covers n
// consecutive curves: position / scale / euler x, y, z; rotation x, y, z, w). Curve order = streamed, dense,
// constant (the order of the clip's binding constant).
// Streamed keys are sampled in float32 (last key with time <= t, first key at -FLT_MAX):
// value = ((c0 x + c1) x + c2) x + c3, x = t - key time.
// ENGINE: Mecanim samples streamed clips natively; this is the cubic form of the stored keys.
//
// Targets: an Animator binds each distinct binding (path, class, attribute) once through a host callback
// bind(binding) -> {set(v), get()} | null (null = no such object / property: Unity skips the curve). AnimTargets
// has the accessors for Transform; hosts add their own (GameObject, renderers, ParticleSystem, CanvasGroup, UI).

export class AnimError extends Error {};

// one streamed curve at local time t (float32): t[] key times, k[] 4 coefficients per key
export const animEval = (ts, k, t) => {
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ts[m] <= t) lo = m; else hi = m - 1; }
  const x = F(t - ts[lo]), i = lo * 4;
  return F(F(F(F(F(F(k[i] * x) + k[i + 1]) * x) + k[i + 2]) * x) + k[i + 3]);
};

export const ANIM_COMPONENTS = { 1: [""], 3: [".x", ".y", ".z"], 4: [".x", ".y", ".z", ".w"] };

// ------------------------------------------------------------------- clip
// desc = {name, length, loopTime, curves: [{binding: {path, cls, typeID, attr}, t, k} | {binding, constant}],
//         events: [{time, functionName, ...}]}
export class AnimClip {
  constructor(desc) {
    this.name = desc.name;
    this.length = F(desc.length);
    this.loopTime = !!desc.loopTime;
    this.curves = desc.curves;
    this.events = (desc.events || []).map((e) => ({ ...e, time: F(e.time) }));
  }

  // raw Mecanim clip. Dense and discrete / PPtr curves are not implemented (no live clip has any; raising
  // keeps other data from being sampled wrongly).
  static fromMecanim(clip, key = clip.name) {
    const name = key;
    if (clip.startTime !== 0 || clip.cycleOffset) throw new AnimError(`clip ${name}: start time / cycle offset`);
    if (clip.dense.curveCount || clip.discreteCurveCount || (clip.pptrCurveMapping && clip.pptrCurveMapping.length))
      throw new AnimError(`clip ${name}: dense / discrete / PPtr curves not implemented`);
    const bindings = [];
    for (const b of clip.bindings) {
      const comps = ANIM_COMPONENTS[b.curves || 1];
      if (!comps) throw new AnimError(`clip ${name}: binding with ${b.curves} curves`);
      for (const c of comps)
        bindings.push({ path: b.path, cls: b.class, typeID: b.typeID, attr: `${b.attribute}${c}` });
    }
    const nS = clip.streamed.curveCount;
    if (bindings.length !== nS + clip.constant.length) throw new AnimError(`clip ${name}: binding count`);
    const curves = [];
    for (let c = 0; c < nS; c++) curves.push({ binding: bindings[c], t: [], k: [] });
    for (const [time, keys] of clip.streamed.frames)
      for (const [c, c0, c1, c2, c3] of keys) {
        const s = curves[c];
        s.t.push(F(time)); s.k.push(F(c0), F(c1), F(c2), F(c3));
      }
    clip.constant.forEach((v, j) => curves.push({ binding: bindings[nS + j], constant: F(v) }));
    return new AnimClip({ name, length: clip.stopTime, loopTime: clip.loopTime, curves, events: clip.events });
  }

  // Looping clips wrap with a positive modulo (a state playing at speed -1 runs its time below 0), others clamp.
  // ENGINE: Mecanim's wrap of negative state time is native; positive modulo is the documented looping behaviour.
  // A zero-length clip (constant curves only) samples at 0.
  localTime(t) {
    const L = this.length;
    if (this.loopTime && L > 0) { const r = t % L; return r < 0 ? r + L : r; }
    return Math.min(Math.max(t, 0), L);
  }

  // out(curveIndex, value) for every curve in curve order, at state time `time`
  sample(time, out) {
    const t = F(this.localTime(time));
    for (let i = 0; i < this.curves.length; i++) {
      const c = this.curves[i];
      out(i, c.t === undefined ? c.constant : animEval(c.t, c.k, t));
    }
  }

  // AnimationClip.AddEvent (runtime events, e.g. Fwk AnimationFinishEventTrigger at clip.length)
  addEvent(ev) { this.events.push({ ...ev, time: F(ev.time) }); this.events.sort((a, b) => a.time - b.time); }

  // Events passed while the state time moved from `prev` (exclusive) to `cur` (inclusive), in time order.
  // ENGINE: AnimationEvent dispatch is native; (prev, cur] window, fired after the frame's pose (documented).
  // An event at exactly the end of a clamped clip fires once.
  eventsBetween(prev, cur) {
    if (!this.events.length || !(cur > prev)) return [];
    const L = this.length, out = [];
    if (!this.loopTime || !(L > 0)) {
      for (const e of this.events) if (e.time > prev && e.time <= cur) out.push(e);
      return out;
    }
    for (let n = Math.floor(prev / L); n * L <= cur; n++)
      for (const e of this.events) { const t = n * L + e.time; if (t > prev && t <= cur) out.push(e); }
    return out;
  }

  // Resolve bindings exported as `crc32:<n>` (Unity keeps only the CRC32 of the attribute name) against candidate
  // attribute names; unmatched ones stay unresolved.
  resolveCrc(candidates) {
    const byCrc = new Map(candidates.map((s) => [crc32(s) >>> 0, s]));
    for (const c of this.curves) {
      const m = /^crc32:(\d+)$/.exec(c.binding.attr);
      if (m && byCrc.has(Number(m[1]) >>> 0)) c.binding = { ...c.binding, attr: byCrc.get(Number(m[1]) >>> 0) };
    }
    return this;
  }
};

export let _crcTable = null;
export const crc32 = (s) => {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  const bytes = new TextEncoder().encode(s);
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = _crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

// ------------------------------------------------------------------- controller
// Normalized one-layer controller: {name, states: [{name, speed, clip, writeDefaults, transitions}], defaultState
// (index), anyState: [transition], parameters: Map name -> {type, value}}. transition = {destination, duration,
// offset, exitTime, hasExitTime, fixedDuration, canTransitionToSelf, conditions: [{mode, event, threshold}]}.
export const AnimController = {
  // raw AnimatorController: clips[i].clip keys into `clipOf(key)` -> AnimClip
  fromMecanim(ctrl, clipOf) {
    if (ctrl.layers.length !== 1) throw new AnimError(`${ctrl.name}: ${ctrl.layers.length} layers`);
    const sm = ctrl.stateMachines[ctrl.layers[0].stateMachine];
    const clips = ctrl.clips.map((c) => clipOf(c.clip));
    const states = sm.states.map((s) => {
      if (s.cycleOffset || s.mirror || s.speedParam || s.timeParam) throw new AnimError(`${ctrl.name}.${s.name}: state settings`);
      if (s.blendTrees.length > 1 || (s.blendTrees[0] && s.blendTrees[0].length !== 1))
        throw new AnimError(`${ctrl.name}.${s.name}: blend tree`);
      const leaf = s.blendTrees[0] ? s.blendTrees[0][0] : null;
      if (leaf && (leaf.children.length || leaf.clip < 0)) throw new AnimError(`${ctrl.name}.${s.name}: blend tree`);
      return { name: s.name, speed: s.speed, clip: leaf ? clips[leaf.clip] : null, writeDefaults: !!s.writeDefaultValues,
               transitions: s.transitions };
    });
    const parameters = new Map(ctrl.parameters.map((p) => [p.name, { type: p.type, value: p.type === 9 || p.type === 4 ? false : 0 }]));
    return { name: ctrl.name, states, defaultState: sm.defaultState, anyState: sm.anyStateTransitions, parameters };
  },
};

// ------------------------------------------------------------------- Animator
// The state time advances in the animation phase before sampling, so a state entered this frame is first sampled
// after one advance. Update mode 0 (Normal): scaled delta time * Animator.speed.
// ENGINE: the Animator update is native; advance-then-sample is the order assumed here.
// Write Defaults: every property bound by any clip of the controller gets its default value (read from the target
// when the Animator binds) while the current state's clip does not animate it; WriteDefaultValues() writes all.
// Transitions: condition transitions (AnyState first, then the current state's) are taken before the advance; an
// exit-time transition after it, when the state's normalized time reaches exitTime.
// ENGINE: Mecanim's state machine is native; transition order, carried-over time and cross-fade weights follow the docs.
// That covers the order of transition checks inside one update, the time carried into the destination of a
// zero-duration exit-time transition (here: the time past the exit point), the linear weight of a cross-fade (source
// and destination both advancing), and no transition being evaluated while a cross-fade runs (interruption source
// None; the data carries no interruption fields).
export class Animator {
  // ctrl: normalized controller; bind(binding) -> accessor | null
  constructor(ctrl, bind, name = ctrl.name) {
    this.name = name;
    this.ctrl = ctrl;
    this.speed = 1;                     // Animator.speed
    this.enabled = true;
    this.onEvent = null;                // (event, state) => void
    this.props = new Map();             // binding id -> {acc, def}
    this.bound = new Map();             // clip -> accessor per curve (null = skipped)
    for (const s of ctrl.states) if (s.clip && !this.bound.has(s.clip)) this.bound.set(s.clip, s.clip.curves.map((c) => this._prop(c.binding, bind)));
    this.params = new Map([...(ctrl.parameters || new Map())].map(([k, p]) => [k, { ...p }]));
    this.reset();
  }

  _prop(b, bind) {
    const id = `${b.path}\u0000${b.cls}\u0000${b.attr}`;
    if (!this.props.has(id)) {
      const acc = bind(b);
      this.props.set(id, acc ? { acc, def: acc.get ? acc.get() : undefined } : null);
    }
    return this.props.get(id);
  }

  stateIndex(name) {
    const i = this.ctrl.states.findIndex((s) => s.name === name);
    if (i < 0) throw new AnimError(`${this.name}: no state ${name}`);
    return i;
  }

  get state() { return this.ctrl.states[this.si]; }

  // Animator enable with keepAnimatorStateOnDisable false: back to the default state at time 0, parameters at their
  // defaults (the controllers used have only triggers, default false).
  // ENGINE: the parameter reset on re-enable is native; parameters return to their defaults here.
  reset() {
    this.si = this.ctrl.defaultState; this.time = 0; this.fade = null;
    for (const p of this.params.values()) p.value = p.type === 9 || p.type === 4 ? false : 0;
  }

  // Animator.Play(state) / CrossFade(state, 0): immediate switch to the state at normalizedTime * length.
  // ENGINE: Play / CrossFade are native; a zero-length cross-fade is an immediate switch, also to the playing state.
  play(name, normalizedTime = 0) {
    this.si = typeof name === "number" ? name : this.stateIndex(name);
    const c = this.state.clip;
    this.time = c ? F(normalizedTime * c.length) : 0;
    this.fade = null;
  }

  setTrigger(name) {
    const p = this.params.get(name);
    if (!p || p.type !== 9) throw new AnimError(`${this.name}: no trigger ${name}`);
    p.value = true;
  }

  _conditionsMet(tr) {
    for (const c of tr.conditions) {
      const p = this.params.get(c.event);
      if (!p) throw new AnimError(`${this.name}: condition on ${c.event}`);
      if (c.mode === 1) { if (!p.value) return false; }             // If (bool / trigger true)
      else if (c.mode === 2) { if (p.value) return false; }         // IfNot
      else if (c.mode === 3) { if (!(p.value > c.threshold)) return false; }
      else if (c.mode === 4) { if (!(p.value < c.threshold)) return false; }
      else if (c.mode === 6) { if (p.value !== c.threshold) return false; }
      else if (c.mode === 7) { if (p.value === c.threshold) return false; }
      else throw new AnimError(`${this.name}: condition mode ${c.mode}`);
    }
    return true;
  }

  _consume(tr) { for (const c of tr.conditions) { const p = this.params.get(c.event); if (p.type === 9) p.value = false; } }

  _take(tr, carry) {
    this._consume(tr);
    const dst = this.ctrl.states[tr.destination], L = dst.clip ? dst.clip.length : 0;
    const t0 = F(F(tr.offset * L) + carry);
    const src = this.state, len = src.clip ? src.clip.length : 0;
    const dur = tr.fixedDuration ? tr.duration : tr.duration * len;
    if (dur > 0) this.fade = { from: this.si, fromTime: this.time, duration: F(dur), elapsed: 0 };
    else this.fade = null;
    this.si = tr.destination; this.time = t0;
  }

  update(dt) {
    if (!this.enabled) return;
    // condition transitions (AnyState, then the state's own without exit time)
    if (!this.fade) {
      const cand = [...(this.ctrl.anyState || []).filter((t) => !t.hasExitTime),
                    ...(this.state.transitions || []).filter((t) => !t.hasExitTime && t.conditions.length)];
      for (const tr of cand) {
        if (!tr.canTransitionToSelf && tr.destination === this.si) continue;
        if (this._conditionsMet(tr)) { this._take(tr, 0); break; }
      }
    }
    const st = this.state, prev = this.time;
    this.time = F(this.time + F(F(dt * st.speed) * this.speed));
    if (this.fade) {
      const f = this.fade, fs = this.ctrl.states[f.from];
      f.fromTime = F(f.fromTime + F(F(dt * fs.speed) * this.speed));
      f.elapsed = F(f.elapsed + F(F(dt) * this.speed));
      if (f.elapsed >= f.duration) this.fade = null;
    }
    // exit-time transitions of the current state
    if (!this.fade && st.clip && st.clip.length > 0) {
      for (const tr of st.transitions || []) {
        if (!tr.hasExitTime || !this._conditionsMet(tr)) continue;
        const L = st.clip.length, e = tr.exitTime;
        const n0 = prev / L, n1 = this.time / L;
        // exit time < 1 on a looping state is reached once per cycle; >= 1 once
        const hit = e < 1 && st.clip.loopTime ? Math.floor(n1 - e) > Math.floor(n0 - e) : n0 < e && n1 >= e;
        if (!hit) continue;
        const past = F((n1 - (e < 1 && st.clip.loopTime ? Math.floor(n1 - e) + e : e)) * L);
        this._fireEvents(st, prev, this.time);
        this._take(tr, past);
        this._write();
        return;
      }
    }
    this._write();
    this._fireEvents(st, prev, this.time);
  }

  _fireEvents(st, prev, cur) {
    if (!st.clip || !this.onEvent) return;
    for (const e of st.clip.eventsBetween(prev, cur)) this.onEvent(e, st);
  }

  // Sample the current state (and the fading-out one) into the bound properties.
  _write() {
    const st = this.state;
    if (!this.fade) {
      if (st.writeDefaults) this._writeDefaultsExcept(st.clip);
      if (st.clip) { const accs = this.bound.get(st.clip); st.clip.sample(this.time, (i, v) => { if (accs[i]) accs[i].acc.set(v); }); }
      return;
    }
    const f = this.fade, fs = this.ctrl.states[f.from], w = Math.min(Math.max(f.elapsed / f.duration, 0), 1);
    const vals = new Map();
    const collect = (s, time, k) => {
      if (!s.clip) return;
      const accs = this.bound.get(s.clip);
      s.clip.sample(time, (i, v) => { const p = accs[i]; if (!p) return; const e = vals.get(p) || [undefined, undefined]; e[k] = v; vals.set(p, e); });
    };
    collect(fs, f.fromTime, 0); collect(st, this.time, 1);
    for (const p of this.props.values()) if (p && !vals.has(p) && (fs.writeDefaults || st.writeDefaults)) vals.set(p, [undefined, undefined]);
    for (const [p, [a, b]] of vals) {
      const cur = p.acc.get ? p.acc.get() : 0;
      const va = a !== undefined ? a : fs.writeDefaults ? p.def : cur;
      const vb = b !== undefined ? b : st.writeDefaults ? p.def : cur;
      p.acc.set(F(va + F(F(vb - va) * w)));
    }
  }

  _writeDefaultsExcept(clip) {
    const skip = clip ? new Set(this.bound.get(clip)) : new Set();
    for (const p of this.props.values()) if (p && !skip.has(p) && p.def !== undefined) p.acc.set(p.def);
  }

  // Animator.WriteDefaultValues()
  writeDefaultValues() { for (const p of this.props.values()) if (p && p.def !== undefined) p.acc.set(p.def); }
};

// ------------------------------------------------------------------- accessors for Transform
// Local position / scale components are written directly. Rotation components (m_LocalRotation) are written as
// they come. Euler components (localEulerAnglesRaw) keep the transform's euler triple and set
// rotation = Quaternion.Euler after each component.
// ENGINE: Mecanim's quaternion normalisation of a single sampled clip is native; it is not applied here.
// ENGINE: an untouched transform's starting euler triple is m_LocalEulerAnglesHint; here `localEuler` or (0, 0, 0).
export const AnimTargets = {
  transform(t, attr) {
    const m = /^(m_LocalPosition|m_LocalScale|m_LocalRotation|localEulerAnglesRaw|localEulerAngles|m_LocalEulerAnglesHint)\.([xyzw])$/.exec(attr);
    if (!m) return null;
    const [, prop, c] = m;
    if (prop === "m_LocalPosition") return { get: () => t.localPosition[c], set: (v) => { t.localPosition[c] = v; } };
    if (prop === "m_LocalScale") return { get: () => t.localScale[c], set: (v) => { t.localScale[c] = v; } };
    if (prop === "m_LocalRotation") return { get: () => t.localRotation[c], set: (v) => { t.localRotation[c] = v; } };
    if (c === "w") return null;
    return {
      get: () => (t.localEuler || { x: 0, y: 0, z: 0 })[c],
      set: (v) => { const e = { ...(t.localEuler || { x: 0, y: 0, z: 0 }) }; e[c] = v; t.setLocalEuler(e.x, e.y, e.z); },
    };
  },
};

// ------------------------------------------------------------------- Gradient (UnityEngine.Gradient)
// Serialized packing: keyN.rgb colour key N, keyN.a alpha key N, ctimeN / atimeN = time * 65535.
// Blend mode (m_Mode 0): linear between neighbouring keys, clamped to the first / last key outside them.
// m_ColorSpace 0 (Gamma) and -1 (Uninitialized) are interpolated on the stored (gamma) values.
// ENGINE: Gradient.Evaluate is native; this is its documented blend on the stored values.
export class Gradient {
  constructor(g) {
    if (g.m_Mode !== 0) throw new AnimError(`gradient mode ${g.m_Mode} not implemented`);
    if (g.m_ColorSpace !== 0 && g.m_ColorSpace !== -1) throw new AnimError(`gradient colour space ${g.m_ColorSpace}`);
    this.colorKeys = [];
    for (let i = 0; i < g.m_NumColorKeys; i++) {
      const k = g[`key${i}`];
      this.colorKeys.push({ t: F(g[`ctime${i}`] / 65535), c: [k.r, k.g, k.b] });
    }
    this.alphaKeys = [];
    for (let i = 0; i < g.m_NumAlphaKeys; i++) this.alphaKeys.push({ t: F(g[`atime${i}`] / 65535), a: g[`key${i}`].a });
  }

  static _eval(keys, t, get) {
    if (t <= keys[0].t) return get(keys[0]);
    const n = keys.length;
    if (t >= keys[n - 1].t) return get(keys[n - 1]);
    let i = 1;
    while (keys[i].t < t) i++;
    const a = keys[i - 1], b = keys[i], d = b.t - a.t;
    const u = d > 0 ? (t - a.t) / d : 0;
    const va = get(a), vb = get(b);
    return Array.isArray(va) ? va.map((x, j) => x + (vb[j] - x) * u) : va + (vb - va) * u;
  }

  evaluate(t) {
    const c = Gradient._eval(this.colorKeys, t, (k) => k.c);
    return [c[0], c[1], c[2], Gradient._eval(this.alphaKeys, t, (k) => k.a)];
  }

  // key times the mesh is split at (DivideCheck); colour keys first, then alpha keys
  keyTimes() { return [...this.colorKeys.map((k) => k.t), ...this.alphaKeys.map((k) => k.t)]; }
};

// ------------------------------------------------------------------- AnimationCurve
// UnityEngine.AnimationCurve.Evaluate for non-weighted keys: cubic Hermite between neighbouring keys with the
// tangents scaled by the key interval; clamped to the end keys outside them.
// ENGINE: AnimationCurve.Evaluate is native; this is Unity's documented Hermite form.
// The pre/post wrap modes are not modelled (the fades only evaluate inside [0, 1)).
export const animCurve = (keys, t) => {
  const n = keys.length;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys[n - 1].time) return keys[n - 1].value;
  let i = 0;
  while (keys[i + 1].time < t) i++;
  const a = keys[i], b = keys[i + 1], dx = b.time - a.time, u = (t - a.time) / dx, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.value + (u3 - 2 * u2 + u) * a.outSlope * dx + (-2 * u3 + 3 * u2) * b.value +
         (u3 - u2) * b.inSlope * dx;
};
