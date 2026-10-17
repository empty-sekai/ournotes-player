import { URPPost, VOLUME_DEFAULTS, VOLUME_PARAMS } from "../../../engine/postfx.js";

// The main camera of the home spot as it renders a talk (CameraManager.MainCamera, a Fwk.Cam.UniversalCamera), and the
// volume stack it post-processes the spot with.
//   - camera: SpotSceneRoot.Setup -> SceneRoot.OnCameraSetup: MainCamera.SetCameraInfo(_sceneCamera) copies the Spot
//     scene camera's position, rotation, projection, clear flags, background colour, clip planes and culling mask, then
//     the scene camera is deactivated. What SetCameraInfo does not copy is the main camera's own: renderer 0, Base
//     and post-processing on from CameraManager.InitMainCamera, HDR and dithering from the CameraManager prefab, and
//     antialiasing from the game's detail settings (GameConfig.OnUpdateDetailConfig -> SetCameraAntialiasingMode;
//     GameDetailConfigDefaultData has it off at every quality level, as the prefab).
//   - volume mask: SpotCameraController.Setup: SetVolumeMask(LayerMask.GetMask("HomeView")). SpotManager keeps the
//     mask across the ADV boot of a talk (EnsureAfterTalkAdvBootedAsync saves a MainCameraState, RestoreMainCameraState
//     sets it back).
//   - volume stack: the camera's volume update mode is ViaScripting; Fwk.Volume.VolumeManager puts the main camera in
//     its always-update set when it boots (only the full story player, AdvPlayer.Play, takes it out) and calls
//     UpdateVolumeStack for it every PostLateUpdate: VolumeManager.Update(stack, camera transform, HomeView). No game
//     code changes a spot Volume, so the stack is the same in every frame of a talk and the host evaluates it once
//     (spotVolumeStack).
//   - chain: the UI camera is an Overlay camera stacked on the main camera without post-processing
//     (UICameraController.Init), so the main camera's post chain (URPPost: LUT, bloom, uber with the film grain) runs
//     on the spot alone, into the stack's colour target, before the UI camera draws the canvases and the UI blur
//     (UIRenderPass). With antialiasing off no FinalPost runs at the end of the stack.

// LayerMask.NameToLayer("HomeView") in the project's tags and layers
export const HOME_VIEW_LAYER = 15;
export const HOME_VIEW_MASK = 1 << HOME_VIEW_LAYER;

// The main camera in the spot: {near, far, clearFlags, clearColor: [r, g, b, a], orthographic, orthographicSize,
// viewport: {x, y, width, height}, rendererIndex, hdr, antialiasing, dithering, volumeMask} from the CameraManager's
// MainCamera (its Camera and UniversalAdditionalCameraData records in scene.json) and the Spot scene camera (host.json
// home.sceneRoot.sceneCamera, advui camera record; null: none, the main camera keeps its own values).
export const spotMainCamera = (mainCamera, mainData, sceneCamera = null) => {
  const src = sceneCamera ? sceneCamera.camera : mainCamera;
  if (!mainCamera || !src) throw new Error("home spot: the main camera's Camera record is needed");
  const bg = src.m_BackGroundColor, data = mainData || {};
  return { near: src["near clip plane"], far: src["far clip plane"], clearFlags: src.m_ClearFlags,
           clearColor: [bg.r, bg.g, bg.b, bg.a], orthographic: !!src.orthographic, orthographicSize: src["orthographic size"],
           viewport: src.m_NormalizedViewPortRect || null, rendererIndex: 0, hdr: !!mainCamera.m_HDR,
           antialiasing: data.m_Antialiasing || 0, dithering: !!data.m_Dithering, volumeMask: HOME_VIEW_MASK };
};

// The camera settings the spot's drawing does not reproduce: a projection other than perspective, a viewport other
// than the full screen, antialiasing (None 0, FXAA 1, SMAA 2, TAA 3: FinalPost or other passes at the end of the
// stack) and dithering (the uber pass). Raises on the first one set.
export const checkSpotCamera = (cam, what = "home spot") => {
  if (cam.orthographic) throw new Error(`${what}: an orthographic main camera is not implemented`);
  const r = cam.viewport;
  if (r && (r.x !== 0 || r.y !== 0 || r.width !== 1 || r.height !== 1))
    throw new Error(`${what}: a main camera viewport rect other than the full screen is not implemented`);
  if (cam.antialiasing) throw new Error(`${what}: main camera antialiasing mode ${cam.antialiasing} is not implemented`);
  if (cam.dithering) throw new Error(`${what}: main camera dithering is not implemented`);
  return cam;
};

// Volume registrations in scene order, then the placed prefabs; component fields and profile objects stay native.
export const spotVolumeStack = (volumes, mask = HOME_VIEW_MASK, what = "home spot") => {
  for (const v of volumes) if (typeof v.active !== "boolean") throw new Error(`${what}: Volume ${v.path}: activeInHierarchy is not in the host data`);
  const sorted = volumes.filter((v) => v.active && v.fields.m_Enabled && ((mask >>> v.layer) & 1))
    .map((v, i) => [v, i]).sort((a, b) => (a[0].fields.priority - b[0].fields.priority) || (a[1] - b[1]));
  const blended = [];
  for (const [v] of sorted) {
    const f = v.fields;
    if (!v.profile || !(f.weight > 0)) continue;
    if (!f.m_IsGlobal) throw new Error(`${what}: local Volume ${v.path} (blend distance ${f.blendDistance}) not implemented`);
    for (const c of v.profile.components) {
      if (!c.active) continue;
      const kinds = VOLUME_PARAMS[c.asset];
      if (!kinds) throw new Error(`${what}: volume component ${c.asset} not implemented`);
      for (const [k, p] of Object.entries(c)) if (p?.m_OverrideState && kinds[k] === "n" && VOLUME_DEFAULTS[c.asset][k] === null)
        throw new Error(`${what}: ${c.asset}.${k}: texture parameters not implemented`);
    }
    blended.push({ profile: v.profile, weight: f.weight });
  }
  return URPPost.evaluateStack(blended);
};

// The parts of a stack the spot camera's chain does not draw: depth of field and motion blur (they read the camera
// depth texture, which the spot does not produce here) and the AdvCurvedLens pass. Raises on the first one active.
export const checkSpotStack = (stack, what = "home spot") => {
  if (URPPost.dofActive(stack)) throw new Error(`${what}: volume depth of field (the camera depth texture) not implemented`);
  if (stack.MotionBlur.intensity > 0) throw new Error(`${what}: volume motion blur (the camera depth texture) not implemented`);
  const C = stack.AdvCurvedLens;
  if (C.intensity > 0 && (C.horizontalRate > 0 || C.verticalRate > 0))
    throw new Error(`${what}: volume AdvCurvedLens not implemented`);
  return stack;
};
