import { EASE } from "../../engine/tween.js";
import { UITween, UIError, UINode } from "../../engine/ugui.js";
import { StoryTalkWindow } from "../ui-talk.js";
import { ASPECT_BOOST_MAX, ASPECT_BOOST_RANGE, DEFAULT_TALK_ROOT, LAYOUT_DEFAULT, SLOT_DEFINITIONS, SLOT_LAYOUT,
         TALK_WINDOW_SCALE_MAX, TALK_WINDOW_SCALE_MIN, TALK_WINDOW_SIZE, VIEW_FADE_DURATION } from "./define.js";
import { DEFAULT_UI_MATERIAL, reparent, runtimeNodeRecord, setActive, setLastSibling } from "./ui.js";

// SimpleAdvView: the presentation of the simple player inside the host's overlay root: the layout surface
// (SimpleAdvLayoutResolver), one slot per character position (a RawImage showing the character's capture texture),
// the talk window centred in the talk root at its design size, the full-screen tap catcher and the root CanvasGroup
// fades. Pure layout and timing: the capture textures are set by the renderer (render.js), the characters are the
// session's Live2DCharacters.

const F = Math.fround;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// SimpleAdvLayoutRoot.CreateProfile -> SimpleAdvLayoutProfile(...) (its constructor clamps), or
// SimpleAdvLayoutProfile.Default when the root has no layout component
export const layoutProfile = (rec) => {
  if (!rec) return LAYOUT_DEFAULT;
  const pos = (v, lo, hi, def) => (v > 0 ? clamp(v, lo, hi) : def);
  return {
    referenceSize: { ...rec._layoutSurfaceReferenceSize },
    anchor: { x: clamp01(rec._layoutSurfaceAnchor.x), y: clamp01(rec._layoutSurfaceAnchor.y) },
    viewport: { min: { ...rec._characterViewportRect._anchorMin }, max: { ...rec._characterViewportRect._anchorMax } },
    designAspect: rec._designViewportAspect > 0 ? rec._designViewportAspect : LAYOUT_DEFAULT.designAspect,
    slotCount: Math.max(1, Math.min(5, rec._characterSlotCount | 0)),
    slotWidth: clamp01(rec._characterSlotWidth), slotHeight: clamp01(rec._characterSlotHeight),
    slotCenterY: clamp01(rec._characterSlotCenterY),
    captureBaseScale: pos(rec._characterCaptureBaseScale, F(0.1), 2, 1),
    displayScale: pos(rec._characterDisplayScale, F(0.1), 3, 1),
    displayOffset: { ...rec._characterDisplayOffset },
  };
};

// SimpleAdvLayoutResolver.ResolveSlots: per slot {positionType, def, rect: normalized [x0, y0, x1, y1]}
export const resolveSlots = (profile) => SLOT_LAYOUT[profile.slotCount].map(([pos, cx]) => {
  const hw = F(profile.slotWidth / 2), hh = F(profile.slotHeight / 2), cy = profile.slotCenterY;
  return { positionType: pos, def: SLOT_DEFINITIONS[pos],
           rect: [clamp01(F(cx - hw)), clamp01(F(cy - hh)), clamp01(F(cx + hw)), clamp01(F(cy + hh))] };
});

// SimpleAdvView.CalculateAspectScaleBoost
export const aspectScaleBoost = (aspect, design) =>
  (aspect < design ? F(1 + F(ASPECT_BOOST_MAX * clamp01(F(F(design - aspect) / ASPECT_BOOST_RANGE)))) : 1);

// SimpleAdvView.CalculateTalkWindowScale
export const talkWindowScale = (w, h) => {
  if (!(w > 0) || !(h > 0)) return 1;
  return clamp(Math.min(F(h / TALK_WINDOW_SIZE.y), F(w / TALK_WINDOW_SIZE.x)), TALK_WINDOW_SCALE_MIN, TALK_WINDOW_SCALE_MAX);
};

// AspectRatioFitter.UpdateRect for FitInParent (3) / EnvelopeParent (4): anchors 0..1, anchoredPosition 0, the size
// delta that gives the aspect inside / around the parent rect
export const aspectFit = (node, mode, aspect) => {
  const p = node.parent.rect;
  node.anchorMin = { x: 0, y: 0 }; node.anchorMax = { x: 1, y: 1 }; node.anchoredPosition = { x: 0, y: 0 };
  const size = { x: 0, y: 0 };
  if ((F(p.h * aspect) < p.w) !== (mode === 3)) size.y = F(F(p.w / aspect) - p.h);
  else size.x = F(F(p.h * aspect) - p.w);
  node.sizeDelta = size;
};

