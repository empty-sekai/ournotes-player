// Headless Node environment for the player: a no-op WebGL2 context, a no-op AudioContext and AssetStores over files
// on disk. Nothing is drawn or played; the session runs its full logic (simulation, views, effects, draw calls) so
// that everything it reads and every GL call it makes can be observed.
//
//   import { headlessGL, HeadlessAudioContext, openChart } from "./lib/headless.mjs";
//   const assets = await openChart("site/charts/100001_expert.json");     // or a directory with live.json
//   const session = await ChartSession.create({ gl: headlessGL(), assets, audioContext: new HeadlessAudioContext() });
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AssetStore, TEXT_FILE } from "../../src/data/assets.js";

// ---- WebGL2 ---------------------------------------------------------------------------------------------------------
// Every constant is a distinct number (shared by all contexts), every create* returns a new {kind, id} object, queries
// answer "complete / linked / compiled", everything else does nothing. onCall(name, args), when given, sees every call.
// The context is a plain object: a constant or method is made at its first access (through a Proxy prototype) and kept
// as an own property, so later accesses are ordinary property reads.
const glConstants = new Map();
const glConst = (name) => {
  if (!glConstants.has(name)) glConstants.set(name, 0x8000 + glConstants.size);
  return glConstants.get(name);
};

export const headlessGL = ({ width = 320, height = 180, onCall = null } = {}) => {
  let id = 0;
  const obj = (kind) => ({ kind, id: ++id });
  const impl = {
    getError: () => 0,
    getExtension: (n) => ({ name: n }),
    getSupportedExtensions: () => [],
    getParameter: (p) => (p === glConst("MAX_TEXTURE_SIZE") || p === glConst("MAX_RENDERBUFFER_SIZE") ? 16384
                          : p === glConst("MAX_SAMPLES") ? 4 : 0),
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getProgramParameter: (p, n) => (n === glConst("LINK_STATUS") || n === glConst("VALIDATE_STATUS") ? true : 0),
    getUniformLocation: () => obj("uniform"),
    getAttribLocation: () => -1,
    getActiveUniforms: (p, idx) => idx.map(() => 0),
    checkFramebufferStatus: () => glConst("FRAMEBUFFER_COMPLETE"),
    isContextLost: () => false,
    getContextAttributes: () => ({}),
    readPixels: () => {},
    fenceSync: () => obj("sync"),
    clientWaitSync: () => glConst("ALREADY_SIGNALED"),
  };
  const canvas = { width, height };
  const fns = new Map();
  const make = (k) => {
    if (/^[A-Z0-9_]+$/.test(k)) return glConst(k);
    let f = fns.get(k);
    if (!f) {
      const g = impl[k] || (k.startsWith("create") ? () => obj(k.slice(6)) : () => undefined);
      f = onCall ? (...a) => { onCall(k, a); return g(...a); } : g;
      fns.set(k, f);
    }
    return f;
  };
  const gl = Object.create(new Proxy({}, {
    get(t, k, receiver) {
      if (typeof k !== "string") return undefined;
      if (k in t) return t[k];                                    // Object.prototype's members, as on any object
      const v = make(k);
      Object.defineProperty(receiver, k, { value: v, writable: true, configurable: true });
      return v;
    },
  }));
  return Object.assign(gl, { canvas, drawingBufferWidth: width, drawingBufferHeight: height });
};

// ---- WebAudio -------------------------------------------------------------------------------------------------------
// The clock is `t` (seconds), set by the caller. decodeAudioData reads the header only (FLAC STREAMINFO, MP4 mdhd) and,
// as a browser does, returns a buffer at the context's sample rate (the length scaled from the file's rate).
const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
                            cancelScheduledValues() {}, setTargetAtTime() {}, cancelAndHoldAtTime() {} });
const audioNode = (extra = {}) => ({ connect(d) { return d; }, disconnect() {}, ...extra });
const audioBuffer = (channels, length, sampleRate) => ({
  numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
  getChannelData: () => new Float32Array(0), copyToChannel() {}, copyFromChannel() {},
});

const flacInfo = (b) => {
  const s = b.subarray(8, 8 + 34);
  return { sampleRate: (s[10] << 12) | (s[11] << 4) | (s[12] >> 4), channels: ((s[12] >> 1) & 7) + 1,
           samples: (s[13] & 0x0f) * 2 ** 32 + s.readUInt32BE(14) };
};
// first track's media header (timescale = sample rate for audio, duration in samples)
const mp4Info = (b) => {
  const i = b.indexOf("mdhd", 0, "latin1");
  if (i < 0) throw new Error("MP4 without mdhd");
  const v = b[i + 4], o = i + 8 + (v === 1 ? 16 : 8);
  const sampleRate = b.readUInt32BE(o);
  const samples = v === 1 ? Number(b.readBigUInt64BE(o + 4)) : b.readUInt32BE(o + 4);
  return { sampleRate, channels: 2, samples };
};

