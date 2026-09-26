import { StoryPlayer } from "./player.js";

// <ournotes-story>: a StoryPlayer in the element's shadow root.
//
//   <ournotes-story src="https://example.org/site/stories/10462.json" lang="en" controls></ournotes-story>
//
// Attributes (reflected by the properties of the same name):
//   src          URL of a story manifest; changing it loads that story
//   lang         the language ("ja" "en" "zh-Hant" "zh-Hans" "ko"; default: the manifest's); changing it reloads the
//                language's files and restarts at the current line
//   auto         auto mode (boolean attribute; "off" / "false" / "0" is off); absent: off, the game's default
//   speed        the playback speed: 1, 1.5, 1.7 or 2 (AdvPlaybackSpeed Normal, OnePointFive, OnePointSeven, Double)
//   quality      "best" (default), "high" or "middle" (the game's quality option), read when the story loads
//   autoplay     play as soon as the story is loaded (boolean; audio may still wait for a user gesture)
//   controls     show the control bar (boolean attribute; "off" hides it); default shown
//   line         start at this line (0-based), read when the story loads
//   volume-bgm, volume-se, volume-voice   0..1
//   no-voice     play without voices (boolean), read when the story loads
// Methods and properties as StoryPlayer: play(), pause(), next(), skip(), seekToLine(i), setVolume(category, v), line,
// lineCount, speaker, text, ended, languages, plus `player` (the StoryPlayer, null until loaded) and `ready` (a promise
// of the StoryPlayer of the current src). Events (not bubbling): ready, error, progress, play, pause, line, command,
// ended; `detail` as StoryPlayer's. The element is display: block and 13:6 at its width unless given a height.

const EVENTS = ["ready", "error", "progress", "play", "pause", "line", "command", "ended"];
const OFF = new Set(["off", "false", "0", "no"]);
const ELEMENT_CSS = `:host { display: block; position: relative; aspect-ratio: 13 / 6; contain: content; }
:host([hidden]) { display: none; }`;
const SPEED_OF = { 1: 10, 1.5: 15, 1.7: 17, 2: 20 };

const Base = globalThis.HTMLElement || class {};

// "1.5" -> 15; the AdvPlaybackSpeed values themselves (10, 15, 17, 20) are accepted too
export const parseStorySpeed = (s) => {
  const v = Number(s);
  if (SPEED_OF[v]) return SPEED_OF[v];
  return [10, 15, 17, 20].includes(v) ? v : 10;
};

export class OurnotesStoryElement extends Base {
  static get observedAttributes() { return ["src", "lang", "auto", "speed", "volume-bgm", "volume-se", "volume-voice"]; }

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
  get lang() { return this.getAttribute("lang") || (this.player ? this.player.lang : ""); }
  set lang(v) { if (v) this.setAttribute("lang", String(v)); else this.removeAttribute("lang"); }
  get auto() { return this._flag("auto", false); }
  set auto(v) { this.setAttribute("auto", v ? "" : "off"); }
  get speed() { return parseStorySpeed(this.getAttribute("speed") || "1") / 10; }
  set speed(v) { this.setAttribute("speed", String(v)); }

  get line() { return this.player ? this.player.line : -1; }
  get lineCount() { return this.player ? this.player.lineCount : 0; }
  get speaker() { return this.player ? this.player.speaker : ""; }
  get text() { return this.player ? this.player.text : ""; }
  get ended() { return !!this.player && this.player.ended; }
  get languages() { return this.player ? this.player.languages : []; }
  get info() { return this.player ? this.player.info : null; }
  get ready() { return this._ready; }

  async play() { (await this._ready).play(); }
  async pause() { (await this._ready).pause(); }
  async next() { (await this._ready).next(); }
  async skip() { (await this._ready).skip(); }
  async seekToLine(i) { return (await this._ready).seekToLine(i); }
  async setVolume(category, v) { (await this._ready).setVolume(category, v); }

  _flag(name, dflt) {
    if (!this.hasAttribute(name)) return dflt;
    return !OFF.has(String(this.getAttribute(name)).toLowerCase());
  }

  _volume(name) {
    const v = this.getAttribute(name);
    return v === null ? 1 : Math.min(1, Math.max(0, Number(v) || 0));
  }

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
    if (name === "lang") { if (value) p.setLanguage(value).catch(() => {}); }
    else if (name === "auto") p.setAuto(this._flag("auto", false));
    else if (name === "speed") p.setSpeed(parseStorySpeed(value || "1"));
    else if (name === "volume-bgm") p.setVolume("Bgm", this._volume(name));
    else if (name === "volume-se") p.setVolume("Se", this._volume(name));
    else if (name === "volume-voice") p.setVolume("Voice", this._volume(name));
  }

  _reset() {
    this._ready = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
    this._ready.catch(() => {});
  }

  _load() {
    const gen = ++this._gen, abort = new AbortController();
    this._abort = abort;
    const relay = (e) => {
      if (e.type === "ready" && gen === this._gen) this.player = e.target;
      this.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }));
    };
    const num = (a) => (this.hasAttribute(a) ? Number(this.getAttribute(a)) : undefined);
    this._loading = StoryPlayer.create(this.shadowRoot, {
      src: new URL(this.src, document.baseURI).href, lang: this.getAttribute("lang") || undefined,
      auto: this._flag("auto", false), speed: parseStorySpeed(this.getAttribute("speed") || "1"),
      quality: this.getAttribute("quality") || undefined, line: num("line"), autoplay: this.hasAttribute("autoplay"),
      controls: this._flag("controls", true), voice: !this.hasAttribute("no-voice"),
      volumes: { Bgm: this._volume("volume-bgm"), Se: this._volume("volume-se"), Voice: this._volume("volume-voice") },
      seed: num("seed"), signal: abort.signal, on: Object.fromEntries(EVENTS.map((t) => [t, relay])),
    }).then((p) => {
      if (gen !== this._gen) { p.dispose(); return; }
      this.player = p;
      this._loading = null;
      if (this.hasAttribute("autoplay")) p.play();
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
    this._reject(new DOMException("the story was unloaded", "AbortError"));
    this._reset();
  }
}

// defines the element under `tagName` (once per name)
export const defineOurnotesStory = (tagName = "ournotes-story") => {
  if (!globalThis.customElements) return null;
  const known = customElements.get(tagName);
  if (known) return known;
  const C = class extends OurnotesStoryElement {};
  customElements.define(tagName, C);
  return C;
};
