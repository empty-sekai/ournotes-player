import assert from "node:assert/strict";
import test from "node:test";

import { PlayerLoop } from "../../src/engine/loop.js";
import { UINode } from "../../src/engine/ugui.js";
import { LAYOUT_DEFAULT, SIMPLE_RT_SIZE, SLOT_LAYOUT, STAGE_X } from "../../src/story/simple/define.js";
import { SIMPLE_CLASS, SIMPLE_PHASE, classifyRow, runnerRows, supportedRowProblem, validateSimpleEpisode } from "../../src/story/simple/validator.js";
import { SimpleAdvView, SimpleTalkWindow, aspectFit, aspectScaleBoost, layoutProfile, resolveSlots, talkWindowScale } from "../../src/story/simple/view.js";
import { SimpleCanvas, SimpleUIDoc, runtimeNodeRecord } from "../../src/story/simple/ui.js";
import { CameraTargetRenderer, cameraTargetDesc } from "../../src/story/simple/render.js";

const F = Math.fround;
const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ------------------------------------------------------------------------------------------------ validator
test("validator: episode rows classified by the simple runner's command set", () => {
  const E = SIMPLE_PHASE.Episode;
  for (const cmd of ["In", "Out", "Talk", "Delay", "Brightness", "Expression", "Pause", "Resume", "Motion", "Character",
                     "Costume", "Wait", "Se", "Angle", "TalkWindow", "Look", "Voice", "Effect", "RimLight", "LookTarget",
                     "MotionLoop", "EyeBlink"])
    assert.equal(classifyRow({ cmd }, E), SIMPLE_CLASS.Supported, cmd);
  for (const cmd of ["Stage", "Bgm", "FadeIn", "FadeOut", "Focus", "Location", "MoveToRight", "SoundVolume", "Shake", "Pan"])
    assert.equal(classifyRow({ cmd }, E), SIMPLE_CLASS.Abort, cmd);
});

test("validator: initialize and finalize phases", () => {
  const I = SIMPLE_PHASE.Initialize, Z = SIMPLE_PHASE.Finalize;
  assert.equal(classifyRow({ cmd: "Se", Parameter1: "Stop" }, I), SIMPLE_CLASS.Ignored);
  assert.equal(classifyRow({ cmd: "Se", Parameter1: "" }, I), SIMPLE_CLASS.Abort);
  assert.equal(classifyRow({ cmd: "Bgm", BgmID: 0 }, I), SIMPLE_CLASS.Ignored);
  assert.equal(classifyRow({ cmd: "Bgm", BgmID: 3 }, I), SIMPLE_CLASS.Abort);
  assert.equal(classifyRow({ cmd: "FadeIn" }, I), SIMPLE_CLASS.Ignored);
  assert.equal(classifyRow({ cmd: "Talk", AdvTextID: "0" }, Z), SIMPLE_CLASS.Ignored);
  assert.equal(classifyRow({ cmd: "Talk", AdvTextID: "12" }, Z), SIMPLE_CLASS.Abort);
  assert.equal(classifyRow({ cmd: "FadeOut" }, Z), SIMPLE_CLASS.Ignored);
});

test("validator: rows that refuse the whole episode", () => {
  assert.match(supportedRowProblem({ cmd: "LookTarget", TargetName: "" }), /TargetName/);
  assert.match(supportedRowProblem({ cmd: "LookTarget", TargetName: "a", PositionType: 2 }), /PositionType 2/);
  assert.equal(supportedRowProblem({ cmd: "LookTarget", TargetName: "a", PositionType: 2, Parameter3: "STOP" }), null);
  assert.equal(supportedRowProblem({ cmd: "LookTarget", TargetName: "a", PositionType: 7 }), null);
  assert.match(supportedRowProblem({ cmd: "MotionLoop", TargetName: "a", MotionName: "idle" }), /MotionLoop/);
  assert.equal(supportedRowProblem({ cmd: "MotionLoop", TargetName: "a", MotionName: "Misc_loop" }), null);
  assert.equal(supportedRowProblem({ cmd: "MotionLoop", TargetName: "a", Parameter1: "stop" }), null);
  assert.match(supportedRowProblem({ cmd: "EyeBlink", TargetName: "a", Parameter1: "close" }), /EyeBlink/);
  assert.equal(supportedRowProblem({ cmd: "EyeBlink", TargetName: "a", Parameter1: "Resume" }), null);
  assert.match(supportedRowProblem({ cmd: "EyeBlink", TargetName: "" }), /EyeBlink/);
  assert.match(supportedRowProblem({ cmd: "Brightness", TargetName: "", PositionType: 0 }), /Brightness/);
  assert.match(supportedRowProblem({ cmd: "Brightness", TargetName: "a", CanvasLayers: [2, 0] }), /canvas layers/);
  assert.equal(supportedRowProblem({ cmd: "Brightness", PositionType: 3, CanvasLayers: [2] }), null);
  assert.match(supportedRowProblem({ cmd: "Effect", CanvasLayers: [0] }), /canvas layer 0/);
  assert.equal(supportedRowProblem({ cmd: "Effect", CanvasLayers: [] }), null);
});

