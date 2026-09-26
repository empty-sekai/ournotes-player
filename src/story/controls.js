import { storyStrings } from "./strings.js";
import { SimpleStorySession } from "./simple/session.js";

// Control bar of a StoryPlayer, with visible labels in the page's language. The story menu's items with the game's
// semantics (AdvPlayerUIEventHandler): Auto, Fast-forward (×1 -> ×1.5 -> ×1.7 -> ×2 -> ×1; a speed other than ×1
// turns auto on, turning auto off resets it to ×1), Skip (with its confirmation; the playback waits while it is open) and the
// next button (a tap on the story screen, as a click on the story itself); the app's music, sound effect and voice
// volumes. Apart from them, the player's own items: play / pause and the line position. Keyboard (while the player
// has the focus): Space / Enter next, A auto, F fast-forward, K play / pause. Every element lives in the player's
// shadow root. An Overlay episode (the simple player: no auto button, no fast-forward) shows neither Auto nor
// Fast-forward.

export const STORY_PLAYER_CSS = `
:host { all: initial; visibility: inherit; }   /* hidden with its host element */
.stage { position: absolute; left: 0; top: 0; right: 0; bottom: var(--bar-h, 0px); }
.canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
.status { position: absolute; left: 12px; bottom: 12px; color: #aaa; font: 12px/1.4 system-ui, sans-serif;
          white-space: pre-wrap; pointer-events: none; }
.status[hidden] { display: none; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; min-height: 44px; display: flex; flex-wrap: wrap;
       align-items: center; gap: 6px 10px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px));
       box-sizing: border-box; background: #111; color: #eee; font: 13px/1.2 system-ui, sans-serif;
       user-select: none; -webkit-user-select: none; }
.btn, .sel { height: 30px; border: 0; border-radius: 6px; background: rgba(255,255,255,.14); color: inherit;
             font: inherit; cursor: pointer; padding: 0 10px; }
.btn:disabled { opacity: .35; cursor: default; }
.btn[aria-pressed="true"] { background: rgba(255,255,255,.34); }
.sel option { color: #000; }
.field { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.vol { width: 72px; accent-color: #fff; }
.pos { font-variant-numeric: tabular-nums; white-space: nowrap; opacity: .8; }
.grow { flex: 1; }
.big { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 14px 22px;
       border: 0; border-radius: 10px; background: rgba(0,0,0,.6); color: #fff; font: 16px/1 system-ui, sans-serif;
       cursor: pointer; }
.big[hidden] { display: none; }
[hidden] { display: none !important; }
`;

const speedLabel = (v) => `×${v / 10}`;
const NEXT_SPEED = { 10: 15, 15: 17, 17: 20, 20: 10 };           // AdvPlayerModel.GetNextPlaybackSpeed

