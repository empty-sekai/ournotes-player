import { nativeComponent } from "./story-screen-resources.mjs";
// Canvas prefab geometry off the canvas plane: rotations about x / y and z offsets placed by the node's 3D matrix
// (perspective canvases keep z for the camera's projection, orthographic ones drop it), and Quaternion.eulerAngles.
// Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasPrefab, ScreenCanvas, quatEuler, viewProjection } from "../../src/story/features/canvas.js";
import { eulerAngles } from "../../src/story/features/dotween-pro.js";

const SCALER = { m_UiScaleMode: 1, m_ReferenceResolution: { x: 1000, y: 500 }, m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 0,
                 m_ReferencePixelsPerUnit: 100, _maxAspectThreshold: 10 };
const FULL = { m_AnchorMin: { x: 0, y: 0 }, m_AnchorMax: { x: 1, y: 1 }, m_AnchoredPosition: { x: 0, y: 0 },
               m_SizeDelta: { x: 0, y: 0 }, m_Pivot: { x: 0.5, y: 0.5 } };
const CENTRE = (w, h) => ({ m_AnchorMin: { x: 0.5, y: 0.5 }, m_AnchorMax: { x: 0.5, y: 0.5 }, m_AnchoredPosition: { x: 0, y: 0 },
                            m_SizeDelta: { x: w, y: h }, m_Pivot: { x: 0.5, y: 0.5 } });
const image = { type: "MonoBehaviour", class: "Image", m_Enabled: 1, m_Material: null, m_Color: { r: 1, g: 1, b: 1, a: 1 },
                m_Sprite: null, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1 };
const node = (path, rect, components = [], extra = {}) => ({ path, name: path.split("/").pop(), active: true,
  localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  rect, components: components.map(nativeComponent), ...extra });

const build = (perspective, rot, z = 0) => {
  const c = new ScreenCanvas("C", { sortingOrder: 1, scaler: SCALER }, { sprite: () => null });
  if (perspective) c.perspective = { fov: 60 };
  new CanvasPrefab([node("p", FULL, [], { localRotation: rot }),
                    node("p/img", CENTRE(100, 40), [{ type: "CanvasRenderer" }, image], { localPosition: { x: 0, y: 0, z } })], c.root, c);
  c.layout(1000, 500);
  return c;
};
const corners = (c) => { const v = c.drawItems()[0].verts; return [0, 1, 2, 3].map((i) => [v[i * 16], v[i * 16 + 1], v[i * 16 + 2]]); };
const near = (a, b, eps = 1e-3) => a.every((x, i) => Math.abs(x - b[i]) < eps);

test("a rotation about y: the perspective canvas keeps the mesh's z, the orthographic one flattens it", () => {
  const q = quatEuler(0, 60, 0);
  const p = corners(build(true, q)), o = corners(build(false, q));
  // the image's 100 units along x turn by 60 degrees about y: x extent +-25, z -+43.3 (Unity: +y rotation turns +x to -z)
  const xs = p.map((v) => v[0] - 500), zs = p.map((v) => v[2]);
  assert.ok(near([Math.min(...xs), Math.max(...xs)], [-25, 25]), `${xs}`);
  assert.ok(near([Math.min(...zs), Math.max(...zs)], [-43.30127, 43.30127]), `${zs}`);
  for (const v of p) assert.ok(Math.abs(v[2] + (v[0] - 500) * Math.tan(Math.PI / 3)) < 1e-3, `${v}`);   // z = -x tan 60
  assert.deepEqual(o.map((v) => v[2]), [0, 0, 0, 0]);
  assert.ok(near(o.map((v) => v[0]).sort((a, b) => a - b), p.map((v) => v[0]).sort((a, b) => a - b)));
});

test("the perspective view-projection scales a point at canvas z by D / (D + z) about the view centre", () => {
  const W = 1000, H = 500, vp = viewProjection(60, W, H), D = H / (2 * Math.tan(Math.PI / 6));
  const project = ([x, y, z]) => { const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    return [((vp[0] * x + vp[12]) / w + 1) / 2 * W, ((vp[5] * y + vp[13]) / w + 1) / 2 * H]; };
  const k = D / (D + 50);
  assert.ok(near(project([600, 300, 50]), [500 + 100 * k, 250 + 50 * k]));
  assert.ok(near(project([123, 456, 0]), [123, 456]));                   // the canvas plane maps as the orthographic view
  // a z offset under an x / y rotation moves the mesh within the plane too (no longer refused)
  const c = corners(build(true, quatEuler(0, 90, 0), 10));
  for (const v of c) assert.ok(Math.abs(v[0] - 510) < 1e-3, `${v}`);      // local +z turns to +x under +90 about y
});

