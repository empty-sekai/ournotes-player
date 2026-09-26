// The game's Live options in the player (src/live/settings.js) and where they reach the simulation, note geometry,
// live UI, sound and session: option math (float32, banker's rounding), defaults and validation over synthetic chart
// data, the derived values at the defaults (equal to the fixed values the player used before the options), the
// executor's display offset / timing offset / Miss window, the judgement view's None mode, the note SE maps and the
// live category volumes, the session's routing of a change and its chart clock with a chart position offset, and the
// controls' string tables. Synthetic data only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { LIVE_LANE_EFFECT_SET, LiveLaneEffects } from "../../src/live/fx-effects.js";
import { LiveJudgementViewCenter } from "../../src/live/fx-ui.js";
import { NoteGeo } from "../../src/live/notegeo.js";
import { ArrowGradient, LiveBarLines, LiveNotes, NoteHeadView, musicScorePosition } from "../../src/live/noteview.js";
import { Prefab } from "../../src/engine/prefab.js";
import { ChartSession } from "../../src/live/session.js";
import { LIVE_OPTIONS, LIVE_OPTION_GROUPS, LiveOptionContext, LiveSettingsError, LiveSettingsMath, liveCategoryVolumes,
         liveDerived, liveNoteEffectName, liveNoteSeMaps, liveOptionItems, liveOptionsOf, liveSettingsChanges }
  from "../../src/live/settings.js";
import { LiveExecutor } from "../../src/live/simulator.js";
import { LiveAudio, LiveGameClock, LiveSoundPlayer } from "../../src/live/sound.js";
import { ChartControls, NOTE_SPEED_STEPS, noteSpeedStep, parseOptionInput } from "../../src/player/controls.js";
import { PLAYER_STRINGS, formatString, playerLanguage, playerStrings } from "../../src/player/strings.js";

const M = LiveSettingsMath;

// ---- synthetic chart data (the keys the options read)
const LIVE_SETTINGS = { note_speed_min: "1", note_speed_max: "12", note_speed_view_min: "4", note_speed_view_max: "0.35" };
const D5 = NoteGeo.displayOffsetMs(5, 1, 12, 4, 0.35);
const notesJson = (extra = {}) => ({
  settings: { optionDefaults: { NoteSpeed: "5.00", NoteTiming: "0.00", SlideOpacity: "60", GuideOpacity: "60",
                                SimultaneousLineDisplay: "TRUE", MeasureLineDisplay: "FALSE",
                                LiveSkillActivationPositionDisplay: "FALSE" },
              optionRanges: { NoteSpeed: [100, 1200], SlideOpacity: [10, 100], GuideOpacity: [10, 100] },
              liveSettings: LIVE_SETTINGS, noteDisplayTimeMs: D5, effect: "effect001", ...extra },
});
const sceneJson = () => ({ master: { optionDefaultsPreset1: {
  JudgePosition: { value: "0" }, BackgroundBrightness: { value: "70" }, LaneOpacity: { value: "80" },
  GuidelineOpacity: { value: "25" }, GuidelineCount: { value: "2" }, JudgePositionDisplay: { value: "FALSE" } } } });
const audioJson = (extra = {}) => ({
  // the fresh-profile values of the game's local sound config (AppConfigDefaultData: 1 each)
  categories: { LiveBgm: 1, LiveBgmConfig: 1, LiveSe: 1, LiveSeConfig: 1, LiveVoiceConfig: 1, LiveNotesSeConfig: 1 },
  noteSe: { patternId: 1, types: { 2: 102, 3: 103, 4: 104, 5: 105, 6: 106, 7: 107, 8: 108, 9: 109, 10: 110 },
            volumes: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 1, 1])),
            mutes: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 1, false])), ...extra },
});
const context = (o = {}) => new LiveOptionContext({ live: o.live || {}, scene: sceneJson(), notes: o.notes || notesJson(),
                                                    audio: o.audio || audioJson(), info: o.info || { quality: 1 } });

test("option math: note timing and chart position in ms (float32 product, banker's rounding, clamp)", () => {
  assert.equal(M.roundEven(2.5), 2); assert.equal(M.roundEven(3.5), 4); assert.equal(M.roundEven(-2.5), -2);
  assert.equal(M.timingAdjustmentMs(0), 0);
  assert.equal(M.timingAdjustmentMs(0.29), 29);
  assert.equal(M.timingAdjustmentMs(-3.5), -300);
  assert.equal(M.timingAdjustmentMs(2.994999), 299);
  assert.equal(M.timingAdjustmentMs(0.125), 12);                // F(12.5) -> ties to even
  assert.equal(M.chartPositionMs(1), -100);
  assert.equal(M.chartPositionMs(-3.01), 300);
  assert.ok(Object.is(M.chartPositionMs(0), 0));
  assert.equal(M.viewProgressOffset(0), 0);                     // exactly 0 at the default
  assert.equal(M.viewProgressOffset(-5), F(0.05));
  assert.equal(M.viewProgressOffset(5), F(-0.05));
  assert.equal(M.unit01(80), F(0.8)); assert.equal(M.unit01(150), 1);
});

test("defaults come from the chart data; the derived values at the defaults are the player's former constants", () => {
  const ctx = context(), s = ctx.resolve({});
  assert.equal(s.NoteSpeed, 5); assert.equal(s.NoteTiming, 0); assert.equal(s.ChartPosition, 0);
  assert.equal(s.LaneOpacity, 80); assert.equal(s.GuidelineCount, 2); assert.equal(s.BackgroundBrightness, 70);
  assert.equal(s.SimultaneousLineDisplay, true); assert.equal(s.LiveQuality, 1);
  // live volumes: the option defaults (MasterOptionDefault preset 1); the categories keep the data's fresh-profile
  // values while all of them are at their defaults
  assert.equal(s.LiveMusicVolume, 100); assert.equal(s.LiveSeVolume, 50); assert.equal(s.LiveVoiceVolume, 80);
  assert.equal(s.LiveNoteSeVolume, 70);
  assert.deepEqual(liveDerived(ctx, s), { noteSpeed: 5, timingAdjustmentMs: 0, chartPositionMs: 0, viewProgressOffset: 0 });
  assert.equal(liveNoteSeMaps(ctx, s), null);
  assert.deepEqual(liveCategoryVolumes(ctx, s), { LiveBgmConfig: 1, LiveSeConfig: 1, LiveVoiceConfig: 1, LiveNotesSeConfig: 1 });
  assert.equal(liveNoteEffectName(ctx, s), null);
  assert.ok(Object.isFrozen(s));
});

