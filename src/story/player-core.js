import { EASE, tryGetEase } from "../engine/tween.js";
import { SOUND_CATEGORY } from "../engine/audio.js";
import { ADV_PLAYBACK_MODE, StoryCommandError, checkEpisodeCommands, commandHandler, registerCommand,
         registeredCommands } from "./interfaces.js";
import { BUILTIN_COMMANDS } from "./commands/index.js";
import { advRow, floatParam } from "./params.js";
import { clearAutoAdvCancellation, playTalkMappedVoices, startVoiceLipSync, stopCurrentVoices,
         stopLipSyncForShowingCharacters, stopVoiceLipSync } from "./commands/talk.js";
import { storyVideo, tryShowVideoControl } from "./features/video.js";

// The episode interpreter: AdvPlayer's playback loop (Play, PreparePlayTask, StartPlayTask, PlayCommands, Stop), the
// shared command helpers of AdvPlayerModel (CalcDuration, the speed rate, the shortcut index, the next-step state of
// manual and auto advance) and the AdvPlaybackSession fields the commands share. Each command's Execute is a
// registered handler (commands/*.js, interfaces.js registerCommand).

for (const [name, fn] of Object.entries(BUILTIN_COMMANDS)) registerCommand(name, fn);

// AdvPlayerModel NextStepState
export const NEXT_STEP = { Idle: 0, AllowNext: 1, GoNext: 2 };

// AdvPlayerModel.GetNextPlaybackSpeed: the next AdvPlaybackSpeed value, wrapping
const FAST_FORWARD_NEXT = { 10: 15, 15: 17, 17: 20, 20: 10 };

// AdvPlayer.IsUnboundedWaitCommand: Talk, Wait, ChatTalk, ChoiceShow
const UNBOUNDED_WAIT = new Set(["Talk", "Wait", "ChatTalk", "ChoiceShow"]);
// AdvPlayer.GetBlockingSeconds: the row's Duration / max(DelaySeconds, 0) + Duration
const BLOCKING_DURATION = new Set(["In", "Out", "Delay", "Shake", "FadeOut", "FadeIn", "Brightness", "MoveToRight",
  "MoveToLeft", "SoundVolume", "Stage", "Alpha", "MoveToUp", "MoveToDown", "MoveToForward", "MoveToBack",
  "MoveToDirection"]);
const BLOCKING_DELAY_DURATION = new Set(["Focus", "Angle", "Pan", "Tilt", "Look", "Pedestal", "Track", "DoF", "Role",
  "Zoom", "LookTarget", "PanV2"]);

// The loaded characters of an episode (AdvEpisodeResourceLoader character maps): each Character row's controller
// under `TargetName + "-" + TargetAssetIndex` (AdvCharacterHelper.GetCharacterAssetMapKey; a key already present keeps
// the first model, LoadCharacter's TryAdd), and TargetName -> asset index, TryAdd(name, 0) on load; only Costume
// (SetCharacterAssetIndex) changes it. get(name) is TryGetCharacterController, the lookup of every character command.
// Iteration is load order.
export class StoryCharacters {
  constructor() { this.byKey = new Map(); this.indexByName = new Map(); this.meta = new Map(); }
  static key(name, index) { return `${name}-${index}`; }
  has(name, index) { return this.byKey.has(StoryCharacters.key(name, index)); }
  add(name, index, ch) {
    const k = StoryCharacters.key(name, index);
    if (this.byKey.has(k)) return false;
    this.byKey.set(k, ch); this.meta.set(ch, { name, index });
    if (!this.indexByName.has(name)) this.indexByName.set(name, 0);
    return true;
  }
  get(name) {
    if (!name) return undefined;
    const i = this.indexByName.get(name);
    return i === undefined ? undefined : this.byKey.get(StoryCharacters.key(name, i));
  }
  setAssetIndex(name, index) { this.indexByName.set(name, index); }
  // TargetName of a controller, and a label (the name alone for asset index 0)
  nameOf(ch) { return this.meta.get(ch).name; }
  label(ch) { const m = this.meta.get(ch); return m.index ? `${m.name}-${m.index}` : m.name; }
  values() { return this.byKey.values(); }
  get size() { return this.byKey.size; }
  // AdvEpisodeResourceLoader.GetShowingCharacterControllers
  showing() { return [...this.byKey.values()].filter((c) => c.isShowing); }
}

