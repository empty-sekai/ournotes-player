import { ModelPlayer } from "./player.js";

// <ournotes-live2d>: a ModelPlayer in the element's shadow root.
//
//   <ournotes-live2d src="https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json"></ournotes-live2d>
//
// Attributes (reflected by the properties of the same name):
//   src          URL of a model manifest; changing it loads that model
//   motion       a motion to play: shown first when the model loads, played whenever the attribute changes (removing it
//                plays the default motion); the default motion follows it unless `loop` is set
//   expression   an expression to set, likewise (removing it sets the default expression)
//   loop         the motion named by `motion` is replayed whenever it ends (boolean attribute; read when it starts)
//   paused       no frame advances (boolean attribute)
//   physics, breath   "off" (or "false", "0") switches the physics / the breath motion off; absent: on
//   seed         seed of the eye blink intervals, read when the model loads
// Properties and methods as ModelPlayer: motions, expressions, defaultMotion, defaultExpression, info, name,
// motionPlaying, looping, time, seed (read only), playMotion(name, opts), setExpression(name, opts), play(), pause(),
// plus `player` (the ModelPlayer, null until loaded) and `ready` (a promise of the ModelPlayer of the current src). The `motion` / `expression` properties read the current motion /
// expression once loaded. Events (not bubbling): ready, error, progress, play, pause, motionstart, motionend; `detail`
// as ModelPlayer's.
// The element is display: block, transparent, and 2:3 at its width unless given a height (CSS aspect-ratio).

const EVENTS = ["ready", "error", "progress", "play", "pause", "motionstart", "motionend"];
const OFF = new Set(["off", "false", "0", "no"]);
const ELEMENT_CSS = `:host { display: block; position: relative; aspect-ratio: 2 / 3; contain: content; }
:host([hidden]) { display: none; }`;

const Base = globalThis.HTMLElement || class {};