test("validation: names, types, ranges, the values the chart offers, options not reproduced", () => {
  const ctx = context();
  const bad = (v, re) => assert.throws(() => ctx.resolve(v), (e) => e instanceof LiveSettingsError && re.test(e.message));
  bad({ Nope: 1 }, /unknown setting Nope/);
  bad({ NoteSpeed: "8" }, /expected a number/);
  bad({ LaneOpacity: 50.5 }, /expected an integer/);
  bad({ NoteSpeed: 12.5 }, /out of range 1\.\.12/);
  bad({ SimultaneousLineDisplay: 1 }, /expected true or false/);
  bad({ MirrorChart: true }, /this chart offers false/);           // no mirrored score in the data
  bad({ NoteDesignId: 2 }, /this chart offers 1/);
  bad({ JudgeResultPositionType: 1 }, /not reproduced/);
  bad({ AssistMode: true }, /not reproduced/);
  bad([], /must be an object/);
  // accepted: a not-reproduced option at its default, options without an effect in auto play
  const s = ctx.resolve({ AssistMode: false, FastSlowDisplay: true, NoteSpeed: 8.25, JudgeResultPositionType: 2 });
  assert.equal(s.NoteSpeed, 8.25); assert.equal(s.FastSlowDisplay, true); assert.equal(s.JudgeResultPositionType, 2);
  assert.equal(s.NoteSpeed, F(8.25));
  // floats are float32
  assert.equal(ctx.resolve({ NoteTiming: 0.1 }).NoteTiming, F(0.1));
  // offered with the data: a mirrored score, skins, effect sets, note SE groups
  const rich = context({ live: { notesMirror: "score/x.mirror.notes.json" },
                         notes: notesJson({ skins: { 1: "skin001", 2: "skin002" }, effects: { 1: "effect001", 2: "effect001Simple" } }),
                         audio: audioJson({ groups: { 1: { 2: 102 }, 2: { 2: 202 } } }) });
  // a skin id offered only with its record
  assert.throws(() => rich.resolve({ NoteDesignId: 2 }), /offers 1/);
  const r = rich.resolve({ MirrorChart: true, NoteEffectId: 2, NoteSePatternId: 2, UseIndividualNoteSe: true });
  assert.equal(r.MirrorChart, true);
  assert.equal(liveNoteEffectName(rich, r), "effect001Simple");
  // LiveQuality Low: the Light variant only where the data has it (ExistsAsset), else the set itself
  assert.equal(liveNoteEffectName(rich, { ...r, LiveQuality: 2 }), "effect001Simple");
  rich.notes.assets = { "Effect/Live/NoteEffect/effect001Light/LiveNoteEffectAssetSettings": {} };
  assert.equal(liveNoteEffectName(rich, { ...r, LiveQuality: 2 }), "effect001Simple");
  assert.equal(liveNoteEffectName(rich, { ...r, NoteEffectId: 1, LiveQuality: 2 }), "effect001Light");
  rich.notes.assets["Effect/Live/NoteEffect/effect001SimpleLight/LiveNoteEffectAssetSettings"] = {};
  assert.equal(liveNoteEffectName(rich, { ...r, LiveQuality: 2 }), "effect001SimpleLight");
  // without an effects table: the default set by the data's name
  const plain = context({ info: { quality: 1, options: { LiveQuality: [1, 2] } },
                          notes: { ...notesJson(), assets: { "Effect/Live/NoteEffect/effect001Light/LiveNoteEffectAssetSettings": {} } } });
  assert.equal(liveNoteEffectName(plain, plain.resolve({ LiveQuality: 2 })), "effect001Light");
});

test("note designs: offered with their records in notes.json noteSkins (top level)", () => {
  const skins = { 1: "skin001", 2: "skin002", 3: "skin003" };
  const top = context({ notes: { ...notesJson({ skins }), noteSkins: { skin002: {}, skin003: {} } } });
  assert.deepEqual(top.values(LIVE_OPTIONS.find((o) => o.name === "NoteDesignId")), [1, 2, 3]);
  assert.equal(top.resolve({ NoteDesignId: 3 }).NoteDesignId, 3);
  // records under settings are not the data format's place
  const misplaced = context({ notes: notesJson({ skins, noteSkins: { skin002: {} } }) });
  assert.deepEqual(misplaced.values(LIVE_OPTIONS.find((o) => o.name === "NoteDesignId")), [1]);
});

test("lane effects: always the effect001 set (LaneEffectLoadStep.GetAssetPath), whatever the note effect set", () => {
  assert.equal(LIVE_LANE_EFFECT_SET, "effect001");
  const notes = { settings: { effect: "effect001Simple" },
                  assets: { "Effect/Live/LaneEffect/effect001/LiveLaneEffectAssetSettings": {} } };
  const lane = new LiveLaneEffects(null, { notes, score: { laneCount: 24, notes: [] },
                                           sceneInfo: { laneWidth: 19.12, laneContainers: [] }, effect: "effect001SimpleLight" });
  assert.equal(lane.views.size, 0);
  delete notes.assets["Effect/Live/LaneEffect/effect001/LiveLaneEffectAssetSettings"];
  assert.throws(() => new LiveLaneEffects(null, { notes, score: { laneCount: 24, notes: [] },
                                                  sceneInfo: { laneWidth: 19.12, laneContainers: [] } }),
                /LaneEffect\/effect001\/LiveLaneEffectAssetSettings not exported/);
});

// ---- note skins: flick arrows (LiveFlickNoteView / LiveDirectionFlickNoteView, ArrowGradientAnimator)
const arrowSprite = (name, us) => ({ sprite: name, rect: { width: 20, height: 10 }, pixelsToUnits: 100, uv: us.map((u) => [u, 0.5]) });
// a flick head without prefab / GL: the parts NoteHeadView's skin setup and UpdateView use
const flickHead = (unit) => {
  const v = Object.create(NoteHeadView.prototype);
  const geo = Object.assign(Object.create(NoteGeo.prototype), { unit: F(0.5), headPlacement: () => ({ x: 0, y: 0 }) });
  Object.assign(v, { owner: { geo, clip: (id) => ({ id }) }, unit, main: null, mark: null, left: null, right: null, subArrow: null,
                     parts: null, p: { root: { t: {} } }, arrow: { sprite: null, size: { x: -1, y: -1 }, order: 0 } });
  return v;
};

