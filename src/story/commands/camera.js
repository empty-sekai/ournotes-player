import { closestFocusDataByZoomRatio, floatParam } from "../params.js";
import { StoryCommandError } from "../interfaces.js";

// Camera commands: PanV2, Track, Pedestal, Zoom (AdvCameraCommandBase prologue) and Focus. They move the main camera
// (Fwk UniversalCamera, field.js StoryCamera) and the field renderer's blur / curved-lens rates.

// The camera commands' prologue: nothing in Overlay playback mode (IMasterAdv.IsPlaybackMode(Overlay)), else
// Session.DelayTokens.Delay(CalcDuration(DelaySeconds, 0)); false = cancelled or skipped
export const cameraPrologue = async (c, p) => {
  if (p.isOverlay) return false;
  return p.delay(p.calcDuration(c.DelaySeconds || 0, 0));
};

// AdvPanV2Command: rotate the camera about the focus point, sliding it by (1 - slide rate) of the arc
export const PanV2 = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0);
  const angle = floatParam(c.Parameter1), s = p.session;
  const dist = s.stage ? Math.abs(s.stage.characterFieldPosition.z - s.focusCameraPosition.z) : 0;
  const slide = (c.Parameter3 ?? "").trim() === "" ? p.ctx.settings.player._defaultPanV2FocusSlideRate
    : floatParam(c.Parameter3);
  const rad = angle * 0.017453292;
  const off = { x: -Math.sin(rad) * dist * (1 - slide), y: (1 - Math.cos(rad)) * dist * (1 - slide) };
  s.panV2Offset = off;
  const base = s.panV2Base, cam = p.ctx.camera;
  await Promise.all([cam.rotateY(angle, dur, ease), cam.moveX(base.x + off.x, dur, ease),
                     cam.moveZ(base.z + off.y, dur, ease), p.ctx.field.rotateCharacterStagesY(angle, dur, ease)]);
})());

// AdvTrackCommand: camera x = Parameter1 + the focus x
export const Track = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0), s = p.session;
  const x = floatParam(c.Parameter1) + s.focusCameraPosition.x;
  s.panV2Base = { x, y: s.panV2Base.y, z: s.panV2Base.z };
  s.panV2Offset = { x: 0, y: s.panV2Offset.y };
  await p.ctx.camera.moveX(x, dur, ease);
})());

// AdvPedestalCommand: camera y = Parameter1 + the focus y
export const Pedestal = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0), s = p.session;
  const y = floatParam(c.Parameter1) + s.focusCameraPosition.y;
  s.panV2Base = { x: s.panV2Base.x, y, z: s.panV2Base.z };
  await p.ctx.camera.moveY(y, dur, ease);
})());

// AdvZoomCommand: zoom ratio = the focus zoom ratio x Parameter1 (<= 0: 1); the blur radius and curved lens follow the
// focus data closest to that ratio; Parameter3 "sharp" keeps the background blur, else it is that focus data's
// intensity + Parameter3
export const Zoom = (c, p) => p.noWait(c, (async () => {
  if (!await cameraPrologue(c, p)) return;
  const ease = p.ease(c.Parameter2), dur = p.calcDuration(c.Duration || 0, 0);
  let mul = floatParam(c.Parameter1);
  if (mul <= 0) mul = 1;
  const s = p.session, fr = p.ctx.fieldRenderer;
  const target = s.focusZoomRatio * mul;
  const tasks = [];
  const fds = s.focusDataSettings;
  let fd = null;
  if (!fds) console.warn("Zoom: no focus data settings");
  else {
    fd = closestFocusDataByZoomRatio(fds, target);
    if (fd) {
      s.focusCameraDistance = fd._cameraDistance;
      tasks.push(fr.applyBlurRadiusByCameraDistance(fd._cameraDistance, dur, ease));
      tasks.push(fr.applyCurvedLensIntensityRateByCameraDistance(fd._cameraDistance, dur, ease));
    }
  }
  const p3 = c.Parameter3 ?? "";
  if (p3.toLowerCase() !== "sharp" && fd && p.ctx.quality.backgroundBlur && fds._backgroundBlurEnabled)
    tasks.push(fr.setBackgroundBlur(dur, fd._backgroundBlurIntensity + floatParam(p3), ease));
  tasks.push(p.ctx.camera.zoom(target, dur, ease));
  await Promise.all(tasks);
})());

// AdvFocusCommand: the camera to the focus anchor of PositionType (or the TargetName's slot, at its head height), the
// zoom ratio and blur of the focus data for CameraDistance; Parameter1 "sharp" clears the blur
export const Focus = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx, s = p.session, fr = ctx.fieldRenderer;
  let pos = c.PositionType || 0;
  let fds = s.focusDataSettings;
  if (!fds) { fds = p.defaultFocusDataSettings(); s.focusDataSettings = fds; console.warn("Focus: default focus data"); }
  if (!fds) throw new StoryCommandError("Focus: no focus data settings");
  const cd = c.CameraDistance || 0;
  const fd = fds._focusData.find((x) => x._cameraDistance === cd);
  if (!fd) throw new StoryCommandError(`Focus: no focus data for camera distance ${cd}`);
  const dur = p.calcDuration(c.Duration || 0, 0);
  const sharp = (c.Parameter1 ?? "").toLowerCase() === "sharp";
  const chBlur = sharp ? 0 : fd._characterBlurIntensity, bgBlur = sharp ? 0 : fd._backgroundBlurIntensity;
  if (!await p.delay(p.calcDuration(c.DelaySeconds || 0, 0))) return;
  const ease = p.ease(c.Parameter2, fds._focusEase);
  s.focusCameraDistance = cd;
  const pt = ctx.field.focusPoint(pos);
  let camY = fd._fieldZoomOffsetY;
  const ch = c.TargetName ? ctx.characters.get(c.TargetName) : null;
  if (ch && ch.isAlive) {
    if (s.targetNameToPosition.has(c.TargetName)) {
      pos = s.targetNameToPosition.get(c.TargetName);
      camY = ch.headPosition().y - fd._characterHeadFocusOffsetY;
    } else console.warn(`Focus: TargetName ${c.TargetName} has no PositionType`);
  }
  s.focusCameraPosition = { x: pt.x, y: camY, z: 0 };
  s.focusZoomRatio = fd._fieldZoomRatio;
  s.panV2Base = { x: pt.x, y: camY, z: 0 }; s.panV2Offset = { x: 0, y: 0 };
  const cam = ctx.camera;
  const tasks = [cam.move({ x: pt.x, y: camY, z: 0 }, dur, ease), cam.rotateY(0, dur, ease),
                 cam.zoom(fd._fieldZoomRatio, dur, ease), ctx.field.rotateCharacterStagesY(0, dur, ease),
                 fr.applyBlurRadiusByCameraDistance(cd, dur, ease),
                 fr.applyCurvedLensIntensityRateByCameraDistance(cd, dur, ease)];
  if (ctx.quality.backgroundBlur && fds._backgroundBlurEnabled) tasks.push(fr.setBackgroundBlur(dur, bgBlur, ease));
  if (ctx.quality.characterBlur && fds._characterBlurEnabled) {
    const has = s.positionToCharacter.has(pos);
    for (const q of s.placedPositions) tasks.push(fr.setCharacterBlur(q, dur, (q === pos || !has) ? 0 : chBlur, ease));
  }
  await Promise.all(tasks);
})());
