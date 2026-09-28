// The story control bar (controls.js) on a stand-in DOM and a stand-in player: the line bar and its label, a seek
// from the bar (coalesced while one runs, its line shown until the new session reaches it), the skip confirmation,
// the video bar (a movie or a clip seeks on change, a video that cannot be seeked only shows; the line bar rests while
// a clip's seek replaces the session), the labels' language, and the taps and keys that wait for a session. Synthetic
// inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { StoryControls, formatStoryTime } from "../../src/story/controls.js";

const flush = () => new Promise((res) => setImmediate(res));

// elements with the properties, attributes and listeners the bar uses
const fakeDocument = () => {
  const doc = { documentElement: { lang: "en" }, defaultView: {} };
  doc.createElement = (tag) => {
    const listeners = new Map(), attrs = new Map();
    return {
      tagName: tag.toUpperCase(), className: "", textContent: "", hidden: false, disabled: false, value: "", max: "",
      min: "", step: "", type: "", offsetHeight: 44, children: [], ownerDocument: doc,
      style: { setProperty() {} },
      append(...c) { this.children.push(...c); }, remove() {}, focus() {},
      setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener(type, fn) { const l = listeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      fire(type, extra = {}) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, target: this, button: 0, ...extra }); },
    };
  };
  return doc;
};

// a player with the members the bar reads; seekToLine resolves when the test says so
const fakePlayer = ({ lineCount = 10, line = -1 } = {}) => {
  const doc = fakeDocument(), root = doc.createElement("div");
  // StorySession.setDialogOpen: the playback waits (and a playing video pauses) while the confirmation is open
  const session = (l = line) => ({ core: { isPause: false }, line: l, dialogs: [],
                                   setDialogOpen(open, resume = true) {
                                     this.core.isPause = open; this.dialogs.push(open ? open : resume ? "cancel" : "skip");
                                   } });
  const p = {
    root, shadow: doc.createElement("#shadow-root"), canvas: doc.createElement("canvas"),
    paused: false, auto: false, speed: 10, ended: false, video: null, seeks: [], videoSeeks: [], lineCount,
    session: session(), newSession: session,
    get line() { return this.session ? this.session.line : -1; },
    seekToLine(i) {
      const old = this.session;
      this.session = null;
      if (this.controls) this.controls.update();                         // StoryPlayer._replace syncs the bar
      return new Promise((res) => this.seeks.push({ line: i, done: (l = i - 1) => {
        this.session = session(l); if (this.controls) this.controls.update(); res(); }, old }));
    },
    seekVideo(sec) { this.videoSeeks.push(sec); return Promise.resolve(true); },
    play() {}, pause() {}, next() {}, setAuto() {}, setSpeed() {}, skip() {}, setVolume() {},
  };
  const lc = p.lineCount;
  Object.defineProperty(p, "lineCount", { get() { return this.session ? lc : 0; } });
  p.controls = new StoryControls(p, { lang: "en" });
  return p;
};

test("the line bar: the line of the player, its count, the label; off without a session, with one line, while confirming", () => {
  const p = fakePlayer(), c = p.controls;
  assert.deepEqual([c.seek.min, c.seek.max, c.seek.value, c.seek.disabled], ["0", "9", "0", false]);
  assert.equal(c.pos.textContent, "Line 1 / 10");                        // before the first line
  assert.equal(c.seek.getAttribute("aria-label"), "Position");
  p.session.line = 3; c.update();
  assert.deepEqual([c.seek.value, c.pos.textContent, c.seek.getAttribute("aria-valuetext")], ["3", "Line 4 / 10", "Line 4 / 10"]);
  // ended: the label says so, the bar can still restart at a line
  p.ended = true; c.update();
  assert.deepEqual([c.pos.textContent, c.seek.disabled], ["The end", false]);
  p.ended = false;
  // the skip confirmation: the bar rests and the playback waits
  c.btnSkip.fire("click");
  assert.deepEqual([c.seek.disabled, p.session.core.isPause], [true, true]);
  c.btnSkipNo.fire("click");
  assert.deepEqual([c.seek.disabled, p.session.core.isPause, p.session.dialogs], [false, false, [true, "cancel"]]);
  c.btnSkip.fire("click"); c.btnSkipYes.fire("click");                  // confirmed: the paused video is not resumed
  assert.deepEqual(p.session.dialogs.slice(2), [true, "skip"]);
  p.session = null; c.update();
  assert.deepEqual([c.seek.disabled, c.pos.textContent], [true, ""]);   // loading
  const one = fakePlayer({ lineCount: 1 });
  assert.equal(one.controls.seek.disabled, true);
});

