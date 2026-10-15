// AssetStore: the files of one chart or product (path -> text or bytes) and the objects it uses (object id -> class,
// name and files by role), read synchronously by the session once loaded.
//
// Sources:
//   AssetStore.fromManifest(url)   a manifest ({files: {path: {asset, size}}, ...}) and the content-addressed assets
//                                  it lists, all fetched before the session starts. A large JSON file is listed per
//                                  top-level key ({parts: [[key, asset, size], ...], size}); its text is rebuilt as
//                                  {"k1":t1,"k2":t2,...} from the parts' raw texts (numbers stay exactly as stored).
//                                  An encoded asset (assets/<sha256>.<ext>.gz or .br) has its stored byte count too
//                                  ({asset, size, stored}, [key, asset, size, stored]); it is decoded here unless the
//                                  server already did (Content-Encoding). A product manifest (nnnotes.product/1) also
//                                  lists its objects ({objects: {id: {class, name, files: {role: {asset, size}}}}}),
//                                  fetched the same way.
//   new AssetStore({ text, bytes, objects, info })   in memory: path -> string, path -> Uint8Array / ArrayBuffer, and
//                                  object id -> {class, name, files: {role: string | Uint8Array | ArrayBuffer}}.
// Text files are the .json and .glsl files; every other file is binary. An object's file is text when its asset is a
// .json or .glsl asset (in memory: when it is given as a string).
//
// Objects (docs/data-format.md "Objects"): an object id is "<serialized file>:<pathId>", the path id in decimal. Every
// object has a `json` file; a reference in it, {"$ref": {"file", "pathId"}}, names the object "<file>:<pathId>"
// (refId). The typed readers (prefab, material, clip, mono, texture) check the object's class.

// the schema of a product manifest
export const PRODUCT_MANIFEST = "nnnotes.product/1";

export const TEXT_FILE = /\.(json|glsl)$/;
// the assets whose bytes are text: a .json or .glsl asset, encoded or not
export const TEXT_ASSET = /\.(json|glsl)(\.(gz|br))?$/;

const entries = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m || {}));

// The object id a reference names: {"$ref": {file, pathId}} -> "<file>:<pathId>"; null for a null reference.
export const refId = (v) => {
  if (v === null || v === undefined) return null;
  const r = v.$ref;
  if (!r || typeof r.file !== "string" || typeof r.pathId !== "string")
    throw new Error(`not a reference to an object of a known file: ${JSON.stringify(v)}`);
  return `${r.file}:${r.pathId}`;
};

