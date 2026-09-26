import { F } from "../../engine/core.js";
import { UINode, uiCanvasSize } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { countRenderedCharacters, removeTagsWithRuby } from "../ui-talk.js";
import { compOf } from "./canvas.js";
import { DTCancelled, DTSequence, DT_PLUGIN, dtTo, storyDOTween } from "./dotween-core.js";
import { featureSlot, featureState } from "./state.js";

// The phone of the chat rows: UIAdvChatWidget with its AdvChatView, one AdvChatWindow instance per chat id, the
// conversation memory of the session (AdvPlaybackSession / AdvChatMemoryState). The commands add and remove the
// phone's foreground entry on the field renderer (AdvForegroundFieldRendererEntry). Everything the commands observe is modelled: the window's visibility
// and slides, screen modes, the bubbles and the lock-screen timeline, read counts, the typing box, the memory. The
// phone is not drawn: its bubbles are uGUI layout groups around TextMeshPro text.
// ENGINE: VerticalLayoutGroup / ContentSizeFitter / ScrollRect / SoftMask layout and TMP text are not modelled, so the
// scroll positions and the typing box height are not computed (the scroll tweens keep their timing on a 0 position).

// UIAdvChatWidget prefab values (the story data has no widget record): the ChatCanvas (Screen Space - Camera on the ADV
// camera, sortingOrder 10000, CanvasScaler ScaleWithScreenSize 1920 x 1080 Expand), the AdvChatView serialized fields,
// and the Target rect (anchors and pivot (0.5, 1), size 0, anchored position 0).
export const CHAT_WIDGET = Object.freeze({
  sortingOrder: 10000,
  scaler: Object.freeze({ m_UiScaleMode: 1, m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 1,
                          m_MatchWidthOrHeight: 0, m_ReferencePixelsPerUnit: 100 }),
  showEaseDuration: 0.3, hideEaseDuration: 0.2, showEase: 18, hideEase: 18, scrollDuration: 0.2, typingDelay: 0.03,
  typingTextBoxMinHeight: 63, screenModeTransitionDuration: 0.18, screenModeTransitionEase: 9,
  incomingCallPositionOffset: Object.freeze({ x: 0, y: 0 }), targetPosition: Object.freeze({ x: 0, y: 0 }),
});
// the ADV viewport before the first layout (a headless session): 13:6
const DEFAULT_VIEWPORT = { width: 2340, height: 1080 };
const INT_MAX = 2147483647;

// AdvChatWindowNameHelper.TruncateName: NFC, per text element width 1 (U+00A0, U+0020..U+007E, U+FF61..U+FF9F) or 2;
// past 12 the name is cut before the element that exceeds it, trimmed at the end, and "..." appended.
// ENGINE: .NET StringInfo text elements; Intl.Segmenter grapheme clusters stand in for them.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const truncateName = (name) => {
  const s = name.normalize("NFC");
  let width = 0, cut = 0;
  for (const { segment, index } of segmenter.segment(s)) {
    const c = segment.charCodeAt(0);
    const w = c === 0xA0 || (c >= 0x20 && c < 0x7F) || (c >= 0xFF61 && c < 0xFFA0) ? 1 : 2;
    if (width + w > 12) return `${s.slice(0, index).trimEnd()}...`;
    width += w; cut = index + segment.length;
  }
  return s.slice(0, cut);
};
// AdvChatWindowNameHelper.Format: the member count in parentheses for a group of 2..99
export const formatWindowName = (name, members, canAppend) => {
  if (!name) return name;
  const t = truncateName(name);
  return canAppend && members >= 2 && members <= 99 ? `${t}(${members})` : t;
};

// StringExtensions.RemoveTags: the "<...>" spans dropped (the chat texts carry no ruby)
export const removeTags = (text) => {
  if (/<r(uby)?=|<ruby>|<r>/i.test(text)) throw new StoryCommandError("ruby text in a chat row not implemented");
  return removeTagsWithRuby(text);
};

// ------------------------------------------------------------------------------------------------ memory
// AdvChatMemoryEntry: EntryType 0 Talk, 1 Stamp
class ChatMemoryEntry {
  constructor(type, sender, name, text, stamp, voiceIds, log) {
    Object.assign(this, { type, sender, name, text, stamp, voiceIds, readCount: null, shouldAddTalkLog: log,
                          isTalkLogAdded: false });
  }
}

// AdvChatMemoryState: the entries of one memory id and the read state per sender
export class ChatMemoryState {
  constructor() { this.entries = []; this.reads = new Map(); }

  addTalk(sender, text, name, readCount, voiceIds, log) {
    return this._add(new ChatMemoryEntry(0, sender, name, text, "", [...(voiceIds || [])], log), readCount);
  }

  addStamp(sender, stamp, name, readCount, logText, log) {
    return this._add(new ChatMemoryEntry(1, sender, name, logText, stamp, null, log), readCount);
  }

