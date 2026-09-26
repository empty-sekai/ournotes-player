import { F } from "../engine/core.js";
import { GLTex } from "../engine/texture.js";
import { UIDraw, UIImage, UILayout, UIMesh, UINode, UISprite, uiColor32 } from "../engine/ugui.js";
import { LiveCopyProgram, LiveLightWeightBackground } from "./background.js";
import { LiveLane, LiveLaneLayout } from "./lane.js";
import { liveMaterialSheets } from "./renderer.js";

// LiveRenderCanvas: the LiveMainCamera canvas of screen mode 3 (LightWeight) and URP's final blit to the screen.
//   Live/RenderCanvas (ScreenSpaceCamera on LiveMainCamera, plane distance 10, sorting order 5500 = 55 -> table,
//   CanvasScaler ConstantPixelSize 1: canvas units = screen pixels), children in hierarchy order:
//     LightWeightBackgroundStageImage  RawImage (Default UI Material = UI/Default), texture = blur_result (RGB565),
//                                      AspectRatioFitter EnvelopeParent (aspect = tex w / h), start-timeline scale
//     LightWeightBackgroundShadowImage Image black, sprite live_game_white, CanvasGroup alpha 1 - BackgroundBrightness
//     InGameRawImage                   RawImage UI/Default, texture LiveGameView_InGame (premultiplied -> alpha twice)
//     EffectRawImage                   RawImage EffectRawImageMaterial (UI/Additive), texture LiveGameView_Effect
//   MVImage, LightWeightCompositeRoot and the support-card image stay off in mode 3
//   (LiveViewPresenter.FullInitialize).
// Not drawn, with the reason:
//   Live/LiveBackgroundView/Canvas (letterbox) and the RenderTexture_Screen quad: LiveBackgroundView is disabled in
//   LightWeight mode (LiveBackgroundViewPresenter.Setup), so there are no letterbox bands at any aspect.
//   Live/ShadowCanvas/shadow_image (order 1000, alpha stays at the serialized 0.20 in mode 3): drawn before
//   RenderCanvas and always fully covered by the stage image (RGB565 texture -> a = 1, white RawImage, EnvelopeParent
//   rect >= screen at every timeline scale >= 1), whose UI/Default output replaces the destination (One,
//   OneMinusSrcAlpha with a = 1): it cannot change a pixel.
// Canvas drawing follows UIDraw (engine/ugui.js): canvas-space vertices, ortho P over the canvas,
// unity_GUIZTestMode LEqual for a camera canvas.

export class LiveRenderCanvas {
  constructor(renderer) {
    this.r = renderer; this.gl = renderer.gl; this.lib = renderer.lib; this.prefab = renderer.prefab; this.scene = renderer.scene;
    this.ROOT = "Live/RenderCanvas";
    this.canvasComp = this.prefab.component(this.ROOT, "Canvas");
    this.sortingOrder = LiveLane.sortingOrder(this.prefab, this.ROOT, this.canvasComp.m_SortingOrder);
    // UINode tree of the canvas (CanvasGroup components folded into the records UINode reads)
    const nodes = new Map();
    for (const [path, e] of this.prefab.nodes) {
      if (path !== this.ROOT && !path.startsWith(`${this.ROOT}/`)) continue;
      const cg = e.node.components.find((c) => c.type === "CanvasGroup");
      const parent = path === this.ROOT ? null : nodes.get(path.slice(0, path.lastIndexOf("/")));
      nodes.set(path, new UINode({ ...e.node, canvasGroup: cg }, parent));
    }
    this.nodes = nodes;
    this.root = nodes.get(this.ROOT);
    const n = (k) => nodes.get(`${this.ROOT}/${k}`);
    this.stage = n("LightWeightBackgroundStageImage");
    this.shadow = n("LightWeightBackgroundShadowImage");
    this.inGame = n("InGameRawImage");
    this.effect = n("EffectRawImage");
    // LiveViewPresenter.FullInitialize, mode 3, no MV ids, BackgroundSwitch 0 (no snap)
    for (const k of ["LightWeightBackgroundStageImage", "LightWeightBackgroundShadowImage"]) n(k).activeSelf = true;
    for (const k of ["LightWeightCompositeRoot", "LightWeightBackgroundSuppertCardImage", "MVImage"]) n(k).activeSelf = false;
    this.configure(renderer.settings);
    const comp = (node, cls) => this.prefab.component(node.path, cls);
    this.graphics = new Map([
      [this.stage, { kind: "raw", g: comp(this.stage, "RawImage") }],
      [this.shadow, { kind: "image", g: comp(this.shadow, "Image") }],
      [this.inGame, { kind: "raw", g: comp(this.inGame, "RawImage") }],
      [this.effect, { kind: "raw", g: comp(this.effect, "RawImage") }],
    ]);
    this.fitter = comp(this.stage, "AspectRatioFitter");
  }

  _material(m) {                            // m_Material null -> Default UI Material (UI/Default, property defaults)
    const mat = m || { material: "Default UI Material", shader: { shader: "UI/Default" }, keywords: [], floats: {}, colors: {} };
    return liveMaterialSheets(this.lib, mat, this.r.tex);
  }

