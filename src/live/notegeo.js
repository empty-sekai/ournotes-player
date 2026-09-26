import { animCurve } from "../engine/anim.js";
import { F } from "../engine/core.js";

// Note-plane geometry of the live note highway (NoteGeo): display offset time, note progress, head placement,
// judgement-line positions and lane geometry, lane / width clamp, sprite-parts width layout of the heads, flick arrow
// sprite, order in layer, slide / guide body meshes, hold head and pair-line positions.
// Pure float32 math, no GL: unit tests load this module in Node.
// Every value the game computes in float is rounded with F (= Math.fround) in the game's operation order.
// powf is evaluated as fround(Math.pow(double)); a correctly rounded powf can differ by 1 ulp.

export class NoteGeo {
  // s = livenotes/notes.json `settings`; viewProgressOffset = LiveGameView.FullInitialize's view progress offset of
  // JudgePosition (settings.js LiveSettingsMath.viewProgressOffset; 0 at the default)
  constructor(s, viewProgressOffset = 0) {
    this.laneCount = s.laneCount;                                            // 24
    const W = F(F(s.laneSize[0]) / 100), H = F(F(s.laneSize[1]) / 100);     // CreateLaneViewSettings
    const top = F(s.laneTopRange), bot = F(s.laneBottomRange), tp = F(s.laneTopPosition);
    // LaneBaseVertices [0] left top, [1] right top, [2] left bottom, [3] right bottom
    this.lt = { x: F(F(W * top) * -0.5), y: F(F(H * 0.5) + tp) };
    this.rt = { x: F(F(W * top) * 0.5), y: this.lt.y };
    this.lb = { x: F(F(W * bot) * -0.5), y: F(H * -0.5) };
    this.rb = { x: F(F(W * bot) * 0.5), y: this.lb.y };
    this.spawn = NoteGeo.spawnPosition([this.lt, this.rt, this.lb, this.rb]);
    // JudgementPositionLogic.GetJudgementPositions (bottomPosition 2.24)
    const { lt, rt, lb, rb } = this, n = F(this.laneCount);
    const r = NoteGeo.clamp01(F(F(s.judgementScreenBottomPosition) / F(lt.y - lb.y)));
    const raw = [];
    for (let i = 0; i < this.laneCount; i++) {
      const f = NoteGeo.clamp01(F(F(i) / n));
      const by = F(lb.y + F(F(rb.y - lb.y) * f));
      const bx = F(F(F(F(F(rb.x - lb.x) / n) * 0.5) + lb.x) + F(F(rb.x - lb.x) * f));
      const tx = F(F(F(F(F(rt.x - lt.x) / n) * 0.5) + lt.x) + F(F(rt.x - lt.x) * f));
      const ty = F(lt.y + F(F(rt.y - lt.y) * f));
      raw.push({ x: F(bx + F(r * F(tx - bx))), y: F(by + F(F(ty - by) * r)) });
    }
    // LiveNoteViewJudgementRoot2D ctor: offsetProgress = EarlyFloatLerp(-0.05, 0.05, laneJudgementPosOffset)
    // = 0 for JudgePosition 0 (lambda: LerpUnclamped(spawn, P, offsetProgress + 1))
    const off = F(viewProgressOffset);
    const sp = this.spawn, lerpU = NoteGeo.lerpU2;
    this.J = raw.map((p) => lerpU(sp, p, F(off + 1)));
    // 12 extrapolated positions per side, k = 1..12 (ZLinq Range(1, 12)), factor k + 1
    this.exL = []; this.exR = [];
    for (let k = 1; k <= 12; k++) {
      this.exL.push(lerpU(this.J[1], this.J[0], F(k + 1)));
      this.exR.push(lerpU(this.J[this.laneCount - 2], this.J[this.laneCount - 1], F(k + 1)));
    }
    this.unit = F(Math.abs(F(this.J[0].x - this.J[1].x)));                   // _oneLaneUnitWidth
    this.laneMin = -0.5; this.laneMax = F(F(this.laneCount - 1) + 0.5);        // _laneMinPointX / _laneMaxPointX
    // LiveNoteLineViewBase.Initialize layout constants
    this.laneXMin = F(this.J[0].x + F(this.unit * -0.5));
    this.laneXMax = F(this.J[this.laneCount - 1].x + F(this.unit * 0.5));
    this.laneTopY = this.lt.y;                                                // LaneBaseVertices[0].y
    this.tiltCenter = s.tiltCenterLane ?? 11.5;
  }

