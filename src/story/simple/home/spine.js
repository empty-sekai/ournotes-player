// Spine skeletons of the home spot (SpotSpineCharacter -> Spine.Unity SkeletonAnimation) through a Spine runtime the
// page provides, and the mesh SkeletonRenderer builds from them (Spine.Unity MeshGenerator: one mesh per skeleton,
// a submesh per atlas page change, Color32 vertex colours with pmaVertexColors, z = zSpacing per draw-order index).
//
// The Spine runtime is not part of this package: the page loads Esoteric Software's own spine-core build for the
// skeleton data's version (Spine Runtimes license), which defines the global `spine`. spineRuntime() checks what the
// host needs from it; without a usable runtime the room still draws and the talk plays, and the host reports
// "Spine runtime missing".
//
// SkeletonAnimation (updateTiming InUpdate) advances in the frame's Update: AnimationState.Update(dt x timeScale),
// Skeleton.Update, AnimationState.Apply, UpdateWorldTransform(Physics.Update). SpotManager.PlayInAnimation plays the
// initial animation ("home_start", no loop) on every character when the spot appears, long before a talk starts;
// afterwards the skeletons hold its last frame and nothing in the talk path re-animates them. The host therefore starts
// each skeleton at that end state (applyEndState: mix 0, track time = the animation's duration, Update(0), Apply,
// UpdateWorldTransform), as the spot preview's ApplyAnimationEndState does.

const f = Math.fround;

// the members of the runtime the host uses
export const SPINE_API = Object.freeze(["TextureAtlas", "AtlasAttachmentLoader", "SkeletonJson", "SkeletonBinary",
  "Skeleton", "AnimationState", "AnimationStateData", "Physics", "SkeletonClipping", "RegionAttachment",
  "MeshAttachment", "ClippingAttachment", "BlendMode"]);

export const majorMinor = (v) => {
  const m = /^(\d+)\.(\d+)/.exec(String(v ?? ""));
  return m ? `${m[1]}.${m[2]}` : null;
};

// major.minor of a spine-core build: its `version` string when it has one, else from what the build exports (4.2 added
// the Physics enum and the physics constraint timelines; 4.3 splits bone and slot poses into BonePose / SlotPose; 4.1
// added sequences)
export const spineRuntimeVersion = (S) => {
  if (!S) return null;
  if (typeof S.version === "string") return majorMinor(S.version);
  if (S.BonePose || S.SlotPose) return "4.3";
  if (S.Physics && (S.PhysicsConstraintTimeline || S.PhysicsConstraint)) return "4.2";
  if (S.SequenceTimeline || S.Sequence) return "4.1";
  return null;
};

// {runtime, reason}: the runtime when it has SPINE_API and reads skeleton data of `dataVersion` (major.minor must
// match, as Spine runtimes require), else runtime null and the reason
export const spineRuntime = (candidate = globalThis.spine, dataVersion = "4.2") => {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function"))
    return { runtime: null, reason: "no Spine runtime: the page did not load Esoteric Software's spine-core (global `spine`)" };
  const lack = SPINE_API.filter((k) => !candidate[k]);
  if (lack.length) return { runtime: null, reason: `the Spine runtime lacks ${lack.join(", ")}` };
  const want = majorMinor(dataVersion), have = spineRuntimeVersion(candidate);
  if (!want) return { runtime: null, reason: `skeleton data version '${dataVersion}' not understood` };
  if (!have) return { runtime: null, reason: "the Spine runtime's version could not be determined" };
  if (have !== want) return { runtime: null, reason: `Spine runtime ${have} cannot read skeleton data ${dataVersion}` };
  return { runtime: candidate, reason: null };
};

// the editor version a skeleton file was exported with: JSON skeleton.spine, or the binary header (8-byte hash, then
// the version string: varint length + 1, UTF-8)
export const skeletonDataVersion = (file, content) => {
  if (/\.json$/i.test(file)) {
    const d = typeof content === "string" ? JSON.parse(content) : content;
    return d && d.skeleton ? d.skeleton.spine ?? null : null;
  }
  const b = content instanceof Uint8Array ? content : new Uint8Array(content);
  let p = 8, n = 0, shift = 0, byte;
  do { byte = b[p++]; n |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80 && shift < 35);
  if (n <= 1) return null;
  return new TextDecoder("utf-8").decode(b.subarray(p, p + n - 1));
};

// the atlas page an attachment's current region is on (AtlasRegion.page; the region's renderer object in spine-unity)
const pageOf = (a) => (a.region && a.region.page ? a.region.page.name : null);

const QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];

// (byte)(x) of a float in 0..255
const toByte = (x) => Math.min(255, Math.max(0, Math.trunc(x)));

