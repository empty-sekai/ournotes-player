// Still (AdvStillCommand) and the DOTween model under it, on a real PlayerLoop at 30 fps with a synthetic still prefab
// and story UI records: tween startup, delays, loops, deferred kills, Sequence inserts and callbacks, the filtered
// Play / Kill; the still's show / hide fades, the view's overlay / background fades, sequences and their callbacks,
// playback speed, the contained scale. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures, setStoryFeaturesSpeed } from "../../src/story/features/index.js";
import { DT_PLUGIN, DTManager, DTSequence, dtTo } from "../../src/story/features/dotween-core.js";
import { stillView } from "../../src/story/features/still.js";
import { shakes } from "../../src/story/features/shake.js";
import { viewProjection } from "../../src/story/features/canvas.js";
import { URPPost } from "../../src/engine/postfx.js";

const flush = () => new Promise((res) => setImmediate(res));
const steps = async (loop, n) => { await flush(); for (let i = 0; i < n; i++) { await loop.step(); await flush(); } };
const settle = async (loop, promise, max = 400) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  const f0 = loop.frameCount;
  while (!done && loop.frameCount - f0 < max) { await loop.step(); await flush(); }
  assert.ok(done, "not settled");
  return loop.frameCount - f0;
};

test("DOTween: lazy start value, delay, Yoyo loops, callbacks; a kill inside the update loop despawns at its end", async () => {
  const loop = new PlayerLoop(30), mgr = new DTManager(loop), log = [];
  let v = 5;
  const t = dtTo(mgr, () => v, (x) => { v = x; }, 10, 0.5, DT_PLUGIN.float).setDelay(0.5).setLoops(2, 1).setEase(1)
    .on("onStart", () => log.push(["start", loop.frameCount])).on("onStepComplete", () => log.push(["step", loop.frameCount]))
    .on("onComplete", () => log.push(["complete", loop.frameCount])).on("onKill", () => log.push(["kill", loop.frameCount]));
  v = 0;                                                                  // read at startup, after the delay
  await steps(loop, 10);
  assert.equal(v, 0);
  assert.deepEqual(log, []);
  await steps(loop, 15);                                                  // 0.83 s: a third into the first loop
  assert.ok(v > 5 && v < 8, `${v}`);
  await steps(loop, 15);                                                  // 1.33 s: Yoyo, two thirds of the way back
  assert.ok(v > 2 && v < 5, `${v}`);
  await steps(loop, 10);
  assert.equal(v, 0);
  assert.deepEqual(log.map((x) => x[0]), ["start", "step", "step", "complete", "kill"]);
  assert.equal(t.active, false);
  // a tween killed by an earlier tween's callback: inactive at once, despawned (OnKill) at the end of that loop
  const order = [];
  let b = null;
  const a = dtTo(mgr, () => 0, () => {}, 1, 0, DT_PLUGIN.float).on("onComplete", () => { b.kill(); order.push(["killed", b.active]); });
  b = dtTo(mgr, () => 0, () => order.push(["b update"]), 1, 1, DT_PLUGIN.float).on("onKill", () => order.push(["b kill"]));
  await steps(loop, 1);
  assert.deepEqual(order, [["killed", false], ["b kill"]]);
  assert.equal(a.active, false);
  mgr.dispose();
});

