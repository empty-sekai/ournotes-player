// The chat phone's uGUI pieces on synthetic inputs: stencil states of masks and masked graphics, chat sprites (trimmed
// sliced inner uv), the Soft Mask parameters, the ScrollRect positions, node copies, the canvas draw list and the
// Screen Space - Camera globals, the sprite constants in the globals of a canvas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UnityProgram } from "../../src/engine/glsl.js";
import { UIDraw, UILayout } from "../../src/engine/ugui.js";
import {
  ChatCanvasGL, ChatCanvasUI, ChatScrollRect, STENCIL_NONE, buildChatNodes, chatSprite, cloneChatNode, maskStencil,
  maskedStencil, softMaskParams,
} from "../../src/story/ui-chat.js";

const F = Math.fround;
const Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 }, Z = { x: 0, y: 0, z: 0 };
const rect = (aMin, aMax, pos, size, pivot = { x: 0.5, y: 0.5 }) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax, m_AnchoredPosition: pos,
                                                                        m_SizeDelta: size, m_Pivot: pivot });
const FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 });
const C = { x: 0.5, y: 0.5 };
const node = (path, r = FULL, components = [], active = true) => ({ path, name: path.split("/").pop(), active, layer: 5,
  localPosition: Z, localRotation: Q, localScale: ONE, rect: r, components });
const image = (extra = {}) => ({ type: "MonoBehaviour", class: "Image", m_Enabled: 1, m_Material: null, m_Sprite: null,
  m_Color: { r: 1, g: 1, b: 1, a: 1 }, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1, m_PixelsPerUnitMultiplier: 1,
  m_UseSpriteMesh: 0, ...extra });
const host = { sprite: () => null, binding: () => null, visual: true };

test("stencil states: masked graphics at a depth, a mask's push and pop at depth 0 and deeper", () => {
  assert.deepEqual(maskedStencil(0), STENCIL_NONE);
  assert.deepEqual(maskedStencil(2), { ref: 3, comp: 3, op: 0, read: 3, write: 0, colorMask: 15, alphaClip: false });
  assert.deepEqual(maskStencil(0, false), {
    push: { ref: 1, comp: 8, op: 2, read: 255, write: 255, colorMask: 0, alphaClip: true },
    pop: { ref: 1, comp: 8, op: 1, read: 255, write: 255, colorMask: 0, alphaClip: true } });
  assert.deepEqual(maskStencil(1, true), {
    push: { ref: 3, comp: 3, op: 2, read: 1, write: 3, colorMask: 15, alphaClip: true },
    pop: { ref: 1, comp: 3, op: 2, read: 1, write: 3, colorMask: 0, alphaClip: true } });
});

const spriteRec = (over = {}) => ({ sprite: "s", rect: { x: 10, y: 20, width: 100, height: 80 }, border: { x: 10, y: 8, z: 12, w: 6 },
  pixelsToUnits: 100, pivot: C, textureRect: { x: 10, y: 20, width: 100, height: 80 }, textureRectOffset: { x: 0, y: 0 },
  settingsRaw: 0, texture: { texture: "t.png", width: 256, height: 256 }, ...over });

test("chat sprites: the untrimmed inner uv, a trimmed sliced sprite's inner uv from the sprite rect's origin, refusals", () => {
  const a = chatSprite(spriteRec());
  assert.deepEqual(a.inner, [20 / 256, 28 / 256, 98 / 256, 94 / 256]);
  assert.equal(a.texture.name, "t.png");
  const b = chatSprite(spriteRec({ textureRect: { x: 12, y: 24, width: 90, height: 70 }, textureRectOffset: { x: 2, y: 4 } }));
  assert.equal(b.trimmed, true);
  // origin (12 - 2, 24 - 4) = (10, 20): the same inner rect as untrimmed
  assert.deepEqual(b.inner, [20 / 256, 28 / 256, 98 / 256, 94 / 256]);
  assert.throws(() => chatSprite(spriteRec({ settingsRaw: 4 })), /rotation/);
  assert.throws(() => chatSprite(spriteRec({ texture: null })), /no texture/);
});