export class OurnotesLive2DElement extends Base {
  static get observedAttributes() { return ["src", "motion", "expression", "paused", "physics", "breath"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ELEMENT_CSS;
    this.shadowRoot.append(style);
    this.player = null;
    this._loading = null;
    this._gen = 0;
    this._reset();
  }

  // ---- attributes and properties
  get src() { return this.getAttribute("src") || ""; }
  set src(v) { this.setAttribute("src", String(v)); }
  get motion() { return this.player ? this.player.motion : this.getAttribute("motion") || ""; }
  set motion(v) { if (v) this.setAttribute("motion", String(v)); else this.removeAttribute("motion"); }
  get expression() { return this.player ? this.player.expression : this.getAttribute("expression") || ""; }
  set expression(v) { if (v) this.setAttribute("expression", String(v)); else this.removeAttribute("expression"); }
  get loop() { return this.hasAttribute("loop"); }
  set loop(v) { this.toggleAttribute("loop", !!v); }
  get paused() { return this.player ? this.player.paused : this.hasAttribute("paused"); }
  set paused(v) { this.toggleAttribute("paused", !!v); }
  get physics() { return this.player ? this.player.physics : !OFF.has(String(this.getAttribute("physics")).toLowerCase()); }
  set physics(v) { if (v) this.removeAttribute("physics"); else this.setAttribute("physics", "off"); }
  get breath() { return this.player ? this.player.breath : !OFF.has(String(this.getAttribute("breath")).toLowerCase()); }
  set breath(v) { if (v) this.removeAttribute("breath"); else this.setAttribute("breath", "off"); }

  get motions() { return this.player ? this.player.motions : []; }
  get expressions() { return this.player ? this.player.expressions : []; }
  get defaultMotion() { return this.player ? this.player.defaultMotion : ""; }
  get defaultExpression() { return this.player ? this.player.defaultExpression : ""; }
  get hasPhysics() { return !!this.player && this.player.hasPhysics; }
  get info() { return this.player ? this.player.info : null; }
  get name() { return this.player ? this.player.name : ""; }
  get motionPlaying() { return !!this.player && this.player.motionPlaying; }
  get looping() { return !!this.player && this.player.looping; }
  get time() { return this.player ? this.player.time : 0; }
  // the seed in use once loaded, else the attribute's (null without one)
  get seed() {
    if (this.player) return this.player.seed;
    return this.hasAttribute("seed") ? Number(this.getAttribute("seed")) : null;
  }
  get ready() { return this._ready; }

  async playMotion(name, opts) { (await this._ready).playMotion(name, opts); }
  async setExpression(name, opts) { (await this._ready).setExpression(name, opts); }
  play() { this.paused = false; }
  pause() { this.paused = true; }

  // ---- lifecycle
  connectedCallback() {
    clearTimeout(this._disposeTimer);
    if (!this.player && !this._loading && this.src) this._load();
  }

  // a move in the document (disconnect + connect in the same task) keeps the player
  disconnectedCallback() {
    this._disposeTimer = setTimeout(() => { if (!this.isConnected) this._unload(); }, 0);
  }

  attributeChangedCallback(name, old, value) {
    if (old === value) return;
    if (name === "src") { if (this.isConnected) { this._unload(); if (value) this._load(); } return; }
    const p = this.player;
    if (!p) return;
    if (name === "motion") p.playMotion(value || p.defaultMotion, { loop: this.loop && !!value });
    else if (name === "expression") p.setExpression(value || p.defaultExpression);
    else if (name === "paused") { if (value === null) p.play(); else p.pause(); }
    else if (name === "physics") p.physics = !OFF.has(String(value).toLowerCase());
    else if (name === "breath") p.breath = !OFF.has(String(value).toLowerCase());
  }

  _reset() {
    this._ready = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
    this._ready.catch(() => {});
  }

  _load() {
    const gen = ++this._gen, abort = new AbortController();
    this._abort = abort;
    const attr = (a) => this.getAttribute(a) || undefined;
    const relay = (e) => {
      if (e.type === "ready" && gen === this._gen) this.player = e.target;
      this.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }));
    };
    const on = (a) => !OFF.has(String(this.getAttribute(a)).toLowerCase());
    const first = { motion: attr("motion"), expression: attr("expression") };
    this._loading = ModelPlayer.create(this.shadowRoot, {
      src: new URL(this.src, document.baseURI).href, motion: first.motion, expression: first.expression,
      loop: this.loop, paused: this.hasAttribute("paused"), physics: on("physics"), breath: on("breath"),
      seed: this.hasAttribute("seed") ? Number(this.getAttribute("seed")) : undefined, signal: abort.signal,
      on: Object.fromEntries(EVENTS.map((t) => [t, relay])),
    }).then((p) => {
      if (gen !== this._gen) { p.dispose(); return; }
      this.player = p;
      this._loading = null;
      // attributes changed while loading
      if (attr("motion") !== first.motion) p.playMotion(attr("motion") || p.defaultMotion, { loop: this.loop && !!attr("motion") });
      if (attr("expression") !== first.expression) p.setExpression(attr("expression") || p.defaultExpression);
      if (on("physics") !== p.physics) p.physics = on("physics");
      if (on("breath") !== p.breath) p.breath = on("breath");
      if (this.hasAttribute("paused")) p.pause(); else p.play();
      this._resolve(p);
    }, (e) => {
      if (gen !== this._gen) return;
      this._loading = null;
      this._reject(e);
    });
  }

  _unload() {
    this._gen++;
    if (this._abort) this._abort.abort();
    const p = this.player;
    this.player = null;
    this._loading = null;
    if (p) p.dispose();
    this._reject(new DOMException("the model was unloaded", "AbortError"));
    this._reset();
  }
}

// defines the element under `tagName` (once per name)
export const defineOurnotesLive2D = (tagName = "ournotes-live2d") => {
  if (!globalThis.customElements) return null;
  const known = customElements.get(tagName);
  if (known) return known;
  const C = class extends OurnotesLive2DElement {};
  customElements.define(tagName, C);
  return C;
};
