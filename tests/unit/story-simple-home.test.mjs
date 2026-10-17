// Home host of the simple ADV player (src/story/simple/home): the room glb read back into Unity space, the spot
// camera's default pose / focus / return on a PlayerLoop, the UI blur ramp and Dual Kawase settings, the room's
// visibility and URP draw order, URP's lighting state for the Lit materials, the main camera in the spot and its volume
// stack and post chain, a headless host (gl = null) and a drawn one on the headless context. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore, bindAssets } from "../../src/data/assets.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { EASE, easeF } from "../../src/engine/tween.js";
import { blurLevels, blurPass, blurSettings, UIBlur } from "../../src/story/simple/home/blur.js";
import { forwardOf, lookRotation, rotateVector, slerp, SpotCamera, spotFieldOfView } from "../../src/story/simple/home/camera.js";
import { parseGlb, roomMeshes } from "../../src/story/simple/home/glb.js";
import { backgroundMatrix, inverseTRS, NO_TAP_TARGET, roomInverse, roomMatrix, SimpleHomeHost, SPINE_MISSING,
         spotLighting } from "../../src/story/simple/home/host.js";
import { checkSpotCamera, checkSpotStack, HOME_VIEW_MASK, spotMainCamera, spotVolumeStack as nativeVolumeStack,
         } from "../../src/story/simple/home/post.js";
import { URPPost, VOLUME_DEFAULTS } from "../../src/engine/postfx.js";
import { GLTarget } from "../../src/engine/texture.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";
import { mat4 } from "../../src/engine/math.js";
import { majorMinor, skeletonDataVersion, spineRuntime, spineRuntimeVersion } from "../../src/story/simple/home/spine.js";
import { homeResources, lightingResources, volumeResources } from "./story-home-resources.mjs";
import { parseQueueTag, ShaderInfo, sortDrawItems, SpotRoom } from "../../src/story/simple/home/room.js";

const createHome = (gl, store, loop, host, opts = {}) => {
  const { data, objects } = homeResources(store, host, opts, gl);
  return SimpleHomeHost.create(gl, store, loop, data, { ...opts, objects });
};
const spotVolumes = (h) => [...(h.sceneRoot?.volumes || []), ...(h.volume ? [h.volume] : [])];
const spotVolumeStack = (h, mask, what) => nativeVolumeStack(spotVolumes(h).map(volumeResources), mask, what);

const F = Math.fround;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearVec = (a, b, eps = 1e-6) => ["x", "y", "z"].every((k) => near(a[k], b[k], eps));
const flush = () => new Promise((res) => setImmediate(res));