test("DOTween Sequence: delays become offsets, callbacks at their time, restart rewinds to the captured start values", async () => {
  const loop = new PlayerLoop(30), mgr = new DTManager(loop), log = [];
  const o = { x: 1, y: 7 };
  const tx = dtTo(mgr, () => o.x, (v) => { o.x = v; }, 2, 0.5, DT_PLUGIN.float).setEase(1);
  const ty = dtTo(mgr, () => o.y, (v) => { o.y = v; }, 8, 0.5, DT_PLUGIN.float).setEase(1).setDelay(0.5)
    .on("onStart", () => log.push(["y start", o.x]));
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  const inf = dtTo(mgr, () => 0, () => {}, 1, 1, DT_PLUGIN.float).setLoops(-1);
  const s = new DTSequence(mgr).setAutoKill(false);
  s.insert(0, tx).insert(0, ty).insertCallback(1, () => log.push(["end", o.x, o.y]));
  s.insert(0, tx);                                                        // already sequenced: rejected
  const s2 = new DTSequence(mgr);
  s2.insert(0, inf);                                                      // loops -1 -> int.MaxValue
  console.warn = warn;
  assert.equal(warned, 2);
  assert.equal(inf.loops, 2147483647);
  assert.equal(ty.sequencedPosition, 0.5);
  assert.equal(s.duration, 1);
  await steps(loop, 16);
  assert.equal(o.x, 2);
  assert.deepEqual(log, [["y start", 2]]);                                // y starts at 0.5 s, after x ended
  await steps(loop, 16);
  assert.deepEqual(log[1], ["end", 2, 8]);
  s.restart(true);                                                        // children back to their captured starts
  assert.deepEqual(o, { x: 1, y: 7 });
  // the filtered Play: top-level tweens by target or string id, newest first
  const seen = [];
  const p1 = dtTo(mgr, () => 0, () => {}, 1, 1, DT_PLUGIN.float).setTarget(o).setId("a").on("onPlay", () => seen.push(1));
  const p2 = dtTo(mgr, () => 0, () => {}, 1, 1, DT_PLUGIN.float).setTarget(o).on("onPlay", () => seen.push(2));
  p1.pause(); p2.pause();
  p1.playedOnce = p2.playedOnce = true;
  assert.equal(mgr.play(o), 2);
  assert.deepEqual(seen, [2, 1]);
  assert.equal(mgr.kill("a"), 1);
  assert.equal(p1.active, false);
  assert.equal(mgr.play(tx), 0);                                          // nested tweens are never reached
  mgr.dispose();
});

// ------------------------------------------------------------------------------------------------ still fixtures
const Z = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 };
const rect = (aMin, aMax, pos, size, pivot = { x: 0.5, y: 0.5 }) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax,
  m_AnchoredPosition: pos, m_SizeDelta: size, m_Pivot: pivot });
const FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 });
const CENTER = (w, h) => rect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: w, y: h });
const CLAMPED = { m_Enabled: 1, m_UiScaleMode: 1, m_ReferencePixelsPerUnit: 100, m_ScaleFactor: 1,
                  m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 0,
                  class: "ClampedCanvasScaler", _maxAspectThreshold: Math.fround(13 / 6) };
const uiImage = (a) => ({ m_Enabled: 1, m_Color: { r: 0, g: 0, b: 0, a }, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1,
                          m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1, sprite: null, material: null });
