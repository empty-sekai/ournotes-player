// The chat rows on a real PlayerLoop at 30 fps with a synthetic chat window prefab and a stand-in story UI: opening,
// closing and reconfiguring the phone, bubbles and read labels, the conversation memory and its restore, the typing
// box, the waits, the incoming call fit, detaching while shortcutting. Synthetic inputs only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerLoop } from "../../src/engine/loop.js";
import { commandHandler } from "../../src/story/interfaces.js";
import { disposeStoryFeatures, installStoryFeatures } from "../../src/story/features/index.js";
import { ChatMemoryState, formatWindowName, storyChat, truncateName } from "../../src/story/features/chat.js";

const flush = () => new Promise((res) => setImmediate(res));
const settle = async (loop, promise, max = 900) => {
  let done = false;
  promise.then(() => { done = true; });
  await flush();
  const f0 = loop.frameCount;
  while (!done && loop.frameCount - f0 < max) { await loop.step(); await flush(); }
  assert.ok(done, "not settled");
  return loop.frameCount - f0;
};
const steps = async (loop, n) => { await flush(); for (let i = 0; i < n; i++) { await loop.step(); await flush(); } };

const Z = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, ONE = { x: 1, y: 1, z: 1 };
const rect = (aMin, aMax, pos, size, pivot = { x: 0.5, y: 0.5 }) => ({ m_AnchorMin: aMin, m_AnchorMax: aMax, m_AnchoredPosition: pos,
                                                                        m_SizeDelta: size, m_Pivot: pivot });
const TOP = { x: 0.5, y: 1 }, FULL = rect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 });
const W = "win";
const node = (path, r = FULL, components = [], active = true) => ({ path: `${W}${path}`, name: (path.split("/").pop() || W),
  active, layer: 5, localPosition: Z, localRotation: Q, localScale: ONE, rect: r, components });
const ref = (path, cls) => ({ component: "MonoBehaviour", gameObject: `${W}${path}`, class: cls });
const chatNode = (path, my) => node(path, rect(TOP, TOP, { x: 0, y: 0 }, { x: 600, y: 100 }, TOP),
  [{ type: "MonoBehaviour", class: my ? "AdvMyChatNode" : "AdvOtherChatNode", m_Enabled: 1 }]);
const windowDoc = ({ group = 0, layout = 0 } = {}) => ({ key: `Adv/Chat/Prefabs/${W}`, nodes: [
  node("", rect(TOP, TOP, { x: 0, y: 0 }, { x: 720, y: 700 }, TOP), [{ type: "MonoBehaviour", class: "AdvChatWindow", m_Enabled: 1,
    _myChatNodePrefab: ref("/Mask/Scroll View/Viewport/Content/MyChatNode", "AdvMyChatNode"),
    _otherChatNodePrefab: ref("/Mask/Scroll View/Viewport/Content/OtherChatNode", "AdvOtherChatNode"),
    _chatNodeParent: { transform: `${W}/Mask/Scroll View/Viewport/Content` }, _scrollRect: ref("/Mask/Scroll View", "ScrollRect"),
    _lockChatNodeParent: { transform: `${W}/Mask/LockScreen/SVLock/Viewport/Content` }, _lockScrollRect: ref("/Mask/LockScreen/SVLock", "ScrollRect"),
    _normalScreenObject: { gameObject: `${W}/Mask/Scroll View` }, _lockScreenObject: { gameObject: `${W}/Mask/LockScreen` },
    _incomingCallObject: { gameObject: `${W}/Mask/IncomingCall` }, _lockScreenNameText: null,
    _incomingCallStatusTextKey: "call_status", _lockScreenStatusTextKey: "lock_status",
    _typingContentText: ref("/Mask/Scroll View/Viewport/Typing/Text", "UIText"), _showBatteryPercentSymbol: 1,
    _isGroupChat: group, _chatLayoutMode: layout, _windowPosition: { x: 0, y: 0 }, _windowRotation: { x: 0, y: 0, z: 0 } }]),
  node("/Mask", rect(TOP, TOP, { x: 0, y: -30 }, { x: 700, y: 1470 }, TOP)),
  node("/Mask/Scroll View"), node("/Mask/Scroll View/Viewport"), node("/Mask/Scroll View/Viewport/Content"),
  chatNode("/Mask/Scroll View/Viewport/Content/MyChatNode", true), chatNode("/Mask/Scroll View/Viewport/Content/OtherChatNode", false),
  node("/Mask/Scroll View/Viewport/Typing"), node("/Mask/Scroll View/Viewport/Typing/Text"),
  node("/Mask/LockScreen", FULL, [], false), node("/Mask/LockScreen/SVLock"), node("/Mask/LockScreen/SVLock/Viewport"),
  node("/Mask/LockScreen/SVLock/Viewport/Content"),
  chatNode("/Mask/LockScreen/SVLock/Viewport/Content/MyChatNode", true), chatNode("/Mask/LockScreen/SVLock/Viewport/Content/OtherChatNode", false),
  node("/Mask/IncomingCall", FULL, [], false),
] });
const chatDoc = (opts) => ({ chats: { 100: { _id: 100, _chatSoundId: 51, _inOutSoundId: 52, _chatWindowAssetName: W, _chatIconAssetName: "icon100" },
                                      200: { _id: 200, _chatSoundId: 0, _inOutSoundId: 0, _chatWindowAssetName: "", _chatIconAssetName: "icon200" } },
                             windows: { [W]: windowDoc(opts) }, icons: { icon100: {}, icon200: {} }, stamps: { "stamp/s1": {} } });