test("Soft Mask parameters: a Simple sprite with padding, a Sliced sprite's borders scaled and adjusted to the rect", () => {
  const simple = chatSprite(spriteRec({ rect: { x: 0, y: 0, width: 100, height: 100 }, border: { x: 0, y: 0, z: 0, w: 0 },
                                        textureRect: { x: 4, y: 6, width: 90, height: 80 }, textureRectOffset: { x: 4, y: 6 } }));
  const n = (w, h, img) => ({ path: "m", rect: { x: -w / 2, y: -h / 2, w, h }, image: img });
  const p = softMaskParams(n(100, 100, { m_Type: 0, m_PreserveAspect: 0, m_PixelsPerUnitMultiplier: 1, spriteObj: simple }), 100);
  assert.deepEqual(p.rect, [-46, -44, 44, 36]);                          // padding 4, 6, 6, 14
  assert.deepEqual(p.uvRect, simple.outer);
  assert.equal(p.sliced, false);
  const circle = chatSprite(spriteRec({ rect: { x: 0, y: 0, width: 64, height: 64 }, border: { x: 16, y: 16, z: 16, w: 16 },
                                        textureRect: { x: 0, y: 0, width: 64, height: 64 } }));
  const img = { m_Type: 1, m_PreserveAspect: 0, m_PixelsPerUnitMultiplier: 0.5, spriteObj: circle };
  const q = softMaskParams(n(100, 100, img), 100);                        // scale 100 / (100 x 0.5) = 2: borders 32
  assert.deepEqual(q.border, [-18, -18, 18, 18]);
  assert.deepEqual(q.uvBorder, circle.inner);
  assert.equal(q.sliced, true);
  const r = softMaskParams(n(40, 40, img), 100);                          // 64 > 40: borders scaled by 40 / 64
  assert.deepEqual(r.border, [0, 0, 0, 0]);
  const solid = softMaskParams(n(10, 20, { m_Type: 1, spriteObj: null }), 100);
  assert.deepEqual([solid.rect, solid.texture], [[-5, -10, 5, 10], null]);
});

// canvas c (400 x 300) > scroll view (full) > viewport (200 x 100, centred) > content (top stretch, `h` tall)
const scrollTree = (h) => {
  const recs = [node("c"), node("c/sv", FULL, [{ type: "MonoBehaviour", class: "ScrollRect", m_Enabled: 1, m_Horizontal: 0, m_Vertical: 1,
                                                  m_MovementType: 2, m_HorizontalScrollbar: null, m_VerticalScrollbar: null }]),
                node("c/sv/vp", rect(C, C, { x: 0, y: 0 }, { x: 200, y: 100 })),
                node("c/sv/vp/ct", rect({ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: h }, { x: 0.5, y: 1 }))];
  const t = buildChatNodes(recs, null, host);
  const layout = () => UILayout.layoutRoot(t.root, 400, 300, () => {});
  layout();
  return { ...t, sr: new ChatScrollRect(t.nodes.get("c/sv"), t.nodes.get("c/sv/vp/ct"), t.nodes.get("c/sv/vp"), layout) };
};

test("ScrollRect: verticalNormalizedPosition from the bounds, SetNormalizedPosition, the Clamped LateUpdate", () => {
  const { sr, nodes } = scrollTree(300), ct = nodes.get("c/sv/vp/ct");
  assert.equal(sr.normalized, 1);                                          // content top at the view top
  sr.normalized = 0;
  assert.equal(ct.anchoredPosition.y, 200);                               // hidden 300 - 100
  assert.equal(sr.normalized, 0);
  sr.normalized = 0.5;
  assert.equal(ct.anchoredPosition.y, 100);
  sr.normalized = F(0.5 + 0.00001);                                        // a move of 0.002 units: under the 0.01 threshold
  assert.equal(ct.anchoredPosition.y, 100);
  ct.anchoredPosition.y = 250;
  sr.lateUpdate();
  assert.equal(ct.anchoredPosition.y, 200);                               // clamped back to the bottom
  const small = scrollTree(60);
  assert.equal(small.sr.normalized, 0);                                    // smaller than the view: its size around the pivot
  small.sr.lateUpdate();
  assert.equal(small.nodes.get("c/sv/vp/ct").anchoredPosition.y, 0);
});