// One SkeletonAnimation: the runtime skeleton and animation state of a SpotSpineCharacter.
//   runtime: the checked spine runtime; data: SkeletonData; stateData: AnimationStateData; anim: the spot.json
//   SkeletonAnimation fields (_animationName, loop, timeScale, initialSkinName, initialFlipX / Y, pmaVertexColors,
//   tintBlack, zSpacing)
export class SpotSkeleton {
  constructor(runtime, data, stateData, anim) {
    const S = this.S = runtime;
    this.anim = anim;
    if (anim.tintBlack) throw new Error("SkeletonAnimation tintBlack is not implemented");
    // SkeletonRenderer.Initialize
    const sk = this.skeleton = new S.Skeleton(data);
    sk.scaleX = anim.initialFlipX ? -1 : 1;
    sk.scaleY = anim.initialFlipY ? -1 : 1;
    if (anim.initialSkinName && anim.initialSkinName !== "default") sk.setSkinByName(anim.initialSkinName);
    this.state = new S.AnimationState(stateData);
    this.clipper = new S.SkeletonClipping();
    this.timeScale = anim.timeScale ?? 1;
    this.world = new Float32Array(2048);
    this.dirty = true;
  }

  // SkeletonAnimation with _animationName set: SetAnimation(0, name, loop), then held at its end (module header)
  applyEndState() {
    const S = this.S, name = this.anim._animationName;
    const anim = name ? this.skeleton.data.findAnimation(name) : null;
    if (anim) {
      const e = this.state.setAnimation(0, name, !!this.anim.loop);
      e.mixDuration = 0;
      e.trackTime = anim.duration;
    }
    this.state.update(0);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform(S.Physics.update);
    this.dirty = true;
  }

  // SkeletonAnimation.Update(deltaTime) with updateTiming InUpdate
  update(dt) {
    const d = f(dt * this.timeScale);
    this.state.update(d);
    this.skeleton.update(d);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform(this.S.Physics.update);
    this.dirty = true;
  }

  _worldBuffer(n) {
    if (this.world.length < n) this.world = new Float32Array(Math.max(n, this.world.length * 2));
    return this.world;
  }

  // MeshGenerator (SkeletonRenderer.LateUpdate) for the current pose. Returns {positions (xyz), colors (RGBA bytes),
  // uvs, indices, draws: [{page, start, count}], bounds: {min, max, center} | null}. UVs are in Unity's bottom-left
  // texture space (v flipped from the atlas' top-left space, as spine-unity's atlas does), matching textures uploaded
  // with row 0 at the bottom.
  buildMesh() {
    const S = this.S, sk = this.skeleton, clipper = this.clipper, anim = this.anim;
    const pma = anim.pmaVertexColors !== 0 && anim.pmaVertexColors !== false, zSpacing = f(anim.zSpacing || 0);
    const pos = [], col = [], uv = [], idx = [], draws = [];
    const skc = sk.color;
    let cur;
    sk.drawOrder.forEach((slot, order) => {
      if (!slot.bone.active) { clipper.clipEndWithSlot(slot); return; }
      const a = slot.getAttachment();
      let n, verts, uvs, tris;
      if (a instanceof S.RegionAttachment) {
        if (a.sequence) a.sequence.apply(slot, a);
        verts = this._worldBuffer(8);
        a.computeWorldVertices(slot, verts, 0, 2);
        n = 4; uvs = a.uvs; tris = QUAD_TRIANGLES;
      } else if (a instanceof S.MeshAttachment) {
        if (a.sequence) a.sequence.apply(slot, a);
        verts = this._worldBuffer(a.worldVerticesLength);
        a.computeWorldVertices(slot, 0, a.worldVerticesLength, verts, 0, 2);
        n = a.worldVerticesLength >> 1; uvs = a.uvs; tris = a.triangles;
      } else if (a instanceof S.ClippingAttachment) {
        clipper.clipStart(slot, a);
        return;
      } else { clipper.clipEndWithSlot(slot); return; }
      // Color32: pmaVertexColors multiplies rgb by the byte alpha; an additive slot gets alpha 0
      const sc = slot.color, ac = a.color;
      const alpha = f(f(f(skc.a) * f(sc.a)) * f(ac.a));
      let A = toByte(f(alpha * 255));
      const ch = (s, t, u) => (pma ? toByte(f(f(f(f(s) * f(t)) * f(u)) * A)) : toByte(f(f(f(f(s) * f(t)) * f(u)) * 255)));
      const R = ch(skc.r, sc.r, ac.r), G = ch(skc.g, sc.g, ac.g), B = ch(skc.b, sc.b, ac.b);
      if (pma && slot.data.blendMode === S.BlendMode.Additive) A = 0;
      if (clipper.isClipping()) ({ n, verts, uvs, tris } = this._clip(verts, n, uvs, tris));
      if (!n || !tris.length) { clipper.clipEndWithSlot(slot); return; }
      const page = pageOf(a);
      if (!draws.length || page !== cur) { draws.push({ page, start: idx.length, count: 0 }); cur = page; }
      const base = pos.length / 3, z = f(zSpacing * order);
      for (let i = 0; i < n; i++) {
        pos.push(verts[i * 2], verts[i * 2 + 1], z);
        uv.push(uvs[i * 2], f(1 - uvs[i * 2 + 1]));
        col.push(R, G, B, A);
      }
      for (const t of tris) idx.push(base + t);
      draws[draws.length - 1].count += tris.length;
      clipper.clipEndWithSlot(slot);
    });
    clipper.clipEnd();
    this.dirty = false;
    return { positions: Float32Array.from(pos), colors: Uint8Array.from(col), uvs: Float32Array.from(uv),
             indices: Uint32Array.from(idx), draws, bounds: SpotSkeleton.bounds(pos) };
  }

