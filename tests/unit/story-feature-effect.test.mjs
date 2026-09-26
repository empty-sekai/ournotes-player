// Effect (AdvEffectCommand) on a real PlayerLoop with a synthetic effect prefab: the toggle, "atonce", the hide after
// the particles end, placement by canvas layer / PositionType, sort bands, speed and Animator states.
// Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { Transform } from "../../src/engine/math.js";
import { UnityRandom } from "../../src/engine/random.js";
import { commandHandler, createStoryUILayers } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures, setStoryFeaturesSpeed } from "../../src/story/features/index.js";
import { AdvParticleEffect, characterSortBand, createStageParticleGroups, releaseStageParticleGroups, storyEffects } from "../../src/story/features/effect.js";
import { AnimRecords } from "../../src/story/features/clips.js";
import { Prefab } from "../../src/engine/prefab.js";

const flush = () => new Promise((res) => setImmediate(res));
const steps = async (loop, n) => { await flush(); for (let i = 0; i < n; i++) await loop.step(); await flush(); };

const mm = (v) => ({ minMaxState: 0, scalar: v, minScalar: v });
const off = { enabled: 0 };
// a ParticleSystem record: point emitter, rate over time, constant lifetime
const ps = ({ looping = true, duration = 1, rate = 10, lifetime = 0.5, speed = 1 } = {}) => ({
  type: "ParticleSystem", lengthInSec: duration, looping: looping ? 1 : 0, prewarm: 0, playOnAwake: 1, simulationSpeed: speed,
  stopAction: 0, cullingMode: 0, startDelay: mm(0), moveWithTransform: 0, scalingMode: 1, emitterVelocityMode: 0,
  useUnscaledTime: 0, autoRandomSeed: 1, randomSeed: 0, ringBufferMode: 0,
  InitialModule: { startLifetime: mm(lifetime), startSpeed: mm(0), startColor: { minMaxState: 0, maxColor: { r: 1, g: 1, b: 1, a: 1 } },
                   startSize: mm(1), startSizeY: mm(1), startSizeZ: mm(1), size3D: 0, startRotationX: mm(0), startRotationY: mm(0),
                   startRotation: mm(0), rotation3D: 0, randomizeRotationDirection: 0, gravityModifier: mm(0), gravitySource: 0,
                   maxNumParticles: 100 },
  EmissionModule: { enabled: 1, rateOverTime: mm(rate), rateOverDistance: mm(0), m_Bursts: [], m_BurstCount: 0 },
  ShapeModule: { enabled: 0, type: 0, m_Position: { x: 0, y: 0, z: 0 }, m_Rotation: { x: 0, y: 0, z: 0 }, m_Scale: { x: 1, y: 1, z: 1 },
                 radius: { value: 1, mode: 0 }, arc: { value: 360, mode: 0 }, angle: 25, length: 5, radiusThickness: 1,
                 boxThickness: { x: 0, y: 0, z: 0 }, randomDirectionAmount: 0, sphericalDirectionAmount: 0, randomPositionAmount: 0,
                 alignToDirection: 0 },
  SizeModule: off, ColorModule: off, VelocityModule: off, ClampVelocityModule: off, RotationModule: off, ForceModule: off,
  NoiseModule: off, CustomDataModule: off,
});
const psr = (order) => ({ type: "ParticleSystemRenderer", m_Enabled: 1, m_RenderMode: 0, m_RenderAlignment: 0,
  m_Pivot: { x: 0, y: 0, z: 0 }, m_Flip: { x: 0, y: 0, z: 0 }, m_MinParticleSize: 0, m_MaxParticleSize: 0.5, m_SortMode: 0,
  m_SortingLayer: 0, m_SortingLayerID: 0, m_SortingOrder: order, m_NormalDirection: 1, m_MaskInteraction: 0,
  m_UseCustomVertexStreams: 0, m_Materials: [{ material: "m", shader: { shader: "Mobile/Particles/Additive" } }] });
const node = (path, components, active = true) => ({ path, name: path.split("/").pop(), active, layer: 0, tag: 0,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });

