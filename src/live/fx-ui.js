import { AnimClip, AnimController, Animator } from "../engine/anim.js";
import { F } from "../engine/core.js";
import { ShaderLib } from "../engine/glsl.js";
import { GLTex } from "../engine/texture.js";
import { DOTRunner, DOTSequence, UIAffine, UIDraw, UIError, UIImage, UILayout, UINode, UISprite, UI_CLIP_TARGET, dotFloat, dotPunch, uiCanvasSize } from "../engine/ugui.js";

// Live UI hit feedback on LiveUICanvas (LiveUIFx): the judgement text and the combo counter, as a uGUI subset
// (engine/ugui.js) built from the scene and prefab records.
//
// Game code followed:
//   LiveJudgementView.Initialize (sprite dictionary 5,4,3,2,1,6 <- Perfect..Just of LiveJudgementSpriteAsset),
//   CreateJudgeResultView (Instantiate(prefab, effect_root) then Initialize), ShowJudgement,
//   ShowJudgementCenter, HasComboResetJudgement, SetScale;
//   UILiveNoteJudgeEffectView.Initialize, CreateTween, Show, <Initialize>b__30_0/1;
//   Image.SetNativeSize (virtual, called by UILiveNoteJudgeEffectView.Initialize, as is SetAllDirty), Image.pixelsPerUnit;
//   UIComboCounterView .ctor, Awake, Initialize, UpdateView,
//   ApplyComboCount, GetTierSprites, SetDigit, ApplyGlow,
//   CalculateGlowWidth, NumberToCharArrayExtensions.GetDigitsSize, .cctor (StringToHash Add/Init);
//   LiveCanvasOrderInLayerSetter.Awake + LiveOrderInLayerUtility.GetOrderInLayer (100 -> 10000);
//   DOTween: the DOTween model in engine/ugui.js (Punch, SetPunch, Vector3ArrayPlugin and the Sequence cycle follow
//   the game's DOTween build; the rest follows DOTween's documented behaviour).
// Data: livescene/scene.json (scene.nodes under Live/LiveUICanvas), livenotes/notes.json (prefabs.judge_effect_view,
// controllers / clips of EmbLive/Animation/Combo/*, assets Live/UiSpriteAssets/{LiveJudgementSpriteAsset,
// LiveComboSpriteAsset} with their inline sprite records), textures under livenotes/textures, UI/Default under
// livenotes/shaders.
//
// Frame: update(fr) in the update phase (LiveUIView.UpdateLiveSimulateFrame: ShowJudgement, then
// UIComboCounterView.UpdateView), tweens(dt) in the DOTween phase, animate(dt) with the Animators, submit(renderer) in
// the render hook. Everything but the GL draw runs with gl = null.

export const LIVEUI = {
  CANVAS: "Live/LiveUICanvas",
  COMBO: "Live/LiveUICanvas/UISafeArea/ContentArea/UILiveCombo",
  JUDGEMENT: "Live/LiveUICanvas/UILiveJudgement",
  PREFAB: "UILiveNoteJudgeEffectView",
  JUDGEMENT_SPRITES: "Live/UiSpriteAssets/LiveJudgementSpriteAsset",
  COMBO_SPRITES: "Live/UiSpriteAssets/LiveComboSpriteAsset",
  COMBO_CONTROLLER: "EmbLive/Animation/Combo/UILiveCombo",
  SHADER: "UI/Default",
  // UILiveNoteJudgeEffectView.Initialize: _judgementImages[i] <-> judgement KEYS[i] (static array)
  JUDGE_KEYS: [5, 4, 3, 2, 1, 6],
  // ShowJudgementCenter priority for Good..Just (static table); Miss 1, Bad 2 are inline
  PRIORITY_3_6: [3, 5, 10, 20],
};

export const liveComp = (rec, cls) => (rec.components || []).find((c) => (c.class || c.type) === cls) || null;

// ------------------------------------------------------------------- scene / prefab records -> UINode
// The fields UINode reads (path, name, active, rect, localRotation, localScale, canvasGroup) plus the components
// this module uses; graphics other than Image / TextMeshProUGUI do not occur in the subset (checked).
export class LiveUITree {
  constructor(refPPU) {
    this.refPPU = refPPU;
    this.nodes = new Map();
    this.sprites = new Map();             // "<sprite>@<texture path>" -> UISprite
    this.textures = new Map();            // texture path (relative to livenotes/) -> exported descriptor, loaded by load()
  }

