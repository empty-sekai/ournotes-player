import { Prefab } from "../../src/engine/prefab.js";
import { ShaderLib } from "../../src/engine/glsl.js";
import { GLTex } from "../../src/engine/texture.js";

// Synthetic component and product resources for camera, room and host rendering cases.
export const volumeResources = (v) => ({ path: v.path, layer: v.layer, active: v.active,
  fields: { m_Enabled: v.enabled, m_IsGlobal: v.isGlobal, weight: v.weight, priority: v.priority, blendDistance: v.blendDistance },
  profile: v.profile ? { components: (v.components || []).map(({ class: asset, active, ...params }) => ({ asset, active,
    ...Object.fromEntries(Object.entries(params).map(([k, m_Value]) => [k, { m_OverrideState: 1, m_Value }])) })) } : null });

export const lightingResources = ({ graphics, quality, rendererIndex, renderSettings, lights, what }) => {
  if (!graphics) throw new Error("URP lighting needs the scene's render settings");
  const level = graphics.qualityLevels[quality];
  if (!level) throw new Error(`quality level ${quality} is missing`);
  const name = level.customRenderPipeline || graphics.defaultPipeline, pipeline = { ...graphics.pipelines[name], m_Name: name };
  const renderer = pipeline.m_RendererDataList[rendererIndex < 0 ? pipeline.m_DefaultRendererIndex : rendererIndex];
  return { pipeline, renderer: { ...graphics.renderers[renderer], m_Name: renderer }, renderSettings,
    lightmaps: renderSettings?.lightmaps ? [{}] : [], lights, what };
};

