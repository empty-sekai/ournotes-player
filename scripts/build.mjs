#!/usr/bin/env node
// Builds the browser bundles into dist/ (esbuild, target es2022, linked source maps with the sources inlined):
//   ournotes-player.js / .min.js                   ESM of src/index.js (the API; defines nothing)
//   ournotes-player.element.js / .min.js           ESM of src/element.js (the API; defines <ournotes-player>)
//   ournotes-player.global.js / .min.js            IIFE of src/element.js: defines <ournotes-player> and exposes the
//                                                  API as the global `OurnotesPlayer`
//   ournotes-player.live2d.js / .min.js            ESM of src/live2d/index.js (the Live2D model viewer's API)
//   ournotes-player.live2d.element.js / .min.js    ESM of src/live2d/define.js (the same; defines <ournotes-live2d>)
//   ournotes-player.live2d.global.js / .min.js     IIFE of src/live2d/define.js: defines <ournotes-live2d> and exposes
//                                                  the API as the global `OurnotesLive2D`
//   ournotes-player.story.js / .min.js             ESM of src/story/index.js (the story player's API)
//   ournotes-player.story.element.js / .min.js     ESM of src/story/define.js (the same; defines <ournotes-story>)
//   ournotes-player.story.global.js / .min.js      IIFE of src/story/define.js: defines <ournotes-story> and exposes
//                                                  the API as the global `OurnotesStory`
// The output depends only on the sources, the package version and the esbuild version (no timestamps, no absolute
// paths), so two builds of the same tree are byte-identical. Any esbuild warning fails the build.
//   node scripts/build.mjs [--check]     --check: build twice and compare the outputs

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const banner = `/*! ${pkg.name} ${pkg.version} | AGPL-3.0-only, with the browser exception in LICENSE-EXCEPTION | ` +
  `https://github.com/empty-sekai/ournotes-player */`;

const BUNDLES = [
  { entry: "src/index.js", out: "ournotes-player", format: "esm" },
  { entry: "src/element.js", out: "ournotes-player.element", format: "esm" },
  { entry: "src/element.js", out: "ournotes-player.global", format: "iife", globalName: "OurnotesPlayer" },
  { entry: "src/live2d/index.js", out: "ournotes-player.live2d", format: "esm" },
  { entry: "src/live2d/define.js", out: "ournotes-player.live2d.element", format: "esm" },
  { entry: "src/live2d/define.js", out: "ournotes-player.live2d.global", format: "iife", globalName: "OurnotesLive2D" },
  { entry: "src/story/index.js", out: "ournotes-player.story", format: "esm" },
  { entry: "src/story/define.js", out: "ournotes-player.story.element", format: "esm" },
  { entry: "src/story/define.js", out: "ournotes-player.story.global", format: "iife", globalName: "OurnotesStory" },
];

async function build(outdir) {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const warnings = [];
  for (const b of BUNDLES) {
    for (const minify of [false, true]) {
      const r = await esbuild.build({
        absWorkingDir: root,
        entryPoints: [b.entry],
        outfile: path.join(outdir, `${b.out}${minify ? ".min" : ""}.js`),
        bundle: true,
        format: b.format,
        globalName: b.globalName,
        platform: "browser",
        target: "es2022",
        minify,
        sourcemap: "linked",
        sourcesContent: true,              // the maps carry their sources: a bundle and its map work anywhere
        charset: "utf8",
        legalComments: "none",
        banner: { js: banner },
        logLevel: "silent",
        metafile: false,
      });
      warnings.push(...r.warnings);
    }
  }
  if (warnings.length) {
    const text = await esbuild.formatMessages(warnings, { kind: "warning" });
    throw new Error(`esbuild warnings:\n${text.join("\n")}`);
  }
  // source maps name the sources relative to the map file; make sure no absolute path slipped in
  for (const f of fs.readdirSync(outdir).filter((f) => f.endsWith(".map"))) {
    const map = JSON.parse(fs.readFileSync(path.join(outdir, f), "utf8"));
    const bad = map.sources.filter((s) => path.isAbsolute(s) || /^[A-Za-z]:/.test(s));
    if (bad.length) throw new Error(`${f}: absolute source paths ${bad.join(", ")}`);
  }
}

const digest = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) =>
  [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));

const dist = path.join(root, "dist");
await build(dist);
const first = digest(dist);
if (process.argv.includes("--check")) {
  const again = path.join(root, "dist-check");
  try {
    await build(again);
    const second = digest(again);
    const diff = Object.keys({ ...first, ...second }).filter((f) => first[f] !== second[f]);
    if (diff.length) throw new Error(`non-deterministic output: ${diff.join(", ")}`);
  } finally { fs.rmSync(again, { recursive: true, force: true }); }
}
for (const f of Object.keys(first)) {
  if (f.endsWith(".map")) continue;
  const kb = (fs.statSync(path.join(dist, f)).size / 1024).toFixed(1);
  console.log(`dist/${f}  ${kb} KiB`);
}
