import { F, join } from "../../engine/core.js";
import { mat4 } from "../../engine/math.js";
import { URPPost } from "../../engine/postfx.js";
import { ADV_CANVAS_LAYER, StoryCommandError } from "../interfaces.js";
import { GLTarget, GLTex } from "../../engine/texture.js";
import { ShaderLib } from "../../engine/glsl.js";
import { UIDraw, UIMesh, uiColor32 } from "../../engine/ugui.js";
import { CanvasGL, CanvasNode, ScreenCanvas } from "./canvas.js";
import { DOTargets } from "./dotween.js";
import { featureSlot, featureState } from "./state.js";

// The camera canvases of UIAdvWidget below the front canvas, in their paint order (Canvas.sortingOrder): VideoCanvas
// 301, StillCanvas / VideoAndStillRenderScreenCanvas 302, FrameCanvas 303 (the front canvas is 304). AdvCanvasLayer is
// a data enum, not this order, so all of them draw from one view on the story UI's Still layer, the last layer drawn
// before the front canvas.
// VideoCanvas and StillCanvas are rendered by UIAdvWidget._videoAndStillCamera into a render texture of the screen size
// (cleared with the camera's background colour), which the RawImage _videoAndStillScreenImage on
// VideoAndStillRenderScreenCanvas (no active scaler: canvas units are pixels) shows; FrameCanvas is drawn directly.
// That camera (URP, HDR, post-processing on, antialiasing off, volume update mode of the pipeline asset: every frame)
// draws the two canvases into its HDR colour target and runs the post chain from there into the render texture
// (RenderTexture(screen size, depth 8, default format): 8-bit RGBA). Its volume mask is layer 11 (Adv), the layer of
// every ADV volume (AdvGlobalVolume's stage and warmup volumes, the PostEffect volumes), so it blends the same volumes
// as the main camera, evaluated when it renders; while a still is set UIAdvWidget.SuppressStillPostEffect sets the
// mask to 0 (component defaults only).
// ENGINE: with HDR and post-process alpha output allowed URP picks R16G16B16A16_SFloat for the colour target; UI
// shaders write no depth, so depth of field and motion blur read the cleared depth.
// The canvases, scalers, views, camera and screen image are ui/ui.json records (the story UI data).

export const SCREEN_CANVAS = Object.freeze({ video: 301, still: 302, frame: 303 });
export const SCREEN_CANVAS_PATH = Object.freeze({ video: "UIAdvWidget/VideoCanvas", still: "UIAdvWidget/StillCanvas",
                                                  frame: "UIAdvWidget/FrameCanvas" });
export const SCREEN_IMAGE_CANVAS = "UIAdvWidget/VideoAndStillRenderScreenCanvas";

// a full-stretch child view of a canvas (UIPart RectTransform)
export const stretchView = (parent, name) => new CanvasNode({
  path: `${parent.path}/${name}`, name, active: true, localPosition: { x: 0, y: 0, z: 0 },
  localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
  rect: { m_AnchorMin: { x: 0, y: 0 }, m_AnchorMax: { x: 1, y: 1 }, m_AnchoredPosition: { x: 0, y: 0 },
          m_SizeDelta: { x: 0, y: 0 }, m_Pivot: { x: 0.5, y: 0.5 } } }, parent);

// the story UI data (ui/ui.json) and its directory
export const storyUIDoc = (ctx) => featureSlot(ctx, "uiDoc", () => {
  const file = ctx.story && ctx.story.ui;
  if (!file) throw new StoryCommandError("the story data has no story UI (ui/ui.json)");
  const cut = file.lastIndexOf("/");
  return { doc: ctx.assets.json(file), dir: cut < 0 ? "" : file.slice(0, cut) };
});

export const uiNode = (doc, path) => {
  const rec = doc.nodes.find((n) => n.path === path);
  if (!rec) throw new StoryCommandError(`${path} is not in the story UI data`);
  return rec;
};