  add(rec, path, parent) {
    const cg = liveComp(rec, "CanvasGroup");
    const n = new UINode({ path, name: rec.name, active: rec.active, rect: rec.rect, localRotation: rec.localRotation,
                              localScale: rec.localScale, canvasGroup: cg }, parent);
    n.localScaleZ = rec.localScale.z;
    n.components = rec.components || [];
    const im = liveComp(rec, "Image");
    if (im) {
      if (im.m_Material) throw new UIError(`${path}: Image material ${JSON.stringify(im.m_Material)} not implemented`);
      n.image = { m_Enabled: !!im.m_Enabled, m_Color: im.m_Color, m_Type: im.m_Type, m_PreserveAspect: im.m_PreserveAspect,
                  m_FillCenter: im.m_FillCenter, m_PixelsPerUnitMultiplier: im.m_PixelsPerUnitMultiplier,
                  m_UseSpriteMesh: im.m_UseSpriteMesh, spriteObj: im.m_Sprite ? this.sprite(im.m_Sprite) : null };
    }
    const tmp = liveComp(rec, "TextMeshProUGUI");
    if (tmp) n.tmp = { m_Enabled: !!tmp.m_Enabled };
    for (const cls of ["HorizontalLayoutGroup", "VerticalLayoutGroup"]) {
      const lg = liveComp(rec, cls);
      if (lg && lg.m_Enabled) n.layoutGroup = { ...lg, class: cls };
    }
    const csf = liveComp(rec, "ContentSizeFitter");
    if (csf && csf.m_Enabled) n.contentSizeFitter = csf;
    const le = liveComp(rec, "LayoutElement");
    if (le && le.m_Enabled) n.layoutElement = le;
    this.nodes.set(path, n);
    return n;
  }

  node(path) {
    const n = this.nodes.get(path);
    if (!n) throw new UIError(`live ui node not built: ${path}`);
    return n;
  }

  // exported sprite record (inline in components and sprite assets) -> UISprite. load = true registers its texture
  // for LiveUIFx.load(): only the sprite assets' sprites (livenotes/textures); sprites of scene / prefab image records
  // are either replaced before they can draw or sit under disabled images / zero-alpha groups (a draw of an unloaded
  // texture raises).
  sprite(s, load = false) {
    if (!s) return null;
    const tex = s.texture;
    const key = `${s.sprite}@${tex.texture}`;
    if (!this.sprites.has(key)) {
      if (s.downscaleMultiplier !== undefined && s.downscaleMultiplier !== 1)
        throw new UIError(`sprite ${s.sprite}: atlas variant scale ${s.downscaleMultiplier}`);
      this.sprites.set(key, new UISprite(s.sprite, { rect: s.rect, border: s.border, pixelsPerUnit: s.pixelsToUnits,
        pivot: s.pivot, textureRect: s.textureRect, textureRectOffset: s.textureRectOffset },
      { width: tex.width, height: tex.height, name: tex.texture }));
    }
    if (load) this.textures.set(tex.texture, tex);
    return this.sprites.get(key);
  }

  // GameObjectExtension.SetActiveFast: no-op when activeSelf already equals v
  setActive(n, v) { n.activeSelf = !!v; }

  // Image.SetNativeSize: sizeDelta = sprite rect / pixelsPerUnit, anchorMax = anchorMin;
  // pixelsPerUnit = sprite.pixelsPerUnit / canvas.referencePixelsPerUnit.
  // ENGINE: Canvas.referencePixelsPerUnit of the nested UILiveJudgement canvas is native; taken as 100.
  // (The root CanvasScaler value and the Canvas default are both 100, as is the Image's default without a canvas.)
  setNativeSize(n) {
    const sp = n.image.spriteObj;
    if (!sp) return;
    const ppu = F(sp.pixelsPerUnit / this.refPPU);
    n.anchorMax = { ...n.anchorMin };
    n.sizeDelta = { x: F(sp.rect.width / ppu), y: F(sp.rect.height / ppu) };
  }
};

