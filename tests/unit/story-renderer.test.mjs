// The engine values the story renderer hands the game's shaders (src/story/renderer.js): the main camera's per-camera
// values (_WorldSpaceCameraPos, unity_OrthoParams, glstate_matrix_projection) and the per-object unity_WorldToObject,
// read by the particle shaders of effect meshes and particle systems; and the per-draw sprite constants of an effect SpriteRenderer (src/live/fx-effects.js),
// read by URP's 2D sprite shader. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { UnityProgram } from "../../src/engine/glsl.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { Transform, mat4 } from "../../src/engine/math.js";
import { FxSpriteRenderer } from "../../src/live/fx-effects.js";
import { AdvCamera } from "../../src/story/field.js";
import { StoryRenderer } from "../../src/story/renderer.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

const cameraNode = (extra = {}) => ({ path: "CameraManager/MainCamera", components: [{ type: "Camera",
  "near clip plane": 0.3, "far clip plane": 5000, "field of view": 60, orthographic: false, "orthographic size": 2,
  m_BackGroundColor: { r: 1, g: 1, b: 1, a: 1 }, ...extra }] });

// a program with the given default-block uniforms ([name, type, size]) and one uniform block of vec4 / matrix members
// ([name, offset in bytes]), as UnityProgram reads a linked program's inputs
const program = (gl, label, uniforms, members) => Object.assign(Object.create(UnityProgram.prototype), {
  gl, label, program: gl.createProgram(), samplers: [],
  uniforms: uniforms.map(([name, type, size = 1]) => ({ name, loc: { uniform: name }, type: gl[type], size })),
  blocks: members.length ? [{ name: "UnityPerDraw", binding: 0, data: new Float32Array(64), buffer: gl.createBuffer(),
    members: members.map(([name, offset]) => ({ name, type: gl.FLOAT_VEC4, size: name.startsWith("hlslcc_mtx4x4") ? 4 : 1,
                                                offset, stride: 16 })) }] : [],
});

const identityNear = (m, eps = 1e-5) => {
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(m[i] - (i % 5 === 0 ? 1 : 0)) < eps, `m[${i}] = ${m[i]}`);
};

test("StoryRenderer: the camera position, ortho params, projection and unity_WorldToObject reach a particle program", () => {
  const calls = [];
  const gl = headlessGL({ onCall: (n, a) => calls.push([n, a]) });
  const loop = new PlayerLoop(30);
  const camera = new AdvCamera(loop, cameraNode());
  camera.setPosition({ x: 1, y: 2, z: -10 });
  const r = new StoryRenderer(gl, null, { camera, session: { stage: null } }, { unityLighting: false }, loop);
  const g = r._cameraGlobals(200, 100);
  assert.deepEqual(g._WorldSpaceCameraPos, [1, 2, -10]);
  assert.deepEqual(g.unity_OrthoParams, [4, 2, 0, 0]);               // orthographic size x aspect 2, perspective
  assert.deepEqual(Array.from(g.glstate_matrix_projection), Array.from(camera.projection(2)));
  assert.deepEqual(Array.from(g.unity_MatrixVP), Array.from(mat4.mul(g.glstate_matrix_projection, g.unity_MatrixV)));

  const t = new Transform("Bg");
  t.localPosition = { x: 0.5, y: -1, z: 3 }; t.localScale = { x: 2, y: 0.5, z: 4 }; t.setLocalEuler(10, 20, 30);
  const per = r._perObject(t, 12), M = t.localToWorld();
  identityNear(mat4.mul(per.unity_WorldToObject, M));
  assert.equal(per.unity_WorldToObject, per.unity_WorldToObject);    // made once per draw

  // the inputs of URP's Particles/Unlit forward pass (vertex stage)
  const prog = program(gl, "Universal Render Pipeline/Particles/Unlit#0.0[_SURFACE_TYPE_TRANSPARENT]",
    [["_WorldSpaceCameraPos", "FLOAT_VEC3"], ["unity_OrthoParams", "FLOAT_VEC4"], ["hlslcc_mtx4x4unity_MatrixV", "FLOAT_VEC4", 4],
     ["hlslcc_mtx4x4unity_MatrixVP", "FLOAT_VEC4", 4]],
    [["hlslcc_mtx4x4unity_ObjectToWorld", 0], ["hlslcc_mtx4x4unity_WorldToObject", 64]]);
  calls.length = 0;
  prog.apply([per, g]);
  const set = (name) => calls.find(([n, a]) => /^uniform\dfv$/.test(n) && a[0].uniform === name);
  assert.deepEqual([set("_WorldSpaceCameraPos")[0], Array.from(set("_WorldSpaceCameraPos")[1][1])], ["uniform3fv", [1, 2, -10]]);
  assert.deepEqual(Array.from(set("unity_OrthoParams")[1][1]), [4, 2, 0, 0]);
  assert.deepEqual(Array.from(prog.blocks[0].data.subarray(16, 32)), Array.from(per.unity_WorldToObject));
  // a value the renderer does not supply still fails the draw
  assert.throws(() => prog.apply([{ unity_ObjectToWorld: M }, g]), /no value for shader property 'unity_WorldToObject'/);

  // a zero-scale transform has no inverse: zeros
  t.localScale = { x: 0, y: 1, z: 1 };
  assert.deepEqual(Array.from(r._perObject(t, 12).unity_WorldToObject), new Array(16).fill(0));
});

