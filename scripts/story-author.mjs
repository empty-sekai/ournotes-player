#!/usr/bin/env node
// Story author (experimental): write dialogue stories as JSON scripts with the stages, music, story UI and Live2D
// models of a story site, check them, look at them as the story player draws them, and build them into the site. Made
// for programs and agents: every command prints one JSON object on stdout (progress on stderr), and the pictures are
// PNG files whose paths the JSON names. docs/story-author.md describes the commands and the script format.
//
//   node scripts/story-author.mjs <command> [arguments] [--site <dir>] [options]
//     bases   [--search <text>] [--limit <n>]           the stories of the site a script can take its scene from
//     base    <manifest> [--lang <l>] [--out <dir>]     a base story's stages, music, languages and characters;
//                                                       --out: stages.png, the stages' background pictures
//     models  [--search <text>]                         the site's Live2D models
//     model   <id> [--out <dir>]                        a model's motions and expressions; --out: <id>-expressions.png
//                                                       and <id>-motions.png, the model showing each
//     new     <manifest> [--lang <l>]                   a starter script on that base story (the script itself)
//     check   <script> [--fix <file>]                   the script's errors and warnings, each with its JSON pointer
//                                                       and, where one is known, its fix (JSON Patch operations)
//     render  <script> --out <dir> [--from <line>] [--to <line>] [--width <px>] [--settle <frames>] [--fix <file>]
//                                                       plays the script in the story player and saves a picture of
//                                                       each line once its text is shown (line-<n>.png) and contact
//                                                       sheets of them (sheet.png); a line that overflows the talk
//                                                       window comes with a fix that breaks or splits it
//     build   <script> --name <name>                    writes the story into the site: custom-stories/<name>.json
//                                                       and its assets under assets/
//     serve   [--port <n>]                              serves the package and the site on 127.0.0.1 to watch the
//                                                       built stories in examples/story; runs until stopped
//   --site <dir>       the story site (default: the OURNOTES_SITE environment variable)
//   --chrome <path>    the browser for pictures (default: CHROME_PATH, else an installed Chrome, Chromium or Edge)
//   --gpu              draw with the GPU (default: SwiftShader, the same pictures on every machine)
//   --core <url|file>  Live2D Cubism Core (default: Live2D's distribution)
//   --timeout <s>      give up a picture job after this long (default 600)
//   --fix <file>       check, render: write the script with every fix applied to <file> (it may be the script)
// Exit status: 0 done, 1 the script has errors or the job failed (the JSON says why: {"ok": false, ...}), 2 usage.
import fs from "node:fs";
import path from "node:path";
import { Browser, findBrowser } from "./lib/story-author/chrome.js";
import {
  FONT_PRESETS, SCRIPT_FORMAT, applyFixes, checkScript, compileScript, fontFamily, layoutFix, motionStems,
  parseScript, scriptTexts,
} from "./lib/story-author/script.js";
import { CUBISM_CORE_URL, startServer } from "./lib/story-author/server.js";
import { Site, SiteError } from "./lib/story-author/site.js";

class UsageError extends Error {}

const VALUE_OPTIONS = new Set(["site", "lang", "out", "from", "to", "width", "settle", "name", "search", "limit", "chrome",
                               "core", "timeout", "port", "columns", "fix"]);
const FLAG_OPTIONS = new Set(["gpu", "help"]);

const parseArgs = (argv) => {
  const args = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (FLAG_OPTIONS.has(k)) { opts[k] = true; continue; }
    if (!VALUE_OPTIONS.has(k)) throw new UsageError(`unknown option --${k}`);
    const v = inline !== undefined ? inline : argv[++i];
    if (v === undefined) throw new UsageError(`--${k} needs a value`);
    opts[k] = v;
  }
  return { args, opts };
};