const uiDoc = () => {
  const rec = (path, extra = {}, r = FULL) => ({ path, name: path.split("/").pop(), active: true, localPosition: Z,
                                                 localRotation: Q, localScale: ONE, rect: r, ...extra });
  const cam = "UIAdvWidget/VideoAndStillCamera", V = "UIAdvWidget/StillCanvas/AdvStillView";
  const canvas = (path, order, scaler, camera = cam) => rec(path, { canvas: { m_Enabled: 1, m_RenderMode: 1, m_SortingOrder: order,
    m_OverrideSorting: false, m_PixelPerfect: false, camera, m_PlaneDistance: 100 }, canvasScaler: scaler });
  return { nodes: [
    canvas("UIAdvWidget/VideoCanvas", 301, { ...CLAMPED, m_ScreenMatchMode: 1, class: undefined }),
    canvas("UIAdvWidget/StillCanvas", 302, CLAMPED),
    rec(V, { stillView: { enabled: 1, _overlay: `${V}/Overlay`, _background: `${V}/Background`, _target: `${V}/Target` } }),
    rec(`${V}/Overlay`, { image: uiImage(0) }, CENTER(2048, 2048)),
    { ...rec(`${V}/Background`, { image: uiImage(1) }), active: false },
    rec(`${V}/Target`),
    canvas("UIAdvWidget/VideoAndStillRenderScreenCanvas", 302, { ...CLAMPED, m_Enabled: 0 }, undefined),
    rec("UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen", { rawImage: { m_Enabled: 1, m_Color: { r: 1, g: 1, b: 1, a: 1 },
      m_UVRect: { x: 0, y: 0, width: 1, height: 1 }, texture: null, material: null } }),
    canvas("UIAdvWidget/FrameCanvas", 303, CLAMPED, "UIAdvWidget/UICamera"),
  ], sprites: {}, textures: {},
  videoAndStillCamera: { path: cam, camera: { m_Enabled: 1, m_ClearFlags: 2, m_BackGroundColor: { r: 0, g: 0, b: 0, a: 0 },
    m_NormalizedViewPortRect: { x: 0, y: 0, width: 1, height: 1 }, orthographic: false, "field of view": 60,
    "near clip plane": 0.3, "far clip plane": 1000, m_HDR: true },
    additionalCameraData: { m_RenderPostProcessing: 1, m_VolumeLayerMask: { m_Bits: 2048 }, m_Antialiasing: 0 } },
  videoAndStillScreenImage: "UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen" };
};

const EVENTS = ["onStart", "onPlay", "onUpdate", "onStepComplete", "onComplete", "onTweenCreated", "onRewind"];
const calls = (list = []) => ({ m_PersistentCalls: { m_Calls: list } });
const call = (gameObject, cls, method, mode = 1, str = "") => ({ m_Target: { component: "MonoBehaviour", gameObject, class: cls },
  m_TargetAssemblyTypeName: cls === "DOTweenAnimation" ? "DG.Tweening.DOTweenAnimation, DOTweenPro" : "Fwk.Tween.DOTweenSequence, Fwk",
  m_MethodName: method, m_Mode: mode, m_Arguments: { m_StringArgument: str }, m_CallState: 2 });
const abs = (cls, extra) => ({ type: "MonoBehaviour", class: cls, m_Enabled: 1, updateType: 0, isSpeedBased: 0,
  ...Object.fromEntries(EVENTS.map((e) => [`has${e[0].toUpperCase()}${e.slice(1)}`, 0])),
  ...Object.fromEntries(EVENTS.map((e) => [e, calls()])), ...extra });
const anim = (path, type, targetType, target, extra = {}) => abs("DOTweenAnimation", {
  targetIsSelf: 1, targetGO: { gameObject: path }, tweenTargetIsTargetGO: 1, delay: 0, duration: 1, easeType: 1, loopType: 0,
  loops: 1, id: "", isRelative: 0, isFrom: 0, isIndependentUpdate: 0, autoKill: 1, autoGenerate: 1, isActive: 1, isValid: 1,
  target, animationType: type, targetType, forcedTargetType: 0, autoPlay: 0, useTargetAsV3: 0, endValueFloat: 0,
  endValueV3: { x: 0, y: 0, z: 0 }, endValueV2: { x: 0, y: 0 }, endValueColor: { r: 1, g: 1, b: 1, a: 1 }, optionalBool0: 0,
  optionalBool1: 0, optionalFloat0: 0, optionalInt0: 0, optionalRotationMode: 0, optionalShakeRandomnessMode: 0, ...extra });
const image = () => ({ type: "MonoBehaviour", class: "Image", m_Enabled: 1, m_Material: null, m_Color: { r: 1, g: 1, b: 1, a: 1 },
  m_Sprite: null, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1 });
const node = (path, components, r = FULL) => ({ path, name: path.split("/").pop(), active: true, layer: 5, localPosition: Z,
  localRotation: Q, localScale: ONE, rect: r, components });
