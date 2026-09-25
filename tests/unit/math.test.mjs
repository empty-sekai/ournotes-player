// Unity-convention math (src/engine/math.js): column-major matrices, Matrix4x4.TRS, Quaternion.Euler order in Unity's
// left-handed space, the OpenGL-style perspective matrix and the Transform parent chain. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Transform, mat4, quat } from "../../src/engine/math.js";

const near = (p, q, eps = 1e-6) => {
  for (const k of ["x", "y", "z"]) assert.ok(Math.abs(p[k] - q[k]) <= eps, `${k}: expected ${q[k]}, got ${p[k]} (${JSON.stringify(p)})`);
};

test("matrices are column-major Float32Array(16), translation in m[12..14]", () => {
  const m = mat4.trs({ x: 1, y: 2, z: 3 }, quat.identity(), { x: 1, y: 1, z: 1 });
  assert.ok(m instanceof Float32Array);
  assert.equal(m.length, 16);
  assert.deepEqual([m[12], m[13], m[14], m[15]], [1, 2, 3, 1]);
  near(mat4.transformPoint(m, { x: 1, y: 1, z: 1 }), { x: 2, y: 3, z: 4 });
});

test("mul(a, b) applies b first (column vectors)", () => {
  const T = mat4.trs({ x: 10, y: 0, z: 0 }, quat.identity(), { x: 1, y: 1, z: 1 });
  const S = mat4.scale(2, 2, 2);
  near(mat4.transformPoint(mat4.mul(T, S), { x: 1, y: 0, z: 0 }), { x: 12, y: 0, z: 0 });
  near(mat4.transformPoint(mat4.mul(S, T), { x: 1, y: 0, z: 0 }), { x: 22, y: 0, z: 0 });
  assert.deepEqual([...mat4.mul(mat4.identity(), T)], [...T]);
});

test("Quaternion.Euler: +90 about Y turns forward (+Z) to right (+X); Z, then X, then Y", () => {
  const rot = (q, p) => mat4.transformPoint(mat4.trs({ x: 0, y: 0, z: 0 }, q, { x: 1, y: 1, z: 1 }), p);
  near(rot(quat.euler(0, 90, 0), { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 });
  near(rot(quat.euler(90, 0, 0), { x: 0, y: 0, z: 1 }), { x: 0, y: -1, z: 0 });
  near(rot(quat.euler(0, 0, 90), { x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 });
  // X first, then Y: forward -> down -> down (Y first would give right)
  near(rot(quat.euler(90, 90, 0), { x: 0, y: 0, z: 1 }), { x: 0, y: -1, z: 0 });
  // Z first, then X: right -> up -> forward (X first would leave right in place, then Z would give up)
  near(rot(quat.euler(90, 0, 90), { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: 1 });
});

test("TRS scales before rotating", () => {
  const m = mat4.trs({ x: 0, y: 0, z: 0 }, quat.euler(0, 90, 0), { x: 1, y: 1, z: 3 });
  near(mat4.transformPoint(m, { x: 0, y: 0, z: 1 }), { x: 3, y: 0, z: 0 });
});

test("inverseRigid inverts rotation + translation", () => {
  const m = mat4.trs({ x: 1, y: -2, z: 5 }, quat.euler(30, 45, 60), { x: 1, y: 1, z: 1 });
  const id = mat4.mul(mat4.inverseRigid(m), m);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-6, `m[${i}] = ${id[i]}`);
});

test("perspective maps the near and far planes to NDC z -1 and 1", () => {
  const P = mat4.perspective(60, 16 / 9, 0.3, 100);
  assert.equal(P[11], -1);
  assert.equal(P[15], 0);
  const ndcZ = (z) => (P[10] * z + P[14]) / (P[11] * z);
  assert.ok(Math.abs(ndcZ(-0.3) + 1) < 1e-5);
  assert.ok(Math.abs(ndcZ(-100) - 1) < 1e-5);
  assert.ok(Math.abs(P[5] - 1 / Math.tan(Math.PI / 6)) < 1e-6);
  assert.ok(Math.abs(P[0] - P[5] / (16 / 9)) < 1e-6);
});

test("Transform: local TRS through the parent chain", () => {
  const parent = new Transform("parent");
  parent.localPosition = { x: 0, y: 0, z: 5 };
  parent.setLocalEuler(0, 90, 0);
  const child = new Transform("child", parent);
  child.localPosition = { x: 1, y: 0, z: 0 };
  near(child.worldPosition(), { x: 0, y: 0, z: 4 });        // +X turned by +90 about Y is -Z
  assert.equal(parent.find("child"), child);
  assert.throws(() => parent.find("missing"));
  child.setParent(null);
  near(child.worldPosition(), { x: 1, y: 0, z: 0 });
  assert.equal(parent.children.length, 0);
});
