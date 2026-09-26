import { commandHandler } from "../interfaces.js";
import { StoryPlayerCore } from "../player-core.js";
import "../features/index.js";
import { playEveryoneLipSyncVoices, playTalkMappedVoices, speakerName, startAirLipSync, startVoiceLipSync,
         stopLipSyncAndCloseMouth, stopLipSyncForShowingCharacters, stopVoiceLipSync, tryPlayVoice } from "../commands/talk.js";
import { LOOK_STAGE_DIFF_TO_PARAM_SCALE, SIMPLE_ADVANCE, SIMPLE_COMPLETE, STAGE_X, TALK_LIP_SYNC,
         canPlaceCharacter } from "./define.js";
import { runnerRows, validateSimpleEpisode } from "./validator.js";

// SimpleAdvPlayer: one Overlay episode on the simple presentation (view.js) inside a host screen. The loaded episode's
// AdvPlayer is only the command context of the shared command classes: here a StoryPlayerCore whose context is the
// simple session's (characters, audio, loop, settings, the booted but undisplayed field renderer), never played.
// SimpleAdvCommandRunner runs the rows with the character handler (In, Out, LookTarget, Effect), the text handler
// (Talk, Voice, Wait), the talk window swap and the shared commands; every other command is logged and skipped.

const F = Math.fround;
const validText = (id) => !!id && id !== "0";                           // AdvEpisode.IsValidTextId

// the rows the runner hands to the shared command classes (awaited with the AdvPlayer as IAdvPlayerContext)
export const SIMPLE_SHARED_COMMANDS = Object.freeze(["Delay", "Brightness", "Expression", "Pause", "Resume", "Motion",
  "Costume", "Se", "Angle", "Look", "RimLight", "MotionLoop", "EyeBlink"]);
// the rows the simple handlers run
export const SIMPLE_OWN_COMMANDS = Object.freeze(["In", "Out", "Talk", "Character", "Wait", "TalkWindow", "Voice",
  "Effect", "LookTarget"]);

// SimpleAdvTextCommandHandler.ResolveTalkLipSyncMode: Parameter1 trimmed, ignore case
export const talkLipSyncMode = (p1) => {
  const s = (p1 ?? "").trim().toLowerCase();
  if (s === "airlipsync") return TALK_LIP_SYNC.Air;
  if (s === "airlipsync_holdopen") return TALK_LIP_SYNC.AirHoldOpen;
  if (s === "everyonelipsync") return TALK_LIP_SYNC.Everyone;
  return TALK_LIP_SYNC.Default;
};

// AdvMotionController.PlayLastQueueMotion(characterName): the last queued motion of the character plays (the queue is
// dropped), else its waiting motion; the waiting entry is dropped either way
export const playLastQueueMotion = (motions, name) => {
  if (!name) return;
  const q = motions.queues.get(name);
  if (q && q.length) { motions.playInternal(q[q.length - 1]); motions.queues.delete(name); }
  else if (motions.waiting.has(name)) motions.playInternal(motions.waiting.get(name));
  else return;
  motions.waiting.delete(name);
};

export class SimpleAdvPlayer {
  // ctx: the simple StoryContext; view: SimpleAdvView; window: the initial SimpleTalkWindow; windows: name -> the
  // talk windows the story provides; request: {advanceMode, completeBehavior, withVoice, startIndex};
  // hooks: {slotStage(slot) -> CameraTargetRenderer, onLine, onCommand, onSkipped(c), onError}
  constructor(ctx, view, window, windows, request, hooks = {}) {
    this.ctx = ctx; this.view = view; this.initialWindow = window; this.windows = windows; this.hooks = hooks;
    this.advanceMode = request.advanceMode ?? SIMPLE_ADVANCE.Manual;
    this.completeBehavior = request.completeBehavior ?? SIMPLE_COMPLETE.CleanupAll;
    this.startIndex = request.startIndex || 0;
    // the AdvPlayer as IAdvPlayerContext: shortcut off, speed x1, its own auto flag off (the simple path decides auto
    // advance by its request)
    const p = this.p = new StoryPlayerCore(ctx, { auto: false, speed: 10, onError: hooks.onError || null });
    if (request.withVoice === false) p.session.withVoice = false;
    this.voiceVersion = 0;
    this.isPlaying = false; this.completed = false; this.cancelled = false;
    this.skipped = [];                                                  // rows logged by LogUnsupported
    this.lineIndex = -1;
    this.validation = null;
  }

