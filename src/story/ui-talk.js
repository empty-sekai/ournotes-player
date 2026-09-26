import { F } from "../engine/core.js";
import { UIError, UITween } from "../engine/ugui.js";
import { countedText } from "./ui-ruby.js";

// A talk window of the story UI (AdvSystem.UI.UIAdvTalkWindow on UITypingTalkWindow; the prefabs UIDefaultTalkWindow
// and UICenterTalkWindow under UIContainer/TalkView): background show / hide, next indicator, auto and fast icons,
// speaker name, the typewriter, the talk text style of a backdrop-filter window and the data a window swap carries.
// `ui` = the host: {part (the window's nodes), loop, tweens (the UI tween runner), language, doc (dotween settings),
// setActive(node, v)}, plus setTextColor(node, colour) / setTextOutlineColor(node, colour) for a window with
// _useBackdropFilter. The text nodes carry `storyText` (ui-ruby.js StoryText, the node's text component). The
// window's optional references (SpeakerText, _speakerNameObjects, _talkBackground, _talkNextIndicator, _autoIcon,
// _fastIcon) may be null parts: the game null-checks each of them.

const LANGUAGE_FAST_TYPING = new Set([1, 4]);  // LanguageMode English, Korean: 0.015 s per character
const FAST_TYPING_DELAY = F(0.015);

// StringExtensions ruby tags (RemoveTagsCore): <ruby=value>text</ruby> | <r=value>text</r>. .NET `.` matches any
// character but \n.
const RUBY_TAG = /<ruby\s*=\s*([^"'>]+)>([^\n]*?)<\/ruby>|<r\s*=\s*([^"'>]+)>([^\n]*?)<\/r>/y;

// StringExtensions.RemoveTagsCore(text, rubyMode): per UTF-16 unit; at a '<', Regex.Match(text, i) of the ruby tags
// counts when the match starts at i: mode 0 appends its text, 1 its reading then its text, 2 the whole match as it
// is; the scan continues after the match. Any other '<' starts a tag that is dropped up to the next '>' (a later '<'
// is checked again). "" and null come back unchanged.
const removeTagsCore = (text, mode) => {
  if (!text) return text;
  let out = "", inTag = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "<") {
      RUBY_TAG.lastIndex = i;
      const m = RUBY_TAG.exec(text);
      if (m) {
        if (mode === 2) out += m[0];
        else {
          if (mode === 1) out += m[1] !== undefined ? m[1] : m[3];
          out += m[2] !== undefined ? m[2] : m[4];
        }
        inTag = false;
        i += m[0].length - 1;
      } else inTag = true;
    } else if (inTag) inTag = c !== ">";
    else out += c;
  }
  return out;
};

// StringExtensions.RemoveTagsWithRuby(text, removeRubyContent = false) -> RemoveTagsCore(text, removeRubyContent ? 0 : 1)
export const removeTagsWithRuby = (text, removeRubyContent = false) => removeTagsCore(text, removeRubyContent ? 0 : 1);

// StringExtensions.RemoveTagsKeepingRuby(text) -> RemoveTagsCore(text, 2): the ruby tags stay, every other tag goes
// (the talk log text of Talk, Subtitles and Location)
export const removeTagsKeepingRuby = (text) => removeTagsCore(text, 2);

// Fwk.UI.TmpTextHelper.CountRenderedCharacters: 0 for ""; a "<...>" span counts 1 when it starts with "<sprite", else
// 0; a surrogate pair counts 1; every other UTF-16 unit (space and line feed included) counts 1.
export const countRenderedCharacters = (text) => {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x3C) {
      const end = text.indexOf(">", i);
      if (end >= 0) { if (text.startsWith("<sprite", i)) n++; i = end; continue; }
    }
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { n++; i++; continue; }
    }
    n++;
  }
  return n;
};