const ref = (gameObject, cls) => ({ component: "MonoBehaviour", gameObject, class: cls });
// a GameObject with a plain Transform (the prefabs keep their DOTween sequences under such a holder)
const holder = (path, components = []) => ({ path, name: path.split("/").pop(), active: true, layer: 5, localPosition: Z,
  localRotation: Q, localScale: ONE, components });

// a still: Img moves right over 1 s (sequence command, then Wait 0.5), its OnComplete plays the Orphan's fade; the
// sequence sits under a plain Transform holder
const stillDoc = () => ({ key: "Adv/Still/st", nodes: [
  node("st", [{ type: "CanvasGroup", m_Enabled: 1, m_Alpha: 1, m_Interactable: 1, m_BlocksRaycasts: 1, m_IgnoreParentGroups: 0 },
              abs("AdvStill", { _canvasGroup: { component: "CanvasGroup", gameObject: "st" }, _doTweenSequences: [ref("st/DOTweenData/Seq", "DOTweenSequence")] })],
       CENTER(1920, 1080)),
  node("st/Img", [image(), anim("st/Img", 1, 5, { transform: "st/Img" }, { endValueV3: { x: 100, y: 0, z: 0 }, hasOnComplete: 1,
                                                                            onComplete: calls([call("st/Orphan", "DOTweenAnimation", "DOPlay")]) })],
       CENTER(100, 100)),
  node("st/Orphan", [image(), anim("st/Orphan", 7, 3, ref("st/Orphan", "Image"), { duration: 0.5, endValueFloat: 0 })], CENTER(10, 10)),
  holder("st/DOTweenData"),
  holder("st/DOTweenData/Seq", [abs("DOTweenSequence", { _id: "", _isAutoPlay: 0, _isLoop: 0, _killOnDisable: 1, _list: [
    { _commandType: 0, _duration: 0.5, _tweenIndex: 0, _tweenAnimation: ref("st/Img", "DOTweenAnimation"), _tweenEvent: calls(), _useAnimationDuration: 0 },
    { _commandType: 2, _duration: 0.5, _tweenIndex: 0, _tweenAnimation: ref("st/Img", "DOTweenAnimation"), _tweenEvent: calls(), _useAnimationDuration: 0 },
  ] })]),
] });

const makePlayer = () => {
  const loop = new PlayerLoop(30);
  const docs = { "stills.json": { stills: { st: stillDoc() } }, "ui/ui.json": uiDoc() };
  const ctx = { loop, ui: { layers: createStoryUILayers() }, gl: null, camera: { setShakeOffset() {} },
                field: { root: { localPosition: { ...Z } } }, background: { root: { localPosition: { ...Z } } },
                episode: { commands: [{ i: 0, cmd: "Still", TargetAssetName: "st" }] },
                story: { stills: "stills.json", ui: "ui/ui.json" }, assets: { json: (p) => { assert.ok(docs[p], p); return docs[p]; } } };
  const p = { ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1,
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return this.shortCutIndex >= 0; },
              calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
              noWait(c, task) { if (c.IsNoWait) { task.catch((e) => { throw e; }); return Promise.resolve(); } return task; } };
  return { ctx, p, loop };
};
const run = (t, row) => commandHandler("Still")({ cmd: "Still", TargetAssetName: "st", ...row }, t.p);

