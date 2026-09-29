// Chart data page: rankings, charts and a guide over a site's music-data.json (nnnotes music-data; a file made with
// --no-deck has no deck statistics, and the score figures are then left out) and jackets/<jacket>.webp
// (nnnotes music-data --jackets; optional). Song pages (credits, vocals, audio, chart previews) are moenotes': every song
// links there instead of repeating them. The choices live in the query:
//   ?v=rank|charts|guide &lang=<language> &band=<id> &d=<difficulty>[,...] &q=<search>
//   &r=efficiency|event|speed|level|notes|long|short|skip &sp=density|bpmMax|bpm   (ranking, speed measure)
//   &len=bgm|chart &oh=<seconds> &x=<percent>[,...] &frontier               (efficiency)
//   &gk=free &rk=<r>[,<r>,<r>]                                              (play scenario: Free Live, else Gekisou
//                                                                           Live with a rank 1-5 per range; default
//                                                                           Gekisou Live at rank 1 everywhere)
//   &gr=<Great percent> &jr=<Just percent>                                  (accuracy: Great share, default 0; Just
//                                                                           rate in Just ranges, default 100)
//   &p=<power> &tr=<rank> &n=<players>                                      (event: rank chance; Gekisou Live room
//                                                                           size, default 5)
//   &jk=off                                                                 (no jackets)
//   &ax=<figure> &ay=<figure>                                               (scatter axes)
//   &c=<scoreId>                                                            (the chart detail open)
//   &moenotes=<base URL>|off                                                (song links; default https://bdon.moe/)
//   &theme=light|dark                                                       (default: the system's)
// The site root is this page's directory unless ?site=<URL> names another one.
import {
  DIFFICULTIES, MOENOTES, NOTE_KINDS, chartRows, extent, histogram, matches, moenotesUrl, pickText, refigure, sortBy,
  ticks,
} from "./catalog.js";
import {
  MEASURES, RANGES, RANK_MAX, SCORE_RANKS, X_MAX, chartFigures, eventDominance, formatLength, formatRanks, lengthMs,
  meanSkill, modelPower, orderRates, parseRanks, perMinute, plainKind, quantile, rangeMeasures, rank, rankThreshold,
  reachChance, requiredPower, scenarioData, scoreRate, weightSum,
} from "./ranking.js";
import { GUIDE, UI } from "./text.js";

const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "./", location.href);
const moeBase = q.get("moenotes") === "off" ? null : q.get("moenotes") || MOENOTES;
const SVG = "http://www.w3.org/2000/svg";
// difficulty accents are CSS variables (index.html), so both themes restyle the charts too
const DIFF_COLOR = { easy: "var(--easy)", normal: "var(--normal)", hard: "var(--hard)", expert: "var(--expert)" };
const DIFF_SHORT = { easy: "EZ", normal: "NM", hard: "HD", expert: "EX" };
const KIND_COLOR = { tap: "var(--mn-accent)", flick: "var(--mn-pink)", slide: "var(--mn-mint)", trace: "var(--mn-amber)", combo: "var(--mn-border)" };
// line icons (24 x 24, stroked with currentColor); the star is moenotes' heading star
const ICONS = {
  star: "m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z",
  close: "M6 6l12 12M18 6 6 18",
  out: "M7 17 17 7M9 7h8v8",
  swap: "M4 8h14l-4-4M20 16H6l4 4",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  image: "M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M15 9h.01",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
};

// the theme: ?theme=, else the system's (followed while it changes)
const dark = matchMedia("(prefers-color-scheme: dark)");
let theme = ["light", "dark"].includes(q.get("theme")) ? q.get("theme") : null;
const applyTheme = () => { document.documentElement.dataset.theme = theme || (dark.matches ? "dark" : "light"); };
applyTheme();
dark.addEventListener("change", applyTheme);
const RANKS = ["efficiency", "event", "speed", "level", "notes", "long", "short", "skip"];
const EFF_RANKS = new Set(["efficiency", "event", "skip"]);
const AXES = ["displayLevel", "density", "bpm", "bpmMax", "notes", "bgmMs", "perMinute", "rate", "base", "skip"];
const EFF_AXES = new Set(["perMinute", "rate", "base", "skip"]);

// ---------------------------------------------------------------- DOM helpers
const h = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return e;
};
const s = (tag, attrs = {}, ...children) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  e.append(...children.flat().filter((c) => c !== null && c !== undefined));
  return e;
};
const icon = (name, cls = "ic") => s("svg", { class: cls, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  "stroke-width": name === "star" ? 1.4 : 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
s("path", { d: ICONS[name] }));
// a heading with moenotes' star and orbit track; `tail` is right-aligned controls
const heading = (tag, cls, title, ...tail) => h("div", { class: cls }, icon("star", "ic star"), h(tag, {}, title),
  h("span", { class: "track", "aria-hidden": "true" }), tail.flat().filter(Boolean).length ? h("div", { class: "tail" }, tail) : null);
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));
const fmtInt = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : "–");
const lv = (r) => (Number.isInteger(r.displayLevel) ? String(r.displayLevel) : String(r.displayLevel));

const load = async (name, optional) => {
  const r = await fetch(new URL(name, site)).catch((e) => { if (optional) return null; throw e; });
  if (!r || !r.ok) {
    if (optional) return null;
    throw new Error(`${name}: HTTP ${r ? r.status : "?"}`);
  }
  return r.json();
};

const defaultLanguage = (langs) => {
  if (langs.includes(q.get("lang"))) return q.get("lang");
  for (const n of navigator.languages || [navigator.language]) {
    const l = String(n).toLowerCase();
    const hit = l.startsWith("zh") ? (/(tw|hk|mo|hant)/.test(l) ? "zh-Hant" : "zh-Hans") : langs.find((x) => l.startsWith(x.toLowerCase()));
    if (hit && langs.includes(hit)) return hit;
  }
  return langs.includes("ja") ? "ja" : langs[0];
};

