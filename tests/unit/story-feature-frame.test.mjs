// Frame (AdvFrameCommand) on a real PlayerLoop at 30 fps with synthetic frame prefabs: the toggle, Show / Hide
// states, named states, the CanvasGroup fade, sibling order, the pre-delay, canvas size and the comment texts.
// Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { EASE } from "../../src/engine/tween.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { frameView, slanderText } from "../../src/story/features/frame.js";
import { clampedCanvasSize } from "../../src/story/features/canvas.js";

const FLT_MIN = -3.4028234663852886e+38;
const flush = () => new Promise((res) => setImmediate(res));
const settle = async (loop, promise, max = 400) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  while (!done && loop.frameCount < max) await loop.step();
  assert.ok(done, "not settled");
  return loop.frameCount;
};

// a raw Mecanim clip: linear curves {binding, from, to} over [0, len], or constants when len is 0
const clip = (name, len, loop, curves) => {
  const bindings = curves.map((c) => c.b);
  const streamed = len > 0 ? { curveCount: curves.length, frames: [
    [FLT_MIN, curves.map((c, i) => [i, 0, 0, 0, c.from])],
    [0, curves.map((c, i) => [i, 0, 0, (c.to - c.from) / len, c.from])],
    [len, curves.map((c, i) => [i, 0, 0, 0, c.to])]] } : { curveCount: 0, frames: [] };
  return { clip: name, sampleRate: 60, wrapMode: 0, startTime: 0, stopTime: len, loopTime: loop, cycleOffset: 0, events: [],
           bindings, streamed, dense: { curveCount: 0, frameCount: 0, sampleRate: 60, beginTime: 0, samples: [] },
           constant: len > 0 ? [] : curves.map((c) => c.to) };
};
const state = (name, speed, clipIndex, loop, transitions = []) => ({
  name, path: `Base Layer.${name}`, speed, cycleOffset: 0, loop, writeDefaultValues: true, mirror: false, speedParam: "",
  timeParam: "", blendTrees: clipIndex === null ? [] : [[{ clip: clipIndex, duration: 1, blendType: 0, children: [] }]],
  transitions });
const alphaB = { path: "", typeID: 225, class: "CanvasGroup", attribute: "m_Alpha" };
const topB = { path: "Top", typeID: 224, class: "RectTransform", attribute: "m_AnchoredPosition.y" };

const rect = (aMin, aMax, pos, size, pivot) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax, m_AnchoredPosition: pos,
                                                   m_SizeDelta: size, m_Pivot: pivot });
const FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
const node = (path, components, r = FULL) => ({ path, name: path.split("/").pop(), active: true, layer: 5, tag: 0,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  rect: r, components });
const cg = (a) => ({ type: "CanvasGroup", m_Enabled: 1, m_Alpha: a, m_Interactable: true, m_BlocksRaycasts: true,
                     m_IgnoreParentGroups: false });
const image = (color) => ({ type: "MonoBehaviour", class: "Image", m_Enabled: 1, m_Material: null, m_Color: color,
  m_Sprite: null, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1 });