test("Still: load kills the referenced animations' paused tweens; show fades in and plays the sequence; its callback plays the orphan", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p);
  const v = stillView(t.ctx), s = v.loaded("st");
  const img = s.prefab.node("st/Img"), orphan = s.prefab.node("st/Orphan");
  assert.equal(s.isShowing, false);
  assert.equal(s.cg.alpha, 0);
  assert.equal(s.animations[0].tween, null);                              // killed by the sequence's OnDisable
  assert.ok(s.animations[1].tween && !s.animations[1].tween.isPlaying);  // the orphan's paused Awake tween
  const frames = await settle(t.loop, run(t, { Parameter1: "0.5" }));
  assert.ok(frames >= 15 && frames <= 17, `${frames}`);
  assert.equal(s.isShowing, true);
  assert.equal(s.cg.alpha, 1);
  assert.equal(v.overlay.image.m_Color.a, 0);
  assert.equal(v.background.image.m_Color.a, 1);                          // Parameter4 0: the backdrop fades in
  assert.equal(v.postEffectSuppressed, true);
  assert.ok(img.anchoredPosition.x > 40 && img.anchoredPosition.x < 60, `${img.anchoredPosition.x}`);
  await steps(t.loop, 16);                                                // Img done: its OnComplete plays the orphan
  assert.equal(img.anchoredPosition.x, 100);
  await steps(t.loop, 8);
  assert.ok(orphan.image.m_Color.a > 0.3 && orphan.image.m_Color.a < 0.7, `${orphan.image.m_Color.a}`);
  await steps(t.loop, 10);
  assert.equal(orphan.image.m_Color.a, 0);
  assert.equal(s.animations[1].tween, null);                              // completed and killed: never re-created
  // hide at once (fade 0): alpha 0, sequences killed, inactive; the view's fades complete at the next update
  await settle(t.loop, run(t, {}));
  assert.equal(s.isShowing, false);
  assert.equal(s.cg.alpha, 0);
  assert.equal(v.background.image.m_Color.a, 0);
  assert.equal(v.postEffectSuppressed, false);
  assert.equal(s.sequenceComponents[0].sequence, null);
  disposeStoryFeatures(t.ctx);
});

test("Still: Parameter2 / 3 / 4, IsNoWait, playback speed, contained scale, last sibling, shake target, unknown stills", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p);
  const v = stillView(t.ctx), s = v.loaded("st");
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  await settle(t.loop, run(t, { Parameter2: "0.4", Parameter3: "3", Parameter4: "0.6" }));
  console.warn = warn;
  assert.equal(warned, 1);                                                // index out of range: nothing plays
  assert.equal(s.cg.alpha, Math.fround(0.4));
  assert.equal(v.overlay.image.m_Color.a, Math.fround(0.6));
  assert.equal(v.background.image.m_Color.a, 0);                          // Parameter4 > 0: backdrop untouched
  assert.equal(s.sequenceComponents[0].sequence, null);
  await settle(t.loop, run(t, { IsNoWait: 1 }));                          // hide, not awaited
  await steps(t.loop, 2);
  assert.equal(s.isShowing, false);
  await settle(t.loop, run(t, { Parameter2: "5" }));                      // > 1 -> 1, sequence 0 plays
  assert.equal(s.cg.alpha, 1);
  setStoryFeaturesSpeed(t.ctx, 2);
  assert.equal(s.sequenceComponents[0].sequence.timeScale, 2);
  v.screen.layoutAll(2340, 1080);                                         // 13:6: 1920 x 886.15 units
  assert.ok(Math.abs(v.target.localScale.x - 886.1538 / 1080) < 1e-4, `${v.target.localScale.x}`);
  assert.deepEqual(v.target.children.map((n) => n.name), ["st"]);
  // the shake works in world units: the canvas' lossy scale = the view height at the plane distance / canvas height
  const u = Math.fround(Math.fround(200 * Math.fround(Math.tan(Math.fround(30) * Math.PI / 180))) / v.screen.canvas.still.size.H);
  assert.equal(v.screen.worldPerCanvasUnit("still"), u);
  const img = () => v.screen.canvas.still.drawItems().find((it) => it.node.name === "Img").verts;
  const flat = img();
  shakes(t.ctx).still.set({ x: 3, y: 4, z: 10 });
  assert.deepEqual(v.target.anchoredPosition, { x: Math.fround(3 / u), y: Math.fround(4 / u) });
  assert.equal(v.target.localZ, Math.fround(10 / u));
  // off the canvas plane: the mesh keeps its z; the camera's projection scales it about the view centre by D / (D + z)
  v.screen.layoutAll(2340, 1080);
  const { W, H } = v.screen.canvas.still.size, D = H / (2 * Math.tan(Math.PI / 6)), k = D / (D + 10 / u);
  const near = img();
  const cx = W / 2, cy = H / 2, x0 = flat[0] + 3 / u, y0 = flat[1] + 4 / u;       // the offset is in the parent space
  assert.ok(Math.abs(near[0] - x0) < 0.01 && Math.abs(near[1] - y0) < 0.01 && Math.abs(near[2] - 10 / u) < 0.01, `${near.slice(0, 3)}`);
  const vp = viewProjection(60, W, H), cw = vp[3] * near[0] + vp[7] * near[1] + vp[11] * near[2] + vp[15];
  const sx = ((vp[0] * near[0] + vp[12]) / cw + 1) / 2 * W, sy = ((vp[5] * near[1] + vp[13]) / cw + 1) / 2 * H;
  assert.ok(Math.abs(sx - (cx + (x0 - cx) * k)) < 0.05 && Math.abs(sy - (cy + (y0 - cy) * k)) < 0.05, `${sx} ${sy}`);
  shakes(t.ctx).still.stop();
  assert.deepEqual(v.target.anchoredPosition, { x: 0, y: 0 });
  assert.equal(v.target.localZ, Math.fround(10 / u));                    // StopShake keeps the z
  // the video and still camera blends the ADV volumes, none while a still suppresses them
  t.ctx.volume = { evaluateStack: () => "adv volumes" };
  v.postEffectSuppressed = true;
  assert.deepEqual(v.screen.cameraStack(), URPPost.evaluateStack([]));
  v.postEffectSuppressed = false;
  assert.equal(v.screen.cameraStack(), "adv volumes");
  await assert.rejects(run(t, { TargetAssetName: "nope" }), /not loaded/);
  disposeStoryFeatures(t.ctx);
});

