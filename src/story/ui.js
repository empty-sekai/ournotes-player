import { F, join } from "../engine/core.js";
import { ShaderLib } from "../engine/glsl.js";
import { GLTex } from "../engine/texture.js";
import { Tweens } from "../engine/tween.js";
import { UIAnimator, UIClip, UIDraw, UIError, UIImage, UINode, UISprite, UITween, uiCanvasSize } from "../engine/ugui.js";
import { TMPText, UIGradientMod, tmpUnsupported } from "../engine/uitext.js";
import { ADV_CANVAS_LAYER, StoryCommandError, createStoryUILayers } from "./interfaces.js";
import { StoryLayout } from "./ui-layout.js";
import { StoryText, countedText, shownText } from "./ui-ruby.js";
import { StoryTalkWindow, removeTagsWithRuby } from "./ui-talk.js";
import { StoryLetterBox, StoryRuleTransition } from "./ui-transition.js";

// The story's front canvas (StoryUI): UIAdvWidget/FrontCanvas with the talk windows under UIContainer/TalkView (the
// default UIDefaultTalkWindow; UICenterTalkWindow with its centre-talk backdrop when the episode uses it), the flash,
// rule transition cover, location caption, curtains, subtitles, front next indicator, menu entry button and video
// buttons, episode title, plus the AdvLetterBoxCanvas bands, drawn with the game's UI shaders. The other canvases of the widget (video, still, frame) belong to their features and are not
// built here. Generic uGUI (RectTransform, Image, CanvasGroup, canvas drawing, UI clips and tweens) is
// engine/ugui.js, TextMesh Pro layout engine/uitext.js; the auto layout (layout groups, content size fitters) is
// ui-layout.js, the talk window ui-talk.js, the text components and the ruby rewrite ui-ruby.js, the rule transition
// and the letterbox ui-transition.js. The UI's timing runs on the player
// loop with or without a GL context (gl = null: layout, geometry and timing only).
//
// Data: ui/ui.json (nodes, sprites, textures, UI materials, clips, controllers, transitions, player settings), the
// language's ui/fonts.json (font assets, glyph pages, text materials, per text node the TMP text record and its
// localized font binding) and ui/languages.json (LanguageMode of the language).

export const ADVUI_WIDGET = "UIAdvWidget";
export const ADVUI_FRONT = "UIAdvWidget/FrontCanvas";
export const ADVUI_LETTERBOX = "UIAdvWidget/AdvLetterBoxCanvas";
export const ADVUI_TALK_VIEW = "UISafeArea/UIContainer/TalkView";
export const ADVUI_DEFAULT_WINDOW = "UIDefaultTalkWindow";
export const ADVUI_DEFAULT_MATERIAL = "Default UI Material";
// The serialized references of the talk window prefabs (UITypingTalkWindow SpeakerText, TalkText, TalkArea,
// _speakerNameObjects (at most one here), _talkNextIndicator; UIAdvTalkWindow _talkBackground, _autoIcon, _fastIcon),
// relative to the window root; null = a null reference
export const ADVUI_TALK_WINDOW_REFS = Object.freeze({
  UIDefaultTalkWindow: {
    speakerText: "TalkArea/Content/Speaker/Back/SpeakerText", talkText: "TalkArea/Content/TalkText", talkArea: "TalkArea",
    speaker: "TalkArea/Content/Speaker", nextIndicator: "TalkArea/Content/TalkNextIndicator", background: "TalkBackground",
    autoIcon: "TalkArea/Content/AutoIcon", fastIcon: "TalkArea/Content/FastIcon",
  },
  UICenterTalkWindow: {
    speakerText: null, talkText: "TalkArea/Content/TalkText", talkArea: "TalkArea", speaker: null, nextIndicator: null,
    background: "TalkBackground", autoIcon: null, fastIcon: null,
  },
});
const BACKDROP_FADE = F(0.2);                // UpdateCenterTalkBackdropFilter: CanvasGroup.DOFade(1, 0.2)
const LANGUAGE_ENGLISH = 1;                  // Fwk.Localization.LanguageMode.English
const LANGUAGE_KOREAN = 4;                   // Fwk.Localization.LanguageMode.Korean

// AdvMenuView serialized references (UIAdvWidget prefab): the video button group and its buttons, the panel buttons
const MENU = "UISafeArea/UIContainer/MenuView";
const MENU_PARTS = {
  videoButtonParent: `${MENU}/VideoButtons`, skipVideoButton: `${MENU}/VideoButtons/SkipButton`,
  pauseVideoButton: `${MENU}/VideoButtons/PauseButton`, autoButton: `${MENU}/MenuButtonsParent/Back/AutoPlayButton`,
  fastForwardButton: `${MENU}/MenuButtonsParent/Back/FastButton`, menuButtonsParent: `${MENU}/MenuButtonsParent`,
};

