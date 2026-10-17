import { uiTextBinding } from "../ui-objects.js";
import { F } from "../../engine/core.js";
import { uiCanvasSize } from "../../engine/ugui.js";
import { StoryCommandError } from "../interfaces.js";
import { ChatCanvasGL, ChatCanvasUI, ChatScrollRect, buildChatNodes, chatSprite, cloneChatNode, compOf, isUnder } from "../ui-chat.js";
import { countedText } from "../ui-ruby.js";
import { countRenderedCharacters, removeTagsWithRuby } from "../ui-talk.js";
import { DTCancelled, DTSequence, DT_PLUGIN, dtTo, storyDOTween } from "./dotween-core.js";
import { featureSlot, featureState } from "./state.js";

// The phone of the chat rows: UIAdvChatWidget with its AdvChatView, one AdvChatWindow instance per chat id, the
// conversation memory of the session (AdvPlaybackSession / AdvChatMemoryState). The commands add and remove the
// phone's foreground entry on the field renderer (AdvForegroundFieldRendererEntry). The view does what AdvChatView
// does to the window's objects: screen modes and slides, the bubbles (copies of the window's node templates) and the
// lock-screen timeline, identities and read labels, the typing box, the scroll positions. With the story UI's chat data
// (story.ui `chatWidget`, story.fonts `texts`) the window is a laid-out uGUI tree (ui-chat.js) and a drawing
// session draws it on the ADV camera; without it (a headless session over other data) the same state is kept without
// the layout, the scroll tweens running on a 0 position.

// UIAdvChatWidget prefab values, used when the story UI data has no `chatWidget` record: the ChatCanvas (sortingOrder
// 10000, CanvasScaler ScaleWithScreenSize 1920 x 1080 Expand), the AdvChatView serialized fields.
export const CHAT_WIDGET = Object.freeze({
  sortingOrder: 10000,
  scaler: Object.freeze({ m_UiScaleMode: 1, m_ReferenceResolution: { x: 1920, y: 1080 }, m_ScreenMatchMode: 1,
                          m_MatchWidthOrHeight: 0, m_ReferencePixelsPerUnit: 100 }),
  showEaseDuration: 0.3, hideEaseDuration: 0.2, showEase: 18, hideEase: 18, scrollDuration: 0.2, typingDelay: 0.03,
  typingTextBoxMinHeight: 63, screenModeTransitionDuration: 0.18, screenModeTransitionEase: 9,
  incomingCallPositionOffset: Object.freeze({ x: 0, y: 0 }), targetPosition: Object.freeze({ x: 0, y: 0 }),
});
// the AdvChatView record of story.ui `chatWidget` in CHAT_WIDGET's form
const widgetConfig = (phone) => {
  if (!phone) return CHAT_WIDGET;
  const v = phone.chatView, t = phone.target.anchoredPosition;
  return { sortingOrder: phone.sortingOrder, scaler: phone.scaler,
           showEaseDuration: v._showEaseDuration, hideEaseDuration: v._hideEaseDuration, showEase: v._showEase, hideEase: v._hideEase,
           scrollDuration: v._scrollDuration, typingDelay: v._typingDelay, typingTextBoxMinHeight: v._typingTextBoxMinHeight,
           screenModeTransitionDuration: v._screenModeTransitionDuration, screenModeTransitionEase: v._screenModeTransitionEase,
           incomingCallPositionOffset: { ...v._incomingCallPositionOffset }, targetPosition: { x: t.x, y: t.y } };
};
// the ADV viewport before the first draw (a headless session): 13:6
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
// AdvChatWindow: the prefab instance of one chat id (inactive until shown), its RectTransforms as uGUI nodes
// (ui-chat.js; laid out and drawn with the story UI's chat data, else kept for the visible-bounds fit of the incoming
// call screen and the objects' activity). `host` resolves sprites and text bindings.
export class ChatWindow {
  constructor(chatId, name, doc, host) {
    this.chatId = chatId; this.name = name; this.records = doc.nodes; this.host = host;
    const built = buildChatNodes(doc.nodes, null, host);
    this.nodes = built.nodes; this.root = built.root;
    const w = compOf(this.root.raw, "AdvChatWindow");
    if (!w) throw new StoryCommandError(`chat window ${name}: no AdvChatWindow`);
    const node = (r) => (r ? this._node(host.pathOf(r)) : null);
    this.normal = node(w._normalScreenObject); this.lock = node(w._lockScreenObject); this.incoming = node(w._incomingCallObject);
    this.chatNodeParent = node(w._chatNodeParent); this.lockChatNodeParent = node(w._lockChatNodeParent);
    this.scrollRect = node(w._scrollRect); this.lockScrollRect = node(w._lockScrollRect);
    this.viewport = node(w._viewport);
    this.typingText = node(w._typingContentText); this.typingRect = node(w._typingIndicatorBottomRect);
    this.windowNameText = node(w._windowNameText); this.batteryText = node(w._batteryPercentageText);
    this.batteryFill = node(w._batteryFillImage); this.incomingCallNameText = node(w._incomingCallNameText);
    this.lockScreenNameText = node(w._lockScreenNameText);
    this.statusTexts = [[node(w._incomingCallStatusText), w._incomingCallStatusTextKey || ""],
                        [node(w._lockScreenStatusText), w._lockScreenStatusTextKey || ""]];
    this.templates = { my: node(w._myChatNodePrefab), other: node(w._otherChatNodePrefab) };
    this.hasLockScreenName = !!w._lockScreenNameText;
    this.isGroupChat = !!w._isGroupChat; this.layoutMode = w._chatLayoutMode | 0;
    this.windowPosition = { x: w._windowPosition.x, y: w._windowPosition.y };
    this.windowRotationZ = w._windowRotation.z;
    if (w._windowRotation.x || w._windowRotation.y) throw new StoryCommandError(`chat window ${name}: rotation outside the canvas plane`);
    this.showPercent = !!w._showBatteryPercentSymbol;
    this.statusKeys = { incoming: w._incomingCallStatusTextKey || "", lock: w._lockScreenStatusTextKey || "" };
    const r = this.root.raw.rect;
    if (r.m_AnchorMin.x !== r.m_AnchorMax.x || r.m_AnchorMin.y !== r.m_AnchorMax.y)
      throw new StoryCommandError(`chat window ${name}: a stretched root not implemented`);
    this.rootSize = { w: r.m_SizeDelta.x, h: r.m_SizeDelta.y };
    for (const n of this.nodes.values()) if (isChatNode(n)) n.lookup = this.nodes;   // the prefab's chat node objects
    this.root.activeSelf = false;                                     // TryAdd: SetActiveFast(false)
    this.currentScreenMode = 0;
    this.text = { windowName: "", battery: "", batteryFill: 0, incomingCallName: "", lockScreenName: "", status: [] };
    this.scroll = null;                                               // {main, lock}: ChatScrollRect with the layout
  }