  get loop() { return this.ctx.loop; }
  get session() { return this.p.session; }
  get isAuto() { return this.advanceMode === SIMPLE_ADVANCE.Auto; }

  // ------------------------------------------------------------------------------------------------ Play
  // SimpleAdvPlayer.Play from the validation on (the download and AdvManager.Preload are the session's loading):
  // -> "completed" | "invalid" | "stopped"
  async play() {
    this.isPlaying = true;
    const v = this.validation = validateSimpleEpisode(this.ctx.episode, this.ctx.settings.player, this.startIndex);
    if (!v.ok) {                                                        // FinishWithoutPresentation
      console.warn(`SimpleAdvPlayer: row ${v.failure.row}: ${v.failure.reason}; the episode is not played`);
      this.cleanupAll();
      this.isPlaying = false; this.completed = true;
      return "invalid";
    }
    const view = this.view;
    view.hide();                                                        // SimpleAdvView.Initialize (the slots warm up
    view.attachTalkWindow(this.initialWindow);                          // with the renderer's targets)
    view.setAdvanceInputEnabled(true);
    view.setAdvanceProgressEnabled(this.advanceMode !== SIMPLE_ADVANCE.Auto);
    view.show();
    try {
      for (const c of runnerRows(this.ctx.episode, this.startIndex)) {
        if (this.cancelled) return "stopped";
        if (this.hooks.onCommand) this.hooks.onCommand(c);
        await this.dispatch(c);
      }
    } catch (e) {
      if (this.cancelled) return "stopped";
      throw e;
    }
    if (this.cancelled) return "stopped";
    await this.complete(false);
    return "completed";
  }

  // SimpleAdvCommandRunner.Run: the dispatch of one row
  dispatch(c) {
    const p = this.p;
    switch (c.cmd) {
      case "In": return c.IsNoWait ? (this.showCharacter(c).catch((e) => p.fail(e)), Promise.resolve()) : this.showCharacter(c);
      case "Out": this.playCharacterOut(c); return Promise.resolve();
      case "Talk": return this.playTalk(c);
      case "Character": return Promise.resolve();
      case "Wait": return this.playWait(c);
      case "TalkWindow": this.applyLoadedTalkWindow(c); return Promise.resolve();
      case "Voice": return this.playVoice(c);
      case "Effect": return this.playEffect(c);
      case "LookTarget": return this.playLookTarget(c);
      default:
        if (SIMPLE_SHARED_COMMANDS.includes(c.cmd)) return commandHandler(c.cmd)(c, p);
        this.skipped.push({ row: c.i, cmd: c.cmd });                    // LogUnsupported
        if (this.hooks.onSkipped) this.hooks.onSkipped(c);
        return Promise.resolve();
    }
  }

  // ------------------------------------------------------------------------------------------------ complete
  // CompleteAsync(suppress): CleanupAll after the root's fade out, or RetainCompletedPresentation
  async complete(suppress) {
    if (this.completed) return;
    this.isPlaying = false; this.completed = true;
    if (!suppress) {
      if (this.completeBehavior !== SIMPLE_COMPLETE.HideTalkWindowKeepCharacters) {
        await this.view.fadeOutAndHide();
        this.cleanupAll();
      } else this.retainCompletedPresentation();
    } else this.cleanupAll();
  }

  // Stop from the page (no game counterpart: the talks have no skip): suppressed completion
  stop() {
    if (this.completed) return;
    this.cancelled = true; this.p.cancelled = true;
    this.p.session.delayTokens.cancel(false);
    this.complete(true);
  }

  // CleanupAll: voices at once, SE with a 0.3 s fade, effects, lip sync, the view's characters
  cleanupAll() {
    this.stopCurrentVoices(false);
    this.stopCurrentSe();
    this.resetAllLipSync();
    for (const s of this.view.slots) if (s.character) this.hideSlot(s);
    this.view.hide();
  }

  // RetainCompletedPresentation: the talk window goes, the characters stay
  retainCompletedPresentation() {
    this.stopCurrentVoices(false);
    this.resetAllLipSync();
    this.view.hideTalkWindow();
    this.view.setAdvanceInputEnabled(false);
    this.view.setAdvanceProgressEnabled(false);
  }

