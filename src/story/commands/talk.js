import { floatParam } from "../params.js";
import { addLogEntry } from "../features/talklog.js";
import { removeTagsKeepingRuby } from "../ui-talk.js";
import { delayWithPauseSpeedAdjustment } from "./misc.js";
import { beginVoicePlaybackScope } from "./voice.js";

// Talk and Location, with the Talk command's voice routing and lip sync (AdvTalkVoicePlaybackHelper) and its
// auto-advance timing (AdvTextCommandHelper.WaitAutoPlayText).

const F = Math.fround;
const NEXT_GO = 2;                          // AdvPlayerModel NextStepState.GoNext

// AdvTalkHelper.GetSpeakerName
export const speakerName = (c, p) => {
  const ms = p.ctx.settings.masterIds;
  if (!c.TargetName || c.TargetStatus === 2) return "";                // NoSpeaker
  if (c.TargetStatus === 1) return p.ctx.localize(ms._unknownCharacterNameTextId);   // Unknown
  const ids = c.TargetTextIDs || [];
  let sep = ids.length < 2 ? "" : p.ctx.localize(ms._splitCharacterNameTextId);
  let out = "";
  ids.forEach((id, i) => {
    let name = p.ctx.localize(id);
    const colors = c.TargetTextColors || [];
    if (i < colors.length) name = `<color=${colors[i]}>${name}</color>`;
    if (i === ids.length - 1) sep = "";
    out += name + sep;
  });
  return out;
};

// Session.ClearAutoAdvCancellationToken: the auto-advance token (p.autoAdvCancel, its Cancel) cancelled and dropped
export const clearAutoAdvCancellation = (p) => {
  const cancel = p.autoAdvCancel;
  p.autoAdvCancel = null;
  if (cancel) cancel();
};

// Session.CreateAutoAdvCancellationToken: the previous token cleared first; cancel is the new token's Cancel
export const createAutoAdvCancellation = (p, cancel) => {
  clearAutoAdvCancellation(p);
  p.autoAdvCancel = cancel;
};

// AdvSoundHelper.StopCurrentVoices(ctx, preserveAutoAdvToken): every current voice stopped (no fade), the list
// cleared, then Session.ClearAutoAdvCancellationToken unless the token is preserved (the Auto button keeps it)
export const stopCurrentVoices = (p, preserveAutoAdvToken = false) => {
  const a = p.ctx.audio, s = p.session;
  for (const id of s.voicePlayIds) a.stop(id, false);
  s.voicePlayIds = [];
  if (!preserveAutoAdvToken) clearAutoAdvCancellation(p);
};

// AdvTalkVoicePlaybackHelper.TryPlayVoice: SoundManager.Play at the playback speed; onPlayStart runs before the sound
// starts (the lip sync is attached first)
export const tryPlayVoice = (p, id, sounds, onStart) => {
  const a = p.ctx.audio, rate = p.speedRate();
  const pid = a.play(id, { crossFade: 0.3, ...(rate !== 1 ? { speed: rate } : {}),
                           onPlayStart: (info) => { sounds.push(info); if (onStart) onStart(info); } });
  p.session.voicePlayIds.push(pid);
  return pid;
};

// SetLipSyncPresentationMode(ignore ? Default : AdvCalm)
const presentation = (ch, ignore) => ch.setLipSyncPresentationMode(ignore ? 0 : 1);

// AdvTalkVoicePlaybackHelper.StartVoiceLipSync: the voice's player drives the character's MotionSync (the CRI Lips
// analyzer for a character without MotionSync)
export const startVoiceLipSync = (p, ch, info, ignore) => {
  presentation(ch, ignore);
  if (ignore) return;
  const src = p.ctx.audio.pcmSource(info);
  if (ch.isMotionSyncEnabled === false) ch.setLipsAnalyzer(src);
  else { ch.setMotionSyncSource(src); p.session.motionSyncVoices.set(ch, info.id); }   // SetCriAtomExPlayer
  ch.setLipSyncEnabled(true);
  p.session.activeVoiceLipSync.set(ch, info.id);                       // RegisterActiveVoiceLipSync
};

