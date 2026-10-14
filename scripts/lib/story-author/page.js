// The story author's page code: runs in the headless browser (chrome.js) on the author's server (server.js) and
// posts the pictures it draws to /out/<name>.png. run(job) does one job and returns its report:
//   story    plays a composed story manifest with StorySession, stepping 1/30 s at a time, and takes a picture of
//            each line once its text is fully shown (then taps to the next line); contact sheets of the pictures.
//            Each frame says how long the line took to show and how long the player would have held it in auto mode
//            (autoSeconds), and a line whose text overflows its talk window comes with the wrap the fix is built from
//   model    a model (ModelSession) with each expression, and in each motion, on contact sheets
//   stages   the background pictures of a base story's stages on a contact sheet
// Progress goes to console.log (the author prints it on stderr).
import { AssetStore } from "../../../src/data/assets.js";
import { TMP_WRAP } from "../../../src/engine/uitext.js";
import { ModelSession } from "../../../src/live2d/session.js";
import { loadStoryStore } from "../../../src/story/assets.js";
import { NEXT_STEP } from "../../../src/story/player-core.js";
import { StorySession } from "../../../src/story/session.js";

const SHEET_BG = "#15151a", LABEL_BG = "#22222a", LABEL_FG = "#f2f2f2", LABEL_DIM = "#a8a8b8";
const LABEL_H = 30, GAP = 6;

const canvasOf = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

const pngOf = (canvas) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the canvas gave no PNG"))), "image/png"));

const post = async (name, blob) => {
  const r = await fetch(`/out/${encodeURIComponent(name)}`, { method: "POST", body: blob });
  if (!r.ok) throw new Error(`saving ${name}: HTTP ${r.status}`);
  return name;
};