export class StoryControls {
  constructor(player, { lang } = {}) {
    this.player = player;
    const doc = player.root.ownerDocument;
    const t = this.t = storyStrings(lang || (doc.documentElement && doc.documentElement.lang) || "en");
    const el = (tag, cls, props = {}) => { const e = doc.createElement(tag); e.className = cls; Object.assign(e, props); return e; };
    const bar = this.bar = el("div", "bar");
    this.btnPlay = el("button", "btn play", { type: "button", textContent: t.pause });
    this.btnNext = el("button", "btn next", { type: "button", textContent: t.next });
    this.btnAuto = el("button", "btn auto", { type: "button", textContent: t.auto });
    this.btnSpeed = el("button", "btn speed", { type: "button" });
    this.btnSkip = el("button", "btn skip", { type: "button", textContent: t.skip });
    this.confirm = el("span", "field confirm", { hidden: true });
    this.btnSkipYes = el("button", "btn", { type: "button", textContent: t.skip });
    this.btnSkipNo = el("button", "btn", { type: "button", textContent: t.cancel });
    this.confirm.append(el("span", "", { textContent: t.skipConfirm }), this.btnSkipYes, this.btnSkipNo);
    this.pos = el("span", "pos");
    const grow = el("span", "grow");
    this.vols = {};
    const vols = [];
    for (const [cat, label] of [["Bgm", t.music], ["Se", t.effects], ["Voice", t.voice]]) {
      const f = el("label", "field", { textContent: label });
      const r = el("input", "vol", { type: "range", min: "0", max: "1", step: "0.05", value: "1" });
      f.append(r); vols.push(f); this.vols[cat] = r;
    }
    bar.append(this.btnNext, this.btnAuto, this.btnSpeed, this.btnSkip, this.confirm, grow, this.btnPlay, this.pos, ...vols);
    this.big = el("button", "big", { type: "button", textContent: t.start, hidden: true });
    player.shadow.append(bar, this.big);

    const on = (target, type, fn) => { target.addEventListener(type, fn); this._off.push(() => target.removeEventListener(type, fn)); };
    this._off = [];
    const focus = () => player.root.focus({ preventScroll: true });
    on(this.btnPlay, "click", () => { focus(); if (player.paused) player.play(); else player.pause(); });
    on(this.btnNext, "click", () => { focus(); player.next(); });
    on(this.btnAuto, "click", () => { focus(); player.setAuto(!player.auto); });
    on(this.btnSpeed, "click", () => { focus(); player.setSpeed(NEXT_SPEED[player.speed]); });
    // OnSkipButtonTapped: the confirmation dialog pauses the playback (AdvPlayer.OnOpenDialog -> Model.SetPause)
    on(this.btnSkip, "click", () => { focus(); this._confirm(true); });
    on(this.btnSkipYes, "click", () => { focus(); this._confirm(false); player.skip(); });
    on(this.btnSkipNo, "click", () => { focus(); this._confirm(false); });
    for (const [cat, r] of Object.entries(this.vols)) on(r, "input", () => player.setVolume(cat, Number(r.value)));
    on(this.big, "click", () => { this.big.hidden = true; focus(); player.play(); });
    on(player.canvas, "pointerdown", (e) => { if (e.button === 0) player.next(); });
    on(player.root, "keydown", (e) => {
      if (e.target !== player.root || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); player.next(); }
      else if ((e.key === "a" || e.key === "A") && !this._simple()) player.setAuto(!player.auto);
      else if ((e.key === "f" || e.key === "F") && !this._simple()) player.setSpeed(NEXT_SPEED[player.speed]);
      else if (e.key === "k" || e.key === "K") { if (player.paused) player.play(); else player.pause(); }
    });
    const ro = new (doc.defaultView.ResizeObserver || class { observe() {} disconnect() {} })(() => this._barHeight());
    ro.observe(bar);
    this._off.push(() => ro.disconnect());
    this._barHeight();
    this.update();
  }

  _confirm(open) {
    this.confirm.hidden = !open;
    this.btnSkip.hidden = open;
    const s = this.player.session;
    if (s && s.core) s.core.isPause = open;
  }

  _barHeight() { this.player.root.style.setProperty("--bar-h", `${this.bar.offsetHeight || 44}px`); }

  _simple() { return this.player.session instanceof SimpleStorySession; }

  // shows "click to start" until the first play (audio needs a user gesture)
  showStart(on) { this.big.hidden = !on; }

  update() {
    const p = this.player, t = this.t;
    this.btnPlay.textContent = p.paused ? t.play : t.pause;
    this.btnAuto.setAttribute("aria-pressed", String(!!p.auto));
    this.btnSpeed.textContent = `${t.speed} ${speedLabel(p.speed)}`;
    this.btnSpeed.setAttribute("aria-pressed", String(p.speed !== 10));
    const n = p.lineCount;
    this.pos.textContent = p.ended ? t.ended : n ? `${t.line} ${Math.max(0, p.line) + 1} / ${n}` : "";
    const live = !!p.session && !p.ended;
    for (const b of [this.btnNext, this.btnAuto, this.btnSpeed, this.btnSkip]) b.disabled = !live;
    this.btnAuto.hidden = this.btnSpeed.hidden = this._simple();
  }

  dispose() { for (const f of this._off) f(); this.bar.remove(); this.big.remove(); }
}
