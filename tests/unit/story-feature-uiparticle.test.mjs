import { screenResources } from "./story-screen-resources.mjs";
// Coffee UIParticle on the frame canvas (uiparticle.js) with synthetic frame prefabs, particle systems and UI camera:
// the baked quad on the canvas for each auto scaling mode and simulation space, the driven scale, the generated
// renderer nodes, activity, the checks at load and the headless path. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { EASE } from "../../src/engine/tween.js";
import { UI_STRIDE } from "../../src/engine/ugui.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { frameView } from "../../src/story/features/frame.js";
import { featureState } from "../../src/story/features/state.js";

const flush = () => new Promise((res) => setImmediate(res));
const settle = async (loop, promise, max = 400) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  while (!done && loop.frameCount < max) await loop.step();
  assert.ok(done, "not settled");
};

const Z = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 };
const rect = (aMin, aMax, pos, size, pivot) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax, m_AnchoredPosition: pos,
                                                   m_SizeDelta: size, m_Pivot: pivot });
const FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
const node = (path, components, extra = {}) => ({ path, name: path.split("/").pop(), active: true, layer: 5, tag: 0,
  localPosition: Z, localRotation: Q, localScale: ONE, rect: FULL, components, ...extra });
const cg = (a) => ({ type: "CanvasGroup", m_Enabled: 1, m_Alpha: a, m_Interactable: true, m_BlocksRaycasts: true,
                     m_IgnoreParentGroups: false });

// a particle system: one particle at t = 0, still, lifetime 5
const mm = (v) => ({ minMaxState: 0, scalar: v, minScalar: v });
const off = { enabled: 0 };
const ps = ({ space = 0, scaling = 0, emission = 1, prewarm = 0, extra = {} } = {}) => ({ type: "ParticleSystem",
  lengthInSec: 5, looping: 1, prewarm, playOnAwake: 1, simulationSpeed: 1, stopAction: 0, cullingMode: 0, startDelay: mm(0),
  moveWithTransform: space, scalingMode: scaling, emitterVelocityMode: 0, useUnscaledTime: 0, autoRandomSeed: 1, randomSeed: 0,
  ringBufferMode: 0,
  InitialModule: { startLifetime: mm(5), startSpeed: mm(0), startColor: { minMaxState: 0, maxColor: { r: 1, g: 1, b: 1, a: 1 } },
                   startSize: mm(1), startSizeY: mm(1), startSizeZ: mm(1), size3D: 0, startRotationX: mm(0), startRotationY: mm(0),
                   startRotation: mm(0), rotation3D: 0, randomizeRotationDirection: 0, gravityModifier: mm(0), gravitySource: 0,
                   maxNumParticles: 100 },
  EmissionModule: { enabled: emission, rateOverTime: mm(0), rateOverDistance: mm(0), m_BurstCount: 1,
                    m_Bursts: [{ time: 0, countCurve: mm(1), cycleCount: 1, repeatInterval: 0.01, probability: 1 }] },
  ShapeModule: { enabled: 0, type: 0, m_Position: Z, m_Rotation: Z, m_Scale: ONE, radius: { value: 1, mode: 0 },
                 arc: { value: 360, mode: 0 }, angle: 25, length: 5, radiusThickness: 1, boxThickness: Z, randomDirectionAmount: 0,
                 sphericalDirectionAmount: 0, randomPositionAmount: 0, alignToDirection: 0 },
  SizeModule: off, ColorModule: off, VelocityModule: off, ClampVelocityModule: off, RotationModule: off, ForceModule: off,
  NoiseModule: off, CustomDataModule: off, ...extra });
const MAT = { material: "glow", shader: { shader: "UI/Additive" }, keywords: [],
              textures: { _MainTex: { texture: { texture: "textures/glow.png", width: 4, height: 4 }, scale: { x: 1, y: 1 }, offset: { x: 0, y: 0 } } } };