test("validator: startIndex and IgnoreData rows, the first failure reported", () => {
  const episode = { commands: [
    { i: 0, cmd: "Talk", AdvTextID: "1" }, { i: 1, cmd: "Stage", IgnoreData: true },
    { i: 2, cmd: "EyeBlink", TargetName: "a", Parameter1: "x" }, { i: 3, cmd: "LookTarget", TargetName: "" }] };
  assert.deepEqual(runnerRows(episode, 0).map((c) => c.i), [0, 2, 3]);
  assert.deepEqual(runnerRows(episode, 3).map((c) => c.i), [3]);
  const v = validateSimpleEpisode(episode, { _initializeEpisodes: [{ Command: 15, BgmID: 0 }], _finalizeEpisodes: [] });
  assert.equal(v.ok, false);
  assert.equal(v.failure.row, 2);
  assert.equal(v.rows[0].phase, SIMPLE_PHASE.Initialize);
  assert.equal(validateSimpleEpisode(episode, { _initializeEpisodes: [], _finalizeEpisodes: [] }, 3).failure.row, 3);
});

// ------------------------------------------------------------------------------------------------ layout
test("layout profile: defaults and the profile constructor's clamps", () => {
  assert.equal(layoutProfile(null), LAYOUT_DEFAULT);
  const p = layoutProfile({ _layoutSurfaceReferenceSize: { x: 1220, y: 1020 }, _layoutSurfaceAnchor: { x: -1, y: 0.5 },
    _characterViewportRect: { _anchorMin: { x: 0, y: 0 }, _anchorMax: { x: 1, y: 1 } }, _designViewportAspect: 0,
    _characterSlotCount: 9, _characterSlotWidth: 0.3, _characterSlotHeight: 2, _characterSlotCenterY: 0.5,
    _characterCaptureBaseScale: 0.35, _characterDisplayScale: 5, _characterDisplayOffset: { x: 0, y: 0.23 } });
  assert.deepEqual(p.anchor, { x: 0, y: 0.5 });
  assert.equal(p.designAspect, LAYOUT_DEFAULT.designAspect);
  assert.equal(p.slotCount, 5);
  assert.equal(p.slotHeight, 1);
  assert.equal(p.displayScale, 3);
  close(p.captureBaseScale, 0.35);
});

test("slots: the SimpleAdvCharacterSlotLayout table and normalized rects", () => {
  assert.deepEqual(SLOT_LAYOUT[4].map((s) => s[0]), [1, 3, 7, 9]);
  const home = resolveSlots({ ...LAYOUT_DEFAULT, slotWidth: F(0.4), slotCenterY: F(0.3) });
  assert.deepEqual(home.map((s) => s.positionType), [1, 3, 5, 7, 9]);
  close(home[0].rect[0], 0); close(home[0].rect[2], 0.38);             // 0.18 - 0.2 clamped to 0
  close(home[2].rect[1], 0); close(home[2].rect[3], 0.8);               // centre y 0.3, height 1
  assert.equal(home[4].def.layer, "Camera5");
  const three = resolveSlots({ ...LAYOUT_DEFAULT, slotCount: 3 });
  assert.deepEqual(three.map((s) => s.def.root), ["Position2Root", "Position3Root", "Position4Root"]);
  assert.deepEqual(STAGE_X, { 1: F(-1.6), 3: F(-0.8), 5: 0, 7: F(0.8), 9: F(1.6) });
});

