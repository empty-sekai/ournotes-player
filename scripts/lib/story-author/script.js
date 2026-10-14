// Story scripts: the document an author writes to make a dialogue story with the stages, music, story UI and Live2D
// models of a story site, its checks and its compilation into the story player's data (docs/story-author.md).
//
// A script (format SCRIPT_FORMAT) names a base story of the site (`base`: the path of its story manifest) whose
// stages, music, story UI and player settings it uses, the language of its texts, the font family the browser draws
// them with, the cast (models of the site's models.json and the names they speak under) and the beats in order:
//   {"scene": <stage>, "music"?, "location"?, "camera"?, "positions"?}   a new stage behind a fade
//   {"positions": {...}, "camera"?}                                     who stands where from this beat on
//   {"say": <cast id>, "text", "motion"?, "expression"?}                a line of a character
//   {"narrate": <text>}                                                 a line without a speaker
// parseScript checks the document's shape; checkScript checks its names against the site (stages, music, models,
// motions, expressions) and the staging (positions, speakers on stage). Every problem names the JSON pointer of the
// value, an unknown name comes with the names that exist and the nearest one, and a problem with a known fix carries it
// as JSON Patch operations (applyFixes applies them; layoutFix makes the fix of a line that overflows the talk
// window). compileScript turns a script without errors into the episode's command rows (episode.json) and the story
// index (story.json).

import { ADV_COMMAND } from "../../../src/story/interfaces.js";
import { STORY_LANGUAGES } from "../../../src/story/params.js";

export const SCRIPT_FORMAT = "ournotes.story-script/1";

// the character slots of the story field (AdvCharacterField position types), far left to far right
export const POSITIONS = Object.freeze({ "far-left": 1, left: 3, center: 5, right: 7, "far-right": 9 });
// the side a slot's motions face: the game's motions come in _L, _C and _R variants
const SIDE = { 1: "L", 3: "L", 5: "C", 7: "R", 9: "R" };

// The name of the position nearest `slot` that `occupied` (a set of position values) does not hold, or null when every
// position is taken. -> "far-left" | "left" | "center" | "right" | "far-right"
export const freeSlot = (slot, occupied) =>
  Object.keys(POSITIONS).sort((a, b) => Math.abs(POSITIONS[a] - slot) - Math.abs(POSITIONS[b] - slot) || POSITIONS[a] - POSITIONS[b])
    .find((k) => !occupied.has(POSITIONS[k])) || null;
// focus data: the camera distance
export const CAMERAS = Object.freeze({ near: 1, middle: 2, far: 3 });
export const FONT_PRESETS = Object.freeze(["sans", "serif", "rounded"]);
export const MUSIC_STOP = "stop";

const NAME_COLOR = "#FFFFFF";
const SCENE_FADE = 1;                                          // seconds of the fade between scenes
const CAST_FADE = 0.2;                                         // seconds a character takes to enter or leave
const FOCUS_MOVE = 0.5;                                        // seconds the camera takes to follow a positions beat
const BGM_FADE = "1.5";
const TITLE_ID = "custom_title";
const CAST_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

// The browser's font families (CSS font-family lists) of the font presets, per story language.
export const FONT_FAMILIES = Object.freeze({
  sans: {
    ja: "\"Noto Sans JP\", \"Hiragino Sans\", \"Yu Gothic UI\", \"Yu Gothic\", Meiryo, sans-serif",
    en: "\"Noto Sans\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
    "zh-Hant": "\"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif",
    "zh-Hans": "\"Noto Sans SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
    ko: "\"Noto Sans KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", sans-serif",
  },
  serif: {
    ja: "\"Noto Serif JP\", \"Hiragino Mincho ProN\", \"Yu Mincho\", serif",
    en: "\"Noto Serif\", Georgia, \"Times New Roman\", serif",
    "zh-Hant": "\"Noto Serif TC\", \"Songti TC\", PMingLiU, serif",
    "zh-Hans": "\"Noto Serif SC\", \"Songti SC\", SimSun, serif",
    ko: "\"Noto Serif KR\", \"AppleMyungjo\", Batang, serif",
  },
  rounded: {
    ja: "\"M PLUS Rounded 1c\", \"Hiragino Maru Gothic ProN\", \"Yu Gothic UI\", sans-serif",
    en: "Nunito, \"Varela Round\", \"Arial Rounded MT Bold\", sans-serif",
    "zh-Hant": "\"Yuanti TC\", \"Microsoft JhengHei\", sans-serif",
    "zh-Hans": "\"Yuanti SC\", YouYuan, \"Microsoft YaHei\", sans-serif",
    ko: "\"NanumSquareRound\", \"Malgun Gothic\", sans-serif",
  },
});

// the CSS font-family list a script's texts are drawn with (`language`: the story language it plays in)
export const fontFamily = (font, language) => (font && font.family) || FONT_FAMILIES[(font && font.preset) || "sans"][language];

// ------------------------------------------------------------------------------------------------ names

// a JSON pointer token
const tok = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

const distance = (a, b) => {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};