  static clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  static lerpU2(a, b, t) { return { x: F(a.x + F(F(b.x - a.x) * t)), y: F(a.y + F(F(b.y - a.y) * t)) }; }

  // LiveViewUtility.GetNoteSpawnPosition (float32, side lines v0-v2 and v1-v3)
  static spawnPosition(v) {
    const s1 = F(F(v[2].y - v[0].y) / F(v[2].x - v[0].x));
    const s2 = F(F(v[3].y - v[1].y) / F(v[3].x - v[1].x));
    const c1 = F(v[0].y - F(v[0].x * s1));
    const x = F(F(F(v[1].y - F(v[1].x * s2)) - c1) / F(s1 - s2));
    return { x, y: F(c1 + F(s1 * x)) };
  }

  // NoteBeforePlayingTimeGetter.GetNoteDisplayOffsetTimeMs
  static displayOffsetMs(speed, smin, smax, vmin, vmax) {
    let t = F(F(Math.max(0, F(F(speed) - F(smin)))) / F(F(smax) - F(smin)));
    t = NoteGeo.clamp01(t);
    const e = NoteGeo.clamp01(F(1 - F(Math.pow(F(1 - t), F(1.31)))));
    return Math.trunc(F(F(F(vmin) + F(F(F(vmax) - F(vmin)) * e)) * 1000));
  }

  // UpdaterBase.GetProgress (ints; float division; not clamped above 1)
  static progress(tNow, tNote, D) { return Math.max(0, F(F((tNow - tNote) + D) / F(D))); }
  // LiveNoteLineViewUtility.CalculateUnitNoteProgress raw form (unclamped)
  static rawProgress(tNow, tNote, D) { return F(F((tNow - tNote) + D) / F(D)); }
  // LiveGameCurveUtility.ConvertNoteViewProgress
  static viewProgress(p) { return F(Math.pow(F(1.065), F(F(p - 1) * 45))); }

  // Math.Round(double), half to even
  static roundHalfEven(x) {
    const r = Math.round(x);
    return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
  }

  // LiveNoteViewBase.SetOrderInLayer: GetOrderInLayer(50) = 5000 .. GetOrderInLayer(55) = 5500
  static orderInLayer(v) { return NoteGeo.roundHalfEven(F(F(NoteGeo.clamp01(v) * 500) + 5000)); }

  // LiveNoteViewUtility.ClampLaneAndWidth
  static clampLaneAndWidth(c, w, lo, hi) {
    const l = F(c - F(w * 0.5)), r = F(c + F(w * 0.5));
    const dl = l < lo ? F(lo - l) : 0, dr = r > hi ? F(r - hi) : 0;
    return { center: F(F(c + F(dl * 0.5)) - F(dr * 0.5)), width: F(F(w - dl) - dr) };
  }

  // root2D.GetNoteJudgementPosition(int)
  jInt(i) {
    if (i < 0) return this.exL[~Math.max(i, -this.exL.length)];
    if (i < this.laneCount) return this.J[i];
    return this.exR[Math.min(i - this.laneCount, this.exR.length - 1)];
  }

  // root2D.GetNoteJudgementPosition(float): a = J[floor], b = J[ceil], x lerp, y from a
  jFloat(lane) {
    const fl = Math.floor(lane), a = this.jInt(fl), b = this.jInt(Math.ceil(lane));
    return { x: F(a.x + F(F(b.x - a.x) * F(lane - fl))), y: a.y };
  }

  // root2D.GetNoteJudgementPosition(int, int): Vector3.Lerp(J[l], J[r], 0.5)
  jPair(l, r) {
    const a = this.jInt(l), b = this.jInt(r);
    return { x: F(a.x + F(F(b.x - a.x) * 0.5)), y: F(a.y + F(F(b.y - a.y) * 0.5)) };
  }

  // LiveNoteViewBase.UpdateView: localPosition / localScale of a head at view progress v
  headPlacement(laneCenter, v) {
    const J = this.jFloat(laneCenter), s = this.spawn;
    return { x: F(s.x + F(F(J.x - s.x) * v)), y: F(s.y + F(F(J.y - s.y) * v)), scale: v };
  }

