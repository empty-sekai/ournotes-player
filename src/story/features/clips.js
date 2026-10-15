import { AnimClip, AnimController } from "../../engine/anim.js";

// Animator controllers and clips of one story data file (frames.json, stills.json, effects.json). The exporter
// writes each controller and clip in full the first time the file uses it and as a reference after that
// ({controller: name} / {clip: name}), also across prefabs of the same file; these references resolve here. Two full
// records under one name that differ make the name ambiguous: a reference to it raises.
const AMBIGUOUS = Symbol("ambiguous");

const isFullClip = (x) => typeof x.clip === "string" && Object.keys(x).length > 1;
const isFullController = (x) => typeof x.controller === "string" && Array.isArray(x.layers);

export class AnimRecords {
  constructor(doc, Err = Error) {
    this.Err = Err;
    this.controllers = new Map();
    this.clips = new Map();
    const add = (map, name, rec) => {
      const seen = map.get(name);
      if (seen === undefined) map.set(name, rec);
      else if (seen !== AMBIGUOUS && seen !== rec && JSON.stringify(seen) !== JSON.stringify(rec)) map.set(name, AMBIGUOUS);
    };
    const walk = (x) => {
      if (Array.isArray(x)) { for (const v of x) walk(v); return; }
      if (!x || typeof x !== "object") return;
      if (isFullController(x)) add(this.controllers, x.controller, x);
      else if (isFullClip(x)) add(this.clips, x.clip, x);
      for (const v of Object.values(x)) walk(v);
    };
    walk(doc);
  }

  _get(map, kind, name, where) {
    const r = map.get(name);
    if (r === AMBIGUOUS) throw new this.Err(`${where}: two different ${kind}s named ${name}`);
    if (!r) throw new this.Err(`${where}: ${kind} ${name} not in the data`);
    return r;
  }

  // Animator.m_Controller -> the full controller record, or null when the Animator has none
  controller(raw, where) {
    if (!raw) return null;
    if (typeof raw.controller !== "string") throw new this.Err(`${where}: Animator controller not exported`);
    return raw.layers ? raw : this._get(this.controllers, "controller", raw.controller, where);
  }

  // the normalized controller (AnimController.fromMecanim) with its clips: the controller's own full records first
  controllerOf(raw, where) {
    const own = ownClips(raw, (name) => new this.Err(`${where}: two clips named ${name}`));
    const made = new Map();
    return AnimController.fromMecanim(raw, ({ clip: key }) => {
      if (!made.has(key)) made.set(key, AnimClip.fromMecanim(own.get(key) || this._get(this.clips, "clip", key, where), key));
      return made.get(key);
    });
  }
}

// the full clip records of a full controller's `clips` by name (two different ones under one name raise)
const ownClips = (raw, err) => {
  const own = new Map();
  for (const c of raw.clips || []) {
    if (!isFullClip(c)) continue;
    const seen = own.get(c.clip);
    if (seen && JSON.stringify(seen) !== JSON.stringify(c)) throw err(c.clip);
    if (!seen) own.set(c.clip, c);
  }
  return own;
};

// The references of a story data file that AnimRecords cannot resolve: a controller or clip reference without a full
// record of its name in the file, or with two different ones (a clip reference in a controller's `clips` resolves to
// that controller's own full record first). Returns the problems as messages, each once.
export const animRecordProblems = (doc) => {
  const r = new AnimRecords(doc), out = new Set();
  const need = (map, kind, name) => {
    const v = map.get(name);
    if (v === undefined) out.add(`${kind} ${name}: referenced, not in the file`);
    else if (v === AMBIGUOUS) out.add(`${kind} ${name}: referenced, two different full records in the file`);
  };
  const walk = (x, own) => {
    if (Array.isArray(x)) { for (const v of x) walk(v, own); return; }
    if (!x || typeof x !== "object") return;
    if (isFullController(x)) {
      let mine = new Map();
      try { mine = ownClips(x, (name) => new Error(name)); } catch (e) {
        out.add(`controller ${x.controller}: two different clips named ${e.message}`);
      }
      for (const [k, v] of Object.entries(x)) walk(v, k === "clips" ? mine : null);
      return;
    }
    if (typeof x.controller === "string") need(r.controllers, "controller", x.controller);
    else if (typeof x.clip === "string" && !isFullClip(x) && !(own && own.has(x.clip))) need(r.clips, "clip", x.clip);
    for (const v of Object.values(x)) walk(v, null);
  };
  walk(doc, null);
  return [...out];
};
