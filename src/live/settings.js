import { F } from "../engine/core.js";

// Live settings: the game's options (App.Options.OptionItemType) that the chart player reproduces, their values,
// validation and the values the live derives from them.
//
// The game keeps options as strings in the current preset (OptionPresetData.Values) and reads them once when a live
// boots (LiveDataCreator.CreateBootData, LiveBootDataCreator.CreateViewData, LiveSettingCreator.CreateLiveNoteSettings /
// CreateSESettings); a fresh profile uses preset 1, whose values are MasterOptionDefault's preset-1 rows. Here a
// setting is a plain value keyed by the option's name, in the unit the option screen shows (float options as their
// value, e.g. NoteTiming 0.25; int options as integers; switches as booleans).
//
// Apply modes (see docs/fidelity.md):
//   boot    read by the live's boot: a change restarts the chart state with the new value and returns to the chart
//           time the session was at (the state a live started with that value has there)
//   live    the live category volumes (AppConfig.ApplyLive*Volume): global CRI category volumes the game's settings
//           panel changes at once, also for sounds that are playing
//   reload  selects other files (score, skins, effect sets, quality): the session is created again
//   none    read by the game, with no visible effect in an auto-played live (accepted, not applied)
//
// Defaults: the chart data's preset-1 values (livenotes settings.optionDefaults, livescene master
// .optionDefaultsPreset1). Items the data does not carry fall back to the MasterOptionDefault / MasterOptionRange rows,
// written below as `def` / `range` (the master's stored units).
//
// Live volumes (410-417): the game plays the live through the CRI categories Live*Config, whose volumes it keeps in
// the device's local sound config, not in the options. A fresh install writes AppConfigDefaultData there
// (AppConfig.OnFirstSetup -> ApplyDefaultAppConfigData; the chart data's `categories`), whatever the options say; the
// sound settings panel writes all four from the options when it saves (UISoundLiveVolumeSettingPanelPresenter
// .SaveOptions: mute ? 0 : clamp01(value / 100)). So the options show their preset-1 values (100 / 70 / 50 / 80), the
// categories keep the data's values while every live volume and mute is at its default (a profile whose sound
// settings were never saved), and once one differs all four categories take their option values.

// OptionItemType names, ids and screen groups (GameOptionMainType / GameOptionSubType; items in the order of the
// setting panels' serialized elements)
export const LIVE_OPTION_GROUPS = [
  { key: "basic", sections: ["basicNote", "basicLive"] },
  { key: "detail", sections: ["detailLane", "detailNote"] },
  { key: "display1", sections: ["display1Background", "display1Combo"] },
  { key: "display2", sections: ["display2Lane", "display2Note"] },
  { key: "sound", sections: ["soundLive", "soundNoteSe"] },
];

