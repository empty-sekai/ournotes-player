// The story's front canvas (src/story/ui.js, ui-talk.js, ui-ruby.js, ui-transition.js) on a synthetic UI document
// with the prefab geometry of the default talk window, title, location caption, flash, subtitles, front next
// indicator, video buttons, rule transition and letterbox bands, and a synthetic font asset: state after Refresh,
// talk window fade, typewriter frames per language and speed, cancel, speaker plate layout, title / location timing,
// ruby rewrite and ruby margin, flash fade, subtitles, video buttons, the talk window's optional parts, rule fade,
// letterbox bands and fade, text checks, the StoryUI contract. No GL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { StoryCommandError, checkStoryUI } from "../../src/story/interfaces.js";
import { StoryUI } from "../../src/story/ui.js";
import { hasRubyInFirstLine, netSingleToString, replaceRubyTags } from "../../src/story/ui-ruby.js";
import { StoryTalkWindow, countRenderedCharacters, removeTagsKeepingRuby, removeTagsWithRuby } from "../../src/story/ui-talk.js";

const close = (a, b, eps = 1e-4, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

// ------------------------------------------------------------------------------------------------ synthetic data
const v2 = (x, y) => ({ x, y });
const node = (path, { aMin = [0, 0], aMax = [1, 1], pos = [0, 0], size = [0, 0], pivot = [0.5, 0.5], active = 1, ...rest } = {}) => ({
  path, name: path.slice(path.lastIndexOf("/") + 1), active, localPosition: { x: 0, y: 0, z: 0 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  rect: { m_AnchorMin: v2(...aMin), m_AnchorMax: v2(...aMax), m_AnchoredPosition: v2(...pos), m_SizeDelta: v2(...size),
          m_Pivot: v2(...pivot) }, ...rest,
});
const white = { r: 1, g: 1, b: 1, a: 1 };
const image = (sprite = null) => ({ m_Enabled: 1, m_Color: white, m_Type: 0, m_PreserveAspect: 0, m_FillCenter: 1,
                                    m_UseSpriteMesh: 0, m_PixelsPerUnitMultiplier: 1, sprite, material: null });
const group = (alpha = 1) => ({ m_Enabled: 1, m_Alpha: alpha, m_IgnoreParentGroups: 0 });
const animator = (controller) => ({ controller, enabled: 1, updateMode: 0, keepStateOnDisable: 0 });
const hlg = (left, right) => ({ m_Enabled: 1, class: "HorizontalLayoutGroup", m_Padding: { m_Left: left, m_Right: right, m_Top: 0, m_Bottom: 0 },
                                m_Spacing: 0, m_ChildAlignment: 3, m_ChildControlWidth: 1, m_ChildControlHeight: 0,
                                m_ChildForceExpandWidth: 0, m_ChildForceExpandHeight: 0, m_ChildScaleWidth: 0,
                                m_ChildScaleHeight: 0, m_ReverseArrangement: 0 });
const fitter = { m_Enabled: 1, m_HorizontalFit: 2, m_VerticalFit: 0 };
const F0 = "UIAdvWidget/FrontCanvas", C = `${F0}/UISafeArea/UIContainer`, W = `${C}/TalkView/UIDefaultTalkWindow`;
const K = `${W}/TalkArea/Content`, L = "UIAdvWidget/AdvLetterBoxCanvas";
const style = { fontRole: "primary" };

const M = `${C}/MenuView`;
// the centre window prefab (UICenterTalkWindow) under TalkView and the widget's CenterTalkBackdrop
const CW = `${C}/TalkView/UICenterTalkWindow`;
const centerNodes = () => [
  node(CW, { talkWindow: { _typingDelay: F(0.05), _useBackdropFilter: 1, _safeAreaTalkBackgroundExpansionFactor: 2,
                           _backdropFilterColor: { r: 0, g: 0, b: 0, a: F(0.4) }, _talkTextColor: { r: 1, g: 1, b: 1, a: 1 },
                           _talkTextOutlineColor: { r: F(0.0941176), g: F(0.0705882), b: F(0.1607843), a: F(0.4) } } }),
  node(`${CW}/TalkBackground`, { aMin: [0, 0.5], aMax: [1, 0.5], size: [0, 200], image: { ...image(), m_Enabled: 0 }, canvasGroup: group() }),
  node(`${CW}/TalkArea`, { aMin: [0, 0.5], aMax: [1, 0.5], size: [0, 200] }),
  node(`${CW}/TalkArea/Indicator`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], pos: [640, -127], size: [100, 100], active: 0 }),
  node(`${CW}/TalkArea/Content`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [1140, 0],
                                   layoutGroup: { ...hlg(0, 0), m_ChildAlignment: 4, m_Spacing: 40, m_ChildControlHeight: 1, m_ChildForceExpandWidth: 1 },
                                   contentSizeFitter: { m_Enabled: 1, m_HorizontalFit: 0, m_VerticalFit: 2 } }),
  node(`${CW}/TalkArea/Content/TalkText`, { aMin: [0, 0], aMax: [0, 0], pivot: [0, 1], textStyle: style }),
];
const withCenter = (doc) => {
  const i = doc.nodes.findIndex((n) => n.path === `${C}/NextIndicator`);
  doc.nodes.splice(i, 0, ...centerNodes());
  const f = doc.nodes.findIndex((n) => n.path === `${F0}/FlashView`);
  doc.nodes.splice(f, 0, node(`${F0}/CenterTalkBackdrop`, { image: { ...image(), m_Color: { r: 0, g: 0, b: 0, a: F(0.4) } }, canvasGroup: group(0) }));
  return doc;
};
const uiDoc = () => ({
  nodes: [
    node("UIAdvWidget/VideoCanvas", { canvas: { m_Enabled: 1, m_RenderMode: 1, m_PixelPerfect: 0 } }),   // drawn by its feature
    node("UIAdvWidget/VideoCanvas/VideoView", { image: image("nope") }),
    node(F0, { canvas: { m_Enabled: 1, m_RenderMode: 1, m_PixelPerfect: 0 },
               canvasScaler: { m_Enabled: 1, m_UiScaleMode: 1, m_ReferencePixelsPerUnit: 100, m_ScaleFactor: 1,
                               m_ReferenceResolution: v2(1920, 1080), m_ScreenMatchMode: 1, m_MatchWidthOrHeight: 1 } }),
    node(`${F0}/FlashView`, { image: image(), flashView: { enabled: 1, _flash: `${F0}/FlashView` } }),
    node(`${F0}/RuleTransition`, { active: 0, image: image(), ruleTransition: { material: "UI-Transition" } }),
    node(`${F0}/LocationVIew`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [1400, 86], active: 0, canvasGroup: group(),
                                 animator: animator("AdvLocation"),
                                 tweenSequence: { list: [{ _commandType: 1, _duration: 2.5 }], raw: { updateType: 0, isSpeedBased: 0 } } }),
    node(`${F0}/LocationVIew/LocationText`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [1400, 62], textStyle: style }),
    node(`${F0}/UISafeArea`), node(C),
    node(`${C}/SubtitlesView`, { subtitlesView: { enabled: 1, _subtitles: `${C}/SubtitlesView/SubtitlesText`,
                                                  _subtitlesText: `${C}/SubtitlesView/SubtitlesText` } }),
    node(`${C}/SubtitlesView/SubtitlesText`, { aMin: [0, 0], aMax: [1, 0], pos: [0, 60], size: [0, 141], pivot: [0.5, 0], textStyle: style }),
    node(`${C}/TalkView`),
    node(W, { talkWindow: { _typingDelay: F(0.05), _useBackdropFilter: 0 } }),
    node(`${W}/TalkBackground`, { aMin: [0, 0], aMax: [1, 0], pos: [0, -66], size: [800, 356], pivot: [0.5, 0], image: image(), canvasGroup: group() }),
    node(`${W}/TalkArea`, { aMin: [0, 0], aMax: [1, 0] }),
    node(K, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [1580, 0] }),
    node(`${K}/TalkText`, { aMin: [0, 0.5], aMax: [0, 0.5], pos: [198.71, 201.91], size: [1200, 200], pivot: [0, 1], textStyle: style }),
    node(`${K}/TalkNextIndicator`, { aMin: [1, 0], aMax: [1, 0], pos: [-152, 76], size: [60, 60], active: 0, image: image(),
                                     animator: animator("NextIndicator") }),
    node(`${K}/AutoIcon`, { aMin: [1, 0], aMax: [1, 0], pos: [-152, 76], size: [60, 60], active: 0, animator: animator("AutoNext") }),
    node(`${K}/FastIcon`, { aMin: [1, 0], aMax: [1, 0], pos: [-60, 76], size: [60, 60], active: 0 }),
    node(`${K}/Speaker`, { aMin: [0, 0.5], aMax: [0, 0.5], pos: [184, 285], size: [800, 60], pivot: [0, 0.5] }),
    node(`${K}/Speaker/Back`, { aMin: [0, 0.5], aMax: [0, 0.5], pos: [0, -26.9], size: [0, 60], pivot: [0, 0.5],
                                layoutGroup: hlg(20, 80), contentSizeFitter: fitter }),
    node(`${K}/Speaker/Back/SpeakerText`, { aMin: [0, 0], aMax: [0, 0], size: [0, 36], textStyle: style }),
    node(`${C}/NextIndicator`, { aMin: [1, 0], aMax: [1, 0], pos: [-60, -25], size: [28, 19] }),
    node(`${C}/NextIndicator/IndicatorIcon`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], pos: [0, 68], size: [28, 19], image: image("next"),
                                                animator: animator("NextIndicator") }),
    node(M, { canvasGroup: group() }), node(`${M}/MenuEntryButton`, { aMin: [1, 1], aMax: [1, 1], pos: [-84, -8], size: [120, 120], pivot: [1, 1] }),
    node(`${M}/VideoButtons`, { layoutGroup: { ...hlg(0, 0), m_ChildAlignment: 4, m_Spacing: 30, m_ChildControlWidth: 0 } }),
    node(`${M}/VideoButtons/BlackFilter`, { pivot: [1, 1], image: { ...image(), m_Color: { r: 0, g: 0, b: 0, a: 0.4 } },
                                            layoutElement: { m_Enabled: 1, m_IgnoreLayout: 1, m_LayoutPriority: 1, m_MinWidth: -1,
                                                             m_PreferredWidth: -1, m_FlexibleWidth: -1 },
                                            safeAreaEdgeAnchor: { enabled: 1, _left: { _target: 1, _anchor: 0, _offset: 0 },
                                                                  _right: { _target: 1, _anchor: 2, _offset: 0 },
                                                                  _top: { _target: 1, _anchor: 2, _offset: 0 },
                                                                  _bottom: { _target: 1, _anchor: 0, _offset: 0 } } }),
    node(`${M}/VideoButtons/PauseButton`, { aMin: [0, 0], aMax: [0, 0], size: [180, 180],
                                            buttonImageState: { normal: "stop", selected: "play", target: `${M}/VideoButtons/PauseButton/IconImage` } }),
    node(`${M}/VideoButtons/PauseButton/IconImage`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], size: [180, 180], image: image("stop") }),
    node(`${M}/VideoButtons/SkipButton`, { aMin: [0, 0], aMax: [0, 0], size: [180, 180] }),
    node(`${C}/TitleView`, { aMin: [0, 1], aMax: [0, 1], active: 0, canvasGroup: group(), animator: animator("AdvTitle"),
                             tweenSequence: { list: [{ _commandType: 1, _duration: 0 }], raw: { updateType: 0, isSpeedBased: 0 } } }),
    node(`${C}/TitleView/Title`, { aMin: [0.5, 0.5], aMax: [0.5, 0.5], pos: [0, -30], size: [0, 60], pivot: [0, 1],
                                   layoutGroup: hlg(40, 0), contentSizeFitter: fitter }),
    node(`${C}/TitleView/Title/TitleText`, { size: [0, 60], aMin: [0, 0], aMax: [0, 0], textStyle: style }),
    node(`${C}/TitleView/Title/Padding`, { size: [0, 60], aMin: [0, 0], aMax: [0, 0],
                                           layoutElement: { m_Enabled: 1, m_IgnoreLayout: 0, m_LayoutPriority: 1, m_MinWidth: 364.5,
                                                            m_PreferredWidth: -1, m_FlexibleWidth: -1 } }),
    node(L, { canvas: { m_Enabled: 1, m_RenderMode: 0, m_PixelPerfect: 0 } }),
    node(`${L}/TopBand`, { aMin: [0, 1], aMax: [1, 1], pivot: [0.5, 0], active: 0, image: image() }),
    node(`${L}/BottomBand`, { aMin: [0, 0], aMax: [1, 0], pivot: [0.5, 1], active: 0, image: image() }),
  ],
  sprites: Object.fromEntries(["letterbox", "next", "stop", "play"].map((n) => [n, {
    texture: "lb", rect: { x: 0, y: 0, width: 1920, height: 1440 }, textureRect: { x: 0, y: 0, width: 1920, height: 1440 },
    textureRectOffset: { x: 0, y: 0 }, border: { x: 0, y: 0, z: 0, w: 0 }, pivot: v2(0.5, 0.5), pixelsPerUnit: 100 }])),
  letterBoxSprite: "letterbox",
  textures: { lb: { texture: "textures/lb.png", width: 1920, height: 1440, mipCount: 1 } },
  materials: { "UI-Transition": { material: "UI-Transition", shader: { shader: "UI/Transition" }, keywords: [], floats: { _Val: 1, _UseGradient: 0 },
                                  colors: { _Color: { r: 0, g: 0, b: 0, a: 1 } } },
               "Default UI Material": { material: "Default UI Material", shader: { shader: "UI/Default" }, keywords: [], floats: {}, colors: {} } },
  materialKeywords: {},
  clips: {
    "NextIndicator/Loop": { name: "Loop", startTime: 0, stopTime: 0.9166667, loopTime: 1, events: [],
                            curves: { "RectTransform.m_AnchoredPosition.y": { keys: [[0, 2000, -600, 0, 76], [0.2, -2596.544678, 714.049683, 0, 68], [0.3833333, 0, 0, 0, 76]] } } },
    "AutoNext/Loop": { name: "Loop", startTime: 0, stopTime: 2, loopTime: 1, events: [],
                       curves: { "Transform.localEulerAngles.z": { keys: [[0, -89.75, 269.25, 0, 0]] } } },
    "AdvLocation/Play": { name: "Play", startTime: 0, stopTime: 2.5, loopTime: 0, events: [],
                          curves: { "CanvasGroup.m_Alpha": { keys: [[0, -74.074066, 33.333332, 0, 0], [0.3, 0, 0, 0, 1], [2, 74.07412, -33.333347, 0, 1], [2.3, 0, 0, 0, 0]] },
                                    "RectTransform.m_AnchoredPosition.x": { keys: [[0, 4800, -3600, 0, 300], [0.5, 0, 0, 0, 0], [2, 4800, -3600, 0, 0]] } } },
    "AdvTitle/Play": { name: "Play", startTime: 0, stopTime: 6, loopTime: 0, events: [],
                       curves: { "CanvasGroup.m_Alpha": { keys: [[0, 0, 0, 0, 1], [5, 2, -3, 0, 1], [6, 0, 0, 0, 0]] },
                                 "RectTransform.m_AnchoredPosition.x": { keys: [[0, 0, 0, 0, 0], [5, 600, -900, 0, 0]] } } },
  },
  controllers: {
    NextIndicator: { name: "NextIndicator", defaultState: "Loop", states: [{ name: "Loop", speed: 1, clip: "Loop" }] },
    AutoNext: { name: "AutoNext", defaultState: "Loop", states: [{ name: "Loop", speed: -1, clip: "Loop" }] },
    AdvLocation: { name: "AdvLocation", defaultState: "Idle", states: [{ name: "Idle", speed: 1, clip: "Idle" }, { name: "Play", speed: 1, clip: "Play" }] },
    AdvTitle: { name: "AdvTitle", defaultState: "Idle", states: [{ name: "Idle", speed: 1, clip: "Idle" }, { name: "Play", speed: 1, clip: "Play" }] },
  },
  transitions: { "adv_transition_0001/adv_transition_0001": {
    _texture: { texture: "lb", name: "rule" }, _gradient: 0,
    _easingCurve: { m_Curve: [{ time: 0, value: 0, inSlope: 1, outSlope: 1, weightedMode: 0 }, { time: 1, value: 1, inSlope: 1, outSlope: 1, weightedMode: 0 }] } } },
  playerSettings: { _defaultTransitionAssetAddress: "adv_transition_0001/adv_transition_0001", _waitTalkTextUnitTime: 0.04 },
  dotween: { defaultEaseType: 6 },
  shaders: { index: "shaders/shaders.json", names: [] },
});