// ------------------------------------------------------------------- UILiveNoteJudgeEffectView
export class LiveJudgeEffectView {
  // root: the instance's UINode; comp: its UILiveNoteJudgeEffectView record; at(prefabPath) -> instance node
  constructor(tree, root, comp, at, sprites, spriteAsset, showDuration, runner) {
    this.tree = tree; this.root = root; this.runner = runner;
    this.images = comp._judgementImages.map((r) => at(r.gameObject));
    this.groups = comp._judgementImageCanvasGroups.map((r) => at(r.gameObject));
    for (const g of this.groups) if (!g.canvasGroup) throw new UIError(`${g.path}: no CanvasGroup`);
    this.laneCenterIndex = 0; this.isActive = false;
    this.currentMainTween = null;
    this.mainTweens = new Map();
    this.showDuration = F(showDuration);
    // Initialize (isJudgeOffsetMsDisplay false with default options; the localized offset format is unused)
    const setSprite = (n, s) => { n.image.spriteObj = s ? tree.sprite(s) : null; };
    setSprite(at(comp._fastOffsetImage.gameObject), spriteAsset.FastSprite);
    setSprite(at(comp._lateOffsetImage.gameObject), spriteAsset.LateSprite);
    LIVEUI.JUDGE_KEYS.forEach((key, i) => {
      setSprite(this.images[i], sprites.get(key));
      tree.setNativeSize(this.images[i]);
      this.groups[i].canvasGroup.alpha = 0;
      const tw = this.createTween(this.groups[i]);
      tw.onComplete = () => { this.isActive = false; };                      // <Initialize>b__30_1
      this.mainTweens.set(key, tw);
    });
    for (const f of ["_fastCanvasGroup", "_lateCanvasGroup", "_assistCanvasGroup", "_noneCanvasGroup"]) at(comp[f].gameObject).canvasGroup.alpha = 0;
    for (const f of ["_fastOffsetText", "_lateOffsetText", "_noneOffsetText", "_fastOffsetImage", "_lateOffsetImage"])
      tree.setActive(at(comp[f].gameObject), false);
    // UIGekisouJudgementView.Initialize (gekisou sprites) is not modelled: SetActive(false) sets its
    // CanvasGroup alpha 0, so nothing under it draws. The sub tweens (fast / late / none / assist / gekisou) are created
    // by Initialize but only restarted by ShowSubTiming / ShowSubAssist / ShowGekisou, never reached with default options.
    const gk = at(comp._gekisouJudgementView.gameObject), gkc = liveComp(gk, "UIGekisouJudgementView");
    at(gkc._canvasGroup.gameObject).canvasGroup.alpha = 0;
  }

  // CreateTween: Sequence Append(DOFade(cg, 1, 0)); Join(DOPunchScale(cg.transform, Vector3.one * 0.2,
  // showDuration * 0.5, vibrato 1, elasticity 1).SetEase(OutBack 27)); AppendInterval(showDuration * 0.5);
  // Append(DOFade(cg, 0, 0)); SetAutoKill(false); SetLink(gameObject); Pause(). SetPunch replaces the OutBack by OutQuad
  // when the punch starts up (DOTween model in engine/ugui.js), so OutBack is never evaluated.
  createTween(n) {
    const cg = n.canvasGroup;
    const fade = (to) => dotFloat(() => cg.alpha, (v) => { cg.alpha = v; }, to, 0);
    const k = F(F(1) * F(0.2));
    const punch = dotPunch(() => ({ x: n.localScale.x, y: n.localScale.y, z: n.localScaleZ }),
                              (v) => { n.localScale.x = v.x; n.localScale.y = v.y; n.localScaleZ = v.z; },
                              { x: k, y: k, z: k }, F(this.showDuration * 0.5), 1, 1);
    punch.ease = 27;                                                         // SetEase(0x1b)
    const s = new DOTSequence(this.runner);
    s.append(fade(1)).join(punch).appendInterval(F(this.showDuration * 0.5)).append(fade(0));
    s.autoKill = false;
    return s.pause();
  }

  // Show: complete the current main tween, anchoredPosition, restart this judgement's sequence
  show(laneCenterIndex, anchoredPos, judgement) {
    if (this.currentMainTween) this.currentMainTween.complete();
    this.laneCenterIndex = laneCenterIndex;
    this.isActive = true;
    this.root.anchoredPosition = { x: anchoredPos.x, y: anchoredPos.y };
    const tw = this.mainTweens.get(judgement);
    if (!tw) throw new UIError(`judgement ${judgement}: no main tween`);           // Dictionary indexer throws too
    this.currentMainTween = tw;
    tw.restart();
  }
};

