import { applyState } from "../engine/glsl.js";
import { Transform, mat4 } from "../engine/math.js";
import { URPPost } from "../engine/postfx.js";
import { GLTarget, GLTex } from "../engine/texture.js";
import { Live2DDrawing } from "../live2d/drawing.js";

// the engine's per-object values that do not change: the ambient probe of a Flat white environment (SH(N) = 1)
const SH_A = Object.freeze([0, 0, 0, 1]), SH_ZERO = Object.freeze([0, 0, 0, 0]);
const localToWorld = Transform.prototype.localToWorld;

// One story frame on WebGL2 with the game's shaders:
//   main camera: clear -> the transparent list (layers 6..12) directly, or the AdvFieldRenderPass offscreen composite
//   (per-slot alpha, brightness, blur; the background blur and the Stage capture crossfade; layer 11 only while the
//   foreground entry is active) -> URP post (LUT, bloom, uber with film grain) -> AdvCurvedLens -> the UI camera
//   (StoryUI.render) -> FinalPost (FXAA at High / Best). The UI camera's own renderers (layers 5 UI and 13 AdvFront)
//   are not drawn: a session that draws refuses the effects placed there.
// ENGINE: URP picks the camera colour format (B10G11R11 or R16G16B16A16_SFloat) from a player setting; RGBA16F holds
// the same gamma-space values. The offscreen field targets are RGBA16F as the WebGL2 substitute for
// R16G16B16A16_UNorm.

// `scene`: the session's scene objects {camera, field, background, volume, fieldRenderer, stageData, postTextures,
// session}; `lib`: the ShaderLib of the story's shaders (stage, post-processing); `assets`: the story's AssetStore.
// Each character draws with its model's own shaders (addCharacter).
export class StoryRenderer {
  constructor(gl, lib, scene, quality, loop, { assets } = {}) {
    this.gl = gl; this.lib = lib; this.scene = scene; this.quality = quality; this.loop = loop; this.assets = assets;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is required");
    gl.frontFace(gl.CW);                    // Unity's front-face convention with its world-to-camera matrix
    this.characters = [];                   // {ch: Live2DCharacter, gl: Live2DDrawing}
    this.fieldItemSources = [];             // further transparent-list items (addFieldItems)
    this.size = null;
    this.vao = gl.createVertexArray();
    this.post = new URPPost(gl, lib, { vao: this.vao });
    this.frameIndex = 0;
    this.filmGrain = 0;                     // the host's multiplier of FilmGrain.intensity (0: no film grain)
    this.grainScale = 1;                    // the game's screen pixels per canvas pixel (render)
  }

  // the film grain options of a camera's uber pass: the grain tiles one texel per pixel of the game's screen, which
  // the quality's resolution caps (AdvQuality.screenScale); the ADV viewport is as wide as the screen
  // (CreateAdvViewport never pillarboxes)
  grainOptions() { return { grain: this.grain, grainScale: this.grainScale, grainIntensity: this.filmGrain }; }

