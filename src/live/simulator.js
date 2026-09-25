import { F } from "../engine/core.js";
import { NoteGeo } from "./notegeo.js";

// LiveExecutor: the game's auto-play simulation (FTLiveSimulator + App LiveExecutor) that drives the chart player:
// note and line states, auto judgements, combo, and the per-frame result read by the note views, effects and UI.
// Default options: auto play at Perfect (LocalCacheData._autoJudgement 5, no diff override), note speed 5, input timing
// offset 0, no mirror, no skills.
// Input: score/<chart>.notes.json and livenotes/notes.json `settings` (see docs/data-format.md).
//
// One update() = one LiveExecutor.Update -> FTLiveSimulator.Update:
//   early out when t > lastTimingNote + 2000; all note updaters (notes.json order) step their state; line updaters;
//   JudgementNearPositionNote (auto judgements in update-list order); line UpdateJudgement (Enabled / Missed);
//   ComboParameter.UpdateFromCounter; App combo (LiveComboController).
// resetFrame() = LiveExecutor.ResetFrameResult (runs every Unity frame, also when the clock gate skips the
// update: the per-frame lists are then empty).
// No skill effect is simulated (the player has no deck).

export class LiveExecutor {
  constructor(score, settings) {
    const od = settings.optionDefaults, ls = settings.liveSettings;
    // NoteBeforePlayingTimeGetter (bpmRatio 1): D from NoteSpeed and MasterLiveSettings 3..6
    this.D = NoteGeo.displayOffsetMs(parseFloat(od.NoteSpeed), parseFloat(ls.note_speed_min), parseFloat(ls.note_speed_max),
                                        parseFloat(ls.note_speed_view_min), parseFloat(ls.note_speed_view_max));
    if (settings.noteDisplayTimeMs !== undefined && settings.noteDisplayTimeMs !== this.D)
      throw new Error(`display offset ${this.D} != exported ${settings.noteDisplayTimeMs}`);
    this.inp = 0;          // IInputTimingProvider.TimingAdjustmentMs: option item 2 "0.00"
    const MAX = 2147483647;
    this.MAX = MAX;
    const JT = { 1: 1, 20: 10, 21: 21, 60: 21, 61: 21, 63: 21, 104: 21, 105: 21, 120: 21, 22: 11, 40: 5, 41: 5, 42: 5,
                 102: 5, 62: 22, 80: 1, 82: 1, 100: 1, 101: 1, 103: 1, 121: 1, 122: 1, 0: 0 };   // ConvertJudgementType
    const JUDGEMENT_OP = (op) => ![0, 80, 82, 100, 103, 121, 122, 123].includes(op);        // IsJudgementNote
    this.isJudgementOp = JUDGEMENT_OP;
    this.notes = score.notes.map((n) => {
      if (!(n.op in JT)) throw new Error(`note ${n.id}: op ${n.op} not in the updater factory`);
      const jt = n.op === 1 && n.critical ? 2 : n.op === 20 && n.critical ? 15 : JT[n.op];
      return {
        id: n.id, note: n, t: n.timeMs, op: n.op, jt,
        auto: ![80, 82, 122, 121].includes(n.op),                  // IsAutoJudgementNote (HiddenUpdater / ComboSkipUpdater)
        lastJ: [80, 82, 122, 121, 100, 103].includes(n.op) ? 7 : 1,  // OnUpdatePlayingLast judgement (Pass / Miss)
        state: 0, progress: 0, offset: 0,                          // NoteSimulateResult..ctor
        res: { type: 0, origin: 0, judgement: 0, timing: 0, time: MAX, diff: MAX, convDiff: MAX },
      };
    });
    this.byId = new Map(this.notes.map((r) => [r.id, r]));
    // AfterMaxTimeMs of the note's timing parameter (MasterLiveJudgementTiming, assist 0: the last unit of each
    // NoteJudgementType). Only the Last test reads it; every value is < 237 ms = the jp >= 1.1 bound.
    this.afterMax = { 0: 130, 1: 130, 2: 130, 5: 130, 10: 130, 11: 150, 12: 130, 15: 130, 21: 130, 22: 130 };
    // MusicScore.LastTimingNotePosition: first note of the largest (float) Bar + BarProgress key
    let lastKey = -Infinity, lastT = 0;
    for (const n of score.notes) { const k = F(n.bar + F(n.barProgress)); if (k > lastKey) { lastKey = k; lastT = n.timeMs; } }
    this.lastTimingMs = lastT;
    this._buildLines(score);
    // ComboCounter / ComboParameter / App LiveComboController
    this.comboEntries = [];                      // {time, j, order, combo, max, ap, fc}
    this._addOrder = 0;
    this.appCombo = 0; this.appMax = 0; this.appAP = true; this.appFC = true;
    this._prevSimCombo = 0;
    const self = this;
    this.fr = {
      timeMs: 0, deltaTime: 0, displayOffsetMs: this.D,
      updateNoteIds: [], stateNoteIds: [], judgedNotes: [], updateLineIds: [],
      combo: 0, maxCombo: 0, simCombo: 0, isAllPerfect: true, isFullCombo: true,
      isUpdatedCombo: false, addCombo: 0, resetCombo: false, finishedAllNoteUpdate: false,
      noteState: (id) => self.byId.get(id).state,
      noteProgress: (id) => self.byId.get(id).progress,
      noteResult: (id) => self.byId.get(id),
      note: (id) => self.byId.get(id).note,
      lineState: (id) => self.lineById.get(id),
      line: (id) => self.lineById.get(id).line,
    };
    this._done = 0;
    this._inUpdate = new Set(); this._inState = new Set(); this._inLine = new Set();
  }