// the name of `names` nearest to `name` (case-insensitive edit distance, at most a third of its length), or null
export const nearest = (name, names) => {
  const s = String(name).toLowerCase();
  let best = null, bd = Infinity;
  for (const n of names) {
    const d = distance(s, String(n).toLowerCase());
    if (d < bd) { bd = d; best = n; }
  }
  return best !== null && bd <= Math.max(2, Math.floor(s.length / 3)) ? best : null;
};

const EXPECTED_MAX = 40;
export const byName = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });

// the JSON Patch operation that renames the object key at `path` to `key`
const renameOp = (path, key) => ({ op: "move", from: path, path: `${path.slice(0, path.lastIndexOf("/"))}/${tok(key)}` });

// An error about a name that is not one of `names` (`where`: what holds them, if not the script): the names (up to
// EXPECTED_MAX) and the nearest one, with the fix that writes it in: `fix` "replace" (the name is the value at
// `path`), "rename" (the name is the key at `path`) or null (no fix).
const unknown = (path, code, what, name, names, where = "", fix = "replace") => {
  const list = [...names], near = nearest(name, list);
  return { path, code, message: `${what} ${JSON.stringify(name)} does not exist${where ? ` in ${where}` : ""}` +
           (list.length ? (near ? `; did you mean ${JSON.stringify(near)}?` : "") : ` (${where || "it"} has none)`),
           ...(list.length <= EXPECTED_MAX ? { expected: list } : { expectedCount: list.length }),
           ...(near ? { suggestion: near } : {}),
           ...(near && fix ? { fix: [fix === "rename" ? renameOp(path, near) : { op: "replace", path, value: near }] } : {}) };
};

// ------------------------------------------------------------------------------------------------ text

const LT_FULLWIDTH = String.fromCharCode(0xFF1C);
const WORD_JOINER = String.fromCharCode(0x2060);
const str = (v) => (typeof v === "string" ? v : "");

// An author's text as TextMeshPro rich text that shows it as written: "<" becomes the full-width less-than sign
// (U+FF1C), since the talk window's typewriter counts the characters of the text with every "<...>" removed; a word
// joiner (U+2060, zero width, no break) after every "\" keeps it from starting an escape; line breaks are line feeds.
export const plainText = (s) => str(s).replace(/\r\n?/g, "\n").replace(/</g, LT_FULLWIDTH).replace(/\\/g, `\\${WORD_JOINER}`);

// "sound_bgm_adv_the_tender_light" -> "The Tender Light"
export const cueLabel = (cue) => str(cue).replace(/^sound_bgm_(adv_)?/i, "").split("_").filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ------------------------------------------------------------------------------------------------ layout fixes

// The word joiner plainText writes after a "\": it is in the text the talk window lays out, not in the script's.
const JOINER = String.fromCharCode(0x2060);

// The lines a text wraps into, as the script writes them: `shown` are the lines of plainText(text) the talk window
// lays out with word wrapping (page.js), each with the line feed that ends it, if any. Apart from the word joiners,
// plainText writes one character for each character of the text, so the two line up character for character. ->
// the lines without the line feeds and the spaces at their ends, or null when `shown` is not the text.
export const wrapText = (text, shown) => {
  const src = [...str(text).replace(/\r\n?/g, "\n")];
  const lines = (shown || []).map((l) => [...l].filter((c) => c !== JOINER));
  const flat = lines.flat();
  if (!lines.length || flat.length !== src.length || flat.join("") !== [...plainText(src.join(""))].filter((c) => c !== JOINER).join(""))
    return null;
  const out = [];
  let at = 0, wrapped = false;
  for (const l of lines) {
    let line = src.slice(at, at + l.length).join("");
    at += l.length;
    if (wrapped) line = line.replace(/^[ \t]+/, "");                   // the space a wrapped line starts after
    wrapped = !line.endsWith("\n");
    out.push(line.replace(/[ \t]*\n?$/, ""));
  }
  return out;
};

// The lines (with the ascender and descender of each: their top and bottom in the text) cut into runs that each fit
// `heightLimit`, as even as the longest run that fits allows: [[from, to), ...], or null when a line alone does not
// fit.
export const lineGroups = (asc, desc, heightLimit) => {
  const fits = (a, b) => asc[a] - desc[b - 1] <= heightLimit + 0.01;
  const n = asc.length;
  let most = 0;
  while (most < n && fits(0, most + 1)) most++;
  if (!most) return null;
  const count = Math.ceil(n / most), size = Math.ceil(n / count), even = [];
  for (let a = 0; a < n; a += size) even.push([a, Math.min(n, a + size)]);
  if (even.every(([a, b]) => fits(a, b))) return even;
  const greedy = [];
  for (let a = 0; a < n;) {
    let b = a + 1;
    if (!fits(a, b)) return null;
    while (b < n && fits(a, b + 1)) b++;
    greedy.push([a, b]);
    a = b;
  }
  return greedy;
};