// ------------------------------------------------------------------- LiveJudgementView (center mode)
export class LiveJudgementViewCenter {
  // positionType: JudgeResultPositionType (option 103): 0 Center, 2 None (1 Lane is not reproduced)
  constructor(comp, view, positionType = 0) {
    if (positionType !== 0 && positionType !== 2) throw new UIError(`JudgeResultPositionType ${positionType} not implemented`);
    this.center = { x: comp._centerAnchoredPosition.x, y: comp._centerAnchoredPosition.y };
    this.view = view;
    this.showResult = positionType !== 2;  // IsShowJudgeResult: JudgeResultPositionType != 2
    this.shows = [];                      // judgements passed to Show this frame (for checks)
  }

  // ShowJudgement: JudgeResultPositionType 103 != 1 -> ShowJudgementCenter.
  // judged = [{judgement, note}] in GetCurrentFrameJudgementNoteIdList order.
  // gekisou: ResolveGekisouMission reads the gekisou frame result, absent in a normal live; mission 0 is assumed, so
  // SetScale writes Vector3.one (UILiveJudgement's scale is already one) and ShowGekisou is not reached.
  // sub lines: IsExecSubTweenJudgement is false with default options (Fast/Slow 100, PerfectFastSlow 101,
  // JudgeOffsetMs 102 off) and the assist bit of ILiveNoteParameter is not in the chart data
  // (no assist notes in a normal chart), so ShowSubTiming / ShowSubAssist are not reached.
  showJudgement(judged) {
    this.shows = [];
    const js = judged.map((j) => j.judgement);
    if (!js.some((j) => j !== 0 && j !== 7)) return;                       // Wait 0 / Pass 7 only
    const comboReset = js.some((j) => j === 1 || j === 2);                  // HasComboResetJudgement: Miss / Bad
    if (!this.showResult) return;                                           // None: returns before ResolveSingleView
    let best = -1;
    for (const j of js) {
      let p;
      if (j === 0 || j === 7) continue;
      if (j === 1) p = 1;
      else if (j === 2) p = 2;
      else {
        if (comboReset) continue;
        p = j - 3 >= 0 && j - 3 < 4 ? LIVEUI.PRIORITY_3_6[j - 3] : 0;
      }
      if (best < p) { best = p; this.view.show(0, this.center, j); this.shows.push(j); }
    }
  }
};

// ------------------------------------------------------------------- UIComboCounterView
export class LiveComboCounter {
  constructor(tree, comp, spriteAsset, animator) {
    const N = (r) => tree.node(r.gameObject);
    this.tree = tree; this.animator = animator; this.spriteAsset = null;
    this.title = N(comp._titleImage); this.glow = N(comp._glowImage);
    this.layoutGroupNode = N(comp._layoutGroup);
    this.digits = ["one", "two", "three", "four"].map((d) => ({
      frame: N(comp[`_${d}DigitFrame`]), base: N(comp[`_${d}DigitBaseImage`]), fill: N(comp[`_${d}DigitFillImage`]) }));
    // .ctor (_digitWidth / _glowWidthMargin are serialized, same values), continuation true
    this.digitWidth = F(comp._digitWidth); this.glowWidthMargin = F(comp._glowWidthMargin);
    this.currentCombo = -1; this.currentTier = 0; this.appliedGlowDigitCount = -1;
    this.isAllPerfect = false; this.isFullCombo = false; this.isContinuationEffectDisplay = true;
    this.pendingSprites = spriteAsset;
    this.triggers = [];                   // animator triggers set (for checks)
  }

  awake() { this.updateView(0, true, true); }                              // Awake

  // Initialize: Animator.speed 1, continuation = IReadOnlyLiveViewSettings slot 20 (ContinuationEffect
  // Display 208, default true), sprite asset, UpdateView(0, false, false)
  initialize(continuation = true) {
    this.animator.speed = 1;
    this.isContinuationEffectDisplay = continuation;
    this.spriteAsset = this.pendingSprites;
    this.updateView(0, false, false);
  }

  _trigger(name) { this.animator.setTrigger(name); this.triggers.push(name); }

  // UpdateView
  updateView(combo, isAllPerfect, isFullCombo) {
    const prev = this.currentCombo;
    const t = isAllPerfect ? 2 : (isFullCombo ? 1 : 0);
    this.isAllPerfect = isAllPerfect; this.isFullCombo = isFullCombo;
    const tier = this.isContinuationEffectDisplay ? t : 0;
    if (prev === combo && this.currentTier === tier) return;
    this.currentCombo = combo; this.currentTier = tier;
    if (combo < 1) { this._trigger("Init"); return; }
    this.applyComboCount(combo, tier);
    if (prev === combo) return;
    this._trigger("Add");
  }