  _add(e, readCount) {
    this.entries.push(e);
    if (readCount >= 1) this.applyRead(e.sender, readCount);
    return e;
  }

  // ApplyRead: the sender's entries get max(base, readCount); base = the entry's count, else the last applied count
  // for the entries of the last application, else 0
  applyRead(sender, readCount) {
    if (sender <= 0 || readCount <= 0) return;
    let st = this.reads.get(sender);
    if (!st) { st = { current: 0, lastApplied: 0 }; this.reads.set(sender, st); }
    let i = 0;
    for (const e of this.entries) {
      if (e.sender !== sender) continue;
      let base = i < st.lastApplied ? st.current : 0;
      if (e.readCount !== null) base = e.readCount;
      e.readCount = Math.max(base, readCount);
      i++;
    }
    st.current = readCount; st.lastApplied = i;
  }

  snapshot() { return [this.entries.map((e) => [e.type, e.sender, e.text, e.stamp, e.readCount, e.isTalkLogAdded])]; }
}

// ------------------------------------------------------------------------------------------------ window
// AdvChatWindow: the prefab instance of one chat id (inactive until shown). Its RectTransforms are kept as uGUI nodes
// for the visible-bounds fit of the incoming call screen.
export class ChatWindow {
  constructor(chatId, name, doc) {
    this.chatId = chatId; this.name = name;
    this.nodes = new Map();
    for (const rec of doc.nodes) {
      const cut = rec.path.lastIndexOf("/");
      const parent = cut < 0 ? null : this.nodes.get(rec.path.slice(0, cut));
      if (cut >= 0 && !parent) throw new StoryCommandError(`${rec.path}: parent not in the chat window`);
      this.nodes.set(rec.path, new UINode(rec, parent));
    }
    this.root = this.nodes.get(doc.nodes[0].path);
    const w = compOf(this.root.rec, "AdvChatWindow");
    if (!w) throw new StoryCommandError(`chat window ${name}: no AdvChatWindow`);
    const node = (r) => (r ? this._node(r.gameObject || r.transform) : null);
    this.normal = node(w._normalScreenObject); this.lock = node(w._lockScreenObject); this.incoming = node(w._incomingCallObject);
    this.chatNodeParent = node(w._chatNodeParent); this.lockChatNodeParent = node(w._lockChatNodeParent);
    this.scrollRect = node(w._scrollRect); this.lockScrollRect = node(w._lockScrollRect);
    this.typingText = node(w._typingContentText);
    this.hasLockScreenName = !!w._lockScreenNameText;
    this.isGroupChat = !!w._isGroupChat; this.layoutMode = w._chatLayoutMode | 0;
    this.windowPosition = { x: w._windowPosition.x, y: w._windowPosition.y };
    this.windowRotationZ = w._windowRotation.z;
    this.showPercent = !!w._showBatteryPercentSymbol;
    this.statusKeys = { incoming: w._incomingCallStatusTextKey || "", lock: w._lockScreenStatusTextKey || "" };
    const r = this.root.rec.rect;
    if (r.m_AnchorMin.x !== r.m_AnchorMax.x || r.m_AnchorMin.y !== r.m_AnchorMax.y)
      throw new StoryCommandError(`chat window ${name}: a stretched root not implemented`);
    this.rootSize = { w: r.m_SizeDelta.x, h: r.m_SizeDelta.y };
    // the lock templates: the first lock Other / My node under the lock parent (inactive ones included)
    const under = (p, cls) => p ? [...this.nodes.values()].find((n) => n !== p && isUnder(n, p) && compOf(n.rec, cls)) || null : null;
    this.lockTemplates = { other: under(this.lockChatNodeParent, "AdvOtherChatNode"), my: under(this.lockChatNodeParent, "AdvMyChatNode") };
    // the node objects in the prefab (the templates and the pre-filled lock nodes)
    this.prefabChatNodes = [...this.nodes.values()].filter((n) => compOf(n.rec, "AdvMyChatNode") || compOf(n.rec, "AdvOtherChatNode"));
    this.root.activeSelf = false;                                     // TryAdd: SetActiveFast(false)
    this.currentScreenMode = 0;
    this.text = { windowName: "", battery: "", batteryFill: 0, incomingCallName: "", lockScreenName: "", status: [] };
  }

  _node(path) {
    const n = this.nodes.get(path);
    if (!n) throw new StoryCommandError(`chat window ${this.name}: ${path} not found`);
    return n;
  }

  get active() { return this.root.activeSelf; }

  // SetScreenMode: the normal screen active in mode 0, the lock screen in mode 2, the incoming call in mode 1
  setScreenMode(mode) {
    this.currentScreenMode = mode;
    if (this.normal) this.normal.activeSelf = mode === 0;
    if (this.lock) this.lock.activeSelf = mode === 2;
    if (this.incoming) this.incoming.activeSelf = mode === 1;
  }

