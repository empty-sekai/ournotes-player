#!/usr/bin/env node
// Checks that the package's public contracts agree with each other: what package.json, the modules, the type
// declarations, the schemas and the documents each say about the same thing.
//
//   node scripts/check-contracts.mjs          (npm run contract:check; dist/ must be built: npm run build)
//
//   package       main, module and types are the "." entry's; every `files` entry exists; every `exports` target and
//                 `sideEffects` pattern names files that exist, inside `files`
//   entries       each entry point's runtime exports (the module's ES exports, through every re-export) are the values
//                 its type declarations export, and the names its row of an entry points table in docs/ lists (a row
//                 that says "the same" lists the entry without /element)
//   schemas       each schema/*.json is a draft 2020-12 schema whose $id is its raw URL on the main branch, uses only
//                 the keywords the validator implements, is loaded by scripts/validate-data.mjs and named in docs/
//   formats       every ournotes.* format id the code, the types or the schemas name is in the documents, and every
//                 one the documents name is in the code or the schemas
//   links         every relative link of the Markdown files points at a file that exists and, with #fragment, at a
//                 heading of that file
//   story-author  the commands, options and problem codes of scripts/story-author.mjs are the ones its header and
//                 docs/story-author.md describe
//   workflows     the CI job runs the same commands as the release workflow's verification job, in the same order
// Prints each problem as "<contract>: <message>"; exit status 0 when there is none, 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";
import { compile } from "./lib/json-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const posix = (p) => p.split(path.sep).join("/");
const pkg = JSON.parse(read("package.json"));

// the files under `dir` (relative, "/"-separated), without node_modules, dist (unless asked) and dot directories
const walk = (dir, { dist = false } = {}) => {
  const out = [];
  const go = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules" || (e.name === "dist" && !dist && !rel)) continue;
        go(p);
      } else out.push(p);
    }
  };
  go(dir);
  return out;
};

