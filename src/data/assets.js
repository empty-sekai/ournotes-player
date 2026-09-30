// AssetStore: the files of one chart (path -> text or bytes), read synchronously by the session once loaded.
//
// Sources:
//   AssetStore.fromManifest(url)   a chart manifest ({files: {path: {asset, size}}, ...}) and the content-addressed
//                                  assets it lists, all fetched before the session starts. A large JSON file is listed
//                                  per top-level key ({parts: [[key, asset, size], ...], size}); its text is rebuilt as
//                                  {"k1":t1,"k2":t2,...} from the parts' raw texts (numbers stay exactly as stored).
//                                  An encoded asset (assets/<sha256>.<ext>.gz or .br) has its stored byte count too
//                                  ({asset, size, stored}, [key, asset, size, stored]); it is decoded here unless the
//                                  server already did (Content-Encoding).
//   new AssetStore({ text, bytes, info })   in memory: path -> string and path -> Uint8Array / ArrayBuffer.
// Text files are the .json and .glsl files; every other file is binary.

export const TEXT_FILE = /\.(json|glsl)$/;

const entries = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m || {}));

// the content encoding of an asset by its name: "gzip" (.gz), "br" (.br), or null (stored as it is)
export const assetEncoding = (asset) => {
  const m = /\.(gz|br)$/.exec(String(asset));
  return m ? (m[1] === "gz" ? "gzip" : "br") : null;
};

// The default decoder of fromManifest: DecompressionStream("gzip"), and DecompressionStream("brotli") where the browser
// can construct it. A browser without brotli decoding gets .br assets only through the server's Content-Encoding.
export const decodeAsset = async (bytes, encoding) => {
  const format = encoding === "gzip" ? "gzip" : encoding === "br" ? "brotli" : null;
  if (!format) throw new Error(`unknown content encoding ${encoding}`);
  let stream = null;
  try { stream = new DecompressionStream(format); } catch { stream = null; }
  if (!stream) {
    throw new Error(encoding === "br"
      ? "this browser cannot decode brotli: a .br asset must be served with Content-Encoding: br"
      : "DecompressionStream(\"gzip\") is not available: serve the .gz assets with Content-Encoding: gzip");
  }
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
};

// a plain Uint8Array over the bytes a decoder returns (a Node Buffer's slice() would share its memory)
const u8 = (b) => (b instanceof Uint8Array ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

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
  // charts/<id>.json + assets/<sha256>.<ext>). An encoded asset whose fetched length is its `stored` count is decoded;
  // one whose length is already its `size` (the server decoded it) is used as it is; any other length fails. Every
  // file's decoded byte size is checked against the manifest.
  //   fetch        the fetch function (default globalThis.fetch)
  //   onProgress   (loadedBytes, totalBytes) after each asset; an encoded asset counts its stored bytes
  //   signal       an AbortSignal: aborts the requests and rejects with its reason
  //   decode       (bytes, encoding) -> Promise<Uint8Array | ArrayBuffer>: the decoder of "gzip" and "br" assets
  //                (default decodeAsset)
  static async fromManifest(url, { fetch = globalThis.fetch, onProgress = null, signal = null, base = null,
                                   concurrency = 6, decode = decodeAsset } = {}) {
    if (!url) throw new Error("no chart manifest URL");
    if (typeof fetch !== "function") throw new Error("no fetch function");
    if (typeof decode !== "function") throw new Error("no decode function");
    const here = globalThis.document ? globalThis.document.baseURI : globalThis.location ? globalThis.location.href : undefined;
    const manifestUrl = new URL(String(url), here);
    const root = base ? new URL(String(base), here) : new URL("../", manifestUrl);
    // A failed asset ends the whole load: cancel in-flight requests and stop peers before their next job.
    const controller = new AbortController(), requestSignal = controller.signal;
    const cancel = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
    try {
      const get = async (u) => {
        requestSignal.throwIfAborted();
        const r = await fetch(u, { signal: requestSignal });
        requestSignal.throwIfAborted();
        if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
        return r;
      };
      const man = await (await get(manifestUrl.href)).json();
      requestSignal.throwIfAborted();
      if (!man || typeof man.files !== "object") throw new Error(`${manifestUrl.href}: not a chart manifest`);
      const jobs = new Map();                                // asset -> {size, stored, path}: each asset fetched once
      for (const [path, f] of Object.entries(man.files)) {
        const list = f.parts ? f.parts.map((p) => [p[1], p[2], p[3]]) : [[f.asset, f.size, f.stored]];
        for (const [asset, size, stored] of list) jobs.set(asset, { size, stored, path });
      }
      const list = [...jobs.entries()];
      const weight = (j) => j.stored ?? j.size;
      const total = list.reduce((n, [, j]) => n + weight(j), 0);
      const got = new Map(), dec = new TextDecoder("utf-8");
      let next = 0, loaded = 0;
      const worker = async () => {
        while (next < list.length) {
          requestSignal.throwIfAborted();
          const [asset, j] = list[next++];
          const raw = new Uint8Array(await (await get(new URL(asset, root).href)).arrayBuffer());
          requestSignal.throwIfAborted();
          let buf = raw;
          if (j.stored !== undefined && raw.byteLength === j.stored) {
            const encoding = assetEncoding(asset);
            if (!encoding) throw new Error(`${j.path}: ${asset} has a stored size but no .gz / .br name`);
            try { buf = u8(await decode(raw, encoding)); } catch (e) { throw new Error(`${j.path}: ${asset}: ${e.message}`); }
            requestSignal.throwIfAborted();
            if (buf.byteLength !== j.size) throw new Error(`${j.path}: ${buf.byteLength} bytes decoded, manifest ${j.size}`);
          } else if (raw.byteLength !== j.size) {
            throw new Error(`${j.path}: ${raw.byteLength} bytes, manifest ${j.stored !== undefined ? `${j.stored} stored, ` : ""}${j.size}`);
          }
          got.set(asset, buf);
          loaded += weight(j);
          if (onProgress) onProgress(loaded, total);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
      requestSignal.throwIfAborted();
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
    } catch (e) {
      controller.abort(e);
      throw requestSignal.reason;
    } finally {
      if (signal) signal.removeEventListener("abort", cancel);
    }
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