// ------------------------------------------------------------------------------------------------ synthetic data
// a GLB as the room file writes it: nodes without transforms, one mesh each, POSITION / TEXCOORD_0 / uint32 indices
const buildGlb =(meshes, materials) => {
  const parts = [], views = [], accessors = [];
  let len = 0;
  const view = (typed) => {
    while (len % 4) { parts.push(new Uint8Array(1)); len++; }
    const u8 = new Uint8Array(typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength));
    views.push({ buffer: 0, byteOffset: len, byteLength: u8.byteLength });
    parts.push(u8); len += u8.byteLength;
    return views.length - 1;
  };
  const acc = (typed, type, componentType, n, minmax) => {
    const a = { bufferView: view(typed), componentType, count: typed.length / n, type };
    if (minmax) {
      a.min = [0, 1, 2].map((k) => Math.min(...Array.from(typed).filter((_, i) => i % 3 === k)));
      a.max = [0, 1, 2].map((k) => Math.max(...Array.from(typed).filter((_, i) => i % 3 === k)));
    }
    accessors.push(a);
    return accessors.length - 1;
  };
  const jsonMeshes = meshes.map((m) => {
    const pos = acc(new Float32Array(m.positions), "VEC3", 5126, 3, true), uv = acc(new Float32Array(m.uvs), "VEC2", 5126, 2);
    const attributes = { POSITION: pos, TEXCOORD_0: uv };
    if (m.normals) attributes.NORMAL = acc(new Float32Array(m.normals), "VEC3", 5126, 3);
    return { name: m.name, primitives: m.prims.map((p) => ({ attributes,
      indices: acc(new Uint32Array(p.indices), "SCALAR", 5125, 1), mode: 4, material: p.material })) };
  });
  while (len % 4) { parts.push(new Uint8Array(1)); len++; }
  const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: meshes.map((_, i) => i) }],
                 nodes: meshes.map((m, i) => ({ name: m.name, mesh: i, extras: { unityActive: m.active !== false } })),
                 meshes: jsonMeshes, accessors, bufferViews: views, buffers: [{ byteLength: len }], materials };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = Uint8Array.from([...js, ...new Array(pad).fill(0x20)]);
  const out = new Uint8Array(12 + 8 + js.length + 8 + len), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  let o = 20 + js.length;
  dv.setUint32(o, len, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// a quad card at depth z (glTF space: the room file's negated z), width 1
const card = (name, z, material, extra = {}) => ({
  name, positions: [0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z], uvs: [0, 1, 1, 1, 1, 0, 0, 0],
  prims: [{ indices: [0, 2, 1, 0, 3, 2], material }], ...extra });

const parsedShader = (queue, lightMode) => ({
  name: "x", properties: [], keywords: [],
  subShaders: [{ tags: { tags: queue ? [["QUEUE", queue]] : [] },
                 passes: [{ name: "", tags: { tags: [] }, state: { m_Tags: { tags: lightMode ? [["LIGHTMODE", lightMode]] : [] } } }] }],
});

const SHADERS = {
  "Unlit/Transparent Cutout": parsedShader("AlphaTest"),
  "Unlit/Transparent": parsedShader("Transparent"),
  "Hidden/UI/DualKawaseBlur": parsedShader(null),
  "Universal Render Pipeline/Spine/Skeleton": parsedShader("Transparent", "UniversalForward"),
  "Universal Render Pipeline/Lit": parsedShader("Geometry", "UniversalForward"),
};

const MATERIALS = [
  { name: "cut", shader: "Unlit/Transparent Cutout", keywords: [], floats: { _Cutoff: 0.5 }, colors: {}, renderQueue: -1,
    texEnvs: { _MainTex: { texture: null, scale: [1, 1], offset: [0, 0] } } },
  { name: "tr", shader: "Unlit/Transparent", keywords: [], floats: {}, colors: {}, renderQueue: -1,
    texEnvs: { _MainTex: { texture: null, scale: [1, 1], offset: [0, 0] } } },
];

const SETTINGS = {
  backgroundPosition: { x: 0, y: 0, z: 0 }, backgroundRotation: { x: 0, y: 0, z: 0 }, backgroundScale: { x: 1, y: 1, z: 1 },
  originalOffset: { x: 0.2, y: 0.18, z: 5 }, orbitRatio: 1, defaultPositionOffset: { x: 0, y: 0, z: 2.35 },
  fieldOfView: 19, zoomMinFov: 14, zoomMaxFov: 20,
};

const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

const makeStore = ({ roomNodes, spot = {}, home = {}, meshes } = {}) => {
  const ms = meshes || [card("near", -4, 0), card("hidden", -5, 0, { active: false }), card("glass", -6, 1), card("floor", -7, 0)];
  const nodes = roomNodes || ms.map((m) => ({ path: `room/${m.name}`, active: m.active !== false, renderQueue: m.name === "floor" ? 2000 : null }));
  const spotDoc = {
    spotId: 1, situationSettings: SETTINGS,
    characters: [{ path: "s/A", _characterId: 3, _distanceRatio: 0.3, world: translation(0, 0, 0), focusWorld: translation(1, 0.5, 6) }],
    spineCharacters: [], skeletons: [], ...spot };
  const hostDoc = { kind: "home", home: {
    spotId: 1, talk: "tap", characterId: 3, spot: "host/spot/spot.json", room: "host/spot/room.glb", roomNodes: nodes,
    roomMaterials: MATERIALS, situation: { name: "s", matched: true }, sceneRoot: { objRoot: null, lights: [], volumes: [] },
    volume: null, spineMaterials: {}, shaders: { index: "host/shaders/shaders.json", names: Object.keys(SHADERS) },
    blur: { iterations: 3, offset: 1, downsample: 1, blendRateMax: 0.3 }, ambient: null, ...home } };
  const text = { "host/host.json": JSON.stringify(hostDoc), "host/spot/spot.json": JSON.stringify(spotDoc),
                 "host/shaders/shaders.json": JSON.stringify(Object.keys(SHADERS).map((n, i) => ({ name: n, parsed: `s${i}.json`, variants: [] }))) };
  Object.keys(SHADERS).forEach((n, i) => { text[`host/shaders/s${i}.json`] = JSON.stringify(SHADERS[n]); });
  const bytes = { "host/spot/room.glb": buildGlb(ms, MATERIALS.map((m) => ({ name: m.name }))) };
  return { store: new AssetStore({ text, bytes }), host: hostDoc };
};

const CAM = { near: 0.3, far: 1000, clearFlags: 2, clearColor: [0, 0, 0, 1] };

test("Spine mesh uploads preserve another renderer's index buffer", () => {
  const foreign = {}, own = {}, indices = new Map([[foreign, "character indices"]]);
  let bound = foreign;
  const gl = { ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, DYNAMIC_DRAW: 3,
    bindVertexArray: (vao) => { bound = vao; }, createBuffer: () => ({}),
    bindBuffer: (target, buffer) => { if (target === 2) indices.set(bound, buffer); }, bufferData() {} };
  const mesh = { positions: new Float32Array(6), colors: new Uint8Array(8), uvs: new Float32Array(4), indices: new Uint32Array(3) };
  const skeleton = { skeleton: { buildMesh: () => mesh } };
  SimpleHomeHost.prototype._uploadSkeleton.call({ gl, vao: own, buffers: [] }, skeleton);
  assert.equal(indices.get(foreign), "character indices");
  assert.equal(indices.get(own), skeleton.gpu.index);
});

// ------------------------------------------------------------------------------------------------------------ glb
test("glb: the room file's glTF space goes back to Unity space (z, winding, uv v)", () => {
  const bytes = buildGlb([card("a", -4, 0), card("b", -5, 1, { active: false })], [{ name: "m0" }, { name: "m1" }]);
  const glb = parseGlb(bytes);
  assert.equal(glb.json.nodes.length, 2);
  const [a, b] = roomMeshes(glb);
  assert.equal(a.name, "a"); assert.equal(a.active, true); assert.equal(b.active, false);
  const p = a.primitives[0];
  assert.deepEqual(Array.from(p.positions.slice(0, 6)), [0, 0, 4, 1, 0, 4]);          // z negated
  assert.deepEqual(Array.from(p.indices), [0, 1, 2, 0, 2, 3]);                          // winding reversed back
  assert.deepEqual(Array.from(p.uvs), [0, 0, 1, 0, 1, 1, 0, 1]);                        // v = 1 - v
  assert.equal(p.material, 0); assert.equal(p.vertexCount, 4);
  assert.deepEqual(a.bounds.min, { x: 0, y: 0, z: 4 }); assert.deepEqual(a.bounds.max, { x: 1, y: 1, z: 4 });
  assert.deepEqual(a.bounds.center, { x: 0.5, y: 0.5, z: 4 });
  assert.equal(b.primitives[0].material, 1);
  assert.equal(p.normals, null);                                                        // no NORMAL in the file
  const [n] = roomMeshes(parseGlb(buildGlb([card("n", -4, 0, { normals: [0, 0, 1, 0, 0, 1, 0.6, 0, 0.8, 0, 1, 0] })], [{ name: "m0" }])));
  assert.deepEqual(Array.from(n.primitives[0].normals), [0, 0, -1, 0, 0, -1, F(0.6), 0, F(-0.8), 0, 1, -0]);  // z negated
  const short = parseGlb(buildGlb([card("n", -4, 0, { normals: [0, 0, 1] })], [{ name: "m0" }]));
  assert.throws(() => roomMeshes(short), /NORMAL count differs from POSITION/);
});

test("glb: malformed files are refused", () => {
  assert.throws(() => parseGlb(new Uint8Array(24)), /not a binary glTF/);
  const bytes = buildGlb([card("a", -4, 0)], [{ name: "m0" }]);
  const bad = bytes.slice(); new DataView(bad.buffer).setUint32(4, 1, true);
  assert.throws(() => parseGlb(bad), /container version 1/);
  const glb = parseGlb(bytes);
  glb.json.nodes[0].translation = [1, 0, 0];
  assert.throws(() => roomMeshes(glb), /transform/);
});

// --------------------------------------------------------------------------------------------------------- camera
test("camera math: LookRotation basis, Quaternion * Vector3, Slerp end points", () => {
  assert.deepEqual(lookRotation({ x: 0, y: 0, z: 5 }), { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(lookRotation({ x: 0, y: 0, z: 0 }), null);
  assert.equal(lookRotation({ x: 0, y: 2, z: 0 }), null);                              // parallel to up
  const d = { x: 0.3, y: -0.4, z: 2 }, q = lookRotation(d), n = Math.hypot(d.x, d.y, d.z);
  assert.ok(nearVec(forwardOf(q), { x: d.x / n, y: d.y / n, z: d.z / n }));
  const up = rotateVector(q, { x: 0, y: 1, z: 0 }), right = rotateVector(q, { x: 1, y: 0, z: 0 });
  assert.ok(near(right.y, 0), "the camera's right axis stays horizontal (world up)");
  assert.ok(up.y > 0);
  const r90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  assert.deepEqual(slerp(q, r90, 0), q);
  assert.ok(["x", "y", "z", "w"].every((k) => near(slerp(q, r90, 1)[k], F(r90[k]))));
  const h = slerp({ x: 0, y: 0, z: 0, w: 1 }, r90, 0.5);
  assert.ok(near(h.y, Math.sin(Math.PI / 8)) && near(h.w, Math.cos(Math.PI / 8)));
});

test("camera: SetDefaultPosition = LookAt(originalOffset) from defaultPositionOffset, then minus orbitRatio x forward", () => {
  const loop = new PlayerLoop(30);
  const c1 = new SpotCamera(loop, { ...SETTINGS, originalOffset: { x: 0, y: 0, z: 10 }, defaultPositionOffset: { x: 0, y: 0, z: 0 }, orbitRatio: 2 },
                            { near: 0.3, far: 1000 });
  assert.deepEqual(c1.rotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(c1.position, { x: 0, y: 0, z: -2 });
  const c2 = new SpotCamera(loop, SETTINGS, { near: 0.3, far: 1000 });
  const d = { x: 0.2, y: F(0.18) - 0, z: 5 - F(2.35) }, n = Math.hypot(d.x, d.y, d.z);
  const fw = forwardOf(c2.rotation);
  assert.ok(nearVec(fw, { x: d.x / n, y: d.y / n, z: d.z / n }));
  assert.deepEqual(c2.position, { x: F(0 - fw.x), y: F(0 - fw.y), z: F(F(2.35) - fw.z) });
  assert.equal(c2.fieldOfView, 19);
  assert.equal(spotFieldOfView({ fieldOfView: 25, zoomMinFov: 14, zoomMaxFov: 20 }), 20);
  assert.equal(spotFieldOfView({ fieldOfView: 10, zoomMinFov: 14, zoomMaxFov: 20 }), 14);
  assert.throws(() => new SpotCamera(loop, SETTINGS, { near: 0, far: 10 }), /clip planes/);
});

// the Tween's float32 position after k frames of f(dt)
const tweenPositions = (dt, duration, frames) => {
  const out = []; let p = 0;
  for (let i = 0; i < frames; i++) { p = F(p + F(dt)); if (F(duration) <= p) p = F(duration); out.push(p); }
  return out;
};

test("camera: FocusCharacterAsync and ReturnToDefaultPosition tween 0.5 s InOutQuad on the loop's tween phase", async () => {
  const { store, host } = makeStore();
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: CAM, spine: null });
  const P = { ...h.camera.position }, R0 = { ...h.camera.rotation };
  const Fw = { x: 1, y: 0.5, z: 6 }, k = F(0.3);
  const target = { x: F(F(F(Fw.x - P.x) * k) + P.x), y: F(F(F(Fw.y - P.y) * k) + P.y), z: F(F(F(Fw.z - P.z) * k) + P.z) };
  let done = false;
  h.focusCharacter(3, 0.5).then(() => { done = true; });
  const dt = 1 / 30, ps = tweenPositions(dt, 0.5, 30), end = ps.findIndex((p) => p >= F(0.5)) + 1;
  for (let i = 0; i < end; i++) {
    await loop.step();
    const e = easeF(EASE.InOutQuad, ps[i], 0.5);
    for (const c of ["x", "y", "z"]) assert.equal(h.camera.position[c], F(F(P[c]) + F(F(F(target[c]) - F(P[c])) * e)), `frame ${i + 1} ${c}`);
    if (i < end - 1) assert.equal(done, false);
  }
  await flush();
  assert.equal(done, true);
  assert.equal(end, 15);
  assert.ok(nearVec(h.camera.position, target));
  const fw = forwardOf(h.camera.rotation), d = { x: Fw.x - target.x, y: Fw.y - target.y, z: Fw.z - target.z }, n = Math.hypot(d.x, d.y, d.z);
  assert.ok(nearVec(fw, { x: d.x / n, y: d.y / n, z: d.z / n }, 1e-5), "looks at the focus from the target");
  // return: the default pose again, same timing
  let back = false;
  h.returnToDefaultPosition(0.5).then(() => { back = true; });
  for (let i = 0; i < 15; i++) await loop.step();
  await flush();
  assert.equal(back, true);
  assert.ok(nearVec(h.camera.position, P));
  assert.ok(["x", "y", "z", "w"].every((c) => near(h.camera.rotation[c], R0[c])));
  h.stopUiFadeAndShow();
  assert.equal(h.uiAlpha, 1);
  h.resetCamera();
  assert.equal(h.uiAlpha, 1);
  h.dispose();
});

// -------------------------------------------------------------------------------------------------------------- blur
test("blur: ExecBlur ramps the rate over 0.2 s from the caller's frame (scaled dt, first step dt / 0.2); StopBlur is instant", async () => {
  const loop = new PlayerLoop(30), blur = new UIBlur(loop), seen = [];
  loop.on("update", (l) => { if (l.frameCount === 1) blur.exec(0.2); });
  for (let i = 0; i < 9; i++) { await loop.step(); seen.push(blur.effectiveRate); }
  // expected: the float32 ramp of ChangeBlurRateOverTime, one step per frame
  const exp = []; let e = 0;
  while (e < F(0.2)) { e = F(e + F(1 / 30)); exp.push(F(0 + F(F(1 - 0) * Math.min(1, F(e / F(0.2)))))); }
  exp.push(1);
  assert.equal(seen[0], F(F(1 / 30) / F(0.2)));
  assert.deepEqual(seen.slice(0, exp.length), exp);
  assert.ok(seen.slice(exp.length).every((r) => r === 1));
  // already on and not stopping: ExecBlur does nothing
  blur.exec(0.2);
  assert.equal(blur.effectiveRate, 1);
  blur.stop();
  assert.equal(blur.effectiveRate, 0);
  assert.equal(blur.enabled, false);
  // timeScale scales the ramp (Time.deltaTime); a stop during the ramp leaves the pass off
  const loop2 = new PlayerLoop(30), b2 = new UIBlur(loop2);
  loop2.timeScale = 2;
  loop2.on("update", (l) => { if (l.frameCount === 1) b2.exec(0.2); });
  await loop2.step();
  assert.equal(b2.effectiveRate, F(F(2 / 30) / F(0.2)));
  b2.stop();
  await loop2.step(); await loop2.step();
  assert.equal(b2.effectiveRate, 0);
  // duration <= 0: rate 1 at once
  const b3 = new UIBlur(loop2);
  b3.exec(0);
  assert.equal(b3.effectiveRate, 1);
});

test("blur pass: UIRenderPass.Setup clamps, offset = rate x offset, blend = clamp01(rate / blendRateMax), level sizes", () => {
  const P = { iterations: 3, offset: 1, downsample: 1, blendRateMax: 0.3 };
  assert.equal(blurPass(P, 0), null);
  assert.deepEqual(blurPass(P, 0.15), { iterations: 3, downsample: 1, offset: F(0.15), blendRate: F(F(0.15) / F(0.3)) });
  assert.deepEqual(blurPass(P, 1), { iterations: 3, downsample: 1, offset: 1, blendRate: 1 });
  assert.deepEqual(blurPass(P, 0.3).blendRate, 1);
  assert.equal(blurSettings({ ...P, iterations: 0 }, 1).iterations, 1);
  assert.equal(blurSettings({ ...P, iterations: 12 }, 1).iterations, 8);
  assert.equal(blurSettings({ ...P, blendRateMax: 0.001 }, 1).blendRateMax, F(0.01));
  assert.equal(blurSettings({ ...P, blendRateMax: 3 }, 1).blendRateMax, 1);
  assert.equal(blurSettings({ ...P, offset: -1, downsample: -2 }, 1).offset, 0);
  assert.deepEqual(blurLevels(1920, 1080, 3, 1), [{ width: 960, height: 540 }, { width: 480, height: 270 }, { width: 240, height: 135 }]);
  assert.deepEqual(blurLevels(5, 3, 3, 1), [{ width: 2, height: 1 }, { width: 1, height: 1 }, { width: 1, height: 1 }]);
  assert.deepEqual(blurLevels(100, 50, 2, 0), [{ width: 100, height: 50 }, { width: 50, height: 25 }]);
});

// -------------------------------------------------------------------------------------------------------------- room
test("room: roomNodes visibility, the floor queue override and URP's opaque / transparent order", () => {
  const { store, host } = makeStore();
  const { data, objects, summary } = homeResources(store, host, {});
  const shaders = new ShaderInfo(objects);
  assert.equal(shaders.queue("Unlit/Transparent Cutout"), 2450);
  assert.deepEqual(shaders.forwardPasses("Universal Render Pipeline/Spine/Skeleton"), [0]);
  const room = new SpotRoom(parseGlb(store.bytes("host/spot/room.glb")), summary, data.host.home.backgroundState, objects, shaders);
  const items = room.drawItems(backgroundMatrix(SETTINGS, null), { x: 0, y: 0, z: 0 });
  assert.deepEqual(items.map((it) => room.meshes[it.part.node].name), ["near", "glass", "floor"]);   // "hidden" is inactive
  const order = sortDrawItems(items.map((it, i) => ({ ...it, index: i }))).map((it) => `${room.meshes[it.part.node].name}:${it.queue}`);
  assert.deepEqual(order, ["floor:2000", "near:2450", "glass:3000"]);
  // opaque front to back, transparent back to front
  const mk = (queue, dist, index) => ({ queue, dist, index, sortingOrder: 0 });
  assert.deepEqual(sortDrawItems([mk(2450, 5, 0), mk(2450, 2, 1), mk(3000, 2, 2), mk(3000, 9, 3)]).map((i) => i.index), [1, 0, 3, 2]);
  assert.deepEqual(sortDrawItems([mk(3000, 9, 0), { ...mk(3000, 1, 1), sortingOrder: 1 }]).map((i) => i.index), [0, 1]);
  assert.equal(parseQueueTag("Transparent+1"), 3001);
  assert.equal(parseQueueTag("Geometry-10"), 1990);
  assert.throws(() => new SpotRoom(parseGlb(store.bytes("host/spot/room.glb")), { ...summary, nodes: [] }, data.host.home.backgroundState, objects, shaders), /room nodes/);
});

test("background root: localPosition, world eulerAngles and localScale under objRoot", () => {
  const s = { ...SETTINGS, backgroundPosition: { x: 1, y: 2, z: 3 }, backgroundRotation: { x: 0, y: 90, z: 0 }, backgroundScale: { x: 2, y: 2, z: 2 } };
  const m = backgroundMatrix(s, null);
  assert.ok(near(m[12], 1) && near(m[13], 2) && near(m[14], 3));
  assert.ok(near(m[8], 2) && near(m[2], -2), "Euler(0, 90, 0) turns +z to +x");
  // a parent rotated 90 degrees about y: the world rotation is still Euler(0, 90, 0), the position is rotated
  const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  const m2 = backgroundMatrix(s, { position: { x: 0, y: 0, z: 0 }, rotation: q, scale: { x: 1, y: 1, z: 1 } });
  assert.ok(near(m2[8], 2, 1e-5) && near(m2[2], -2, 1e-5));
  assert.ok(near(m2[12], 3, 1e-5) && near(m2[14], -1, 1e-5));
  // the room's baked space: the root's serialized transform (baked into every vertex) is taken out again
  const root = { localPosition: { x: -0.5, y: 0.25, z: 2 }, localRotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
                 localScale: { x: 2, y: 2, z: 2 } };
  const baked = mat4.transformPoint(mat4.trs(root.localPosition, root.localRotation, root.localScale), { x: 1, y: 2, z: 3 });
  const w = mat4.transformPoint(roomMatrix(m, root), baked), e = mat4.transformPoint(m, { x: 1, y: 2, z: 3 });
  assert.ok(nearVec(w, e, 1e-5));
  assert.equal(roomMatrix(m, null), m);
  const inv = mat4.mul(inverseTRS(root.localPosition, root.localRotation, root.localScale), mat4.trs(root.localPosition, root.localRotation, root.localScale));
  assert.ok(Array.from(inv).every((v, i) => near(v, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i], 1e-6)));
});

// -------------------------------------------------------------------------------------------------------------- host
test("host: headless create, 'Spine runtime missing' without a runtime or with one of another version", async () => {
  const spine = {
    spineCharacters: [{ path: "s/A", skeletonData: "A_SkeletonData", animation: { _animationName: "home_start", loop: 0, timeScale: 1,
      initialSkinName: "", initialFlipX: 0, initialFlipY: 0, pmaVertexColors: 1, tintBlack: 0, zSpacing: 0 }, world: translation(0, 0, 5) }],
    skeletons: [{ name: "A_SkeletonData", skeleton: "a.json", atlases: ["a.atlas"], scale: 0.01, defaultMix: 0.2, mixes: [] }] };
  const { store, host } = makeStore({ spot: spine });
  store._text.set("host/spot/spine/a.json", JSON.stringify({ skeleton: { spine: "4.2.43" } }));
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: CAM, spine: null });
  assert.deepEqual(h.missing, [SPINE_MISSING]);
  assert.match(h.spineReason, /no Spine runtime/);
  assert.equal(h.skeletons.length, 0);
  h.renderScene(null, 64, 32); h.applyBlur(null, 64, 32);                             // no context: nothing drawn
  assert.equal(h.blurRate, 0);
  h.execBlur();
  await loop.step();
  assert.ok(h.blurRate > 0);
  h.stopBlur();
  assert.equal(h.blurRate, 0);
  h.dispose();
  const old = { TextureAtlas() {}, AtlasAttachmentLoader() {}, SkeletonJson() {}, SkeletonBinary() {}, Skeleton() {}, AnimationState() {},
                AnimationStateData() {}, Physics: {}, SkeletonClipping() {}, RegionAttachment() {}, MeshAttachment() {}, ClippingAttachment() {},
                BlendMode: {}, version: "4.1.54" };
  const h2 = await createHome(null, store, loop, host, { camera: CAM, spine: old });
  assert.deepEqual(h2.missing, [SPINE_MISSING]);
  assert.match(h2.spineReason, /4\.1 cannot read skeleton data 4\.2\.43/);
  h2.dispose();
  // the spot's volume is drawn by the post chain: nothing listed (no Spine characters in this spot)
  const { store: s3, host: h3doc } = makeStore({ home: { volume: { path: "bg", active: true, enabled: true, isGlobal: true,
    weight: 0.05, priority: 0, blendDistance: 0, layer: 15, profile: "p", components: [] } } });
  const h3 = await createHome(null, s3, loop, h3doc, { camera: CAM, spine: null });
  assert.deepEqual(h3.missing, []);
  h3.dispose();
  assert.throws(() => new SimpleHomeHost(null, store, loop, { kind: "afterlive" }, { camera: CAM }), /not a home host/);
});