// A screen canvas of the story UI data: a Screen Space - Camera canvas with the expected paint order and a CanvasScaler
// (ScaleWithScreenSize) or Fwk.UI.ClampedCanvasScaler (the scale clamped past _maxAspectThreshold).
export const screenCanvasSettings = (doc, path, sortingOrder) => {
  const rec = uiNode(doc, path), c = rec.canvas, s = rec.canvasScaler;
  if (!c || !s) throw new StoryCommandError(`${path}: no canvas or canvas scaler in the story UI data`);
  if (!c.m_Enabled || c.m_RenderMode !== 1 || c.m_SortingOrder !== sortingOrder || c.m_OverrideSorting || c.m_PixelPerfect)
    throw new StoryCommandError(`${path}: canvas (render mode ${c.m_RenderMode}, sorting order ${c.m_SortingOrder}) is not the expected camera canvas`);
  if (!s.m_Enabled || s.m_UiScaleMode !== 1) throw new StoryCommandError(`${path}: canvas scaler mode ${s.m_UiScaleMode} not implemented`);
  const scaler = { m_UiScaleMode: 1, m_ReferenceResolution: { ...s.m_ReferenceResolution }, m_ScreenMatchMode: s.m_ScreenMatchMode,
                   m_MatchWidthOrHeight: s.m_MatchWidthOrHeight, m_ReferencePixelsPerUnit: s.m_ReferencePixelsPerUnit };
  if (s.class === "ClampedCanvasScaler") scaler._maxAspectThreshold = s._maxAspectThreshold;
  return { sortingOrder, scaler, camera: c.camera || null, planeDistance: c.m_PlaneDistance ?? null };
};

// the ADV viewport before the first draw (a headless session never draws): 13:6
export const REFERENCE_VIEWPORT = Object.freeze({ width: 2340, height: 1080 });

// The shaders of the screen canvases, packed in two places: the story's shaders/ (the frame, still and effect
// materials) and the story UI's (UI/Default, which every image without a material and the video masks use). A shader
// is read from the pack that has it.
class ShaderPacks {
  constructor(libs) { this.libs = libs; }
  _lib(name) {
    const l = this.libs.find((x) => x.index.has(name));
    if (!l) throw new StoryCommandError(`shader not packed: ${name}`);
    return l;
  }
  info(name) { return this._lib(name).info(name); }
  defaults(name, ...a) { return this._lib(name).defaults(name, ...a); }
  program(name, ...a) { return this._lib(name).program(name, ...a); }
  state(name, ...a) { return this._lib(name).state(name, ...a); }
}

const uiShaderBase = (doc, dir) => {
  const index = doc.shaders && doc.shaders.index;
  if (!index || !/\/shaders\.json$/.test(index)) throw new StoryCommandError("the story UI data has no shader index");
  return join(dir, index.replace(/\/shaders\.json$/, ""));
};

// UIAdvWidget._videoAndStillCamera as far as the canvases use it
const stillCamera = (doc) => {
  const cam = doc.videoAndStillCamera;
  if (!cam || !cam.camera) throw new StoryCommandError("the story UI data has no video and still camera");
  const c = cam.camera;
  if (!c.m_Enabled || c.m_ClearFlags !== 2) throw new StoryCommandError(`video and still camera: clear flags ${c.m_ClearFlags} not implemented`);
  const r = c.m_NormalizedViewPortRect;
  if (r.x !== 0 || r.y !== 0 || r.width !== 1 || r.height !== 1) throw new StoryCommandError("video and still camera: viewport rect not implemented");
  if (c.orthographic) throw new StoryCommandError("video and still camera: orthographic projection not implemented");
  const d = cam.additionalCameraData;
  if (!d) throw new StoryCommandError("video and still camera: no UniversalAdditionalCameraData in the story UI data");
  if (d.m_RenderPostProcessing !== 1 || d.m_Antialiasing !== 0 || !c.m_HDR)
    throw new StoryCommandError("video and still camera: post-processing / antialiasing / HDR settings not implemented");
  if (d.m_VolumeLayerMask.m_Bits !== ADV_VOLUME_LAYER_MASK)
    throw new StoryCommandError(`video and still camera: volume mask ${d.m_VolumeLayerMask.m_Bits} not implemented`);
  // UsePipelineSettings (2: the pipeline assets update the volumes every frame) or EveryFrame (0); not ViaScripting
  const mode = d.m_VolumeFrameworkUpdateModeOption;
  if (mode !== undefined && mode !== 2 && mode !== 0)
    throw new StoryCommandError(`video and still camera: volume update mode ${mode} not implemented`);
  return cam;
};

// layer 11 "Adv": the layer of every ADV volume
const ADV_VOLUME_LAYER_MASK = 1 << 11;