// the text cut to fit `width` pixels with an ellipsis
const fit = (ctx, text, width) => {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, m)}…`).width <= width) lo = m; else hi = m - 1;
  }
  return `${text.slice(0, lo)}…`;
};

// Contact sheets of pictures: cells of `cellW` x `cellH` with a label band above each ({title, detail}), `columns`
// per row, at most `perSheet` per sheet. -> the names of the sheets posted (`${prefix}.png`, or `${prefix}-<n>.png`)
const sheets = async (cells, { prefix, columns, cellW, cellH, perSheet = 12, font }) => {
  const out = [];
  const pages = Math.max(1, Math.ceil(cells.length / perSheet));
  for (let page = 0; page < pages; page++) {
    const list = cells.slice(page * perSheet, (page + 1) * perSheet);
    if (!list.length) break;
    const cols = Math.min(columns, list.length), rows = Math.ceil(list.length / cols);
    const W = GAP + cols * (cellW + GAP), H = GAP + rows * (LABEL_H + cellH + GAP);
    const c = canvasOf(W, H), ctx = c.getContext("2d");
    ctx.fillStyle = SHEET_BG;
    ctx.fillRect(0, 0, W, H);
    list.forEach((cell, i) => {
      const x = GAP + (i % cols) * (cellW + GAP), y = GAP + Math.floor(i / cols) * (LABEL_H + cellH + GAP);
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(x, y, cellW, LABEL_H);
      ctx.textBaseline = "middle";
      ctx.font = `bold 15px ${font}`;
      ctx.fillStyle = LABEL_FG;
      const title = fit(ctx, cell.title, cellW - 12);
      ctx.fillText(title, x + 6, y + LABEL_H / 2);
      if (cell.detail) {
        const tw = ctx.measureText(title).width + 10;
        ctx.font = `14px ${font}`;
        ctx.fillStyle = LABEL_DIM;
        ctx.fillText(fit(ctx, cell.detail, cellW - 12 - tw), x + 6 + tw, y + LABEL_H / 2);
      }
      if (cell.image) ctx.drawImage(cell.image, x, y + LABEL_H, cellW, cellH);
    });
    const name = pages > 1 ? `${prefix}-${page + 1}.png` : `${prefix}.png`;
    out.push(await post(name, await pngOf(c)));
  }
  return out;
};

const LABEL_FONT = "\"Noto Sans CJK SC\", \"Noto Sans SC\", \"Microsoft YaHei\", \"PingFang SC\", \"Hiragino Sans\", sans-serif";

// ------------------------------------------------------------------------------------------------ story

// The talk text's layout once the line is shown: its lines, point size, the widest line's advance and the text's
// height against the room its box has (the talk text does not wrap: a line longer than the box runs past it).
const talkLayout = (s) => {
  const talk = s.ui && s.ui.talk, node = talk && talk.p.talkText;
  if (!node || !node.text) return null;
  const t = node.text, mg = t.margin, r = node.rect;
  const lines = t.lines.filter(Boolean);
  const width = Math.max(0, ...lines.map((l) => l.maxAdvance || 0));
  const height = lines.length ? lines[0].ascender - lines[lines.length - 1].descender : 0;
  const widthLimit = Math.max(0, r.w - mg.x - mg.z), heightLimit = Math.max(0, r.h - mg.y - mg.w);
  const round = (v) => Math.round(v * 10) / 10;
  return { lines: lines.length, fontSize: round(t.renderedFontSize), width: round(width), widthLimit: round(widthLimit),
           height: round(height), heightLimit: round(heightLimit),
           overflow: width > widthLimit + 0.01 || height > heightLimit + 0.01 };
};

// Where word wrapping breaks the talk text, for the fix of a line that does not fit: the talk text laid out again with
// TextMeshPro's word wrapping (its rules, the font's CJK line breaking rules included: the breaks the game's text
// engine takes), then with its own wrapping mode again. -> {lines: the text of each line (the characters laid out,
// the line feed that ends it included), asc, desc: the ascender and descender of each line} of a text that fits the
// window's width once broken, else null (a single word stays wider than the window).
const wrapLayout = (s) => {
  const talk = s.ui && s.ui.talk, node = talk && talk.p.talkText;
  if (!node || !node.text) return null;
  const t = node.text, r = node.rect, mg = t.margin, limit = Math.max(0, r.w - mg.x - mg.z), mode = t.wrapping;
  try {
    t.setWrapping(TMP_WRAP.Normal);
    t.generate();
    const info = t.lines.filter(Boolean);
    if (!info.length || info.some((l) => (l.maxAdvance || 0) > limit + 0.01)) return null;
    const lines = info.map((l, i) => t.chars.slice(l.first, i + 1 < info.length ? info[i + 1].first : t.chars.length)
      .filter(Boolean).map((c) => String.fromCodePoint(c.u)).join(""));
    return { lines, asc: info.map((l) => l.ascender), desc: info.map((l) => l.descender) };
  } catch (e) {
    console.log(`no wrap layout: ${e.message}`);
    return null;
  } finally {
    t.setWrapping(mode);
    t.generate();
  }
};

// The seconds the player holds a typed line of `length` characters in auto mode, without voices
// (AdvTextCommandHelper.WaitAutoPlayText): _waitTalkTextUnitTime per character, at least _minTalkDisplayTime, at the
// playback speed rate `speed`.
const autoHold = (P, length, speed) => Math.max(P._waitTalkTextUnitTime * length, P._minTalkDisplayTime) / speed;

const round2 = (v) => Math.round(v * 100) / 100;

// job: {manifest, lang, family, sample, width, height, quality, from, to, settle, maxSeconds, columns, cellWidth,
// lines: [{line, title, detail}] (the labels of the contact sheet)}
const story = async (job) => {
  const t0 = performance.now();
  if (job.family) await document.fonts.load(`40px ${job.family}`, job.sample || "A");
  const store = await loadStoryStore(job.manifest, { lang: job.lang });
  const canvas = canvasOf(job.width, job.height);
  document.body.append(canvas);
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
                                           premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is not available in the browser");
  const s = await StorySession.create(gl, store, { lang: job.lang, line: job.from, autoplay: true, auto: false,
                                                    sound: false, voice: false, seed: 1, quality: job.quality,
                                                    width: job.width, height: job.height });
  console.log(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  // the characters the typewriter of the current line types (the talk view's setTalk -> {totalLength})
  let length = 0;
  const setTalk = s.ui.setTalk.bind(s.ui);
  s.ui.setTalk = (text) => { const t = setTalk(text); length = t.totalLength; return t; };
  const P = s.ctx.settings.player;
  const frames = [], thumbs = [];
  const cellW = job.cellWidth, cellH = Math.round(cellW * job.height / job.width);
  const limit = Math.round(job.maxSeconds * 30);
  let shown = job.from - 1, idle = 0, current = -1, started = 0;
  try {
    while (!s.ended && shown < job.to) {
      await s.step({ draw: false });
      const line = s.line;
      if (line !== current) { current = line; started = s.time; }
      if (line > shown && !s.ui.isTyping && s.core.nextStep === NEXT_STEP.AllowNext) {
        const timing = { characters: length, typing: round2(s.time - started),
                         autoHold: round2(autoHold(P, length, s.core.speedRate())) };
        for (let i = 0; i < job.settle; i++) await s.step({ draw: false });
        s.render();
        const file = `line-${String(line).padStart(3, "0")}.png`;
        await post(file, await pngOf(canvas));
        const talk = talkLayout(s), wrap = talk && talk.overflow ? wrapLayout(s) : null;
        frames.push({ line, file, time: round2(s.time), talk, timing, ...(wrap ? { wrap } : {}) });
        thumbs.push({ line, image: await createImageBitmap(canvas, { resizeWidth: cellW, resizeHeight: cellH, resizeQuality: "high" }) });
        console.log(`line ${line}`);
        shown = line;
        idle = 0;
        if (line < job.to) s.tap();
        continue;
      }
      if (++idle > limit) throw new Error(`no line came to wait for a tap within ${job.maxSeconds} s of story time after line ${shown}`);
    }
  } finally {
    await s.dispose();
  }
  const labels = new Map(job.lines.map((l) => [l.line, l]));
  const cells = thumbs.map((t) => ({ title: `#${t.line} ${(labels.get(t.line) || {}).title || ""}`,
                                     detail: (labels.get(t.line) || {}).detail || "", image: t.image }));
  const sheetFiles = await sheets(cells, { prefix: "sheet", columns: job.columns, cellW, cellH, font: LABEL_FONT });
  return { frames, sheets: sheetFiles, ended: s.ended, seconds: Math.round((performance.now() - t0) / 100) / 10 };
};