// ----------------------------------------------------------------------------------------------- URP lighting
const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const RENDER_SETTINGS = { m_Fog: 0, m_AmbientMode: 3, m_AmbientSkyColor: WHITE, m_AmbientIntensity: 1, m_DefaultReflectionMode: 0,
                          m_SkyboxMaterial: null, m_CustomReflection: null, m_Sun: null, lightmaps: 0 };
const pipeline = (extra = {}) => ({ m_ShEvalMode: 0, m_MainLightRenderingMode: 1, m_MainLightShadowsSupported: 0,
                                    m_AdditionalLightsRenderingMode: 0, m_AdditionalLightShadowsSupported: 0,
                                    m_ReflectionProbeBlending: 0, m_ReflectionProbeBoxProjection: 0, m_SupportsLightLayers: 0,
                                    m_RendererDataList: ["Runtime", "Editor"], m_DefaultRendererIndex: 1, m_SupportsHDR: 1, ...extra });
const GRAPHICS = {
  defaultPipeline: "Best",
  qualityLevels: [{ name: "Middle", customRenderPipeline: "Middle" }, { name: "Best", customRenderPipeline: "Best" }],
  pipelines: { Best: pipeline({ m_AdditionalLightsRenderingMode: 2 }), Middle: pipeline() },
  renderers: { Runtime: { m_RenderingMode: 0, m_RendererFeatures: [{ class: "Fwk.UI.Rendering.UIRendererFeature", m_Active: 1 }] },
               Editor: { m_RenderingMode: 0, m_RendererFeatures: [] } },
};
const lighting = (over = {}) => spotLighting(lightingResources({ graphics: GRAPHICS, quality: 1, rendererIndex: 0, renderSettings: RENDER_SETTINGS,
                                               lights: [], what: "home spot 1", ...over }));

