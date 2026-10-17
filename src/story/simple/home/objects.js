import { Prefab, componentClass } from "../../../engine/prefab.js";
import { mat4, quat } from "../../../engine/math.js";

// Scene placement, camera and component registrations retained by the home host product.
export class HomeScene {
  constructor(data, objects) {
    this.objects = objects;
    const home = data.host.home, assets = data.assets;
    const roots = home.scene.filter((id) => assets.object(id).class === "GameObject");
    this.scene = new Prefab({ key: "home scene", nodes: [] });
    if (roots.length) this.scene = Prefab.fromObjects(assets, roots);
    this.background = objects.prefab(home.background);
    this.situation = objects.prefab(home.situation);
    const sceneRoots = this.components(this.scene, "SpotSceneRoot");
    if (sceneRoots.length > 1) throw new Error("home scene: multiple SpotSceneRoot components");
    const fields = sceneRoots[0]?.fields;
    const transform = fields?._objRoot ? this.scene.transformOf(fields._objRoot) : null;
    this.objRoot = transform ? worldTRS(transform) : null;
    this.rootMatrix = transform ? transform.localToWorld() : mat4.identity();
    this.camera = fields?._sceneCamera ? this.scene.componentOf(fields._sceneCamera, "Camera").fields : null;
    this.renderSettings = this.setting(home.scene, "RenderSettings");
    this.lightmaps = this.setting(home.scene, "LightmapSettings")?.m_Lightmaps || [];
    this.volumes = []; this.lights = [];
    for (const p of [this.scene, this.background, this.situation]) {
      const active = (path) => p === this.background
        ? home.backgroundState.nodes[path]?.active ?? p.activeInHierarchy(path) : p.activeInHierarchy(path);
      for (const { path, node, fields: f } of this.components(p, "Volume"))
        this.volumes.push({ path, layer: node.layer, active: active(path), fields: f,
          profile: objects.profile(f.sharedProfile) });
      for (const cls of ["Light", "ReflectionProbe"])
        for (const { path, fields: f } of this.components(p, cls))
          this.lights.push({ ...f, type: cls, path, active: active(path) });
    }
  }

  setting(ids, cls) {
    const found = ids.filter((id) => this.objects.assets.object(id).class === cls);
    if (found.length > 1) throw new Error(`home scene: multiple ${cls} objects`);
    return found.length ? this.objects.assets.objectJson(found[0]) : null;
  }

  components(prefab, cls) {
    const out = [];
    for (const [path, { node }] of prefab.nodes) for (const c of node.components)
      if (componentClass(c) === cls) out.push({ path, node, fields: c.fields });
    return out;
  }

  spine(path) {
    const p = this.situation, c = p.fields(path, "SpotSpineCharacter");
    const anim = p.componentOf(c._animation, "SkeletonAnimation").fields;
    const renderer = p.fields(p.pathOf(c._animation), "MeshRenderer");
    const skeleton = this.objects.mono(anim.skeletonDataAsset), pages = new Map();
    for (const ref of skeleton.atlasAssets) {
      const atlas = this.objects.mono(ref), id = this.objects.id(atlas.atlasFile, "TextAsset");
      const lines = new TextDecoder().decode(this.objects.assets.objectBytes(id, "data")).split(/\r?\n/).map((s) => s.trim());
      const names = lines.filter((s, i) => s && !s.includes(":") && lines[i + 1]?.startsWith("size:"));
      if (names.length !== atlas.materials.length) throw new Error(`${path}: atlas page/material count mismatch`);
      names.forEach((page, i) => pages.set(page, this.objects.material(atlas.materials[i])));
    }
    return { pages, sortingOrder: renderer.m_SortingOrder };
  }
}

const worldTRS = (t) => {
  let rotation = t.localRotation;
  for (let p = t.parent; p; p = p.parent) rotation = quat.mul(p.localRotation, rotation);
  const m = t.localToWorld();
  return { position: t.worldPosition(), rotation,
    scale: { x: Math.hypot(m[0], m[1], m[2]), y: Math.hypot(m[4], m[5], m[6]), z: Math.hypot(m[8], m[9], m[10]) } };
};