// glyphs: 50 x 70, bearing (5, 70), advance 60 at point size 100; space advance 30
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?.,一二三。";
const fontAsset = () => {
  const characters = {}, glyphs = {};
  [...CHARS].forEach((ch, i) => {
    const gi = i + 1, space = ch === " ";
    characters[String(ch.codePointAt(0))] = { glyph: gi, scale: 1, elementType: 1 };
    glyphs[String(gi)] = { metrics: space ? { m_Width: 0, m_Height: 0, m_HorizontalBearingX: 0, m_HorizontalBearingY: 0, m_HorizontalAdvance: 30 }
                                          : { m_Width: 50, m_Height: 70, m_HorizontalBearingX: 5, m_HorizontalBearingY: 70, m_HorizontalAdvance: 60 },
                           rect: { m_X: (i % 16) * 64 + 8, m_Y: Math.floor(i / 16) * 96 + 8, m_Width: space ? 0 : 50, m_Height: space ? 0 : 70 },
                           scale: 1, atlasIndex: 0, packed: { texture: "page0", dx: 0, dy: 0 } };
  });
  return { faceInfo: { m_PointSize: 100, m_Scale: 1, m_LineHeight: 120, m_AscentLine: 90, m_DescentLine: -30, m_Baseline: 0, m_TabWidth: 25 },
           normalStyle: 0, normalSpacingOffset: 0, boldStyle: 0.75, boldSpacing: 7, tabSize: 10, characters, glyphs,
           glyphPairAdjustmentRecords: 0, fallbacks: [] };
};
const tmp = (cls, over) => ({
  class: cls, enabled: 1, m_fontSize: 36, m_fontSizeBase: 36, m_enableAutoSizing: 0, m_fontSizeMin: 18, m_fontSizeMax: 36,
  m_charWidthMaxAdj: 0, m_lineSpacingMax: 0, m_fontStyle: 0, m_HorizontalAlignment: 1, m_VerticalAlignment: 256,
  m_characterSpacing: 2, m_wordSpacing: 0, m_paragraphSpacing: 0, m_TextWrappingMode: 0, m_overflowMode: 0,
  m_isRichText: 1, m_parseCtrlCharacters: 1, m_overrideHtmlColors: 0, m_useMaxVisibleDescender: 1,
  m_margin: { x: 0, y: 0, z: 0, w: 0 }, m_fontColor: white, m_ActiveFontFeatures: [], m_isOrthographic: 1,
  m_isRightToLeft: 0, m_enableVertexGradient: 0, m_characterHorizontalScale: 1, m_horizontalMapping: 0,
  m_verticalMapping: 0, m_enableExtraPadding: 0,
  localized: { fontAsset: "Test SDF", material: "Test - Default", lineSpacing: 5 }, ...over,
});
const RUBY = { _rubyVerticalOffset: "1em", _rubyScale: 0.5, _rubyLineHeight: "", _rubyShowType: 0, _rubyMargin: 10 };
const rubyText = (top) => ({ ruby: RUBY, uiRubyText: { _rubyMarginTop: top } });
const withCenterFonts = (fonts) => {
  fonts.materials["Test - Outline"] = { material: "Test - Outline", shader: { shader: "TextMeshPro/Mobile/Distance Field" }, keywords: ["OUTLINE_ON"],
                                        floats: { _GradientScale: 10, _ScaleRatioA: 1, _ScaleRatioC: 1, _OutlineWidth: 0.4, _FaceDilate: 0.4 },
                                        colors: { _OutlineColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 } } };
  fonts.materialKeywords["Test - Outline"] = ["OUTLINE_ON"];
  fonts.lineBreaking = { leading: "", following: "。", useModernHangulLineBreakingRules: false };   // TMP_Settings rules
  fonts.texts[`${CW}/TalkArea/Content/TalkText`] = tmp("RubyEmojiTextMeshProUGUI", {
    m_HorizontalAlignment: 2, m_VerticalAlignment: 256, m_TextWrappingMode: 1,
    localized: { fontAsset: "Test SDF", material: "Test - Outline", lineSpacing: 5 }, ...rubyText(-22) });
  return fonts;
};
const fontsDoc = (koAdjust = null) => ({
  language: "zh-Hant", source: "open", fonts: { "Test SDF": fontAsset() },
  textures: { page0: { texture: "fonts/page0.png", width: 1024, height: 1024, mipCount: 1 } },
  materials: { "Test - Default": { material: "Test - Default", shader: { shader: "TextMeshPro/Mobile/Distance Field" }, keywords: [],
                                   floats: { _GradientScale: 10, _ScaleRatioA: 1, _ScaleRatioC: 1 }, colors: {} } },
  materialKeywords: { "Test - Default": [] },
  texts: {
    [`${K}/TalkText`]: tmp("RubyEmojiTextMeshProUGUI", rubyText(-22)),
    [`${K}/Speaker/Back/SpeakerText`]: tmp("RubyTextMeshProUGUI", { m_fontStyle: 1, m_VerticalAlignment: 512, m_TextWrappingMode: 1, ...rubyText(-24) }),
    [`${F0}/LocationVIew/LocationText`]: tmp("RubyTextMeshProUGUI", { m_fontSize: 40, m_fontStyle: 1, m_HorizontalAlignment: 2, m_VerticalAlignment: 512,
                                                                     ...rubyText(0) }),
    [`${C}/SubtitlesView/SubtitlesText`]: tmp("RubyTextMeshProUGUI", { m_fontStyle: 1, m_HorizontalAlignment: 2, m_VerticalAlignment: 1024,
                                                                      ...rubyText(0) }),
    [`${C}/TitleView/Title/TitleText`]: tmp("TextMeshProUGUI", { m_fontSize: 40, m_fontSizeBase: 40, m_enableAutoSizing: 1, m_fontSizeMin: 24,
                                                                  m_fontSizeMax: 40, m_fontStyle: 1, m_VerticalAlignment: 512,
                                                                  ...(koAdjust ? { localizeKoreanAdjust: koAdjust } : {}) }),
  },
  coverage: { characters: CHARS.length, missing: [] },
});
const create = ({ mode = 2, lang = "zh-Hant", koAdjust = null, doc = uiDoc(), fonts = fontsDoc(koAdjust), attach = true } = {}) => {
  const loop = new PlayerLoop(30);
  const ui = new StoryUI(null, loop, doc, { lang, fonts, language: { language: lang, mode, lineSpacing: 5 } });
  if (attach) ui.setTalkWindow("UIDefaultTalkWindow");                  // AdvPlayer PlayInitialCommands
  return { loop, ui, step: async (n = 1) => { for (let i = 0; i < n; i++) await loop.step(); } };
};