// ------------------------------------------------------------------------------------------------ model

// job: {id, manifest, expressions: [names], motions: [{stem, clip}], width, height, face and body: {crop: [x, y, w,
// h] (fractions of the picture), cellWidth, columns} (the expressions are shown on the face, the motions on the
// body), settle (frames after an expression), motionAt (seconds into a motion)}
const model = async (job) => {
  const t0 = performance.now();
  const assets = await AssetStore.fromManifest(job.manifest);
  const canvas = canvasOf(job.width, job.height);
  document.body.append(canvas);
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
                                           stencil: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is not available in the browser");
  const s = await ModelSession.create({ gl, assets, seed: 1, width: job.width, height: job.height });
  // a view: the crop in pixels and the cell size
  const view = ({ crop: [cx, cy, cw, ch], cellWidth, columns }) => {
    const sw = Math.round(cw * job.width), sh = Math.round(ch * job.height);
    return { sx: Math.round(cx * job.width), sy: Math.round(cy * job.height), sw, sh, columns,
             cellW: cellWidth, cellH: Math.round(cellWidth * sh / sw) };
  };
  const face = view(job.face), body = view(job.body);
  const shot = (v) => {
    s.render();
    return createImageBitmap(canvas, v.sx, v.sy, v.sw, v.sh, { resizeWidth: v.cellW, resizeHeight: v.cellH, resizeQuality: "high" });
  };
  const steps = async (n) => { for (let i = 0; i < n; i++) await s.step({ draw: false }); };
  const out = {};
  try {
    await steps(job.settle);
    const exp = [];
    for (const name of job.expressions) {
      s.setExpression(name, { fade: 0 });
      await steps(job.settle);
      exp.push({ title: name, image: await shot(face) });
    }
    out.expressions = await sheets(exp, { prefix: `${job.id}-expressions`, ...face, perSheet: 40, font: LABEL_FONT });
    console.log(`${job.expressions.length} expressions`);
    if (job.expressions.length) s.setExpression(s.defaultExpression || job.expressions[0], { fade: 0 });
    const mot = [];
    for (const m of job.motions) {
      s.playMotion(m.clip, { fade: 0 });
      await steps(Math.round(job.motionAt * 30));
      mot.push({ title: m.stem, detail: m.clip === m.stem ? "" : m.clip.slice(m.stem.length + 1), image: await shot(body) });
    }
    out.motions = await sheets(mot, { prefix: `${job.id}-motions`, ...body, perSheet: 24, font: LABEL_FONT });
    console.log(`${job.motions.length} motions`);
  } finally {
    await s.dispose();
  }
  return { ...out, seconds: Math.round((performance.now() - t0) / 100) / 10 };
};

// ------------------------------------------------------------------------------------------------ stages

// job: {stages: [{id, caption, url}], cellWidth, columns}
const stages = async (job) => {
  const cells = [];
  let cellH = 0;
  for (const st of job.stages) {
    let image = null;
    if (st.url) {
      const r = await fetch(st.url);
      if (!r.ok) throw new Error(`${st.url}: HTTP ${r.status}`);
      const bmp = await createImageBitmap(await r.blob());
      cellH = cellH || Math.round(job.cellWidth * bmp.height / bmp.width);
      image = bmp;
    }
    cells.push({ title: st.id, detail: st.caption, image });
  }
  cellH = cellH || Math.round(job.cellWidth * 9 / 16);
  return { sheets: await sheets(cells, { prefix: "stages", columns: job.columns, cellW: job.cellWidth, cellH, perSheet: 24, font: LABEL_FONT }) };
};

const JOBS = { story, model, stages };

export const run = (job) => {
  const f = JOBS[job.kind];
  if (!f) throw new Error(`unknown job ${job.kind}`);
  return f(job);
};
