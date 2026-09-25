import { ChartPlayer } from "./player.js";

// <ournotes-player>: a ChartPlayer in the element's shadow root.
//
//   <ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
//
// Attributes (reflected by the properties of the same name):
//   src        URL of a chart manifest; changing it loads that chart
//   controls   show the control bar (boolean attribute)
//   autoplay   start playing once loaded (boolean attribute; see ChartPlayer for locked audio)
//   speed      playback speed (default 1)
//   music, se  "off" (or "false", "0") switches the music / the sound effects off; absent: on
//   quality, seed   passed to the session when the chart loads
// Methods and properties as ChartPlayer: play(), pause(), seek(ms), currentTime, duration, paused, ended, chart,
// plus `player` (the ChartPlayer, null until loaded) and `ready` (a promise of the ChartPlayer of the current src).
// Events (not bubbling): ready, play, pause, seeked, timeupdate, ended, error, progress; `detail` as ChartPlayer's.
// The element is 16:9 at its width unless given a height (CSS aspect-ratio).

const EVENTS = ["ready", "play", "pause", "seeked", "timeupdate", "ended", "error", "progress"];
const OFF = new Set(["off", "false", "0", "no"]);
const ELEMENT_CSS = `:host { display: block; position: relative; aspect-ratio: 16 / 9; background: #000; contain: content; }
:host([hidden]) { display: none; }`;

const Base = globalThis.HTMLElement || class {};

export class OurnotesPlayerElement extends Base {
  static get observedAttributes() { return ["src", "controls", "speed", "music", "se"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open", delegatesFocus: true });   // focus() reaches the player (keyboard)
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
  get controls() { return this.hasAttribute("controls"); }
  set controls(v) { this.toggleAttribute("controls", !!v); }
  get autoplay() { return this.hasAttribute("autoplay"); }
  set autoplay(v) { this.toggleAttribute("autoplay", !!v); }
  get speed() { return this.player ? this.player.speed : attrNumber(this.getAttribute("speed"), 1); }
  set speed(v) { this.setAttribute("speed", String(Number(v))); }
  get music() { return this.player ? this.player.music : !OFF.has(String(this.getAttribute("music")).toLowerCase()); }
  set music(v) { if (v) this.removeAttribute("music"); else this.setAttribute("music", "off"); }
  get se() { return this.player ? this.player.se : !OFF.has(String(this.getAttribute("se")).toLowerCase()); }
  set se(v) { if (v) this.removeAttribute("se"); else this.setAttribute("se", "off"); }

  get currentTime() { return this.player ? this.player.currentTime : 0; }
  set currentTime(ms) { this.seek(ms); }
  get duration() { return this.player ? this.player.duration : NaN; }
  get paused() { return this.player ? this.player.paused : true; }
  get ended() { return this.player ? this.player.ended : false; }
  get chart() { return this.player ? this.player.chart : null; }
  get ready() { return this._ready; }

  async play() { return (await this._ready).play(); }
  async pause() { if (this.player) await this.player.pause(); }
  async seek(ms) { return (await this._ready).seek(ms); }

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
    if (name === "speed") { const r = attrNumber(value, 1); if (r > 0 && r !== p.speed) p.speed = r; }
    else if (name === "music") { const on = !OFF.has(String(value).toLowerCase()); if (on !== p.music) p.music = on; }
    else if (name === "se") { const on = !OFF.has(String(value).toLowerCase()); if (on !== p.se) p.se = on; }
    else if (name === "controls") p.controls = this.controls;
  }

  _reset() {
    this._ready = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
    this._ready.catch(() => {});
  }

  _load() {
    const gen = ++this._gen, abort = new AbortController();
    this._abort = abort;
    const num = (a) => (this.hasAttribute(a) ? Number(this.getAttribute(a)) : undefined);
    const relay = (e) => this.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }));
    this._loading = ChartPlayer.create(this.shadowRoot, {
      src: new URL(this.src, document.baseURI).href, controls: this.controls, autoplay: this.autoplay,
      speed: attrNumber(this.getAttribute("speed"), 1), music: this.music, se: this.se,
      quality: num("quality"), seed: num("seed"), signal: abort.signal,
      on: Object.fromEntries(EVENTS.map((t) => [t, relay])),
    }).then((p) => {
      if (gen !== this._gen) { p.dispose(); return; }
      this.player = p;
      this._loading = null;
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
    this._reject(new DOMException("the chart was unloaded", "AbortError"));
    this._reset();
  }

}

const attrNumber = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

// defines the element under `tagName` (once per name)
export const defineOurnotesPlayer = (tagName = "ournotes-player") => {
  if (!globalThis.customElements) return null;
  const known = customElements.get(tagName);
  if (known) return known;
  const C = class extends OurnotesPlayerElement {};
  customElements.define(tagName, C);
  return C;
};