test("aspect boost, talk window scale and the aspect fitter", () => {
  assert.equal(aspectScaleBoost(2.5, F(2.1666667)), 1);
  close(aspectScaleBoost(16 / 9, F(2.1666667)), 1 + 0.15 * ((2.1666667 - 16 / 9) / 0.85), 1e-5);
  close(aspectScaleBoost(1, F(2.1666667)), 1.15);
  assert.equal(talkWindowScale(0, 100), 1);
  close(talkWindowScale(960, 320), 1);
  close(talkWindowScale(921.6, 410.4), 0.96);
  close(talkWindowScale(10, 10), 0.1);
  const parent = new UINode(runtimeNodeRecord("p", "p"), null);
  parent.rect = { x: -100, y: -50, w: 200, h: 100 };
  const n = new UINode(runtimeNodeRecord("p/n", "n", { min: { x: 0.2, y: 0.2 }, max: { x: 0.4, y: 0.4 } }), parent);
  aspectFit(n, 4, 1);                                                  // envelope: a 200 x 200 square
  assert.deepEqual(n.sizeDelta, { x: 0, y: 100 });
  aspectFit(n, 3, 2.1666667);                                          // fit: 200 wide, 92.3 high
  close(n.sizeDelta.y, 200 / 2.1666667 - 100, 1e-3);
});

// ------------------------------------------------------------------------------------------------ view
const hostTree = () => {
  const root = new UINode(runtimeNodeRecord("Canvas", "Canvas"), null);
  const overlay = new UINode(runtimeNodeRecord("Canvas/Overlay", "Overlay", { active: false }), root);
  new UINode(runtimeNodeRecord("Canvas/Overlay/Back", "Back"), overlay);
  new UINode(runtimeNodeRecord("Canvas/Overlay/TalkRoot", "TalkRoot", { min: { x: 0.26, y: 0.09 }, max: { x: 0.74, y: 0.38 } }), overlay);
  return { root, overlay };
};

const layoutAll = (canvas, view) => {
  for (let i = 0; i < 6; i++) { canvas.layout(1920, 1080); if (!view.fit()) break; }
};

test("view: resolver hierarchy, slot images and talk window layout", () => {
  const { root, overlay } = hostTree();
  const tweens = { active: new Set() };
  const view = new SimpleAdvView(overlay, { _layoutSurfaceReferenceSize: { x: 0, y: 0 }, _layoutSurfaceAnchor: { x: 0.5, y: 0.5 },
    _characterViewportRect: { _anchorMin: { x: 0, y: 0 }, _anchorMax: { x: 1, y: 1 } }, _designViewportAspect: F(2.1666667),
    _characterSlotCount: 5, _characterSlotWidth: F(0.4), _characterSlotHeight: 1, _characterSlotCenterY: F(0.3),
    _characterCaptureBaseScale: F(0.52), _characterDisplayScale: F(1.85), _characterDisplayOffset: { x: 0, y: F(0.23) } },
  { tweens, dotween: { defaultEaseType: 6 } });
  assert.deepEqual(overlay.children.map((c) => c.name), ["LayoutSurface", "TapCatcher"]);
  assert.deepEqual(view.surface.children.map((c) => c.name), ["Back", "CharacterViewport", "TalkRoot"]);
  assert.deepEqual(view.viewport.children.map((c) => c.name), ["Position1Root", "Position2Root", "Position3Root", "Position4Root", "Position5Root"]);
  const win = new UINode(runtimeNodeRecord("W", "UISimpleAdvTalkWindow"), null);
  view.attachTalkWindow({ root: win, talk: { refresh() {}, hideTalk() {} }, setSpeakerName() {} });
  const canvas = new SimpleCanvas(root, { m_Enabled: 1, m_UiScaleMode: 1, m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 1 });
  layoutAll(canvas, view);
  // 1920 x 1080 canvas: viewport fits 2.1666:1 in the full surface (1920 x 886.15); slot 3 is 768 wide, image a square
  close(view.viewport.rect.w, 1920, 1e-3); close(view.viewport.rect.h, 1920 / F(2.1666667), 1e-2);
  const s3 = view.slots[2];
  close(s3.root.rect.w, F(0.4) * 1920, 1e-2);
  close(s3.image.rect.w, s3.image.rect.h, 1e-3);
  close(s3.image.rect.w, Math.max(s3.root.rect.w, s3.root.rect.h), 1e-2);
  close(s3.image.localScale.x, F(1.85) * aspectScaleBoost(1920 / 1080, F(2.1666667)), 1e-5);
  // talk root 921.6 x 313.2 -> scale min(313.2 / 320, 921.6 / 960) = 0.96
  close(win.localScale.x, 0.96, 1e-4);
  assert.deepEqual(win.sizeDelta, { x: 960, y: 320 });
});