// letterbox-like frame: Show / Hide states at speed 1000, Show_anime -> Show at exit time 1
const letterbox = (name) => {
  const ctrl = { controller: name, name, parameters: [], defaultValues: [],
    layers: [{ name: "Base Layer", stateMachine: 0, defaultWeight: 0, blending: 0 }],
    clips: [clip("in", 0.5, false, [{ b: topB, from: 200, to: 0 }, { b: alphaB, from: 0, to: 0.8 }]),
            clip("loop", 0, true, [{ b: alphaB, to: 0.8 }, { b: topB, to: 0 }]),
            clip("out", 0.5, false, [{ b: alphaB, from: 0.8, to: 0 }, { b: topB, from: 0, to: 200 }]),
            clip("out2", 0, false, [{ b: alphaB, to: 0.8 }, { b: topB, to: 0 }])],
    stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: [
      state("none", 1, null, true), state("Show", 1000, 1, true), state("Hide_anime", 1, 2, false),
      state("Show_anime", 1, 0, false, [{ destination: 1, duration: 0, offset: 0, exitTime: 1, hasExitTime: true,
                                          fixedDuration: true, canTransitionToSelf: true, conditions: [] }]),
      state("Hide", 1000, 3, false)] }] };
  const animator = { type: "Animator", m_Enabled: 1, m_Controller: ctrl, m_CullingMode: 0, m_UpdateMode: 0,
                     m_ApplyRootMotion: false, m_KeepAnimatorStateOnDisable: false };
  return { key: `Adv/Frame/${name}`, nodes: [
    node(name, [{ type: "MonoBehaviour", class: "AdvFrame", m_Enabled: 1, _canvasGroup: { component: "CanvasGroup", gameObject: name },
                  _animator: { component: "Animator", gameObject: `${name}/Root` }, _screenPadding: null }, cg(0.8)]),
    node(`${name}/Root`, [animator, cg(1)]),
    node(`${name}/Root/Top`, [], rect({ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 70 }, { x: 0.5, y: 1 })),
    node(`${name}/Root/Top/Image`, [{ type: "CanvasRenderer" }, image({ r: 0, g: 0, b: 0, a: 1 })]),
  ] };
};
const fill = (name) => ({ key: `Adv/Frame/${name}`, nodes: [
  node(name, [{ type: "MonoBehaviour", class: "AdvFrame", m_Enabled: 1, _canvasGroup: { component: "CanvasGroup", gameObject: name },
                _animator: null, _screenPadding: null }, cg(1)]),
  node(`${name}/Fill`, [{ type: "CanvasRenderer" }, image({ r: 1, g: 1, b: 1, a: 1 })]),
] });

// the screen canvases of the story UI data (ui/ui.json) as the exporter writes them
const CLAMPED = { m_Enabled: 1, m_UiScaleMode: 1, m_ReferencePixelsPerUnit: 100, m_ScaleFactor: 1,
                  m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 0,
                  class: "ClampedCanvasScaler", _maxAspectThreshold: Math.fround(13 / 6) };
const uiDoc = () => {
  const Z = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 };
  const rec = (path, extra = {}, r = FULL) => ({ path, name: path.split("/").pop(), active: true, localPosition: Z,
                                                 localRotation: Q, localScale: ONE, rect: r, ...extra });
  const cam = "UIAdvWidget/VideoAndStillCamera";
  const canvas = (path, order, scaler, camera = cam) => rec(path, { canvas: { m_Enabled: 1, m_RenderMode: 1, m_SortingOrder: order,
    m_OverrideSorting: false, m_PixelPerfect: false, camera, m_PlaneDistance: 100 }, canvasScaler: scaler });
  return { nodes: [
    canvas("UIAdvWidget/VideoCanvas", 301, { ...CLAMPED, m_ScreenMatchMode: 1, class: undefined }),
    canvas("UIAdvWidget/StillCanvas", 302, CLAMPED),
    rec("UIAdvWidget/StillCanvas/AdvStillView", { stillView: { enabled: 1, _overlay: "UIAdvWidget/StillCanvas/AdvStillView/Overlay",
      _background: "UIAdvWidget/StillCanvas/AdvStillView/Background", _target: "UIAdvWidget/StillCanvas/AdvStillView/Target" } }),
    rec("UIAdvWidget/StillCanvas/AdvStillView/Overlay", { image: { m_Enabled: 1, m_Color: { r: 0, g: 0, b: 0, a: 0 }, m_Type: 0,
      m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1, sprite: null, material: null } },
      rect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: 2048, y: 2048 }, { x: 0.5, y: 0.5 })),
    { ...rec("UIAdvWidget/StillCanvas/AdvStillView/Background", { image: { m_Enabled: 1, m_Color: { r: 0, g: 0, b: 0, a: 1 },
      m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1, sprite: null, material: null } }),
      active: false },
    rec("UIAdvWidget/StillCanvas/AdvStillView/Target"),
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