test("AdvCamera: the serialized orthographic size in unity_OrthoParams; an orthographic main camera is refused", () => {
  const cam = new AdvCamera(new PlayerLoop(30), cameraNode({ "orthographic size": 5 }));
  assert.deepEqual(cam.orthoParams(16 / 9), [F(5 * F(16 / 9)), 5, 0, 0]);
  assert.throws(() => new AdvCamera(new PlayerLoop(30), cameraNode({ orthographic: true })), /orthographic main camera/);
});

// an effect SpriteRenderer: Simple mesh of a unit quad (pivot centre), flipped in x, half-transparent tint
const spriteRenderer = () => {
  const sr = new FxSpriteRenderer({
    m_Enabled: 1, m_DrawMode: 0, m_MaskInteraction: 0, m_FlipX: 1, m_FlipY: 0, m_SortingLayer: 0, m_SortingOrder: 7,
    m_Color: { r: 0.5, g: 0.25, b: 1, a: 0.5 }, m_Size: { x: 1, y: 1 },
    m_Materials: [{ material: "m", shader: { shader: "Universal Render Pipeline/2D/Sprite-Unlit-Default" } }],
    m_Sprite: { sprite: "s", texture: { texture: "t", width: 4, height: 4 }, rect: { x: 0, y: 0, width: 4, height: 4 },
                border: { x: 0, y: 0, z: 0, w: 0 }, pivot: { x: 0.5, y: 0.5 }, pixelsToUnits: 4, settingsRaw: 0,
                vertices: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [-0.5, 0.5, 0], [0.5, 0.5, 0]],
                uv: [[0, 0], [1, 0], [0, 1], [1, 1]], indices: [0, 2, 1, 1, 2, 3] },
  }, new Transform("Wave"), { name: "fx:Wave" });
  sr.texture = { width: 4, height: 4 };
  return sr;
};
const drawn = (sr, prog) => {
  const out = [];
  sr.material = { ready: true, program: prog, queue: 3000, draw: (ctx, mesh, M, sheet) => out.push({ mesh, sheet }) };
  sr.drawItem([0, 0, -10]).draw({});
  assert.equal(out.length, 1);
  const { mesh, sheet } = out[0], v = mesh.verts, s = mesh.stride;
  return { sheet, x0: v[0], color0: Array.from(v.subarray(3, 7)), n: v.length / s };
};

test("FxSpriteRenderer: a program with unity_SpriteColor / unity_SpriteProps takes the colour and flip per draw", () => {
  const gl = headlessGL();
  const perDraw = program(gl, "Universal Render Pipeline/2D/Sprite-Unlit-Default#0.0[]", [["hlslcc_mtx4x4unity_MatrixVP", "FLOAT_VEC4", 4]],
                          [["hlslcc_mtx4x4unity_ObjectToWorld", 0], ["unity_SpriteColor", 64], ["unity_SpriteProps", 80]]);
  const a = drawn(spriteRenderer(), perDraw);
  assert.deepEqual(a.sheet.unity_SpriteColor, [0.5, 0.25, 1, 0.5]);
  assert.deepEqual(a.sheet.unity_SpriteProps, [-1, 1, 0, 0]);
  assert.equal(a.x0, -0.5);                                           // unflipped: the program flips
  assert.deepEqual(a.color0, [1, 1, 1, 1]);                           // white: the program tints
  // a program without them (a particle shader on a sprite): colour in the vertices (Color32), flip in the positions
  const plain = program(gl, "Mobile/Particles/Additive#0.0[]", [["hlslcc_mtx4x4unity_MatrixVP", "FLOAT_VEC4", 4]],
                        [["hlslcc_mtx4x4unity_ObjectToWorld", 0]]);
  const b = drawn(spriteRenderer(), plain);
  assert.ok(!("unity_SpriteColor" in b.sheet) && !("unity_SpriteProps" in b.sheet));
  assert.equal(b.x0, 0.5);
  assert.deepEqual(b.color0, [128 / 255, 64 / 255, 1, 128 / 255].map(F));
  assert.equal(a.n, 4); assert.equal(b.n, 4);
});

test("StoryRenderer: the per-object light count follows the layer of each drawn item", () => {
  const loop = new PlayerLoop(30);
  const camera = new AdvCamera(loop, cameraNode());
  const r = new StoryRenderer(headlessGL(), null, { camera, session: { stage: null } }, { unityLighting: false }, loop);
  // two point lights at the origin that light the character layers Camera1..Camera5 (6..10)
  r.addLights = [0, 1].map(() => ({ pos: [0, 0, 0, 1], range: 5, layers: 0b11111000000 }));
  const t = new Transform("Item");
  const lightCount = (frame, layer) => frame.perObject(t, layer).unity_LightData[1];
  const frame = { globals: {}, perObject: (tr, layer) => r._perObject(tr, layer) };
  const seen = [];
  const item = (layer, ownLayer) => ({ sortingOrder: 0, dist: 0, layer, draw: (f) => seen.push(lightCount(f, ownLayer)) });
  // a character on Camera1 (6) and one off the five slots (Default, 0), effects on AdvBack (12) and AdvFront (13), and
  // a draw that names its own layer
  r._drawList([item(6), item(0), item(12), item(13), item(12, 8)], frame);
  assert.deepEqual(seen, [2, 0, 0, 0, 2]);
});
