import { LiveLaneLayout } from "../live/lane.js";
import { LIVE_SPEEDS } from "../live/session.js";
import { F } from "../engine/core.js";
import { LIVE_OPTION_GROUPS, LiveSettingsMath } from "../live/settings.js";
import { formatString } from "./strings.js";

// Controls of a ChartPlayer, in two parts:
//   the bar: the viewer controls (play / pause, time, seek bar, playback speed), the game's note speed as a quick
//     control, and the button that opens the settings panel; a big play button before the first play. The bar hides
//     itself while playing and shows again on pointer movement over the player, a tap or a key.
//   the settings panel: the game's Live options (src/live/settings.js) in the game's groups (Basic, Detail, Display 1,
//     Display 2, Sound) and sections, with the game's ranges and defaults; only the options this chart offers are
//     shown. A change is applied through ChartPlayer.setSettings.
// Note speed in the bar: the steps of the game's note speed buttons before a live (UILiveBeforeStartOptionDialogWidget:
// UIFloatElementStepButtonsParts, min 1, max 12, steps 1 / 0.1 / 0.01), stepped as its OnStepButton does (float32 sum,
// clamped to the range, no change when approximately equal), shown with two decimals (UpdateUi, "F2"). The buttons step
// by 0.1, with Shift by 1. The value between them is a text field: a typed value (Enter or leaving the field applies
// it, Escape cancels) is rounded to 0.01 in float32 and clamped to the range, text that is not a number is discarded
// (parseOptionInput); the panel's number fields take typed values by the same rules. A change goes through
// ChartPlayer.setSettings as the panel's do; clicks in quick succession are applied once, 300 ms after the last (the
// bar shows the value at once).
// Keyboard (while the player has the focus): Space / K play / pause, Left / Right seek -5 s / +5 s, Up / Down playback
// speed, [ / ] note speed -0.1 / +0.1 (with Shift -1 / +1), Escape closes the settings panel; a focused button takes
// Space and Enter itself, a focused text field every key; inside the panel the controls take their own keys (Tab moves
// between them, Left / Right between the tabs). Labels come from the player's string table (strings.js). Works at phone width. Every element
// lives in the player's shadow root.