test("spotLighting: keywords of the quality level's pipeline asset, no light, URP's default light constants", () => {
  const best = lighting();
  assert.equal(best.pipeline.m_Name, "Best"); assert.equal(best.renderer.m_Name, "Runtime");
  // Auto SH evaluation is per vertex on GLES3; the additional lights keyword stays on without an additional light
  assert.deepEqual(best.keywords, ["EVALUATE_SH_VERTEX", "_ADDITIONAL_LIGHTS_VERTEX"]);
  assert.deepEqual(lighting({ quality: 0 }).keywords, ["EVALUATE_SH_VERTEX"]);
  assert.equal(lighting({ rendererIndex: -1 }).renderer.m_Name, "Editor");
  const g = (p) => ({ ...GRAPHICS, pipelines: { ...GRAPHICS.pipelines, Best: pipeline(p) } });
  assert.deepEqual(lighting({ graphics: g({ m_ShEvalMode: 3, m_AdditionalLightsRenderingMode: 1 }) }).keywords, ["_ADDITIONAL_LIGHTS"]);
  assert.deepEqual(lighting({ graphics: g({ m_ShEvalMode: 2, m_ReflectionProbeBlending: 1 }) }).keywords,
                   ["EVALUATE_SH_MIXED", "_REFLECTION_PROBE_BLENDING"]);
  assert.deepEqual(lighting({ graphics: { ...GRAPHICS, qualityLevels: [{ customRenderPipeline: null }] }, quality: 0 }).pipeline.m_Name, "Best");
  assert.deepEqual(best.globals._MainLightPosition, [0, 0, 1, 0]);
  assert.deepEqual(best.globals._MainLightColor, [0, 0, 0, 1]);
  assert.deepEqual(best.globals._AdditionalLightsCount, [0, 0, 0, 0]);
  assert.deepEqual(best.perObject.unity_SHAr, [0, 0, 0, 1]);                 // a white Flat ambient: SH(N) = 1
  assert.deepEqual(best.perObject.unity_SHC, [0, 0, 0, 0]);
  assert.deepEqual(best.perObject.unity_LightData, [0, 0, 1, 0]);
  // inactive or disabled lights light nothing
  const off = [{ path: "a", type: "Light", active: false, m_Enabled: 1 }, { path: "b", type: "Light", active: true, m_Enabled: 0 }];
  assert.deepEqual(lighting({ lights: off }).keywords, best.keywords);
});

test("spotLighting: what it does not reproduce is refused", () => {
  const rs = (x) => ({ renderSettings: { ...RENDER_SETTINGS, ...x } });
  const g = (p) => ({ graphics: { ...GRAPHICS, pipelines: { ...GRAPHICS.pipelines, Best: pipeline(p) } } });
  const r = (x) => ({ graphics: { ...GRAPHICS, renderers: { ...GRAPHICS.renderers, Runtime: { m_RenderingMode: 0, m_RendererFeatures: [], ...x } } } });
  for (const [over, re] of [
    [{ graphics: null }, /needs the scene's render settings/],
    [{ quality: 4 }, /quality level 4/],
    [{ lights: [{ path: "room/lamp", type: "Light", active: true, m_Enabled: 1 }] }, /Light room\/lamp is not reproduced/],
    [{ lights: [{ path: "probe", type: "ReflectionProbe", active: true, m_Enabled: 1 }] }, /ReflectionProbe probe/],
    [{ renderSettings: null }, /RenderSettings/],
    [rs({ m_Fog: 1 }), /fog/],
    [rs({ m_Sun: { name: null } }), /sun/],
    [rs({ lightmaps: 2 }), /lightmaps/],
    [rs({ m_AmbientMode: 0 }), /ambient mode 0/],
    [rs({ m_AmbientSkyColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }), /white Flat ambient/],
    [rs({ m_SkyboxMaterial: { name: "sky" } }), /default reflection/],
    [rs({ m_DefaultReflectionMode: 1 }), /default reflection/],
    [g({ m_MainLightShadowsSupported: 1 }), /main light shadows/],
    [g({ m_AdditionalLightShadowsSupported: 1, m_AdditionalLightsRenderingMode: 1 }), /additional light shadows/],
    [g({ m_SupportsLightLayers: 1 }), /light layers/],
    [r({ m_RenderingMode: 2 }), /rendering mode 2/],
    [r({ m_RendererFeatures: [{ class: "UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion", m_Active: 1 }] }), /ScreenSpaceAmbientOcclusion/],
  ]) assert.throws(() => lighting(over), re, JSON.stringify(over));
  // an inactive feature sets nothing
  lighting(r({ m_RendererFeatures: [{ class: "UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion", m_Active: 0 }] }));
});

test("roomInverse: the inverse of roomMatrix", () => {
  const settings = { ...SETTINGS, backgroundPosition: { x: 1, y: -2, z: 3 }, backgroundRotation: { x: 10, y: 180, z: -5 },
                     backgroundScale: { x: 2, y: 1, z: 0.5 } };
  const objRoot = { position: { x: 0.5, y: 0, z: -1 }, rotation: { x: 0, y: 0.7071068, z: 0, w: 0.7071068 }, scale: { x: 1, y: 2, z: 1 } };
  const roomRoot = { localPosition: { x: 0, y: 1, z: 0 }, localRotation: { x: 0, y: 1, z: 0, w: 0 }, localScale: { x: 1, y: 1, z: 2 } };
  for (const [o, rr] of [[null, null], [objRoot, null], [objRoot, roomRoot]]) {
    const I = mat4.mul(roomMatrix(backgroundMatrix(settings, o), rr), roomInverse(settings, o, rr));
    I.forEach((v, i) => assert.ok(near(v, i % 5 === 0 ? 1 : 0, 1e-5), `${i}: ${v}`));
  }
});

// a pass render state as the parsed shader files hold it (opaque, no blend, ZTest LEqual, back faces culled)
const v = (val) => ({ val });
const PASS_STATE = { rtBlend0: { srcBlend: v(1), destBlend: v(0), srcBlendAlpha: v(1), destBlendAlpha: v(0), blendOp: v(0),
                                 blendOpAlpha: v(0), colMask: v(15) },
                     zTest: v(4), zWrite: v(1), culling: v(2), offsetFactor: v(0), offsetUnits: v(0), stencilRef: v(0),
                     stencilReadMask: v(255), stencilWriteMask: v(255), rtSeparateBlend: false, alphaToMask: v(0),
                     stencilOp: { comp: v(8), pass: v(0), fail: v(0), zFail: v(0) },
                     stencilOpFront: { comp: v(8), pass: v(0), fail: v(0), zFail: v(0) },
                     stencilOpBack: { comp: v(8), pass: v(0), fail: v(0), zFail: v(0) } };
const drawnShader = (queue, lightMode, passes = 1) => ({
  name: "x", properties: [], keywords: [],
  subShaders: [{ tags: { tags: queue ? [["QUEUE", queue], ["RenderPipeline", "UniversalPipeline"]] : [] },
                 passes: Array.from({ length: passes }, () => ({ name: "", tags: { tags: [] },
                   state: { ...PASS_STATE, m_Tags: { tags: lightMode ? [["LIGHTMODE", lightMode]] : [] } } })) }],
});
const LIT = "Universal Render Pipeline/Lit";
const DRAWN_SHADERS = {
  "Unlit/Transparent Cutout": [drawnShader("AlphaTest"), [[0, []]]],
  "Hidden/UI/DualKawaseBlur": [drawnShader(null, null, 3), [[0, []], [1, []], [2, []]]],
  [LIT]: [{ ...drawnShader("Geometry", "UniversalForward"),               // _BaseMap unset: the shader's default white
            properties: [{ m_Name: "_BaseMap", m_Type: 4, m_DefTexture: { m_DefaultName: "white" } }] },
          [[0, ["EVALUATE_SH_VERTEX"]], [0, ["EVALUATE_SH_VERTEX", "_ADDITIONAL_LIGHTS_VERTEX"]],
           [0, ["EVALUATE_SH_VERTEX", "_ADDITIONAL_LIGHTS", "_MAIN_LIGHT_SHADOWS"]]]],
};
// the Lit forward pass's inputs (URP 14 Lit, pass ForwardLit, EVALUATE_SH_VERTEX): what the headless context reports
const LIT_INPUTS = {
  attribs: ["in_POSITION0", "in_NORMAL0", "in_TEXCOORD0"],
  uniforms: ["hlslcc_mtx4x4unity_MatrixVP", "_GlobalMipBias", "_MainLightPosition", "_MainLightColor", "_WorldSpaceCameraPos",
             "unity_OrthoParams", "hlslcc_mtx4x4unity_MatrixV"],
  blocks: { UnityPerDraw: ["hlslcc_mtx4x4unity_ObjectToWorld", "hlslcc_mtx4x4unity_WorldToObject", "unity_LightData",
                           "unity_SpecCube0_HDR", "unity_SHAr", "unity_SHAg", "unity_SHAb", "unity_SHBr", "unity_SHBg", "unity_SHBb", "unity_SHC"],
            UnityPerMaterial: ["_BaseMap_ST", "_BaseColor", "_Smoothness", "_Metallic", "_Surface"] },
  samplers: [["unity_SpecCube0", "SAMPLER_CUBE"], ["_BaseMap", "SAMPLER_2D"]],
};
const glsl = (tag) => `#ifdef VERTEX\n#version 300 es\n// ${tag}\n#endif\n#ifdef FRAGMENT\n#version 300 es\n#endif\n`;

// the headless context, reporting LIT_INPUTS for the programs linked from a source tagged LIT (as a browser reports a
// program's active inputs); records the uniform values set and the textures bound per target
const litGL = () => {
  const calls = [];
  const gl = headlessGL({ width: 64, height: 32, onCall: (n, a) => calls.push([n, a]) });
  const src = new Map(), shadersOf = new Map(), lit = new Set();
  const plain = LIT_INPUTS.uniforms.map((n) => ({ name: n.startsWith("hlslcc_mtx4x4") ? `${n}[0]` : n,
                                                  type: n.startsWith("hlslcc_mtx4x4") ? gl.FLOAT_VEC4 : gl.FLOAT_VEC4,
                                                  size: n.startsWith("hlslcc_mtx4x4") ? 4 : 1 }));
  const blockNames = Object.keys(LIT_INPUTS.blocks);
  const members = blockNames.flatMap((b) => LIT_INPUTS.blocks[b].map((n) => ({ block: b, name: n.startsWith("hlslcc") ? `${n}[0]` : n,
                                                                             type: gl.FLOAT_VEC4, size: n.startsWith("hlslcc") ? 4 : 1 })));
  const samplers = LIT_INPUTS.samplers.map(([name, t]) => ({ name, type: gl[t], size: 1 }));
  const all = [...members, ...plain, ...samplers];
  const base = { shaderSource: gl.shaderSource, attachShader: gl.attachShader, linkProgram: gl.linkProgram };
  Object.assign(gl, {
    shaderSource: (sh, t) => { src.set(sh, t); base.shaderSource(sh, t); },
    attachShader: (p, sh) => { if (!shadersOf.has(p)) shadersOf.set(p, []); shadersOf.get(p).push(sh); base.attachShader(p, sh); },
    linkProgram: (p) => { if ((shadersOf.get(p) || []).some((sh) => /\/\/ LIT/.test(src.get(sh)))) lit.add(p); base.linkProgram(p); },
    getProgramParameter: (p, n) => (n === gl.LINK_STATUS ? true : !lit.has(p) ? 0 : n === gl.ACTIVE_ATTRIBUTES ? LIT_INPUTS.attribs.length
                                    : n === gl.ACTIVE_UNIFORMS ? all.length : n === gl.ACTIVE_UNIFORM_BLOCKS ? blockNames.length : 0),
    getActiveAttrib: (p, i) => ({ name: LIT_INPUTS.attribs[i], type: gl.FLOAT_VEC4, size: 1 }),
    getAttribLocation: (p, name) => (lit.has(p) ? LIT_INPUTS.attribs.indexOf(name) : -1),
    getActiveUniformBlockName: (p, b) => blockNames[b],
    getActiveUniformBlockParameter: (p, b, n) => (n === gl.UNIFORM_BLOCK_DATA_SIZE ? 4096
      : all.map((u, i) => [u, i]).filter(([u]) => u.block === blockNames[b]).map(([, i]) => i)),
    getActiveUniforms: (p, idx, n) => idx.map((i) => (n === gl.UNIFORM_OFFSET ? i * 64 : 16)),
    getActiveUniform: (p, i) => all[i],
    getUniformLocation: (p, name) => ({ uniform: name }),
  });
  return { gl, calls, lit };
};

const litStore = (renderSettings = RENDER_SETTINGS, home = {}) => {
  const litMat = { name: "atlas_mat", shader: LIT, keywords: [], floats: { _Smoothness: 0, _Metallic: 0, _Surface: 0 },
                   colors: { _BaseColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }, renderQueue: -1,
                   texEnvs: { _BaseMap: { texture: null, scale: [1, 1], offset: [0, 0] } } };
  const mats = [MATERIALS[0], litMat];
  const ms = [card("near", -4, 0), card("wall", -6, 1, { normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] })];
  const nodes = ms.map((m) => ({ path: `room/${m.name}`, active: true, renderQueue: null }));
  const hostDoc = { kind: "home", home: {
    spotId: 1, talk: "area", characterId: null, spot: "host/spot/spot.json", room: "host/spot/room.glb", roomNodes: nodes,
    roomMaterials: mats, situation: { name: "s", matched: true },
    sceneRoot: { objRoot: null, lights: [], volumes: [], renderSettings }, lights: [], volume: null, spineMaterials: {},
    shaders: { index: "host/shaders/shaders.json", names: Object.keys(DRAWN_SHADERS) },
    blur: { iterations: 3, offset: 1, downsample: 1, blendRateMax: 0.3 }, ambient: null, ...home } };
  const spotDoc = { spotId: 1, situationSettings: SETTINGS, characters: [], spineCharacters: [], skeletons: [] };
  const index = Object.entries(DRAWN_SHADERS).map(([name, [, vs]], i) => ({ name, parsed: `s${i}.json`,
    variants: vs.map(([pass, keywords], k) => ({ platform: "gles3", type: "GLES3", subShader: 0, pass, stage: "vertex", keywords,
                                                 file: `s${i}/v${k}.glsl` })) }));
  const text = { "host/host.json": JSON.stringify(hostDoc), "host/spot/spot.json": JSON.stringify(spotDoc),
                 "host/shaders/shaders.json": JSON.stringify(index) };
  Object.entries(DRAWN_SHADERS).forEach(([name, [parsed, vs]], i) => {
    text[`host/shaders/s${i}.json`] = JSON.stringify(parsed);
    vs.forEach(([, kw], k) => { text[`host/shaders/s${i}/v${k}.glsl`] = glsl(name === LIT ? `LIT ${kw.join(" ")}` : name); });
  });
  const bytes = { "host/spot/room.glb": buildGlb(ms, mats.map((m) => ({ name: m.name }))) };
  return { store: new AssetStore({ text, bytes }), host: hostDoc };
};
const DRAWN_CAM = { ...CAM, orthographicSize: 5, rendererIndex: 0 };