export class StoryTalkWindow {
  constructor(ui) {
    this.ui = ui;
    const p = ui.part;
    this.p = p;
    if (p.background && !p.background.canvasGroup) throw new UIError("TalkBackground has no CanvasGroup");
    const tw = p.window.rec.talkWindow;
    if (!tw) throw new UIError(`${p.window.path}: no UIAdvTalkWindow record`);
    this.rec = tw;
    this.useBackdropFilter = !!tw._useBackdropFilter;   // UIAdvTalkWindow.UseBackdropFilter
    if (this.useBackdropFilter && (typeof ui.setTextColor !== "function" || typeof ui.setTextOutlineColor !== "function"))
      throw new UIError(`${p.window.path}: backdrop-filter window without text style hooks`);
    this.typingDelay = tw._typingDelay;             // UITypingTalkWindow._typingDelay, prefab 0.05
    this.playbackSpeed = 1;                         // UITypingTalkWindow.PlaybackSpeed = ToRate(Normal 10)
    this._fadeIn = this._fadeOut = null;
    this._typing = null;
  }

  // UIAdvTalkWindow.Init (TalkArea off; the background rect for the safe area: no inset here; ApplyTalkTextStyle) and
  // UITypingTalkWindow.Refresh: TalkArea off, ResetSpeaker, HideTalkNextIndicator, OnRefresh: HideTalk(0),
  // HideAutoIcon, kill both tweens; the fast icon hidden
  refresh() {
    const p = this.p, ui = this.ui;
    ui.setActive(p.talkArea, false);
    this._isShowing = false; this._isAutoMode = false; this._isActiveIndicator = false; this._autoIconActive = false;
    this._typing = null;
    this._applyTalkTextStyle();                     // Init
    p.talkText.storyText.setText("");               // ResetSpeaker: TalkText.SetText(""), SetSpeakerName("")
    this.setSpeakerName("");
    this.hideTalkNextIndicator();
    this.hideTalk(0);
    this._hideAutoIcon();
    for (const tw of [this._fadeIn, this._fadeOut]) if (tw) tw.kill();
    this._fadeIn = this._fadeOut = null;
    this.setFastIconActive(false);
  }

  // CanvasGroup.DOFade(to, d): DOTween.To on alpha with the default ease (DOTweenSettings defaultEaseType), start
  // value read on the first update
  _fade(cg, to, duration) {
    return new UITween(this.ui.tweens, { duration, getFrom: () => cg.alpha, to, ease: this.ui.doc.dotween.defaultEaseType,
                                         apply: (v) => { cg.alpha = v; } });
  }

  // UIAdvTalkWindow.ApplyTalkTextStyle: only with _useBackdropFilter and a TalkText: UIText.SetColor(_talkTextColor),
  // then (playing) the TMP text's fontMaterial instance gets _OutlineColor = _talkTextOutlineColor
  _applyTalkTextStyle() {
    if (!this.useBackdropFilter || !this.p.talkText) return;
    this.ui.setTextColor(this.p.talkText, this.rec._talkTextColor);
    this.ui.setTextOutlineColor(this.p.talkText, this.rec._talkTextOutlineColor);
  }

  // UIAdvTalkWindow.ShowTalk (AdvTalkView.ShowTalk passes 0.2): ApplyTalkTextStyle, then the TalkArea and the
  // background fade. Without a _talkBackground only the TalkArea is switched.
  showTalk(duration = 0.2) {
    const p = this.p;
    this._applyTalkTextStyle();
    this._isShowing = true;
    this.ui.setActive(p.talkArea, true);
    if (!p.background) return;
    const cg = p.background.canvasGroup;
    if (this._fadeIn && this._fadeIn.isActive) return;
    if (this._fadeOut && this._fadeOut.isActive) this._fadeOut.kill();
    if (cg.alpha >= 1) return;
    if (duration > 0) this._fadeIn = this._fade(cg, 1, duration);
    else cg.alpha = 1;
  }