export class HeadlessAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate; this.state = "running"; this.destination = audioNode(); this.t = 0;
  }
  get currentTime() { return this.t; }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  getOutputTimestamp() { return { contextTime: this.t, performanceTime: 0 }; }
  createGain() { return audioNode({ gain: param(1) }); }
  createBufferSource() {
    return audioNode({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), detune: param(0),
                       start() {}, stop() {}, onended: null });
  }
  createBuffer(channels, length, sampleRate) { return audioBuffer(channels, length, sampleRate); }
  async decodeAudioData(ab) {
    const b = Buffer.from(ab);
    const i = b.toString("latin1", 0, 4) === "fLaC" ? flacInfo(b)
      : b.toString("latin1", 4, 8) === "ftyp" ? mp4Info(b) : null;
    if (!i) throw new Error("the headless AudioContext reads FLAC and MP4 headers only");
    const n = i.sampleRate === this.sampleRate ? i.samples : Math.floor(i.samples * this.sampleRate / i.sampleRate);
    return audioBuffer(i.channels, n, this.sampleRate);
  }
}

// ---- assets ---------------------------------------------------------------------------------------------------------
const pngSize = (b) => {
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

// images decode to their size only ({width, height, close}): enough for texture uploads to the headless context
export const headlessImages = (store) => {
  store.image = async (p) => ({ ...pngSize(Buffer.from(store.bytes(p))), close() {} });
  return store;
};

export const fileFetch = async (u) => {
  const b = fs.readFileSync(fileURLToPath(String(u)));
  return { ok: true, status: 200, json: async () => JSON.parse(b.toString("utf8")),
           arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

// every file under `dir` (path -> text or bytes)
export const storeFromDir = (dir, info = null) => {
  const text = new Map(), bytes = new Map();
  const walk = (d, pre) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = pre ? `${pre}/${e.name}` : e.name, f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, p);
      else if (TEXT_FILE.test(p)) text.set(p, fs.readFileSync(f, "utf8"));
      else bytes.set(p, new Uint8Array(fs.readFileSync(f)));
    }
  };
  walk(dir, "");
  return new AssetStore({ text, bytes, info });
};

// the files under `dir` as storeFromDir has them, each read when it is first asked for (has, text, bytes, ...); a
// path names a file by its exact name, "/"-separated, without "." or ".." segments
export class DirStore extends AssetStore {
  constructor(dir, info = null) {
    super({ info });
    this.dir = dir;
    this._entries = new Map();            // directory -> Map(name -> is a directory)
  }

  _entriesOf(d) {
    let m = this._entries.get(d);
    if (!m) {
      try { m = new Map(fs.readdirSync(d, { withFileTypes: true }).map((e) => [e.name, e.isDirectory()])); } catch { m = new Map(); }
      this._entries.set(d, m);
    }
    return m;
  }

  _load(p) {
    if (typeof p !== "string" || this._text.has(p) || this._bin.has(p)) return;
    const parts = p.split("/");
    if (parts.some((x) => !x || x === "." || x === "..")) return;
    let f = this.dir;
    for (let i = 0; i < parts.length; i++) {
      if (this._entriesOf(f).get(parts[i]) !== (i < parts.length - 1)) return;   // missing, or a file / directory mix-up
      f = path.join(f, parts[i]);
    }
    if (TEXT_FILE.test(p)) this._text.set(p, fs.readFileSync(f, "utf8"));
    else this._bin.set(p, new Uint8Array(fs.readFileSync(f)));
  }

  has(p) { this._load(p); return super.has(p); }
  text(p) { this._load(p); return super.text(p); }
  bytes(p) { this._load(p); return super.bytes(p); }

  list(prefix = "") {
    const walk = (d, pre) => {
      for (const [name, isDir] of this._entriesOf(d)) {
        const p = pre ? `${pre}/${name}` : name;
        if (isDir) walk(path.join(d, name), p); else this._load(p);
      }
    };
    walk(this.dir, "");
    return super.list(prefix).sort();
  }
}

// a chart manifest file (site/charts/<id>.json, assets under site/assets) or a directory holding live.json (its files
// read on demand)
export const openChart = async (where) => {
  const p = path.resolve(where);
  const store = fs.statSync(p).isDirectory() ? new DirStore(p)
    : await AssetStore.fromManifest(pathToFileURL(p).href, { fetch: fileFetch });
  return headlessImages(store);
};