// the story's URP post programs as recording stand-ins: blits = [{shader, pass, keywords, value(name)}]
const POST_STATE = { src: 1, dst: 0, srcA: 1, dstA: 0, op: 0, opA: 0, colMask: 15, zTest: 8, zWrite: 0, cull: 0,
                     offsetFactor: 0, offsetUnits: 0, stencilFront: [8, 0, 0, 0], stencilBack: [8, 0, 0, 0],
                     stencilRef: 0, stencilRead: 255, stencilWrite: 255 };
const postLib = () => {
  const blits = [];
  const lib = { program: (shader, pass, keywords) => ({ apply: (sheets) => {
    const value = (n) => { for (const x of sheets) if (n in x) return x[n]; return undefined; };
    blits.push({ shader: shader.split("/").pop(), pass, keywords: [...keywords].sort(), value });
  } }), state: () => POST_STATE };
  return { lib, blits };
};

test("host: a drawn Lit room gets URP's lighting keywords, normals, light constants and the black reflection cube", async () => {
  const { store, host } = litStore();
  const { gl, calls } = litGL();
  const loop = new PlayerLoop(30);
  const h = await createHome(gl, store, loop, host, { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 1, spine: null,
                                                                  post: postLib() });
  const litPrograms = [...h.lib.cache.values()].filter((p) => p.label.startsWith(LIT));
  assert.deepEqual(litPrograms.map((p) => p.label), [`${LIT}#0.0[EVALUATE_SH_VERTEX _ADDITIONAL_LIGHTS_VERTEX]`]);
  const target = { glTexture: { kind: "Texture", id: -1 }, bind() {} };
  calls.length = 0;
  h.renderScene(target, 64, 32);
  // the normals are bound for the Lit pass; the cube sampler takes the black cube map
  assert.ok(calls.some(([n, a]) => n === "enableVertexAttribArray" && a[0] === LIT_INPUTS.attribs.indexOf("in_NORMAL0")));
  const cube = h.tex.blackCube;
  assert.equal(cube.target, gl.TEXTURE_CUBE_MAP);
  assert.ok(calls.some(([n, a]) => n === "bindTexture" && a[0] === gl.TEXTURE_CUBE_MAP && a[1] === cube.glTexture));
  const u4 = (name) => calls.filter(([n, a]) => n === "uniform4fv" && a[0].uniform === name).map(([, a]) => Array.from(a[1]));
  assert.deepEqual(u4("_MainLightColor").at(-1), [0, 0, 0, 1]);
  assert.deepEqual(u4("unity_OrthoParams").at(-1), [10, 5, 0, 0]);                  // orthographicSize x aspect 2
  const cam = h.camera.position;
  assert.deepEqual(u4("_WorldSpaceCameraPos").at(-1).slice(0, 3), [cam.x, cam.y, cam.z].map(F));
  gl.deleteTexture = () => {};
  h.dispose();
  // a lower quality level: no additional lights keyword
  const low = litStore();
  const h2 = await createHome(litGL().gl, low.store, new PlayerLoop(30), low.host,
                                         { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 0, spine: null, post: postLib() });
  assert.deepEqual([...h2.lib.cache.values()].filter((p) => p.label.startsWith(LIT)).map((p) => p.label), [`${LIT}#0.0[EVALUATE_SH_VERTEX]`]);
  h2.dispose();
});

test("host: a drawn session checks the lighting before any GL call", async () => {
  const { store, host } = litStore({ ...RENDER_SETTINGS, m_Fog: 1 });
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 1, spine: null });
  h.gl = new Proxy({}, { get: () => { throw new Error("GL call"); } });
  await assert.rejects(h._upload(), /home spot 1: scene fog is not reproduced/);
  h.graphics = null;
  await assert.rejects(h._upload(), /home spot 1: URP lighting needs the scene's render settings/);
  h.orthographicSize = undefined;
  await assert.rejects(h._upload(), /orthographic size/);
  h.gl = null;
  h.dispose();
});