test("Alpha: showing stills fade to Clamp01(Parameter1) over Duration; other canvas layers do nothing", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p);
  const s = stillView(t.ctx).loaded("st");
  const alpha = (row) => commandHandler("Alpha")({ cmd: "Alpha", ...row }, t.p);
  await settle(t.loop, alpha({ Parameter1: "0.5", Duration: 1 }));        // nothing showing: completes at once
  assert.equal(s.cg.alpha, 0);
  await settle(t.loop, run(t, {}));
  const frames = await settle(t.loop, alpha({ Parameter1: "0.5", Duration: 1, CanvasLayers: [7] }));
  assert.ok(frames >= 30 && frames <= 32, `${frames}`);
  assert.equal(s.cg.alpha, 0.5);
  await settle(t.loop, alpha({ Parameter1: "3", CanvasLayers: [2, 5] }));
  assert.equal(s.cg.alpha, 0.5);
  await settle(t.loop, alpha({ Parameter1: "-1" }));                      // no layers: stills and video, at once
  assert.equal(s.cg.alpha, 0);
  disposeStoryFeatures(t.ctx);
});

test("DOTween.Shake: the Harmonic randomness mode draws its angle steps from Random.Range(0, randomness)", async () => {
  const { shakeWaypoints } = await import("../../src/story/features/dotween.js");
  const draws = [];
  const random = { range: (a, b) => { draws.push([a, b]); return a; } };
  shakeWaypoints(1, { x: 10, y: 10, z: 10 }, 3, 90, false, true, true, random, true);
  assert.deepEqual(draws, [[0, 360], [0, 90], [0, 90], [0, 90]]);
  draws.length = 0;
  shakeWaypoints(1, { x: 10, y: 10, z: 10 }, 3, 90, false, true, true, random, false);
  assert.deepEqual(draws, [[0, 360], [-90, 90], [-90, 90], [-90, 90]]);
});
