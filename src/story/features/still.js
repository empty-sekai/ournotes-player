import { F } from "../../engine/core.js";
import { UIError } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { CanvasNode, CanvasPrefab, compOf } from "./canvas.js";
import { DT_PLUGIN, dtTo, storyDOTween } from "./dotween-core.js";
import { DOTweenAnimation, DOTweenSequenceComponent } from "./dotween-pro.js";
import { SCREEN_CANVAS_PATH, storyScreen, storyUIDoc } from "./screen.js";
import { ShakeTarget, shakes } from "./shake.js";
import { featureSlot, featureState } from "./state.js";

// Stills: AdvStillView on UIAdvWidget/StillCanvas and the AdvStill prefab instances of stills.json
// (AdvEpisodeResourceLoader.LoadStill: one instance per TargetAssetName, AdvStill.Init at load).
//
// AdvStill: _canvasGroup, _doTweenSequences (Fwk.Tween.DOTweenSequence). Init: inactive, CanvasGroup DOKill, alpha 0,
// StopStillAnimation. ShowStill(alpha, d, index): active, StopStillAnimation, PlayStillAnimation(index), SetAlpha.
// HideStill(d): SetAlpha(0, d), StopStillAnimation, inactive (a cancelled hide leaves it active). SetAlpha(a, d):
// CanvasGroup DOKill; DOFade(a, d) awaited when d > 0 (ToUniTask KillAndCancelAwait: a kill completes the await);
// then alpha = a. PlayStillAnimation(i): an empty array plays nothing, an index out of range warns, else
// _doTweenSequences[i].DOPlay(). StopStillAnimation: DOKill of every sequence. SetPlaybackSpeed: SetTimeScale of every
// sequence (ReapplyPlaybackSpeed; sequences created later start at the stored time scale).
// Instantiation: Awake of the DOTweenAnimations on active GameObjects (hierarchy and component order) creates their
// tweens paused; Init's deactivation disables the DOTweenSequences (OnDisable: DOKill), which kills the paused tweens of
// the animations their commands reference. Tweens of other animations stay paused until a callback plays them.
//
// AdvStillView (ui/ui.json record `stillView`): _overlay, _background (Awake: its alpha 0), _target. SetStill(s):
// UIAdvWidget.SuppressStillPostEffect, reparented under _target as its last sibling, localPosition 0, ApplyContainedScale
// (_target scale = min(view width / 1920, view height / 1080), also on every resize). FadeTo(a, d, isShow): hide ->
// _background DOFade(0) (not awaited); show with a == 0 -> _background DOFade(1) (not awaited); _overlay DOFade(a)
// awaited; then hide: _background alpha 0; a <= 0: _overlay alpha 0. UIAdvWidget.FadeToStill: show -> suppress the still
// post effect; hide -> restore it when the fade ends.
// Not modelled: the windowed preload / release of the loader (an unshown still released eight rows behind its last row
// and loaded again later starts from its prefab values; the window schedule is not in the story data): every still of
// the episode is loaded at the start and kept.

export const STILL_BASE_SIZE = Object.freeze({ x: 1920, y: 1080 });   // ScreenManager.BaseResolution (landscape)

// components a still prefab may carry beyond the ones read here (drawn or laid out by canvas.js)
const STILL_COMPONENTS = new Set(["RectTransform", "CanvasRenderer", "CanvasGroup", "Image", "AdvStill", "DOTweenAnimation",
  "DOTweenSequence", "AspectRatioFitter", "LayoutElement", "HorizontalLayoutGroup", "VerticalLayoutGroup", "ContentSizeFitter",
  "TextMeshProUGUI"]);