export class SimpleAdvView {
  // root: the host's overlay root node (its parent chain laid out by the host canvas); layoutRec: its
  // SimpleAdvLayoutRoot record (null: the default profile); tweens: the UI tween runner ({active: Set}) stepped in
  // the loop's tween phase; dotween: DOTweenSettings (default ease)
  constructor(root, layoutRec, { tweens, dotween }) {
    this.root = root; this.tweens = tweens; this.dotween = dotween;
    this.profile = layoutProfile(layoutRec);
    this.boost = 1;
    this.advanceInputEnabled = false; this.advanceProgressEnabled = false; this.advanceRequested = false;
    this.initialized = false; this.shownOnce = false; this.presentationTween = null;
    this.window = null;                                                 // the attached talk window {ui, talk, root}
    this._resolveLayout();
  }

  // SimpleAdvLayoutResolver.Resolve + SimpleAdvView.EnsureLayout
  _resolveLayout() {
    const root = this.root, pr = this.profile;
    const child = (name) => root.children.find((c) => c.name === name) || null;
    const make = (parent, name, opts) => { const n = new UINode(runtimeNodeRecord(`${parent.path}/${name}`, name, opts), parent); n.doc = null; return n; };
    // LayoutSurface: found or created; stretched full, or the reference size scaled to fit at the surface anchor
    let surface = child("LayoutSurface");
    if (!surface) surface = make(root, "LayoutSurface");
    this.surface = surface;
    const back = child("Back"), talkRoot0 = child("TalkRoot");
    let viewport = child("CharacterViewport");
    if (!viewport) viewport = make(surface, "CharacterViewport",
      { min: pr.viewport.min, max: pr.viewport.max });
    for (const n of [back, viewport, talkRoot0]) if (n && n.parent !== surface) reparent(n, surface);
    // CharacterViewport after Back, or first
    const order = surface.children.filter((n) => n !== viewport);
    const bi = back ? order.indexOf(back) + 1 : 0;
    order.splice(bi, 0, viewport);
    surface.children = order;
    reparent(surface, root, 0);                                         // SetAsFirstSibling
    this.viewport = viewport; this.back = back;
    let talkRoot = talkRoot0;
    if (!talkRoot) talkRoot = make(surface, "TalkRoot", { min: DEFAULT_TALK_ROOT.min, max: DEFAULT_TALK_ROOT.max });
    this.talkRoot = talkRoot;
    // slots: roots with the normalized rect, images (RawImage + AspectRatioFitter EnvelopeParent, ratio 1), inactive
    this.slots = resolveSlots(pr).map((s, index) => {
      const r = s.rect;
      const slotRoot = viewport.children.find((c) => c.name === s.def.root)
        || make(viewport, s.def.root, { min: { x: r[0], y: r[1] }, max: { x: r[2], y: r[3] } });
      slotRoot.anchorMin = { x: r[0], y: r[1] }; slotRoot.anchorMax = { x: r[2], y: r[3] };
      slotRoot.anchoredPosition = { x: 0, y: 0 }; slotRoot.sizeDelta = { x: 0, y: 0 };
      const image = make(slotRoot, s.def.image, { active: false });
      image.rawImage = { m_Enabled: 1, color: { r: 1, g: 1, b: 1, a: 1 }, m_UVRect: { x: 0, y: 0, width: 1, height: 1 },
                         material: DEFAULT_UI_MATERIAL, texture: null };             // new RawImage: the default UI material
      return { index, positionType: s.positionType, def: s.def, root: slotRoot, image, character: null, targetName: null,
               fade: null, initialized: false };
    });
    setLastSibling(talkRoot);
    // the CanvasGroup of the presentation root (alpha 0, no raycasts) and the tap catcher (last sibling)
    root.canvasGroup = { alpha: 0, ignoreParentGroups: false };
    this.tap = make(root, "TapCatcher", { active: false });
    this.initialized = true;
  }