  // GetTierSprites: 1 FullCombo, 2 AllPerfect, else Normal
  tierSprites(tier) {
    const a = this.spriteAsset;
    return tier === 1 ? a.FullComboSprites : tier === 2 ? a.AllPerfectSprites : a.NormalSprites;
  }

  // ApplyComboCount
  applyComboCount(combo, tier) {
    if (!this.spriteAsset) return;
    const ts = this.tierSprites(tier);
    if (!ts) return;
    const n = digitsSize(combo);
    this.title.image.spriteObj = this.tree.sprite(ts.TitleSprite);
    const place = [1, 10, 100, 1000];
    this.digits.forEach((d, k) => this.setDigit(d, n < k + 1, Math.trunc(combo / place[k]) % 10, ts));
    this.applyGlow(n, ts);
  }

  // SetDigit: frame inactive for unused places, else active with base / fill sprites of the digit
  setDigit(d, disabled, number, ts) {
    if (disabled) { this.tree.setActive(d.frame, false); return; }
    this.tree.setActive(d.frame, true);
    const pick = (arr) => (number > -1 && arr && number < arr.length ? arr[number] : null);
    d.base.image.spriteObj = this.tree.sprite(pick(ts.BaseDigitSprites));
    d.fill.image.spriteObj = this.tree.sprite(pick(ts.FillDigitSprites));
  }

  // ApplyGlow: no glow sprite -> glow inactive, applied count -1; else active, sprite, and the width only
  // when the digit count changed
  applyGlow(n, ts) {
    if (!ts.GlowSprite) { this.tree.setActive(this.glow, false); this.appliedGlowDigitCount = -1; return; }
    this.tree.setActive(this.glow, true);
    this.glow.image.spriteObj = this.tree.sprite(ts.GlowSprite);
    if (this.appliedGlowDigitCount === n) return;
    this.appliedGlowDigitCount = n;
    this.glow.sizeDelta = { x: this.calculateGlowWidth(n), y: this.glow.sizeDelta.y };
  }

  // CalculateGlowWidth: digitWidth * n + layoutGroup.spacing * (n - 1) + glowWidthMargin * 2
  calculateGlowWidth(n) {
    const sp = this.layoutGroupNode.layoutGroup.m_Spacing;
    return F(F(F(this.digitWidth * n) + F(sp * (n - 1))) + F(this.glowWidthMargin * 2));
  }
};

// NumberToCharArrayExtensions.GetDigitsSize (decimal digits of |x|, 1 for 0)
export const digitsSize = (x) => { const a = Math.abs(x); let n = 1; for (let p = 10; a >= p && n < 10; p *= 10) n++; return n; };