  // AdvSoundHelper.StopCurrentVoices / StopCurrentSe
  stopCurrentVoices(fade) {
    const s = this.p.session, a = this.ctx.audio;
    for (const id of s.voicePlayIds) a.stop(id, !!fade);
    s.voicePlayIds = [];
  }
  stopCurrentSe() {
    const s = this.p.session, a = this.ctx.audio;
    for (const id of s.sePlayIds) a.stop(id, true, F(0.3));
    s.sePlayIds = [];
  }

  // AdvTalkVoicePlaybackHelper.ResetAllLipSync: every loaded controller stops its lip sync and closes its mouth
  resetAllLipSync() { for (const ch of this.ctx.characters.values()) stopLipSyncAndCloseMouth(this.p, ch); }

  // AdvTalkVoicePlaybackHelper.StopLipSyncTargets
  stopLipSyncTargets(names) {
    for (const n of names) { const ch = this.ctx.characters.get(n); if (ch) stopLipSyncAndCloseMouth(this.p, ch); }
  }

  // ------------------------------------------------------------------------------------------------ characters
  // SimpleAdvCharacterCommandHandler.ResolveSlotIndex
  resolveSlot(c) {
    const v = this.view, pos = c.PositionType || 0;
    const byName = v.slotByTargetName(c.TargetName);
    if (byName) return byName;
    if (canPlaceCharacter(pos)) return this._slotOrWarn(pos);
    if (c.TargetName && this.p.session.targetNameToPosition.has(c.TargetName))
      return this._slotOrWarn(this.p.session.targetNameToPosition.get(c.TargetName));
    const d = v.defaultSlot();
    if (!d) console.warn("SimpleAdv: no position root");
    return d;
  }

  _slotOrWarn(pos) {
    const s = this.view.slotByPositionType(pos);
    if (!s) console.warn(`SimpleAdv: overlay has no position root for PositionType ${pos}`);
    return s;
  }

  // PlayCharacterIn -> ShowCharacter
  async showCharacter(c) {
    const ctx = this.ctx, v = this.view, s = this.p.session;
    const ch = ctx.characters.get(c.TargetName);
    if (!ch) { console.warn(`SimpleAdv: character ${c.TargetName} is not loaded`); return; }
    const slot = this.resolveSlot(c);
    if (!slot) return;
    // AdvPlaybackSession.SetCharacterPositionInfo
    const pos = slot.positionType;
    if (s.placedPositions.includes(pos)) {
      s.targetNameToPosition.delete(c.TargetName); s.positionToCharacter.delete(pos);
      s.placedPositions.splice(s.placedPositions.indexOf(pos), 1);
    }
    s.targetNameToPosition.set(c.TargetName, pos); s.positionToCharacter.set(pos, ch); s.placedPositions.push(pos);
    const desync = !c.MotionName && v.otherSlotsHaveCharacter(slot);    // ShouldDelayIdleAndBreathStart
    await this.slotShow(slot, c.TargetName, ch, c.MotionName || "", c.ExpressionName || "", c.MotionFadeIn || 0, !desync);
    if (s.eyeBlinkStoppedTargetNames.has(c.TargetName)) ch.setEyeBlinkStopped(true, 0);
    await v.fadeInSlot(slot, this.p.calcDuration(c.Duration || 0, 0), this.loop);
    if (desync) this.startIdleAndBreathWithOffset(c.TargetName, ch, slot).catch((e) => this.p.fail(e));
  }

  // SimpleAdvView.Slot.Show
  async slotShow(slot, name, ch, motion, expression, fadeIn, startImmediately) {
    const q = this.ctx.quality, crt = this.hooks.slotStage(slot);
    if (slot.character && slot.character !== ch) this.hideSlot(slot);
    crt.applyCaptureScale(this.view.profile.captureBaseScale);
    ch.setLayer(crt.layer);
    ch.setParent(crt.stage);
    ch.show(motion, expression, fadeIn);
    ch.setIgnoreAllUpdate(false);
    ch.forceModelUpdate();
    ch.setLightingEnabled(false);
    ch.setPhysicsEnabled(q.characterPhysics);
    ch.setBreathMotionEnabled(q.characterBreathMotion && startImmediately);
    ch.setEyeBlinkEnabled(true);
    ch.forceModelUpdate();
    await this.loop.yield("PostLateUpdate");                            // UniTask.Yield(LastPostLateUpdate)
    this.view.setSlotCharacter(slot, name, ch);
    crt.active = true;                                                  // CameraTargetRenderer.Activate
  }

