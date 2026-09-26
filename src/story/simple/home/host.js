import { join } from "../../../engine/core.js";
import { applyState, ShaderLib } from "../../../engine/glsl.js";
import { mat4, quat } from "../../../engine/math.js";
import { GLTex } from "../../../engine/texture.js";
import { blurPass, BLUR_SHADER, DualKawaseBlur, UIBlur } from "./blur.js";
import { SpotCamera } from "./camera.js";
import { imageBytes, parseGlb, textureInfo } from "./glb.js";
import { materialQueue, ShaderInfo, sortDrawItems, SpotRoom } from "./room.js";
import { skeletonDataVersion, spineRuntime, SpotSkeletonData } from "./spine.js";

// The 3D part of the home host of the simple ADV player: the live home spot drawn behind a tap or area talk
// (SpotManager with its SpotSceneRoot, SpotCameraController and UIBlurController).
//   - room: the background prefab's cards (host/spot/room.glb) with the game's Unlit shaders and the saved material
//     values, the renderers active after SpotBackground.Prepare, the floor queue override (room.js);
//   - Spine characters (SpotSpineCharacter / SkeletonAnimation) through the page's Spine runtime (spine.js);
//   - the main camera: default pose, focus and return tweens, Reset (camera.js);
//   - the UI blur: rate ramp and the Dual Kawase pass on the camera colour (blur.js).
// Scene placement (SpotSceneRoot.SetObject): the background and situation prefabs are parented under _objRoot
// keeping their local transforms; the background root then gets localPosition = backgroundPosition, eulerAngles (world)
// = backgroundRotation, localScale = backgroundScale. The situation's matrices in spot.json are prefab-space world
// matrices, so under _objRoot they are objRoot x matrix. The room file bakes each renderer's prefab-space world matrix,
// the background root's own serialized transform included: home.roomRoot ({localPosition, localRotation, localScale}
// of that root) is taken back out before the situation's transform goes on; without it the baked space is taken as the
// root's local space.
// The spot's Volume (post-processing of the main camera) is not drawn; `missing` lists it when the data has one.
// With gl = null nothing is drawn and every timing (camera tweens, blur ramp, Spine updates) still runs.

export const SPINE_MISSING = "Spine runtime missing";
export const VOLUME_MISSING = "spot Volume post-processing";
// A tap talk whose character no SpotCharacter of the spot carries: the game starts a tap talk only from a tapped
// SpotCharacter (HomeSpotAfterTalkRequestFactory.TrySelectAdv: MasterStoryHomeSpotTapTalkEpisode._spotId == the spot
// and _characterId == the tapped SpotCharacter's _characterId), so it never plays such a talk; the session plays it
// as a tap talk without the camera focus
export const NO_TAP_TARGET = "no tap target for the talk's character in the spot (camera focus not played)";
// room shaders that need URP's lighting state (the per-camera lighting keywords and the light uniforms), which this
// host does not set: a drawn session refuses a room with such a material
export const LIT_ROOM_SHADERS = new Set(["Universal Render Pipeline/Lit"]);

// CameraClearFlags (1 Skybox, 2 SolidColor, 3 Depth, 4 Nothing)
const CLEAR_SKYBOX = 1, CLEAR_SOLID = 2;
const IDENTITY_Q = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

const dirOf = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const matrixOf = (a, what) => {
  if (!Array.isArray(a) || a.length !== 16) throw new Error(`${what}: not a 4 x 4 column-major matrix`);
  return Float32Array.from(a);
};
const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
const colorOf = (c) => (Array.isArray(c) ? c : c ? [c.r, c.g, c.b, c.a] : [0, 0, 0, 1]);

// SpotSceneRoot.SetObject: the background root's localToWorld under _objRoot (world TRS {position, rotation,
// scale}, or null for identity): localPosition = p, eulerAngles = e (a world rotation: localRotation =
// inverse(parent rotation) x Euler(e)), localScale = s
export const backgroundMatrix = (settings, objRoot) => {
  const p = settings.backgroundPosition, e = settings.backgroundRotation, s = settings.backgroundScale;
  if (!p || !e || !s) throw new Error("situationSettings: backgroundPosition / Rotation / Scale missing");
  const parent = objRoot ? mat4.trs(objRoot.position, objRoot.rotation, objRoot.scale) : mat4.identity();
  const parentRot = objRoot ? objRoot.rotation : IDENTITY_Q;
  const q = quat.mul(conj(parentRot), quat.euler(e.x, e.y, e.z));
  return mat4.mul(parent, mat4.trs(p, q, s));
};