// the parts of a talk window
const Win = (ui, name = "UIDefaultTalkWindow") => ui.windows.get(name).part;

// ------------------------------------------------------------------------------------------------ tests
test("StoryUI contract and the state after Refresh", () => {
  const { ui } = create({ attach: false });
  checkStoryUI(ui);
  assert.deepEqual(ui.talkWindows, ["UIDefaultTalkWindow"]);
  const P = ui.part, D = Win(ui);
  assert.equal(D.talkArea.activeSelf, false); assert.equal(P.location.activeSelf, false);
  assert.equal(P.title.activeSelf, false); assert.equal(P.rule.activeSelf, false);
  assert.equal(D.background.canvasGroup.alpha, 0);                       // HideTalk(0)
  assert.equal(D.speaker.activeSelf, false);
  assert.equal(P.flash.activeSelf, false); assert.equal(P.subtitles.activeSelf, false);
  assert.equal(P.frontNextIndicator.activeSelf, false); assert.equal(P.videoButtonParent.activeSelf, false);
  assert.equal(ui.nodes.has("UIAdvWidget/VideoCanvas"), false);          // the widget's other canvases are not built
  ui.layout(2340, 1080);
  assert.deepEqual(ui.drawList(ui.front).map((it) => it.node.name), []);  // no window attached yet
  assert.equal(ui.isShowingTalk(), false);
  assert.equal(ui.trueCanvasSortOrder, null);
  assert.equal(ui.talkShakeTarget(), null);
  assert.equal(ui.talk, null);
  ui.setTalkWindow("UIDefaultTalkWindow");
  assert.equal(D.window.activeSelf, true);
  assert.deepEqual(ui.drawList(ui.front).map((it) => it.node.name), ["TalkBackground"]);   // at alpha 0
  const sh = ui.talkShakeTarget();
  sh.set({ x: 3, y: -2, z: 0 });
  assert.deepEqual(sh.get(), { x: 3, y: -2, z: 0 });
  assert.throws(() => ui.setTalkWindow("UICenterTalkWindow"), StoryCommandError);
});

