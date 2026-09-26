// FxParticleSystem.fastForward (ParticleSystem.Simulate) and bake (ParticleSystemRenderer.BakeMesh with
// BakeRotationAndScale) on synthetic systems.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FxError, FxMatrixTransform, FxParticleSystem, FxV } from "../../src/engine/particles.js";
import { mat4, quat } from "../../src/engine/math.js";
import { UnityRandom } from "../../src/engine/random.js";

const mm = (v) => ({ minMaxState: 0, scalar: v, minScalar: v });
const off = { enabled: 0 };
const v3 = (x, y, z) => ({ x, y, z });
const psRaw = ({ looping = true, duration = 10, rate = 10, lifetime = 0.5, speed = 1, startSpeed = 0, space = 0,
                        bursts = [], stopAction = 0, prewarm = false, size = 1, extra = {} } = {}) => ({
  lengthInSec: duration, looping: looping ? 1 : 0, prewarm: prewarm ? 1 : 0, playOnAwake: 1, simulationSpeed: speed,
  stopAction, cullingMode: 0, startDelay: mm(0), moveWithTransform: space, scalingMode: 0, emitterVelocityMode: 0,
  useUnscaledTime: 0, autoRandomSeed: 1, randomSeed: 0, ringBufferMode: 0,
  InitialModule: { startLifetime: mm(lifetime), startSpeed: mm(startSpeed), startColor: { minMaxState: 0, maxColor: { r: 1, g: 1, b: 1, a: 1 } },
                   startSize: mm(size), startSizeY: mm(size), startSizeZ: mm(size), size3D: 0, startRotationX: mm(0),
                   startRotationY: mm(0), startRotation: mm(0), rotation3D: 0, randomizeRotationDirection: 0,
                   gravityModifier: mm(0), gravitySource: 0, maxNumParticles: 1000 },
  EmissionModule: { enabled: 1, rateOverTime: mm(rate), rateOverDistance: mm(0), m_Bursts: bursts, m_BurstCount: bursts.length },
  ShapeModule: { enabled: 0, type: 0, m_Position: v3(0, 0, 0), m_Rotation: v3(0, 0, 0), m_Scale: v3(1, 1, 1),
                 radius: { value: 1, mode: 0 }, arc: { value: 360, mode: 0 }, angle: 25, length: 5, radiusThickness: 1,
                 boxThickness: v3(0, 0, 0), randomDirectionAmount: 0, sphericalDirectionAmount: 0, randomPositionAmount: 0,
                 alignToDirection: 0 },
  SizeModule: off, ColorModule: off, VelocityModule: off, ClampVelocityModule: off, RotationModule: off, ForceModule: off,
  NoiseModule: off, CustomDataModule: off, ...extra,
});
const psrRaw = ({ enabled = true, mode = 0, streams = null, flip = v3(0, 0, 0), extra = {} } = {}) => ({
  m_Enabled: enabled ? 1 : 0, m_RenderMode: mode, m_RenderAlignment: 0, m_Pivot: v3(0, 0, 0), m_Flip: flip,
  m_MinParticleSize: 0, m_MaxParticleSize: 0, m_SortMode: 0, m_SortingLayer: 0, m_SortingLayerID: 0, m_SortingOrder: 0,
  m_NormalDirection: 1, m_MaskInteraction: 0, m_UseCustomVertexStreams: streams ? 1 : 0, m_VertexStreams: streams || [],
  m_LengthScale: 2, m_VelocityScale: 0, m_CameraVelocityScale: 0, m_FreeformStretching: 0, m_RotateWithStretchDirection: 1,
  m_Materials: [{ material: "m", shader: { shader: "Mobile/Particles/Additive" } }], ...extra,
});
const burst = (count, time = 0) => ({ time, countCurve: mm(count), cycleCount: 1, repeatInterval: 0.01, probability: 1 });
const make = (o = {}, r = {}, m = mat4.identity()) =>
  new FxParticleSystem(psRaw(o), psrRaw(r), new FxMatrixTransform(m), { rng: new UnityRandom(7), name: "t" });