test("Quaternion.eulerAngles: Z X Y order in [0, 360), the poles with z = 0", () => {
  for (const [x, y, z] of [[5, 8, 3], [0, 355, 358], [30, 200, 10], [300, 45, 90]]) {
    const e = eulerAngles(quatEuler(x, y, z));
    assert.ok(near([e.x, e.y, e.z], [x, y, z], 2e-3), `${x} ${y} ${z} -> ${e.x} ${e.y} ${e.z}`);
  }
  const pole = eulerAngles(quatEuler(90, 30, 20));                         // x = 90: y - z folds into y
  assert.ok(near([pole.x, pole.z], [90, 0], 2e-3) && Math.abs(pole.y - 10) < 2e-3, `${pole.x} ${pole.y} ${pole.z}`);
});

test("Image Tiled: a trimmed sprite tiles at its full rect size with the uvs of its packed area", () => {
  const canvas = new ScreenCanvas("C", { sortingOrder: 303, scaler: { m_ReferencePixelsPerUnit: 100 } });
  // a 10 x 10 sprite trimmed to 6 x 10 at offset 2 in a 64 x 64 texture, not packed, clamped
  const sprite = { sprite: "s", rect: { x: 0, y: 0, width: 10, height: 10 }, border: { x: 0, y: 0, z: 0, w: 0 }, pixelsToUnits: 100,
                   pivot: { x: 0.5, y: 0.5 }, textureRect: { x: 8, y: 16, width: 6, height: 10 }, textureRectOffset: { x: 2, y: 0 },
                   settingsRaw: 0, texture: { texture: "t.png", width: 64, height: 64, settings: { m_WrapU: 1, m_WrapV: 1 } } };
  const img = { type: "MonoBehaviour", class: "Image", m_Enabled: 1, m_Material: null, m_Color: { r: 1, g: 1, b: 1, a: 1 },
                m_Sprite: sprite, m_Type: 2, m_PreserveAspect: 0, m_FillCenter: 1, m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1 };
  const rec = { path: "T", name: "T", active: true, localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 },
                localScale: { x: 1, y: 1, z: 1 }, components: [img],
                rect: { m_AnchorMin: { x: 0.5, y: 0.5 }, m_AnchorMax: { x: 0.5, y: 0.5 }, m_AnchoredPosition: { x: 0, y: 0 },
                        m_SizeDelta: { x: 25, y: 10 }, m_Pivot: { x: 0.5, y: 0.5 } } };
  rec.components = rec.components.map(nativeComponent);
  canvas.objects = { sprite: () => ({ ...sprite, id: "sprite:1", texture: { ...sprite.texture, id: "texture:1", wrapU: 1, wrapV: 1 } }) };
  const pf = new CanvasPrefab([rec], canvas.root, canvas);
  canvas.scaler = { m_UiScaleMode: 1, m_ReferenceResolution: { x: 100, y: 100 }, m_ScreenMatchMode: 0, m_MatchWidthOrHeight: 0,
                    m_ReferencePixelsPerUnit: 100 };
  canvas.layout(100, 100);
  const [it] = canvas.drawItems();
  assert.equal(pf.node("T").image.m_Type, 2);
  const uv = (i) => [it.verts[i * 16 + 7], it.verts[i * 16 + 8]].map((x) => Math.round(x * 1e4) / 1e4);
  const xy = (i) => [it.verts[i * 16], it.verts[i * 16 + 1]].map((x) => Math.round(x * 1e3) / 1e3);
  // three tiles of 10: two whole, the last clipped to 5 (half of the packed width in u)
  assert.equal(it.verts.length / 16, 12);
  const [u0, v0, u1, v1] = [8 / 64, 16 / 64, 14 / 64, 26 / 64].map((x) => Math.round(x * 1e4) / 1e4);
  assert.deepEqual([xy(0), uv(0)], [[37.5, 45], [u0, v0]]);
  assert.deepEqual([xy(2), uv(2)], [[47.5, 55], [u1, v1]]);
  assert.deepEqual([xy(10), uv(10)], [[62.5, 55], [Math.round((8 / 64 + 3 / 64) * 1e4) / 1e4, v1]]);
});