export class StoryScreen {
  constructor(ctx) {
    this.ctx = ctx;
    const { doc, dir } = storyUIDoc(ctx);
    this.ui = doc; this.uiDir = dir;
    this.camera = stillCamera(doc);
    this.canvases = Object.entries(SCREEN_CANVAS).map(([k, order]) => {
      const st = screenCanvasSettings(doc, SCREEN_CANVAS_PATH[k], order), c = new ScreenCanvas(SCREEN_CANVAS_PATH[k], st);
      if (k !== "frame") {
        if (st.camera !== this.camera.path) throw new StoryCommandError(`${c.name}: camera ${st.camera} is not the video and still camera`);
        c.perspective = { fov: this.camera.camera["field of view"] };
        c.planeDistance = st.planeDistance;
      }
      return [k, c];
    });
    this.canvas = Object.fromEntries(this.canvases);
    // the screen image: a stretched RawImage under a canvas without an active scaler
    const imgRec = uiNode(doc, doc.videoAndStillScreenImage), canvasRec = uiNode(doc, SCREEN_IMAGE_CANVAS);
    if (!imgRec.rawImage || !imgRec.path.startsWith(`${SCREEN_IMAGE_CANVAS}/`) || imgRec.path.split("/").length !== 3)
      throw new StoryCommandError("the video and still screen image is not a RawImage of its canvas");
    if (canvasRec.canvas.m_SortingOrder !== SCREEN_CANVAS.still || (canvasRec.canvasScaler && canvasRec.canvasScaler.m_Enabled))
      throw new StoryCommandError(`${SCREEN_IMAGE_CANVAS}: canvas settings not implemented`);
    this.screenCanvas = new ScreenCanvas(SCREEN_IMAGE_CANVAS, { sortingOrder: SCREEN_CANVAS.still, scaler: null });
    this.screenImage = new CanvasNode(imgRec, this.screenCanvas.root);
    this.screenImage.rawImage = { ...imgRec.rawImage };
    if (this.screenImage.rawImage.material) throw new StoryCommandError("video and still screen image: material not implemented");
    this.dotween = new DOTargets();       // DOKill targets of the canvas tweens
    this.animators = [];                  // CanvasAnimator, updated in the animation phase
    this.updaters = [];                   // MonoBehaviour Updates (update phase): fn(dt)
    this.itemSources = [];                // (canvas, node, alpha) -> extra draw items (particles)
    this.gl = null;
    this.target = null;                   // the camera's render texture
    this.cameraColor = null;              // the camera's HDR colour target
    this.post = null;                     // the camera's post chain (URPPost: its own LUT, bokeh kernel, motion data)
    this._hooks = [];
    const on = (phase, fn) => { ctx.loop.on(phase, fn); this._hooks.push([phase, fn]); };
    on("update", (loop) => { for (const u of this.updaters) u(loop.deltaTime); });
    on("animation", (loop) => { for (const a of this.animators) a.update(loop.deltaTime); });
    this.view = { render: (args) => this.render(args) };
    ctx.ui.layers[ADV_CANVAS_LAYER.Still].add(this.view);
  }

  async load() {
    const ctx = this.ctx;
    if (!ctx.gl) return;
    const libs = [new ShaderLib(ctx.gl, "shaders", ctx.assets), new ShaderLib(ctx.gl, uiShaderBase(this.ui, this.uiDir), ctx.assets)];
    const packs = new ShaderPacks(libs);
    this.gl = new CanvasGL(ctx.gl, packs, ctx.assets);
    await this.gl.load(GLTex, this.canvases.map(([, c]) => c));
    const R = ctx.renderer;
    if (!R) throw new StoryCommandError("the video and still camera's post-processing needs the story renderer");
    this.post = new URPPost(ctx.gl, packs);
    this.post.volumeTextures = R.post.volumeTextures;     // the textures of the volume profiles (loadPostEffects)
    this.post.initLut();                                  // its own colour curves and internal LUT
  }

  // the size of a camera canvas in canvas units: its last layout, else at the reference viewport
  canvasSizeOf(kind) {
    const c = this.canvas[kind];
    if (c.size) return c.size;
    const { W, H } = c.canvasSize(REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height);
    return { W, H };
  }

  // world units per canvas unit of a camera canvas (the canvas' lossy scale): the view height at the plane distance
  // over the canvas height
  worldPerCanvasUnit(kind) {
    const c = this.canvas[kind];
    if (!c.perspective || !(c.planeDistance > 0)) throw new StoryCommandError(`${c.name}: no perspective camera plane distance`);
    const tan = F(Math.tan(F(c.perspective.fov * 0.5) * Math.PI / 180));
    return F(F(F(2 * c.planeDistance) * tan) / this.canvasSizeOf(kind).H);
  }

