#!/usr/bin/env node
// Validates a chart site against docs/data-format.md and the schemas in schema/.
//
//   node scripts/validate-data.mjs <site dir> [chart id | model id ...]
//
// Checks, per chart: the manifest (schema, agreement with charts.json), every asset (present, byte size, SHA-256
// matching its name), the rebuilt text of split JSON files, live.json, the score, audio/live-audio.json (schema, sound
// id references, waveform files and their FLAC / MP4 headers), livescene/scene.json and livenotes/notes.json (the
// structures the player reads, animation references, node order), both shader directories (index, parsed shader data,
// GLSL ES 3.00 stage blocks) and the texture descriptors (PNG present where required, size as described).
// Live2D models (models.json, models/<id>.json): the manifest (schema, agreement with models.json), every asset,
// model.json, the moc3 header, the prefab (the components the model viewer reads, clip and fade references, drawable
// materials and textures), the shader index and programs, and that the manifest lists exactly the files the viewer
// reads.
// charts.json of a site of several regions: an id at most once per region (an entry without `regions` serves every
// region, so its id only once), every entry's regions among the index's `regions`, text languages among `languages`.
// Without charts.json the manifests are charts/*.json and charts/<region>/*.json. A models.json entry's key and model
// facts (group, canvas, textures) must equal its manifest's `key` and `model` where both have them, and its character,
// names and label where either has them.
// Stories (stories.json, stories/<advId>.json, stories/<region>/<advId>.json; docs/story-data-format.md): the manifest
// (schema, language groups, agreement with stories.json), every asset of the common files and of each language group,
// story.json, episode.json, the required commands against the episode's rows and the player settings, the cue sheets
// (cues.json, waveform files and their FLAC / MP4 headers), the Live2D models (moc3 header, prefab, textures, shader
// variants), both shader directories, texture descriptors, and per language ui/ui.json, ui/languages.json and
// ui/fonts.json (text bindings, the dialog and chat window bindings, font assets, glyph pages, text material
// shaders). An
// Overlay story built with open fonts: its host (host/host.json and, per language, ui/simple/ui.json with
// ui/simple/fonts.json). A story id is the manifest path below stories/ without .json (`10462`, `tw/10462`).
// Prints the failures and a summary; exits 1 when a chart, a model or a story fails. No dependencies.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADV_COMMAND } from "../src/story/interfaces.js";
import { compile } from "./lib/json-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = (name) => compile(JSON.parse(fs.readFileSync(path.join(here, "..", "schema", `${name}.schema.json`), "utf8")));
const S = {
  charts: schema("charts"), manifest: schema("manifest"), live: schema("live"), audio: schema("live-audio"),
  score: schema("score"), models: schema("models"), model: schema("model"), modelJson: schema("model-json"),
  stories: schema("stories"), storyManifest: schema("story-manifest"), story: schema("story"), episode: schema("episode"),
  storyFonts: schema("story-fonts"), storyLanguage: schema("story-language"),
};

