import { F } from "../../engine/core.js";
import { mat4 } from "../../engine/math.js";
import { URPPost } from "../../engine/postfx.js";
import { ADV_CANVAS_LAYER, StoryCommandError } from "../interfaces.js";
import { GLTarget, GLTex } from "../../engine/texture.js";
import { UIDraw, UIMesh, uiColor32 } from "../../engine/ugui.js";
import { CanvasGL, CanvasNode, ScreenCanvas, compOf } from "./canvas.js";
import { DOTargets } from "./dotween.js";
import { featureSlot, featureState } from "./state.js";
import { CanvasParticles } from "./uiparticle.js";

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
// The canvases, scalers, views, camera and screen image are story.ui records (the story UI data).

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

// the story UI data (story.ui) and its directory
export const storyUIDoc = (ctx) => featureSlot(ctx, "uiDoc", () => {
  const id = ctx.data.ui.widget;
  return { doc: ctx.assets.prefab(id), prefab: ctx.objects.prefab(id) };
});

export const uiNode = (doc, path) => {
  const rec = doc.nodes.find((n) => n.path === path);
  if (!rec) throw new StoryCommandError(`${path} is not in the story UI data`);
  return rec;
};

// A screen canvas of the story UI data: a Screen Space - Camera canvas with the expected paint order and a CanvasScaler
// (ScaleWithScreenSize) or Fwk.UI.ClampedCanvasScaler (the scale clamped past _maxAspectThreshold).
export const screenCanvasSettings = (doc, path, sortingOrder, prefab, objects) => {
  const rec = uiNode(doc, path), c = compOf(rec, "Canvas");
  const clamped = compOf(rec, "ClampedCanvasScaler"), s = clamped || compOf(rec, "CanvasScaler");
  if (!c || !s) throw new StoryCommandError(`${path}: no canvas or canvas scaler in the story UI data`);
  if (!c.m_Enabled || c.m_RenderMode !== 1 || c.m_SortingOrder !== sortingOrder || c.m_OverrideSorting || c.m_PixelPerfect)
    throw new StoryCommandError(`${path}: canvas (render mode ${c.m_RenderMode}, sorting order ${c.m_SortingOrder}) is not the expected camera canvas`);
  if (!s.m_Enabled || s.m_UiScaleMode !== 1) throw new StoryCommandError(`${path}: canvas scaler mode ${s.m_UiScaleMode} not implemented`);
  const scaler = { m_UiScaleMode: 1, m_ReferenceResolution: { ...s.m_ReferenceResolution }, m_ScreenMatchMode: s.m_ScreenMatchMode,
                   m_MatchWidthOrHeight: s.m_MatchWidthOrHeight, m_ReferencePixelsPerUnit: s.m_ReferencePixelsPerUnit };
  if (clamped) scaler._maxAspectThreshold = s._maxAspectThreshold;
  return { sortingOrder, scaler, camera: !c.m_Camera ? null : c.m_Camera.$ref ? objects.assets.contained(c.m_Camera).path : prefab.pathOf(c.m_Camera), planeDistance: c.m_PlaneDistance ?? null };
};

// the ADV viewport before the first draw (a headless session never draws): 13:6
export const REFERENCE_VIEWPORT = Object.freeze({ width: 2340, height: 1080 });