  // SimpleAdvView.Slot.Hide
  hideSlot(slot) {
    const ch = slot.character, crt = this.hooks.slotStage(slot);
    if (ch) {
      ch.hide(); ch.setIgnoreAllUpdate(true);
      ch.setLightingEnabled(true); ch.setEyeBlinkEnabled(true);
      ch.setLayer(0);                                                   // "Default"
      ch.setParent(this.hooks.poolRoot || null);                        // ApplyBasePosition + SetParent(fallback)
    }
    this.view.clearSlot(slot);
    crt.active = false;                                                 // CameraTargetRenderer.Deactivate
  }

  // StartIdleAndBreathWithOffset: slot + 1 frames later the default motion restarts (when it is still the one
  // playing) and the breath motion starts, so that characters shown together do not move in step
  async startIdleAndBreathWithOffset(name, ch, slot) {
    await this.loop.delayFrame(slot.index + 1);
    if (this.ctx.characters.get(name) !== ch || this.view.slotByTargetName(name) !== slot) return;
    if (ch.ctl.currentMotion === ch.defaultMotionName) ch.playMotion(ch.defaultMotionName, 0);
    ch.setBreathMotionEnabled(this.ctx.quality.characterBreathMotion);
  }

  // PlayCharacterOut: the slot by name, placeable PositionType or the session's position; hidden at once
  playCharacterOut(c) {
    const v = this.view, pos = c.PositionType || 0;
    let slot = v.slotByTargetName(c.TargetName);
    if (!slot && canPlaceCharacter(pos)) slot = this._slotOrWarn(pos);
    if (!slot && c.TargetName && this.p.session.targetNameToPosition.has(c.TargetName))
      slot = this._slotOrWarn(this.p.session.targetNameToPosition.get(c.TargetName));
    if (slot) this.hideSlot(slot);
  }

  // PlayLookTarget -> SetLookTargetOverTime: the look direction toward the slot of PositionType from the looker's own
  // slot (ResolveStageX difference x 0.2, clamped), y 0; "stop" returns to the original look. The look itself is the
  // shared AdvLookCommandHelper.ApplyLookOverTime, run through the Look command with that direction.
  playLookTarget(c) {
    const p = this.p, ctx = this.ctx;
    const task = (async () => {
      const ch = ctx.characters.get(c.TargetName);
      if (!ch) { console.warn(`SimpleAdv: LookTarget TargetName ${c.TargetName}`); return; }
      const enabled = (c.Parameter3 ?? "").toLowerCase() !== "stop";
      let x = 0;
      if (enabled) {
        const own = this.view.slotByTargetName(c.TargetName);
        if (!own) return;
        if (!p.session.positionToCharacter.has(c.PositionType || 0)) {
          console.warn(`SimpleAdv: LookTarget PositionType ${c.PositionType || 0} TargetName ${c.TargetName}`);
          return;
        }
        const d = F(F((STAGE_X[c.PositionType] ?? 0) - (STAGE_X[own.positionType] ?? 0)) * LOOK_STAGE_DIFF_TO_PARAM_SCALE);
        x = Math.min(1, Math.max(-1, d));
      }
      await commandHandler("Look")({ ...c, IsNoWait: false, Parameter1: String(x), Parameter2: "0" }, p);
    })();
    return p.noWait(c, task);
  }

  // PlayEffect: an Effect row places its particle effect on the stage of the slot of PositionType (the slot's capture
  // layer, sort order EFFECT_SORT_ORDER). The session refuses an episode with Effect rows before loading.
  playEffect(c) {
    throw new Error(`SimpleAdv: row ${c.i}: Effect ${c.TargetName ?? ""} on a character slot is not provided`);
  }

  // ------------------------------------------------------------------------------------------------ text
  // AdvTalkWindowCommandHelper.ApplyLoadedTalkWindow(episode, loader, view.AttachTalkWindow)
  applyLoadedTalkWindow(c) {
    const w = this.windows.get(c.TargetAssetName);
    if (!w) throw new Error(`SimpleAdv: talk window ${c.TargetAssetName} is not provided`);
    this.view.attachTalkWindow(w);
  }

