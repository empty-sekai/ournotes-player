import { SOUND_CATEGORY, SOUND_CATEGORY_NAME } from "../../engine/audio.js";
import { floatParam } from "../params.js";
import { delayUntilVideoTimeline, storyVideo, videoTimelineActive } from "../features/video.js";

// Small commands: Delay, Wait, CancelDelay, ForceAuto (script flow), SoundVolume (category volumes), Expression,
// Costume, EyeBlink, Pause, Resume (character state).

const F = Math.fround;
const GO_NEXT = 2;                              // AdvPlayerModel NextStepState.GoNext (player-core.js NEXT_STEP)

// String.Equals(a, b, StringComparison.OrdinalIgnoreCase) against an upper-case ASCII key
const equalsIgnoreCase = (s, KEY) => s.length === KEY.length && s.toUpperCase() === KEY;

// UniTask.WaitUntil(predicate, PlayerLoopTiming.Update, token) with the playback token: the predicate is first checked
// at the next Update tick, then once per tick; a Stop / Skip ends the wait (false)
const waitUntil = async (p, pred) => {
  do await p.ctx.loop.yield("Update"); while (!p.cancelled && !pred());
  return !p.cancelled;
};

// UniTask.Delay(TimeSpan.FromSeconds(sec), ignoreTimeScale false, PlayerLoopTiming.Update, token) with the playback
// token: PlayerLoop.delay, ended by a Stop / Skip at the next Update tick (false)
const playbackDelay = (p, sec) => {
  const loop = p.ctx.loop;
  let done = false;
  const delay = loop.delay(sec).then((ok) => { done = true; return ok; });
  const stop = (async () => { while (!done && !p.cancelled) await loop.yield("Update"); return false; })();
  return Promise.race([delay, stop]);
};

// AdvPlayerHelper.DelayWithPauseSpeedAdjustment(duration): counts the duration down by Time.deltaTime once per frame
// (float), holds while Model.IsPause and rescales the rest when the playback speed changes:
//   if (!(duration > 0)) return
//   remaining = duration; previous = GetCurrentSpeedRate()
//   loop: if (remaining <= 0) return
//         if (Flow.IsClipVideoSkip) return                     (a Clip video being skipped to its marker)
//         if (token cancelled) return
//         if (Model.IsPause) { await UniTask.WaitWhile(() => Model.IsPause, Update); continue }
//         (WaitWhileVideoSeekRespeedingAsync: no video seek re-speed runs in this player)
//         speed = GetCurrentSpeedRate(); if (speed != previous) { remaining *= previous / speed; previous = speed }
//         await UniTask.NextFrame(); remaining -= Time.deltaTime
// Resolves false when the playback stopped, or when `alive` (another token linked in) turns false.
export const delayWithPauseSpeedAdjustment = async (p, duration, alive = null) => {
  if (!(duration > 0)) return true;
  const loop = p.ctx.loop;
  let remaining = F(duration), previous = F(p.speedRate());
  for (;;) {
    if (remaining <= 0) return true;
    const video = storyVideo(p.ctx);
    if (video && video.flow.clipVideoSkip) return true;
    if (p.cancelled || (alive && !alive())) return false;
    if (p.isPause) {
      if (!await waitUntil(p, () => !p.isPause)) return false;
      continue;
    }
    const speed = F(p.speedRate());
    if (speed !== previous) { remaining = F(remaining * F(previous / speed)); previous = speed; }
    await loop.yield("Update");                                         // UniTask.NextFrame (Update)
    remaining = F(remaining - F(loop.deltaTime));
  }
};

// AdvDelayCommand (IsNoWait is not read): DelayWithPauseSpeedAdjustment(CalcDuration(Duration, 0)); nothing while
// shortcutting. While a video's timeline runs (and not shortcutting) the delay follows the video's frame clock: the
// timeline target moves on by Duration (not divided by the speed rate) and DelayUntilVideoTimelineAsync waits for it;
// when the video is lost, finishes or stalls first, the seconds still missing run as a plain delay.
const Delay = async (c, p) => {
  if (videoTimelineActive(p.ctx) && !p.shortcut) {
    storyVideo(p.ctx).timeline.advanceTarget(F(c.Duration || 0));
    const { completed, remaining } = await delayUntilVideoTimeline(p);
    if (completed) return;
    await delayWithPauseSpeedAdjustment(p, F(p.calcDuration(remaining, 0)));
    return;
  }
  await delayWithPauseSpeedAdjustment(p, F(p.calcDuration(c.Duration || 0, 0)));
};

