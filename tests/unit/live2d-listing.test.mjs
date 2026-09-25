// Model picker texts of the Live2D page (examples/live2d/listing.js). Synthetic models.json entries only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { modelText } from "../../examples/live2d/listing.js";

test("a model is listed by its character name and id, else by its id", () => {
  const m = { id: "adv_live2d_a_001_casual_01", label: "A", names: { ja: "エー", en: "A" }, bytes: 3 * 1048576 };
  assert.equal(modelText(m), "A · adv_live2d_a_001_casual_01 (3.0 MB)");
  assert.equal(modelText(m, "ja"), "エー · adv_live2d_a_001_casual_01 (3.0 MB)");
  assert.equal(modelText(m, "ko"), "A · adv_live2d_a_001_casual_01 (3.0 MB)");        // no Korean name: the label
  assert.equal(modelText({ id: "sub_x", names: { en: "X" } }, "en"), "X · sub_x");
  assert.equal(modelText({ id: "sub_x", names: { en: "X" } }), "sub_x");                // no language, no label
  assert.equal(modelText({ id: "sub_y" }), "sub_y");
});
