import { mat4, quat, Transform } from "../../engine/math.js";
import { GLTarget, GLTex } from "../../engine/texture.js";
import { Live2DDrawing } from "../../live2d/drawing.js";
import { SIMPLE_RT_SIZE, SIMPLE_STAGE_POSITION } from "./define.js";

// The character captures of the simple player: per slot a CameraTargetRenderer (Fwk.Rendering; prefab
// Common/Prefab/CameraTargetRenderer: Container / CaptureCamera, Container / Stage) with its own 1536 x 1536 render
// texture; the slot's character hangs under the stage and is the only thing its camera sees (the culling mask is the
// slot's layer). Each capture is drawn with the character's own Live2D shaders (lighting off: Slot.Show), then shown by
// the slot's RawImage (view.js).
//
// ENGINE: the capture RenderTexture is R8G8B8A8_UNorm with a D16 depth buffer; RGBA8 with a 24-bit depth / stencil
// renderbuffer here (the characters' shaders do not test depth).

const DEFAULT_CAMERA_TARGET = {             // the prefab values (used when the story has no host data)
  container: { localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 } },
  stage: { localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 } },
  camera: { localPosition: { x: 0, y: 0, z: -1 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, fieldOfView: 60, near: 0.3,
            far: 1000, orthographic: false, orthographicSize: 0.6, clearFlags: 2,
            backgroundColor: { r: 0.1921568661928177, g: 0.3019607961177826, b: 0.4745098054409027, a: 0 } },
};

const setTRS = (t, rec) => {
  t.localPosition = { ...rec.localPosition };
  t.localRotation = rec.localRotation ? { ...rec.localRotation } : quat.identity();
  t.localScale = rec.localScale ? { ...rec.localScale } : { x: 1, y: 1, z: 1 };
};

// One CameraTargetRenderer: Init(runtimeParent) under the runtime parent; the stage at s_stageLocalPosition with the
// capture scale (ApplyCaptureScale: max(scale, 0.01))
export class CameraTargetRenderer {
  constructor(index, parent, desc = DEFAULT_CAMERA_TARGET) {
    this.index = index; this.desc = desc;
    this.root = new Transform(`CameraTargetRenderer_${index}`, parent);
    this.container = new Transform("Container", this.root);
    this.camera = new Transform("CaptureCamera", this.container);
    this.stage = new Transform("Stage", this.container);
    setTRS(this.container, desc.container); setTRS(this.camera, desc.camera); setTRS(this.stage, desc.stage);
    this.stage.localPosition = { ...SIMPLE_STAGE_POSITION };
    this.target = null;                                                  // GLTarget (with a GL context)
    this.active = false;
  }

  applyCaptureScale(scale) { const s = Math.max(scale, 0.01); this.stage.localScale = { x: s, y: s, z: s }; }

  // Unity worldToCameraMatrix (view space looks down -z) and the camera's projection at the target's aspect (1)
  viewMatrix() { return mat4.mul(mat4.scale(1, 1, -1), mat4.inverseRigid(this.camera.localToWorld())); }
  projection() {
    const c = this.desc.camera;
    if (c.orthographic) throw new Error("CameraTargetRenderer: orthographic capture camera not implemented");
    return mat4.perspective(c.fieldOfView, 1, c.near, c.far);
  }
}

export const cameraTargetDesc = (host) => (host && host.cameraTarget ? host.cameraTarget : DEFAULT_CAMERA_TARGET);

// The GL side: Live2D drawings of the loaded characters and the slots' capture textures.
export class SimpleCaptureRenderer {
  // lib: the ShaderLib of the story's shaders (the characters' materials); resources: scene.json resources (the
  // Cubism mask materials); assets: the story's AssetStore
  constructor(gl, lib, resources, loop, { assets } = {}) {
    this.gl = gl; this.lib = lib; this.resources = resources; this.loop = loop; this.assets = assets;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is required");
    gl.frontFace(gl.CW);                    // Unity's front-face convention with its world-to-camera matrix
    this.drawings = new Map();              // Live2DCharacter -> Live2DDrawing
    this.white = null;
  }

  addCharacter(ch, dir) {
    const g = new Live2DDrawing(this.gl, this.lib, ch, { dir, resources: this.resources, white: this.white, assets: this.assets });
    this.drawings.set(ch, g);
    return g;
  }

  async load() {
    this.white = GLTex.solid(this.gl, [255, 255, 255, 255], "white");
    for (const g of this.drawings.values()) { g.white = this.white; await g.loadTextures(); g.prepare(); }
  }

  // Slot.EnsureInitialized: the slot's render texture "SimpleAdvView_{index}"
  ensureTarget(crt) {
    if (crt.target) return crt.target;
    crt.target = new GLTarget(this.gl, SIMPLE_RT_SIZE, SIMPLE_RT_SIZE, { depth: true, label: `SimpleAdvView_${crt.index}` });
    return crt.target;
  }

  // the capture of each active camera target with its character: clear to the camera's background colour (solid
  // colour clear flags), the character's drawables as URP's transparent queue (sorting order, then back to front)
  render(targets) {
    const gl = this.gl;
    for (const g of this.drawings.values()) g.renderMasks();              // CubismMaskCommandBuffer, before cameras
    for (const { crt, character } of targets) {
      if (!crt.active || !character || !character.isShowing) continue;
      const rt = this.ensureTarget(crt), d = this.drawings.get(character);
      if (!d) continue;
      const cam = crt.desc.camera, bg = cam.backgroundColor;
      rt.bind();
      gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.depthMask(true);
      gl.clearColor(bg.r, bg.g, bg.b, bg.a); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const V = crt.viewMatrix(), P = crt.projection(), camPos = crt.camera.worldPosition(), t = this.loop.time;
      const globals = {
        _ProjectionParams: [1, cam.near, cam.far, 1 / cam.far], unity_MatrixVP: mat4.mul(P, V), unity_MatrixV: V,
        _Time: [t / 20, t, t * 2, t * 3], _GlobalMipBias: [0, 0], _ScreenParams: [rt.width, rt.height, 1 + 1 / rt.width, 1 + 1 / rt.height],
        _MainLightPosition: [0, 0, 1, 0], _MainLightColor: [0, 0, 0, 0],
        _AdditionalLightsCount: [0, 0, 0, 0], _AdditionalLightsPosition: new Float32Array(64),
        _AdditionalLightsColor: new Float32Array(64), _AdditionalLightsAttenuation: new Float32Array(64),
        _AdditionalLightsSpotDir: new Float32Array(64),
      };
      const frame = { globals, perObject: (tr) => ({ unity_ObjectToWorld: tr.localToWorld(), unity_SHAr: [0, 0, 0, 1],
        unity_SHAg: [0, 0, 0, 1], unity_SHAb: [0, 0, 0, 1], unity_SHBr: [0, 0, 0, 0], unity_SHBg: [0, 0, 0, 0],
        unity_SHBb: [0, 0, 0, 0], unity_SHC: [0, 0, 0, 0], unity_LightData: [0, 0, 0, 0] }) };
      const dist = (tr) => { const p = tr.worldPosition(); return Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z); };
      const items = d.items([]).map((it) => ({ ...it, dist: dist(it.transform) }));
      items.sort((a, b) => (a.sortingOrder - b.sortingOrder) || (b.dist - a.dist));
      for (const it of items) it.draw(frame);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(targets) {
    for (const { crt } of targets) if (crt.target) { crt.target.release(); crt.target = null; }
    if (this.white) this.gl.deleteTexture(this.white.glTexture);
  }
}
