// Chart data page: rankings, charts and a guide over a site's songs.json (nnnotes songs), chart-stats.json
// (ournotes-deck chart-stats; optional: without it the efficiency figures are left out) and jackets/<jacket>.webp
// (nnnotes songs --jackets; optional). Song pages (credits, vocals, audio, chart previews) are moenotes': every song
// links there instead of repeating them. The choices live in the query:
//   ?v=rank|charts|guide &lang=<language> &band=<id> &d=<difficulty>[,...] &q=<search>
//   &r=efficiency|speed|level|notes|long|short|skip &sp=density|bpmMax|bpm   (ranking, speed measure)
//   &len=bgm|chart &oh=<seconds> &x=<percent>[,...] &frontier               (efficiency)
//   &ax=<figure> &ay=<figure>                                               (scatter axes)
//   &c=<scoreId>                                                            (the chart detail open)
//   &moenotes=<base URL>|off                                                (song links; default https://bdon.moe/)
// The site root is this page's directory unless ?site=<URL> names another one.
import {
  DIFFICULTIES, MOENOTES, NOTE_KINDS, chartRows, extent, histogram, matches, moenotesUrl, pickText, sortBy, ticks,
} from "./catalog.js";
import { formatLength, perMinute, rank, scoreRate, sortedSkills } from "./ranking.js";
import { GUIDE, UI } from "./text.js";

