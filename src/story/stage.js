import { Prefab } from "../engine/prefab.js";
import { StoryCommandError } from "./interfaces.js";
import { createStageParticleGroups, releaseStageParticleGroups } from "./features/effect.js";

// A story stage: the exported stage prefab (AdvStage component on its root) with the data the Stage command applies.

// Unity LightType
export const LIGHT_TYPE = { 0: "Spot", 1: "Directional", 2: "Point", 3: "Area" };

export class AdvStageData {
  constructor(exported) {
    this.prefab = new Prefab(exported);
    const rootPath = this.prefab.root.name;
    const s = this.prefab.component(rootPath, "AdvStage");
    this.raw = s;
    this.name = rootPath;
    this.characterFieldPosition = s._characterFieldPosition;
    this.characterFieldScale = s._characterFieldScale;
    this.backgroundFieldPosition = s._backgroundFieldPosition;
    this.backgroundFieldScale = s._backgroundFieldScale;
    this.backgroundSprite = s._backgroundSprite;
    this.backgroundColor = s._backgroundColor;
    this.fov = s._fov;
    this.initialCameraPosition = s._initialCameraPosition;
    this.initialCameraRotation = s._initialCameraRotation;
    this.focusDataSettingsKey = s._usingFocusDataSettingsKey;
    this.focusPoints = s._focusPointsCollection._entries.map((e) => e._focusPointPositions);
    this.shadow = {
      texture: s._shadowTexture, uv: s._shadowTextureUv, intensity: s._shadowTextureIntensity,
      amplitude: s._shadowTextureAmplitude, frequency: s._shadowTextureFrequency,
    };
    // a feature of the stage format this player does not draw: refused when the stage is loaded
    if (this.shadow.texture) throw new StoryCommandError(`stage ${this.name}: shadow textures are not supported`);
    this.particleEffectGroupCollection = s._particleEffectGroupCollection;
    // the effects of each AdvParticleEffectGroup (built by initParticleGroups)
    this.particleGroups = this.particleEffectGroupCollection._groups.map(() => []);
    this.loop = null;
    this.volumeProfiles = s._allVolumeProfileCollection._profiles;
    this.lightGroups = s._lightGroupCollection._groups.map((g) => g._lights.map((ref) => {
      const light = this.prefab.component(ref.gameObject, "Light");
      const urp = this.prefab.component(ref.gameObject, "UniversalAdditionalLightData");
      return { path: ref.gameObject, transform: this.prefab.transform(ref.gameObject), light, urp,
               type: LIGHT_TYPE[light.m_Type] };
    }));
    // AdvStage.Init -> AdvLightGroupCollection.Init: every light's GameObject inactive
    this.lightActive = new Map();
    for (const g of this.lightGroups) for (const l of g) this.lightActive.set(l.path, false);
    this.currentLightGroup = 0;             // the group ShowLights / HideLights act on (ChangeLights sets it)
    this.currentParticleEffectGroup = 0;
  }

  // AdvLightGroupCollection.TryGetGroup / AdvVolumeProfileCollection.TryGetProfile: nothing from an empty list; an
  // index out of range of a non-empty list is reported
  _entry(list, index, what) {
    if (!list.length) return null;
    if (index >= 0 && index < list.length) return list[index] || null;
    console.warn(`stage ${this.name}: ${what} ${index} out of range 0..${list.length - 1}`);
    return null;
  }

  _setLightGroupActive(index, active) {     // AdvLightGroup.ShowLights / HideLights: SetActiveFast per light
    const g = this._entry(this.lightGroups, index, "light group");
    if (g) for (const l of g) this.lightActive.set(l.path, active);
  }

  // A shared asset (e.g. a volume profile used by several stages) is exported in full once and by name elsewhere;
  // resolves those names across the stages.
  static resolveShared(stages) {
    const profiles = new Map();
    for (const st of stages) for (const p of st.volumeProfiles) if (p.components) profiles.set(p.name, p);
    for (const st of stages) {
      st.volumeProfiles = st.volumeProfiles.map((p) => {
        if (p.components) return p;
        const full = profiles.get(p.name);
        if (!full) throw new Error(`stage ${st.name}: volume profile ${p.name} not exported`);
        return full;
      });
    }
  }

  showLights() { this._setLightGroupActive(this.currentLightGroup, true); }
  hideLights() { this._setLightGroupActive(this.currentLightGroup, false); }

  // ChangeLights: the current group hidden, the index kept on the stage, group `index` shown
  changeLights(index) {
    this._setLightGroupActive(this.currentLightGroup, false);
    this.currentLightGroup = index;
    this._setLightGroupActive(index, true);
  }

  // the lights whose GameObject is active, each once, in group order
  activeLights() {
    const seen = new Set(), out = [];
    for (const g of this.lightGroups) for (const l of g) {
      if (this.lightActive.get(l.path) && !seen.has(l.path)) { seen.add(l.path); out.push(l); }
    }
    return out;
  }

  get hasParticleEffects() { return this.particleEffectGroupCollection._groups.some((g) => g._particleEffects.length > 0); }

  // AdvStage.Init -> AdvParticleEffectGroupCollection.Init: each group's effects built over the stage prefab and
  // initialized (stopped, cleared, hidden). records: AnimRecords of the scene data file; opts.rng: UnityEngine.Random.
  initParticleGroups(ctx, records, opts = {}) {
    this.loop = ctx.loop;
    if (!this.hasParticleEffects) return;
    this.particleGroups = createStageParticleGroups(ctx, this.name, this.prefab, this.particleEffectGroupCollection,
                                                    records, opts);
    this._releaseGroups = () => releaseStageParticleGroups(ctx, this.particleGroups);
  }

  // the effects are no longer updated or drawn
  releaseParticleGroups() {
    if (this._releaseGroups) this._releaseGroups();
    this._releaseGroups = null;
    this.particleGroups = this.particleGroups.map(() => []);
  }

  // AdvParticleEffectGroupCollection.TryGetGroup -> each effect's Play() / Stop(false)
  _playGroup(index) { for (const e of this._entry(this.particleGroups, index, "particle effect group") || []) e.play(); }
  _stopGroup(index) {
    for (const e of this._entry(this.particleGroups, index, "particle effect group") || []) e.stop(false, this.loop);
  }

  // PlayParticleEffects / StopParticleEffects: the current group
  playParticleEffects() { this._playGroup(this.currentParticleEffectGroup); }
  stopParticleEffects() { this._stopGroup(this.currentParticleEffectGroup); }

  // ChangeParticleEffects: the current group stopped, the index kept on the stage, group `index` played
  changeParticleEffects(index) {
    this._stopGroup(this.currentParticleEffectGroup);
    this.currentParticleEffectGroup = index;
    this._playGroup(index);
  }

  // SetPlaybackSpeed: every effect of every group
  setPlaybackSpeed(rate) { for (const g of this.particleGroups) for (const e of g) e.setPlaybackSpeed(rate); }

  // TryGetVolumeProfileAll
  volumeProfile(index) { return this._entry(this.volumeProfiles, index, "volume profile"); }
}
