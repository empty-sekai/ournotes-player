import { registerCommand } from "../interfaces.js";
import { featureState, dropFeatureState } from "./state.js";
import { stopAllShakes } from "./shake.js";
import { Alpha } from "../commands/alpha.js";
import { Angle } from "../commands/angle.js";
import { Brightness } from "../commands/brightness.js";
import { Pan, Role, Tilt } from "../commands/camera-rotate.js";
import { DoF } from "../commands/dof.js";
import { MotionLoop } from "../commands/motionloop.js";
import { Back, Forward, MoveToBack, MoveToDown, MoveToForward, MoveToLeft, MoveToRight, MoveToUp } from "../commands/placement.js";
import { CameraShake, Shake } from "../commands/shake.js";
import { ChatRead, ChatStamp, ChatTalk, ChatTyping, ChatWindow } from "../commands/chat.js";
import { ChoiceSet, ChoiceShow, GoTo } from "../commands/choice.js";
import { Effect } from "../commands/effect.js";
import { Flash } from "../commands/flash.js";
import { Frame } from "../commands/frame.js";
import { RimLight, StageEnv } from "../commands/stageenv.js";
import { Still } from "../commands/still.js";
import { Subtitles } from "../commands/subtitles.js";
import { Clip, Movie } from "../commands/video.js";
import { Voice } from "../commands/voice.js";
import { Timeline } from "../commands/timeline.js";
import { PostEffect } from "../commands/posteffect.js";
import { loadChat } from "./chat.js";
import { loadEffectMaterials, loadEffects } from "./effect.js";
import { loadFrames } from "./frame.js";
import { loadPostEffects } from "./posteffect.js";
import { loadStills } from "./still.js";
import { loadVideos } from "./video.js";

// The story features beyond the core interpreter: their commands (registered when this module loads, before any
// episode's command check) and their per-episode setup on a StoryContext.

export const FEATURE_COMMANDS = {
  Shake, CameraShake, Tilt, Role, Pan, DoF, MoveToRight, MoveToLeft, MoveToUp, MoveToDown, MoveToForward, MoveToBack,
  Forward, Back, Brightness, Angle, MotionLoop, PostEffect, Frame, StageEnv, RimLight, Flash,
  ChoiceSet, ChoiceShow, GoTo, Timeline, Effect, Still, Alpha, Movie, Clip, Subtitles, Voice,
  ChatWindow, ChatTalk, ChatStamp, ChatRead, ChatTyping,
};

for (const [name, fn] of Object.entries(FEATURE_COMMANDS)) registerCommand(name, fn);

// Per-episode setup, after the StoryContext exists and the episode's resources are loaded, before play:
// core = the StoryPlayerCore; opts.random = the session's UnityRandom (UnityEngine.Random: DOTween shakes).
export const installStoryFeatures = async (ctx, core, opts = {}) => {
  const s = featureState(ctx);
  s.core = core;
  if (opts.random) s.random = opts.random;
  await loadPostEffects(ctx);
  loadFrames(ctx);
  loadStills(ctx);
  loadVideos(ctx);
  loadChat(ctx);
  loadEffects(ctx);
  if (s.screen) await s.screen.load();
  await loadEffectMaterials(ctx);
};

// AdvLocalDataHandler.ReapplyPlaybackSpeed for the features' objects (still sequences, command particle effects,
// video): called by the player whenever the playback speed changes
export const setStoryFeaturesSpeed = (ctx, rate) => {
  const s = featureState(ctx);
  for (const f of s.speedListeners || []) f(rate);
};

// releases what the features hold for the context (views, GL resources, tweens)
export const disposeStoryFeatures = (ctx) => {
  const s = featureState(ctx);
  if (s.shake) stopAllShakes(ctx);
  for (const d of s.disposers.splice(0).reverse()) d();
  dropFeatureState(ctx);
};

// the features' state for checks (JSON-able; stable between runs with the same seed): each installed feature's
// snapshot, by name
export const snapshotStoryFeatures = (ctx) => {
  const s = featureState(ctx), out = {};
  if (s.shake) {
    const sh = s.shake;
    out.shake = { camera: [sh.camera.state, sh.camera.position], generation: sh.shakeGeneration,
                  still: sh.still ? sh.still.get() : null, talk: sh.talk ? sh.talk.get() : null };
  }
  for (const f of s.snapshots || []) Object.assign(out, f());
  return out;
};
