// The story UI's auto layout (src/story/ui-layout.js) on synthetic node trees: a width-controlled horizontal group
// with a content size fitter and an uncontrolled group against the engine's layout subsets (UILayout), a fully
// controlled horizontal group with force expand and a vertical content size fitter (the centre talk window's
// content), a vertical group with flexible layout elements, ignored children, and layout roots below a group.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { UILayout, UINode } from "../../src/engine/ugui.js";
import { StoryLayout } from "../../src/story/ui-layout.js";

const v2 = (x, y) => ({ x, y });
const rec = (path, { aMin = [0, 0], aMax = [1, 1], pos = [0, 0], size = [0, 0], pivot = [0.5, 0.5], active = 1, ...rest } = {}) => ({
  path, name: path.slice(path.lastIndexOf("/") + 1), active, localPosition: { x: 0, y: 0, z: 0 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  rect: { m_AnchorMin: v2(...aMin), m_AnchorMax: v2(...aMax), m_AnchoredPosition: v2(...pos), m_SizeDelta: v2(...size),
          m_Pivot: v2(...pivot) }, ...rest,
});
const group = (cls, o = {}) => ({ m_Enabled: 1, class: cls, m_Padding: { m_Left: 0, m_Right: 0, m_Top: 0, m_Bottom: 0 },
  m_Spacing: 0, m_ChildAlignment: 0, m_ChildControlWidth: 0, m_ChildControlHeight: 0, m_ChildForceExpandWidth: 0,
  m_ChildForceExpandHeight: 0, m_ChildScaleWidth: 0, m_ChildScaleHeight: 0, m_ReverseArrangement: 0, ...o });
const element = (o) => ({ m_Enabled: 1, m_IgnoreLayout: 0, m_LayoutPriority: 1, m_MinWidth: -1, m_MinHeight: -1,
  m_PreferredWidth: -1, m_PreferredHeight: -1, m_FlexibleWidth: -1, m_FlexibleHeight: -1, ...o });

// a tree from records (parents first); layoutGroup / contentSizeFitter / layoutElement as StoryUI sets them; `text`
// = a stub text component {preferredWidth(), preferredHeight()} (the height may read the node's rect width)
const tree = (recs) => {
  const byPath = new Map();
  for (const r of recs) {
    const parent = byPath.get(r.path.slice(0, r.path.lastIndexOf("/"))) || null;
    const n = new UINode(r, parent);
    if (r.layoutGroup) n.layoutGroup = r.layoutGroup;
    if (r.contentSizeFitter) n.contentSizeFitter = r.contentSizeFitter;
    if (r.layoutElement && r.layoutElement.m_Enabled) n.layoutElement = r.layoutElement;
    if (r.stub) n.text = r.stub(n);
    byPath.set(r.path, n);
  }
  return byPath;
};
const textOf = (n) => n.text || null;
const snap = (n) => ({ aMin: { ...n.anchorMin }, aMax: { ...n.anchorMax }, pos: { ...n.anchoredPosition }, size: { ...n.sizeDelta },
                       rect: { ...n.rect }, m: [...n.matrix] });

test("width-controlled horizontal group with a horizontal fitter: same as the engine subset", () => {
  const make = () => tree([
    rec("C"),
    rec("C/Plate", { aMin: [0, 0], aMax: [0, 0], pos: [30, 10], size: [0, 60], pivot: [0, 0],
                     layoutGroup: group("HorizontalLayoutGroup", { m_Padding: { m_Left: 24, m_Right: 30, m_Top: 0, m_Bottom: 0 },
                                                                  m_ChildAlignment: 3, m_ChildControlWidth: 1, m_Spacing: 6 }),
                     contentSizeFitter: { m_Enabled: 1, m_HorizontalFit: 2, m_VerticalFit: 0 } }),
    rec("C/Plate/Name", { aMin: [0, 0], aMax: [0, 0], size: [0, 36], pivot: [0.5, 0.5], stub: () => ({ preferredWidth: () => F(213.37), preferredHeight: () => 40 }) }),
    rec("C/Plate/Tail", { aMin: [0, 0], aMax: [0, 0], size: [17, 20], pivot: [0.5, 0.5], stub: () => ({ preferredWidth: () => F(11.5), preferredHeight: () => 40 }) }),
  ]);
  const a = make(), b = make();
  new StoryLayout(100, textOf).layoutRoot(a.get("C"), 2340, 1080);
  UILayout.layoutRoot(b.get("C"), 2340, 1080, (n) => UILayout.rebuildHorizontal(n, (x) => UILayout.elements(x, 100, (y) => (y.text
    ? [{ priority: 0, minWidth: 0, preferredWidth: y.text.preferredWidth(), flexibleWidth: -1 }] : []))));
  for (const p of ["C/Plate", "C/Plate/Name", "C/Plate/Tail"]) assert.deepEqual(snap(a.get(p)), snap(b.get(p)), p);
  assert.equal(a.get("C/Plate").sizeDelta.x, F(F(F(F(24 + 30) + F(F(213.37) + 6)) + F(F(11.5) + 6)) - 6));
});

test("uncontrolled groups, both kinds and alignments: same as the engine subset", () => {
  for (const cls of ["HorizontalLayoutGroup", "VerticalLayoutGroup"]) {
    for (const align of [0, 4, 8]) {
      for (const expand of [0, 1]) {
        const make = () => tree([
          rec("C"),
          rec("C/G", { aMin: [1, 0], aMax: [1, 0], pos: [-40, 30], size: [500, 300], pivot: [1, 0],
                       layoutGroup: group(cls, { m_Padding: { m_Left: 3, m_Right: 5, m_Top: 7, m_Bottom: 11 }, m_Spacing: 13,
                                                 m_ChildAlignment: align, m_ChildForceExpandWidth: expand, m_ChildForceExpandHeight: expand }) }),
          rec("C/G/A", { size: [120, 90], pivot: [0.25, 0.75] }),
          rec("C/G/Off", { size: [10, 10], active: 0 }),
          rec("C/G/B", { size: [80, 40] }),
        ]);
        const a = make(), b = make();
        new StoryLayout(100, textOf).layoutRoot(a.get("C"), 2340, 1080);
        UILayout.layoutRoot(b.get("C"), 2340, 1080, (n) => UILayout.rebuildUncontrolled(n));
        for (const p of ["C/G", "C/G/A", "C/G/B"]) assert.deepEqual(snap(a.get(p)), snap(b.get(p)), `${cls} ${align} ${expand} ${p}`);
      }
    }
  }
});

test("controlled horizontal group, force expand width, vertical preferred fitter: text width then its height", () => {
  const heights = [];
  const t = tree([
    rec("C"),
    rec("C/Area", { aMin: [0, 0.5], aMax: [1, 0.5], size: [0, 200] }),
    rec("C/Area/Content", { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [1140, 0],
                            layoutGroup: group("HorizontalLayoutGroup", { m_ChildAlignment: 4, m_Spacing: 40, m_ChildControlWidth: 1,
                                                                         m_ChildControlHeight: 1, m_ChildForceExpandWidth: 1 }),
                            contentSizeFitter: { m_Enabled: 1, m_HorizontalFit: 0, m_VerticalFit: 2 } }),
    // preferred width 1500 (wider than the group) or 300; preferred height from the width it is laid out at
    rec("C/Area/Content/Text", { aMin: [0, 0], aMax: [0, 0], size: [0, 0], pivot: [0, 1],
                                 stub: (n) => ({ preferredWidth: () => 1500,
                                                 preferredHeight: () => { heights.push(n.rect.w); return n.rect.w === 1140 ? F(97.21) : 45; } }) }),
  ]);
  new StoryLayout(100, textOf).layoutRoot(t.get("C"), 2340, 1080);
  const c = t.get("C/Area/Content"), x = t.get("C/Area/Content/Text");
  assert.ok(heights.length > 0 && heights.every((w) => w === 1140), "the height is asked after the width pass, at the laid-out width");
  assert.equal(c.sizeDelta.y, F(97.21));
  assert.deepEqual(x.anchorMin, { x: 0, y: 1 });
  assert.deepEqual(x.sizeDelta, { x: 1140, y: F(97.21) });
  assert.deepEqual(x.anchoredPosition, { x: 0, y: -0 });                 // -pos - size * (1 - pivot.y) = -0 - 0
  assert.deepEqual(x.rect, { x: -0, y: F(-97.21), w: 1140, h: F(97.21) });
  // the content is centred on the area: its top edge at +h/2 from the area centre
  const top = x.matrix[5];
  assert.ok(Math.abs(top - (540 + F(97.21) / 2)) < 1e-4, `top ${top}`);   // node matrices are double
});

test("controlled groups: min / preferred lerp, flexible surplus, other-axis clamp and priorities", () => {
  const t = tree([
    rec("C"),
    rec("C/V", { aMin: [0, 0], aMax: [0, 0], pos: [100, 100], size: [300, 250], pivot: [0, 0],
                 layoutGroup: group("VerticalLayoutGroup", { m_Padding: { m_Left: 10, m_Right: 20, m_Top: 5, m_Bottom: 15 }, m_Spacing: 4,
                                                             m_ChildAlignment: 1, m_ChildControlWidth: 1, m_ChildControlHeight: 1 }) }),
    rec("C/V/A", { layoutElement: element({ m_MinHeight: 30, m_PreferredHeight: 60, m_FlexibleHeight: 1, m_PreferredWidth: 100 }) }),
    rec("C/V/B", { layoutElement: element({ m_MinHeight: 20, m_PreferredHeight: 40, m_FlexibleHeight: 3, m_FlexibleWidth: 1, m_MinWidth: 50 }) }),
    rec("C/V/Ignored", { size: [7, 7], layoutElement: element({ m_IgnoreLayout: 1, m_Enabled: 0 }) }),
    // a text whose preferred width loses to the layout element (higher priority)
    rec("C/V/T", { layoutElement: element({ m_PreferredHeight: 10, m_PreferredWidth: 42 }),
                   stub: () => ({ preferredWidth: () => 999, preferredHeight: () => 999 }) }),
  ]);
  new StoryLayout(100, textOf).layoutRoot(t.get("C"), 2340, 1080);
  const [a, b, x, ig] = ["C/V/A", "C/V/B", "C/V/T", "C/V/Ignored"].map((p) => t.get(p));
  // vertical: totals min 5+15 + 30+4 + 20+4 + 10 = 88, preferred 20 + 64 + 44 + 10 = 138, flexible 4; size 250 ->
  // surplus 112, multiplier 28: A 60+28, B 40+84, T 10
  assert.deepEqual([a.sizeDelta.y, b.sizeDelta.y, x.sizeDelta.y], [88, 124, 10]);
  assert.deepEqual([a.anchoredPosition.y, b.anchoredPosition.y, x.anchoredPosition.y], [F(-5 - 44), F(-(5 + 92) - 62), F(-(97 + 128) - 5)]);
  // horizontal (other axis): inner 270; A clamp(270, 0, 100) = 100, B flexible -> clamp(270, 50, 300) = 270, T 42;
  // alignment UpperCenter
  assert.deepEqual([a.sizeDelta.x, b.sizeDelta.x, x.sizeDelta.x], [100, 270, 42]);
  assert.deepEqual([a.anchoredPosition.x, b.anchoredPosition.x, x.anchoredPosition.x], [F(10 + 85 + 50), F(10 + 0 + 135), F(10 + 114 + 21)]);
  assert.deepEqual(ig.sizeDelta, { x: 7, y: 7 }, "an ignored child keeps its rect");
  assert.deepEqual(ig.anchorMin, { x: 0, y: 0 });
});

test("a content size fitter below a layout group is laid out by the group's rebuild", () => {
  const order = [];
  const t = tree([
    rec("C"),
    rec("C/H", { aMin: [0, 0], aMax: [0, 0], size: [400, 100], pivot: [0, 0],
                 layoutGroup: group("HorizontalLayoutGroup", { m_ChildControlWidth: 1 }) }),
    rec("C/H/Fit", { aMin: [0, 0], aMax: [0, 0], size: [0, 30],
                     contentSizeFitter: { m_Enabled: 1, m_HorizontalFit: 0, m_VerticalFit: 2 },
                     stub: (n) => ({ preferredWidth: () => { order.push(`w${n.name}`); return 120; },
                                     preferredHeight: () => { order.push(`h${n.name}:${n.rect.w}`); return 33; } }) }),
  ]);
  new StoryLayout(100, textOf).layoutRoot(t.get("C"), 2340, 1080);
  const f = t.get("C/H/Fit");
  assert.deepEqual(f.sizeDelta, { x: 120, y: 33 });
  assert.ok(order.includes("hFit:120"), order.join(","));
});
