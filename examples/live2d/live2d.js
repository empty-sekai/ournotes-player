// Model index page: lists the site's models.json (grouped by `group`), shows the chosen model in <ournotes-live2d> and
// offers its motions and expressions. ?model=<id> opens a model, ?site=<URL> names the site root (default: the parent
// directory of this page), ?core=<URL> loads Live2D Cubism Core from another place than Live2D's distribution, ?lang=
// picks the language of the character names where models.json has them (listing.js).
// Served from the repository. On a site, import dist/ournotes-player.live2d.element.min.js instead.
import "../../src/live2d/define.js";
import { modelText } from "./listing.js";

const CORE = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const q = new URLSearchParams(location.search);
const site = new URL(q.get("site") || "../", location.href);
const $ = (id) => document.getElementById(id);
const viewer = $("viewer"), pick = $("model"), motion = $("motion"), expression = $("expression");

const message = (text) => { $("msg").textContent = text; };
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// Live2D Cubism Core is Live2D's own file, loaded by the page (a classic script defining Live2DCubismCore)
const loadCore = () => new Promise((resolve, reject) => {
  if (globalThis.Live2DCubismCore) { resolve(); return; }
  const s = document.createElement("script");
  s.src = q.get("core") || CORE;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error(`Live2D Cubism Core could not be loaded from ${s.src}`));
  document.head.append(s);
});

const fill = (select, names, current) => {
  select.replaceChildren(...names.map((n) => new Option(n, n, false, n === current)));
  select.disabled = !names.length;
};

const status = () => {
  const p = viewer.player;
  $("status").textContent = p ? `${p.name}\nmotion ${p.motion}${p.motionPlaying ? " (playing)" : ""}\nexpression ${p.expression}` : "";
};

const open = (entry) => {
  message("loading…");
  motion.replaceChildren(); expression.replaceChildren();
  const url = new URL(location.href);
  url.searchParams.set("model", entry.id);
  history.replaceState(null, "", url);
  viewer.setAttribute("src", new URL(entry.manifest, site).href);
};

viewer.addEventListener("progress", (e) => message(`loading ${mb(e.detail.loaded)} / ${mb(e.detail.total)}`));
viewer.addEventListener("ready", () => {
  message("");
  fill(motion, viewer.motions, viewer.defaultMotion);
  fill(expression, viewer.expressions, viewer.defaultExpression);
  $("physics").disabled = !viewer.hasPhysics;
  status();
});
viewer.addEventListener("error", (e) => {
  console.error(e.detail.error);
  message(`error: ${e.detail.error && e.detail.error.message ? e.detail.error.message : e.detail.error}`);
});
const play = () => { if (motion.value) viewer.playMotion(motion.value, { loop: $("loop").checked }); };
motion.addEventListener("change", play);
$("replay").addEventListener("click", play);
expression.addEventListener("change", () => { if (expression.value) viewer.setExpression(expression.value); });
$("physics").addEventListener("change", (e) => { viewer.physics = e.target.checked; });
$("breath").addEventListener("change", (e) => { viewer.breath = e.target.checked; });
$("pause").addEventListener("click", (e) => {
  viewer.paused = !viewer.paused;
  e.target.textContent = viewer.paused ? "Play" : "Pause";
});
setInterval(status, 250);

(async () => {
  try {
    await loadCore();
    const r = await fetch(new URL("models.json", site));
    if (!r.ok) throw new Error(`models.json: HTTP ${r.status}`);
    const { models } = await r.json();
    if (!models || !models.length) throw new Error("models.json lists no models");
    const groups = new Map();
    for (const m of models) {
      const g = m.group || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    for (const [g, list] of groups) {
      const parent = g ? Object.assign(document.createElement("optgroup"), { label: g }) : pick;
      for (const m of list) parent.append(new Option(modelText(m, q.get("lang")), m.id));
      if (parent !== pick) pick.append(parent);
    }
    const first = models.find((m) => m.id === q.get("model")) || models[0];
    pick.value = first.id;
    pick.addEventListener("change", () => open(models.find((m) => m.id === pick.value)));
    open(first);
  } catch (e) {
    console.error(e);
    message(`error: ${e && e.message ? e.message : e}`);
  }
})();