const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "./", location.href);
const moeBase = q.get("moenotes") === "off" ? null : q.get("moenotes") || MOENOTES;
const SVG = "http://www.w3.org/2000/svg";
const DIFF_COLOR = { easy: "#4a8cff", normal: "#3fbf6a", hard: "#f2a33a", expert: "#ef4d6b" };
const RANKS = ["efficiency", "speed", "level", "notes", "long", "short", "skip"];
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
  const [songs, stats] = await Promise.all([load("songs.json"), load("chart-stats.json", true)]);
  boot.remove();

  const langs = Array.isArray(songs.languages) && songs.languages.length ? songs.languages : ["ja"];
  const rows = chartRows(songs, stats);
  const byScore = new Map(rows.map((r) => [r.scoreId, r]));
  const bands = new Map((songs.bands || []).map((b) => [String(b.id), b]));
  const hasStats = rows.some((r) => r.weights);
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
    ax: AXES.includes(q.get("ax")) ? q.get("ax") : "displayLevel",
    ay: AXES.includes(q.get("ay")) ? q.get("ay") : hasStats ? "perMinute" : "density",
    chart: Number(q.get("c")) || null,
  };
  while (S.skills.length < 5) S.skills.push(0);
  if (!hasStats && (S.rankBy === "efficiency" || S.rankBy === "skip")) S.rankBy = "speed";
  const u = () => (S.lang.startsWith("zh") ? UI.zh : UI.en);
  const g = () => (S.lang.startsWith("zh") ? GUIDE.zh : GUIDE.en);
  const skills = () => sortedSkills(S.skills.map((x) => x / 100));
  const eff = (r) => (r.weights
    ? { rate: scoreRate(r, skills()), perMinute: perMinute(r, skills(), S.len, S.overhead * 1000) }
    : { rate: null, perMinute: null });
  const title = (r) => pickText(r.title, S.lang) || String(r.musicId);
  const bandOf = (r) => bands.get(String(r.bandIds[0]));
  const bandName = (r) => pickText(r.bandName, S.lang) || (bandOf(r) ? pickText(bandOf(r).name, S.lang) : "");
  const bandColor = (r) => (bandOf(r) ? bandOf(r).mainColor : "#8a93a6");
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
    put("ax", S.ax, "displayLevel");
    put("ay", S.ay, hasStats ? "perMinute" : "density");
    put("c", S.chart, null);
    let t = p.toString();
    if (S.frontier) t += `${t ? "&" : ""}frontier`;
    history.replaceState(null, "", `${location.pathname}${t ? `?${t}` : ""}`);
  };

  // ------------------------------------------------------------ shared pieces
  const jacket = (r, cls = "jk") => {
    const box = h("span", { class: cls, style: `--band:${bandColor(r)}` }, h("span", { class: "jk-fallback" }, title(r).slice(0, 1)));
    if (r.song.jacket) {
      const img = h("img", { src: new URL(`jackets/${r.song.jacket}.webp`, site).href, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => img.remove());
      box.append(img);
    }
    return box;
  };
  const moeLink = (r, label) => (moeBase
    ? h("a", { class: label ? "moe-btn" : "moe", href: moenotesUrl(r.musicId, S.lang, moeBase), target: "_blank", rel: "noopener",
      title: u().moenotesHint, onclick: (e) => e.stopPropagation() }, label ? [label, " ↗"] : "↗")
    : null);
  const level = (r) => h("span", { class: `lv ${r.difficulty}`, title: u().diff[r.difficulty] }, lv(r));
  const songCell = (r) => h("div", { class: "song" }, jacket(r),
    h("div", { class: "song-text" },
      h("div", { class: "song-title" }, h("span", { class: "t" }, title(r)), moeLink(r)),
      h("div", { class: "song-band" }, h("i", { style: `background:${bandColor(r)}` }), bandName(r))));
  const seg = (options, value, onPick, cls = "seg") => h("div", { class: cls, role: "tablist" },
    options.map(([v, label]) => h("button", { class: v === value ? "on" : "", role: "tab", "aria-selected": v === value ? "true" : "false", onclick: () => onPick(v) }, label)));

  const header = h("header", { class: "top" });
  const filters = h("div", { class: "filters" });
  const main = h("main", { class: "main" });
  const foot = h("footer", { class: "foot" });
  const drawer = h("div", { class: "drawer-wrap", onclick: (e) => { if (e.target === drawer) closeChart(); } });
  document.body.append(header, filters, main, foot, drawer);
  // replaceChildren() writes null as text: drop the parts a view leaves out
  const put = (el, ...parts) => el.replaceChildren(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.chart) closeChart(); });

  const renderHeader = () => {
    const t = u();
    document.title = t.app;
    document.documentElement.lang = S.lang;
    put(header, 
      h("div", { class: "brand" }, h("span", { class: "logo" }, "♪"), h("span", {}, t.app)),
      h("nav", { class: "views" }, ["rank", "charts", "guide"].map((v) => h("button", {
        class: S.view === v ? "on" : "", onclick: () => { S.view = v; renderAll(); },
      }, t.views[v]))),
      h("select", { class: "lang", "aria-label": "language", onchange: (e) => { S.lang = e.target.value; renderAll(); } },
        langs.map((l) => h("option", { value: l, selected: l === S.lang }, l))),
    );
  };

  const renderFilters = () => {
    const t = u();
    if (S.view === "guide") { put(filters, ); filters.hidden = true; return; }
    filters.hidden = false;
    const bandChips = h("div", { class: "chips" },
      h("button", { class: `chip${S.band === "" ? " on" : ""}`, onclick: () => { S.band = ""; renderAll(); } }, t.all),
      [...bands].map(([id, b]) => h("button", {
        class: `chip${S.band === id ? " on" : ""}`, style: `--c:${b.mainColor}`, onclick: () => { S.band = S.band === id ? "" : id; renderAll(); },
      }, h("i", { style: `background:${b.mainColor}` }), pickText(b.name, S.lang))));
    const diffChips = h("div", { class: "chips" }, DIFFICULTIES.map((d) => h("button", {
      class: `chip diff${S.diffs.includes(d) ? " on" : ""}`, style: `--c:${DIFF_COLOR[d]}`,
      onclick: () => {
        const on = S.diffs.includes(d) ? S.diffs.filter((x) => x !== d) : [...S.diffs, d];
        S.diffs = DIFFICULTIES.filter((x) => on.includes(x));
        renderAll();
      },
    }, t.diff[d])));
    const search = h("input", { type: "search", class: "search", placeholder: t.search, value: S.search, "aria-label": t.search });
    search.addEventListener("input", () => { S.search = search.value; renderMain(); save(); });
    put(filters, h("div", { class: "filter-row" }, bandChips), h("div", { class: "filter-row" }, diffChips, search));
  };

  const pool = () => rows.filter((r) => S.diffs.includes(r.difficulty)
    && (!S.band || r.bandIds.map(String).includes(S.band)));

  // ------------------------------------------------------------ rankings
  // `live`: redraws what depends on the figures while a slider or a number changes
  const effPanel = (live) => {
    const t = u();
    const ohOut = h("output", {}, `${S.overhead} s`);
    const oh = h("input", { type: "range", min: 0, max: 180, step: 5, value: S.overhead, "aria-label": t.overhead });
    oh.addEventListener("input", () => { S.overhead = Number(oh.value); ohOut.textContent = `${S.overhead} s`; live(); save(); });
    const inputs = S.skills.map((x, i) => {
      const inp = h("input", { type: "number", class: "skill", min: 0, max: 300, step: 5, value: x, "aria-label": `${t.skills} ${i + 1}` });
      inp.addEventListener("input", () => { S.skills[i] = Math.max(0, Number(inp.value) || 0); live(); save(); });
      return inp;
    });
    return h("div", { class: "panel eff" },
      h("label", { class: "field" }, h("span", {}, t.length), seg([["bgm", t.bgm], ["chart", t.chart]], S.len, (v) => { S.len = v; renderMain(); save(); })),
      h("label", { class: "field" }, h("span", {}, t.overhead), oh, ohOut),
      h("div", { class: "field" }, h("span", {}, t.skills), h("div", { class: "skills" }, inputs,
        t.presets.map(([label, v]) => h("button", { class: "ghost", onclick: () => { S.skills = v.split(",").map(Number); renderMain(); save(); } }, label)))),
      S.view === "rank" ? h("label", { class: "field check" }, h("input", { type: "checkbox", checked: S.frontier, onchange: (e) => { S.frontier = e.target.checked; live(); save(); } }), t.frontier) : null);
  };

  let tableBox = null;
  const renderRank = () => {
    const t = u();
    const tabs = seg(RANKS.filter((k) => hasStats || (k !== "efficiency" && k !== "skip")).map((k) => [k, t.rankBy[k]]), S.rankBy,
      (v) => { S.rankBy = v; renderMain(); save(); }, "seg big");
    const sub = S.rankBy === "speed"
      ? seg(Object.entries(t.speedBy), S.speedBy, (v) => { S.speedBy = v; renderMain(); save(); })
      : null;
    tableBox = h("div", { class: "table-box" });
    put(main, 
      h("div", { class: "rank-head" }, tabs),
      h("p", { class: "hint" }, t.rankHint[S.rankBy], sub),
      S.rankBy === "efficiency" ? effPanel(renderTable) : null,
      !hasStats ? h("p", { class: "hint warn" }, t.noStats) : null,
      tableBox);
    renderTable();
  };

  const renderTable = () => {
    if (!tableBox) return;
    const t = u();
    let list = pool();
    let hi = "";
    const cols = ["rank", "song", "level", "time", "bpm", "notes", "density"];
    if (S.rankBy === "efficiency") {
      list = rank(list.filter((r) => r.weights), { skills: skills(), source: S.len, overheadMs: S.overhead * 1000 });
      cols.push("rate", "perMinute", "relative", "dom");
      hi = "perMinute";
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
    // dominance indexes refer to the unsorted pool that rank() received
    const unsorted = S.rankBy === "efficiency" ? pool().filter((r) => r.weights) : null;
    list = list.filter((r) => matches(r, S.search) && (!S.frontier || S.rankBy !== "efficiency" || r.frontier));
    const top = hi === "perMinute" && byPool && byPool.length ? byPool[0].perMinute : null;
    const barMax = (() => {
      const vals = list.map((r) => (hi === "time" ? lengthOf(r) : hi === "level" ? r.displayLevel : hi === "bpm" ? r[S.speedBy] : hi === "perMinute" ? r.perMinute : r[hi]));
      return Math.max(...vals.filter(Number.isFinite), 0);
    })();
    const th = (k) => h("th", { class: `${k}${k === hi ? " hi" : ""}` }, k === "bpm" && S.rankBy === "speed" && S.speedBy === "bpmMax" ? t.speedBy.bpmMax : t.col[k]);
    const bar = (v, text) => h("span", { class: "bar", style: `--w:${barMax ? Math.max(0, Math.min(100, (100 * v) / barMax)) : 0}%` }, text);
    const body = list.map((r, i) => {
      const cell = {
        rank: h("td", { class: "rank" }, h("span", { class: `no n${i + 1}` }, String(i + 1))),
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
        rate: h("td", { class: "num" }, fmt(r.rate, 3)),
        perMinute: h("td", { class: "num" }, bar(r.perMinute, fmt(r.perMinute, 3))),
        relative: h("td", { class: "num dim" }, top ? `${((100 * r.perMinute) / top).toFixed(1)}%` : ""),
        dom: h("td", {}, r.frontier ? h("span", { class: "front" }, "★ ", t.onFrontier) : h("span", {
          class: "beaten", title: t.tipDom((r.dominatedBy || []).map((j) => `${title(unsorted[j])} ${t.diff[unsorted[j].difficulty]}`).join("、")),
        }, t.dominatedBy((r.dominatedBy || []).length))),
        skip: h("td", { class: "num" }, bar(r.skip, fmt(r.skip, 3))),
      };
      if (hi === "level") cell.level = h("td", { class: "num" }, bar(r.displayLevel, level(r)));
      return h("tr", { class: `${r.frontier && S.rankBy === "efficiency" ? "on-front" : ""}`, tabindex: 0,
        onclick: () => openChart(r.scoreId), onkeydown: (e) => { if (e.key === "Enter") openChart(r.scoreId); } },
      cols.map((k) => { const c = cell[k]; if (k === hi) c.classList.add("hi"); c.classList.add(`c-${k}`); return c; }));
    });
    tableBox.replaceChildren(
      h("div", { class: "count" }, `${u().chartsN(list.length)}${list.length !== all ? ` / ${all}` : ""}`),
      h("div", { class: "table-scroll" }, h("table", { class: "rank-table" },
        h("thead", {}, h("tr", {}, cols.map((k) => { const c = th(k); c.classList.add(`c-${k}`); return c; }))),
        h("tbody", {}, body))));
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
      const c = s("circle", { cx: sx(x + jitter(r.scoreId)), cy: sy(y), r: 5.5, fill: bandColor(r), stroke: DIFF_COLOR[r.difficulty], tabindex: 0 });
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
        const rect = s("rect", { x, y, width: Math.max(1, bw - 6), height: hgt, rx: 3, fill: DIFF_COLOR[d] });
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
        h("span", { class: "hbar-track" }, h("span", { class: "hbar-fill", style: `width:${(100 * n) / max}%;background:${b ? b.mainColor : "#8a93a6"}` })),
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
      [...bands].map(([, b]) => h("span", {}, h("i", { style: `background:${b.mainColor}` }), pickText(b.name, S.lang))),
      h("span", { class: "legend-sep" }),
      DIFFICULTIES.filter((d) => S.diffs.includes(d)).map((d) => h("span", {}, h("i", { class: "ring", style: `border-color:${DIFF_COLOR[d]}` }), t.diff[d])));
    put(main, 
      h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h2", {}, t.scatter),
          h("div", { class: "axes" }, pick(t.x, S.ax, (v) => { S.ax = v; }), h("button", { class: "ghost swap", title: "⇄", onclick: () => { [S.ax, S.ay] = [S.ay, S.ax]; renderMain(); save(); } }, "⇄"), pick(t.y, S.ay, (v) => { S.ay = v; }))),
        EFF_AXES.has(S.ax) || EFF_AXES.has(S.ay) ? effPanel(() => plot.replaceChildren(scatter())) : null,
        plot, legend),
      h("div", { class: "grid2" },
        h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, t.levelDist)), levelChart()),
        h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, t.bandShare)), bandChart())));
    tableBox = null;
  };

  // ------------------------------------------------------------ guide
  const renderGuide = () => {
    const G = g();
    put(main, h("article", { class: "guide" },
      h("h1", {}, G.title), h("p", { class: "lead" }, G.intro),
      h("nav", { class: "toc" }, G.sections.map(([name], i) => h("a", { href: `#g${i}` }, name)), h("a", { href: "#gs" }, G.scenarioTitle)),
      h("div", { class: "formula" }, h("code", {}, "得分 ≈ P × (base + Σ xₖ · wₖ)"), h("code", {}, "效率 = 分/综合力 ÷ ((时长 + 额外耗时) / 60)")),
      G.sections.map(([name, intro, items], i) => h("section", { id: `g${i}`, class: "g-section" },
        h("h2", {}, name), intro ? h("p", { class: "g-intro" }, intro) : null,
        h("div", { class: "terms" }, items.map(([term, meaning, why]) => h("div", { class: "term" },
          h("h3", {}, term), h("p", {}, meaning), why ? h("p", { class: "why" }, why) : null))))),
      h("section", { id: "gs", class: "g-section" }, h("h2", {}, G.scenarioTitle),
        h("div", { class: "scenes" }, G.scenarios.map(([who, where, what]) => h("div", { class: "scene" },
          h("h3", {}, who), h("span", { class: "where" }, where), h("p", {}, what)))))));
    if (!S.lang.startsWith("zh")) main.querySelector(".formula").replaceChildren(h("code", {}, "score ≈ P × (base + Σ xₖ · wₖ)"), h("code", {}, "efficiency = score/power ÷ ((length + overhead) / 60)"));
  };

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
    for (const [a, b] of c.fevers || []) svg.append(s("rect", { class: "fever", x: sx(a), y: 12, width: Math.max(2, sx(b) - sx(a)), height: 16, rx: 4 }));
    const posWeights = r.stats && r.stats.positions ? r.stats.positions[0] : null;
    const maxW = posWeights ? Math.max(...posWeights) : 0;
    (c.skillEventsMs || []).forEach((ms, i) => {
      const wEnd = Math.min(ms + 5000, r.chartMs || ms + 5000);
      const op = posWeights && maxW ? 0.35 + (0.65 * posWeights[i]) / maxW : 0.8;
      const g2 = s("g", {}, s("rect", { class: "skill", x: sx(ms), y: 41, width: Math.max(2, sx(wEnd) - sx(ms)), height: 18, rx: 4, "fill-opacity": op.toFixed(2) }),
        s("text", { class: "skill-no", x: sx(ms) + 4, y: 54 }, String(i + 1)));
      g2.append(s("title", {}, `${t.detail.skill} ${i + 1}: ${formatLength(ms)}${posWeights ? ` · w ${posWeights[i].toFixed(3)}` : ""}`));
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
    const colors = { tap: "#7aa2ff", flick: "#ff6b9a", slide: "#3fd0a8", trace: "#f5c451", combo: "#8a93a6" };
    return h("div", { class: "comp" },
      h("div", { class: "comp-bar" }, NOTE_KINDS.filter(([k]) => r.kinds[k]).map(([k]) => h("span", { style: `width:${(100 * r.kinds[k]) / total}%;background:${colors[k]}`, title: `${t.kinds[k]} ${r.kinds[k]}` }))),
      h("div", { class: "comp-legend" }, NOTE_KINDS.filter(([k]) => r.kinds[k]).map(([k]) => h("span", {}, h("i", { style: `background:${colors[k]}` }), t.kinds[k], h("b", {}, ` ${r.kinds[k]}`), h("small", {}, ` ${((100 * r.kinds[k]) / total).toFixed(0)}%`)))));
  };

  const weightsChart = (r) => {
    const w = r.stats && r.stats.positions ? r.stats.positions[0] : null;
    if (!w) return null;
    const max = Math.max(...w, 1e-9);
    const order = [...w.keys()].sort((a, b) => w[b] - w[a]);
    return h("div", { class: "weights" }, w.map((v, i) => h("div", { class: `wcol${order[0] === i ? " best" : ""}` },
      h("b", {}, v.toFixed(3)),
      h("span", { class: "wbar" }, h("span", { style: `height:${(100 * v) / max}%` })),
      h("span", { class: "wpos" }, `#${i + 1}`),
      h("small", {}, `${order.indexOf(i) + 1}${S.lang.startsWith("zh") ? " 强" : ""}`))));
  };

  const openChart = (scoreId) => { S.chart = scoreId; renderDrawer(); save(); };
  const closeChart = () => { S.chart = null; renderDrawer(); save(); };
  const renderDrawer = () => {
    const r = S.chart && byScore.get(S.chart);
    if (!r) { drawer.classList.remove("open"); drawer.replaceChildren(); document.body.classList.remove("locked"); return; }
    const t = u();
    const siblings = rows.filter((x) => x.musicId === r.musicId);
    const e = eff(r);
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("span", {}, k), h("b", {}, v), sub ? h("small", {}, sub) : null);
    const c = r.chart;
    const panel = h("div", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": title(r) },
      h("div", { class: "d-hero", style: `--band:${bandColor(r)}` },
        r.song.jacket ? h("div", { class: "d-bg", style: `background-image:url("${new URL(`jackets/${r.song.jacket}.webp`, site).href}")` }) : null,
        jacket(r, "jk xl"),
        h("div", { class: "d-title" },
          h("div", { class: "d-band" }, h("i", { style: `background:${bandColor(r)}` }), bandName(r)),
          h("h2", {}, title(r)),
          h("div", { class: "d-diffs" }, siblings.map((x) => h("button", { class: `lv-tab ${x.difficulty}${x === r ? " on" : ""}`, onclick: () => openChart(x.scoreId) },
            h("span", {}, t.diff[x.difficulty]), h("b", {}, lv(x))))),
          moeLink(r, t.moenotes)),
        h("button", { class: "d-close", "aria-label": t.detail.close, onclick: closeChart }, "✕")),
      h("div", { class: "d-body" },
        h("div", { class: "tiles" },
          tile(t.detail.notes, fmtInt(r.notes), `${t.detail.fullCombo} ${fmtInt(c.fullComboCount)}`),
          tile(t.detail.density, `${fmt(r.density)} N/s`, `${t.detail.span} ${formatLength((c.lastJudgedNoteMs || 0) - (c.firstNoteMs || 0))}`),
          tile(t.detail.bpm, String(r.bpm ?? "–"), r.bpmMin !== r.bpmMax ? `${r.bpmMin}–${r.bpmMax} · ${t.detail.bpmChanges(r.bpmChanges - 1)}` : ""),
          tile(t.detail.bgm, formatLength(r.bgmMs), `${t.detail.musicLength} ${formatLength(r.chartMs)}`),
          r.weights ? tile(t.col.rate, fmt(e.rate, 3), `${t.col.base} ${fmt(r.base, 3)} · ${t.col.skip} ${fmt(r.skip, 3)}`) : null,
          r.weights ? tile(t.col.perMinute, fmt(e.perMinute, 3), `${t.length} ${t[S.len]} + ${S.overhead} s`) : null),
        h("h3", {}, t.detail.timeline), h("div", { class: "tl-scroll" }, timeline(r)),
        h("div", { class: "grid2" },
          h("section", {}, h("h3", {}, t.detail.composition), composition(r)),
          r.weights ? h("section", {}, h("h3", {}, t.detail.weights), weightsChart(r), h("p", { class: "hint" }, t.detail.weightsHint)) : null),
        h("p", { class: "ids" }, `${t.detail.musicId} ${r.musicId} · ${t.detail.scoreId} ${r.scoreId} · ${t.detail.musicType} ${r.song.musicType}`)));
    drawer.replaceChildren(panel);
    drawer.classList.add("open");
    document.body.classList.add("locked");
  };

  // ------------------------------------------------------------ render
  const renderMain = () => {
    if (S.view === "rank") renderRank();
    else if (S.view === "charts") renderCharts();
    else renderGuide();
  };
  const renderFoot = () => {
    const p = songs.provenance || {};
    const m = p.master || {};
    put(foot, h("span", {}, u().source(p.region ?? "?", m.version ?? "?")),
      moeBase ? h("span", {}, h("a", { href: moeBase, target: "_blank", rel: "noopener" }, "moenotes ↗"), ` · ${u().moenotesHint}`) : null);
  };
  const renderAll = () => { renderHeader(); renderFilters(); renderMain(); renderFoot(); renderDrawer(); save(); };
  renderAll();
};

main().catch((e) => {
  console.error(e);
  document.querySelector(".boot")?.remove();
  document.body.append(h("div", { class: "boot error" }, `error: ${e && e.message ? e.message : e}`));
});