const makePlayer = (rows, frames) => {
  const loop = new PlayerLoop(30);
  const ui = { layers: createStoryUILayers() };
  const docs = { "frames.json": { frames }, "ui/ui.json": uiDoc() };
  const ctx = { loop, ui, episode: { commands: rows.map((r, i) => ({ i, ...r })) }, story: { frames: "frames.json", ui: "ui/ui.json" },
                assets: { json: (p) => { assert.ok(docs[p], p); return docs[p]; } }, gl: null,
                localize: (id) => `text ${id}` };
  const p = {
    ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1, delayOk: true,
    speedRate() { return this.playbackSpeed / 10; },
    get shortcut() { return this.shortCutIndex >= 0; },
    calcDuration(d, def = 0) { return this.shortcut ? 0 : (d ? Math.max(d, 0) : def) / this.speedRate(); },
    delay(sec) { return this.delayOk ? loop.delay(sec) : Promise.resolve(false); },
    ease(s, def = EASE.OutQuad) { return def; },
    noWait(c, task) { if (c.IsNoWait) { task.catch((e) => { throw e; }); return Promise.resolve(); } return task; },
  };
  return { ctx, p, loop };
};

const run = (t, row) => commandHandler("Frame")({ cmd: "Frame", ...row }, t.p);

test("Frame: an empty Parameter2 toggles; the Show state waits one frame, then its normalized time", async () => {
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "lb" }], { lb: letterbox("lb") });
  await installStoryFeatures(t.ctx, t.p);
  const f = frameView(t.ctx).loaded("lb");
  assert.equal(f.isShowing, false);                                       // Init: inactive
  assert.equal(f.animator.currentState().state.name, "none");
  const shown = await settle(t.loop, run(t, { TargetAssetName: "lb" }));
  assert.equal(shown, 2);                                                 // NextFrame, then the first poll
  assert.equal(f.isShowing, true);
  assert.equal(f.cg.alpha, 1);
  assert.equal(f.animator.currentState().state.name, "Show");
  assert.equal(f.prefab.node("lb/Root").canvasGroup.alpha, Math.fround(0.8));   // the Show clip's constant
  // second row: HideFrame with the Hide state (the fade is not used), inactive at the end
  await settle(t.loop, run(t, { TargetAssetName: "lb", Parameter1: "2" }));
  assert.ok(t.loop.frameCount - shown < 5);
  assert.equal(f.isShowing, false);
  assert.equal(f.cg.alpha, 0);
  disposeStoryFeatures(t.ctx);
});

test("Frame: a Show pre-delay of Parameter1 seconds at alpha 0, then the Show state", async () => {
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "lb" }], { lb: letterbox("lb") });
  await installStoryFeatures(t.ctx, t.p);
  const f = frameView(t.ctx).loaded("lb");
  const task = run(t, { TargetAssetName: "lb", Parameter1: "0.5" });
  await flush();
  for (let i = 0; i < 10; i++) await t.loop.step();
  assert.equal(f.isShowing, true);
  assert.equal(f.cg.alpha, 0);                                            // WaitForSeconds(0.5) at alpha 0
  assert.equal(f.animator.currentState().state.name, "none");
  await settle(t.loop, task);
  assert.equal(f.cg.alpha, 1);
  assert.equal(f.animator.currentState().state.name, "Show");
  disposeStoryFeatures(t.ctx);
});