// StartSharedAnalyzerLipSync: a speaker without a voice of its own follows the CRI Lips analyzer of another voice
const startSharedAnalyzerLipSync = (p, ch, info, ignore) => {
  presentation(ch, ignore);
  if (ignore) return;
  ch.setLipSyncEnabled(true);
  ch.setLipsAnalyzer(p.ctx.audio.pcmSource(info));
  p.session.activeVoiceLipSync.set(ch, info.id);
};

// ClearCriAtomExPlayer (ResetCriAtomExPlayer): a voice still playing on the character's MotionSync player stops at
// once (StopWithoutReleaseTime) before the player is detached
const clearMotionSyncSource = (p, ch) => {
  const id = p.session.motionSyncVoices.get(ch), audio = p.ctx.audio;
  p.session.motionSyncVoices.delete(ch);
  if (id !== undefined && audio.isPlaying(id)) audio.stop(id, false, 0);
  ch.clearMotionSyncSource();
};

// StopVoiceLipSync: only while that voice is the character's registered one; the mouth is not closed
export const stopVoiceLipSync = (p, ch, info) => {
  if (p.session.activeVoiceLipSync.get(ch) !== info.id) return;
  p.session.activeVoiceLipSync.delete(ch);
  ch.setLipSyncEnabled(false);
  ch.setLipSyncPresentationMode(0);
  clearMotionSyncSource(p, ch);
  if (ch.setLipsAnalyzer) ch.setLipsAnalyzer(null);
};

// StopLipSyncAndCloseMouth
export const stopLipSyncAndCloseMouth = (p, ch) => {
  p.session.activeVoiceLipSync.delete(ch);
  ch.setLipSyncEnabled(false);
  ch.setLipSyncPresentationMode(0);
  clearMotionSyncSource(p, ch);
  if (ch.setLipsAnalyzer) ch.setLipsAnalyzer(null);
  ch.stopTimedPseudoLipSync();
  ch.setMouthOpening(0);
};

// StopLipSyncForShowingCharacters
export const stopLipSyncForShowingCharacters = (p) => {
  for (const ch of p.ctx.characters.showing()) stopLipSyncAndCloseMouth(p, ch);
};

// PlayTalkMappedVoices (the default mode): voice i for speaker i with its lip sync; a speaker without a voice gets the
// timed pseudo lip sync (or, when some speakers have voices, shares voice 0's analyzer); surplus voices play alone
export const playTalkMappedVoices = (p, c, names, talkLength, sounds) => {
  const ctx = p.ctx, s = p.session, voices = c.VoiceIDs || [], n = voices.length, ignore = !!c.IgnoreLipSync;
  let voiceless = null;
  if (n >= 1 && n < names.length && s.withVoice) voiceless = names.slice(n).map((nm) => ctx.characters.get(nm)).filter(Boolean);
  let first = true;
  names.forEach((name, i) => {
    if (!(i < n || voiceless === null)) return;
    const ch = ctx.characters.get(name);
    if (!ch) { if (i < n) tryPlayVoice(p, voices[i], sounds, null); return; }
    if (i < n && s.withVoice) {
      tryPlayVoice(p, voices[i], sounds, (info) => {
        startVoiceLipSync(p, ch, info, ignore);
        const shared = first ? voiceless || [] : [];
        first = false;
        for (const v of shared) startSharedAnalyzerLipSync(p, v, info, ignore);
        info.onFinished.push(() => { stopVoiceLipSync(p, ch, info); for (const v of shared) stopVoiceLipSync(p, v, info); });
      });
    } else {
      presentation(ch, ignore);
      ch.setLipSyncEnabled(!ignore, false);
      ch.startTimedPseudoLipSync(talkLength, p.speedRate(), 1);
    }
  });
  for (let i = names.length; i < n; i++) tryPlayVoice(p, voices[i], sounds, null);
};