const psr = (enabled = 0, material = MAT) => ({ type: "ParticleSystemRenderer", m_Enabled: enabled, m_RenderMode: 0,
  m_RenderAlignment: 0, m_Pivot: Z, m_Flip: Z, m_MinParticleSize: 0, m_MaxParticleSize: 0, m_SortMode: 0, m_SortingLayer: 0,
  m_SortingLayerID: 0, m_SortingOrder: 0, m_NormalDirection: 1, m_MaskInteraction: 0, m_UseCustomVertexStreams: 0,
  m_VertexStreams: [], m_LengthScale: 2, m_VelocityScale: 0, m_CameraVelocityScale: 0, m_FreeformStretching: 0,
  m_Materials: [material] });
const uip = (o = {}) => ({ type: "MonoBehaviour", class: "UIParticle", m_Enabled: 1, m_IgnoreCanvasScaler: 0, m_AbsoluteMode: 0,
  m_AutoScaling: 0, m_Scale3D: { x: 10, y: 10, z: 10 }, m_AnimatableProperties: [], m_Particles: [], m_MeshSharing: 0,
  m_GroupId: 0, m_GroupMaxId: 0, m_PositionMode: 0, m_AutoScalingMode: 2, m_UseCustomView: 0, m_CustomViewSize: 10,
  m_TimeScaleMultiplier: 1, ...o });

// frame "f": the AdvFrame root (CanvasGroup alpha), and an Fx node 200 canvas units right of the centre
const frame = (fx, more = []) => ({ key: "Adv/Frame/f", nodes: [
  node("f", [{ type: "MonoBehaviour", class: "AdvFrame", m_Enabled: 1, _canvasGroup: { component: "CanvasGroup", gameObject: "f" },
              _animator: null, _screenPadding: null }, cg(1)]),
  node("f/Fx", fx, { rect: rect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 200, y: 0 }, { x: 100, y: 100 }, { x: 0.5, y: 0.5 }) }),
  ...more,
] });

const CLAMPED = { m_Enabled: 1, m_UiScaleMode: 1, m_ReferencePixelsPerUnit: 100, m_ScaleFactor: 1,
                  m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 1,
                  class: "ClampedCanvasScaler", _maxAspectThreshold: Math.fround(13 / 6) };
const UI_CAMERA = { path: "UIManager/UICamera", active: true, camera: { m_Enabled: 1, orthographic: 1, "orthographic size": 5,
  "near clip plane": 0.3, "far clip plane": 1000, "field of view": 60 }, additionalCameraData: { m_CameraType: 1 } };
const uiDoc = (uiCamera) => {
  const rec = (path, extra = {}) => ({ path, name: path.split("/").pop(), active: true, localPosition: Z, localRotation: Q,
                                       localScale: ONE, rect: FULL, ...extra });
  const cam = "UIAdvWidget/VideoAndStillCamera";
  const canvas = (path, order, scaler, camera = cam) => rec(path, { canvas: { m_Enabled: 1, m_RenderMode: 1, m_SortingOrder: order,
    m_OverrideSorting: false, m_PixelPerfect: false, camera, m_PlaneDistance: 100 }, canvasScaler: scaler });
  return { nodes: [
    canvas("UIAdvWidget/VideoCanvas", 301, CLAMPED), canvas("UIAdvWidget/StillCanvas", 302, CLAMPED),
    canvas("UIAdvWidget/VideoAndStillRenderScreenCanvas", 302, { ...CLAMPED, m_Enabled: 0 }, undefined),
    rec("UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen", { rawImage: { m_Enabled: 1, m_Color: { r: 1, g: 1, b: 1, a: 1 },
      m_UVRect: { x: 0, y: 0, width: 1, height: 1 }, texture: null, material: null } }),
    canvas("UIAdvWidget/FrameCanvas", 303, CLAMPED, undefined),
  ], sprites: {}, textures: {},
  videoAndStillCamera: { path: cam, camera: { m_Enabled: 1, m_ClearFlags: 2, m_BackGroundColor: { r: 0, g: 0, b: 0, a: 0 },
    m_NormalizedViewPortRect: { x: 0, y: 0, width: 1, height: 1 }, orthographic: false, "field of view": 60,
    "near clip plane": 0.3, "far clip plane": 1000, m_HDR: true },
    additionalCameraData: { m_RenderPostProcessing: 1, m_VolumeLayerMask: { m_Bits: 2048 }, m_Antialiasing: 0 } },
  videoAndStillScreenImage: "UIAdvWidget/VideoAndStillRenderScreenCanvas/Screen", ...(uiCamera ? { uiCamera } : {}) };
};

