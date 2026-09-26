// Opt-in: the story UI's layout and timing on a real story (the front canvas of one episode) in Node, no GL.
//
//   OURNOTES_STORY=<dir>              a story's logical files: episode.json, ui/ui.json, ui/fonts.json, ui/languages.json
//                                     (skipped without it)
//   OURNOTES_STORY_UI_LINES=<file>    optional: write the line breaks of every Talk line of the episode in the talk text
//                                     (JSON: per Talk row the text of each laid-out line), e.g. to compare font sets
//
// The UI runs on the engine's PlayerLoop at 30 fps with the episode's own texts: the first speaker, the longest Talk
// line, the first location name and the title. Checks (each with its tolerance): the talk window, speaker plate,
// location caption, title, menu button, curtains and rule cover boxes at 2340 x 1080 (13:6 viewport) and 2400 x 1080
// (20:9 phone), y-up canvas units with the origin at the canvas' bottom-left corner; the talk background fade
// (DOFade 0.2 s, OutQuad); the typewriter frames per character; the next indicator and auto icon clips; the location
// sequence end; the title clip; the TMP line metrics of the talk, speaker and location texts; the rule fade
// (adv_transition_0001); the letterbox bands and their fade on a 16:9 screen. Values that depend on the font follow
// from the font asset's face info; with the game's fonts (ui/fonts.json `source` "game") the worked TMP example of the
// speaker name 樂奈 (quad, padded atlas rect, preferred width) is checked as well.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { F } from "../../src/engine/core.js";
import { PlayerLoop } from "../../src/engine/loop.js";
import { StoryUI } from "../../src/story/ui.js";
import { countedText } from "../../src/story/ui-ruby.js";
import { countRenderedCharacters, removeTagsWithRuby } from "../../src/story/ui-talk.js";

const DIR = process.env.OURNOTES_STORY || "", LINES = process.env.OURNOTES_STORY_UI_LINES || "";
const SKIP = DIR ? false : "OURNOTES_STORY is not set (path of a story directory)";
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));