  hideIncomingCall() {
    if (this.currentScreenMode === 1) this.setScreenMode(0);
    else if (this.incoming) this.incoming.activeSelf = false;
  }

  // RefreshStatusTexts: the two status lines are master text keys (LocalizeText)
  refreshStatusTexts() { this.text.status = [this.statusKeys.incoming, this.statusKeys.lock]; }

  // SetBatteryPercentage: "{0}%" (or "{0}") and the fill amount p / 100 (Image clamps it to 0..1)
  setBattery(pct) {
    this.text.battery = this.showPercent ? `${pct}%` : `${pct}`;
    this.text.batteryFill = Math.min(Math.max(F(pct / 100), 0), 1);
  }

  // TryGetVisibleBoundsSize: the root's corners and those of every RectTransform below it whose objects are all
  // active up to the root, in root space.
  // ENGINE: the serialized rects stand in for the layout groups' results.
  visibleBoundsSize() {
    const I = [1, 0, 0, 1, 0, 0], root = this.root;
    root.rect = { x: F(-root.pivot.x * this.rootSize.w), y: F(-root.pivot.y * this.rootSize.h), w: this.rootSize.w, h: this.rootSize.h };
    root.matrix = I;
    for (const c of root.children) c.layoutIn(root.rect, I);
    let box = null;
    const add = (n) => {
      const b = n.canvasBox();
      box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
    };
    add(root);
    const visit = (n) => { for (const c of n.children) if (c.activeSelf) { add(c); visit(c); } };
    visit(root);
    return { x: Math.abs(box[2] - box[0]), y: Math.abs(box[3] - box[1]) };
  }
}
const isUnder = (n, p) => { for (let x = n.parent; x; x = x.parent) if (x === p) return true; return false; };

// ------------------------------------------------------------------------------------------------ view
// an AdvMyChatNode / AdvOtherChatNode in a timeline
class ChatNode {
  constructor(other) {
    this.other = other; this.text = null; this.stamp = null; this.name = ""; this.icon = null; this.identity = false;
    this.readText = ""; this.readShown = false;                        // Init: the read label's alpha 0
  }
  snapshot() { return [this.other, this.text, this.stamp, this.name, this.icon, this.identity, this.readText, this.readShown]; }
}

// TypingTask.Start (showAllOnCancel): per rendered character maxVisibleCharacters = i + 1 and one Update tick, then
// for a character other than an ASCII letter UniTask.Delay(delay) (TimeSpan.FromSeconds: whole milliseconds)
const typingTask = (loop, plain, delaySec, setVisible, cancelled) => {
  const total = plain ? countRenderedCharacters(plain) : 0;
  const delay = F(Math.trunc(F(delaySec) * 1000 + 0.5) / 1000);
  const task = { totalLength: total, typing: true };
  const tick = async (check) => {
    for (;;) {
      await loop.yield("Update");
      if (cancelled()) return false;
      if (check()) return true;
    }
  };
  task.done = (async () => {
    for (let i = 0; i < total; i++) {
      setVisible(i + 1);
      if (!await tick(() => true)) { setVisible(total); break; }
      const c = plain.charCodeAt(i);
      if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) continue;
      const created = loop.frameCount;
      let elapsed = 0;
      const ok = await tick(() => {
        if (elapsed === 0 && created === loop.frameCount) return false;
        elapsed = F(elapsed + F(loop.deltaTime));
        return elapsed >= delay;
      });
      if (!ok) { setVisible(total); break; }
    }
    task.typing = false;
  })();
  return task;
};