export class StoryUI {
  // gl may be null (layout, geometry and timing only). doc = ui/ui.json; fonts = ui/fonts.json and language =
  // ui/languages.json of the language `lang`; assets = the story's AssetStore (textures, shaders, glyph pages; the
  // store bound to gl when omitted); dir = the ui directory in the store.
  constructor(gl, loop, doc, { assets, dir = "ui", lang, fonts, language }) {
    if (!fonts || !fonts.texts) throw new UIError("StoryUI: ui/fonts.json missing");
    if (!language || typeof language.mode !== "number") throw new UIError("StoryUI: ui/languages.json missing");
    this.gl = gl; this.loop = loop; this.doc = doc; this.fonts = fonts; this.language = language; this.lang = lang;
    this.assets = assets; this.dir = dir;
    this._materialInstances = new Map();            // TMP_Text.fontMaterial instances: name -> text material record
    // hierarchy order (parents first, siblings in order); the widget's other canvases are skipped with their subtrees
    const byPath = new Map(), skipped = new Set();
    for (const rec of doc.nodes) {
      const parentPath = rec.path.slice(0, rec.path.lastIndexOf("/"));
      if (skipped.has(parentPath)) { skipped.add(rec.path); continue; }
      const parent = byPath.get(parentPath) || null;
      if (!parent && parentPath === ADVUI_WIDGET && rec.path !== ADVUI_FRONT && rec.path !== ADVUI_LETTERBOX) {
        skipped.add(rec.path); continue;
      }
      if (!parent && rec.path !== ADVUI_FRONT && rec.path !== ADVUI_LETTERBOX)
        throw new UIError(`ui node ${rec.path} has no parent in the data`);
      byPath.set(rec.path, new UINode(rec, parent));
    }
    this.nodes = byPath;
    this.front = byPath.get(ADVUI_FRONT);
    this.letterBox = byPath.get(ADVUI_LETTERBOX);
    if (!this.front || !this.letterBox) throw new UIError("ui.json lacks FrontCanvas or AdvLetterBoxCanvas");
    const scaler = this.front.rec.canvasScaler;
    if (!scaler || !scaler.m_Enabled || scaler.m_UiScaleMode !== 1 || scaler.m_ScreenMatchMode !== 1)
      throw new UIError("FrontCanvas: CanvasScaler is not ScaleWithScreenSize / Expand");
    if (this.front.rec.canvas.m_RenderMode !== 1 || this.letterBox.rec.canvas.m_RenderMode !== 0 ||
        this.front.rec.canvas.m_PixelPerfect || this.letterBox.rec.canvas.m_PixelPerfect)
      throw new UIError("canvas render modes differ from the prefab (Camera / Overlay, not pixel perfect)");
    this.scaler = scaler;
    // uGUI auto layout (ui-layout.js); the text component of a node is its ILayoutElement when enabled
    this.autoLayout = new StoryLayout(scaler.m_ReferencePixelsPerUnit, (n) => (n.text && n.text.enabled ? n.text : null));
    this.sprites = new Map(Object.entries(doc.sprites).map(([n, s]) => {
      const t = doc.textures[s.texture];
      if (!t) throw new UIError(`sprite ${n}: texture ${s.texture} not in the data`);
      return [n, new UISprite(n, s, t)];
    }));
    this._fonts = new Map();
    this._clipCache = Object.fromEntries(Object.entries(doc.clips).map(([k, c]) => [k, new UIClip(c)]));
    this.animators = [];
    for (const n of byPath.values()) {
      const r = n.rec;
      if (r.image) {
        const sp = r.image.sprite;
        if (sp && !this.sprites.has(sp)) throw new UIError(`${n.path}: sprite ${sp} not in the data`);
        n.image = { ...r.image, spriteObj: sp ? this.sprites.get(sp) : null, material: r.image.material || ADVUI_DEFAULT_MATERIAL };
        if (!doc.materials[n.image.material]) throw new UIError(`${n.path}: material ${n.image.material} not in the data`);
      }
      if (r.gradient && r.gradient.enabled) n.gradient = r.gradient;
      if (r.textStyle) {
        let t = fonts.texts[n.path];
        if (!t) throw new UIError(`${n.path}: no text binding in ui/fonts.json`);
        // BiliBili.Locale.LocalizeKoreanAdjust.Apply (from OnEnable and the font-changed callback OnEnable registers,
        // so only for an enabled component): in the Korean language mode _koreanFontStyle ForceNormal (1) clears and
        // ForceBold (2) sets the Bold style of the serialized font style; other modes keep it
        const ko = t.localizeKoreanAdjust;
        if (ko && ko.m_Enabled && language.mode === LANGUAGE_KOREAN && (ko._koreanFontStyle === 1 || ko._koreanFontStyle === 2))
          t = { ...t, m_fontStyle: ko._koreanFontStyle === 2 ? t.m_fontStyle | 1 : t.m_fontStyle & ~1 };
        n.text = new TMPText(this, n, t);
        n.text.enabled = !!t.enabled;
        n.textClass = t.class;
        // LocalizeText.OnFontChanged, English only: enableWordWrapping = true (and overflow mode 0) unless the object's
        // name contains "nowrap" (IndexOf, ordinal ignore case)
        if (language.mode === LANGUAGE_ENGLISH && !n.name.toLowerCase().includes("nowrap")) n.text.setWrapping(1);
        n.storyText = new StoryText(n.text, t);
      }
      if (r.animator) {
        const a = r.animator;
        const ctrl = doc.controllers[a.controller];
        if (!ctrl) throw new UIError(`${n.path}: controller ${a.controller} not in the data`);
        if (a.updateMode !== 0 || !a.enabled || a.keepStateOnDisable)
          throw new UIError(`${n.path}: animator settings outside the prefab values`);
        n.animator = new UIAnimator(n, ctrl, this._clipCache);
        this.animators.push(n.animator);
      }
      if (r.layoutGroup && r.layoutGroup.m_Enabled) n.layoutGroup = r.layoutGroup;
      if (r.contentSizeFitter && r.contentSizeFitter.m_Enabled) n.contentSizeFitter = r.contentSizeFitter;
      if (r.layoutElement && r.layoutElement.m_Enabled) n.layoutElement = r.layoutElement;
      if (r.outline && r.outline.enabled) throw new UIError(`${n.path}: enabled Outline effect not implemented`);
      if (r.safeAreaEdgeAnchor && r.safeAreaEdgeAnchor.enabled) n.safeAreaEdgeAnchor = r.safeAreaEdgeAnchor;
    }
    const F_ = (p) => this.front.find(p);
    const opt = (p) => byPath.get(`${ADVUI_FRONT}/${p}`) || null, ref = (p) => (p ? byPath.get(p) || null : null);
    const flashView = opt("FlashView"), subtitlesView = opt("UISafeArea/UIContainer/SubtitlesView");
    this.part = {
      rule: F_("RuleTransition"), location: F_("LocationVIew"), locationText: F_("LocationVIew/LocationText"),
      talkView: F_(ADVUI_TALK_VIEW),
      title: F_("UISafeArea/UIContainer/TitleView"), titleBar: F_("UISafeArea/UIContainer/TitleView/Title"),
      titleText: F_("UISafeArea/UIContainer/TitleView/Title/TitleText"),
      menuButton: F_("UISafeArea/UIContainer/MenuView/MenuEntryButton"),   // AdvMenuView.Refresh: normal state
      topBand: this.letterBox.find("TopBand"), bottomBand: this.letterBox.find("BottomBand"),
      uiContainer: F_("UISafeArea/UIContainer"),
      // AdvFlashView._flash; AdvSubtitlesView._subtitles / _subtitlesText; AdvFrontScreenView._nextIndicator
      flash: flashView && flashView.rec.flashView ? ref(flashView.rec.flashView._flash) : null,
      subtitles: subtitlesView && subtitlesView.rec.subtitlesView ? ref(subtitlesView.rec.subtitlesView._subtitles) : null,
      subtitlesText: subtitlesView && subtitlesView.rec.subtitlesView ? ref(subtitlesView.rec.subtitlesView._subtitlesText) : null,
      frontNextIndicator: opt("UISafeArea/UIContainer/NextIndicator"),
      menu: opt(MENU),
      // UIAdvWidget._centerTalkBackdropCanvasGroup / _centerTalkBackdropImage (in the data with a backdrop-filter window)
      centerTalkBackdrop: opt("CenterTalkBackdrop"),
    };
    for (const [k, p] of Object.entries(MENU_PARTS)) this.part[k] = opt(p);
    const p = this.part;
    if (p.flash && !p.flash.image) throw new UIError("FlashView: no Image");
    if (p.subtitlesText && !p.subtitlesText.storyText) throw new UIError("SubtitlesText: no text component");
    if (p.centerTalkBackdrop && !(p.centerTalkBackdrop.canvasGroup && p.centerTalkBackdrop.image))
      throw new UIError("CenterTalkBackdrop: no CanvasGroup or Image");
    this._lastSubtitles = "";                      // AdvSubtitlesView._lastSubtitles
    this._flash = null;
    // UIPart states of the menu panel buttons (AutoButton / FastForwardButton Show / Hide): applied to their nodes
    // when the panel is in the data
    this._menuButtons = { autoButton: true, fastForwardButton: true };
    // The MenuEntryButton pictogram (App.UI.UIPictogram key 100) keeps the prefab sprite sp_adv_open, which is also the
    // ButtonImageState normal sprite.
    this.tweens = new Tweens();                     // DOTween runner of the UI (UITween)
    // the talk windows in the data (TalkView children): name -> {name, node, part, talk (StoryTalkWindow)}
    this.windows = new Map();
    for (const node of p.talkView.children) {
      const refs = ADVUI_TALK_WINDOW_REFS[node.name];
      if (!refs) throw new UIError(`${node.path}: talk window ${node.name} not implemented`);
      const find = (rel) => (rel ? node.find(rel) : null);
      const part = { window: node };
      for (const [k, rel] of Object.entries(refs)) part[k] = find(rel);
      const host = { part, loop, tweens: this.tweens, language, doc, setActive: (n, v) => this.setActive(n, v),
                     setTextColor: (n, c) => this._setTextColor(n, c), setTextOutlineColor: (n, c) => this._setOutlineColor(n, c) };
      this.windows.set(node.name, { name: node.name, node, part, talk: new StoryTalkWindow(host) });
    }
    if (!this.windows.has(ADVUI_DEFAULT_WINDOW)) throw new UIError(`ui.json lacks the talk window ${ADVUI_DEFAULT_WINDOW}`);
    this.talkWindows = [...this.windows.keys()];
    for (const w of this.windows.values())
      if (w.talk.useBackdropFilter && !p.centerTalkBackdrop) throw new UIError(`${w.name}: CenterTalkBackdrop not in the data`);
    // AdvTalkView: the attached window, the playback speed and icon flags UpdateWindowStatus gives each window
    this._window = null;
    this._view = { playbackSpeed: 1, autoIcon: false, fastIcon: false };
    this._backdropFade = null;
    this.rule = new StoryRuleTransition(this);
    this.letterBoxView = new StoryLetterBox(this);
    this.layers = createStoryUILayers();
    for (const w of this.windows.values()) {          // the loaded windows' initial state, not attached yet
      w.talk.refresh();
      this.setActive(w.node, false);
    }
    this._refresh();
    loop.on("update", (l) => this._onUpdated(l.deltaTime));
    loop.on("tweens", (l) => this.tweens.update(l.deltaTime));     // DOTweenComponent.Update
    loop.on("animation", (l) => this._animate(l.deltaTime));
  }