// the inverse of Matrix4x4.TRS(t, q, s): S^-1 x R^-1 x T^-1
export const inverseTRS = (t, q, s) => {
  const zero = { x: 0, y: 0, z: 0 }, one = { x: 1, y: 1, z: 1 };
  return mat4.mul(mat4.scale(1 / s.x, 1 / s.y, 1 / s.z),
                  mat4.mul(mat4.trs(zero, conj(q), one), mat4.trs({ x: -t.x, y: -t.y, z: -t.z }, IDENTITY_Q, one)));
};

// localToWorld of the room file's baked space: the background root's matrix with the root's serialized transform
// (home.roomRoot, baked into every vertex) taken out
export const roomMatrix = (background, roomRoot) => {
  if (!roomRoot) return background;
  const { localPosition: t, localRotation: q, localScale: s } = roomRoot;
  if (!t || !q || !s) throw new Error("home.roomRoot: localPosition / localRotation / localScale missing");
  return mat4.mul(background, inverseTRS(t, q, s));
};

export class SimpleHomeHost {
  // gl: WebGL2 context or null; store: the story's AssetStore; loop: the session's PlayerLoop; host: host/host.json;
  // opts: {camera: {near, far, clearFlags, clearColor: [r, g, b, a]} of the story scene's main camera,
  //        spine: a Spine runtime (default globalThis.spine; null for none)}
  static async create(gl, store, loop, host, opts = {}) {
    const h = new SimpleHomeHost(gl, store, loop, host, opts);
    try { if (gl) await h._upload(); } catch (e) { h.dispose(); throw e; }
    return h;
  }

  constructor(gl, store, loop, host, opts = {}) {
    if (!host || host.kind !== "home" || !host.home) throw new Error("host.json: not a home host");
    const home = this.home = host.home;
    const cam = opts.camera || {};
    this.gl = gl; this.store = store; this.loop = loop;
    this.missing = [];
    this.spot = store.json(home.spot);
    this.spineDir = join(dirOf(home.spot), "spine");
    this.shaderBase = dirOf(home.shaders.index);
    this.shaders = new ShaderInfo(store, this.shaderBase);
    this.room = new SpotRoom(parseGlb(store.bytes(home.room)), home, this.shaders);
    const settings = this.spot.situationSettings;
    const objRoot = home.sceneRoot ? home.sceneRoot.objRoot : null;
    this.rootMatrix = objRoot ? mat4.trs(objRoot.position, objRoot.rotation, objRoot.scale) : mat4.identity();
    this.backgroundMatrix = backgroundMatrix(settings, objRoot);
    this.roomMatrix = roomMatrix(this.backgroundMatrix, home.roomRoot);
    this.camera = new SpotCamera(loop, settings, { near: cam.near, far: cam.far });
    this.clearFlags = cam.clearFlags ?? CLEAR_SOLID;
    this.clearColor = colorOf(cam.clearColor);
    this.blur = new UIBlur(loop);
    this.blurParams = home.blur;
    if (home.volume || (home.sceneRoot && home.sceneRoot.volumes && home.sceneRoot.volumes.length)) this.missing.push(VOLUME_MISSING);
    this.skeletons = [];
    this.spineReason = null;
    this._hooks = [];
    this._initSpine(opts.spine !== undefined ? opts.spine : globalThis.spine);
    if (home.talk === "tap" && !this.tapTarget(home.characterId)) this.missing.push(NO_TAP_TARGET);
  }