// ------------------------------------------------------------------- the live UI canvas subset
export class LiveUIFx {
  // opts.preroll (default true): run the combo Animator through the Init cross-fade that Awake / Initialize start at
  // load. The number of frames between those calls and the first shown frame is load-time dependent; the fade
  // (0.25 s) is complete long before the intro timeline, so the settled state is taken.
  // ENGINE: Mecanim transition interruption is native; the Animator (engine/anim.js) checks no transition during a cross-fade.
  // (Only matters if Init / Add arrive inside a running Init fade, which auto play at Perfect never does.)
  // settings: the live settings (settings.js) read by LiveUIView.Initialize (ComboCountDisplay 206,
  // ContinuationEffectDisplay 208, JudgeResultPositionType 103); absent: the defaults.
  constructor(gl, { scene, notes, settings = null }, opts = {}) {
    this.gl = gl;
    const opt = (k, d) => (settings && settings[k] !== undefined ? settings[k] : d);
    const recs = new Map(scene.scene.nodes.map((r) => [r.path, r]));
    const rec = (p) => { const r = recs.get(p); if (!r) throw new UIError(`scene node missing: ${p}`); return r; };
    const canvasRec = rec(LIVEUI.CANVAS);
    const canvas = liveComp(canvasRec, "Canvas"), scaler = liveComp(canvasRec, "CanvasScaler");
    if (!canvas || canvas.m_RenderMode !== 1 || canvas.m_PixelPerfect || !canvas.m_Camera || canvas.m_Camera.gameObject !== "Live/LiveMainCamera")
      throw new UIError("LiveUICanvas: not a ScreenSpaceCamera canvas on LiveMainCamera");
    if (!scaler || !scaler.m_Enabled || scaler.m_UiScaleMode !== 1 || scaler.m_ScreenMatchMode !== 1)
      throw new UIError("LiveUICanvas: CanvasScaler is not ScaleWithScreenSize / Expand");
    this.scaler = scaler;
    // LiveCanvasOrderInLayerSetter.Awake: sortingOrder = GetOrderInLayer(_orderInLayer 100) + _offset = 10000 (the
    // serialized m_SortingOrder is the same)
    const ol = liveComp(canvasRec, "LiveCanvasOrderInLayerSetter");
    if (!ol || ol._orderInLayer !== 100) throw new UIError("LiveUICanvas: order-in-layer setter differs");
    this.sortingOrder = 10000 + ol._offset;
    this.planeDistance = canvas.m_PlaneDistance;
    const tree = this.tree = new LiveUITree(scaler.m_ReferencePixelsPerUnit);
    // subset: the canvas, the combo counter's chain and subtree, the judgement view and its effect_root
    // UISafeArea (flexible margin (0,0,0,40)) keeps ContentArea's serialized rect: the player has no device safe
    // area, and the serialized offsets (bottom 40, top 0) are that margin; UISafeAreaGlobalSettings overrides not read.
    const want = (p) => p === LIVEUI.CANVAS || p === `${LIVEUI.CANVAS}/UISafeArea` || p === `${LIVEUI.CANVAS}/UISafeArea/ContentArea` ||
      p === LIVEUI.COMBO || p.startsWith(`${LIVEUI.COMBO}/`) || p === LIVEUI.JUDGEMENT || p.startsWith(`${LIVEUI.JUDGEMENT}/`);
    for (const r of scene.scene.nodes) {           // hierarchy order (parents first, siblings in order)
      if (!want(r.path)) continue;
      const pp = r.path.slice(0, r.path.lastIndexOf("/"));
      tree.add(r, r.path, r.path === LIVEUI.CANVAS ? null : tree.node(pp));
    }
    this.root = tree.node(LIVEUI.CANVAS);

    // judgement: LiveJudgementView.Initialize / CreateJudgeResultView (one pooled instance under effect_root,
    // Instantiate(prefab, parent) keeps the prefab's local RectTransform)
    const jv = liveComp(rec(LIVEUI.JUDGEMENT), "LiveJudgementView");
    const parentPath = jv._judgementEffectParent.transform;
    const prefab = notes.prefabs.judge_effect_view;
    if (prefab.nodes[0].path !== LIVEUI.PREFAB) throw new UIError("judge effect prefab root differs");
    const inst = (p) => `${parentPath}/${p}`;
    for (const r of prefab.nodes) {
      const pp = r.path.includes("/") ? inst(r.path.slice(0, r.path.lastIndexOf("/"))) : parentPath;
      tree.add(r, inst(r.path), tree.node(pp));
    }
    const jsa = notes.assets[LIVEUI.JUDGEMENT_SPRITES];
    if (!jsa) throw new UIError(`asset missing: ${LIVEUI.JUDGEMENT_SPRITES}`);
    const judgeSprites = new Map([[5, jsa.PerfectSprite], [4, jsa.GreatSprite], [3, jsa.GoodSprite], [2, jsa.BadSprite],
                                  [1, jsa.MissSprite], [6, jsa.JustSprite]]);
    for (const s of judgeSprites.values()) tree.sprite(s, true);
    this.dotween = new DOTRunner();
    const effComp = liveComp(prefab.nodes[0], "UILiveNoteJudgeEffectView");
    this.effectView = new LiveJudgeEffectView(tree, tree.node(inst(LIVEUI.PREFAB)), effComp, (p) => tree.node(inst(p)),
                                                 judgeSprites, jsa, jv._showDuration, this.dotween);
    this.judgement = new LiveJudgementViewCenter(jv, this.effectView, opt("JudgeResultPositionType", 0));

    // combo: Animator UILiveCombo on UIComboCounterView's GameObject
    const comboNode = tree.node(LIVEUI.COMBO), comboRec = rec(LIVEUI.COMBO);
    const an = liveComp(comboRec, "Animator");
    const ctrlKey = notes.assets[LIVEUI.COMBO_CONTROLLER] && notes.assets[LIVEUI.COMBO_CONTROLLER].controller;
    const raw = ctrlKey && notes.controllers[ctrlKey];
    if (!an || !raw || raw.name !== an.m_Controller.name) throw new UIError("UILiveCombo: controller not exported");
    if (!an.m_Enabled || an.m_UpdateMode !== 0 || an.m_CullingMode !== 0 || an.m_KeepAnimatorStateOnDisable || an.m_ApplyRootMotion)
      throw new UIError("UILiveCombo: Animator settings outside the implemented subset");
    const ctrl = AnimController.fromMecanim(raw, (key) => {
      if (!notes.clips[key]) throw new UIError(`clip ${key} not exported`);
      return AnimClip.fromMecanim(notes.clips[key], key);
    });
    this.animator = new Animator(ctrl, (b) => LiveUIFx.bind(comboNode, b), "UILiveCombo");
    const csa = notes.assets[LIVEUI.COMBO_SPRITES];
    if (!csa) throw new UIError(`asset missing: ${LIVEUI.COMBO_SPRITES}`);
    for (const ts of [csa.NormalSprites, csa.FullComboSprites, csa.AllPerfectSprites])
      for (const s of [ts.TitleSprite, ts.GlowSprite, ...ts.BaseDigitSprites, ...ts.FillDigitSprites]) if (s) tree.sprite(s, true);
    this.combo = new LiveComboCounter(tree, liveComp(comboRec, "UIComboCounterView"), csa, this.animator);
    this.combo.awake();
    this.combo.initialize(opt("ContinuationEffectDisplay", true));
    // LiveUIView.Initialize: _comboCounterView.gameObject.SetActiveFast(IsShowComboCount). An inactive counter is not
    // drawn and its Animator does not update; UpdateView still runs.
    this.comboShown = opt("ComboCountDisplay", true);
    if (!this.comboShown) tree.setActive(comboNode, false);
    if (opts.preroll !== false && this.comboShown) this.preroll();
  }