  // ------------------------------------------------------------ text host (engine/uitext.js)
  fontAsset(name) {
    if (!this._fonts.has(name)) {
      const f = this.fonts.fonts[name];
      if (!f) throw new UIError(`font asset ${name} not in ui/fonts.json`);
      this._fonts.set(name, { name, ...f, textureSize: this.fonts.textures, lineBreaking: this.fonts.lineBreaking || null });
    }
    return this._fonts.get(name);
  }

  material(name) { return this._materialInstances.get(name) || this.fonts.materials[name] || null; }

  // Raises StoryCommandError for texts the UI cannot lay out as the game does (per text as the talk text of each talk
  // window in the data shows it: the unsupported rich-text features after the ruby rewrite, emoji sequences,
  // characters of the text and of its ruby readings missing from the font asset of the talk text).
  checkTexts(texts) {
    const problems = new Set();
    for (const w of this.windows.values()) this._checkTexts(w.part.talkText, texts, problems);
    if (problems.size) throw new StoryCommandError(`texts the story UI cannot lay out: ${[...problems].join("; ")}`);
  }

  _checkTexts(node, texts, problems) {
    const talk = node.text, b = node.storyText.b;
    for (const s of texts) {
      if (typeof s !== "string" || !s) continue;
      let shown = s;
      try {
        shown = shownText(talk, b, s);
        countedText(talk, b, removeTagsWithRuby(s));
      } catch (e) {
        if (!(e instanceof UIError)) throw e;
        problems.add(e.message);
      }
      for (const p of tmpUnsupported(shown, { richText: talk.richText, parseCtrl: talk.parseCtrl })) problems.add(p);
      const f = talk.font;
      if (talk.richText && /<mark[=>\s]/i.test(shown) && !f.characters["95"])
        problems.add(`${f.name}: U+005F (the highlight glyph) not in the font data`);
      for (const ch of removeTagsWithRuby(s)) {
        const u = ch.codePointAt(0);
        if (!f.characters[String(u)] && u !== 10 && u !== 13 && u !== 9 && u !== 0x200B)
          problems.add(`${f.name}: U+${u.toString(16).toUpperCase().padStart(4, "0")} not in the font data`);
      }
    }
  }

