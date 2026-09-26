// Binary glTF 2.0 (.glb) reading for the spot room (SpotBackground prefab): the JSON and BIN chunks, accessors, the
// embedded images and samplers, and the room meshes back in Unity space.
//
// The room file bakes every drawn MeshRenderer of the background prefab into the prefab's space and writes it as glTF:
// z negated (Unity's left-handed space to glTF's right-handed one), each triangle's winding reversed and the uv v
// flipped (glTF's top-left texture origin). roomMeshes() undoes the three so that the game's own shaders draw the
// meshes with Unity's matrices, front-face convention and bottom-left texture origin. Nodes carry no transform;
// `extras.unityActive` is the object's activeInHierarchy in the prefab.

const GLB_MAGIC = 0x46546c67;             // "glTF"
const CHUNK_JSON = 0x4e4f534a;            // "JSON"
const CHUNK_BIN = 0x004e4942;             // "BIN\0"
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const TRIANGLES = 4;

// {json, bin}: the parsed JSON chunk and the BIN chunk bytes (null when absent)
export const parseGlb = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 20) throw new Error("glb: file too short");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("glb: not a binary glTF file");
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`glb: container version ${version}`);
  const total = dv.getUint32(8, true);
  if (total > u8.byteLength) throw new Error(`glb: header length ${total} exceeds the file (${u8.byteLength} bytes)`);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (off + 8 + len > total) throw new Error("glb: chunk runs past the end of the file");
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON && json === null) json = JSON.parse(new TextDecoder("utf-8").decode(body));
    else if (type === CHUNK_BIN && bin === null) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error("glb: no JSON chunk");
  return { json, bin };
};

// The bytes of a buffer view (the BIN chunk is buffer 0)
export const bufferViewBytes = (glb, index) => {
  const bv = glb.json.bufferViews && glb.json.bufferViews[index];
  if (!bv) throw new Error(`glb: buffer view ${index} missing`);
  if ((bv.buffer ?? 0) !== 0 || !glb.bin) throw new Error(`glb: buffer view ${index} is not in the BIN chunk`);
  const start = bv.byteOffset || 0;
  if (start + bv.byteLength > glb.bin.byteLength) throw new Error(`glb: buffer view ${index} out of range`);
  return glb.bin.subarray(start, start + bv.byteLength);
};

// An accessor's values as a fresh typed array (tightly packed, not normalized)
export const readAccessor = (glb, index) => {
  const a = glb.json.accessors && glb.json.accessors[index];
  if (!a) throw new Error(`glb: accessor ${index} missing`);
  const T = TYPED[a.componentType], n = COMPONENTS[a.type];
  if (!T || !n) throw new Error(`glb: accessor ${index} type ${a.type} / ${a.componentType}`);
  if (a.sparse) throw new Error(`glb: sparse accessor ${index}`);
  const bv = glb.json.bufferViews[a.bufferView];
  const elem = n * T.BYTES_PER_ELEMENT;
  if (bv.byteStride && bv.byteStride !== elem) throw new Error(`glb: interleaved accessor ${index}`);
  const view = bufferViewBytes(glb, a.bufferView), start = a.byteOffset || 0, size = a.count * elem;
  if (start + size > view.byteLength) throw new Error(`glb: accessor ${index} out of range`);
  const out = new T(a.count * n);
  new Uint8Array(out.buffer).set(view.subarray(start, start + size));
  return out;
};

// glTF -> Unity: z negated
const unityPositions = (p) => {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { out[i] = p[i]; out[i + 1] = p[i + 1]; out[i + 2] = -p[i + 2]; }
  return out;
};

// glTF -> Unity: v = 1 - v
const unityUvs = (uv) => {
  const out = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) { out[i] = uv[i]; out[i + 1] = Math.fround(1 - uv[i + 1]); }
  return out;
};

// glTF -> Unity: the second and third index of each triangle swapped back
const unityIndices = (idx) => {
  if (idx.length % 3) throw new Error("glb: index count is not a multiple of 3");
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) { out[i] = idx[i]; out[i + 1] = idx[i + 2]; out[i + 2] = idx[i + 1]; }
  return out;
};

// The Unity-space box of a position accessor, from its min / max (z negated, so min and max swap)
const unityBounds = (a) => {
  if (!a.min || !a.max) return null;
  const min = { x: a.min[0], y: a.min[1], z: -a.max[2] }, max = { x: a.max[0], y: a.max[1], z: -a.min[2] };
  return { min, max, center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
};

// Per node in glb order: {name, active, bounds, primitives: [{positions, uvs, indices, material, vertexCount}]}, all in
// Unity space. Primitives of one mesh share their position / uv arrays (one submesh each, as the room file writes
// them). `bounds` is the box of the node's positions (the room's nodes have no transform, so it is prefab space).
export const roomMeshes = (glb) => {
  const J = glb.json, conv = new Map();
  const once = (index, fn) => {
    if (!conv.has(index)) conv.set(index, fn(readAccessor(glb, index)));
    return conv.get(index);
  };
  return (J.nodes || []).map((node, i) => {
    if (node.mesh === undefined) throw new Error(`glb: node ${i} has no mesh`);
    if (node.matrix || node.translation || node.rotation || node.scale || (node.children && node.children.length))
      throw new Error(`glb: node ${i} has a transform or children (the room file bakes every mesh)`);
    const mesh = J.meshes[node.mesh];
    let bounds = null;
    const primitives = mesh.primitives.map((p, k) => {
      if ((p.mode ?? TRIANGLES) !== TRIANGLES) throw new Error(`glb: ${mesh.name} primitive ${k} mode ${p.mode}`);
      const pos = p.attributes.POSITION, uv = p.attributes.TEXCOORD_0;
      if (pos === undefined || uv === undefined || p.indices === undefined)
        throw new Error(`glb: ${mesh.name} primitive ${k} lacks POSITION / TEXCOORD_0 / indices`);
      const b = unityBounds(J.accessors[pos]);
      if (b) bounds = bounds ? mergeBounds(bounds, b) : b;
      const positions = once(pos, unityPositions);
      return { positions, uvs: once(uv, unityUvs), indices: unityIndices(readAccessor(glb, p.indices)),
               material: p.material ?? null, vertexCount: positions.length / 3, positionAccessor: pos, uvAccessor: uv };
    });
    const extras = node.extras || {};
    return { name: node.name ?? mesh.name, active: extras.unityActive !== false, bounds, primitives };
  });
};

const mergeBounds = (a, b) => {
  const min = { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) };
  const max = { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) };
  return { min, max, center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
};

// {bytes, mimeType, name} of image `index` (embedded in a buffer view)
export const imageBytes = (glb, index) => {
  const im = glb.json.images && glb.json.images[index];
  if (!im) throw new Error(`glb: image ${index} missing`);
  if (im.bufferView === undefined) throw new Error(`glb: image ${index} is not embedded`);
  return { bytes: bufferViewBytes(glb, im.bufferView), mimeType: im.mimeType || "image/png", name: im.name || `image${index}` };
};

// {source, sampler} of texture `index`; the sampler holds the GL enums the room file writes (glTF sampler values)
export const textureInfo = (glb, index) => {
  const t = glb.json.textures && glb.json.textures[index];
  if (!t) throw new Error(`glb: texture ${index} missing`);
  const s = t.sampler !== undefined ? glb.json.samplers[t.sampler] : {};
  return { source: t.source, sampler: { magFilter: s.magFilter ?? 9729, minFilter: s.minFilter ?? 9987,
                                         wrapS: s.wrapS ?? 10497, wrapT: s.wrapT ?? 10497 } };
};