  // Animator binding (paths relative to UILiveCombo): Transform.m_LocalScale.x|y|z and CanvasGroup.m_Alpha. A path
  // that does not exist yields null (Unity skips the curve); other properties raise.
  static bind(root, b) {
    let n = root;
    if (b.path !== "") { try { n = root.find(b.path); } catch (e) { return null; } }
    const prop = `${b.cls}.${b.attr}`;
    if (prop === "CanvasGroup.m_Alpha") {
      if (!n.canvasGroup) return null;
      return { get: () => n.canvasGroup.alpha, set: (v) => { n.canvasGroup.alpha = v; } };
    }
    const m = /^Transform\.m_LocalScale\.([xyz])$/.exec(prop);
    if (m) {
      const c = m[1], set = UI_CLIP_TARGET[prop];
      return { get: () => (c === "z" ? n.localScaleZ : n.localScale[c]), set: (v) => set(n, v) };
    }
    throw new UIError(`${n.path}: animated property ${prop} not implemented`);
  }

  preroll(dt = 1 / 60) {
    for (let i = 0; i < 120; i++) {
      const pending = [...this.animator.params.values()].some((p) => p.type === 9 && p.value);
      if (!pending && !this.animator.fade && this.animator.state.name === "LiveComboInit") return i;
      this.animator.update(dt);
    }
    throw new UIError("UILiveCombo: Init fade did not settle");
  }

  // ------------------------------------------------------------ frame
  // A judgement shown in update gets its first DOTween step (position dt) in the same frame, and a trigger set here
  // is taken by the Animator in this frame's animation phase and sampled after one advance (engine/anim.js convention).
  // ENGINE: GameMain and DOTweenComponent are both order-0 MonoBehaviour Updates; GameMain is taken to run first.
  // Which notes add combo is the simulator's (fr.combo is shown as given).
  update(fr) {
    this.judgement.showJudgement(fr.judgedNotes || []);
    this.combo.updateView(fr.combo, !!fr.isAllPerfect, !!fr.isFullCombo);
  }

  tweens(dt) { this.dotween.update(dt); }

  animate(dt) { if (this.comboShown) this.animator.update(dt); }

  // LiveUIView.SetActive: LiveUICanvas CanvasGroup alpha 1 / 0 (interactable / blocksRaycasts not modelled).
  // Game calls: LiveViewPresenter.HideUI (false) from MusicStartAnimationStateNode.Enter before
  // the start timeline plays, LiveViewPresenter.SetActiveLiveUI (true) from LiveStartStateNodeBase.Enter
  // (StartLive). The session calls this at those two points; the constructor keeps the serialized alpha 1.
  setActive(v) { this.root.canvasGroup.alpha = v ? 1 : 0; }

  // ------------------------------------------------------------ layout and geometry
  canvasSize(width, height) { return uiCanvasSize(this.scaler, width, height); }