// The fix of a line whose text does not fit the talk window: its text broken where TextMeshPro wraps it and, where
// the window holds fewer lines, spread over beats of the same speaker after it. `beat`: the beat as the script writes
// it (say or narrate) at `index`; `wrap`: {lines, asc, desc} of its text laid out with word wrapping (page.js: null
// when a line stays wider than the window); `heightLimit`: the room the window has. -> {texts, fix}, or null when the
// text as written already fits or breaking it does not help (a single line taller than the window).
export const layoutFix = ({ beat, index, wrap, heightLimit }) => {
  const key = "say" in beat ? "text" : "narrate", text = beat[key];
  if (!wrap) return null;
  const lines = wrapText(text, wrap.lines), groups = lines && lineGroups(wrap.asc, wrap.desc, heightLimit);
  if (!groups) return null;
  const texts = groups.map(([a, b]) => lines.slice(a, b).join("\n"));
  const fix = [];
  if (texts[0] !== text) fix.push({ op: "replace", path: `/beats/${index}/${key}`, value: texts[0] });
  texts.slice(1).forEach((t, i) => fix.push({ op: "add", path: `/beats/${index + 1 + i}`,
                                               value: key === "text" ? { say: beat.say, text: t } : { narrate: t } }));
  return fix.length ? { texts, fix } : null;
};

// ------------------------------------------------------------------------------------------------ applying fixes

// The JSON Patch operations of the fixes (RFC 6902): replace, add, and move of an object key to another key of the
// same object (a rename, which keeps the key's place). -> null, or why `op` cannot be applied to `doc`.
const applyOp = (doc, op) => {
  const tokens = (p) => str(p).split("/").slice(1).map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  const parentOf = (ts) => {
    let o = doc;
    for (const t of ts.slice(0, -1)) o = o && typeof o === "object" ? o[t] : undefined;
    return o && typeof o === "object" ? o : null;
  };
  const ts = tokens(op.path), key = ts[ts.length - 1], parent = parentOf(ts);
  if (!parent) return `${op.path} does not exist`;
  const index = Array.isArray(parent) && /^\d+$/.test(key) ? Number(key) : -1;
  if (op.op === "replace") {
    if (Array.isArray(parent) ? index < 0 || index >= parent.length : !(key in parent)) return `${op.path} does not exist`;
    parent[Array.isArray(parent) ? index : key] = op.value;
    return null;
  }
  if (op.op === "add") {
    if (!Array.isArray(parent)) { parent[key] = op.value; return null; }
    if (index < 0 || index > parent.length) return `${op.path} is not a place in the array`;
    parent.splice(index, 0, op.value);
    return null;
  }
  if (op.op === "move") {
    const from = tokens(op.from);
    if (Array.isArray(parent) || parentOf(from) !== parent) return "a move other than renaming a key is not supported";
    const old = from[from.length - 1];
    if (!(old in parent)) return `${op.from} does not exist`;
    if (key !== old && key in parent) return `${op.path} exists already`;
    const entries = Object.entries(parent).map(([k, v]) => [k === old ? key : k, v]);
    for (const k of Object.keys(parent)) delete parent[k];
    for (const [k, v] of entries) parent[k] = v;
    return null;
  }
  return `operation ${JSON.stringify(op.op)} is not supported`;
};

// the beat a JSON pointer is in (-1: none)
const beatOf = (path) => Number((/^\/beats\/(\d+)/.exec(str(path)) || [])[1] ?? -1);

// The script document with the fixes of `problems` applied, later beats first (the fix of a line that does not fit
// adds beats after it, which moves the beats after those). -> {script, applied: [{path, code}], failed: [{path, code,
// message}]}
export const applyFixes = (doc, problems) => {
  const script = JSON.parse(JSON.stringify(doc)), applied = [], failed = [];
  const fixes = (problems || []).filter((p) => Array.isArray(p.fix) && p.fix.length).sort((a, b) => beatOf(b.path) - beatOf(a.path));
  for (const p of fixes) {
    let why = null;
    for (const op of p.fix) if ((why = applyOp(script, op))) break;
    (why ? failed : applied).push({ path: p.path, code: p.code, ...(why ? { message: why } : {}) });
  }
  return { script, applied, failed };
};

// ------------------------------------------------------------------------------------------------ the base story

// The music of a base story: the sound rows of its episode whose cue sheet is a BGM sheet the story has the sound
// files of (story.json audio) -> [{cue, label, sound, sheet}], by cue name.
export const musicChoices = (episode, story) => {
  const audio = (story && story.audio) || {}, out = new Map();
  for (const [id, row] of Object.entries((episode && episode.sounds) || {})) {
    const sheet = episode.cuesheets && episode.cuesheets[row._soundCueSheetID];
    const name = sheet && sheet._cueSheetName;
    if (!name || !/^sound_bgm/i.test(name) || !audio[name] || !row._cueName || out.has(row._cueName)) continue;
    out.set(row._cueName, { cue: row._cueName, label: cueLabel(row._cueName), sound: Number(id), sheet: name });
  }
  return [...out.values()].sort((a, b) => a.cue.localeCompare(b.cue));
};