// type: float | int | bool | enum; def: MasterOptionDefault preset 1 (string); range: MasterOptionRange (stored units);
// hidden: not in the settings panel; notReproduced: enum values the player refuses, with the reason; mute: the mute
// item of a volume (the game's volume element holds both)
export const LIVE_OPTIONS = [
  { name: "NoteSpeed", id: 1, type: "float", section: "basicNote", apply: "boot", def: "5.00", range: [100, 1200] },
  { name: "NoteTiming", id: 2, type: "float", section: "basicNote", apply: "boot", def: "0.00", range: [-300, 300] },
  { name: "ChartPosition", id: 3, type: "float", section: "basicNote", apply: "boot", def: "0.00", range: [-300, 300] },
  { name: "MirrorChart", id: 4, type: "bool", section: "basicNote", apply: "reload", def: "FALSE" },
  { name: "LiveQuality", id: 6, type: "enum", section: "basicLive", apply: "reload", def: "1", values: [0, 1, 2] },
  // HapticFeedbackParameterCreator.Create: device vibration only
  { name: "Vibration", id: 7, type: "bool", section: "basicLive", apply: "none", def: "TRUE", hidden: true },
  // LiveSettingCreator.CreateJudgementViewSettings. The FAST / SLOW and ms lines follow the judgement's timing and
  // offset (UILiveNoteJudgeEffectView.ShowSubTiming); auto judgements have no timing and no offset
  // (UpdaterBase.UpdateJudgement), so nothing is shown at any value.
  { name: "FastSlowDisplay", id: 100, type: "bool", section: "detailLane", apply: "none", def: "FALSE", hidden: true },
  { name: "PerfectFastSlowDisplay", id: 101, type: "bool", section: "detailLane", apply: "none", def: "FALSE", hidden: true },
  { name: "JudgeOffsetMsDisplay", id: 102, type: "bool", section: "detailLane", apply: "none", def: "FALSE", hidden: true },
  // LiveJudgementView.ShowJudgement: 0 Center, 1 Lane (ShowJudgementLane), 2 None (IsShowJudgeResult false)
  { name: "JudgeResultPositionType", id: 103, type: "enum", section: "detailLane", apply: "boot", def: "0", values: [0, 1, 2],
    notReproduced: { 1: "the judgement shown at the note's lane is not reproduced" } },
  { name: "JudgePosition", id: 104, type: "int", section: "detailNote", apply: "boot", def: "0", range: [-5, 5] },
  { name: "SlideOpacity", id: 106, type: "int", section: "detailNote", apply: "boot", def: "60", range: [10, 100] },
  { name: "GuideOpacity", id: 107, type: "int", section: "detailNote", apply: "boot", def: "60", range: [10, 100] },
  { name: "SimultaneousLineDisplay", id: 108, type: "bool", section: "detailNote", apply: "boot", def: "TRUE" },
  { name: "MeasureLineDisplay", id: 109, type: "bool", section: "detailNote", apply: "boot", def: "FALSE" },
  { name: "BackgroundBrightness", id: 201, type: "int", section: "display1Background", apply: "boot", def: "70", range: [30, 100] },
  { name: "ComboCountDisplay", id: 206, type: "bool", section: "display1Combo", apply: "boot", def: "TRUE" },
  { name: "ContinuationEffectDisplay", id: 208, type: "bool", section: "display1Combo", apply: "boot", def: "TRUE" },
  { name: "LaneOpacity", id: 300, type: "int", section: "display2Lane", apply: "boot", def: "80", range: [0, 100] },
  { name: "GuidelineOpacity", id: 301, type: "int", section: "display2Lane", apply: "boot", def: "25", range: [0, 100] },
  // LiveLaneSplitCountType None, Lane4, Lane6, Lane8, Lane12
  { name: "GuidelineCount", id: 302, type: "enum", section: "display2Lane", apply: "boot", def: "2", values: [0, 1, 2, 3, 4] },
  { name: "NoteDesignId", id: 306, type: "enum", section: "display2Note", apply: "reload", def: "1" },
  { name: "NoteEffectId", id: 307, type: "enum", section: "display2Note", apply: "reload", def: "1" },
  { name: "LiveMusicVolume", id: 410, type: "int", section: "soundLive", apply: "live", def: "100", range: [0, 100], mute: "LiveMusicMute" },
  { name: "LiveMusicMute", id: 414, type: "bool", section: "soundLive", apply: "live", def: "FALSE" },
  { name: "LiveNoteSeVolume", id: 411, type: "int", section: "soundLive", apply: "live", def: "70", range: [0, 100], mute: "LiveNoteSeMute" },
  { name: "LiveNoteSeMute", id: 415, type: "bool", section: "soundLive", apply: "live", def: "FALSE" },
  { name: "LiveSeVolume", id: 412, type: "int", section: "soundLive", apply: "live", def: "50", range: [0, 100], mute: "LiveSeMute" },
  { name: "LiveSeMute", id: 416, type: "bool", section: "soundLive", apply: "live", def: "FALSE" },
  { name: "LiveVoiceVolume", id: 413, type: "int", section: "soundLive", apply: "live", def: "80", range: [0, 100], mute: "LiveVoiceMute" },
  { name: "LiveVoiceMute", id: 417, type: "bool", section: "soundLive", apply: "live", def: "FALSE" },
  { name: "NoteSePatternId", id: 420, type: "enum", section: "soundNoteSe", apply: "boot", def: "1" },
  { name: "UseIndividualNoteSe", id: 421, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
  { name: "TapSeId", id: 432, type: "enum", section: "soundNoteSe", apply: "boot", def: "1", individual: true },
  { name: "TapSeVolume", id: 433, type: "int", section: "soundNoteSe", apply: "boot", def: "100", range: [0, 100], mute: "TapSeMute" },
  { name: "TapSeMute", id: 461, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
  { name: "FlickSeId", id: 434, type: "enum", section: "soundNoteSe", apply: "boot", def: "1", individual: true },
  { name: "FlickSeVolume", id: 435, type: "int", section: "soundNoteSe", apply: "boot", def: "100", range: [0, 100], mute: "FlickSeMute" },
  { name: "FlickSeMute", id: 462, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
  { name: "SideFlickSeId", id: 436, type: "enum", section: "soundNoteSe", apply: "boot", def: "1", individual: true },
  { name: "SideFlickSeVolume", id: 437, type: "int", section: "soundNoteSe", apply: "boot", def: "100", range: [0, 100], mute: "SideFlickSeMute" },
  { name: "SideFlickSeMute", id: 463, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
  { name: "SlideSeId", id: 438, type: "enum", section: "soundNoteSe", apply: "boot", def: "1", individual: true },
  { name: "SlideSeVolume", id: 439, type: "int", section: "soundNoteSe", apply: "boot", def: "100", range: [0, 100], mute: "SlideSeMute" },
  { name: "SlideSeMute", id: 464, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
  { name: "TraceSeId", id: 440, type: "enum", section: "soundNoteSe", apply: "boot", def: "1", individual: true },
  { name: "TraceSeVolume", id: 441, type: "int", section: "soundNoteSe", apply: "boot", def: "100", range: [0, 100], mute: "TraceSeMute" },
  { name: "TraceSeMute", id: 465, type: "bool", section: "soundNoteSe", apply: "boot", def: "FALSE" },
];

// Options of the game this player does not reproduce (docs/fidelity.md): a setting other than the value the player
// shows is refused with the reason. Values: the preset-1 defaults, and for ScreenMode the LightWeight mode.
export const LIVE_OPTIONS_NOT_REPRODUCED = {
  AssistMode: ["FALSE", "the assist mode badge is not drawn"],
  FcAcChallengeAssist: ["0", "the full combo / all perfect challenge label is not drawn"],
  JudgePositionDisplay: ["FALSE", "the judgement line is not drawn"],
  FrameRate: ["0", "the player runs at 60 frames per second"],
  ScreenMode: ["3", "the player shows the LightWeight screen mode (3) only"],
  BackgroundSwitch: ["0", "the other LightWeight backgrounds show the deck's cards; the player has no deck"],
  JudgeDetailDisplay: ["FALSE", "the judgement counter is not drawn"],
  NoteStartPosition: ["0", "the lane mask is not drawn"],
  LiveSkinId: ["1", "the game has one lane skin"],
  LiveSkillActivationPositionDisplay: ["FALSE", "skill lines are not drawn"],
};

export const LIVE_OPTION_BY_NAME = new Map(LIVE_OPTIONS.map((o) => [o.name, o]));

// LiveNoteSeType (1..14) -> volume OptionItemType (SoundSettingsExtensions.ToOptionItemType's table) and the volume
// item -> mute item (OptionSoundUtility.GetMuteTypeForVolume)
const NOTE_SE_VOLUME_ITEM = [431, 433, 433, 433, 435, 437, 439, 433, 441, 439, 451, 453, 455, 457];
const NOTE_SE_MUTE_ITEM = { 431: 460, 433: 461, 435: 462, 437: 463, 439: 464, 441: 465, 451: 466, 453: 467, 455: 468,
                            457: 469, 459: 470 };
// LiveSettingCreator.BuildIndividualNoteSeDictionary: the SE id item of each note SE type (types without one, the
// Gekisou types 11..14 here, keep the pattern's sound)
const NOTE_SE_ID_ITEM = { 1: 430, 2: 432, 3: 432, 4: 432, 5: 434, 6: 436, 7: 438, 8: 432, 9: 440, 10: 438 };
const ITEM_NAME = new Map(LIVE_OPTIONS.map((o) => [o.id, o.name]));

// the four live category volumes: option, mute option, CRI config category (AppConfig.ApplyLive*Volume)
export const LIVE_CATEGORY_VOLUMES = [
  { volume: "LiveMusicVolume", mute: "LiveMusicMute", category: "LiveBgmConfig" },
  { volume: "LiveSeVolume", mute: "LiveSeMute", category: "LiveSeConfig" },
  { volume: "LiveVoiceVolume", mute: "LiveVoiceMute", category: "LiveVoiceConfig" },
  { volume: "LiveNoteSeVolume", mute: "LiveNoteSeMute", category: "LiveNotesSeConfig" },
];

export class LiveSettingsError extends RangeError {}

// ---------------------------------------------------------------------------------------------- game math
export const LiveSettingsMath = {
  // System.Math.Round(double): to nearest, ties to even
  roundEven(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  },
  clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

  // OptionRangeHelper.GetClampedNoteTimingOffsetMs: ClampMs(item, OptionValueAccessor.GetNoteTimingOffsetMs)
  // = clamp(Math.Round(value * 100f), range) (the product in float32)
  timingAdjustmentMs(v, range = [-300, 300]) {
    const M = LiveSettingsMath;
    return M.clamp(M.roundEven(F(F(v) * 100)), range[0], range[1]);
  },

  // OptionRangeHelper.GetClampedChartPositionOffsetMs: -ClampMs(item, -GetChartPositionOffsetMs), where
  // GetChartPositionOffsetMs = Math.Round(value * -100f); = -clamp(Math.Round(value * 100f), range)
  chartPositionMs(v, range = [-300, 300]) {
    const M = LiveSettingsMath, c = M.clamp(M.roundEven(F(F(v) * 100)), range[0], range[1]);
    return c === 0 ? 0 : -c;
  },

  // LiveBootDataCreator.CreateViewData: laneJudgementPosOffset = (JudgePosition + 5) / -10f + 1;
  // LiveGameView.FullInitialize: viewProgressOffset = MathUtility.EarlyFloatLerp(-0.05f, 0.05f, offset, true)
  // ((b - a) * clamp01(t) + a); 0 for JudgePosition 0
  viewProgressOffset(judgePosition) {
    const o = F(F(F(judgePosition + 5) / -10) + 1);
    const a = F(-0.05), b = F(0.05), t = o < 0 ? 0 : o > 1 ? 1 : o;
    return F(F(F(b - a) * t) + a);
  },

  // clamp01(value / 100f): OptionValueAccessor.GetLaneOpacity01 / GetGuidelineOpacity01 / GetBackgroundBrightness01,
  // OptionSoundVolumeProvider.GetNormalVolume, OptionSoundUtility.GetIndividualNoteSeVolume
  unit01(v) { const x = F(v / 100); return x < 0 ? 0 : x > 1 ? 1 : x; },
};

// ---------------------------------------------------------------------------------------------- data sources
const parseAs = (o, s) => {
  if (s === undefined || s === null) return undefined;
  if (o.type === "bool") return String(s).toUpperCase() === "TRUE";
  if (o.type === "float") return F(parseFloat(s));
  return Number.parseInt(s, 10);
};

// Resolved chart context: defaults, ranges and the values the chart's files offer.
//   live   live.json;  scene  livescene/scene.json;  notes  livenotes/notes.json;  audio  audio/live-audio.json
//   info   the chart manifest (quality, options)
export class LiveOptionContext {
  constructor({ live = null, scene = null, notes = null, audio = null, info = null } = {}) {
    this.live = live; this.scene = scene; this.notes = notes; this.audio = audio; this.info = info;
    const ns = (notes && notes.settings) || {};
    const sm = (scene && scene.master) || {};
    this._def = ns.optionDefaults || {};
    this._def1 = sm.optionDefaultsPreset1 || {};
    this._range = { ...(sm.optionRanges || {}), ...(ns.optionRanges || {}) };
    this.defaults = {};
    for (const o of LIVE_OPTIONS) this.defaults[o.name] = this._default(o);
  }

  _default(o) {
    if (o.name === "LiveQuality") {
      const q = this.info && Number.isInteger(this.info.quality) ? this.info.quality : undefined;
      if (q !== undefined) return q;
    }
    if (o.name === "NoteSePatternId" && this.audio && this.audio.noteSe && Number.isInteger(this.audio.noteSe.patternId))
      return this.audio.noteSe.patternId;
    const s = this._def[o.name] ?? (this._def1[o.name] && this._def1[o.name].value) ?? o.def;
    return parseAs(o, s);
  }

  // [min, max] in the option screen's unit (float options: MasterOptionRange / 100, OptionRangeHelper.TryGetRangeAsFloat)
  range(o) {
    const r = this._range[o.name] || o.range;
    if (!r) return null;
    return o.type === "float" ? [F(F(r[0]) / 100), F(F(r[1]) / 100)] : [r[0], r[1]];
  }

  // stored-unit range (ms for NoteTiming / ChartPosition)
  storedRange(o) { return this._range[o.name] || o.range || null; }

  // the values an enum / bool option can take with this chart's files; null: any value of the item's type and range
  values(o) {
    const ns = (this.notes && this.notes.settings) || {};
    const groups = this.audio && this.audio.noteSe && this.audio.noteSe.groups;
    const groupIds = groups ? Object.keys(groups).map(Number).sort((a, b) => a - b) : [this.defaults.NoteSePatternId];
    switch (o.name) {
      case "MirrorChart": return this.live && this.live.notesMirror ? [false, true] : [false];
      // bar lines: the view prefab of the scene's LiveBarLineViewContainer (notes.json prefabs.bar_line_view)
      case "MeasureLineDisplay": return this.notes && this.notes.prefabs && this.notes.prefabs.bar_line_view ? [false, true] : [false];
      case "LiveQuality": {
        const q = this.info && this.info.options && this.info.options.LiveQuality;
        return Array.isArray(q) && q.length ? q.slice() : [this.defaults.LiveQuality];
      }
      case "NoteDesignId": {
        // settings.skins: design id -> skin asset name; the records of the other skins: notes.json noteSkins
        const recs = (this.notes && this.notes.noteSkins) || null;
        const skins = ns.skins && recs ? Object.keys(ns.skins).map(Number).filter((id) => recs[ns.skins[id]]) : [];
        return [...new Set([this.defaults.NoteDesignId, ...skins])].sort((a, b) => a - b);
      }
      case "NoteEffectId": {
        const fx = ns.effects ? Object.keys(ns.effects).map(Number) : [];
        return [...new Set([this.defaults.NoteEffectId, ...fx])].sort((a, b) => a - b);
      }
      case "NoteSePatternId": return groupIds;
      case "UseIndividualNoteSe": return groupIds.length > 1 ? [false, true] : [false];
      default:
        if (o.individual) return groupIds;
        return o.values ? o.values.filter((v) => !(o.notReproduced && o.notReproduced[v])) : null;
    }
  }

  // an item the chart can change (more than one value available)
  offered(o) {
    if (!this.available(o)) return false;
    if (o.type === "bool" || o.type === "enum") {
      const v = this.values(o);
      return v === null || v.length > 1;
    }
    return true;
  }

  // Validated settings: the defaults with `user` applied. Unknown names, wrong types, values out of range and values
  // the chart does not offer raise LiveSettingsError.
  resolve(user = {}, base = null) {
    if (user === null || typeof user !== "object" || Array.isArray(user)) throw new LiveSettingsError("settings must be an object");
    const out = { ...(base || this.defaults) };
    for (const [name, v] of Object.entries(user)) {
      const o = LIVE_OPTION_BY_NAME.get(name);
      if (!o) {
        const nr = LIVE_OPTIONS_NOT_REPRODUCED[name];
        if (nr) {
          const d = parseAs({ type: /^(TRUE|FALSE)$/.test(nr[0]) ? "bool" : "int" }, nr[0]);
          if (v === d) continue;
          throw new LiveSettingsError(`${name}: not reproduced (${nr[1]}); only ${JSON.stringify(d)} is accepted`);
        }
        throw new LiveSettingsError(`unknown setting ${name}`);
      }
      out[name] = this.check(o, v);
    }
    return Object.freeze(out);
  }

  check(o, v) {
    const bad = (why) => { throw new LiveSettingsError(`${o.name}: ${why} (got ${JSON.stringify(v)})`); };
    if (o.type === "bool") {
      if (typeof v !== "boolean") bad("expected true or false");
    } else {
      if (typeof v !== "number" || !Number.isFinite(v)) bad("expected a number");
      if (o.type !== "float" && !Number.isInteger(v)) bad("expected an integer");
      if (o.type === "float") v = F(v);
      const r = this.range(o);
      if (r && (v < r[0] || v > r[1])) bad(`out of range ${r[0]}..${r[1]}`);
    }
    if (o.notReproduced && o.notReproduced[v]) bad(`not reproduced (${o.notReproduced[v]})`);
    if (v !== this.defaults[o.name] && !this.available(o)) bad("this chart's data has no volume for it");
    const vals = this.values(o);
    if (vals && !vals.includes(v)) bad(`this chart offers ${vals.map((x) => JSON.stringify(x)).join(", ")}`);
    return v;
  }

  // the live category volumes need the category in the chart's audio data (audio/live-audio.json categories)
  available(o) {
    const c = LIVE_CATEGORY_VOLUMES.find((x) => x.volume === o.name || x.mute === o.name);
    if (!c) return true;
    const cats = this.audio && this.audio.categories;
    return !!cats && typeof cats[c.category] === "number";
  }

  // the names whose values differ between two resolved settings
  static changed(a, b) { return LIVE_OPTIONS.map((o) => o.name).filter((n) => a[n] !== b[n]); }
}

// ---------------------------------------------------------------------------------------------- derived values
// The values the live's boot derives from the settings (ctx: LiveOptionContext, s: resolved settings).
export const liveDerived = (ctx, s) => {
  const M = LiveSettingsMath, o = (n) => LIVE_OPTION_BY_NAME.get(n);
  return {
    noteSpeed: s.NoteSpeed,
    timingAdjustmentMs: M.timingAdjustmentMs(s.NoteTiming, ctx.storedRange(o("NoteTiming"))),
    chartPositionMs: M.chartPositionMs(s.ChartPosition, ctx.storedRange(o("ChartPosition"))),
    viewProgressOffset: M.viewProgressOffset(s.JudgePosition),
  };
};

// Note SE maps of LiveSettingCreator.CreateSESettings from the settings, or null when every sound setting has its
// default (the chart data's maps are then used as they are). audio: live-audio.json.
//   types   LiveNoteSeType -> sound id (pattern: MasterLiveNoteSe rows of the group NoteSePatternId; individual:
//           BuildIndividualNoteSeDictionary; a type without a row has no entry)
//   volumes BuildNoteSeVolumeMap: GetIndividualNoteSeVolume = mute ? 0 : clamp01(volume / 100)
//   mutes   BuildNoteSeMuteMap: GetBool(mute item)
export const liveNoteSeMaps = (ctx, s) => {
  const names = LIVE_OPTIONS.filter((o) => o.section === "soundNoteSe").map((o) => o.name);
  if (names.every((n) => s[n] === ctx.defaults[n])) return null;
  const ns = (ctx.audio && ctx.audio.noteSe) || {};
  const groups = ns.groups || {};
  const val = (id) => {
    const n = ITEM_NAME.get(id);
    return n !== undefined ? s[n] : undefined;
  };
  const types = {}, volumes = {}, mutes = {};
  for (let t = 1; t <= 14; t++) {
    let group = s.NoteSePatternId;
    if (s.UseIndividualNoteSe && NOTE_SE_ID_ITEM[t] !== undefined) group = val(NOTE_SE_ID_ITEM[t]) ?? group;
    const table = groups[String(group)] || (group === ctx.defaults.NoteSePatternId ? ns.types : null);
    if (!table) throw new LiveSettingsError(`note SE group ${group} is not in this chart's data`);
    if (table[String(t)] !== undefined) types[t] = table[String(t)];
    const vi = NOTE_SE_VOLUME_ITEM[t - 1], mi = NOTE_SE_MUTE_ITEM[vi];
    const v = val(vi), m = val(mi);
    const dv = ns.volumes && ns.volumes[String(t)], dm = ns.mutes && ns.mutes[String(t)];
    // items the player does not offer (the empty-tap and Gekisou SE) keep the data's values
    mutes[t] = m !== undefined ? m : !!dm;
    volumes[t] = v !== undefined ? (mutes[t] ? 0 : LiveSettingsMath.unit01(v)) : (dv ?? 1);
  }
  return { types, volumes, mutes };
};

// The live category volumes of the settings, CRI category -> volume (see the header): the data's fresh-profile values
// while every live volume and mute is at its default, else for all four mute ? 0 : clamp01(v / 100) (the sound
// settings panel's SaveOptions with OptionSoundVolumeProvider.GetNormalVolume, applied by AppConfig.ApplyLive*Volume).
// Categories the data does not have are left out.
export const liveCategoryVolumes = (ctx, s) => {
  const out = {}, cats = (ctx.audio && ctx.audio.categories) || {};
  const saved = LIVE_CATEGORY_VOLUMES.some((c) => s[c.volume] !== ctx.defaults[c.volume] || s[c.mute] !== ctx.defaults[c.mute]);
  for (const c of LIVE_CATEGORY_VOLUMES) {
    if (typeof cats[c.category] !== "number") continue;
    out[c.category] = !saved ? cats[c.category] : s[c.mute] ? 0 : LiveSettingsMath.unit01(s[c.volume]);
  }
  return out;
};

// the options of a panel section that the chart offers, in panel order (a volume's mute item is part of the volume)
const MUTE_ITEMS = new Set(LIVE_OPTIONS.filter((o) => o.mute).map((o) => o.mute));
export const liveOptionsOf = (ctx, section) =>
  LIVE_OPTIONS.filter((o) => o.section === section && !o.hidden && !MUTE_ITEMS.has(o.name) && ctx.offered(o));

// The options with a chart: [{name, id, group, section, type, apply, default, value, range, values, offered, hidden,
// mute}] in panel order; range in the option screen's unit (float options: the stored range / 100), values: the
// values the chart offers (null: any value in the range), offered: more than one value available, mute: the mute
// item of a volume. s: resolved settings.
export const liveOptionItems = (ctx, s) => LIVE_OPTIONS.map((o) => ({
  name: o.name, id: o.id, group: LIVE_OPTION_GROUPS.find((g) => g.sections.includes(o.section)).key, section: o.section,
  type: o.type, apply: o.apply, default: ctx.defaults[o.name], value: s[o.name], range: ctx.range(o), values: ctx.values(o),
  offered: ctx.offered(o), hidden: !!o.hidden || MUTE_ITEMS.has(o.name), mute: o.mute || null,
}));

// The note effect set's asset name for NoteEffectId and LiveQuality, or null for the data's set (livenotes
// settings.effect). MasterLiveNoteEffectSkin._assetName; at LiveQuality Low NoteSkinLoadStep.CollectDownloadAddresses
// takes the set's Light variant (GetLightQualityAddress) when ResourceManager.ExistsAsset has it, else the set itself
// (here: when notes.json assets has the variant's LiveNoteEffectAssetSettings). The lane effects do not follow the
// set (LaneEffectLoadStep.GetAssetPath: always effect001).
export const liveNoteEffectName = (ctx, s) => {
  if (s.NoteEffectId === ctx.defaults.NoteEffectId && s.LiveQuality === ctx.defaults.LiveQuality) return null;
  const ns = (ctx.notes && ctx.notes.settings) || {};
  const base = (ns.effects && ns.effects[String(s.NoteEffectId)]) ||
    (s.NoteEffectId === ctx.defaults.NoteEffectId ? ns.effect : undefined);
  if (!base) throw new LiveSettingsError(`NoteEffectId ${s.NoteEffectId}: this chart's data has no effect set for it`);
  if (s.LiveQuality !== 2) return base;
  const assets = (ctx.notes && ctx.notes.assets) || {};
  return assets[`Effect/Live/NoteEffect/${base}Light/LiveNoteEffectAssetSettings`] ? `${base}Light` : base;
};

// the changed names grouped by how they apply: {none, live, noteSe, boot, reload} (boot: re-simulation needed or a
// constant of the views; see ChartSession.setSettings)
export const liveSettingsChanges = (a, b) => {
  const out = { none: [], live: [], noteSe: [], boot: [], reload: [] };
  for (const n of LiveOptionContext.changed(a, b)) {
    const o = LIVE_OPTION_BY_NAME.get(n);
    out[o.section === "soundNoteSe" ? "noteSe" : o.apply].push(n);
  }
  return out;
};
