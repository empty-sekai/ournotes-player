import { F } from "../engine/core.js";

// CubismPhysicsController (execution order 800): the physics rig of the model (CubismPhysicsRig and its sub rigs),
// evaluated at the rig's Fps with interpolation between the fixed steps. Float32 in source order.
// ENGINE: Mathf.Sin / Cos / Atan2 / Sqrt use the device's libm; here double precision rounded to float32 (within one float ulp).

export class Live2DPhysics {
  constructor(rig, params) {
    this.params = params;
    this.fps = rig.Fps;
    this.gravity = { x: rig.Gravity.x, y: rig.Gravity.y };
    this.wind = { x: rig.Wind.x, y: rig.Wind.y };
    this.remain = 0;
    this.cache = new Float32Array(0);
    this.inputCache = new Float32Array(0);
    this.allow = true;
    // CubismPhysicsSubRig.Initialize
    this.subrigs = rig.SubRigs.map((s) => {
      const parts = s.Particles.map((p) => ({
        init: { x: p.InitialPosition.x, y: p.InitialPosition.y }, mobility: p.Mobility, delay: p.Delay,
        acc: p.Acceleration, radius: p.Radius, pos: { x: 0, y: 0 }, last: { x: 0, y: 0 },
        lastG: { x: 0, y: 0 }, force: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
      }));
      parts[0].init = { x: 0, y: 0 }; parts[0].last = { x: 0, y: 0 };
      parts[0].lastG = { x: this.gravity.x, y: F(-this.gravity.y) };
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        p.init = { x: parts[i - 1].init.x, y: F(p.radius + parts[i - 1].init.y) };
        p.pos = { ...p.init }; p.last = { ...p.init };
        p.lastG = { x: this.gravity.x, y: F(-this.gravity.y) };
      }
      const src = (id) => (params.index.has(id) ? params.idx(id) : -1);
      return {
        inputs: s.Input.map((x) => ({ src: src(x.SourceId), weight: x.Weight, comp: x.SourceComponent,
                                      inv: !!x.IsInverted })),
        outputs: s.Output.map((x) => ({ dst: src(x.DestinationId), pi: x.ParticleIndex, comp: x.SourceComponent,
                                        tScale: x.TranslationScale, aScale: x.AngleScale, weight: x.Weight,
                                        inv: !!x.IsInverted })),
        parts, norm: s.Normalization,
        cur: new Float32Array(s.Output.length), prev: new Float32Array(s.Output.length),
      };
    });
  }

  // CubismPhysicsMath.Normalize; clamps `arr[i]` in place
  static normalize(p, i, arr, nMin, nMax, nDef, inv) {
    const a = p.min[i], b = p.max[i];
    const maxV = (b === a || b > a) ? b : a, minV = (a <= b) ? a : b;
    let v = arr[i];
    const c = Math.max(minV, v <= maxV ? v : maxV);
    arr[i] = c; v = c;
    const mid = F(minV + F(F(maxV - minV) * 0.5));
    let r;
    if (F(v - mid) >= 0) {
      const d = F(maxV - mid);
      r = d === 0 ? 0 : F(F(F(F(Math.max(nMin, nMax) - nDef) / d) * F(v - mid)) + nDef);
    } else {
      const d = F(minV - mid);
      r = d === 0 ? 0 : F(F(F(F(Math.min(nMin, nMax) - nDef) / d) * F(v - mid)) + nDef);
    }
    return inv ? r : -r;
  }

  _inputs(s, arr) {
    const t = { x: 0, y: 0 };
    let a = 0;
    for (const inp of s.inputs) {
      if (inp.src < 0) continue;
      const w = F(inp.weight / 100);
      if (inp.comp === 2) {
        const n = s.norm.Angle;
        a = F(a + F(Live2DPhysics.normalize(this.params, inp.src, arr, n.Minimum, n.Maximum, n.Default, inp.inv) * w));
      } else {
        const n = s.norm.Position;
        const v = F(Live2DPhysics.normalize(this.params, inp.src, arr, n.Minimum, n.Maximum, n.Default, inp.inv) * w);
        if (inp.comp === 1) t.y = F(t.y + v); else t.x = F(t.x + v);
      }
    }
    const r = F(F(a / -180) * F(3.1415927)), c = F(Math.cos(r)), sn = F(Math.sin(r));
    const x = F(F(t.x * c) - F(t.y * sn));
    const y = F(F(t.y * c) + F(sn * x));                    // uses the new x, as the SDK does
    return { t: { x, y }, a };
  }

  static gravityDir(a) {
    const r = F(F(a / 180) * F(3.1415927));
    const sx = F(Math.sin(r)), cx = F(Math.cos(r));
    const len = F(Math.sqrt(F(F(sx * sx) + F(cx * cx))));
    return len > 1e-5 ? { x: F(sx / len), y: F(cx / len) } : { x: 0, y: 0 };
  }

  static wrap(r) {
    while (r < -3.1415927) r = F(r + F(6.2831855));
    while (r > 3.1415927) r = F(r + F(-6.2831855));
    return r;
  }

  // CubismPhysicsSubRig.UpdateParticles
  _particles(s, tr, ta, dt) {
    const P = s.parts;
    P[0].pos = { x: tr.x, y: tr.y };
    const g = Live2DPhysics.gravityDir(ta);
    const ga = F(Math.atan2(g.y, g.x));
    const thr = F(s.norm.Position.Maximum * F(0.001));
    for (let i = 1; i < P.length; i++) {
      const p = P[i], q = P[i - 1];
      p.force = { x: F(this.wind.x + F(g.x * p.acc)), y: F(this.wind.y + F(g.y * p.acc)) };
      p.last = { x: p.pos.x, y: p.pos.y };
      const rad = Live2DPhysics.wrap(F(ga - F(Math.atan2(p.lastG.y, p.lastG.x))));
      const delay = F(F(p.delay * dt) * 30);
      const dx = F(p.pos.x - q.pos.x), dy = F(p.pos.y - q.pos.y);
      const ang = F(rad / 5);                                // CubismPhysics.AirResistance
      const sn = F(Math.sin(ang)), c = F(Math.cos(ang));
      const nx = F(F(dx * c) - F(dy * sn));
      const ny = F(F(dy * c) + F(sn * nx));
      let px = F(F(F(q.pos.x + nx) + F(p.vel.x * delay)) + F(F(p.force.x * delay) * delay));
      let py = F(F(F(q.pos.y + ny) + F(p.vel.y * delay)) + F(F(p.force.y * delay) * delay));
      const ddx = F(px - q.pos.x), ddy = F(py - q.pos.y);
      const len = F(Math.sqrt(F(F(ddx * ddx) + F(ddy * ddy))));
      const ux = len > 1e-5 ? F(ddx / len) : 0, uy = len > 1e-5 ? F(ddy / len) : 0;
      px = F(q.pos.x + F(ux * p.radius)); py = F(q.pos.y + F(uy * p.radius));
      if (Math.abs(px) < thr) px = 0;
      p.pos = { x: px, y: py };
      if (delay !== 0)
        p.vel = { x: F(F(F(p.pos.x - p.last.x) / delay) * p.mobility), y: F(F(F(p.pos.y - p.last.y) / delay) * p.mobility) };
      p.lastG = { x: g.x, y: g.y };
    }
  }

  // CubismPhysicsOutput value getters (translation = P[pi] - P[pi - 1])
  _outputValue(s, o) {
    const P = s.parts, pi = o.pi;
    const tr = { x: F(P[pi].pos.x - P[pi - 1].pos.x), y: F(P[pi].pos.y - P[pi - 1].pos.y) };
    let v;
    if (o.comp === 0) v = tr.x;
    else if (o.comp === 1) v = tr.y;
    else {
      const parent = pi >= 2 ? { x: F(P[pi - 1].pos.x - P[pi - 2].pos.x), y: F(P[pi - 1].pos.y - P[pi - 2].pos.y) }
                             : { x: this.gravity.x, y: F(-this.gravity.y) };
      v = Live2DPhysics.wrap(F(F(Math.atan2(tr.y, tr.x)) - F(Math.atan2(parent.y, parent.x))));
    }
    return o.inv ? -v : v;
  }

  // CubismPhysicsSubRig.UpdateOutputParameterValue (into arr[i])
  _write(o, arr, i, t) {
    const p = this.params;
    const scale = o.comp === 2 ? o.aScale : (o.comp === 1 ? o.tScale.y : o.tScale.x);
    let v = F(scale * t);
    if (v < p.min[i]) v = p.min[i]; else if (v > p.max[i]) v = p.max[i];
    const w = F(o.weight / 100);
    if (w < 1) v = F(F(v * w) + F(F(1 - w) * arr[i]));
    arr[i] = v;
  }

  _resize() {
    const n = this.params.count;
    if (this.cache.length < n) { const c = new Float32Array(n); c.set(this.cache); this.cache = c; }
    if (this.inputCache.length < n) { const c = new Float32Array(n); c.set(this.inputCache); this.inputCache = c; }
  }

  // CubismPhysicsRig.Evaluate
  evaluate(dt) {
    if (!this.allow || dt <= 0) return;
    this.remain = F(this.remain + dt) <= 5 ? F(this.remain + dt) : 0;
    const pdt = this.fps > 0 ? F(1 / this.fps) : dt;
    this._resize();
    const vals = this.params.value;
    while (pdt <= this.remain) {
      const w = F(pdt / this.remain);
      for (let i = 0; i < this.params.count; i++) {
        const c = F(F(F(1 - w) * this.inputCache[i]) + F(w * vals[i]));
        this.cache[i] = c; this.inputCache[i] = c;
      }
      for (const s of this.subrigs) this._evaluateSub(s, pdt);
      this.remain = F(this.remain - pdt);
    }
    const a = F(this.remain / pdt);
    for (const s of this.subrigs)
      s.outputs.forEach((o, i) => {
        if (o.dst < 0) return;
        this._write(o, vals, o.dst, F(F(F(1 - a) * s.prev[i]) + F(s.cur[i] * a)));
      });
  }

  _evaluateSub(s, dt) {
    const { t, a } = this._inputs(s, this.cache);
    this._particles(s, t, a, dt);
    s.outputs.forEach((o, i) => {
      s.prev[i] = s.cur[i];
      if (o.dst < 0 || !(o.pi > 0 && o.pi < s.parts.length)) return;
      const v = this._outputValue(s, o);
      s.cur[i] = v;
      this._write(o, this.cache, o.dst, v);
    });
  }

  // CubismPhysicsRig.Stabilization / CubismPhysicsSubRig.Stabilization (at warmup)
  stabilize() {
    this._resize();
    const vals = this.params.value;
    this.cache.set(vals); this.inputCache.set(vals);
    for (const s of this.subrigs) {
      const { t, a } = this._inputs(s, vals);               // normalizes Source.Value in place
      for (const inp of s.inputs) if (inp.src >= 0) this.cache[inp.src] = vals[inp.src];
      const P = s.parts;
      P[0].pos = { x: t.x, y: t.y };
      const g = Live2DPhysics.gravityDir(a);
      const thr = F(s.norm.Position.Maximum * F(0.001));
      for (let i = 1; i < P.length; i++) {
        const p = P[i], q = P[i - 1];
        p.last = { x: p.pos.x, y: p.pos.y };
        p.force = { x: F(this.wind.x + F(g.x * p.acc)), y: F(this.wind.y + F(g.y * p.acc)) };
        p.vel = { x: 0, y: 0 };
        const len = F(Math.sqrt(F(F(p.force.x * p.force.x) + F(p.force.y * p.force.y))));
        const ux = len > 1e-5 ? F(p.force.x / len) : 0, uy = len > 1e-5 ? F(p.force.y / len) : 0;
        let px = F(q.pos.x + F(ux * p.radius));
        const py = F(q.pos.y + F(uy * p.radius));
        if (Math.abs(px) < thr) px = 0;
        p.pos = { x: px, y: py };
        p.lastG = { x: g.x, y: g.y };
      }
      s.outputs.forEach((o, i) => {
        if (o.dst < 0 || !(o.pi > 0 && o.pi < P.length)) return;
        const v = this._outputValue(s, o);
        s.cur[i] = v; s.prev[i] = v;
        this._write(o, vals, o.dst, v);
        this.cache[o.dst] = vals[o.dst];
      });
    }
  }
}