test("view: first show fades the root in over 0.2 s (OutQuad); taps request only with progress enabled", async () => {
  const { overlay } = hostTree();
  const tweens = { active: new Set() };
  const view = new SimpleAdvView(overlay, null, { tweens, dotween: { defaultEaseType: 6 } });
  const loop = new PlayerLoop(30);
  loop.on("tweens", (l) => { for (const t of [...tweens.active]) t.step(l.deltaTime); });
  view.setAdvanceInputEnabled(true); view.setAdvanceProgressEnabled(false);
  view.show();
  assert.equal(overlay.canvasGroup.alpha, 0);
  const alphas = [];
  for (let i = 0; i < 7; i++) { await loop.step(); alphas.push(overlay.canvasGroup.alpha); }
  close(alphas[0], 1 - (1 - 1 / 6) ** 2, 1e-5);                        // OutQuad at t = 1/30 of 0.2
  assert.equal(alphas[5], 1);
  assert.equal(view.onTapped(), true);                                  // auto: swallowed, no request
  assert.equal(view.consumeAdvanceRequest(), false);
  view.setAdvanceProgressEnabled(true);
  view.onTapped();
  assert.equal(view.consumeAdvanceRequest(), true);
  assert.equal(view.consumeAdvanceRequest(), false);
  const done = view.fadeOutAndHide();
  for (let i = 0; i < 7; i++) await loop.step();
  await done;
  assert.equal(overlay.activeSelf, false);
});

test("view: slot fade in waits 3 frames, then the default ease over the duration", async () => {
  const { overlay } = hostTree();
  const tweens = { active: new Set() };
  const view = new SimpleAdvView(overlay, null, { tweens, dotween: { defaultEaseType: 1 } });
  const loop = new PlayerLoop(30);
  loop.on("tweens", (l) => { for (const t of [...tweens.active]) t.step(l.deltaTime); });
  const slot = view.slotByPositionType(5);
  view.setSlotCharacter(slot, "a", {});
  assert.equal(slot.image.rawImage.color.a, 0);
  assert.equal(slot.image.activeSelf, true);
  const p = view.fadeInSlot(slot, F(0.5), loop);
  const a = [];
  for (let i = 0; i < 20; i++) { await loop.step(); a.push(slot.image.rawImage.color.a); }
  await p;
  // called in frame 0: DelayFrame(3) ends in frame 3's Update, where the tween gets its first DOTween update
  assert.deepEqual(a.slice(0, 2), [0, 0]);
  close(a[2], F(1 / 30) / F(0.5), 1e-4);                               // linear (the default ease given)
  assert.equal(a[19], 1);
  assert.equal(view.defaultSlot(), slot);
  view.clearSlot(slot);
  assert.equal(slot.image.activeSelf, false);
});

// ------------------------------------------------------------------------------------------------ capture
test("capture: the camera target transforms and projection", () => {
  const crt = new CameraTargetRenderer(0, null, cameraTargetDesc(null));
  crt.applyCaptureScale(0.52);
  assert.deepEqual(crt.stage.localPosition, { x: 0, y: 0, z: -0.25 });
  assert.deepEqual(crt.stage.localScale, { x: 0.52, y: 0.52, z: 0.52 });
  crt.applyCaptureScale(0);
  assert.equal(crt.stage.localScale.x, 0.01);
  assert.deepEqual(crt.camera.worldPosition(), { x: 0, y: 0, z: -1 });
  const V = crt.viewMatrix();
  close(V[14], -1);                                                     // the stage origin 1 unit ahead of the camera
  assert.equal(SIMPLE_RT_SIZE, 1536);
});