  async load(base = "") {
    const gl = this.gl;
    this.tex = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"),
      black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"),
      bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
    };
    // stage background sprites
    this.sprites = new Map();
    for (const st of this.scene.stageData.values()) {
      const sp = st.backgroundSprite;
      if (!sp || this.sprites.has(sp.sprite)) continue;
      const pos = new Float32Array(sp.vertices.flat()), uv = new Float32Array(sp.uv.flat());
      this.sprites.set(sp.sprite, { texture: await GLTex.load(gl, base, sp.texture, this.assets),
                                    pos: this._buffer(pos), uv: this._buffer(uv),
                                    idx: this._buffer(new Uint16Array(sp.indices), gl.ELEMENT_ARRAY_BUFFER),
                                    count: sp.indices.length, bounds: StoryRenderer.bounds(sp.vertices) });
    }
    // background plane mesh (built-in "Plane")
    const m = this.scene.background.planeMesh;
    if (m.submeshes.length !== 1) throw new Error("plane mesh submeshes");
    this.plane = { pos: this._buffer(new Float32Array(m.vertices.flat())), uv: this._buffer(new Float32Array(m.uv0.flat())),
                   idx: this._buffer(new Uint16Array(m.submeshes[0]), gl.ELEMENT_ARRAY_BUFFER),
                   count: m.submeshes[0].length, bounds: StoryRenderer.bounds(m.vertices) };
    // post textures: film grain by FilmGrain.type, neutral colour curves, internal LUT
    this.grain = await URPPost.loadGrain(gl, base, this.scene.postTextures.filmGrainTex);
    this.post.initLut();
    for (const c of this.characters) { c.gl.white = this.tex.white; await c.gl.loadTextures(); c.gl.prepare(); }
  }

  static bounds(verts) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k] ?? 0); hi[k] = Math.max(hi[k], v[k] ?? 0); }
    return { center: { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 } };
  }

  _buffer(data, target) {
    const gl = this.gl, b = gl.createBuffer();
    target = target || gl.ARRAY_BUFFER;
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  // a character's drawing (its buffers now, its textures and programs in load()): `lib` the ShaderLib of its model's
  // shaders, `dir` the directory its texture paths are relative to, `resources` its model's Cubism mask materials
  // (model.json resources)
  addCharacter(ch, { lib, dir, resources }) {
    const g = new Live2DDrawing(this.gl, lib, ch, { dir, resources, white: this.tex ? this.tex.white : null,
                                                    assets: this.assets });
    this.characters.push({ ch, gl: g });
    return g;
  }

  // source(frame) -> [{sortingOrder, dist, layer, draw(frame)}]: renderers of the feature modules (particle effects),
  // routed by their GameObject layer: the main camera draws layers 6..12 (the direct list); the offscreen composite
  // draws 12 (AdvBack) with the background, 6..10 (Camera1..5) inside the character group whose entries have that
  // layer (none: not drawn), 11 (Adv) after Adv_Present while the foreground entry is active. Layers 5 and 13 belong to
  // the UI camera, which draws none of them here (StoryRenderer.checkLayer).
  addFieldItems(source) { this.fieldItemSources.push(source); return source; }
  removeFieldItems(source) { const i = this.fieldItemSources.indexOf(source); if (i >= 0) this.fieldItemSources.splice(i, 1); }
  _extraItems(frame) {
    const out = [];
    for (const src of this.fieldItemSources) for (const it of src(frame, this)) { StoryRenderer.checkLayer(it.layer); out.push(it); }
    return out;
  }

  // the UI camera (UI | AdvFront) is not reproduced: a renderer on those layers fails the frame
  static checkLayer(layer) {
    if (layer === 5 || layer === 13) throw new Error(`a renderer on layer ${layer} needs the UI camera, which this player does not draw`);
  }

  // the main camera's transparent list keeps layers 6..12 (its culling mask)
  static mainCameraItems(items) { return items.filter((it) => it.layer >= 6 && it.layer <= 12); }

  // AdvFieldRenderPass: 12 goes with the background, 6..10 into the first character group whose entries have that
  // layer (none: not drawn), 11 onto the camera colour after Adv_Present (drawn while the foreground entry is active);
  // other layers are not drawn. groups: fr.groups() ({entries: [{layer}]}).
  static routeOffscreen(items, groups) {
    const out = { background: [], groups: groups.map(() => []), foreground: [] };
    for (const it of items) {
      if (it.layer === 12) out.background.push(it);
      else if (it.layer === 11) out.foreground.push(it);
      else {
        const k = groups.findIndex((g) => g.entries.some((e) => e.layer === it.layer));
        if (k >= 0) out.groups[k].push(it);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ targets
  // The camera colour and the post target are made with the size; the others (the offscreen composite's, the blur's,
  // the curved lens's, the capture's) when a frame first draws into them: a story that never uses them keeps no
  // full-size RGBA16F buffer for them (GPU memory on phones).
  _resize(w, h) {
    if (this.size && this.size.w === w && this.size.h === h) return;
    this._releaseTargets();
    const gl = this.gl, F16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    this.size = { w, h };
    const hw = Math.max(1, Math.round(w * 0.5)), hh = Math.max(1, Math.round(h * 0.5));
    const specs = {
      color: [w, h, { ...F16, label: "CameraColor" }],
      post: [w, h, { ...F16, label: "AfterPost" }],
      lens: [w, h, { ...F16, label: "_AdvCurvedLensTemporaryRT" }],
      main: [w, h, { ...F16, label: "AdvMainRT" }],
      temp: [w, h, { ...F16, label: "AdvTempRT" }],
      half: [hw, hh, { ...F16, label: "AdvBlurRT" }],
      capture: [w, h, { filter: gl.NEAREST, label: "CaptureRTHandle" }],
    };
    const rt = this.rt = {};
    const own = (k, v) => Object.defineProperty(rt, k, { value: v, writable: true, enumerable: true, configurable: true });
    for (const [k, [tw, th, o]] of Object.entries(specs)) {
      Object.defineProperty(rt, k, { enumerable: true, configurable: true,
                                     get: () => { const t = new GLTarget(gl, tw, th, o); own(k, t); return t; },
                                     set: (v) => own(k, v) });
    }
    void rt.color, void rt.post;             // every frame draws into these two
    this.post.resizeBloom(w, h);
  }

  // the targets made so far (reading a target not made yet would make it)
  _madeTargets() {
    return Object.values(Object.getOwnPropertyDescriptors(this.rt || {})).filter((d) => "value" in d).map((d) => d.value);
  }

  _releaseTargets() { for (const t of this._madeTargets()) if (t && t.release) t.release(); }

  // ---------------------------------------------------------------- globals
  // the main camera's per-camera values (ScriptableRenderer.SetPerCameraShaderVariables,
  // RenderingUtils.SetViewAndProjectionMatrices: glstate_matrix_projection = the GPU projection)
  _cameraGlobals(w, h) {
    const cam = this.scene.camera, t = this.loop.time;
    const V = cam.viewMatrix(), P = cam.projection(w / h);
    this.view = V; this.proj = P; this.vp = mat4.mul(P, V);
    const pos = this.camPos = cam.transform.worldPosition();
    const g = {
      _ProjectionParams: [1, cam.near, cam.far, 1 / cam.far],
      unity_MatrixVP: this.vp, unity_MatrixV: V, glstate_matrix_projection: P,
      _WorldSpaceCameraPos: [pos.x, pos.y, pos.z], unity_OrthoParams: cam.orthoParams(w / h),
      _Time: [t / 20, t, t * 2, t * 3], _GlobalMipBias: [0, 0],
      _ScreenParams: [w, h, 1 + 1 / w, 1 + 1 / h],
    };
    Object.assign(g, this._mainLight());
    return g;
  }

  _visibleLights() {
    const st = this.scene.session.stage;
    if (!st || !this.quality.unityLighting) return [];
    return st.activeLights();
  }

  // GetMainLightIndex / InitializeLightConstants_Common
  _mainLight() {
    const dirs = this._visibleLights().filter((l) => l.type === "Directional");
    let best = null;
    for (const l of dirs) if (!best || l.light.m_Intensity > best.light.m_Intensity) best = l;
    this.mainLight = best;
    if (!best) return { _MainLightPosition: [0, 0, 1, 0], _MainLightColor: [0, 0, 0, 0] };
    const m = best.transform.localToWorld();
    const c = best.light.m_Color, k = best.light.m_Intensity;
    return { _MainLightPosition: [-m[8], -m[9], -m[10], 0], _MainLightColor: [c.r * k, c.g * k, c.b * k, c.a * k] };
  }

  // Additional lights (Best only, per-vertex): URP visible order, per-object count <= 2
  _additionalLights() {
    const out = [];
    for (const l of this._visibleLights()) {
      if (l === this.mainLight || l.type === "Directional") continue;
      const m = l.transform.localToWorld(), L = l.light;
      if (!StoryRenderer.sphereInFrustum(this.vp, { x: m[12], y: m[13], z: m[14] }, L.m_Range)) continue;   // light culling
      const range = L.m_Range, r2 = range * range, fade = 0.8 * 0.8 * r2 - r2;
      const att = [1 / Math.max(0.0001, r2), -r2 / fade, 0, 1];
      let dir = [0, 0, 1, 0];
      if (l.type === "Spot") {
        const co = Math.cos(Math.PI / 180 * L.m_SpotAngle * 0.5), ci = Math.cos(L.m_InnerSpotAngle * Math.PI / 180 * 0.5);
        const inv = 1 / Math.max(0.001, ci - co);
        att[2] = inv; att[3] = -co * inv;
        dir = [-m[8], -m[9], -m[10], 0];
      } else if (l.type !== "Point") throw new Error(`light type ${l.type}`);
      const c = L.m_Color, k = L.m_Intensity;
      out.push({ pos: [m[12], m[13], m[14], 1], color: [c.r * k, c.g * k, c.b * k, c.a * k], att, dir, range,
                 layers: L.m_CullingMask.m_Bits });
    }
    return out;
  }

  _lightSheet() {
    const lights = this.quality.additionalLightsVertex ? this._additionalLights() : [];
    this.addLights = lights;
    const n = 16, pad = (f) => { const a = new Float32Array(n * 4); lights.forEach((l, i) => a.set(l[f], i * 4)); return a; };
    return { _AdditionalLightsCount: [lights.length, 0, 0, 0], _AdditionalLightsPosition: pad("pos"),
             _AdditionalLightsColor: pad("color"), _AdditionalLightsAttenuation: pad("att"),
             _AdditionalLightsSpotDir: pad("dir") };
  }

  // Engine per-object values. The ambient probe of a Flat white environment is
  // taken as SH(N) = 1. unity_WorldToObject (the renderer's world-to-local matrix) is made when a program reads it.
  // ENGINE: world-to-object of a zero-scale transform is native; zeros are passed (the draw covers no pixel).
  _perObject(transform, layer) {
    const M = this._world(transform);
    let count = 0;
    if (this.addLights && this.addLights.length) {
      const p = { x: M[12], y: M[13], z: M[14] };
      for (const l of this.addLights) {
        if (!((l.layers >> layer) & 1)) continue;
        const d = Math.hypot(p.x - l.pos[0], p.y - l.pos[1], p.z - l.pos[2]);
        if (d <= l.range + 10) count++;               // renderer bounds vs light range (engine culling)
      }
      count = Math.min(count, 2);
    }
    let inverse = null;
    return { unity_ObjectToWorld: M, unity_SHAr: SH_A, unity_SHAg: SH_A, unity_SHAb: SH_A,
             unity_SHBr: SH_ZERO, unity_SHBg: SH_ZERO, unity_SHBb: SH_ZERO, unity_SHC: SH_ZERO,
             unity_LightData: [0, count, 0, 0],
             get unity_WorldToObject() { return inverse || (inverse = mat4.inverse(M) || new Float32Array(16)); } };
  }

  // A transform's localToWorld, made once per frame: drawing changes no transform, and the drawables of a model share
  // their parents. Objects with a localToWorld of their own (world matrices of effects) are asked each time. The
  // matrices are read, never written.
  _world(t) {
    if (t.localToWorld !== localToWorld || !this._worlds) return t.localToWorld();
    let m = this._worlds.get(t);
    if (!m) {
      const l = t.localMatrix();
      m = t.parent ? mat4.mul(this._world(t.parent), l) : l;
      this._worlds.set(t, m);
    }
    return m;
  }

  // -------------------------------------------------------- transparent lists
  _distance(transform, center) {
    const M = this._world(transform), p = mat4.transformPoint(M, center || { x: 0, y: 0, z: 0 });
    return Math.hypot(p.x - this.camPos.x, p.y - this.camPos.y, p.z - this.camPos.z);
  }

  // background (layer 12): black plane + sprite, both sortingOrder -100
  _backgroundItems() {
    const bg = this.scene.background;
    if (!bg.active) return [];
    const items = [];
    items.push({ sortingOrder: bg.planeRenderer.m_SortingOrder ?? -100, dist: this._distance(bg.planeTransform, this.plane.bounds.center),
                 draw: (frame) => this._drawPlane(frame) });
    if (bg.sprite) {
      const s = this.sprites.get(bg.sprite.sprite);
      items.push({ sortingOrder: bg.spriteRenderer.m_SortingOrder, dist: this._distance(bg.spriteTransform, s.bounds.center),
                   draw: (frame) => this._drawSprite(frame, s) });
    }
    return items;
  }

  // the keywords the renderer adds to every character draw: _ADDITIONAL_LIGHTS_VERTEX at Best (UniversalRP_Best's
  // per-vertex additional lights), none at the other qualities
  static characterKeywords(quality) { return quality.additionalLightsVertex ? ["_ADDITIONAL_LIGHTS_VERTEX"] : []; }

  _characterItems(filter) {
    const kw = StoryRenderer.characterKeywords(this.quality);
    const items = [];
    for (const c of this.characters) {
      if (!c.ch.isShowing || (filter && !filter(c.ch))) continue;
      for (const it of c.gl.items(kw)) items.push({ ...it, dist: this._distance(it.transform), layer: c.ch.gameObjectLayer ?? 0 });
    }
    return items;
  }

  static sortItems(items) {                 // SortingCriteria.CommonTransparent: order, queue, back to front
    return items.sort((a, b) => (a.sortingOrder - b.sortingOrder) || (b.dist - a.dist));
  }

  _drawList(items, frame) { for (const it of StoryRenderer.sortItems(items)) it.draw({ ...frame, layer: it.layer ?? 12 }); }

  _bindMesh(prog, bufs) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      if (name === "in_POSITION0") { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
      else if (name === "in_TEXCOORD0") { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
      else if (name === "in_COLOR0") gl.vertexAttrib4f(loc, 1, 1, 1, 1);
      else throw new Error(`${prog.label}: attribute ${name}`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
  }

  _material(mat, shader) {
    const defaults = this.lib.defaults(shader, this.tex);
    const texSheet = {};
    for (const [k, v] of Object.entries(mat.textures || {})) {
      if (v.texture) throw new Error(`${mat.material}.${k}: material textures not implemented`);
      texSheet[`${k}_ST`] = [v.scale.x, v.scale.y, v.offset.x, v.offset.y];
    }
    return [mat.floats, mat.colors, texSheet, defaults];
  }

  _drawPlane(frame) {
    const bg = this.scene.background, mat = bg.planeRenderer.m_Materials[0], shader = mat.shader.shader;
    const prog = this.lib.program(shader, 0, mat.keywords);
    prog.apply([this._perObject(bg.planeTransform, 12), ...this._material(mat, shader), frame.globals]);
    applyState(this.gl, this.lib.state(shader, 0, mat.floats));
    this._bindMesh(prog, this.plane);
    this.gl.drawElements(this.gl.TRIANGLES, this.plane.count, this.gl.UNSIGNED_SHORT, 0);
  }

  _drawSprite(frame, s) {
    const bg = this.scene.background, sr = bg.spriteRenderer, mat = sr.m_Materials[0], shader = mat.shader.shader;
    const prog = this.lib.program(shader, 0, mat.keywords);
    const c = bg.color, rc = sr.m_Color;
    prog.apply([{ _MainTex: s.texture, unity_SpriteColor: [rc.r * c.r, rc.g * c.g, rc.b * c.b, rc.a * c.a],
                  unity_SpriteProps: [sr.m_FlipX ? -1 : 1, sr.m_FlipY ? -1 : 1, 0, 0] },
                this._perObject(bg.spriteTransform, 12), ...this._material(mat, shader), frame.globals]);
    applyState(this.gl, this.lib.state(shader, 0, mat.floats));
    this._bindMesh(prog, s);
    this.gl.drawElements(this.gl.TRIANGLES, s.count, this.gl.UNSIGNED_SHORT, 0);
  }

  // --------------------------------------------------------------- blit passes
  _blit(shader, pass, sheets, target, opts = {}) { this.post.blit(shader, pass, sheets, target, { ...opts, viewport: this.viewport }); }

  // bounding sphere against the six clip planes of a view-projection matrix
  static sphereInFrustum(M, c, r) {
    const row = (i) => [M[i], M[4 + i], M[8 + i], M[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    const planes = [0, 1, 2, 3, 4, 5].map((k) => {
      const a = [r0, r0, r1, r1, r2, r2][k], sgn = k % 2 ? -1 : 1;
      return r3.map((v, j) => v + sgn * a[j]);
    });
    for (const p of planes) {
      const len = Math.hypot(p[0], p[1], p[2]);
      if ((p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3]) / len < -r) return false;
    }
    return true;
  }

  _blur(target, material, size) {           // AddBlurInPlace
    const s = "Adv/DistanceAdaptiveLensBlur";
    const m = { ...this.lib.defaults(s, this.tex), _BlurRadiusMax: this.scene.fieldRenderer.blurRadiusMax, _BlurSize: size };
    const sp = { _ScreenParams: [this.size.w, this.size.h, 1 + 1 / this.size.w, 1 + 1 / this.size.h] };
    this._blit(s, 0, [{ _BlitTexture: target, _BlitTexture_TexelSize: URPPost.texel(target) }, m, sp], this.rt.half);
    this._blit(s, 1, [{ _BlitTexture: this.rt.half, _BlitTexture_TexelSize: URPPost.texel(this.rt.half) }, m, sp], target);
  }

  _composite(src, target, shader, alpha, brightness) {
    const sheet = { _BlitTexture: src, _Alpha: alpha };
    if (brightness !== undefined) sheet._Brightness = brightness;
    this._blit(shader, 0, [sheet, this.lib.defaults(shader, this.tex)], target);
  }

  // AdvFieldRenderPass.RecordRenderGraph
  _offscreen(frame) {
    const gl = this.gl, fr = this.scene.fieldRenderer, R = this.rt;
    R.main.bind(); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const groups = fr.groups(), route = StoryRenderer.routeOffscreen(this._extraItems(frame), groups);
    if (fr.background.active) {
      this._drawList([...this._backgroundItems(), ...route.background], frame);
      if (fr.background.blur > 0) this._blur(R.main, null, fr.background.blur * fr.background.blurRate);
      if (fr.capture.rt) this._composite(fr.capture.rt, R.main, "Adv/AlphaBlend", fr.capture.alpha);
    }
    groups.forEach((g, k) => {
      const members = new Set(g.entries.map((e) => e.target));
      R.temp.bind(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this._drawList([...this._characterItems((ch) => members.has(ch)), ...route.groups[k]], frame);
      if (g.blur > 0) this._blur(R.temp, null, g.blurSize);
      this._composite(R.temp, R.main, "Adv/AlphaBlendPremultiplied", g.alpha, g.brightness);
    });
    // Adv_Present: full overwrite of the camera colour (point copy)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.main.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.color.fb);
    gl.blitFramebuffer(0, 0, this.size.w, this.size.h, 0, 0, this.size.w, this.size.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // Adv_Foreground: layer 11 onto the camera colour
    if (fr.isForegroundActive) { R.color.bind(); this._drawList(route.foreground, frame); }
  }

  _curvedLens(stack) {                      // AdvCurvedLensRenderPass (event 600)
    const C = stack.AdvCurvedLens, fr = this.scene.fieldRenderer;
    const eff = (C.attenuateByCameraDistance ? fr.curvedLensRate : 1) * C.intensity;
    const active = C.intensity > 0 && (C.horizontalRate > 0 || C.verticalRate > 0) && eff > 0;
    if (!active) return;
    const s = "Adv/CurvedLens";
    this._blit(s, 0, [{ _BlitTexture: this.rt.post, _BlitTexture_TexelSize: URPPost.texel(this.rt.post),
      _AdvCurvedLensParams1: [C.center.x, C.center.y, eff, C.size],
      _AdvCurvedLensParams2: [C.softness, C.horizontalRate, C.verticalRate, Math.max(C.scale, 0.001)],
      _AdvCurvedLensParams3: [C.reverse ? 1 : 0, 0, 0, 0] }], this.rt.lens);
    [this.rt.post, this.rt.lens] = [this.rt.lens, this.rt.post];
  }

  // ------------------------------------------------------------------ frame
  // `vp` = the ADV viewport in backbuffer pixels {x, y, w, h} (AdvCameraConfig.CreateAdvViewport);
  // `ui` (optional) draws the overlay canvas onto the bound post target.
  render(vp, ui) {
    const w = vp.w, h = vp.h;
    this.viewport = vp;
    this.grainScale = this.quality.screenScale(w);
    this._resize(w, h);
    this._worlds = new Map();
    try { this._render(vp, ui); } finally { this._worlds = null; }
  }

  _render(vp, ui) {
    const gl = this.gl, w = vp.w, h = vp.h;
    for (const c of this.characters) c.gl.renderMasks();          // CubismMaskCommandBuffer (before cameras)
    const globals = { ...this._cameraGlobals(w, h), ...this._lightSheet() };
    const frame = { globals, perObject: (t, layer) => this._perObject(t, layer) };
    const liveFrame = { globals, perObject: (t) => this._perObject(t, 6) };
    const fr = this.scene.fieldRenderer;
    // main camera
    this.rt.color.bind();
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    const cc = this.scene.camera.clearColor;
    gl.clearColor(cc[0], cc[1], cc[2], cc[3]); gl.clear(gl.COLOR_BUFFER_BIT);
    if (fr.needsOffscreen()) this._offscreen(liveFrame);
    else {
      this.rt.color.bind();
      this._drawList([...this._backgroundItems(), ...this._characterItems(),
                      ...StoryRenderer.mainCameraItems(this._extraItems(liveFrame))], liveFrame);
    }
    const stack = this.scene.volume.stack;
    this.post.buildLut(stack);
    const cam = this.scene.camera;
    this.post.render(stack, this.rt.color, this.rt.post, { width: w, height: h, frameCount: this.loop.frameCount,
                     ...this.grainOptions(), gray: this.tex.gray, black: this.tex.black,
                     camera: { view: this.view, proj: this.proj, near: cam.near, far: cam.far } });
    if (this.quality.stagePostEffect) this._curvedLens(stack);
    // ScreenCapture of the AdvBack layer requested this frame (its renderers re-drawn at event 600, no post)
    if (fr.capture.pending) {
      const res = fr.capture.pending; fr.capture.pending = null;
      this.rt.capture.bind(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this._drawList([...this._backgroundItems(), ...this._extraItems(liveFrame).filter((it) => it.layer === 12)], liveFrame);
      this.loop.yield("Update").then(() => res(this.rt.capture));
    }
    // UI overlay camera onto the same target
    if (ui) { this.rt.post.bind(); ui.render({ gl, width: w, height: h, target: this.rt.post }); }
    // FinalPost (FXAA at High/Best) to the canvas
    this.post.finalPost(this.rt.post, null, { width: w, height: h, fxaa: this.quality.cameraAntiAliasing, viewport: this.viewport });
  }
}
