// Chart index page: without a chart in the query it lists charts.json (title, band, difficulty, level, notes,
// length; each row links to the chart); with ?music=<musicId>&difficulty=<difficulty> it plays
// charts/<musicId>_<difficulty>.json in a full-page <ournotes-player>.
// Served from the repository. On a site, import dist/ournotes-player.element.min.js instead.
import { formatTime } from "../../src/element.js";

const DIFFICULTIES = ["easy", "normal", "hard", "expert"];
const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "./", location.href);
const off = (v) => v === "off" || v === "0" || v === "false";

const message = (text) => {
  const m = document.createElement("div");
  m.className = "msg";
  m.textContent = text;
  document.body.append(m);
};

const play = (music, difficulty) => {
  if (!/^\d+$/.test(music) || !DIFFICULTIES.includes(difficulty)) throw new Error("unknown chart");
  document.body.className = "play";
  const el = document.createElement("ournotes-player");
  el.controls = true;
  if (q.has("autoplay")) el.autoplay = true;
  if (q.get("speed")) el.setAttribute("speed", q.get("speed"));
  if (off(q.get("music"))) el.music = false;
  if (off(q.get("se"))) el.se = false;
  el.addEventListener("ready", () => {
    const c = el.chart;
    if (c && c.title) document.title = `${c.title} ${difficulty.toUpperCase()}`;
    el.focus();                                              // keyboard controls without a first click
  });
  el.addEventListener("error", (e) => console.error(e.detail.error));
  el.setAttribute("src", new URL(`charts/${music}_${difficulty}.json`, site).href);
  document.body.append(el);
};

const list = async () => {
  document.body.className = "list";
  const r = await fetch(new URL("charts.json", site));
  if (!r.ok) throw new Error(`charts.json: HTTP ${r.status}`);
  const { charts } = await r.json();
  const t = document.createElement("table");
  t.className = "charts";
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
  const keep = q.get("site") ? `&site=${encodeURIComponent(q.get("site"))}` : "";
  for (const c of charts) {
    const a = document.createElement("a");
    a.href = `?music=${c.musicId}&difficulty=${c.difficulty}${keep}`;
    a.textContent = c.title || String(c.musicId);
    t.append(row([[a], [(c.bands || []).join(" / "), "band"], [c.difficulty], [String(c.displayLevel ?? c.level), "num"],
                  [String(c.notes), "num"], [formatTime(c.durationMs), "num"]]));
  }
  document.body.append(t);
};

(async () => {
  try {
    if (q.has("music") || q.has("difficulty")) play(String(q.get("music")), String(q.get("difficulty") || "expert"));
    else await list();
  } catch (e) {
    console.error(e);
    message(`error: ${e && e.message ? e.message : e}`);
  }
})();