const snap = (s) => s.particles.map((p) => [p.age, ...p.pos]);
const close = (a, b, eps = 1e-5, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

test("fastForward on a paused system emits, advances and leaves it paused", () => {
  const s = make({ rate: 10 });
  s.onActiveChanged(true);                   // playOnAwake
  s.clear(); s.pause();                      // UIParticleRenderer.Set
  assert.equal(s.isPaused, true);
  s.fastForward(0.1, false, false, false);
  assert.equal(s.isPaused, true);
  assert.equal(s.particleCount, 1);
  close(s.time, 0.1);
  s.simulate(0.1);                           // the player-loop update does not touch a paused system
  close(s.time, 0.1);
  s.fastForward(0.4, false, false, false);
  assert.equal(s.particleCount, 5);
  close(s.time, 0.5);
  assert.equal(s.isAlive(), true);
  assert.equal(s.isPlaying, false);
});

test("fastForward of a frame is the player-loop step", () => {
  const a = make({ rate: 30, startSpeed: 2, lifetime: 0.3 }), b = make({ rate: 30, startSpeed: 2, lifetime: 0.3 });
  a.onActiveChanged(true); b.onActiveChanged(true); b.pause();
  for (let i = 0; i < 40; i++) { a.simulate(1 / 30); b.fastForward(1 / 30, false, false, false); }
  assert.deepEqual(snap(b), snap(a));
  assert.equal(b.time, a.time);
});

test("a long fastForward (prewarm) runs in steps and keeps the loop", () => {
  const s = make({ duration: 1, rate: 10, lifetime: 0.5 });
  s.onActiveChanged(true); s.clear(); s.pause();
  s.fastForward(1 + 0.5, false, false, false);           // UIParticle: first dt += main.duration
  close(s.time, 0.5, 1e-4);
  assert.equal(s.loopCount, 1);
  assert.ok(s.particleCount >= 4 && s.particleCount <= 6, `count ${s.particleCount}`);
  for (const p of s.particles) assert.ok(p.age < 0.5);
});

test("fastForward applies simulationSpeed; restart clears and pauses at time 0", () => {
  const s = make({ speed: 2, rate: 10 });
  s.onActiveChanged(true); s.pause();
  s.fastForward(0.25, false, false, false);
  close(s.time, 0.5);
  assert.ok(s.particleCount > 0);
  s.fastForward(0, false, true, false);                   // UIParticle.Play
  assert.equal(s.particleCount, 0);
  assert.equal(s.time, 0);
  assert.equal(s.isPaused, true);
  assert.equal(s.isAlive(), true);
  const t = make();                                        // restart also starts a stopped system
  t.fastForward(0.2, false, true, false);
  assert.equal(t.isPaused, true);
  assert.equal(t.particleCount, 2);
});

test("fastForward(0) records the emitter position only", () => {
  const m = mat4.identity(), s = make({ rate: 10, startSpeed: 1 }, {}, m);
  s.onActiveChanged(true); s.pause();
  s.fastForward(0.3, false, false, false);
  const before = snap(s);
  s.transform.set(mat4.trs({ x: 3, y: 0, z: 0 }, quat.identity(), { x: 1, y: 1, z: 1 }));
  s.fastForward(0, false, false, false);
  assert.deepEqual(snap(s), before);
  assert.deepEqual(s.prevEmitterPos, [3, 0, 0]);
});

test("fastForward rejects fixed time steps, negative times and a stopped system without restart", () => {
  const s = make();
  assert.throws(() => s.fastForward(0.1), FxError);
  assert.throws(() => s.fastForward(-1, false, false, false), FxError);
  assert.throws(() => s.fastForward(NaN, false, false, false), FxError);
  assert.throws(() => s.fastForward(0.1, false, false, false), /stopped/);
});

test("a non-looping system that dies inside fastForward ends stopped with its stop action", () => {
  const s = make({ looping: false, duration: 0.2, rate: 20, lifetime: 0.1, stopAction: 3 });
  let stopped = 0;
  s.onStopped = () => stopped++;
  s.onActiveChanged(true); s.pause();
  s.fastForward(0.2, false, false, false);
  assert.equal(s.isPaused, true);
  close(s.time, 0.2);
  s.stop(false);                                           // UIParticle stops a finished non-looping system
  s.fastForward(0.2, false, false, false);
  assert.equal(s.state, "stopped");
  assert.equal(stopped, 1);
  assert.equal(s.isAlive(), false);
});

test("fastForward withChildren drives the child systems", () => {
  const p = make({ rate: 10 }), c = make({ rate: 20 });
  p.children.push(c);
  p.fastForward(0.5, true, true, false);
  assert.equal(p.isPaused, true);
  assert.equal(c.isPaused, true);
  assert.equal(p.particleCount, 5);
  assert.equal(c.particleCount, 10);
});

const verts = (g) => {
  const out = [], [n, o] = g.attribs.in_POSITION0;
  for (let i = 0; i < g.verts.length; i += g.stride) out.push([g.verts[i + o], g.verts[i + o + 1], g.verts[i + o + 2]].slice(0, n));
  return out;
};
const cam = { localToWorld: mat4.trs({ x: 0, y: 0, z: -10 }, quat.identity(), { x: 1, y: 1, z: 1 }) };

test("bake applies the rotation and scale of a Local-space system, not its position", () => {
  const M = mat4.trs({ x: 5, y: 1, z: 0 }, quat.euler(0, 0, 90), { x: 2, y: 2, z: 2 });
  const s = make({ rate: 0, bursts: [burst(2)], startSpeed: 1 }, {}, M);
  s.fastForward(0.25, false, true, false);
  assert.equal(s.particleCount, 2);
  const geo = s.geometry(cam), baked = s.bake(cam);
  assert.equal(baked.particles, 2);
  assert.deepEqual(Array.from(baked.idx), [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  assert.equal(baked.submeshes.length, 1);
  const g = { verts: geo.parts[0].mesh.verts, stride: geo.parts[0].mesh.stride, attribs: geo.parts[0].mesh.attribs };
  const world = verts(g).map((v) => FxV.point(geo.localToWorld, v)), b = verts(baked);
  world.forEach((w, i) => { close(b[i][0] + 5, w[0], 1e-4); close(b[i][1] + 1, w[1], 1e-4); close(b[i][2], w[2], 1e-4); });
  // normals: towards the camera after the rotation, unit length
  const [, no] = baked.attribs.in_NORMAL0;
  for (let i = 0; i < baked.verts.length; i += baked.stride) {
    const n = [baked.verts[i + no], baked.verts[i + no + 1], baked.verts[i + no + 2]];
    close(FxV.len(n), 1, 1e-5); close(n[2], -1, 1e-5);
  }
});

test("bake keeps World-space vertices in world coordinates", () => {
  const M = mat4.trs({ x: 5, y: 1, z: 0 }, quat.euler(0, 0, 30), { x: 2, y: 2, z: 2 });
  const s = make({ rate: 0, bursts: [burst(1)], space: 1 }, {}, M);
  s.fastForward(0.1, false, true, false);
  const geo = s.geometry(cam), baked = s.bake(cam);
  assert.deepEqual(Array.from(baked.verts), Array.from(geo.parts[0].mesh.verts));
  const c = verts(baked).reduce((a, v) => FxV.add(a, FxV.scale(v, 1 / 4)), [0, 0, 0]);
  close(c[0], 5, 1e-5); close(c[1], 1, 1e-5);
});

test("bake reads a disabled renderer; unsupported options and streams raise", () => {
  const s = make({ rate: 0, bursts: [burst(1)] }, { enabled: false });
  assert.equal(s.renderer, null);
  assert.equal(s.rendererConfig.renderMode, 0);
  s.fastForward(0.1, false, true, false);
  assert.equal(s.geometry(cam), null);
  assert.equal(s.bake(cam).particles, 1);
  assert.throws(() => s.bake(cam, 3), FxError);
  const c = make({ rate: 0, bursts: [burst(1)] }, { streams: [0, 3, 4, 10] });
  c.fastForward(0.1, false, true, false);
  assert.throws(() => c.bake(cam), /stream 10/);
  const f = make({ rate: 0, bursts: [burst(1)] }, { enabled: false, flip: v3(0.5, 0, 0) });
  f.fastForward(0.1, false, true, false);
  assert.throws(() => f.bake(cam), /flip/);
  const none = new FxParticleSystem(psRaw(), null, new FxMatrixTransform(), { name: "n" });
  assert.equal(none.rendererConfig, null);
  assert.equal(none.bake(cam), null);
});

const uvsOf = (g) => {
  const [, o] = g.attribs.in_TEXCOORD0, out = [];
  for (let i = 0; i < g.verts.length; i += g.stride) out.push([g.verts[i + o], g.verts[i + o + 1]]);
  return out;
};
const worldOf = (s) => {
  const geo = s.geometry(cam), m = geo.parts[0].mesh;
  return verts({ verts: m.verts, stride: m.stride, attribs: m.attribs }).map((v) => FxV.point(geo.localToWorld, v));
};
const nearAll = (a, b, eps = 1e-4) => a.forEach((v, i) => v.forEach((x, k) => close(x, b[i][k], eps, `v${i}.${k}`)));
const yaw90 = mat4.trs({ x: 0, y: 0, z: 0 }, quat.euler(0, 90, 0), { x: 1, y: 1, z: 1 });   // +Z -> +X

test("stretched billboard: head at the particle, tail back along the velocity, width across the view", () => {
  const stretch = (lengthScale, velocityScale, space = 1) => {
    const s = make({ rate: 0, bursts: [burst(1)], startSpeed: 1, lifetime: 1, space },
                   { mode: 1, extra: { m_LengthScale: lengthScale, m_VelocityScale: velocityScale } }, yaw90);
    s.fastForward(0.5, false, true, false);
    return s;
  };
  const s = stretch(2, 0);
  nearAll(worldOf(s), [[0.5, -0.5, 0], [-1.5, -0.5, 0], [-1.5, 0.5, 0], [0.5, 0.5, 0]]);
  assert.deepEqual(uvsOf(s.bake(cam)), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  nearAll(worldOf(stretch(2, 1)), [[0.5, -0.5, 0], [-2.5, -0.5, 0], [-2.5, 0.5, 0], [0.5, 0.5, 0]]);
  // a negative length scale stretches forward (the side flips with the cross product); Local space gives the same quad
  nearAll(worldOf(stretch(-3, 0, 0)), [[0.5, 0.5, 0], [3.5, 0.5, 0], [3.5, -0.5, 0], [0.5, -0.5, 0]]);
  nearAll(worldOf(stretch(2, 0, 0)), worldOf(s));
  const f = make({ rate: 0, bursts: [burst(1)] }, { mode: 1, extra: { m_FreeformStretching: 1 } });
  f.fastForward(0.1, false, true, false);
  assert.throws(() => f.geometry(cam), /freeform/);
});

const linear = { m_Curve: [{ time: 0, value: 0, inSlope: 1, outSlope: 1 }, { time: 1, value: 1, inSlope: 1, outSlope: 1 }],
                 m_PreInfinity: 2, m_PostInfinity: 2 };
const uvModule = (o = {}) => ({ UVModule: { enabled: 1, mode: 0, timeMode: 0, tilesX: 2, tilesY: 2, animationType: 0, cycles: 1,
  uvChannelMask: -1, flipU: 0, flipV: 0, frameOverTime: { minMaxState: 1, scalar: 0.9999, minScalar: 0.9999, maxCurve: linear },
  startFrame: mm(0), ...o } });

test("texture sheet: frame over the lifetime, cycles and start frame pick the grid tile from the top left", () => {
  const tileAt = (age, o = {}) => {
    const s = make({ rate: 0, bursts: [burst(1)], lifetime: 1, extra: uvModule(o) });
    s.fastForward(age, false, true, false);
    return uvsOf(s.bake(cam));
  };
  assert.deepEqual(tileAt(0.3), [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]]);                    // frame 1: top right
  assert.deepEqual(tileAt(0.8), [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]]);                    // frame 3: bottom right
  assert.deepEqual(tileAt(0.8, { cycles: 2 }), [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]);     // frac(1.6): frame 2
  assert.deepEqual(tileAt(0.3, { startFrame: mm(0.5) }), [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]]);  // two frames on
  assert.deepEqual(tileAt(0.3, { uvChannelMask: 0 }), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const s = make({ rate: 0, bursts: [burst(1)], extra: uvModule({ timeMode: 2 }) });
  assert.throws(() => s.fastForward(0.1, false, true, false), /time mode 2/);
});

const subModule = (list, type = 0) => ({ SubModule: { enabled: 1, subEmitters: list.map(([path, probability]) => ({
  emitter: { component: "ParticleSystem", gameObject: path }, type, properties: 0, emitProbability: probability })) } });

test("Birth sub-emitters emit on each parent particle's timeline and are stepped by the parent", () => {
  const parent = make({ rate: 10, lifetime: 0.5, startSpeed: 1, extra: subModule([["p/a", 1], ["p/b", 0.5]]) }, {}, yaw90);
  const a = make({ rate: 0, bursts: [burst(1)], lifetime: 5 }), b = make({ rate: 0, bursts: [burst(1)], lifetime: 5 });
  a.onActiveChanged(true);                   // playing, but a sub-emitter never emits from its own position
  assert.throws(() => parent.fastForward(0.1, false, true, false), /not linked/);
  const byPath = { "p/a": a, "p/b": b };
  parent.linkSubEmitters((ref) => byPath[ref.gameObject]);
  assert.equal(a.mainEmitter, parent);
  parent.children.push(a, b);
  parent.fastForward(0, true, true, false);
  for (let i = 0; i < 20; i++) parent.fastForward(0.05, true, false, false);
  assert.equal(parent.emittedTotal, 10);
  assert.equal(a.particleCount, 10);
  assert.ok(b.particleCount > 0 && b.particleCount < 10, `b ${b.particleCount}`);
  // each sub particle starts where its parent particle was: on the parent's +X path, within one step of the emitter
  for (const p of a.particles) {
    close(p.pos[1], 0, 1e-5); close(p.pos[2], 0, 1e-5);
    assert.ok(p.pos[0] >= 0 && p.pos[0] < 0.06, `${p.pos}`);
  }
  // a sub-emitter ignores its own simulate / fastForward
  const before = a.particles.map((p) => p.age);
  a.simulate(0.1); a.fastForward(0.1, false, false, false);
  assert.deepEqual(a.particles.map((p) => p.age), before);
  // rate over time on the timeline: about rate x parent lifetime per parent particle
  const q = make({ rate: 0, bursts: [burst(1)], lifetime: 1, extra: subModule([["q/r", 1]]) });
  const r = make({ rate: 10, lifetime: 5 });
  q.linkSubEmitters(() => r);
  q.fastForward(0, false, true, false);
  for (let i = 0; i < 30; i++) q.fastForward(0.05, false, false, false);
  assert.ok(r.particleCount >= 9 && r.particleCount <= 10, `r ${r.particleCount}`);
  const death = make({ extra: subModule([["d", 1]], 2) });
  assert.throws(() => death.fastForward(0.1, false, true, false), /sub-emitter type 2/);
});

const tri = { mesh: "tri", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
              uv0: [[0, 0], [1, 0], [0, 1]], submeshes: [[0, 1, 2]] };
const meshShape = (placementMode, extra = {}) => ({ ShapeModule: { ...psRaw().ShapeModule, enabled: 1, type: 6, placementMode,
  m_Mesh: tri, m_MeshSpawn: { mode: 0 }, m_UseMeshColors: 1, m_MeshNormalOffset: 0, m_UseMeshMaterialIndex: 0,
  m_MeshMaterialIndex: 0, ...extra } });

test("mesh shape: vertices, edges and triangle surface, emitted along the normal", () => {
  const run = (mode, extra) => {
    const s = make({ rate: 0, bursts: [burst(200)], startSpeed: 0, extra: meshShape(mode, extra) });
    s.fastForward(0.01, false, true, false);
    assert.equal(s.particleCount, 200);
    return s.particles;
  };
  for (const p of run(2)) {
    assert.ok(p.pos[0] >= -1e-6 && p.pos[1] >= -1e-6 && p.pos[0] + p.pos[1] <= 1 + 1e-6, `${p.pos}`);
    close(p.pos[2], 0, 1e-6);
  }
  for (const p of run(0)) assert.ok([[0, 0], [1, 0], [0, 1]].some(([x, y]) => Math.abs(p.pos[0] - x) + Math.abs(p.pos[1] - y) < 1e-6));
  for (const p of run(1)) {
    const onEdge = Math.abs(p.pos[1]) < 1e-6 || Math.abs(p.pos[0]) < 1e-6 || Math.abs(p.pos[0] + p.pos[1] - 1) < 1e-6;
    assert.ok(onEdge, `${p.pos}`);
  }
  for (const p of run(2, { m_MeshNormalOffset: 0.5, m_Scale: v3(2, 2, 1) })) {
    close(p.pos[2], 0.5, 1e-6);
    assert.ok(p.pos[0] + p.pos[1] <= 2 + 1e-5);
  }
  const moving = make({ rate: 0, bursts: [burst(3)], startSpeed: 2, extra: meshShape(2) });
  moving.fastForward(0.25, false, true, false);
  for (const p of moving.particles) { close(p.vel[2], 2, 1e-6); close(p.pos[2], 0.5, 1e-5); }
  const missing = make({ extra: meshShape(2, { m_Mesh: null }) });
  assert.throws(() => missing.fastForward(0.1, false, true, false), /without mesh data/);
});