test("a seek from the bar: one runs at a time, the last request waits; the bar shows the target until its session shows it", async () => {
  const p = fakePlayer(), c = p.controls;
  p.session.line = 2; c.update();
  c.seek.value = "6"; c.seek.fire("input");
  assert.equal(c.pos.textContent, "Line 7 / 10");                        // shown while dragged, not applied
  assert.equal(p.seeks.length, 0);
  c.seek.fire("change");
  await flush();
  assert.deepEqual(p.seeks.map((s) => s.line), [6]);
  assert.equal(c.seek.disabled, false);                                  // no session meanwhile: the bar stays usable
  assert.deepEqual([c.seek.max, c.seek.value], ["9", "6"]);
  // two more while it runs: only the last follows
  c.seek.value = "8"; c.seek.fire("change");
  c.seek.value = "4"; c.seek.fire("change");
  assert.equal(c.seek.value, "4");
  p.seeks[0].done();
  await flush();
  assert.deepEqual(p.seeks.map((s) => s.line), [6, 4]);
  p.seeks[1].done();                                                     // the new session is at line 3 until its shortcut ends
  await flush();
  assert.equal(p.seeks.length, 2);
  assert.deepEqual([p.line, c.seek.value, c.pos.textContent], [3, "4", "Line 5 / 10"]);
  p.session.line = 4; c.update();
  assert.equal(c.seek.value, "4");
  p.session.line = 5; c.update();
  assert.deepEqual([c.seek.value, c.pos.textContent], ["5", "Line 6 / 10"]);
  // keys: a change per step, as the range input sends them
  c.seek.value = "9"; c.seek.fire("input"); c.seek.fire("change");
  await flush();
  assert.equal(p.seeks[2].line, 9);
  p.seeks[2].done();
  await flush();
  assert.equal(c.seek.value, "9");
});

test("a seek from the bar while the skip confirmation is open is not possible; a session started meanwhile waits too", async () => {
  const p = fakePlayer(), c = p.controls;
  c.btnSkip.fire("click");
  assert.equal(c.seek.disabled, true);
  // a seek of the page's (StoryPlayer.seekToLine) replaces the session: the confirmation still holds the playback
  const run = p.seekToLine(5);
  p.seeks[0].done();
  await run;
  assert.equal(p.session.core.isPause, true);
  c.btnSkipNo.fire("click");
  assert.deepEqual([p.session.core.isPause, c.seek.disabled], [false, false]);
});

test("the video bar: the time of a playing video; a movie seeks on change, one that cannot be seeked only shows; hidden without one", async () => {
  const p = fakePlayer(), c = p.controls;
  assert.equal(c.vid.hidden, true);
  p.video = { kind: "movie", time: 12.4, duration: 109.2, seekable: true };
  c.tick();
  assert.deepEqual([c.vid.hidden, c.vidSeek.disabled, c.vidSeek.max, c.vidSeek.value, c.vidSeek.step],
                   [false, false, "109.2", "12.4", "any"]);
  assert.deepEqual([c.vidTime.textContent, c.vidSeek.getAttribute("aria-valuetext")], ["0:12 / 1:49", "0:12 / 1:49"]);
  // dragged: the playback does not move the thumb; the label follows the thumb
  c.vidSeek.fire("pointerdown");
  c.vidSeek.value = "60"; c.vidSeek.fire("input");
  p.video = { ...p.video, time: 13 };
  c.tick();
  assert.deepEqual([c.vidSeek.value, c.vidTime.textContent], ["60", "1:00 / 1:49"]);
  c.vidSeek.fire("change"); c.vidSeek.fire("pointerup");
  await flush();
  assert.deepEqual(p.videoSeeks, [60]);
  p.video = { ...p.video, time: 60 };
  c.tick();
  assert.equal(c.vidSeek.value, "60");
  // the skip confirmation rests it; a clip only shows
  c.btnSkip.fire("click");
  assert.equal(c.vidSeek.disabled, true);
  c.btnSkipNo.fire("click");
  p.video = { kind: "clip", time: 3, duration: 20, seekable: false };
  c.tick();
  assert.deepEqual([c.vidSeek.disabled, c.vidTime.textContent], [true, "0:03 / 0:20"]);
  p.video = null;
  c.tick();
  assert.equal(c.vid.hidden, true);
});

