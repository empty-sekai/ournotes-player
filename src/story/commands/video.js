import { F } from "../../engine/core.js";
import { StoryCommandError } from "../interfaces.js";
import { floatParam } from "../params.js";
import { DTCancelled } from "../features/dotween-core.js";
import { delayWithSpeedAdjustment, waitUntil } from "../features/timing.js";
import { storyVideo } from "../features/video.js";
import { stopCurrentVoices } from "./talk.js";

// Movie (AdvMovieCommand) and Clip (AdvClipCommand) with AdvVideoCommandHelper. Both are always awaited (IsNoWait,
// DelaySeconds and Duration are not read) and take the loader's current prepared video (Session.CurrentVideoInfo).

const NEXT_IDLE = 0;

// the story UI calls of the video paths (UIAdvWidget: talk, front next indicator, subtitles, menu buttons)
export const videoUI = (ctx, name, ...args) => {
  const f = ctx.ui[name];
  if (typeof f !== "function") throw new StoryCommandError(`the story UI has no ${name}`);
  return f.apply(ctx.ui, args);
};

const linger = (p) => {
  const t = p.ctx.settings.player._waitVideoLingeringTimeOnAutoPlay;
  if (typeof t !== "number") throw new StoryCommandError("player settings: _waitVideoLingeringTimeOnAutoPlay missing");
  return F(t / p.speedRate());
};

// AdvVideoCommandHelper.ResetVideoPlaybackState: the flow flags cleared, then RestoreVideoPlaybackUI
export const resetVideoPlaybackState = (p) => {
  const v = storyVideo(p.ctx);
  Object.assign(v.flow, { clipVideoPlaying: false, clipVideoSkip: false, clipControlAvailable: false, movieVideoPlaying: false });
  restoreVideoPlaybackUI(p);
};

// RestoreVideoPlaybackUI: auto button shown, pause-video button back to normal, video buttons hidden
const restoreVideoPlaybackUI = (p) => {
  videoUI(p.ctx, "showAutoButton");
  videoUI(p.ctx, "resetPauseVideoButton");
  videoUI(p.ctx, "hideVideoButtons");
};

// AdvCommandCompletionHandler.OnPlayVideoFinished (a clip's end)
const onPlayVideoFinished = (p) => {
  if (p.isAutoPlay) { p.changeNextStepStateOnAutoPlay(); return; }
  if (p.nextStep === NEXT_IDLE) p.changeNextStepStateOnAutoPlay();
  if (!videoUI(p.ctx, "isShowingTalk")) videoUI(p.ctx, "showNextIndicator");
};

// AdvVideoCommandHelper.StopVideo(duration): runs synchronously up to the fade when the duration is 0
export const stopVideo = async (p, duration, cancelled) => {
  const v = storyVideo(p.ctx);
  videoUI(p.ctx, "clearSubtitles");
  v.timeline.end();
  if (!v.hasCurrentVideoInfo) return;
  stopCurrentVoices(p, false);
  videoUI(p.ctx, "hideTalk");
  videoUI(p.ctx, "hideNextIndicator");
  v.current.onPlayFinished = [];                      // UnregisterPlayFinishedFunction
  Object.assign(v.flow, { clipVideoPlaying: false, clipVideoSkip: false, clipControlAvailable: false, movieVideoPlaying: false });
  videoUI(p.ctx, "hideVideoButtons");
  if (duration > 0) await v.view.hide(duration, cancelled); else v.view.hideInternal();
  if (v.current) v.current.stop();                    // VideoManager.Stop
  if (!(v.flow.clipVideoPlaying || v.flow.movieVideoPlaying)) restoreVideoPlaybackUI(p);
  v.prepareNext();
};

// Mathf.Approximately
const approximately = (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1.1210387714598537e-44);

// AdvVideoCommandHelper.PrepareAudioVideoForSpeedAsync: Prepared 0, Aborted 1, Invalidated 2. At a speed other than 1
// an audio video is stopped and prepared again at that speed (CRI applies a speed to such a movie on prepare).
const prepareAudioVideoForSpeed = async (p, video, speed) => {
  const uid = video.uniqueVideoId, invalidated = () => !video.source || video.uniqueVideoId !== uid;
  if (approximately(1, speed)) return 0;
  video.stop();
  if (!await waitUntil(p, () => video.isStopComplete() || invalidated())) return 2;
  if (invalidated()) return 2;
  video.changePlaybackSpeed(speed);
  video.prepare();
  if (!await waitUntil(p, () => video.isReady() || invalidated())) return 2;
  return invalidated() ? 2 : video.isReady() ? 0 : 1;
};

const forget = (promise) => promise.catch((e) => { if (!(e instanceof DTCancelled)) throw e; });
const guarded = (fn) => (c, p) => fn(c, p).catch((e) => { if (!(e instanceof DTCancelled)) throw e; });

