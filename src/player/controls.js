import { LIVE_SPEEDS } from "../live/session.js";

// Control bar of a ChartPlayer: play / pause, time, seek bar, speed, music, sound effects, and a big play button
// before the first play. The bar hides itself while playing and shows again on pointer movement over the player, a
// tap or a key. Keyboard (while the player has the focus): Space / K play / pause, Left / Right seek -5 s / +5 s,
// Up / Down speed, M music, S sound effects. Works at phone width. Every element lives in the player's shadow root.

export const PLAYER_CSS = `
:host { all: initial; visibility: inherit; }   /* hidden with its host element */
.canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
.status { position: absolute; left: 12px; bottom: 12px; color: #aaa; font: 12px/1.4 system-ui, sans-serif;
          white-space: pre; pointer-events: none; }
.status[hidden] { display: none; }
.status.above-bar { bottom: calc(56px + env(safe-area-inset-bottom, 0px)); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px;
       padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box;
       background: linear-gradient(transparent, rgba(0,0,0,.72)); color: #eee;
       font: 13px/1 system-ui, sans-serif; transition: opacity .25s; user-select: none; -webkit-user-select: none; }
.bar.hidden { opacity: 0; pointer-events: none; }
.btn, .speed { height: 32px; min-width: 36px; border: 0; border-radius: 6px; background: rgba(255,255,255,.14);
               color: inherit; font: inherit; cursor: pointer; padding: 0 8px; }
.btn:disabled { opacity: .35; cursor: default; }
.toggle[aria-pressed="false"] { opacity: .45; text-decoration: line-through; }
.speed option { color: #000; }
.time { min-width: 86px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.seek { flex: 1; min-width: 60px; accent-color: #fff; }
.big { position: absolute; left: 50%; top: 50%; width: 72px; height: 72px; margin: -36px 0 0 -36px;
       border: 0; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 28px; cursor: pointer; }
.big[hidden] { display: none; }
.root-narrow .bar { gap: 5px; padding-left: 6px; padding-right: 6px; }
.root-narrow .time { min-width: 0; font-size: 11px; }
.root-narrow .btn { min-width: 32px; padding: 0 5px; }
.root-tiny .time { display: none; }
`;

const HIDE_MS = 2500;

