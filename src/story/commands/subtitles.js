import { F } from "../../engine/core.js";
import { StoryCommandError } from "../interfaces.js";
import { removeTagsWithRuby } from "../ui-talk.js";
import { delayWithPauseSpeedAdjustment } from "./misc.js";
import { speakerName, stopCurrentVoices, tryPlayVoice, waitAutoPlayText } from "./talk.js";
import { videoUI } from "./video.js";
import { addLogEntry } from "../features/talklog.js";
import { waitUntil } from "../features/timing.js";
import { storyVideo } from "../features/video.js";

const NEXT_ALLOW = 1, NEXT_GO = 2;

// AdvSoundHelper.PlayEpisodeVoices: the row's voices, without lip sync
const playEpisodeVoices = (c, p) => { for (const id of c.VoiceIDs || []) tryPlayVoice(p, id, [], null); };

// Subtitles (AdvSubtitlesCommand.Execute): always awaited, IsNoWait only skips the waits. A valid AdvTextID shows the
// localized caption (hidden, only stored, while subtitles are off; a backlog entry also while shortcutting); an invalid
// one clears the caption and the front next indicator. The row's voices replace the current ones. Without a playing
// video the row waits like a talk line (next indicator, auto timing by the text length, the tap); over a playing clip
// it waits for a tap or the clip's end, then (still playing) a second tap, and in auto mode 0.1 s / speed more. The
// row's voices stop when its wait ends.
export const Subtitles = (c, p) => (async () => {
  const ctx = p.ctx, v = storyVideo(ctx);
  const valid = !!c.AdvTextID && c.AdvTextID !== "0";
  let text = "";
  if (valid) {
    const speaker = speakerName(c, p);
    text = ctx.localize(c.AdvTextID);
    addLogEntry(p, c, text, speaker, c.VoiceIDs);
  }
  if (p.shortcut) return;
  if (!valid) { videoUI(ctx, "clearSubtitles"); videoUI(ctx, "hideNextIndicator"); return; }
  if ((c.VoiceIDs || []).length && p.session.withVoice) { stopCurrentVoices(p, false); playEpisodeVoices(c, p); }
  if (p.subtitlesEnabled === false) videoUI(ctx, "updateHiddenSubtitles", text);
  else videoUI(ctx, "showSubtitles", text);
  if (!c.IsNoWait) {
    const playing = () => !!v && v.videoPlayingOrSeekRespeeding;
    if (!playing()) {
      videoUI(ctx, "showNextIndicator");
      p.changeNextStepStateOnAutoPlay();
      if (p.isAutoPlay) await waitAutoPlayText(p, [], null, removeTagsWithRuby(text, false).length);
      if (!await waitUntil(p, () => p.nextStep === NEXT_GO)) return;
      videoUI(ctx, "hideNextIndicator");
    } else {
      p.nextStep = NEXT_ALLOW;
      if (!await waitUntil(p, () => p.nextStep === NEXT_GO || videoUI(ctx, "isShowingNextIndicator"))) return;
      if (playing()) { p.nextStep = NEXT_ALLOW; videoUI(ctx, "showNextIndicator"); }
      else { p.changeNextStepStateOnAutoPlay(); if (!p.isAutoPlay) videoUI(ctx, "showNextIndicator"); }
      if (!await waitUntil(p, () => p.nextStep === NEXT_GO)) return;
      if (p.isAutoPlay) {
        const t = ctx.settings.player._waitSubtitlesLingeringTimeOnAutoPlay;
        if (typeof t !== "number") throw new StoryCommandError("player settings: _waitSubtitlesLingeringTimeOnAutoPlay missing");
        if (!await delayWithPauseSpeedAdjustment(p, F(t / p.speedRate()))) return;
      }
    }
    stopCurrentVoices(p, false);
  }
  p.nextStep = 0;                                                     // ChangeIdleState
})();