const setup = async (doc, { uiCamera = UI_CAMERA } = {}) => {
  const loop = new PlayerLoop(30);
  const docs = { "frames.json": { frames: { f: doc } }, "ui/ui.json": uiDoc(uiCamera) };
  const ctx = { loop, ui: { layers: createStoryUILayers() }, episode: { commands: [{ i: 0, cmd: "Frame", TargetAssetName: "f" }] },
                story: { frames: "frames.json", ui: "ui/ui.json" }, gl: null, localize: (id) => `text ${id}`,
                assets: { json: (p) => { assert.ok(docs[p], p); return docs[p]; } } };
  screenResources(ctx, docs["ui/ui.json"], { f: doc });
  const p = { ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1, speedRate() { return 1; }, get shortcut() { return false; },
              calcDuration(d, def = 0) { return d ? Math.max(d, 0) : def; }, delay: (sec) => loop.delay(sec),
              ease(s, def = EASE.OutQuad) { return def; }, noWait(c, task) { return task; } };
  await installStoryFeatures(ctx, p);
  const v = frameView(ctx), screen = v.screen, canvas = screen.canvas.frame;
  // the next frame drawn without GL: a loop step, then layout, the UIParticle refresh and the draw items
  // (StoryScreen.render)
  const draw = async () => {
    await loop.step();
    screen.layoutAll(2340, 1080);
    if (screen.frameParticles) screen.frameParticles.refresh(loop);
    return canvas.drawItems((n, a) => screen._extra(n, a));
  };
  const show = () => settle(loop, commandHandler("Frame")({ cmd: "Frame", TargetAssetName: "f" }, p));
  return { ctx, loop, v, screen, canvas, draw, show, f: v.loaded("f") };
};

const corners = (it) => [0, 1, 2, 3].map((i) => [it.verts[i * UI_STRIDE], it.verts[i * UI_STRIDE + 1]]);
const near = (a, b, eps = 1e-3) => a.forEach((v, i) => v.forEach((x, k) => assert.ok(Math.abs(x - b[i][k]) <= eps, `v${i}.${k} ${x} vs ${b[i][k]}`)));
// the Fx quad: 1 particle unit x scale3D 10 = 10 canvas units around the node (200 right of the centre)
const fxQuad = (canvas) => {
  const cx = canvas.size.W / 2 + 200, cy = canvas.size.H / 2;
  return [[cx - 5, cy - 5], [cx + 5, cy - 5], [cx + 5, cy + 5], [cx - 5, cy + 5]];
};