  _node(path) {
    const n = this.nodes.get(path);
    if (!n) throw new StoryCommandError(`chat window ${this.name}: ${path} not found`);
    return n;
  }

  get active() { return this.root.activeSelf; }

  // UIText.SetText on one of the window's texts (laid out: the node's TMP text)
  _setText(node, s) { if (node && node.text) node.setText(s); }

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

  // RefreshStatusTexts: LocalizeText.SetMasterTextId of the two status texts (their text: the MasterText in the
  // language, story.ui `chatStatusTexts`)
  refreshStatusTexts(statusTexts) {
    this.text.status = [this.statusKeys.incoming, this.statusKeys.lock];
    for (const [n, key] of this.statusTexts) {
      if (!n || !n.text) continue;
      const s = statusTexts ? statusTexts[key] : undefined;
      if (typeof s !== "string") throw new StoryCommandError(`chat window ${this.name}: status text ${key} not in the story UI data`);
      n.setText(s);
    }
  }

  setWindowName(s) { this.text.windowName = s; this._setText(this.windowNameText, s); }
  setIncomingCallName(s) { this.text.incomingCallName = s; this._setText(this.incomingCallNameText, s); }
  setLockScreenName(s) { if (this.hasLockScreenName) { this.text.lockScreenName = s; this._setText(this.lockScreenNameText, s); } }

  // SetBatteryPercentage: "{0}%" (or "{0}") and Image.fillAmount = p / 100 (clamped to 0..1; an Image without a sprite
  // draws its rect whatever the fill)
  setBattery(pct) {
    this.text.battery = this.showPercent ? `${pct}%` : `${pct}`;
    this.text.batteryFill = Math.min(Math.max(F(pct / 100), 0), 1);
    this._setText(this.batteryText, this.text.battery);
    if (this.batteryFill && this.batteryFill.image) this.batteryFill.image.fillAmount = this.text.batteryFill;
  }

  // TryGetVisibleBoundsSize: the root's corners and those of every RectTransform below it whose objects are all
  // active up to the root, in root space, from the RectTransforms as last laid out.
  // ENGINE: without the story UI's chat data (no layout) the RectTransforms are read as serialized.
  visibleBoundsSize() {
    const I = [1, 0, 0, 1, 0, 0], root = this.root, saved = [];
    const keep = (n) => { saved.push([n, n.rect, n.matrix]); for (const c of n.children) keep(c); };
    keep(root);
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
    for (const [n, rect, matrix] of saved) { n.rect = rect; n.matrix = matrix; }
    return { x: Math.abs(box[2] - box[0]), y: Math.abs(box[3] - box[1]) };
  }
}

// ------------------------------------------------------------------------------------------------ view
const isMyNode = (n) => !!compOf(n.raw, "AdvMyChatNode");
const isChatNode = (n) => isMyNode(n) || !!compOf(n.raw, "AdvOtherChatNode");

// Component.GetComponentsInChildren<AdvChatNode>(includeInactive) below `parent`, in hierarchy order: every chat node
// object with `all`, else the ones whose objects are active up to `parent`.
// ENGINE: GetComponentsInChildren is native; without includeInactive the nodes active up to the searched object count
// as found while the window object itself is inactive (every window is first initialized before it is shown).
const chatNodesUnder = (parent, all) => {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (!all && !c.activeSelf) continue;
      if (isChatNode(c)) out.push(c);
      walk(c);
    }
  };
  walk(parent);
  return out;
};

// TMP_Text.textInfo as GetVisibleTypingTextHeight reads it: the lines' ascender and descender, the characters' code
// point and line. TMP's lineInfo.lineHeight (the fallback for a line of no height) is not kept by the text layout.
const textInfoOf = (t) => ({ lines: t.lines.map((l) => ({ ascender: l.ascender, descender: l.descender })),
                             chars: t.chars.map((c) => ({ u: c.u, lineNumber: c.lineNumber })) });

// an AdvMyChatNode / AdvOtherChatNode in a timeline; `ui` = its object and parts
class ChatNode {
  constructor(other) {
    this.other = other; this.text = null; this.stamp = null; this.name = ""; this.icon = null; this.identity = false;
    this.readText = ""; this.readShown = false;                        // Init: the read label's alpha 0
    this.ui = null;
  }
  snapshot() { return [this.other, this.text, this.stamp, this.name, this.icon, this.identity, this.readText, this.readShown]; }
}

// the parts of a chat node object: the references of its AdvMyChatNode / AdvOtherChatNode, resolved in the object
// (`root.lookup`: prefab path -> node)
const chatNodeParts = (root) => {
  const c = compOf(root.raw, "AdvMyChatNode") || compOf(root.raw, "AdvOtherChatNode");
  const get = (r) => {
    if (!r) return null;
    const n = root.lookup.get(root.pathOf(r));
    if (!n || (n !== root && !isUnder(n, root))) throw new StoryCommandError(`${root.src}: ${r.gameObject || r.transform} is outside the chat node`);
    return n;
  };
  const icon = get(c._chatIconImage), name = get(c._senderNameText);
  return { root, textBox: get(c._textBox), talkText: get(c._talkText), stamp: get(c._stampImage),
           readText: get(c._readText), readRenderer: get(c._readTextCanvasRenderer),
           // SetSenderNameVisible / ResolveChatIconVisibilityTarget: the root objects, else the text's object or the
           // icon's parent
           nameTarget: get(c._senderNameRootObject) || name, nameText: name,
           iconTarget: get(c._chatIconRootObject) || (icon ? icon.parent || icon : null), iconImage: icon };
};