// AdvStill with its prefab instance
export class StillInstance {
  constructor(view, name, doc) {
    this.view = view; this.name = name;
    const prefab = this.prefab = new CanvasPrefab(doc.nodes, null, view.screen.canvas.still);
    this.root = prefab.root;
    const adv = compOf(doc.nodes[0], "AdvStill");
    if (!adv) throw new UIError(`still ${name}: no AdvStill on the root`);
    const gos = new WeakMap(), byRef = new Map(), abs = new Map();
    this.host = {
      mgr: view.mgr, random: featureState(view.ctx).random,
      node: (p) => prefab.node(p),
      go: (n) => { if (!gos.has(n)) gos.set(n, { gameObject: n.path }); return gos.get(n); },
      abs: (p) => abs.get(p) || [],
      componentOf: (r) => byRef.get(`${r.gameObject}\u0000${r.class || r.component}`) || null,
    };
    this.animations = []; this.sequenceComponents = [];
    for (const rec of doc.nodes) {
      const node = prefab.node(rec.path), list = [];
      for (const c of rec.components || []) {
        const cls = c.class || c.type;
        if (!STILL_COMPONENTS.has(cls)) throw new UIError(`still ${name}:${rec.path}: component ${cls} not implemented`);
        let a = null;
        if (cls === "DOTweenAnimation") { a = new DOTweenAnimation(this.host, node, c); this.animations.push(a); }
        else if (cls === "DOTweenSequence") { a = new DOTweenSequenceComponent(this.host, node, c); this.sequenceComponents.push(a); }
        if (!a) continue;
        list.push(a);
        byRef.set(`${rec.path}\u0000${cls}`, a);
      }
      if (list.length) abs.set(rec.path, list);
    }
    const cgNode = prefab.ref(adv._canvasGroup);
    if (!cgNode || !cgNode.canvasGroup) throw new UIError(`still ${name}: _canvasGroup missing`);
    this.cg = cgNode.canvasGroup;
    this.sequences = adv._doTweenSequences ? adv._doTweenSequences.map((r) => (r ? this.host.componentOf(r) : null)) : null;
    this.awoken = new Set();
    this.enabledSequences = new Set();
    this._activate();
    this.init();
  }

  // GameObject activation: Awake of animations reaching an active GameObject for the first time, OnEnable / OnDisable
  // of the sequences whose activity changes
  _activate() {
    for (const a of this.animations) if (!this.awoken.has(a) && a.node.activeInHierarchy) { this.awoken.add(a); a.awake(); }
    for (const s of this.sequenceComponents) {
      const on = s.enabled && s.node.activeInHierarchy;
      if (on && !this.enabledSequences.has(s)) this.enabledSequences.add(s);
      else if (!on && this.enabledSequences.has(s)) { this.enabledSequences.delete(s); s.onDisable(); }
    }
  }

  setActive(v) { this.root.activeSelf = !!v; this._activate(); }

  get isShowing() { return this.root.activeSelf; }

  _sequencesOrFail() {
    if (!this.sequences) throw new StoryCommandError(`still ${this.name}: no animation array`);
    return this.sequences;
  }

  stopAnimation() {
    for (const s of this._sequencesOrFail()) {
      if (!s) throw new StoryCommandError(`still ${this.name}: a missing animation in the array`);
      s.doKill();
    }
  }

  playAnimation(index) {
    const seqs = this._sequencesOrFail();
    if (!seqs.length) return;
    if (index < 0 || index >= seqs.length) {
      console.warn(`Cannot play still animation. Index ${index}, Length ${seqs.length}`);
      return;
    }
    if (!seqs[index]) throw new StoryCommandError(`still ${this.name}: a missing animation in the array`);
    seqs[index].doPlay();
  }

  init() {
    this.setActive(false);
    this.view.mgr.kill(this.cg);
    this.cg.alpha = 0;
    this.stopAnimation();
  }

  async setAlpha(alpha, duration, cancelled) {
    const mgr = this.view.mgr, cg = this.cg;
    alpha = F(alpha);
    mgr.kill(cg);
    if (duration > 0) {
      const t = dtTo(mgr, () => cg.alpha, (v) => { cg.alpha = v; }, alpha, duration, DT_PLUGIN.float).setTarget(cg);
      await mgr.toUniTask(t, cancelled);
    }
    cg.alpha = alpha;
  }

  async show(alpha, duration, index, cancelled) {
    this.setActive(true);
    this.stopAnimation();
    this.playAnimation(index);
    await this.setAlpha(alpha, duration, cancelled);
  }

