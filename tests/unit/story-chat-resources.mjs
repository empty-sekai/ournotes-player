import { Prefab } from "../../src/engine/prefab.js";
import { nativeComponent } from "./story-screen-resources.mjs";

export const chatWidgetPrefab = (widget) => {
  const first = widget.nodes[0], parent = first.path.slice(0, first.path.lastIndexOf("/"));
  const roots = parent ? [{ ...first, path: parent, name: parent.split("/").at(-1), components: [], rect: undefined }] : [];
  return new Prefab({ key: "chat-widget", nodes: [...roots, ...widget.nodes.map((n) => {
  const components = [];
  const add = (cls, fields) => { if (fields) components.push(nativeComponent({ ...fields, class: cls })); };
  add("Canvas", n.canvas); add("CanvasScaler", n.canvasScaler); add("CanvasGroup", n.canvasGroup);
  if (n.chatView) add("AdvChatView", { ...n.chatView, _windowParentRect: { transform: n.chatView._windowParentRect } });
  return { ...n, components };
})] });
};

export const chatResources = (ctx, doc, widget = null) => {
  const docs = Object.fromEntries(Object.entries(doc.windows).map(([name, p]) =>
    [name, { ...p, nodes: p.nodes.map((n) => ({ ...n, components: n.components.map(nativeComponent) })) }]));
  const prefabs = new Map(), sprites = new Map();
  ctx.data = { story: { chats: doc.chats }, ui: { chatWidget: widget ? "fixture:widget" : null },
    asset: (address) => {
      const m = /^Adv\/Chat\/(Prefabs|Icon|Stamp)\/(.+)$/.exec(address);
      const rec = m && (m[1] === "Prefabs" ? docs : m[1] === "Icon" ? doc.icons : doc.stamps)[m[2]];
      if (!rec) throw new Error(`${address}: not in the chat data`);
      return { objects: [m[1] === "Prefabs" ? m[2] : rec] };
    } };
  ctx.assets = { prefab: (id) => docs[id] };
  ctx.objects = {
    prefab: (id) => {
      if (!prefabs.has(id)) prefabs.set(id, id === "fixture:widget" ? chatWidgetPrefab(widget) : new Prefab(docs[id]));
      return prefabs.get(id);
    },
    sprite: (s) => {
      if (!s) return null;
      if (!sprites.has(s)) sprites.set(s, { ...s, id: s.sprite, texture: { ...s.texture, id: s.texture.texture } });
      return sprites.get(s);
    },
  };
};