// --------------------------------------------------------------------------------------- main camera and post
const camRec = (over = {}) => ({ m_ClearFlags: 2, m_BackGroundColor: { r: 1, g: 1, b: 1, a: 1 }, "near clip plane": 0.3,
  "far clip plane": 5000, "field of view": 60, orthographic: false, "orthographic size": 0, m_HDR: true,
  m_NormalizedViewPortRect: { x: 0, y: 0, width: 1, height: 1 }, ...over });
const camData = (over = {}) => ({ m_RendererIndex: 0, m_VolumeLayerMask: { m_Bits: 1 }, m_RenderPostProcessing: 1,
                                  m_Antialiasing: 0, m_Dithering: 0, ...over });

test("spotMainCamera: SetCameraInfo takes the scene camera's projection, clear and clip planes; HDR stays the main camera's", () => {
  const scene = { path: "SceneRoot/SceneCamera", camera: camRec({ m_BackGroundColor: { r: 0, g: 0, b: 0, a: 0 }, "far clip plane": 1000,
                                                                 "orthographic size": 170, m_HDR: false }) };
  const c = spotMainCamera(camRec(), camData({ m_RendererIndex: 2 }), scene);
  assert.deepEqual(c, { near: 0.3, far: 1000, clearFlags: 2, clearColor: [0, 0, 0, 0], orthographic: false, orthographicSize: 170,
                        viewport: { x: 0, y: 0, width: 1, height: 1 }, rendererIndex: 0, hdr: true, antialiasing: 0,
                        dithering: false, volumeMask: 1 << 15 });
  assert.equal(HOME_VIEW_MASK, 32768);
  // no scene camera: the main camera keeps its own values
  assert.deepEqual(spotMainCamera(camRec(), camData(), null).clearColor, [1, 1, 1, 1]);
  assert.equal(spotMainCamera(camRec(), camData(), null).far, 5000);
  assert.equal(checkSpotCamera(c), c);
  for (const [over, re] of [[{ orthographic: true }, /orthographic/], [{ viewport: { x: 0, y: 0, width: 0.5, height: 1 } }, /viewport/],
                            [{ antialiasing: 1 }, /antialiasing mode 1/], [{ dithering: true }, /dithering/]])
    assert.throws(() => checkSpotCamera({ ...c, ...over }, "home spot 7"), re);
});

const spotVol = (over = {}) => ({ path: "bg", active: true, enabled: true, isGlobal: true, weight: 0.05, priority: 0, blendDistance: 0,
  layer: 15, profile: "p", components: [{ class: "Bloom", active: true, threshold: 0.5, intensity: 4 },
    { class: "SplitToning", active: true, highlights: { r: 0.56, g: 0.57, b: 0.72, a: 1 }, balance: -20 }], ...over });

test("spotVolumeStack: the defaults, then the HomeView volumes by priority, each at clamp01(weight) through its Interp", () => {
  const t = F(0.05), lerp = (a, b) => F(F(a) + F(F(F(b) - F(a)) * t));
  const s = spotVolumeStack({ sceneRoot: { volumes: [] }, volume: spotVol() });
  assert.equal(s.Bloom.intensity, lerp(0, 4));
  assert.equal(s.Bloom.threshold, lerp(0.9, 0.5));
  assert.equal(s.Bloom.scatter, 0.7);                                             // not overridden
  assert.deepEqual(s.SplitToning.highlights, { r: lerp(0.5, 0.56), g: lerp(0.5, 0.57), b: lerp(0.5, 0.72), a: 1 });
  assert.equal(s.SplitToning.balance, lerp(0, -20));
  assert.deepEqual(s.Vignette, VOLUME_DEFAULTS.Vignette);
  // registration order: the Spot scene's volumes, then the background's
  const scene = spotVol({ path: "scene", components: [{ class: "Bloom", active: true, intensity: 2 }], weight: 1 });
  assert.deepEqual(spotVolumes({ sceneRoot: { volumes: [scene] }, volume: spotVol() }).map((v) => v.path), ["scene", "bg"]);
  // not blended: another layer, inactive, disabled, no weight, no profile, an inactive component
  const none = URPPost.evaluateStack([]);
  for (const over of [{ layer: 11 }, { active: false }, { enabled: false }, { weight: 0 }, { profile: null },
                      { components: [{ class: "Bloom", active: false, intensity: 4 }] }])
    assert.deepEqual(spotVolumeStack({ volume: spotVol(over) }), none, JSON.stringify(over));
  // a weight above 1 blends as 1
  assert.equal(spotVolumeStack({ volume: spotVol({ weight: 3 }) }).Bloom.intensity, 4);
  // priority: the higher one blends last, whatever the registration order; equal priorities keep it
  const a = spotVol({ path: "a", priority: 2, weight: 1, components: [{ class: "Bloom", active: true, intensity: 1 }] });
  const b = spotVol({ path: "b", priority: 1, weight: 1, components: [{ class: "Bloom", active: true, intensity: 3 }] });
  assert.equal(spotVolumeStack({ sceneRoot: { volumes: [a] }, volume: b }).Bloom.intensity, 1);
  assert.equal(spotVolumeStack({ sceneRoot: { volumes: [{ ...a, priority: 1 }] }, volume: b }).Bloom.intensity, 3);
  // another camera mask
  assert.deepEqual(spotVolumeStack({ volume: spotVol() }, 1 << 11), none);
});

test("spotVolumeStack and checkSpotStack refuse what the spot's chain does not draw", () => {
  for (const [over, re] of [
    [{ isGlobal: false, blendDistance: 2 }, /local Volume bg \(blend distance 2\) not implemented/],
    [{ active: undefined }, /activeInHierarchy is not in the host data/],
    [{ components: [{ class: "ScreenSpaceLensFlare", active: true, intensity: 1 }] }, /volume component ScreenSpaceLensFlare not implemented/],
    [{ components: [{ class: "Bloom", active: true, sharpness: 1 }] }, /Bloom\.sharpness: unknown parameter/],
    [{ components: [{ class: "Bloom", active: true, dirtTexture: { m_PathID: 5 } }] }, /Bloom\.dirtTexture: texture parameters not implemented/],
    [{ components: [{ class: "FilmGrain", active: true, texture: { m_PathID: 5 } }] }, /FilmGrain\.texture: texture parameters/],
  ]) assert.throws(() => spotVolumeStack({ volume: spotVol(over) }, HOME_VIEW_MASK, "home spot 7"), re, JSON.stringify(over));
  const stack = (components) => spotVolumeStack({ volume: spotVol({ weight: 1, components }) });
  for (const [components, re] of [
    [[{ class: "DepthOfField", active: true, mode: 1 }], /depth of field/],
    [[{ class: "MotionBlur", active: true, intensity: 0.5 }], /motion blur/],
    [[{ class: "AdvCurvedLens", active: true, intensity: 0.5 }], /AdvCurvedLens/],
  ]) assert.throws(() => checkSpotStack(stack(components)), re);
  const ok = stack([{ class: "Vignette", active: true, intensity: 0.3 }, { class: "ColorAdjustments", active: true, postExposure: 1 }]);
  assert.equal(checkSpotStack(ok), ok);
});

test("host: the main camera draws the spot into its HDR colour target, then its post chain into the stack's target", async () => {
  const { store, host } = litStore(RENDER_SETTINGS, { volume: spotVol() });
  const { gl, calls } = litGL();
  const loop = new PlayerLoop(30), post = postLib();
  const h = await createHome(gl, store, loop, host, { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 1, spine: null, post });
  assert.deepEqual(h.missing, []);
  assert.equal(h.volumeStack.Bloom.intensity, F(4 * F(0.05)));
  const target = new GLTarget(gl, 64, 32, { label: "SimpleScreen" });
  calls.length = 0;
  h.render(target, 64, 32);
  const color = h.cameraColor;
  assert.equal(color.width, 64); assert.equal(color.height, 32);
  assert.ok(calls.some(([n, a]) => n === "texImage2D" && a[1] === 0 && a[2] === gl.RGBA16F && a[3] === 64 && a[4] === 32),
            "an RGBA16F camera colour at the screen size");
  // the chain: LUT, bloom (prefilter, down / up per mip, upsample), uber last
  const order = post.blits.map((b) => `${b.shader}:${b.pass}`);
  assert.equal(order[0], "LutBuilderLdr:0");
  assert.equal(order.at(-1), "UberPost:0");
  assert.equal(order[1], "Bloom:0");
  assert.ok(order.includes("Bloom:3"));
  const uber = post.blits.at(-1);
  assert.equal(uber.value("_BlitTexture"), color);
  assert.deepEqual(uber.keywords, ["_BLOOM_LQ", "_ENABLE_ALPHA_OUTPUT", "_USE_FAST_SRGB_LINEAR_CONVERSION"]);
  assert.equal(uber.value("_Bloom_Params")[0], F(4 * F(0.05)));
  const lut = post.blits[0], t = F(0.05);
  assert.equal(lut.value("_SplitShadows")[3], F(F(F(-20) * t) / 100));
  assert.equal(lut.value("_SplitHighlights")[2], F(F(0.5) + F(F(F(0.72) - F(0.5)) * t)));
  // the uber pass writes the target given
  const uberDraw = calls.map(([n], i) => [n, i]).filter(([n]) => n === "drawArrays").at(-1)[1];
  const bound = calls.slice(0, uberDraw).filter(([n, a]) => n === "bindFramebuffer" && a[0] === gl.FRAMEBUFFER).at(-1);
  assert.equal(bound[1][1], target.fb);
  // a resize makes the colour target again
  h.render(target, 32, 16);
  assert.notEqual(h.cameraColor, color);
  assert.equal(h.cameraColor.width, 32);
  assert.equal(h.hdr, true);
  gl.deleteTexture = () => {};
  h.dispose();
  // HDR needs the pipeline asset's support as well as the camera's: RGBA8 otherwise
  const ldr = litStore(RENDER_SETTINGS, { volume: spotVol() }), g2 = litGL();
  const graphics = { ...GRAPHICS, pipelines: { ...GRAPHICS.pipelines, Best: pipeline({ m_AdditionalLightsRenderingMode: 2, m_SupportsHDR: 0 }) } };
  const h2 = await createHome(g2.gl, ldr.store, new PlayerLoop(30), ldr.host,
                                         { camera: DRAWN_CAM, graphics, quality: 1, spine: null, post: postLib() });
  assert.equal(h2.hdr, false);
  g2.calls.length = 0;
  h2.render(new GLTarget(g2.gl, 64, 32, { label: "SimpleScreen" }), 64, 32);
  assert.equal(g2.calls.some(([n, a]) => n === "texImage2D" && a[2] === g2.gl.RGBA16F && a[3] === 64), false);
  g2.gl.deleteTexture = () => {};
  h2.dispose();
});

