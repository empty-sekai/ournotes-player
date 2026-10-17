import { AnimClip, AnimController } from "../../src/engine/anim.js";
import { Prefab } from "../../src/engine/prefab.js";

let componentId = 1;
export const nativeComponent = ({ type = "MonoBehaviour", class: cls, ...fields }) => fields.fields
  ? { type, ...fields } : { type, pathId: String(componentId++), ...(cls ? { script: `Test||${cls}` } : {}), fields };

// Resource doubles shared by the screen's behavioral tests. Each product owns a separate prefab.
export const screenResources = (ctx, widget, products = {}) => {
  const materials = new Map(), sprites = new Map(), prefabs = new Map();
  const paths = (v) => {
    if (typeof v === "string" && v.startsWith("UIAdvWidget/")) return { gameObject: v };
    if (Array.isArray(v)) return v.map(paths);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paths(x)]));
    return v;
  };
  const node = (path, components = []) => ({ path, name: path.split("/").at(-1), active: true,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, components });
  const nodes = widget.nodes.map((n) => {
    const cs = [];
    const add = (cls, fields) => { if (fields) cs.push(nativeComponent({ ...fields, class: cls })); };
    if (n.canvas) add("Canvas", { ...n.canvas, m_Camera: n.canvas.camera ? { gameObject: n.canvas.camera } : null });
    add(n.canvasScaler?.class || "CanvasScaler", n.canvasScaler);
    add("CanvasGroup", n.canvasGroup);
    if (n.image) add("Image", { ...n.image, m_Sprite: n.image.sprite ? widget.sprites[n.image.sprite] : null,
      m_Material: n.image.material ? widget.materials[n.image.material] : null });
    if (n.rawImage) add("RawImage", { ...n.rawImage, m_Material: n.rawImage.material });
    add("AdvStillView", paths(n.stillView)); add("AdvVideoView", paths(n.videoView));
    return { ...n, components: cs };
  });
  nodes.unshift(node("UIAdvWidget", [nativeComponent({ class: "UIAdvWidget",
    _videoAndStillCamera: { gameObject: widget.videoAndStillCamera.path },
    _videoAndStillScreenImage: { gameObject: widget.videoAndStillScreenImage } })]));
  const cam = widget.videoAndStillCamera;
  nodes.push(node(cam.path, [nativeComponent({ type: "Camera", ...cam.camera }),
    nativeComponent({ class: "UniversalAdditionalCameraData", ...cam.additionalCameraData })]));
  for (const n of widget.nodes) {
    const path = n.canvas?.camera;
    if (path && !nodes.some((r) => r.path === path)) nodes.push(node(path));
  }
  const docs = { "fixture:widget": { key: "widget", nodes } };
  const manager = [node("UIManager")];
  if (widget.uiCamera) manager.push(node("UIManager/UICamera", [nativeComponent({ type: "Camera", ...widget.uiCamera.camera })]));
  docs["fixture:manager"] = { key: "manager", nodes: manager };
  for (const [key, doc] of Object.entries(products))
    docs[`fixture:${key}`] = { ...doc, nodes: doc.nodes.map((n) => ({ ...n, components: n.components.map(nativeComponent) })) };
  const objects = {
    prefab: (id) => {
      if (!prefabs.has(id)) { const p = new Prefab(docs[id]); p.ids = [id]; prefabs.set(id, p); }
      return prefabs.get(id);
    },
    id: (v) => v,
    sprite: (s) => {
      if (!s) return null;
      if (!sprites.has(s)) {
        const tex = typeof s.texture === "string" ? widget.textures[s.texture] : s.texture;
        sprites.set(s, { ...s, id: s.sprite || s.name || "sprite", name: s.sprite || s.name,
          texture: { ...tex, id: tex.texture, wrapU: tex.settings?.m_WrapU ?? 1, wrapV: tex.settings?.m_WrapV ?? 1 } });
      }
      return sprites.get(s);
    },
    material: (m) => {
      if (!m) return null;
      if (!materials.has(m)) materials.set(m, { ...m, id: m.material, shader: m.shader.shader,
        textures: Object.fromEntries(Object.entries(m.textures || {}).map(([k, t]) => [k,
          { ...t, texture: t.texture ? { ...t.texture, id: t.texture.texture } : null }])) });
      return materials.get(m);
    },
    mesh: (m) => m,
    controller: (raw) => {
      if (!raw) return null;
      const clips = new Map();
      const visit = (v) => {
        if (!v || typeof v !== "object") return;
        if (v.clip && v.bindings) clips.set(v.clip, v);
        for (const x of Object.values(v)) visit(x);
      };
      visit(products);
      return AnimController.fromMecanim(raw, (c) => AnimClip.fromMecanim(clips.get(c.clip), c.clip));
    },
  };
  const previous = ctx.data;
  ctx.data = { ...previous, ui: { widget: "fixture:widget", uiManager: "fixture:manager" },
    asset: (address) => {
      const key = `fixture:${address.replace(/^Adv\/(Frame|Still)\//, "")}`;
      if (!docs[key]) throw new Error(`${address}: not in the story data`);
      return { objects: [key] };
    } };
  ctx.assets = { ...ctx.assets, prefab: (id) => docs[id] };
  ctx.objects = objects;
  return objects;
};