test("flick arrow: a width bracket without a sprite draws no arrow, keeps its size and stays dirty (as the game leaves it)", () => {
  const a = arrowSprite("a", [0.1, 0.3]), c = arrowSprite("c", [0.5, 0.9]);
  const unit = { _arrowAssets: [{ _maxWidth: 5, _sprite: a }, { _maxWidth: 13, _sprite: null }, { _maxWidth: 99, _sprite: c }],
                 _arrowLoopAnimation: { clip: 7 }, _arrowTiltEnabled: 0, _arrowTiltMaterial: null, _gradientSettings: null };
  const v = flickHead(unit);
  v.setup(1, 10, 12, 1000, false);
  assert.deepEqual(v.clip, { id: 7 });
  assert.equal(v.gradient, undefined);                    // no gradient settings: the default material, no animator
  v.setViewProgress(F(0.5)); v.updateView();
  assert.equal(v.arrow.sprite, null);                     // no arrow
  assert.deepEqual(v.arrow.size, { x: -1, y: -1 });       // size not set
  assert.equal(v.dirty, true);                            // UpdateView did not finish
  assert.ok(Number.isNaN(v._vw));                         // the width is not noted as applied: tried again next time
  assert.equal(v.renderers().includes(v.arrow), false);
  v.updateView();
  assert.equal(v.arrow.sprite, null);
  v.width = 3; v.updateView();                            // another width: a sprite again
  assert.equal(v.arrow.sprite, a);
  assert.deepEqual(v.arrow.size, NoteGeo.spriteSize(a));
  assert.equal(v.dirty, false);
  // the tilt: without a tilt material the game skips it; with one it is not implemented
  assert.doesNotThrow(() => flickHead({ ...unit, _arrowTiltEnabled: 1 }).setupSkin());
  assert.throws(() => flickHead({ ...unit, _arrowTiltEnabled: 1, _arrowTiltMaterial: { material: "tilt" } }).setupSkin(), /tilt/);
});

test("flick arrow gradient: the settings' material and the ArrowGradientAnimator block", () => {
  const mat = { material: "arrow_gradient_center", shader: { shader: "Sirius/ArrowGradientCenter" } };
  const settings = { _arrowGradientMaterial: mat, _gradientDuration: F(0.8), _gradientPauseDuration: F(0.4),
                     _gradientBandWidth: F(0.3), _gradientMinAlpha: F(0.25) };
  const s1 = arrowSprite("s1", [F(0.625), F(0.5), F(0.75)]);
  const unit = { _arrowAssets: [{ _maxWidth: 99, _sprite: s1 }], _arrowLoopAnimation: null, _gradientSettings: settings,
                 _directionalGradient: 1 };
  const v = flickHead(unit);
  v.setup(1, 3, 12, 1000, false);
  assert.equal(v.arrow.material, mat);                    // Renderer.sharedMaterial
  assert.ok(v.gradient instanceof ArrowGradient);
  assert.equal(v.clip, null);
  assert.equal(v.gradient.mpb, null);                     // no block before the first Update
  v.setViewProgress(1); v.updateView();
  const notes = Object.create(LiveNotes.prototype);
  Object.assign(notes, { spawned: new Map([[1, v]]), held: new Map() });
  const dt = F(1 / 60);
  notes.updateGradients(dt);
  let t = F(F(0 + dt) % F(F(0.8) + F(0.4)));
  assert.deepEqual(v.gradient.mpb, { _GradientOffset: F(t / F(0.8)), _BandWidth: F(0.3), _MinAlpha: F(0.25),
                                     _UvMin: F(0.5), _UvRange: F(F(0.75) - F(0.5)), _Directional: 1 });
  for (let i = 0; i < 60; i++) { notes.updateGradients(dt); t = F(F(t + dt) % F(F(0.8) + F(0.4))); }
  assert.equal(v.gradient.time, t);                       // fmodf over duration + pause
  assert.equal(v.gradient.mpb._GradientOffset, 1);        // in the pause: clamped to 1 (61 frames > 0.8 s)
  // a sprite change: the uv range again; no sprite: 0 and 1
  v.arrow.sprite = null; notes.updateGradients(dt);
  assert.equal(v.gradient.mpb._UvMin, 0); assert.equal(v.gradient.mpb._UvRange, 1);
  // a new setup restarts the animator (Initialize: time 0)
  v.setup(2, 3, 12, 2000, false);
  assert.equal(v.gradient.time, 0);
  // without settings the unit's getters give their defaults
  const g = new ArrowGradient({ _gradientSettings: null });
  assert.deepEqual([g.duration, g.pause, g.bandWidth, g.minAlpha, g.directional], [1, 0, 0.4, 0.5, false]);
});

// ---- bar lines (MeasureLineDisplay)
test("music score position: bars from the last BPM / bar change in float32; zero before the first BPM change", () => {
  const bpm = (bpm, bar, timeMs, barProgress = 0) => ({ bpm, bar, barProgress, timeMs });
  const score = { bpmChanges: [bpm(190, 0, 0)], barChanges: [{ beatsPerBar: 4, bar: 0, barProgress: 0, timeMs: 0 }] };
  // one bar of 4 beats at 190 BPM: 1263.157... ms; bar 7 starts at 8842.1 ms
  assert.equal(musicScorePosition(score, 8842).bar, 6);
  assert.equal(musicScorePosition(score, 8843).bar, 7);
  const p = musicScorePosition(score, 1000);
  const f = F(F(F(F(1000) / 1000) - 0) / F(F(4 * 60) / 190));
  assert.deepEqual(p, { bar: 0, rhythm: Math.trunc(F(f * 8)) % 8, rhythmicUnit: 8, barProgress: f, timeMs: 1000 });
  // a later bar change is the reference; its beats per bar
  const s2 = { bpmChanges: [bpm(120, 0, 0)], barChanges: [{ beatsPerBar: 4, bar: 0, barProgress: 0, timeMs: 0 },
                                                          { beatsPerBar: 3, bar: 4, barProgress: 0, timeMs: 8000 }] };
  assert.equal(musicScorePosition(s2, 7999).bar, 3);
  assert.equal(musicScorePosition(s2, 9500).bar, 5);                    // 1.5 s of 1.5 s bars after bar 4
  assert.deepEqual(musicScorePosition({ bpmChanges: [bpm(120, 0, 500)], barChanges: [] }, 100),
                   { bar: 0, rhythm: 0, rhythmicUnit: 0, barProgress: 0, timeMs: 0 });
});