  // ENGINE: RectTransform placement is native; UINode follows the documented anchor / pivot rules.
  // The layout groups follow the game's uGUI build (engine/ugui.js); the judgement position is derived from the
  // serialized rects, not measured in the game.
  layout(W, H) {
    UILayout.layoutRoot(this.root, W, H, (n) => UILayout.rebuildUncontrolled(n));
  }

  // canvas-space centre of a node's rect relative to the canvas centre (reference units, y up)
  centre(n, W, H) {
    const r = n.rect, [x, y] = UIAffine.apply(n.matrix, r.x + r.w / 2, r.y + r.h / 2);
    return { x: x - W / 2, y: y - H / 2 };
  }

  // paint order and inherited alpha: UIDraw.list (hierarchy order).
  // ENGINE: the nested Canvases of UILiveCombo / UILiveJudgement (overrideSorting off) are taken to draw in hierarchy order.
  // They do not overlap on screen. Items with inherited alpha 0 are left out: UI/Default rounds
  // the vertex alpha to 1/255 steps and blends One / OneMinusSrcAlpha with rgb *= a, so they write nothing.
  drawItems() {
    const refPPU = this.scaler.m_ReferencePixelsPerUnit;
    return UIDraw.list(this.root, (n, alpha) => {
      if (n.tmp && n.tmp.m_Enabled && alpha > 0) throw new UIError(`${n.path}: visible TMP text not implemented`);
      if (!n.image || !n.image.m_Enabled || !(alpha > 0)) return [];
      const sp = n.image.spriteObj, mesh = UIImage.build(n, n.image, sp, refPPU);
      return [{ node: n, texture: sp ? sp.texture.name : null, alpha, mesh,
                verts: UIDraw.pack(mesh.verts, n, alpha), idx: Uint32Array.from(mesh.idx) }];
    });
  }

  // ------------------------------------------------------------ GL
  // the GL resources of an already loaded LiveUIFx (same scene and notes): what load() creates
  adoptGL(prev) {
    for (const k of ["lib", "solid", "material", "tex", "vao", "vbo", "ibo"]) this[k] = prev[k];
  }

  async load() {
    const gl = this.gl;
    if (!gl) return;
    this.lib = new ShaderLib(gl, "livenotes/shaders");
    this.solid = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
    };
    // Graphic.defaultGraphicMaterial (m_Material null): the built-in "Default UI Material" = UI/Default with its
    // shader defaults, no keywords (no RectMask2D / alpha clip in the subset)
    const defaults = this.lib.defaults(LIVEUI.SHADER, this.solid);
    const num = Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v === "number"));
    this.material = { shader: LIVEUI.SHADER, keywords: [], floats: num, colors: {}, defaults };
    this.lib.program(LIVEUI.SHADER, 0, []);
    this.tex = new Map();
    for (const [p, desc] of this.tree.textures) this.tex.set(p, await GLTex.load(gl, "livenotes", desc));
    this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
  }

  // LiveUICanvas on LiveMainCamera (orthographic, the canvas plane perpendicular to the view axis at plane distance 1):
  // UIDraw.globals' orthographic projection over the canvas units gives the same clip-space x, y.
  // ENGINE: unity_GUIZTestMode 4 (LEqual) for a camera canvas; the depth test does not reject canvas fragments here.
  // (The renderer owns the main camera target's depth.)
  submit(renderer) {
    renderer.submit("main", { sortingLayer: 0, sortingOrder: this.sortingOrder, queue: 3000, distance: this.planeDistance,
                              draw: (ctx) => this.draw(ctx) });
  }

  draw(ctx) {
    const { width, height } = ctx.target;
    const { W, H } = this.canvasSize(width, height);
    this.layout(W, H);
    const gl = this.gl;
    if (!gl) return;
    const globals = UIDraw.globals(W, H, width, height, 4);
    gl.disable(gl.SCISSOR_TEST);
    for (const it of this.drawItems()) {
      const tex = it.texture ? this.tex.get(it.texture) : this.solid.white;
      if (!tex) throw new UIError(`${it.node.path}: texture ${it.texture} not loaded`);
      // Graphic: _TextureSampleAdd 0 for RGBA textures, _MainTex_ST unit, no clip rect
      const sheet = { _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0],
                      _ClipRect: [-32767, -32767, 32767, 32767] };
      UIDraw.draw(gl, this.lib, this, this.material, sheet, globals, it.verts, it.idx);
    }
  }
};
