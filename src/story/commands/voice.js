import { F } from "../../engine/core.js";
import { StoryCommandError } from "../interfaces.js";
import { delayWithSpeedAdjustment, waitUntil } from "../features/timing.js";
import { createAutoAdvCancellation, startVoiceLipSync, stopCurrentVoices, stopLipSyncAndCloseMouth, stopVoiceLipSync,
         tryPlayVoice } from "./talk.js";
import { videoUI } from "./video.js";

// Voice (AdvVoiceCommand): a row's voices without a text window, waited for.

// AdvPlaybackSession.BeginVoicePlaybackScope / IsVoicePlaybackScopeCurrent: one version counter shared by Talk and
// Voice (a later Talk or Voice makes an earlier Voice's scope stale); never 0
export const beginVoicePlaybackScope = (s) => {
  const v = ((s.voiceScopeVersion | 0) + 1) | 0;
  s.voiceScopeVersion = (v >>> 0) > 1 ? v : 1;
  return s.voiceScopeVersion;
};
const scopeCurrent = (s, v) => v !== 0 && s.voiceScopeVersion === v;

// AdvVoiceCommand.OwnsCurrentVoicePlayback: the scope is current and the session's voices are exactly the ones this
// row started (any when it started none)
const owns = (s, scope, owned) => scopeCurrent(s, scope) &&
  (!owned.length || (s.voicePlayIds.length === owned.length && owned.every((id, i) => s.voicePlayIds[i] === id)));

// AdvTalkVoicePlaybackHelper.PlaySimpleVoices / PlayVoiceMappedVoices (shouldPlayVoice true): the number of voices
// started. A named speaker gets its voice with lip sync (stopped when the voice finishes); a speaker without a voice
// gets nothing; an unknown speaker's voice and the surplus voices play without lip sync.
const playSimpleVoices = (p, c, sounds) => {
  for (const id of c.VoiceIDs || []) tryPlayVoice(p, id, sounds, null);
  return (c.VoiceIDs || []).length;
};
const playVoiceMappedVoices = (p, c, names, sounds) => {
  const voices = c.VoiceIDs || [], ignore = !!c.IgnoreLipSync;
  let n = 0;
  names.forEach((name, i) => {
    if (i >= voices.length) return;
    const ch = p.ctx.characters.get(name);
    tryPlayVoice(p, voices[i], sounds, ch ? (info) => {
      startVoiceLipSync(p, ch, info, ignore);
      info.onFinished.push(() => stopVoiceLipSync(p, ch, info));     // RegisterPlayFinishedFunction
    } : null);
    n++;
  });
  for (let i = names.length; i < voices.length; i++) { tryPlayVoice(p, voices[i], sounds, null); n++; }
  return n;
};

// AdvVoiceCommand.PlayVoice. Shortcutting returns at once. After DelayIfSameFrameAsBgmOrSeAsync a newer Talk / Voice
// ends the row; otherwise the current voices stop (the auto-advance token with them), the next step is set, a new
// auto-advance token is linked, and the voices start. With none started the row goes idle. Otherwise one tick for the
// start callbacks, each sound until it has finished, then 0.6 s / speed (auto, DelayWithSpeedAdjustment: no pause hold,
// no minimum display time) or the front next indicator and the tap (manual), then idle. A cancelled auto-advance
// token (a tap, another command stopping the voices) ends the row at once and leaves the next step as it is. At the
// end, if this row still owns the current voices, they stop and the named speakers' mouths close.
// ENGINE: TryPlayVoice returns false for a sound that fails to start; here the audio raises for a cue not preloaded.
const playVoice = async (c, p) => {
  const ctx = p.ctx, s = p.session, audio = ctx.audio, sounds = [];
  let names = null, owned = [];
  const scope = beginVoicePlaybackScope(s);
  try {
    if (p.shortcut) return;
    if (audio.lastBgmOrSeFrame === ctx.loop.frameCount) await ctx.loop.delayFrame(2);
    if (p.cancelled || !scopeCurrent(s, scope)) return;
    stopCurrentVoices(p, false);
    p.changeNextStepStateOnAutoPlay();
    let autoCancelled = false;
    createAutoAdvCancellation(p, () => { autoCancelled = true; });
    const auto = () => autoCancelled;
    const split = ctx.settings.player._targetNameSplitKey;
    if (c.TargetName && typeof split !== "string") throw new StoryCommandError("player settings: _targetNameSplitKey missing");
    names = c.TargetName ? c.TargetName.split(split) : [];
    const expected = names.length ? playVoiceMappedVoices(p, c, names, sounds) : playSimpleVoices(p, c, sounds);
    owned = [...s.voicePlayIds];
    if (expected === 0) { p.nextStep = 0; return; }
    if (!await waitUntil(p, () => expected <= sounds.length, auto)) return;
    for (const info of sounds) if (!await waitUntil(p, () => !audio.isPlaying(info.id), auto)) return;
    if (p.isAutoPlay) {
      const t = ctx.settings.player._waitAfterVoiceTime;
      if (typeof t !== "number") throw new StoryCommandError("player settings: _waitAfterVoiceTime missing");
      if (!await delayWithSpeedAdjustment(p, F(t / p.speedRate()), auto)) return;
    } else {
      videoUI(ctx, "showNextIndicator");
      if (!await waitUntil(p, () => p.nextStep === 2)) return;
      videoUI(ctx, "hideNextIndicator");
    }
    p.nextStep = 0;                                                     // ChangeIdleState
  } finally {
    if (owns(s, scope, owned)) {
      stopCurrentVoices(p, false);
      if (names && !c.IgnoreLipSync)                                    // StopLipSyncTargets
        for (const nm of names) { const ch = ctx.characters.get(nm); if (ch) stopLipSyncAndCloseMouth(p, ch); }
    }
  }
};

// AdvVoiceCommand.Execute: nothing while voices are off; IsNoWait detaches the row
export const Voice = (c, p) => (p.session.withVoice ? p.noWait(c, playVoice(c, p)) : Promise.resolve());