const barLinePrefab = () => ({ key: "bar_line_view", nodes: [{
  path: "LiveBarLineView", name: "LiveBarLineView", active: true, layer: 25,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  components: [{ type: "MonoBehaviour", class: "LiveBarLineView", _viewProgress: 0, _renderer: { gameObject: "LiveBarLineView" } },
               { type: "SpriteRenderer", m_Enabled: 1, m_Sprite: { sprite: "bar", texture: { texture: "t" } }, m_Materials: [{ material: "m" }],
                 m_Size: { x: 1, y: F(0.04) }, m_SortingOrder: 4999, m_Color: { r: 1, g: 1, b: 1, a: 1 } }] }] });

test("bar lines: the bar lines after the position's bar within the display offset, views reused in order", () => {
  const geo = Object.assign(Object.create(NoteGeo.prototype), { laneCount: 24, unit: F(0.5), headPlacement: (c, t) => ({ x: 7, y: F(10 * t) }) });
  const score = { barLineTimeMs: [0, 1000, 2000, 3000, 4000, 5000], bpmChanges: [{ bpm: 240, bar: 0, barProgress: 0, timeMs: 0 }],
                  barChanges: [{ beatsPerBar: 4, bar: 0, barProgress: 0, timeMs: 0 }] };             // one bar per second
  const owner = { score, geo, displayOffsetMs: 1500 };
  const bl = new LiveBarLines(owner, barLinePrefab(), null);
  bl.update({ timeMs: 1200 });                        // bar 1: lines 2 (2000) within 1200 + 1500; 3 (3000) not
  assert.equal(bl.active.length, 1);
  const v = bl.active[0];
  assert.equal(v.progress, NoteGeo.viewProgress(F(F(F(1500 + 1200) - 2000) / 1500)));
  assert.deepEqual(v.p.root.t.localPosition, { x: 0, y: F(10 * v.progress), z: 0 });
  assert.deepEqual(v.p.root.t.localScale, { x: v.progress, y: v.progress, z: v.progress });
  assert.deepEqual(v.node.size, { x: 12, y: F(0.04) });           // LaneCount x unit
  assert.equal(v.node.order, 4999);                               // the prefab's sorting order
  bl.update({ timeMs: 1600 });                        // lines 2 and 3: the first view reused for line 2, one rented
  assert.equal(bl.active.length, 2); assert.equal(bl.active[0], v);
  bl.update({ timeMs: 2100 });                        // bar 2: lines 3 only; the second view returned
  assert.equal(bl.active.length, 1); assert.equal(bl.pool.length, 1); assert.equal(bl.active[0], v);
  assert.equal(bl.renderers().length, 1);
  bl.update({ timeMs: 5100 });
  assert.equal(bl.active.length, 0);
  bl.reset();
  assert.equal(bl.pool.length, 2);
});