  // the layout steps a RectTransform pass cannot do (fitters and the component code that sizes from a parent rect);
  // returns true when a value changed and the layout must run again
  fit() {
    const pr = this.profile, before = JSON.stringify(this._fitState());
    const surface = this.surface, parent = surface.parent.rect;
    if (!(pr.referenceSize.x > 0) || !(pr.referenceSize.y > 0)) {
      surface.anchorMin = { x: 0, y: 0 }; surface.anchorMax = { x: 1, y: 1 };
      surface.anchoredPosition = { x: 0, y: 0 }; surface.sizeDelta = { x: 0, y: 0 };
    } else {
      const k = clamp(Math.min(parent.w / pr.referenceSize.x, parent.h / pr.referenceSize.y), F(0.01), 1);
      surface.anchorMin = { ...pr.anchor }; surface.anchorMax = { ...pr.anchor }; surface.pivot = { ...pr.anchor };
      surface.anchoredPosition = { x: 0, y: 0 };
      surface.sizeDelta = { x: F(pr.referenceSize.x * k), y: F(pr.referenceSize.y * k) };
    }
    if (this.viewport.rect) aspectFit(this.viewport, 3, pr.designAspect);
    const rr = this.root.rect;
    this.boost = rr && rr.h > 0 ? aspectScaleBoost(F(rr.w / rr.h), pr.designAspect) : 1;
    for (const s of this.slots) {
      if (s.root.rect) aspectFit(s.image, 4, 1);
      const k = F(pr.displayScale * this.boost);                      // ApplyImagePresentation (the offset is reset by
      s.image.localScale = { x: k, y: k };                              // the fitter's UpdateRect when the image activates)
    }
    if (this.window) this._applyTalkWindowLayout();
    return JSON.stringify(this._fitState()) !== before;
  }

  _fitState() {
    return [this.surface.sizeDelta, this.viewport.sizeDelta, this.slots.map((s) => [s.image.sizeDelta, s.image.localScale]),
            this.window ? [this.window.root.localScale] : null];
  }

  // ApplyTalkWindowLayout: centred in the talk root at 960 x 320, scaled to fit
  _applyTalkWindowLayout() {
    const w = this.window.root, tr = this.talkRoot.rect;
    const s = tr ? talkWindowScale(tr.w, tr.h) : 1;
    w.anchorMin = { x: 0.5, y: 0.5 }; w.anchorMax = { x: 0.5, y: 0.5 }; w.pivot = { x: 0.5, y: 0.5 };
    w.sizeDelta = { ...TALK_WINDOW_SIZE }; w.localScale = { x: s, y: s }; w.anchoredPosition = { x: 0, y: 0 };
  }

  // ------------------------------------------------------------------------------------------------ root
  // Show: raycasts on, talk window layout, the tap catcher active per SetAdvanceInputEnabled (last sibling); the first
  // show fades the root in (0 -> 1 over 0.2 s, OutQuad)
  show() {
    setActive(this.root, true);
    this.root.canvasGroup.blocksRaycasts = true;
    setActive(this.tap, this.advanceInputEnabled);
    setLastSibling(this.tap);
    if (this.shownOnce) return;
    this.shownOnce = true;
    const cg = this.root.canvasGroup;
    cg.alpha = 0;
    this._restartPresentationTween(new UITween(this.tweens, { duration: VIEW_FADE_DURATION, getFrom: () => cg.alpha, to: 1,
                                                              ease: EASE.OutQuad, apply: (v) => { cg.alpha = v; } }));
  }

  hide() {
    const cg = this.root.canvasGroup;
    this._restartPresentationTween(null);
    cg.alpha = 0; cg.blocksRaycasts = false;
    setActive(this.root, false);
  }

  _restartPresentationTween(t) {
    if (this.presentationTween) this.presentationTween.kill();
    this.presentationTween = t;
  }

  // FadeOutAndHideAsync: no raycasts; alpha <= 0 -> Hide; else DOFade(0, 0.2) InQuad, then Hide
  async fadeOutAndHide() {
    if (!this.initialized || !this.root.activeSelf) return;
    const cg = this.root.canvasGroup;
    cg.blocksRaycasts = false;
    if (cg.alpha <= 0) { this.hide(); return; }
    const t = new UITween(this.tweens, { duration: VIEW_FADE_DURATION, getFrom: () => cg.alpha, to: 0, ease: EASE.InQuad,
                                         apply: (v) => { cg.alpha = v; } });
    this._restartPresentationTween(t);
    await t.promise;
    this.hide();
  }

  setAdvanceInputEnabled(v) { this.advanceInputEnabled = !!v; setActive(this.tap, this.advanceInputEnabled && this.root.activeSelf); }
  setAdvanceProgressEnabled(v) { this.advanceProgressEnabled = !!v; if (!v) this.advanceRequested = false; }

  // OnTapped (TapCatcher Button.onClick): a request only while progress is enabled
  onTapped() {
    if (!this.tap.activeInHierarchy) return false;
    if (this.advanceProgressEnabled) this.advanceRequested = true;
    return true;
  }
  resetAdvanceRequest() { this.advanceRequested = false; }
  consumeAdvanceRequest() { const r = this.advanceRequested; this.advanceRequested = false; return r; }

