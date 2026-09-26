import { floatParam } from "../params.js";
import { NEXT_STEP } from "../player-core.js";
import { featureState } from "../features/state.js";
import { shakes, talkShakeTarget } from "../features/shake.js";
import { delayWithSpeedAdjustment, waitUntil } from "../features/timing.js";

// Shake and CameraShake (AdvShakeCommand, AdvCameraShakeCommand).

const LAYER = { Background: 0, Overlay: 1, Character: 2, Still: 7, Talk: 9 };

// AdvShakeCommand.WaitShakeTask: WhenAny(DelayWithSpeedAdjustment(duration), UniTask.WaitUntil(next step GoNext) when
// a tap may end it); a newer Shake row cancels the wait (Session.RefreshShakeCancellationToken)
const waitShake = (p, duration, tapCancel, stopped) => {
  if (!tapCancel) return delayWithSpeedAdjustment(p, duration, stopped);
  let done = false;
  const end = () => done || stopped();
  return Promise.race([
    delayWithSpeedAdjustment(p, duration, end).then((v) => { done = true; return v; }),
    waitUntil(p, () => p.nextStep === NEXT_STEP.GoNext, end).then((v) => { done = true; return v; }),
  ]);
};

// AdvShakeCommand.Shake: Parameter1 x the player settings' field / UI shake strength; CanvasLayers picks the targets
// (none: the background and character fields, the still and the talk window)
export const Shake = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx, P = ctx.settings.player, sh = shakes(ctx), random = featureState(ctx).random;
  const duration = p.calcDuration(c.Duration || 0, 0);
  const fieldPower = floatParam(c.Parameter1) * P._shakeFieldStrength;
  const uiPower = floatParam(c.Parameter1) * P._shakeUIStrength;
  const tapCancel = !c.IsNoWait;
  if (tapCancel) p.nextStep = NEXT_STEP.AllowNext;                     // Model.ChangeAllowNextState
  const generation = ++sh.shakeGeneration;
  const runner = ctx.loop.tweens, field = { x: fieldPower, y: fieldPower, z: 0 };
  const still = () => { if (sh.still) sh.still.shake(runner, random, duration, uiPower); };
  const talk = () => { const t = talkShakeTarget(ctx); if (t) t.shake(runner, random, duration, uiPower); };
  const layers = c.CanvasLayers || [];
  if (!layers.length) {
    sh.backgroundField.shake(runner, random, duration, field);
    sh.characterField.shake(runner, random, duration, field);
    still(); talk();
  } else {
    for (const layer of layers) {
      if (layer === LAYER.Background) sh.backgroundField.shake(runner, random, duration, field);
      else if (layer === LAYER.Overlay || layer === LAYER.Character) sh.characterField.shake(runner, random, duration, field);
      else if (layer === LAYER.Still) still();
      else if (layer === LAYER.Talk) talk();
      else console.warn(`Shake command is not supported for ${JSON.stringify(layers)} layer`);
    }
  }
  // with no layers the game passes the row's token to the wait, so a newer Shake does not end it
  await waitShake(p, duration, tapCancel, layers.length ? () => generation !== sh.shakeGeneration : () => false);
})());

// AdvCameraShakeCommand.CameraShake: nothing in Overlay playback mode; a running camera shake stops (fade = Parameter1,
// else Duration); otherwise it starts (strength Parameter2 > 0, else the player settings') and the row waits the fade
export const CameraShake = (c, p) => p.noWait(c, (async () => {
  if (p.isOverlay) return;
  const ctx = p.ctx, P = ctx.settings.player, ctrl = shakes(ctx).camera;
  let fade = p.calcDuration(floatParam(c.Parameter1), 0);
  if (fade <= 0) fade = p.calcDuration(c.Duration || 0, 0);
  if (ctrl.isPlaying) { await ctrl.disable(fade); return; }
  let strength = floatParam(c.Parameter2);
  if (strength <= 0) strength = P._cameraShakeStrength;
  ctrl.enable(fade, P._cameraShakeDuration, { x: strength, y: strength, z: 0 }, P._cameraShakeVibrato,
              P._cameraShakeRandomness).catch((e) => p.fail(e));
  await ctx.loop.delay(fade);                                           // UniTask.Delay(fade) at Update, scaled time
})());
