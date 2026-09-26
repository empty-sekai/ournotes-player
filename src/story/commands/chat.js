import { StoryCommandError } from "../interfaces.js";
import { floatParam } from "../params.js";
import { removeTags, storyChat } from "../features/chat.js";
import { DTCancelled } from "../features/dotween-core.js";
import { addLogEntry } from "../features/talklog.js";
import { waitUntil } from "../features/timing.js";
import { clearAutoAdvCancellation, stopCurrentVoices, tryPlayVoice, waitAutoPlayText } from "./talk.js";
import { videoUI } from "./video.js";

// ChatWindow, ChatTalk, ChatStamp, ChatRead, ChatTyping (AdvChat*Command with AdvChatCommandHelper,
// AdvChatMemoryCommandHelper). While shortcutting every row runs detached; IsNoWait detaches only a ChatWindow row and
// otherwise skips the final wait.

const NEXT_GO = 2;

const chatOf = (p, c) => {
  const chat = storyChat(p.ctx);
  if (!chat) throw new StoryCommandError(`${c.cmd} #${c.i}: the chat data is not loaded`);
  return chat;
};

const detach = (p, t) => { t.catch((e) => p.fail(e)); return Promise.resolve(); };
const guard = (t) => t.catch((e) => { if (!(e instanceof DTCancelled)) throw e; });

// Parameter readers of AdvEpisode: int.TryParse / float.TryParse (invariant), false for an empty or bad value
const tryInt = (v) => {
  const s = (v ?? "").toString().trim();
  return /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
};

// AdvChatCommandHelper
const skipTalkLog = (c) => (c.Parameter4 ?? "").trim().toLowerCase() === "skiptalklog";
const characterName = (c, p) => {
  const id = (c.TargetTextIDs || [])[0];
  return id ? p.ctx.localize(id) : "";
};

// AdvChatMemoryCommandHelper.TryGetChatMemoryId / TryResolveChatMemoryId / IsCurrentChatMemoryVisible
const memoryIdOf = (c) => { const id = tryInt(c.Parameter3); return id !== null && id > 0 ? id : null; };
const resolveMemoryId = (c, chat) => {
  const id = memoryIdOf(c);
  if (id !== null) return id;
  return chat.memoryId !== null && chat.view.visible ? chat.memoryId : null;
};
const memoryVisible = (chat, id) => chat.memoryId === id && chat.view.visible;

// the chat SEs: SoundManager.Play at the playback speed, an SE of the session, the BGM / SE frame
const playSe = (p, id) => {
  const a = p.ctx.audio, rate = p.speedRate();
  p.session.sePlayIds.push(a.play(id, { crossFade: 0.3, ...(rate !== 1 ? { speed: rate } : {}) }));
  a.lastBgmOrSeFrame = p.ctx.loop.frameCount;
};

// AdvChatCommandHelper.ChatWaitCommon: in auto mode the talk timing of `length` characters (or of the voices), then,
// unless already GoNext, the front next indicator and the tap
const chatWait = async (p, c, shortcut, length, sounds) => {
  if (shortcut || c.IsNoWait) return;
  p.changeNextStepStateOnAutoPlay();
  if (p.isAutoPlay) await waitAutoPlayText(p, sounds || [], null, length);
  if (p.cancelled) return;
  if (p.nextStep !== NEXT_GO) {
    videoUI(p.ctx, "showNextIndicator");
    if (!await waitUntil(p, () => p.nextStep === NEXT_GO)) return;
  }
  clearAutoAdvCancellation(p);
  videoUI(p.ctx, "hideNextIndicator");
  p.nextStep = 0;                                                     // ChangeIdleState
};