  // the camera's volume stack when it renders: the ADV volumes (layer 11), none while a still suppresses them
  cameraStack() {
    const st = featureState(this.ctx).still, suppressed = !!st && st.postEffectSuppressed;
    return suppressed ? URPPost.evaluateStack([]) : this.ctx.volume.evaluateStack();
  }

  _cameraColor(gl, width, height) {
    const c = this.cameraColor;
    if (c && c.width === width && c.height === height) return c;
    if (c) c.release();
    this.cameraColor = new GLTarget(gl, width, height, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
                                                         depth: true, label: "VideoAndStillCamera.CameraColor" });
    this.post.resizeBloom(width, height);
    return this.cameraColor;
  }

  // the camera's matrices for depth of field and motion blur: it does not move, so only the projection matters
  _cameraMatrices(width, height) {
    const c = this.camera.camera, near = c["near clip plane"], far = c["far clip plane"];
    return { view: mat4.identity(), proj: mat4.perspective(c["field of view"], width / height, near, far), near, far };
  }

  // draw items of other graphics on a node (particles), in hierarchy order after the node's own graphic
  _extra(n, alpha) {
    const out = [];
    for (const f of this.itemSources) out.push(...f(n, alpha));
    return out;
  }

  _renderTarget(gl, width, height) {
    if (this.target && (this.target.width !== width || this.target.height !== height)) { this.target.release(); this.target = null; }
    if (!this.target) this.target = new GLTarget(gl, width, height, { depth: true, label: "UIAdvWidget.VideoAndStill.RenderTexture" });
    return this.target;
  }

  // RawImage.OnPopulateMesh over the screen image rect; uvRect = the ADV viewport in the screen (the whole target)
  _screenItem() {
    const n = this.screenImage, r = n.rect, m = new UIMesh(), c = uiColor32(n.rawImage.m_Color);
    m.addQuad(r.x, r.y, r.x + r.w, r.y + r.h, c, 0, 0, 1, 1);
    return { node: n, material: null, glTex: () => this.target, verts: UIDraw.pack(m.verts, n, 1), idx: Uint32Array.from(m.idx) };
  }

  render({ gl, width, height }) {
    this.layoutAll(width, height);
    if (!gl || !this.gl) return;
    gl.disable(gl.SCISSOR_TEST);
    const cam = ["video", "still"].map((k) => [this.canvas[k], this.canvas[k].drawItems((n, a) => this._extra(n, a))]);
    if (cam.some(([, items]) => items.length)) {
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
      const color = this._cameraColor(gl, width, height);
      color.bind();
      const bg = this.camera.camera.m_BackGroundColor;
      gl.colorMask(true, true, true, true);
      gl.clearColor(bg.r, bg.g, bg.b, bg.a);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);   // clear flags SolidColor
      for (const [c, items] of cam) this.gl.draw(c, items, width, height);
      const R = this.ctx.renderer;
      this.post.render(this.cameraStack(), color, this._renderTarget(gl, width, height),
                       { width, height, frameCount: this.ctx.loop.frameCount, grain: R.grain, gray: R.tex.gray,
                         black: R.tex.black, camera: this._cameraMatrices(width, height) });
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      this.gl.draw(this.screenCanvas, [this._screenItem()], width, height);
    }
    const frame = this.canvas.frame;
    this.gl.draw(frame, frame.drawItems((n, a) => this._extra(n, a)), width, height);
  }

  // layout without drawing (the canvas sizes of a viewport): the headless session never renders
  layoutAll(width, height) {
    for (const [, c] of this.canvases) { const { W, H } = c.canvasSize(width, height); c.layout(W, H); }
    this.screenCanvas.layout(width, height);
  }

  dispose() {
    const ctx = this.ctx;
    this.dotween.killAll();
    for (const [phase, fn] of this._hooks) { const hs = ctx.loop.hooks[phase], i = hs.indexOf(fn); if (i >= 0) hs.splice(i, 1); }
    ctx.ui.layers[ADV_CANVAS_LAYER.Still].remove(this.view);
    if (this.target) this.target.release();
    if (this.cameraColor) this.cameraColor.release();
    if (this.gl) this.gl.dispose();
  }
}

export const storyScreen = (ctx) => featureSlot(ctx, "screen", () => {
  const s = new StoryScreen(ctx);
  featureState(ctx).disposers.push(() => s.dispose());
  return s;
});