  // UIText.SetColor on a text node: the TMP vertex colour
  _setTextColor(node, c) { node.text.setColor(c); }

  // TMP_Text.fontMaterial (an instance of the shared material, created once and kept as the shared material) with
  // Material.SetColor(_OutlineColor, c); the instance is compiled with the other materials (now when GL is loaded)
  _setOutlineColor(node, c) {
    const t = node.text;
    let name = t.materialName;
    if (!this._materialInstances.has(name)) {
      const base = this.fonts.materials[name];
      if (!base) throw new UIError(`${node.path}: material ${name} not in the data`);
      this._materialInstances.set(`${name} (Instance ${node.path})`, { ...base, baseName: name, colors: { ...(base.colors || {}) } });
      name = `${name} (Instance ${node.path})`;
      t.materialName = name;
    }
    this._materialInstances.get(name).colors._OutlineColor = { r: c.r, g: c.g, b: c.b, a: c.a };
    if (this.materials) this._addMaterials(new Map([[name, this._materialInstances.get(name)]]), this.fonts.materialKeywords);
  }

  // GameObjectExtension.SetActiveFast: no-op when activeSelf already equals v. Behaviours of a subtree that becomes
  // active in the hierarchy get OnEnable: an Animator with keepAnimatorStateOnDisable false restarts in its default
  // state. On disable a DOTweenSequence with _killOnDisable kills its sequence.
  // ENGINE: Animator.writeDefaultValuesOnDisable is not applied: every animated node here is invisible while disabled and resampled on its first update after enable.
  setActive(node, v) {
    if (node.activeSelf === v) return;
    const before = node.activeInHierarchy;
    node.activeSelf = v;
    const after = node.activeInHierarchy;
    if (before === after) return;
    const walk = (n) => {
      if (!n.activeSelf) return;
      if (after && n.animator) n.animator.reset();
      if (!after && n.sequence) { n.sequence.kill(); n.sequence = null; }
      for (const c of n.children) walk(c);
    };
    walk(node);
  }