test("host: the film grain follows the host option; the grain textures load only when it is drawn", async () => {
  const grainVol = spotVol({ weight: 1, components: [{ class: "FilmGrain", active: true, type: 1, intensity: 0.5 }] });
  const desc = (i) => ({ texture: `textures/g${i}.png`, name: `g${i}`, width: 8, height: 8, mipCount: 1,
                         settings: { m_FilterMode: 1, m_WrapU: 0, m_WrapV: 0 } });
  const textures = { Runtime: { filmGrainTex: Array.from({ length: 10 }, (_, i) => desc(i)) } };
  const make = async (post) => {
    const { store, host } = litStore(RENDER_SETTINGS, { volume: grainVol });
    const loaded = [];
    store.image = async (p) => { loaded.push(p); return { width: 8, height: 8, close() {} }; };
    const { gl } = litGL();
    bindAssets(gl, store);
    const p = postLib();
    const h = await createHome(gl, store, new PlayerLoop(30), host,
                                          { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 1, spine: null, post: { ...post, lib: p.lib } });
    const target = new GLTarget(gl, 64, 32, { label: "SimpleScreen" });
    h.render(target, 64, 32);
    gl.deleteTexture = () => {};
    return { h, loaded, uber: p.blits.at(-1) };
  };
  // default: no film grain, nothing loaded
  const off = await make({ textures });
  assert.deepEqual(off.loaded, []);
  assert.equal(off.uber.keywords.includes("_FILM_GRAIN"), false);
  off.h.dispose();
  // the option on: the renderer's textures, the grain by type, tiled by the game's screen pixels
  const on = await make({ textures, filmGrain: 1, screenScale: () => 0.5 });
  assert.equal(on.loaded.length, 10);
  assert.ok(on.uber.keywords.includes("_FILM_GRAIN"));
  assert.equal(on.uber.value("_Grain_Texture"), on.h.grain[1]);
  assert.deepEqual(on.uber.value("_Grain_Params"), [2, VOLUME_DEFAULTS.FilmGrain.response]);
  assert.deepEqual(on.uber.value("_Grain_TilingParams").slice(0, 2), [4, 2]);
  on.h.dispose();
  // the option on without the textures: refused before drawing
  await assert.rejects(make({ textures: {}, filmGrain: 1 }), /film grain textures of renderer Runtime/);
});

test("host: a drawn session refuses a spot volume or camera setting the chain does not draw, before any GL call", async () => {
  const { store, host } = litStore(RENDER_SETTINGS, { volume: spotVol({ isGlobal: false }) });
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: DRAWN_CAM, graphics: GRAPHICS, quality: 1, spine: null,
                                                                   post: postLib() });
  assert.deepEqual(h.missing, []);                                                  // a headless session plays it
  h.gl = new Proxy({}, { get: () => { throw new Error("GL call"); } });
  await assert.rejects(h._upload(), /home spot 1: local Volume .*bg/);
  h.postOpts = {};
  await assert.rejects(h._upload(), /needs the story's shaders/);
  h.cameraSettings = { ...DRAWN_CAM, antialiasing: 1 };
  await assert.rejects(h._upload(), /antialiasing mode 1/);
  h.gl = null;
  h.dispose();
});

test("host: an unknown character keeps the camera still and resolves", async () => {
  const { store, host } = makeStore();
  const loop = new PlayerLoop(30), h = await createHome(null, store, loop, host, { camera: CAM, spine: null });
  const p = { ...h.camera.position }, warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try { await h.focusCharacter(99); } finally { console.warn = warn; }
  assert.equal(warned, 1);
  assert.deepEqual(h.camera.position, p);
  h.dispose();
});

test("host: a tap talk whose character has no SpotCharacter in the spot is listed in missing", async () => {
  const { store, host } = makeStore({ home: { characterId: 16 } });
  const h = await createHome(null, store, new PlayerLoop(30), host, { camera: CAM, spine: null });
  assert.equal(h.tapTarget(16), null);
  assert.equal(h.tapTarget(3).path, "s/A");
  assert.ok(h.missing.includes(NO_TAP_TARGET));
  h.dispose();
  const ok = makeStore();
  const h2 = await createHome(null, ok.store, new PlayerLoop(30), ok.host, { camera: CAM, spine: null });
  assert.equal(h2.missing.includes(NO_TAP_TARGET), false);
  h2.dispose();
  const area = makeStore({ home: { talk: "area", characterId: null } });                 // area talks focus nobody
  const h3 = await createHome(null, area.store, new PlayerLoop(30), area.host, { camera: CAM, spine: null });
  assert.equal(h3.missing.includes(NO_TAP_TARGET), false);
  h3.dispose();
});

// ------------------------------------------------------------------------------------------------------------- spine
// A stand-in for spine-core 4.2 with the members the host uses; skeletons are described by a `fake` block of the
// skeleton JSON: slots in draw order with a bone offset, slot colour, blend mode and attachment.
const makeFakeSpine = () => {
  const log = [];
  class Color { constructor(r = 1, g = 1, b = 1, a = 1) { Object.assign(this, { r, g, b, a }); } }
  class RegionAttachment {
    constructor(d) { this.color = new Color(...(d.color || [1, 1, 1, 1])); this.region = { page: { name: d.page } }; this.sequence = null;
                     this.uvs = Float32Array.from([0, 1, 0, 0, 1, 0, 1, 1]); this.size = d.size || 1; }
    computeWorldVertices(slot, out, off, stride) {
      const x = slot.bone.x, y = slot.bone.y, s = this.size, v = [x, y, x, y + s, x + s, y + s, x + s, y];
      for (let i = 0; i < 4; i++) { out[off + i * stride] = v[i * 2]; out[off + i * stride + 1] = v[i * 2 + 1]; }
    }
  }
  class MeshAttachment {
    constructor(d) { this.color = new Color(); this.region = { page: { name: d.page } }; this.sequence = null;
                     this.worldVerticesLength = 6; this.triangles = [0, 1, 2]; this.uvs = Float32Array.from([0, 0, 1, 0, 0, 0.25]); }
    computeWorldVertices(slot, start, count, out, off, stride) {
      const v = [0, 0, 1, 0, 0, 1];
      for (let i = 0; i < 3; i++) { out[off + i * stride] = v[i * 2] + slot.bone.x; out[off + i * stride + 1] = v[i * 2 + 1] + slot.bone.y; }
    }
  }
  class ClippingAttachment {}
  class SkeletonClipping { clipStart() {} clipEndWithSlot() {} clipEnd() {} isClipping() { return false; } }
  class TextureAtlas {
    constructor(text) { this.pages = text.trim().split("\n").map((name) => ({ name })); log.push(["atlas", this.pages.length]); }
    findRegion(name) { return { name }; }
  }
  class AtlasAttachmentLoader { constructor(atlas) { this.atlas = atlas; } }
  const makeData = (d, scale) => ({
    scale, animations: d.fake.animations, slots: d.fake.slots,
    findAnimation(n) { return this.animations.find((x) => x.name === n) || null; },
  });
  class SkeletonJson { constructor(loader) { this.loader = loader; this.scale = 1; } readSkeletonData(t) { return makeData(JSON.parse(t), this.scale); } }
  class SkeletonBinary { constructor(loader) { this.loader = loader; this.scale = 1; } readSkeletonData() { throw new Error("binary"); } }
  class Skeleton {
    constructor(data) {
      this.data = data; this.color = new Color(); this.scaleX = 1; this.scaleY = 1;
      this.drawOrder = data.slots.map((s) => ({
        bone: { active: s.active !== false, x: s.x || 0, y: s.y || 0 }, color: new Color(...(s.color || [1, 1, 1, 1])),
        data: { blendMode: s.blend || 0 },
        attachment: s.attachment.type === "region" ? new RegionAttachment(s.attachment)
          : s.attachment.type === "mesh" ? new MeshAttachment(s.attachment) : null,
        getAttachment() { return this.attachment; } }));
    }
    setSkinByName(n) { log.push(["skin", n]); }
    update(d) { log.push(["skeleton.update", d]); }
    updateWorldTransform(p) { log.push(["updateWorldTransform", p]); }
  }
  class AnimationStateData {
    constructor(data) { this.skeletonData = data; this.defaultMix = 0; this.mixes = []; }
    setMix(a, b, d) { this.mixes.push([a, b, d]); }
  }
  class AnimationState {
    constructor(data) { this.data = data; this.entry = null; }
    setAnimation(track, name, loop) {
      this.entry = { track, name, loop, mixDuration: 0.2, trackTime: 0, animation: this.data.skeletonData.findAnimation(name) };
      log.push(["setAnimation", track, name, loop]);
      return this.entry;
    }
    update(d) { log.push(["state.update", d, this.entry && this.entry.trackTime, this.entry && this.entry.mixDuration]); }
    apply() { log.push(["apply"]); }
  }
  return { log, runtime: { Color, RegionAttachment, MeshAttachment, ClippingAttachment, SkeletonClipping, TextureAtlas,
    AtlasAttachmentLoader, SkeletonJson, SkeletonBinary, Skeleton, AnimationState, AnimationStateData,
    Physics: { none: 0, reset: 1, update: 2, pose: 3 }, PhysicsConstraint: class {}, BlendMode: { Normal: 0, Additive: 1, Multiply: 2, Screen: 3 } } };
};

