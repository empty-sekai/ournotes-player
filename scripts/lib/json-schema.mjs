// A small JSON Schema (draft 2020-12) validator for the schemas in schema/. It implements the keywords those schemas
// use and throws on any other keyword, so a schema never silently checks less than it says.
//
//   const check = compile(schema);
//   const errors = check(value);   // [] when valid, else ["<json pointer>: <message>", ...]

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples", "$defs"]);
const KEYWORDS = new Set(["$ref", "type", "enum", "const", "properties", "required", "additionalProperties",
                          "patternProperties", "propertyNames", "items", "prefixItems", "minItems", "maxItems",
                          "minimum", "maximum", "exclusiveMinimum", "minLength", "pattern", "anyOf", "oneOf"]);

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

const isType = (v, t) => {
  switch (t) {
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number" && !Number.isNaN(v);
    default: return typeOf(v) === t;
  }
};

const equal = (a, b) => {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b) || typeof a !== "object" || a === null) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
};

const ptr = (path) => (path.length ? "/" + path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/") : "/");

export const compile = (root) => {
  const regex = new Map();
  const re = (s) => { if (!regex.has(s)) regex.set(s, new RegExp(s, "u")); return regex.get(s); };

  const resolve = (ref) => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
    let s = root;
    for (const part of ref.slice(2).split("/")) {
      s = s[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (s === undefined) throw new Error(`unresolved $ref ${ref}`);
    }
    return s;
  };

  // walk the schema once to reject unknown keywords
  const seen = new Set();
  const lint = (s, at) => {
    if (typeof s === "boolean" || seen.has(s)) return;
    if (!s || typeof s !== "object") throw new Error(`${at}: schema must be an object or boolean`);
    seen.add(s);
    for (const k of Object.keys(s)) if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`${at}: unsupported keyword ${k}`);
    for (const k of ["additionalProperties", "propertyNames", "items"]) if (s[k] !== undefined) lint(s[k], `${at}/${k}`);
    for (const k of ["properties", "patternProperties", "$defs"])
      for (const [n, sub] of Object.entries(s[k] || {})) lint(sub, `${at}/${k}/${n}`);
    for (const k of ["prefixItems", "anyOf", "oneOf"]) (s[k] || []).forEach((sub, i) => lint(sub, `${at}/${k}/${i}`));
    if (s.$ref) resolve(s.$ref);
  };
  lint(root, "#");

  const validate = (s, v, path, errs) => {
    if (s === true) return;
    if (s === false) { errs.push(`${ptr(path)}: not allowed`); return; }
    if (s.$ref) validate(resolve(s.$ref), v, path, errs);
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some((t) => isType(v, t))) { errs.push(`${ptr(path)}: expected ${ts.join(" or ")}, got ${typeOf(v)}`); return; }
    }
    if (s.const !== undefined && !equal(v, s.const)) errs.push(`${ptr(path)}: expected ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((e) => equal(v, e))) errs.push(`${ptr(path)}: ${JSON.stringify(v)} not one of ${JSON.stringify(s.enum)}`);
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) errs.push(`${ptr(path)}: ${v} < ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errs.push(`${ptr(path)}: ${v} > ${s.maximum}`);
      if (s.exclusiveMinimum !== undefined && !(v > s.exclusiveMinimum)) errs.push(`${ptr(path)}: ${v} <= ${s.exclusiveMinimum}`);
    }
    if (typeof v === "string") {
      if (s.minLength !== undefined && [...v].length < s.minLength) errs.push(`${ptr(path)}: shorter than ${s.minLength}`);
      if (s.pattern !== undefined && !re(s.pattern).test(v)) errs.push(`${ptr(path)}: ${JSON.stringify(v)} does not match ${s.pattern}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${ptr(path)}: fewer than ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${ptr(path)}: more than ${s.maxItems} items`);
      const pre = s.prefixItems || [];
      pre.forEach((sub, i) => { if (i < v.length) validate(sub, v[i], [...path, i], errs); });
      if (s.items !== undefined) for (let i = pre.length; i < v.length; i++) validate(s.items, v[i], [...path, i], errs);
    }
    if (typeOf(v) === "object") {
      for (const k of s.required || []) if (!Object.prototype.hasOwnProperty.call(v, k)) errs.push(`${ptr(path)}: missing ${k}`);
      const props = s.properties || {}, pats = Object.entries(s.patternProperties || {});
      for (const [k, x] of Object.entries(v)) {
        if (s.propertyNames !== undefined) validate(s.propertyNames, k, [...path, k], errs);
        let matched = false;
        if (Object.prototype.hasOwnProperty.call(props, k)) { matched = true; validate(props[k], x, [...path, k], errs); }
        for (const [p, sub] of pats) if (re(p).test(k)) { matched = true; validate(sub, x, [...path, k], errs); }
        if (!matched && s.additionalProperties !== undefined) validate(s.additionalProperties, x, [...path, k], errs);
      }
    }
    if (s.anyOf && !s.anyOf.some((sub) => { const e = []; validate(sub, v, path, e); return e.length === 0; }))
      errs.push(`${ptr(path)}: matches none of anyOf`);
    if (s.oneOf) {
      const n = s.oneOf.filter((sub) => { const e = []; validate(sub, v, path, e); return e.length === 0; }).length;
      if (n !== 1) errs.push(`${ptr(path)}: matches ${n} of oneOf (expected 1)`);
    }
  };

  return (value, { limit = 20 } = {}) => {
    const errs = [];
    validate(root, value, [], errs);
    return errs.length > limit ? [...errs.slice(0, limit), `... ${errs.length - limit} more`] : errs;
  };
};