test("story UI layout and timing", { skip: SKIP }, async () => {
  const doc = readJSON("ui/ui.json"), fonts = readJSON("ui/fonts.json"), language = readJSON("ui/languages.json");
  const episode = readJSON("episode.json");
  const field = language.field;
  const txt = (id) => episode.text[id][field];
  const talks = episode.commands.filter((c) => c.cmd === "Talk" && c.AdvTextID && c.AdvTextID !== "0");
  const firstTalk = talks.find((c) => c.TargetTextIDs && c.TargetTextIDs.length);
  const speaker = `<color=${firstTalk.TargetTextColors[0]}>${txt(firstTalk.TargetTextIDs[0])}</color>`;
  const line = talks.map((c) => txt(c.AdvTextID)).reduce((a, b) => (b.length > a.length ? b : a));
  const locCmd = episode.commands.find((c) => c.cmd === "Location");
  const locName = locCmd ? txt(locCmd.AdvTextID && locCmd.AdvTextID !== "0" ? locCmd.AdvTextID : locCmd.TargetTextIDs[0]) : null;
  const title = episode.title[field];

  const rows = [];
  let failed = 0;
  const check = (name, got, want, tol, note = "") => {
    const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
    if (!ok) failed++;
    rows.push([ok ? "ok" : "FAIL", name, typeof got === "number" ? +got.toFixed(5) : got,
               typeof want === "number" ? +want.toFixed(5) : want, tol === 0 ? "exact" : tol, note]);
  };
  const box = (name, n, want, tol, note) => {
    const b = n.canvasBox();
    ["x0", "y0", "x1", "y1"].forEach((k, i) => { if (want[i] !== null) check(`${name}.${k}`, b[i], want[i], tol, note); });
  };

  const loop = new PlayerLoop(30);
  const ui = new StoryUI(null, loop, doc, { lang: language.language, fonts, language });
  ui.setTalkWindow("UIDefaultTalkWindow");
  const D = ui.windows.get("UIDefaultTalkWindow").part;                // the default window's parts with the widget's
  const P = { ...ui.part, ...D, speakerBack: D.speaker.find("Back") }, tt = P.talkText.text;
  const step = async (n = 1) => { for (let i = 0; i < n; i++) await loop.step(); };
  const talkFont = tt.font, fi = talkFont.faceInfo;

  // --- scenario, all calls between frames (frame 0) ----------------------------------------------------------------
  ui.showTitle(title);
  const locDone = locName !== null ? ui.showLocation(locName).then(() => { locDone.frame = loop.frameCount; }) : null;
  ui.showTalk();
  ui.setSpeakerName(speaker);
  const typing = ui.setTalk(line);
  const plain = removeTagsWithRuby(line);
  check("typewriter: totalLength", typing.totalLength, countRenderedCharacters(countedText(tt, P.talkText.storyText.b, plain)), 0, "tags removed");
  check("typewriter: visible at call (frame 0)", tt.maxVisibleCharacters, 1, 0, "first character in the same frame");
  const visibleAt = [0];
  let bgFullAt = -1, typingDoneAt = -1;
  const indicatorY = [], bgAlpha = [];
  typing.finished.then(() => { typingDoneAt = loop.frameCount; });
  for (let f = 1; f <= 90; f++) {
    await step();
    while (visibleAt.length < tt.maxVisibleCharacters) visibleAt.push(f);
    const a = P.background.canvasGroup.alpha;
    if (f <= 6) bgAlpha.push(a);
    if (bgFullAt < 0 && a >= 1) bgFullAt = f;
    if (P.nextIndicator.activeInHierarchy && indicatorY.length < 3) indicatorY.push([f, P.nextIndicator.anchoredPosition.y]);
    if (f === 30) {
      // --- layout at frame 30 (1.0 s): location and title in their hold phase --------------------------------------
      for (const [pw, ph] of [[2340, 1080], [2400, 1080]]) {
        const { W, H, scale } = ui.canvasSize(pw, ph);
        const tag = `${W}x${H}`;
        check(`${tag} canvas scale`, scale, 1, 0, "Expand, height wins");
        ui.layout(W, H);
        const c = W / 2, pwS = P.speakerText.text.preferredWidth(), pwT = P.titleText.text.preferredWidth();
        box(`${tag} TalkBackground`, P.background, [-400, -66, W + 400, 290], 0.01, "prefab");
        box(`${tag} TalkText`, P.talkText, [c - 591.29, 1.91, c + 608.71, 201.91], 0.01, "prefab");
        box(`${tag} Speaker`, P.speaker, [c - 606, 255, c + 194, 315], 0.01, "prefab");
        box(`${tag} Line`, P.speaker.find("Line"), [c - 606.86, 224.4, c + 595.31, 237.4], 0.01, "prefab");
        box(`${tag} Back`, P.speakerBack, [c - 606, 228.1, c - 606 + 20 + pwS + 80, 288.1], 0.01, "20 + pw + 80");
        box(`${tag} SpeakerText`, P.speakerText, [c - 586, 258.1 - 18, c - 586 + pwS, 258.1 + 18], 0.01, "layout group");
        box(`${tag} FastIcon`, P.fastIcon, [c + 700, 46, c + 760, 106], 0.01, "centre (W/2+730, 76)");
        if (locDone) {
          box(`${tag} LocationVIew`, P.location, [c - 700, H / 2 - 43, c + 700, H / 2 + 43], 0.01, "hold (x 0)");
          box(`${tag} LocationText`, P.locationText, [c - 700, H / 2 - 31, c + 700, H / 2 + 31], 0.01, "prefab");
        }
        box(`${tag} Title`, P.titleBar, [0, H - 90, 40 + pwT + 364.5, H - 30], 0.01, "40 + pw + 364.5");
        box(`${tag} TitleText`, P.titleText, [40, H - 90, 40 + pwT, H - 30], 0.01, "layout group");
        box(`${tag} MenuEntryButton`, P.menuButton, [W - 204, H - 128, W - 84, H - 8], 0.01, "prefab");
        box(`${tag} UIPictogram`, P.menuButton.find("Contents/UIPictogram"), [W - 174, H - 98, W - 114, H - 38], 0.01, "prefab");
        box(`${tag} RightCurtain`, ui.front.find("RightCurtain"), [c + 1169, null, c + 2169, null], 0.01, "prefab");
        box(`${tag} LeftCurtain`, ui.front.find("LeftCurtain"), [c - 2169, null, c - 1169, null], 0.01, "prefab");
        box(`${tag} RuleTransition`, P.rule, [0, 0, W, H], 0.01, "full stretch");
      }
      if (locDone) check("location alpha at t=1.0", P.location.canvasGroup.alpha, 1, 1e-6, "clip hold");
      check("title alpha at t=1.0", P.title.canvasGroup.alpha, 1, 1e-6, "clip hold");
      ui.layout(2340, 1080);
      rows.push(["--", "paint order (2340)", ui.drawList(ui.front).map((it) => it.node.name + (it.kind === "text" ? `[${it.chars.length}]` : "")).join(" > "), "", "", ""]);
    }
  }
  // --- talk background fade: DOFade(1, 0.2) OutQuad, float32 position ------------------------------------------------
  bgAlpha.forEach((a, i) => {
    const pos = Math.min(F((i + 1) * F(1 / 30)), 0.2), k = pos / 0.2;
    check(`TalkBackground alpha frame ${i + 1}`, a, i + 1 >= 6 ? 1 : -k * (k - 2), 1e-6, "OutQuad");
  });
  check("TalkBackground alpha 1 at frame", bgFullAt, 6, 0, "0.2 s at 30 fps");
  // --- typewriter: 1 WaitWhile tick, then Delay ticks until elapsed >= delay; ASCII letters 1 tick -----------------------
  const delay = F(Math.trunc(F(F([1, 4].includes(language.mode) ? 0.015 : ui.talk.typingDelay) / 1) * 1000 + 0.5) / 1000);
  let ticks = 0;
  for (let e = 0; e < delay; e = F(e + F(1 / 30))) ticks++;
  const perChar = (ch) => (/[A-Za-z]/.test(ch) ? 1 : 1 + ticks);
  const letters = [...Array(typing.totalLength).keys()].map((i) => plain[i] || "");
  const steps = visibleAt.slice(1).map((f, k) => f - visibleAt[k]);
  check("typewriter: frames per char", steps.join(","), letters.slice(0, -1).map(perChar).join(","), 0, `1 + ${ticks} ticks, letters 1`);
  const wantEnd = visibleAt[visibleAt.length - 1] + perChar(letters[letters.length - 1]);
  check("typewriter: typing end frame", typingDoneAt, wantEnd, 0, `${typing.totalLength} chars`);
  check("typewriter: isTyping after end", ui.isTyping, false, 0, "");
  // --- NextIndicator Loop clip after activation at the typing end: y = 76 - 600 t^2 + 2000 t^3 -----------------------------
  indicatorY.forEach(([f, y]) => {
    const t = (f - typingDoneAt + 1) / 30;
    check(`NextIndicator y frame ${f}`, y, 76 - 600 * t * t + 2000 * t * t * t, 1e-3, "clip (t = frames since enable)");
  });
  if (locDone) {
    let seqPos = 0, seqSteps = 0;
    while (seqPos < F(2.5)) { seqPos = F(seqPos + F(1 / 30)); seqSteps++; }
    check("location sequence end frame", locDone.frame, seqSteps + 1, 0, "2.5 s (float32 position) + WaitWhile tick");
  }
  // --- title clip near t = 5.5 s: alpha 1 - 3u^2 + 2u^3, x -900u^2 + 600u^3, u = t - 5 ------------------------------------
  await step(165 - loop.frameCount);
  const tu = P.title.animator.time - 5;
  check("title state time at frame 165", P.title.animator.time, 5.5, 1e-4, "165 frames");
  check("title alpha at state time", P.title.canvasGroup.alpha, 1 - 3 * tu * tu + 2 * tu * tu * tu, 1e-4, "clip");
  check("title x at state time", P.title.anchoredPosition.x, -900 * tu * tu + 600 * tu * tu * tu, 1e-3, "clip");

  // --- TMP numbers ------------------------------------------------------------------------------------------------------
  ui.layout(2340, 1080);
  tt.generate();
  const L = tt.lines, s36 = F(F(36 / fi.m_PointSize) * fi.m_Scale), em36 = F(36 * 0.01);
  const feeds = tt.tokens.filter((k) => k.c === 10 || k.c === 11 || k.c === 0x2028 || k.c === 0x2029).length;
  check("TalkText lines", L.length, tt.wrapping === 1 ? L.length : feeds + 1, 0, "line feeds (NoWrap)");
  const game = fonts.source === "game";
  if (L.length > 1) {
    const want = game && talkFont.name === "FZLTH_GB18030L2_R SDF" ? 43.38 : fi.m_LineHeight * s36 + tt.lineSpacing * em36;
    check("line advance @36", L[0].baseline - L[1].baseline, want, 1e-4, "lineHeight x scale + lineSpacing x 0.36");
  }
  const top = P.talkText.rect.y + P.talkText.rect.h;
  const wantTop = game && talkFont.name === "FZLTH_GB18030L2_R SDF" ? 32.11 : fi.m_AscentLine * s36;
  check("first baseline below box top", top - (tt.anchor.y + L[0].baseline), wantTop, 0.005, "ascent x scale");
  const vis = tt.chars.filter((c) => c.visible && c.g.metrics.m_HorizontalAdvance > 0);
  const i0 = tt.chars.indexOf(vis[0]), next = tt.chars[i0 + 1];
  if (next && next.lineNumber === vis[0].lineNumber)
    check("characterSpacing 2 @36 per glyph", next.xAdvance - vis[0].xAdvance - next.g.metrics.m_HorizontalAdvance * next.scale,
          (talkFont.normalSpacingOffset + 2) * 0.36, 1e-4, "(offset + 2) x 0.36");
  const st = P.speakerText.text;
  st.generate();
  const s0 = st.chars.find((c) => c.visible), s1 = st.chars[st.chars.indexOf(s0) + 1];
  if (s1) {
    const boldExtra = s1.xAdvance - s0.xAdvance - s1.g.metrics.m_HorizontalAdvance * s1.scale - (st.font.normalSpacingOffset + 2) * 0.36;
    check("bold extra advance @36", boldExtra, game && st.font.name === "FZLTH_GB18030L2_R SDF" ? 2.52 : st.font.boldSpacing * 0.36, 1e-4,
          "boldSpacing x 0.36");
  }
  // worked TMP example with the game font (SpeakerText 樂, bold 36, OutlineAdvCommon)
  const le = st.chars.find((c) => c.u === 0x6A02);
  if (game && le && st.font.name === "FZLTH_GB18030L2_R SDF") {
    check("樂 TL.x", le.x0, -4.786875, 1e-4, "TMP example"); check("樂 TL.y", le.y1, 34.520625, 1e-4, "TMP example");
    check("樂 TR.x", le.x1, 40.68, 1e-4, "TMP example"); check("樂 BL.y", le.y0, -9.140625, 1e-4, "TMP example");
    const r = le.g.rect;
    check("樂 padded rect", `${r.m_X - 16},${r.m_Y - 16},${r.m_X + r.m_Width + 16},${r.m_Y + r.m_Height + 16}`,
          "1866,3460,1992,3587", 0, "padding 13.1875 + style 2.8125");
    if (st.text === "<color=#FFFFFF>樂奈</color>") check("樂奈 preferred width", st.preferredWidth(), 75.25, 0, "TMP example");
  }
  if (locDone) {
    const lt = P.locationText.text, lf = lt.font.faceInfo, s40 = F(F(40 / lf.m_PointSize) * lf.m_Scale);
    lt.generate();
    const want = game && lt.font.name === "FZLTH_GB18030L2_R SDF" ? 12.58 : (lf.m_AscentLine * s40 + lf.m_DescentLine * s40) / 2;
    check("LocationText baseline below centre", -(lt.anchor.y + lt.lines[0].baseline), want, 1e-4, "middle @40");
  }

  // --- AutoIcon: speed -1 Loop, z = 269.25 t^2 - 89.75 t^3 at t = 2 - dt after enable --------------------------------------
  ui.setAutoMode(true);
  check("auto mode hides the indicator", P.nextIndicator.activeSelf, false, 0, "SetAutoMode(true)");
  await step();
  const ta = 2 - 1 / 30;
  check("AutoIcon z one frame after enable", P.autoIcon.rotationZ, 269.25 * ta * ta - 89.75 * ta * ta * ta, 1e-3, "clip, speed -1");
  ui.setAutoMode(false);

  // --- rule fade: FadeIn 1.0 s with the default transition; shader alpha = smoothstep(clamp01((1 - Val) / 2)) -------------
  const ts = ui.transitionSettings(doc.playerSettings._defaultTransitionAssetAddress);
  const f0 = loop.frameCount;
  let ruleHiddenAt = -1, val15 = null;
  const fade = ui.fadeIn(ts, { r: 0, g: 0, b: 0, a: 1 }, 1.0).then(() => { ruleHiddenAt = loop.frameCount - f0; });
  check("FadeIn _Val at call", ui.rule.val, -1, 0, "alpha 1");
  for (let f = 1; f <= 32; f++) { await step(); if (f === 15) val15 = ui.rule.val; }
  await fade;
  const u15 = Math.min(Math.max((1 - val15) / 2, 0), 1);
  check("FadeIn alpha at frame 15", u15 * u15 * (3 - 2 * u15), 0.5, 1e-5, "smoothstep(1 - p)");
  let tf = 0, n = 0;
  while (tf < 1) { tf = F(tf + F(1 / 30)); n++; }
  check("FadeIn hides at frame", ruleHiddenAt, n, 0, "loop (float32 t)");
  check("RuleTransition inactive after FadeIn", P.rule.activeSelf, false, 0, "");

  // --- letterbox on a 16:9 screen (1920 x 1080): viewport 1920 x 886, band 97, draw height 0.75 x 1920 -----------------------
  const sw = 1920, sh = 1080, vh = Math.round(sh * (sw / sh) / 2.1666667), vy = Math.round((sh - vh) / 2);
  ui.renderLetterBox({ gl: null, screenWidth: sw, screenHeight: sh, viewport: { x: 0, y: vy, w: sw, h: vh } });
  const band = (sh - vh) / 2;
  check("letterbox active", ui.letterBox.activeSelf, true, 0, "band > 1");
  check("letterbox alpha before fade-in", ui.letterBox.canvasGroup.alpha, 0, 0, "SetLetterBoxVisibleImmediate(alpha 0)");
  box("TopBand", P.topBand, [0, sh - band, sw, sh - band + 1440], 0.01, "band");
  box("BottomBand", P.bottomBand, [0, band - 1440, sw, band], 0.01, "band");
  const lf0 = loop.frameCount;
  let lbDone = -1;
  ui.fadeInLetterBox().then(() => { lbDone = loop.frameCount - lf0; });
  await step(8);
  check("letterbox alpha after fade", ui.letterBox.canvasGroup.alpha, 1, 0, "0.2 s linear");
  // fade frames 1..6 in UIAdvWidget.OnUpdated; the WaitUntil runs in UniTask's Update runner, which precedes
  // MonoBehaviour Update, so it sees the end on frame 7
  check("fadeInLetterBox resolves at frame", lbDone, 7, 0, "WaitUntil in the UniTask Update runner");

  // --- line breaks of every Talk line (optional dump) -------------------------------------------------------------------
  if (LINES) {
    const out = {};
    for (const c of talks) {
      const s = txt(c.AdvTextID);
      P.talkText.storyText.setText(s); tt.setMaxVisible(99999); tt.generate();
      out[c.i] = tt.lines.map((ln) => tt.chars.slice(ln.first, ln.last + 1).map((ch) => String.fromCodePoint(ch.u)).join(""));
    }
    fs.writeFileSync(LINES, `${JSON.stringify({ language: language.language, source: fonts.source, lines: out }, null, 1)}\n`);
  }

  // --- table ------------------------------------------------------------------------------------------------------------
  const wcol = [4, 44, 18, 18, 7];
  for (const r of rows) {
    if (r[0] === "--") { console.log(`# ${r[1]}: ${r[2]}`); continue; }
    console.log(`# ${r.slice(0, 5).map((v, i) => String(v).padEnd(wcol[i])).join(" ")} ${r[5]}`);
  }
  const nChecks = rows.filter((r) => r[0] !== "--").length;
  console.log(`# ${nChecks - failed}/${nChecks} checks passed`);
  assert.equal(failed, 0, `${failed} of ${nChecks} checks failed`);
});