test("talk background fades in with OutQuad over 0.2 s", async () => {
  const { ui, step } = create();
  ui.showTalk();
  assert.equal(Win(ui).talkArea.activeSelf, true);
  const alpha = [];
  for (let f = 1; f <= 7; f++) { await step(); alpha.push(Win(ui).background.canvasGroup.alpha); }
  alpha.slice(0, 5).forEach((a, i) => { const k = Math.min(F((i + 1) * F(1 / 30)), 0.2) / 0.2; close(a, -k * (k - 2), 1e-6); });
  assert.equal(alpha[5], 1);
});

// frames at which character k becomes visible for a typewriter started at frame 0
const typeFrames = async (opts, text, speed = 1) => {
  const { ui, loop, step } = create(opts);
  ui.setPlaybackSpeed(speed);
  const t = Win(ui).talkText.text;
  const typing = ui.setTalk(text);
  let end = -1;
  typing.finished.then(() => { end = loop.frameCount; });
  const at = [0];
  assert.equal(t.maxVisibleCharacters, 1);                               // the first character in the calling frame
  for (let f = 1; f <= 60; f++) { await step(); while (at.length < t.maxVisibleCharacters) at.push(f); }
  return { at, end, ui, typing };
};

test("typewriter: one tick per ASCII letter, WaitWhile + Delay ticks otherwise", async () => {
  const { at, end, ui } = await typeFrames({}, "AB一二");
  assert.deepEqual(at.slice(1).map((f, k) => f - at[k]), [1, 1, 3]);    // 0.05 s at 30 fps: 1 + 2 ticks
  assert.equal(end, at[3] + 3);
  assert.equal(ui.isTyping, false);
  assert.equal(Win(ui).nextIndicator.activeSelf, true);
  const fast = await typeFrames({}, "一二三", 2);                         // 0.025 s: 1 + 1 ticks
  assert.deepEqual(fast.at.slice(1).map((f, k) => f - fast.at[k]), [2, 2]);
  const en = await typeFrames({ mode: 1, lang: "en" }, "一二三");          // English: 0.015 s
  assert.deepEqual(en.at.slice(1).map((f, k) => f - en.at[k]), [2, 2]);
  assert.equal(Win(en.ui).talkText.text.wrapping, 1);                      // LocalizeText: word wrap in English
});