// AdvMovieCommand.PlayMovie: the script waits until the video has ended and faded out (Parameter2); alpha Parameter3,
// fade-in Parameter1. While shortcutting the video is stopped and the next one prepared, nothing is shown.
const playMovie = async (c, p, v, cancelled) => {
  videoUI(p.ctx, "hideTalk");
  const video = v.current;
  if (!video) throw new StoryCommandError(`Movie #${c.i}: no prepared video`);
  if (p.shortcut) { video.stop(); v.prepareNext(); return; }
  const p3 = floatParam(c.Parameter3), alpha = p3 <= 0 ? 1 : Math.min(p3, 1);
  forget(v.view.show(video, alpha, p.calcDuration(floatParam(c.Parameter1), 0), cancelled));
  Object.assign(v.flow, { clipVideoPlaying: false, clipVideoSkip: false, clipControlAvailable: false, movieVideoPlaying: true });
  videoUI(p.ctx, "hideAutoButton");
  videoUI(p.ctx, "showFastForwardButton");
  let aborted = false;
  if (video.hasAudio) {
    const r = await prepareAudioVideoForSpeed(p, video, p.speedRate());
    if (r === 2) return;
    if (r === 1) aborted = true; else video.play();
  } else video.play(p.speedRate());
  if (!aborted) {
    if (!await waitUntil(p, () => video.isPlaying())) return;
    if (!await waitUntil(p, () => !video.isPlaying())) return;          // WaitWhile(IsPlaying || respeeding)
  }
  const out = p.calcDuration(floatParam(c.Parameter2), 0);
  if (out > 0) await v.view.hide(out, cancelled); else v.view.hideInternal();
  videoUI(p.ctx, "showFastForwardButton");
  resetVideoPlaybackState(p);
  videoUI(p.ctx, "clearSubtitles");
  v.prepareNext();
};

// Movie: a video on screen (a clip, or an ended video not yet stopped) is replaced at once, after the auto lingering
export const Movie = guarded(async (c, p) => {
  if (!((c.VideoID || 0) > 0)) return;
  const v = storyVideo(p.ctx), cancelled = () => p.cancelled;
  if (v.videoPlaying) {
    if (p.isAutoPlay && !await delayWithSpeedAdjustment(p, linger(p))) return;
    forget(stopVideo(p, 0, cancelled));
  }
  await playMovie(c, p, v, cancelled);
});

// AdvClipCommand.PlayClip: waits for the prepared video, shows it and returns once it plays; the video timeline starts
// (Delay rows follow the video's frames) and the clip's end runs OnPlayVideoFinished and the playback-state reset
const playClip = async (c, p, v, alpha, fade, cancelled) => {
  if (!v.hasCurrentVideoInfo && !await waitUntil(p, () => v.hasCurrentVideoInfo)) return;
  const video = v.current;
  video.changePlaybackSpeed(p.speedRate());
  forget(v.view.show(video, alpha, fade, cancelled));
  videoUI(p.ctx, "hideVideoButtons");
  videoUI(p.ctx, "hideAutoButton");
  v.flow.clipVideoPlaying = true;
  v.flow.clipControlAvailable = (c.Parameter3 ?? "").trim().toLowerCase() !== "hideclipcontrol";
  videoUI(p.ctx, "showFastForwardButton");
  if (video.hasAudio) {
    if (await prepareAudioVideoForSpeed(p, video, p.speedRate()) !== 0) return;
    video.play();
  } else video.play(p.speedRate());
  v.timeline.begin(video.uniqueVideoId, video.displayedFrameNo());
  video.onPlayFinished.push(() => onPlayVideoFinished(p));
  video.onPlayFinished.push(() => { resetVideoPlaybackState(p); videoUI(p.ctx, "showFastForwardButton"); });
  videoUI(p.ctx, "hideTalk");
  videoUI(p.ctx, "clearSubtitles");
};

// Clip: with a VideoID a new clip (a clip on screen fades out first over the same fade); without one the stop marker
// (fade-out Parameter1; "SkipClipTarget" in Parameter3 ends a skip to this row). Parameter2 alpha, Parameter3
// "HideClipControl": taps reach the script instead of showing the video buttons.
export const Clip = guarded(async (c, p) => {
  const v = storyVideo(p.ctx), cancelled = () => p.cancelled;
  const fade = p.calcDuration(floatParam(c.Parameter1), 0);
  if (!((c.VideoID || 0) > 0)) {
    if ((c.Parameter3 ?? "").trim().toLowerCase() === "skipcliptarget") v.flow.clipVideoSkip = false;
    if (p.isAutoPlay && !await delayWithSpeedAdjustment(p, linger(p))) return;
    await stopVideo(p, fade, cancelled);
    videoUI(p.ctx, "showFastForwardButton");
    videoUI(p.ctx, "hideVideoButtons");
    v.flow.clipControlAvailable = false;
    return;
  }
  if (v.videoPlaying) {
    if (p.isAutoPlay && !await delayWithSpeedAdjustment(p, linger(p))) return;
    await stopVideo(p, fade, cancelled);
  }
  const p2 = floatParam(c.Parameter2), alpha = p2 <= 0 ? 1 : Math.min(p2, 1);
  await playClip(c, p, v, alpha, fade, cancelled);
});