const FLT_MIN = -3.4028234663852886e+38;
const animator = { type: "Animator", m_Enabled: 1, m_UpdateMode: 0, m_CullingMode: 0, m_ApplyRootMotion: false,
  m_KeepAnimatorStateOnDisable: false, m_Controller: { controller: "c", name: "c", parameters: [], defaultValues: [],
    layers: [{ name: "Base Layer", stateMachine: 0 }],
    clips: [{ clip: "loop", sampleRate: 60, wrapMode: 0, startTime: 0, stopTime: 1, loopTime: true, cycleOffset: 0, events: [],
              bindings: [{ path: "Glow", typeID: 1, class: "GameObject", attribute: "m_IsActive" }],
              streamed: { curveCount: 1, frames: [[FLT_MIN, [[0, 0, 0, 0, 1]]], [1, [[0, 0, 0, 0, 1]]]] },
              dense: { curveCount: 0 }, constant: [] },
            { clip: "loop" }],
    stateMachines: [{ defaultState: 0, anyStateTransitions: [], states: [
      { name: "loop", speed: 1, cycleOffset: 0, loop: true, writeDefaultValues: true, mirror: false, speedParam: "", timeParam: "",
        blendTrees: [[{ clip: 0, children: [] }]], transitions: [] },
      { name: "stop", speed: 1, cycleOffset: 0, loop: false, writeDefaultValues: true, mirror: false, speedParam: "", timeParam: "",
        blendTrees: [[{ clip: 1, children: [] }]], transitions: [] }] }] } };

const effectDoc = () => ({ effects: { "fx/a": { key: "Adv/Effect/fx/a", nodes: [
  node("a", [psr(0), ps({ rate: 20, lifetime: 0.5 }), { type: "MonoBehaviour", class: "AdvParticleEffect", _particleSystem: { component: "ParticleSystem", gameObject: "a" } }]),
  node("a/Root", [animator]),
  node("a/Root/Dust", [ps({ rate: 20, lifetime: 0.5, speed: 0.5 }), psr(10000)]),
  node("a/Root/Glow", [ps({ rate: 5 }), psr(-3)], false),
] } }, instances: { star: "fx/a" } });

const makePlayer = () => {
  const loop = new PlayerLoop(30);
  const stageT = [1, 3, 5, 7, 9].map((i) => { const t = new Transform(`Stage${i}`); t.localPosition = { x: i, y: 0, z: 0 }; return t; });
  const entries = [0, 1, 2, 3, 4].map((i) => ({ index: i, target: null, renderIndex: -1 }));
  const fr = { entries, entryOf: (pos) => entries[{ 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pos]] || null, listeners: [],
               onCharacterOrderChanged(fn) { this.listeners.push(fn); return () => {}; } };
  const cam = new Transform("MainCamera"); cam.localPosition = { x: 0, y: 1, z: -10 };
  const ctx = { loop, ui: { layers: createStoryUILayers(), trueCanvasSortOrder: 300 }, gl: null, renderer: null,
                camera: { transform: cam }, field: { stageTransform: (pt) => stageT[{ 1: 0, 3: 1, 5: 2, 7: 3, 9: 4 }[pt]] },
                fieldRenderer: fr, episode: { commands: [{ i: 0, cmd: "Effect", TargetName: "star", TargetAssetName: "fx/a" }] },
                story: { effects: "effects.json" }, assets: { json: () => effectDoc() } };
  const p = { ctx, playbackSpeed: 10, shortCutIndex: -1, session: { stage: { backgroundFieldPosition: { x: 0, y: 0, z: 20 } } },
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return false; } };
  return { ctx, p, loop, fr, stageT };
};
const run = (t, row) => commandHandler("Effect")({ cmd: "Effect", TargetName: "star", ...row }, t.p);

test("Effect: the first row places and plays, the next blank row stops; hidden once the particles have ended", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p, { random: new UnityRandom(3) });
  const e = storyEffects(t.ctx).get("star");
  assert.equal(e.isVisible, false);                                       // Init: hidden, stopped
  await run(t, { PositionType: 5 });
  assert.equal(e.isPlaying, true);
  assert.equal(e.isVisible, true);
  assert.equal(e.root.parent, t.stageT[2]);                               // under the slot's Stage node, at its position
  assert.deepEqual(e.root.localPosition, { x: 0, y: 0, z: 0 });
  assert.equal(e.order[0].layer, 8);                                      // Camera3, recursive
  await steps(t.loop, 10);
  const dust = e.entries.get("a/Root/Dust").system;
  assert.ok(dust.particles.length > 0);
  assert.equal(dust.main.simulationSpeed, 0.5);
  await run(t, {});                                                       // stop emitting: still visible until the end
  assert.equal(e.isPlaying, false);
  await steps(t.loop, 2);
  assert.equal(e.isVisible, true);
  await steps(t.loop, 40);
  assert.equal(e.isVisible, false);
  // "AtOnce" (any case) clears and hides at once
  await run(t, { CanvasLayers: [0] });
  assert.equal(e.order[0].layer, 12);                                     // AdvBack in front of the camera
  const w = e.root.localToWorld();
  assert.deepEqual([w[12], w[13], w[14]].map((x) => Math.round(x * 1000) / 1000), [0, 1, 10]);
  await steps(t.loop, 5);
  await run(t, { Parameter1: "AtOnce" });
  assert.equal(e.isVisible, false);
  assert.equal(dust.particles.length, 0);
  disposeStoryFeatures(t.ctx);
});