// ---------------------------------------------------------------- app
const main = async () => {
  const boot = h("div", { class: "boot" }, h("div", { class: "spinner" }), UI.zh.loading);
  document.body.append(boot);
  const songs = await load("music-data.json");
  // jackets are optional (nnnotes songs --jackets): one probe decides whether the site has them
  const probe = ((songs && songs.songs) || []).find((x) => x.jacket);
  const hasJackets = probe ? await fetch(new URL(`jackets/${probe.jacket}.webp`, site), { method: "HEAD" })
    .then((r) => r.ok).catch(() => false) : false;
  boot.remove();

  const langs = Array.isArray(songs.languages) && songs.languages.length ? songs.languages : ["ja"];
  const rows = chartRows(songs);
  const byScore = new Map(rows.map((r) => [r.scoreId, r]));
  const bands = new Map((songs.bands || []).map((b) => [String(b.id), b]));
  const hasStats = rows.some((r) => r.weights);
  // what the data can show besides Gekisou Live at rank 1 (ranking.js scenarioData)
  const has = scenarioData(songs);
  const kind = plainKind(songs);
  const power = modelPower(songs);
  const pct = (v, def) => (v === null || !Number.isFinite(Number(v)) ? def : Math.min(100, Math.max(0, Math.round(Number(v)))));
  const S = {
    view: ["rank", "charts", "guide"].includes(q.get("v")) ? q.get("v") : "rank",
    lang: defaultLanguage(langs),
    band: q.get("band") || "",
    diffs: (q.get("d") || "expert").split(",").filter((d) => DIFFICULTIES.includes(d)),
    search: q.get("q") || "",
    rankBy: RANKS.includes(q.get("r")) ? q.get("r") : hasStats ? "efficiency" : "speed",
    speedBy: ["density", "bpmMax", "bpm"].includes(q.get("sp")) ? q.get("sp") : "density",
    len: q.get("len") === "chart" ? "chart" : "bgm",
    overhead: Math.min(600, Math.max(0, Number(q.get("oh") ?? 30) || 0)),
    skills: (q.get("x") || "100,100,100,100,100").split(",").map(Number).filter((x) => Number.isFinite(x) && x >= 0).slice(0, 5),
    frontier: q.has("frontier"),
    power: Math.max(0, Math.round(Number(q.get("p")) || 0)),
    target: SCORE_RANKS.includes(q.get("tr")) ? q.get("tr") : "SS",
    // the play scenario (ranking.js chartFigures) and the accuracy
    mode: q.get("gk") === "free" && has.free ? "free" : "battle",
    ranks: has.ranks ? parseRanks(q.get("rk")) : Array(RANGES).fill(1),
    great: pct(q.get("gr"), 0),
    just: has.just ? pct(q.get("jr"), 100) : 100,
    room: Math.min(RANK_MAX, Math.max(1, Math.round(Number(q.get("n")) || 5))),
    jackets: q.get("jk") !== "off",
    ax: AXES.includes(q.get("ax")) ? q.get("ax") : "displayLevel",
    ay: AXES.includes(q.get("ay")) ? q.get("ay") : hasStats ? "perMinute" : "density",
    chart: Number(q.get("c")) || null,
  };
  while (S.skills.length < 5) S.skills.push(0);
  if (!hasStats && EFF_RANKS.has(S.rankBy)) S.rankBy = "speed";
  const u = () => (S.lang.startsWith("zh") ? UI.zh : UI.en);
  const showJackets = () => hasJackets && S.jackets;
  const g = () => (S.lang.startsWith("zh") ? GUIDE.zh : GUIDE.en);
  const skills = () => S.skills.map((x) => x / 100);
  const scenario = () => ({ mode: S.mode, ranks: S.ranks, just: S.just / 100, great: S.great / 100 });
  // the rows carry the figures of the scenario chosen (the Great share folded in: the score ranks take factor 1)
  const setScenario = (change) => { if (change) change(); refigure(rows, songs, scenario()); };
  setScenario();
  // the score ranks: a Gekisou Live room of S.room players who all score the same, or solo
  const room = () => (S.mode === "battle" ? S.room : 0);
  // Free Live's score per power at the Great share chosen (the one Gekisou Live keeps as the song's best score)
  const freeRate = (r) => {
    const f = chartFigures(r.stats, kind, power, { mode: "free", great: S.great / 100 });
    return f ? scoreRate(f, skills()) : null;
  };
  const eff = (r) => (r.weights
    ? { rate: scoreRate(r, skills()), perMinute: perMinute(r, skills(), S.len, S.overhead * 1000) }
    : { rate: null, perMinute: null });
  const title = (r) => pickText(r.title, S.lang) || String(r.musicId);
  const bandOf = (r) => bands.get(String(r.bandIds[0]));
  const bandName = (r) => pickText(r.bandName, S.lang) || (bandOf(r) ? pickText(bandOf(r).name, S.lang) : "");
  const bandColor = (r) => (bandOf(r) ? bandOf(r).mainColor : "var(--mn-text-muted)");
  const lengthOf = (r) => (S.len === "chart" ? r.chartMs ?? r.bgmMs : r.bgmMs ?? r.chartMs);
  const figure = (r, k) => {
    if (k === "perMinute" || k === "rate") return eff(r)[k];
    if (k === "bgmMs") return (r.bgmMs ?? r.chartMs) / 1000;
    return r[k];
  };

  const save = () => {
    const p = new URLSearchParams();
    const put = (k, v, def) => { if (v !== def && v !== "" && v !== null && v !== undefined) p.set(k, String(v)); };
    put("site", q.get("site"));
    put("moenotes", q.get("moenotes"));
    put("v", S.view, "rank");
    put("lang", S.lang);
    put("band", S.band, "");
    put("d", S.diffs.join(","), "expert");
    put("q", S.search, "");
    put("r", S.rankBy, hasStats ? "efficiency" : "speed");
    put("sp", S.speedBy, "density");
    put("len", S.len, "bgm");
    put("oh", S.overhead, 30);
    put("x", S.skills.join(","), "100,100,100,100,100");
    put("p", S.power, 0);
    put("tr", S.target, "SS");
    put("gk", S.mode, "battle");
    put("rk", formatRanks(S.ranks), "");
    put("gr", S.great, 0);
    put("jr", S.just, 100);
    put("n", S.room, 5);
    put("jk", S.jackets ? null : "off", null);
    put("ax", S.ax, "displayLevel");
    put("ay", S.ay, hasStats ? "perMinute" : "density");
    put("c", S.chart, null);
    put("theme", theme, null);
    let t = p.toString();
    if (S.frontier) t += `${t ? "&" : ""}frontier`;
    history.replaceState(null, "", `${location.pathname}${t ? `?${t}` : ""}`);
  };

  // ------------------------------------------------------------ shared pieces
  const jacket = (r, cls = "jk") => {
    const box = h("span", { class: cls, style: `--band:${bandColor(r)}` }, h("span", { class: "jk-fallback" }, title(r).slice(0, 1)));
    if (showJackets() && r.song.jacket) {
      const img = h("img", { src: new URL(`jackets/${r.song.jacket}.webp`, site).href, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => img.remove());
      box.append(img);
    }
    return box;
  };
  const moeLink = (r, label) => (moeBase
    ? h("a", { class: label ? "moe-btn" : "moe", href: moenotesUrl(r.musicId, S.lang, moeBase), target: "_blank", rel: "noopener",
      title: u().moenotesHint, "aria-label": label ? null : u().moenotes, onclick: (e) => e.stopPropagation() }, label || null, icon("out"))
    : null);
  const level = (r) => h("span", { class: `lv d-${r.difficulty}`, title: u().diff[r.difficulty] }, h("small", {}, DIFF_SHORT[r.difficulty]), lv(r));
  const songCell = (r) => h("div", { class: "song" }, jacket(r),
    h("div", { class: "song-text" },
      h("div", { class: "song-title" }, h("span", { class: "t" }, title(r)), moeLink(r)),
      h("div", { class: "song-band" }, h("i", { class: "dot", style: `background:${bandColor(r)}` }), bandName(r))));
  // options: [value, label, disabled?]
  const seg = (options, value, onPick, cls = "seg") => h("div", { class: cls, role: "tablist" },
    options.map(([v, label, off]) => h("button", { role: "tab", "aria-selected": v === value ? "true" : "false", disabled: Boolean(off),
      onclick: () => { if (v !== value) onPick(v); } }, label)));

  const header = h("header", { class: "top wrap" });
  const head = h("div", { class: "wrap" });
  const filters = h("div", { class: "wrap" });
  const main = h("main", { class: "main wrap" });
  const foot = h("div", { class: "wrap" });
  const drawer = h("div", { class: "drawer-wrap", onclick: (e) => { if (e.target === drawer) closeChart(); } });
  document.body.append(header, head, filters, main, foot, drawer);
  // replaceChildren() writes null as text: drop the parts a view leaves out
  const put = (el, ...parts) => el.replaceChildren(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.chart) closeChart(); });

  const renderHeader = () => {
    const t = u();
    document.title = t.app;
    document.documentElement.lang = S.lang;
    const shown = document.documentElement.dataset.theme;
    put(header, h("div", { class: "appbar glass" },
      h("div", { class: "brand" }, icon("star"), h("span", {}, t.app)),
      h("nav", { class: "views", "aria-label": t.app }, ["rank", "charts", "guide"].map((v) => h("button", {
        "aria-current": S.view === v ? "page" : null, onclick: () => { S.view = v; renderAll(); scrollTo({ top: 0 }); },
      }, t.views[v]))),
      h("div", { class: "tools" },
        hasJackets ? h("button", { class: "toggle", "aria-pressed": S.jackets ? "true" : "false", title: t.jacketsHint,
          onclick: () => { S.jackets = !S.jackets; renderAll(); } }, icon("image"), h("span", {}, t.jackets)) : null,
        h("button", { class: "icon-btn", "aria-label": t.theme, title: t.theme,
          onclick: () => { theme = shown === "dark" ? "light" : "dark"; applyTheme(); renderHeader(); save(); } }, icon(shown === "dark" ? "sun" : "moon")),
        h("select", { class: "lang", "aria-label": "Language", onchange: (e) => { S.lang = e.target.value; renderAll(); } },
          langs.map((l) => h("option", { value: l, selected: l === S.lang }, l))))));
  };

  // the route heading: the view's title and what it answers
  const renderHead = () => {
    const t = u();
    const [title, lead] = S.view === "guide" ? [g().title, g().lead]
      : [t.heads[S.view], t.lead[S.view](songs.songs.length, rows.length)];
    put(head, h("div", { class: "page-head" }, h("div", { class: "page-head-title" }, icon("star", "ic star"), h("h1", {}, title),
      h("span", { class: "track", "aria-hidden": "true" })), h("p", {}, lead)));
  };

  const renderFilters = () => {
    const t = u();
    if (S.view === "guide") { put(filters, ); filters.hidden = true; return; }
    filters.hidden = false;
    const chip = (on, onclick, ...children) => h("button", { class: "chip", "aria-pressed": on ? "true" : "false", onclick }, children);
    const bandChips = h("div", { class: "group scroll", role: "group", "aria-label": t.band }, h("span", { class: "group-label" }, t.band),
      chip(S.band === "", () => { S.band = ""; renderAll(); }, t.all),
      [...bands].map(([id, b]) => chip(S.band === id, () => { S.band = S.band === id ? "" : id; renderAll(); },
        h("i", { style: `background:${b.mainColor}` }), pickText(b.name, S.lang))));
    const diffChips = h("div", { class: "group", role: "group", "aria-label": t.difficulty }, h("span", { class: "group-label" }, t.difficulty),
      DIFFICULTIES.map((d) => h("button", {
        class: `chip d d-${d}`, "aria-pressed": S.diffs.includes(d) ? "true" : "false", title: t.diff[d],
        onclick: () => {
          const on = S.diffs.includes(d) ? S.diffs.filter((x) => x !== d) : [...S.diffs, d];
          S.diffs = DIFFICULTIES.filter((x) => on.includes(x));
          renderAll();
        },
      }, DIFF_SHORT[d])));
    const input = h("input", { type: "search", placeholder: t.search, value: S.search, "aria-label": t.search });
    input.addEventListener("input", () => { S.search = input.value; renderMain(); save(); });
    put(filters, h("div", { class: "filters glass" }, h("div", { class: "filter-row" }, bandChips),
      h("div", { class: "filter-row" }, diffChips, h("label", { class: "search" }, icon("search"), input))));
  };
  const clearFilters = () => { S.band = ""; S.search = ""; S.frontier = false; S.diffs = [...DIFFICULTIES]; renderAll(); };

  const pool = () => rows.filter((r) => S.diffs.includes(r.difficulty)
    && (!S.band || r.bandIds.map(String).includes(S.band)));

  // ------------------------------------------------------------ play scenario and accuracy
  // `redo` redraws after a choice (this panel too), `live` what depends on the figures while a slider moves; `rooms`
  // adds the Gekisou Live room size (score ranks), `missions` names the ranges after a song's Gekisou missions
  const scenarioPanel = ({ redo, live, rooms = false, missions = null }) => {
    const t = u();
    const T = t.scen;
    const battle = S.mode === "battle";
    const note = (text) => h("small", { class: "note" }, text);
    const modes = seg([["battle", T.battle], ["free", has.free ? T.free : `${T.free} · ${T.pending}`, !has.free]], S.mode,
      (v) => { setScenario(() => { S.mode = v; }); redo(); });
    const ranks = [...Array(RANGES).keys()].map((i) => h("span", { class: "rk-pick" },
      h("small", {}, T.range(i + 1, missions ? t.missions[missions[i]] : null)),
      seg([...Array(RANK_MAX).keys()].map((k) => [k + 1, String(k + 1), k > 0 && !has.ranks]), S.ranks[i],
        (v) => { setScenario(() => { S.ranks = S.ranks.map((x, j) => (j === i ? v : x)); }); redo(); }, "seg mini")));
    const slider = (label, value, set, off) => {
      const out = h("output", {}, off ? T.pending : `${value}%`);
      const inp = h("input", { type: "range", min: 0, max: 100, step: 1, value, disabled: off, "aria-label": label });
      inp.addEventListener("input", () => {
        const v = Number(inp.value);
        out.textContent = `${v}%`;
        setScenario(() => set(v));
        live();
        save();
      });
      return h("label", { class: "field" }, h("span", {}, label), inp, out);
    };
    return h("div", { class: "panel scen glass" },
      h("div", { class: "field" }, h("span", {}, T.mode), modes, note(battle ? T.battleHint : T.freeHint)),
      battle ? h("div", { class: "field" }, h("span", {}, T.ranks), ranks, note(has.ranks ? T.rankBest : `${T.rankBest} · ${T.ranksPending}`)) : null,
      h("div", { class: "field" }, h("span", {}, T.accuracy),
        slider(T.great, S.great, (v) => { S.great = v; }, false),
        battle ? slider(T.just, S.just, (v) => { S.just = v; }, !has.just) : null,
        note(battle ? T.accNote : T.accNoteFree)),
      rooms && battle ? h("div", { class: "field" }, h("span", {}, T.room),
        seg([...Array(RANK_MAX).keys()].map((k) => [k + 1, String(k + 1)]), S.room, (v) => { S.room = v; redo(); }, "seg mini"),
        note(T.roomHint)) : null,
      rooms && !battle ? note(T.soloRanks) : null);
  };
  const redoMain = () => { renderMain(); save(); };

  // ------------------------------------------------------------ rankings
  // `live`: redraws what depends on the figures while a slider or a number changes
  const effPanel = (live) => {
    const t = u();
    const ohOut = h("output", {}, `${S.overhead} s`);
    const oh = h("input", { type: "range", min: 0, max: 180, step: 5, value: S.overhead, "aria-label": t.overhead });
    oh.addEventListener("input", () => { S.overhead = Number(oh.value); ohOut.textContent = `${S.overhead} s`; live(); save(); });
    const mean = h("output", { class: "mean" });
    const showMean = () => { mean.textContent = t.meanSkill(Math.round(100 * meanSkill(skills(), 5))); };
    showMean();
    const inputs = S.skills.map((x, i) => {
      const inp = h("input", { type: "number", class: "num-in skill", min: 0, max: 100 * X_MAX, step: 5, value: x, "aria-label": `${t.skills} ${i + 1}` });
      inp.addEventListener("input", () => { S.skills[i] = Math.min(100 * X_MAX, Math.max(0, Number(inp.value) || 0)); showMean(); live(); save(); });
      inp.addEventListener("change", () => { inp.value = S.skills[i]; });
      return inp;
    });
    const event = S.view === "rank" && S.rankBy === "event";
    const power = h("input", { type: "number", class: "num-in power", min: 0, step: 1000, value: S.power || "", placeholder: t.powerHint, "aria-label": t.power });
    power.addEventListener("input", () => { S.power = Math.max(0, Math.round(Number(power.value) || 0)); live(); save(); });
    return h("div", { class: "panel eff glass" },
      h("div", { class: "field" }, h("span", {}, t.length), seg([["bgm", t.bgm], ["chart", t.chart]], S.len, (v) => { S.len = v; renderMain(); save(); })),
      h("label", { class: "field" }, h("span", {}, t.overhead), oh, ohOut),
      h("div", { class: "field" }, h("span", {}, t.skills), h("div", { class: "skills" }, inputs, mean,
        t.presets.map(([label, v]) => h("button", { class: "ghost", onclick: () => { S.skills = v.split(",").map(Number); renderMain(); save(); } }, label)))),
      event ? h("div", { class: "field" }, h("span", {}, t.target), seg(SCORE_RANKS.slice(2).reverse().map((r) => [r, r]), S.target, (v) => { S.target = v; renderMain(); save(); })) : null,
      event ? h("label", { class: "field" }, h("span", {}, t.power), power) : null,
      S.view === "rank" ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: S.frontier, onchange: (e) => { S.frontier = e.target.checked; live(); save(); } }), t.frontier) : null);
  };

  let tableBox = null;
  const renderRank = () => {
    const t = u();
    const tabs = seg(RANKS.filter((k) => hasStats || !EFF_RANKS.has(k)).map((k) => [k, t.rankBy[k]]), S.rankBy,
      (v) => { S.rankBy = v; renderMain(); save(); }, "tabs glass");
    const sub = S.rankBy === "speed"
      ? seg(Object.entries(t.speedBy), S.speedBy, (v) => { S.speedBy = v; renderMain(); save(); })
      : null;
    tableBox = h("div", { class: "table-box" });
    put(main, 
      h("div", { class: "rank-head" }, tabs),
      h("p", { class: "hint" }, t.rankHint[S.rankBy], sub),
      S.rankBy === "efficiency" || S.rankBy === "event"
        ? [scenarioPanel({ redo: redoMain, live: renderTable, rooms: S.rankBy === "event" }), effPanel(renderTable)] : null,
      !hasStats ? h("p", { class: "hint warn" }, t.noStats) : null,
      tableBox);
    renderTable();
  };

  const renderTable = () => {
    if (!tableBox) return;
    const t = u();
    let list = pool();
    let hi = "";
    let unsorted = null;                                  // the list the dominance indexes refer to
    const cols = ["rank", "song", "level", "time", "bpm", "notes", "density"];
    if (S.rankBy === "efficiency") {
      unsorted = list.filter((r) => r.weights);
      list = rank(unsorted, { skills: skills(), source: S.len, overheadMs: S.overhead * 1000 });
      cols.push("rate", "perMinute", "relative", "dom");
      hi = "perMinute";
    } else if (S.rankBy === "event") {
      const n = room();
      unsorted = list.filter((r) => r.weights && rankThreshold(r, S.target, n) !== null);
      const dom = eventDominance(unsorted, S.len, X_MAX, n);
      list = unsorted.map((r, i) => {
        const L = lengthMs(r, S.len);
        const perHour = L ? 3600000 / (L + S.overhead * 1000) : null;
        const chance = S.power ? reachChance(r, skills(), S.power, S.target, 1, n) : null;
        return { ...r, need: requiredPower(r, skills(), S.target, 1, n), chance, perHour,
          goal: chance === null || perHour === null ? null : chance * perHour, dominatedBy: dom[i], frontier: dom[i].length === 0 };
      });
      list = S.power ? sortBy(list, (r) => (r.goal === null ? null : r.goal - r.need * 1e-12)) : sortBy(list, (r) => r.need, true);
      cols.splice(4, 3);                                   // BPM, notes, density: not what this ranking is about
      cols.push("need", ...(S.power ? ["chance"] : []), "perHour", ...(S.power ? ["goal"] : []), "dom");
      hi = S.power ? "goal" : "need";
    } else if (S.rankBy === "skip") {
      list = sortBy(list.filter((r) => r.skip !== null), (r) => r.skip);
      cols.push("skip");
      hi = "skip";
    } else if (S.rankBy === "speed") {
      list = sortBy(list, (r) => r[S.speedBy]);
      hi = S.speedBy === "density" ? "density" : "bpm";
    } else if (S.rankBy === "level") {
      list = sortBy(list, (r) => r.displayLevel * 1e5 + (r.notes || 0));
      hi = "level";
    } else if (S.rankBy === "notes") {
      list = sortBy(list, (r) => r.notes);
      hi = "notes";
    } else {
      list = sortBy(list, (r) => lengthOf(r), S.rankBy === "short");
      hi = "time";
    }
    const all = list.length;
    const byPool = S.rankBy === "efficiency" ? list : null;
    list = list.filter((r) => matches(r, S.search) && (!S.frontier || !unsorted || r.frontier));
    const top = hi === "perMinute" && byPool && byPool.length ? byPool[0].perMinute : null;
    const barMax = (() => {
      const vals = list.map((r) => (hi === "time" ? lengthOf(r) : hi === "level" ? r.displayLevel : hi === "bpm" ? r[S.speedBy] : r[hi]));
      return Math.max(...vals.filter(Number.isFinite), 0);
    })();
    const th = (k) => h("th", { class: `${k}${k === hi ? " hi" : ""}` }, k === "bpm" && S.rankBy === "speed" && S.speedBy === "bpmMax" ? t.speedBy.bpmMax : t.col[k]);
    const bar = (v, text) => h("span", { class: "bar", style: `--w:${barMax ? Math.max(0, Math.min(100, (100 * v) / barMax)) : 0}%` }, text);
    const body = list.map((r, i) => {
      const cell = {
        rank: h("td", { class: "rank" }, h("span", { class: `no${i < 3 ? " top" : ""}` }, String(i + 1))),
        song: h("td", { class: "song-td" }, songCell(r)),
        level: h("td", { class: "num" }, level(r)),
        time: h("td", { class: "num" }, hi === "time" ? bar(lengthOf(r), formatLength(lengthOf(r))) : formatLength(lengthOf(r))),
        bpm: h("td", { class: "num" }, (() => {
          const main = S.rankBy === "speed" && S.speedBy === "bpmMax" ? r.bpmMax : r.bpm;
          const text = [String(main ?? "–"), r.bpmMin !== r.bpmMax ? h("small", { title: u().detail.bpmChanges(r.bpmChanges - 1) }, ` ${r.bpmMin}–${r.bpmMax}`) : null];
          return hi === "bpm" ? bar(main, text) : text;
        })()),
        notes: h("td", { class: "num" }, hi === "notes" ? bar(r.notes, fmtInt(r.notes)) : fmtInt(r.notes)),
        density: h("td", { class: "num" }, hi === "density" ? bar(r.density, fmt(r.density)) : fmt(r.density)),
        rate: h("td", { class: "num" }, fmt(r.rate, 3), (() => {
          if (!r.weights) return null;
          const v = orderRates(r, skills());
          return v[0] === v[v.length - 1] ? null : h("small", { class: "spread", title: t.tipSpread }, ` ${fmt(v[0], 3)}–${fmt(v[v.length - 1], 3)}`);
        })()),
        need: h("td", { class: "num" }, hi === "need" ? bar(r.need, fmtInt(r.need)) : fmtInt(r.need)),
        chance: h("td", { class: "num" }, r.chance === null || r.chance === undefined ? "–" : h("span", { class: `chance c${Math.round((r.chance || 0) * 4)}` }, `${(100 * r.chance).toFixed(r.chance > 0 && r.chance < 0.01 ? 1 : 0)}%`)),
        perHour: h("td", { class: "num" }, fmt(r.perHour, 1)),
        goal: h("td", { class: "num" }, bar(r.goal, fmt(r.goal, 2))),
        perMinute: h("td", { class: "num" }, bar(r.perMinute, fmt(r.perMinute, 3))),
        relative: h("td", { class: "num dim" }, top ? `${((100 * r.perMinute) / top).toFixed(1)}%` : ""),
        dom: h("td", {}, r.frontier ? h("span", { class: "front" }, icon("star"), t.onFrontier) : h("span", {
          class: "beaten", title: (S.rankBy === "event" ? t.tipDomEvent : t.tipDom)((r.dominatedBy || []).map((j) => `${title(unsorted[j])} ${t.diff[unsorted[j].difficulty]}`).join("、")),
        }, t.dominatedBy((r.dominatedBy || []).length))),
        skip: h("td", { class: "num" }, bar(r.skip, fmt(r.skip, 3))),
      };
      if (hi === "level") cell.level = h("td", { class: "num" }, bar(r.displayLevel, level(r)));
      return h("tr", { class: `${r.frontier && unsorted ? "on-front" : ""}`, tabindex: 0,
        onclick: () => openChart(r.scoreId), onkeydown: (e) => { if (e.key === "Enter") openChart(r.scoreId); } },
      cols.map((k) => { const c = cell[k]; if (k === hi) c.classList.add("hi"); c.classList.add(`c-${k}`); return c; }));
    });
    tableBox.replaceChildren(
      h("div", { class: "count" }, `${u().chartsN(list.length)}${list.length !== all ? ` / ${all}` : ""}`),
      h("div", { class: "table-card glass" }, list.length ? h("div", { class: "table-scroll" }, h("table", { class: "rank-table" },
        h("thead", {}, h("tr", {}, cols.map((k) => { const c = th(k); c.classList.add(`c-${k}`); return c; }))),
        h("tbody", {}, body))) : h("div", { class: "empty" }, h("b", {}, t.empty), t.emptyHint, " ",
        h("button", { class: "ghost", onclick: clearFilters }, t.clear))));
  };

  // ------------------------------------------------------------ charts
  const tooltip = h("div", { class: "tip", hidden: true });
  document.body.append(tooltip);
  const showTip = (e, r, lines) => {
    tooltip.replaceChildren(h("div", { class: "tip-head" }, jacket(r, "jk sm"), h("div", {},
      h("div", { class: "tip-title" }, title(r)), h("div", { class: "tip-sub" }, level(r), " ", bandName(r)))),
    lines.map(([k, v]) => h("div", { class: "tip-row" }, h("span", {}, k), h("b", {}, v))));
    tooltip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
  };
  const hideTip = () => { tooltip.hidden = true; };

  const scatter = () => {
    const t = u();
    const W = 860, H = 460, m = { l: 58, r: 18, t: 16, b: 46 };
    const list = pool().filter((r) => matches(r, S.search));
    const pts = list.map((r) => [figure(r, S.ax), figure(r, S.ay), r]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const ex = extent(pts.map((p) => p[0])), ey = extent(pts.map((p) => p[1]));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot", role: "img", "aria-label": `${t.axes[S.ax]} × ${t.axes[S.ay]}` });
    if (!ex || !ey) return svg;
    const sx = (v) => m.l + ((v - ex[0]) / (ex[1] - ex[0])) * (W - m.l - m.r);
    const sy = (v) => H - m.b - ((v - ey[0]) / (ey[1] - ey[0])) * (H - m.t - m.b);
    const grid = s("g", { class: "grid" });
    for (const v of ticks(ex[0], ex[1], 8)) grid.append(s("line", { x1: sx(v), x2: sx(v), y1: m.t, y2: H - m.b }), s("text", { x: sx(v), y: H - m.b + 18, "text-anchor": "middle" }, String(+v.toFixed(2))));
    for (const v of ticks(ey[0], ey[1], 6)) grid.append(s("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v) }), s("text", { x: m.l - 8, y: sy(v) + 4, "text-anchor": "end" }, String(+v.toFixed(3))));
    svg.append(grid,
      s("text", { class: "axis-label", x: (m.l + W - m.r) / 2, y: H - 8, "text-anchor": "middle" }, t.axes[S.ax]),
      s("text", { class: "axis-label", x: 14, y: (m.t + H - m.b) / 2, transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})`, "text-anchor": "middle" }, t.axes[S.ay]));
    const jitter = (id) => (S.ax === "displayLevel" ? (((id * 2654435761) % 1000) / 1000 - 0.5) * 0.3 : 0);
    const dots = s("g", { class: "dots" });
    for (const [x, y, r] of pts) {
      const c = s("circle", { cx: sx(x + jitter(r.scoreId)), cy: sy(y), r: 5.5, style: `fill:${bandColor(r)};stroke:${DIFF_COLOR[r.difficulty]}`, tabindex: 0 });
      c.addEventListener("mousemove", (e) => showTip(e, r, [[t.axes[S.ax], fmt(x, S.ax === "displayLevel" ? 1 : 3)], [t.axes[S.ay], fmt(y, 3)]]));
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", () => { hideTip(); openChart(r.scoreId); });
      dots.append(c);
    }
    svg.append(dots);
    return svg;
  };

  const levelChart = () => {
    const t = u();
    const hist = histogram(pool().filter((r) => matches(r, S.search)), (r) => r.level, 1);
    const W = 860, H = 260, m = { l: 40, r: 10, t: 12, b: 34 };
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot" });
    if (!hist.length) return svg;
    const max = Math.max(...hist.map(([, c]) => Object.values(c).reduce((a, b) => a + b, 0)));
    const bw = (W - m.l - m.r) / hist.length;
    const sy = (v) => ((H - m.t - m.b) * v) / max;
    const grid = s("g", { class: "grid" });
    for (const v of ticks(0, max, 4)) grid.append(s("line", { x1: m.l, x2: W - m.r, y1: H - m.b - sy(v), y2: H - m.b - sy(v) }), s("text", { x: m.l - 6, y: H - m.b - sy(v) + 4, "text-anchor": "end" }, String(v)));
    svg.append(grid);
    hist.forEach(([b, c], i) => {
      let y = H - m.b;
      const x = m.l + i * bw + 3;
      for (const d of DIFFICULTIES) {
        if (!c[d]) continue;
        const hgt = sy(c[d]);
        y -= hgt;
        const rect = s("rect", { x, y, width: Math.max(1, bw - 6), height: hgt, rx: 3, style: `fill:${DIFF_COLOR[d]}` });
        rect.append(s("title", {}, `Lv ${b} ${t.diff[d]}: ${c[d]}`));
        svg.append(rect);
      }
      svg.append(s("text", { class: "tick", x: x + (bw - 6) / 2, y: H - m.b + 18, "text-anchor": "middle" }, String(b)));
    });
    return svg;
  };

  const bandChart = () => {
    const counts = new Map();
    for (const song of songs.songs || []) {
      if (S.search && !matches({ song, musicId: song.id }, S.search)) continue;
      const key = song.bandName ? `n:${pickText(song.bandName, S.lang)}` : String((song.bandIds || [])[0] ?? "");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const list = [...counts].sort((a, b) => b[1] - a[1]);
    const max = Math.max(...list.map((x) => x[1]), 1);
    return h("div", { class: "hbars" }, list.map(([k, n]) => {
      const b = bands.get(k);
      const name = k.startsWith("n:") ? k.slice(2) : b ? pickText(b.name, S.lang) : "—";
      return h("div", { class: "hbar" }, h("span", { class: "hbar-name" }, name),
        h("span", { class: "hbar-track" }, h("span", { class: "hbar-fill", style: `width:${(100 * n) / max}%;background:${b ? b.mainColor : "var(--mn-text-muted)"}` })),
        h("b", {}, String(n)));
    }));
  };

  const renderCharts = () => {
    const t = u();
    const axes = AXES.filter((k) => hasStats || !EFF_AXES.has(k));
    const pick = (label, value, set) => h("label", { class: "field" }, h("span", {}, label), h("select", { onchange: (e) => { set(e.target.value); renderMain(); save(); } },
      axes.map((k) => h("option", { value: k, selected: k === value }, t.axes[k]))));
    const plot = h("div", { class: "plot-box" }, scatter());
    const legend = h("div", { class: "legend" },
      [...bands].map(([, b]) => h("span", {}, h("i", { class: "dot", style: `background:${b.mainColor}` }), pickText(b.name, S.lang))),
      h("span", { class: "legend-sep" }),
      DIFFICULTIES.filter((d) => S.diffs.includes(d)).map((d) => h("span", {}, h("i", { class: `ring d-${d}` }), t.diff[d])));
    put(main, 
      h("section", { class: "card glass" },
        heading("h2", "sec-head", t.scatter,
          h("div", { class: "axes" }, pick(t.x, S.ax, (v) => { S.ax = v; }), h("button", { class: "ghost", "aria-label": t.swap, title: t.swap, onclick: () => { [S.ax, S.ay] = [S.ay, S.ax]; renderMain(); save(); } }, icon("swap")), pick(t.y, S.ay, (v) => { S.ay = v; }))),
        EFF_AXES.has(S.ax) || EFF_AXES.has(S.ay)
          ? [scenarioPanel({ redo: redoMain, live: () => plot.replaceChildren(scatter()) }), effPanel(() => plot.replaceChildren(scatter()))] : null,
        plot, legend),
      h("div", { class: "grid2" },
        h("section", { class: "card glass" }, heading("h2", "sec-head", t.levelDist), levelChart()),
        h("section", { class: "card glass" }, heading("h2", "sec-head", t.bandShare), bandChart())));
    tableBox = null;
  };

  // ------------------------------------------------------------ guide
  // sections: {title, body: [paragraph], math: [formula], defs: [[term, definition]]}; the body comes first
  const renderGuide = () => {
    const G = g();
    const no = (i) => String(i + 1).padStart(2, "0");
    const links = G.sections.map((x, i) => h("a", { href: `#g${i}` }, h("span", {}, no(i)), x.title));
    put(main, h("div", { class: "guide" },
      h("nav", { class: "toc glass", "aria-label": G.title }, links),
      h("article", { class: "g-body" }, G.sections.map((x, i) => h("section", { id: `g${i}`, class: "g-section" },
        heading("h2", "sec-head", [h("span", { class: "g-no" }, no(i)), " ", x.title]),
        (x.body || []).map((p) => h("p", {}, p)),
        x.math && x.math.length ? h("div", { class: "formula" }, x.math.map((m) => h("code", {}, m))) : null,
        (x.after || []).map((p) => h("p", {}, p)),
        x.defs && x.defs.length ? h("dl", { class: "defs" }, x.defs.flatMap(([term, def]) => [h("dt", {}, term), h("dd", {}, def)])) : null)))));
    // the contents follow the reading: the first section in the band from under the header to 45% of the window
    if (guideSpy) guideSpy.disconnect();
    const seen = new Set();
    guideSpy = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      const first = G.sections.findIndex((_, i) => seen.has(`g${i}`));
      links.forEach((a, i) => a.setAttribute("aria-current", i === first ? "true" : "false"));
    }, { rootMargin: "-90px 0px -55% 0px" });
    main.querySelectorAll(".g-section").forEach((x) => guideSpy.observe(x));
  };
  let guideSpy = null;

  // ------------------------------------------------------------ chart detail
  const timeline = (r) => {
    const t = u();
    const c = r.chart;
    const end = Math.max(r.bgmMs || 0, r.chartMs || 0, c.lastNoteMs || 0) || 1;
    const W = 860, H = 132, m = { l: 70, r: 12 };
    const sx = (ms) => m.l + (ms / end) * (W - m.l - m.r);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot timeline" });
    const lanes = [[t.detail.fever, 20], [t.detail.skill, 50], [t.detail.span, 80], [t.detail.bpm, 104]];
    for (const [name, y] of lanes) svg.append(s("text", { class: "lane", x: 0, y: y + 4 }, name), s("line", { class: "lane-line", x1: m.l, x2: W - m.r, y1: y, y2: y }));
    (c.fevers || []).forEach(([a, b], i) => {
      const mission = t.missions[(r.song.gekisouMissions || [])[i]];
      const g2 = s("g", {}, s("rect", { class: "fever", x: sx(a), y: 12, width: Math.max(2, sx(b) - sx(a)), height: 16, rx: 4 }),
        mission ? s("text", { class: "fever-tag", x: sx(a) + 4, y: 24 }, mission) : null);
      g2.append(s("title", {}, `${t.detail.fever} ${i + 1}: ${formatLength(a)}–${formatLength(b)}${mission ? ` · ${t.detail.mission} ${mission}` : ""}`));
      svg.append(g2);
    });
    // skill event i fires performance position events[i][0] (music-data.json deck statistics)
    const posWeights = r.weights;
    const maxW = posWeights ? Math.max(...posWeights) : 0;
    const eventW = (i) => {
      const k = r.stats && r.stats.events && r.stats.events[i] ? r.stats.events[i][0] : i;
      return posWeights && posWeights[k] !== undefined ? posWeights[k] : null;
    };
    (c.skillEventsMs || []).forEach((ms, i) => {
      const wEnd = Math.min(ms + 5000, r.chartMs || ms + 5000);
      const op = eventW(i) !== null && maxW ? 0.35 + (0.65 * eventW(i)) / maxW : 0.8;
      const g2 = s("g", {}, s("rect", { class: "skill", x: sx(ms), y: 41, width: Math.max(2, sx(wEnd) - sx(ms)), height: 18, rx: 4, "fill-opacity": op.toFixed(2) }),
        s("text", { class: "skill-no", x: sx(ms) + 4, y: 54 }, String(i + 1)));
      g2.append(s("title", {}, `${t.detail.skill} ${i + 1}: ${formatLength(ms)}${eventW(i) !== null ? ` · w ${eventW(i).toFixed(3)}` : ""}`));
      svg.append(g2);
    });
    svg.append(s("rect", { class: "span", x: sx(c.firstNoteMs || 0), y: 76, width: Math.max(2, sx(c.lastJudgedNoteMs || 0) - sx(c.firstNoteMs || 0)), height: 8, rx: 4 }));
    const changes = (c.bpm && c.bpm.changes) || [];
    if (changes.length) {
      const lo = Math.min(...changes.map((x) => x.bpm)), hi = Math.max(...changes.map((x) => x.bpm));
      const yy = (b) => (hi === lo ? 104 : 114 - ((b - lo) / (hi - lo)) * 20);
      let d = "";
      changes.forEach((x, i) => {
        const x0 = sx(Math.max(0, x.timeMs)), x1 = sx(i + 1 < changes.length ? changes[i + 1].timeMs : end);
        d += `${i ? "L" : "M"}${x0.toFixed(1)},${yy(x.bpm).toFixed(1)}H${x1.toFixed(1)}`;
      });
      svg.append(s("path", { class: "bpm-line", d }));
      if (hi !== lo) svg.append(s("text", { class: "tick", x: W - m.r, y: 92, "text-anchor": "end" }, `${lo}–${hi}`));
    }
    for (let ms = 0; ms <= end; ms += 30000) svg.append(s("text", { class: "tick", x: sx(ms), y: H - 2, "text-anchor": "middle" }, formatLength(ms).replace(/\.\d$/, "")));
    return svg;
  };

  const composition = (r) => {
    const t = u();
    const total = Object.values(r.kinds).reduce((a, b) => a + b, 0) || 1;
    return h("div", { class: "comp" },
      h("div", { class: "comp-bar" }, NOTE_KINDS.filter(([k]) => r.kinds[k]).map(([k]) => h("span", { style: `width:${(100 * r.kinds[k]) / total}%;background:${KIND_COLOR[k]}`, title: `${t.kinds[k]} ${r.kinds[k]}` }))),
      h("div", { class: "comp-legend" }, NOTE_KINDS.filter(([k]) => r.kinds[k]).map(([k]) => h("span", {}, h("i", { class: "dot", style: `background:${KIND_COLOR[k]}` }), t.kinds[k], h("b", {}, ` ${r.kinds[k]}`), h("small", {}, ` ${((100 * r.kinds[k]) / total).toFixed(0)}%`)))));
  };

  const weightsChart = (r) => {
    const w = r.weights;
    if (!w) return null;
    const max = Math.max(...w, 1e-9);
    const W = weightSum(r);
    return h("div", { class: "weights" }, w.map((v, i) => h("div", { class: "wcol" },
      h("b", {}, v.toFixed(3)),
      h("span", { class: "wbar" }, h("span", { style: `height:${(100 * v) / max}%` })),
      h("span", { class: "wpos" }, `#${i + 1}`),
      h("small", {}, `${W > 0 ? ((100 * v) / W).toFixed(0) : 0}%`))));
  };

  // the song's score ranks: threshold, the power the expected score needs, and the chance at the power entered
  const ranksTable = (r) => {
    const t = u();
    const n = room();
    const ranks = SCORE_RANKS.filter((k) => rankThreshold(r, k, n) !== null).reverse();
    if (!ranks.length || !r.weights) return null;
    const rates = orderRates(r, skills());
    const spread = rates[rates.length - 1] > rates[0] + 1e-12;       // equal skills: every order scores the same
    return h("table", { class: "ranks" },
      h("thead", {}, h("tr", {}, h("th", {}, t.detail.rank), h("th", {}, n ? t.detail.requiredRoom(n) : t.detail.required), h("th", {}, t.detail.needPower),
        spread ? h("th", {}, t.detail.needRange) : null, S.power ? h("th", {}, t.detail.chanceAt(fmtInt(S.power))) : null)),
      h("tbody", {}, ranks.map((k) => {
        const R = rankThreshold(r, k, n);
        const chance = S.power ? reachChance(r, skills(), S.power, k, 1, n) : null;
        return h("tr", {}, h("td", {}, h("span", { class: `rk rk-${k}` }, k)), h("td", { class: "num" }, fmtInt(R)),
          h("td", { class: "num" }, fmtInt(requiredPower(r, skills(), k, 1, n))),
          spread ? h("td", { class: "num dim" }, R > 0 ? `${fmtInt(R / rates[rates.length - 1])}–${fmtInt(R / rates[0])}` : "–") : null,
          chance === null ? null : h("td", { class: "num" }, `${(100 * chance).toFixed(0)}%`));
      })));
  };

  // the rank measure of every Gekisou range (ranking.js rangeMeasures, no skills): Gekisou Live only; null when the
  // data has none of them
  const measuresBox = (r) => {
    const t = u();
    const D = t.detail;
    const measures = rangeMeasures(r.stats);
    if (!measures.some((m) => MEASURES.some((k) => m.values[k]))) return null;
    // a measure as its seed mean, with the seeds' min–max when they differ
    const stat = (m) => {
      if (!m) return "–";
      const v = Number.isInteger(m.mean) ? fmtInt(m.mean) : fmt(m.mean, 1);
      return m.min === m.max ? v : `${v} (${fmtInt(m.min)}–${fmtInt(m.max)})`;
    };
    return h("section", {}, heading("h3", "sec-head", D.measures),
      h("div", { class: "tbl-scroll" }, h("table", { class: "ranks measures" },
        h("thead", {}, h("tr", {}, h("th", {}, D.mRange), h("th", {}, D.mCompared), MEASURES.map((k) => h("th", {}, D.measure[k])))),
        h("tbody", {}, measures.map((m) => h("tr", {},
          h("td", {}, t.scen.range(m.index + 1, t.missions[m.mission] || null)),
          h("td", {}, m.measure ? D.measure[m.measure] : "–"),
          MEASURES.map((k) => h("td", { class: k === m.measure ? "num hi" : "num dim" }, stat(m.values[k])))))))),
      h("p", { class: "hint" }, D.measuresHint));
  };

  // a scenario changed in the detail: the view behind it redraws when the detail closes
  let behindStale = false;
  const openChart = (scoreId) => { S.chart = scoreId; renderDrawer(); save(); };
  const closeChart = () => {
    S.chart = null;
    renderDrawer();
    if (behindStale) { behindStale = false; renderMain(); }
    save();
  };
  const renderDrawer = () => {
    const r = S.chart && byScore.get(S.chart);
    if (!r) { drawer.classList.remove("open"); drawer.replaceChildren(); document.body.classList.remove("locked"); return; }
    const t = u();
    const siblings = rows.filter((x) => x.musicId === r.musicId);
    const tile = (k, v, sub, cls) => h("div", { class: cls ? `tile ${cls}` : "tile" }, h("span", {}, k), h("b", {}, v), sub ? h("small", {}, sub) : null);
    const c = r.chart;
    // the figures of the scenario chosen: redrawn in place while the detail's own scenario panel changes
    const controls = h("div", {});
    const scores = h("div", {});
    const line = h("div", { class: "tl-scroll" });
    const weights = h("section", {});
    const ranks = h("div", {});
    const measures = measuresBox(r);
    const draw = () => {
      const e = eff(r);
      const battle = S.mode === "battle";
      const solo = battle && r.weights ? freeRate(r) : null;
      if (measures) measures.hidden = !battle;
      put(scores, h("div", { class: "tiles" },
        r.weights ? tile(t.col.rate, fmt(e.rate, 3), (() => {
          const v = orderRates(r, skills());
          return v[v.length - 1] > v[0] + 1e-12 ? `${t.detail.orders} ${fmt(v[0], 3)}–${fmt(v[v.length - 1], 3)} · P10 ${fmt(quantile(v, 0.1), 3)}` : t.detail.sameOrder;
        })()) : null,
        r.weights ? tile(t.col.base, fmt(r.base, 3), `W ${fmt(weightSum(r), 3)} · ${t.col.skip} ${fmt(r.skip, 3)}`
          + (r.seeds > 1 ? ` · ${t.detail.seeds(r.seeds)} ${fmt(r.baseRange[0], 3)}–${fmt(r.baseRange[1], 3)}` : "")) : null,
        r.weights ? tile(t.col.perMinute, fmt(e.perMinute, 3), `${t.length} ${t[S.len]} + ${S.overhead} s`) : null,
        battle && r.weights ? tile(t.detail.twoScores, `${fmt(e.rate, 3)} / ${solo === null ? t.scen.pending : fmt(solo, 3)}`,
          t.detail.twoScoresHint, "wide") : null,
        battle && r.unplayable ? tile(t.detail.unplayable, "–", `${t.detail.unplayableHint}${has.free ? t.detail.unplayableFree : ""}`) : null,
        !r.weights && !(battle && r.unplayable) && r.stats ? tile(t.detail.noFigures, "–", t.scen.pending) : null));
      put(line, timeline(r));
      put(weights, r.weights ? [heading("h3", "sec-head", t.detail.weights), weightsChart(r), h("p", { class: "hint" }, t.detail.weightsHint)] : null);
      put(ranks, r.weights && r.scoreRanks.length ? h("section", {}, heading("h3", "sec-head", t.detail.ranks), ranksTable(r),
        h("p", { class: "hint" }, room() ? t.detail.ranksHintRoom(S.room) : t.detail.ranksHint)) : null);
    };
    const panelHere = () => (hasStats ? scenarioPanel({
      redo: () => { put(controls, panelHere()); draw(); behindStale = true; save(); },
      live: () => { draw(); behindStale = true; },
      rooms: true,
      missions: r.song.gekisouMissions || null,
    }) : null);
    put(controls, panelHere());
    draw();
    const panel = h("div", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": title(r) },
      h("div", { class: "d-hero", style: `--band:${bandColor(r)}` },
        showJackets() && r.song.jacket ? h("div", { class: "d-bg", style: `background-image:url("${new URL(`jackets/${r.song.jacket}.webp`, site).href}")` }) : null,
        jacket(r, "jk xl"),
        h("div", { class: "d-title" },
          h("div", { class: "d-band" }, h("i", { class: "dot", style: `background:${bandColor(r)}` }), bandName(r)),
          h("h2", {}, title(r)),
          h("div", { class: "d-diffs" }, siblings.map((x) => h("button", { class: `lv-tab d-${x.difficulty}`, "aria-current": x === r ? "true" : null,
            title: t.diff[x.difficulty], onclick: () => openChart(x.scoreId) }, h("span", {}, DIFF_SHORT[x.difficulty]), h("b", {}, lv(x))))),
          moeLink(r, t.moenotes)),
        h("button", { class: "d-close", "aria-label": t.detail.close, title: t.detail.close, onclick: closeChart }, icon("close"))),
      h("div", { class: "d-body" },
        h("div", { class: "tiles" },
          tile(t.detail.notes, fmtInt(r.notes), `${t.detail.fullCombo} ${fmtInt(c.fullComboCount)}`),
          tile(t.detail.density, `${fmt(r.density)} N/s`, `${t.detail.span} ${formatLength((c.lastJudgedNoteMs || 0) - (c.firstNoteMs || 0))}`),
          tile(t.detail.bpm, String(r.bpm ?? "–"), r.bpmMin !== r.bpmMax ? `${r.bpmMin}–${r.bpmMax} · ${t.detail.bpmChanges(r.bpmChanges - 1)}` : ""),
          tile(t.detail.bgm, formatLength(r.bgmMs), `${t.detail.musicLength} ${formatLength(r.chartMs)}`)),
        hasStats ? heading("h3", "sec-head", t.detail.score) : null, controls, scores,
        heading("h3", "sec-head", t.detail.timeline), line,
        h("div", { class: "grid2" },
          h("section", {}, heading("h3", "sec-head", t.detail.composition), composition(r)),
          weights),
        ranks,
        measures,
        h("p", { class: "ids" }, `${t.detail.musicId} ${r.musicId} · ${t.detail.scoreId} ${r.scoreId} · ${t.detail.musicType} ${r.song.musicType}`)));
    drawer.replaceChildren(panel);
    drawer.classList.add("open");
    document.body.classList.add("locked");
  };

  // ------------------------------------------------------------ render
  const renderMain = () => {
    if (S.view !== "guide" && guideSpy) { guideSpy.disconnect(); guideSpy = null; }
    if (S.view === "rank") renderRank();
    else if (S.view === "charts") renderCharts();
    else renderGuide();
  };
  const renderFoot = () => {
    const p = songs.provenance || {};
    const m = p.master || {};
    const c = p.client || {};
    const d = p.deck || null;
    const deckLink = d && d.source && d.commit
      ? h("a", { href: `${d.source}/tree/${d.commit}`, target: "_blank", rel: "noopener" }, `${d.name || "deck"} ${d.commit.slice(0, 7)}`)
      : null;
    // the data is the same on every server as far as we know; the region and versions it was taken from go in the hint
    const client = c.versionName ? `${c.versionName}${c.versionCode ? ` (${c.versionCode})` : ""}` : "?";
    const master = m.version ?? "?";
    put(foot, h("footer", { class: "foot" }, h("span", {},
      h("span", { title: u().sourceHint(p.region ?? "?", master, client) }, u().source(/^[0-9a-f]{32}$/i.test(master) ? master.slice(0, 8) : master)),
      deckLink ? [` · ${u().deckModel} `, deckLink] : null),
      h("span", {}, u().caveat),
      moeBase ? h("span", {}, h("a", { href: moeBase, target: "_blank", rel: "noopener" }, "moenotes", icon("out")), ` · ${u().moenotesHint}`) : null));
  };
  const renderAll = () => { renderHeader(); renderHead(); renderFilters(); renderMain(); renderFoot(); renderDrawer(); save(); };
  renderAll();
};

main().catch((e) => {
  console.error(e);
  document.querySelector(".boot")?.remove();
  document.body.append(h("div", { class: "boot error" }, `error: ${e && e.message ? e.message : e}`));
});