test("node copies: the template's subtree as the parent's last child with its current state and a lookup of its references", () => {
  const recs = [node("w"), node("w/ct"), node("w/ct/n", FULL, [{ type: "MonoBehaviour", class: "AdvMyChatNode", m_Enabled: 1 }]),
                node("w/ct/n/img", FULL, [image()]), node("w/ct/n/off", FULL, [], false)];
  const t = buildChatNodes(recs, null, host);
  const tpl = t.nodes.get("w/ct/n"), img = t.nodes.get("w/ct/n/img");
  img.rendererAlpha = 0.5; img.image.m_Color = { r: 1, g: 0, b: 0, a: 1 }; tpl.activeSelf = false;
  const a = cloneChatNode(tpl, recs, t.nodes.get("w/ct"), host), b = cloneChatNode(tpl, recs, t.nodes.get("w/ct"), host);
  assert.deepEqual(t.nodes.get("w/ct").children.map((c) => c.name), ["n", "n(Clone)", "n(Clone)"]);
  assert.notEqual(a.root.path, b.root.path);
  assert.match(a.root.path, /^w\/ct\/n\(Clone\)#\d+$/);
  const ai = a.root.lookup.get("w/ct/n/img");
  assert.equal(ai.parent, a.root);
  assert.deepEqual([a.root.activeSelf, ai.rendererAlpha, ai.image.m_Color.g, a.root.lookup.get("w/ct/n/off").activeSelf], [false, 0.5, 0, false]);
  ai.image.m_Color.g = 1;                                                  // the copy's state is its own
  assert.equal(img.image.m_Color.g, 0);
});

// a widget (canvas > AdvChatView > Target) and a window under Target: Mask (hidden graphic) > group (alpha 0.5) > bubble
const widget = () => ({ nodes: [
  { ...node("W/ChatCanvas"), canvas: { m_Enabled: 1, m_RenderMode: 1, m_PixelPerfect: 0, m_OverrideSorting: 0, m_SortingOrder: 10000, m_PlaneDistance: 1 },
    canvasScaler: { m_Enabled: 1, m_UiScaleMode: 1, m_ScreenMatchMode: 1, m_ReferenceResolution: { x: 1920, y: 1080 }, m_MatchWidthOrHeight: 0,
                    m_ReferencePixelsPerUnit: 100 } },
  { ...node("W/ChatCanvas/AdvChatView"), chatView: { _windowParentRect: "W/ChatCanvas/AdvChatView/Target" } },
  { ...node("W/ChatCanvas/AdvChatView/Target", rect({ x: 0.5, y: 1 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 1 })), canvasGroup: null },
] });

test("the canvas draw list: a mask's push, its masked children at depth 1 with inherited alpha, its pop; hidden objects skipped", () => {
  const ui = new ChatCanvasUI(widget());
  const top = rect({ x: 0.5, y: 1 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }, { x: 200, y: 400 }, { x: 0.5, y: 1 });
  const recs = [node("win", top), node("win/Mask", FULL, [image(), { type: "MonoBehaviour", class: "Mask", m_Enabled: 1, m_ShowMaskGraphic: 0 }]),
                node("win/Mask/g", FULL, [{ type: "CanvasGroup", m_Enabled: 1, m_Alpha: 0.5, m_IgnoreParentGroups: 0 }]),
                node("win/Mask/g/bubble", rect(C, C, { x: 0, y: 0 }, { x: 100, y: 50 }), [image()]),
                node("win/Mask/g/off", FULL, [image()], false)];
  const t = buildChatNodes(recs, ui.target, host);
  t.nodes.get("win/Mask/g/bubble").rendererAlpha = 0.5;
  ui.setSize(1920, 1080);
  ui.layout();
  const items = ui.drawItems(2);
  assert.deepEqual(items.map((it) => [it.node.path, it.kind]), [["win/Mask", "image"], ["win/Mask/g/bubble", "image"], ["win/Mask", "image"]]);
  const st = maskStencil(0, false);
  assert.deepEqual([items[0].stencil, items[1].stencil, items[2].stencil], [st.push, maskedStencil(1), st.pop]);
  assert.equal(items[1].verts[6], 0.25);                                   // group 0.5 x CanvasRenderer 0.5
  // the Target at the view's top centre, the window hanging from it: bubble centre at (960, 1080 - 200)
  const v = items[1].verts, cx = (v[0] + v[2 * 16]) / 2, cy = (v[1] + v[2 * 16 + 1]) / 2;
  assert.deepEqual([cx, cy], [960, 880]);
});

test("Screen Space - Camera globals: the canvas at the plane distance fills the view", () => {
  const g = ChatCanvasGL.globals(1920, 1080, 1920, 1080, { fov: 60, near: 0.3, far: 1000, distance: 1 });
  const s = F(F(2 * F(Math.tan(Math.PI / 6))) / 1080);
  assert.equal(g.worldScale, s);
  const M = g.unity_ObjectToWorld, P = g.unity_MatrixVP;
  const clip = (x, y) => {                                                 // P * M * (x, y, 0, 1)
    const w = [M[0] * x + M[4] * y + M[12], M[1] * x + M[5] * y + M[13], M[2] * x + M[6] * y + M[14], M[3] * x + M[7] * y + M[15]];
    const c = [0, 1, 2, 3].map((r) => P[r] * w[0] + P[4 + r] * w[1] + P[8 + r] * w[2] + P[12 + r] * w[3]);
    return [c[0] / c[3], c[1] / c[3]];
  };
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
  assert.ok(close(clip(0, 0), [-1, -1]), `${clip(0, 0)}`);
  assert.ok(close(clip(1920, 1080), [1, 1]), `${clip(1920, 1080)}`);
  assert.ok(close(clip(960, 540), [0, 0]));
});

test("canvas globals: the constants a 2D Shader Graph sprite material reads, below the material's own values", () => {
  const sprite = { _RendererColor: [1, 1, 1, 1], unity_SpriteColor: [1, 1, 1, 1], unity_SpriteProps: [1, 1, 0, 0],
                   _GlobalMipBias: [0, 1] };
  const ortho = UIDraw.globals(1920, 1080, 1920, 1080, 4);
  const camera = ChatCanvasGL.globals(1920, 1080, 1920, 1080, { fov: 60, near: 0.3, far: 1000, distance: 1 });
  for (const g of [ortho, camera]) for (const [name, v] of Object.entries(sprite)) assert.deepEqual(g[name], v, name);
  // UIDraw.draw's sheets: per-draw, material floats, material colours, shader defaults, globals
  const own = { _RendererColor: [1, 0, 0, 1] };
  for (const name of Object.keys(sprite)) assert.deepEqual(UnityProgram.lookup([{}, {}, {}, {}, ortho], name, "p"), sprite[name]);
  assert.deepEqual(UnityProgram.lookup([{}, {}, own, {}, ortho], "_RendererColor", "p"), [1, 0, 0, 1]);
});