// AdvChatWindowCommand.PlayChatWindow: opens the phone on a window (SE, texts, the memory restored, the slide in, then
// the wait), closes it when the row repeats the visible window, chat, memory and mode (SE, the slide out, no wait), or
// reconfigures the visible phone (no SE; restored when the chat or memory changed; the wait)
const playChatWindow = async (c, p) => {
  const ctx = p.ctx, chat = chatOf(p, c), view = chat.view, cancelled = () => p.cancelled;
  const p2 = tryInt(c.Parameter2), mode = p2 === 1 || p2 === 2 ? p2 : 0;
  const window = chat.window(c.TargetChatID || 0);
  if (!window) throw new StoryCommandError(`ChatWindow #${c.i}: no chat window loaded for chat ${c.TargetChatID}`);
  const wasActive = window.active;
  const changed = view.trySetWindow(window);
  const mem = memoryIdOf(c);
  const curId = chat.currentMasterChat ? chat.currentMasterChat._id : 0;
  const same = !changed && curId === c.TargetChatID && mem === chat.memoryId;
  const shortcut = p.shortcut;
  const close = wasActive && !changed && same && chat.screenMode === mode;
  const master = chat.chats.get(c.TargetChatID);
  if (!master) throw new StoryCommandError(`ChatWindow #${c.i}: chat ${c.TargetChatID} not in the chat data`);
  if (!shortcut && (changed || !wasActive || close) && master._inOutSoundId > 0) playSe(p, master._inOutSoundId);
  if (close) {
    view.hideIncomingCall();
    await view.hide(shortcut, cancelled);
    chat.screenMode = 0;
    ctx.fieldRenderer.removeForegroundEntry();                         // the phone's field renderer entry
    return;
  }
  chat.currentMasterChat = master; chat.memoryId = mem; chat.screenMode = mode;
  const id = (c.TargetTextIDs || [])[0], text = id ? ctx.localize(id) : "";
  const readId = ctx.settings.masterIds && ctx.settings.masterIds._chatReadTextId;
  if (!readId) throw new StoryCommandError("master id settings: _chatReadTextId missing");
  view.setReadText(ctx.localize(readId));
  const battery = floatParam(c.Parameter1), members = tryInt(c.Parameter4) ?? 0;
  if (mode === 2) view.setLockScreenName(text);                        // ApplyScreenMode
  else if (mode === 1) view.setIncomingCallName(text);
  else view.setWindowName(text, members);
  view.setScreenMode(mode);
  view.setBattery(battery === Infinity ? -2147483648 : Math.trunc(battery));
  const state = mem !== null ? chat.memory.get(mem) || null : null;
  if (changed || !same || !wasActive)
    view.restoreChatHistory(mem !== null ? (state ? restoreEntries(chat, state, c.TargetChatID) : []) : null, mode === 2);
  if (state) for (const e of state.entries) {                          // AddPendingTalkLogEntries
    if (e.isTalkLogAdded || !e.shouldAddTalkLog) continue;
    addLogEntry(p, c, e.text, e.name, e.voiceIds);
    e.isTalkLogAdded = true;
  }
  if (!wasActive || changed) {
    ctx.fieldRenderer.addForegroundEntry();
    await view.show(shortcut, cancelled);
  }
  await chatWait(p, c, shortcut, 0, null);
};

// BuildRestoreEntries: own versus other by the restoring row's chat id
const restoreEntries = (chat, state, rowChatId) => state.entries.map((e) => ({
  isOther: e.sender !== rowChatId, type: e.type, text: e.text, stamp: e.type === 1 ? chat.stamp(e.stamp) : null,
  icon: chat.icon(e.sender), name: e.name, readCount: e.readCount ?? 0 }));

// AdvChatTalkCommand.PlayChatTalk: stored in the memory (only stored while that memory is not on screen), logged,
// sent as a bubble (own when the sender is the window's chat), the chat SE, the voices (after a same-frame SE, two
// frames later), the wait by the text length or the voices; at the end the current voices stop
const playChatTalk = async (c, p) => {
  const ctx = p.ctx, chat = chatOf(p, c), view = chat.view, s = p.session, audio = ctx.audio;
  const text = ctx.localize(c.AdvTextID), readCount = tryInt(c.Parameter1) ?? 0, name = characterName(c, p), skip = skipTalkLog(c);
  let entry = null;
  const mem = resolveMemoryId(c, chat);
  if (mem !== null) {
    entry = chat.memoryState(mem).addTalk(c.TargetChatID, text, name, readCount, c.VoiceIDs, !skip);
    if (!memoryVisible(chat, mem)) return;
  }
  if (!chat.currentMasterChat) return;
  if (!skip) { addLogEntry(p, c, text, name, c.VoiceIDs); if (entry) entry.isTalkLogAdded = true; }
  const icon = chat.icon(c.TargetChatID);
  if (c.TargetChatID === chat.currentMasterChat._id) { view.sendMyText(text, readCount, icon, name); view.clearTypingText(); }
  else view.sendOtherText(text, icon, name);
  const sounds = [];
  try {
    const shortcut = p.shortcut;
    if (!shortcut) {
      if (chat.currentMasterChat._chatSoundId > 0) playSe(p, chat.currentMasterChat._chatSoundId);
      if ((c.VoiceIDs || []).length && s.withVoice) {
        if (audio.lastBgmOrSeFrame === ctx.loop.frameCount) await ctx.loop.delayFrame(2);   // DelayIfSameFrameAsBgmOrSeAsync
        if (p.cancelled) return;
        stopCurrentVoices(p, false);
        for (const v of c.VoiceIDs) tryPlayVoice(p, v, sounds, null);
      }
    }
    await chatWait(p, c, shortcut, removeTags(text).length, sounds);
  } finally {
    sounds.length = 0;
    stopCurrentVoices(p, false);
  }
};