// The stages of a base story: [{id, key, caption}] in the order its episode sets them (the others last, by key). The
// id is the key's last segment, or the whole key where two keys end alike; the caption is the first location caption
// (in `language`) the episode shows while that stage is set, or "".
export const stageChoices = (scene, episode, language) => {
  const field = STORY_LANGUAGES[language];
  const keys = Object.keys((scene && scene.stages) || {}), captions = new Map(), order = [];
  let cur = null;
  for (const c of (episode && episode.commands) || []) {
    if (c.IgnoreData) continue;
    if (c.cmd === "Stage" && keys.includes(c.TargetAssetName)) { cur = c.TargetAssetName; if (!order.includes(cur)) order.push(cur); }
    else if (c.cmd === "Location" && cur && !captions.has(cur)) {
      const id = c.AdvTextID || (c.TargetTextIDs || [])[0];
      const t = (c.lines && c.lines[field]) || (episode.text && episode.text[id] && episode.text[id][field]) || "";
      if (t) captions.set(cur, t.replace(/<[^>]*>/g, "").trim());
    }
  }
  for (const k of [...keys].sort()) if (!order.includes(k)) order.push(k);
  const last = (k) => k.split("/").pop();
  const count = new Map();
  for (const k of keys) count.set(last(k), (count.get(last(k)) || 0) + 1);
  return order.map((key) => ({ id: count.get(last(key)) > 1 ? key : last(key), key, caption: captions.get(key) || "" }));
};

// The texture path of a stage's background sprite (a prefab of scene.json stages), or null.
export const stageBackground = (prefab) => {
  for (const n of (prefab && prefab.nodes) || []) for (const c of n.components || []) {
    if (c && c.class === "AdvStage") {
      const t = c._backgroundSprite && c._backgroundSprite.texture;
      return t && typeof t.texture === "string" ? t.texture : null;
    }
  }
  return null;
};

// ------------------------------------------------------------------------------------------------ models

// The motions and expressions of a model, from its prefab (the Live2DCharacter component of the root node):
// {motions: clip names, expressions, defaultMotion, defaultExpression}.
export const modelActions = (prefab) => {
  const root = ((prefab && prefab.nodes) || [])[0];
  const ch = root && (root.components || []).find((c) => c && c.class === "Live2DCharacter");
  if (!ch) throw new Error("the model prefab has no Live2DCharacter");
  return { motions: (ch._motionList || []).map((m) => m.clip).filter(Boolean), expressions: [...(ch._expressionList || [])],
           defaultMotion: ch.DefaultMotionName || "", defaultExpression: ch.DefaultExpressionName || "" };
};

// "mtn_smile02_L" -> {stem: "mtn_smile02", side: "L"}; a name without a side is its own stem
export const motionStem = (name) => {
  const m = /^(.*)_([LCR])$/.exec(str(name));
  return m ? { stem: m[1], side: m[2] } : { stem: str(name), side: "" };
};

// the motion stems of a list of motion names, in first-seen order
export const motionStems = (names) => [...new Set((names || []).map((n) => motionStem(n).stem))];

// The clip a motion of a script plays on `slot`: a clip name of the model as it is; a stem, the variant facing the
// slot's side, else the centre one, else the stem itself, else any variant. "" when the model has none of these.
export const resolveMotion = (motion, slot, motions) => {
  if (!motion) return "";
  if (motions.includes(motion) && motionStem(motion).side) return motion;
  for (const n of [`${motion}_${SIDE[slot] || "C"}`, `${motion}_C`, motion]) if (motions.includes(n)) return n;
  return motions.find((n) => motionStem(n).stem === motion) || "";
};

// ------------------------------------------------------------------------------------------------ fonts