  // ------------------------------------------------------------ GL resources
  async load() {
    const gl = this.gl;
    if (!gl) return;
    const assets = this.assets || undefined;
    this.lib = new ShaderLib(gl, join(this.dir, this.doc.shaders.index.replace(/\/shaders\.json$/, "")), assets);
    this.solid = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
    };
    this.tex = {};
    for (const [name, desc] of [...Object.entries(this.doc.textures), ...Object.entries(this.fonts.textures)]) {
      if (this.tex[name]) throw new UIError(`texture name ${name} used twice`);
      this.tex[name] = await GLTex.load(gl, this.dir, desc, assets);
    }
    this.materials = {};
    this._addMaterials(new Map(Object.entries(this.doc.materials)), this.doc.materialKeywords);
    this._addMaterials(new Map(Object.entries(this.fonts.materials)), this.fonts.materialKeywords);
    this._addMaterials(this._materialInstances, this.fonts.materialKeywords);
    this.buf = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
  }

  // GL material records (compiled up front); an instance takes the keywords of its base material
  _addMaterials(mats, keywords) {
    if (!this.gl) return;
    for (const [name, m] of mats) {
      const shader = m.shader.shader, defaults = this.lib.defaults(shader, this.solid);
      const num = Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v === "number"));
      const kw = keywords[m.baseName || name] || [];
      this.materials[name] = { shader, keywords: kw, floats: { ...num, ...m.floats }, colors: m.colors || {}, defaults };
      this.lib.program(shader, 0, kw);                                   // compile up front
    }
  }

  dispose() {
    const gl = this.gl;
    if (!gl || !this.buf) return;
    for (const t of Object.values(this.tex)) gl.deleteTexture(t.glTexture);
    for (const t of Object.values(this.solid)) gl.deleteTexture(t.glTexture);
    gl.deleteVertexArray(this.buf.vao); gl.deleteBuffer(this.buf.vbo); gl.deleteBuffer(this.buf.ibo);
    this.buf = null;
  }

  // ------------------------------------------------------------ layout (RectTransforms + LayoutRebuilder)
  // CanvasScaler ScaleWithScreenSize / Expand: 2340 x 1080 units in a 13:6 viewport
  canvasSize(width, height) { return uiCanvasSize(this.scaler, width, height); }

  _layoutRoot(root, W, H) { this.autoLayout.layoutRoot(root, W, H); }

  // UISafeArea keeps its prefab anchors (0,0)-(1,1): AdvViewportSafeArea.OnResolutionChanged only moves them for a
  // device safe area inside the viewport, and a web page has none. UIAdvTalkWindow.OnResolutionChanged grows the talk
  // background by 2 x the bottom safe-area offset, 0 without an inset. The Left / Right curtains keep their prefab state.
  layout(W, H) {
    this._layoutRoot(this.front, W, H);
    this._edgeAnchors(this.front, W, H);
  }

  // UISafeAreaLayoutUtility.DoLayoutEdgeAnchors -> UISafeAreaEdgeAnchor.DoLayout(safe area, canvas): each edge from
  // the canvas rect (_target != 0) or the UISafeArea rect (here the canvas: no inset), _anchor 0 min + offset, 1 centre
  // + offset, 2 max - offset; pivot (0.5, 0.5) at the centre of the edges, no rotation, scale 1, size along both axes
  // (SetSizeWithCurrentAnchors). Parents are unrotated and unscaled (else raise).
  _edgeAnchors(root, W, H) {
    const walk = (n) => {
      if (!n.activeSelf) return;
      if (n.safeAreaEdgeAnchor) {
        const a = n.safeAreaEdgeAnchor, m = n.parent.matrix;
        if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1) throw new UIError(`${n.path}: edge anchor under a rotated or scaled parent`);
        const edge = (e, size) => {
          if (![0, 1, 2].includes(e._anchor)) throw new UIError(`${n.path}: edge anchor ${e._anchor}`);
          return e._anchor === 0 ? F(0 + e._offset) : e._anchor === 1 ? F(e._offset + F(size * 0.5)) : F(size - e._offset);
        };
        const l = edge(a._left, W), r = edge(a._right, W), t = edge(a._top, H), b = edge(a._bottom, H);
        const pr = n.parent.rect;
        n.pivot = { x: 0.5, y: 0.5 }; n.rotationZ = 0; n.euler = null; n.localScale = { x: 1, y: 1 };
        n.setSizeWithCurrentAnchors(0, F(r - l)); n.setSizeWithCurrentAnchors(1, F(t - b));
        const refX = F(F(pr.x + F(n.anchorMin.x * pr.w)) + F(F(F(n.anchorMax.x - n.anchorMin.x) * pr.w) * 0.5));
        const refY = F(F(pr.y + F(n.anchorMin.y * pr.h)) + F(F(F(n.anchorMax.y - n.anchorMin.y) * pr.h) * 0.5));
        n.anchoredPosition = { x: F(F(F(F(l + r) * 0.5) - m[4]) - refX), y: F(F(F(F(t + b) * 0.5) - m[5]) - refY) };
        n.layoutIn(pr, m);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
  }

  // ------------------------------------------------------------ canvas geometry
  // paint order and inherited alpha: UIDraw.list; an image before the text of the same node
  drawList(root) {
    return UIDraw.list(root, (n, alpha) => {
      const out = [];
      if (n.image && n.image.m_Enabled) out.push(this._imageItem(n, alpha));
      if (n.text && n.text.enabled) out.push(...this._textItems(n, alpha));
      return out;
    });
  }

  _imageItem(n, alpha) {
    const img = n.image, sp = img.spriteObj;
    let mesh = UIImage.build(n, img, sp, this.scaler.m_ReferencePixelsPerUnit);
    if (n.gradient) mesh = UIGradientMod.apply(mesh, n.gradient);
    return { node: n, kind: n === this.part.rule ? "rule" : "image", material: img.material,
             texture: sp ? sp.texture.name : null, verts: UIDraw.pack(mesh.verts, n, alpha),
             idx: Uint32Array.from(mesh.idx), mesh };
  }

  // TextMeshProUGUI mesh per atlas page group (TMPText.meshes)
  _textItems(n, alpha) {
    const t = n.text;
    return t.meshes().map((m) => ({ node: n, kind: "text", material: t.materialName, texture: m.texture,
                                    verts: UIDraw.pack(m.verts, n, alpha, true), idx: Uint32Array.from(m.idx),
                                    chars: m.chars }));
  }

  // ------------------------------------------------------------ drawing
  _draw(it, globals) {
    const mat = this.materials[it.material];
    const tex = it.texture ? this.tex[it.texture] : this.solid.white;
    let sheet;
    if (it.kind === "rule") sheet = this.rule.sheet(mat);
    else if (it.kind === "text")                    // glyph page: _TextureWidth/Height = the page's size
      sheet = { _MainTex: tex, _TextureWidth: tex.width, _TextureHeight: tex.height };
    else                                            // Graphic: _TextureSampleAdd 0 for RGBA textures, _MainTex_ST unit
      sheet = { _MainTex: tex, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0],
                _ClipRect: [-32767, -32767, 32767, 32767] };
    UIDraw.draw(this.gl, this.lib, this.buf, mat, sheet, globals, it.verts, it.idx);
  }

  // views of the canvas layers from..to (ADV_CANVAS_LAYER), back to front, in the order added
  renderLayers(from, to, args) {
    for (let k = from; k <= to; k++) for (const v of this.layers[k].views) v.render(args);
  }

  // FrontCanvas onto the bound target (the post target, width x height = ADV viewport pixels). Views of the Chat ..
  // Still layers draw first, those of the Front and Talk layers after the canvas.
  render({ gl, width, height }) {
    const { W, H } = this.canvasSize(width, height);
    this.layout(W, H);
    const args = { gl, width, height, canvasWidth: W, canvasHeight: H };
    if (!this.gl) return;
    this.renderLayers(ADV_CANVAS_LAYER.Chat, ADV_CANVAS_LAYER.Still, args);
    const globals = UIDraw.globals(W, H, width, height, 4);
    gl.disable(gl.SCISSOR_TEST);
    for (const it of this.drawList(this.front)) this._draw(it, globals);
    this.renderLayers(ADV_CANVAS_LAYER.Front, ADV_CANVAS_LAYER.Talk, args);
  }

  // AdvLetterBoxCanvas (ScreenSpaceOverlay, no CanvasScaler: 1 unit = 1 screen pixel) onto the default framebuffer.
  // UIAdvWidget.UpdateLetterBoxBands runs when the viewport or the screen size changes (AdvViewportChanged);
  // viewport = {x, y, w, h} in pixels, GL bottom-left origin.
  renderLetterBox({ gl, screenWidth, screenHeight, viewport }) {
    this.letterBoxView.update(screenWidth, screenHeight, viewport);
    this._layoutRoot(this.letterBox, screenWidth, screenHeight);
    if (!this.gl || !this.letterBox.activeSelf) return;
    const globals = UIDraw.globals(screenWidth, screenHeight, screenWidth, screenHeight, 8);
    gl.disable(gl.SCISSOR_TEST);
    for (const it of this.drawList(this.letterBox)) this._draw(it, globals);
  }

  // ------------------------------------------------------------ initial state
  // UIAdvWidget.Init -> Refresh, in its order, for the parts in the data. Parts not in the data (CenterTalkBackdrop
  // alpha 0, NextButton and CancelFullScreenButton, the menu panel, choices, log) are invisible after Refresh.
  _refresh() {
    const p = this.part;
    if (p.flash) this._refreshFlash();               // AdvFlashView.Refresh
    this.setActive(p.location, false);               // AdvLocationView.Refresh: UIPart.Hide
    if (this._window) this.talk.refresh();           // AdvTalkView.Refresh: the attached window
    if (p.subtitles) this.clearSubtitles();          // AdvSubtitlesView.ClearSubtitles
    this._refreshMenu();                             // AdvMenuView.Refresh
    this.setActive(p.title, false);                  // AdvTitleView.Refresh: UIPart.Hide
    // AdvFrontScreenView.Refresh: _nextIndicator inactive, CancelFullScreenButton hidden, _uiContainer active
    if (p.frontNextIndicator) this.setActive(p.frontNextIndicator, false);
    this.setActive(p.uiContainer, true);
    this.rule.refresh();                             // UIRuleTransitionView.Refresh
    this.letterBoxView.refresh();                    // RefreshLetterBoxBands
    this._resetBlurAndBackdrop();                    // ResetAdvBlurAndBackdrop
  }

  // AdvMenuView.Refresh (parts in the data): MenuEntryButton / PauseVideoButton / SubtitlesButton ChangeNormalState,
  // FastForwardButton / AutoButton / SkipVideoButton UIPart.Show, _menuButtonsParent and _videoButtonParent inactive,
  // DOKill + alpha 1 on the menu CanvasGroup. The entry button pictogram keeps the prefab sprite sp_adv_open (the
  // ButtonImageState normal sprite).
  _refreshMenu() {
    const p = this.part;
    if (p.pauseVideoButton) this.resetPauseVideoButton();
    this.showFastForwardButton(); this.showAutoButton();
    if (p.skipVideoButton) this.setActive(p.skipVideoButton, true);
    if (p.menuButtonsParent) this.setActive(p.menuButtonsParent, false);
    if (p.videoButtonParent) this.setActive(p.videoButtonParent, false);
    if (p.menu && p.menu.canvasGroup) p.menu.canvasGroup.alpha = 1;
  }

  _need(part, what) {
    const n = this.part[part];
    if (!n) throw new StoryCommandError(`the story UI has no ${what} (not in the UI data)`);
    return n;
  }

  // Fwk.UI.UIWidget.TrueCanvasSortOrder: the sorting order of the widget's first canvas (_canvases[0]), 99999 without
  // canvases; null when the UI data does not carry the widget's canvas list (ui.json `widget`)
  get trueCanvasSortOrder() {
    const w = this.doc.widget;
    if (!w || !Array.isArray(w.canvases)) return null;
    return w.canvases.length ? w.canvases[0].sortingOrder : 99999;
  }

  // ------------------------------------------------------------ StoryUI: talk window
  // the attached window's StoryTalkWindow (AdvTalkView._window)
  get talk() { return this._window ? this._window.talk : null; }

  // UIAdvWidget.SetTalkWindow (TalkWindow command; AdvPlayer PlayInitialCommands attaches UIDefaultTalkWindow) ->
  // AdvTalkView.SetWindow: with a window attached, its data (UIAdvTalkWindow.GetData: speaker, talk text, talk area
  // and background shown) goes to the new one (ApplyData) and the old window's object goes inactive; else the new
  // window hides its talk at once. The new window's object goes active, becomes TalkView's last child at local
  // position 0 (ApplySafeAreaLayout: no safe-area inset here), and UpdateWindowStatus gives it the view's playback
  // speed and icon flags. Then UpdateAdvBlurAndBackdrop.
  setTalkWindow(name) {
    const w = this.windows.get(name);
    if (!w) throw new StoryCommandError(`talk window ${name} not in the UI data`);
    const old = this._window;
    if (old) {
      w.talk.applyData(old.talk.getData());
      this.setActive(old.node, false);
    } else w.talk.hideTalk(0);
    this._window = w;
    this.setActive(w.node, true);
    const siblings = w.node.parent.children;          // Transform.SetAsLastSibling
    siblings.splice(siblings.indexOf(w.node), 1); siblings.push(w.node);
    w.node.anchoredPosition = { x: 0, y: 0 };          // localPosition = 0 (stretched, centred pivot)
    this._updateWindowStatus();
    this._updateBlurAndBackdrop();
  }

  // AdvTalkView.UpdateWindowStatus: PlaybackSpeed, ShowAutoIcon / HideAutoIcon, ShowFastIcon / HideFastIcon
  _updateWindowStatus() {
    const t = this.talk;
    if (!t) return;
    t.playbackSpeed = this._view.playbackSpeed;
    t.setAutoMode(this._view.autoIcon);
    t.setFastIconActive(this._view.fastIcon);
  }

  // The position the talk shake moves (AdvTalkView.ShakeTalk: DOShakePosition on the window's transform; StopTalkShake
  // sets its anchoredPosition back to 0): the attached window root's anchored position (prefab (0, 0)) in canvas
  // units, read and written on the window attached at the time; z is kept for the tween only (canvas vertices have
  // z = 0). null while no window is attached.
  talkShakeTarget() {
    if (!this._window) return null;
    const cur = () => this._window.node;
    return { get: () => { const w = cur(); return { x: w.anchoredPosition.x, y: w.anchoredPosition.y, z: w.shakeZ || 0 }; },
             set: (v) => { const w = cur(); w.anchoredPosition.x = v.x; w.anchoredPosition.y = v.y; w.shakeZ = v.z; } };
  }

  // UIAdvWidget.ShowTalk / HideTalk: AdvTalkView.ShowTalk / HideTalk (the attached window, 0.2 s), then
  // UpdateAdvBlurAndBackdrop
  showTalk(duration = 0.2) { if (this.talk) this.talk.showTalk(duration); this._updateBlurAndBackdrop(); }
  hideTalk(duration = 0.2) { if (this.talk) this.talk.hideTalk(duration); this._updateBlurAndBackdrop(); }
  // UIAdvWidget.IsShowingTalk: a window is attached and its TalkArea is active
  isShowingTalk() { return !!this._window && this._window.part.talkArea.activeSelf; }
  hideTalkNextIndicator() { if (this.talk) this.talk.hideTalkNextIndicator(); }
  setSpeakerName(text) { if (this.talk) this.talk.setSpeakerName(text); }
  setTalk(text) {
    if (!this.talk) throw new StoryCommandError("Talk before a talk window is attached");
    return this.talk.setTalk(text);
  }
  get isTyping() { return !!this.talk && this.talk.isTyping; }
  // AdvTalkView.SetAutoIconActive / SetFastIconActive: the view's flag, then UpdateWindowStatus
  setAutoMode(on) { this._view.autoIcon = !!on; this._updateWindowStatus(); }
  setFastIconActive(on) { this._view.fastIcon = !!on; this._updateWindowStatus(); }

  // ------------------------------------------------------------ centre-talk backdrop
  // UIAdvWidget.IsCenterTalkBackdropVisible: the attached window uses the backdrop filter and its TalkArea is active
  _isCenterTalkBackdropVisible() {
    const w = this._window;
    return !!w && w.talk.useBackdropFilter && w.part.talkArea.activeSelf;
  }

  // UIAdvWidget.UpdateAdvBlurAndBackdrop -> UpdateCenterTalkBackdropFilter(visible, window): DOKill on the backdrop
  // CanvasGroup; shown: the Image colour = the window's _backdropFilterColor, then DOFade(1, 0.2) unless the alpha is
  // already Mathf.Approximately 1; hidden: alpha 0 at once. The backdrop exists in the data whenever a window uses it.
  _updateBlurAndBackdrop() {
    const b = this.part.centerTalkBackdrop;
    if (!b) return;
    const visible = this._isCenterTalkBackdropVisible();
    if (this._backdropFade) { this._backdropFade.kill(); this._backdropFade = null; }
    const cg = b.canvasGroup;
    if (!visible) { cg.alpha = 0; return; }
    const c = this._window.talk.rec._backdropFilterColor;
    b.image.m_Color = { r: c.r, g: c.g, b: c.b, a: c.a };
    const a = cg.alpha;
    if (Math.abs(1 - a) < Math.max(F(Math.max(Math.abs(a), 1) * 1e-6), F(1.401298464324817e-45 * 8))) return;
    this._backdropFade = new UITween(this.tweens, { duration: BACKDROP_FADE, getFrom: () => cg.alpha, to: 1,
                                                    ease: this.doc.dotween.defaultEaseType, apply: (v) => { cg.alpha = v; } });
  }

  // UIAdvWidget.ResetAdvBlurAndBackdrop: DOKill on the backdrop CanvasGroup, alpha 0
  _resetBlurAndBackdrop() {
    const b = this.part.centerTalkBackdrop;
    if (this._backdropFade) { this._backdropFade.kill(); this._backdropFade = null; }
    if (b) b.canvasGroup.alpha = 0;
  }

  // UIAdvWidget.SetPlaybackSpeed: talk window PlaybackSpeed (read by the next StartTyping), Location / Title views:
  // Animator.speed and DOTweenSequence.SetTimeScale (ts <= 0 -> 1). The talk window's indicator Animators keep speed 1
  // (no setter on the paths read).
  setPlaybackSpeed(rate) {
    this._view.playbackSpeed = rate;                 // AdvTalkView.SetPlaybackSpeed -> UpdateWindowStatus
    this._updateWindowStatus();
    const ts = rate <= 0 ? 1 : rate;
    for (const n of [this.part.location, this.part.title]) {
      n.animator.speed = rate;
      n.sequenceTimeScale = ts;
      if (n.sequence) n.sequence.timeScale = ts;
    }
  }

  // ------------------------------------------------------------ flash, subtitles, front next indicator
  // AdvFlashView.Refresh: DOKill(_flash) (a pending Flash await ends and hides the view), inactive, colour (1, 1, 1, 1)
  _refreshFlash() {
    if (this._flash) this._flash.kill();
    const f = this.part.flash;
    this.setActive(f, false);
    f.image.m_Color = { r: 1, g: 1, b: 1, a: 1 };
  }

  // UIAdvWidget.Flash -> AdvFlashView.Flash(duration): DOKill(_flash); active; colour (1, 1, 1, 1);
  // await _flash.DOFade(0, duration) (default ease) .ToUniTask; inactive. Resolves when the view is hidden.
  // ENGINE: UniTask's DOTween awaiter completes on the tween's kill callback, so a flash killed by the next Flash call (or Refresh) ends its await inside DOKill and hides the view before the new flash shows it.
  flash(duration) {
    const f = this._need("flash", "flash view");
    if (this._flash) this._flash.kill();
    this.setActive(f, true);
    const color = { r: 1, g: 1, b: 1, a: 1 };
    f.image.m_Color = color;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const rec = {};
    const end = () => {
      if (this._flash !== rec) return;
      this._flash = null;
      this.setActive(f, false);
      resolve();
    };
    const tw = new UITween(this.tweens, { duration, getFrom: () => color.a, to: 0, ease: this.doc.dotween.defaultEaseType,
                                          apply: (v) => { color.a = v; }, onComplete: end });
    rec.kill = () => { tw.kill(); end(); };
    this._flash = rec;
    return done;
  }

  // AdvSubtitlesView: ShowSubtitles (remember, _subtitlesText.SetText, _subtitles active), UpdateHiddenSubtitles
  // (remember, inactive), HideSubtitles (inactive, text kept), ClearSubtitles (forget, SetText(""), inactive),
  // RestoreSubtitlesIfAny (the remembered text shown again when not empty). No tween.
  showSubtitles(text) {
    const v = this._need("subtitles", "subtitles view");
    this._lastSubtitles = text;
    this.part.subtitlesText.storyText.setText(text);
    this.setActive(v, true);
  }

  updateHiddenSubtitles(text) {
    const v = this._need("subtitles", "subtitles view");
    this._lastSubtitles = text;
    this.setActive(v, false);
  }

  hideSubtitles() { this.setActive(this._need("subtitles", "subtitles view"), false); }

  clearSubtitles() {
    const v = this._need("subtitles", "subtitles view");
    this._lastSubtitles = "";
    this.part.subtitlesText.storyText.setText("");
    this.setActive(v, false);
  }

  restoreSubtitlesIfAny() {
    const v = this._need("subtitles", "subtitles view");
    if (!this._lastSubtitles) return;
    this.part.subtitlesText.storyText.setText(this._lastSubtitles);
    this.setActive(v, true);
  }

  // UIAdvWidget.ShowNextIndicator / HideNextIndicator / IsShowingNextIndicator: the front NextIndicator
  // (AdvFrontScreenView._nextIndicator) SetActive / activeSelf; its IndicatorIcon Animator restarts on enable
  showNextIndicator() { this.setActive(this._need("frontNextIndicator", "front next indicator"), true); }
  hideNextIndicator() { this.setActive(this._need("frontNextIndicator", "front next indicator"), false); }
  isShowingNextIndicator() { return this._need("frontNextIndicator", "front next indicator").activeSelf; }

  // ------------------------------------------------------------ menu buttons
  // UIAdvWidget.ShowVideoButtons(showSkip) -> AdvMenuView.ShowVideoButtons: SkipVideoButton UIPart Show / Hide, then
  // _videoButtonParent active; HideVideoButtons: _videoButtonParent inactive
  showVideoButtons(showSkip) {
    const root = this._need("videoButtonParent", "video buttons");
    this.setActive(this._need("skipVideoButton", "skip video button"), !!showSkip);
    this.setActive(root, true);
  }

  hideVideoButtons() { this.setActive(this._need("videoButtonParent", "video buttons"), false); }

  // PauseVideoButton.ChangeNormalState: the ButtonImageState target shows the normal sprite
  resetPauseVideoButton() {
    const b = this._need("pauseVideoButton", "pause video button"), st = b.rec.buttonImageState;
    if (!st) throw new UIError(`${b.path}: no ButtonImageState`);
    const target = this.nodes.get(st.target), sp = this.sprites.get(st.normal);
    if (!target || !target.image || !sp) throw new UIError(`${b.path}: ButtonImageState target or sprite not in the data`);
    target.image.spriteObj = sp;
  }

  // AutoButton / FastForwardButton UIPart.Show / Hide (menu panel buttons)
  _setMenuButton(key, v) {
    this._menuButtons[key] = v;
    if (this.part[key]) this.setActive(this.part[key], v);
  }

  showAutoButton() { this._setMenuButton("autoButton", true); }
  hideAutoButton() { this._setMenuButton("autoButton", false); }
  showFastForwardButton() { this._setMenuButton("fastForwardButton", true); }

  // ------------------------------------------------------------ location caption and episode title
  // SimpleAnimationTrigger.PlayAnimation: nothing when the object is inactive in the hierarchy, else
  // Animator.CrossFade(state, _blendTime 0, layer 0, normalizedTimeOffset 0) (UIAnimator.play)
  _playAnimation(node, state) {
    if (!node.activeInHierarchy) return;
    node.animator.play(state);
  }

  // DOTweenSequence.DOPlayAsync: DOKill, CreateSequence (CustomEvent -> InsertCallback at the cursor; the cursor
  // advances by _duration when > 0; timeScale = the view's playback speed), Play, then WaitWhile(IsPlaying) at
  // PlayerLoopTiming.Update. The CustomEvent of both views calls SimpleAnimationTrigger.PlayAnimation("Play").
  _playSequence(node) {
    const ts = node.rec.tweenSequence;
    if (!ts || ts.raw.updateType !== 0 || ts.raw.isSpeedBased) throw new UIError(`${node.path}: DOTweenSequence settings`);
    if (node.sequence) { node.sequence.kill(); node.sequence = null; }
    let at = 0;
    const at0 = [];
    for (const cmd of ts.list) {
      if (cmd._commandType !== 1 || at !== 0) throw new UIError(`${node.path}: sequence command outside the implemented subset`);
      at0.push(() => this._playAnimation(node, "Play"));
      if (cmd._duration > 0) at += cmd._duration;
    }
    const seq = new UITween(this.tweens, { duration: at, timeScale: node.sequenceTimeScale || 1, at0 });
    node.sequence = seq;
    return (async () => { do { await this.loop.yield("Update"); } while (seq.isActive); })();
  }

  // UIAdvWidget.ShowLocation -> AdvLocationView.ShowLocation: UIPart.Show(), text (TMP text property), await the
  // sequence (completes after 2.5 s / speed)
  showLocation(name) {
    const p = this.part;
    this.setActive(p.location, true);
    p.locationText.storyText.setText(name);
    return this._playSequence(p.location);
  }

  // AdvTitleView.ShowTitle: UIPart.Show(), text, sequence of duration 0 (returns on the next tick); never hidden
  // afterwards (the clip ends at alpha 0)
  showTitle(text) {
    const p = this.part;
    this.setActive(p.title, true);
    p.titleText.storyText.setText(text);
    return this._playSequence(p.title);
  }

  // ------------------------------------------------------------ fades and letterbox
  transitionSettings(address) { return this.rule.settings(address); }
  fadeOut(settings, color, dur) { return this.rule.animate(settings, color, dur, 1, -1, false); }
  fadeIn(settings, color, dur) { return this.rule.animate(settings, color, dur, -1, 1, true); }
  fadeInLetterBox() { return this.letterBoxView.fadeIn(); }

  // UIAdvWidget.OnUpdated (GameMain.Update chain) -> UpdateLetterBoxFade
  _onUpdated(dt) {
    this.letterBoxView.updateFade(dt);
    for (let k = 0; k < this.layers.length; k++) for (const v of this.layers[k].views) if (v.update) v.update(dt);
  }

  // Animators of active objects (PreLateUpdate DirectorUpdateAnimation, Normal update mode: scaled delta *
  // Animator.speed). UI tweens step in the loop's "tweens" phase.
  _animate(dt) {
    for (const a of this.animators) if (a.node.activeInHierarchy) a.update(dt);
  }
}