  // SplitTargetNames
  splitTargetNames(c) {
    return c.TargetName ? c.TargetName.split(this.ctx.settings.player._targetNameSplitKey) : [];
  }

  // SimpleAdvTextCommandHandler.PlayTalkVoices -> the voice version (0 when no voice was started)
  playTalkVoices(c, mode, names, talkLength, sounds) {
    const p = this.p, s = p.session, voices = c.VoiceIDs || [];
    let played = false;
    if (mode === TALK_LIP_SYNC.Everyone) {
      if (s.withVoice && voices.length) { this.stopCurrentVoices(false); playEveryoneLipSyncVoices(p, c, sounds); played = true; }
    } else if (mode === TALK_LIP_SYNC.AirHoldOpen) startAirLipSync(p, c, names, talkLength, true);
    else if (mode === TALK_LIP_SYNC.Air) startAirLipSync(p, c, names, talkLength, false);
    else if (names.length) {
      this.stopCurrentVoices(false);
      playTalkMappedVoices(p, c, names, talkLength, sounds);
      played = s.withVoice && voices.length > 0;
    } else if (s.withVoice && voices.length) {                            // PlaySimpleVoices
      this.stopCurrentVoices(false);
      for (const id of voices) tryPlayVoice(p, id, sounds, null);
      played = true;
    }
    return played ? ++this.voiceVersion : 0;
  }

  // StopVoicePlayback(version, mode): a newer voice set keeps playing; else the voices stop and the lip sync clears
  stopVoicePlayback(version, mode, names) {
    if (version > 0 && version !== this.voiceVersion) return;
    this.stopCurrentVoices(false);
    if (mode === TALK_LIP_SYNC.Everyone) stopLipSyncForShowingCharacters(this.p);
    else this.stopLipSyncTargets(names);
  }

  // SimpleAdvTextCommandHandler.PlayTalk
  async playTalk(c) {
    const ctx = this.ctx, v = this.view, w = v.window, loop = this.loop;
    if (!w) return;
    if (!validText(c.AdvTextID)) { w.talk.hideTalk(0); return; }
    const speaker = speakerName(c, this.p), text = ctx.localize(c.AdvTextID);
    v.show();
    v.resetAdvanceRequest();
    w.setSpeakerName(speaker);
    w.talk.showTalk(0);
    const typing = w.talk.setTalk(text);
    this.lineIndex++;
    if (this.hooks.onLine) this.hooks.onLine({ index: this.lineIndex, row: c.i, speaker, text });
    const talkLength = typing.totalLength, mode = talkLipSyncMode(c.Parameter1), names = this.splitTargetNames(c);
    const sounds = [];
    const version = this.playTalkVoices(c, mode, names, talkLength, sounds);
    while (w.talk.isTyping && !this.cancelled) {
      if (v.consumeAdvanceRequest()) { typing.cancel(); break; }
      await loop.yield("Update");
    }
    if (this.advanceMode === SIMPLE_ADVANCE.Manual) await this.waitForAdvance(false);
    else await this.waitForAutoTalkAdvance(talkLength, sounds);
    if (this.cancelled) return;
    this.stopVoicePlayback(version, mode, names);
    w.talk.hideTalkNextIndicator();
    playLastQueueMotion(this.p.motions, c.TargetName);
  }

  // WaitForAdvance(resetAtStart): until a tap request is consumed, one Update tick per check
  async waitForAdvance(resetAtStart) {
    if (resetAtStart) this.view.resetAdvanceRequest();
    while (!this.cancelled && !this.view.consumeAdvanceRequest()) await this.loop.yield("Update");
  }

  // IsAnyVoicePlaying: a voice of the session still plays
  isAnyVoicePlaying() { return this.p.session.voicePlayIds.some((id) => this.ctx.audio.isPlaying(id)); }

  // DelayForAutoAdvance(d): remaining -= SystemDeltaTime x speed rate per Update tick; a consumed request ends it
  async delayForAutoAdvance(d) {
    let remaining = F(d);
    while (remaining > 0 && !this.cancelled) {
      if (this.view.consumeAdvanceRequest()) return;
      await this.loop.yield("Update");
      remaining = F(remaining - F(F(this.loop.deltaTime) * this.p.speedRate()));
    }
  }