// AdvChatStampCommand.GetStampLogText: "<name after the last '/'>_log" when the text table has it
const stampLogText = (p, name) => {
  const id = `${name.slice(name.lastIndexOf("/") + 1)}_log`, table = p.ctx.episode.text;
  return table && Object.hasOwn(table, id) ? p.ctx.localize(id) : "";
};

// AdvChatStampCommand.PlayChatStamp: as ChatTalk with a stamp (its log text, else the generic stamp log), no voices
const playChatStamp = async (c, p) => {
  const ctx = p.ctx, chat = chatOf(p, c), view = chat.view;
  const stamp = chat.stamp(c.TargetAssetName), readCount = tryInt(c.Parameter1) ?? 0, name = characterName(c, p), skip = skipTalkLog(c);
  let logText = stampLogText(p, c.TargetAssetName || "");
  if (!logText) {
    const id = ctx.settings.masterIds && ctx.settings.masterIds._chatStampLogTextId;
    if (!id) throw new StoryCommandError("master id settings: _chatStampLogTextId missing");
    logText = ctx.localize(id);
  }
  let entry = null;
  const mem = resolveMemoryId(c, chat);
  if (mem !== null) {
    entry = chat.memoryState(mem).addStamp(c.TargetChatID, c.TargetAssetName, name, readCount, logText, !skip);
    if (!memoryVisible(chat, mem)) return;
  }
  if (!chat.currentMasterChat) return;
  if (!skip) { addLogEntry(p, c, logText, name, null); if (entry) entry.isTalkLogAdded = true; }
  const icon = chat.icon(c.TargetChatID);
  if (c.TargetChatID === chat.currentMasterChat._id) { view.sendMyStamp(stamp, readCount, icon, name); view.clearTypingText(); }
  else view.sendOtherStamp(stamp, icon, name);
  const shortcut = p.shortcut;
  if (!shortcut && chat.currentMasterChat._chatSoundId > 0) playSe(p, chat.currentMasterChat._chatSoundId);
  await chatWait(p, c, shortcut, 0, null);
};

// AdvChatReadCommand.SetChatRead: the read count into the memory (sender: the row's chat id, else the visible chat),
// then on screen and the wait
const setChatRead = async (c, p) => {
  const chat = chatOf(p, c), readCount = tryInt(c.Parameter1) ?? 0;
  const mem = resolveMemoryId(c, chat);
  if (mem !== null) {
    const sender = c.TargetChatID > 0 ? c.TargetChatID : chat.view.visible && chat.currentMasterChat ? chat.currentMasterChat._id : 0;
    if (sender < 1) console.warn(`[AdvChatReadCommand] memoryId=${mem}: the ChatRead sender could not be resolved; not applied to the memory.`);
    else chat.memoryState(mem).applyRead(sender, readCount);
    if (!memoryVisible(chat, mem)) return;
  }
  chat.view.setRead(readCount);
  await chatWait(p, c, p.shortcut, 0, null);
};

// AdvChatTypingCommand.PlayChatTyping: the text typed into the input box (instant while shortcutting), then the wait
// by its rendered length
const playChatTyping = async (c, p) => {
  const ctx = p.ctx, chat = chatOf(p, c);
  if (!chat.currentMasterChat) return;
  const shortcut = p.shortcut, text = ctx.localize(c.AdvTextID);
  if (!skipTalkLog(c)) addLogEntry(p, c, text, characterName(c, p), null);
  const len = await chat.view.showTypingText(text, shortcut, () => p.cancelled);
  await chatWait(p, c, shortcut, len, null);
};

export const ChatWindow = (c, p) => {
  const t = guard(playChatWindow(c, p));
  return p.shortcut || c.IsNoWait ? detach(p, t) : t;
};
const chatCommand = (body) => (c, p) => { const t = guard(body(c, p)); return p.shortcut ? detach(p, t) : t; };
export const ChatTalk = chatCommand(playChatTalk);
export const ChatStamp = chatCommand(playChatStamp);
export const ChatRead = chatCommand(setChatRead);
export const ChatTyping = chatCommand(playChatTyping);