// AdvWaitCommand (IsNoWait is not read): waits for the player's tap, or in auto mode lingers
// _waitCommandLingeringTimeOnAutoPlay (divided by the speed rate); nothing while shortcutting:
//   ChangeNextStepStateOnAutoPlay(); await UniTask.WaitUntil(() => IsNextStepGoNext, Update)
//   if (IsAutoPlay) await UniTask.Delay(AdvWaitCommandHelper.CalcAutoWaitDelay(), Update)
// A tap does not shorten the auto-mode linger (its token is the playback's, not the auto-advance one).
const Wait = (c, p) => (async () => {
  if (p.shortcut) return;
  p.changeNextStepStateOnAutoPlay();
  if (!await waitUntil(p, () => p.nextStep === GO_NEXT)) return;
  if (!p.isAutoPlay) return;
  await playbackDelay(p, F(p.calcDuration(p.ctx.settings.player._waitCommandLingeringTimeOnAutoPlay, 0)));
})();

// AdvCancelDelayCommand: AdvCommandDelayTokens.ClearCommonDelayCancellationToken (Cancel, Dispose, null): every
// pending Session.DelayTokens.Delay ends at the next Update tick and returns true (its command token is not
// cancelled), so the waiting commands go on at once. Delay and Wait rows do not use that token.
const CancelDelay = (c, p) => { p.session.delayTokens.cancel(); return Promise.resolve(); };

// AdvForceAutoCommand: AdvPlayerModel.SwitchForceAutoPlay (ForcedAutoPlay = !ForcedAutoPlay). While it is set
// IsAutoPlay is true whatever the player's own auto setting.
const ForceAuto = (c, p) => { p.forcedAutoPlay = !p.forcedAutoPlay; return Promise.resolve(); };

// AdvPlaybackSession._soundVolumeCancellationTokenSource per session: RefreshSoundVolumeCancellationToken cancels the
// previous source (a running SoundVolume fade) and creates a new one
const soundVolumeTokens = new WeakMap();
const refreshSoundVolumeToken = (s) => {
  const old = soundVolumeTokens.get(s);
  if (old) old.cancelled = true;
  const tok = { cancelled: false };
  soundVolumeTokens.set(s, tok);
  return tok;
};

// AdvSoundVolumeCommand.ChangeVolume (IsNoWait honoured): the volume of the category Parameter1 ("all" or empty: Bgm
// and Voice; "se": nothing) to Parameter2, linearly over CalcDuration(Duration, 0), one step per Update tick:
//   token = Session.RefreshSoundVolumeCancellationToken()           // stops a running fade where it is
//   if (category.ToLower() == "se") return
//   d = CalcDuration(Duration, 0)
//   if (d <= 0) { SoundManager.ChangeVolume(each, volume); return }
//   start = GetVolume(each); elapsed = 0
//   while (elapsed < d) { elapsed += Time.deltaTime; ChangeVolume(each, Mathf.Lerp(start, volume, elapsed / d))
//                         await UniTask.Yield(Update, linked(playback token, token)) }
//   ChangeVolume(each, volume)
// The first step runs in the command's own frame. A cancelled fade ends at its Yield without the final value.
// GetVolume returns the category's CRI volume (its DefaultVolume x the last ChangeVolume value) and ChangeVolume
// multiplies by DefaultVolume again, so a fade of Bgm (DefaultVolume 0.7) starts below the current volume (as in the
// game).
const changeVolume = async (c, p) => {
  const a = p.ctx.audio, loop = p.ctx.loop;
  const tok = refreshSoundVolumeToken(p.session);
  const category = c.Parameter1 ?? "";
  const lower = category.toLowerCase();                               // String.ToLower (ASCII keys)
  if (lower === "se") return;
  const volume = F(floatParam(c.Parameter2)), d = F(p.calcDuration(c.Duration || 0, 0));
  const names = lower === "all" || category === ""
    ? [SOUND_CATEGORY_NAME[SOUND_CATEGORY.Bgm], SOUND_CATEGORY_NAME[SOUND_CATEGORY.Voice]] : [category];
  if (d <= 0) { for (const n of names) a.changeVolume(n, volume); return; }
  const start = names.map((n) => F(a.getVolume(n)));
  let elapsed = 0;
  while (elapsed < d) {
    if (p.cancelled) return;                                          // token.ThrowIfCancellationRequested
    elapsed = F(elapsed + F(loop.deltaTime));
    const r = F(elapsed / d), t = r > 1 ? 1 : (r >= 0 ? r : 0);
    names.forEach((n, i) => a.changeVolume(n, F(start[i] + F(F(volume - start[i]) * t))));
    await loop.yield("Update");
    if (tok.cancelled || p.cancelled) return;
  }
  for (const n of names) a.changeVolume(n, volume);
};