export const formatTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class ChartControls {
  constructor(player) {
    this.player = player;
    this.dragging = false;
    this.hidden = false;
    this.overBar = false;
    const doc = player.root.ownerDocument, s = player.session;
    const el = (tag, cls, attrs = {}) => { const e = doc.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
    const wrap = this.wrap = el("div", "controls");
    const bar = this.bar = el("div", "bar");
    this.btnPlay = el("button", "btn play", { type: "button", title: "Play / Pause (Space)" });
    this.time = el("span", "time");
    this.seekbar = el("input", "seek", { type: "range", min: "0", max: String(s.durationMs()), step: "1", value: "0",
                                         title: "Seek (Left / Right)" });
    this.speed = el("select", "speed", { title: "Speed (Up / Down)" });
    for (const v of LIVE_SPEEDS) this.speed.append(new Option(`${v}×`, String(v), v === 1, v === 1));
    if (!LIVE_SPEEDS.includes(s.speed)) this.speed.append(new Option(`${s.speed}×`, String(s.speed), true, true));
    this.speed.value = String(s.speed);
    this.btnMusic = el("button", "btn toggle music", { type: "button", title: "Music (M)", textContent: "♪" });
    this.btnSe = el("button", "btn toggle se", { type: "button", title: "Sound effects (S)", textContent: "SE" });
    bar.append(this.btnPlay, this.time, this.seekbar, this.speed, this.btnMusic, this.btnSe);
    this.big = el("button", "big", { type: "button", title: "Play", textContent: "▶" });
    this.big.setAttribute("aria-label", "Play");
    wrap.append(bar, this.big);
    player.shadow.append(wrap);
    player.statusEl.classList.add("above-bar");
    if (!s.audioAvailable) { this.btnMusic.disabled = true; this.btnSe.disabled = true; }

    const on = (t, type, fn) => { t.addEventListener(type, fn); this._off.push(() => t.removeEventListener(type, fn)); };
    this._off = [];
    for (const b of [this.btnPlay, this.big, this.btnMusic, this.btnSe]) on(b, "click", () => player.root.focus({ preventScroll: true }));
    on(this.btnPlay, "click", () => this.toggle());
    on(this.big, "click", () => this.play());
    on(this.seekbar, "input", () => { this.dragging = true; this._label(Number(this.seekbar.value)); });
    on(this.seekbar, "change", () => { this.dragging = false; this.seek(Number(this.seekbar.value)); });
    on(this.speed, "change", () => { player.speed = Number(this.speed.value); player.root.focus({ preventScroll: true }); });
    on(this.btnMusic, "click", () => { player.music = !player.music; });
    on(this.btnSe, "click", () => { player.se = !player.se; });
    on(player.canvas, "pointerdown", (e) => {
      if (e.pointerType === "mouse") { if (e.button === 0 && (player.session.started || player.session.holdStart)) this.toggle(); }
      else if (this.hidden) this.show(); else this.hide(true);
    });
    on(player.root, "pointermove", (e) => { if (e.pointerType === "mouse") this.show(); });
    on(bar, "pointerenter", () => { this.overBar = true; this.show(); });
    on(bar, "pointerleave", () => { this.overBar = false; this.show(); });
    // width classes (the host's width, not the window's): narrow < 480 px, tiny < 340 px
    const Ro = player.root.ownerDocument.defaultView.ResizeObserver;
    if (Ro) {
      this._ro = new Ro(() => {
        const w = player.root.clientWidth;
        wrap.classList.toggle("root-narrow", w < 480);
        wrap.classList.toggle("root-tiny", w < 340);
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
    if (this.playing) return this.player.pause().then(() => { this.refresh(); this.show(); });
    return this.play();
  }

  seek(ms) { return this.player.seek(ms).then(() => this.refresh(), (e) => this.player._fail(e)); }

  // keydown on the player (it has the focus)
  key(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT") && e.key !== " ") return;
    const p = this.player;
    if (e.key === " " || e.code === "Space" || e.key === "k" || e.key === "K") { e.preventDefault(); this.toggle(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      this.seek(p.currentTime + (e.key === "ArrowLeft" ? -5000 : 5000));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const i = LIVE_SPEEDS.indexOf(p.speed) + (e.key === "ArrowUp" ? 1 : -1);
      if (i >= 0 && i < LIVE_SPEEDS.length) { p.speed = LIVE_SPEEDS[i]; this.speed.value = String(LIVE_SPEEDS[i]); }
    } else if (e.key === "m" || e.key === "M") { if (p.audioAvailable) p.music = !p.music; }
    else if (e.key === "s" || e.key === "S") { if (p.audioAvailable) p.se = !p.se; }
    else return;
    this.show();
  }

  show() {
    this.hidden = false;
    this.bar.classList.remove("hidden");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.hide(), HIDE_MS);
  }

  hide(force = false) {
    if (!force && (!this.playing || this.overBar || this.dragging)) return;
    this.hidden = true;
    this.bar.classList.add("hidden");
  }

  _label(ms) { this.time.textContent = `${formatTime(ms)} / ${formatTime(this.player.duration)}`; }

  refresh() {
    const p = this.player;
    if (!p.session) return;
    this.btnPlay.textContent = this.playing ? "❚❚" : "▶";
    this.btnPlay.setAttribute("aria-label", this.playing ? "Pause" : "Play");
    this.btnMusic.setAttribute("aria-pressed", String(p.music));
    this.btnSe.setAttribute("aria-pressed", String(p.se));
    if (String(p.speed) !== this.speed.value && LIVE_SPEEDS.includes(p.speed)) this.speed.value = String(p.speed);
    if (!this.dragging) { const t = p.currentTime; this.seekbar.value = String(t); this._label(t); }
    if (!this.playing && !this.hidden) this.show();
  }

  dispose() {
    clearTimeout(this._timer);
    for (const f of this._off) f();
    this._off = [];
    if (this._ro) this._ro.disconnect();
    this.wrap.remove();
    this.player.statusEl.classList.remove("above-bar");
  }
}