test("Effect: sort orders by placement and character bands; speed; Animator states; missing instances fail", async () => {
  const t = makePlayer();
  await installStoryFeatures(t.ctx, t.p, { random: new UnityRandom(3) });
  const e = storyEffects(t.ctx).get("star");
  assert.deepEqual(e.relativeSortOrders, [-1, 1, -2]);                   // below 1: [-3, 0] -> -2, -1; from 1: [10000] -> 1
  await run(t, { CanvasLayers: [5] });                                    // UI: canvas sort order + layer for particles
  assert.deepEqual(e.renderers.map((r) => r.target.sortingOrder), [305, 305, 305]);
  await run(t, { Parameter1: "atonce" });
  t.fr.entries[1].target = { isShowing: true, drawablePartsCount: 40 }; t.fr.entries[1].renderIndex = 2;
  assert.deepEqual(characterSortBand(t.fr, 3), { backBase: 2000, frontBase: 2040, max: 2999 });
  await run(t, { PositionType: 3 });
  assert.deepEqual(e.renderers.map((r) => r.target.sortingOrder), [1999, 2041, 1998]);
  t.p.playbackSpeed = 20;
  setStoryFeaturesSpeed(t.ctx, 2);                                        // ReapplyPlaybackSpeed
  assert.equal(e.entries.get("a/Root/Dust").system.main.simulationSpeed, 1);
  assert.equal(e.animator.speed, 2);
  assert.equal(e.tryPlayAnimatorState("stop"), true);
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  await run(t, { Parameter2: "missing" });                                // playing + state: no replay, a warning
  console.warn = warn;
  assert.equal(warned, 1);
  assert.throws(() => run(t, { TargetName: "nobody" }), /not loaded/);
  disposeStoryFeatures(t.ctx);
});

test("stage particle groups: effects over the stage prefab, shared between groups, updated with the command effects", async () => {
  const t = makePlayer();
  t.ctx.episode.commands = [];
  await installStoryFeatures(t.ctx, t.p, { random: new UnityRandom(3) });
  const comp = (path) => ({ type: "MonoBehaviour", class: "AdvParticleEffect", _particleSystem: { component: "ParticleSystem", gameObject: path } });
  const stage = new Prefab({ key: "st", nodes: [
    node("st", []), node("st/Rain", [ps({ rate: 30 }), psr(0), comp("st/Rain")]),
    node("st/Off", [], false), node("st/Off/Snow", [ps({ rate: 30 }), psr(0), comp("st/Off/Snow")]),
  ] });
  const ref = (p) => ({ component: "MonoBehaviour", class: "AdvParticleEffect", gameObject: p });
  const coll = { _groups: [{ _particleEffects: [ref("st/Rain")] }, { _particleEffects: [ref("st/Rain"), ref("st/Off/Snow")] }] };
  const groups = createStageParticleGroups(t.ctx, "st", stage, coll, new AnimRecords({}));
  const [rain, snow] = groups[1];
  assert.equal(groups[0][0], rain);
  assert.equal(rain.isVisible, false);
  assert.equal(stage.transform("st/Rain").activeSelf, false);             // Init hides the GameObject
  for (const e of groups[1]) e.play();
  await steps(t.loop, 5);
  assert.ok(rain.particleSystem.particles.length > 0);
  assert.equal(snow.isVisible, true);
  assert.equal(snow.particleSystem.particles.length, 0);                  // under an inactive GameObject
  snow.setParentActive(true);
  await steps(t.loop, 5);
  assert.ok(snow.particleSystem.particles.length > 0);
  for (const e of groups[1]) e.stop(false, t.loop);
  await steps(t.loop, 40);
  assert.equal(rain.isVisible, false);
  releaseStageParticleGroups(t.ctx, groups);
  assert.deepEqual(storyEffects(t.ctx).stageEffects, []);
  const nested = { _groups: [{ _particleEffects: [ref("st/Off"), ref("st/Off/Snow")] }] };
  const stage2 = new Prefab({ key: "st", nodes: [node("st", []), node("st/Off", [ps({}), psr(0), comp("st/Off")]),
                                                 node("st/Off/Snow", [ps({}), psr(0), comp("st/Off/Snow")])] });
  assert.throws(() => createStageParticleGroups(t.ctx, "st", stage2, nested, new AnimRecords({})), /nested/);
  disposeStoryFeatures(t.ctx);
});