const SoundVolume = (c, p) => p.noWait(c, changeVolume(c, p));

// AdvExpressionCommand: the TargetName's character plays ExpressionName (empty: its default expression) with the
// MotionFadeIn fade (0 while shortcutting); no character, nothing
const Expression = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (ch) {
    const fade = p.shortcut ? 0 : (c.MotionFadeIn || 0);
    if (!c.ExpressionName) ch.playDefaultExpression(fade); else ch.playExpression(c.ExpressionName, fade);
  }
  return Promise.resolve();
};

// AdvCostumeCommand: AdvEpisodeResourceLoader.SetCharacterAssetIndex(TargetName, TargetAssetIndex); the name's later
// commands use the model loaded under that index. The character already shown is left as it is.
const Costume = (c, p) => {
  p.ctx.characters.setAssetIndex(c.TargetName ?? "", c.TargetAssetIndex || 0);
  return Promise.resolve();
};

// AdvEyeBlinkCommand: Parameter1 "stop" / "resume" (any case), or empty to toggle the session's state for TargetName,
// stops or resumes the character's auto eye blink (0.2 s transition, 0 while shortcutting). The session keeps the
// state so that a later In applies it (AdvPlaybackSession.SetEyeBlinkStopped; an empty TargetName is not recorded).
// Any other Parameter1 logs a warning and does nothing.
const EyeBlink = (c, p) => {
  const name = c.TargetName ?? "", p1 = c.Parameter1 ?? "", stopped = p.session.eyeBlinkStoppedTargetNames;
  let stop;
  if (p1 === "") stop = !(name !== "" && stopped.has(name));         // !Session.IsEyeBlinkStopped(TargetName)
  else if (equalsIgnoreCase(p1, "STOP")) stop = true;
  else if (equalsIgnoreCase(p1, "RESUME")) stop = false;
  else {
    console.warn(`EyeBlink: invalid Parameter1 "${p1}" (TargetName "${name}")`);
    return Promise.resolve();
  }
  if (name !== "") { if (stop) stopped.add(name); else stopped.delete(name); }
  const ch = p.ctx.characters.get(name);
  if (ch) ch.setEyeBlinkStopped(stop, p.shortcut ? 0 : F(0.2));
  return Promise.resolve();
};

// AdvPauseCommand (synchronous): the TargetName's character pauses its animation (Live2DCharacterController.Pause);
// while shortcutting it is first put at its motion's state after the skipped seconds
// (Live2DCharacter.ApplyStateAtMotionTime(AdvMotionController.GetSkippedSeconds(TargetName)))
const Pause = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (ch) {
    if (p.shortcut) ch.applyStateAtMotionTime(p.motions.skippedSeconds(c.TargetName));
    ch.pause();
  }
  return Promise.resolve();
};

// AdvResumeCommand (synchronous): Live2DCharacterController.Resume
const Resume = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (ch) ch.resume();
  return Promise.resolve();
};

export const MISC_COMMANDS = { Delay, Wait, CancelDelay, ForceAuto, SoundVolume, Expression, Costume, EyeBlink, Pause,
                               Resume };