test("typewriter: counts the text without tags; cancel reveals the rest and still shows the indicator", async () => {
  const { ui, loop, step } = create();
  const typing = ui.setTalk("<size=150%>一二三</size>");
  assert.equal(typing.totalLength, 3);
  await step();
  typing.cancel();
  let done = -1;
  typing.finished.then(() => { done = loop.frameCount; });
  await step(2);
  assert.ok(done > 0);
  assert.equal(Win(ui).talkText.text.maxVisibleCharacters, 3);
  assert.equal(Win(ui).nextIndicator.activeSelf, true);
  ui.setAutoMode(true);
  assert.equal(Win(ui).nextIndicator.activeSelf, false);
  assert.equal(Win(ui).autoIcon.activeSelf, true);
});

test("removeTagsWithRuby and CountRenderedCharacters", () => {
  assert.equal(removeTagsWithRuby("<size=150%>AB</size>C"), "ABC");
  assert.equal(removeTagsWithRuby("<r=よみ>読</r>み"), "よみ読み");
  assert.equal(removeTagsWithRuby("<ruby=・>あ</ruby>"), "・あ");
  assert.equal(removeTagsWithRuby("<r=>x</r>"), "x");                    // an empty reading is no ruby tag
  assert.equal(removeTagsWithRuby("a<b"), "a");                           // an unclosed '<' drops the rest
  assert.equal(removeTagsWithRuby("<r=よみ>読</r>み", true), "読み");      // removeRubyContent: the text only
  assert.equal(removeTagsWithRuby(""), "");
  // RemoveTagsKeepingRuby: ruby tags copied as they are, other tags dropped
  assert.equal(removeTagsKeepingRuby("<size=150%>A<r=よみ>読</r></size>B"), "A<r=よみ>読</r>B");
  assert.equal(removeTagsKeepingRuby("<ruby=・>あ</ruby><color=#FFF>x"), "<ruby=・>あ</ruby>x");
  assert.equal(removeTagsKeepingRuby("<r=\"よ\">読</r>"), "読");            // a quoted reading is no ruby tag here
  assert.equal(removeTagsKeepingRuby("<r=よ>a\nb</r>"), "a\nb");          // a ruby text does not span a line feed
  assert.equal(removeTagsKeepingRuby("a<b<r=よ>読</r>"), "a<r=よ>読</r>");  // a '<' inside a tag is checked again
  assert.equal(countRenderedCharacters("A😀B"), 3);             // a surrogate pair counts 1
  assert.equal(countRenderedCharacters("A B\n"), 4);
});

test("speaker plate: name shown, Back = 20 + preferred width + 80", () => {
  const { ui } = create();
  ui.showTalk(0);
  ui.setSpeakerName("<color=#FFFFFF>AB</color>");
  assert.equal(Win(ui).speaker.activeSelf, true);
  ui.layout(2340, 1080);
  const pw = Win(ui).speakerText.text.preferredWidth();
  const [x0, , x1] = Win(ui).speaker.find("Back").canvasBox();
  close(x1 - x0, 20 + pw + 80, 1e-3);
  const [tx0, ty0, , ty1] = Win(ui).talkText.canvasBox();
  close(tx0, 1170 - 591.29, 1e-3); close(ty0, 1.91, 1e-3); close(ty1, 201.91, 1e-3);
  ui.setSpeakerName("");
  assert.equal(Win(ui).speaker.activeSelf, false);
});