  // SpotSpineCharacter -> SkeletonAnimation, each started at its initial animation's end state (spine.js)
  _initSpine(candidate) {
    const chars = (this.spot.spineCharacters || []).filter((c) => c.skeletonData && c.animation && c.world);
    if (!chars.length) return;
    const recs = new Map((this.spot.skeletons || []).map((r) => [r.name, r]));
    const first = recs.get(chars[0].skeletonData);
    if (!first) throw new Error(`spot.json: skeleton data ${chars[0].skeletonData} not listed`);
    const file = join(this.spineDir, first.skeleton);
    const version = skeletonDataVersion(first.skeleton, /\.json$/i.test(file) ? this.store.text(file) : this.store.bytes(file));
    const { runtime, reason } = spineRuntime(candidate, version);
    if (!runtime) { this.missing.push(SPINE_MISSING); this.spineReason = reason; return; }
    this.spine = runtime;
    const used = [...new Set(chars.map((c) => c.skeletonData))].map((n) => {
      if (!recs.has(n)) throw new Error(`spot.json: skeleton data ${n} not listed`);
      return recs.get(n);
    });
    this.spineData = new SpotSkeletonData(runtime, used, (f) => this.store.text(join(this.spineDir, f)),
                                          (f) => this.store.bytes(join(this.spineDir, f)));
    // host.json home.spineCharacters (by path): the MeshRenderer's sortingOrder and the atlas pages' materials
    const extra = new Map((this.home.spineCharacters || []).map((x) => [x.path, x]));
    const named = new Map();
    for (const c of chars) {
      for (const [page, name] of Object.entries((extra.get(c.path) || {}).pageMaterials || {})) {
        if (named.has(page) && named.get(page) !== name)
          throw new Error(`home.spineCharacters: atlas page ${page} has the materials ${named.get(page)} and ${name}`);
        named.set(page, name);
      }
    }
    this.pageMaterials = new Map(this.spineData.pages().map((p) => [p, this._pageMaterial(p, named.get(p))]));
    for (const c of chars) {
      const skeleton = this.spineData.skeleton(c.skeletonData, c.animation);
      skeleton.applyEndState();
      // Renderer.sortingOrder of the SkeletonAnimation's MeshRenderer
      const e = extra.get(c.path) || {};
      this.skeletons.push({ character: c, skeleton, matrix: mat4.mul(this.rootMatrix, matrixOf(c.world, c.path)),
                            sortingOrder: e.sortingOrder ?? c.sortingOrder ?? 0, mesh: null, gpu: null });
    }
    // SkeletonAnimation.Update (updateTiming InUpdate): the loop's update phase
    this._on("update", (loop) => { for (const s of this.skeletons) s.skeleton.update(loop.deltaTime); });
  }

  // the material of an atlas page (SpineAtlasAsset.materials[page]): the one host.json names for the page, else the
  // only Spine material, else the one named after the page as spine-unity's importer names it ("<page>_Material").
  // The record (advui material form) is brought to the room material form: shader name, texEnvs with [x, y] pairs.
  _pageMaterial(page, name = null) {
    const mats = this.home.spineMaterials || {}, list = Object.values(mats);
    const m = name ? mats[name] : list.length === 1 ? list[0] : mats[`${page.replace(/\.[^.]*$/, "")}_Material`];
    if (!m) throw new Error(`home.spineMaterials: no material ${name || ""} for atlas page ${page}`);
    const shader = typeof m.shader === "string" ? m.shader : m.shader && m.shader.shader;
    const matName = m.name || m.material;
    if (!this.shaders.has(shader)) throw new Error(`home.spineMaterials ${matName}: shader ${shader} not packed`);
    const pair = (v, d) => (Array.isArray(v) ? v : v ? [v.x, v.y] : d);
    const texEnvs = Object.fromEntries(Object.entries(m.texEnvs || m.textures || {}).map(([slot, t]) =>
      [slot, { scale: pair(t.scale, [1, 1]), offset: pair(t.offset, [0, 0]) }]));
    return { name: matName, shader, keywords: m.keywords || [], floats: m.floats || {}, colors: m.colors || {},
             renderQueue: m.renderQueue ?? -1, texEnvs };
  }

  _on(phase, fn) { this.loop.on(phase, fn); this._hooks.push([phase, fn]); }

