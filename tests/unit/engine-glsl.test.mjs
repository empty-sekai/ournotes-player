// UnityProgram.apply's sampler binding (src/engine/glsl.js): a cube sampler takes a cube map, every other sampler a 2D
// texture, and a texture of the other kind is refused; vector values upload the uniform's component count. UnityProgram.reads names the program's inputs. passState /
// applyState: a pass's Stencil block (stencilOp) drives both faces from the material's stencil properties. ShaderLib
// memoizes the variant search and passState per value set. Synthetic
// inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GL, ShaderLib, UnityProgram, applyState, passState } from "../../src/engine/glsl.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

const program = (gl, samplers) => Object.assign(Object.create(UnityProgram.prototype), {
  gl, label: "p", program: gl.createProgram(), uniforms: [], blocks: [],
  samplers: samplers.map(([name, type], unit) => ({ name, loc: { name }, unit, type: gl[type] })),
});

test("UnityProgram.apply: cube samplers bind TEXTURE_CUBE_MAP, other samplers TEXTURE_2D, a mismatch is refused", () => {
  const calls = [];
  const gl = headlessGL({ onCall: (n, a) => calls.push([n, ...a]) });
  const cube = { glTexture: gl.createTexture(), target: gl.TEXTURE_CUBE_MAP }, flat = { glTexture: gl.createTexture() };
  const p = program(gl, [["_Env", "SAMPLER_CUBE"], ["_MainTex", "SAMPLER_2D"]]);
  calls.length = 0;
  p.apply([{ _Env: cube, _MainTex: flat }]);
  const binds = calls.filter(([n]) => n === "bindTexture");
  assert.deepEqual(binds, [["bindTexture", gl.TEXTURE_CUBE_MAP, cube.glTexture], ["bindTexture", gl.TEXTURE_2D, flat.glTexture]]);
  assert.throws(() => p.apply([{ _Env: flat, _MainTex: flat }]), /p: sampler _Env needs a cube map/);
  assert.throws(() => p.apply([{ _Env: cube, _MainTex: cube }]), /p: sampler _MainTex needs a 2D texture/);
});

test("UnityProgram.apply: a float4 value on a float / float2 / float3 uniform uploads its leading components", () => {
  const calls = [];
  const gl = headlessGL({ onCall: (n, a) => calls.push([n, ...a]) });
  const p = Object.assign(program(gl, []), {
    uniforms: [["_A", "FLOAT"], ["_B", "FLOAT_VEC2"], ["_C", "FLOAT_VEC3"], ["_D", "FLOAT_VEC4"]]
      .map(([name, type]) => ({ name, loc: { name }, type: gl[type], size: 1 })),
  });
  calls.length = 0;
  const v = [1, 2, 3, 4];
  p.apply([{ _A: v, _B: v, _C: { x: 5, y: 6, z: 7, w: 8 }, _D: v }]);
  const up = calls.filter(([n]) => n.startsWith("uniform")).map(([n, loc, x]) => [n, loc.name, Array.from(x)]);
  assert.deepEqual(up, [["uniform1fv", "_A", [1]], ["uniform2fv", "_B", [1, 2]], ["uniform3fv", "_C", [5, 6, 7]],
                        ["uniform4fv", "_D", [1, 2, 3, 4]]]);
});

test("UnityProgram.reads: an active uniform, uniform block member (matrix name without hlslcc_mtx4x4) or sampler", () => {
  const gl = headlessGL();
  const p = Object.assign(program(gl, [["_MainTex", "SAMPLER_2D"]]), {
    uniforms: [{ name: "_WorldSpaceCameraPos" }],
    blocks: [{ name: "UnityPerDraw", members: [{ name: "hlslcc_mtx4x4unity_ObjectToWorld" }, { name: "unity_SpriteColor" }] }],
  });
  for (const name of ["_WorldSpaceCameraPos", "unity_ObjectToWorld", "unity_SpriteColor", "_MainTex"]) assert.ok(p.reads(name), name);
  for (const name of ["unity_SpriteProps", "hlslcc_mtx4x4unity_ObjectToWorld", "unity_OrthoParams"]) assert.ok(!p.reads(name), name);
});

// a UI pass state as packed: Stencil { Ref [_Stencil] ReadMask [_StencilReadMask] WriteMask [_StencilWriteMask]
// Comp [_StencilComp] Pass [_StencilOp] }, ColorMask [_ColorMask], ZTest [unity_GUIZTestMode], blend One OneMinusSrcAlpha
const V = (val, name = "<noninit>") => ({ val, name });
const KEEP_ALWAYS = () => ({ pass: V(0), fail: V(0), zFail: V(0), comp: V(8) });
const uiPass = (extra = {}) => ({
  rtBlend0: { srcBlend: V(1), destBlend: V(10), srcBlendAlpha: V(1), destBlendAlpha: V(10), blendOp: V(0), blendOpAlpha: V(0),
              colMask: V(0, "_ColorMask") },
  zTest: V(0, "unity_GUIZTestMode"), zWrite: V(0), culling: V(0), offsetFactor: V(0), offsetUnits: V(0),
  stencilRef: V(0, "_Stencil"), stencilReadMask: V(0, "_StencilReadMask"), stencilWriteMask: V(0, "_StencilWriteMask"),
  stencilOp: { pass: V(0, "_StencilOp"), fail: V(0), zFail: V(0), comp: V(0, "_StencilComp") },
  stencilOpFront: KEEP_ALWAYS(), stencilOpBack: KEEP_ALWAYS(), rtSeparateBlend: false, alphaToMask: V(0), ...extra,
});
const floats = (stencil, comp, op, read, write, colorMask) => ({ _Stencil: stencil, _StencilComp: comp, _StencilOp: op,
  _StencilReadMask: read, _StencilWriteMask: write, _ColorMask: colorMask, unity_GUIZTestMode: 4 });