// ui/fonts.json of the base story with every font asset drawn by the browser in `family` (the story player's browser
// fonts): the asset keeps its point size, padding, render mode, style settings, line metrics and fallbacks; its
// characters and glyphs are made as texts use them, so every character of the family shows (no missing glyph). The
// glyph cell margin keeps the room the asset's text materials need for their underlay offset.
export const withBrowserFonts = (fonts, family) => {
  const out = JSON.parse(JSON.stringify(fonts));
  for (const [name, f] of Object.entries(out.fonts || {})) {
    const gs = f.atlasPadding + 1;
    const margin = f.source && f.source.generator && f.source.generator.margin;
    let underlay = Number.isFinite(margin) ? Math.max(0, (margin - Math.ceil(gs) - 1) / gs) : 0;
    for (const [mname, m] of Object.entries(out.materials || {})) {
      if (!mname.startsWith(name) || !m.floats) continue;
      underlay = Math.max(underlay, Math.abs(m.floats._UnderlayOffsetX || 0), Math.abs(m.floats._UnderlayOffsetY || 0));
    }
    f.browser = { family, ...(underlay > 0 ? { underlayOffset: underlay } : {}) };
    f.characters = {};
    f.glyphs = {};
    delete f.missingGlyph;
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ parsing

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const TOP_KEYS = ["format", "base", "language", "title", "font", "cast", "beats"];
const BEAT_KEYS = {
  scene: ["id", "scene", "music", "location", "camera", "positions"],
  say: ["id", "say", "text", "motion", "expression"],
  narrate: ["id", "narrate"],
  positions: ["id", "positions", "camera"],
};
const KINDS = Object.keys(BEAT_KEYS);

// The shape of a script: -> {script, errors}. `script` is the document with every value checked for its type and
// form (a value with an error is left out); errors: [{path, code, message, ...}] with codes format, type, missing,
// unknownKey, castId, beatKind, empty, duplicateId, unknownLanguage, unknownFont, unknownPosition, unknownCamera.
export const parseScript = (doc) => {
  const errors = [];
  const err = (path, code, message, extra = {}) => errors.push({ path, code, message, ...extra });
  const keys = (o, allowed, path) => {
    for (const k of Object.keys(o)) {
      if (allowed.includes(k)) continue;
      const near = nearest(k, allowed), kp = `${path}/${tok(k)}`;
      err(kp, "unknownKey", `unknown key ${JSON.stringify(k)}` + (near ? `; did you mean ${JSON.stringify(near)}?` : ""),
          { expected: allowed, ...(near ? { suggestion: near } : {}), ...(near && !(near in o) ? { fix: [renameOp(kp, near)] } : {}) });
    }
  };
  const text = (o, k, path, { required = false, empty = false } = {}) => {
    if (!(k in o)) { if (required) err(path, "missing", `${path.split("/").pop()} is required`); return undefined; }
    if (typeof o[k] !== "string") { err(path, "type", `${path.split("/").pop()} must be a string`); return undefined; }
    if (!empty && !o[k].trim()) { err(path, "empty", `${path.split("/").pop()} is empty`); return undefined; }
    return o[k];
  };
  const named = (v, table, path, code, what) => {
    if (typeof v !== "string") { err(path, "type", `${what} must be a string`, { expected: Object.keys(table) }); return undefined; }
    if (!(v in table)) { errors.push(unknown(path, code, what, v, Object.keys(table))); return undefined; }
    return table[v];
  };

  if (!isObj(doc)) { err("", "type", "a script is a JSON object"); return { script: null, errors }; }
  if (doc.format !== SCRIPT_FORMAT) err("/format", "format", `format must be ${JSON.stringify(SCRIPT_FORMAT)}`);
  keys(doc, TOP_KEYS, "");
  const script = { format: SCRIPT_FORMAT, base: text(doc, "base", "/base", { required: true }), language: undefined,
                   title: text(doc, "title", "/title", { empty: true }) || "", font: { preset: "sans" }, cast: [], beats: [] };
  if ("language" in doc) {
    if (typeof doc.language !== "string" || !STORY_LANGUAGES[doc.language])
      errors.push(unknown("/language", "unknownLanguage", "language", doc.language, Object.keys(STORY_LANGUAGES)));
    else script.language = doc.language;
  }
  if ("font" in doc) {
    const f = doc.font;
    if (typeof f === "string") {
      if (FONT_PRESETS.includes(f)) script.font = { preset: f };
      else errors.push(unknown("/font", "unknownFont", "font preset", f, FONT_PRESETS));
    } else if (isObj(f)) {
      keys(f, ["family"], "/font");
      const family = text(f, "family", "/font/family", { required: true });
      if (family) script.font = { family };
    } else err("/font", "type", `font must be a preset (${FONT_PRESETS.join(", ")}) or {"family": <CSS font-family list>}`);
  }

  if (!("cast" in doc)) err("/cast", "missing", "cast is required (an object: cast id -> {model, name})");
  else if (!isObj(doc.cast)) err("/cast", "type", "cast must be an object: cast id -> {model, name}");
  else for (const [id, c] of Object.entries(doc.cast)) {
    const path = `/cast/${tok(id)}`;
    if (!CAST_ID.test(id)) { err(path, "castId", `cast id ${JSON.stringify(id)} must be a letter followed by letters, digits or _`); continue; }
    if (!isObj(c)) { err(path, "type", "a cast member is an object {model, name}"); continue; }
    keys(c, ["model", "name"], path);
    const model = text(c, "model", `${path}/model`, { required: true }), name = text(c, "name", `${path}/name`, { required: true });
    if (model && name) script.cast.push({ id, model, name, path });
  }

  const positions = (v, path) => {
    if (!isObj(v)) { err(path, "type", "positions must be an object: cast id -> position or {at, motion, expression}"); return null; }
    const out = [];
    for (const [id, p] of Object.entries(v)) {
      const pp = `${path}/${tok(id)}`;
      let at, motion, expression;
      if (typeof p === "string") at = named(p, POSITIONS, pp, "unknownPosition", "position");
      else if (isObj(p)) {
        keys(p, ["at", "motion", "expression"], pp);
        if (!("at" in p)) err(`${pp}/at`, "missing", "at is required", { expected: Object.keys(POSITIONS) });
        else at = named(p.at, POSITIONS, `${pp}/at`, "unknownPosition", "position");
        motion = text(p, "motion", `${pp}/motion`);
        expression = text(p, "expression", `${pp}/expression`);
      } else { err(pp, "type", "a position is a name or {at, motion, expression}", { expected: Object.keys(POSITIONS) }); continue; }
      if (at !== undefined) out.push({ cast: id, slot: at, motion: motion || "", expression: expression || "", path: pp,
                                       atPath: typeof p === "string" ? pp : `${pp}/at` });
    }
    return out;
  };

  const ids = new Set();
  // every beat id of the document, for the fix of a duplicate one (an id no beat has)
  const allIds = new Set(Array.isArray(doc.beats) ? doc.beats.filter((b) => isObj(b) && typeof b.id === "string").map((b) => b.id) : []);
  const freeId = (id) => {
    let n = 2;
    while (allIds.has(`${id}_${n}`)) n++;
    allIds.add(`${id}_${n}`);
    return `${id}_${n}`;
  };
  if (!("beats" in doc)) err("/beats", "missing", "beats is required (an array)");
  else if (!Array.isArray(doc.beats)) err("/beats", "type", "beats must be an array");
  else if (!doc.beats.length) err("/beats", "empty", "beats is empty");
  else doc.beats.forEach((b, index) => {
    const path = `/beats/${index}`;
    if (!isObj(b)) { err(path, "type", "a beat is an object"); return; }
    const kind = KINDS.find((k) => k in b);
    if (!kind) { err(path, "beatKind", `a beat has one of ${KINDS.join(", ")}`, { expected: KINDS }); return; }
    keys(b, BEAT_KEYS[kind], path);
    const beat = { kind, index, path, id: undefined };
    if ("id" in b) {
      const id = text(b, "id", `${path}/id`);
      if (id && ids.has(id)) {
        const next = freeId(id);
        err(`${path}/id`, "duplicateId", `beat id ${JSON.stringify(id)} is used by an earlier beat`,
            { suggestion: next, fix: [{ op: "replace", path: `${path}/id`, value: next }] });
      } else if (id) { ids.add(id); beat.id = id; }
    }
    if (kind === "scene" || kind === "positions") {
      if (kind === "scene") {
        beat.stage = text(b, "scene", `${path}/scene`, { required: true });
        if ("music" in b) beat.music = text(b, "music", `${path}/music`);
        beat.location = text(b, "location", `${path}/location`, { empty: true }) || "";
      }
      beat.camera = "camera" in b ? named(b.camera, CAMERAS, `${path}/camera`, "unknownCamera", "camera") : undefined;
      beat.positions = "positions" in b ? positions(b.positions, `${path}/positions`) : (kind === "scene" ? [] : null);
      if (kind === "positions" && !beat.positions) return;
    } else if (kind === "say") {
      beat.speaker = text(b, "say", `${path}/say`, { required: true });
      beat.text = text(b, "text", `${path}/text`, { required: true });
      beat.motion = text(b, "motion", `${path}/motion`) || "";
      beat.expression = text(b, "expression", `${path}/expression`) || "";
    } else {
      beat.speaker = null;
      beat.text = text(b, "narrate", `${path}/narrate`, { required: true });
    }
    script.beats.push(beat);
  });
  return { script, errors };
};

// ------------------------------------------------------------------------------------------------ checking

// The names of a script against its site. `site`:
//   base     {languages, language, stages: stageChoices(...), music: musicChoices(...)} of the script's base story
//   models   the model ids of the site's models.json (an array or a Set)
//   actions  model id -> modelActions(prefab), for the models of the cast that exist
// -> {language, errors, warnings}: language, the language the story plays in; error codes unknownLanguage,
// unknownModel, unknownCast, unknownStage, unknownMusic, unknownMotion, unknownExpression, beforeScene,
// positionTaken, offStage; warning codes speakerOffStage (a line of a character not on stage), unusedCast.
export const checkScript = (script, site) => {
  const errors = [], warnings = [];
  const base = site.base, models = new Set(site.models || []), actions = site.actions || {};
  const language = script.language || base.language;
  if (script.language && !base.languages.includes(script.language))
    errors.push(unknown("/language", "unknownLanguage", "language", script.language, base.languages, "the base story"));
  const cast = new Map(script.cast.map((c) => [c.id, c]));
  for (const c of script.cast) if (!models.has(c.model)) errors.push(unknown(`${c.path}/model`, "unknownModel", "model", c.model, [...models].sort(byName), "models.json"));
  const actionsOf = (id) => (cast.has(id) ? actions[cast.get(id).model] : undefined);
  const checkAction = (id, motion, expression, path) => {
    const a = actionsOf(id);
    if (!a) return;
    if (motion && !a.motions.includes(motion) && !motionStems(a.motions).includes(motion))
      errors.push(unknown(`${path}/motion`, "unknownMotion", "motion", motion, motionStems(a.motions).sort(byName), cast.get(id).model));
    if (expression && !a.expressions.includes(expression))
      errors.push(unknown(`${path}/expression`, "unknownExpression", "expression", expression, [...a.expressions].sort(byName), cast.get(id).model));
  };
  const stageIds = base.stages.map((s) => s.id), cues = base.music.map((m) => m.cue);
  const used = new Set();
  let scenes = 0, on = new Set();
  for (const b of script.beats) {
    if (b.kind !== "scene" && !scenes) errors.push({ path: b.path, code: "beforeScene", message: "the first beat must be a scene" });
    if (b.kind === "scene") {
      scenes++;
      if (b.stage && !stageIds.includes(b.stage)) errors.push(unknown(`${b.path}/scene`, "unknownStage", "stage", b.stage, stageIds, "the base story"));
      if (b.music && b.music !== MUSIC_STOP && !cues.includes(b.music))
        errors.push(unknown(`${b.path}/music`, "unknownMusic", "music", b.music, [MUSIC_STOP, ...cues], "the base story"));
    }
    if (b.positions) {
      const slots = new Map();
      // the slots of the beat and the ones given to fixes of characters on a taken slot
      const occupied = new Set(b.positions.map((p) => p.slot));
      for (const p of b.positions) {
        if (!cast.has(p.cast)) {
          const near = nearest(p.cast, cast.keys());
          errors.push(unknown(p.path, "unknownCast", "cast member", p.cast, cast.keys(), "",
                              near && !b.positions.some((q) => q.cast === near) ? "rename" : null));
          continue;
        }
        used.add(p.cast);
        if (slots.has(p.slot)) {
          const free = freeSlot(p.slot, occupied);
          if (free) occupied.add(POSITIONS[free]);
          errors.push({ path: p.path, code: "positionTaken", message: `${p.cast} and ${slots.get(p.slot)} stand at the same position` +
                        (free ? `; ${JSON.stringify(free)} is free` : ""),
                        ...(free ? { suggestion: free, fix: [{ op: "replace", path: p.atPath, value: free }] } : {}) });
        } else slots.set(p.slot, p.cast);
        checkAction(p.cast, p.motion, p.expression, p.path);
      }
      on = new Set(b.positions.map((p) => p.cast));
    }
    if (b.kind === "say" && b.speaker) {
      if (!cast.has(b.speaker)) { errors.push(unknown(`${b.path}/say`, "unknownCast", "cast member", b.speaker, cast.keys())); continue; }
      used.add(b.speaker);
      if (!on.has(b.speaker)) {
        if (b.motion || b.expression)
          errors.push({ path: b.path, code: "offStage", message: `${b.speaker} is not on stage: a motion or an expression needs the speaker on stage` });
        else warnings.push({ path: `${b.path}/say`, code: "speakerOffStage", message: `${b.speaker} speaks from off stage` });
      }
      checkAction(b.speaker, b.motion, b.expression, b.path);
    }
  }
  for (const c of script.cast) if (!used.has(c.id)) warnings.push({ path: c.path, code: "unusedCast", message: `${c.id} never comes on stage or speaks` });
  return { language, errors, warnings };
};

// ------------------------------------------------------------------------------------------------ compiling

// The story data of a script that checkScript passes. `site`:
//   base     {story, episode, stages, music} of the base story (its story.json and episode.json; stageChoices,
//            musicChoices)
//   models   model id -> model key (Character/Live2D/<group>/<name>/model/<name>) of the site's models.json
//   actions  model id -> modelActions(prefab)
// language: the story language. -> {episode, story, lines: [{line, beat, path, id, speaker, name, text}], scenes}
export const compileScript = (script, site, language) => {
  const field = STORY_LANGUAGES[language];
  if (!field) throw new Error(`unknown story language ${language}`);
  const { base, models, actions } = site;
  const stageKey = new Map(base.stages.map((s) => [s.id, s.key])), music = new Map(base.music.map((m) => [m.cue, m]));
  const cast = new Map(script.cast.map((c) => [c.id, c]));
  const rows = [], text = {}, lines = [];
  const row = (cmd, fields = {}) => {
    const raw = ADV_COMMAND.indexOf(cmd);
    if (raw < 0) throw new Error(`no ADV command ${cmd}`);
    rows.push({ i: rows.length, cmd, raw, ...fields });
  };
  const textId = (id, s) => { text[id] = { [field]: s }; return id; };
  const motionsOf = (id) => actions[cast.get(id).model].motions;
  const enterMotion = (m) => {
    if (m.motion) return resolveMotion(m.motion, m.slot, motionsOf(m.cast));
    const a = actions[cast.get(m.cast).model];
    if (!a.defaultMotion) return "";
    const v = resolveMotion(motionStem(a.defaultMotion).stem, m.slot, a.motions);
    return v === a.defaultMotion ? "" : v;
  };

  // the models: one Character row per cast member that comes on stage (the player loads them before playing)
  const onStageEver = new Set(script.beats.flatMap((b) => (b.positions || []).map((p) => p.cast)));
  const story = { ...base.story, advId: 0, episode: "episode.json", models: {}, audio: {},
                  frames: null, effects: null, postEffects: null, stills: null, talkWindows: null, chat: null,
                  videos: null, crilips: null };
  for (const c of script.cast) {
    if (!onStageEver.has(c.id)) continue;
    const key = models[c.model];
    story.models[key] = c.model;
    row("Character", { TargetName: c.id, TargetAssetName: key.replace(/^Character\/Live2D\//, "") });
  }

  let on = new Map(), scenes = 0, bgm = 0, camera = CAMERAS.middle;
  const expression = new Map();                                 // cast id -> the expression it shows
  const focus = (staged) => {
    const slots = [...staged.values()].map((m) => m.slot);
    return slots.length ? Math.min(9, Math.max(1, Math.round(slots.reduce((a, b) => a + b, 0) / slots.length))) : 5;
  };
  const enter = (m, duration) => {
    const motion = enterMotion(m);
    row("In", { TargetName: m.cast, PositionType: m.slot, ...(duration ? { Duration: duration } : {}), IsNoWait: 1,
                ...(motion ? { MotionName: motion } : {}), ...(m.expression ? { ExpressionName: m.expression } : {}) });
    expression.set(m.cast, m.expression || "");
  };

  for (const b of script.beats) {
    if (b.kind === "scene") {
      const next = new Map(b.positions.map((p) => [p.cast, p]));
      if (scenes) {
        row("FadeOut", { Duration: SCENE_FADE });
        for (const m of on.values()) row("Out", { TargetName: m.cast, PositionType: m.slot });
      }
      row("Stage", { TargetAssetName: stageKey.get(b.stage) });
      if (b.music === MUSIC_STOP) { if (bgm) { row("Bgm", { Parameter1: "1" }); bgm = 0; } }
      else if (b.music) {
        const m = music.get(b.music);
        if (m.sound !== bgm) { row("Bgm", { BgmID: m.sound, Parameter1: BGM_FADE }); bgm = m.sound; }
      }
      for (const m of next.values()) enter(m, 0);
      camera = b.camera || CAMERAS.middle;
      row("Focus", { PositionType: focus(next), CameraDistance: camera });
      if (scenes) row("FadeIn", { Duration: SCENE_FADE });
      if (b.location.trim()) row("Location", { AdvTextID: textId(`custom_location_${b.index}`, plainText(b.location)) });
      on = next;
      scenes++;
    } else if (b.kind === "positions") {
      const next = new Map(b.positions.map((p) => [p.cast, p]));
      // each Out waits for its fade, so that a slot is free before a character enters it
      for (const m of on.values())
        if (!next.has(m.cast) || next.get(m.cast).slot !== m.slot) row("Out", { TargetName: m.cast, PositionType: m.slot, Duration: CAST_FADE });
      for (const m of next.values()) {
        if (!on.has(m.cast) || on.get(m.cast).slot !== m.slot) enter(m, CAST_FADE);
        else if (m.motion || m.expression) {
          const motion = resolveMotion(m.motion, m.slot, motionsOf(m.cast));
          const exp = m.expression || expression.get(m.cast) || "";
          if (motion) row("Motion", { TargetName: m.cast, MotionName: motion, ...(exp ? { ExpressionName: exp } : {}) });
          else row("Expression", { TargetName: m.cast, ExpressionName: exp });
          expression.set(m.cast, exp);
        }
      }
      if (b.camera) camera = b.camera;
      row("Focus", { PositionType: focus(next), CameraDistance: camera, Duration: FOCUS_MOVE, IsNoWait: 1 });
      on = next;
    } else {
      const speaker = b.speaker ? cast.get(b.speaker) : null;
      if (speaker && on.has(speaker.id)) {
        const motion = resolveMotion(b.motion, on.get(speaker.id).slot, motionsOf(speaker.id));
        if (motion) {
          // a Motion row sets the expression too (an empty one is the default): the current one unless the line sets one
          const exp = b.expression || expression.get(speaker.id) || "";
          row("Motion", { TargetName: speaker.id, MotionName: motion, ...(exp ? { ExpressionName: exp } : {}) });
          expression.set(speaker.id, exp);
        } else if (b.expression) {
          row("Expression", { TargetName: speaker.id, ExpressionName: b.expression });
          expression.set(speaker.id, b.expression);
        }
      }
      const fields = { AdvTextID: textId(`custom_line_${b.index}`, plainText(b.text)) };
      if (speaker) Object.assign(fields, { TargetName: speaker.id, TargetTextIDs: [textId(`custom_name_${speaker.id}`, plainText(speaker.name))],
                                           TargetTextColors: [NAME_COLOR] });
      row("Talk", fields);
      lines.push({ line: lines.length, beat: b.index, path: b.path, ...(b.id ? { id: b.id } : {}),
                   speaker: speaker ? speaker.id : null, name: speaker ? speaker.name : "", text: b.text });
    }
  }

  // the sounds the rows play, with their cue sheets and sound files
  const sounds = {}, cuesheets = {};
  for (const r of rows) {
    if (r.cmd !== "Bgm" || !r.BgmID) continue;
    const s = base.episode.sounds[r.BgmID], sheet = base.episode.cuesheets[s._soundCueSheetID];
    sounds[r.BgmID] = s;
    cuesheets[s._soundCueSheetID] = sheet;
    story.audio[sheet._cueSheetName] = base.story.audio[sheet._cueSheetName];
  }
  const title = script.title.trim();
  const episode = {
    advId: 0, asset: "", commandCount: rows.length, commands: rows,
    text: { ...(title ? { [TITLE_ID]: { [field]: plainText(title) } } : {}), ...text },
    sounds, cuesheets, videos: {}, resources: [],
    master: { _id: 0, _sheetName: "", _advEpisodeAsset: "", _titleTextId: title ? TITLE_ID : 0, _rubyTitleTextId: 0,
              _playbackMode: 0 },
    title: title ? { [field]: plainText(title) } : null,
  };
  return { episode, story, lines, scenes };
};

// every text a compiled story shows (the characters a font has to draw)
export const scriptTexts = (script) => [script.title, ...script.cast.map((c) => c.name),
  ...script.beats.map((b) => (b.kind === "scene" ? b.location : b.text || ""))].join("");
