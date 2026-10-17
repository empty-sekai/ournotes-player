import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeProductManifests, productDir } from "../../src/data/products.js";

const json = { asset: "assets/texture.json", size: 2 };
const image = { asset: "assets/texture.png", size: 17 };
const product = (name, files) => [name, {
  schema: "nnnotes.product/1", product: name, subject: "default", files: {},
  objects: { "cab:1": { class: "Texture2D", name: "texture", files } },
}];

test("product objects combine complementary roles and compare file fields by value", () => {
  const left = product("scene", { json });
  const right = product("ui", { image, json: { size: 2, asset: json.asset } });
  const result = mergeProductManifests([left, right]);
  assert.deepEqual(result.objects["cab:1"].files, { json, image });
  assert.deepEqual(left[1].objects["cab:1"].files, { json });
  assert.deepEqual(result.products, { scene: { default: "scene" }, ui: { default: "ui" } });
});

test("shared object metadata and overlapping file roles must agree", () => {
  const left = product("scene", { json });
  const right = product("ui", { json: { ...json, size: 3 } });
  assert.throws(() => mergeProductManifests([left, right]), /object cab:1 differs.*json/);
  right[1].objects["cab:1"].files = { json };
  right[1].objects["cab:1"].class = "Material";
  assert.throws(() => mergeProductManifests([left, right]), /object cab:1 differs.*class/);
});

test("duplicate product paths retain the same file content", () => {
  const left = product("scene", { json });
  left[1].files = { "scene.json": json };
  const right = structuredClone(left);
  right[1].files["scene.json"].size++;
  assert.throws(() => mergeProductManifests([left, right]), /differing product files/);
  assert.throws(() => mergeProductManifests([]), /no product manifests/);
});

test("product paths may include region directories and must remain relative", () => {
  assert.equal(productDir("regions/a/stories/7.json"), "regions/a/stories/7");
  for (const path of ["/stories/7.json", "stories/../7.json", "stories/7.json?x", "a//7.json", "a\\7.json"])
    assert.throws(() => productDir(path), /not a product manifest path/);
});