  // ---------------------------------------------------------------- heads
  // Sprite.bounds.size of a head part sprite, taken as rect / pixelsToUnits.
  // ENGINE: Sprite.bounds is native; these skin sprites use Tight meshes, the rect size is assumed (not the vertex box).
  static spriteSize(sp) {
    return { x: F(F(sp.rect.width) / F(sp.pixelsToUnits)), y: F(F(sp.rect.height) / F(sp.pixelsToUnits)) };
  }

  // LiveSpritePartsNoteViewBase.GetTiltValue
  static tiltValue(thresholds, dist) {
    for (const t of thresholds) if (dist <= t.Distance) return t.TiltValue;
    return thresholds[thresholds.length - 1].TiltValue;
  }

  // LiveSpritePartsNoteViewBase.OnSetViewWidth. unit = skin NoteSkinAssetUnit (sprites resolved).
  partsLayout(unit, laneCenter, width, viewWidth) {
    const G = NoteGeo, c0 = this.tiltCenter;
    const parts = new Map(unit._parts.map((p) => [p.TiltValue, p]));
    const l = F(laneCenter - F(width * 0.5)), r = F(laneCenter + F(width * 0.5));
    const pick = (d) => parts.get(G.tiltValue(unit._tiltThresholds, d)) || parts.get(0);
    const PL = pick(Math.abs(F(l - c0))), PR = pick(Math.abs(F(r - c0)));
    let L, oL, fL, R, oR, fR;
    if (l >= c0 || r <= c0) {
      if (laneCenter < c0) { L = PL.RightSprite; oL = PL.RightOverhang; fL = true; R = PR.LeftSprite; oR = PR.LeftOverhang; fR = true; }
      else { L = PL.LeftSprite; oL = PL.LeftOverhang; fL = false; R = PR.RightSprite; oR = PR.RightOverhang; fR = false; }
    } else { L = PL.RightSprite; oL = PL.RightOverhang; fL = true; R = PR.RightSprite; oR = PR.RightOverhang; fR = false; }
    oL = F(oL); oR = F(oR);
    const sL = G.spriteSize(L), sR = G.spriteSize(R), sM = G.spriteSize(unit._mainSprite);
    const wL = sL.x, wR = sR.x;
    return {
      left: { sprite: L, flipX: fL, size: sL, x: F(F(F(wL * 0.5) - F(viewWidth * 0.5)) - oL) },
      right: { sprite: R, flipX: fR, size: sR, x: F(oR + F(F(viewWidth * 0.5) - F(wR * 0.5))) },
      main: { sprite: unit._mainSprite, size: { x: F(F(F(F(oR + oL) + viewWidth) - wL) - wR), y: sM.y },
              x: F(F(F(oR - oL) * 0.5) + F(F(wL - wR) * 0.5)) },
    };
  }

  // LiveFlickNoteView.GetSprite / LiveDirectionFlickNoteView.GetSprite
  arrowSprite(unit, viewWidth) {
    const a = unit._arrowAssets, lanes = F(viewWidth / this.unit);
    for (const e of a) if (lanes < e._maxWidth) return e._sprite;
    return a[a.length - 1]._sprite;
  }

  // ---------------------------------------------------------------- bodies
  // LiveCalculator.GetNoteLineTypeEasing
  static ease(t, kind) {
    if (kind === 0) return t;
    if (kind === 1) return F(F(2 - t) * t);
    if (kind === 2) return F(t * t);
    throw new Error(`NoteLineEaseType ${kind}`);
  }

  // NoteLineCenterLineBuilder.ComputeLinePoint -> centre lane, width
  static linePoint(s, eL, eR, l0, l1, w0, w1) {
    const a = NoteGeo.ease(s, eL), b = NoteGeo.ease(s, eR);
    let left = F(l0 - F(w0 * 0.5)), right = F(F(w0 * 0.5) + l0);
    left = F(left + F(F(F(l1 - F(w1 * 0.5)) - left) * a));
    right = F(right + F(F(F(F(w1 * 0.5) + l1) - right) * b));
    return { lane: F(F(left + right) * 0.5), width: F(right - left) };
  }

  // LiveNoteLineViewBase.CalculateLodSplitCount
  static lodSplit(bp, ep, noteSpeed) {
    const f = NoteGeo.clamp01(F(F(F(noteSpeed) - 4) * 0.125));
    const d = F(F(0.6) - F(f * F(0.6)));
    let frac = 1;
    if (d > F(0.001)) frac = NoteGeo.clamp01(F(NoteGeo.viewProgress(Math.max(bp, ep)) / d));
    return NoteGeo.roundHalfEven(F(F(frac * 68) + 2));
  }

