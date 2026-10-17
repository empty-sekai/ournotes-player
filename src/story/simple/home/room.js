import { mat4 } from "../../../engine/math.js";
import { roomMeshes } from "./glb.js";

// The spot room (the background prefab's MeshRenderers, host/spot/room.glb) as the main camera draws it: which
// renderers are drawn (activeInHierarchy after SpotBackground.Prepare, host.json roomNodes), their materials as saved
// (roomMaterials, run with the game's shaders), the render queue of each (the material's, or the shader's Queue tag,
// with SpotSceneRoot.SetObject's floor override) and URP's opaque / transparent ordering. The helpers here need no
// WebGL context; host.js uploads and draws.

// SubShader "Queue" tag names (UnityEngine.Rendering.RenderQueue)
export const QUEUE_NAMES = Object.freeze({ background: 1000, geometry: 2000, alphatest: 2450, transparent: 3000, overlay: 4000 });
export const OPAQUE_MAX_QUEUE = 2500;     // RenderQueueRange.opaque = 0..2500; transparent = 2501..5000
// the pass tags URP's forward renderer draws (DrawObjectsPass shader tag ids, in order); a pass without a LightMode
// tag counts as SRPDefaultUnlit
export const FORWARD_LIGHT_MODES = Object.freeze(["srpdefaultunlit", "universalforward", "universalforwardonly"]);

const tagsOf = (t) => (t && Array.isArray(t.tags) ? t.tags : Array.isArray(t) ? t : []);
const tag = (tags, key) => {
  const hit = tagsOf(tags).find(([k]) => String(k).toLowerCase() === key);
  return hit ? String(hit[1]) : null;
};

// "Transparent", "Geometry+1", "AlphaTest-10", or a number
export const parseQueueTag = (v) => {
  if (v === null || v === undefined) return QUEUE_NAMES.geometry;
  const m = /^\s*([A-Za-z]+)?\s*([+-]\s*\d+)?\s*$/.exec(String(v));
  if (!m) throw new Error(`render queue tag '${v}'`);
  if (!m[1]) return Number(m[2].replace(/\s/g, ""));
  const base = QUEUE_NAMES[m[1].toLowerCase()];
  if (base === undefined) throw new Error(`render queue tag '${v}'`);
  return base + (m[2] ? Number(m[2].replace(/\s/g, "")) : 0);
};

// Parsed shader objects addressed by id, with the product's Shader.Find name table.
export class ShaderInfo {
  constructor(objects) { this.objects = objects; }

  has(name) { return !!this.objects.shaderNames[name] || this.objects.assets.hasObject(name); }

  info(name) {
    return this.objects.shaderInfo(this.objects.shaderNames[name] || name);
  }

  // the SubShader URP uses: the first whose RenderPipeline tag is absent or UniversalPipeline
  subShader(name) {
    const i = this.info(name).subShaders.findIndex((ss) => {
      const rp = tag(ss.tags, "renderpipeline");
      return rp === null || rp.toLowerCase() === "universalpipeline";
    });
    if (i < 0) throw new Error(`${name}: no SubShader for the Universal pipeline`);
    return i;
  }

  // Material.renderQueue with m_CustomRenderQueue -1: the SubShader's Queue tag
  queue(name) { return parseQueueTag(tag(this.info(name).subShaders[this.subShader(name)].tags, "queue")); }

  // the passes URP's forward renderer draws for this shader, in the order of its shader tag ids
  forwardPasses(name) {
    const passes = this.info(name).subShaders[this.subShader(name)].passes;
    const mode = (p) => (tag(p.tags, "lightmode") ?? tag(p.state && p.state.m_Tags, "lightmode") ?? "SRPDefaultUnlit").toLowerCase();
    const out = [];
    for (const m of FORWARD_LIGHT_MODES) passes.forEach((p, i) => { if (mode(p) === m) out.push(i); });
    if (!out.length) throw new Error(`${name}: no pass URP's forward renderer draws`);
    return out;
  }
}

// A material record of host.json (roomMaterials / spineMaterials): its render queue
export const materialQueue = (mat, shaders) => (mat.renderQueue >= 0 ? mat.renderQueue : shaders.queue(mat.shader));