const makePlayer = (rows, { auto = false, doc = chatDoc() } = {}) => {
  const loop = new PlayerLoop(30), se = [], log = [];
  let indicator = false;
  const ui = { isTyping: false, showNextIndicator: () => { indicator = true; }, hideNextIndicator: () => { indicator = false; },
               get indicator() { return indicator; } };
  const texts = { 60001: "Read", 60004: "[stamp]", 11: "Group", 21: "hello there", 22: "me", 23: "typing!", 31: "Alice", s1_log: "[s1]" };
  const fieldRenderer = { foreground: { count: 0 }, addForegroundEntry() { this.foreground.count++; },
                          removeForegroundEntry() { this.foreground.count = Math.max(this.foreground.count - 1, 0); } };
  const ctx = { loop, ui, gl: null, fieldRenderer, localize: (id) => texts[id] ?? `t${id}`,
                audio: { play: (id) => { se.push([id, loop.frameCount]); return se.length; }, stop() {}, isPlaying: () => false,
                         lastBgmOrSeFrame: -1 },
                settings: { player: { _waitTalkTextUnitTime: 0.04, _minTalkDisplayTime: 1.6, _waitAfterVoiceTime: 0.6 },
                            masterIds: { _chatReadTextId: "60001", _chatStampLogTextId: "60004" } },
                episode: { commands: rows.map((r, i) => ({ i, ...r })), text: texts }, story: { chat: "chat/chat.json" },
                assets: { json: (p) => { assert.equal(p, "chat/chat.json"); return doc; } } };
  const p = { ctx, playbackSpeed: 10, cancelled: false, shortCutIndex: -1, isAutoPlay: auto, nextStep: 0, autoAdvCancel: null,
              session: { voicePlayIds: [], sePlayIds: [], withVoice: true },
              speedRate() { return this.playbackSpeed / 10; }, get shortcut() { return this.shortCutIndex >= 0; },
              changeNextStepStateOnAutoPlay() { this.nextStep = this.isAutoPlay ? 2 : 1; },
              fail(e) { throw e; }, onLog: (e) => log.push(e),
              tap() { const f = this.autoAdvCancel; this.autoAdvCancel = null; if (f) f(); if (this.nextStep === 1) this.nextStep = 2; } };
  return { ctx, p, loop, se, log, ui };
};
const run = (t, row) => commandHandler(row.cmd)(row, t.p);
const OPEN = { cmd: "ChatWindow", TargetChatID: 100, TargetTextIDs: ["11"], Parameter1: "80", Parameter2: "0", Parameter4: "3" };