  // LiveNoteLineViewUtility.EstimateSegmentSplitCount
  static estimateSplit(n, diff) { return diff < 1 ? Math.max(2, Math.trunc(F(F(n) * diff))) : n; }

  // NoteLineCenterLineBuilder.BuildRow
  _row(lay, seg, s, p, splitIndex) {
    const u = seg.u, G = NoteGeo;
    const lp = G.linePoint(s, u.eL, u.eR, u.l0, u.l1, u.w0, u.w1);
    const w = lp.width;                                            // ConvertWidth: identity
    const v = G.viewProgress(p);
    const fl = Math.floor(lp.lane), a = this.jInt(fl), b = this.jInt(Math.ceil(lp.lane));
    const fr = G.clamp01(F(lp.lane - fl));
    const jx = F(a.x + F(F(b.x - a.x) * fr)), jy = F(a.y + F(F(b.y - a.y) * fr));
    const px = F(this.spawn.x + F(F(jx - this.spawn.x) * v));
    const py = F(this.spawn.y + F(F(jy - this.spawn.y) * v));
    const y = Math.min(py, this.laneTopY);
    const half = F(F(F(v * Math.max(F(w - lay.inset), 0)) * this.unit) * 0.5);
    const ft = F(F(seg.oneSplit * F(splitIndex)) + F(u.Tb));
    return { s, p, v, lane: lp.lane, lx: F(px - half), rx: F(px + half), y, fromTimeMs: Math.floor(ft) };
  }

  _edges(row) {
    return [F(row.lx - F(row.v * this.laneXMin)), F(row.lx - F(row.v * this.laneXMax)),
            F(row.rx - F(row.v * this.laneXMin)), F(row.rx - F(row.v * this.laneXMax))];
  }

  // NoteLineCenterLineBuilder.FindLaneEdgeCrossing (EvaluateEdgeCrossingValue)
  _crossing(lay, seg, lo, hi, useRight, bound) {
    const f = (q) => {
      const row = this._row(lay, seg, F(seg.vs + F(F(seg.ve - seg.vs) * q)), F(seg.cb + F(F(seg.ce - seg.cb) * q)),
                            F(F(seg.split) * q));
      return F((useRight ? row.rx : row.lx) - F(row.v * bound));
    };
    let f0 = f(lo);
    for (let i = 0; i < 16; i++) {
      const mid = F(F(hi + lo) * 0.5), fm = f(mid);
      if (F(f0 * fm) <= 0) hi = mid; else { lo = mid; f0 = fm; }
    }
    return F(F(hi + lo) * 0.5);
  }

  // NoteLineCenterLineBuilder.Build -> rows, bottom (begin side) first
  _build(lay, u, split) {
    const G = NoteGeo, bp = u.bp, ep = u.ep;
    let cb = bp >= 1 ? F(lay.fadeRange + 1) : bp;
    cb = Math.max(cb, 0);
    const ce = G.clamp01(ep);
    let vs = 0, ve = 1;                                            // CalculateSegmentVisibleRange
    if (Math.abs(F(ep - bp)) >= F(1e-6)) {
      vs = G.clamp01(F(F(cb - bp) / F(ep - bp))); ve = G.clamp01(F(F(ce - bp) / F(ep - bp)));
    }
    const seg = { u, cb, ce, vs, ve, split, oneSplit: F(F(u.Te - u.Tb) / F(split)) };
    const hasOne = ce < 1 && cb > 1;
    const cross = hasOne ? F(F(1 - cb) / F(ce - cb)) : -1;
    const out = [];
    let prev = null, oneDone = false, edgeIns = 0, s = vs, tPrev = 0;
    const span = F(ve - vs);
    for (let i = 0; i <= split; i++) {
      const t = F(F(i) / F(split));
      const row = this._row(lay, seg, s, F(cb + F(t * F(ce - cb))), F(i));
      const pending = [];
      if (hasOne && !oneDone && cross < t) { pending.push({ q: cross, one: true }); oneDone = true; }
      const cur = this._edges(row);
      if (prev && edgeIns < 4) {
        for (let k = 0; k < 4; k++) {
          if (F(prev[k] * cur[k]) < 0 && pending.length <= 4)            // AddPendingInsert: max 5
            pending.push({ q: this._crossing(lay, seg, tPrev, t, k > 1, (k & 1) ? this.laneXMax : this.laneXMin), one: false });
        }
      }
      // SortPendingInserts: stable insertion sort by parameter
      for (let a = 1; a < pending.length; a++) {
        const e = pending[a]; let b = a - 1;
        while (b >= 0 && pending[b].q > e.q) { pending[b + 1] = pending[b]; b--; }
        pending[b + 1] = e;
      }
      for (const e of pending) {
        if (e.one || edgeIns < 4) {
          out.push(this._row(lay, seg, F(vs + F(e.q * F(ve - vs))), e.one ? 1 : F(cb + F(e.q * F(ce - cb))), F(e.q * F(split))));
          if (!e.one) edgeIns++;
        }
      }
      out.push(row);
      prev = cur;
      s = Math.min(F(F(span / F(split)) + s), ve);
      tPrev = t;
    }
    return out;
  }