  // UIAdvTalkWindow.HideTalk (AdvTalkView.HideTalk passes 0.2): the mirror of ShowTalk
  hideTalk(duration = 0.2) {
    const p = this.p;
    this._isShowing = false;
    this.ui.setActive(p.talkArea, false);
    if (!p.background) return;
    const cg = p.background.canvasGroup;
    if (this._fadeOut && this._fadeOut.isActive) return;
    if (this._fadeIn && this._fadeIn.isActive) this._fadeIn.kill();
    if (cg.alpha <= 0) return;
    if (duration > 0) this._fadeOut = this._fade(cg, 0, duration);
    else cg.alpha = 0;
  }

  // ShowTalkNextIndicator / HideTalkNextIndicator / SetAutoMode (SetAutoMode(true) runs HideTalkNextIndicator, which
  // also clears _isActiveIndicator). Without a _talkNextIndicator the indicator methods return first (flag untouched).
  _showTalkNextIndicator() {
    if (!this.p.nextIndicator) return;
    this._isActiveIndicator = true; this.ui.setActive(this.p.nextIndicator, !this._isAutoMode);
  }
  hideTalkNextIndicator() {
    if (!this.p.nextIndicator) return;
    this._isActiveIndicator = false; this.ui.setActive(this.p.nextIndicator, false);
  }
  _setAutoModeFlag(v) {
    this._isAutoMode = v;
    if (v) this.hideTalkNextIndicator();
    else if (this.p.nextIndicator) this.ui.setActive(this.p.nextIndicator, this._isActiveIndicator);
  }
  // UIAdvTalkWindow.ShowAutoIcon / HideAutoIcon: the icon (when set), then SetAutoMode
  _showAutoIcon() { if (this.p.autoIcon) this.ui.setActive(this.p.autoIcon, true); this._setAutoModeFlag(true); }
  _hideAutoIcon() { if (this.p.autoIcon) this.ui.setActive(this.p.autoIcon, false); this._setAutoModeFlag(false); }

  // AdvTalkView auto-icon flag -> UpdateWindowStatus: ShowAutoIcon / HideAutoIcon
  setAutoMode(v) { this._autoIconActive = !!v; if (v) this._showAutoIcon(); else this._hideAutoIcon(); }

  // UIAdvWidget.SetTalkWindowFastIconActive -> ShowFastIcon / HideFastIcon (when the icon is set)
  setFastIconActive(v) { if (this.p.fastIcon) this.ui.setActive(this.p.fastIcon, !!v); }

  // UITypingTalkWindow.SetSpeakerName: SpeakerText.SetText(name) (the node's text component) when set, then each
  // _speakerNameObjects entry (at most [Speaker] here) is active iff the name is not empty
  setSpeakerName(name) {
    if (this.p.speakerText) this.p.speakerText.storyText.setText(name);
    if (this.p.speaker) this.ui.setActive(this.p.speaker, !!name);
  }

  // UIAdvTalkWindow.GetData: SpeakerName = SpeakerText.GetText() ("" without SpeakerText), TalkText =
  // TalkText.GetText(), IsShowingTalkArea = _isShowing, IsShowingTalkBg = _isShowing and the background's alpha > 0
  getData() {
    const p = this.p;
    return { speakerName: p.speakerText ? p.speakerText.storyText.getText() : "", talkText: p.talkText.storyText.getText(),
             isShowingTalkArea: !!this._isShowing,
             isShowingTalkBg: !!this._isShowing && !!p.background && p.background.canvasGroup.alpha > 0 };
  }

  // UIAdvTalkWindow.ApplyData: SpeakerText.SetText (when set; the name objects keep their state), TalkText.SetText
  // (maxVisibleCharacters kept), _isShowing and the TalkArea from IsShowingTalkArea, then ShowTalk(0) or HideTalk(0)
  // after IsShowingTalkBg
  applyData(d) {
    const p = this.p;
    if (p.speakerText) p.speakerText.storyText.setText(d.speakerName);
    p.talkText.storyText.setText(d.talkText);
    this._isShowing = d.isShowingTalkArea;
    this.ui.setActive(p.talkArea, d.isShowingTalkArea);
    if (d.isShowingTalkBg) this.showTalk(0); else this.hideTalk(0);
  }

