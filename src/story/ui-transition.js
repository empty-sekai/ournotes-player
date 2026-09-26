import { F } from "../engine/core.js";
import { animCurve } from "../engine/anim.js";
import { UIError } from "../engine/ugui.js";

// Screen transitions of the story UI: the rule transition cover (Fwk.Transition UIRuleTransitionView on
// FrontCanvas/RuleTransition, drawn with the UI-Transition material) and the letterbox bands of UIAdvWidget
// (AdvLetterBoxCanvas). `ui` = the StoryUI owning the nodes and the player loop.

export class StoryRuleTransition {
  constructor(ui) {
    this.ui = ui;
    const node = ui.part.rule, rt = node.rec.ruleTransition, doc = ui.doc;
    if (!rt || !doc.materials[rt.material]) throw new UIError("RuleTransition: UI-Transition material not in the data");
    // UIRuleTransitionView: the Image draws with `_material` (UI-Transition); its properties are set per fade
    node.image.material = rt.material;
    const tm = doc.materials[rt.material];
    this.node = node;
    this.texture = null;
    this.color = tm.colors._Color; this.val = tm.floats._Val; this.useGradient = tm.floats._UseGradient;
    this._token = 0;
  }

  // UIRuleTransitionView.Refresh: CTS cleared, UIPart.Hide, _RuleTex = null, _Val = 1
  refresh() {
    this._token++;
    this.ui.setActive(this.node, false);
    this.texture = null; this.val = 1;
  }

  // per-draw properties of the cover: _RuleTex / _Color / _Val / _UseGradient
  // ENGINE: with _UseGradient 1 the shader reads the rule at gl_FragCoord / _ScreenParams; the bound target here is the viewport-sized post target.
  sheet(mat) {
    return { _RuleTex: this.texture ? this.ui.tex[this.texture] : mat.defaults._RuleTex, _Color: this.color,
             _Val: this.val, _UseGradient: this.useGradient };
  }

  // GetTransitionSettings(address) -> Fwk.Transition.RuleTransitionSettings (_texture, _gradient, _easingCurve)
  settings(address) {
    const s = this.ui.doc.transitions[address];
    if (!s) throw new UIError(`transition ${address} not in the data`);
    const keys = s._easingCurve.m_Curve;
    if (!keys.length || keys.some((k) => k.weightedMode !== 0)) throw new UIError(`${address}: weighted easing curve not implemented`);
    const texture = s._texture ? s._texture.texture : null;
    if (texture && !this.ui.doc.textures[texture]) throw new UIError(`${address}: rule texture not in the data`);
    return { address, texture, gradient: s._gradient, curve: keys };
  }

  // UIRuleTransitionView.Animate:
  //   _RuleTex, _Color, _UseGradient; UIPart.Show(); t = 0
  //   while t < dur: _Val = curve.Evaluate(t / dur) * (end - start) + start; t += GetSystemDeltaTime(); yield
  //   _Val = end; FadeIn: UIPart.Hide()
  // Start / end: FadeOut (1, -1), FadeIn (-1, 1). The system delta is the loop's step. An Animate started while
  // another runs takes over the material; the older loop stops touching it (as Refresh cancels it).
  async animate(settings, color, dur, start, end, hideAtEnd) {
    const token = ++this._token, loop = this.ui.loop;
    this.texture = settings.texture; this.color = color; this.useGradient = settings.gradient;
    this.ui.setActive(this.node, true);
    const d = F(dur);
    let t = 0;
    while (t < d) {
      this.val = F(F(animCurve(settings.curve, F(t / d))) * (end - start) + start);
      t = F(t + F(loop.deltaTime));
      await loop.yield("Update");
      if (token !== this._token) return;
    }
    this.val = end;
    if (hideAtEnd) this.ui.setActive(this.node, false);
  }
}

export class StoryLetterBox {
  constructor(ui) {
    this.ui = ui;
    const doc = ui.doc, p = ui.part;
    // UIAdvWidget.SetLetterBoxSprite (AdvPlayer.Init): Textures/letterbox-image on both band Images
    const lb = ui.sprites.get(doc.letterBoxSprite);
    if (!lb) throw new UIError(`letterbox sprite ${doc.letterBoxSprite} not in the data`);
    p.topBand.image.spriteObj = lb; p.bottomBand.image.spriteObj = lb;
    this.root = ui.letterBox;
    this._key = null;
  }

  // RefreshLetterBoxBands: visible / initialized / fadeEnabled / fading cleared, the group (if any) at alpha 0, both
  // bands inactive
  refresh() {
    const p = this.ui.part;
    this.s = { visible: false, initialized: false, fadeEnabled: false, fading: false, from: 0, to: 0, elapsed: 0 };
    if (this.root.canvasGroup) this.root.canvasGroup.alpha = 0;
    this.ui.setActive(p.topBand, false); this.ui.setActive(p.bottomBand, false);
  }