// ------------------------------------------------------------------------------------------------ host UI animator
const spriteRec = (x) => ({ texture: "t", rect: { x, y: 0, width: 4, height: 4 }, textureRect: { x, y: 0, width: 4, height: 4 },
                            textureRectOffset: { x: 0, y: 0 }, border: { x: 0, y: 0, z: 0, w: 0 }, pixelsPerUnit: 100,
                            pivot: { x: 0.5, y: 0.5 } });
const hostDoc = () => {
  const node = (path, extra = {}) => ({ ...runtimeNodeRecord(path, path.split("/").pop()), ...extra });
  return {
    nodes: [node("W", { animator: { controller: "C", enabled: 1, updateMode: 0, keepStateOnDisable: false } }),
            node("W/A", { canvasGroup: { m_Enabled: 1, m_Alpha: 1, m_IgnoreParentGroups: false } }),
            node("W/B", { image: { m_Enabled: 1, sprite: "s1", m_Type: 0, color: { r: 1, g: 1, b: 1, a: 1 } } })],
    textures: { t: { width: 8, height: 4 } }, sprites: { s1: spriteRec(0), s2: spriteRec(4) },
    materials: { "Default UI Material": { shader: { shader: "UI/Default" } } },
    controllers: { C: { name: "C", defaultState: "Idle", states: [{ name: "Idle", speed: 1, clip: null },
                                                                   { name: "Show", speed: 1, clip: "Show" }] } },
    clips: { "C/Show": { name: "Show", startTime: 0, stopTime: 1, loopTime: false, events: [],
      pptrCurveMapping: ["s1", "s2"],
      curves: {
        "A:CanvasGroup.m_Alpha": { keys: [[-3.4028234663852886e38, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 0, 0, 0, 1]] },
        "B:Image.m_Sprite": { discrete: [[-3.4028234663852886e38, 0], [0.5, 1]] },
        "#123:CanvasGroup.m_Alpha": { constant: 0 },
        "Gone:CanvasGroup.m_Alpha": { constant: 0 },
      } } },
  };
};

test("host UI animator: child-path bindings, discrete sprite curves, unresolved and missing paths", () => {
  const doc = new SimpleUIDoc(null, null, hostDoc(), { assets: null, dir: "host/ui" });
  const w = doc.node("W"), a = doc.node("W/A"), b = doc.node("W/B");
  assert.deepEqual(doc.unbound, ["C: Gone"]);                          // "#123": unresolved in the game data, skipped
  assert.equal(w.animator.play("Show"), true);
  w.animator.update(0.25);
  close(a.canvasGroup.alpha, 0.25);                                    // the child's CanvasGroup
  assert.equal(b.image.spriteObj.name, "s1");
  w.animator.update(0.5);
  assert.equal(b.image.spriteObj.name, "s2");                          // the step at 0.5: pptrCurveMapping[1]
  w.animator.update(5);
  assert.equal(a.canvasGroup.alpha, 1);                                // a non-looping clip holds its end
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try { assert.equal(w.animator.play("In"), false); } finally { console.warn = warn; }
  assert.equal(warned, 1);
  assert.equal(w.animator.state.name, "Show");                         // a missing state changes nothing
});