test("AdvParticleEffect: a MeshRenderer with its MeshFilter is a renderer of the effect (sort orders, layer, draw item)", () => {
  const quad = { mesh: "Quad", vertices: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [-0.5, 0.5, 0], [0.5, 0.5, 0]],
                 normals: [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]], uv0: [[0, 0], [1, 0], [0, 1], [1, 1]],
                 submeshes: [[0, 3, 1, 3, 0, 2]] };
  const mr = { type: "MeshRenderer", m_Enabled: true, m_SortingLayer: 0, m_SortingOrder: 0,
               m_Materials: [{ material: "bg", shader: { shader: "Universal Render Pipeline/Particles/Unlit" }, renderQueue: 3000 }] };
  const bg = node("a/Root/Bg", [{ type: "MeshFilter", m_Mesh: quad }, mr]);
  bg.localPosition = { x: 0, y: 0, z: 0.2 }; bg.localScale = { x: 20, y: 15, z: 1 };
  const doc = effectDoc().effects["fx/a"];
  const e = new AdvParticleEffect("spot", { ...doc, nodes: [...doc.nodes, bg] }, { rng: new UnityRandom(1) });
  assert.deepEqual(e.renderers.map((r) => r.kind), ["particle", "particle", "particle", "mesh"]);
  assert.deepEqual(e.relativeSortOrders, [-1, 1, -2, -1]);                // the mesh's 0 ranks with the particles' 0
  e.setSortOrder(305);                                                    // SetSortOrder: particle renderers only
  assert.deepEqual(e.renderers.map((r) => r.target.sortingOrder), [305, 305, 305, 0]);
  e.setLayerRecursively(8);
  assert.equal(e.entries.get("a/Root/Bg").layer, 8);
  const it = e.renderers[3].target.drawItem([0, 0, -10]);
  assert.equal(it.queue, 3000);
  assert.ok(Math.abs(it.distance - 10.2) < 1e-5, `${it.distance}`);      // the quad's centre at z 0.2
  const part = e.renderers[3].target.parts[0];
  assert.deepEqual([part.stride, Object.keys(part.attribs)], [8, ["in_POSITION0", "in_NORMAL0", "in_TEXCOORD0"]]);
  assert.throws(() => new AdvParticleEffect("bad", { ...doc, nodes: [...doc.nodes, node("a/Root/M", [mr])] }), /MeshRenderer without a MeshFilter/);
});

test("AdvParticleEffect: a field item's draw hands the field renderer's per-object hook a Transform and the layer", () => {
  const quad = { mesh: "Quad", vertices: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [-0.5, 0.5, 0], [0.5, 0.5, 0]],
                 normals: [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]], uv0: [[0, 0], [1, 0], [0, 1], [1, 1]],
                 submeshes: [[0, 3, 1, 3, 0, 2]] };
  const mr = { type: "MeshRenderer", m_Enabled: true, m_SortingLayer: 0, m_SortingOrder: 0,
               m_Materials: [{ material: "bg", shader: { shader: "Universal Render Pipeline/Particles/Unlit" }, renderQueue: 3000 }] };
  const bg = node("a/Root/Bg", [{ type: "MeshFilter", m_Mesh: quad }, mr]);
  bg.localPosition = { x: 0, y: 0, z: 0.2 }; bg.localScale = { x: 20, y: 15, z: 1 };
  const doc = effectDoc().effects["fx/a"];
  // FxMaterial.draw calls ctx.perObject(matrix of the draw)
  const materials = { get: () => ({ queue: 3000, draw: (ctx, mesh, M) => ctx.perObject(M) }) };
  const e = new AdvParticleEffect("spot", { ...doc, nodes: [...doc.nodes, bg] }, { rng: new UnityRandom(1), materials });
  e.setLayerRecursively(8);
  const seen = [];
  const frame = { globals: {}, perObject: (t, layer) => { seen.push([Array.from(t.localToWorld()), layer]); return {}; } };
  const camera = { localToWorld: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1) };
  const items = e.items(camera);
  assert.equal(items.length, 1);                                          // the mesh (no particle yet)
  items[0].draw(frame);
  assert.equal(seen.length, 1);
  const [M, layer] = seen[0];
  assert.equal(layer, 8);
  assert.deepEqual([M[0], M[5], M[14]].map((x) => Math.round(x * 1000) / 1000), [20, 15, 0.2]);
});