export const homeResources = (store, spec, opts, gl = null) => {
  const h = spec.home, prefabs = new Map(), records = new Map(), classes = new Map();
  const node = (path, components = [], trs = {}) => ({ path, name: path.split("/").at(-1), active: true, layer: 0,
    localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 }, ...trs, components });
  const comp = (type, fields) => ({ type, fields });
  const prefab = (id, nodes) => { classes.set(id, "GameObject"); const doc = { key: id, nodes }; records.set(id, doc); prefabs.set(id, new Prefab(doc)); };
  const refs = (path) => ({ gameObject: path });
  const volumes = [...(h.sceneRoot?.volumes || []), ...(h.volume ? [h.volume] : [])].map(volumeResources);
  const scene = [node("Scene", [comp("SpotSceneRoot", { _objRoot: refs("Scene/Objects") })])];
  const tr = h.sceneRoot?.objRoot;
  scene.push(node("Scene/Objects", [], tr ? { localPosition: tr.position, localRotation: tr.rotation, localScale: tr.scale } : {}));
  volumes.forEach((v, i) => {
    records.set(`profile:${i}`, v.profile);
    scene.push(node(`Scene/${v.path}`, [comp("Volume", { ...v.fields, sharedProfile: `profile:${i}` })], { active: v.active, layer: v.layer }));
  });
  for (const [i, l] of (h.sceneRoot?.lights || []).entries())
    scene.push(node(`Scene/Light${i}`, [comp(l.type || "Light", l)], { active: l.active }));
  prefab("scene", scene);
  prefab("background", [node("Background", [], h.roomRoot)]);
  prefab("camera", [node("Camera", [comp("CameraManager", { _mainCamera: refs("Camera") })])]);
  const spot = store.json(h.spot), situation = [node("Situation")];
  for (const [i, c] of spot.spineCharacters.entries()) {
    if (!c.skeletonData) continue;
    const extra = h.spineCharacters?.find((r) => r.path === c.path), path = `Situation/Character${i}`;
    const skeleton = spot.skeletons.find((r) => r.name === c.skeletonData);
    const pageNames = skeleton.atlases.flatMap((f) => (store.has(`host/spot/spine/${f}`) ? store.text(`host/spot/spine/${f}`) : "").split(/\r?\n/).filter((s) => s && !s.includes(":")));
    const materials = pageNames.map((page) => extra?.pageMaterials?.[page] || (Object.keys(h.spineMaterials).length === 1
      ? Object.keys(h.spineMaterials)[0] : `${page.replace(/\.[^.]*$/, "")}_Material`));
    records.set(`skeleton:${i}`, { atlasAssets: [`atlas:${i}`] });
    records.set(`atlas:${i}`, { atlasFile: `atlas-text:${i}`, materials });
    records.set(`atlas-text:${i}`, new TextEncoder().encode(pageNames.map((n) => `${n}\nsize: 8,8\n`).join("\n")));
    const components = [comp("SpotSpineCharacter", { _animation: refs(`${path}/Animation`) })];
    situation.push(node(path, components));
    situation.push(node(`${path}/Animation`, [comp("SkeletonAnimation", { skeletonDataAsset: `skeleton:${i}` }),
      comp("MeshRenderer", { m_SortingOrder: extra?.sortingOrder ?? c.sortingOrder ?? 0 })]));
    // The spot product identifies each character by the prefab path.
    for (const n of situation.slice(-2)) n.path = n.path.replace(path, c.path);
    components[0].fields._animation = refs(`${c.path}/Animation`);
  }
  // Synthetic character paths have a shared root named s.
  if (situation.length > 1) { situation[0].path = "s"; situation[0].name = "s"; }
  prefab("situation", situation);
  classes.set("render-settings", "RenderSettings"); records.set("render-settings", h.sceneRoot?.renderSettings);
  classes.set("lightmaps", "LightmapSettings"); records.set("lightmaps", { m_Lightmaps: h.sceneRoot?.renderSettings?.lightmaps ? [{}] : [] });
  const graphics = opts.graphics;
  records.set("quality", { m_QualitySettings: graphics?.qualityLevels || [] });
  records.set("graphics", { m_CustomRenderPipeline: graphics?.defaultPipeline });
  for (const [name, p] of Object.entries(graphics?.pipelines || {})) records.set(name, { ...p, m_Name: name });
  for (const [name, r] of Object.entries(graphics?.renderers || {})) {
    const features = r.m_RendererFeatures.map((f, i) => { const id = `feature:${name}:${i}`; records.set(id, f); return id; });
    records.set(name, { ...r, m_Name: name, m_RendererFeatures: features, postProcessData: `post:${name}` });
    const textures = opts.post?.textures?.[name];
    records.set(`post:${name}`, { textures: textures ? { filmGrainTex: textures.filmGrainTex.map((t) => { records.set(t.name, t); return t.name; }) } : {} });
  }
  const material = (m, id) => ({ ...m, id, material: m.material || m.name, shader: m.shader?.shader || m.shader,
    textures: Object.fromEntries(Object.entries(m.textures || m.texEnvs || {}).map(([k, v]) => [k, { ...v,
      scale: Array.isArray(v.scale) ? { x: v.scale[0], y: v.scale[1] } : v.scale,
      offset: Array.isArray(v.offset) ? { x: v.offset[0], y: v.offset[1] } : v.offset }])) });
  const mats = new Map(h.roomMaterials.map((m, i) => [`material:${i}`, material(m, `material:${i}`)]));
  for (const [id, m] of Object.entries(h.spineMaterials || {})) mats.set(id, material(m, id));
  const index = new Map(store.json(h.shaders.index).map((r) => [r.name, r]));
  store.object = (id) => ({ class: classes.get(id) });
  store.hasObject = (id) => index.has(id) || records.has(id);
  store.objectJson = (id) => records.get(id);
  store.objectBytes = (id) => records.get(id);
  store.prefab = (id) => records.get(id);
  const objects = { assets: store, id: (v) => v || null, prefab: (id) => prefabs.get(id),
    mono: (id) => records.get(id), profile: (id) => records.get(id), material: (id) => mats.get(id),
    shaderNames: Object.fromEntries([...index.keys()].map((n) => [n, n])),
    shaderInfo: (id) => store.json(`host/shaders/${index.get(id).parsed}`), uiBlur: () => h.blur,
    texture: (id) => GLTex.load(gl, "", records.get(id), store), lib: gl ? new ShaderLib(gl, "host/shaders", store) : null };
  const summary = { glb: "room.glb", nodes: h.roomNodes, materialIds: h.roomMaterials.map((_, i) => `material:${i}`) };
  const data = { assets: store, scene: { prefabs: { cameraManager: "camera" }, graphics: { graphics: "graphics", quality: "quality" } },
    story: { host: { talk: h.talk, characterId: h.characterId } },
    host: { kind: "home", home: { spotId: h.spotId, background: "background", situation: "situation",
      scene: ["scene", "render-settings", "lightmaps"], parts: { room: "room", spot: "spot" },
      backgroundState: { nodes: Object.fromEntries(h.roomNodes.map((n) => [n.path, n])) } } },
    document: (part) => part === "room" ? summary : store.json(h.spot), file: (_, file) => `host/spot/${file}` };
  return { data, objects, summary };
};
