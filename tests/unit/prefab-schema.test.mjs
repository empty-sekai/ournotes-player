import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { compile } from "../../scripts/lib/json-schema.mjs";
import { node, mb } from "./live2d-objects.mjs";

const validate = compile(JSON.parse(fs.readFileSync(new URL("../../schema/prefab.schema.json", import.meta.url), "utf8")));
const prefab = () => ({ name: "Root", nodes: [node("Root", [mb("Example", { enabled: true })])] });

test("prefab schemas describe numeric transforms and typed component fields", () => {
  const doc = prefab();
  assert.deepEqual(validate(doc), []);
  delete doc.nodes[0].localPosition.x;
  assert.ok(validate(doc).some((e) => e.includes("x")));
  doc.nodes[0].localPosition.x = "zero";
  assert.ok(validate(doc).some((e) => e.includes("number")));
});

test("prefab schemas check component identity and RectTransform vectors", () => {
  const doc = prefab();
  doc.nodes[0].components[0].script = 3;
  assert.ok(validate(doc).length);
  doc.nodes[0].components[0].script = null;
  doc.nodes[0].rect = { m_Pivot: { x: 0.5, y: 0.5 } };
  assert.deepEqual(validate(doc), []);
  doc.nodes[0].rect.m_Pivot.y = null;
  assert.ok(validate(doc).length);
});