const int = (opts, k, def, min = 0) => {
  if (opts[k] === undefined) return def;
  const n = Number(opts[k]);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${k} must be a whole number of at least ${min}`);
  return n;
};

const log = (...a) => process.stderr.write(`[story-author] ${a.join(" ")}\n`);

// JSON with every array or object that fits in `width` columns on one line
const pretty = (v, indent = "", width = 110) => {
  const flat = JSON.stringify(v);
  if (flat === undefined || v === null || typeof v !== "object" || flat.length + indent.length <= width) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner, width)).join(",\n")}\n${indent}]`;
  const items = Object.entries(v).filter(([, x]) => x !== undefined);
  return `{\n${items.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner, width)}`).join(",\n")}\n${indent}}`;
};

const openSite = (opts) => {
  const dir = opts.site || process.env.OURNOTES_SITE;
  if (!dir) throw new UsageError("no site: pass --site <dir> or set OURNOTES_SITE");
  return new Site(dir);
};

const outDir = (opts, required = false) => {
  if (!opts.out) { if (required) throw new UsageError("--out <dir> is required"); return null; }
  const d = path.resolve(opts.out);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const matches = (q, ...values) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return values.some((v) => v !== undefined && v !== null && JSON.stringify(v).toLowerCase().includes(s));
};

// ------------------------------------------------------------------------------------------------ pictures

// runs one page job (page.js) in a browser of its own, with `files` served over the site; pictures go to `out`
const pictures = async (site, opts, out, files, job) => {
  const server = await startServer({ site: site.dir, core: opts.core || CUBISM_CORE_URL, out, files });
  let browser = null;
  try {
    browser = await Browser.launch({ executable: findBrowser(opts.chrome), gpu: !!opts.gpu,
                                     onConsole: (type, text) => (type === "log" || type === "error" ? log(text) : null) });
    await browser.navigate(`${server.url}/page.html`);
    await browser.evaluate("new Promise((r, j) => { const t0 = Date.now(); const f = () => globalThis.Live2DCubismCore ? r() : " +
                           "Date.now() - t0 > 30000 ? j(new Error('Live2D Cubism Core did not load')) : setTimeout(f, 50); f(); })");
    return await browser.evaluate(`import("/scripts/lib/story-author/page.js").then((m) => m.run(${JSON.stringify(job)}))`,
                                  int(opts, "timeout", 600, 1));
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
};

// ------------------------------------------------------------------------------------------------ scripts

const readScript = (file) => {
  if (!file) throw new UsageError("no script file");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { throw new UsageError(`${file}: ${e.message}`); }
  try { return JSON.parse(text); } catch (e) {
    return { parseError: { path: "", code: "json", message: `${file} is not JSON: ${e.message}` } };
  }
};

// a script checked against its site: {ok, doc, script, language, errors, warnings, base, models, actions} (doc: the
// document as read)
const loadScript = async (site, file) => {
  const doc = readScript(file);
  if (doc.parseError) return { ok: false, errors: [doc.parseError], warnings: [] };
  const { script, errors } = parseScript(doc);
  if (!script) return { ok: false, doc, errors, warnings: [] };
  let base = null;
  if (script.base) {
    try {
      const languages = Object.keys(site.json(script.base).languages || {});
      base = await site.base(script.base, languages.includes(script.language) ? script.language : null);
    } catch (e) {
      if (!(e instanceof SiteError)) throw e;
      errors.push({ path: "/base", code: "unknownBase", message: e.message });
    }
  }
  if (!base) return { ok: false, doc, script, errors, warnings: [] };
  const models = site.models().map((m) => m.id), keys = Object.fromEntries(site.models().map((m) => [m.id, m.key]));
  const actions = {};
  for (const c of script.cast) if (models.includes(c.model) && !actions[c.model]) actions[c.model] = (await site.model(c.model)).actions;
  const checked = checkScript(script, { base, models, actions });
  const all = [...errors, ...checked.errors];
  return { ok: all.length === 0, doc, script, language: checked.language, errors: all, warnings: checked.warnings, base,
           models: keys, actions };
};

// --fix <file>: the script document with the fixes of `problems` applied, written to <file> and checked again ->
// {file, applied, failed, ok, errors, warnings}: the fixes applied and the ones that failed, and how the written
// script checks (its error and warning counts)
const writeFixed = async (site, opts, doc, problems) => {
  if (!doc) throw new UsageError("--fix: the script is not JSON, so it cannot be fixed");
  const { script, applied, failed } = applyFixes(doc, problems);
  const file = path.resolve(opts.fix);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${pretty(script)}\n`);
  const c = await loadScript(site, file);
  return { file, applied, failed, ok: c.ok, errors: c.errors.length, warnings: c.warnings.length };
};