  // LiveViewPresenter.FullInitialize -> SetLightWeightBackgroundBrightness: shadow CanvasGroup alpha = 1 -
  // GetBackgroundBrightness01 = 1 - clamp01(option 201 / 100), set once (a constant of the canvas draw).
  // settings: the live settings or undefined (the data's preset-1 default).
  configure(settings) {
    const v = settings && settings.BackgroundBrightness !== undefined ? settings.BackgroundBrightness
      : Number(LiveLaneLayout.option(this.scene, "BackgroundBrightness"));
    const bright = Math.min(1, Math.max(0, v / 100));
    this.shadow.canvasGroup.alpha = F(1 - F(bright));
  }

  async load() {
    const gl = this.gl;
    this.bg = await LiveLightWeightBackground.build(gl, this.lib, this.scene, this.prefab, this.r.base, this.r.vao);
    const sp = this.graphics.get(this.shadow).g.m_Sprite;
    const atlas = await GLTex.load(gl, this.r.base, sp.texture);
    this.shadowSprite = new UISprite(sp.sprite, { ...sp, pixelsPerUnit: sp.pixelsToUnits }, atlas);
    this.buf = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
    for (const [node, e] of this.graphics) e.mat = this._material(e.g.m_Material);
    // AspectRatioFitter.aspectRatio = (float)tex.width / (float)tex.height of the composite (FullInitialize)
    this.aspect = F(F(this.bg.target.width) / F(this.bg.target.height));
    this.copy = LiveCopyProgram.create(gl);
  }

  resize(W, H) { this.size = { W, H }; }

  // AspectRatioFitter.UpdateRect, EnvelopeParent (4): anchors (0,0)-(1,1), anchoredPosition 0, sizeDelta from the
  // parent rect P and the aspect a (uGUI AspectRatioFitter.cs).
  _fit(P) {
    const n = this.stage, a = this.aspect;
    n.anchorMin = { x: 0, y: 0 }; n.anchorMax = { x: 1, y: 1 }; n.anchoredPosition = { x: 0, y: 0 };
    n.sizeDelta = F(P.h * a) < P.w ? { x: 0, y: F(F(P.w / a) - P.h) } : { x: F(F(P.h * a) - P.w), y: 0 };
  }

  _items(W, H) {
    const tex = { [this.stage.path]: this.bg.target, [this.inGame.path]: this.r.rt.inGame, [this.effect.path]: this.r.rt.effect };
    return UIDraw.list(this.root, (n, alpha) => {
      const e = this.graphics.get(n);
      if (!e || !e.g.m_Enabled) return [];
      let mesh, t;
      if (e.kind === "raw") {                // RawImage.OnPopulateMesh: rect quad, uv = uvRect (texelSize scale 1)
        const r = n.rect, uv = e.g.m_UVRect;
        mesh = new UIMesh();
        mesh.addQuad(r.x, r.y, r.x + r.w, r.y + r.h, uiColor32(e.g.m_Color), uv.x, uv.y, uv.x + uv.width, uv.y + uv.height);
        t = tex[n.path];
      } else {
        mesh = UIImage.build(n, e.g, this.shadowSprite, 100);
        t = this.shadowSprite.texture;
      }
      return [{ node: n, mat: e.mat, texture: t, verts: UIDraw.pack(mesh.verts, n, alpha), idx: Uint32Array.from(mesh.idx) }];
    });
  }

  // render item for LiveMainCamera: sorting order 5500, distance = plane distance (view depth of the canvas plane)
  item() {
    return {
      sortingLayer: this.canvasComp.m_SortingLayer || 0, sortingOrder: this.sortingOrder, queue: 3000,
      distance: this.canvasComp.m_PlaneDistance,
      draw: (ctx) => {
        const { W, H } = this.size;
        this._fit({ w: W, h: H });                        // the fitter drives the rect before the canvas lays out
        UILayout.layoutRoot(this.root, W, H, () => {});
        const globals = UIDraw.globals(W, H, ctx.target.width, ctx.target.height, 4);
        ctx.gl.disable(ctx.gl.SCISSOR_TEST);
        for (const it of this._items(W, H))
          UIDraw.draw(ctx.gl, this.lib, this.buf, it.mat,
                         { _MainTex: it.texture, _MainTex_ST: [1, 1, 0, 0], _TextureSampleAdd: [0, 0, 0, 0],
                           _ClipRect: [-32767, -32767, 32767, 32767] }, globals, it.verts, it.idx);
      },
    };
  }

  // URP final blit of LiveMainCamera's HDR intermediate to the back buffer (same size).
  // ENGINE: URP's final blit shader (CoreBlit) is replaced by a same-size texel copy (gamma project: no conversion).
  // The float -> 8-bit conversion is the GPU's.
  finalBlit(src, viewport) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);
    this.copy.draw(src.glTexture, [viewport.x, viewport.y], this.r.vao);
  }
};