  // MusicScoreNoteLineCreator.CreateNoteLineDictionary + NoteLine.Setup
  _buildLines(score) {
    const BEGIN = [20, 41, 61, 80, 100, 101, 102, 104], END = [22, 42, 62, 82, 103, 105];
    const lines = new Map();
    for (const n of score.notes) {
      const all = BEGIN.includes(n.op) || END.includes(n.op) || n.op === 82;
      const ids = all ? n.lineIds : ([21, 63, 120, 121, 122].includes(n.op) ? n.lineIds.slice(0, 1) : []);
      for (const lid of ids) {
        if (!lines.has(lid)) lines.set(lid, { lineId: lid, view: [], all: [] });
        const L = lines.get(lid);
        if (!L.all.includes(n)) L.all.push(n);
        if (n.op !== 120 && n.op !== 121 && !L.view.includes(n)) L.view.push(n);
      }
    }
    const src = new Map(score.lines.map((l) => [l.lineId, l]));
    this.lines = [];
    for (const L of lines.values()) {
      const key = (n) => F(n.bar + F(n.barProgress));
      let s = L.all[0], e = L.all[0];
      for (const n of L.all) { if (n.timeMs < s.timeMs) s = n; if (n.timeMs > e.timeMs) e = n; }
      const view = L.view.map((n, i) => ({ n, i })).sort((a, b) => (key(a.n) - key(b.n)) || (a.i - b.i)).map((x) => x.n);
      const nodes = view.filter((n) => !n.slideAlong);
      const units = [];
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i];
        units.push({ start: a, end: b, startCenter: F(F(a.laneStartFloat + a.laneEndFloat) * 0.5),
                     endCenter: F(F(b.laneStartFloat + b.laneEndFloat) * 0.5), startWidth: F(a.width), endWidth: F(b.width) });
      }
      const startNote = view.find((n) => BEGIN.includes(n.op)), endNote = view.find((n) => END.includes(n.op));
      if (!startNote && !endNote) throw new Error(`line ${L.lineId}: no begin and no end`);
      const self = this;
      this.lines.push({
        lineId: L.lineId, line: src.get(L.lineId), tStart: s.timeMs, tEnd: e.timeMs, startNote, endNote, units,
        state: 0, enabled: false, missed: false,                  // NoteLineState..ctor
        noteIds: L.all.map((n) => n.id),
        isPressed(t) { return this.enabled && this.tStart < t; },  // NoteLineState.IsPressed
        get start() { return self.byId.get(startNote.id); },
      });
    }
    this.lineById = new Map(this.lines.map((l) => [l.lineId, l]));
  }

  // ---------------------------------------------------------------- frame-result list helpers (AddId: unique)
  // (each list keeps insertion order; the sets only answer "already added")
  _touch(r) { if (!this._inUpdate.has(r.id)) { this._inUpdate.add(r.id); this.fr.updateNoteIds.push(r.id); } }
  _stateTouch(r) { if (!this._inState.has(r.id)) { this._inState.add(r.id); this.fr.stateNoteIds.push(r.id); } }
  _lineTouch(L) { if (!this._inLine.has(L.lineId)) { this._inLine.add(L.lineId); this.fr.updateLineIds.push(L.lineId); } }
  // note state write; _done = number of notes in state Done (6), the OnUpdateNoteState done counter
  _assign(r, s) { if (r.state === 6) this._done--; if (s === 6) this._done++; r.state = s; }
  _setProgress(r, p) { this._touch(r); r.progress = p; }
  _setOffset(r, o) { if (r.offset !== o) { this._touch(r); r.offset = o; } }
  _setState(r, s) { if (r.state !== s) { this._assign(r, s); this._touch(r); this._stateTouch(r); } }

  // FTLiveSimulator.OnNoteJudgement: judged list, converters (identity), ComboCounter.AddJudgement
  _judged(r) {
    const fr = this.fr;
    if (!fr.judgedNotes.some((x) => x.id === r.id))
      fr.judgedNotes.push({ id: r.id, judgement: r.res.judgement, diffMs: r.res.convDiff, timing: r.res.timing,
                            judgementTimeMs: r.res.time, note: r.note });
    const j = r.res.judgement;
    this._comboAdd(r.t, j);
    if (j === 1 || j === 2) { fr.addCombo = 0; fr.resetCombo = true; }
  }

  // ComboCounter.AddJudgement + RecomputeStateFrom
  _comboAdd(time, j) {
    if (j === 0 || j === 7) return;
    const E = this.comboEntries, e = { time, j, order: this._addOrder++ };
    let k = E.length;
    while (k > 0 && (E[k - 1].time > time || (E[k - 1].time === time && E[k - 1].order > e.order))) k--;
    E.splice(k, 0, e);
    let prev = k > 0 ? E[k - 1] : { combo: 0, max: 0, ap: true, fc: true };
    for (let i = k; i < E.length; i++) {
      const x = E[i], bad = x.j === 1 || x.j === 2;
      x.combo = bad ? 0 : prev.combo + 1; x.max = Math.max(prev.max, x.combo);
      x.fc = prev.fc && !bad; x.ap = prev.ap && (x.j === 5 || x.j === 6);
      prev = x;
    }
  }
  _comboAt(t, strict) {           // FindLastIndexBefore (<) / FindLastIndexAtOrBefore (<=)
    const E = this.comboEntries;
    for (let i = E.length - 1; i >= 0; i--) if (strict ? E[i].time < t : E[i].time <= t) return E[i];
    return null;
  }

  // ---------------------------------------------------------------- per frame
  resetFrame() {                  // LiveSimulateFrameResult.ClearFrameParameter
    const fr = this.fr;
    fr.updateNoteIds.length = 0; fr.stateNoteIds.length = 0; fr.judgedNotes.length = 0; fr.updateLineIds.length = 0;
    this._inUpdate.clear(); this._inState.clear(); this._inLine.clear();
    fr.isUpdatedCombo = false; fr.addCombo = 0; fr.resetCombo = false;
    return fr;
  }

  update(tNow, dt) {
    const fr = this.resetFrame(), D = this.D, inp = this.inp;
    if (!Number.isInteger(tNow)) throw new Error(`chartMs must be an int (${tNow})`);
    fr.timeMs = tNow; fr.deltaTime = dt;
    if (this.lastTimingMs + 2000 < tNow) { this._appCombo(); return fr; }     // early out: no updater runs
    // 4a. note updaters (UpdaterBase.Update)
    for (const r of this.notes) {
      if (r.t < D + tNow) this._step(r, tNow);
      else if (r.state !== 0) this._setState(r, 0);
    }
    // 4b. line updaters (NoteLineUpdater.Update)
    for (const L of this.lines) this._lineStep(L, tNow);
    // 5. JudgementNearPositionNote (auto). The window tests cannot reject an auto candidate: it needs
    //    tNow >= tNote + inp (so tNote - tNow <= 0 <= before) and state 2..4 (so not Done); tJudge = tNote.
    const cand = [];
    for (const id of fr.updateNoteIds.slice()) {
      const r = this.byId.get(id);
      if (tNow < r.t + inp) continue;
      if (!r.auto || !(r.state === 2 || r.state === 3 || r.state === 4)) continue;
      cand.push(r);
    }
    if (cand.length > 24) throw new Error(`${cand.length} auto judgements in one frame (cache has 24 buckets)`);
    for (const r of cand) {         // UpdaterBase.UpdateJudgement: auto && !override
      const g = r.op === 100 || r.op === 103 ? 7 : 5;               // GuideBegin/End EditJudgementResultDerivation
      r.res = { type: r.jt, origin: g, judgement: g, timing: 0, time: r.t, diff: this.MAX, convDiff: this.MAX };
      this._setState(r, 6);
      this._judged(r);
    }
    // 6. NoteLineUpdater.UpdateJudgement (Enabled / Missed)
    for (const L of this.lines) {
      if (L.state !== 1) continue;
      let en = null, mi = null;
      if (tNow - 100 < L.tStart) {
        const j = L.start.res.judgement;
        if (j >= 3 && j <= 6) { en = true; mi = false; }
        else if (this._tryGetEnableLine(L)) { en = false; mi = true; }
      } else { en = true; mi = false; }                              // input.AutoInput slot 0 (IsAutoJudgement)
      if (en !== null) {
        if (L.enabled !== en) { L.enabled = en; this._lineTouch(L); }
        if (L.missed !== mi) { L.missed = mi; this._lineTouch(L); }
      }
    }
    // 7. combo (ComboParameter.UpdateFromCounter + FTLiveSimulator.Update tail)
    const c = this._comboAt(tNow, true), a = this._comboAt(tNow, false);
    const simCombo = c ? c.combo : 0;
    fr.simCombo = simCombo; fr.simMaxCombo = c ? c.max : 0;
    fr.isAllPerfect = a ? a.ap : true; fr.isFullCombo = a ? a.fc : true;
    const d = simCombo - this._prevSimCombo;
    this._prevSimCombo = simCombo;
    if (d >= 1) { fr.isUpdatedCombo = true; fr.addCombo += d; }
    fr.finishedAllNoteUpdate = this._done >= this.notes.length;
    this._appCombo();
    return fr;
  }

  // TryGetEnableLine, auto play: only branch (a) can hold (a line note judged Miss / Bad this frame)
  _tryGetEnableLine(L) {
    return this.fr.judgedNotes.some((x) => (x.judgement === 1 || x.judgement === 2) && L.noteIds.includes(x.id));
  }

  // LiveExecutor.UpdateCurrentFrameParameters: App combo (frame-result slot 19)
  _appCombo() {
    const fr = this.fr;
    if (fr.resetCombo) { this.appCombo = 0; this.appFC = false; }
    this.appCombo += fr.addCombo; this.appMax = Math.max(this.appMax, this.appCombo);
    if (!fr.isAllPerfect) this.appAP = false;
    fr.combo = this.appCombo; fr.maxCombo = this.appMax;
  }

  _step(r, tNow) {                  // UpdatePlayingNote -> OnUpdatePlaying*
    if (r.state === 6) return;      // Done: no transition
    const D = this.D, inp = this.inp, off = (tNow - r.t) - inp;
    const p = Math.max(0, F(F((tNow - r.t) + D) / F(D)));                 // GetProgress
    const jp = Math.max(0, F(F((tNow - (r.t + inp)) + D) / F(D)));        // GetJudgementProgress
    const last = () => this.afterMax[r.jt] < off && jp >= F(1.1);         // IsGreaterEqualLastTiming
    switch (r.state) {
      case 0:
        if (last()) { this._setState(r, 5); break; }
        this._setProgress(r, p); this._setOffset(r, off);
        this._setState(r, r.t + inp < tNow ? 4 : r.t + inp === tNow ? 3 : 1); break;
      case 1: this._setProgress(r, p); this._setOffset(r, off); this._setState(r, 2); break;
      case 2: this._setProgress(r, p); this._setOffset(r, off); if (jp >= 1) this._setState(r, 3); break;
      case 3: this._setProgress(r, p); this._setOffset(r, off); this._setState(r, 4); break;
      case 4: this._setProgress(r, p); this._setOffset(r, off); if (last()) this._setState(r, 5); break;
      case 5:                                                              // SetLastJudgement
        r.res = { type: r.jt, origin: r.lastJ, judgement: r.lastJ, timing: 5, time: tNow, diff: this.MAX, convDiff: this.MAX };
        this._touch(r); this._judged(r); this._setState(r, 6); break;
      default: break;
    }
  }

  _lineStep(L, tNow) {              // NoteLineUpdater.Update / UpdatePlayingLongLine
    if (L.state === 2) return;
    const setLineState = (v) => { L.state = v; this._lineTouch(L); };     // UpdateState (no change test)
    if (this.D + tNow > L.tStart) {
      if (L.tEnd < tNow) {
        setLineState(2);
        const s = L.start;
        if (!s) throw new Error(`line ${L.lineId} has no begin note`);
        if (s.res.judgement !== -1 && s.res.judgement !== 0) {            // UpdateStartNoteState(6)
          this._assign(s, 6); this._touch(s); this._stateTouch(s);
        } else {                                                           // ForceJudgement
          const j = this.isJudgementOp(s.op) ? 1 : 7;
          s.res = { type: 0, origin: j, judgement: j, timing: 6, time: tNow, diff: this.MAX, convDiff: this.MAX };
          this._assign(s, 6); this._touch(s); this._stateTouch(s); this._judged(s);
        }
      } else if (L.state === 1) this._lineTouch(L);
      else if (L.state === 0) setLineState(1);
    } else if (L.state !== 0) setLineState(0);
  }
};