test("UIParticle: a Transform-scaled system is baked with the UI camera into a canvas quad of scale3D canvas units", async () => {
  const t = await setup(frame([{ type: "CanvasRenderer" }, uip(), ps(), psr()]));
  const fx = t.f.prefab.node("f/Fx");
  assert.equal((await t.draw()).length, 0);                                  // hidden: nothing, and no refusal
  await t.show();
  const items = (await t.draw());
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.node.name, "[generated] UIParticleRenderer");
  assert.equal(fx.children[fx.children.length - 1], it.node);         // the last child of the UIParticle
  assert.equal(it.material, t.ctx.objects.material(MAT));
  assert.equal(it.texture, "textures/glow.png");
  assert.ok(t.canvas.materials.has("glow") && t.canvas.textures.has("textures/glow.png"));
  near(corners(it), fxQuad(t.canvas));
  // AutoScalingMode Transform drives the node's scale to the inverse of the parent's lossy scale (the canvas scale)
  const s = 2 * 5 / t.canvas.size.H;
  assert.ok(Math.abs(fx.localScale.x - 1 / s) < 1e-2 && Math.abs(fx.localScaleZ - 1 / s) < 1e-2);
  // the vertex alpha follows the inherited CanvasGroup alpha
  t.f.cg.alpha = 0.5;
  assert.equal((await t.draw())[0].verts[6], 0.5);
  // hidden again: OnDisable gives the scale back and resets the renderer
  t.f.setActive(false);
  assert.equal((await t.draw()).length, 0);
  assert.deepEqual([fx.localScale.x, fx.localScale.y, fx.localScaleZ], [1, 1, 1]);
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: the None scaling mode and a World-space system give the same quad", async () => {
  for (const [comp, sys] of [[uip({ m_AutoScalingMode: 0 }), ps()], [uip(), ps({ space: 1 })], [uip({ m_AutoScalingMode: 0 }), ps({ space: 1 })]]) {
    const t = await setup(frame([{ type: "CanvasRenderer" }, comp, sys, psr()]));
    await t.show();
    near(corners((await t.draw())[0]), fxQuad(t.canvas));
    if (comp.m_AutoScalingMode === 0) assert.equal(t.f.prefab.node("f/Fx").localScale.x, 1);
    disposeStoryFeatures(t.ctx);
  }
});

