// Chart index page: without a chart in the query it lists charts.json (title, band, difficulty, level, notes,
// length; each row links to the chart); with ?music=<musicId>&difficulty=<difficulty> it plays that chart in a
// full-page <ournotes-player>. A site of several regions or languages (charts.json `regions`, `languages`) gets a
// region and a language switch: ?region=<id>&lang=<language> (default: the index's first region and its `language`).
// Served from the repository. On a site, import dist/ournotes-player.element.min.js instead.
import { formatTime } from "../../src/element.js";
import { chartText, chartsFor, languagesFor, manifestFor, pickLanguage, pickRegion, queryString } from "./listing.js";

const DIFFICULTIES = ["easy", "normal", "hard", "expert"];
const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "./", location.href);
const off = (v) => v === "off" || v === "0" || v === "false";
// `music` carries both the chart's music id and the music switch (music=off): digits are the id
const musicId = q.getAll("music").find((v) => /^\d+$/.test(v));
const musicOff = q.getAll("music").some(off);

const message = (text) => {
  const m = document.createElement("div");
  m.className = "msg";
  m.textContent = text;
  document.body.append(m);
};

const loadIndex = async () => {
  const r = await fetch(new URL("charts.json", site));
  if (!r.ok) throw new Error(`charts.json: HTTP ${r.status}`);
  return r.json();
};

const play = async (music, difficulty) => {
  if (!/^\d+$/.test(music) || !DIFFICULTIES.includes(difficulty)) throw new Error("unknown chart");
  let manifest = `charts/${music}_${difficulty}.json`;
  if (q.has("region")) {                                     // a region's own manifest, when it has one
    const index = await loadIndex().catch(() => null);
    if (index) manifest = manifestFor(index, music, difficulty, pickRegion(index, q.get("region")));
  }
  document.body.className = "play";
  const el = document.createElement("ournotes-player");
  el.controls = true;
  if (q.has("autoplay")) el.autoplay = true;
  if (q.get("speed")) el.setAttribute("speed", q.get("speed"));
  if (musicOff) el.music = false;
  if (off(q.get("se"))) el.se = false;
  el.addEventListener("ready", () => {
    const c = el.chart;
    const title = c && chartText(c, q.get("lang")).title;
    if (title) document.title = `${title} ${difficulty.toUpperCase()}`;
    el.focus();                                              // keyboard controls without a first click
  });
  el.addEventListener("error", (e) => console.error(e.detail.error));
  el.setAttribute("src", new URL(manifest, site).href);
  document.body.append(el);
};

const select = (label, options, value, onChange) => {
  const l = document.createElement("label");
  l.append(`${label} `);
  const s = document.createElement("select");
  for (const [v, text] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    s.append(o);
  }
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  l.append(s);
  return l;
};

const list = async () => {
  document.body.className = "list";
  const index = await loadIndex();
  const view = document.createElement("div");
  document.body.append(view);
  const render = (wantRegion, wantLang) => {
    const region = pickRegion(index, wantRegion);
    const lang = pickLanguage(index, region, wantLang);
    const keep = { site: q.get("site"), region, lang };
    history.replaceState(null, "", queryString({ site: keep.site, region: wantRegion && region, lang: wantLang && lang }) || location.pathname);
    view.replaceChildren();
    const regions = Array.isArray(index.regions) ? index.regions : [];
    const langs = languagesFor(index, region);
    if (regions.length > 1 || langs.length > 1) {
      const bar = document.createElement("div");
      bar.className = "switch";
      if (regions.length > 1) bar.append(select("Region", regions.map((r) => [r.id, r.name || r.id]), region, (v) => render(v, lang)));
      if (langs.length > 1) bar.append(select("Language", langs.map((l) => [l, l]), lang, (v) => render(region, v)));
      view.append(bar);
    }
    const t = document.createElement("table");
    t.className = "charts";
    if (lang) t.lang = lang;
    const row = (cells, head) => {
      const tr = document.createElement("tr");
      for (const [c, cls] of cells) {
        const td = document.createElement(head ? "th" : "td");
        if (cls) td.className = cls;
        if (c instanceof Node) td.append(c); else td.textContent = c;
        tr.append(td);
      }
      return tr;
    };
    t.append(row([["Title"], ["Band", "band"], ["Difficulty"], ["Level"], ["Notes"], ["Length"]], true));
    for (const c of chartsFor(index, region)) {
      const { title, bands } = chartText(c, lang);
      const a = document.createElement("a");
      a.href = queryString({ music: c.musicId, difficulty: c.difficulty, ...keep });
      a.textContent = title;
      t.append(row([[a], [bands.join(" / "), "band"], [c.difficulty], [String(c.displayLevel ?? c.level), "num"],
                    [String(c.notes), "num"], [formatTime(c.durationMs), "num"]]));
    }
    view.append(t);
  };
  render(q.get("region"), q.get("lang"));
};

(async () => {
  try {
    if (musicId !== undefined || q.has("difficulty")) await play(String(musicId), String(q.get("difficulty") || "expert"));
    else await list();
  } catch (e) {
    console.error(e);
    message(`error: ${e && e.message ? e.message : e}`);
  }
})();
