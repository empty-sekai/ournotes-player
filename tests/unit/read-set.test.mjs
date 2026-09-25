// The read-set tool (scripts/read-set.mjs) and its headless harness (scripts/lib/headless.mjs): the plan of the note
// views' materials (LiveNotes.plannedMaterials, NoteGL.prepare) over a synthetic score and prefabs, the command line
// (--features, option errors), the plain-object WebGL2 stub and the on-demand directory store. The equality of the
// plan with the full simulation over real charts is an opt-in data check (CONTRIBUTING.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LiveNotes, NoteGL } from "../../src/live/noteview.js";
import { NoteGeo } from "../../src/live/notegeo.js";
import { DirStore, headlessGL, storeFromDir } from "../../scripts/lib/headless.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "read-set.mjs");

// ---- synthetic note views
const TRS = { localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 } };
const mat = (name, shader = "Sprites/Default") => ({ material: name, shader: { shader }, keywords: [], floats: { _Z: 1 }, colors: {} });
const sr = (m, enabled = 1) => ({ type: "SpriteRenderer", m_Enabled: enabled, m_Materials: [m], m_Size: { x: 1, y: 1 },
                                  m_Color: { r: 1, g: 1, b: 1, a: 1 }, m_SortingOrder: 0, m_SortingLayer: 0, m_DrawMode: 0 });
const sprite = (name) => ({ sprite: name, texture: { texture: `textures/${name}.png` }, rect: { x: 0, y: 0, width: 4, height: 4 } });
// a head prefab: root (view script) with a main and a mark renderer
const head = (name, main, mark) => ({ nodes: [
  { path: name, name, active: true, ...TRS, components: [{ type: "MonoBehaviour", class: "LiveNoteView",
    _mainSpriteRenderer: { gameObject: `${name}/main` }, _markSpriteRenderer: { gameObject: `${name}/mark` } }] },
  { path: `${name}/main`, name: "main", active: true, ...TRS, components: [sr(main)] },
  { path: `${name}/mark`, name: "mark", active: true, ...TRS, components: [sr(mark)] },
] });
const M = Object.fromEntries(["tap", "tapMark", "slide", "slideMark", "conn", "connMark", "end", "endMark", "flick",
                              "flickMark", "pair", "body"].map((k) => [k, mat(k)]));
const ln = {
  prefabs: {
    tap_note_view: head("tap_note_view", M.tap, M.tapMark),
    slide_note_view: head("slide_note_view", M.slide, M.slideMark),
    connection_note_view: head("connection_note_view", M.conn, M.connMark),
    slide_end_note_view: head("slide_end_note_view", M.end, M.endMark),
    flick_note_view: head("flick_note_view", M.flick, M.flickMark),
    guide_note_view: { nodes: [{ path: "guide_note_view", name: "guide_note_view", active: true, ...TRS, components: [] }] },
    pair_note_line: { nodes: [{ path: "pair_note_line", name: "pair_note_line", active: true, ...TRS,
                                components: [{ ...sr(M.pair), m_Sprite: sprite("pair") }] }] },
  },
  noteSkin: {                                   // the tap and connection skins have no centre mark: no mark drawn
    TapNoteAsset: { _mainSprite: sprite("tap"), _centerMarkSprite: null },
    SlideNoteAsset: { _mainSprite: sprite("slide"), _centerMarkSprite: sprite("slide_mark") },
    SlideConnectNoteAsset: { _mainSprite: sprite("conn"), _centerMarkSprite: null },
    SlideEndNoteAsset: { _mainSprite: sprite("end"), _centerMarkSprite: sprite("end_mark") },
    FlickNoteAsset: { _mainSprite: sprite("flick"), _centerMarkSprite: sprite("flick_mark") },
  },
};
const note = (id, op, extra = {}) => ({ id, op, timeMs: 1000 * id, laneStart: 2, laneEnd: 4, laneStartFloat: 2, laneEndFloat: 4,
                                        width: 3, critical: false, direction: "Normal", pairNoteId: 0, lineIds: [], ...extra });
const GEO = new NoteGeo({ laneCount: 24, laneSize: [1912, 1000], laneTopRange: 0.3, laneBottomRange: 1, laneTopPosition: 0,
                          judgementScreenBottomPosition: 2.24 });
const planned = (notes, { showPairLines = true } = {}) => {
  const owner = Object.assign(Object.create(LiveNotes.prototype), {
    ln, score: { notes }, geo: GEO, showPairLines, notes: new Map(notes.map((n) => [n.id, n])), material: M.body,
    _clips: new Map(),
  });
  return LiveNotes.prototype.plannedMaterials.call(owner).map((m) => m.material).sort();
};

