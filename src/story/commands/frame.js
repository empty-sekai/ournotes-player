import { StoryCommandError } from "../interfaces.js";
import { floatParam } from "../params.js";
import { frameView } from "../features/frame.js";

// Frame (AdvFrameCommand.Execute / SetFrame): fade = CalcDuration(Parameter1), or CalcDuration(Duration) when that is
// <= 0; UIAdvWidget.SetFrame(frame) runs before the optional DelaySeconds (Session.DelayTokens: CancelDelay or Stop end
// the row there); then Animator.speed = the playback rate and either the toggle (empty Parameter2: ShowFrame when
// hidden, HideFrame when showing) or the named state, after the frame's text receiver got the localized TargetTextIDs.
// No playback-mode or quality check. A TargetAssetName that is not loaded fails the row (the game dereferences null).
export const Frame = (c, p) => p.noWait(c, (async () => {
  let fade = p.calcDuration(floatParam(c.Parameter1), 0);
  if (fade <= 0) fade = p.calcDuration(c.Duration || 0, 0);
  const view = frameView(p.ctx), frame = view.loaded(c.TargetAssetName);
  view.setFrame(frame);
  if (!frame) throw new StoryCommandError(`Frame: ${c.TargetAssetName ?? ""} is not loaded`);
  if ((c.DelaySeconds || 0) > 0 && !await p.delay(p.calcDuration(c.DelaySeconds, 0))) return;
  frame.speedRate = p.speedRate();
  const stop = () => p.cancelled;
  const state = c.Parameter2 ?? "";
  if (state === "") {
    await (frame.isShowing ? frame.hide(fade, stop) : frame.show(fade, stop));
    return;
  }
  // SetFrameTexts: the texts of TargetTextIDs (an invalid id: empty) to an IAdvFrameTextReceiver
  const ids = c.TargetTextIDs || [];
  if (frame.receiver) frame.receiver.setTexts(state, ids.map((id) => (id && id !== "0" ? p.ctx.localize(id) : "")));
  else if (ids.length) console.warn(`Frame: ${c.TargetAssetName} has text ids but no text receiver`);
  await frame.play(state, stop);
})());