// TypingTask.Start (showAllOnCancel): per rendered character (`total`: CountRenderedCharacters of the text as the
// component lays it out) maxVisibleCharacters = i + 1 and one Update tick, then for a character of the unedited text at
// i other than an ASCII letter UniTask.Delay(delay) (TimeSpan.FromSeconds: whole milliseconds)
const typingTask = (loop, plain, total, delaySec, setVisible, cancelled) => {
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
  // phone: the laid-out widget (ChatCanvasUI) or null; statusTexts: story.ui `chatStatusTexts`; sprite(kind, name):
  // a chat icon ("icons") or stamp ("stamps") sprite by asset name, or null
  constructor(ctx, phone = null, statusTexts = null, sprite = () => null) {
    this.ctx = ctx;
    this.phone = phone; this.statusTexts = statusTexts; this.sprite = sprite;
    this.cfg = widgetConfig(phone);
    this.mgr = storyDOTween(ctx);
    this.target = { pos: { ...this.cfg.targetPosition }, scale: { x: 1, y: 1, z: 1 }, rotationZ: 0 };
    this.defaultPosition = { ...this.cfg.targetPosition };            // Init: Target.anchoredPosition
    this.layout(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
    this.refresh();
  }

  // the AdvChatView rect: the ChatCanvas (Expand) over the ADV viewport. A change of the canvas size is
  // OnResolutionChanged: AdjustWindowSize.
  layout(width, height) {
    const { W, H } = uiCanvasSize(this.cfg.scaler, width, height);
    const changed = this.viewSize && (this.viewSize.w !== W || this.viewSize.h !== H);
    this.viewSize = { w: W, h: H };
    if (this.phone) this.phone.setSize(width, height);
    if (changed) this.adjustWindowSize();
  }

  // Refresh: every reference dropped, the tweens killed, the state reset
  refresh() {
    if (this.typingCancel) this.typingCancel();
    this._killTweens();
    this.window = null;
    this.mainNodes = []; this.lockNodes = [];
    this.lockAll = null; this.lockPool = null; this.lockTemplates = { my: null, other: null };   // _allLockChatNodes, the pools
    this.selfEntries = [];
    this.readText = null; this.currentReadCount = 0; this.lastReadAppliedIndex = -1;
    this.playbackSpeed = 1;
    this.pendingMain = false; this.pendingLock = false; this.restoring = false; this.restoreLockOnly = false;
    this.baseScale = { x: 1, y: 1, z: 1 };
    this.typing = { text: "", maxVisible: INT_MAX };
    this.typingCancel = null;
    this.scroll = { main: 0, lock: 0 };
    this.warned = { my: false, other: false };
    this.contentLayout = null;                                        // _contentLayoutGroup / its default bottom padding
  }

  _killTweens() {
    for (const k of ["slide", "transition", "scrollMain", "scrollLock"]) if (this[k]) { this[k].kill(); this[k] = null; }
  }

  setPlaybackSpeed(s) { this.playbackSpeed = s; }

  get visible() { return !!this.window && this.window.active; }

  // ---------------------------------------------------------------- the laid-out widget
  // Canvas.ForceUpdateCanvases / LayoutRebuilder.ForceRebuildLayoutImmediate: the Target from the view's transform
  // state, then the auto layout of the canvas
  _layout() {
    const p = this.phone;
    if (!p) return;
    const t = p.target, s = this.target;
    t.anchoredPosition = { x: s.pos.x, y: s.pos.y }; t.localScale = { x: s.scale.x, y: s.scale.y }; t.rotationZ = s.rotationZ;
    p.layout();
  }

  // the scroll positions: ScrollRect.verticalNormalizedPosition of the window's timelines when laid out
  _getScroll(key) { const w = this.window; return w && w.scroll ? w.scroll[key].normalized : this.scroll[key]; }
  _setScroll(key, v) { const w = this.window; if (w && w.scroll) w.scroll[key].normalized = v; else this.scroll[key] = v; }

  // GetTypingIndicatorHeight: LayoutUtility.GetPreferredHeight of the typing indicator (as last laid out), else its
  // rect height; 0 while it is inactive
  _typingIndicatorHeight() {
    const r = this.window && this.window.typingRect;
    if (!r || !r.activeInHierarchy || !this.phone) return 0;
    let h = r.rect ? this.phone.layoutEngine.preferredSize(r, 1) : 0;
    if (h <= 0) h = r.rect ? r.rect.h : 0;
    return h >= 0 ? h : 0;
  }

  // ApplyTypingIndicatorPaddingToContent: the content's VerticalLayoutGroup bottom padding = its bottom padding when
  // first read (per attached window) + (int) the typing indicator height
  _applyTypingPadding() {
    const w = this.window, content = w && w.scroll ? w.scroll.main.content : null;
    if (!content) return;
    if (!this.contentLayout) {
      const lg = content.layoutGroup;
      if (!lg || lg.class !== "VerticalLayoutGroup") return;
      this.contentLayout = { lg, bottom: null };
    }
    const c = this.contentLayout;
    if (c.bottom === null) c.bottom = c.lg.m_Padding.m_Bottom;
    const h = this._typingIndicatorHeight();
    const bottom = (h === Infinity ? -2147483648 : Math.trunc(h)) + c.bottom;
    if (c.lg.m_Padding.m_Bottom !== bottom) c.lg.m_Padding.m_Bottom = bottom;
  }

  // UpdateTypingTextBoxHeight: the typing box's LayoutElement preferredHeight = max(its min height (first: the box's
  // rect height, else _typingTextBoxMinHeight), padding + the visible text height + the text's top and bottom margins)
  _updateTypingTextBoxHeight() {
    const n = this.window && this.window.typingText;
    if (!n || !n.text || !this.phone) return;
    const box = n.parent;
    if (!box) return;
    // GetComponent<LayoutElement>() (a disabled one is set but lays nothing out), else AddComponent
    if (!box.layoutElement && !box.disabledLayoutElement) {
      if (box.rec.layoutElement) box.disabledLayoutElement = { ...box.rec.layoutElement };
      else box.layoutElement = { m_IgnoreLayout: 0, m_MinWidth: -1, m_MinHeight: -1, m_PreferredWidth: -1, m_PreferredHeight: -1,
                                 m_FlexibleWidth: -1, m_FlexibleHeight: -1, m_LayoutPriority: 1 };
    }
    const le = box.layoutElement || box.disabledLayoutElement;
    let minH = le.m_MinHeight;
    if (minH < 0) {
      const r = box.raw.rect;
      minH = box.rect ? box.rect.h : (r.m_AnchorMin.y === r.m_AnchorMax.y ? r.m_SizeDelta.y : 0);
      if (minH <= 0) minH = this.cfg.typingTextBoxMinHeight;
      le.m_MinHeight = minH;
    }
    const vg = box.layoutGroup || box.rec.layoutGroup, lg = vg && vg.class === "VerticalLayoutGroup" ? vg : null;   // TryGetComponent: enabled or not
    const pad = lg ? lg.m_Padding.m_Top + lg.m_Padding.m_Bottom : 0;
    const t = n.text, h = F(F(F(F(pad + this._visibleTypingTextHeight(n)) + t.margin.y) + t.margin.w));
    le.m_PreferredHeight = minH <= h ? h : minH;
  }

  // GetVisibleTypingTextHeight after TMP_Text.ForceMeshUpdate (an inactive text keeps the text info of its last mesh):
  // the first line's ascender down to the descender of the line of the last visible character (a line feed counts
  // the next line), else the first line's height, else the font size
  _visibleTypingTextHeight(n) {
    const t = n.liveText() || n.text;
    if (n.activeInHierarchy) {
      if (!n.rect) this._layout();
      t.generate();
      n.textInfo = textInfoOf(t);
    }
    const info = n.textInfo;
    if (info && info.lines.length > 0) {
      const count = info.chars.length, mv = t.maxVisibleCharacters;
      const vis = mv === INT_MAX ? count : mv >= 0 ? Math.min(count, mv) : 0;
      let last = 0;
      if (vis > 0 && count > 0) {
        const c = info.chars[vis - 1], k = c.lineNumber + (c.u === 13 || c.u === 10 ? 2 : 1);
        last = k < 1 ? 0 : Math.min(k, info.lines.length) - 1;
      }
      const h = F(info.lines[0].ascender - info.lines[last].descender);
      if (h > 0) return h;
      throw new StoryCommandError(`${n.src}: a typing line of no height (TMP lineInfo.lineHeight) not implemented`);
    }
    return t.fontSize;
  }

  _setTyping(text, maxVisible) {
    this.typing = { text, maxVisible };
    const n = this.window && this.window.typingText;
    if (n && n.text) { n.setText(text); n.text.setMaxVisible(maxVisible); }
  }

  _setTypingVisible(maxVisible) {
    this.typing.maxVisible = maxVisible;
    const n = this.window && this.window.typingText;
    if (n && n.text) n.text.setMaxVisible(maxVisible);
  }

  // ---------------------------------------------------------------- window
  // TrySetChatWindow: a new window is attached under Target (SetChatWindow: the layout cache reset, the window the
  // last child at local position 0, the status texts), sized and initialized; the previous one keeps its state
  trySetWindow(w) {
    if (w === this.window) return false;
    this.window = w;                                                   // SetChatWindow
    this.contentLayout = null;
    if (this.phone) {
      w.root.setParentLast(this.phone.target);
      w.root.anchoredPosition = { x: 0, y: 0 };                          // localPosition 0 under the point-sized Target
      if (!w.scroll && w.scrollRect) w.scroll = { main: this._scrollRectOf(w.scrollRect), lock: w.lockScrollRect ? this._scrollRectOf(w.lockScrollRect) : null };
    }
    w.refreshStatusTexts(this.statusTexts);
    this.adjustWindowSize();
    this.initializeChat(false);
    return true;
  }

  _scrollRectOf(node) {
    const s = node.scrollRect;
    if (!s) throw new StoryCommandError(`${node.path}: no ScrollRect`);
    const w = this.window, get = (r) => (r ? w._node(w.host.pathOf(r)) : null);
    return new ChatScrollRect(node, get(s.m_Content), get(s.m_Viewport), () => this._layout());
  }

  // AdjustWindowSize: the window scaled to the view height
  adjustWindowSize() {
    const w = this.window;
    if (!w) return;
    const k = F(this.viewSize.h / w.rootSize.h);
    this.baseScale = { x: k, y: k, z: 1 };
    this.applyWindowTransform(w.active, false);
  }

  // InitializeChat(preserve): the main nodes found under the node parent hidden (the main pools, built from the active
  // ones, stay empty: every main node is a new copy of its template); every lock node hidden, the first lock Other and
  // My node the lock templates; the read state cleared; the window's mode (0 unless preserved) set; the typing text
  // cleared; the lock timeline reset
  initializeChat(preserve) {
    const w = this.window;
    if (!w) return;
    const mode = preserve ? w.currentScreenMode : 0;
    if (!w.chatNodeParent) throw new StoryCommandError(`chat window ${w.name}: no chat node parent`);
    for (const n of chatNodesUnder(w.chatNodeParent, false)) n.activeSelf = false;
    this.mainNodes = [];
    if (w.lockChatNodeParent) {
      const all = chatNodesUnder(w.lockChatNodeParent, true);
      for (const n of all) n.activeSelf = false;
      this.lockAll = all;
      this.lockTemplates = { other: all.find((n) => !isMyNode(n)) || null, my: all.find(isMyNode) || null };
    } else { this.lockAll = null; this.lockTemplates = { my: null, other: null }; }
    this.selfEntries = [];
    this.warned = { my: false, other: false };
    this.pendingMain = false; this.pendingLock = false;
    this.currentReadCount = 0; this.lastReadAppliedIndex = -1;
    w.setScreenMode(mode);
    this.clearTypingText();
    this.resetLockTimeline();
  }

  // ResetLockTimeline: every lock node hidden and pushed onto its pool (a stack, in the order the nodes were found or
  // made), the entries' lock nodes dropped, the lock tween killed, the lock scroll at 0
  resetLockTimeline() {
    const w = this.window;
    if (this.lockAll) {
      this.lockPool = { my: [], other: [] };
      for (const n of this.lockAll) { n.activeSelf = false; this.lockPool[isMyNode(n) ? "my" : "other"].push(n); }
    } else this.lockPool = null;
    this.lockNodes = [];
    for (const e of this.selfEntries) e.lock = null;
    this.pendingLock = false;
    if (this.scrollLock) { this.scrollLock.kill(); this.scrollLock = null; }
    if (w && w.scroll) { if (w.scroll.lock) w.scroll.lock.normalized = 0; } else this.scroll.lock = 0;
  }

  // the window position and scale of a screen mode
  _targetPosition(mode) {
    const w = this.window, off = mode === 1 ? this.cfg.incomingCallPositionOffset : { x: 0, y: 0 };
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
      const d = F(this.cfg.screenModeTransitionDuration / Math.max(this.playbackSpeed, 0.01));
      const seq = new DTSequence(this.mgr);
      seq.insert(0, dtTo(this.mgr, () => t.pos, (v) => { t.pos = v; }, pos, d, DT_PLUGIN.vector2).setTarget(t));
      seq.insert(seq.lastTweenInsertTime, dtTo(this.mgr, () => t.scale, (v) => { t.scale = v; }, scale, d, DT_PLUGIN.vector3).setTarget(t));
      seq.setEase(this.cfg.screenModeTransitionEase);
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
    await this._slide(pos.y, noWait ? 0 : F(this.cfg.showEaseDuration / this.playbackSpeed), this.cfg.showEase, cancelled);
  }

  // HideAsync: the slide down (0 s when noWait), then the window below the view, inactive
  async hide(noWait, cancelled) {
    const w = this.window;
    this._killTransition();
    await this._slide(F(-this.viewSize.h), noWait ? 0 : F(this.cfg.hideEaseDuration / this.playbackSpeed), this.cfg.hideEase, cancelled);
    this.target.pos = { x: F(F(this.defaultPosition.x - w.windowPosition.x) - this.cfg.incomingCallPositionOffset.x), y: F(-this.viewSize.h) };
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
    this.applyWindowTransform(active, active && prev !== mode && this.cfg.screenModeTransitionDuration > 0);
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
    if (w) w.setWindowName(formatWindowName(text, members, w.isGroupChat && w.layoutMode === 0));
  }
  setIncomingCallName(text) { if (this.window) this.window.setIncomingCallName(text); }
  setLockScreenName(text) { if (this.window) this.window.setLockScreenName(text); }
  setBattery(pct) { if (this.window) this.window.setBattery(pct); }
  setReadText(text) { this.readText = text; this._refreshReadVisibility(); }

  // CanScrollNow / CanScrollLockNow: the scroll rect's object active in the hierarchy
  get canScrollNow() { return !!this.window && !!this.window.scrollRect && this.window.scrollRect.activeInHierarchy; }
  get canScrollLockNow() { return !!this.window && !!this.window.lockScrollRect && this.window.lockScrollRect.activeInHierarchy; }

  // ScrollToBottomImmediate: the typing padding, the layout rebuilt, the scroll tween killed, the position 0
  scrollToBottomImmediate() {
    if (!this.canScrollNow) { this.pendingMain = true; return; }
    this._applyTypingPadding();
    this._layout();
    if (this.scrollMain) { this.scrollMain.kill(); this.scrollMain = null; }
    this._setScroll("main", 0);
  }

  scrollLockToBottomImmediate() {
    if (!this.canScrollLockNow) { this.pendingLock = true; return; }
    this._layout();
    if (this.scrollLock) { this.scrollLock.kill(); this.scrollLock = null; }
    this._setScroll("lock", 0);
  }

  // ScrollToBottomSmooth / ScrollLockToBottomSmooth: (main: the typing padding) the layout, then
  // DOVerticalNormalizedPos(0, 0.2 s / speed) with the default ease; its start value is read on its first update
  _scrollSmooth(key) {
    const main = key === "main";
    if (!(main ? this.canScrollNow : this.canScrollLockNow)) { this[main ? "pendingMain" : "pendingLock"] = true; return; }
    if (main) this._applyTypingPadding();
    this._layout();
    const field = main ? "scrollMain" : "scrollLock";
    if (this[field]) this[field].kill();
    const tw = dtTo(this.mgr, () => this._getScroll(key), (v) => this._setScroll(key, v), 0,
                    F(this.cfg.scrollDuration / this.playbackSpeed), DT_PLUGIN.float);
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

  // ApplyMyNodeReadVisibility: SetReadText + ShowRead (CanvasRenderer alpha 1), else HideRead (alpha 0)
  _applyReadVisibility(node, rc) {
    if (!node) return;
    const ui = node.ui;
    if (this._showRead && rc > 0) {
      node.readText = this.buildReadText(rc); node.readShown = true;
      if (ui && ui.readText && ui.readText.text) ui.readText.setText(node.readText);
      if (ui && ui.readRenderer) ui.readRenderer.rendererAlpha = 1;
    } else {
      node.readShown = false;
      if (ui && ui.readRenderer) ui.readRenderer.rendererAlpha = 0;
    }
  }

  _refreshReadVisibility() {
    for (const e of this.selfEntries) {
      const rc = e.readCount ?? this.currentReadCount;
      this._applyReadVisibility(e.main, rc); this._applyReadVisibility(e.lock, rc);
    }
  }

  // Get{My,Other}ChatNode: a copy of the template (Instantiate under the node parent); GetLock{My,Other}ChatNode: a
  // node popped from the lock pool (made the last sibling), else a copy of the lock template (the pool empty and no
  // template: a warning once, no node). Then active, Init (own: the read label's alpha 0), the identity (name, icon,
  // their visibility), own: the read label.
  _node(other, rc, icon, name, lock) {
    const w = this.window, key = other ? "other" : "my", label = other ? "Other" : "My";
    let root;
    if (!lock) {
      const tpl = w.templates[key];
      if (!tpl) throw new StoryCommandError(`chat window ${w.name}: no ${label}ChatNode template`);
      root = cloneChatNode(tpl, w.records, w.chatNodeParent, w.host).root;
    } else {
      if (!w.lockChatNodeParent) throw new StoryCommandError(`chat window ${w.name}: a lock timeline node without the lock node parent`);
      const pool = this.lockPool ? this.lockPool[key] : null;
      if (pool && pool.length) { root = pool.pop(); root.setAsLastSibling(); }
      else {
        const tpl = this.lockTemplates[key];
        if (!tpl) {
          if (!this.warned[key]) {
            this.warned[key] = true;
            console.warn(`[AdvChatView] Lock ${label}ChatNode template is missing. Skip lock timeline node spawn.`);
          }
          return null;
        }
        root = cloneChatNode(tpl, w.records, w.lockChatNodeParent, w.host).root;
        this.lockAll.push(root);
      }
    }
    root.activeSelf = true;                                             // SetActiveFast(true)
    const n = new ChatNode(other), ui = n.ui = chatNodeParts(root);
    if (!other && ui.readRenderer) ui.readRenderer.rendererAlpha = 0;  // AdvMyChatNode.Init
    n.name = name; n.icon = icon; n.identity = this._showIdentity;       // Apply{My,Other}NodeIdentity
    if (ui.nameText && ui.nameText.text) ui.nameText.setText(name ?? "");                       // SetSenderName
    if (ui.iconImage && ui.iconImage.image) ui.iconImage.image.spriteObj = icon ? this.sprite("icons", icon) : null;   // SetChatIcon
    if (ui.nameTarget) ui.nameTarget.activeSelf = n.identity;            // SetSenderNameVisible
    if (ui.iconTarget) ui.iconTarget.activeSelf = n.identity;            // SetChatIconVisible
    if (!other) this._applyReadVisibility(n, rc);
    (lock ? this.lockNodes : this.mainNodes).push(n);
    return n;
  }

  // SetChatNodeText (SetTalk, text box on, stamp off) / SetChatNodeStamp (SetStamp, text box off, stamp on)
  _setContent(n, isStamp, text, stamp) {
    if (isStamp) n.stamp = stamp; else n.text = text;
    const ui = n.ui;
    if (isStamp) { if (ui.stamp && ui.stamp.image) ui.stamp.image.spriteObj = this.sprite("stamps", stamp); }
    else if (ui.talkText && ui.talkText.text) ui.talkText.setText(text);
    if (ui.textBox) ui.textBox.activeSelf = !isStamp;
    if (ui.stamp) ui.stamp.activeSelf = isStamp;
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
    for (const n of [main, lock]) if (n) this._setContent(n, isStamp, text, stamp);
    // OnChatSend
    if (other) this._refreshReadVisibility();
    if (!this.restoring) {
      this._scrollSmooth("main");
      if (this._shouldAppendLock()) this._scrollSmooth("lock");
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

  // RefreshTypingLayout(scroll): the typing indicator, the padding, the content and the viewport rebuilt; with scroll
  // the timeline snapped to the bottom when it can scroll, else pending
  _refreshTypingLayout(scroll) {
    if (!this.window) return;
    if (this.phone) { this._layout(); this._applyTypingPadding(); this._layout(); }
    if (!scroll) return;
    if (this.canScrollNow) { if (this.scrollMain) { this.scrollMain.kill(); this.scrollMain = null; } this._setScroll("main", 0); }
    else this.pendingMain = true;
  }

  // ClearTypingText: the typing released, the text "" fully visible, the box height, the layout
  clearTypingText() {
    if (this.typingCancel) { this.typingCancel(); this.typingCancel = null; }
    this._setTyping("", INT_MAX);
    this._updateTypingTextBoxHeight();
    this._refreshTypingLayout(false);
  }

  // ShowTypingTextAsync: the text typed into the input box (0.03 s / speed per character); the rendered length
  async showTypingText(text, instant, cancelled) {
    const w = this.window;
    if (!w || !w.typingText) return !text ? 0 : removeTags(text).length;
    text = text ?? "";
    if (this.typingCancel) { this.typingCancel(); this.typingCancel = null; }
    this._setTyping(text, 0);
    this._updateTypingTextBoxHeight();
    if (!instant && text !== "") {
      let stop = false;
      const cancel = () => { stop = true; };
      this.typingCancel = cancel;
      const typing = this.typing, loop = this.ctx.loop, plain = removeTagsWithRuby(text), n = w.typingText;
      const counted = n.storyText ? countedText(n.text, n.storyText.b, plain, n.storyText.emoji) : plain;
      const task = typingTask(loop, plain, plain ? countRenderedCharacters(counted) : 0, F(this.cfg.typingDelay / this.playbackSpeed),
                              (n) => { if (this.typing === typing) this._setTypingVisible(n); else typing.maxVisible = n; },
                              () => stop || cancelled());
      // WaitTypingLayoutSync: while typing, each change of the visible count re-lays the box and snaps the scroll
      let last = typing.maxVisible;
      const sync = (async () => {
        while (task.typing) {
          if (typing.maxVisible !== last) { last = typing.maxVisible; this._updateTypingTextBoxHeight(); this._refreshTypingLayout(true); }
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
        this._updateTypingTextBoxHeight();
        this._refreshTypingLayout(true);
      }
    }
    this._setTypingVisible(INT_MAX);
    this._updateTypingTextBoxHeight();
    this._refreshTypingLayout(true);
    return removeTags(text).length;
  }

  // ScrollRect.LateUpdate of the attached window's timelines (laid out)
  lateUpdate() {
    const w = this.window;
    if (!w || !w.scroll || !w.active) return;
    w.scroll.main.lateUpdate();
    if (w.scroll.lock) w.scroll.lock.lateUpdate();
  }

  snapshot() {
    const w = this.window, t = this.target;
    return [w ? w.chatId : 0, w ? [w.active, w.currentScreenMode, w.text] : null, [t.pos, t.scale, t.rotationZ],
            this.mainNodes.map((n) => n.snapshot()), this.lockNodes.map((n) => n.snapshot()),
            this.selfEntries.map((e) => e.readCount), this.currentReadCount, this.lastReadAppliedIndex,
            this.typing, w && w.scroll ? { main: w.scroll.main.content.anchoredPosition.y,
                                           lock: w.scroll.lock ? w.scroll.lock.content.anchoredPosition.y : 0 } : this.scroll,
            this.pendingMain, this.pendingLock, this.playbackSpeed];
  }
}

// ------------------------------------------------------------------------------------------------ the chat state
// AdvEpisodeResourceLoader's chat maps (windows by chat id, icons by chat id, stamps by asset name; the MasterAdvChat
// rows of the chat rows) and the session's chat fields. `ui` = the story UI (its chat widget, status texts and the
// chat windows' text bindings; null or without them: not laid out).
export class StoryChat {
  constructor(ctx, data, ui = null) {
    this.ctx = ctx; this.data = data;
    this.chats = new Map(Object.entries(data.story.chats || {}).map(([k, v]) => [Number(k), v]));
    this.windows = new Map(); this.icons = new Map(); this.stamps = new Map();
    this.phone = ui?.fonts?.texts && data.ui.chatWidget ? new ChatCanvasUI(ctx.objects.prefab(data.ui.chatWidget)) : null;
    this.sprites = new Map();
    this._spriteCache = new Map();
    const host = (id) => ({
      prefabId: id, pathOf: (ref) => ctx.objects.prefab(id).pathOf(ref),
      sprite: (s) => (this.phone ? this._chatSprite(s) : null),
      binding: (src, node) => this.phone ? uiTextBinding(node, ui.fonts) : null,
      textHost: ui, languageMode: ui?.language?.mode || 0, requireTexts: !!this.phone, visual: !!this.phone,
    });
    const addresses = new Set();
    for (const c of ctx.episode.commands) {
      if (c.IgnoreData || !["ChatWindow", "ChatTalk", "ChatStamp"].includes(c.cmd)) continue;
      const id = c.TargetChatID || 0, chat = this.chats.get(id);
      if (id !== 0 && !chat) throw new StoryCommandError(`chat #${c.i}: chat ${id} not in the chat data`);
      if (c.cmd === "ChatWindow" && chat && chat._chatWindowAssetName) {
        const name = chat._chatWindowAssetName;
        if (!addresses.has(name)) {                                    // one load per address, kept for the first id
          addresses.add(name);
          const root = this.assetRoot(`Adv/Chat/Prefabs/${name}`), rec = ctx.assets.prefab(root);
          if (!this.windows.has(id)) this.windows.set(id, new ChatWindow(id, name, rec, host(root)));
        }
      }
      if ((c.cmd === "ChatTalk" || c.cmd === "ChatStamp") && chat && chat._chatIconAssetName && !this.icons.has(id)) {
        this.assetRoot(`Adv/Chat/Icon/${chat._chatIconAssetName}`);
        this.icons.set(id, chat._chatIconAssetName);
      }
      if (c.cmd === "ChatStamp" && (c.TargetAssetName ?? "").trim() && !this.stamps.has(c.TargetAssetName)) {
        this.assetRoot(`Adv/Chat/Stamp/${c.TargetAssetName}`);
        this.stamps.set(c.TargetAssetName, c.TargetAssetName);
      }
    }
    this.view = new ChatView(ctx, this.phone, this.phone ? ui.doc.chatStatusTexts || null : null, (kind, n) => this.sprite(kind, n));
    // AdvPlaybackSession
    this.currentMasterChat = null; this.screenMode = 0; this.memoryId = null; this.memory = new Map();
    this.gl = null;
  }

  // a chat sprite record -> UISprite (its texture registered for the GL load)
  _chatSprite(s) {
    if (!s) return null;
    s = this.ctx.objects.sprite(s);
    const key = s.id;
    let sp = this._spriteCache.get(key);
    if (!sp) {
      sp = chatSprite(s);
      this._spriteCache.set(key, sp);
      this.sprites.set(sp.texture.id, sp.desc);
    }
    return sp;
  }

  // an icon or stamp of chat.json by asset name, as a sprite (null without the layout)
  sprite(kind, name) {
    if (!this.phone || !name) return null;
    return this._chatSprite(this.assetRoot(`Adv/Chat/${kind === "icons" ? "Icon" : "Stamp"}/${name}`));
  }

  assetRoot(address) {
    const product = this.data.asset(address);
    if (product.objects.length !== 1) throw new StoryCommandError(`${address}: expected one root object`);
    return product.objects[0];
  }

  // The texts the laid-out phone will show, each checked against the chat window texts that show it (the texts of every
  // chat node of the windows, the typing text, the window, call and lock screen names, the battery and status texts),
  // with the story UI's text check: a text its font cannot lay out refuses the episode before it plays. Formatted
  // forms (a shortened name, the member count, the battery percentage, a group read count) are included.
  checkTexts() {
    const ctx = this.ctx, ui = ctx.ui, loc = (id) => (id && id !== "0" ? ctx.localize(id) : "");
    const set = () => new Set(), T = { talk: set(), name: set(), typing: set(), window: set(), read: set(), battery: set() };
    const readId = ctx.settings && ctx.settings.masterIds ? ctx.settings.masterIds._chatReadTextId : null;
    const read = readId ? loc(readId) : "", counts = new Set();
    for (const c of ctx.episode.commands) {
      if (c.IgnoreData) continue;
      const name = loc((c.TargetTextIDs || [])[0]), p1 = c.Parameter1 == null ? "" : String(c.Parameter1).trim();
      if (c.cmd === "ChatTalk") { T.talk.add(loc(c.AdvTextID)); T.name.add(name); }
      else if (c.cmd === "ChatStamp") T.name.add(name);
      else if (c.cmd === "ChatTyping") T.typing.add(loc(c.AdvTextID));
      else if (c.cmd === "ChatWindow") {
        const members = Number.parseInt(c.Parameter4, 10);
        for (const s of [name, truncateName(name), formatWindowName(name, members, true)]) T.window.add(s);
        const b = Number.parseFloat(p1);
        if (Number.isFinite(b)) for (const s of [`${Math.trunc(b)}%`, `${Math.trunc(b)}`]) T.battery.add(s);
      }
      if (/^[+-]?\d+$/.test(p1) && ["ChatTalk", "ChatStamp", "ChatRead"].includes(c.cmd)) counts.add(Number.parseInt(p1, 10));
    }
    T.read.add(read);
    for (const n of counts) if (n >= 1) T.read.add(read ? `${read} ${n}` : `${n}`);
    const problems = new Set();
    const check = (node, texts) => { if (node && node.text) ui.checkNodeTexts(node, [...texts].filter(Boolean), problems); };
    for (const w of this.windows.values()) {
      for (const root of [...w.nodes.values()].filter(isChatNode)) {
        const parts = chatNodeParts(root);
        check(parts.talkText, T.talk); check(parts.nameText, T.name); check(parts.readText, T.read);
      }
      check(w.typingText, T.typing);
      for (const n of [w.windowNameText, w.incomingCallNameText, w.lockScreenNameText]) check(n, T.window);
      check(w.batteryText, T.battery);
      for (const [n, key] of w.statusTexts) check(n, [this.view.statusTexts ? this.view.statusTexts[key] : ""]);
    }
    if (problems.size) throw new StoryCommandError(`texts the chat phone cannot lay out: ${[...problems].join("; ")}`);
  }

  window(id) { return this.windows.get(id) || null; }
  icon(id) { return id > 0 ? this.icons.get(id) || null : null; }
  stamp(name) { return this.stamps.get(name) || null; }

  memoryState(id) {
    let m = this.memory.get(id);
    if (!m) { m = new ChatMemoryState(); this.memory.set(id, m); }
    return m;
  }

  // the GL resources of the drawn phone: the chat sprites' textures (windows, and the icons and stamps the rows use)
  async loadGL(gl) {
    for (const id of this.icons.keys()) this.sprite("icons", this.icons.get(id));
    for (const name of this.stamps.keys()) this.sprite("stamps", name);
    this.gl = new ChatCanvasGL(gl, this.ctx.ui, this.ctx.objects);
    await this.gl.load(this.sprites);
  }

  // The field renderer's items: the ChatCanvas (layer 11, the canvas' sorting order, at the plane distance) while an
  // attached window is active
  fieldItems() {
    const p = this.phone;
    if (!p || !this.gl || !p.target.children.some((c) => c.activeSelf)) return [];
    return [{ sortingOrder: p.sortingOrder, dist: p.planeDistance, layer: 11, draw: (f) => this.draw(f) }];
  }

  // the canvas on the camera colour target (StoryRenderer's `rt.color`, where the camera's list and the foreground
  // pass draw layer 11), laid out for the frame's screen size
  draw(frame) {
    const gl = this.gl.gl, sp = frame.globals._ScreenParams, width = sp[0], height = sp[1];
    const v = this.view, p = this.phone, cam = this.ctx.camera, target = this.ctx.renderer.rt && this.ctx.renderer.rt.color;
    if (!target || target.width !== width || target.height !== height) throw new StoryCommandError("chat phone: no camera colour target of the frame's size");
    v.layout(width, height);
    v._layout();
    const globals = ChatCanvasGL.globals(p.size.W, p.size.H, width, height,
                                         { fov: cam.fov, near: cam.near, far: cam.far, distance: p.planeDistance });
    this.gl.draw(p.drawItems(globals.worldScale), globals, target);
    for (const w of this.windows.values())                              // the text info of the typing mesh just drawn
      if (w.typingText && w.typingText.activeInHierarchy && w.typingText.text) w.typingText.textInfo = textInfoOf(w.typingText.text);
    gl.bindVertexArray(null);
  }

  dispose() { this.view.refresh(); if (this.gl) { this.gl.dispose(); this.gl = null; } }

  snapshot() {
    return { chat: [this.currentMasterChat ? this.currentMasterChat._id : 0, this.screenMode, this.memoryId,
                    [...this.memory].map(([k, m]) => [k, m.snapshot()]), this.view.snapshot()] };
  }
}

export const storyChat = (ctx) => featureState(ctx).chat || null;

// The chat data of an episode with chat rows (chat.json) and, with the story UI's chat data, the laid-out phone; a
// drawing session draws it on the field renderer and refuses without that data.
export const loadChat = async (ctx) => {
  const uses = ctx.episode.commands.some((c) => !c.IgnoreData && c.cmd.startsWith("Chat"));
  if (!uses) return null;
  const s = featureState(ctx);
  const chat = featureSlot(ctx, "chat", () => new StoryChat(ctx, ctx.data, ctx.ui || null));
  if (chat.phone) chat.checkTexts();
  if (ctx.gl) {
    if (!chat.phone) throw new StoryCommandError("the chat phone needs the story UI's chat widget and chat window text bindings (story.ui chatWidget, story.fonts texts)");
    if (!ctx.renderer) throw new StoryCommandError("the chat phone needs the story renderer");
    await chat.loadGL(ctx.gl);
    const source = () => chat.fieldItems();
    ctx.renderer.addFieldItems(source);
    s.disposers.push(() => ctx.renderer.removeFieldItems(source));
  }
  if (chat.phone) {                                                   // ScrollRect.LateUpdate
    let live = true;
    ctx.loop.on("lateUpdate", () => { if (live) chat.view.lateUpdate(); });
    s.disposers.push(() => { live = false; });
  }
  if (s.core && typeof s.core.speedRate === "function") chat.view.setPlaybackSpeed(s.core.speedRate());
  s.disposers.push(() => chat.dispose());
  (s.snapshots = s.snapshots || []).push(() => chat.snapshot());
  (s.speedListeners = s.speedListeners || []).push((rate) => chat.view.setPlaybackSpeed(rate));
  return chat;
};