  // WaitForAutoTalkAdvance(talkLength)
  async waitForAutoTalkAdvance(talkLength) {
    const P = this.ctx.settings.player, loop = this.loop, speed = F(this.p.speedRate()), start = F(loop.time);
    if (!this.isAnyVoicePlaying()) await this.delayForAutoAdvance(F(F(P._waitTalkTextUnitTime * talkLength) / speed));
    else {
      while (this.isAnyVoicePlaying() && !this.cancelled) {
        if (this.view.consumeAdvanceRequest()) return;
        await loop.yield("Update");
      }
      await this.delayForAutoAdvance(F(P._waitAfterVoiceTime / speed));
    }
    const elapsed = F(F(loop.time) - start), minT = F(P._minTalkDisplayTime / speed);
    if (elapsed < minT && !this.cancelled) await this.delayForAutoAdvance(F(minT - elapsed));
  }

  // PlayVoice: the row's voices (mapped to TargetName's characters when named); the wait per advance mode
  async playVoice(c) {
    const p = this.p, s = p.session, loop = this.loop, voices = c.VoiceIDs || [];
    this.view.resetAdvanceRequest();
    const names = this.splitTargetNames(c), sounds = [];
    let version = 0;
    if (s.withVoice && voices.length) {                                  // PlayEpisodeVoices
      this.stopCurrentVoices(false);
      if (!names.length) for (const id of voices) tryPlayVoice(p, id, sounds, null);
      else this.playVoiceMappedVoices(c, names, sounds);
      version = ++this.voiceVersion;
    }
    if (c.IsNoWait) { this.observeNoWaitVoice(version).catch((e) => p.fail(e)); return; }
    if (this.advanceMode === SIMPLE_ADVANCE.Auto) {                     // WaitForAutoVoiceAdvance
      let skipped = false;
      while (this.isAnyVoicePlaying() && !this.cancelled) {
        if (this.view.consumeAdvanceRequest()) { skipped = true; break; }
        await loop.yield("Update");
      }
      if (!skipped) await this.delayForAutoAdvance(F(this.ctx.settings.player._waitAfterVoiceTime / F(p.speedRate())));
    } else {
      while (this.isAnyVoicePlaying() && !this.cancelled) {
        if (this.view.consumeAdvanceRequest()) break;
        await loop.yield("Update");
      }
    }
    if (this.cancelled) return;
    this.stopVoicePlayback(version, TALK_LIP_SYNC.Default, names);
  }

  // ObserveNoWaitVoice: the voices end on their own; their lip sync then clears (unless a newer voice set started)
  async observeNoWaitVoice(version) {
    while (this.isAnyVoicePlaying() && !this.cancelled) await this.loop.yield("Update");
    if (!this.cancelled && version > 0 && version === this.voiceVersion) this.stopVoicePlayback(version, TALK_LIP_SYNC.Default, []);
  }

  // AdvTalkVoicePlaybackHelper.PlayVoiceMappedVoices: voice i for the i-th named character with its lip sync (a name
  // without a loaded character plays its voice alone); surplus voices play alone
  playVoiceMappedVoices(c, names, sounds) {
    const p = this.p, voices = c.VoiceIDs || [], ignore = !!c.IgnoreLipSync;
    names.forEach((name, i) => {
      if (i >= voices.length) return;
      const ch = this.ctx.characters.get(name);
      if (!ch) { tryPlayVoice(p, voices[i], sounds, null); return; }
      tryPlayVoice(p, voices[i], sounds, (info) => {
        startVoiceLipSync(p, ch, info, ignore);
        info.onFinished.push(() => stopVoiceLipSync(p, ch, info));
      });
    });
    for (let i = names.length; i < voices.length; i++) tryPlayVoice(p, voices[i], sounds, null);
  }

  // PlayWait: auto -> DelayForAutoAdvance(AdvWaitCommandHelper.CalcAutoWaitDelay()); manual -> the next tap
  playWait() {
    if (this.advanceMode === SIMPLE_ADVANCE.Auto)
      return this.delayForAutoAdvance(F(this.p.calcDuration(this.ctx.settings.player._waitCommandLingeringTimeOnAutoPlay, 0)));
    return this.waitForAdvance(true);
  }
}