export const PLAYER_CSS = `
:host { all: initial; visibility: inherit; }   /* hidden with its host element */
.canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
.status { position: absolute; left: 12px; bottom: 12px; color: #aaa; font: 12px/1.4 system-ui, sans-serif;
          white-space: pre; pointer-events: none; }
.status[hidden] { display: none; }
.status.above-bar { bottom: calc(var(--bar-h, 48px) + 8px); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
       padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box;
       background: linear-gradient(transparent, rgba(0,0,0,.72)); color: #eee;
       font: 13px/1 system-ui, sans-serif; transition: opacity .25s; user-select: none; -webkit-user-select: none; }
.bar.hidden { opacity: 0; pointer-events: none; }
.btn, .speed { height: 32px; min-width: 36px; border: 0; border-radius: 6px; background: rgba(255,255,255,.14);
               color: inherit; font: inherit; cursor: pointer; padding: 0 8px; }
.btn:disabled { opacity: .35; cursor: default; }
.speed option { color: #000; }
.speed-label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.note-speed { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.note-speed .btn { min-width: 32px; padding: 0; font-size: 16px; }
.ns-value { width: calc(5ch + 8px); height: 28px; box-sizing: border-box; padding: 0 2px; border: 0; border-radius: 5px;
            background: rgba(255,255,255,.12); color: inherit; font: inherit; text-align: center;
            font-variant-numeric: tabular-nums; }
.time { min-width: 86px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.seek { flex: 1; min-width: 60px; accent-color: #fff; }
.big { position: absolute; left: 50%; top: 50%; width: 72px; height: 72px; margin: -36px 0 0 -36px;
       border: 0; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 28px; cursor: pointer; }
.big[hidden] { display: none; }
.root-narrow .bar { gap: 5px 6px; padding-left: 6px; padding-right: 6px; }
.root-narrow .seek { order: -1; flex: 1 1 100%; }
.root-narrow .time { min-width: 0; font-size: 11px; margin-right: auto; }
.root-narrow .btn { min-width: 32px; padding: 0 6px; }
.root-narrow .big { top: calc((100% - var(--bar-h, 0px)) / 2); }
.root-cramped .big { width: 56px; height: 56px; margin: -28px 0 0 -28px; font-size: 22px; }
.panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100%); box-sizing: border-box; display: flex;
         flex-direction: column; background: rgba(18,18,22,.95); color: #eee; font: 13px/1.35 system-ui, sans-serif; }
.panel[hidden] { display: none; }
.panel-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; flex: none;
              border-bottom: 1px solid rgba(255,255,255,.12); }
.panel-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
.tabs { display: flex; gap: 4px; padding: 6px 8px; overflow-x: auto; flex: none; border-bottom: 1px solid rgba(255,255,255,.12); }
.tab { flex: none; height: 28px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit;
       padding: 0 10px; cursor: pointer; white-space: nowrap; }
.tab[aria-selected="true"] { background: rgba(255,255,255,.2); }
.panel-body { flex: 1; overflow-y: auto; padding: 0 12px 8px; }
.panel-body h3 { margin: 12px 0 2px; font-size: 12px; font-weight: 600; opacity: .7; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 7px 0;
       border-bottom: 1px solid rgba(255,255,255,.07); }
.row .name { flex: 1 1 auto; min-width: 0; }
.row input[type=range] { flex: 1 1 100%; min-width: 0; margin: 0; accent-color: #fff; }
/* a volume: label and number on the first line, slider and mute switch on the second */
.row.with-mute input[type=range] { flex: 1 1 calc(100% - 110px); }
.row select, .row .num { height: 28px; box-sizing: border-box; border: 0; border-radius: 5px; background: rgba(255,255,255,.12);
                         color: inherit; font: inherit; padding: 0 6px; }
.row select { max-width: 60%; }
.row .num { width: 76px; }
.row select option { color: #000; }
.row .unit { font-size: 11px; opacity: .75; font-variant-numeric: tabular-nums; }
.row .hint { flex: 1 1 100%; font-size: 11px; opacity: .7; }
.check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.check.name { flex: 1 1 auto; }
.panel-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; flex: none;
              padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(255,255,255,.12); }
.panel-body .note { margin: 10px 0 2px; font-size: 11px; opacity: .7; }
.root-short .panel { overflow-y: auto; }
.root-short .panel-body { flex: none; overflow: visible; }
.panel-status { flex: 1; min-height: 1em; font-size: 12px; color: #fc6; }
.panel.busy .panel-body { opacity: .6; pointer-events: none; }
.btn:focus-visible, .tab:focus-visible, .big:focus-visible, .speed:focus-visible, .seek:focus-visible,
.ns-value:focus-visible, .row :focus-visible { outline: 2px solid #8cf; outline-offset: 1px; }
`;

const HIDE_MS = 2500;

// the note speed buttons of the game's pre-live option dialog (UIFloatElementStepButtonsParts _largeStep, _mediumStep,
// _smallStep); the bar uses the large and medium steps
export const NOTE_SPEED_STEPS = { large: 1, medium: F(0.1), small: F(0.01) };
const NOTE_SPEED_KEYS = { "[": -NOTE_SPEED_STEPS.medium, "]": NOTE_SPEED_STEPS.medium,
                          "{": -NOTE_SPEED_STEPS.large, "}": NOTE_SPEED_STEPS.large };
const NOTE_SPEED_APPLY_MS = 300;

// A typed option value: a decimal number (a comma is taken as the decimal point), rounded half away from zero to the
// option screen's precision (floats 0.01, as it shows them with "F2", then float32; integers 1) and clamped to the
// range; null for text that is not a number.
export const parseOptionInput = (text, lo, hi, float = true) => {
  const s = String(text).trim().replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s), a = Math.abs(n);
  const r = Math.sign(n) * (float ? Number(`${Math.round(Number(`${a}e2`))}e-2`) : Math.round(a));
  const v = r < lo ? lo : r > hi ? hi : r;
  return float ? F(v) : v;
};