const compileChecked = (c) => compileScript(c.script, { base: c.base, models: c.models, actions: c.actions }, c.language);

const familyOf = (c) => fontFamily(c.script.font, c.language);

// ------------------------------------------------------------------------------------------------ commands

const commands = {
  async bases({ args, opts }) {
    const site = openSite(opts), limit = int(opts, "limit", 50, 1);
    const found = site.stories().filter((s) => matches(opts.search, s.id, s.manifest, s.asset, s.sheetName, s.titles, s.groups));
    const lang = opts.lang;
    return { count: found.length, bases: found.slice(0, limit).map((s) => ({
      manifest: s.manifest, title: (s.titles && (s.titles[lang] || s.titles[s.language])) || "", languages: s.languages,
      groups: (s.groups || []).map((g) => (g.chapter && g.chapter.names && (g.chapter.names[lang] || g.chapter.names[s.language])) || g.kind),
    })), ...(found.length > limit ? { more: found.length - limit } : {}) };
  },

  async base({ args, opts }) {
    const site = openSite(opts);
    if (!args[0]) throw new UsageError("base <manifest>: the path of a story manifest in the site");
    const b = await site.base(args[0], opts.lang || null), out = outDir(opts);
    const res = { manifest: b.path, language: b.language, languages: b.languages,
                  stages: b.stages.map((s) => ({ id: s.id, caption: s.caption })),
                  music: b.music.map((m) => ({ cue: m.cue, label: m.label })),
                  cast: b.cast, fonts: FONT_PRESETS };
    if (out) {
      const bytes = await site.baseFiles(b, b.stages.map((s) => s.background).filter(Boolean));
      const files = new Map(), stages = [];
      b.stages.forEach((s, i) => {
        const name = `.story-author/stage-${i}.png`;
        if (s.background && bytes.has(s.background)) files.set(name, bytes.get(s.background));
        stages.push({ id: s.id, caption: s.caption, url: files.has(name) ? `/site/${name}` : null });
      });
      log(`drawing ${stages.length} stages`);
      const r = await pictures(site, opts, out, files, { kind: "stages", stages, cellWidth: 360, columns: 3 });
      res.sheets = r.sheets.map((f) => path.join(out, f));
    }
    return res;
  },

  async models({ opts }) {
    const site = openSite(opts);
    const found = site.models().filter((m) => matches(opts.search, m.id, m.group, m.character, m.names, m.label));
    return { count: found.length, models: found.map((m) => ({ id: m.id, group: m.group,
      ...(m.character !== undefined ? { character: m.character } : {}), ...(m.names ? { names: m.names } : {}),
      ...(m.label ? { label: m.label } : {}) })) };
  },

  async model({ args, opts }) {
    const site = openSite(opts);
    if (!args[0]) throw new UsageError("model <id>: a model id of models.json");
    const m = await site.model(args[0]), a = m.actions, out = outDir(opts);
    const byName = (x, y) => x.localeCompare(y, "en", { numeric: true });
    const motions = motionStems(a.motions).sort(byName).map((stem) => ({ stem,
      sides: "LCR".split("").filter((d) => a.motions.includes(`${stem}_${d}`)).join("") }));
    const res = { id: m.entry.id, motions, expressions: [...a.expressions].sort(byName), defaultMotion: a.defaultMotion,
                  defaultExpression: a.defaultExpression };
    if (out) {
      const clip = (stem) => [`${stem}_C`, stem, `${stem}_L`, `${stem}_R`].find((n) => a.motions.includes(n));
      log(`drawing ${a.expressions.length} expressions and ${motions.length} motions`);
      const r = await pictures(site, opts, out, new Map(), {
        kind: "model", id: m.entry.id, manifest: `/site/${m.entry.manifest}`, expressions: res.expressions,
        motions: motions.map((x) => ({ stem: x.stem, clip: clip(x.stem) })), width: 1000, height: 1500,
        face: { crop: [0.335, 0.13, 0.35, 0.25], cellWidth: 180, columns: 8 },
        body: { crop: [0.2, 0.08, 0.6, 0.5], cellWidth: 200, columns: 6 }, settle: 12, motionAt: 0.8,
      });
      res.sheets = [...r.expressions, ...r.motions].map((f) => path.join(out, f));
    }
    return res;
  },

  async new({ args, opts }) {
    const site = openSite(opts);
    if (!args[0]) throw new UsageError("new <manifest>: the base story's manifest path");
    const b = await site.base(args[0], opts.lang || null);
    const entries = new Map(site.models().map((m) => [m.id, m]));
    const cast = {};
    for (const id of b.cast.filter((x) => entries.has(x)).slice(0, 2)) {
      const e = entries.get(id);
      let key = (/^adv_live2d_([a-z]+)_/.exec(id) || [])[1] || `c${Object.keys(cast).length + 1}`;
      while (cast[key]) key += "_2";
      cast[key] = { model: id, name: (e.names && e.names[b.language]) || e.label || key };
    }
    const [a, c] = Object.keys(cast), place = ["left", "right"];
    const positions = Object.fromEntries(Object.keys(cast).map((k, i) => [k, place[i]]));
    return {
      format: SCRIPT_FORMAT, base: b.path, language: b.language, title: "", font: "sans", cast,
      beats: [
        { scene: b.stages.length ? b.stages[0].id : "", camera: "middle", positions },
        ...(a ? [{ say: a, text: "..." }] : []), ...(c ? [{ say: c, text: "..." }] : []), { narrate: "..." },
      ],
    };
  },

  async check({ args, opts }) {
    const site = openSite(opts), c = await loadScript(site, args[0]);
    const res = { ok: c.ok, language: c.language, errors: c.errors, warnings: c.warnings };
    if (c.ok) {
      const k = compileChecked(c);
      Object.assign(res, { lines: k.lines.length, scenes: k.scenes, font: familyOf(c) });
    }
    if (opts.fix) res.fixed = await writeFixed(site, opts, c.doc, [...c.errors, ...c.warnings]);
    return res;
  },

  async render({ args, opts }) {
    const site = openSite(opts), out = outDir(opts, true);
    const c = await loadScript(site, args[0]);
    if (!c.ok) return { ok: false, errors: c.errors, warnings: c.warnings };
    const k = compileChecked(c);
    if (!k.lines.length) return { ok: false, errors: [{ path: "/beats", code: "noLines", message: "the script has no line to show" }], warnings: c.warnings };
    const last = k.lines.length - 1;
    const from = int(opts, "from", 0), to = Math.min(int(opts, "to", last), last);
    if (from > to) throw new UsageError(`--from ${from} is after the last line ${to}`);
    const width = int(opts, "width", 1300, 320), height = Math.round(width * 6 / 13);
    const family = familyOf(c);
    const { manifest, assets } = await site.compose(c.base, k, { language: c.language, family, title: c.script.title });
    const files = new Map([[".story-author/story.json", JSON.stringify(manifest)], ...assets]);
    for (const f of fs.readdirSync(out)) if (/^(line-\d+|sheet(-\d+)?)\.png$/.test(f)) fs.rmSync(path.join(out, f));
    log(`rendering lines ${from}..${to} of ${k.lines.length}`);
    const r = await pictures(site, opts, out, files, {
      kind: "story", manifest: "/site/.story-author/story.json", lang: c.language, family, sample: scriptTexts(c.script),
      width, height, quality: 4, from, to, settle: int(opts, "settle", 8), maxSeconds: 60,
      lines: k.lines.map((l) => ({ line: l.line, title: l.name || "(narration)", detail: l.text.replace(/\s+/g, " ") })),
      columns: int(opts, "columns", 3, 1), cellWidth: 420,
    });
    const byLine = new Map(k.lines.map((l) => [l.line, l]));
    const warnings = [...c.warnings];
    const frames = r.frames.map((f) => {
      const l = byLine.get(f.line), t = f.talk;
      // a line that overflows has one fix (its text broken where the game wraps it, and spread over beats after it
      // where the window holds fewer lines), on its first warning
      let fix = f.wrap ? layoutFix({ beat: c.doc.beats[l.beat], index: l.beat, wrap: f.wrap, heightLimit: t.heightLimit }) : null;
      const how = fix ? (fix.texts.length > 1 ? `; the fix spreads it over ${fix.texts.length} lines of the script`
                                               : "; the fix breaks it where the game wraps it") : "";
      const warn = (w) => {
        if (fix) { Object.assign(w, { suggestion: fix.texts, fix: fix.fix }); fix = null; }
        warnings.push(w);
      };
      if (t && t.width > t.widthLimit + 0.01)
        warn({ path: l.path, code: "textTooWide", message: `line ${f.line} runs past the talk window ` +
               `(${t.width} > ${t.widthLimit}): break it with "\\n" or shorten it${how}` });
      if (t && t.height > t.heightLimit + 0.01)
        warn({ path: l.path, code: "textTooTall", message: `line ${f.line} has ${t.lines} lines, taller than the ` +
               `talk window (${t.height} > ${t.heightLimit}): split it into two lines of the script${how}` });
      return { line: f.line, path: l.path, ...(l.id ? { id: l.id } : {}), speaker: l.speaker, text: l.text,
               image: path.join(out, f.file), talk: f.talk, timing: f.timing };
    });
    const res = { ok: true, out, sheets: r.sheets.map((f) => path.join(out, f)), frames, warnings, seconds: r.seconds };
    if (opts.fix) res.fixed = await writeFixed(site, opts, c.doc, warnings);
    return res;
  },

  async build({ args, opts }) {
    const site = openSite(opts);
    const name = opts.name;
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new UsageError("--name <name>: lowercase letters, digits, - and _");
    const c = await loadScript(site, args[0]);
    if (!c.ok) return { ok: false, errors: c.errors, warnings: c.warnings };
    const k = compileChecked(c);
    const { manifest, assets } = await site.compose(c.base, k, { language: c.language, family: familyOf(c), title: c.script.title });
    let added = 0;
    for (const [p, b] of assets) {
      const f = site.file(p);
      if (fs.existsSync(f)) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, b);
      added++;
    }
    const rel = `custom-stories/${name}.json`, file = site.file(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(manifest)}\n`);
    return { ok: true, manifest: rel, file, assetsAdded: added, lines: k.lines.length, warnings: c.warnings,
             play: `examples/story/index.html?src=<site URL>/${rel}` };
  },

  async serve({ opts }) {
    const site = openSite(opts);
    const server = await startServer({ site: site.dir, port: int(opts, "port", 0) });
    const dir = site.file("custom-stories");
    const stories = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
    process.stdout.write(`${pretty({ ok: true, url: server.url, stories: stories.map((f) =>
      `${server.url}/examples/story/index.html?src=/site/custom-stories/${encodeURIComponent(f)}`) })}\n`);
    log("serving; stop with Ctrl+C");
    await new Promise((r) => process.once("SIGINT", r));
    await server.close();
    return null;
  },
};

// the header above, without the comment marks
const HELP = (() => {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split(/\r?\n/).slice(1);
  return lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.slice(3)).join("\n");
})();

const main = async () => {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
  const [cmd, ...args] = parsed.args;
  if (!cmd || cmd === "help" || parsed.opts.help) { process.stdout.write(`${HELP}\n`); return cmd || parsed.opts.help ? 0 : 2; }
  const f = commands[cmd];
  if (!f) { process.stderr.write(`unknown command ${cmd}; commands: ${Object.keys(commands).join(", ")}\n`); return 2; }
  try {
    const res = await f({ args, opts: parsed.opts });
    if (res === null) return 0;
    process.stdout.write(`${pretty(res)}\n`);
    return res.ok === false ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) { process.stderr.write(`${e.message}\n`); return 2; }
    process.stdout.write(`${pretty({ ok: false, error: e.message })}\n`);
    if (!(e instanceof SiteError)) process.stderr.write(`${e.stack}\n`);
    return 1;
  }
};

process.exitCode = await main();
