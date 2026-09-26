// Story index page: without a story in the query it lists stories.json (title, where the game lists the story, kind,
// rows, first download; each row links to the story); with ?story=<advId> it plays that story in <ournotes-story>. A
// site of several regions or languages (stories.json `regions`, `languages`) gets a region and a language switch:
// ?region=<id>&lang=<language> (default: the index's first region and its `language`); the language is also the
// story's. ?kind=<kind> lists the stories of one group kind.
// Served from the repository. On a site, import dist/ournotes-player.story.element.min.js instead.
import "../../src/story/define.js";
import { firstLoad, groupLabel, languagesFor, manifestFor, pickLanguage, pickRegion, queryString, storiesFor, storyKind,
  storyTitle } from "./listing.js";

const CORE = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const KINDS = { chapter: "Main and event stories", friendship: "Friendship stories", spotTalk: "Spot talks",
  liveResult: "Live results", spot: "Spots", other: "Other" };
const LANGUAGE_NAMES = { ja: "日本語", en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", ko: "한국어" };
const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "../", location.href);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const message = (text) => document.body.append(el("div", { className: "msg", textContent: text }));

const loadIndex = async () => {
  const r = await fetch(new URL("stories.json", site));
  if (!r.ok) throw new Error(`stories.json: HTTP ${r.status}`);
  return r.json();
};

// Live2D's files are loaded by the page (classic scripts defining Live2DCubismCore and Live2DCubismMotionSyncCore)
const loadScript = (src, name) => new Promise((resolve, reject) => {
  if (globalThis[name]) { resolve(); return; }
  const s = document.createElement("script");
  s.src = src;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error(`${name} could not be loaded from ${s.src}`));
  document.head.append(s);
});

const select = (label, options, value, onChange) => {
  const s = el("select", {}, ...options.map(([v, text]) => new Option(text, v)));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return el("label", {}, `${label} `, s);
};

const play = async (advId) => {
  if (!/^\d+$/.test(advId)) throw new Error("unknown story");
  const index = await loadIndex().catch(() => null);
  const region = index ? pickRegion(index, q.get("region")) : null;
  const manifest = index ? manifestFor(index, advId, region) : `stories/${advId}.json`;
  document.body.className = "play";
  const msg = el("span", { className: "msg" }), title = el("h1", { textContent: `#${advId}` }), pick = el("select");
  const back = el("a", { href: queryString({ site: q.get("site"), region: q.get("region"), lang: q.get("lang"), kind: q.get("kind") }) || location.pathname,
                         textContent: "Stories" });
  const story = el("ournotes-story"), line = el("div", { className: "line" });
  document.body.append(el("header", {}, back, title, el("label", {}, "Language ", pick), msg), el("main", {}, story), line);
  story.addEventListener("progress", (e) => { msg.textContent = `loading ${mb(e.detail.loaded)} / ${mb(e.detail.total)}`; });
  story.addEventListener("ready", () => {
    msg.textContent = "";
    const info = story.info || {};
    const t = info.story ? storyTitle(info.story, story.lang) : "";
    if (t) { title.textContent = t; document.title = t; }
    pick.replaceChildren(...story.languages.map((l) => new Option(LANGUAGE_NAMES[l] || l, l, false, l === story.lang)));
    pick.disabled = story.languages.length < 2;
    story.focus();
  });
  story.addEventListener("line", (e) => {
    const d = e.detail;
    line.textContent = `${d.index + 1} / ${d.lineCount}  ${d.speaker ? `${d.speaker}: ` : ""}${d.text}`;
  });
  story.addEventListener("ended", (e) => { msg.textContent = e.detail.reason === 1 ? "skipped" : "ended"; });
  story.addEventListener("error", (e) => {
    console.error(e.detail.error);
    msg.textContent = `error: ${e.detail.error && e.detail.error.message ? e.detail.error.message : e.detail.error}`;
  });
  pick.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("lang", pick.value);
    history.replaceState(null, "", url);
    story.lang = pick.value;
  });
  await loadScript(q.get("core") || CORE, "Live2DCubismCore");
  if (q.get("motionsync")) await loadScript(q.get("motionsync"), "Live2DCubismMotionSyncCore");
  for (const a of ["lang", "line", "speed"]) if (q.get(a)) story.setAttribute(a, q.get(a));
  if (q.get("auto")) story.setAttribute("auto", q.get("auto"));
  story.src = new URL(manifest, site).href;
};

const list = async () => {
  document.body.className = "list";
  const index = await loadIndex();
  const view = el("div");
  document.body.append(view);
  const render = (wantRegion, wantLang, wantKind) => {
    const region = pickRegion(index, wantRegion);
    const lang = pickLanguage(index, region, wantLang);
    const all = storiesFor(index, region);
    const kinds = Object.keys(KINDS).filter((k) => all.some((s) => storyKind(s) === k));
    const kind = kinds.includes(wantKind) ? wantKind : null;
    const keep = { site: q.get("site"), region: wantRegion && region, lang: wantLang && lang, kind };
    history.replaceState(null, "", queryString(keep) || location.pathname);
    view.replaceChildren();
    const regions = Array.isArray(index.regions) ? index.regions : [];
    const langs = languagesFor(index, region);
    const bar = el("div", { className: "switch" });
    if (regions.length > 1) bar.append(select("Region", regions.map((r) => [r.id, r.name || r.id]), region, (v) => render(v, lang, kind)));
    if (langs.length > 1) bar.append(select("Language", langs.map((l) => [l, LANGUAGE_NAMES[l] || l]), lang, (v) => render(region, v, kind)));
    if (kinds.length > 1) bar.append(select("Kind", [["", "All"], ...kinds.map((k) => [k, KINDS[k]])], kind || "", (v) => render(region, lang, v || null)));
    view.append(bar);
    const t = el("table", { className: "stories" });
    if (lang) t.lang = lang;
    const row = (cells, head) => el("tr", {}, ...cells.map(([c, cls]) => {
      const td = el(head ? "th" : "td");
      if (cls) td.className = cls;
      td.append(c);
      return td;
    }));
    t.append(row([["Title"], ["Where", "where"], ["Kind"], ["Rows"], ["First load"]], true));
    for (const s of all) {
      if (kind && storyKind(s) !== kind) continue;
      const a = el("a", { href: queryString({ ...keep, story: s.advId, region: region, lang }), textContent: storyTitle(s, lang) });
      t.append(row([[a], [groupLabel(s, lang), "where"], [KINDS[storyKind(s)]], [String(s.commandCount), "num"], [mb(firstLoad(s, lang)), "num"]]));
    }
    view.append(t);
  };
  render(q.get("region"), q.get("lang"), q.get("kind"));
};

(async () => {
  try {
    if (q.has("story")) await play(String(q.get("story")));
    else await list();
  } catch (e) {
    console.error(e);
    message(`error: ${e && e.message ? e.message : e}`);
  }
})();
