import { refId } from "../data/assets.js";
import { AnimBindings, AnimClip, AnimController } from "./anim.js";
import { ShaderLib } from "./glsl.js";
import { Prefab, scriptClass } from "./prefab.js";
import { GLTex } from "./texture.js";

// ObjectResources: the objects of a product store (docs/data-format.md "Objects") as playback modules read them, each made
// once per session. A value `v` is a reference as an object holds it ({"$ref": ...}) or an object id as a document
// holds it; null gives null.
//   material(v)   a Material: material.json with `id`, `shader` = the id of its Shader object (read when a draw
//                 needs it) and each texture slot's `texture` = the AssetStore.texture record of its Texture2D (or
//                 null)
//   sprite(v), mesh(v), textureRecord(v)   AssetStore.sprite / mesh / texture
//   mono(v)       a MonoBehaviour asset: mono.json with `id` and `class` (the script class)
//   prefab(id)    a root GameObject as a Prefab (Prefab.fromObjects; `ids` = [id])
//   clip(id, prefab, path)        the AnimClip of clip `id` as the Animator at node `path` of the prefab or scene
//                                 root `prefab` (a GameObject id) plays it: its bindings named by the bindings tables
//                                 of the live's documents (AnimBindings); `rawName` = AnimationClip.name. The clips of
//                                 one AnimationClip share its events (AnimationClip.AddEvent changes the asset).
//   controller(v, prefab, path)   the AnimController of an AnimatorController with its clips (clip()); `clipList`:
//                                 the clips in the controller's order (runtimeAnimatorController.animationClips)
//   resolve(v)    a copy of a value with each reference to a Sprite, a Material or a MonoBehaviour replaced by
//                 sprite() / material() / the resolved mono() (other references kept)
//   shaderInfo(id)  the parsed Shader object
// With a GL context: `lib`, the ShaderLib over every Shader object of the store (by object id; `shaders` {Unity name:
// id} answers Shader.Find), and texture(id) -> Promise<GLTex>, the GL texture of a Texture2D object (uploaded once).
export class ObjectResources {
  constructor(assets, { bindings = [], shaders = {}, gl = null } = {}) {
    this.assets = assets;
    this.bindings = new AnimBindings(bindings);
    this.gl = gl;
    this.lib = gl ? ShaderLib.fromObjects(gl, shaders, assets) : null;
    this.shaderNames = shaders;
    this._materials = new Map();
    this._monos = new Map();
    this._prefabs = new Map();
    this._clips = new Map();
    this._events = new Map();         // clip id -> the events every AnimClip of it shares
    this._controllers = new Map();
    this._textures = new Map();
    this._profiles = new Map();
  }

  // the object id of a reference ({"$ref": ...}) or of an object id as a document gives it, checked to be in the store
  // (and of class `cls`); null for null
  id(v, cls = null) {
    if (typeof v !== "string") return this.assets.ref(v, cls);
    this.assets.object(v, cls);
    return v;
  }

  material(v) {
    const id = this.id(v, "Material");
    if (id === null) return null;
    let m = this._materials.get(id);
    if (!m) {
      const j = this.assets.material(id);
      const textures = Object.fromEntries(Object.entries(j.textures || {}).map(([k, t]) =>
        [k, { ...t, texture: t.texture ? this.textureRecord(t.texture) : null }]));
      m = { ...j, id, shader: refId(j.shader), textures };
      this._materials.set(id, m);
    }
    return m;
  }

  sprite(v) { const id = this.id(v, "Sprite"); return id === null ? null : this.assets.sprite(id); }
  mesh(v) { const id = this.id(v, "Mesh"); return id === null ? null : this.assets.mesh(id); }
  textureRecord(v) { const id = this.id(v, "Texture2D"); return id === null ? null : this.assets.texture(id); }

  mono(v) {
    const id = this.id(v, "MonoBehaviour");
    if (id === null) return null;
    let m = this._monos.get(id);
    if (!m) {
      const j = this.assets.mono(id);
      m = { ...j, id, class: scriptClass(j.$script) };
      this._monos.set(id, m);
    }
    return m;
  }

  resolve(v) {
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (!v || typeof v !== "object") return v;
    if (v.$ref !== undefined) {
      const id = refId(v), cls = this.assets.hasObject(id) ? this.assets.object(id).class : null;
      return cls === "Sprite" ? this.sprite(id) : cls === "Material" ? this.material(id)
        : cls === "MonoBehaviour" ? this.resolve(this.mono(id)) : v;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]));
  }

  shaderInfo(id) { this.assets.object(id, "Shader"); return this.assets.objectJson(id); }

  profile(v) {
    const id = this.id(v, "MonoBehaviour");
    if (id === null) return null;
    if (!this._profiles.has(id)) {
      const raw = this.mono(id);
      this._profiles.set(id, { id, name: raw.m_Name, components: raw.components.map((ref) => {
        const c = this.mono(ref);
        return { ...c, asset: c.class };
      }) });
    }
    return this._profiles.get(id);
  }

  rendererData(graphicsId, rendererIndex) {
    const graphics = this.assets.objectJson(graphicsId);
    const pipeline = this.mono(graphics.m_CustomRenderPipeline);
    const index = rendererIndex < 0 ? pipeline.m_DefaultRendererIndex : rendererIndex;
    return this.mono(pipeline.m_RendererDataList[index]);
  }

  grainTextures(graphicsId, rendererIndex) {
    const renderer = this.rendererData(graphicsId, rendererIndex);
    return this.mono(renderer.postProcessData).textures.filmGrainTex.map((ref) => this.id(ref, "Texture2D"));
  }

  uiBlur(graphicsId, rendererIndex) {
    const renderer = this.rendererData(graphicsId, rendererIndex);
    const feature = renderer.m_RendererFeatures.map((ref) => this.mono(ref))
      .find((m) => m.class === "UIRendererFeature");
    if (!feature) return null;
    return { enabled: !!feature.m_Active, renderer: rendererIndex, iterations: feature._blurIterations,
      offset: feature._blurOffset, downsample: feature._blurDownsample, blendRateMax: feature._blurBlendRateMax };
  }

  prefab(id) {
    let p = this._prefabs.get(id);
    if (!p) { p = Prefab.fromObjects(this.assets, [id], id); this._prefabs.set(id, p); }
    return p;
  }

  clip(id, prefab, path) {
    const k = `${id}\u0000${prefab}\u0000${path}`;
    let c = this._clips.get(k);
    if (!c) {
      const raw = this.assets.clip(id);
      c = AnimClip.fromObject(raw, this.bindings.names(prefab, path, id), raw.name);
      c.rawName = raw.name;
      if (this._events.has(id)) c.events = this._events.get(id); else this._events.set(id, c.events);
      this._clips.set(k, c);
    }
    return c;
  }

  controller(v, prefab, path) {
    const id = this.id(v, "AnimatorController");
    if (id === null) return null;
    const k = `${id}\u0000${prefab}\u0000${path}`;
    let ctrl = this._controllers.get(k);
    if (!ctrl) {
      const raw = this.assets.controller(id);
      const clip = (e) => this.clip(this.id(e, "AnimationClip"), prefab, path);
      ctrl = AnimController.fromMecanim(raw, clip);
      ctrl.clipList = raw.clips.map(clip);
      this._controllers.set(k, ctrl);
    }
    return ctrl;
  }

  texture(id) {
    if (!this.gl) throw new Error("ObjectResources: no GL context for textures");
    let t = this._textures.get(id);
    if (!t) { t = GLTex.loadObject(this.gl, id, this.assets); this._textures.set(id, t); }
    return t;
  }
}