// ------------------------------------------------------------------------------------------------ talk window
// UISimpleAdvTalkWindow with synthetic fonts: glyphs 50 x 70, advance 60 at point size 100
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ";
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
const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const tmpBinding = (cls, over) => ({
  class: cls, enabled: 1, m_fontSize: 30, m_fontSizeBase: 30, m_enableAutoSizing: 0, m_fontSizeMin: 18, m_fontSizeMax: 30,
  m_charWidthMaxAdj: 0, m_lineSpacingMax: 0, m_fontStyle: 0, m_HorizontalAlignment: 1, m_VerticalAlignment: 256,
  m_characterSpacing: 0, m_wordSpacing: 0, m_paragraphSpacing: 0, m_TextWrappingMode: 1, m_overflowMode: 0,
  m_isRichText: 1, m_parseCtrlCharacters: 1, m_overrideHtmlColors: 0, m_useMaxVisibleDescender: 1,
  m_margin: { x: 0, y: 0, z: 0, w: 0 }, m_fontColor: WHITE, m_ActiveFontFeatures: [], m_isOrthographic: 1,
  m_isRightToLeft: 0, m_enableVertexGradient: 0, m_characterHorizontalScale: 1, m_horizontalMapping: 0,
  m_verticalMapping: 0, m_enableExtraPadding: 0,
  localized: { fontAsset: "Test SDF", material: "Test - Simple", lineSpacing: 0 },
  ruby: { _rubyVerticalOffset: "1em", _rubyScale: 0.5, _rubyLineHeight: "", _rubyShowType: 0, _rubyMargin: 10 }, ...over,
});
const W = "UISimpleAdvTalkWindow", TT = `${W}/TalkArea/Content/TextWindow/TalkText`, ST = `${W}/TalkArea/Content/Speaker/Back/SpeakerText`;
const simpleWindowDoc = () => {
  const n = (path, extra = {}) => ({ ...runtimeNodeRecord(path, path.split("/").pop()), ...extra });
  return {
    nodes: [n(W, { talkWindow: { _typingDelay: 0.05, _useBackdropFilter: 0 } }), n(`${W}/TalkArea`), n(`${W}/TalkArea/Content`),
            n(`${W}/TalkArea/Content/TextWindow`), n(TT, { textStyle: {} }), n(`${W}/TalkArea/Content/Speaker`),
            n(`${W}/TalkArea/Content/Speaker/Back`), n(ST, { textStyle: {} })],
    textures: {}, sprites: {}, materials: { "Default UI Material": { shader: { shader: "UI/Default" } } },
    dotween: { defaultEaseType: 6 },
  };
};
const simpleFonts = () => ({
  language: "ja", source: "open", fonts: { "Test SDF": fontAsset() },
  textures: { page0: { texture: "fonts/page0.png", width: 1024, height: 1024, mipCount: 1 } },
  materials: { "Test - Simple": { material: "Test - Simple", shader: { shader: "TextMeshPro/Mobile/Distance Field" }, keywords: [],
                                  floats: { _GradientScale: 10, _ScaleRatioA: 1, _ScaleRatioC: 1 }, colors: {} } },
  materialKeywords: { "Test - Simple": [] },
  texts: { [TT]: tmpBinding("RubyEmojiTextMeshProUGUI", { uiRubyText: { _rubyMarginTop: -22 } }),
           [ST]: tmpBinding("RubyTextMeshProUGUI", { m_fontSize: 36, uiRubyText: { _rubyMarginTop: -24 } }) },
});

test("simple talk window: text components over the font data, no background, ruby text typed with its reading", async () => {
  const loop = new PlayerLoop(30), tweens = { active: new Set() };
  loop.on("tweens", (l) => { for (const t of [...tweens.active]) t.step(l.deltaTime); });
  const doc = new SimpleUIDoc(null, loop, simpleWindowDoc(), { assets: null, dir: "ui/simple", fonts: simpleFonts(),
                                                              language: { language: "ja", mode: 2 } });
  const win = new SimpleTalkWindow(doc, W, { loop, tweens, language: { language: "ja", mode: 2 } });
  const tt = doc.node(TT), st = doc.node(ST);
  assert.equal(tt.storyText.b.class, "RubyEmojiTextMeshProUGUI");
  assert.equal(st.storyText.t, st.text);
  win.talk.refresh();
  assert.equal(win.part.talkArea.activeSelf, false);
  win.talk.showTalk(0);                                                 // no _talkBackground: TalkArea only
  assert.equal(win.part.talkArea.activeSelf, true);
  win.setSpeakerName("Name");
  assert.equal(st.text.text, "Name");
  assert.equal(win.part.speaker.activeSelf, true);
  const typing = win.talk.setTalk("A<r=BC>D</r>E");
  assert.equal(typing.totalLength, 5);                                  // RemoveTagsWithRuby: A BC D E
  assert.equal(tt.text.margin.y, -22);                                  // UIRubyText: the ruby margin top
  assert.match(tt.text.text, /^A<nobr>.*D.*<voffset=1em><size=50%>BC<\/size><\/voffset>.*<\/nobr>E$/);
  for (let i = 0; i < 10; i++) await loop.step();
  assert.equal(win.talk.isTyping, false);
  win.talk.setTalk("AB");
  assert.equal(tt.text.margin.y, 0);
  win.talk.hideTalk(0);
  assert.equal(win.part.talkArea.activeSelf, false);
});