// PlayEveryoneLipSyncVoices: every showing character follows voice 0's analyzer
export const playEveryoneLipSyncVoices = (p, c, sounds) => {
  const ignore = !!c.IgnoreLipSync;
  (c.VoiceIDs || []).forEach((id, i) => {
    tryPlayVoice(p, id, sounds, (info) => {
      if (i !== 0) return;
      for (const ch of p.ctx.characters.showing()) startSharedAnalyzerLipSync(p, ch, info, ignore);
      info.onFinished.push(() => {
        for (const ch of p.ctx.characters.showing()) if (p.session.activeVoiceLipSync.has(ch)) stopVoiceLipSync(p, ch, info);
      });
    });
  });
};

// StartAirLipSync / StartHoldOpenAirLipSync: no audio, the named speakers move their mouths for the line's length
export const startAirLipSync = (p, c, names, talkLength, holdOpen) => {
  const ignore = !!c.IgnoreLipSync, v = floatParam(c.Parameter2) || 1;
  for (const name of names) {
    const ch = p.ctx.characters.get(name);
    if (!ch) continue;
    presentation(ch, ignore);
    ch.setLipSyncEnabled(!ignore, false);
    if (holdOpen) ch.startTimedHoldOpenPseudoLipSync(v, talkLength, p.speedRate());
    else ch.startTimedPseudoLipSync(talkLength, p.speedRate(), v);
  }
};

// AdvTextCommandHelper.WaitAutoPlayText, on a token linking the playback token with a new auto-advance token of the
// session (Session.CreateAutoAdvCancellationToken: the previous one cancelled first; a tap cancels it):
//   WaitWhile(IsTyping); startTime = Time.time
//   voices: WaitUntil(IsPlayFinished) for each, then DelayWithPauseSpeedAdjustment(_waitAfterVoiceTime / speed)
//   else DelayWithPauseSpeedAdjustment(_waitTalkTextUnitTime * talkLength / speed)
//   elapsed = GetTime() - startTime; minT = _minTalkDisplayTime / speed; if (elapsed < minT) DelayWithPause...(minT - elapsed)
// A cancelled auto-advance token ends those waits at their next tick; then, on the playback token only,
//   WaitUntil(IsNextStepGoNext)
// UniTask.WaitWhile / WaitUntil check their predicate from the next Update tick on (float32 arithmetic throughout).
export const waitAutoPlayText = async (p, sounds, typing, talkLength) => {
  const P = p.ctx.settings.player, loop = p.ctx.loop, ui = p.ctx.ui, audio = p.ctx.audio, speed = F(p.speedRate());
  let autoCancelled = false;
  createAutoAdvCancellation(p, () => { autoCancelled = true; });
  const alive = () => !autoCancelled && !p.cancelled;
  const waitWhile = async (pred) => {
    do { await loop.yield("Update"); if (!alive()) return false; } while (pred());
    return true;
  };
  const body = async () => {
    if (!await waitWhile(() => ui.isTyping)) return;
    const start = F(loop.time);
    if (sounds.length) {
      for (const info of sounds) if (!await waitWhile(() => audio.isPlaying(info.id))) return;
      if (!await delayWithPauseSpeedAdjustment(p, F(P._waitAfterVoiceTime / speed), alive)) return;
    } else if (!await delayWithPauseSpeedAdjustment(p, F(F(P._waitTalkTextUnitTime * talkLength) / speed), alive)) return;
    const elapsed = F(F(loop.time) - start), minT = F(P._minTalkDisplayTime / speed);
    if (elapsed < minT) await delayWithPauseSpeedAdjustment(p, F(minT - elapsed), alive);
  };
  await body();
  if (p.cancelled) return;
  do await loop.yield("Update"); while (!p.cancelled && p.nextStep !== NEXT_GO);
};