  // UIAdvWidget.InitializeLetterBoxCanvasGroup: the CanvasGroup of AdvLetterBoxCanvas is added at run time
  // (AddComponent: alpha 1), not interactable, no raycasts
  _initGroup() {
    if (!this.root.canvasGroup) this.root.canvasGroup = { alpha: 1, ignoreParentGroups: false };
  }

  // AdvViewportChanged -> UpdateLetterBoxBands when the screen or the viewport changes
  update(screenW, screenH, viewport) {
    const key = `${screenW}x${screenH}:${viewport.x},${viewport.y},${viewport.w},${viewport.h}`;
    if (key === this._key) return;
    this._key = key;
    this._updateBands(viewport.h / screenH, screenW, screenH);
  }

  // UpdateLetterBoxBands: band = (1 - viewport.height) * Screen.height * 0.5; viewport.height is the viewport rect
  // the page gives (whole pixels)
  _updateBands(viewportHeight, screenW, screenH) {
    const p = this.ui.part;
    const band = F(F(F(1 - viewportHeight) * screenH) * 0.5);
    if (band > 1) {
      this.ui.setActive(p.topBand, true); this.ui.setActive(p.bottomBand, true);
      const fb = Math.max(band, 0);
      p.topBand.anchoredPosition = { x: 0, y: -fb }; p.topBand.sizeDelta.y = this._bandDrawHeight(p.topBand, fb, screenW);
      p.bottomBand.anchoredPosition = { x: 0, y: fb }; p.bottomBand.sizeDelta.y = this._bandDrawHeight(p.bottomBand, fb, screenW);
    }
    this._setVisible(band > 1);
  }

  // GetBandDrawHeight: sprite ? max(rect.h / rect.w * Screen.width, fallback) : fallback
  _bandDrawHeight(node, fallback, screenW) {
    const sp = node.image.spriteObj;
    if (!sp || !(sp.rect.width > 0) || !(sp.rect.height > 0)) return fallback;
    const h = F(F(sp.rect.height / sp.rect.width) * screenW);
    return h <= fallback ? fallback : h;
  }

  // SetLetterBoxVisible
  _setVisible(visible) {
    this._initGroup();
    const s = this.s, cg = this.root.canvasGroup;
    if (s.initialized) {
      if (s.visible === visible) return;
      s.visible = visible;
      if (visible) {
        this.ui.setActive(this.root, true);
        if (s.fadeEnabled) { this._startFade(1); return; }
        s.fading = false; cg.alpha = 0;
        return;
      }
      if (s.fadeEnabled) { this._startFade(0); return; }
    }
    this._setVisibleImmediate(visible, 0);
    s.initialized = true;
  }

  // SetLetterBoxVisibleImmediate
  _setVisibleImmediate(visible, alpha) {
    const s = this.s, p = this.ui.part;
    s.fading = false; s.visible = visible;
    this.ui.setActive(this.root, visible);
    this.root.canvasGroup.alpha = visible ? alpha : 0;
    if (!visible) { this.ui.setActive(p.topBand, false); this.ui.setActive(p.bottomBand, false); }
  }

  // StartLetterBoxFade
  _startFade(target) {
    const s = this.s;
    s.from = this.root.canvasGroup.alpha; s.to = target; s.elapsed = 0; s.fading = true;
  }

  // FadeInLetterBoxIfNeededAsync: nothing unless the bands are visible and the group alpha < 1; else root active,
  // fade enabled, fade to 1, then UniTask.WaitUntil(!fading) at PlayerLoopTiming.Update
  async fadeIn() {
    this._initGroup();
    const s = this.s;
    if (!s.visible || this.root.canvasGroup.alpha >= 1) return;
    this.ui.setActive(this.root, true);
    s.fadeEnabled = true;
    this._startFade(1);
    do { await this.ui.loop.yield("Update"); } while (s.fading);
  }

  // UpdateLetterBoxFade: elapsed += min(delta, 0.033333335); alpha = lerp(from, to, clamp01(elapsed / 0.2)); at the
  // end fading stops, alpha = to, and a hidden target deactivates the root and both bands
  updateFade(dt) {
    const s = this.s, cg = this.root.canvasGroup, p = this.ui.part;
    if (!s.fading || !cg) return;
    s.elapsed = F(Math.min(F(dt), F(1 / 30)) + s.elapsed);
    const k = F(s.elapsed / F(0.2)), u = k <= 1 ? k : 1, v = k >= 0 ? u : 0;
    cg.alpha = F(s.from + F(Math.max(v, 0) * F(s.to - s.from)));
    if (v < 1) return;
    s.fading = false;
    cg.alpha = s.to;
    if (s.visible) return;
    this.ui.setActive(this.root, false); this.ui.setActive(p.topBand, false); this.ui.setActive(p.bottomBand, false);
  }
}