export class ChatView {
  constructor(ctx) {
    this.ctx = ctx;
    this.mgr = storyDOTween(ctx);
    this.target = { pos: { ...CHAT_WIDGET.targetPosition }, scale: { x: 1, y: 1, z: 1 }, rotationZ: 0 };
    this.defaultPosition = { ...CHAT_WIDGET.targetPosition };         // Init: Target.anchoredPosition
    this.layout(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
    this.refresh();
  }

  // the AdvChatView rect: the ChatCanvas (Expand) over the ADV viewport
  layout(width, height) {
    const { W, H } = uiCanvasSize(CHAT_WIDGET.scaler, width, height);
    this.viewSize = { w: W, h: H };
  }

  // Refresh: every reference dropped, the tweens killed, the state reset
  refresh() {
    if (this.typingCancel) this.typingCancel();
    this._killTweens();
    this.window = null;
    this.mainNodes = []; this.lockNodes = [];
    this.selfEntries = [];
    this.readText = null; this.currentReadCount = 0; this.lastReadAppliedIndex = -1;
    this.playbackSpeed = 1;
    this.pendingMain = false; this.pendingLock = false; this.restoring = false; this.restoreLockOnly = false;
    this.baseScale = { x: 1, y: 1, z: 1 };
    this.typing = { text: "", maxVisible: INT_MAX };
    this.typingCancel = null;
    this.scroll = { main: 0, lock: 0 };
    this.warned = { my: false, other: false };
  }

  _killTweens() {
    for (const k of ["slide", "transition", "scrollMain", "scrollLock"]) if (this[k]) { this[k].kill(); this[k] = null; }
  }

  setPlaybackSpeed(s) { this.playbackSpeed = s; }

  get visible() { return !!this.window && this.window.active; }

  // TrySetChatWindow: a new window is attached under Target, sized and initialized; the previous one keeps its state
  trySetWindow(w) {
    if (w === this.window) return false;
    this.window = w;                                                   // SetChatWindow
    w.refreshStatusTexts();
    this.adjustWindowSize();
    this.initializeChat(false);
    return true;
  }

  // AdjustWindowSize: the window scaled to the view height
  adjustWindowSize() {
    const w = this.window;
    if (!w) return;
    const k = F(this.viewSize.h / w.rootSize.h);
    this.baseScale = { x: k, y: k, z: 1 };
    this.applyWindowTransform(w.active, false);
  }

  // InitializeChat(preserve): the main nodes hidden, the lock timeline reset, the read state cleared, the window's mode
  // (0 unless preserved) set, the typing text cleared
  initializeChat(preserve) {
    const w = this.window;
    if (!w) return;
    const mode = preserve ? w.currentScreenMode : 0;
    for (const n of w.prefabChatNodes) if (isUnder(n, w.chatNodeParent)) n.activeSelf = false;
    this.mainNodes = [];
    this.selfEntries = [];
    this.pendingMain = false;
    this.warned = { my: false, other: false };
    this.currentReadCount = 0; this.lastReadAppliedIndex = -1;
    w.setScreenMode(mode);
    this.clearTypingText();
    this.resetLockTimeline();
  }

  // ResetLockTimeline: the lock nodes back into their pools, the lock scroll at 0
  resetLockTimeline() {
    const w = this.window;
    if (w) for (const n of w.prefabChatNodes) if (w.lockChatNodeParent && isUnder(n, w.lockChatNodeParent)) n.activeSelf = false;
    this.lockNodes = [];
    this.pendingLock = false;
    for (const e of this.selfEntries) e.lock = null;
    if (this.scrollLock) { this.scrollLock.kill(); this.scrollLock = null; }
    this.scroll.lock = 0;
  }

  // the window position and scale of a screen mode
  _targetPosition(mode) {
    const w = this.window, off = mode === 1 ? CHAT_WIDGET.incomingCallPositionOffset : { x: 0, y: 0 };
    return { x: F(F(off.x + this.defaultPosition.x) + w.windowPosition.x), y: F(off.y + w.windowPosition.y) };
  }

  // the window's bounds after the base scale, rotated by the window rotation: half extents
  _halfExtents() {
    const w = this.window, size = w.visibleBoundsSize();
    const sx = F(size.x * this.baseScale.x), sy = F(size.y * this.baseScale.y);
    const a = F(Math.abs(w.windowRotationZ) * F(0.017453292)), s = Math.abs(F(Math.sin(a))), c = Math.abs(F(Math.cos(a)));
    return { x: F(F(F(sx * c) + F(sy * s)) * 0.5), y: F(F(F(sx * s) + F(sy * c)) * 0.5) };
  }

  // CalculateIncomingCallAutoFitMultiplier (mode 1; other modes 1): the phone fitted into the view around its position
  _scaleMultiplier(mode, pos) {
    if (mode !== 1 || !this.window) return 1;
    const fx = F(F(this.viewSize.w * 0.5) - Math.abs(pos.x)), fy = F(F(this.viewSize.h * 0.5) - Math.abs(pos.y));
    if (fx <= 0 || fy <= 0) return 0.01;
    const h = this._halfExtents();
    if (h.x <= 0 || h.y <= 0) return 1;
    const r = Math.min(F(fy / h.y), F(fx / h.x));
    return r < 0.01 ? 0.01 : Math.min(r, 1);
  }

  // ClampTargetWindowPositionForMode (mode 1): the position kept inside the view for the scaled phone
  _clampPosition(mode, pos, mult) {
    if (mode !== 1 || !this.window) return pos;
    const h = this._halfExtents();
    const lx = Math.max(0, F(F(this.viewSize.w * 0.5) - F(F(h.x * 2) * mult * 0.5)));
    const ly = Math.max(0, F(F(this.viewSize.h * 0.5) - F(F(h.y * 2) * mult * 0.5)));
    return { x: Math.min(Math.max(pos.x, -lx), lx), y: Math.min(Math.max(pos.y, -ly), ly) };
  }

  _modeTransform(mode) {
    const pos0 = this._targetPosition(mode), mult = this._scaleMultiplier(mode, pos0);
    const s = this.baseScale;
    return { pos: this._clampPosition(mode, pos0, mult), mult, scale: { x: F(mult * s.x), y: F(mult * s.y), z: F(mult * s.z) } };
  }

  _killTransition() { if (this.transition) { this.transition.kill(); this.transition = null; } }

  // ApplyWindowTransformForCurrentMode(updatePosition, animate): a Sequence of DOAnchorPos and DOScale (their default
  // ease) under the transition ease, 0.18 s / speed; otherwise set at once
  applyWindowTransform(updatePosition, animate) {
    if (!this.window) return;
    const { pos, scale } = this._modeTransform(this.window.currentScreenMode), t = this.target;
    this._killTransition();
    if (updatePosition && animate) {
      const d = F(CHAT_WIDGET.screenModeTransitionDuration / Math.max(this.playbackSpeed, 0.01));
      const seq = new DTSequence(this.mgr);
      seq.insert(0, dtTo(this.mgr, () => t.pos, (v) => { t.pos = v; }, pos, d, DT_PLUGIN.vector2).setTarget(t));
      seq.insert(seq.lastTweenInsertTime, dtTo(this.mgr, () => t.scale, (v) => { t.scale = v; }, scale, d, DT_PLUGIN.vector3).setTarget(t));
      seq.setEase(CHAT_WIDGET.screenModeTransitionEase);
      seq.on("onKill", () => { if (this.transition === seq) this.transition = null; });
      this.transition = seq;
    } else {
      t.scale = scale;
      if (updatePosition) t.pos = pos;
    }
  }

  // ShowAsync: the window placed below the view at its mode's scale, activated, the pending scrolls flushed (one
  // tick), then the slide up (0 s when noWait)
  async show(noWait, cancelled) {
    const w = this.window;
    this._killTransition();
    const { pos, scale } = this._modeTransform(w.currentScreenMode), t = this.target;
    t.pos = { x: pos.x, y: F(-this.viewSize.h) };
    t.rotationZ = w.windowRotationZ;
    t.scale = scale;
    const pendMain = this.pendingMain, pendLock = this.pendingLock;
    w.root.activeSelf = true;
    if (pendMain || pendLock) {                                        // PreparePendingScrollBeforeShowAsync
      if (pendMain) { this.pendingMain = false; this.scrollToBottomImmediate(); }
      if (pendLock) { this.pendingLock = false; this.scrollLockToBottomImmediate(); }
      await this.ctx.loop.yield("Update");
      if (cancelled()) throw new DTCancelled("cancelled");
      if (pendMain) this.scrollToBottomImmediate();
      if (pendLock) this.scrollLockToBottomImmediate();
    }
    await this._slide(pos.y, noWait ? 0 : F(CHAT_WIDGET.showEaseDuration / this.playbackSpeed), CHAT_WIDGET.showEase, cancelled);
  }

  // HideAsync: the slide down (0 s when noWait), then the window below the view, inactive
  async hide(noWait, cancelled) {
    const w = this.window;
    this._killTransition();
    await this._slide(F(-this.viewSize.h), noWait ? 0 : F(CHAT_WIDGET.hideEaseDuration / this.playbackSpeed), CHAT_WIDGET.hideEase, cancelled);
    this.target.pos = { x: F(F(this.defaultPosition.x - w.windowPosition.x) - CHAT_WIDGET.incomingCallPositionOffset.x), y: F(-this.viewSize.h) };
    w.root.activeSelf = false;
  }

  // Target.DOAnchorPosY(y, d).SetEase(e).ToUniTask(KillAndCancelAwait)
  _slide(y, d, ease, cancelled) {
    const t = this.target;
    const tw = dtTo(this.mgr, () => t.pos.y, (v) => { t.pos = { x: t.pos.x, y: v }; }, y, d, DT_PLUGIN.float).setTarget(t).setEase(ease);
    this.slide = tw;
    return this.mgr.toUniTask(tw, cancelled).finally(() => { if (this.slide === tw) this.slide = null; });
  }

  // SetChatWindowScreenMode: the window's screen objects, the transform (animated while visible and the mode changes),
  // the lock timeline reset unless it stays on a visible lock screen, the pending scroll of the shown timeline
  setScreenMode(mode) {
    const w = this.window;
    if (!w) return;
    const prev = w.currentScreenMode, active = w.active;
    const keepLock = mode === 2 ? prev === 2 && active : true;
    w.setScreenMode(mode);
    this.applyWindowTransform(active, active && prev !== mode && CHAT_WIDGET.screenModeTransitionDuration > 0);
    if (!keepLock) this.resetLockTimeline();
    if (mode === 0 && this.pendingMain) this.scrollToBottomImmediate();
    if (mode === 2 && this.pendingLock) this.scrollLockToBottomImmediate();
  }

  hideIncomingCall() {
    const w = this.window;
    if (!w) return;
    w.hideIncomingCall();
    this.applyWindowTransform(w.active, false);
  }

  setWindowName(text, members) {
    const w = this.window;
    if (w) w.text.windowName = formatWindowName(text, members, w.isGroupChat && w.layoutMode === 0);
  }
  setIncomingCallName(text) { if (this.window) this.window.text.incomingCallName = text; }
  setLockScreenName(text) { if (this.window && this.window.hasLockScreenName) this.window.text.lockScreenName = text; }
  setBattery(pct) { if (this.window) this.window.setBattery(pct); }
  setReadText(text) { this.readText = text; this._refreshReadVisibility(); }

  // CanScrollNow / CanScrollLockNow: the scroll rect's object active in the hierarchy
  get canScrollNow() { return !!this.window && !!this.window.scrollRect && this.window.scrollRect.activeInHierarchy; }
  get canScrollLockNow() { return !!this.window && !!this.window.lockScrollRect && this.window.lockScrollRect.activeInHierarchy; }

  scrollToBottomImmediate() {
    if (!this.canScrollNow) { this.pendingMain = true; return; }
    if (this.scrollMain) { this.scrollMain.kill(); this.scrollMain = null; }
    this.scroll.main = 0;
  }

  scrollLockToBottomImmediate() {
    if (!this.canScrollLockNow) { this.pendingLock = true; return; }
    if (this.scrollLock) { this.scrollLock.kill(); this.scrollLock = null; }
    this.scroll.lock = 0;
  }

  // ScrollToBottomSmooth: DOVerticalNormalizedPos(0, 0.2 s / speed), the default ease, from the laid-out position
  _scrollSmooth(key, can, pendingKey) {
    if (!can) { this[pendingKey] = true; return; }
    const field = key === "main" ? "scrollMain" : "scrollLock";
    if (this[field]) this[field].kill();
    const s = this.scroll;
    const tw = dtTo(this.mgr, () => s[key], (v) => { s[key] = v; }, 0, F(CHAT_WIDGET.scrollDuration / this.playbackSpeed), DT_PLUGIN.float);
    tw.on("onKill", () => { if (this[field] === tw) this[field] = null; });
    this[field] = tw;
  }

  _shouldAppendLock() {
    const w = this.window;
    return !!w && !!w.lockChatNodeParent && !this.restoring && w.currentScreenMode === 2 && w.lockChatNodeParent.activeInHierarchy;
  }

  // ShouldShowIdentityInCurrentLayout: Line always, Discord in a group
  get _showIdentity() { const w = this.window; return !w || w.layoutMode === 0 || (w.layoutMode === 1 && w.isGroupChat); }
  get _showRead() { return !this.window || this.window.layoutMode !== 1; }

  // BuildReadText
  buildReadText(rc) {
    const t = this.readText ?? "";
    if (rc < 1 || !this._showRead) return "";
    if (this.window && this.window.isGroupChat) return t ? `${t} ${rc}` : `${rc}`;
    return t;
  }

  _applyReadVisibility(node, rc) {
    if (!node) return;
    if (this._showRead && rc > 0) { node.readText = this.buildReadText(rc); node.readShown = true; }
    else node.readShown = false;
  }

  _refreshReadVisibility() {
    for (const e of this.selfEntries) {
      const rc = e.readCount ?? this.currentReadCount;
      this._applyReadVisibility(e.main, rc); this._applyReadVisibility(e.lock, rc);
    }
  }

  _node(other, rc, icon, name, lock) {
    const w = this.window;
    if (lock) {
      const tpl = other ? w.lockTemplates.other : w.lockTemplates.my, key = other ? "other" : "my";
      if (!tpl) {
        if (!this.warned[key]) {
          this.warned[key] = true;
          console.warn(`[AdvChatView] Lock ${other ? "Other" : "My"}ChatNode template is missing. Skip lock timeline node spawn.`);
        }
        return null;
      }
    }
    const n = new ChatNode(other);
    n.name = name; n.icon = icon; n.identity = this._showIdentity;       // Apply{My,Other}NodeIdentity
    if (!other) this._applyReadVisibility(n, rc);
    (lock ? this.lockNodes : this.mainNodes).push(n);
    return n;
  }

  // SendText / SendStamp: a stamp without a sprite sends nothing; the main timeline gets the node (and the lock one
  // while the lock screen shows), a restore in the lock mode only the lock one; then OnChatSend
  _send(other, isStamp, text, stamp, rc, icon, name) {
    if (isStamp && !stamp) return null;
    let main = null, lock = null;
    if (!this.restoreLockOnly) {
      const appendLock = this._shouldAppendLock();
      main = this._node(other, rc, icon, name, false);
      lock = appendLock ? this._node(other, rc, icon, name, true) : null;
    } else lock = this._node(other, rc, icon, name, true);
    if (!other && (main || lock)) this.selfEntries.push({ main, lock, readCount: rc >= 1 ? rc : null });
    for (const n of [main, lock]) if (n) { if (isStamp) n.stamp = stamp; else n.text = text; }
    // OnChatSend
    if (other) this._refreshReadVisibility();
    if (!this.restoring) {
      this._scrollSmooth("main", this.canScrollNow, "pendingMain");
      if (this._shouldAppendLock()) this._scrollSmooth("lock", this.canScrollLockNow, "pendingLock");
    }
    return main ?? lock;
  }

  // SendMy*: then SetRead for a count >= 1
  sendMyText(text, rc, icon, name) { const n = this._send(false, false, text, null, rc, icon, name); if (rc >= 1) this.setRead(rc); return n; }
  sendMyStamp(stamp, rc, icon, name) { const n = this._send(false, true, null, stamp, rc, icon, name); if (rc >= 1) this.setRead(rc); return n; }
  sendOtherText(text, icon, name) { return this._send(true, false, text, null, 0, icon, name); }
  sendOtherStamp(stamp, icon, name) { return this._send(true, true, null, stamp, 0, icon, name); }

  // SetRead: every own entry gets max(its count or the segment's fallback, readCount); the labels refreshed
  setRead(rc) {
    if (rc > 0) {
      const seg = this.lastReadAppliedIndex + 1, lim = Math.min(seg, this.selfEntries.length);
      this.selfEntries.forEach((e, i) => {
        let v = seg >= 0 && i < lim ? this.currentReadCount : 0;
        if (e.readCount !== null) v = e.readCount;
        e.readCount = Math.max(v, rc);
      });
      this.currentReadCount = rc;
      this.lastReadAppliedIndex = this.selfEntries.length - 1;
    }
    this._refreshReadVisibility();
  }

  // RestoreChatHistory(entries, lockOnly): the window re-initialized in its mode, the entries sent again without
  // scrolling, then the shown timeline scrolled to the bottom (pending while not visible)
  restoreChatHistory(entries, lockOnly) {
    if (!this.window) return;
    this.initializeChat(true);
    if (!entries || !entries.length) return;
    this.restoring = true; this.restoreLockOnly = lockOnly;
    for (const e of entries) {
      if (e.type === 1) { if (e.isOther) this.sendOtherStamp(e.stamp, e.icon, e.name); else this.sendMyStamp(e.stamp, e.readCount, e.icon, e.name); }
      else if (e.isOther) this.sendOtherText(e.text, e.icon, e.name);
      else this.sendMyText(e.text, e.readCount, e.icon, e.name);
    }
    this.restoring = false; this.restoreLockOnly = false;
    if (lockOnly) this.scrollLockToBottomImmediate(); else this.scrollToBottomImmediate();
  }

  // RefreshTypingLayout(scroll): the timeline snapped to the bottom when it can scroll, else pending
  _refreshTypingLayout(scroll) {
    if (!scroll) return;
    if (this.canScrollNow) { if (this.scrollMain) { this.scrollMain.kill(); this.scrollMain = null; } this.scroll.main = 0; }
    else this.pendingMain = true;
  }

  clearTypingText() {
    if (this.typingCancel) { this.typingCancel(); this.typingCancel = null; }
    this.typing = { text: "", maxVisible: INT_MAX };
    this._refreshTypingLayout(false);
  }

  // ShowTypingTextAsync: the text typed into the input box (0.03 s / speed per character); the rendered length
  async showTypingText(text, instant, cancelled) {
    const w = this.window;
    if (!w || !w.typingText) return !text ? 0 : removeTags(text).length;
    text = text ?? "";
    if (this.typingCancel) { this.typingCancel(); this.typingCancel = null; }
    this.typing = { text, maxVisible: 0 };
    if (!instant && text !== "") {
      let stop = false;
      const cancel = () => { stop = true; };
      this.typingCancel = cancel;
      const typing = this.typing, loop = this.ctx.loop;
      const task = typingTask(loop, removeTagsWithRuby(text), F(CHAT_WIDGET.typingDelay / this.playbackSpeed),
                              (n) => { typing.maxVisible = n; }, () => stop || cancelled());
      // WaitTypingLayoutSync: while typing, each change of the visible count re-lays the box and snaps the scroll
      let last = typing.maxVisible;
      const sync = (async () => {
        while (task.typing) {
          if (typing.maxVisible !== last) { last = typing.maxVisible; this._refreshTypingLayout(true); }
          await loop.yield("Update");
          if (stop || cancelled()) return;
        }
      })();
      try {
        await Promise.all([task.done, sync]);
        if (cancelled()) throw new DTCancelled("cancelled");
        return task.totalLength;
      } finally {
        if (this.typingCancel === cancel) this.typingCancel = null;
        this._refreshTypingLayout(true);
      }
    }
    this.typing.maxVisible = INT_MAX;
    this._refreshTypingLayout(true);
    return removeTags(text).length;
  }

  snapshot() {
    const w = this.window, t = this.target;
    return [w ? w.chatId : 0, w ? [w.active, w.currentScreenMode, w.text] : null, [t.pos, t.scale, t.rotationZ],
            this.mainNodes.map((n) => n.snapshot()), this.lockNodes.map((n) => n.snapshot()),
            this.selfEntries.map((e) => e.readCount), this.currentReadCount, this.lastReadAppliedIndex,
            this.typing, this.scroll, this.pendingMain, this.pendingLock, this.playbackSpeed];
  }
}

// ------------------------------------------------------------------------------------------------ the chat state
// AdvEpisodeResourceLoader's chat maps (windows by chat id, icons by chat id, stamps by asset name; the MasterAdvChat
// rows of the chat rows) and the session's chat fields
export class StoryChat {
  constructor(ctx, doc) {
    this.ctx = ctx;
    this.chats = new Map(Object.entries(doc.chats || {}).map(([k, v]) => [Number(k), v]));
    this.windows = new Map(); this.icons = new Map(); this.stamps = new Map();
    const addresses = new Set();
    for (const c of ctx.episode.commands) {
      if (c.IgnoreData || !["ChatWindow", "ChatTalk", "ChatStamp"].includes(c.cmd)) continue;
      const id = c.TargetChatID || 0, chat = this.chats.get(id);
      if (id !== 0 && !chat) throw new StoryCommandError(`chat #${c.i}: chat ${id} not in the chat data`);
      if (c.cmd === "ChatWindow" && chat && chat._chatWindowAssetName) {
        const name = chat._chatWindowAssetName;
        if (!addresses.has(name)) {                                    // one load per address, kept for the first id
          addresses.add(name);
          const rec = (doc.windows || {})[name];
          if (!rec) throw new StoryCommandError(`chat window ${name} not in the chat data`);
          if (!this.windows.has(id)) this.windows.set(id, new ChatWindow(id, name, rec));
        }
      }
      if ((c.cmd === "ChatTalk" || c.cmd === "ChatStamp") && chat && chat._chatIconAssetName && !this.icons.has(id)) {
        if (!(doc.icons || {})[chat._chatIconAssetName]) throw new StoryCommandError(`chat icon ${chat._chatIconAssetName} not in the chat data`);
        this.icons.set(id, chat._chatIconAssetName);
      }
      if (c.cmd === "ChatStamp" && (c.TargetAssetName ?? "").trim() && !this.stamps.has(c.TargetAssetName)) {
        if (!(doc.stamps || {})[c.TargetAssetName]) throw new StoryCommandError(`chat stamp ${c.TargetAssetName} not in the chat data`);
        this.stamps.set(c.TargetAssetName, c.TargetAssetName);
      }
    }
    this.view = new ChatView(ctx);
    // AdvPlaybackSession
    this.currentMasterChat = null; this.screenMode = 0; this.memoryId = null; this.memory = new Map();
  }