const glob = (pattern) => new RegExp(`^${pattern.replace(/^\.\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
const inFiles = (rel) => pkg.files.some((f) => (f.endsWith("/") ? rel.startsWith(f) : rel === f));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const list = (s) => [...s].sort().join(", ") || "(none)";

// the package's entry points with a module of their own: [{name, specifier, types, module}]
const entryPoints = () => Object.entries(pkg.exports).filter(([k, v]) => !k.includes("*") && typeof v === "object")
  .map(([k, v]) => ({ name: k, specifier: k === "." ? pkg.name : `${pkg.name}/${k.slice(2)}`,
                      types: v.types.replace(/^\.\//, ""), module: v.default.replace(/^\.\//, "") }));

// ------------------------------------------------------------------------------------------------ package

const checkPackage = () => {
  const out = [], main = pkg.exports["."];
  for (const k of ["main", "module"]) if (pkg[k] !== main.default) out.push(`${k} ${pkg[k]} is not the "." entry's module ${main.default}`);
  if (pkg.types !== main.types) out.push(`types ${pkg.types} is not the "." entry's types ${main.types}`);
  for (const f of pkg.files) if (!exists(f)) out.push(`files: ${f} does not exist`);
  const all = walk("", { dist: true });
  for (const [k, v] of Object.entries(pkg.exports)) {
    for (const target of typeof v === "string" ? [v] : Object.values(v)) {
      const rel = target.replace(/^\.\//, "");
      if (rel.includes("*") ? !all.some((f) => glob(rel).test(f)) : !exists(rel)) out.push(`exports ${k}: ${target} names no file`);
      else if (!inFiles(rel.replace(/\*.*$/, "")) && rel !== "package.json") out.push(`exports ${k}: ${target} is not in files`);
    }
  }
  for (const p of pkg.sideEffects) {
    const matched = all.filter((f) => glob(p).test(f));
    if (!matched.length) out.push(`sideEffects: ${p} names no file${p.startsWith("./dist/") && !exists("dist") ? " (dist/ is not built)" : ""}`);
    else if (!matched.every(inFiles)) out.push(`sideEffects: ${p} names files that are not in files`);
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ entries

// the runtime exports of a module: the ES exports of its bundle, so re-exports count -> Set, or the bundler's first
// error when the module does not build
const runtimeExports = async (module) => {
  try {
    const r = await esbuild.build({ entryPoints: [path.join(root, module)], bundle: true, format: "esm", write: false,
                                    metafile: true, logLevel: "silent", outdir: path.join(root, ".contracts") });
    return new Set(Object.values(r.metafile.outputs).find((o) => o.entryPoint).exports);
  } catch (e) {
    const m = e.errors && e.errors[0];
    return m ? `${m.location ? `${m.location.file}:${m.location.line}: ` : ""}${m.text}` : e.message;
  }
};

// the values (not the types) each declaration file exports: file -> Set
const declaredValues = (files) => {
  const program = ts.createProgram(files.map((f) => path.join(root, f)), {
    noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] });
  const checker = program.getTypeChecker(), out = new Map();
  for (const f of files) {
    const sym = checker.getSymbolAtLocation(program.getSourceFile(path.join(root, f)));
    const value = (s) => ((s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s).flags & ts.SymbolFlags.Value) !== 0;
    out.set(f, new Set(sym ? checker.getExportsOfModule(sym).filter(value).map((s) => s.name) : []));
  }
  return out;
};

// the rows of the documents' entry points tables: specifier -> {file, names: Set | null ("the same")}
const documentedEntries = () => {
  const out = new Map(), problems = [];
  for (const f of walk("docs").filter((f) => f.endsWith(".md"))) {
    for (const line of read(f).split(/\r?\n/)) {
      const m = /^\| `([^`]+)`(?: \([^)]*\))? \| (.*) \|$/.exec(line);
      if (!m || !(m[1] === pkg.name || m[1].startsWith(`${pkg.name}/`))) continue;
      if (out.has(m[1])) { problems.push(`${m[1]} has two entry points rows (${out.get(m[1]).file}, ${f})`); continue; }
      const names = /^the same\b/.test(m[2]) ? null
        : new Set([...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x)));
      out.set(m[1], { file: f, names });
    }
  }
  return { rows: out, problems };
};

const checkEntries = async () => {
  const entries = entryPoints(), out = [];
  const declared = declaredValues([...new Set(entries.map((e) => e.types))]);
  const { rows, problems } = documentedEntries();
  out.push(...problems);
  for (const e of entries) {
    const runtime = await runtimeExports(e.module), values = declared.get(e.types);
    if (typeof runtime === "string") { out.push(`${e.specifier}: ${e.module} does not build: ${runtime}`); continue; }
    if (!sameSet(runtime, values)) {
      const extra = [...runtime].filter((x) => !values.has(x)), missing = [...values].filter((x) => !runtime.has(x));
      out.push(`${e.specifier}: ${e.module} and ${e.types} differ` + (extra.length ? `; not declared: ${list(extra)}` : "") +
               (missing.length ? `; declared but not exported: ${list(missing)}` : ""));
    }
    const row = rows.get(e.specifier);
    if (!row) { out.push(`${e.specifier}: no entry points row in docs/`); continue; }
    const base = row.names ? row : rows.get(e.specifier.replace(/\/element$/, ""));
    if (!base || !base.names) { out.push(`${e.specifier}: ${row.file} says "the same" with no entry to be the same as`); continue; }
    if (!sameSet(runtime, base.names)) {
      const extra = [...runtime].filter((x) => !base.names.has(x)), missing = [...base.names].filter((x) => !runtime.has(x));
      out.push(`${e.specifier}: ${base.file} lists other exports` + (extra.length ? `; not listed: ${list(extra)}` : "") +
               (missing.length ? `; listed but not exported: ${list(missing)}` : ""));
    }
  }
  for (const s of rows.keys()) if (!entries.some((e) => e.specifier === s)) out.push(`${rows.get(s).file}: ${s} is not an entry point`);
  return out;
};

// ------------------------------------------------------------------------------------------------ schemas

const SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const SCHEMA_BASE = `https://raw.githubusercontent.com/${pkg.repository.url.replace(/^git\+https:\/\/github\.com\/|\.git$/g, "")}/main/`;

const checkSchemas = () => {
  const out = [], validator = read("scripts/validate-data.mjs");
  const loaded = new Set([...validator.matchAll(/schema\("([\w-]+)"\)/g)].map((m) => `${m[1]}.schema.json`));
  const docs = walk("docs").filter((f) => f.endsWith(".md")).map(read).join("\n");
  for (const f of fs.readdirSync(path.join(root, "schema")).filter((f) => f.endsWith(".json")).sort()) {
    const rel = `schema/${f}`;
    let s;
    try { s = JSON.parse(read(rel)); } catch (e) { out.push(`${rel}: not JSON (${e.message})`); continue; }
    if (s.$schema !== SCHEMA_DIALECT) out.push(`${rel}: $schema is not ${SCHEMA_DIALECT}`);
    if (s.$id !== SCHEMA_BASE + rel) out.push(`${rel}: $id is not ${SCHEMA_BASE + rel}`);
    try { compile(s); } catch (e) { out.push(`${rel}: ${e.message}`); }
    if (!loaded.has(f)) out.push(`${rel}: scripts/validate-data.mjs does not load it`);
    if (!docs.includes(rel)) out.push(`${rel}: no document in docs/ names it`);
    for (const m of JSON.stringify(s).matchAll(/\bdocs\/[\w-]+\.md\b/g)) if (!exists(m[0])) out.push(`${rel}: ${m[0]} does not exist`);
  }
  for (const f of loaded) if (!exists(`schema/${f}`)) out.push(`scripts/validate-data.mjs loads schema/${f}, which does not exist`);
  return out;
};

// ------------------------------------------------------------------------------------------------ formats

const FORMAT_ID = /\bournotes\.[a-z][a-z0-9-]*\/\d+\b/g;

const checkFormats = () => {
  const ids = (files) => {
    const m = new Map();
    for (const f of files) for (const [id] of read(f).matchAll(FORMAT_ID)) if (!m.has(id)) m.set(id, f);
    return m;
  };
  const code = ids(["src", "scripts", "examples", "types", "schema"].flatMap((d) => walk(d))
    .filter((f) => /\.(m?js|d\.ts|json)$/.test(f)));
  const docs = ids(["README.md", "README.en.md", "CONTRIBUTING.md", ...walk("docs").filter((f) => f.endsWith(".md"))]);
  const out = [];
  for (const [id, f] of code) if (!docs.has(id)) out.push(`${id} (${f}) is in no document`);
  for (const [id, f] of docs) if (!code.has(id)) out.push(`${id} (${f}) is in no module, type declaration or schema`);
  return out;
};

// ------------------------------------------------------------------------------------------------ links

// GitHub's heading anchors: lowercase, punctuation removed (letters, marks, digits, spaces, "-" and "_" kept), spaces to
// "-"; a repeated heading gets -1, -2, ...
const anchors = (text) => {
  const out = new Set(), seen = new Map();
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const slug = m[1].toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    out.add(n ? `${slug}-${n}` : slug);
  }
  return out;
};

const checkLinks = () => {
  const out = [], files = walk("").filter((f) => f.endsWith(".md")), cache = new Map();
  const anchorsOf = (rel) => { if (!cache.has(rel)) cache.set(rel, anchors(read(rel))); return cache.get(rel); };
  for (const f of files) {
    let fence = false;
    read(f).split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) return;
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;                 // https:, mailto:, ...
        const [file, frag] = target.split("#");
        const rel = file ? posix(path.normalize(path.join(path.dirname(f), decodeURIComponent(file)))) : f;
        const where = `${f}:${i + 1}`;
        if (!exists(rel)) { out.push(`${where}: ${target} names no file`); continue; }
        if (frag !== undefined && rel.endsWith(".md") && !anchorsOf(rel).has(decodeURIComponent(frag)))
          out.push(`${where}: ${target} names no heading of ${rel}`);
      }
    });
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ story-author