  // NoteLineTrapezoidCalculator.Calculate
  _trapezoid(S, E, g) {
    const gE = Math.min(F(F(E.v * 0.5) * g), F(F(E.rx - E.lx) * 0.5));
    const gS = Math.min(F(F(S.v * 0.5) * g), F(F(S.rx - S.lx) * 0.5));
    const mnE = F(E.v * this.laneXMin), mxE = F(E.v * this.laneXMax);
    const mnS = F(S.v * this.laneXMin), mxS = F(S.v * this.laneXMax);
    const cl = (x, lo, hi) => (x >= lo ? Math.min(x, hi) : lo);
    const srt = (a, b) => (a <= b ? [a, b] : [b, a]);
    const eL = srt(cl(E.lx, mnE, mxE), cl(F(E.lx + gE), mnE, mxE)), eR = srt(cl(F(E.rx - gE), mnE, mxE), cl(E.rx, mnE, mxE));
    const sL = srt(cl(S.lx, mnS, mxS), cl(F(S.lx + gS), mnS, mxS)), sR = srt(cl(F(S.rx - gS), mnS, mxS), cl(S.rx, mnS, mxS));
    const border = (actual, intended, o0, o1) => {     // LerpBorderUv
      if (intended < F(1e-6)) return [0.5, 0.5];
      const k = NoteGeo.clamp01(F(actual / intended));
      return [F(F(F(o0 - 0.5) * k) + 0.5), F(F(F(o1 - 0.5) * k) + 0.5)];
    };
    return {
      // [left band, right band]: {tl, tr, bl, br} x values; top y = E.y, bottom y = S.y
      x: [{ tl: eL[0], tr: eL[1], bl: sL[0], br: sL[1] }, { tl: eR[0], tr: eR[1], bl: sR[0], br: sR[1] }],
      uvTop: [border(F(eL[1] - eL[0]), gE, 0, 0.125), border(F(eR[1] - eR[0]), gE, 0.875, 1)],
      uvBot: [border(F(sL[1] - sL[0]), gS, 0, 0.125), border(F(sR[1] - sR[0]), gS, 0.875, 1)],
    };
  }

