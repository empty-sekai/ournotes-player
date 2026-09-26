// Story page: plays one story manifest in <ournotes-story>. ?story=<advId> plays stories/<advId>.json of the site,
// ?src=<URL> another manifest; ?site=<URL> names the site root (default: the parent directory of this page). ?lang=,
// ?line=, ?auto=1 and ?speed= are passed to the element. Live2D Cubism Core is loaded from Live2D's distribution unless
// ?core=<URL> names another copy; the MotionSync Core (the voices' lip sync) from ?motionsync=<URL> when given.
// Served from the repository. On a site, import dist/ournotes-player.story.element.min.js instead.
import "../../src/story/define.js";

const CORE = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "../", location.href);
const $ = (id) => document.getElementById(id);
const story = $("story"), pick = $("lang");

const message = (text) => { $("msg").textContent = text; };
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// Live2D's files are loaded by the page (classic scripts defining Live2DCubismCore and Live2DCubismMotionSyncCore)
const loadScript = (src, name) => new Promise((resolve, reject) => {
  if (globalThis[name]) { resolve(); return; }
  const s = document.createElement("script");
  s.src = src;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error(`${name} could not be loaded from ${s.src}`));
  document.head.append(s);
});

const LANGUAGE_NAMES = { ja: "日本語", en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", ko: "한국어" };

story.addEventListener("progress", (e) => message(`loading ${mb(e.detail.loaded)} / ${mb(e.detail.total)}`));
story.addEventListener("ready", () => {
  message("");
  const info = story.info || {}, titles = (info.story && info.story.titles) || {};
  const title = titles[story.lang] || Object.values(titles)[0];
  if (title) { $("title").textContent = title; document.title = title; }
  pick.replaceChildren(...story.languages.map((l) => new Option(LANGUAGE_NAMES[l] || l, l, false, l === story.lang)));
  pick.disabled = story.languages.length < 2;
});
story.addEventListener("line", (e) => {
  const d = e.detail;
  $("line").textContent = `${d.index + 1} / ${d.lineCount}  ${d.speaker ? `${d.speaker}: ` : ""}${d.text}`;
});
story.addEventListener("ended", (e) => message(e.detail.reason === 1 ? "skipped" : "ended"));
story.addEventListener("error", (e) => {
  console.error(e.detail.error);
  message(`error: ${e.detail.error && e.detail.error.message ? e.detail.error.message : e.detail.error}`);
});
pick.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("lang", pick.value);
  history.replaceState(null, "", url);
  story.lang = pick.value;
});

(async () => {
  try {
    await loadScript(q.get("core") || CORE, "Live2DCubismCore");
    if (q.get("motionsync")) await loadScript(q.get("motionsync"), "Live2DCubismMotionSyncCore");
  } catch (e) { message(e.message); return; }
  const src = q.get("src") || (q.get("story") ? new URL(`stories/${q.get("story")}.json`, site).href : "");
  if (!src) { message("no story: pass ?story=<advId> or ?src=<manifest URL>"); return; }
  for (const a of ["lang", "line", "speed"]) if (q.get(a)) story.setAttribute(a, q.get(a));
  if (q.get("auto")) story.setAttribute("auto", q.get("auto"));
  story.src = new URL(src, location.href).href;
})();