// UIAdvWidget._videoAndStillCamera as far as the canvases use it
const stillCamera = (prefab) => {
  const widget = prefab.find("UIAdvWidget").c.fields;
  const path = prefab.pathOf(widget._videoAndStillCamera), c = prefab.fields(path, "Camera");
  const cam = { path, camera: c, additionalCameraData: prefab.fields(path, "UniversalAdditionalCameraData") };
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
    const { doc, prefab } = storyUIDoc(ctx);
    this.ui = doc;
    this.camera = stillCamera(prefab);
    this.canvases = Object.entries(SCREEN_CANVAS).map(([k, order]) => {
      const st = screenCanvasSettings(doc, SCREEN_CANVAS_PATH[k], order, prefab, ctx.objects), c = new ScreenCanvas(SCREEN_CANVAS_PATH[k], st, ctx.objects);
      if (k !== "frame") {
        if (st.camera !== this.camera.path) throw new StoryCommandError(`${c.name}: camera ${st.camera} is not the video and still camera`);
        c.perspective = { fov: this.camera.camera["field of view"] };
      }
      c.planeDistance = st.planeDistance;
      return [k, c];
    });
    this.canvas = Object.fromEntries(this.canvases);
    // the screen image: a stretched RawImage under a canvas without an active scaler
    const widget = prefab.find("UIAdvWidget").c.fields;
    const imgRec = uiNode(doc, prefab.pathOf(widget._videoAndStillScreenImage)), canvasRec = uiNode(doc, SCREEN_IMAGE_CANVAS);
    const rawImage = compOf(imgRec, "RawImage"), scaler = compOf(canvasRec, "CanvasScaler");
    if (!rawImage || !imgRec.path.startsWith(`${SCREEN_IMAGE_CANVAS}/`) || imgRec.path.split("/").length !== 3)
      throw new StoryCommandError("the video and still screen image is not a RawImage of its canvas");
    if (compOf(canvasRec, "Canvas").m_SortingOrder !== SCREEN_CANVAS.still || (scaler && scaler.m_Enabled))
      throw new StoryCommandError(`${SCREEN_IMAGE_CANVAS}: canvas settings not implemented`);
    this.screenCanvas = new ScreenCanvas(SCREEN_IMAGE_CANVAS, { sortingOrder: SCREEN_CANVAS.still, scaler: null }, ctx.objects);
    this.screenImage = new CanvasNode(imgRec, this.screenCanvas.root);
    this.screenImage.rawImage = { ...rawImage };
    if (this.screenImage.rawImage.m_Material) throw new StoryCommandError("video and still screen image: material not implemented");
    // UIAdvWidget.InitVideoSeekFreezeOverlay: "VideoSeekFreeze" on the screen image's parent with the screen image's
    // anchors, position, size and pivot (unrotated, unit scale), a RawImage without raycasts under a CanvasGroup at
    // alpha 0, last sibling, inactive
    const si = this.screenImage, v2 = (q) => ({ x: q.x, y: q.y });
    this.freeze = new CanvasNode({ path: `${SCREEN_IMAGE_CANVAS}/VideoSeekFreeze`, name: "VideoSeekFreeze", active: false,
      localPosition: { x: 0, y: 0, z: 0 }, localRotation: { x: 0, y: 0, z: 0, w: 1 }, localScale: { x: 1, y: 1, z: 1 },
      rect: { m_AnchorMin: v2(si.anchorMin), m_AnchorMax: v2(si.anchorMax), m_AnchoredPosition: v2(si.anchoredPosition),
              m_SizeDelta: v2(si.sizeDelta), m_Pivot: v2(si.pivot) },
      canvasGroup: { m_Enabled: 1, m_Alpha: 0, m_IgnoreParentGroups: 0 } }, this.screenCanvas.root);
    this.freezeTarget = null;             // _videoSeekFreezeTexture
    this.freezeVisible = false;           // _isVideoSeekFreezeVisible
    this._freezeCopy = false;             // a copy of the render texture due at the next draw
    this._freezeCopied = false;           // the overlay shows that copy
    this._cameraDrawn = false;            // the last draw drew the camera's canvases into the render texture
    this._viewport = null;                // the size of the last draw
    this.dotween = new DOTargets();       // DOKill targets of the canvas tweens
    this.animators = [];                  // CanvasAnimator, updated in the animation phase
    this.updaters = [];                   // MonoBehaviour Updates (update phase): fn(dt)
    this.itemSources = [];                // (node, alpha) -> extra draw items (particles)
    this.frameParticles = null;           // the frame canvas' UIParticles (CanvasParticles), with the first prefab that has any
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
    this.gl = new CanvasGL(ctx.gl, ctx.objects, ctx.ui);
    await this.gl.load(GLTex, this.canvases.map(([, c]) => c));
    const R = ctx.renderer;
    if (!R) throw new StoryCommandError("the video and still camera's post-processing needs the story renderer");
    this.post = new URPPost(ctx.gl, ctx.objects.lib);
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

  // The UIParticles of a camera canvas (uiparticle.js): the frame canvas, rendered by the UI camera (the story UI data's
  // uiCamera, read at the first draw)
  canvasParticles(kind) {
    if (kind !== "frame") throw new StoryCommandError(`${this.canvas[kind].name}: canvas particles not implemented`);
    if (!this.frameParticles) {
      const cp = this.frameParticles = new CanvasParticles(this.ctx, this.canvas.frame, () => {
        const manager = this.ctx.objects.prefab(this.ctx.data.ui.uiManager);
        return manager.find("Camera").c.fields;
      });
      this.itemSources.push((n, a) => cp.itemsOf(n, a));
    }
    return this.frameParticles;
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

  // UIAdvWidget.TryShowVideoSeekFreeze(alpha): the render texture blitted into the overlay's texture (made again at
  // another size, "UIAdvWidget.VideoSeekFreeze.RenderTexture", no depth), the overlay given the screen image's uvRect
  // and rect, active and last, its group at alpha; true. The game's render texture always exists, so this returns
  // true drawn or not. The copy is made at the next draw, before the camera draws: nothing draws into the render
  // texture in between.
  tryShowVideoSeekFreeze(alpha) {
    const si = this.screenImage, n = this.freeze;
    for (const k of ["anchorMin", "anchorMax", "anchoredPosition", "sizeDelta", "pivot"]) n[k] = { ...si[k] };
    n.activeSelf = true;
    n.setParentLast(this.screenCanvas.root);
    n.canvasGroup.alpha = F(alpha);
    this._freezeCopy = true;
    this.freezeVisible = true;
    return true;
  }

  // UIAdvWidget.ClearVideoSeekFreeze: the group's tweens killed and its alpha 0, the overlay inactive without a
  // texture (its render texture kept). Also run on a viewport change (OnAdvViewportChanged, OnResolutionChanged) and
  // by UIAdvWidget.Refresh (the overlay starts cleared here).
  clearVideoSeekFreeze() {
    const n = this.freeze;
    this.dotween.kill(n.canvasGroup);
    n.canvasGroup.alpha = 0;
    n.activeSelf = false;
    this._freezeCopy = false; this._freezeCopied = false;
    this.freezeVisible = false;
  }

  // Graphics.Blit(render texture, overlay texture): the frame the last draw left; a last draw without the camera's
  // canvases drew no screen image either, so the overlay has nothing to show then
  _copyVideoSeekFreeze(gl) {
    this._freezeCopy = false;
    const src = this._cameraDrawn ? this.target : null;
    this._freezeCopied = !!src;
    if (!src) return;
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    let t = this.freezeTarget;
    if (t && (t.width !== src.width || t.height !== src.height)) { t.release(); t = null; }
    if (!t) t = this.freezeTarget = new GLTarget(gl, src.width, src.height, { label: "UIAdvWidget.VideoSeekFreeze.RenderTexture" });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
  }

  // the overlay's RawImage over its rect: white, the copy, the screen image's uvRect (the whole texture), under its
  // group's alpha
  _freezeItems() {
    const n = this.freeze;
    if (!n.activeSelf || !this._freezeCopied) return [];
    const r = n.rect, m = new UIMesh();
    m.addQuad(r.x, r.y, r.x + r.w, r.y + r.h, [255, 255, 255, 255], 0, 0, 1, 1);
    return [{ node: n, material: null, glTex: () => this.freezeTarget, verts: UIDraw.pack(m.verts, n, n.canvasGroup.alpha),
              idx: Uint32Array.from(m.idx) }];
  }

  render({ gl, width, height }) {
    const vp = this._viewport;
    if (vp && (vp.w !== width || vp.h !== height)) this.clearVideoSeekFreeze();
    this._viewport = { w: width, h: height };
    this.layoutAll(width, height);
    if (!gl || !this.gl) return;
    if (this._freezeCopy) this._copyVideoSeekFreeze(gl);
    gl.disable(gl.SCISSOR_TEST);
    const cam = ["video", "still"].map((k) => [this.canvas[k], this.canvas[k].drawItems((n, a) => this._extra(n, a))]);
    this._cameraDrawn = cam.some(([, items]) => items.length);
    if (this._cameraDrawn) {
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), port = gl.getParameter(gl.VIEWPORT);
      const color = this._cameraColor(gl, width, height);
      color.bind();
      const bg = this.camera.camera.m_BackGroundColor;
      // clear flags SolidColor: colour, depth and stencil cleared whole, whatever write masks the last draw left
      gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMask(0xff);
      gl.clearColor(bg.r, bg.g, bg.b, bg.a);
      gl.clearDepth(1); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      for (const [c, items] of cam) this.gl.draw(c, items, width, height);
      const R = this.ctx.renderer;
      this.post.render(this.cameraStack(), color, this._renderTarget(gl, width, height),
                       { width, height, frameCount: this.ctx.loop.frameCount, ...R.grainOptions(), gray: R.tex.gray,
                         black: R.tex.black, camera: this._cameraMatrices(width, height) });
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.viewport(port[0], port[1], port[2], port[3]);
      this.gl.draw(this.screenCanvas, [this._screenItem(), ...this._freezeItems()], width, height);
    } else {
      const freeze = this._freezeItems();
      if (freeze.length) this.gl.draw(this.screenCanvas, freeze, width, height);
    }
    const frame = this.canvas.frame;
    if (this.frameParticles) this.frameParticles.refresh(this.ctx.loop);
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
    if (this.freezeTarget) this.freezeTarget.release();
    if (this.cameraColor) this.cameraColor.release();
    if (this.gl) this.gl.dispose();
  }
}

export const storyScreen = (ctx) => featureSlot(ctx, "screen", () => {
  const s = new StoryScreen(ctx);
  featureState(ctx).disposers.push(() => s.dispose());
  return s;
});