test("UIParticle: a child system is placed relative to the UIParticle and scaled with it", async () => {
  const child = node("f/Fx/Child", [ps(), psr()], { localPosition: { x: 3, y: 0, z: 0 }, rect: undefined });
  const t = await setup(frame([{ type: "CanvasRenderer" }, uip(), ps({ emission: 0 }), psr()], [child]));
  await t.show();
  const items = (await t.draw());
  assert.equal(items.length, 1);                                     // the root system has no particle
  // Relative position mode: the child's offset (3 units under the driven node) times scale3D
  near(corners(items[0]), fxQuad(t.canvas).map(([x, y]) => [x + 30, y]));
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: particles advance with the drawn frames and systems are simulated by their UIParticle only", async () => {
  const moving = ps({ extra: { InitialModule: { ...ps().InitialModule, startSpeed: mm(1) },
                               ShapeModule: { ...ps().ShapeModule, enabled: 1, type: 5, m_Scale: Z, m_Rotation: { x: 0, y: 90, z: 0 } } } });
  const t = await setup(frame([{ type: "CanvasRenderer" }, uip(), moving, psr()]));
  await t.show();
  const x0 = corners((await t.draw())[0])[0][0];
  const sys = t.f.particles.entries[0].system;
  assert.equal(sys.isPaused, true);                                  // UIParticleRenderer.Set paused it
  for (let i = 0; i < 2; i++) await t.draw();
  const x1 = corners((await t.draw())[0])[0][0];
  // 3 frames at 1 unit / s along +X, times scale3D
  assert.ok(Math.abs(x1 - x0 - 3 / 30 * 10) < 1e-3, `${x1 - x0}`);
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: checks at load and at the first draw", async () => {
  // a drawing system outside every UIParticle
  await assert.rejects(setup(frame([{ type: "CanvasRenderer" }, ps(), psr(1)])), /outside a UIParticle/);
  // one that cannot draw is allowed (renderer disabled), and marks nothing to refuse
  const quiet = await setup(frame([{ type: "CanvasRenderer" }, ps(), psr(0)]));
  await quiet.show();
  assert.equal((await quiet.draw()).length, 0);
  disposeStoryFeatures(quiet.ctx);
  await assert.rejects(setup(frame([uip({ m_MeshSharing: 1 }), ps(), psr()])), /mesh sharing 1/);
  await assert.rejects(setup(frame([uip({ m_Particles: [{ component: "ParticleSystem", gameObject: "f/Nope" }] }), ps(), psr()])),
                       /f\/Nope is not in the prefab/);
  const mat = { ...MAT, textures: { ...MAT.textures, _MaskTex: { texture: { texture: "textures/mask.png" } } } };
  await assert.rejects(setup(frame([uip(), ps(), psr(0, mat)])), /texture _MaskTex/);
  // no UI camera in the story UI data: the first draw raises, the headless path does not
  const t = await setup(frame([uip(), ps(), psr()]), { uiCamera: null });
  await t.show();
  t.screen.layoutAll(2340, 1080);
  assert.throws(() => t.screen.frameParticles.refresh(t.loop), /0 Camera/);
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: an Animator curve on a ParticleSystem property drives the system", async () => {
  const t = await setup(frame([uip(), ps(), psr()]));
  const fx = t.f.prefab.node("f/Fx"), pp = t.f.particles;
  const acc = pp.property(fx, "ParticleSystem.EmissionModule.rateOverTime.scalar");
  acc.set(12);
  assert.equal(pp.entries[0].system.emission.rateOverTime.scalar, 12);
  assert.equal(pp.property(t.f.prefab.node("f"), "ParticleSystem.EmissionModule.rateOverTime.scalar"), null);
  assert.throws(() => pp.property(fx, "ParticleSystem.LightsModule.ratio"), /not implemented/);
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: aligned World-space lines under a turned, flattened node are drawn as tall quads", async () => {
  // a line system as in a speed-line frame: box shape emitting along its z with Align To Direction, sizes 0.2 x 20,
  // start rotation 90 degrees, the node turned half a turn about (-1, 1, 0) and flattened along z (scale 10, 10, 0)
  const Iline = { ...ps().InitialModule, size3D: 1, startSize: mm(0.2), startSizeY: mm(20), startRotation: mm(Math.PI / 2) };
  const line = ps({ space: 1, extra: { InitialModule: Iline,
    ShapeModule: { ...ps().ShapeModule, enabled: 1, type: 5, m_Scale: { x: 10, y: 3, z: 1 }, alignToDirection: 1 } } });
  const turned = node("f/Fx/Line", [line, psr()], { rect: undefined, localRotation: { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0, w: 0 },
                                                    localScale: { x: 10, y: 10, z: 0 } });
  const t = await setup(frame([{ type: "CanvasRenderer" }, uip({ m_Scale3D: { x: 1, y: 1, z: 1 } }), ps({ emission: 0 }), psr()], [turned]));
  await t.show();
  const items = await t.draw();
  assert.equal(items.length, 1);
  assert.equal(t.f.particles.entries[1].system.renderer, null);           // disabled renderer: settings from rendererConfig
  assert.equal(t.f.particles.entries[1].system.rendererConfig.alignment, 2);
  const c = corners(items[0]);
  assert.ok(c.flat().every(Number.isFinite));
  const w = Math.max(...c.map((v) => v[0])) - Math.min(...c.map((v) => v[0]));
  const h = Math.max(...c.map((v) => v[1])) - Math.min(...c.map((v) => v[1]));
  // 0.2 x 20 particle units, times the node scale 10: 2 wide, 200 tall on the canvas
  assert.ok(Math.abs(w - 2) < 1e-2 && Math.abs(h - 200) < 1e-2, `${w} x ${h}`);
  disposeStoryFeatures(t.ctx);
});

test("UIParticle: the systems draw from a stream of their own, not the scripts' UnityEngine.Random", async () => {
  const random = ps({ extra: { InitialModule: { ...ps().InitialModule, startSpeed: { minMaxState: 3, minScalar: 0, scalar: 2 } } } });
  const t = await setup(frame([{ type: "CanvasRenderer" }, uip(), random, psr()]));
  const shared = featureState(t.ctx).random, before = [shared.x, shared.y, shared.z, shared.w];
  await t.show();
  for (let i = 0; i < 5; i++) await t.draw();
  assert.equal((await t.draw()).length, 1);
  assert.deepEqual([shared.x, shared.y, shared.z, shared.w], before);      // untouched by the particles
  assert.notEqual(t.f.particles.entries[0].system.sharedRng, shared);
  disposeStoryFeatures(t.ctx);
  // a UIParticle group id range would draw Random.Range at OnEnable: refused
  await assert.rejects(setup(frame([uip({ m_GroupMaxId: 3 }), ps(), psr()])), /group id range/);
});