  // ------------------------------------------------------------------------------------------------ talk window
  // AttachTalkWindow: the previous window's data moves over; the new one goes under the talk root, shown and refreshed
  attachTalkWindow(win) {
    let data = null;
    if (this.window && this.window !== win) {
      data = { speaker: this.window.speakerName };
      this.window.talk.hideTalk(0);
      setActive(this.window.root, false);
    }
    this.window = win;
    reparent(win.root, this.talkRoot);
    setActive(win.root, true);
    win.talk.refresh();
    if (data) win.setSpeakerName(data.speaker);
    this._applyTalkWindowLayout();
    setLastSibling(this.tap);
  }

  // HideTalkWindow: HideTalk(0) + UIPart.Hide
  hideTalkWindow() {
    if (!this.window) return;
    this.window.talk.hideTalk(0);
    setActive(this.window.root, false);
  }

  // ------------------------------------------------------------------------------------------------ slots
  slotByTargetName(name) { return this.slots.find((s) => s.targetName && s.targetName === name) || null; }
  slotByPositionType(pos) { return this.slots.find((s) => s.positionType === pos) || null; }
  // TryGetDefaultSlotIndex: the PositionType 5 slot, else slot 0
  defaultSlot() { return this.slotByPositionType(5) || this.slots[0] || null; }
  otherSlotsHaveCharacter(slot) { return this.slots.some((s) => s !== slot && s.character); }

  // Slot.Show (after EnsureInitialized): the previous controller of the slot is hidden; the image appears transparent
  // (colour (1, 1, 1, 0)) in the frame the character is set up; the capture camera activates
  setSlotCharacter(slot, name, ch) {
    slot.character = ch; slot.targetName = name;
    if (slot.fade) { slot.fade.kill(); slot.fade = null; }
    slot.image.rawImage.color = { r: 1, g: 1, b: 1, a: 0 };
    setActive(slot.image, true);
    slot.active = true;
  }

  // Slot.FadeInAsync(duration): DelayFrame(3); d <= 0 -> white; else Graphic.DOFade(1, d) (the default ease), white
  async fadeInSlot(slot, duration, loop) {
    await loop.delayFrame(3);
    const c = slot.image.rawImage.color;
    if (!(duration > 0)) { slot.image.rawImage.color = { r: 1, g: 1, b: 1, a: 1 }; return; }
    const t = slot.fade = new UITween(this.tweens, { duration, getFrom: () => slot.image.rawImage.color.a, to: 1,
      ease: this.dotween.defaultEaseType, apply: (v) => { slot.image.rawImage.color = { ...c, a: v }; } });
    await t.promise;
    if (slot.fade === t) slot.fade = null;
    slot.image.rawImage.color = { r: 1, g: 1, b: 1, a: 1 };
  }

  // Slot.Hide: the image is white and inactive, the capture camera off
  clearSlot(slot) {
    if (slot.fade) { slot.fade.kill(); slot.fade = null; }
    slot.character = null; slot.targetName = null;
    slot.image.rawImage.color = { r: 1, g: 1, b: 1, a: 1 };
    setActive(slot.image, false);
    slot.active = false;
  }
}

// The talk window of the simple player on StoryTalkWindow (the UIAdvTalkWindow behaviour shared with the story UI):
// the prefab UISimpleAdvTalkWindow references TalkArea, TalkText, SpeakerText and the Speaker plate, and no talk
// background, next indicator, auto or fast icon.
export class SimpleTalkWindow {
  constructor(doc, rootPath, { loop, tweens, language }) {
    const root = doc.node(rootPath), f = (rel) => root.find(rel);
    if (!root.rec.talkWindow) throw new UIError(`${rootPath}: no UIAdvTalkWindow record`);
    this.root = root;
    this.part = {
      window: root, background: null, talkArea: f("TalkArea"), talkText: f("TalkArea/Content/TextWindow/TalkText"),
      nextIndicator: null, autoIcon: null, fastIcon: null, speaker: f("TalkArea/Content/Speaker"),
      speakerText: f("TalkArea/Content/Speaker/Back/SpeakerText"),
    };
    this.loop = loop; this.tweens = tweens; this.language = language; this.doc = { dotween: doc.doc.dotween };
    this.setActive = setActive;
    this.talk = new StoryTalkWindow(this);
    this.speakerName = "";
    setActive(root, false);
  }

  setSpeakerName(name) { this.speakerName = name; this.talk.setSpeakerName(name); }
}
