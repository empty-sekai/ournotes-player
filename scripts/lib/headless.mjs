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
  return new Proxy({ canvas, drawingBufferWidth: width, drawingBufferHeight: height }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) return glConst(k);
      let f = fns.get(k);
      if (!f) {
        const g = impl[k] || (k.startsWith("create") ? () => obj(k.slice(6)) : () => undefined);
        f = onCall ? (...a) => { onCall(k, a); return g(...a); } : g;
        fns.set(k, f);
      }
      return f;
    },
  });
};

// ---- WebAudio -------------------------------------------------------------------------------------------------------
// The clock is `t` (seconds), set by the caller. decodeAudioData reads the header only (FLAC STREAMINFO, MP4 mdhd).
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
    return audioBuffer(i.channels, i.samples, i.sampleRate);
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

// a chart manifest file (site/charts/<id>.json, assets under site/assets) or a directory holding live.json
export const openChart = async (where) => {
  const p = path.resolve(where);
  const store = fs.statSync(p).isDirectory() ? storeFromDir(p)
    : await AssetStore.fromManifest(pathToFileURL(p).href, { fetch: fileFetch });
  return headlessImages(store);
};