test("Frame: a named state plays from time 0 to its end; its exit-time transition leads to Show", async () => {
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "lb" }], { lb: letterbox("lb") });
  await installStoryFeatures(t.ctx, t.p);
  const f = frameView(t.ctx).loaded("lb");
  const top = f.prefab.node("lb/Root/Top");
  const task = run(t, { TargetAssetName: "lb", Parameter2: "Show_anime" });
  assert.equal(f.isShowing, true);                                        // a hidden frame is shown at alpha 1
  assert.equal(f.cg.alpha, 1);
  await flush();
  for (let i = 0; i < 8; i++) await t.loop.step();
  assert.equal(f.animator.currentState().state.name, "Show_anime");
  assert.ok(top.anchoredPosition.y > 50 && top.anchoredPosition.y < 150);  // half way down from 200
  const end = await settle(t.loop, task);
  assert.ok(end >= 15 && end <= 18, `ended at ${end}`);
  assert.equal(f.animator.currentState().state.name, "Show");
  assert.equal(top.anchoredPosition.y, 0);
  // an unknown state: nothing (a warning), the row completes at once
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  const f0 = t.loop.frameCount;
  assert.equal(await settle(t.loop, run(t, { TargetAssetName: "lb", Parameter2: "Missing" })), f0);
  console.warn = warn;
  assert.equal(warned, 1);
  disposeStoryFeatures(t.ctx);
});

test("Frame: without an Animator the CanvasGroup fades over Parameter1 (or Duration) with OutQuad", async () => {
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "w" }], { w: fill("w") });
  await installStoryFeatures(t.ctx, t.p);
  const f = frameView(t.ctx).loaded("w");
  const task = run(t, { TargetAssetName: "w", Duration: 1 });
  await flush();
  for (let i = 0; i < 15; i++) await t.loop.step();
  assert.ok(f.cg.alpha > 0.7 && f.cg.alpha < 0.8, `alpha ${f.cg.alpha}`);  // OutQuad at half time: 0.75
  await settle(t.loop, task);
  assert.equal(f.cg.alpha, 1);
  // hide at once (no fade), inactive
  await settle(t.loop, run(t, { TargetAssetName: "w" }));
  assert.equal(f.isShowing, false);
  assert.equal(f.cg.alpha, 0);
  disposeStoryFeatures(t.ctx);
});

test("Frame: the latest row's frame is the last sibling; a cancelled pre-delay shows nothing; unknown frames fail", async () => {
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "a" }, { cmd: "Frame", TargetAssetName: "b" }],
                       { a: fill("a"), b: fill("b") });
  await installStoryFeatures(t.ctx, t.p);
  const v = frameView(t.ctx), a = v.loaded("a"), b = v.loaded("b");
  await settle(t.loop, run(t, { TargetAssetName: "b" }));
  await settle(t.loop, run(t, { TargetAssetName: "a" }));
  assert.deepEqual(v.node.children.map((n) => n.name), ["b", "a"]);
  await settle(t.loop, run(t, { TargetAssetName: "b" }));                // hide b: moved to the end first
  assert.deepEqual(v.node.children.map((n) => n.name), ["a", "b"]);
  t.p.delayOk = false;                                                    // CancelDelay during DelaySeconds
  await settle(t.loop, run(t, { TargetAssetName: "b", DelaySeconds: 1 }));
  assert.equal(b.isShowing, false);
  assert.equal(a.isShowing, true);
  await assert.rejects(run(t, { TargetAssetName: "nope" }), /not loaded/);
  disposeStoryFeatures(t.ctx);
});

test("FrameCanvas: ClampedCanvasScaler size and the frame root at the view's pivot", async () => {
  const s = clampedCanvasSize(CLAMPED, 2340, 1080);
  assert.equal(s.W, 1920);
  assert.ok(Math.abs(s.H - 886.1538) < 1e-3);
  const wide = clampedCanvasSize(CLAMPED, 2400, 1000);                  // above the threshold: 13/6 / aspect
  assert.ok(Math.abs(wide.scale - Math.fround(13 / 6) / 2.4) < 1e-9);
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "lb" }], { lb: letterbox("lb") });
  await installStoryFeatures(t.ctx, t.p);
  await settle(t.loop, run(t, { TargetAssetName: "lb" }));
  const screen = frameView(t.ctx).screen;
  screen.layoutAll(2340, 1080);
  const img = frameView(t.ctx).loaded("lb").prefab.node("lb/Root/Top/Image");
  const box = img.canvasBox();                                            // top band: full width, 70 units high
  assert.deepEqual(box.map((x) => Math.round(x * 100) / 100), [0, 816.15, 1920, 886.15]);
  disposeStoryFeatures(t.ctx);
});