test("bar lines: the container's element root relative to screen_root; offered only with the bar line prefab", () => {
  const node = (path, pos = { x: 0, y: 0, z: 0 }, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 0,
    localPosition: pos, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
  const base = "LiveGameView/LiveGameCamera/screen_root/LiveGameAllNoteView";
  const scene = new Prefab({ key: "scene", nodes: [
    node("LiveGameView"), node("LiveGameView/LiveGameCamera"), node("LiveGameView/LiveGameCamera/screen_root", { x: 0, y: 0, z: 10 }),
    node(base, { x: 0, y: 0, z: 0 }, [{ type: "MonoBehaviour", class: "LiveAllNoteView", _barLineView: { gameObject: `${base}/LiveAllBarLineView` } }]),
    node(`${base}/LiveAllBarLineView`, { x: 0, y: 1, z: 0 }, [{ type: "MonoBehaviour", class: "LiveAllBarLineView", _container: { gameObject: `${base}/LiveAllBarLineView/container` } }]),
    node(`${base}/LiveAllBarLineView/container`, { x: 0, y: 0, z: 2 }, [{ type: "MonoBehaviour", class: "LiveBarLineViewContainer",
      _elementRoot: { transform: `${base}/LiveAllBarLineView/container` }, _elementPrefab: { gameObject: "LiveBarLineView" } }]) ] });
  const m = LiveBarLines.elementRoot(scene);
  assert.deepEqual([m[12], m[13], m[14]], [0, 1, 2]);             // screen_root's own z not included
  const item = LIVE_OPTIONS.find((o) => o.name === "MeasureLineDisplay");
  assert.deepEqual(context().values(item), [false]);
  assert.throws(() => context().resolve({ MeasureLineDisplay: true }), /this chart offers false/);
  const withPrefab = context({ notes: { ...notesJson(), prefabs: { bar_line_view: barLinePrefab() } } });
  assert.deepEqual(withPrefab.values(item), [false, true]);
  assert.equal(withPrefab.resolve({ MeasureLineDisplay: true }).MeasureLineDisplay, true);
  assert.deepEqual(liveSettingsChanges(withPrefab.resolve({}), withPrefab.resolve({ MeasureLineDisplay: true })).boot, ["MeasureLineDisplay"]);
});

test("changes are grouped by how they apply", () => {
  const ctx = context(), a = ctx.resolve({});
  const b = ctx.resolve({ NoteSpeed: 9, LaneOpacity: 40, LiveMusicVolume: 30, TapSeVolume: 50, FastSlowDisplay: true });
  assert.deepEqual(liveSettingsChanges(a, b), { none: ["FastSlowDisplay"], live: ["LiveMusicVolume"], noteSe: ["TapSeVolume"],
                                                boot: ["NoteSpeed", "LaneOpacity"], reload: [] });
  assert.deepEqual(LiveOptionContext.changed(a, a), []);
});

test("option items: groups and sections of the game's option screen; mutes belong to their volumes", () => {
  const ctx = context(), items = liveOptionItems(ctx, ctx.resolve({}));
  assert.equal(items.length, LIVE_OPTIONS.length);
  for (const i of items) assert.ok(LIVE_OPTION_GROUPS.some((g) => g.key === i.group && g.sections.includes(i.section)));
  const music = items.find((i) => i.name === "LiveMusicVolume");
  assert.equal(music.mute, "LiveMusicMute");
  assert.equal(items.find((i) => i.name === "LiveMusicMute").hidden, true);
  assert.deepEqual(items.find((i) => i.name === "NoteSpeed").range, [1, 12]);
  // a volume whose category the data lacks is not offered
  const thin = context({ audio: { categories: { LiveBgmConfig: 1 }, noteSe: audioJson().noteSe } });
  assert.equal(thin.offered(LIVE_OPTIONS.find((o) => o.name === "LiveSeVolume")), false);
  assert.throws(() => thin.resolve({ LiveSeVolume: 10 }), /no volume/);
  assert.deepEqual(liveOptionsOf(ctx, "basicNote").map((o) => o.name), ["NoteSpeed", "NoteTiming", "ChartPosition"]);
});

test("note SE maps: volumes, mutes and the individual sounds per note type", () => {
  const ctx = context({ audio: audioJson({ groups: { 1: { 2: 102, 5: 105, 7: 107 }, 3: { 2: 302, 5: 305, 7: 307 } } }) });
  const m = liveNoteSeMaps(ctx, ctx.resolve({ TapSeVolume: 40, FlickSeMute: true }));
  assert.equal(m.volumes[2], F(0.4)); assert.equal(m.volumes[3], F(0.4)); assert.equal(m.volumes[8], F(0.4));
  assert.equal(m.volumes[5], 0); assert.equal(m.mutes[5], true);
  assert.equal(m.volumes[1], 1);                                  // the empty-tap SE keeps the data's value
  assert.equal(m.types[2], 102);
  const ind = liveNoteSeMaps(ctx, ctx.resolve({ UseIndividualNoteSe: true, FlickSeId: 3 }));
  assert.equal(ind.types[5], 305); assert.equal(ind.types[2], 102);
  const pat = liveNoteSeMaps(ctx, ctx.resolve({ NoteSePatternId: 3 }));
  assert.equal(pat.types[7], 307); assert.equal(pat.types[3], undefined);   // a type without a row has no entry
});

test("live category volumes: the data's values at the defaults; after a change all four mute ? 0 : clamp01(v / 100)", () => {
  const ctx = context();
  assert.deepEqual(liveCategoryVolumes(ctx, ctx.resolve({ LiveMusicVolume: 40, LiveSeMute: true })),
                   { LiveBgmConfig: F(0.4), LiveSeConfig: 0, LiveVoiceConfig: F(0.8), LiveNotesSeConfig: F(0.7) });
  // one mute is enough; the saved defaults are the option values, not the data's
  assert.deepEqual(liveCategoryVolumes(ctx, ctx.resolve({ LiveVoiceMute: true })),
                   { LiveBgmConfig: 1, LiveSeConfig: F(0.5), LiveVoiceConfig: 0, LiveNotesSeConfig: F(0.7) });
  // back at the defaults: the data's values again
  assert.deepEqual(liveCategoryVolumes(ctx, ctx.resolve({ LiveVoiceMute: false, LiveMusicVolume: 100 })),
                   { LiveBgmConfig: 1, LiveSeConfig: 1, LiveVoiceConfig: 1, LiveNotesSeConfig: 1 });
  // a category the data lacks is left out
  const thin = context({ audio: { categories: { LiveBgmConfig: 1 }, noteSe: audioJson().noteSe } });
  assert.deepEqual(liveCategoryVolumes(thin, thin.resolve({ LiveMusicVolume: 30 })), { LiveBgmConfig: F(0.3) });
});

// ---- executor
const tap = (id, timeMs) => ({ id, op: 1, timeMs, bar: id, barProgress: 0, lineIds: [], critical: false });
const run = (exec, until) => {
  const judged = [];
  for (let t = 16; t <= until; t += 16) for (const j of exec.update(t, 1 / 60).judgedNotes) judged.push([j.id, t]);
  return judged;
};

test("executor: display offset from NoteSpeed, input timing offset, the Miss window widened by the offset", () => {
  const score = { notes: [tap(1, 1000), tap(2, 2000)], lines: [] };
  const settings = notesJson().settings;
  const def = new LiveExecutor(score, settings), same = new LiveExecutor(score, settings, { noteSpeed: 5, timingAdjustmentMs: 0 });
  assert.equal(def.D, D5); assert.equal(same.D, D5); assert.equal(def.inp, 0);
  assert.deepEqual(same.afterMax, def.afterMax);
  assert.deepEqual(run(same, 2500), run(def, 2500));
  assert.equal(new LiveExecutor(score, settings, { noteSpeed: 1 }).D, 4000);
  assert.equal(new LiveExecutor(score, settings, { noteSpeed: 12 }).D, 349);   // trunc(F(0.35) x 1000)
  // the exported display offset is checked at the default speed only
  assert.throws(() => new LiveExecutor(score, { ...settings, noteDisplayTimeMs: 1 }), /display offset/);
  assert.doesNotThrow(() => new LiveExecutor(score, { ...settings, noteDisplayTimeMs: 1 }, { noteSpeed: 7 }));
  // judged at the first frame with t >= note + offset
  assert.deepEqual(run(new LiveExecutor(score, settings, { timingAdjustmentMs: 45 }), 2500), [[1, 1056], [2, 2048]]);
  assert.deepEqual(run(new LiveExecutor(score, settings, { timingAdjustmentMs: -20 }), 2500), [[1, 992], [2, 1984]]);
  assert.deepEqual(run(new LiveExecutor(score, settings), 2500), [[1, 1008], [2, 2000]]);
  const w = new LiveExecutor(score, settings, { timingAdjustmentMs: -120 });
  assert.equal(w.afterMax[1], 250); assert.equal(w.afterMax[11], 270);
});

test("note geometry: the judgement positions follow JudgePosition's view progress offset", () => {
  const s = { laneCount: 24, laneSize: [1912, 1000], laneTopRange: 0.3, laneBottomRange: 1, laneTopPosition: 0,
              judgementScreenBottomPosition: 2.24 };
  const base = new NoteGeo(s), zero = new NoteGeo(s, M.viewProgressOffset(0));
  assert.deepEqual(zero.J, base.J);
  const low = new NoteGeo(s, M.viewProgressOffset(-5)), high = new NoteGeo(s, M.viewProgressOffset(5));
  assert.ok(low.J[0].y < base.J[0].y && high.J[0].y > base.J[0].y);   // - lower, + higher
});

test("judgement view: None shows no judgement (IsShowJudgeResult false), Center as before", () => {
  const shown = [];
  const view = { show: (lane, pos, j) => shown.push(j) };
  const comp = { _centerAnchoredPosition: { x: 0, y: 100 } };
  new LiveJudgementViewCenter(comp, view, 0).showJudgement([{ judgement: 5 }]);
  assert.deepEqual(shown, [5]);
  new LiveJudgementViewCenter(comp, view, 2).showJudgement([{ judgement: 5 }, { judgement: 1 }]);
  assert.deepEqual(shown, [5]);
  assert.throws(() => new LiveJudgementViewCenter(comp, view, 1), /not implemented/);
});

// ---- sound
const param = (v) => ({ value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = (extra = {}) => ({ connect(d) { return d; }, disconnect() {}, ...extra });
const fakeContext = () => ({ sampleRate: 48000, state: "running", currentTime: 0, destination: node(),
                             createGain: () => node({ gain: param(1) }) });

test("live category volumes change the buses at once; the data's categories are not written", () => {
  const data = { sounds: {}, categories: { LiveBgm: 1, LiveBgmConfig: 1, LiveSe: 1, LiveSeConfig: 0.5 }, react: [],
                 music: { soundId: 1 }, noteSe: { types: {}, volumes: {}, mutes: {} }, liveSe: {}, timeline: {} };
  const audio = new LiveAudio(new PlayerLoop(60), data, { context: fakeContext() });
  const bgm = audio.sm._catBus(["LiveBgm", "LiveBgmConfig"]), se = audio.sm._catBus(["LiveSe", "LiveSeConfig"]);
  assert.equal(bgm.gain.value, 1); assert.equal(se.gain.value, 0.5);
  audio.setCategoryVolumes({ LiveBgmConfig: 0.4, LiveSeConfig: 0.5 });
  assert.equal(bgm.gain.value, 0.4); assert.equal(se.gain.value, 0.5);
  assert.equal(data.categories.LiveBgmConfig, 1);
  audio.setCategoryVolumes({ LiveBgmConfig: 1 });
  assert.equal(bgm.gain.value, 1);
  assert.equal(audio.sm.catVolume.size, 0);
});

test("note SE maps replaced: new sounds and volumes; a looped slide SE restarts with them", () => {
  const log = [];
  const sm = { play: (id, o) => { log.push(["play", id, o.volume]); return log.length; }, stop: (uid) => log.push(["stop", uid]) };
  const p = new LiveSoundPlayer({ noteSe: { types: { 4: 104, 7: 107 }, volumes: {}, mutes: {} }, liveSe: {}, music: { soundId: 1 } }, sm);
  p.longSePlaying = true; p.longSeId = 9; p.currentLongSeType = 7;
  p.setNoteSe({ types: { 4: 204, 7: 207 }, volumes: { 4: 0.5 }, mutes: { 7: false } });
  assert.deepEqual(log, [["stop", 9]]);
  assert.equal(p.longSePlaying, false);
  p.playNoteSe(4);
  assert.deepEqual(log.at(-1), ["play", 204, 0.5]);
});

test("finish sounds: a result whose direction sound the chart data omits plays none", () => {
  const log = [];
  const sm = { play: (id) => { log.push(id); return log.length; }, stop() {} };
  const data = { noteSe: { types: {}, volumes: {}, mutes: {} }, liveSe: { 10: 510, 13: 513, 16: 516 }, music: { soundId: 1 },
                 sounds: { 510: {}, 516: {} } };
  const p = new LiveSoundPlayer(data, sm);
  assert.equal(p.playFinishVoiceAndCheer({ isAllPerfect: true, isFullCombo: true }), 3);
  assert.deepEqual(log.splice(0), [-1, 510, 516]);                 // no voice id (-1), finish cheer, all perfect
  assert.equal(p.playFinishVoiceAndCheer({ isAllPerfect: false, isFullCombo: false }), -1);
  assert.deepEqual(log.splice(0), [-1, 510]);                      // ClearDirection (13) is not in `sounds`
});

// ---- session
const stubSession = () => {
  const ctx = context(), calls = [];
  const s = Object.create(ChartSession.prototype);
  Object.assign(s, {
    disposed: false, paused: true, state: "playing", chartMs: 5000, optionContext: ctx, _settings: ctx.resolve({}),
    audio: { setCategoryVolumes: (m) => calls.push(["volumes", m]), setNoteSe: (m) => calls.push(["noteSe", !!m]),
             data: { noteSe: {} } },
    stage: { lane: { configure: () => calls.push(["lane"]) } },
    renderer: { canvas: { configure: () => calls.push(["canvas"]) } },
    notes: { setLineOpacity: () => calls.push(["lines"]) },
    seek: async (ms, o) => { calls.push(["seek", ms, o]); return ms; },
    render: () => calls.push(["render"]),
  });
  return { s, calls };
};

test("session: a change applies by kind (volumes live, constants replaced, simulation options restart the chart)", async () => {
  const { s, calls } = stubSession();
  assert.deepEqual(await s.setSettings({ LiveVoiceVolume: 20 }), ["LiveVoiceVolume"]);
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ["volumes", "render"]);
  await s.setSettings({ LaneOpacity: 10, BackgroundBrightness: 40, SlideOpacity: 100 });
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ["lane", "canvas", "lines", "render"]);
  await s.setSettings({ NoteSpeed: 10.5 });
  assert.deepEqual(calls.splice(0), [["seek", 5000, { restart: true }], ["render"]]);
  assert.equal(s.derived.noteSpeed, 10.5);
  assert.deepEqual(await s.setSettings({ NoteSpeed: 10.5 }), []);   // nothing changed
  await s.setSettings({}, { reset: true });
  assert.equal(s.settings.NoteSpeed, 5);
  await assert.rejects(s.setSettings({ LiveQuality: 0 }), /offers 1/);
  const rich = context({ live: { notesMirror: "m.json" } });
  s.optionContext = rich; s._settings = rich.resolve({});
  await assert.rejects(s.setSettings({ MirrorChart: true }), (e) => e.reload === true && e.settings.MirrorChart === true);
});

test("session clock: the chart position offset shifts chart time; the post-music lead ends the chart", () => {
  const s = Object.create(ChartSession.prototype);
  s.hold = null; s.state = "playing";
  s.clock = { lastMs: -1, hasMusicEverPlayed: false, offsetMs: 0, chartPositionMs: -100, postMusicBufferMs: 0,
              postMusicElapsedMs: 0, musicLengthMs: 1000 };
  let playing = true, ms = 50;
  const src = { isPlayingMusic: () => playing, musicTimeMs: () => ms };
  assert.equal(s._chartMs(src, 1 / 60), 0);                       // NormalizeTimeMs: max(t + offset, 0)
  ms = 600;
  assert.equal(s._chartMs(src, 1 / 60), 500);
  playing = false;                                                // the lead of 100 ms after the music
  const seen = [];
  for (let i = 0; i < 10 && s.state === "playing"; i++) seen.push(s._chartMs(src, 1 / 60));
  assert.equal(s.state, "ended");
  assert.deepEqual(seen, [916, 933, 950, 966, 983, 1000, null]);
  // no offset: the chart ends with the music
  s.state = "playing"; s.clock.chartPositionMs = 0;
  assert.equal(s._chartMs(src, 1 / 60), null);
  assert.equal(s.state, "ended");
});

test("seek stop test: the next frame's chart time is the one the frame reaches, through the music end and the lead", () => {
  for (const cp of [-100, -7, 0, 100]) {
    const s = Object.create(ChartSession.prototype);
    s.hold = null; s.state = "playing";
    s.clock = { lastMs: -1, hasMusicEverPlayed: false, offsetMs: 0, chartPositionMs: cp, postMusicBufferMs: 0,
                postMusicElapsedMs: 0, musicLengthMs: 1000 };
    const clk = new LiveGameClock(0.8), dt = 1 / 60, len = 1000, seen = [];
    const src = { isPlayingMusic: () => clk.isPlaying(len), musicTimeMs: () => clk.timeMs() };
    for (let i = 0; i < 40 && s.state === "playing"; i++) {
      const next = s._nextChartMs(clk, len, dt);
      clk.advance(dt);
      const got = s._chartMs(src, dt);
      assert.equal(next, got === null && s.state === "ended" ? Infinity : got, `cp ${cp}, frame ${i}`);
      seen.push(got);
    }
    assert.equal(s.state, "ended");
    // with a lead the last chart time is the music length; the lead's frames follow the float32 elapsed time, not the
    // game clock (whose next value would be 16 ms behind the lead's at the first frame after the music)
    if (cp < 0) assert.equal(seen.at(-2), len);
    if (cp === -100) assert.deepEqual(seen.slice(-6), [883, 916, 933, 950, 966, 983, 1000, null].slice(-6));
  }
});

test("catch-up: frames of the music the chart clock passed; none at the step into the post-music lead", () => {
  const caught = (lastSec, lastMs, chartMs, cp = -100) => {
    const s = Object.create(ChartSession.prototype), calls = [];
    Object.assign(s, {
      loop: { deltaTime: 1 / 60, tweens: { update() {} } }, lastSec, chartMs: lastMs,
      clock: { musicLengthMs: 1000, chartPositionMs: cp },
      exec: { update: (t) => { calls.push(t); return {}; }, resetFrame() {} },
      notes: { update() {}, updateGradients() {}, advanceGraph() {} },
      fx: { update() {}, uiFrame() {}, clearEffects() {}, animation() {}, ui: { tweens() {} } },
    });
    s._catchUp(chartMs);
    return calls;
  };
  assert.deepEqual(caught(0.8, 700, 766), [716, 733, 750]);       // three frames of the music missed
  assert.deepEqual(caught(0.8, 700, 716), []);                    // the next frame: nothing missed
  // the last music frame (music 983 ms, chart 883) and the first lead frame (chart 1016 - 100 = 916): the jump of two
  // frames' time is the lead's clock, not a missed frame
  assert.deepEqual(caught(59 / 60, 883, 916), []);
  // the music has ended (chartMs null): the music frames after the last update are caught up
  assert.deepEqual(caught(0.9, 800, null, 0), [916, 933, 950, 966, 983]);
});

// ---- note speed in the control bar
test("note speed steps: the pre-live dialog's steps, a float32 sum clamped to the range, no step when equal", () => {
  assert.deepEqual(NOTE_SPEED_STEPS, { large: 1, medium: F(0.1), small: F(0.01) });
  let v = 5;
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(v = noteSpeedStep(v, NOTE_SPEED_STEPS.medium, 1, 12));
  assert.deepEqual(seen, [F(5.1), F(5.2), F(F(5.2) + F(0.1))]);    // float32 sums, as OnStepButton adds
  assert.equal(noteSpeedStep(11.5, NOTE_SPEED_STEPS.large, 1, 12), 12);   // clamped to the maximum
  assert.equal(noteSpeedStep(12, NOTE_SPEED_STEPS.large, 1, 12), null);   // already there: no change
  assert.equal(noteSpeedStep(1.05, -NOTE_SPEED_STEPS.medium, 1, 12), 1);
  assert.equal(noteSpeedStep(1, -NOTE_SPEED_STEPS.small, 1, 12), null);
});

// a ChartControls without DOM: the bar's note speed parts as plain objects, a player stub
const barStub = (settings = { NoteSpeed: 5 }) => {
  const calls = [];
  const player = {
    session: {}, settings,
    optionItems: () => [{ name: "NoteSpeed", range: [1, 12] }],
    setSettings: async (v) => { calls.push(v); player.settings = { ...player.settings, ...v }; return Object.keys(v); },
    _fail: (e) => { throw e; },
  };
  const c = Object.create(ChartControls.prototype);
  Object.assign(c, { player, panel: null, nsTarget: null, nsValue: { value: "", select() {} }, nsDown: { disabled: false },
                     nsUp: { disabled: false }, show() {} });
  return { c, player, calls };
};

test("note speed in the bar: shown at once, applied once through setSettings after quick steps", async () => {
  const { c, player, calls } = barStub();
  c.stepNoteSpeed(NOTE_SPEED_STEPS.medium); c.stepNoteSpeed(NOTE_SPEED_STEPS.medium); c.stepNoteSpeed(NOTE_SPEED_STEPS.large);
  assert.equal(c.nsValue.value, "6.20");
  assert.equal(calls.length, 0);
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(calls, [{ NoteSpeed: F(F(F(5.1) + F(0.1)) + 1) }]);
  assert.equal(c.nsTarget, null);
  assert.equal(c.nsValue.value, "6.20");
  assert.equal(player.settings.NoteSpeed, calls[0].NoteSpeed);
  // at the maximum the + button is disabled, as UpdateUi's SetButtonInteractable
  player.settings = { NoteSpeed: 12 };
  c._showNoteSpeed();
  assert.equal(c.nsUp.disabled, true); assert.equal(c.nsDown.disabled, false);
  c.stepNoteSpeed(NOTE_SPEED_STEPS.large);
  assert.equal(c.nsTarget, null);                                  // no change: nothing scheduled
});

test("typed option values: a decimal number, rounded to 0.01 in float32, clamped; anything else null", () => {
  assert.equal(parseOptionInput("7.25", 1, 12), F(7.25));
  assert.equal(parseOptionInput(" 5.5 ", 1, 12), F(5.5));
  assert.equal(parseOptionInput("5,5", 1, 12), F(5.5));                 // a decimal comma
  assert.equal(parseOptionInput("7.456", 1, 12), F(7.46));
  assert.equal(parseOptionInput("1.005", 1, 12), F(1.01));              // half away from zero on the typed digits
  assert.equal(parseOptionInput("6.004", 1, 12), F(6));
  assert.equal(parseOptionInput(".5", 1, 12), 1);                       // clamped to the range
  assert.equal(parseOptionInput("99", 1, 12), 12);
  assert.equal(parseOptionInput("12.004", 1, 12), 12);
  assert.equal(parseOptionInput("-0.555", -3, 3), F(-0.56));
  assert.equal(parseOptionInput("+2", -3, 3), 2);
  for (const bad of ["", " ", "abc", "5.5.5", "1e1", "5..", "--1", "Infinity", "NaN", "0x10", "5 5"]) {
    assert.equal(parseOptionInput(bad, 1, 12), null, bad);
  }
  assert.equal(parseOptionInput("49.6", 0, 100, false), 50);             // an integer option
  assert.equal(parseOptionInput("101", 0, 100, false), 100);
});

test("note speed typed in the bar: applied at once through setSettings; not a number reverts; Escape cancels", async () => {
  const { c, player, calls } = barStub();
  c._showNoteSpeed();
  assert.equal(c.nsValue.value, "5.00");
  c.nsValue.value = "7.456";
  c.commitNoteSpeed(c.nsValue.value);
  assert.equal(c.nsValue.value, "7.46");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [{ NoteSpeed: F(7.46) }]);
  assert.equal(player.settings.NoteSpeed, F(7.46));
  // not a number: the value in effect again, nothing applied
  c.nsValue.value = "fast";
  c.commitNoteSpeed(c.nsValue.value);
  assert.equal(c.nsValue.value, "7.46");
  // the same value after rounding: nothing applied
  c.nsValue.value = "7.459";
  c.commitNoteSpeed(c.nsValue.value);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  // Enter applies, Escape cancels an edit (and then goes on to the player: no preventDefault without an edit)
  const keyEv = (key) => { const e = { key, prevented: false, preventDefault() { e.prevented = true; } }; c.noteSpeedFieldKey(e); return e; };
  c.nsValue.value = "3";
  assert.equal(keyEv("Escape").prevented, true);
  assert.equal(c.nsValue.value, "7.46");
  assert.equal(keyEv("Escape").prevented, false);
  c.nsValue.value = "3";
  assert.equal(keyEv("Enter").prevented, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls[1], { NoteSpeed: 3 });
  assert.equal(c.nsValue.value, "3.00");
});

