// docs/fidelity.md lists every `ENGINE:` note of src/ (scripts/engine-notes.mjs). Reads the repository's own files only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collect, current, render } from "../../scripts/engine-notes.mjs";

const doc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "fidelity.md");

test("the ENGINE: list in docs/fidelity.md matches the sources", () => {
  const groups = collect();
  assert.ok(groups.length > 0);
  assert.equal(current(fs.readFileSync(doc, "utf8")).list, render(groups),
               "run node scripts/engine-notes.mjs --write");
});
