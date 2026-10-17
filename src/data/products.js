import { PRODUCT_MANIFEST } from "./assets.js";

// The directory holding a product's files within an AssetStore.
export const productDir = (manifestPath) => {
  const p = String(manifestPath), parts = p.split("/");
  if (parts.length < 2 || parts.some((s) => !s || s === "." || s === "..") || !p.endsWith(".json") || /[?#\\]/.test(p))
    throw new Error(`${p}: not a product manifest path <directory>/<file>.json`);
  return p.slice(0, -".json".length);
};

export const isProduct = (m, product) => !!m && m.schema === PRODUCT_MANIFEST && m.product === product
  && !!m.files && typeof m.files === "object" && !Array.isArray(m.files)
  && !!m.objects && typeof m.objects === "object" && !Array.isArray(m.objects);

const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
};

// Merge compatible object roles. Each product may retain a different subset of one object's files.
export const mergeProductManifests = (loaded) => {
  if (!loaded.length) throw new Error("no product manifests");
  const files = {}, objects = {}, products = {};
  for (const [dir, m] of loaded) {
    const subjects = (products[m.product] ||= {});
    if (m.subject in subjects) {
      if (subjects[m.subject] !== dir) throw new Error(`${m.product} ${m.subject}: two manifests (${subjects[m.subject]}, ${dir})`);
    }
    subjects[m.subject] = dir;
    for (const [p, f] of Object.entries(m.files)) {
      const path = `${dir}/${p}`;
      if (Object.hasOwn(files, path) && !same(files[path], f)) throw new Error(`${path}: differing product files`);
      files[path] = f;
    }
    for (const [id, o] of Object.entries(m.objects)) {
      const target = (objects[id] ||= { files: {} });
      for (const [key, value] of Object.entries(o)) {
        if (key === "files") continue;
        if (Object.hasOwn(target, key) && !same(target[key], value))
          throw new Error(`object ${id} differs between the manifests of the products (${key})`);
        target[key] = value;
      }
      for (const [role, file] of Object.entries(o.files || {})) {
        if (Object.hasOwn(target.files, role) && !same(target.files[role], file))
          throw new Error(`object ${id} differs between the manifests of the products (${role})`);
        target.files[role] = file;
      }
    }
  }
  const [dir, man] = loaded[0];
  const { files: _f, objects: _o, ...info } = man;
  return { ...info, dir, products, files, objects };
};