test("keyboard shortcuts are off in a text field: typing 5.5 or [ ] does not play or step", () => {
  const { c } = barStub();
  const got = [];
  c.stepNoteSpeed = (s) => got.push(["step", s]);
  c.toggle = () => got.push("toggle");
  c.seek = (ms) => got.push(["seek", ms]);
  c.show = () => {};
  c.speed = { value: "1" };
  c.player.speed = 1; c.player.currentTime = 10000;
  const key = (k, target) => c.key({ key: k, code: k === " " ? "Space" : "", preventDefault() {}, composedPath: () => [target] });
  for (const target of [{ tagName: "INPUT", type: "text" }, { tagName: "INPUT", type: "number" }, { tagName: "TEXTAREA" }]) {
    for (const k of ["5", ".", "5", " ", "k", "K", "[", "]", "{", "}", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "m", "s"]) key(k, target);
  }
  assert.deepEqual(got, []);
  assert.equal(c.player.speed, 1);
  key(" ", { tagName: "INPUT", type: "range" });                         // the seek bar: Space still plays / pauses
  key("]", { tagName: "DIV" });
  assert.deepEqual(got, ["toggle", ["step", NOTE_SPEED_STEPS.medium]]);
});

test("note speed keys: [ ] step by 0.1, { } by 1; the other keys keep their meaning", () => {
  const { c } = barStub();
  const steps = [];
  c.stepNoteSpeed = (s) => steps.push(s);
  c.toggle = () => steps.push("toggle");
  const key = (k) => { const e = { key: k, code: "", preventDefault() {}, composedPath: () => [{ tagName: "DIV" }] }; c.key(e); };
  for (const k of ["[", "]", "{", "}", " ", "m", "s"]) key(k);
  assert.deepEqual(steps, [-NOTE_SPEED_STEPS.medium, NOTE_SPEED_STEPS.medium, -1, 1, "toggle"]);
});

