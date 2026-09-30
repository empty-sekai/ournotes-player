import test from "node:test";
import assert from "node:assert/strict";
import { axisGoal, paretoPoints } from "../../examples/songs/pareto.js";

test("score figures maximize reward and duration minimizes cost on either axis", () => {
  for (const axis of ["base", "skip", "rate", "perMinute"]) assert.equal(axisGoal(axis), "max");
  assert.equal(axisGoal("bgmMs"), "min");
});

test("lower cost and higher reward retain trade-offs, reject dominated candidates", () => {
  assert.deepEqual(paretoPoints([[1, 5], [2, 8], [3, 7], [2, 6], [4, 9]]), [[1, 5], [2, 8], [4, 9]]);
});
test("all four objective directions distinguish their optimal corners", () => {
  const points = [[1, 1], [1, 3], [3, 1], [3, 3], [2, 2]];
  for (const x of ["min", "max"]) for (const y of ["min", "max"]) {
    assert.deepEqual(paretoPoints(points, x, y), [[x === "min" ? 1 : 3, y === "min" ? 1 : 3]]);
  }
});
test("equal-coordinate candidates survive together; missing values are excluded", () => {
  assert.deepEqual(paretoPoints([[1, 5, "a"], [1, 5, "b"], [NaN, 9], [1, Infinity], [2, 4]]), [[1, 5, "a"], [1, 5, "b"]]);
  assert.deepEqual(paretoPoints([]), []);
});