test("passState / applyState: the Stencil block's properties set the stencil test of both faces", () => {
  const calls = [];
  const gl = headlessGL({ onCall: (n, a) => calls.push([n, ...a]) });
  GL.init(gl);
  const stencilCalls = (f) => {
    calls.length = 0;
    applyState(gl, passState(uiPass(), f));
    return calls.filter(([n, a]) => /^stencil/.test(n) || ((n === "enable" || n === "disable") && a === gl.STENCIL_TEST));
  };
  // a mask graphic: Always, Replace with 1, colour writes off
  const mask = floats(1, 8, 2, 255, 255, 0);
  assert.deepEqual(passState(uiPass(), mask).stencilFront, [8, 2, 0, 0]);
  assert.deepEqual(stencilCalls(mask), [
    ["enable", gl.STENCIL_TEST],
    ["stencilFuncSeparate", gl.FRONT, gl.ALWAYS, 1, 255], ["stencilOpSeparate", gl.FRONT, gl.KEEP, gl.KEEP, gl.REPLACE],
    ["stencilFuncSeparate", gl.BACK, gl.ALWAYS, 1, 255], ["stencilOpSeparate", gl.BACK, gl.KEEP, gl.KEEP, gl.REPLACE],
    ["stencilMask", 255]]);
  // a graphic drawn where the mask bit is clear: Equal against 2 & 1, no stencil writes
  const outside = floats(2, 3, 0, 1, 0, 15);
  assert.deepEqual(stencilCalls(outside), [
    ["enable", gl.STENCIL_TEST],
    ["stencilFuncSeparate", gl.FRONT, gl.EQUAL, 2, 1], ["stencilOpSeparate", gl.FRONT, gl.KEEP, gl.KEEP, gl.KEEP],
    ["stencilFuncSeparate", gl.BACK, gl.EQUAL, 2, 1], ["stencilOpSeparate", gl.BACK, gl.KEEP, gl.KEEP, gl.KEEP],
    ["stencilMask", 0]]);
  // the shader defaults (Always, Keep) and CompareFunction.Disabled leave the test off
  assert.deepEqual(stencilCalls(floats(0, 8, 0, 255, 255, 15)), [["disable", gl.STENCIL_TEST]]);
  assert.deepEqual(stencilCalls(floats(1, 0, 2, 255, 255, 15)), [["disable", gl.STENCIL_TEST]]);
  // per-face ops are refused
  const back = { ...KEEP_ALWAYS(), comp: V(3) };
  assert.throws(() => passState(uiPass({ stencilOpBack: back }), mask), /per-face stencil ops not implemented/);
  assert.throws(() => passState(uiPass({ stencilOpFront: { ...KEEP_ALWAYS(), pass: V(0, "_StencilOpFront") } }), mask),
                /per-face stencil ops not implemented/);
});

test("ShaderLib: program() searches a variant once per keyword set; state() is shared per value set of the named floats", () => {
  const gl = headlessGL();
  const assets = { json: (p) => p === "shaders/shaders.json" ? [{ name: "UI", parsed: "ui.json", variants: [] }]
                                                          : { subShaders: [{ passes: [{ state: uiPass() }] }] } };
  const lib = new ShaderLib(gl, "shaders", assets);
  let searches = 0;
  lib._program = (name, pass, keywords) => ({ name, pass, keywords, n: ++searches });
  const a = lib.program("UI", 0, ["A", "B"]);
  assert.equal(lib.program("UI", 0, ["A", "B"]), a);
  assert.notEqual(lib.program("UI", 0, ["A"]), a);
  assert.equal(searches, 2);

  const mat = floats(1, 8, 2, 255, 255, 0);
  const s = lib.state("UI", 0, mat);
  assert.deepEqual(s, passState(uiPass(), mat));
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.stencilFront));
  assert.equal(lib.state("UI", 0, mat), s);                                   // the same object again
  assert.equal(lib.state("UI", 0, { ...mat, _Unrelated: 3 }), s);             // floats the state does not name
  mat._StencilComp = 3;                                                       // a value changed in place
  const t = lib.state("UI", 0, mat);
  assert.notEqual(t, s);
  assert.deepEqual(t, passState(uiPass(), mat));
  mat._StencilComp = 8;
  assert.equal(lib.state("UI", 0, mat), s);
  delete mat._Stencil;                                                        // a missing property raises as before
  assert.throws(() => lib.state("UI", 0, mat), (e) => {
    assert.throws(() => passState(uiPass(), mat), { message: e.message });
    return true;
  });
});