  // UITypingTalkWindow.SetTalk: TalkText.SetText(text) (UIRubyText.SetText: the ruby rewrite and the ruby margin top),
  // then StartTyping(...).Forget(): UITypingTalkWindow.StartTyping + TypingTask.Start:
  //   HideTalkNextIndicator; delay = _typingDelay (0.015 in the English / Korean language modes) / PlaybackSpeed
  //   textWithoutTags = RemoveTagsWithRuby(text); TotalLength = CountRenderedCharacters(TalkText, textWithoutTags)
  //   (the emoji text's preprocessing first)
  //   for i < TotalLength: maxVisibleCharacters = i + 1; await WaitWhile(IsPause);
  //                        textWithoutTags[i] an ASCII letter -> next; await UniTask.Delay(delay)
  //   ShowTalkNextIndicator
  // The letter test indexes UTF-16 units with the character index, as the game does. The first character shows in
  // the calling frame (the loop starts synchronously). WaitWhilePromise and DelayPromise are evaluated on UniTask
  // Update ticks from the next frame on; DelayPromise.MoveNext: cancellation first, the creation frame is skipped,
  // elapsed += Time.deltaTime (float), done when elapsed >= delay. TimeSpan.FromSeconds rounds to whole
  // milliseconds. No pause exists here, so WaitWhile ends on its first tick. cancel() is the typing token (Talk:
  // typingCts.Cancel()): observed on the next tick by the pending promise, then showAllOnCancel reveals the whole
  // text and the task ends normally, so the next indicator still appears. A new line while an older, cancelled task
  // has not yet observed its cancel: StartTyping stores the new TypingTask (IsTyping reads that one); the old task ends
  // on its next tick (its showAllOnCancel write is overwritten by the new task in the same tick) and then shows the
  // next indicator.
  setTalk(text) {
    const node = this.p.talkText, t = node.text, loop = this.ui.loop;
    const plain = removeTagsWithRuby(text);
    const total = plain ? countRenderedCharacters(countedText(t, node.storyText.b, plain)) : 0;
    node.storyText.setText(text);
    this.hideTalkNextIndicator();
    const mode = this.ui.language.mode;
    const delayF = F(F(LANGUAGE_FAST_TYPING.has(mode) ? FAST_TYPING_DELAY : this.typingDelay) / this.playbackSpeed);
    const delay = F(Math.trunc(delayF * 1000 + 0.5) / 1000);
    const task = { totalLength: total, done: false, cancelRequested: false };
    this._typing = task;
    const tick = async (check) => {                  // one UniTask Update-tick promise
      for (;;) {
        await loop.yield("Update");
        if (task.cancelRequested) return false;
        if (check()) return true;
      }
    };
    const run = async () => {
      let cancelled = false;
      for (let i = 0; i < total; i++) {
        t.setMaxVisible(i + 1);
        if (!(await tick(() => true))) { cancelled = true; break; }
        const c = plain.charCodeAt(i);
        if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) continue;   // char.IsLetter(c) && c < 0x80
        const created = loop.frameCount;
        let elapsed = 0;
        const ok = await tick(() => {
          if (elapsed === 0 && created === loop.frameCount) return false;
          elapsed = F(elapsed + F(loop.deltaTime));
          return elapsed >= delay;
        });
        if (!ok) { cancelled = true; break; }
      }
      if (cancelled) t.setMaxVisible(total);        // showAllOnCancel
      task.done = true;                              // IsTyping = false
      this._showTalkNextIndicator();
    };
    const finished = run();
    return { totalLength: total, finished, cancel: () => { if (!task.done) task.cancelRequested = true; } };
  }

  get isTyping() { return !!this._typing && !this._typing.done; }
}