test("plan: the head renderers of the note kinds in the score, the pair line and the line body", () => {
  const score = [
    note(1, 1, { pairNoteId: 2 }), note(2, 1, { pairNoteId: 1 }),                // taps with a pair line
    note(3, 20, { lineIds: [1] }), note(4, 21, { lineIds: [1] }), note(5, 22, { lineIds: [1] }),   // a slide
    note(6, 120), note(7, 0),                                                    // None views: nothing drawn
  ];
  assert.deepEqual(planned(score), ["body", "conn", "end", "endMark", "pair", "slide", "slideMark", "tap"]);
  // no flick in the score: the flick view is never drawn; pair lines off: no pair line
  assert.deepEqual(planned(score, { showPairLines: false }), ["body", "conn", "end", "endMark", "slide", "slideMark", "tap"]);
  // a guide line (its begin note has a view without renderers) still draws the line body
  assert.deepEqual(planned([note(1, 100, { lineIds: [2] }), note(2, 103, { lineIds: [2] })]), ["body"]);
  // no line, a pair whose note is not in the score
  assert.deepEqual(planned([note(1, 1, { pairNoteId: 9 }), note(2, 40)]), ["flick", "flickMark", "tap"]);
});

test("plan: a planned material makes the shader library requests of its draw", () => {
  const calls = [];
  const lib = { program: (...a) => calls.push(["program", ...a]), state: (...a) => calls.push(["state", ...a]),
                defaults: (...a) => calls.push(["defaults", ...a]) };
  const defTex = { white: {} };
  NoteGL.prototype.prepare.call({ lib, defTex }, M.slide);
  assert.deepEqual(calls, [["program", "Sprites/Default", 0, []], ["state", "Sprites/Default", 0, { _Z: 1 }],
                           ["defaults", "Sprites/Default", defTex]]);
});

// ---- command line
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("read-set --features names the plan mode; option errors exit 2", () => {
  const f = run("--features");
  assert.equal(f.status, 0);
  assert.deepEqual(JSON.parse(f.stdout), { features: ["plan"] });
  assert.equal(f.stdout.trim(), '{"features":["plan"]}');
  assert.equal(run().status, 2);
  const r = run("some/chart", "--plan", "--frames=10");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--frames has no meaning with --plan/);
});

// ---- headless WebGL2
test("headless WebGL2: constants, methods and calls as plain properties", () => {
  const calls = [], gl = headlessGL({ width: 64, height: 32, onCall: (k) => calls.push(k) }), other = headlessGL();
  assert.equal(gl.TEXTURE_2D, gl.TEXTURE_2D);
  assert.notEqual(gl.TEXTURE_2D, gl.ARRAY_BUFFER);
  assert.equal(other.TEXTURE_2D, gl.TEXTURE_2D);                         // shared by every context
  assert.equal(gl.bindTexture, gl.bindTexture);
  const a = gl.createBuffer(), b = gl.createTexture();
  assert.deepEqual([a.kind, b.kind, a.id < b.id], ["Buffer", "Texture", true]);
  assert.equal(gl.getParameter(gl.MAX_TEXTURE_SIZE), 16384);
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  assert.equal(gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0), undefined);
  assert.deepEqual(calls, ["createBuffer", "createTexture", "getParameter", "checkFramebufferStatus", "drawElements"]);
  assert.deepEqual([gl.canvas.width, gl.canvas.height, gl.drawingBufferWidth], [64, 32, 64]);
  const own = gl.createBuffer;                                           // wrapped and unwrapped, as a session does
  gl.createBuffer = () => "wrapped";
  assert.equal(gl.createBuffer(), "wrapped");
  delete gl.createBuffer;
  assert.equal(gl.createBuffer, own);
  assert.equal(gl.hasOwnProperty, Object.prototype.hasOwnProperty);
  assert.equal(String(gl), "[object Object]");
  assert.equal(gl[Symbol.iterator], undefined);
});

// ---- directory store
test("DirStore reads each file when it is first asked for, with storeFromDir's contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ournotes-live-"));
  try {
    fs.mkdirSync(path.join(dir, "livescene", "textures"), { recursive: true });
    fs.writeFileSync(path.join(dir, "live.json"), '{"scene":"livescene/scene.json","n":1e999}');
    fs.writeFileSync(path.join(dir, "livescene", "scene.json"), '{"k":"é"}');
    fs.writeFileSync(path.join(dir, "livescene", "a.glsl"), "#version 300 es\n");
    fs.writeFileSync(path.join(dir, "livescene", "textures", "t.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
    const lazy = new DirStore(dir), full = storeFromDir(dir);
    assert.equal(lazy._text.size + lazy._bin.size, 0);
    assert.equal(lazy.text("live.json"), full.text("live.json"));
    assert.equal(lazy.json("live.json").n, Infinity);
    assert.equal(lazy._text.size + lazy._bin.size, 1, "only the file asked for is read");
    assert.deepEqual(lazy.bytes("livescene/textures/t.png"), full.bytes("livescene/textures/t.png"));
    assert.deepEqual(lazy.bytes("livescene/scene.json"), full.bytes("livescene/scene.json"));
    assert.equal(lazy.text("livescene/a.glsl"), full.text("livescene/a.glsl"));
    for (const p of ["LIVE.json", "livescene", "livescene/../live.json", "./live.json", "livescene//a.glsl", "nope.json"]) {
      assert.equal(lazy.has(p), full.has(p), p);
      assert.throws(() => lazy.text(p), /asset not found/, p);
    }
    assert.deepEqual(lazy.list(), full.list().sort());
    assert.deepEqual(lazy.list("livescene/"), full.list("livescene/").sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
