import { Transform } from "../engine/math.js";
import { AdvBackgroundField, AdvCamera, AdvCharacterField, AdvFieldRendererManager, AdvGlobalVolume } from "./field.js";
import { AdvStageData } from "./stage.js";

// The story scene and stage assets, instantiated from their object references.
export class StoryScene {
  constructor(data, objects, loop, quality) {
    const scene = data.scene, prefabs = scene.prefabs;
    this.manager = new Transform("AdvManager");
    const camera = objects.prefab(prefabs.cameraManager);
    const manager = camera.fields(camera.root.name, "CameraManager");
    const mainPath = camera.pathOf(manager._mainCamera);
    this.camera = new AdvCamera(loop, camera.fields(mainPath, "Camera"));
    this.field = new AdvCharacterField(loop, objects.prefab(prefabs.characterField), this.manager);
    this.background = new AdvBackgroundField(objects.prefab(prefabs.backgroundField), this.manager);
    this.volume = new AdvGlobalVolume(objects.prefab(prefabs.globalVolume), quality, objects);
    this.fieldRenderer = new AdvFieldRendererManager(loop, quality);
    this.stageData = new Map();
    for (const key of Object.keys(data.parts.assets || {})) {
      if (!key.startsWith("Adv/Stage/")) continue;
      const address = key.slice("Adv/Stage/".length);
      const asset = data.asset(key);
      if (asset.objects.length !== 1) throw new Error(`${address}: expected one stage root`);
      const stage = new AdvStageData(objects.prefab(asset.objects[0]), objects);
      stage.prefab.root.setParent(this.manager);
      this.stageData.set(address, stage);
    }
    const renderer = camera.fields(mainPath, "UniversalAdditionalCameraData").m_RendererIndex;
    this.postTextures = { filmGrainTex: objects.grainTextures(scene.graphics.graphics, renderer) };
    this.session = null;
  }
}