// URP's draw order of one camera: the opaque list (queue <= 2500; SortingCriteria.CommonOpaque: sorting order, render
// queue, front to back) then the transparent list (CommonTransparent: sorting order, render queue, back to front).
// Items: {queue, sortingOrder, dist, index}; `index` keeps equal keys in a stable order.
// ENGINE: the opaque sort's quantized depth and state-change grouping are native; plain front-to-back distance here.
export const sortDrawItems = (items) => {
  const opaque = items.filter((it) => it.queue <= OPAQUE_MAX_QUEUE), transparent = items.filter((it) => it.queue > OPAQUE_MAX_QUEUE);
  const key = (a, b) => (a.sortingOrder - b.sortingOrder) || (a.queue - b.queue);
  opaque.sort((a, b) => key(a, b) || (a.dist - b.dist) || (a.index - b.index));
  transparent.sort((a, b) => key(a, b) || (b.dist - a.dist) || (a.index - b.index));
  return [...opaque, ...transparent];
};

const distance = (M, c, cam) => {
  const p = mat4.transformPoint(M, c);
  return Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
};

// Room geometry and its summary share node and material order. The host supplies activation and queue overrides.
export class SpotRoom {
  constructor(glb, summary, state, objects, shaders) {
    this.glb = glb;
    this.meshes = roomMeshes(glb);
    const nodes = summary.nodes.map(({ path }) => {
      if (!state.nodes[path]) throw new Error(`room node ${path}: no background state`);
      return { path, ...state.nodes[path] };
    });
    const mats = summary.materialIds.map((id) => objects.material(id));
    if (!Array.isArray(nodes) || nodes.length !== this.meshes.length)
      throw new Error(`room nodes: ${nodes.length} entries for ${this.meshes.length} glb nodes`);
    const glbMats = glb.json.materials || [];
    if (!Array.isArray(mats) || mats.length !== glbMats.length)
      throw new Error(`room materials: ${mats.length} entries for ${glbMats.length} glb materials`);
    mats.forEach((m, i) => {
      if (glbMats[i].name !== undefined && m.material !== glbMats[i].name)
        throw new Error(`room material ${m.material} is not glb material ${glbMats[i].name}`);
      if (!shaders.has(m.shader)) throw new Error(`room material ${m.material}: shader ${m.shader} not packed`);
    });
    this.materials = mats;
    this.nodes = nodes;
    this.shaders = shaders;
    // per primitive: its queue. The floor override is Renderer.material.renderQueue = 2000: the first material slot's
    // instance, i.e. the node's first primitive
    this.parts = [];
    this.meshes.forEach((m, n) => {
      m.primitives.forEach((p, k) => {
        if (p.material === null) throw new Error(`room node ${m.name}: primitive without material`);
        const mat = mats[p.material];
        const override = k === 0 && nodes[n].renderQueue !== null && nodes[n].renderQueue !== undefined ? nodes[n].renderQueue : null;
        this.parts.push({ node: n, prim: k, primitive: p, material: mat, queue: override ?? materialQueue(mat, shaders),
                          passes: shaders.forwardPasses(mat.shader), subShader: shaders.subShader(mat.shader) });
      });
    });
  }

  // renderers drawn: activeInHierarchy after SpotBackground.Prepare (roomNodes[i].active)
  visible(n) { return !!this.nodes[n].active; }

  // draw items for the camera at world position `cam`, with the background root's localToWorld `M`: the room's
  // renderers have no transform of their own, so every one is drawn with M; the distance is to the renderer's bounds
  // centre. ({part, queue, sortingOrder, dist, index})
  // ENGINE: Renderer.bounds (world box of the mesh's local box) is native; the box of the baked vertices stands in for it.
  // (The room file bakes each mesh into prefab space; both boxes have the same centre for rectangular cards.)
  drawItems(M, cam) {
    const out = [];
    this.parts.forEach((part, index) => {
      if (!this.visible(part.node)) return;
      const b = this.meshes[part.node].bounds;
      out.push({ part, queue: part.queue, sortingOrder: 0, dist: b ? distance(M, b.center, cam) : 0, index });
    });
    return out;
  }
}