test("frame comment text helpers: user id budget and the body break", () => {
  assert.equal(slanderText.userId("abc", "0123456789abcdefghij"), "@0123456789abcdef");   // 19 - 3 elements
  assert.equal(slanderText.userId("a".repeat(19), "x"), "");
  assert.equal(slanderText.body("a".repeat(25)), `${"a".repeat(20)}\n${"a".repeat(5)}`);
  assert.equal(slanderText.body("ab\r\ncd"), "ab\ncd");
});

test("Frame: a UIParticle node plays headless but refuses to be drawn while visible", async () => {
  const sparkle = (name) => ({ key: `Adv/Frame/${name}`, nodes: [
    ...fill(name).nodes,
    node(`${name}/Fx`, [{ type: "CanvasRenderer" }, { type: "MonoBehaviour", class: "UIParticle", m_Enabled: 1 },
                        { type: "ParticleSystem" }, { type: "ParticleSystemRenderer" }]),
  ] });
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: "s" }], { s: sparkle("s") });
  await installStoryFeatures(t.ctx, t.p);
  const v = frameView(t.ctx), s = v.loaded("s"), canvas = v.screen.canvas.frame;
  v.screen.layoutAll(2340, 1080);
  assert.deepEqual(canvas.drawItems(), []);                               // not shown: nothing drawn, no refusal
  await settle(t.loop, run(t, { TargetAssetName: "s" }));
  assert.equal(s.isShowing, true);
  v.screen.layoutAll(2340, 1080);
  assert.throws(() => canvas.drawItems(), /s\/Fx: UIParticle \/ ParticleSystem \/ ParticleSystemRenderer not drawn/);
  disposeStoryFeatures(t.ctx);
});

test("Frame: a RectTransform under a plain Transform is laid out against a zero-size rect at the Transform's origin", async () => {
  const name = "t";
  const plain = { path: `${name}/Holder`, name: "Holder", active: true, layer: 5, tag: 0, localPosition: { x: 100, y: 50, z: 0 },
                  localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 2, y: 2, z: 1 }, components: [] };
  const img = node(`${name}/Holder/Img`, [{ type: "CanvasRenderer" }, image({ r: 1, g: 1, b: 1, a: 1 })],
                   rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 10, y: 0 }, { x: 20, y: 20 }, { x: 0.5, y: 0.5 }));
  const t = makePlayer([{ cmd: "Frame", TargetAssetName: name }], { [name]: { key: `Adv/Frame/${name}`, nodes: [...fill(name).nodes, plain, img] } });
  await installStoryFeatures(t.ctx, t.p);
  await settle(t.loop, run(t, { TargetAssetName: name }));
  const v = frameView(t.ctx);
  v.screen.layoutAll(2340, 1080);
  const box = v.loaded(name).prefab.node(`${name}/Holder/Img`).canvasBox();
  const W = 1920, H = v.screen.canvas.frame.size.H;                        // the frame root fills the canvas: origin at its centre
  const cx = W / 2 + 100 + 2 * 10, cy = H / 2 + 50;                       // anchors at the holder's origin, then its scale 2
  assert.deepEqual(box.map((x) => Math.round(x * 100) / 100),
                   [cx - 20, cy - 20, cx + 20, cy + 20].map((x) => Math.round(x * 100) / 100));
  disposeStoryFeatures(t.ctx);
});