// AdvCommandDelayTokens: Delay(d) = UniTask.Delay(d) at PlayerLoopTiming.Update (scaled time) linked to the common
// delay token; d <= 0 completes synchronously. The waits go straight into the player loop's delay queue, so a Delay
// that runs out resumes exactly as PlayerLoop.delay does. A cancelled Delay is observed on the next Update tick
// (cancelImmediately false) and returns !token.IsCancellationRequested: true after CancelDelay
// (ClearCommonDelayCancellationToken), false when the playback stops (the command token).
export class AdvCommandDelayTokens {
  constructor(loop) { this.loop = loop; this.pending = new Set(); }

  delay(sec) {
    if (!(sec > 0)) return Promise.resolve(true);
    const loop = this.loop;
    if (this.pending.size > 64) for (const d of this.pending) if (!loop._delays.includes(d)) this.pending.delete(d);
    return new Promise((res) => {
      const d = loop._delayEntry(sec, res);                              // PlayerLoop.delay's own entry
      this.pending.add(d);
      loop._delays.push(d);
    });
  }

  // ClearCommonDelayCancellationToken (result true), or the playback's stop (result false)
  cancel(result = true) {
    const loop = this.loop, list = [...this.pending].filter((d) => loop._delays.includes(d));
    this.pending.clear();
    if (!list.length) return;
    loop._delays = loop._delays.filter((d) => !list.includes(d));
    loop.yield("Update").then(() => { for (const d of list) d.res(result); });
  }
}

// AdvMotionController: the motions waiting for their MotionWait, per TargetName, with a FIFO queue behind each;
// update(dt) is one step of ObserveCharacterMotions (OnUpdateCharacterMotions, once per frame): a waiting motion of a
// showing character counts down by AppTimeManager.GetSystemDeltaTime() x the speed rate (float32) and plays at <= 0;
// the next queued one starts its full wait in the next frame. The skipped seconds of a shortcut are kept per character that played a named motion (the Pause
// command seeks its motion by them).
export class AdvMotionController {
  constructor(player) {
    this.player = player; this.waiting = new Map(); this.queues = new Map(); this.skipped = new Map();
  }

  playMotion(ch, c, shortcut) {
    const d = { name: c.TargetName, ch, wait: shortcut ? 0 : Math.fround(c.MotionWait || 0), motion: c.MotionName || "",
                expression: c.ExpressionName || "", fadeIn: shortcut ? 0 : (c.MotionFadeIn || 0) };
    if (d.wait <= 0) {
      this.playInternal(d);
      if (this.waiting.has(d.name)) { this.waiting.delete(d.name); this.queues.delete(d.name); }
    } else if (!this.waiting.has(d.name)) this.waiting.set(d.name, d);
    else { if (!this.queues.has(d.name)) this.queues.set(d.name, []); this.queues.get(d.name).push(d); }
  }

  playInternal(d) {
    if (d.motion) this.skipped.set(d.name, 0);
    d.ch.playMotion(d.motion, d.fadeIn);
    if (!d.expression) d.ch.playDefaultExpression(d.fadeIn);
    else d.ch.playExpression(d.expression, d.fadeIn);
  }

  update(dt) {
    for (const [name, d] of [...this.waiting]) {
      if (!d.ch.isShowing) continue;
      d.wait = Math.fround(d.wait - Math.fround(Math.fround(dt) * this.player.speedRate()));
      if (d.wait > 0) continue;
      this.playInternal(d);
      const q = this.queues.get(name);
      if (q && q.length) this.waiting.set(name, q.shift()); else this.waiting.delete(name);
    }
  }

  // AdvanceSkippedSeconds / MarkSkippedSecondsUnbounded (+Infinity) / GetSkippedSeconds
  advanceSkippedSeconds(sec) {
    if (!(sec > 0) || !this.skipped.size) return;
    for (const k of [...this.skipped.keys()]) this.skipped.set(k, this.skipped.get(k) + sec);
  }
  markSkippedSecondsUnbounded() { this.advanceSkippedSeconds(Infinity); }
  skippedSeconds(name) { return name ? this.skipped.get(name) || 0 : 0; }

  // PlayLastQueueMotions: at the shortcut target, per character the last queued motion (else the waiting one) plays
  // now and the rest are dropped
  playLastQueueMotions() {
    if (!this.waiting.size && !this.queues.size) return;
    for (const name of new Set([...this.waiting.keys(), ...this.queues.keys()])) {
      const q = this.queues.get(name);
      if (q && q.length) { this.playInternal(q.pop()); this.queues.delete(name); }
      else if (this.waiting.has(name)) this.playInternal(this.waiting.get(name));
      else continue;
      this.waiting.delete(name);
    }
  }
}

