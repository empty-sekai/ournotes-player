import { componentClass } from "../engine/prefab.js";
import { UINode, UIError } from "../engine/ugui.js";

const TEXT_CLASSES = new Set(["TextMeshProUGUI", "RubyTextMeshProUGUI", "RubyEmojiTextMeshProUGUI"]);

// Instantiate a prefab subtree as UI nodes. Source component ids and source paths remain available after parenting.
export const uiTree = (objects, id, { root = null, parent = null, nodes = new Map(), Node = UINode, include = null } = {}) => {
  const prefab = objects.prefab(id), source = root || prefab.root.name;
  const destination = parent ? `${parent.path}/${source.split("/").at(-1)}` : source;
  const pathOf = (path) => path === source ? destination : path.startsWith(`${source}/`)
    ? destination + path.slice(source.length) : path;
  for (const [path, entry] of prefab.nodes) {
    if (path !== source && !path.startsWith(`${source}/`)) continue;
    if (include && !include(path, entry.node)) continue;
    const mapped = pathOf(path), p = path === source ? parent : nodes.get(mapped.slice(0, mapped.lastIndexOf("/")));
    if (nodes.has(mapped)) throw new UIError(`${mapped}: duplicate UI node`);
    const n = new Node({ ...entry.node, path: mapped }, p);
    n.prefabId = id;
    n.sourcePath = path;
    n.ref = (ref) => ref ? nodes.get(pathOf(prefab.pathOf(ref))) || null : null;
    n.componentId = (c) => `${id.slice(0, id.lastIndexOf(":"))}:${c.pathId}`;
    nodes.set(mapped, n);
  }
  return nodes.get(destination);
};

// Text components keep their serialized TMP fields; the language product supplies the font/material binding.
export const uiTextBinding = (node, fonts) => {
  const c = node.rec.components.find((x) => TEXT_CLASSES.has(componentClass(x)));
  if (!c) return null;
  const id = node.componentId(c), binding = fonts.texts[id];
  if (!binding) throw new UIError(`${node.path}: no font binding for ${id}`);
  const t = c.fields, cls = componentClass(c);
  const sprite = fonts.sprites?.[id]?.spriteAsset || null;
  return { ...t, id, class: cls, enabled: !!t.m_Enabled, localized: binding.font,
    spriteAsset: sprite, localizeKoreanAdjust: binding.localizeKoreanAdjust,
    ruby: cls.includes("Ruby") ? t : null, uiRubyText: node.fields("UIRubyText") };
};