const TEXT_FILE = /\.(json|glsl)$/;
const STORY_HOST_FORMAT = "ournotes.story-host/1";
const extOf = (p) => (p.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() ?? "";
const has = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------ binary headers
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngInfo = (b) => {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString("latin1", 12, 16) !== "IHDR") throw new Error("not a PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), depth: b[24], colorType: b[25] };
};
// FLAC STREAMINFO: sample rate (20 bits), channels - 1 (3), bits per sample - 1 (5), total samples (36)
const flacInfo = (b) => {
  if (b.length < 42 || b.toString("latin1", 0, 4) !== "fLaC" || (b[4] & 0x7f) !== 0) throw new Error("not FLAC (no STREAMINFO)");
  const s = b.subarray(8, 42);
  return { sampleRate: (s[10] << 12) | (s[11] << 4) | (s[12] >> 4), channels: ((s[12] >> 1) & 7) + 1,
           samples: (s[13] & 0x0f) * 2 ** 32 + s.readUInt32BE(14) };
};
const isMp4 = (b) => b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp";

// GLSL file of one variant: top-level `#ifdef VERTEX` and `#ifdef FRAGMENT` blocks, each starting with
// `#version 300 es` (the stage split the player's shader loader performs)
const glslStages = (src) => {
  const out = {};
  let depth = 0, cur = null, buf = [];
  for (const ln of src.split("\n")) {
    const t = ln.trim();
    if (depth === 0 && (t === "#ifdef VERTEX" || t === "#ifdef FRAGMENT")) { cur = t.slice(7).toLowerCase(); depth = 1; buf = []; continue; }
    if (!cur) continue;
    if (/^#\s*if/.test(t)) depth++;
    else if (/^#\s*endif/.test(t) && --depth === 0) { out[cur] = buf.join("\n"); cur = null; continue; }
    buf.push(ln);
  }
  const errs = [];
  for (const k of ["vertex", "fragment"]) {
    if (out[k] === undefined) errs.push(`no ${k.toUpperCase()} block`);
    else if (!out[k].replace(/^\s+/, "").startsWith("#version 300 es")) errs.push(`${k} stage does not start with #version 300 es`);
  }
  return errs;
};

// ------------------------------------------------------------------------------------------------ site
class Site {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.assetCheck = new Map();      // asset -> error string | null
    this.bufCache = new Map();        // asset -> Buffer (small binaries only)
    this.derived = new Map();         // "<kind>|<signature>" -> cached per-file result
  }

  file(rel) { return path.join(this.dir, ...rel.split("/")); }

  // present, byte size, content hash
  checkAsset(asset, size) {
    const key = `${asset}|${size}`;
    if (!this.assetCheck.has(key)) {
      let err = null;
      try {
        const b = fs.readFileSync(this.file(asset));
        const sha = crypto.createHash("sha256").update(b).digest("hex");
        if (b.length !== size) err = `${asset}: ${b.length} bytes, manifest ${size}`;
        else if (path.basename(asset).split(".")[0] !== sha) err = `${asset}: content SHA-256 is ${sha}`;
      } catch (e) { err = `${asset}: ${e.code === "ENOENT" ? "missing" : e.message}`; }
      this.assetCheck.set(key, err);
    }
    return this.assetCheck.get(key);
  }

  bytes(asset) { return fs.readFileSync(this.file(asset)); }

  // cached result of fn() per kind and content signature
  once(kind, sig, fn) {
    const k = `${kind}|${sig}`;
    if (!this.derived.has(k)) this.derived.set(k, fn());
    return this.derived.get(k);
  }
}

// ------------------------------------------------------------------------------------------------ one chart
class Chart {
  constructor(site, id, man) {
    this.site = site; this.id = id; this.man = man; this.errs = [];
    this.files = isObj(man.files) ? man.files : {};
    this.checked = new Set();       // logical files already parsed by a check
  }

  err(where, msg) { this.errs.push(`${where}: ${msg}`); }

  has(p) { return has(this.files, p); }

  sig(p) {
    const f = this.files[p];
    return f.parts ? f.parts.map((x) => `${x[0]}=${x[1]}`).join(",") : f.asset;
  }

  // the logical file's text (split JSON files rebuilt from their parts)
  text(p) {
    const f = this.files[p];
    if (!f.parts) return this.site.bytes(f.asset).toString("utf8");
    return `{${f.parts.map(([k, a]) => `${JSON.stringify(k)}:${this.site.bytes(a).toString("utf8")}`).join(",")}}`;
  }

  // per-file check with cross-chart caching: fn(parsedJson) -> result; parse errors are reported
  json(kind, p, fn) {
    if (!this.has(p)) { this.err(p, "not in the manifest"); return null; }
    this.checked.add(p);
    const r = this.site.once(kind, this.sig(p), () => {
      let v;
      try { v = JSON.parse(this.text(p)); } catch (e) { return { errs: [`not valid JSON (${e.message})`] }; }
      return fn(v);
    });
    for (const e of r.errs || []) this.err(p, e);
    return r;
  }

  run(entry) {
    const m = this.man;
    for (const e of S.manifest(m)) this.err("manifest", e);
    if (!isObj(m.files)) return this.errs;
    if (entry) this.crossCheck(entry);
    this.checkAssets();
    if (this.errs.length) return this.errs;       // content checks need every asset in place

    const live = this.json("live", "live.json", (v) => ({ errs: S.live(v), v: S.live(v).length ? null : v })).v;
    if (!live) return this.errs;
    for (const k of ["scene", "notes", "noteAssets", "liveAudio"]) if (!this.has(live[k])) this.err("live.json", `${k}: ${live[k]} not in the manifest`);
    if (this.errs.length) return this.errs;

    const score = this.checkScore(live.notes);
    this.checkAudio(live.liveAudio);
    const notes = this.checkNoteAssets(live.noteAssets, score);
    const scene = this.checkScene(live.scene);
    this.checkShaders("livescene/shaders");
    this.checkShaders("livenotes/shaders");
    this.checkTextures("livescene", scene && scene.textures, scene && scene.required);
    this.checkTextures("livenotes", notes && notes.textures, []);
    // every other JSON file of the chart must parse (the player may not read it, but it is fetched)
    for (const p of Object.keys(this.files)) if (p.endsWith(".json") && !this.checked.has(p)) this.json("parse", p, () => ({ errs: [] }));
    return this.errs;
  }

  crossCheck(e) {
    const m = this.man;
    for (const k of ["musicId", "difficulty", "audio", "audioFormat"])
      if (has(e, k) && has(m, k) && e[k] !== m[k]) this.err("manifest", `${k} ${JSON.stringify(m[k])}, charts.json ${JSON.stringify(e[k])}`);
    if (has(e, "flows") && JSON.stringify(e.flows) !== JSON.stringify(m.flows)) this.err("manifest", "flows differ from charts.json");
    if ((has(e, "regions") || has(m, "regions")) && JSON.stringify(e.regions) !== JSON.stringify(m.regions))
      this.err("manifest", "regions differ from charts.json");
    if (isObj(m.chart))
      for (const [k, v] of Object.entries(m.chart))
        if (has(e, k) && JSON.stringify(e[k]) !== JSON.stringify(v)) this.err("manifest", `chart.${k} differs from charts.json`);
    const total = Object.values(this.files).reduce((n, f) => n + (f.size || 0), 0);
    if (has(e, "bytes") && e.bytes !== total) this.err("charts.json", `bytes ${e.bytes}, manifest files total ${total}`);
    if (e.id !== `${m.musicId}_${m.difficulty}`) this.err("charts.json", `id ${e.id} does not match the manifest`);
  }

  checkAssets() {
    for (const [p, f] of Object.entries(this.files)) {
      if (f.parts) {
        if (!p.endsWith(".json")) this.err(p, "only JSON files may be split into parts");
        const keys = new Set();
        let total = 2 + f.parts.length - 1;        // braces and commas
        for (const [k, a, size] of f.parts) {
          if (keys.has(k)) this.err(p, `part key ${k} twice`);
          keys.add(k);
          if (extOf(a) !== "json") this.err(p, `part ${k}: ${a} is not a .json asset`);
          const e = this.site.checkAsset(a, size);
          if (e) this.err(p, e);
          total += Buffer.byteLength(JSON.stringify(k)) + 1 + size;
        }
        if (total !== f.size) this.err(p, `rebuilt text is ${total} bytes, manifest ${f.size}`);
      } else {
        if (extOf(f.asset) !== extOf(p)) this.err(p, `asset extension .${extOf(f.asset)} differs from the file's`);
        const e = this.site.checkAsset(f.asset, f.size);
        if (e) this.err(p, e);
      }
    }
  }

  checkScore(p) {
    const r = this.json("score", p, (s) => {
      const errs = S.score(s);
      if (errs.length) return { errs };
      const ids = new Map(), lines = new Map();
      for (const n of s.notes) { if (ids.has(n.id)) errs.push(`note id ${n.id} twice`); ids.set(n.id, n); }
      for (const l of s.lines) { if (lines.has(l.lineId)) errs.push(`line id ${l.lineId} twice`); lines.set(l.lineId, l); }
      for (const n of s.notes) {
        for (const id of n.lineIds) if (!lines.has(id)) errs.push(`note ${n.id}: line ${id} not in lines`);
        if (n.pairNoteId && !ids.has(n.pairNoteId)) errs.push(`note ${n.id}: pair note ${n.pairNoteId} not in notes`);
      }
      for (const l of s.lines) for (const id of l.noteIds) if (!ids.has(id)) errs.push(`line ${l.lineId}: note ${id} not in notes`);
      return { errs: errs.slice(0, 20), laneCount: s.laneCount };
    });
    return r && !r.errs.length ? r : null;
  }

  checkAudio(p) {
    const r = this.json("audio", p, (a) => {
      const errs = S.audio(a);
      if (errs.length) return { errs };
      const snd = (id) => has(a.sounds, String(id));
      if (!snd(a.music.soundId)) errs.push(`music.soundId ${a.music.soundId} not in sounds`);
      for (const k of ["types"]) for (const [t, id] of Object.entries(a.noteSe[k])) if (!snd(id)) errs.push(`noteSe.types.${t}: sound ${id} not in sounds`);
      // auto play ends every chart with an all perfect: of the live SE, FinishCheers (10) and AllPerfectDirection (16)
      // are played; the other types need no sound
      for (const t of [10, 16]) if (!has(a.liveSe, String(t)) || !snd(a.liveSe[t])) errs.push(`liveSe.${t}: no sound in sounds`);
      for (const [k, id] of Object.entries(a.voice || {})) if (/SoundId$/.test(k) && id > 0 && !snd(id)) errs.push(`voice.${k}: sound ${id} not in sounds`);
      const layers = [];
      for (const [id, s] of Object.entries(a.sounds)) {
        for (const c of s.categories) if (!has(a.categories, c)) errs.push(`sounds.${id}: category ${c} has no volume in categories`);
        for (const L of s.layers) {
          if ((L.loopStart === null) !== (L.loopEnd === null)) errs.push(`sounds.${id}: loopStart and loopEnd must both be set or both null`);
          if (L.loopStart !== null && !(L.loopStart < L.loopEnd && L.loopEnd <= L.samples)) errs.push(`sounds.${id}: loop points outside the waveform`);
          layers.push({ id, ...L });
        }
      }
      const music = a.sounds[String(a.music.soundId)];
      return { errs, layers, musicFile: music ? music.layers[0].file : null };
    });
    if (!r || r.errs.length) return;
    const m = this.man;
    if (m.audioFormat && r.musicFile && extOf(r.musicFile) !== (m.audioFormat === "aac" ? "m4a" : "flac"))
      this.err(p, `music file ${r.musicFile} does not match audioFormat ${m.audioFormat}`);
    if (m.audio === false) return;                 // no waveforms in a chart without audio
    for (const L of r.layers) {
      if (!this.has(L.file)) { this.err(p, `sounds.${L.id}: ${L.file} not in the manifest`); continue; }
      const asset = this.files[L.file].asset;
      const e = this.site.once("wave", `${asset}|${L.sampleRate}|${L.channels}|${L.samples}`, () => {
        const b = this.site.bytes(asset);
        if (extOf(L.file) === "m4a") return isMp4(b) ? null : "not an MP4 file";
        try {
          const i = flacInfo(b);
          if (i.sampleRate !== L.sampleRate) return `FLAC sample rate ${i.sampleRate}, described ${L.sampleRate}`;
          if (L.channels !== undefined && i.channels !== L.channels) return `FLAC channels ${i.channels}, described ${L.channels}`;
          if (i.samples !== L.samples) return `FLAC total samples ${i.samples}, described ${L.samples}`;
          return null;
        } catch (err) { return err.message; }
      });
      if (e) this.err(L.file, e);
    }
  }

  checkNoteAssets(p, score) {
    const r = this.json("notes", p, (n) => {
      const errs = [];
      for (const k of ["settings", "prefabs", "noteSkin", "assets", "clips", "controllers"]) if (!isObj(n[k])) errs.push(`${k} missing`);
      if (errs.length) return { errs };
      const st = n.settings;
      for (const k of ["laneCount", "laneTopRange", "laneBottomRange", "judgementScreenBottomPosition", "laneTopPosition", "tiltCenterLane"])
        if (typeof st[k] !== "number") errs.push(`settings.${k} is not a number`);
      if (!Array.isArray(st.laneSize) || st.laneSize.length !== 2) errs.push("settings.laneSize is not [width, height]");
      if (typeof st.effect !== "string") errs.push("settings.effect is not a string");
      if (!isObj(st.optionDefaults) || typeof st.optionDefaults.NoteSpeed !== "string") errs.push("settings.optionDefaults.NoteSpeed missing");
      for (const k of ["note_speed_min", "note_speed_max", "note_speed_view_min", "note_speed_view_max"])
        if (!isObj(st.liveSettings) || typeof st.liveSettings[k] !== "string") errs.push(`settings.liveSettings.${k} missing`);
      if (!isObj(st.optionRanges)) errs.push("settings.optionRanges missing");
      for (const [k, pf] of Object.entries(n.prefabs)) nodeList(pf, `prefabs.${k}`, errs);
      for (const [k, a] of Object.entries(n.assets)) if (has(a, "nodes")) nodeList(a, `assets.${k}`, errs);
      const refs = { clip: new Set(), controller: new Set() }, textures = [];
      walk(n, (o) => {
        if (typeof o.clip === "string" && Object.keys(o).length === 1) refs.clip.add(o.clip);
        if (typeof o.controller === "string") refs.controller.add(o.controller);
        if (isDescriptor(o)) textures.push(desc(o));
      }, ["clips"]);
      for (const c of Object.values(n.controllers)) walk(c, (o) => { if (typeof o.clip === "string") refs.clip.add(o.clip); });
      for (const k of refs.clip) if (!has(n.clips, k)) errs.push(`clip ${k} not in clips`);
      for (const k of refs.controller) if (!has(n.controllers, k)) errs.push(`controller ${k} not in controllers`);
      return { errs: errs.slice(0, 20), laneCount: st.laneCount, textures: dedupe(textures) };
    });
    if (r && score && r.laneCount !== undefined && r.laneCount !== score.laneCount)
      this.err(p, `settings.laneCount ${r.laneCount}, score laneCount ${score.laneCount}`);
    return r && !r.errs.length ? r : null;
  }

  checkScene(p) {
    const quality = this.man.quality ?? 1;
    const r = this.json("scene", p, (s) => {
      const errs = [];
      if (!isObj(s.scene)) errs.push("scene missing"); else nodeList(s.scene, "scene", errs);
      for (const k of ["startTimeline", "laneLinePrefab"]) if (!isObj(s.assets) || !isObj(s.assets[k])) errs.push(`assets.${k} missing`); else nodeList(s.assets[k], `assets.${k}`, errs);
      const required = [];
      for (const k of ["lane_base", "lane_tap_area", "out_side_line"]) {
        const d = isObj(s.laneSkin) && s.laneSkin[k];
        if (!isObj(d) || !isDescriptor(d.texture)) errs.push(`laneSkin.${k}.texture is not a texture descriptor`); else required.push(d.texture.texture);
      }
      for (const k of ["lightweightBackground", "jacket"]) {
        const d = isObj(s.sprites) && s.sprites[k];
        if (!isObj(d) || !isDescriptor(d.texture)) errs.push(`sprites.${k}.texture is not a texture descriptor`); else required.push(d.texture.texture);
      }
      const grain = isObj(s.postTextures) && isObj(s.postTextures.ForwardRendererLiveGameEffect) && s.postTextures.ForwardRendererLiveGameEffect.filmGrainTex;
      if (!Array.isArray(grain) || !grain.every(isDescriptor)) errs.push("postTextures.ForwardRendererLiveGameEffect.filmGrainTex is not a list of texture descriptors");
      else required.push(...grain.map((d) => d.texture));
      if (!isObj(s.master) || !Array.isArray(s.master.liveQualitySettings)) errs.push("master.liveQualitySettings missing");
      if (!isObj(s.master) || !isObj(s.master.optionDefaultsPreset1)) errs.push("master.optionDefaultsPreset1 missing");
      const qualities = Array.isArray(s.master && s.master.liveQualitySettings) ? s.master.liveQualitySettings.map((q) => q._quality) : [];
      const textures = [];
      walk(s, (o) => { if (isDescriptor(o)) textures.push(desc(o)); });
      return { errs: errs.slice(0, 20), required: [...new Set(required)], textures: dedupe(textures), qualities };
    });
    if (r && !r.errs.length && !r.qualities.includes(quality)) this.err(p, `no master.liveQualitySettings row for quality ${quality}`);
    return r && !r.errs.length ? r : null;
  }

  checkShaders(dir) {
    const idx = `${dir}/shaders.json`;
    const r = this.json("shaders", idx, (list) => {
      const errs = [];
      if (!Array.isArray(list)) return { errs: ["not an array"] };
      const names = new Set();
      for (const [i, rec] of list.entries()) {
        if (!isObj(rec) || typeof rec.name !== "string" || typeof rec.parsed !== "string" || !Array.isArray(rec.variants)) { errs.push(`[${i}]: needs name, parsed, variants`); continue; }
        if (names.has(rec.name)) errs.push(`shader ${rec.name} twice`);
        names.add(rec.name);
        for (const v of rec.variants)
          if (!isObj(v) || typeof v.file !== "string" || !Number.isInteger(v.subShader) || !Number.isInteger(v.pass) || !Array.isArray(v.keywords))
            errs.push(`${rec.name}: a variant needs file, subShader, pass, keywords`);
      }
      return { errs, list: errs.length ? [] : list.map((x) => ({ name: x.name, parsed: x.parsed, files: x.variants.map((v) => v.file) })) };
    });
    if (!r || r.errs.length) return;
    for (const rec of r.list) {
      const pp = `${dir}/${rec.parsed}`;
      this.json("shaderinfo", pp, (s) => {
        const errs = [];
        if (!Array.isArray(s.subShaders) || !s.subShaders.every((x) => Array.isArray(x.passes) && x.passes.every((y) => isObj(y.state))))
          errs.push("subShaders[].passes[].state missing");
        if (s.properties !== undefined && !Array.isArray(s.properties)) errs.push("properties is not an array");
        return { errs };
      });
      for (const f of rec.files) {
        const fp = `${dir}/${f}`;
        if (!this.has(fp)) { this.err(idx, `${rec.name}: ${fp} not in the manifest`); continue; }
        if (!fp.endsWith(".glsl")) { this.err(fp, "a variant file must be .glsl"); continue; }
        const errs = this.site.once("glsl", this.files[fp].asset, () => glslStages(this.text(fp)));
        for (const e of errs) this.err(fp, e);
      }
    }
  }

  checkTextures(dir, textures, required) {
    if (!textures) return;
    for (const t of required || []) if (!this.has(`${dir}/${t}`)) this.err(`${dir}/${t}`, "required texture not in the manifest");
    for (const d of textures) {
      const p = `${dir}/${d.texture}`;
      if (!this.has(p)) continue;                  // described but not part of this chart
      const asset = this.files[p].asset;
      const info = this.site.once("png", asset, () => { try { return pngInfo(this.site.bytes(asset)); } catch (e) { return { error: e.message }; } });
      if (info.error) { this.err(p, info.error); continue; }
      if (info.width !== d.width || info.height !== d.height)
        this.err(p, `PNG is ${info.width}x${info.height}, descriptor ${d.name || ""} says ${d.width}x${d.height}`);
      if (d.mipCount > 1) this.err(p, `descriptor ${d.name || ""}: mipCount ${d.mipCount} (mipmapped textures are not supported)`);
    }
  }
}

// a prefab / scene node list: hierarchy order (parent before child), local TRS, components
function nodeList(pf, where, errs) {
  if (!Array.isArray(pf.nodes)) { errs.push(`${where}.nodes is not an array`); return; }
  const paths = new Set();
  for (const n of pf.nodes) {
    if (!isObj(n) || typeof n.path !== "string" || !Array.isArray(n.components)) { errs.push(`${where}: a node needs path and components`); return; }
    const cut = n.path.lastIndexOf("/");
    if (cut >= 0 && !paths.has(n.path.slice(0, cut))) { errs.push(`${where}: parent of ${n.path} is not listed before it`); return; }
    for (const k of ["localPosition", "localRotation", "localScale"]) if (!isObj(n[k])) { errs.push(`${where}: ${n.path} has no ${k}`); return; }
    paths.add(n.path);
  }
}

const isDescriptor = (o) => isObj(o) && typeof o.texture === "string" && /\.png$/i.test(o.texture) &&
  Number.isInteger(o.width) && Number.isInteger(o.height);
const desc = (o) => ({ texture: o.texture, width: o.width, height: o.height, mipCount: o.mipCount ?? 1, name: o.name });
const dedupe = (ds) => [...new Map(ds.map((d) => [`${d.texture}|${d.width}|${d.height}|${d.mipCount}`, d])).values()];

// every object inside v (skipping the top-level keys in `skip`)
function walk(v, fn, skip = []) {
  const stack = [v];
  let top = true;
  while (stack.length) {
    const o = stack.pop();
    if (Array.isArray(o)) { for (const x of o) if (x && typeof x === "object") stack.push(x); continue; }
    if (!o || typeof o !== "object") continue;
    fn(o);
    for (const [k, x] of Object.entries(o)) if (x && typeof x === "object" && !(top && skip.includes(k))) stack.push(x);
    top = false;
  }
}

// ------------------------------------------------------------------------------------------------ one Live2D model
const LIT_SHADER = "Live2D Cubism/Lit-URP-ADV-optimize", MASK_SHADER = "Live2D Cubism/Mask";
const ROOT_COMPONENTS = ["Live2DCharacter", "CubismFadeController", "CubismExpressionController", "CubismRenderController",
  "CubismAutoEyeBlinkInput", "CubismEyeBlinkController", "CubismMouthController", "CubismHarmonicMotionController"];
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const inDir = (dir, p) => (dir ? `${dir}/${p}` : p);

// the prefab as the model viewer reads it: {errs, textures (descriptors), keywordSets, masked}
function modelPrefab(pf) {
  const errs = [];
  if (!isObj(pf)) return { errs: ["not an object"] };
  nodeList(pf, "prefab", errs);
  if (errs.length) return { errs };
  const root = pf.nodes[0], comp = (cls) => root.components.filter((c) => c.class === cls);
  for (const cls of ROOT_COMPONENTS) if (comp(cls).length !== 1) errs.push(`root ${root.path}: ${comp(cls).length} ${cls}`);
  if (comp("CubismPhysicsController").length > 1) errs.push(`root ${root.path}: more than one CubismPhysicsController`);
  if (errs.length) return { errs };
  const ch = comp("Live2DCharacter")[0], fl = comp("CubismFadeController")[0].CubismFadeMotionList;
  const clips = Array.isArray(ch._motionList) ? ch._motionList : [];
  if (!clips.length) errs.push("Live2DCharacter._motionList is empty");
  const fadeIds = new Set(isObj(fl) && Array.isArray(fl.MotionInstanceIds) ? fl.MotionInstanceIds : []);
  for (const c of clips) {
    const ev = (c.events || []).filter((e) => e.functionName === "InstanceId");
    if (!ev.length || !fadeIds.has(ev[ev.length - 1].intParameter)) errs.push(`clip ${c.clip}: no fade motion for its InstanceId`);
  }
  if (!clips.some((c) => c.clip === ch.DefaultMotionName)) errs.push(`default motion ${ch.DefaultMotionName} is not a clip`);
  const ex = comp("CubismExpressionController")[0];
  const exprs = isObj(ex.ExpressionsList) && Array.isArray(ex.ExpressionsList.CubismExpressionObjects)
    ? ex.ExpressionsList.CubismExpressionObjects.map((e) => String(e.name).replace(/\.exp3$/, "")) : [];
  if (ex.UseLegacyBlendCalculation) errs.push("legacy expression blend is not supported");
  if (ch.DefaultExpressionName && !exprs.includes(ch.DefaultExpressionName)) errs.push(`default expression ${ch.DefaultExpressionName} is not in ExpressionsList`);
  const textures = [], kw = new Map();
  let drawables = 0, masked = false;
  for (const n of pf.nodes) {
    if (!n.components.some((c) => c.class === "CubismDrawable")) continue;
    drawables++;
    const r = n.components.find((c) => c.class === "CubismRenderer"), mr = n.components.find((c) => c.type === "MeshRenderer");
    if (!r || !isDescriptor(r._mainTexture)) { errs.push(`${n.path}: CubismRenderer._mainTexture is not a texture descriptor`); continue; }
    textures.push(desc(r._mainTexture));
    const mats = mr && Array.isArray(mr.m_Materials) ? mr.m_Materials : [];
    if (mats.length !== 1 || !isObj(mats[0].shader) || mats[0].shader.shader !== LIT_SHADER) {
      errs.push(`${n.path}: needs one material of ${LIT_SHADER}`); continue;
    }
    const k = Array.isArray(mats[0].keywords) ? [...mats[0].keywords].sort() : [];
    kw.set(k.join(" "), k);
    if (k.includes("CUBISM_MASK_ON")) masked = true;
  }
  if (!drawables) errs.push("no CubismDrawable nodes");
  if (pf.nodes.some((n) => n.components.some((c) => c.class === "CubismPosePart"))) errs.push("pose parts are not supported");
  return { errs, textures: dedupe(textures), keywordSets: [...kw.values()], masked };
}

class Model extends Chart {
  run(entry) {
    const m = this.man;
    for (const e of S.model(m)) this.err("manifest", e);
    if (!isObj(m.files)) return this.errs;
    if (entry) {
      if (entry.id !== m.id) this.err("models.json", `id ${entry.id}, manifest id ${m.id}`);
      if (has(entry, "key") && has(m, "key") && entry.key !== m.key) this.err("models.json", "key differs from the manifest");
      if (isObj(m.model))
        for (const k of ["group", "canvas", "textures"])
          if (has(entry, k) && has(m.model, k) && JSON.stringify(entry[k]) !== JSON.stringify(m.model[k]))
            this.err("models.json", `${k} differs from the manifest's model.${k}`);
      const facts = isObj(m.model) ? m.model : {};
      for (const k of ["character", "names", "label"])
        if ((has(entry, k) || has(facts, k)) && JSON.stringify(entry[k]) !== JSON.stringify(facts[k]))
          this.err("models.json", `${k} differs from the manifest's model.${k}`);
      const total = Object.values(this.files).reduce((n, f) => n + (f.size || 0), 0);
      if (has(entry, "bytes") && entry.bytes !== total) this.err("models.json", `bytes ${entry.bytes}, manifest files total ${total}`);
      if (has(entry, "files") && entry.files !== Object.keys(this.files).length) this.err("models.json", `files ${entry.files}, manifest ${Object.keys(this.files).length}`);
    }
    this.checkAssets();
    if (this.errs.length) return this.errs;
    const idx = this.json("modeljson", "model.json", (v) => ({ errs: S.modelJson(v), v: S.modelJson(v).length ? null : v })).v;
    if (!idx) return this.errs;
    for (const k of ["moc3", "prefab", "shaders"]) if (!this.has(idx[k])) this.err("model.json", `${k}: ${idx[k]} not in the manifest`);
    if (this.errs.length) return this.errs;
    const moc = this.site.bytes(this.files[idx.moc3].asset);
    if (moc.length < 8 || moc.toString("latin1", 0, 4) !== "MOC3") this.err(idx.moc3, "not a moc3 file");
    const pf = this.json("prefab", idx.prefab, modelPrefab);
    if (!pf || pf.errs.length) return this.errs;
    const read = new Set(["model.json", idx.moc3, idx.prefab]);
    const dir = dirOf(idx.prefab);
    for (const d of pf.textures) {
      const p = inDir(dir, d.texture);
      read.add(p);
      if (!this.has(p)) { this.err(p, "texture of a drawable not in the manifest"); continue; }
      const asset = this.files[p].asset;
      const info = this.site.once("png", asset, () => { try { return pngInfo(this.site.bytes(asset)); } catch (e) { return { error: e.message }; } });
      if (info.error) this.err(p, info.error);
      else if (info.width !== d.width || info.height !== d.height) this.err(p, `PNG is ${info.width}x${info.height}, descriptor says ${d.width}x${d.height}`);
      const full = Math.floor(Math.log2(Math.max(d.width, d.height))) + 1;
      if (!(Number.isInteger(d.mipCount) && d.mipCount >= 1 && d.mipCount <= full)) this.err(p, `mipCount ${d.mipCount} (1 to ${full})`);
    }
    const sdir = dirOf(idx.shaders), before = this.errs.length;
    this.checkShaders(sdir);
    if (this.errs.length > before) return this.errs;
    read.add(idx.shaders);
    const list = JSON.parse(this.text(idx.shaders));
    const need = [[LIT_SHADER, pf.keywordSets], ...(pf.masked ? [[MASK_SHADER, [[]]]] : [])];
    for (const [name, sets] of need) {
      const rec = list.find((r) => r.name === name);
      if (!rec) { this.err(idx.shaders, `${name} not in the index`); continue; }
      read.add(inDir(sdir, rec.parsed));
      const vs = rec.variants.filter((v) => v.subShader === 0 && v.pass === 0);
      const known = new Set(vs.flatMap((v) => v.keywords));
      for (const set of sets) {
        const want = set.filter((k) => known.has(k)).sort().join(" ");
        const v = vs.find((x) => [...x.keywords].sort().join(" ") === want);
        if (!v) this.err(idx.shaders, `${name}: no variant for [${want}]`);
        else read.add(inDir(sdir, v.file));
      }
    }
    for (const p of Object.keys(this.files)) if (!read.has(p)) this.err(p, "listed but not read by the model viewer");
    return this.errs;
  }
}

// ------------------------------------------------------------------------------------------------ one story
// LanguageMode and text field per language (ui/languages.json)
const STORY_LANGUAGES = { ja: [0, "japanese"], en: [1, "english"], "zh-Hant": [2, "traditionalChinese"],
  "zh-Hans": [3, "simplifiedChinese"], ko: [4, "korean"] };
const STORY_MEDIA = ["frames", "effects", "postEffects", "stills", "talkWindows", "chat", "videos"];
const WAVE_EXT = { aac: "m4a", flac: "flac" };
// JSON text with object keys sorted (comparison independent of key order)
const canon = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
const sameJson = (a, b) => canon(a) === canon(b);
const sizeOf = (files) => Object.values(files).reduce((n, f) => n + (isObj(f) && Number.isInteger(f.size) ? f.size : 0), 0);
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : Boolean(v));
const commandName = (v) => ADV_COMMAND[v] || `Cmd${v}`;

// the variant of shader `name` in a parsed shader index that draws a material with `keywords`: the variant of sub
// shader 0, pass 0 whose keywords equal the material's keywords that the shader's variants use
function variantFor(list, name, keywords) {
  const rec = list.find((r) => r.name === name);
  if (!rec) return { error: `${name} not in the index` };
  const vs = rec.variants.filter((v) => v.subShader === 0 && v.pass === 0);
  const known = new Set(vs.flatMap((v) => v.keywords));
  const want = keywords.filter((k) => known.has(k)).sort().join(" ");
  const v = vs.find((x) => [...x.keywords].sort().join(" ") === want);
  return v ? { variant: v } : { error: `${name}: no variant for [${want}]` };
}

class Story extends Chart {
  constructor(site, id, man) {
    super(site, id, man);
    this.common = this.files;
    this.groups = isObj(man.languages) ? man.languages : {};
    this.lang = null;                 // the language group being checked (error prefix)
  }

  err(where, msg) { this.errs.push(`${this.lang ? `[${this.lang}] ` : ""}${where}: ${msg}`); }

  // the parsed JSON of a logical file (not cached: story documents are large and mostly per story), or null
  doc(p, check) {
    if (!this.has(p)) { this.err(p, "not in the manifest"); return null; }
    this.checked.add(p);
    let v;
    try { v = JSON.parse(this.text(p)); } catch (e) { this.err(p, `not valid JSON (${e.message})`); return null; }
    const errs = check ? check(v) : [];
    for (const e of errs.slice(0, 20)) this.err(p, e);
    return errs.length ? null : v;
  }

  // every JSON file of the current file set not parsed by a check must parse
  parseRest(paths) {
    for (const p of paths) if (p.endsWith(".json") && !this.checked.has(p)) this.json("parse", p, () => ({ errs: [] }));
  }

  png(p, d, singleLevel) {
    const asset = this.files[p].asset;
    const info = this.site.once("png", asset, () => { try { return pngInfo(this.site.bytes(asset)); } catch (e) { return { error: e.message }; } });
    if (info.error) { this.err(p, info.error); return; }
    if (info.width !== d.width || info.height !== d.height)
      this.err(p, `PNG is ${info.width}x${info.height}, descriptor ${d.name || ""} says ${d.width}x${d.height}`);
    if (singleLevel && (d.mipCount ?? 1) !== 1) this.err(p, `descriptor ${d.name || ""}: mipCount ${d.mipCount}`);
  }

  // texture descriptors anywhere in a document: the ones whose PNG is in the file set (relative to `dir`) agree with it
  descriptors(v, dir) {
    const seen = new Set();
    walk(v, (o) => {
      if (!isDescriptor(o)) return;
      const p = inDir(dir, o.texture), k = `${p}|${o.width}|${o.height}`;
      if (seen.has(k) || !this.has(p)) return;       // described but not part of this story
      seen.add(k);
      this.png(p, desc(o), false);
    });
  }

  run(entry) {
    const m = this.man;
    for (const e of S.storyManifest(m)) this.err("manifest", e);
    if (!isObj(m.files) || !isObj(m.languages)) return this.errs;
    this.checkGroups();
    if (entry) this.crossCheck(entry);
    this.checkAssets();
    for (const [lang, g] of Object.entries(this.groups)) {
      if (!isObj(g) || !isObj(g.files)) continue;
      this.lang = lang; this.files = g.files;
      this.checkAssets();
    }
    this.lang = null; this.files = this.common;
    if (this.errs.length) return this.errs;       // content checks need every asset in place

    const langs = Object.keys(this.groups);
    if (!langs.length) { this.err("manifest", "no language group"); return this.errs; }
    this.files = { ...this.common, ...this.groups[langs[0]].files };
    const story = this.checkCommon();
    if (story) {
      this.parseRest(Object.keys(this.common));
      for (const lang of langs) {
        this.lang = lang;
        this.files = { ...this.common, ...this.groups[lang].files };
        this.checkLanguage(lang, story);
        this.parseRest(Object.keys(this.groups[lang].files));
      }
    }
    this.lang = null; this.files = this.common;
    return this.errs;
  }

  checkGroups() {
    const m = this.man;
    if (!has(m.languages, m.language)) this.err("manifest", `language ${m.language} is not a key of languages`);
    for (const [lang, g] of Object.entries(m.languages)) {
      if (!isObj(g) || !isObj(g.files)) continue;
      for (const p of Object.keys(g.files)) if (has(m.files, p)) this.err("manifest", `languages.${lang}: ${p} is also a common file`);
      for (const p of ["ui/fonts.json", "ui/languages.json"]) if (!has(g.files, p)) this.err("manifest", `languages.${lang}: ${p} missing`);
      if (isObj(m.host) && !has(g.files, "ui/simple/fonts.json")) this.err("manifest", `languages.${lang}: ui/simple/fonts.json missing (the story has a host)`);
    }
    if (!isObj(m.story)) return;
    const s = m.story;
    if (s.advId !== m.advId) this.err("manifest", `story.advId ${s.advId}, advId ${m.advId}`);
    if (s.language !== m.language) this.err("manifest", `story.language ${s.language}, language ${m.language}`);
    if (!sameJson([...(s.languages || [])].sort(), Object.keys(m.languages).sort())) this.err("manifest", "story.languages differ from the keys of languages");
    if (isObj(m.requires) && !sameJson(m.requires.commands, s.commands)) this.err("manifest", "requires.commands differ from story.commands");
  }

  crossCheck(e) {
    const m = this.man;
    if (e.id !== String(m.advId)) this.err("stories.json", `id ${e.id}, manifest advId ${m.advId}`);
    for (const k of ["audio", "audioFormat", "fonts"]) if (e[k] !== m[k]) this.err("stories.json", `${k} ${JSON.stringify(e[k])}, manifest ${JSON.stringify(m[k])}`);
    if (isObj(m.story)) for (const [k, v] of Object.entries(m.story)) if (!sameJson(e[k], v)) this.err("stories.json", `${k} differs from the manifest's story.${k}`);
    if ((has(e, "regions") || has(m, "regions")) && !sameJson(e.regions, m.regions)) this.err("stories.json", "regions differ from the manifest");
    const size = { common: sizeOf(m.files), languages: Object.fromEntries(Object.entries(this.groups).map(([l, g]) => [l, sizeOf(g.files || {})])) };
    if (!sameJson(e.size, size)) this.err("stories.json", `size ${JSON.stringify(e.size)}, manifest files ${JSON.stringify(size)}`);
  }

  // the files every language shares: story.json, episode.json, scene.json, commands, sounds, models, shaders, textures
  checkCommon() {
    const m = this.man;
    const story = this.doc("story.json", S.story);
    if (!story) return null;
    if (story.advId !== m.advId) this.err("story.json", `advId ${story.advId}, manifest ${m.advId}`);
    for (const p of [story.episode, story.scene, ...STORY_MEDIA.map((k) => story[k]).filter((p) => p !== null)])
      if (!has(this.common, p)) { this.err("story.json", `${p} is not a common file`); return null; }
    const episode = this.doc(story.episode, S.episode);
    const scene = this.doc(story.scene, (v) => (isObj(v) && isObj(v.settings) && isObj(v.settings.playerSettings) ? [] : ["settings.playerSettings missing"]));
    if (!episode || !scene) return null;
    const s = isObj(m.story) ? m.story : {};
    if (episode.advId !== m.advId) this.err(story.episode, `advId ${episode.advId}, manifest ${m.advId}`);
    if (episode.commandCount !== episode.commands.length) this.err(story.episode, `commandCount ${episode.commandCount}, ${episode.commands.length} rows`);
    if (s.commandCount !== episode.commandCount) this.err("manifest", `story.commandCount ${s.commandCount}, episode ${episode.commandCount}`);
    if (isObj(episode.master) && s.playbackMode !== episode.master._playbackMode) this.err("manifest", `story.playbackMode ${s.playbackMode}, episode master row ${episode.master._playbackMode}`);

    // the commands the player runs: the rows without IgnoreData, the player settings' initialize and finalize rows
    const ps = scene.settings.playerSettings, names = new Set();
    for (const c of episode.commands) if (!truthy(c.IgnoreData)) names.add(c.cmd);
    for (const k of ["_initializeEpisodes", "_finalizeEpisodes"]) for (const r of ps[k] || []) names.add(commandName(r.Command));
    const want = [...names].sort();
    if (!sameJson(m.requires.commands, want)) this.err("manifest", `requires.commands ${JSON.stringify(m.requires.commands)}, the episode runs ${JSON.stringify(want)}`);
    const lipSync = episode.commands.some((c) => c.cmd === "Talk" && truthy(c.TargetName) && truthy(c.VoiceIDs) && !truthy(c.IgnoreLipSync) && !truthy(c.IgnoreData));
    if (m.requires.motionSync !== lipSync) this.err("manifest", `requires.motionSync ${m.requires.motionSync}, the episode ${lipSync ? "has" : "has no"} lip-synced Talk rows`);

    this.checkSounds(story, episode);
    const models = Object.entries(story.models).map(([key, md]) => this.checkModel(key, md)).filter(Boolean);
    if (this.has("shaders/shaders.json")) this.checkShaders("shaders");
    else if (models.length) this.err("shaders/shaders.json", "not in the manifest");
    if (models.length && this.has("shaders/shaders.json")) {
      const list = JSON.parse(this.text("shaders/shaders.json"));
      const sets = new Map();
      for (const r of models) for (const k of r.keywordSets) sets.set(k.join(" "), k);
      const need = [[LIT_SHADER, [...sets.values()]], ...(models.some((r) => r.masked) ? [[MASK_SHADER, [[]]]] : [])];
      for (const [name, ks] of need) for (const k of ks) {
        const v = variantFor(list, name, k);
        if (v.error) this.err("shaders/shaders.json", v.error);
      }
    }
    this.descriptors(scene, "");
    for (const k of STORY_MEDIA) if (story[k] !== null && k !== "videos") {
      const v = this.doc(story[k]);
      if (v) this.descriptors(v, "");
    }
    if (this.has("ui/shaders/shaders.json")) this.checkShaders("ui/shaders");
    else this.err("ui/shaders/shaders.json", "not in the manifest");
    this.checkHost();
    return story;
  }

  // the host of an Overlay story: present exactly for playbackMode 1 with open fonts, host.json common, its kind
  checkHost() {
    const m = this.man, s = isObj(m.story) ? m.story : {}, host = m.host;
    const overlay = s.playbackMode === 1;
    if (!isObj(host)) {
      if (overlay && m.fonts === "open") this.err("manifest", "an Overlay story (playbackMode 1) with open fonts has no host");
      return;
    }
    if (!overlay) { this.err("manifest", `host on a story of playbackMode ${s.playbackMode}`); return; }
    if (m.fonts !== "open") this.err("manifest", `host on a story with ${m.fonts} fonts`);
    if (!has(this.common, host.doc)) { this.err("manifest", `host.doc ${host.doc} is not a common file`); return; }
    const doc = this.doc(host.doc, (v) => (isObj(v) ? [] : ["not an object"]));
    if (!doc) return;
    if (doc.format !== STORY_HOST_FORMAT) this.err(host.doc, `format ${JSON.stringify(doc.format)}, expected ${STORY_HOST_FORMAT}`);
    if (doc.kind !== host.kind) this.err(host.doc, `kind ${doc.kind}, manifest host.kind ${host.kind}`);
    if (typeof doc.ui === "string" && !has(this.common, doc.ui)) this.err(host.doc, `ui ${doc.ui} is not a common file`);
  }

  checkSounds(story, episode) {
    const m = this.man, sheets = story.audio;
    if (m.audio === false) {
      if (Object.keys(sheets).length) this.err("story.json", "audio is not empty in a story without audio");
      for (const p of Object.keys(this.common)) if (/\.(m4a|flac)$/.test(p)) this.err(p, "a waveform file in a story without audio");
      return;
    }
    for (const cs of Object.values(episode.cuesheets || {}))
      if (isObj(cs) && !has(sheets, cs._cueSheetName)) this.err("story.json", `cue sheet ${cs._cueSheetName} of the episode has no audio directory`);
    for (const [name, dir] of Object.entries(sheets)) {
      const cp = `${dir}/cues.json`;
      if (!has(this.common, cp)) { this.err("story.json", `audio.${name}: ${cp} is not a common file`); continue; }
      const cues = this.doc(cp, (v) => (isObj(v) ? [] : ["not an object"]));
      if (!cues) continue;
      for (const [cue, c] of Object.entries(cues)) {
        if (!isObj(c) || typeof c.file !== "string" || !Number.isInteger(c.sampleRate) || !Number.isInteger(c.samples)) { this.err(cp, `${cue}: needs file, sampleRate, samples`); continue; }
        if (extOf(c.file) !== WAVE_EXT[m.audioFormat]) this.err(cp, `${cue}: ${c.file} does not match audioFormat ${m.audioFormat}`);
        if ((c.loopStart === undefined) !== (c.loopEnd === undefined)) this.err(cp, `${cue}: loopStart and loopEnd must both be set or both absent`);
        else if (c.loopStart !== undefined && !(c.loopStart < c.loopEnd && c.loopEnd <= c.samples)) this.err(cp, `${cue}: loop points outside the waveform`);
        if (c.encoderDelay !== undefined && (extOf(c.file) !== "m4a" || !Number.isInteger(c.encoderDelay) || c.encoderDelay < 0)) this.err(cp, `${cue}: encoderDelay ${c.encoderDelay}`);
        const p = `${dir}/${c.file}`;
        if (!has(this.common, p)) { this.err(cp, `${cue}: ${p} is not a common file`); continue; }
        const asset = this.files[p].asset;
        const e = this.site.once("wave", `${asset}|${c.sampleRate}|${c.channels}|${c.samples}`, () => {
          const b = this.site.bytes(asset);
          if (extOf(p) === "m4a") return isMp4(b) ? null : "not an MP4 file";
          try {
            const i = flacInfo(b);
            if (i.sampleRate !== c.sampleRate) return `FLAC sample rate ${i.sampleRate}, described ${c.sampleRate}`;
            if (c.channels !== undefined && i.channels !== c.channels) return `FLAC channels ${i.channels}, described ${c.channels}`;
            if (i.samples !== c.samples) return `FLAC total samples ${i.samples}, described ${c.samples}`;
            return null;
          } catch (err) { return err.message; }
        });
        if (e) this.err(p, e);
      }
    }
  }

  // a Live2D model of story.json: moc3 header, prefab (as the model viewer reads it), atlas pages
  checkModel(key, md) {
    const moc = inDir(md.dir, md.moc3), pf = inDir(md.dir, md.prefab);
    for (const p of [moc, pf]) if (!has(this.common, p)) { this.err("story.json", `models.${key}: ${p} is not a common file`); return null; }
    const asset = this.files[moc].asset;
    if (!this.site.once("moc3", asset, () => { const b = this.site.bytes(asset); return b.length >= 8 && b.toString("latin1", 0, 4) === "MOC3"; }))
      this.err(moc, "not a moc3 file");
    const r = this.json("prefab", pf, modelPrefab);
    if (!r || r.errs.length) return null;
    for (const d of r.textures) {
      const p = inDir(md.dir, d.texture);
      if (!this.has(p)) this.err(p, "texture of a drawable not in the manifest");
      else this.png(p, d, false);
    }
    return r;
  }

  // one language: ui/ui.json, ui/languages.json, ui/fonts.json
  checkLanguage(lang, story) {
    const m = this.man;
    const ui = this.doc(story.ui, (v) => {
      if (!isObj(v) || !Array.isArray(v.nodes)) return ["nodes is not an array"];
      if (!v.nodes.every((n) => isObj(n) && typeof n.path === "string")) return ["a node needs path"];
      // every parent that is a node of the list comes before its children (the canvases' parent is not listed)
      const all = new Set(v.nodes.map((n) => n.path)), seen = new Set();
      for (const n of v.nodes) {
        const cut = n.path.lastIndexOf("/");
        if (cut >= 0 && all.has(n.path.slice(0, cut)) && !seen.has(n.path.slice(0, cut))) return [`parent of ${n.path} is not listed before it`];
        seen.add(n.path);
      }
      return [];
    });
    const lj = this.doc("ui/languages.json", S.storyLanguage);
    const fj = this.doc("ui/fonts.json", S.storyFonts);
    if (!ui || !lj || !fj) return;
    this.descriptors(ui, "ui");
    let uiShaders = null;
    if (this.has("ui/shaders/shaders.json")) try { uiShaders = JSON.parse(this.text("ui/shaders/shaders.json")); } catch { uiShaders = null; }
    const shaderOf = (where, mats, keywords) => {
      for (const [n, mat] of Object.entries(mats || {})) {
        const sh = isObj(mat) && isObj(mat.shader) ? mat.shader.shader : null;
        if (typeof sh !== "string") { this.err(where, `material ${n} names no shader`); continue; }
        if (!Array.isArray(uiShaders)) continue;
        const kw = isObj(keywords) && Array.isArray(keywords[n]) ? keywords[n] : null;
        if (!kw) { this.err(where, `material ${n} has no materialKeywords`); continue; }
        const v = variantFor(uiShaders, sh, kw);
        if (v.error) this.err(where, `material ${n}: ui/shaders/shaders.json: ${v.error}`);
      }
    };
    shaderOf(story.ui, ui.materials, ui.materialKeywords);

    const [mode, field] = STORY_LANGUAGES[lang] || [];
    if (lj.language !== lang) this.err("ui/languages.json", `language ${lj.language}`);
    if (lj.mode !== mode || lj.field !== field) this.err("ui/languages.json", `mode ${lj.mode} / field ${lj.field}, ${lang} is ${mode} / ${field}`);
    if (lj.fonts !== m.fonts) this.err("ui/languages.json", `fonts ${lj.fonts}, manifest ${m.fonts}`);
    for (const [role, r] of Object.entries(lj.roles)) if (!has(fj.fonts, r.fontAsset)) this.err("ui/languages.json", `roles.${role}: font asset ${r.fontAsset} not in ui/fonts.json`);

    this.checkFonts("ui/fonts.json", fj, ui, story.ui, "ui", lang, shaderOf);
    // the dialog and chat window texts: with open fonts a binding per text node of ui.json dialogs (fonts.json
    // dialogTexts) and per text of ui.json chatTexts (fonts.json chatTexts)
    const F = "ui/fonts.json";
    const dialogs = {};
    for (const [d, rec] of Object.entries(isObj(ui.dialogs) ? ui.dialogs : {}))
      dialogs[d] = Object.fromEntries((Array.isArray(rec.nodes) ? rec.nodes : []).filter((n) => has(n, "textStyle")).map((n) => [n.path, n]));
    const groups = [["dialogTexts", "dialog", dialogs, "dialogs"], ["chatTexts", "chat window", isObj(ui.chatTexts) ? ui.chatTexts : {}, "chatTexts"]];
    for (const [key, what, wanted, uiKey] of groups) {
      if (m.fonts !== "open") {
        if (has(fj, key)) this.err(F, `${key} in ${m.fonts}-font data`);
        continue;
      }
      const bound = isObj(fj[key]) ? fj[key] : {};
      for (const [w, texts] of Object.entries(wanted)) for (const p of Object.keys(texts)) if (!has(bound[w], p)) this.err(F, `${what} ${w}: text ${p} has no binding in ${key}`);
      for (const [w, texts] of Object.entries(bound)) for (const [p, t] of Object.entries(texts)) {
        if (!has(wanted[w], p)) this.err(F, `${key}.${w}.${p}: not a text of ${story.ui} ${uiKey}`);
        this.binding(F, `${key}.${w}.${p}`, t, fj);
      }
    }
    if (isObj(m.host)) this.checkSimple(lang, shaderOf);
  }

  // ui/simple/ui.json and ui/simple/fonts.json of a story with a host
  checkSimple(lang, shaderOf) {
    const m = this.man, U = m.host.ui;
    const ui = this.doc(U, (v) => (isObj(v) && Array.isArray(v.nodes) && v.nodes.every((n) => isObj(n) && typeof n.path === "string") ? [] : ["nodes is not an array of nodes"]));
    const fj = this.doc("ui/simple/fonts.json", S.storyFonts);
    if (!ui || !fj) return;
    this.descriptors(ui, dirOf(U));
    this.checkFonts("ui/simple/fonts.json", fj, ui, U, dirOf(U), lang, shaderOf);
  }

  // a text binding's localized font asset and material are in the fonts document
  binding(F, where, t, fj) {
    if (!isObj(t) || !isObj(t.localized)) { this.err(F, `${where}: no localized record`); return; }
    if (!has(fj.fonts, t.localized.fontAsset)) this.err(F, `${where}: font asset ${t.localized.fontAsset} not in fonts`);
    if (!has(fj.materials, t.localized.material)) this.err(F, `${where}: material ${t.localized.material} not in materials`);
  }

  // a fonts document F (ui/fonts.json, ui/simple/fonts.json) of the UI document `ui` (path U, texture paths relative
  // to `dir`): language, source, a binding per text node, materials, glyph pages, font assets
  checkFonts(F, fj, ui, U, dir, lang, shaderOf) {
    const m = this.man, group = this.groups[lang].files;
    if (fj.language !== lang) this.err(F, `language ${fj.language}`);
    if (fj.source !== m.fonts) this.err(F, `source ${fj.source}, manifest fonts ${m.fonts}`);
    const textNodes = new Set(ui.nodes.filter((n) => has(n, "textStyle")).map((n) => n.path));
    for (const p of textNodes) if (!has(fj.texts, p)) this.err(F, `text node ${p} has no binding in texts`);
    for (const [p, t] of Object.entries(fj.texts)) {
      if (!textNodes.has(p)) this.err(F, `texts.${p}: not a text node of ${U}`);
      this.binding(F, `texts.${p}`, t, fj);
    }
    for (const n of Object.keys(fj.materialKeywords)) if (!has(fj.materials, n)) this.err(F, `materialKeywords.${n}: not in materials`);
    shaderOf(F, fj.materials, fj.materialKeywords);
    // glyph pages: listed in the group (never common: page names differ between languages), PNG as described
    for (const [n, t] of Object.entries(fj.textures)) {
      const p = inDir(dir, t.texture);
      if (!has(group, p)) { this.err(F, `textures.${n}: ${p} not in the language group`); continue; }
      this.png(p, desc(t), true);
    }
    for (const [name, f] of Object.entries(fj.fonts)) {
      const where = `${F} fonts.${name}`;
      if (!has(fj.materials, f.material)) this.err(where, `material ${f.material} not in materials`);
      for (const fb of f.fallbacks) if (!has(fj.fonts, fb)) this.err(where, `fallback ${fb} not in fonts`);
      let bad = 0;
      for (const [u, c] of Object.entries(f.characters)) if (!has(f.glyphs, String(c.glyph)) && bad++ < 5) this.err(where, `character ${u}: glyph ${c.glyph} not in glyphs`);
      for (const [gi, g] of Object.entries(f.glyphs)) {
        if (!has(g, "packed")) {
          if (g.rect.m_Width > 0 && g.rect.m_Height > 0 && bad++ < 5) this.err(where, `glyph ${gi}: a rect without packed texels`);
          continue;
        }
        const t = fj.textures[g.packed.texture];
        if (!t) { if (bad++ < 5) this.err(where, `glyph ${gi}: page ${g.packed.texture} not in textures`); continue; }
        const x = g.rect.m_X + g.packed.dx, y = g.rect.m_Y + g.packed.dy;
        if (x < 0 || y < 0 || x + g.rect.m_Width > t.width || y + g.rect.m_Height > t.height)
          if (bad++ < 5) this.err(where, `glyph ${gi}: rect + offset leaves page ${g.packed.texture} (${t.width}x${t.height})`);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ main
// charts.json (or stories.json: list `stories`, name "stories.json") beyond its schema: ids per region, the regions
// and languages the entries name.
function indexErrors(index, list = index.charts, name = "charts.json") {
  const out = [];
  const byId = new Map();
  for (const e of list) byId.set(e.id, [...(byId.get(e.id) || []), e]);
  for (const [id, es] of byId) {
    if (es.length < 2) continue;
    if (es.some((e) => !Array.isArray(e.regions))) { out.push(`${name}: id ${id} twice`); continue; }
    const seen = new Set();
    for (const r of es.flatMap((e) => e.regions)) {
      if (seen.has(r)) out.push(`${name}: id ${id} twice in region ${r}`);
      seen.add(r);
    }
  }
  if (Array.isArray(index.regions)) {
    const known = new Set(index.regions.map((r) => r.id));
    if (known.size !== index.regions.length) out.push(`${name}: a region id twice in regions`);
    for (const e of list) for (const r of e.regions || [])
      if (!known.has(r)) out.push(`${name}: ${e.manifest}: region ${r} not in regions`);
  }
  if (Array.isArray(index.languages)) {
    const known = new Set(index.languages);
    for (const e of list) for (const l of Object.keys(e.titles || {}))
      if (!known.has(l)) out.push(`${name}: ${e.manifest}: title language ${l} not in languages`);
  }
  return out;
}

// stories.json beyond indexErrors: every entry's languages among `languages`, the default language one of them
function storyIndexErrors(index) {
  const out = indexErrors(index, index.stories, "stories.json");
  if (Array.isArray(index.languages)) {
    const known = new Set(index.languages);
    for (const e of index.stories) for (const l of e.languages)
      if (!known.has(l)) out.push(`stories.json: ${e.manifest}: language ${l} not in languages`);
    if (has(index, "language") && !known.has(index.language)) out.push(`stories.json: language ${index.language} not in languages`);
  }
  return out;
}

const storyId = (manifest) => manifest.replace(/^stories\//, "").replace(/\.json$/, "");

// run one kind of manifest: prints the failures, returns the number valid
function runAll(site, list, Kind) {
  let ok = 0;
  for (const { id, manifest, entry } of list) {
    let errs;
    try {
      const man = JSON.parse(fs.readFileSync(site.file(manifest), "utf8"));
      errs = new Kind(site, id, man).run(entry);
    } catch (e) { errs = [`${manifest}: ${e.message}`]; }
    if (errs.length) {
      console.log(`FAIL ${id}`);
      for (const e of errs.slice(0, 30)) console.log(`  ${e}`);
      if (errs.length > 30) console.log(`  ... ${errs.length - 30} more`);
    } else ok++;
  }
  return ok;
}

function main(argv) {
  const [dir, ...only] = argv;
  if (!dir) { console.error("usage: node scripts/validate-data.mjs <site dir> [chart id | model id | story id ...]"); return 2; }
  const site = new Site(dir);
  const out = [];
  let entries;
  const indexPath = site.file("charts.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const errs = S.charts(index);
    if (errs.length) { console.log("FAIL charts.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    out.push(...indexErrors(index));
    entries = index.charts.map((e) => ({ id: e.id, manifest: e.manifest, entry: e }));
  } else if (fs.existsSync(site.file("charts"))) {
    // charts/<id>.json, then the region manifests charts/<region>/<id>.json
    const list = (dir) => fs.readdirSync(site.file(dir), { withFileTypes: true });
    const files = (dir) => list(dir).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name).sort()
      .map((f) => ({ id: f.slice(0, -5), manifest: `${dir}/${f}`, entry: null }));
    entries = [...files("charts"), ...list("charts").filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .flatMap((r) => files(`charts/${r}`))];
  } else entries = [];
  let models = [];
  const modelsPath = site.file("models.json");
  if (fs.existsSync(modelsPath)) {
    const index = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    const errs = S.models(index);
    if (errs.length) { console.log("FAIL models.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    const ids = new Set();
    for (const e of index.models) { if (ids.has(e.id)) out.push(`models.json: id ${e.id} twice`); ids.add(e.id); }
    models = index.models.map((e) => ({ id: e.id, manifest: e.manifest, entry: e }));
  } else if (fs.existsSync(site.file("models"))) {
    models = fs.readdirSync(site.file("models")).filter((f) => f.endsWith(".json")).sort()
      .map((f) => ({ id: f.slice(0, -5), manifest: `models/${f}`, entry: null }));
  }
  let stories = [];
  const storiesPath = site.file("stories.json");
  if (fs.existsSync(storiesPath)) {
    const index = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
    const errs = S.stories(index);
    if (errs.length) { console.log("FAIL stories.json"); for (const e of errs) console.log(`  ${e}`); return 1; }
    out.push(...storyIndexErrors(index));
    stories = index.stories.map((e) => ({ id: storyId(e.manifest), manifest: e.manifest, entry: e }));
  } else if (fs.existsSync(site.file("stories"))) {
    // stories/<advId>.json, then the region manifests stories/<region>/<advId>.json
    const list = (dir) => fs.readdirSync(site.file(dir), { withFileTypes: true });
    const files = (dir) => list(dir).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name).sort()
      .map((f) => ({ id: storyId(`${dir}/${f}`), manifest: `${dir}/${f}`, entry: null }));
    stories = [...files("stories"), ...list("stories").filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .flatMap((r) => files(`stories/${r}`))];
  }
  if (only.length) {
    const want = new Set(only), kinds = stories.length ? "chart, model or story" : "chart or model";
    entries = entries.filter((e) => want.has(e.id));
    models = models.filter((e) => want.has(e.id));
    stories = stories.filter((e) => want.has(e.id));
    for (const id of want)
      if (![entries, models, stories].some((l) => l.some((e) => e.id === id))) { console.error(`${kinds} ${id} not found`); return 2; }
  }
  const ok = runAll(site, entries, Chart);
  const okModels = runAll(site, models, Model);
  const okStories = runAll(site, stories, Story);
  for (const e of out) console.log(e);
  if (entries.length || (!models.length && !stories.length)) console.log(`${ok}/${entries.length} charts valid`);
  if (models.length) console.log(`${okModels}/${models.length} models valid`);
  if (stories.length) console.log(`${okStories}/${stories.length} stories valid`);
  return ok === entries.length && okModels === models.length && okStories === stories.length && !out.length ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