test("the video bar of a clip: a change seeks it; the line bar rests at its line while the session is replaced", async () => {
  const p = fakePlayer(), c = p.controls;
  let finish;
  const run = new Promise((res) => { finish = res; });
  p.seekVideo = function (sec) { this.videoSeeks.push(sec); return run; };   // StoryPlayer: every seek of the run ends with it
  p.session.line = 4;
  p.video = { kind: "clip", time: 3, duration: 20, row: 7, seekable: true };
  c.update();
  assert.equal(c.vidSeek.disabled, false);
  c.vidSeek.value = "12"; c.vidSeek.fire("change");
  p.session = null; p.video = { ...p.video, time: 12 }; c.update();       // the session replaced, the target shown
  assert.deepEqual([c.seek.disabled, c.seek.value, c.seek.max, c.vidSeek.disabled, c.vidSeek.value], [true, "4", "9", false, "12"]);
  c.vidSeek.value = "8"; c.vidSeek.fire("change");                       // another while it runs: the player moves the target
  assert.deepEqual(p.videoSeeks, [12, 8]);
  p.session = p.newSession(5); p.video = { ...p.video, time: 8 };
  finish(true);
  await flush();
  assert.deepEqual([c.seek.disabled, c.seek.value, c.vidSeek.value], [false, "5", "8"]);
  p.video = null;
  assert.equal(await c.seekVideo(3), false);                              // no video: nothing to seek
  assert.deepEqual(p.videoSeeks, [12, 8]);
});

test("the labels: a story language or a BCP 47 tag, relabeled in place; an unknown code as storyStrings, none the page's", () => {
  const p = fakePlayer(), c = p.controls;
  const labels = () => [c.btnNext.textContent, c.btnSkipNo.textContent, c.volLabels.Bgm.textContent, c.big.textContent,
                        c.seek.getAttribute("aria-label"), c.btnSpeed.textContent, c.pos.textContent];
  assert.deepEqual(labels(), ["Next", "Cancel", "Music", "Click to start", "Position", "Fast-forward ×1", "Line 1 / 10"]);
  c.setLanguage("zh-Hant");
  assert.deepEqual(labels(), ["下一句", "取消", "音樂", "點擊開始", "播放位置", "快轉 ×1", "台詞 1 / 10"]);
  c.setLanguage("ja-JP");
  assert.equal(c.btnNext.textContent, "次へ");
  c.setLanguage("zh-CN");
  assert.equal(c.btnNext.textContent, "下一句");
  assert.equal(c.volLabels.Bgm.textContent, "音乐");
  c.setLanguage("xx");
  assert.equal(c.btnNext.textContent, "Next");
  p.root.ownerDocument.documentElement.lang = "ko";
  const k = new StoryControls(p, {});
  assert.equal(k.btnNext.textContent, "다음");                           // none given: the page's language
});

test("video times as m:ss", () => {
  assert.deepEqual([0, 0.4, 59.99, 60, 109.2, 3599, -2].map(formatStoryTime),
                   ["0:00", "0:00", "0:59", "1:00", "1:49", "59:59", "0:00"]);
});

test("a tap, Next, Space or K while the session is replaced does nothing; the play button is off without a session", async () => {
  const p = fakePlayer();
  const calls = [];
  p.next = () => calls.push("next"); p.play = () => calls.push("play"); p.pause = () => calls.push("pause");
  p.seekToLine(3);                                                             // the session is gone until the seek ends
  p.canvas.fire("pointerdown");
  p.controls.btnNext.fire("click");
  p.controls.btnPlay.fire("click");
  for (const key of [" ", "Enter", "k"]) p.root.fire("keydown", { key, preventDefault() {} });
  assert.deepEqual(calls, []);
  assert.equal(p.controls.btnPlay.disabled, true);
  p.seeks[0].done();
  assert.equal(p.controls.btnPlay.disabled, false);
  p.canvas.fire("pointerdown");
  p.controls.btnPlay.fire("click");
  assert.deepEqual(calls, ["next", "pause"]);
});