// A byte array as an object stores it ({"$hex": "<two hex digits per byte>"}) -> Uint8Array.
export const hexBytes = (v) => {
  const h = v && v.$hex;
  if (typeof h !== "string" || h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error(`not a byte array: ${JSON.stringify(v)}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

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
  // text: path -> string; bytes: path -> Uint8Array | ArrayBuffer; objects: object id -> {class, name, files: role ->
  // string | Uint8Array | ArrayBuffer}; info: the manifest without `files` and `objects` (or null)
  constructor({ text = {}, bytes = {}, objects = {}, info = null } = {}) {
    this._text = new Map(entries(text));
    this._bin = new Map();
    for (const [p, b] of entries(bytes)) this._bin.set(p, b instanceof Uint8Array ? b : new Uint8Array(b));
    this._objects = new Map();
    for (const [id, o] of entries(objects)) {
      if (!o || typeof o.class !== "string") throw new Error(`object ${id}: no class`);
      const files = new Map();
      for (const [role, f] of entries(o.files))
        files.set(role, typeof f === "string" || f instanceof Uint8Array ? f : new Uint8Array(f));
      if (!files.has("json")) throw new Error(`object ${id}: no json file`);
      this._objects.set(id, { class: o.class, name: o.name ?? null, files });
    }
    this._parsed = new Map();          // "<id>#<role>" -> the parsed JSON of an object's file
    this._sprites = new Map();         // id -> sprite()
    this._meshes = new Map();          // id -> mesh()
    this._contained = new Map();       // serialized file -> pathId -> contained()
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
      if (!man || typeof man.files !== "object") throw new Error(`${manifestUrl.href}: not a manifest`);
      if (man.objects !== undefined && (!man.objects || typeof man.objects !== "object"))
        throw new Error(`${manifestUrl.href}: objects is not an object table`);
      // every file to fetch: [where, entry]; an object's file is "<id>#<role>"
      const slots = Object.entries(man.files);
      for (const [id, o] of Object.entries(man.objects || {}))
        for (const [role, f] of Object.entries((o && o.files) || {})) slots.push([`${id}#${role}`, f]);
      const jobs = new Map();                                // asset -> {size, stored, path}: each asset fetched once
      for (const [path, f] of slots) {
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
            try { buf = u8(await decode(raw, encoding)); } catch (e) { throw new Error(`${j.path}: ${asset}: ${e.message}`, { cause: e }); }
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
      const enc = new TextEncoder();
      // a file's text (`asText`, a rebuilt file always) or bytes
      const content = (path, f, asText) => {
        if (f.parts) {
          const t = `{${f.parts.map(([k, asset]) => `${JSON.stringify(k)}:${dec.decode(got.get(asset))}`).join(",")}}`;
          if (enc.encode(t).byteLength !== f.size) throw new Error(`${path}: rebuilt text is not ${f.size} bytes`);
          return t;
        }
        return asText ? dec.decode(got.get(f.asset)) : got.get(f.asset);
      };
      const text = new Map(), bin = new Map();
      for (const [path, f] of Object.entries(man.files)) {
        const c = content(path, f, TEXT_FILE.test(path));
        if (typeof c === "string") text.set(path, c); else bin.set(path, c);
      }
      const objects = {};
      for (const [id, o] of Object.entries(man.objects || {})) {
        const files = {};
        for (const [role, f] of Object.entries(o.files || {}))
          files[role] = content(`${id}#${role}`, f, TEXT_ASSET.test(f.asset ?? ""));
        objects[id] = { class: o.class, name: o.name, files };
      }
      const { files: _files, objects: _objects, ...info } = man;
      return new AssetStore({ text, bytes: bin, objects, info });
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

  // ---- objects

  hasObject(id) { return this._objects.has(id); }

  // {id, class, name} of an object; `cls`: the class it must have
  object(id, cls = null) {
    const o = this._objects.get(id);
    if (!o) throw new Error(`object not found: ${id}`);
    if (cls !== null && o.class !== cls) throw new Error(`${id}: a ${o.class}, not a ${cls}`);
    return { id, class: o.class, name: o.name };
  }

  // the roles of an object's files (json, image, index, program:..., blob:...)
  roles(id) {
    const o = this._objects.get(id);
    if (!o) throw new Error(`object not found: ${id}`);
    return [...o.files.keys()];
  }

  _file(id, role) {
    const o = this._objects.get(id);
    if (!o) throw new Error(`object not found: ${id}`);
    const f = o.files.get(role);
    if (f === undefined) throw new Error(`${id} (${o.class}${o.name ? ` ${o.name}` : ""}): no ${role} file`);
    return f;
  }

  objectText(id, role) {
    const f = this._file(id, role);
    return typeof f === "string" ? f : new TextDecoder("utf-8").decode(f);
  }

  // the parsed JSON of an object's file, parsed once and shared: callers do not modify it
  objectJson(id, role = "json") {
    const k = `${id}#${role}`;
    let v = this._parsed.get(k);
    if (v === undefined) { v = JSON.parse(this.objectText(id, role)); this._parsed.set(k, v); }
    return v;
  }

  // a copy (callers may transfer or detach it)
  objectBytes(id, role) {
    const f = this._file(id, role);
    return typeof f === "string" ? new TextEncoder().encode(f) : f.slice();
  }

  // an image file of an object, decoded as image() decodes a PNG
  async objectImage(id, role = "image") {
    const blob = new Blob([this.objectBytes(id, role)], { type: "image/png" });
    return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "flipY" });
  }

  // the object a reference value names (refId), checked to be in the store and of class `cls` when given; null for a
  // null reference
  ref(v, cls = null) {
    const id = refId(v);
    if (id !== null) this.object(id, cls);
    return id;
  }

  // ---- typed readers: an object's JSON, its class checked (shared: callers do not modify it)

  // a root GameObject's prefab.json: {name, nodes: [{path, name, pathId, active, layer, localPosition, localRotation,
  // localScale, components: [{type, pathId, script, fields}]}]}
  prefab(id) { this.object(id, "GameObject"); return this.objectJson(id); }

  // material.json: {material, shader (a reference), keywords, floats, colors, textures, ...}
  material(id) { this.object(id, "Material"); return this.objectJson(id); }

  // clip.json: the Mecanim clip data and its bindings as stored
  clip(id) { this.object(id, "AnimationClip"); return this.objectJson(id); }

  // mono.json: a MonoBehaviour outside a hierarchy: {$script, m_Name, ...its fields}
  mono(id) { this.object(id, "MonoBehaviour"); return this.objectJson(id); }

  // a Texture2D: {id, name, width, height, mipCount, colorSpace, settings} from its typetree; its pixels are
  // objectImage(id)
  texture(id) {
    this.object(id, "Texture2D");
    const t = this.objectJson(id);
    return { id, name: t.m_Name, width: t.m_Width, height: t.m_Height, mipCount: t.m_MipCount,
             colorSpace: t.m_ColorSpace, settings: t.m_TextureSettings };
  }

  // A Sprite as it is drawn from its render data (sprite.json: the typetree `sprite`, its render mesh `mesh`, the
  // render data `renderData`; a sprite packed by a SpriteAtlas of another file has no `renderData`: its render data is
  // the atlas' m_RenderDataMap entry under the sprite's m_RenderDataKey, as the engine reads it at run time):
  // {id, name, texture (texture() of the page it is drawn from), rect, pivot, border,
  // pixelsToUnits, offset, textureRect, textureRectOffset, atlasRectOffset, downscaleMultiplier, settingsRaw,
  // uvTransform, vertices, uv, indices}. The texture coordinates of a vertex p are ((p.x * uvTransform.x +
  // uvTransform.y) / width, (p.y * uvTransform.z + uvTransform.w) / height) of the page, in float32; vertices, uv and
  // indices are null for a sprite without a render mesh. Made once and shared: callers do not modify it.
  // the render data of sprite `id` (typetree `t`) in its SpriteAtlas (m_SpriteAtlas): the m_RenderDataMap entry whose
  // key is the sprite's m_RenderDataKey
  _atlasRenderData(id, t) {
    if (!t.m_SpriteAtlas) throw new Error(`sprite ${id} (${t.m_Name}): no render data and no atlas`);
    const atlas = this.objectJson(this.ref(t.m_SpriteAtlas, "SpriteAtlas")), key = JSON.stringify(t.m_RenderDataKey);
    const e = atlas.m_RenderDataMap.find(([k]) => JSON.stringify(k) === key);
    if (!e) throw new Error(`sprite ${id} (${t.m_Name}): not in the render data of atlas ${atlas.m_Name}`);
    return e[1];
  }

  sprite(id) {
    this.object(id, "Sprite");
    let s = this._sprites.get(id);
    if (s) return s;
    const j = this.objectJson(id), t = j.sprite, rd = j.renderData ?? this._atlasRenderData(id, t), ut = rd.uvTransform;
    const tex = this.texture(this.ref(rd.texture, "Texture2D")), f = Math.fround;
    const m = j.mesh;
    if (m && m.submeshes.length !== 1) throw new Error(`sprite ${id} (${t.m_Name}): ${m.submeshes.length} submeshes`);
    s = { id, name: t.m_Name, texture: tex, rect: t.m_Rect, pivot: t.m_Pivot, border: t.m_Border,
          pixelsToUnits: t.m_PixelsToUnits, offset: t.m_Offset, textureRect: rd.textureRect,
          textureRectOffset: rd.textureRectOffset, atlasRectOffset: rd.atlasRectOffset,
          downscaleMultiplier: rd.downscaleMultiplier, settingsRaw: rd.settingsRaw, uvTransform: ut,
          vertices: m ? m.positions : null,
          uv: m ? m.positions.map((p) => [f(f(f(p[0] * ut.x) + ut.y) / tex.width), f(f(f(p[1] * ut.z) + ut.w) / tex.height)]) : null,
          indices: m ? m.submeshes[0].flat() : null };
    this._sprites.set(id, s);
    return s;
  }

  // A Mesh in Unity's space, from its `arrays` file: {id, name, vertices, normals, tangents, colors, uv0 .. uv7 (each
  // [[...]] per vertex, absent channels null), submeshes (the triangle indices of each submesh, flat; a submesh of
  // another topology is an error), skin ({joints, weights}: four per vertex, or null), bindPoses (the typetree's
  // m_BindPose)}. Made once and shared.
  mesh(id) {
    const o = this.object(id, "Mesh");
    let m = this._meshes.get(id);
    if (m) return m;
    const a = this.objectJson(id, "arrays"), t = this.objectJson(id);
    const tris = (s, i) => {
      if (s.topology !== "triangles" || !s.indices) throw new Error(`mesh ${id} (${o.name}): submesh ${i} is ${s.topology}`);
      return s.indices.flat();
    };
    m = { id, name: o.name, vertices: a.positions, submeshes: a.submeshes.map(tris),
          skin: a.joints ? { joints: a.joints, weights: a.weights } : null, bindPoses: t.m_BindPose || [] };
    for (const k of ["normals", "tangents", "colors", "uv0", "uv1", "uv2", "uv3", "uv4", "uv5", "uv6", "uv7"]) m[k] = a[k] ?? null;
    this._meshes.set(id, m);
    return m;
  }

  // controller.json: the AnimatorController's layers, state machines and parameters; `clips` are references
  controller(id) { this.object(id, "AnimatorController"); return this.objectJson(id); }

  // The node of a prefab that a reference names when it is not an object of the store: a GameObject or a component
  // inside a root GameObject's prefab.json of the same serialized file: {prefab (the root GameObject id), path (the
  // node's path), component (the prefab.json component, null for a GameObject)}.
  contained(v) {
    const r = v && v.$ref;
    if (!r || typeof r.file !== "string" || typeof r.pathId !== "string") throw new Error(`not a reference: ${JSON.stringify(v)}`);
    let byId = this._contained.get(r.file);
    if (!byId) {
      byId = new Map();
      for (const [id, o] of this._objects) {
        if (o.class !== "GameObject" || !id.startsWith(`${r.file}:`)) continue;
        for (const n of this.prefab(id).nodes) {
          byId.set(n.pathId, { prefab: id, path: n.path, component: null });
          for (const c of n.components) byId.set(c.pathId, { prefab: id, path: n.path, component: c });
        }
      }
      this._contained.set(r.file, byId);
    }
    const hit = byId.get(r.pathId);
    if (!hit) throw new Error(`${r.file}:${r.pathId}: in no prefab of the store`);
    return hit;
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