test("spineRuntime: the members the host uses and the skeleton data's major.minor", () => {
  const { runtime } = makeFakeSpine();
  assert.equal(majorMinor("4.2.43"), "4.2");
  assert.equal(spineRuntimeVersion(runtime), "4.2");
  assert.equal(spineRuntime(runtime, "4.2.43").runtime, runtime);
  assert.equal(spineRuntime(undefined, "4.2.43").runtime, null);
  assert.match(spineRuntime({ ...runtime, SkeletonClipping: undefined }, "4.2.43").reason, /lacks SkeletonClipping/);
  assert.match(spineRuntime({ ...runtime, version: "4.1.2" }, "4.2.43").reason, /4\.1 cannot read/);
  assert.match(spineRuntime({ ...runtime, PhysicsConstraint: undefined, Sequence: class {} }, "4.2.43").reason, /4\.1 cannot read/);
  assert.match(spineRuntime({ ...runtime, BonePose: class {} }, "4.2.43").reason, /4\.3 cannot read/);
  assert.equal(skeletonDataVersion("a.json", JSON.stringify({ skeleton: { spine: "4.2.43" } })), "4.2.43");
  const v = new TextEncoder().encode("4.2.43"), bin = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, v.length + 1, ...v]);
  assert.equal(skeletonDataVersion("a.skel", bin), "4.2.43");
});

test("spine: skeletons start at the initial animation's end state, update in the update phase, MeshGenerator vertex rules", async () => {
  const { runtime, log } = makeFakeSpine();
  const anim = { _animationName: "home_start", loop: 0, timeScale: 2, initialSkinName: "", initialFlipX: 1, initialFlipY: 0,
                 pmaVertexColors: 1, tintBlack: 0, zSpacing: 0 };
  const spot = {
    spineCharacters: [{ path: "s/A", skeletonData: "A_SkeletonData", animation: anim, world: translation(0, 0, 5), sortingOrder: 1 },
                      { path: "s/B", skeletonData: null, animation: null, world: null }],
    skeletons: [{ name: "A_SkeletonData", skeleton: "a.json", atlases: ["a.atlas"], scale: 0.01, defaultMix: 0.2,
                  mixes: [{ from: "x", to: "y", duration: 0.1 }] }] };
  const spineMaterials = { a_Material: { name: "a_Material", shader: "Universal Render Pipeline/Spine/Skeleton",
    keywords: ["_STRAIGHT_ALPHA_INPUT"], floats: { _ZWrite: 0 }, colors: {}, renderQueue: -1, texEnvs: {} } };
  const { store, host } = makeStore({ spot, home: { spineMaterials } });
  store._text.set("host/spot/spine/a.json", JSON.stringify({ skeleton: { spine: "4.2.43" }, fake: {
    animations: [{ name: "home_start", duration: 2.5 }],
    slots: [
      { x: 0, y: 0, color: [1, 0.5, 0.25, 0.5], attachment: { type: "region", page: "a.png" } },
      { x: 5, y: 0, active: false, attachment: { type: "region", page: "a.png" } },
      { x: 2, y: 0, blend: 1, attachment: { type: "mesh", page: "a.png" } },
      { x: 3, y: 0, attachment: { type: "region", page: "b.png" } },
    ] } }));
  store._text.set("host/spot/spine/a.atlas", "a.png\nb.png\n");
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: CAM, spine: runtime });
  assert.deepEqual(h.missing, []);
  assert.equal(h.skeletons.length, 1);
  const s = h.skeletons[0];
  assert.equal(s.skeleton.skeleton.scaleX, -1);
  assert.equal(s.sortingOrder, 1);
  assert.deepEqual(s.skeleton.state.data.mixes, [["x", "y", 0.1]]);
  assert.equal(s.skeleton.state.data.defaultMix, 0.2);
  // end state: SetAnimation(0, name, false), mix 0, track time = duration, Update(0), Apply, UpdateWorldTransform(Physics.Update)
  assert.deepEqual(log.slice(1), [["setAnimation", 0, "home_start", false], ["state.update", 0, 2.5, 0], ["apply"],
                                  ["updateWorldTransform", 2]]);
  log.length = 0;
  await loop.step();
  assert.deepEqual(log, [["state.update", F(2 / 30), 2.5, 0], ["skeleton.update", F(2 / 30)], ["apply"], ["updateWorldTransform", 2]]);
  const mesh = s.skeleton.buildMesh();
  // region (4 vertices), inactive bone skipped, additive mesh (3), region on the second page (4)
  assert.equal(mesh.positions.length / 3, 11);
  assert.deepEqual(Array.from(mesh.indices), [0, 1, 2, 2, 3, 0, 4, 5, 6, 7, 8, 9, 9, 10, 7]);
  assert.deepEqual(mesh.draws, [{ page: "a.png", start: 0, count: 9 }, { page: "b.png", start: 9, count: 6 }]);
  // Color32 with pmaVertexColors: a = (byte)(0.5 x 255) = 127, rgb = (byte)(c x 127); additive slot alpha 0
  assert.deepEqual(Array.from(mesh.colors.slice(0, 4)), [127, 63, 31, 127]);
  assert.deepEqual(Array.from(mesh.colors.slice(16, 20)), [255, 255, 255, 0]);
  // uv v flipped to Unity's bottom-left origin
  assert.deepEqual(Array.from(mesh.uvs.slice(0, 8)), [0, 0, 0, 1, 1, 1, 1, 0]);
  assert.deepEqual(Array.from(mesh.uvs.slice(8, 14)), [0, 1, 1, 1, 0, 0.75]);
  assert.deepEqual(mesh.bounds.min, { x: 0, y: 0, z: 0 });
  assert.deepEqual(mesh.bounds.max, { x: 4, y: 1, z: 0 });
  h.dispose();
  assert.equal(loop.hooks.update.length, 0, "dispose removes the update hook");
  log.length = 0;
  await loop.step();
  assert.deepEqual(log, []);
});

test("spine: per-character sorting order and atlas page material objects", async () => {
  const { runtime } = makeFakeSpine();
  const anim = { _animationName: "home_start", loop: 0, timeScale: 1, initialSkinName: "", initialFlipX: 0, initialFlipY: 0,
                 pmaVertexColors: 1, tintBlack: 0, zSpacing: 0 };
  const spot = {
    spineCharacters: [{ path: "s/A", skeletonData: "A_SkeletonData", animation: anim, world: translation(0, 0, 5) }],
    skeletons: [{ name: "A_SkeletonData", skeleton: "a.json", atlases: ["a.atlas"], scale: 0.01, defaultMix: 0.2, mixes: [] }] };
  const mat = (name, x) => ({ material: name, shader: { shader: "Universal Render Pipeline/Spine/Skeleton" },
    keywords: ["_STRAIGHT_ALPHA_INPUT"], renderQueue: -1, floats: { _ZWrite: 0 }, colors: {},
    textures: { _MainTex: { texture: { name: "a" }, scale: { x, y: 1 }, offset: { x: 0, y: 0.5 } } } });
  const spineMaterials = { a_Material: mat("a_Material", 1), b_Material: mat("b_Material", 2) };
  const spineCharacters = [{ path: "s/A", sortingOrder: 3, sortingLayer: 0,
                             pageMaterials: { "a.png": "a_Material", "b.png": "b_Material" } }];
  const { store, host } = makeStore({ spot, home: { spineMaterials, spineCharacters } });
  store._text.set("host/spot/spine/a.json", JSON.stringify({ skeleton: { spine: "4.2.43" }, fake: {
    animations: [{ name: "home_start", duration: 1 }], slots: [{ x: 0, y: 0, attachment: { type: "region", page: "a.png" } }] } }));
  store._text.set("host/spot/spine/a.atlas", "a.png\nb.png\n");
  const loop = new PlayerLoop(30);
  const h = await createHome(null, store, loop, host, { camera: CAM, spine: runtime });
  assert.equal(h.skeletons[0].sortingOrder, 3);
  const b = h.pageMaterials.get("b.png");
  assert.equal(b.material, "b_Material");
  assert.equal(b.shader, "Universal Render Pipeline/Spine/Skeleton");
  assert.deepEqual(b.textures, { _MainTex: { texture: { name: "a" }, scale: { x: 2, y: 1 }, offset: { x: 0, y: 0.5 } } });
  assert.equal(h.pageMaterials.get("a.png").material, "a_Material");
  h.dispose();
  // two characters naming different materials for one page: refused
  const spot2 = { ...spot, spineCharacters: [...spot.spineCharacters, { ...spot.spineCharacters[0], path: "s/B" }] };
  const bad = makeStore({ spot: spot2, home: { spineMaterials, spineCharacters: [...spineCharacters,
    { path: "s/B", sortingOrder: 0, pageMaterials: { "a.png": "b_Material" } }] } });
  bad.store._text.set("host/spot/spine/a.json", store.text("host/spot/spine/a.json"));
  bad.store._text.set("host/spot/spine/a.atlas", "a.png\nb.png\n");
  await assert.rejects(createHome(null, bad.store, new PlayerLoop(30), bad.host, { camera: CAM, spine: runtime }),
                       /atlas page a\.png: conflicting materials/);
});