test("location caption: 2.5 s sequence, clip hold; title: returns on the next tick, fades after 5 s", async () => {
  const { ui, loop, step } = create();
  ui.setTalkWindow("UIDefaultTalkWindow");
  let locEnd = -1, titleEnd = -1;
  ui.showLocation("一二").then(() => { locEnd = loop.frameCount; });
  ui.showTitle("AB").then(() => { titleEnd = loop.frameCount; });
  await step(30);
  close(ui.part.location.canvasGroup.alpha, 1, 1e-6);
  close(ui.part.title.canvasGroup.alpha, 1, 1e-6);
  assert.equal(titleEnd, 2);
  await step(60);
  let pos = 0, n = 0;
  while (pos < F(2.5)) { pos = F(pos + F(1 / 30)); n++; }
  assert.equal(locEnd, n + 1);
  await step(165 - loop.frameCount);
  const u = ui.part.title.animator.time - 5;
  close(ui.part.title.canvasGroup.alpha, 1 - 3 * u * u + 2 * u * u * u, 1e-4);
});

test("rule transition: FadeIn 1 s reaches half cover at frame 15 and hides at the end", async () => {
  const { ui, loop, step } = create();
  await step();                                                          // Time.deltaTime of a running loop
  const s = ui.transitionSettings("adv_transition_0001/adv_transition_0001");
  let hidden = -1;
  const f0 = loop.frameCount;
  ui.fadeIn(s, { r: 0, g: 0, b: 0, a: 1 }, 1).then(() => { hidden = loop.frameCount - f0; });
  assert.equal(ui.rule.val, -1);
  assert.equal(ui.part.rule.activeSelf, true);
  let v15 = null;
  for (let f = 1; f <= 32; f++) { await step(); if (f === 15) v15 = ui.rule.val; }
  const u = Math.min(Math.max((1 - v15) / 2, 0), 1);
  close(u * u * (3 - 2 * u), 0.5, 1e-5);
  let t = 0, n = 0;
  while (t < 1) { t = F(t + F(1 / 30)); n++; }
  assert.equal(hidden, n);
  assert.equal(ui.part.rule.activeSelf, false);
  assert.throws(() => ui.transitionSettings("nope"), /not in the data/);
});

test("letterbox bands on a 16:9 screen and the 0.2 s fade", async () => {
  const { ui, loop, step } = create();
  const sw = 1920, sh = 1080, vh = Math.round(sh * (sw / sh) / 2.1666667), vy = Math.round((sh - vh) / 2);
  ui.renderLetterBox({ gl: null, screenWidth: sw, screenHeight: sh, viewport: { x: 0, y: vy, w: sw, h: vh } });
  const band = (sh - vh) / 2;
  assert.equal(ui.letterBox.activeSelf, true);
  assert.equal(ui.letterBox.canvasGroup.alpha, 0);
  const tb = ui.part.topBand.canvasBox();
  close(tb[1], sh - band, 0.01); close(tb[3], sh - band + 1440, 0.01);
  const f0 = loop.frameCount;
  let done = -1;
  ui.fadeInLetterBox().then(() => { done = loop.frameCount - f0; });
  await step(8);
  assert.equal(ui.letterBox.canvasGroup.alpha, 1);
  assert.equal(done, 7);
});

test("checkTexts refuses what the UI cannot lay out", () => {
  const { ui } = create();
  ui.checkTexts(["AB", "<size=150%>一二</size>", "<color=#FFFFFF>A</color>", "<r=一二>三</r>"]);
  assert.throws(() => ui.checkTexts(["<mark=#FF0000>A"]), /U\+005F/);             // no highlight glyph in the font
  assert.throws(() => ui.checkTexts(["<r=よ>A</r>"]), /not in the font data/);  // the reading's glyphs too
  assert.throws(() => ui.checkTexts(["Ω"]), /not in the font data/);
  assert.throws(() => ui.checkTexts(["A\u200DB"]), /emoji sequences/);
});

test("Single.ToString as String.Format writes the ruby floats", () => {
  assert.equal(netSingleToString(F(21.6)), "21.6");
  assert.equal(netSingleToString(F(-0.1775)), "-0.1775");
  assert.equal(netSingleToString(F(1 / 3)), "0.3333333");
  assert.equal(netSingleToString(50), "50");
  assert.equal(netSingleToString(-0), "0");
  assert.equal(netSingleToString(F(0.0001)), "0.0001");
  assert.equal(netSingleToString(F(0.00001)), "1E-05");
  assert.equal(netSingleToString(1e7), "1E+07");
  assert.equal(netSingleToString(12345678), "1.234568E+07");
  assert.equal(netSingleToString(1234567), "1234567");
});

test("RubyTextConstants.ReplaceRubyTags: the three show types and the line height prefix", () => {
  const widths = { A: 10, "一二": 40, "三": 20, " a": 15, a: 10, "B": 10 };
  const t = { autoSize: false, node: { path: "T" }, preferredWidthOf: (s) => widths[s] };
  const r = { ...RUBY };
  // RUBY_ALIGNMENT: base 20, ruby 40 x 0.5 = 20 -> comp 0 -> base after ruby
  assert.equal(replaceRubyTags(t, r, "A<r=一二>三</r>B"),
               "A<nobr>三<space=-20><voffset=1em><size=50%>一二</size></voffset><space=0></nobr>B");
  // a wider reading (scale 1): comp -10 -> ruby after base, the base moved right by 10
  assert.equal(replaceRubyTags(t, { ...r, _rubyScale: 1 }, "<ruby=\"一二\">三</ruby>"),
               "<nobr><space=10>三<space=-30><voffset=1em><size=100%>一二</size></voffset><space=-10></nobr>");
  assert.equal(replaceRubyTags(t, { ...r, _rubyShowType: 1 }, "<r>三<rt>一二</rt></r>"),
               "<nobr>三<space=-20><voffset=1em><size=50%>一二</size></voffset><space=0></nobr>");
  // BASE_NO_OVERRAP: the second reading would overlap the first: <space=d> first, then the margin
  const two = replaceRubyTags(t, { ...r, _rubyShowType: 2, _rubyScale: 1 }, "<r=一二>三</r><r=一二>三</r>");
  assert.equal(two, "<space=10><nobr>三<space=-30><voffset=1em><size=100%>一二</size></voffset><space=-10></nobr>" +
                    "<space=30><nobr>三<space=-30><voffset=1em><size=100%>一二</size></voffset><space=-10></nobr>");
  assert.equal(replaceRubyTags(t, { ...r, _rubyLineHeight: "120%" }, "B"),
               "<line-height=120%><voffset=1em><size=50%> </size></voffset><space=-2.5>B");
  assert.equal(replaceRubyTags(t, r, "no ruby"), "no ruby");
  assert.equal(hasRubyInFirstLine("A<r=よ>読</r>"), true);
  assert.equal(hasRubyInFirstLine("A\n<r=よ>読</r>"), false);
  assert.equal(hasRubyInFirstLine("<r=\"よ\">読</r>"), false);           // the helper's tag regex has no quotes
});

