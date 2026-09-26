import { SOUND_CATEGORY } from "../../engine/audio.js";
import { floatParam } from "../params.js";

// Sound commands: Bgm and Se (Fwk SoundManager through engine/audio.js). Neither blocks the script.

// AdvSoundHelper.ScheduleSoundAutoStop: with a Duration the sound stops after it (fade-out Parameter), if still playing
const scheduleAutoStop = (p, id, duration, fadeOut, unscaled, onStop) => {
  const d = unscaled ? duration : p.calcDuration(duration, 0);
  if (d <= 0) return;
  p.ctx.loop.delay(d).then((ok) => {
    const a = p.ctx.audio;
    if (!ok || !a.isPlaying(id)) return;
    a.stop(id, true, unscaled ? fadeOut : p.calcDuration(fadeOut, 0));
    if (onStop) onStop();
  });
};

// AdvBgmCommand: BgmID < 1 stops every BGM (fade Parameter1); else plays BgmID looped with an automatic crossfade of
// Parameter1 s from Parameter2 s. While shortcutting the row is kept for PlaySkippedBgmAsync instead.
export const Bgm = (c, p) => {
  const a = p.ctx.audio, s = p.session;
  const p1 = floatParam(c.Parameter1);
  if (!(c.BgmID >= 1)) {
    a.stopAll(SOUND_CATEGORY.Bgm, true, p1);
    s.skippedBgmEpisode = null;                                        // Session.ClearSkippedBgmEpisode
    a.lastBgmOrSeFrame = p.ctx.loop.frameCount; s.bgmPlayId = -1;
    return Promise.resolve();
  }
  if (p.shortcut) { s.skippedBgmEpisode = c; return Promise.resolve(); }
  const id = a.play(c.BgmID, { isAutoCrossFade: true, crossFade: p1, startSec: floatParam(c.Parameter2), loop: true });
  s.bgmPlayId = id; a.lastBgmOrSeFrame = p.ctx.loop.frameCount;
  scheduleAutoStop(p, id, c.Duration || 0, floatParam(c.Parameter3), true, () => { s.bgmPlayId = -1; });
  return Promise.resolve();
};

// AdvSeCommand (fire-and-forget): after DelaySeconds, Parameter1 "stop" stops the episode's SEs (all, or those of
// SeID; fade Parameter2); else plays SeID (fade-in Parameter3) with an optional auto stop after Duration. Nothing
// while shortcutting.
export const Se = (c, p) => {
  (async () => {
    if (p.shortcut) return;
    if (!await p.delay(p.calcDuration(c.DelaySeconds || 0, 0))) return;
    const a = p.ctx.audio, s = p.session;
    if ((c.Parameter1 ?? "").toLowerCase() === "stop") {
      const fade = floatParam(c.Parameter2);
      for (const pid of [...s.sePlayIds]) {
        const info = a.get(pid);
        if (c.SeID > 0 && (!info || info.soundId !== c.SeID)) continue;
        a.stop(pid, true, fade);
      }
      a.lastBgmOrSeFrame = p.ctx.loop.frameCount;
    } else if (c.SeID > 0) {
      const fadeIn = floatParam(c.Parameter3);
      const id = a.play(c.SeID, { crossFade: fadeIn, forceFadeIn: fadeIn > 0 });
      a.lastBgmOrSeFrame = p.ctx.loop.frameCount; s.sePlayIds.push(id);
      scheduleAutoStop(p, id, c.Duration || 0, floatParam(c.Parameter2), false, null);
    }
  })().catch((e) => p.fail(e));
  return Promise.resolve();
};
