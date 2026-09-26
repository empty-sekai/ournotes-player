// AdvStageCommand: switches the stage (background, lights, focus points, volume profile, camera start); with a
// Duration the previous background crossfades out from a capture of it.

export const Stage = (c, p) => p.noWait(c, (async () => {
  const ctx = p.ctx, s = p.session, fr = ctx.fieldRenderer;
  const dur = p.calcDuration(c.Duration || 0, 0);
  const name = c.TargetAssetName || "";
  let stage = null;
  if (name) {
    stage = ctx.stages.get(name);
    if (!stage) { console.error(`Stage: stage ${name} is not loaded`); return; }
  }
  if (dur > 0) fr.setCaptureTexture(await fr.captureAdvBack());          // ScreenCapture.Capture(AdvBack)
  if (s.stage) { s.stage.stopParticleEffects(); s.stage.hideLights(); }
  s.panV2Base = { x: 0, y: 0, z: 0 }; s.panV2Offset = { x: 0, y: 0 };
  ctx.camera.rotateYNow(0);
  if (!stage) {
    ctx.volume.setStageInfo(null); ctx.field.setStageInfo(null); ctx.background.setStageInfo(null);
    ctx.camera.resetFov(); ctx.camera.resetPositionAndRotation();
    s.stage = null; s.focusDataSettings = p.defaultFocusDataSettings();
    fr.setBackgroundActive(false); fr.setBackgroundAlpha(1); fr.sortCharacters();
    for (const ch of ctx.characters.values()) ch.setMultiplyTexture(null);
  } else {
    for (const ch of ctx.characters.values()) ch.setMultiplyTexture(stage.shadow);
    if (ctx.quality.stageParticleEffect) stage.playParticleEffects();
    if (ctx.quality.unityLighting) stage.showLights();
    if (ctx.quality.stagePostEffect) ctx.volume.setStageInfo(stage);
    stage.setPlaybackSpeed(p.speedRate());
    ctx.field.setStageInfo(stage);
    s.stage = stage;
    s.focusDataSettings = p.focusDataSettings(stage.focusDataSettingsKey) || p.defaultFocusDataSettings();
    ctx.camera.setFov(stage.fov);
    ctx.background.setStageInfo(stage);
    fr.setBackgroundActive(true); fr.setBackgroundAlpha(stage.backgroundColor.a); fr.sortCharacters();
    const q = stage.initialCameraPosition, r = stage.initialCameraRotation;
    if (q.x * q.x + q.y * q.y + q.z * q.z >= 1e-10) { ctx.camera.setPosition(q); s.panV2Base = { ...q }; }
    if (r.x * r.x + r.y * r.y + r.z * r.z >= 1e-10) ctx.camera.setRotation(r);
  }
  if (dur > 0) { await fr.fadeCapture(dur, 1, 0); fr.resetCaptureTexture(); }  // FadeCaptureAsync
})());