test("talk text with ruby: rewritten for TMP, margin top while the first line has ruby, typed with its reading", async () => {
  const { ui, step } = create();
  const t = Win(ui).talkText.text;
  const typing = ui.setTalk("A<r=一二>三</r>B");
  assert.equal(typing.totalLength, 5);                                   // RemoveTagsWithRuby: A 一二 三 B
  assert.equal(t.margin.y, -22);
  assert.match(t.text, /^A<nobr>(<space=[-\d.]+>)?三<space=[-\d.]+><voffset=1em><size=50%>一二<\/size><\/voffset><space=[-\d.]+><\/nobr>B$/);
  t.setMaxVisible(99999);
  ui.layout(2340, 1080);
  t.generate();
  assert.deepEqual(t.chars.map((c) => String.fromCodePoint(c.u)).join(""), "A三一二B");
  close(t.chars[2].scale, t.chars[1].scale / 2, 1e-6);                     // <size=50%>
  close(t.chars[2].y1, F(71.25 * t.chars[2].scale) + 36, 1e-3);            // <voffset=1em> at size 36
  ui.setTalk("AB");
  assert.equal(t.margin.y, 0);
  await step();
});

test("flash: white, OutQuad fade to 0, hidden at the end; a new flash restarts it", async () => {
  const { ui, step } = create();
  await step();
  const f = ui.part.flash;
  let ended = 0;
  const first = ui.flash(0.3).then(() => { ended++; });
  assert.equal(f.activeSelf, true);
  assert.deepEqual(f.image.m_Color, { r: 1, g: 1, b: 1, a: 1 });
  ui.layout(2340, 1080);
  assert.deepEqual(ui.drawList(ui.front).map((it) => it.node.name), ["FlashView", "TalkBackground"]);
  await step(3);
  close(f.image.m_Color.a, (1 - F(3 * F(1 / 30)) / 0.3) ** 2, 1e-5);
  const second = ui.flash(0.3);
  await first;
  assert.equal(ended, 1);
  assert.equal(f.activeSelf, true);                                     // the killed flash hid it, the new one shows it
  assert.equal(f.image.m_Color.a, 1);
  let done = false;
  second.then(() => { done = true; });
  await step(10);
  assert.equal(done, true);
  assert.equal(f.activeSelf, false);
});

test("subtitles: show, hidden text kept, restore, clear; the front next indicator", () => {
  const { ui } = create();
  const v = ui.part.subtitles, t = ui.part.subtitlesText.text;
  ui.showSubtitles("一二");
  assert.equal(v.activeSelf, true); assert.equal(t.text, "一二");
  ui.updateHiddenSubtitles("三");
  assert.equal(v.activeSelf, false); assert.equal(t.text, "一二");
  ui.restoreSubtitlesIfAny();
  assert.equal(v.activeSelf, true); assert.equal(t.text, "三");
  ui.hideSubtitles();
  assert.equal(v.activeSelf, false);
  ui.clearSubtitles();
  ui.restoreSubtitlesIfAny();
  assert.equal(v.activeSelf, false); assert.equal(t.text, "");
  assert.equal(ui.isShowingNextIndicator(), false);
  ui.showNextIndicator();
  assert.equal(ui.isShowingNextIndicator(), true);
  ui.hideNextIndicator();
  assert.equal(ui.part.frontNextIndicator.activeSelf, false);
});

test("video buttons: shown with or without skip, laid out, the black filter on the canvas edges", () => {
  const { ui } = create();
  ui.showVideoButtons(false);
  assert.equal(ui.part.videoButtonParent.activeSelf, true);
  assert.equal(ui.part.skipVideoButton.activeSelf, false);
  ui.layout(2400, 1080);
  const pb = ui.part.pauseVideoButton.canvasBox();
  close(pb[0], 1200 - 90, 1e-3); close(pb[1], 540 - 90, 1e-3);          // alone in the middle (MiddleCenter)
  ui.showVideoButtons(true);
  ui.layout(2400, 1080);
  close(ui.part.pauseVideoButton.canvasBox()[0], 1200 - 195, 1e-3);      // 180 + 30 + 180 centred
  const bf = ui.front.find("UISafeArea/UIContainer/MenuView/VideoButtons/BlackFilter").canvasBox();
  bf.forEach((v, i) => close(v, [0, 0, 2400, 1080][i], 1e-3));
  ui.part.pauseVideoButton.find("IconImage").image.spriteObj = ui.sprites.get("play");
  ui.resetPauseVideoButton();
  assert.equal(ui.part.pauseVideoButton.find("IconImage").image.spriteObj.name, "stop");
  ui.hideVideoButtons();
  assert.equal(ui.part.videoButtonParent.activeSelf, false);
  ui.hideAutoButton(); ui.showAutoButton(); ui.showFastForwardButton();   // panel buttons: not in the data, state only
  const doc = uiDoc();
  doc.widget = { canvases: [{ path: "UIAdvWidget/BlockCanvas", sortingOrder: 300 }] };
  assert.equal(create({ doc }).ui.trueCanvasSortOrder, 300);
});

