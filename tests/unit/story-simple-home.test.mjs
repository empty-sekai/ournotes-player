// Home host of the simple ADV player (src/story/simple/home): the room glb read back into Unity space, the spot
// camera's default pose / focus / return on a PlayerLoop, the UI blur ramp and Dual Kawase settings, the room's
// visibility and URP draw order, and a headless host (gl = null). Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { EASE, easeF } from "../../src/engine/tween.js";
import { blurLevels, blurPass, blurSettings, UIBlur } from "../../src/story/simple/home/blur.js";
import { forwardOf, lookRotation, rotateVector, slerp, SpotCamera, spotFieldOfView } from "../../src/story/simple/home/camera.js";
import { parseGlb, roomMeshes } from "../../src/story/simple/home/glb.js";
import { backgroundMatrix, inverseTRS, LIT_ROOM_SHADERS, NO_TAP_TARGET, roomMatrix, SimpleHomeHost, SPINE_MISSING, VOLUME_MISSING } from "../../src/story/simple/home/host.js";
import { mat4 } from "../../src/engine/math.js";
import { majorMinor, skeletonDataVersion, spineRuntime, spineRuntimeVersion } from "../../src/story/simple/home/spine.js";
import { parseQueueTag, ShaderInfo, sortDrawItems, SpotRoom } from "../../src/story/simple/home/room.js";

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
    return { name: m.name, primitives: m.prims.map((p) => ({ attributes: { POSITION: pos, TEXCOORD_0: uv },
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
  const hostDoc = { format: "ournotes.story-host/1", kind: "home", home: {
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
  const h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: null });
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
  const shaders = new ShaderInfo(store, "host/shaders");
  assert.equal(shaders.queue("Unlit/Transparent Cutout"), 2450);
  assert.deepEqual(shaders.forwardPasses("Universal Render Pipeline/Spine/Skeleton"), [0]);
  const room = new SpotRoom(parseGlb(store.bytes("host/spot/room.glb")), host.home, shaders);
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
  assert.throws(() => new SpotRoom(parseGlb(store.bytes("host/spot/room.glb")), { ...host.home, roomNodes: [] }, shaders), /roomNodes/);
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
test("host: headless create, 'Spine runtime missing' without a runtime or with one of another version, the Volume entry", async () => {
  const spine = {
    spineCharacters: [{ path: "s/A", skeletonData: "A_SkeletonData", animation: { _animationName: "home_start", loop: 0, timeScale: 1,
      initialSkinName: "", initialFlipX: 0, initialFlipY: 0, pmaVertexColors: 1, tintBlack: 0, zSpacing: 0 }, world: translation(0, 0, 5) }],
    skeletons: [{ name: "A_SkeletonData", skeleton: "a.json", atlases: ["a.atlas"], scale: 0.01, defaultMix: 0.2, mixes: [] }] };
  const { store, host } = makeStore({ spot: spine });
  store._text.set("host/spot/spine/a.json", JSON.stringify({ skeleton: { spine: "4.2.43" } }));
  const loop = new PlayerLoop(30);
  const h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: null });
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
  const h2 = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: old });
  assert.deepEqual(h2.missing, [SPINE_MISSING]);
  assert.match(h2.spineReason, /4\.1 cannot read skeleton data 4\.2\.43/);
  h2.dispose();
  const { store: s3, host: h3doc } = makeStore({ home: { volume: { isGlobal: 1, weight: 0.05, components: [] } } });
  const h3 = await SimpleHomeHost.create(null, s3, loop, h3doc, { camera: CAM, spine: null });
  assert.deepEqual(h3.missing, [VOLUME_MISSING]);                                     // no Spine characters in this spot
  h3.dispose();
  assert.throws(() => new SimpleHomeHost(null, store, loop, { kind: "afterlive" }, { camera: CAM }), /not a home host/);
});

test("host: a drawn session refuses a room material that needs URP lighting, before any GL call", async () => {
  const lit = { ...MATERIALS[1], shader: "Universal Render Pipeline/Lit" };
  assert.ok(LIT_ROOM_SHADERS.has(lit.shader));
  const { store, host } = makeStore({ home: { roomMaterials: [MATERIALS[0], lit] } });
  const loop = new PlayerLoop(30);
  const h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: null });   // headless: plays
  h.gl = new Proxy({}, { get: () => { throw new Error("GL call"); } });
  await assert.rejects(h._upload(), /home spot 1: room material tr \(Universal Render Pipeline\/Lit\) is not drawn by this player/);
  h.gl = null;
  h.dispose();
});

test("host: an unknown character keeps the camera still and resolves", async () => {
  const { store, host } = makeStore();
  const loop = new PlayerLoop(30), h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: null });
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
  const h = await SimpleHomeHost.create(null, store, new PlayerLoop(30), host, { camera: CAM, spine: null });
  assert.equal(h.tapTarget(16), null);
  assert.equal(h.tapTarget(3).path, "s/A");
  assert.ok(h.missing.includes(NO_TAP_TARGET));
  h.dispose();
  const ok = makeStore();
  const h2 = await SimpleHomeHost.create(null, ok.store, new PlayerLoop(30), ok.host, { camera: CAM, spine: null });
  assert.equal(h2.missing.includes(NO_TAP_TARGET), false);
  h2.dispose();
  const area = makeStore({ home: { talk: "area", characterId: null } });                 // area talks focus nobody
  const h3 = await SimpleHomeHost.create(null, area.store, new PlayerLoop(30), area.host, { camera: CAM, spine: null });
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
  const h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: runtime });
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

test("spine: host.json's per-character sortingOrder and page materials, advui material records", async () => {
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
  const h = await SimpleHomeHost.create(null, store, loop, host, { camera: CAM, spine: runtime });
  assert.equal(h.skeletons[0].sortingOrder, 3);
  const b = h.pageMaterials.get("b.png");
  assert.equal(b.name, "b_Material");
  assert.equal(b.shader, "Universal Render Pipeline/Spine/Skeleton");
  assert.deepEqual(b.texEnvs, { _MainTex: { scale: [2, 1], offset: [0, 0.5] } });
  assert.equal(h.pageMaterials.get("a.png").name, "a_Material");
  h.dispose();
  // two characters naming different materials for one page: refused
  const spot2 = { ...spot, spineCharacters: [...spot.spineCharacters, { ...spot.spineCharacters[0], path: "s/B" }] };
  const bad = makeStore({ spot: spot2, home: { spineMaterials, spineCharacters: [...spineCharacters,
    { path: "s/B", sortingOrder: 0, pageMaterials: { "a.png": "b_Material" } }] } });
  bad.store._text.set("host/spot/spine/a.json", store.text("host/spot/spine/a.json"));
  bad.store._text.set("host/spot/spine/a.atlas", "a.png\nb.png\n");
  await assert.rejects(SimpleHomeHost.create(null, bad.store, new PlayerLoop(30), bad.host, { camera: CAM, spine: runtime }),
                       /atlas page a\.png has the materials a_Material and b_Material/);
});