  // ------------------------------------------------------------------------------------------------ GPU resources
  async _upload() {
    for (const m of this.room.materials)
      if (LIT_ROOM_SHADERS.has(m.shader))
        throw new Error(`home spot ${this.home.spotId}: room material ${m.name} (${m.shader}) is not drawn by this player`);
    const gl = this.gl;
    this.lib = new ShaderLib(gl, this.shaderBase, this.store);
    this.vao = gl.createVertexArray();
    this.tex = {
      white: GLTex.solid(gl, [255, 255, 255, 255], "white"), black: GLTex.solid(gl, [0, 0, 0, 255], "black"),
      gray: GLTex.solid(gl, [128, 128, 128, 255], "gray"), bump: GLTex.solid(gl, [128, 128, 255, 255], "bump"),
    };
    this.buffers = [];
    this.textures = [];
    this.frameBuffers = new Map();
    // room: one vertex buffer per glb accessor, one index buffer per primitive, textures by glb index
    const byAccessor = new Map(), buf = (data, target) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW);
      this.buffers.push(b);
      return b;
    };
    const attr = (index, data) => {
      if (!byAccessor.has(index)) byAccessor.set(index, buf(data, gl.ARRAY_BUFFER));
      return byAccessor.get(index);
    };
    const glbTextures = new Map();
    for (const part of this.room.parts) {
      const p = part.primitive;
      part.gpu = { in_POSITION0: { buffer: attr(p.positionAccessor, p.positions), size: 3, type: gl.FLOAT, normalized: false },
                   in_TEXCOORD0: { buffer: attr(p.uvAccessor, p.uvs), size: 2, type: gl.FLOAT, normalized: false },
                   index: buf(p.indices, gl.ELEMENT_ARRAY_BUFFER), count: p.indices.length };
      const texs = {};
      for (const [slot, t] of Object.entries(part.material.texEnvs || {})) {
        if (t.texture === null || t.texture === undefined) continue;
        if (!glbTextures.has(t.texture)) glbTextures.set(t.texture, await this._glbTexture(t.texture));
        texs[slot] = glbTextures.get(t.texture);
      }
      part.textures = texs;
      for (const pass of part.passes) {
        this.lib.program(part.material.shader, pass, part.material.keywords || [], part.subShader);
        this.lib.state(part.material.shader, pass, part.material.floats || {}, part.subShader);
      }
    }
    // Spine atlas pages
    if (this.spineData) {
      this.pageTextures = new Map();
      for (const page of this.spineData.pages()) this.pageTextures.set(page, await this._pageTexture(page));
      for (const m of new Set(this.pageMaterials.values()))
        for (const pass of this.shaders.forwardPasses(m.shader)) this.lib.program(m.shader, pass, m.keywords || [], this.shaders.subShader(m.shader));
    }
    if (!this.shaders.has(BLUR_SHADER)) throw new Error(`host shaders: ${BLUR_SHADER} not packed`);
    this.kawase = new DualKawaseBlur(gl, this.lib);
    this.room.glb = null;                 // the file's bytes are no longer needed
  }

  // an embedded glb image with its glTF sampler, rows flipped to Unity's bottom-left origin
  async _glbTexture(index) {
    const glb = this.room.glb, info = textureInfo(glb, index), im = imageBytes(glb, info.source);
    const bmp = await createImageBitmap(new Blob([im.bytes], { type: im.mimeType }),
                                        { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "flipY" });
    return this._texture(bmp, info.sampler, im.name);
  }

  // an atlas page PNG of the spot's spine directory
  // ENGINE: atlas page texture import settings are not in the data; bilinear, clamped, no mipmaps here.
  async _pageTexture(page) {
    const gl = this.gl, bmp = await this.store.image(join(this.spineDir, page));
    return this._texture(bmp, { magFilter: gl.LINEAR, minFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE }, page);
  }

  _texture(bmp, s, label) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    const mips = s.minFilter !== gl.LINEAR && s.minFilter !== gl.NEAREST;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, s.magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, s.minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, s.wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, s.wrapT);
    const tex = new GLTex(gl, t, bmp.width, bmp.height, label);
    bmp.close();
    this.textures.push(tex);
    return tex;
  }

  // a framebuffer drawing into the caller's target with a depth-stencil buffer of our own
  _frameBuffer(target, width, height) {
    const gl = this.gl;
    let e = this.frameBuffers.get(target);
    if (e && (e.width !== width || e.height !== height || e.texture !== target.glTexture)) {
      gl.deleteFramebuffer(e.fb); gl.deleteRenderbuffer(e.depth); this.frameBuffers.delete(target); e = null;
    }
    if (!e) {
      const fb = gl.createFramebuffer(), depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.glTexture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`home spot target: framebuffer incomplete 0x${st.toString(16)}`);
      e = { fb, depth, width, height, texture: target.glTexture };
      this.frameBuffers.set(target, e);
    }
    return e.fb;
  }

  // ---------------------------------------------------------------------------------------------- camera and UI
  // SpotCameraController.UiAlphaRatio
  get uiAlpha() { return this.camera.uiAlphaRatio; }

  // SpotCameraController.StopUiFadeAndShow
  stopUiFadeAndShow() { this.camera.stopUiFadeAndShow(); }

  // UIBlurController.ExecBlur(duration) (SpotManager.EffectBlur(_blurDuration 0.2))
  execBlur(duration = 0.2) { this.blur.exec(duration); }

  // UIBlurController.StopBlur()
  stopBlur() { this.blur.stop(); }

  // the blur rate the pass uses this frame (0 while the blur is off)
  get blurRate() { return this.blur.effectiveRate; }

  // the SpotCharacter a tap on which starts the talks of this _characterId (the first one: a tap on any of them
  // selects the same rows), or null
  tapTarget(characterId) { return (this.spot.characters || []).find((x) => x._characterId === characterId) || null; }

  // SpotCameraController.FocusCharacterAsync(the SpotCharacter with this _characterId, duration)
  focusCharacter(characterId, duration = 0.5) {
    const c = this.tapTarget(characterId);
    if (!c || !c.focusWorld) {
      console.warn(`[SpotCameraController] no focus transform for character ${characterId}`);
      return Promise.resolve();
    }
    const m = matrixOf(c.focusWorld, c.path);
    return this.camera.focus(mat4.transformPoint(this.rootMatrix, { x: m[12], y: m[13], z: m[14] }), c._distanceRatio, duration);
  }

  // SpotCameraController.ReturnToDefaultPosition(duration) (RestoreCameraAfterTalkAsync, _talkReturnDuration 0.5)
  returnToDefaultPosition(duration = 0.5) { return this.camera.returnToDefault(duration); }

  // SpotCameraController.Reset
  resetCamera() { this.camera.reset(); }

  // ------------------------------------------------------------------------------------------------------ drawing
  // The main camera into `target` (a GLTarget of width x height): clear per the camera's clear flags, then URP's
  // opaque and transparent lists of the room's renderers and the Spine renderers.
  renderScene(target, width, height) {
    const gl = this.gl;
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._frameBuffer(target, width, height));
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true); gl.depthMask(true); gl.stencilMask(0xff);
    let bits = gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT;
    // ENGINE: a Skybox clear without a skybox material clears to the background colour.
    if (this.clearFlags === CLEAR_SOLID || this.clearFlags === CLEAR_SKYBOX) {
      const c = this.clearColor;
      gl.clearColor(c[0], c[1], c[2], c[3]);
      bits |= gl.COLOR_BUFFER_BIT;
    }
    gl.clearDepth(1); gl.clearStencil(0); gl.clear(bits);
    const cam = this.camera, V = cam.viewMatrix(), P = cam.projection(width / height), t = this.loop.time;
    const globals = { unity_MatrixVP: mat4.mul(P, V), unity_MatrixV: V, _ProjectionParams: [1, cam.near, cam.far, 1 / cam.far],
                      _ScreenParams: [width, height, 1 + 1 / width, 1 + 1 / height], _Time: [t / 20, t, t * 2, t * 3],
                      _GlobalMipBias: [0, 0] };
    const camPos = cam.position, items = this.room.drawItems(this.roomMatrix, camPos).map((it) => ({
      ...it, draw: () => this._drawRoomPart(it.part, globals) }));
    for (const s of this.skeletons) {
      if (!s.mesh || s.skeleton.dirty) this._uploadSkeleton(s);
      if (!s.mesh.indices.length) continue;
      const b = s.mesh.bounds, c = mat4.transformPoint(s.matrix, b.center);
      const mat = this.pageMaterials.get(s.mesh.draws[0].page);
      items.push({ queue: materialQueue(mat, this.shaders), sortingOrder: s.sortingOrder,
                   dist: Math.hypot(c.x - camPos.x, c.y - camPos.y, c.z - camPos.z), draw: () => this._drawSkeleton(s, globals) });
    }
    items.forEach((it, i) => { it.index = i; });
    for (const it of sortDrawItems(items)) it.draw();
    gl.frontFace(gl.CW);
    target.bind();
  }

  // the property sheet of a material record: floats, colours, and per texture slot the texture (when bound) with its
  // _ST and _TexelSize; unset properties fall back to the shader defaults (the last sheet)
  _materialSheets(mat, textures) {
    const s = { ...(mat.floats || {}) };
    for (const [k, c] of Object.entries(mat.colors || {})) s[k] = c;
    for (const [k, t] of Object.entries(mat.texEnvs || {})) s[`${k}_ST`] = [t.scale[0], t.scale[1], t.offset[0], t.offset[1]];
    for (const [k, tex] of Object.entries(textures)) {
      s[k] = tex;
      s[`${k}_TexelSize`] = [1 / tex.width, 1 / tex.height, tex.width, tex.height];
    }
    return [s, this.lib.defaults(mat.shader, this.tex)];
  }

  _bind(prog, bufs) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const [name, loc] of Object.entries(prog.attribs)) {
      if (loc < 0) continue;
      const b = bufs[name];
      if (b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, b.size, b.type, b.normalized, 0, 0);
      } else if (name === "in_COLOR0") gl.vertexAttrib4f(loc, 1, 1, 1, 1);
      else throw new Error(`${prog.label}: vertex attribute ${name} has no data`);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.index);
  }

  // Unity flips the front face for a negative-determinant object matrix
  _frontFace(M) { const gl = this.gl; gl.frontFace(det3(M) < 0 ? gl.CCW : gl.CW); }

  _drawRoomPart(part, globals) {
    const gl = this.gl, mat = part.material, M = this.roomMatrix;
    const sheets = [{ unity_ObjectToWorld: M }, ...this._materialSheets(mat, part.textures), globals];
    for (const pass of part.passes) {
      const prog = this.lib.program(mat.shader, pass, mat.keywords || [], part.subShader);
      prog.apply(sheets);
      applyState(gl, this.lib.state(mat.shader, pass, mat.floats || {}, part.subShader));
      this._frontFace(M);
      this._bind(prog, part.gpu);
      gl.drawElements(gl.TRIANGLES, part.gpu.count, gl.UNSIGNED_INT, 0);
    }
  }

  // SkeletonRenderer.LateUpdate: the mesh of the current pose into the skeleton's buffers
  _uploadSkeleton(s) {
    const mesh = s.mesh = s.skeleton.buildMesh(), gl = this.gl;
    if (!gl) return;
    if (!s.gpu) {
      const b = () => { const x = gl.createBuffer(); this.buffers.push(x); return x; };
      s.gpu = { in_POSITION0: { buffer: b(), size: 3, type: gl.FLOAT, normalized: false },
                in_COLOR0: { buffer: b(), size: 4, type: gl.UNSIGNED_BYTE, normalized: true },
                in_TEXCOORD0: { buffer: b(), size: 2, type: gl.FLOAT, normalized: false }, index: b() };
    }
    const up = (buffer, data, target = gl.ARRAY_BUFFER) => { gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.DYNAMIC_DRAW); };
    up(s.gpu.in_POSITION0.buffer, mesh.positions); up(s.gpu.in_COLOR0.buffer, mesh.colors);
    up(s.gpu.in_TEXCOORD0.buffer, mesh.uvs); up(s.gpu.index, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
  }

  _drawSkeleton(s, globals) {
    const gl = this.gl;
    for (const d of s.mesh.draws) {
      const mat = this.pageMaterials.get(d.page), sub = this.shaders.subShader(mat.shader);
      const sheets = [{ unity_ObjectToWorld: s.matrix }, ...this._materialSheets(mat, { _MainTex: this.pageTextures.get(d.page) }), globals];
      for (const pass of this.shaders.forwardPasses(mat.shader)) {
        const prog = this.lib.program(mat.shader, pass, mat.keywords || [], sub);
        prog.apply(sheets);
        applyState(gl, this.lib.state(mat.shader, pass, mat.floats || {}, sub));
        this._frontFace(s.matrix);
        this._bind(prog, s.gpu);
        gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, d.start * 4);
      }
    }
  }

  // UIRenderPass "CaptureAndBlur" on `target` (the camera colour after the spot and the UI below the blur) in place,
  // skipped while the blur rate is 0
  applyBlur(target, width, height) {
    if (!this.gl) return;
    const pass = blurPass(this.blurParams, this.blur.effectiveRate);
    if (!pass) return;
    this.kawase.apply(target, width, height, pass);
    target.bind();
  }

  dispose() {
    for (const [phase, fn] of this._hooks) {
      const list = this.loop.hooks[phase], i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    this._hooks = [];
    this.camera.kill();
    this.blur.dispose();
    const gl = this.gl;
    if (!gl) return;
    if (this.kawase) this.kawase.dispose();
    for (const b of this.buffers || []) gl.deleteBuffer(b);
    for (const t of [...(this.textures || []), ...Object.values(this.tex || {})]) gl.deleteTexture(t.glTexture);
    for (const e of (this.frameBuffers || new Map()).values()) { gl.deleteFramebuffer(e.fb); gl.deleteRenderbuffer(e.depth); }
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.lib) for (const p of this.lib.cache.values()) {
      gl.deleteProgram(p.program);
      for (const b of p.blocks) gl.deleteBuffer(b.buffer);
    }
    this.buffers = []; this.textures = []; this.frameBuffers = new Map(); this.tex = {}; this.vao = null;
  }
}