  // SkeletonClipping on one attachment: the clipped triangles with their positions and uvs
  _clip(verts, n, uvs, tris) {
    const c = this.clipper;
    if (typeof c.clipTrianglesUnpacked === "function") {
      c.clipTrianglesUnpacked(verts, tris, tris.length, uvs);
      const v = c.clippedVertices, u = c.clippedUVs;
      return { n: v.length >> 1, verts: v, uvs: u, tris: c.clippedTriangles };
    }
    // older 4.2 builds: interleaved x, y, r, g, b, a, u, v
    const light = new this.S.Color(1, 1, 1, 1), dark = new this.S.Color(0, 0, 0, 1);
    c.clipTriangles(verts, n * 2, tris, tris.length, uvs, light, dark, false);
    const cv = c.clippedVertices, m = cv.length / 8, v = new Float32Array(m * 2), u = new Float32Array(m * 2);
    for (let i = 0; i < m; i++) { v[i * 2] = cv[i * 8]; v[i * 2 + 1] = cv[i * 8 + 1]; u[i * 2] = cv[i * 8 + 6]; u[i * 2 + 1] = cv[i * 8 + 7]; }
    return { n: m, verts: v, uvs: u, tris: c.clippedTriangles };
  }

  static bounds(pos) {
    if (!pos.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
    const min = { x: lo[0], y: lo[1], z: lo[2] }, max = { x: hi[0], y: hi[1], z: hi[2] };
    return { min, max, center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 } };
  }
}

// Skeleton data of spot.json `skeletons[]` records through the runtime (SkeletonDataAsset.GetSkeletonData: the
// atlases' regions, the skeleton file read at the asset's scale; GetAnimationStateData: defaultMix and the mixes).
// `read(file)` returns a file of the spot's spine directory as text (atlas, JSON) or bytes (.skel).
export class SpotSkeletonData {
  constructor(runtime, skeletons, readText, readBytes) {
    this.S = runtime;
    this.atlases = new Map();             // atlas file -> TextureAtlas
    this.records = new Map();             // SkeletonDataAsset name -> {record, data, stateData}
    for (const rec of skeletons) {
      const atlases = rec.atlases.map((file) => {
        if (!this.atlases.has(file)) this.atlases.set(file, new runtime.TextureAtlas(readText(file)));
        return this.atlases.get(file);
      });
      // one loader over every atlas of the asset (AtlasAttachmentLoader reads regions through findRegion)
      const source = atlases.length === 1 ? atlases[0]
        : { findRegion: (name) => { for (const a of atlases) { const r = a.findRegion(name); if (r) return r; } return null; } };
      const loader = new runtime.AtlasAttachmentLoader(source);
      const binary = !/\.json$/i.test(rec.skeleton);
      const reader = binary ? new runtime.SkeletonBinary(loader) : new runtime.SkeletonJson(loader);
      reader.scale = rec.scale;
      const data = reader.readSkeletonData(binary ? readBytes(rec.skeleton) : readText(rec.skeleton));
      const stateData = new runtime.AnimationStateData(data);
      stateData.defaultMix = rec.defaultMix ?? 0;
      for (const m of rec.mixes || []) stateData.setMix(m.from, m.to, m.duration);
      this.records.set(rec.name, { record: rec, data, stateData });
    }
  }

  // atlas page names in atlas order, over every atlas
  pages() { return [...this.atlases.values()].flatMap((a) => a.pages.map((p) => p.name)); }

  skeleton(name, anim) {
    const r = this.records.get(name);
    if (!r) throw new Error(`skeleton data ${name} not in spot.json skeletons`);
    return new SpotSkeleton(this.S, r.data, r.stateData, anim);
  }
}