// StoryPlayerCore: one episode played on a StoryContext.
//   opts.auto          auto mode (AdvPlayerModel._isAutoPlay; LocalDataHandler.Setup restores the saved value, false
//                      in a fresh profile)
//   opts.speed         AdvPlaybackSpeed (10, 15, 17, 20; the saved value, Normal in a fresh profile)
//   opts.shortCutIndex the Index of the row to start at (-1: from the beginning): AdvPlayerModel.SetShortCutIndex
//   opts.onCommand(c, index)  before a row executes;  opts.onLine({index, speaker, text})  when a Talk line shows
//   opts.onLog({row, speaker, text, voiceIds})  a talk log entry (AdvTalkHelper.AddLogEntry: Talk, Location, Subtitles,
//                      chat rows; also while shortcutting)
//   opts.onError(e)    a command that runs on after its row (IsNoWait, fire-and-forget) failed
//   opts.onSpeed(rate) the playback speed rate changed (ReapplyPlaybackSpeed)
export class StoryPlayerCore {
  constructor(ctx, { auto = false, speed = 10, shortCutIndex = -1, onCommand = null, onLine = null, onLog = null,
                     onError = null, onSpeed = null } = {}) {
    this.ctx = ctx;
    this.episode = ctx.episode;
    this.playbackSpeed = speed;
    this.autoPlay = !!auto;             // AdvPlayerModel._isAutoPlay (saved preference; off in a fresh profile)
    this.autoEnabledByPlayer = !!auto;  // AdvPlayerModel.IsAutoEnabledByPlayer
    this.forcedAutoPlay = false;        // AdvPlayerModel.ForcedAutoPlay (ForceAuto command)
    this.isPause = false;               // AdvPlayerModel.IsPause (dialogs, the talk log, video pause): the loop waits
    this.nextStep = NEXT_STEP.Idle;
    this.shortCutIndex = shortCutIndex;
    this.shortCutActivated = false;
    this.coverBlack = false;            // TransitionManager.FadeOutBlackImmediate while a shortcut runs
    this.subtitlesEnabled = true;       // the subtitle option (AdvLocalDataHandler): video subtitles shown
    this.currentEpisodeListIndex = -1;  // AdvPlayerModel.CurrentEpisodeListIndex: the list position PlayCommands runs
    this.onCommand = onCommand; this.onLine = onLine; this.onLog = onLog; this.onError = onError; this.onSpeed = onSpeed;
    this.session = {                    // AdvPlaybackSession
      focusCameraPosition: { x: 0, y: 0, z: 0 }, focusZoomRatio: 1, focusCameraDistance: 0,
      panV2Base: { x: 0, y: 0, z: 0 }, panV2Offset: { x: 0, y: 0 },
      stage: null, focusDataSettings: null,
      targetNameToPosition: new Map(), positionToCharacter: new Map(), placedPositions: [],
      sePlayIds: [], voicePlayIds: [], bgmPlayId: -1, bgmOriginId: 0, skippedBgmEpisode: null,
      activeVoiceLipSync: new Map(), withVoice: true, eyeBlinkStoppedTargetNames: new Set(),
      motionSyncVoices: new Map(),                                     // character -> the voice set on its MotionSync
      delayTokens: new AdvCommandDelayTokens(ctx.loop),
    };
    this.motions = new AdvMotionController(this);
    this.autoAdvCancel = null;          // the Cancel of the session's auto-advance token (null: none; talk.js
                                        // createAutoAdvCancellation / clearAutoAdvCancellation)
    this.lineIndex = -1;                // Talk lines shown so far - 1
    this.cancelled = false;             // Session.CTS cancelled (Stop / Skip)
    this.finished = false;
    this.stopReason = null;
  }

  // ------------------------------------------------------------------------------------------------ helpers
  speedRate() { return Math.fround(this.playbackSpeed / 10); }           // GetCurrentSpeedRate: (float)speed / 10
  get shortcut() { return this.shortCutIndex >= 0; }                    // ShouldShortCut
  get isAutoPlay() { return this.forcedAutoPlay || this.autoPlay; }     // IsAutoPlay
  get isOverlay() { return this.ctx.playbackMode === ADV_PLAYBACK_MODE.Overlay; }