// AdvTalkCommand (IsNoWait is not read): the line goes to the talk log (also while shortcutting), then shows in the
// talk window with its voices; then the player's tap (manual) or the auto-advance timing. A tap while the typewriter
// runs reveals the line and waits once more.
export const Talk = (c, p) => (async () => {
  const ctx = p.ctx, s = p.session, audio = ctx.audio;
  beginVoicePlaybackScope(s);                                           // a Voice row's voices stop being its own
  ctx.ui.hideTalkNextIndicator();
  const valid = !!c.AdvTextID && c.AdvTextID !== "0";                  // IsValidTextId
  const speaker = valid ? speakerName(c, p) : "";
  const text = valid ? ctx.localize(c.AdvTextID) : "";
  if (valid) addLogEntry(p, c, removeTagsKeepingRuby(text), speaker, c.VoiceIDs);   // AdvTalkHelper.AddLogEntry
  if (p.shortcut) return;
  if (!valid) { ctx.ui.hideTalk(); return; }
  const voices = c.VoiceIDs || [];
  if (voices.length && s.withVoice && audio.lastBgmOrSeFrame === ctx.loop.frameCount)
    await ctx.loop.delayFrame(2);                                       // DelayIfSameFrameAsBgmOrSeAsync
  stopCurrentVoices(p, false);
  ctx.ui.showTalk();
  p.changeNextStepStateOnAutoPlay();
  ctx.ui.setSpeakerName(speaker);
  const typing = ctx.ui.setTalk(text);
  const talkLength = typing.totalLength;
  p.lineIndex++;
  if (p.onLine) p.onLine({ index: p.lineIndex, row: c.i, speaker, text });
  const sounds = [];
  try {
    if (!c.TargetName) {
      for (const id of voices) tryPlayVoice(p, id, sounds, null);       // narration: voices without lip sync
    } else {
      const names = c.TargetName.split(ctx.settings.player._targetNameSplitKey);   // SplitTargetNames
      const mode = (c.Parameter1 ?? "").trim().toLowerCase();
      if (mode === "airlipsync") startAirLipSync(p, c, names, talkLength, false);
      else if (mode === "everyonelipsync" && voices.length && s.withVoice) playEveryoneLipSyncVoices(p, c, sounds);
      else if (mode === "airlipsync_holdopen") startAirLipSync(p, c, names, talkLength, true);
      else playTalkMappedVoices(p, c, names, talkLength, sounds);
    }
    if (p.isAutoPlay) await waitAutoPlayText(p, sounds, typing, talkLength);
    // UniTask.WaitUntil(IsNextStepGoNext): the player's tap; in auto mode the step is already GoNext (one tick)
    await p.waitUntilGoNext();
    typing.cancel();                                                    // typingCts.Cancel(): showAllOnCancel
    clearAutoAdvCancellation(p);
    if (ctx.ui.isTyping) {                                              // the tap arrived while still typing
      p.changeNextStepStateOnAutoPlay();
      if (!p.isAutoPlay) await p.waitUntilGoNext();
      else await waitAutoPlayText(p, sounds, typing, talkLength);
    }
  } finally {
    p.nextStep = 0;                                                     // ChangeIdleState
  }
})();

// AdvLocationCommand: the location caption, first to the talk log without a speaker (also while shortcutting). Not
// shown while shortcutting; otherwise WarmupHelper.WarmupMinDelayFrameAsync (UniTask.DelayFrame(1) at Update) first,
// IsNoWait rows too, then UIAdvWidget.ShowLocation (awaited unless IsNoWait)
export const Location = (c, p) => {
  const id = c.AdvTextID || (c.TargetTextIDs || [])[0];
  const name = p.ctx.localize(id);
  addLogEntry(p, c, removeTagsKeepingRuby(name), null, null);
  if (p.shortcut) return Promise.resolve();
  return (async () => {
    await p.ctx.loop.delayFrame(1);
    if (p.cancelled) return;
    await p.noWait(c, p.ctx.ui.showLocation(name));
  })();
};

