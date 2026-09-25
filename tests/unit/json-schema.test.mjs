// The schema validator used by scripts/validate-data.mjs (scripts/lib/json-schema.mjs), and the schemas in schema/
// against it. Synthetic inputs only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "../../scripts/lib/json-schema.mjs";

const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "schema");

test("keywords", () => {
  const check = compile({
    type: "object",
    required: ["id", "kind"],
    properties: {
      id: { type: "integer", minimum: 1 },
      kind: { enum: ["a", "b"] },
      name: { type: "string", pattern: "^[a-z]+$" },
      tags: { type: "array", items: { type: "string" }, maxItems: 2 },
      pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], minItems: 2, maxItems: 2 },
      ref: { $ref: "#/$defs/nullable" },
      v: { const: 2 },
    },
    additionalProperties: false,
    $defs: { nullable: { type: ["integer", "null"] } },
  });
  assert.deepEqual(check({ id: 1, kind: "a", name: "abc", tags: ["x"], pair: ["k", 1.5], ref: null, v: 2 }), []);
  const errs = check({ id: 0.5, kind: "c", name: "A", tags: [1, "a", "b"], pair: ["k"], ref: "x", v: 3, extra: 1 });
  for (const re of [/\/id: expected integer/, /\/kind: "c" not one of/, /\/name: "A" does not match/, /\/tags\/0: expected string/,
                    /\/tags: more than 2/, /\/pair: fewer than 2/, /\/ref: expected integer or null/, /\/v: expected 2/, /\/extra: not allowed/])
    assert.ok(errs.some((e) => re.test(e)), `${re} in ${JSON.stringify(errs)}`);
  assert.deepEqual(check({}), ["/: missing id", "/: missing kind"]);
});

test("anyOf, propertyNames, additionalProperties schema", () => {
  const check = compile({
    type: "object",
    propertyNames: { pattern: "^[0-9]+$" },
    additionalProperties: { anyOf: [{ type: "string" }, { type: "object", required: ["x"] }] },
  });
  assert.deepEqual(check({ 1: "a", 2: { x: 1 } }), []);
  assert.equal(check({ a: "x" }).length, 1);
  assert.equal(check({ 1: 5 }).length, 1);
});

test("unsupported keywords are rejected", () => {
  assert.throws(() => compile({ type: "object", dependentRequired: {} }), /unsupported keyword dependentRequired/);
  assert.throws(() => compile({ $ref: "#/$defs/missing" }), /unresolved/);
});

test("every schema in schema/ compiles", () => {
  const names = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"));
  assert.ok(names.length >= 5);
  for (const f of names) compile(JSON.parse(fs.readFileSync(path.join(schemaDir, f), "utf8")));
});

test("the manifest schema accepts both file entry forms and rejects others", () => {
  const check = compile(JSON.parse(fs.readFileSync(path.join(schemaDir, "manifest.schema.json"), "utf8")));
  const a = `assets/${"0".repeat(64)}.json`;
  const ok = { format: 2, musicId: 1, difficulty: "easy", quality: 1,
               files: { "live.json": { asset: a, size: 3 }, "x.json": { parts: [["k", a, 3]], size: 9 } } };
  assert.deepEqual(check(ok), []);
  assert.notDeepEqual(check({ ...ok, files: { "live.json": { asset: "a.json", size: 3 } } }), []);
  assert.notDeepEqual(check({ ...ok, files: { "x.json": { parts: [["k", a]], size: 3 } } }), []);
  assert.notDeepEqual(check({ ...ok, quality: 7 }), []);
});