  // AdvPlayerModel.CalcDuration
  calcDuration(duration, def = 0) {
    if (this.shortcut) return 0;
    const d = duration ? Math.max(duration, 0) : def;
    return d / this.speedRate();
  }

  delay(sec) { return this.session.delayTokens.delay(sec); }             // Session.DelayTokens.Delay

  // AdvPlayerModel.SetCurrentEpisodeListIndex (GoTo and the choices jump through it)
  setCurrentEpisodeListIndex(i) { this.currentEpisodeListIndex = i; }

  ease(s, def = EASE.OutQuad) { const e = tryGetEase(s); return e === null ? def : e; }

  // IsNoWait: Inner(...).Forget() and the row returns at once
  noWait(c, task) { if (c.IsNoWait) { task.catch((e) => this.fail(e)); return Promise.resolve(); } return task; }

  // a failure of a forgotten task (the game logs it; here it stops the playback)
  fail(e) { if (this.onError) this.onError(e); else console.error(e); }

  focusDataSettings(key) {
    const e = this.ctx.settings.player._focusDataSettingsMap._list.find((x) => x.Key === key);
    return e ? e.Value : null;
  }

  defaultFocusDataSettings() { return this.focusDataSettings(this.ctx.settings.player._defaultFocusDataSettingsKey); }

  // AdvCommandService.ExecuteCommand
  execute(c) {
    const fn = commandHandler(c.cmd);
    if (!fn) throw new StoryCommandError(`command ${c.cmd} (#${c.i}) is not supported by this player`);
    if (this.onCommand) this.onCommand(c);
    return fn(c, this);
  }

  // the commands of every row the episode can execute (story rows without IgnoreData, initialize / finalize rows)
  static requiredCommands(episode, settings) {
    const rows = [...settings._initializeEpisodes.map((r, i) => advRow(r, `init${i}`)),
                  ...episode.commands.filter((c) => !c.IgnoreData),
                  ...settings._finalizeEpisodes.map((r, i) => advRow(r, `fin${i}`))];
    return [...new Set(["TalkWindow", ...rows.map((c) => c.cmd)])];
  }

  static checkEpisode(episode, settings, what) {
    checkEpisodeCommands(StoryPlayerCore.requiredCommands(episode, settings), what);
  }

  static supportedCommands() { return registeredCommands(); }

  // the Talk command's voice helpers (AdvTalkVoicePlaybackHelper), for the commands that route voices
  startVoiceLipSync(ch, info, ignore) { startVoiceLipSync(this, ch, info, ignore); }
  stopVoiceLipSync(ch, info) { stopVoiceLipSync(this, ch, info); }
  playTalkMappedVoices(c, names, talkLength, sounds) { playTalkMappedVoices(this, c, names, talkLength, sounds); }

  // ------------------------------------------------------------------------------------------------ next step
  changeNextStepStateOnAutoPlay() { this.nextStep = this.isAutoPlay ? NEXT_STEP.GoNext : NEXT_STEP.AllowNext; }

  // UniTask.WaitUntil(() => IsNextStepGoNext) at PlayerLoopTiming.Update
  // UniTask.WaitUntil(IsNextStepGoNext, PlayerLoopTiming.Update, playback token): the predicate is first checked at the
  // next Update tick, also when it already holds
  async waitUntilGoNext() {
    do await this.ctx.loop.yield("Update"); while (this.nextStep !== NEXT_STEP.GoNext && !this.cancelled);
  }

  // AdvPlayerUIEventHandler.OnNextButtonTapped: a tap on a playing video shows its controls instead
  // (TryShowVideoControl); ignored under ForceAuto; aborts a running auto-advance wait; a line waiting for the player
  // advances
  tap() {
    if (tryShowVideoControl(this)) return;
    if (this.forcedAutoPlay) return;
    if (this.autoAdvCancel) this.autoAdvCancel();
    if (this.nextStep === NEXT_STEP.AllowNext) this.nextStep = NEXT_STEP.GoNext;
  }

  // AdvLocalDataHandler.SetAutoState -> UpdateAutoPlayState: the model's flag, the talk window's auto icon, and
  // SyncNextStepStateToAutoPlay (a line waiting for a tap advances when auto turns on; an auto line waits for a tap
  // when it turns off)
  setAuto(on) {
    this.autoPlay = !!on;
    this.ctx.ui.setAutoMode(this.isAutoPlay);
    if (this.isAutoPlay) { if (this.nextStep === NEXT_STEP.AllowNext) this.nextStep = NEXT_STEP.GoNext; }
    else if (this.nextStep === NEXT_STEP.GoNext) this.nextStep = NEXT_STEP.AllowNext;
  }