test("talk window without background, indicator and icons (optional references)", async () => {
  const { ui, step } = create();
  const fake = { part: { ...Win(ui), background: null, nextIndicator: null, autoIcon: null, fastIcon: null },
                 loop: ui.loop, tweens: ui.tweens, language: ui.language, doc: ui.doc, setActive: (n, v) => ui.setActive(n, v) };
  const w = new StoryTalkWindow(fake);
  w.refresh();
  w.showTalk();
  assert.equal(Win(ui).talkArea.activeSelf, true);
  w.setAutoMode(true); w.setAutoMode(false); w.setFastIconActive(true);
  const typing = w.setTalk("一二");
  await step(10);
  assert.equal(typing.totalLength, 2);
  assert.equal(w.isTyping, false);
  w.hideTalk();
  assert.equal(Win(ui).talkArea.activeSelf, false);
  assert.equal(Win(ui).background.canvasGroup.alpha, 0);                 // the real background is untouched
});

test("LocalizeKoreanAdjust clears the bold style in the Korean language mode only, when enabled", () => {
  const normal = { _koreanFontStyle: 1, m_Enabled: true };
  assert.equal(create({ mode: 4, lang: "ko", koAdjust: normal }).ui.part.titleText.text.bold, false);
  assert.equal(create({ mode: 2, koAdjust: normal }).ui.part.titleText.text.bold, true);
  // a disabled component gets no OnEnable, so Apply never runs
  assert.equal(create({ mode: 4, lang: "ko", koAdjust: { ...normal, m_Enabled: false } }).ui.part.titleText.text.bold, true);
});

test("centre talk window: the swap carries the talk, the backdrop fades in, the text style and the content layout", async () => {
  const { ui, step } = create({ doc: withCenter(uiDoc()), fonts: withCenterFonts(fontsDoc()) });
  assert.deepEqual(ui.talkWindows, ["UIDefaultTalkWindow", "UICenterTalkWindow"]);
  const D = Win(ui), X = Win(ui, "UICenterTalkWindow"), B = ui.part.centerTalkBackdrop;
  assert.equal(X.window.activeSelf, false);                              // loaded, not attached
  assert.equal(B.canvasGroup.alpha, 0);
  ui.showTalk(0);
  ui.setSpeakerName("<color=#FFFFFF>AB</color>");
  ui.setTalk("一二三");
  await step(12);
  ui.setTalkWindow("UICenterTalkWindow");
  assert.equal(D.window.activeSelf, false); assert.equal(X.window.activeSelf, true);
  assert.equal(ui.part.talkView.children.at(-1), X.window);               // SetAsLastSibling
  assert.equal(X.talkText.storyText.getText(), "一二三");                 // ApplyData
  assert.equal(X.talkArea.activeSelf, true); assert.equal(ui.isShowingTalk(), true);
  assert.equal(X.background.canvasGroup.alpha, 1);
  // ApplyTalkTextStyle: vertex colour and an instance of the text material with the window's outline colour
  const mat = ui.material(X.talkText.text.materialName);
  assert.match(X.talkText.text.materialName, /^Test - Outline \(Instance /);
  assert.deepEqual(mat.colors._OutlineColor, { r: F(0.0941176), g: F(0.0705882), b: F(0.1607843), a: F(0.4) });
  assert.deepEqual(ui.fonts.materials["Test - Outline"].colors._OutlineColor, { r: 0.8, g: 0.8, b: 0.8, a: 1 });
  // the backdrop: the window's filter colour, CanvasGroup.DOFade(1, 0.2) with the default ease (OutQuad)
  assert.deepEqual(B.image.m_Color, { r: 0, g: 0, b: 0, a: F(0.4) });
  const alpha = [];
  for (let f = 1; f <= 7; f++) { await step(); alpha.push(B.canvasGroup.alpha); }
  alpha.slice(0, 5).forEach((a, i) => { const k = Math.min(F((i + 1) * F(1 / 30)), 0.2) / 0.2; close(a, -k * (k - 2), 1e-6); });
  assert.equal(alpha[5], 1);
  // the content: 1140 wide (force expand), as high as the text's preferred height, centred on the talk area
  ui.layout(2340, 1080);
  const t = X.talkText.text, h = t.preferredHeight();
  assert.equal(h, F(Math.trunc(F(F(F(F(32.4) + F(10.8)) * 100) + 1)) / 100));
  const [x0, y0, x1, y1] = X.talkText.canvasBox();
  close(x1 - x0, 1140, 1e-3); close(y1 - y0, h, 1e-3); close((y0 + y1) / 2, 540, 1e-3); close((x0 + x1) / 2, 1170, 1e-3);
  assert.deepEqual(ui.drawList(ui.front).map((it) => it.node.name), ["CenterTalkBackdrop", "TalkText"]);   // TalkBackground Image disabled
  // HideTalk: the talk area off, the backdrop at 0 at once
  ui.hideTalk();
  assert.equal(X.talkArea.activeSelf, false); assert.equal(B.canvasGroup.alpha, 0);
  // back to the default window: the talk shown again only if its area was
  ui.setTalkWindow("UIDefaultTalkWindow");
  assert.equal(D.window.activeSelf, true); assert.equal(X.window.activeSelf, false);
  assert.equal(D.talkText.storyText.getText(), "一二三"); assert.equal(D.talkArea.activeSelf, false);
  assert.equal(ui.part.talkView.children.at(-1), D.window);
});

test("centre talk window: a long line wraps at the content width and the text box grows with it", async () => {
  const { ui } = create({ doc: withCenter(uiDoc()), fonts: withCenterFonts(fontsDoc()) });
  ui.setTalkWindow("UICenterTalkWindow");
  ui.showTalk(0);
  const X = Win(ui, "UICenterTalkWindow"), t = X.talkText.text;
  ui.setTalk("一".repeat(60));                                           // 60 x (21.6 + 0.72) > 1140
  t.setMaxVisible(99999);
  ui.layout(2340, 1080);
  t.generate();
  assert.equal(t.lines.length, 2);
  const [, y0, , y1] = X.talkText.canvasBox();
  close(y1 - y0, t.preferredHeight(), 1e-3);
  assert.ok(t.preferredHeight() > 80);
  close((y0 + y1) / 2, 540, 1e-3);
});
