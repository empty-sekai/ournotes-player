// StoryPlayer's handling of its session without a page: the player's pause holds the session's videos with the frames,
// a session started while paused starts held, a language switch after a seek before the first play restarts at the
// seek's line, a seek within a clip plays on to the last target asked for (forward in the session playing the clip,
// backward in a new one at the clip's row), and the control labels follow the story's language unless the host sets
// one; the drawing buffer is the game's screen for the quality unless resolution is native, and a volume that is not a
// number is 0. Stand-in sessions only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { StoryPlayer } from "../../src/story/player.js";
import { StorySession } from "../../src/story/session.js";

const fakeSession = (lineCount = 10, line = -1) => ({
  lang: "ja", lineCount, line, started: false, held: [],
  audio: { suspend: async () => {}, resume: async () => {} },
  setVolume() {}, resize() {}, render() {}, play() { this.started = true; }, setPaused(on) { this.held.push(on); },
  dispose() {},
});

// a StoryPlayer without its DOM: the members _startSession, play, pause and setLanguage read
const bare = () => Object.assign(Object.create(StoryPlayer.prototype), {
  opts: {}, gl: null, store: {}, _lang: "ja", _auto: false, _speed: 10, _volumes: { Bgm: 1 }, _paused: false,
  disposed: false, controls: null, session: null, _audioContext: null, _manifest: {}, _abort: new AbortController(),
  _pixelSize: () => [130, 60], _emit() {}, _loadStore: async () => ({}), _exclusive: async (fn) => fn(),
});

const withSessions = async (sessions, fn) => {
  const create = StorySession.create, opts = [];
  StorySession.create = async (gl, store, o) => { opts.push(o); return sessions.shift(); };
  try { await fn(opts); } finally { StorySession.create = create; }
};

test("the player's pause holds the session's videos; its play lets them go on", () => {
  const p = bare(), s = fakeSession();
  p.session = s;
  p.play();
  assert.deepEqual(s.held, []);                                          // not paused: nothing to let go
  p.pause();
  p.pause();
  assert.deepEqual([p.paused, s.held], [true, [true]]);
  p.play();
  assert.deepEqual([p.paused, s.held], [false, [true, false]]);
});

test("a seek before the first play, then a language: the new language starts at the seek's line", () => withSessions(
  [fakeSession(10, 4), fakeSession(10, 4), fakeSession(10, 4), fakeSession(10, 9)], async (opts) => {
    const p = bare();
    p._paused = true;
    await p._startSession(5, false);                                     // the session reports line 4 until line 5 shows
    assert.deepEqual([opts[0].line, p._startLine, p.line, p.session.held], [5, 5, 4, [true]]);   // held while paused
    await p.setLanguage("en");
    assert.equal(opts[1].line, 5);
    p.session.line = 7;                                                  // played on: the current line
    await p.setLanguage("ko");
    assert.equal(opts[2].line, 7);
    await p._startSession(99, false);
    assert.equal(p._startLine, 9);                                        // the session's clamp
  }));

test("a seek within a clip: forward the session goes on from the clip's time; a later seek moves the target, one back starts at the clip's row", () => {
  const clipAt = (time) => ({ kind: "clip", time, duration: 100, row: 7, seekable: true });
  const runs = [];
  // a session playing the clip at `time`; moveBack: two seeks arrive while it runs, the last behind the time reached
  const ffSession = (time, moveBack = false) => Object.assign(fakeSession(), {
    started: true, video: clipAt(time), disposed: 0, dispose() { this.disposed++; },
    async fastForwardClip(target, o) {
      const run = { at: this.video.time, first: target(), row: o.row };
      runs.push(run);
      await new Promise((r) => setTimeout(r, 0));
      if (moveBack) { p.seekVideo(30); p.seekVideo(20); }
      run.last = target();
      run.paused = o.paused();
      if (target() < run.first) return { time: run.first, back: true };
      this.video = clipAt(target());
      return { time: target(), back: false };
    },
  });
  const p = bare();
  return withSessions([ffSession(0)], async (opts) => {
    const playing = p.session = ffSession(10, true);
    const first = p.seekVideo(40);
    assert.deepEqual(p.video, clipAt(40));                                // the target shows
    const later = p.seekVideo(60);                                        // a later seek moves the target
    assert.equal(p.video.time, 60);
    assert.deepEqual(await Promise.all([first, later]), [true, true]);
    assert.deepEqual(runs, [{ at: 10, first: 40, row: 7, last: 20, paused: false },   // from the clip's time
                            { at: 0, first: 20, row: 7, last: 20, paused: false }]);  // back: a session at the row
    assert.deepEqual([opts.map((o) => [o.row, o.autoplay]), playing.disposed], [[[7, false]], 1]);
    assert.deepEqual(p.video, clipAt(20));                                // done: the session's own position again
    // forward again: the same session, no new one
    assert.equal(await p.seekVideo(90), true);
    assert.deepEqual([runs.length, runs[2].at, opts.length, p.video.time], [3, 20, 1, 90]);
  });
});

test("a seek within a clip behind the clip's time starts at the clip's row at once", () => {
  const p = bare(), runs = [];
  const session = (time) => Object.assign(fakeSession(), {
    started: true, video: { kind: "clip", time, duration: 50, row: 4, seekable: true }, dispose() {},
    async fastForwardClip(target) { runs.push([this.video.time, target()]); this.video.time = target(); return { time: target(), back: false }; },
  });
  return withSessions([session(0)], async (opts) => {
    p.session = session(30);
    assert.equal(await p.seekVideo(12), true);
    assert.deepEqual([runs, opts.map((o) => o.row)], [[[0, 12]], [4]]);
  });
});

test("the control labels: the language the story plays in, after a language switch too, unless the host sets one", () => withSessions(
  [Object.assign(fakeSession(), { lang: "zh-Hant" }), fakeSession(), Object.assign(fakeSession(), { lang: "en" })], async () => {
    const langs = [];
    const p = Object.assign(bare(), { controls: { setLanguage: (l) => langs.push(l), update() {}, showStart() {} } });
    p._lang = null; p._manifest = { manifest: { language: "zh-Hant" } };
    p._labels();                                                          // the manifest read: its language
    await p._startSession(0, false);
    await p.setLanguage("ja");                                            // the session's language
    p.setUiLanguage("ko");
    await p.setLanguage("en");                                            // the host's language stays
    p.setUiLanguage(null);
    assert.deepEqual(langs, ["zh-Hant", "zh-Hant", "ja", "ko", "ko", "en"]);
  }));

test("the drawing buffer: the game's screen for the quality by default, every device pixel with resolution native", () => {
  const p = Object.create(StoryPlayer.prototype);
  p._devicePixels = () => [2400, 1080];
  Object.assign(p, { _quality: 4, _nativeResolution: false });
  assert.deepEqual(p._pixelSize(), [1920, 864]);
  p._quality = 2;
  assert.deepEqual(p._pixelSize(), [1440, 648]);
  p._nativeResolution = true;
  assert.deepEqual(p._pixelSize(), [2400, 1080]);
});

test("setVolume: a value that is not a number is 0, others are clamped to [0, 1]", () => {
  const set = [];
  const p = Object.assign(bare(), { session: { setVolume: (c, v) => set.push([c, v]) } });
  for (const v of ["x", NaN, undefined, -1, 2, "0.5"]) p.setVolume("Bgm", v);
  assert.deepEqual(set.map(([, v]) => v), [0, 0, 0, 0, 1, 0.5]);
});