  // AdvPlayerUIEventHandler.OnAutoButtonTapped: SwitchAutoState, the player's choice remembered
  // (SetAutoEnabledByPlayerState); auto off at a speed other than Normal resets the speed to Normal and stops the
  // current voices (the auto-advance token kept) and the showing characters' lip sync
  pressAuto(on = !this.autoPlay) {
    if (!!on === this.autoPlay) return;
    this.setAuto(on);
    this.autoEnabledByPlayer = this.isAutoPlay;
    if (this.isAutoPlay || this.playbackSpeed === 10) return;
    this._applySpeed(10);
    if (this.session.voicePlayIds.length) this._stopVoices(true);
  }

  // AdvPlayerUIEventHandler.OnFastForwardButtonTapped (ChangeNextPlaybackSpeed: 10 -> 15 -> 17 -> 20 -> 10), or a
  // given speed: a speed other than Normal turns auto on, Normal brings the player's own auto choice back; the current
  // voices (and the auto-advance token) and the showing characters' lip sync stop
  pressFastForward(speed = FAST_FORWARD_NEXT[this.playbackSpeed]) {
    this._applySpeed(speed);
    this.setAuto(speed === 10 ? !!this.autoEnabledByPlayer : true);
    this._stopVoices(false);
  }

  // AdvLocalDataHandler.UpdatePlaybackSpeed: the model's speed, the talk window's fast icon, ReapplyPlaybackSpeed
  // (the characters' motion and pseudo lip sync speed, UIAdvWidget.SetPlaybackSpeed, the current stage's particle
  // groups, and through `onSpeed` the feature modules' still sequences, particle effects and video)
  _applySpeed(speed) {
    this.playbackSpeed = speed;
    const rate = this.speedRate(), ui = this.ctx.ui;
    ui.setFastIconActive(speed !== 10);
    for (const ch of this.ctx.characters.values()) {
      if (ch.setMotionSpeed) ch.setMotionSpeed(rate);
      if (ch.setPseudoLipSyncSpeed) ch.setPseudoLipSyncSpeed(rate);
    }
    ui.setPlaybackSpeed(rate);
    if (this.session.stage) this.session.stage.setPlaybackSpeed(rate);
    if (this.onSpeed) this.onSpeed(rate);
  }

  // AdvSoundHelper.StopCurrentVoices(preserveAutoAdvToken) and the lip sync of the showing characters (mouths closed)
  _stopVoices(preserveAutoAdvToken) {
    stopCurrentVoices(this, preserveAutoAdvToken);
    stopLipSyncForShowingCharacters(this);
  }

  // ------------------------------------------------------------------------------------------------ playback
  // AdvPlayer.Play: PreparePlayTask, StartPlayTask, PlayCommands, Stop(0). Resolves when the episode ends or stops.
  async play() {
    const ctx = this.ctx, s = this.session, P = ctx.settings.player;
    s.focusDataSettings = this.defaultFocusDataSettings();              // AdvPlayer.Init
    s.focusCameraDistance = 0;
    ctx.volume.stopAlwaysUpdate();                                     // GlobalVolume.StopAlwaysVolumeUpdate
    // PreparePlayTask
    ctx.audio.stopAll(SOUND_CATEGORY.Voice, false, 0.3);
    ctx.ui.setAutoMode(this.isAutoPlay);                               // LocalDataHandler.Setup
    if (this.playbackSpeed !== 10) this._applySpeed(this.playbackSpeed);
    s.bgmOriginId = 0;                                                 // no BGM plays before the episode here
    if (this.shortcut) {
      const first = this.episode.commands.findIndex((c) => c.i === this.shortCutIndex && !c.IgnoreData);
      if (first <= 0) {
        if (first < 0) console.warn(`shortcut index ${this.shortCutIndex} not found`);
        this.shortCutIndex = -1;                                       // ResetShortCutIndex
      } else {
        this.shortCutActivated = true;
        this.coverBlack = true;                                        // TransitionManager.FadeOutBlackImmediate
      }
    }
    // StartPlayTask
    await ctx.ui.fadeInLetterBox();
    if (this.cancelled) return this._stop(this.stopReason);
    this._observeCharacterMotions();
    if (ctx.titleTextId) ctx.ui.showTitle(ctx.localize(ctx.titleTextId)).catch((e) => this.fail(e));   // ShowTitle
    this.execute({ i: -1, cmd: "TalkWindow", TargetName: "UIDefaultTalkWindow" });   // PlayInitialCommands
    // PlayCommands
    for (const [i, r] of P._initializeEpisodes.entries()) await this.execute(advRow(r, `init${i}`));
    const rows = this.episode.commands;
    this.setCurrentEpisodeListIndex(0);
    while (this.currentEpisodeListIndex < rows.length) {
      if (this.cancelled) return this._stop(this.stopReason);          // Stop / Skip: the finalize rows are not played
      const li = this.currentEpisodeListIndex, c = rows[li];
      if (c.IgnoreData) { this.setCurrentEpisodeListIndex(li + 1); continue; }
      if (this.shortcut && c.i === this.shortCutIndex) await this._reachShortcut();
      await this.execute(c);
      if (this.shortcut) this._accumulateSkippedWait(c);
      if (this.currentEpisodeListIndex === li) this.setCurrentEpisodeListIndex(li + 1);   // unless the row jumped
      if (this.isPause) await this._waitWhilePause();
    }
    if (this.cancelled) return this._stop(this.stopReason);
    for (const [i, r] of P._finalizeEpisodes.entries()) await this.execute(advRow(r, `fin${i}`));
    this.finished = true;
    return this._stop(0);
  }