  async hide(duration, cancelled) {
    await this.setAlpha(0, duration, cancelled);
    this.stopAnimation();
    this.setActive(false);
  }

  setPlaybackSpeed(rate) { for (const s of this.sequences || []) if (s) s.setTimeScale(rate); }

  // OnDestroy (unload): CanvasGroup DOKill, StopStillAnimation
  dispose() {
    this.view.mgr.kill(this.cg);
    for (const s of this.sequences || []) if (s) s.doKill();
  }

  snapshot() {
    return [this.name, this.isShowing, this.cg.alpha,
            this.sequenceComponents.map((s) => (s.sequence ? [s.sequence.position, s.sequence.completedLoops, s.sequence.isPlaying] : null)),
            this.animations.map((a) => (a.tween ? [a.tween.position, a.tween.isPlaying] : null))];
  }
}

// AdvStillView and the loader's still map
export class StillView {
  constructor(ctx) {
    this.ctx = ctx;
    this.screen = storyScreen(ctx);
    this.mgr = storyDOTween(ctx);
    const { doc, dir } = storyUIDoc(ctx), canvas = this.screen.canvas.still, base = SCREEN_CANVAS_PATH.still;
    const nodes = new Map();
    for (const rec of doc.nodes) {
      if (!rec.path.startsWith(`${base}/`)) continue;
      const parentPath = rec.path.slice(0, rec.path.lastIndexOf("/"));
      const parent = parentPath === base ? canvas.root : nodes.get(parentPath);
      if (!parent) throw new UIError(`${rec.path}: parent not in the story UI data`);
      const n = new CanvasNode(rec, parent);
      if (rec.image) {
        n.image = { ...rec.image, m_Enabled: !!rec.image.m_Enabled, m_Color: { ...rec.image.m_Color },
                    spriteObj: canvas.uiSprite(doc, rec.image.sprite, dir), material: null };
        if (rec.image.material) throw new UIError(`${rec.path}: image material not implemented`);
      }
      if (rec.rawImage || rec.text || rec.animator) throw new UIError(`${rec.path}: component not implemented on the still canvas`);
      nodes.set(rec.path, n);
    }
    const viewRec = doc.nodes.find((r) => r.stillView);
    if (!viewRec || !nodes.has(viewRec.path)) throw new StoryCommandError("the story UI data has no AdvStillView");
    const sv = viewRec.stillView, get = (p) => {
      const n = nodes.get(p);
      if (!n) throw new StoryCommandError(`AdvStillView: ${p} missing`);
      return n;
    };
    this.node = get(viewRec.path);
    this.overlay = get(sv._overlay); this.background = get(sv._background); this.target = get(sv._target);
    if (!this.overlay.image || !this.background.image) throw new StoryCommandError("AdvStillView: _overlay / _background are not images");
    // Awake: the background colour's alpha 0
    this.background.image.m_Color = { ...this.background.image.m_Color, a: 0 };
    // ApplyContainedScale on every layout (OnRectTransformDimensionsChange): the view rect is the target's parent rect
    this.target.fitter = (n, pr) => {
      if (pr.w <= 0 || pr.h <= 0) return;
      const s = F(Math.min(F(pr.w / STILL_BASE_SIZE.x), F(pr.h / STILL_BASE_SIZE.y)));
      n.localScale = { x: s, y: s }; n.localScaleZ = 1;
    };
    // AdvStillView.Shake / StopShake: DOShakePosition on _target's world position (the shake strength is in world
    // units), StopShake puts anchoredPosition back to 0 and keeps the z. World offsets are local ones times the lossy
    // scale of the target's parent (the camera canvas' scale times the scales below it).
    const t = this.target;
    const unit = () => {
      let s = { x: 1, y: 1, z: 1 };
      for (let n = t.parent; n && n.parent; n = n.parent) s = { x: F(s.x * n.localScale.x), y: F(s.y * n.localScale.y), z: F(s.z * n.localScaleZ) };
      const w = this.screen.worldPerCanvasUnit("still");
      return { x: F(s.x * w), y: F(s.y * w), z: F(s.z * w) };
    };
    shakes(ctx).still = new ShakeTarget(
      () => { const u = unit(); return { x: F(t.anchoredPosition.x * u.x), y: F(t.anchoredPosition.y * u.y), z: F(t.localZ * u.z) }; },
      (v) => { const u = unit(); t.anchoredPosition = { x: F(v.x / u.x), y: F(v.y / u.y) }; t.localZ = F(v.z / u.z); },
      () => { const u = unit(); return { x: 0, y: 0, z: F(t.localZ * u.z) }; });
    this.stills = new Map();                  // TargetAssetName -> StillInstance
    this.list = [];                           // Loader.Stills
    this.postEffectSuppressed = false;        // VideoAndStillCamera volume mask 0
  }

