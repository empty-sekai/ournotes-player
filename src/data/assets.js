// AssetStore: the files of one chart (path -> text or bytes), read synchronously by the session once loaded.
//
// Sources:
//   AssetStore.fromManifest(url)   a chart manifest ({files: {path: {asset, size}}, ...}) and the content-addressed
//                                  assets it lists, all fetched before the session starts. A large JSON file is listed
//                                  per top-level key ({parts: [[key, asset, size], ...], size}); its text is rebuilt as
//                                  {"k1":t1,"k2":t2,...} from the parts' raw texts (numbers stay exactly as stored).
//   new AssetStore({ text, bytes, info })   in memory: path -> string and path -> Uint8Array / ArrayBuffer.
// Text files are the .json and .glsl files; every other file is binary.

export const TEXT_FILE = /\.(json|glsl)$/;

const entries = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m || {}));

export class AssetStore {
  // text: path -> string; bytes: path -> Uint8Array | ArrayBuffer; info: the chart manifest without `files` (or null)
  constructor({ text = {}, bytes = {}, info = null } = {}) {
    this._text = new Map(entries(text));
    this._bin = new Map();
    for (const [p, b] of entries(bytes)) this._bin.set(p, b instanceof Uint8Array ? b : new Uint8Array(b));
    this.info = info;
  }

  // Fetches the manifest at `url`, then every asset it lists (`concurrency` requests at a time). Asset paths in the
  // manifest are relative to `base`, by default the directory above the manifest's directory (the site layout
  // charts/<id>.json + assets/<sha256>.<ext>). Every asset's byte size is checked against the manifest.
  //   fetch        the fetch function (default globalThis.fetch)
  //   onProgress   (loadedBytes, totalBytes) after each asset
  //   signal       an AbortSignal: aborts the requests and rejects with its reason
  static async fromManifest(url, { fetch = globalThis.fetch, onProgress = null, signal = null, base = null,
                                   concurrency = 6 } = {}) {
    if (!url) throw new Error("no chart manifest URL");
    if (typeof fetch !== "function") throw new Error("no fetch function");
    const here = globalThis.document ? globalThis.document.baseURI : globalThis.location ? globalThis.location.href : undefined;
    const manifestUrl = new URL(String(url), here);
    const root = base ? new URL(String(base), here) : new URL("../", manifestUrl);
    const get = async (u) => {
      if (signal) signal.throwIfAborted();
      const r = await fetch(u, signal ? { signal } : undefined);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r;
    };
    const man = await (await get(manifestUrl.href)).json();
    if (!man || typeof man.files !== "object") throw new Error(`${manifestUrl.href}: not a chart manifest`);
    const jobs = new Map();                                // asset -> {size, path}: each asset fetched once
    for (const [path, f] of Object.entries(man.files))
      for (const [asset, size] of f.parts ? f.parts.map((p) => [p[1], p[2]]) : [[f.asset, f.size]]) jobs.set(asset, { size, path });
    const list = [...jobs.entries()];
    const total = list.reduce((n, [, j]) => n + j.size, 0);
    const got = new Map(), dec = new TextDecoder("utf-8");
    let next = 0, loaded = 0;
    const worker = async () => {
      while (next < list.length) {
        const [asset, j] = list[next++];
        const buf = new Uint8Array(await (await get(new URL(asset, root).href)).arrayBuffer());
        if (buf.byteLength !== j.size) throw new Error(`${j.path}: ${buf.byteLength} bytes, manifest ${j.size}`);
        got.set(asset, buf);
        loaded += j.size;
        if (onProgress) onProgress(loaded, total);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
    const text = new Map(), bin = new Map(), enc = new TextEncoder();
    for (const [path, f] of Object.entries(man.files)) {
      if (f.parts) {
        const t = `{${f.parts.map(([k, asset]) => `${JSON.stringify(k)}:${dec.decode(got.get(asset))}`).join(",")}}`;
        if (enc.encode(t).byteLength !== f.size) throw new Error(`${path}: rebuilt text is not ${f.size} bytes`);
        text.set(path, t);
      } else if (TEXT_FILE.test(path)) text.set(path, dec.decode(got.get(f.asset)));
      else bin.set(path, got.get(f.asset));
    }
    const { files, ...info } = man;
    return new AssetStore({ text, bytes: bin, info });
  }

  has(path) { return this._text.has(path) || this._bin.has(path); }

  text(path) {
    const t = this._text.get(path);
    if (t !== undefined) return t;
    const b = this._bin.get(path);
    if (b === undefined) throw new Error(`asset not found: ${path}`);
    return new TextDecoder("utf-8").decode(b);
  }

  json(path) { return JSON.parse(this.text(path)); }

  // a copy (callers may transfer or detach it)
  bytes(path) {
    const b = this._bin.get(path);
    if (b !== undefined) return b.slice();
    const t = this._text.get(path);
    if (t === undefined) throw new Error(`asset not found: ${path}`);
    return new TextEncoder().encode(t);
  }

  arrayBuffer(path) {
    const u = this.bytes(path);
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  }

  // PNG -> ImageBitmap with the texel values exactly as stored (no premultiplication, no colour conversion), flipped
  // so that row 0 is the bottom row (Unity / GL v = 0)
  async image(path) {
    const blob = new Blob([this.bytes(path)], { type: "image/png" });
    return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "flipY" });
  }

  list(prefix = "") {
    return [...this._text.keys(), ...this._bin.keys()].filter((k) => k.startsWith(prefix));
  }
}

// The store of the session that draws into a WebGL context. Shader libraries and texture loads reach the files through
// the context they are given (ShaderLib, GLTex.load, FxMaterials); one context serves one session at a time.
const byContext = new WeakMap();

export const bindAssets = (gl, store) => {
  const cur = byContext.get(gl);
  if (cur && cur !== store) throw new Error("this WebGL context already serves another chart session");
  byContext.set(gl, store);
};

export const unbindAssets = (gl, store) => {
  if (byContext.get(gl) === store) byContext.delete(gl);
};

export const assetsOf = (gl) => {
  const s = gl ? byContext.get(gl) : undefined;
  if (!s) throw new Error("no AssetStore bound to this WebGL context");
  return s;
};