test("ChatWindow opens the phone (SE, slide in 0.3 s, then the tap) and a repeated row closes it without a wait", async () => {
  const rows = [OPEN, { ...OPEN }];
  const t = makePlayer(rows);
  await installStoryFeatures(t.ctx, t.p);
  const chat = storyChat(t.ctx), v = chat.view;
  const open = run(t, { ...rows[0], i: 0 });
  assert.deepEqual(t.se, [[52, 0]]);
  assert.equal(t.ctx.fieldRenderer.foreground.count, 1);
  assert.equal(v.target.pos.y, -1080);                                    // below the view
  await steps(t.loop, 9);
  assert.equal(v.target.pos.y, 0);                                        // slid in (OutExpo, 0.3 s)
  assert.equal(t.ui.indicator, true);
  assert.equal(t.p.nextStep, 1);
  t.p.tap();
  await settle(t.loop, open);
  assert.equal(t.ui.indicator, false);
  const w = chat.window(100);
  assert.deepEqual([w.text.windowName, w.text.battery, w.text.batteryFill], ["Group", "80%", Math.fround(0.8)]);   // not a group: no count
  assert.equal(v.baseScale.x, Math.fround(1080 / 700));
  const f = await settle(t.loop, run(t, { ...rows[1], i: 1 }));
  assert.ok(f >= 6 && f <= 7, `${f}`);                                     // 0.2 s slide out, no tap
  assert.deepEqual(t.se.map((e) => e[0]), [52, 52]);
  assert.deepEqual([w.active, t.ctx.fieldRenderer.foreground.count, chat.screenMode], [false, 0, 0]);
  disposeStoryFeatures(t.ctx);
});

test("ChatTalk / ChatStamp / ChatRead: bubbles, read labels, the chat SE and the auto timing by the text length", async () => {
  const rows = [{ ...OPEN, IsNoWait: true }, { cmd: "ChatTalk", TargetChatID: 200, TargetTextIDs: ["31"], AdvTextID: "21" },
                { cmd: "ChatTalk", TargetChatID: 100, AdvTextID: "22", Parameter1: "1" }, { cmd: "ChatStamp", TargetChatID: 200, TargetAssetName: "stamp/s1" },
                { cmd: "ChatRead", Parameter1: "2" }];
  const t = makePlayer(rows, { auto: true });
  await installStoryFeatures(t.ctx, t.p);
  const v = storyChat(t.ctx).view;
  await settle(t.loop, run(t, { ...rows[0], i: 0 }));                      // IsNoWait: detached
  await steps(t.loop, 10);
  const f = await settle(t.loop, run(t, { ...rows[1], i: 1 }));
  // "hello there": 11 x 0.04 = 0.44 s, padded to 1.6 s (48 frames), then the trailing tick
  assert.ok(f >= 49 && f <= 50, `${f}`);
  assert.deepEqual(t.se.at(-1)[0], 51);
  assert.deepEqual(t.log.map((e) => [e.speaker, e.text]), [["Alice", "hello there"]]);
  await settle(t.loop, run(t, { ...rows[2], i: 2 }));
  await settle(t.loop, run(t, { ...rows[3], i: 3 }));
  assert.deepEqual(v.mainNodes.map((n) => [n.other, n.text, n.stamp, n.readShown, n.readText]),
                   [[true, "hello there", null, false, ""], [false, "me", null, true, "Read"], [true, null, "stamp/s1", false, ""]]);
  assert.deepEqual(t.log.at(-1).text, "[s1]");
  await settle(t.loop, run(t, { ...rows[4], i: 4 }));
  assert.equal(v.selfEntries[0].readCount, 2);
  assert.equal(v.currentReadCount, 2);
  disposeStoryFeatures(t.ctx);
});