const checkStoryAuthor = () => {
  const cli = read("scripts/story-author.mjs"), lib = read("scripts/lib/story-author/script.js");
  const doc = read("docs/story-author.md"), out = [];
  const header = cli.split(/\r?\n/).slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith("//"))).join("\n");
  const body = cli.slice(cli.indexOf("const commands = {"), cli.indexOf("\n};", cli.indexOf("const commands = {")));
  const commands = [...body.matchAll(/^ {2}async (\w+)\(/gm)].map((m) => m[1]);
  for (const c of commands) {
    if (!new RegExp(`^### ${c}$`, "m").test(doc)) out.push(`command ${c}: no "### ${c}" section in docs/story-author.md`);
    if (!new RegExp(`^// {5}${c}\\b`, "m").test(header)) out.push(`command ${c}: not in the header of scripts/story-author.mjs`);
  }
  for (const m of doc.matchAll(/^### (\w+)$/gm))
    if (/^[a-z]+$/.test(m[1]) && !commands.includes(m[1]) && m[1] !== "fixes") out.push(`docs/story-author.md: ### ${m[1]} is not a command`);
  const options = [...cli.matchAll(/new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/"([\w-]+)"/g)].map((x) => x[1]));
  for (const o of options.filter((o) => o !== "help")) {
    if (!doc.includes(`--${o}`)) out.push(`option --${o}: not in docs/story-author.md`);
    if (!header.includes(`--${o}`)) out.push(`option --${o}: not in the header of scripts/story-author.mjs`);
  }
  for (const m of doc.matchAll(/(?<![\w-])--([a-z][\w-]*)/g))
    if (!options.includes(m[1])) out.push(`docs/story-author.md: --${m[1]} is not an option`);
  // the problem codes: code: "..." anywhere, and the code argument of the script checks' helpers (err(path, code, ...),
  // unknown(path, code, ...) and named(value, table, path, code, what))
  const codes = new Set([...cli.matchAll(/code: "(\w+)"/g), ...lib.matchAll(/code: "(\w+)"/g),
                         ...lib.matchAll(/\b(?:err|unknown)\([^,]+,\s*"(\w+)"/g),
                         ...lib.matchAll(/\bnamed\([^,]+,[^,]+,[^,]+,\s*"(\w+)"/g)]
    .map((m) => m[1]));
  const section = doc.slice(doc.indexOf("## Error and warning codes"), doc.indexOf("\n## ", doc.indexOf("## Error and warning codes") + 1));
  const documented = new Set([...section.matchAll(/^\| ([^|]+) \|/gm)].flatMap((m) => [...m[1].matchAll(/`(\w+)`/g)].map((x) => x[1])));
  for (const c of codes) if (!documented.has(c)) out.push(`problem code ${c}: not in the codes table of docs/story-author.md`);
  for (const c of documented) if (!codes.has(c)) out.push(`docs/story-author.md: problem code ${c} is not one the tool reports`);
  return out;
};

// ------------------------------------------------------------------------------------------------ workflows

// the one-line `- run:` commands of a job of a workflow file (the job's block: from "  <job>:" to the next job)
const jobRuns = (file, job) => {
  const text = read(file), start = text.search(new RegExp(`^ {2}${job}:\\s*$`, "m"));
  if (start < 0) return null;
  const rest = text.slice(start + 1), end = rest.search(/^ {2}[\w-]+:\s*$/m);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/^ {6}- run: (.+)$/gm)].map((m) => m[1].trim());
};

const checkWorkflows = () => {
  const ci = jobRuns(".github/workflows/ci.yml", "test"), release = jobRuns(".github/workflows/release.yml", "build");
  if (!ci || !release) return ["the CI test job or the release build job is missing"];
  return ci.join("\n") === release.join("\n") ? []
    : [`the CI test job runs ${JSON.stringify(ci)}, the release build job ${JSON.stringify(release)}`];
};

// ------------------------------------------------------------------------------------------------ main

const CONTRACTS = { package: checkPackage, entries: checkEntries, schemas: checkSchemas, formats: checkFormats,
                    links: checkLinks, "story-author": checkStoryAuthor, workflows: checkWorkflows };

let problems = 0;
for (const [name, check] of Object.entries(CONTRACTS)) {
  for (const p of await check()) { process.stdout.write(`${name}: ${p}\n`); problems++; }
}
process.stdout.write(problems ? `${problems} problem${problems > 1 ? "s" : ""}\n`
                              : `${Object.keys(CONTRACTS).length} contracts hold\n`);
process.exitCode = problems ? 1 : 0;
