import { LAYER_OF_POSITION, floatParam } from "../params.js";

// Character commands: In, Out, Motion, Character, Look, LookTarget, MoveToDirection.

// AdvInCommand (AddSpeaker): shows the TargetName's character on the PositionType slot and fades its composited
// render in (AdvFieldRendererManager.FadeInCharacterAsync)
export const In = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx, s = p.session, pos = c.PositionType || 0;
  if (!c.TargetName) { ctx.ui.setSpeakerName(""); return; }
  if (ctx.field.existsCharacter(pos)) {
    console.warn(`In: PositionType ${pos} already has a character; ${c.TargetName} is not added`);
    return;
  }
  const ch = ctx.characters.get(c.TargetName);
  if (ch) {
    const stage = ctx.field.stageTransform(pos);
    const fadeIn = p.shortcut ? 0 : (c.MotionFadeIn || 0);
    ch.show(c.MotionName || "", c.ExpressionName || "", fadeIn);          // AdvCharacterHelper.ShowCharacterController
    ch.setParent(stage);
    // only the five slots have a field renderer layer; another position (0 when the row has none) shows the character
    // without registering it (its stage is null: GetStageTransform warns)
    if (LAYER_OF_POSITION[pos]) ctx.fieldRenderer.registerCharacter(ch, LAYER_OF_POSITION[pos]);
    ch.resetAngleLook();
    let lighting = (c.Parameter1 ?? "").toLowerCase() !== "unlit";
    if (p.isOverlay || !ctx.quality.unityLighting) lighting = false;
    ch.setIgnoreAllUpdate(false);
    ch.setLightingEnabled(lighting);
    ch.setPhysicsEnabled(ctx.quality.characterPhysics);
    ch.setBreathMotionEnabled(ctx.quality.characterBreathMotion);
    if (s.eyeBlinkStoppedTargetNames.has(c.TargetName)) ch.setEyeBlinkStopped(true, 0);
  } else console.warn(`In: character ${c.TargetName} is not loaded; only its position is registered`);
  // AdvPlaybackSession.SetCharacterPositionInfo (clears the slot's previous occupant first)
  if (s.placedPositions.includes(pos)) {
    s.targetNameToPosition.delete(c.TargetName); s.positionToCharacter.delete(pos);
    s.placedPositions.splice(s.placedPositions.indexOf(pos), 1);
  }
  s.targetNameToPosition.set(c.TargetName, pos);
  s.positionToCharacter.set(pos, ch);
  s.placedPositions.push(pos);
  await ctx.fieldRenderer.fadeCharacter(pos, p.calcDuration(c.Duration || 0, 0), 0, 1);
})());

// AdvOutCommand (RemoveSpeaker): fades the slot's render out (at least 0.05 s outside a shortcut), then hides the
// character and returns it to the loader's pool. The session's name / position maps keep the entry.
export const Out = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx;
  let pos = c.PositionType || 0;
  if (!pos) pos = p.session.targetNameToPosition.get(c.TargetName) || 0;
  let dur = p.calcDuration(c.Duration || 0, 0);
  if (dur <= 0 && !p.shortcut) dur = 0.05;
  await ctx.fieldRenderer.fadeCharacter(pos, dur, 1, 0);
  if (p.cancelled) return;
  const ch = ctx.characters.get(c.TargetName);
  if (ch) {
    ch.hide(); ch.setIgnoreAllUpdate(true);
    ctx.fieldRenderer.unregisterCharacter(ch);
    ch.setParent(ctx.field.poolRoot);
  }
})());

// AdvMotionCommand: AdvMotionController.PlayMotion (MotionWait queues it); never blocks
export const Motion = (c, p) => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (ch) p.motions.playMotion(ch, c, p.shortcut);
  return Promise.resolve();
};

// AdvCharacterCommand: the model is loaded before playback (AdvEpisodeResourceLoader.Preload); nothing at execution
export const Character = () => Promise.resolve();

// AdvLookCommand / AdvLookTargetCommand: ApplyLookOverTime (DelaySeconds, then SmoothChangeToLook over Duration; a
// "stop" row returns to the original look and disables it)
const applyLookOverTime = async (ch, x, y, enabled, c, p) => {
  if (!await p.delay(p.calcDuration(c.DelaySeconds || 0, 0))) return;
  if (!ch.isAlive) return;
  await ch.smoothChangeToLook(x, y, p.calcDuration(c.Duration || 0, 0));
  if (!enabled) ch.setLookEnabled(false);
};

export const Look = (c, p) => p.noWait(c, (async () => {
  const ch = p.ctx.characters.get(c.TargetName);
  if (!ch) return;
  let x = floatParam(c.Parameter1), y = floatParam(c.Parameter2);
  const enabled = (c.Parameter3 ?? "").toLowerCase() !== "stop";
  if (enabled) ch.setLookEnabled(true);
  else { x = ch.originalLookX; y = ch.originalLookY; }
  await applyLookOverTime(ch, x, y, enabled, c, p);
})());

// the look direction toward the character on PositionType: head offset x 0.2 horizontally, 1:1 vertically, each
// clamped to [-1, 1]
export const LookTarget = (c, p) => p.noWait(c, (async () => {
  const looker = p.ctx.characters.get(c.TargetName);
  if (!looker) return;
  const enabled = (c.Parameter3 ?? "").toLowerCase() !== "stop";
  let x, y;
  if (enabled) {
    const target = p.session.positionToCharacter.get(c.PositionType || 0);
    if (!target || !target.isAlive) {
      console.warn(`LookTarget: PositionType ${c.PositionType} has no character (TargetName ${c.TargetName})`);
      return;
    }
    looker.setLookEnabled(true);
    const a = target.headPosition(), b = looker.headPosition();
    x = Math.min(1, Math.max(-1, (a.x - b.x) * 0.2));
    y = Math.min(1, Math.max(-1, a.y - b.y));
  } else { x = looker.originalLookX; y = looker.originalLookY; }
  await applyLookOverTime(looker, x, y, enabled, c, p);
})());

// AdvMoveToDirectionCommand: AdvCharacterField.MoveToDirection (the slot's stage moves by (P1, P2, P3), OutQuad)
export const MoveToDirection = (c, p) => {
  const dur = p.calcDuration(c.Duration || 0, 0);
  const dir = { x: floatParam(c.Parameter1), y: floatParam(c.Parameter2), z: floatParam(c.Parameter3) };
  return p.noWait(c, p.ctx.field.moveToDirection(c.PositionType || 0, dir, dur));
};