  window(id) { return this.windows.get(id) || null; }
  icon(id) { return id > 0 ? this.icons.get(id) || null : null; }
  stamp(name) { return this.stamps.get(name) || null; }

  memoryState(id) {
    let m = this.memory.get(id);
    if (!m) { m = new ChatMemoryState(); this.memory.set(id, m); }
    return m;
  }

  dispose() { this.view.refresh(); }

  snapshot() {
    return { chat: [this.currentMasterChat ? this.currentMasterChat._id : 0, this.screenMode, this.memoryId,
                    [...this.memory].map(([k, m]) => [k, m.snapshot()]), this.view.snapshot()] };
  }
}

export const storyChat = (ctx) => featureState(ctx).chat || null;

// the chat data of an episode with chat rows (chat.json). The phone is not drawn: a session that draws refuses it.
export const loadChat = (ctx) => {
  const uses = ctx.episode.commands.some((c) => !c.IgnoreData && c.cmd.startsWith("Chat"));
  if (!uses) return null;
  if (ctx.gl) throw new StoryCommandError("the chat window (UIAdvChatWidget) is not drawn by this player");
  const file = ctx.story && ctx.story.chat;
  if (!file) throw new StoryCommandError("the story data has no chat.json");
  const s = featureState(ctx);
  const chat = featureSlot(ctx, "chat", () => new StoryChat(ctx, ctx.assets.json(file)));
  if (s.core && typeof s.core.speedRate === "function") chat.view.setPlaybackSpeed(s.core.speedRate());
  s.disposers.push(() => chat.dispose());
  (s.snapshots = s.snapshots || []).push(() => chat.snapshot());
  (s.speedListeners = s.speedListeners || []).push((rate) => chat.view.setPlaybackSpeed(rate));
  return chat;
};
