// GL object tracking shared by ChartSession and ModelSession (src/engine/gltrack.js): the objects a session creates
// through a WebGL2RenderingContext are deleted when it is disposed. A stand-in WebGL2RenderingContext class; no GPU.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetStore } from "../../src/data/assets.js";
import { GL_OBJECTS, trackGL } from "../../src/engine/gltrack.js";
import { ChartSession } from "../../src/live/session.js";
import { headlessGL } from "../../scripts/lib/headless.mjs";

class FakeGL2 {
  constructor() { this.n = 0; this.deleted = []; this.lost = false; }
  isContextLost() { return this.lost; }
}
for (const [c, d] of GL_OBJECTS) {
  FakeGL2.prototype[c] = function () { return { kind: c, id: ++this.n }; };
  FakeGL2.prototype[d] = function (o) { this.deleted.push(o.id); };
}

const withWebGL2 = async (fn) => {
  const saved = globalThis.WebGL2RenderingContext;
  globalThis.WebGL2RenderingContext = FakeGL2;
  try { return await fn(); } finally { if (saved) globalThis.WebGL2RenderingContext = saved; else delete globalThis.WebGL2RenderingContext; }
};

test("release deletes the objects not deleted yet, newest first, and unwraps the methods", () => withWebGL2(() => {
  const gl = new FakeGL2(), t = trackGL(gl);
  assert.equal(Object.keys(gl).filter((k) => typeof gl[k] === "function").length, GL_OBJECTS.length * 2);
  const a = gl.createBuffer(), b = gl.createTexture(), c = gl.createProgram(), q = gl.fenceSync();
  gl.deleteTexture(b);                                     // deleted by the session: not deleted again
  t.release();
  assert.deepEqual(gl.deleted, [b.id, q.id, c.id, a.id]);
  assert.deepEqual(Object.keys(gl).filter((k) => typeof gl[k] === "function"), []);
  gl.createBuffer();                                       // no longer tracked
  trackGL(gl).release();
  assert.deepEqual(gl.deleted, [b.id, q.id, c.id, a.id]);
}));

test("nothing is deleted on a lost context; other contexts are not tracked", () => withWebGL2(() => {
  const gl = new FakeGL2(), t = trackGL(gl);
  gl.createBuffer();
  gl.lost = true;
  t.release();
  assert.deepEqual(gl.deleted, []);
  const plain = headlessGL();                              // not a WebGL2RenderingContext: used as given
  const create = plain.createBuffer;
  trackGL(plain).release();
  assert.equal(plain.createBuffer, create);
}));

test("ChartSession tracks its context and releases it when it fails to load", () => withWebGL2(async () => {
  const gl = new FakeGL2(), set = [];
  const spy = new Proxy(gl, { set(o, k, v) { set.push(k); o[k] = v; return true; } });
  await assert.rejects(ChartSession.create({ gl: spy, assets: new AssetStore() }), /live\.json/);
  assert.deepEqual(set.slice(0, 2), ["createBuffer", "deleteBuffer"]);
  assert.deepEqual(Object.keys(gl).filter((k) => typeof gl[k] === "function"), []);
}));
