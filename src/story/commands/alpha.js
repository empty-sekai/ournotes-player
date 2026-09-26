import { floatParam } from "../params.js";
import { DTCancelled } from "../features/dotween-core.js";
import { featureState } from "../features/state.js";

const LAYER_VIDEO = 6, LAYER_STILL = 7;         // AdvCanvasLayer.Video / Still

// AdvAlphaCommand.SetAlphaStill: AdvStill.SetAlpha on every loaded still that is showing, together
const setAlphaStill = (p, alpha, duration, cancelled) => {
  const s = featureState(p.ctx).still;
  return Promise.all(s ? s.showingStills().map((st) => st.setAlpha(alpha, duration, cancelled)) : []);
};

// AdvAlphaCommand.SetAlphaVideo: UIAdvWidget.SetVideoAlpha while the session has a current video
const setAlphaVideo = async (p, alpha, duration, cancelled) => {
  const v = featureState(p.ctx).video;
  if (v && v.hasCurrentVideoInfo) await v.setVideoAlpha(alpha, duration, cancelled);
};

// Alpha (AdvAlphaCommand.Execute / SetAlpha): alpha = Clamp01(Parameter1), duration = CalcDuration(Duration). Without
// CanvasLayers the stills and the video fade together; otherwise the layers in list order, each awaited: Video (6) the
// video, Still (7) the showing stills, any other layer nothing. Characters and the background are not affected.
export const Alpha = (c, p) => p.noWait(c, (async () => {
  const x = floatParam(c.Parameter1), alpha = x <= 1 ? (x >= 0 ? x : 0) : 1;
  const duration = p.calcDuration(c.Duration || 0, 0), cancelled = () => p.cancelled;
  const layers = c.CanvasLayers || [];
  try {
    if (!layers.length) {
      await Promise.all([setAlphaStill(p, alpha, duration, cancelled), setAlphaVideo(p, alpha, duration, cancelled)]);
      return;
    }
    for (const l of layers) {
      if (l === LAYER_VIDEO) await setAlphaVideo(p, alpha, duration, cancelled);
      else if (l === LAYER_STILL) await setAlphaStill(p, alpha, duration, cancelled);
    }
  } catch (e) {
    if (!(e instanceof DTCancelled)) throw e;
  }
})());