test("chat memory: rows for a closed memory are only stored; reopening restores them and logs the deferred entries", async () => {
  const rows = [{ ...OPEN, Parameter3: "7" }, { cmd: "ChatTalk", TargetChatID: 200, AdvTextID: "21", Parameter3: "7" },
                { ...OPEN, Parameter3: "7" }, { cmd: "ChatTalk", TargetChatID: 100, AdvTextID: "22", Parameter3: "7", Parameter1: "1" },
                { ...OPEN, Parameter3: "7" }];
  const t = makePlayer(rows);
  t.p.shortCutIndex = 99;                                                  // everything detached, no waits or SEs
  await installStoryFeatures(t.ctx, t.p);
  const chat = storyChat(t.ctx), v = chat.view;
  for (const i of [0, 1, 2]) await settle(t.loop, run(t, { ...rows[i], i }));
  await steps(t.loop, 3);
  assert.equal(v.visible, false);
  await settle(t.loop, run(t, { ...rows[3], i: 3 }));                      // closed: stored only
  assert.equal(v.mainNodes.length, 1);
  assert.equal(t.log.length, 1);
  assert.deepEqual(chat.memory.get(7).entries.map((e) => [e.sender, e.text, e.readCount, e.isTalkLogAdded]),
                   [[200, "hello there", null, true], [100, "me", 1, false]]);
  await settle(t.loop, run(t, { ...rows[4], i: 4 }));                      // reopened: restored, the deferred entry logged
  await steps(t.loop, 3);
  assert.deepEqual(v.mainNodes.map((n) => [n.other, n.text]), [[true, "hello there"], [false, "me"]]);
  assert.deepEqual(t.log.map((e) => e.text), ["hello there", "me"]);
  assert.equal(t.se.length, 0);
  assert.equal(t.ctx.fieldRenderer.foreground.count, 1);
  disposeStoryFeatures(t.ctx);
});

test("ChatTyping types into the input box (instant while shortcutting); an own message clears it", async () => {
  const rows = [{ ...OPEN, IsNoWait: true }, { cmd: "ChatTyping", AdvTextID: "23", IsNoWait: true }, { cmd: "ChatTalk", TargetChatID: 100, AdvTextID: "22", IsNoWait: true }];
  const t = makePlayer(rows);
  await installStoryFeatures(t.ctx, t.p);
  const v = storyChat(t.ctx).view;
  await settle(t.loop, run(t, { ...rows[0], i: 0 }));
  await steps(t.loop, 10);
  const typing = run(t, { ...rows[1], i: 1 });
  assert.equal(v.typing.maxVisible, 1);
  const f = await settle(t.loop, typing);
  // "typing!": 6 letters (a tick each) and "!" (a tick and 0.03 s), then the layout sync's last tick
  assert.ok(f >= 8 && f <= 9, `${f}`);
  assert.deepEqual([v.typing.text, v.typing.maxVisible], ["typing!", 7]);
  await settle(t.loop, run(t, { ...rows[2], i: 2 }));
  assert.equal(v.typing.text, "");
  disposeStoryFeatures(t.ctx);
});

test("the incoming call screen fits the phone's visible bounds into the view; names; the read state of the memory", async () => {
  const rows = [{ ...OPEN, Parameter2: "1", IsNoWait: true }];
  const t = makePlayer(rows);
  t.p.shortCutIndex = 99;
  await installStoryFeatures(t.ctx, t.p);
  const v = storyChat(t.ctx).view;
  await settle(t.loop, run(t, { ...rows[0], i: 0 }));
  await steps(t.loop, 2);
  // bounds: the root (720 x 700) and the Mask (700 x 1470 from y -30): 720 x 1500; k = 1080 / 700; fit 540 / (1500 k / 2)
  const k = Math.fround(1080 / 700), mult = Math.fround(540 / Math.fround(Math.fround(1500 * k) * 0.5));
  assert.ok(Math.abs(v.target.scale.y - Math.fround(mult * k)) < 1e-5, `${v.target.scale.y}`);
  disposeStoryFeatures(t.ctx);

  assert.equal(truncateName("abcdefghijkl"), "abcdefghijkl");
  assert.equal(truncateName("abcdefghijklm"), "abcdefghijkl...");
  assert.equal(truncateName("ab cdef ghijk xyz"), "ab cdef ghij...");
  assert.equal(truncateName("αβγδεζη"), "αβγδεζ...");                   // outside ASCII and halfwidth forms: width 2
  assert.equal(formatWindowName("Band", 5, true), "Band(5)");
  assert.equal(formatWindowName("Band", 100, true), "Band");
  assert.equal(formatWindowName("Band", 5, false), "Band");

  const m = new ChatMemoryState();
  m.addTalk(9, "a", "", 0, [], true);
  m.addTalk(9, "b", "", 2, [], true);                                      // AddEntry applies the read: both 2
  m.addTalk(9, "c", "", 0, [], true);
  m.applyRead(9, 1);                                                       // never lowers a count; the new entry: 2 (last applied)
  assert.deepEqual(m.entries.map((e) => e.readCount), [2, 2, 1]);
});