  // AdvEpisodeResourceLoader.LoadStill for every Still row with a name (IgnoreData rows are not preloaded)
  load(doc) {
    for (const c of this.ctx.episode.commands) {
      if (c.cmd !== "Still" || c.IgnoreData) continue;
      const name = c.TargetAssetName ?? "";
      if (!name.trim() || this.stills.has(name)) continue;
      const d = doc.stills[name];
      if (!d) throw new StoryCommandError(`still ${name} is not in the story data`);
      const s = new StillInstance(this, name, d);
      this.stills.set(name, s);
      this.list.push(s);
    }
  }

  loaded(name) { return this.stills.get(name ?? "") || null; }

  showingStills() { return this.list.filter((s) => s.isShowing); }

  // UIAdvWidget.SetStill -> AdvStillView.SetStill
  setStill(still) {
    this.postEffectSuppressed = true;
    if (!still) return;
    still.root.setParentLast(this.target);
    still.root.zeroLocalPosition();
  }

  // AdvStillView.FadeTo
  async fadeTo(alpha, duration, isShow, cancelled) {
    const mgr = this.mgr, bg = this.background.image, ov = this.overlay.image;
    const fade = (img, to) => dtTo(mgr, () => ({ ...img.m_Color }), (v) => { img.m_Color = { ...v }; }, F(to), duration,
                                   DT_PLUGIN.alpha).setTarget(img);
    if (!isShow) mgr.toUniTask(fade(bg, 0), cancelled).catch(() => {});
    else if (alpha === 0) mgr.toUniTask(fade(bg, 1), cancelled).catch(() => {});
    await mgr.toUniTask(fade(ov, alpha), cancelled);
    if (!isShow) bg.m_Color = { ...bg.m_Color, a: 0 };
    if (alpha <= 0) ov.m_Color = { ...ov.m_Color, a: 0 };
  }

  // UIAdvWidget.FadeToStill
  async fadeToStill(alpha, duration, isShow, cancelled) {
    if (isShow) this.postEffectSuppressed = true;
    try { await this.fadeTo(alpha, duration, isShow, cancelled); }
    finally { if (!isShow) this.postEffectSuppressed = false; }
  }

  setPlaybackSpeed(rate) { for (const s of this.list) s.setPlaybackSpeed(rate); }

  dispose() { for (const s of this.list) s.dispose(); }

  snapshot() {
    return { stills: this.list.map((s) => s.snapshot()), overlay: this.overlay.image.m_Color.a,
             background: this.background.image.m_Color.a, suppressed: this.postEffectSuppressed,
             order: this.target.children.map((n) => n.name) };
  }
}

export const stillView = (ctx) => featureSlot(ctx, "still", () => new StillView(ctx));

export const loadStills = (ctx) => {
  const uses = ctx.episode.commands.some((c) => c.cmd === "Still" && !c.IgnoreData && (c.TargetAssetName ?? "").trim());
  if (!uses) return null;
  const file = ctx.story && ctx.story.stills;
  if (!file) throw new StoryCommandError("the story data has no stills.json");
  const v = stillView(ctx);
  v.load(ctx.assets.json(file));
  const s = featureState(ctx);
  s.disposers.push(() => v.dispose());
  (s.snapshots = s.snapshots || []).push(() => ({ still: v.snapshot() }));
  (s.speedListeners = s.speedListeners || []).push((rate) => v.setPlaybackSpeed(rate));
  return v;
};
