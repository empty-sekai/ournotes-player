import { F } from "../engine/core.js";
import { UIError, UILayout } from "../engine/ugui.js";

// uGUI auto layout of the story UI, as the game's uGUI build runs it: layout roots (MarkLayoutForRebuild), the four
// LayoutRebuilder.Rebuild passes, LayoutUtility over the ILayoutElement components of a node (the TMP text, Image,
// LayoutElement, the layout group itself), HorizontalOrVerticalLayoutGroup (CalcAlongAxis, SetChildrenAlongAxis,
// GetChildSizes, GetStartOffset, SetChildAlongAxisWithScale; child sizes controlled or not, force expand) and
// ContentSizeFitter (HandleSelfFittingAlongAxis). Float32 arithmetic in source order. The layout runs in full on every
// layout() call: the rebuild is idempotent for unchanged inputs, which is when the game skips it.

const AXES = [0, 1];
const key = (axis) => (axis === 0 ? "x" : "y");
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);   // Mathf.Clamp
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class StoryLayout {
  // refPPU = the canvas referencePixelsPerUnit; text(n) = the node's enabled text component or null
  constructor(refPPU, text) {
    this.refPPU = refPPU;
    this.text = text;
  }

  // The canvas root, then every layout root under it (LayoutRebuilder.MarkLayoutForRebuild: a node with an enabled
  // layout controller, moved up to the topmost parent chain of enabled layout groups), shallower roots first
  // (CanvasUpdateRegistry sorts the layout queue by parent count).
  layoutRoot(root, W, H) {
    UILayout.layoutRoot(root, W, H, () => {});
    const roots = [];
    const depth = (n) => { let d = 0; for (let x = n.parent; x; x = x.parent) d++; return d; };
    const walk = (n) => {
      if (!n.activeSelf) return;
      if (n.layoutGroup || n.contentSizeFitter) {
        let r = n;
        while (r.parent && r.parent.layoutGroup && r.parent.activeInHierarchy) r = r.parent;
        if (!roots.includes(r)) roots.push(r);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    roots.map((r, i) => ({ r, i, d: depth(r) })).sort((a, b) => a.d - b.d || a.i - b.i).forEach(({ r }) => this.rebuild(r));
  }

  // LayoutRebuilder.Rebuild: horizontal input (children first), horizontal control (parents first), vertical input,
  // vertical control
  rebuild(root) {
    for (const axis of AXES) {
      this._calc(root, axis);
      this._control(root, axis);
    }
  }

  // PerformLayoutCalculation: a node without layout elements and without a layout group ends the walk; the layout
  // elements' inputs are computed on demand, the layout group's CalcAlongAxis here
  _calc(n, axis) {
    if (!(this._hasElements(n) || n.rec.layoutGroup)) return;
    for (const c of n.children) this._calc(c, axis);
    if (n.layoutGroup && n.activeInHierarchy) this._calcAlongAxis(n, axis);
  }

  _hasElements(n) {
    if (!n.activeInHierarchy) return false;
    return !!((this.text(n)) || (n.image && n.image.m_Enabled) || n.layoutElement || n.layoutGroup);
  }

  // PerformLayoutControl: a node without layout controllers ends the walk; the self controller (ContentSizeFitter)
  // before the layout group
  _control(n, axis) {
    if (!n.activeInHierarchy || !(n.contentSizeFitter || n.layoutGroup)) return;
    if (n.contentSizeFitter) this._fit(n, axis);
    if (n.layoutGroup) this._setChildrenAlongAxis(n, axis);
    for (const c of n.children) this._control(c, axis);
  }

  // ---------------------------------------------------------------- LayoutUtility
  // the ILayoutElement values of a node's enabled components: {priority, min, preferred, flexible} per axis
  elements(n, axis) {
    const out = [];
    const t = this.text(n);
    if (t)                                             // TMP_Text: min 0, flexible -1, priority 0
      out.push({ priority: 0, min: 0, preferred: axis === 0 ? t.preferredWidth() : t.preferredHeight(), flexible: -1 });
    if (n.image && n.image.m_Enabled) {
      // Image.preferredWidth / preferredHeight: Sliced / Tiled -> DataUtility.GetMinSize(sprite) / pixelsPerUnit, else
      // the sprite rect size / pixelsPerUnit; min 0, flexible -1, priority 0
      // ENGINE: DataUtility.GetMinSize is native; taken as the border sums (Unity's definition for bordered sprites).
      const sp = n.image.spriteObj;
      let p = 0;
      if (sp) {
        const ppu = F(F(sp.pixelsPerUnit / this.refPPU) * n.image.m_PixelsPerUnitMultiplier);
        const sliced = n.image.m_Type === 1 || n.image.m_Type === 2;
        const size = sliced ? (axis === 0 ? F(sp.border.x + sp.border.z) : F(sp.border.y + sp.border.w))
          : (axis === 0 ? sp.rect.width : sp.rect.height);
        p = F(size / ppu);
      }
      out.push({ priority: 0, min: 0, preferred: p, flexible: -1 });
    }
    if (n.layoutElement) {
      const e = n.layoutElement, a = axis === 0 ? "Width" : "Height";
      out.push({ priority: e.m_LayoutPriority, min: e[`m_Min${a}`], preferred: e[`m_Preferred${a}`], flexible: e[`m_Flexible${a}`] });
    }
    if (n.layoutGroup && n._lg && n._lg[axis]) {       // LayoutGroup: the totals of its last CalcAlongAxis
      const s = n._lg[axis];
      out.push({ priority: 0, min: s.min, preferred: s.preferred, flexible: s.flexible });
    }
    return out;
  }

  // LayoutUtility.GetLayoutProperty: highest priority wins, negative values are skipped, ties take the larger value
  static property(elems, k, def) {
    let v = def, maxPriority = -Infinity;
    for (const e of elems) {
      if (e.priority < maxPriority) continue;
      const p = e[k];
      if (p < 0) continue;
      if (e.priority > maxPriority) { v = p; maxPriority = e.priority; }
      else if (p > v) v = p;
    }
    return v;
  }

  minSize(n, axis) { return StoryLayout.property(this.elements(n, axis), "min", 0); }
  preferredSize(n, axis) {                             // GetPreferredWidth / Height: max(min, preferred)
    const e = this.elements(n, axis);
    return Math.max(StoryLayout.property(e, "min", 0), StoryLayout.property(e, "preferred", 0));
  }
  flexibleSize(n, axis) { return StoryLayout.property(this.elements(n, axis), "flexible", 0); }

  // ---------------------------------------------------------------- ContentSizeFitter
  // HandleSelfFittingAlongAxis: Unconstrained 0 nothing, MinSize 1, PreferredSize 2 -> SetSizeWithCurrentAnchors
  _fit(n, axis) {
    const csf = n.contentSizeFitter, mode = axis === 0 ? csf.m_HorizontalFit : csf.m_VerticalFit;
    if (mode === 0) return;
    if (mode !== 1 && mode !== 2) throw new UIError(`${n.path}: ContentSizeFitter mode ${mode}`);
    n.setSizeWithCurrentAnchors(axis, mode === 1 ? this.minSize(n, axis) : this.preferredSize(n, axis));
    n.layoutIn(n.parent.rect, n.parent.matrix);
  }

  // ---------------------------------------------------------------- HorizontalOrVerticalLayoutGroup
  _group(n) {
    const lg = n.layoutGroup;
    if (lg.class !== "HorizontalLayoutGroup" && lg.class !== "VerticalLayoutGroup")
      throw new UIError(`${n.path}: ${lg.class} not implemented`);
    if (lg.m_ChildScaleWidth || lg.m_ChildScaleHeight || lg.m_ReverseArrangement)
      throw new UIError(`${n.path}: layout group child scale / reverse arrangement not implemented`);
    const p = lg.m_Padding;
    return {
      vertical: lg.class === "VerticalLayoutGroup", spacing: lg.m_Spacing,
      padSum: [p.m_Left + p.m_Right, p.m_Top + p.m_Bottom], padStart: [p.m_Left, p.m_Top],
      control: [!!lg.m_ChildControlWidth, !!lg.m_ChildControlHeight],
      expand: [!!lg.m_ChildForceExpandWidth, !!lg.m_ChildForceExpandHeight],
      align: [F((lg.m_ChildAlignment % 3) * 0.5), F(Math.floor(lg.m_ChildAlignment / 3) * 0.5)],
    };
  }

  // LayoutGroup.rectChildren: children active in the hierarchy, without an ILayoutIgnorer that ignores layout
  // (LayoutElement.ignoreLayout, read whether or not the component is enabled)
  _rectChildren(n) {
    return n.children.filter((c) => c.activeInHierarchy && !(c.rec.layoutElement && c.rec.layoutElement.m_IgnoreLayout));
  }

  // GetChildSizes: not controlled -> min = preferred = sizeDelta, flexible 0; force expand -> flexible >= 1
  _childSizes(c, axis, g) {
    let min, preferred, flexible;
    if (!g.control[axis]) { min = c.sizeDelta[key(axis)]; preferred = min; flexible = 0; }
    else { min = this.minSize(c, axis); preferred = this.preferredSize(c, axis); flexible = this.flexibleSize(c, axis); }
    if (g.expand[axis]) flexible = Math.max(flexible, 1);
    return { min, preferred, flexible };
  }

  _calcAlongAxis(n, axis) {
    const g = this._group(n), children = this._rectChildren(n);
    const pad = g.padSum[axis], other = g.vertical !== (axis === 1);
    let totalMin = pad, totalPreferred = pad, totalFlexible = 0;
    for (const c of children) {
      const s = this._childSizes(c, axis, g);
      if (other) {
        totalMin = Math.max(F(s.min + pad), totalMin);
        totalPreferred = Math.max(F(s.preferred + pad), totalPreferred);
        totalFlexible = Math.max(s.flexible, totalFlexible);
      } else {
        totalMin = F(totalMin + F(s.min + g.spacing));
        totalPreferred = F(totalPreferred + F(s.preferred + g.spacing));
        totalFlexible = F(totalFlexible + s.flexible);
      }
    }
    if (!other && children.length) { totalMin = F(totalMin - g.spacing); totalPreferred = F(totalPreferred - g.spacing); }
    totalPreferred = Math.max(totalMin, totalPreferred);
    if (!n._lg) n._lg = [];
    n._lg[axis] = { min: totalMin, preferred: totalPreferred, flexible: totalFlexible };
  }

  // GetStartOffset(axis, requiredSpaceWithoutPadding)
  _startOffset(n, g, axis, required) {
    const size = axis === 0 ? n.rect.w : n.rect.h;
    const surplus = F(size - F(required + g.padSum[axis]));
    return F(g.padStart[axis] + F(surplus * g.align[axis]));
  }

  // SetChildAlongAxisWithScale (scale 1): anchors (0, 1); size (controlled) and the anchored position on the axis
  _place(c, axis, pos, size = null) {
    const k = key(axis);
    c.anchorMin = { x: 0, y: 1 }; c.anchorMax = { x: 0, y: 1 };
    if (size !== null) c.sizeDelta[k] = size;
    const s = c.sizeDelta[k];
    c.anchoredPosition[k] = axis === 0 ? F(pos + F(s * c.pivot.x)) : F(-pos - F(s * F(1 - c.pivot.y)));
  }

  _setChildrenAlongAxis(n, axis) {
    const g = this._group(n), children = this._rectChildren(n), t = n._lg[axis];
    const size = axis === 0 ? n.rect.w : n.rect.h, align = g.align[axis], other = g.vertical !== (axis === 1);
    if (other) {
      const inner = F(size - g.padSum[axis]);
      for (const c of children) {
        const s = this._childSizes(c, axis, g);
        const required = clamp(inner, s.min, s.flexible > 0 ? size : s.preferred);
        const start = this._startOffset(n, g, axis, required);
        if (g.control[axis]) this._place(c, axis, start, required);
        else this._place(c, axis, F(start + F(F(required - c.sizeDelta[key(axis)]) * align)));
      }
    } else {
      let pos = g.padStart[axis], flexMul = 0;
      const surplus = F(size - t.preferred);
      if (surplus > 0) {
        if (t.flexible === 0) pos = this._startOffset(n, g, axis, F(t.preferred - g.padSum[axis]));
        else if (t.flexible > 0) flexMul = F(surplus / t.flexible);
      }
      let lerp = 0;
      if (t.min !== t.preferred) lerp = clamp01(F(F(size - t.min) / F(t.preferred - t.min)));
      for (const c of children) {
        const s = this._childSizes(c, axis, g);
        const childSize = F(F(s.min + F(F(s.preferred - s.min) * lerp)) + F(s.flexible * flexMul));   // Mathf.Lerp + flexible
        if (g.control[axis]) this._place(c, axis, pos, childSize);
        else this._place(c, axis, F(pos + F(F(childSize - c.sizeDelta[key(axis)]) * align)));
        pos = F(pos + F(childSize + g.spacing));
      }
    }
    n.layoutIn(n.parent.rect, n.parent.matrix);
  }
}