  // One body (LiveNoteLineViewBase.UpdateView -> SetupAllMesh -> SetupMesh / UpdateVertex).
  //   line: { kind: "slide"|"guide", units: [{Tb, Te, l0, l1, w0, w1, eL, eR}], widthScale, glowScale,
  //           slideAlpha, fadeRange, guideCurve? (AnimationCurve keys, animCurve), fadeBeforeEndMs? }
  //   t: simulate time (ms), D: display offset, noteSpeed: option value; bp/ep per unit (CalculateUnitNoteProgress)
  // Returns vertex streams (8 vertices per row pair) and the rows (for checks).
  bodyMesh(line, t, D, noteSpeed, bpep) {
    const G = NoteGeo, units = line.units;
    let minW = Infinity;                                          // ApplyNoteLine
    for (const u of units) minW = Math.min(minW, u.w0, u.w1);
    const lay = { inset: Math.min(F(F(1 - line.widthScale) * 6), F(minW * 0.5)), fadeRange: line.fadeRange };
    const lineBegin = units[0].Tb, lineEnd = units[units.length - 1].Te;
    const inv = lineEnd - lineBegin < 1 ? 0 : F(1 / F(lineEnd - lineBegin));
    const guide = line.kind === "guide";
    // SetStatusValue; evaluated in double, the game's float cos may differ in the last ulp
    const frag = guide ? [1, 0.5] : [F(0.5 - Math.cos(4 * Math.PI * (t - lineBegin) / 1000) * 0.5), F(0.8333334)];
    const fade = (p) => (p > 1 && line.fadeRange > 0                // CalculateFadeInAlpha
      ? F(F(1 - G.clamp01(F(F(p - 1) / line.fadeRange))) * line.slideAlpha) : line.slideAlpha);
    const modA = (ft) => (!guide || lineEnd - ft >= line.fadeBeforeEndMs ? 1   // ModifyAlpha
      : F(animCurve(line.guideCurve, F(1 - F(F(lineEnd - ft) / F(line.fadeBeforeEndMs))))));
    const pos = [], col = [], uv1 = [], uv2 = [], uv3 = [], uv4 = [], rowsAll = [];
    for (let ui = 0; ui < units.length; ui++) {
      const u = { ...units[ui], bp: bpep[ui].bp, ep: bpep[ui].ep };
      if (!(u.ep <= u.bp)) continue;
      const diff = F(Math.min(u.bp, 1) - G.clamp01(u.ep));      // CalculateSegmentScreenProgressSpan
      if (!(diff > 0)) continue;
      let n = G.estimateSplit(G.lodSplit(u.bp, u.ep, noteSpeed), diff);
      n = Math.max(2, G.roundHalfEven(F(1 * F(n))));             // poolScale 1 (ExpandVertexPool)
      const rows = this._build(lay, u, n);
      rowsAll.push(rows);
      if (rows.length < 2) continue;
      for (let r = 0; r + 1 < rows.length; r++) {
        const S = rows[r], E = rows[r + 1], tr = this._trapezoid(S, E, line.glowScale);
        const aS = F(fade(S.p) * modA(S.fromTimeMs)), aE = F(fade(E.p) * modA(E.fromTimeMs));
        const rS = F(inv * F(S.fromTimeMs - lineBegin)), rE = F(inv * F(E.fromTimeMs - lineBegin));
        for (let k = 0; k < 2; k++) {
          const X = tr.x[k], ut = tr.uvTop[k], ub = tr.uvBot[k];
          const gIn = k === 0 ? 1 : 0, gOut = k === 0 ? 0 : 1;    // g = 1 on the outer edge of each band
          const vtx = [[X.bl, S.y, rS, gIn, aS, X.bl, X.br, ub], [X.tl, E.y, rE, gIn, aE, X.tl, X.tr, ut],
                       [X.br, S.y, rS, gOut, aS, X.bl, X.br, ub], [X.tr, E.y, rE, gOut, aE, X.tl, X.tr, ut]];
          for (const [x, y, rr, g, a, x0, x1, uo] of vtx) {
            pos.push(x, y, 0); col.push(rr, g, 0, a);
            uv1.push(x0, 0); uv2.push(x1, 0); uv3.push(uo[0], frag[0]); uv4.push(uo[1], frag[1]);
          }
        }
      }
    }
    const q = pos.length / 24, idx = new Uint32Array(q * 18), uv0 = new Float32Array(q * 16);
    for (let b = 0, o = 0; b < q * 8; b += 8) {                    // InitializeVertexArray
      for (const d of [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6]) idx[o++] = b + d;
      for (let j = 0; j < 8; j++) uv0[(b + j) * 2 + 1] = j & 1;
    }
    return { quads: q, position: Float32Array.from(pos), color: Float32Array.from(col), uv0,
             uv1: Float32Array.from(uv1), uv2: Float32Array.from(uv2), uv3: Float32Array.from(uv3),
             uv4: Float32Array.from(uv4), indices: idx, rows: rowsAll };
  }

  // Hold head at the judgement line: lane / width along the last unit with bp >= 1 && ep <= 1
  holdHead(units, bpep, t) {
    const G = NoteGeo;
    let sel = -1;
    for (let i = 0; i < units.length; i++) if (bpep[i].bp >= 1 && bpep[i].ep <= 1) sel = i;
    if (sel < 0) return null;
    const u = units[sel], span = u.Te - u.Tb;
    const c = span === 0 ? 1 : F(F(t - u.Tb) / F(span));           // CalculateConnectUnitProgress
    const e = G.clamp01(G.ease(c, u.eL));                            // EarlyFloatLerp(isClamp = true)
    const lane = F(u.l0 + F(F(u.l1 - u.l0) * e)), width = F(u.w0 + F(F(u.w1 - u.w0) * e));
    return { unit: sel, ...G.clampLaneAndWidth(lane, width, this.laneMin, this.laneMax) };
  }
};