// a field that takes typed text: the player's keyboard shortcuts stay off while it has the focus
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "tel", "password"]);
const textEntry = (t) => !!t && (t.tagName === "TEXTAREA" || t.isContentEditable === true ||
                                 (t.tagName === "INPUT" && TEXT_INPUTS.has(String(t.type).toLowerCase())));

// Mathf.Approximately: |b - a| < max(1e-6 * max(|a|, |b|), Mathf.Epsilon * 8)
const approximately = (a, b) => Math.abs(b - a) < Math.max(F(1e-6 * Math.max(Math.abs(a), Math.abs(b))), 1.1210388e-44);

// UIFloatElementStepButtonsParts.OnStepButton: v = clamp(current + step, min, max) in float32; null when the value
// does not change (Mathf.Approximately)
export const noteSpeedStep = (current, step, min, max) => {
  const s = F(F(current) + F(step)), v = s < min ? F(min) : s > max ? F(max) : s;
  return approximately(F(current), v) ? null : v;
};
let controlsId = 0;

export const formatTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class ChartControls {
  constructor(player) {
    this.player = player;
    this.t = player.strings;
    this.id = `onp-${++controlsId}`;
    this.dragging = false;
    this.hidden = false;
    this.overBar = false;
    this.panel = null;
    this.applying = false;
    const doc = this.doc = player.root.ownerDocument, s = player.session, t = this.t;
    const el = this.el = (tag, cls, attrs = {}) => { const e = doc.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
    const wrap = this.wrap = el("div", "controls");
    const bar = this.bar = el("div", "bar");
    this.btnPlay = el("button", "btn play", { type: "button" });
    this.time = el("span", "time");
    this.seekbar = el("input", "seek", { type: "range", min: "0", max: String(s.durationMs()), step: "1", value: "0" });
    this.seekbar.setAttribute("aria-label", t.position);
    const speedLabel = el("label", "speed-label");
    this.speed = el("select", "speed");
    for (const v of LIVE_SPEEDS) this.speed.append(new Option(`${v}×`, String(v), v === 1, v === 1));
    if (!LIVE_SPEEDS.includes(s.speed)) this.speed.append(new Option(`${s.speed}×`, String(s.speed), true, true));
    this.speed.value = String(s.speed);
    speedLabel.append(doc.createTextNode(t.speed), this.speed);
    // the game's note speed (see the header)
    const ns = this.noteSpeed = el("div", "note-speed");
    ns.setAttribute("role", "group");
    ns.setAttribute("aria-labelledby", `${this.id}-ns-label`);
    this.nsDown = el("button", "btn ns-down", { type: "button", textContent: "\u2212", title: t.noteSpeedDown });
    this.nsDown.setAttribute("aria-label", t.noteSpeedDown);
    const nsIt = player.optionItems().find((i) => i.name === "NoteSpeed"), nsRange = nsIt ? nsIt.range : [1, 12];
    this.nsValue = el("input", "ns-value", { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false,
                                             enterKeyHint: "done" });
    this.nsValue.setAttribute("aria-label", formatString(t.noteSpeedValue,
      { min: Number(nsRange[0]).toFixed(2), max: Number(nsRange[1]).toFixed(2) }));
    this.nsUp = el("button", "btn ns-up", { type: "button", textContent: "+", title: t.noteSpeedUp });
    this.nsUp.setAttribute("aria-label", t.noteSpeedUp);
    ns.append(el("span", "ns-label", { id: `${this.id}-ns-label`, textContent: t.options.NoteSpeed }), this.nsDown,
              this.nsValue, this.nsUp);
    this.nsTarget = null;              // the note speed the bar shows until it is applied
    this.btnSettings = el("button", "btn settings", { type: "button", textContent: t.settings });
    this.btnSettings.setAttribute("aria-haspopup", "dialog");
    this.btnSettings.setAttribute("aria-expanded", "false");
    bar.append(this.btnPlay, this.time, this.seekbar, speedLabel, ns, this.btnSettings);
    this.big = el("button", "big", { type: "button", title: t.play, textContent: "▶" });
    this.big.setAttribute("aria-label", t.play);
    wrap.append(bar, this.big);
    player.shadow.append(wrap);
    player.statusEl.classList.add("above-bar");

    const on = this.on = (target, type, fn) => { target.addEventListener(type, fn); this._off.push(() => target.removeEventListener(type, fn)); };
    this._off = [];
    for (const b of [this.btnPlay, this.big]) on(b, "click", () => player.root.focus({ preventScroll: true }));
    on(this.btnPlay, "click", () => this.toggle());
    on(this.big, "click", () => this.play());
    on(this.seekbar, "input", () => { this.dragging = true; this._label(Number(this.seekbar.value)); });
    on(this.seekbar, "change", () => { this.dragging = false; this.seek(Number(this.seekbar.value)); });
    on(this.speed, "change", () => { player.speed = Number(this.speed.value); });
    on(this.btnSettings, "click", () => (this.panel && !this.panel.hidden ? this.closePanel() : this.openPanel()));
    on(this.nsDown, "click", (e) => this.stepNoteSpeed(e.shiftKey ? -NOTE_SPEED_STEPS.large : -NOTE_SPEED_STEPS.medium));
    on(this.nsUp, "click", (e) => this.stepNoteSpeed(e.shiftKey ? NOTE_SPEED_STEPS.large : NOTE_SPEED_STEPS.medium));
    on(this.nsValue, "focus", () => { this.nsValue.select(); this.show(); });
    on(this.nsValue, "keydown", (e) => this.noteSpeedFieldKey(e));
    on(this.nsValue, "blur", () => this.commitNoteSpeed(this.nsValue.value));
    on(player.canvas, "pointerdown", (e) => {
      const ss = player.session;                                  // null while a new session loads (settings)
      if (e.pointerType === "mouse") { if (e.button === 0 && ss && (ss.started || ss.holdStart)) this.toggle(); }
      else if (this.hidden) this.show(); else this.hide(true);
    });
    on(player.root, "pointermove", (e) => { if (e.pointerType === "mouse") this.show(); });
    on(bar, "pointerenter", () => { this.overBar = true; this.show(); });
    on(bar, "pointerleave", () => { this.overBar = false; this.show(); });
    // size classes (the host's size, not the window's): narrow when under 480 px wide or when the bar's controls do not
    // fit in one row beside a seek bar of 120 px (the seek bar then takes a row of its own); tiny < 340 px wide; short
    // < 320 px high (the settings panel then scrolls as a whole); cramped when less than 84 px stay above the bar (a
    // smaller big play button). --bar-h: the bar's height, for the big play button and the status line above it.
    const Ro = doc.defaultView.ResizeObserver;
    if (Ro) {
      this._ro = new Ro(() => {
        const w = player.root.clientWidth, h = player.root.clientHeight;
        wrap.classList.toggle("root-tiny", w < 340);
        wrap.classList.toggle("root-short", h < 320);
        wrap.classList.remove("root-narrow");
        const cs = doc.defaultView.getComputedStyle(bar), gap = parseFloat(cs.columnGap) || 0;
        let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + 120;
        for (const c of bar.children) if (c !== this.seekbar) need += c.offsetWidth + gap;
        wrap.classList.toggle("root-narrow", w < 480 || need > w);
        const bh = bar.offsetHeight;
        wrap.classList.toggle("root-cramped", h - bh < 84);
        for (const e of [wrap, player.statusEl]) e.style.setProperty("--bar-h", `${bh}px`);
      });
      this._ro.observe(player.root);
    }
    this.show();
    this.refresh();
  }

  get playing() { return !this.player.paused; }

  play() {
    this.big.hidden = true;
    return this.player.play().then(() => { this.refresh(); this.show(); }, (e) => this.player._fail(e));
  }

  toggle() {
    if (!this.player.session) return Promise.resolve();
    if (this.playing) return this.player.pause().then(() => { this.refresh(); this.show(); });
    return this.play();
  }

  seek(ms) {
    if (!this.player.session) return Promise.resolve();
    return this.player.seek(ms).then(() => this.refresh(), (e) => this.player._fail(e));
  }

  // keydown on the player (it has the focus)
  key(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (this.panel && !this.panel.hidden) {
      if (e.key === "Escape") { e.preventDefault(); this.closePanel(); return; }
      if (t && this.panel.contains(t)) return;                     // the panel's controls keep their keys
    }
    if (textEntry(t)) return;                                        // a text field keeps every key
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT") && e.key !== " ") return;
    // a focused button takes Space and Enter itself (the play button's own click plays / pauses)
    if (t && t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    const p = this.player;
    if (e.key === " " || e.code === "Space" || e.key === "k" || e.key === "K") { e.preventDefault(); this.toggle(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      this.seek(p.currentTime + (e.key === "ArrowLeft" ? -5000 : 5000));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const i = LIVE_SPEEDS.indexOf(p.speed) + (e.key === "ArrowUp" ? 1 : -1);
      if (i >= 0 && i < LIVE_SPEEDS.length) { p.speed = LIVE_SPEEDS[i]; this.speed.value = String(LIVE_SPEEDS[i]); }
    } else if (NOTE_SPEED_KEYS[e.key] !== undefined) {         // [ ] note speed; with Shift ({ }) the large step
      e.preventDefault();
      this.stepNoteSpeed(NOTE_SPEED_KEYS[e.key]);
    } else return;
    this.show();
  }

  // ------------------------------------------------------------------------------------------ note speed
  // one step of the note speed (see the header); applied through ChartPlayer.setSettings
  stepNoteSpeed(step) {
    const p = this.player, it = p.session && p.optionItems().find((i) => i.name === "NoteSpeed");
    if (!it) return;
    const v = noteSpeedStep(this.nsTarget ?? p.settings.NoteSpeed, step, it.range[0], it.range[1]);
    if (v === null) return;
    this.nsTarget = v;
    this._showNoteSpeed();
    clearTimeout(this._nsTimer);
    this._nsTimer = setTimeout(() => this._applyNoteSpeed(), NOTE_SPEED_APPLY_MS);
  }

  // a typed note speed (the bar's field): rounded, clamped, applied at once; not a number or no change: the field shows
  // the value in effect again
  commitNoteSpeed(text) {
    const p = this.player, it = p.session && p.optionItems().find((i) => i.name === "NoteSpeed");
    if (!it) return;
    const v = parseOptionInput(text, it.range[0], it.range[1]);
    if (v === null || v === F(this.nsTarget ?? p.settings.NoteSpeed)) { this._showNoteSpeed(true); return; }
    this.nsTarget = v;
    this._showNoteSpeed(true);
    clearTimeout(this._nsTimer);
    this._applyNoteSpeed();
  }

  // keys of the bar's field: Enter applies, Escape cancels an edit (without an edit Escape goes on to the player)
  noteSpeedFieldKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.commitNoteSpeed(this.nsValue.value);
      this.nsValue.select();
    } else if (e.key === "Escape" && this.nsValue.value !== this._nsShown) {
      e.preventDefault();
      this._showNoteSpeed(true);
      this.nsValue.select();
    }
  }

  _nsFocused() { return typeof this.nsValue.matches === "function" && this.nsValue.matches(":focus"); }

  async _applyNoteSpeed() {
    if (this._nsRunning) return;                                 // the running apply takes the latest value
    this._nsRunning = true;
    try {
      while (this.nsTarget !== null && this.player.session && this.nsTarget !== this.player.settings.NoteSpeed) {
        const v = this.nsTarget;
        await this.player.setSettings({ NoteSpeed: v });
        if (this.nsTarget === v) this.nsTarget = null;
      }
    } catch (e) {
      this.player._fail(e);
    } finally {
      this._nsRunning = false;
      this.nsTarget = null;
      this._showNoteSpeed();
    }
  }

  // the bar's note speed and, when the panel shows it, the panel's row: the value to be applied, else the one in effect;
  // a focused field being typed in keeps its text (force: the bar's field shows the value all the same)
  _showNoteSpeed(force = false) {
    const p = this.player;
    if (!p.session) return;
    const it = p.optionItems().find((i) => i.name === "NoteSpeed"), v = this.nsTarget ?? p.settings.NoteSpeed;
    if (!it) return;
    const text = Number(v).toFixed(2);
    if (force || !this._nsFocused() || this.nsValue.value === this._nsShown) this.nsValue.value = text;
    this._nsShown = text;
    this.nsDown.disabled = approximately(it.range[0], v);
    this.nsUp.disabled = approximately(it.range[1], v);
    const row = this.panel && !this.panel.hidden ? this.body.querySelector(".row[data-name=NoteSpeed]") : null;
    if (row) {
      for (const inp of row.querySelectorAll("input")) {
        if (inp.matches(":focus") && inp.type === "number") continue;
        inp.value = inp.type === "number" ? text : String(v);
      }
    }
  }

  show() {
    this.hidden = false;
    this.bar.classList.remove("hidden");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.hide(), HIDE_MS);
  }

  hide(force = false) {
    if (!force && (!this.playing || this.overBar || this.dragging || (this.panel && !this.panel.hidden) ||
                   this._nsFocused())) return;
    this.hidden = true;
    this.bar.classList.add("hidden");
  }

  _label(ms) { this.time.textContent = `${formatTime(ms)} / ${formatTime(this.player.duration)}`; }

  refresh() {
    const p = this.player, t = this.t;
    if (!p.session) return;
    this.btnPlay.textContent = this.playing ? "❚❚" : "▶";
    this.btnPlay.setAttribute("aria-label", this.playing ? t.pause : t.play);
    this.btnPlay.title = this.playing ? t.pause : t.play;
    if (String(p.speed) !== this.speed.value && LIVE_SPEEDS.includes(p.speed)) this.speed.value = String(p.speed);
    if (!this.dragging) { const ms = p.currentTime; this.seekbar.value = String(ms); this._label(ms); }
    if (!this.playing && !this.hidden) this.show();
    // settings changed elsewhere (API, a reload): the open panel shows them
    if (this.panel && !this.panel.hidden && !this.applying && p.settings !== this._shown) this._renderTab();
    this._showNoteSpeed();
  }

  // ------------------------------------------------------------------------------------------ settings panel
  openPanel() {
    if (!this.panel) this._buildPanel();
    this.panel.hidden = false;
    this.btnSettings.setAttribute("aria-expanded", "true");
    this._renderTab();
    const sel = this.tabs.find((b) => b.getAttribute("aria-selected") === "true");
    if (sel) sel.focus({ preventScroll: true });
    this.show();
  }

  closePanel() {
    if (!this.panel || this.panel.hidden) return;
    this.panel.hidden = true;
    this.btnSettings.setAttribute("aria-expanded", "false");
    this.btnSettings.focus({ preventScroll: true });
    this.show();
  }

  _buildPanel() {
    const el = this.el, t = this.t, on = this.on;
    const panel = this.panel = el("div", "panel", { hidden: true });
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", `${this.id}-title`);
    const head = el("div", "panel-head");
    head.append(el("h2", "", { id: `${this.id}-title`, textContent: t.settingsTitle }));
    const close = el("button", "btn close", { type: "button", textContent: t.close });
    head.append(close);
    const tabs = el("div", "tabs");
    tabs.setAttribute("role", "tablist");
    const items = this.player.optionItems();
    const groups = LIVE_OPTION_GROUPS.filter((g) => items.some((i) => i.group === g.key && !i.hidden && i.offered));
    this.tab = groups.length ? groups[0].key : null;
    this.tabs = groups.map((g) => {
      const b = el("button", "tab", { type: "button", id: `${this.id}-tab-${g.key}`, textContent: t.groups[g.key] || g.key });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", `${this.id}-body`);
      b.dataset.group = g.key;
      on(b, "click", () => { this.tab = g.key; this._renderTab(false); });
      on(b, "keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const i = this.tabs.indexOf(b) + (e.key === "ArrowRight" ? 1 : -1), n = this.tabs[(i + this.tabs.length) % this.tabs.length];
        this.tab = n.dataset.group;
        this._renderTab(false);
        n.focus({ preventScroll: true });
      });
      tabs.append(b);
      return b;
    });
    this.body = el("div", "panel-body", { id: `${this.id}-body` });
    this.body.setAttribute("role", "tabpanel");
    const foot = el("div", "panel-foot");
    this.status = el("span", "panel-status");
    this.status.setAttribute("aria-live", "polite");
    const reset = el("button", "btn reset", { type: "button", textContent: t.reset });
    foot.append(this.status, reset);
    panel.append(head, tabs, this.body, foot);
    this.wrap.append(panel);
    on(close, "click", () => this.closePanel());
    on(reset, "click", () => this._apply({}, true));
  }

  // the rows of the selected group, with the current values (keepScroll: at the same scroll position)
  _renderTab(keepScroll = true) {
    if (!this.panel || !this.player.session) return;
    const t = this.t, p = this.player;
    this._shown = p.settings;
    const items = p.optionItems(), group = LIVE_OPTION_GROUPS.find((g) => g.key === this.tab);
    for (const b of this.tabs) {
      const sel = b.dataset.group === this.tab;
      b.setAttribute("aria-selected", String(sel));
      b.tabIndex = sel ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `${this.id}-tab-${this.tab}`);
    const scroll = keepScroll ? this.body.scrollTop : 0;
    this.body.textContent = "";
    if (!group) return;
    const byName = new Map(items.map((i) => [i.name, i]));
    for (const section of group.sections) {
      const rows = items.filter((i) => i.section === section && !i.hidden && i.offered);
      if (!rows.length) continue;
      this.body.append(this.el("h3", "", { textContent: t.sections[section] || section }));
      for (const it of rows) this.body.append(this._row(it, byName));
    }
    this.body.append(this.el("p", "note", { textContent: t.restartNote }));
    this.body.scrollTop = scroll;
  }

  _row(it, byName) {
    const el = this.el, t = this.t, doc = this.doc, name = t.options[it.name] || it.name, id = `${this.id}-${it.name}`;
    const row = el("div", "row");
    row.dataset.name = it.name;
    const settings = this.player.settings;
    if (it.type === "bool") {
      const lab = el("label", "check name");
      const cb = el("input", "", { type: "checkbox", id, checked: !!it.value });
      cb.addEventListener("change", () => this._apply({ [it.name]: cb.checked }));
      lab.append(cb, doc.createTextNode(name));
      row.append(lab);
    } else if (it.type === "enum") {
      const sel = el("select", "", { id });
      for (const v of it.values || []) sel.append(new Option(this._valueLabel(it.name, v), String(v), false, v === it.value));
      // the per-type sounds of UseIndividualNoteSe (LiveSettingCreator.BuildIndividualNoteSeDictionary)
      if (/^(Tap|Flick|SideFlick|Slide|Trace)SeId$/.test(it.name)) sel.disabled = !settings.UseIndividualNoteSe;
      sel.addEventListener("change", () => this._apply({ [it.name]: Number(sel.value) }));
      row.append(el("label", "name", { htmlFor: id, textContent: name }), sel);
    } else {
      const [lo, hi] = it.range, float = it.type === "float", step = float ? "0.01" : "1";
      const show = (v) => (float ? Number(v).toFixed(2) : String(v));     // the option screen shows floats as F2
      const num = el("input", "num", { type: "number", id, min: String(lo), max: String(hi), step, value: show(it.value) });
      if (lo >= 0) num.inputMode = float ? "decimal" : "numeric";      // (a keypad without a minus sign)
      const range = el("input", "", { type: "range", id: `${id}-range`, min: String(lo), max: String(hi), step,
                                      value: String(it.value) });
      range.setAttribute("aria-label", name);
      const unit = el("span", "unit");
      const ms = (v) => {
        if (it.name === "NoteTiming") unit.textContent = formatString(t.ms, { v: LiveSettingsMath.timingAdjustmentMs(v) });
        else if (it.name === "ChartPosition") unit.textContent = formatString(t.ms, { v: -LiveSettingsMath.chartPositionMs(v) });
      };
      ms(it.value);
      const revert = () => { num.value = show(it.value); range.value = String(it.value); ms(it.value); };
      // a typed or slid value: parseOptionInput's rules (not a number or no change: the value in effect again)
      const commit = (text) => {
        const v = parseOptionInput(text, lo, hi, float);
        if (v === null || v === it.value) { revert(); return; }
        this._apply({ [it.name]: v });
      };
      range.addEventListener("input", () => { num.value = show(range.value); ms(Number(range.value)); });
      range.addEventListener("change", () => commit(range.value));
      num.addEventListener("change", () => commit(num.value));
      num.addEventListener("keydown", (e) => {                    // Enter applies, Escape cancels an edit
        if (e.key === "Enter") { e.preventDefault(); commit(num.value); }
        else if (e.key === "Escape" && num.value !== show(it.value)) { e.preventDefault(); revert(); }
      });
      row.append(el("label", "name", { htmlFor: id, textContent: name }), num);
      if (unit.textContent) row.append(unit);
      row.append(range);
      const mute = it.mute && byName.get(it.mute);
      if (mute) {
        row.classList.add("with-mute");
        const lab = el("label", "check");
        const cb = el("input", "", { type: "checkbox", id: `${this.id}-${mute.name}`, checked: !!mute.value });
        cb.addEventListener("change", () => this._apply({ [mute.name]: cb.checked }));
        lab.append(cb, doc.createTextNode(t.mute));
        row.append(lab);
      }
    }
    if (t.hints[it.name]) row.append(el("div", "hint", { textContent: t.hints[it.name] }));
    return row;
  }

  _valueLabel(name, v) {
    const V = this.t.values;
    switch (name) {
      case "LiveQuality": return V.quality[v] ?? String(v);
      case "JudgeResultPositionType": return V.judgement[v] ?? String(v);
      case "GuidelineCount": return v === 0 ? V.off : String(LiveLaneLayout.SPLIT_MAIN[v]);
      case "NoteDesignId": return formatString(V.design, { n: v });
      case "NoteEffectId": return V.effect[v] ?? formatString(V.effectN, { n: v });
      default: return /SeId$|^NoteSePatternId$/.test(name) ? formatString(V.soundSet, { n: v }) : String(v);
    }
  }

  // applies a change (reset: every option to its default), then shows the values in effect; the control that had the
  // focus keeps it
  async _apply(values, reset = false) {
    if (this.applying) return;
    const focused = this.panel.getRootNode().activeElement, fid = focused && focused.id;
    this.applying = true;
    this.panel.classList.add("busy");
    this.status.textContent = this.t.applying;
    try {
      await this.player.setSettings(values, { reset });
      this.status.textContent = "";
    } catch (e) {
      this.status.textContent = e && e.message ? e.message : String(e);
    } finally {
      this.applying = false;
      this.panel.classList.remove("busy");
      this._renderTab();
      const f = fid && /^[\w-]+$/.test(fid) ? this.panel.querySelector(`#${fid}`) : null;
      if (f) f.focus({ preventScroll: true });
    }
  }

  dispose() {
    clearTimeout(this._timer);
    clearTimeout(this._nsTimer);
    for (const f of this._off) f();
    this._off = [];
    if (this._ro) this._ro.disconnect();
    this.wrap.remove();
    this.player.statusEl.classList.remove("above-bar");
    this.player.statusEl.style.removeProperty("--bar-h");
  }
}