  // AdvMotionController.ObserveCharacterMotions (Forget): OnUpdateCharacterMotions now, then after each
  // UniTask.Yield(Update), until the playback token is cancelled
  async _observeCharacterMotions() {
    const loop = this.ctx.loop;
    while (!this.cancelled && this.stopReason === null) {
      this.motions.update(loop.deltaTime);
      await loop.yield("Update");
    }
  }

  // PlayCommands at the shortcut target: PlayLastQueueMotions, ResetShortCutIndex, PlaySkippedBgmAsync,
  // SnapVideoTimelineToCurrentPosition(IsPause), a 0.2 s delay, TransitionManager.FadeInImmediate
  async _reachShortcut() {
    this.motions.playLastQueueMotions();
    this.shortCutIndex = -1;
    await this._playSkippedBgm();
    const video = storyVideo(this.ctx);
    if (video) video.snapTimeline(this.isPause);
    await this.ctx.loop.delay(0.2);
    this.coverBlack = false;
  }

  // AdvPlayer.PlaySkippedBgmAsync: the last Bgm row passed while shortcutting plays now
  async _playSkippedBgm() {
    const s = this.session, c = s.skippedBgmEpisode;
    s.skippedBgmEpisode = null;
    if (c) await this.execute(c);
  }

  // AdvPlayer.AccumulateShortCutSkippedWait
  _accumulateSkippedWait(c) {
    if (UNBOUNDED_WAIT.has(c.cmd)) this.motions.markSkippedSecondsUnbounded();
    else if (!c.IsNoWait) this.motions.advanceSkippedSeconds(StoryPlayerCore.blockingSeconds(c));
  }

  // AdvPlayer.GetBlockingSeconds
  static blockingSeconds(c) {
    const d = c.Duration || 0, delay = Math.max(c.DelaySeconds || 0, 0);
    if (BLOCKING_DURATION.has(c.cmd)) return d;
    if (BLOCKING_DELAY_DURATION.has(c.cmd)) return delay + d;
    if (c.cmd === "Flash") return d || 0.3;
    if (c.cmd === "Still") return Math.max(floatParam(c.Parameter1), 0);
    return 0;
  }

  async _waitWhilePause() {
    while (this.isPause && !this.cancelled) await this.ctx.loop.yield("Update");
  }

  // AdvPlayer.Skip / Stop: cancels the playback (the running command's waits end, the finalize rows are not played)
  stop(reason = 1) {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.stopReason = reason;
    this.session.delayTokens.cancel(false);
    clearAutoAdvCancellation(this);
  }

  // AdvPlayer.Stop: the sounds the episode started stop (BGM, voices, SE: 0.3 s)
  _stop(reason) {
    const a = this.ctx.audio, s = this.session;
    a.stopAll(SOUND_CATEGORY.Bgm, false, 0.3);
    a.stopAll(SOUND_CATEGORY.Voice, false, 0.3);
    for (const id of s.sePlayIds) a.stop(id, false, 0.3);
    this.stopReason = reason;
    return reason;
  }
}