// ---- strings
test("strings: every language has every key of the English table; tags map to the tables", () => {
  const keys = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  const en = keys(PLAYER_STRINGS.en).sort();
  for (const [lang, table] of Object.entries(PLAYER_STRINGS)) assert.deepEqual(keys(table).sort(), en, lang);
  for (const o of LIVE_OPTIONS) if (!o.hidden && !LIVE_OPTIONS.some((v) => v.mute === o.name)) assert.ok(PLAYER_STRINGS.en.options[o.name], o.name);
  for (const g of LIVE_OPTION_GROUPS) { assert.ok(PLAYER_STRINGS.en.groups[g.key]); for (const x of g.sections) assert.ok(PLAYER_STRINGS.en.sections[x]); }
  assert.equal(playerLanguage("zh-TW"), "zh-Hant"); assert.equal(playerLanguage("zh-Hant-HK"), "zh-Hant");
  assert.equal(playerLanguage("zh-CN"), "zh-Hans"); assert.equal(playerLanguage("zh"), "zh-Hans");
  assert.equal(playerLanguage("ja-JP"), "ja"); assert.equal(playerLanguage("ko"), "ko");
  assert.equal(playerLanguage("fr"), "en"); assert.equal(playerLanguage(""), "en");
  assert.equal(playerStrings("ja").settings, "設定");
  for (const table of Object.values(PLAYER_STRINGS)) {
    assert.ok(table.options.NoteSpeed && table.noteSpeedDown && table.noteSpeedUp);
    assert.match(formatString(table.noteSpeedValue, { min: "1.00", max: "12.00" }), /1\.00.*12\.00/);
  }
  assert.equal(formatString("{a} / {b} {c}", { a: 1, b: 2 }), "1 / 2 {c}");
});
