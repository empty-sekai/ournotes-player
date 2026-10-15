import { Transform } from "./math.js";

// Prefab: Transform hierarchy and component lookup over an exported prefab node list
// (hierarchy order, local TRS, components in GameObject order).

// the class of a script "assembly|namespace|class" (a prefab.json component's `script`, a MonoBehaviour object's
// `$script`)
export const scriptClass = (script) => script.slice(script.lastIndexOf("|") + 1);

// A component's class: a MonoBehaviour's script class (prefab.json `script`; the `class` of a component in a story
// file), else the component's type.
export const componentClass = (c) => (typeof c.script === "string" ? scriptClass(c.script) : (c.class || c.type));

export class Prefab {
  // exported: {key, nodes}
  constructor(exported) {
    this.key = exported.key;
    this.nodes = new Map();          // path -> {node, transform}
    this.roots = [];
    for (const n of exported.nodes) {
      const cut = n.path.lastIndexOf("/");
      const parent = cut < 0 ? null : this.nodes.get(n.path.slice(0, cut));
      if (cut >= 0 && !parent) throw new Error(`${this.key}: parent of ${n.path} missing`);
      const t = new Transform(n.name, parent ? parent.transform : null);
      t.localPosition = { ...n.localPosition };
      t.localRotation = { ...n.localRotation };
      t.localScale = { ...n.localScale };
      t.activeSelf = n.active;
      t.layer = n.layer;
      this.nodes.set(n.path, { node: n, transform: t });
      if (!parent) this.roots.push(t);
    }
  }

  // The prefab.json roots `ids` of the store (AssetStore.prefab) as one hierarchy: a prefab, or the roots of a scene
  // (their node paths start with the root's name). `ids` keeps the root ids.
  static fromObjects(assets, ids, key = ids.join(" ")) {
    const p = new Prefab({ key, nodes: ids.flatMap((id) => assets.prefab(id).nodes) });
    p.ids = ids.slice();
    return p;
  }

  // the `fields` of the unique component of class `cls` on `path` (prefab.json)
  fields(path, cls) { return this.component(path, cls).fields; }

  get root() {
    if (this.roots.length !== 1) throw new Error(`${this.key}: ${this.roots.length} roots`);
    return this.roots[0];
  }

  transform(path) {
    const e = this.nodes.get(path);
    if (!e) throw new Error(`${this.key}: no node ${path}`);
    return e.transform;
  }

  components(path, cls) {
    const e = this.nodes.get(path);
    if (!e) throw new Error(`${this.key}: no node ${path}`);
    return e.node.components.filter((c) => (cls ? componentClass(c) === cls : true));
  }

  component(path, cls) {
    const cs = this.components(path, cls);
    if (cs.length !== 1) throw new Error(`${this.key}: ${cs.length} ${cls} on ${path}`);
    return cs[0];
  }

  // the unique component of a class anywhere in the prefab
  find(cls) {
    const hits = [];
    for (const [path, e] of this.nodes)
      for (const c of e.node.components) if (componentClass(c) === cls) hits.push({ path, c });
    if (hits.length !== 1) throw new Error(`${this.key}: ${hits.length} ${cls}`);
    return hits[0];
  }

  activeInHierarchy(path) {
    let t = this.transform(path);
    for (; t; t = t.parent) if (t.activeSelf === false) return false;
    return true;
  }
};
