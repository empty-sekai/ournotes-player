import { UnityRandom } from "../engine/random.js";
import { FxScene, LiveLaneEffects, LiveNoteEffects } from "./fx-effects.js";
import { LiveUIFx } from "./fx-ui.js";
import { FxMaterials, LiveIntroStars } from "./particles.js";

// Hit feedback of the live chart player (LiveFx): note effects + slide hold loop and lane effects (fx-effects.js),
// ParticleSystems and the lane-in stars of the start timeline (particles.js), judgement text + combo counter
// (fx-ui.js), driven by the executor's frame result and drawn through the renderer's submit interface.
//
// The session constructs one LiveFx, awaits load(), calls update(fr) in the `update` phase right after
// the note views (LiveGameView.UpdateFrame: note views, lane effects, note effects; then LiveUIView), and submit()
// in the render hook before renderer.render(). LiveFx registers its own `tweens` and `animation` hooks.
//
// Unity phases used here (PlayerLoop of Unity 6):
//   Update           LiveViewPresenter.UpdateLiveSimulateFrame -> lane effects, note effects, judgement, combo
//   DOTween          judgement sequences (DOTweenComponent.Update, `tweens` phase)
//   PreLateUpdate    DirectorUpdateAnimation (every Animator: note effects, combo) then ParticleSystemBeginUpdateAll
//                    (every ParticleSystem steps by deltaTime) — both in the `animation` phase, Animators first.
// The order among Animators inside DirectorUpdateAnimation and among ParticleSystems inside the particle update is
// engine-internal; no system here reads another one's output within a frame, so the order has no visible effect.
// ENGINE: particle jobs start at ParticleSystemBeginUpdateAll and sync before rendering; one simulate(dt) per frame here.
// (The sync is PostLateUpdate ParticleSystemEndUpdateAll, so stepping in the animation phase is equivalent for drawing.)

export class LiveFx {
  // gl may be null (Node tests). notes = assets.json("livenotes/notes.json"), score = score/<file>.notes.json,
  // scene = assets.json("livescene/scene.json"). introStars = () => stage.intro.stars() (the 7 lane-in
  // star emitters of the start timeline; the session constructs LiveFx after the stage so that this object's animation
  // hook runs after the timeline evaluation of the frame, as Unity's DirectorUpdateAnimation precedes
  // ParticleSystemBeginUpdateAll). seed: UnityRandom seed of the particle stream.
  // ENGINE: effect ParticleSystems use autoRandomSeed, so the game's values are not reproducible; deterministic per seed here.
  constructor({ gl, loop, notes, score, scene, introStars = null, seed = 1 }) {
    this.gl = gl; this.loop = loop;
    this.materials = new FxMaterials(gl, "livenotes");
    this.sceneMaterials = new FxMaterials(gl, "livescene");      // white_star (shader + texture under livescene/)
    this.rng = new UnityRandom(seed);
    this.introStars = introStars;
    this.stars = new LiveIntroStars(gl, { materials: this.sceneMaterials, rng: this.rng });
    const opts = { notes, score, sceneInfo: FxScene.read(scene), materials: this.materials, rng: this.rng };
    this.lane = new LiveLaneEffects(gl, opts);
    this.note = new LiveNoteEffects(gl, opts);
    this.uiArgs = { scene, notes, score };
    this.ui = new LiveUIFx(gl, this.uiArgs);
    this.frozen = false;             // a step that does not count (the player's seek after a long clock jump)
    loop.on("tweens", (l) => { if (!this.frozen) this.ui.tweens(l.deltaTime); });
    loop.on("animation", (l) => { if (!this.frozen) this.animation(l.deltaTime); });
  }

  async load() {
    if (this.introStars) this.stars.prepare(this.introStars());       // registers the star material before loading
    await this.materials.load();
    await this.sceneMaterials.load();
    await this.note.load();
    await this.lane.load();
    await this.ui.load();
  }

  // LiveGameView.UpdateFrame (after LiveAllNoteView.UpdateNoteView): LiveLaneEffectView.UpdateFrame,
  // LiveAllNoteEffectView.UpdateFrame; then LiveUIView.UpdateLiveSimulateFrame (ShowJudgement, ...,
  // UIComboCounterView.UpdateView).
  update(frameResult) {
    const fr = LiveFx.frame(frameResult);
    this.lane.update(fr);
    this.note.update(fr);
    this.ui.update(fr);
  }

  animation(dt) {
    if (this.lane.animate) this.lane.animate(dt);
    this.note.animate(dt);
    this.ui.animate(dt);
    this.lane.simulate(dt);
    this.note.simulate(dt);
    if (this.introStars) this.stars.update(this.introStars(), dt);
  }

  // LiveViewPresenter.HideUI (MusicStartAnimationStateNode.Enter, before the start timeline) -> false;
  // LiveViewPresenter.SetActiveLiveUI(true) (LiveStartStateNodeBase.Enter) -> true. The session calls it at those points.
  setUIActive(v) { this.ui.setActive(v); }

  // ---- seek support (the player's progress bar; not a game feature)
  // Every playing effect removed: note effects and hold loops back to their pools (OnStopEffect path), lane effects
  // stopped (Clear + Stop), the lane-in stars' particles cleared. The live UI (judgement, combo) is not touched.
  clearEffects() {
    const ne = this.note;
    for (const e of [...ne.activeOneShot]) ne.onStopEffect(e);
    for (const e of ne.lineEffects.values()) {
      if (!e) continue;
      e.restoreDefaultValues();
      e.setElementActive(false);
      ne.pool(22).return(e);
    }
    ne.lineEffects.clear();
    for (const e of this.lane.elements()) {
      if (e.isPlaying) e.stop();
      if (e.baseSystem) e.baseSystem.clear(true);
    }
    for (const { ps } of this.stars.entries.values()) ps.clear(true);
  }

  // the live UI in its state after load (a new LiveUIFx on the loaded GL resources), keeping LiveUIView's active flag
  resetUI() {
    const u = new LiveUIFx(this.gl, this.uiArgs);
    u.adoptGL(this.ui);
    u.root.canvasGroup.alpha = this.ui.root.canvasGroup.alpha;
    this.ui = u;
  }

  // one frame of the live UI only (update phase with the frame result, DOTween, Animator), as in update() / the hooks
  uiFrame(frameResult, dt) {
    if (frameResult) this.ui.update(LiveFx.frame(frameResult));
    this.ui.tweens(dt);
    this.ui.animate(dt);
  }

  submit(renderer) {
    this.lane.submit(renderer);
    this.note.submit(renderer);
    if (this.introStars) this.stars.submit(renderer);
    this.ui.submit(renderer);
  }

  // Frame-result view read by the effect and UI modules over LiveExecutor's frame result
  // (simulator.js; the executor overwrites `fr` in place every frame).
  static frame(fr) {
    return {
      timeMs: fr.timeMs, judgedNotes: fr.judgedNotes, updateLineIds: fr.updateLineIds,
      lineState: (id) => fr.lineState(id), line: (id) => fr.line(id), note: (id) => fr.note(id),
      combo: fr.combo, isAllPerfect: fr.isAllPerfect, isFullCombo: fr.isFullCombo,
    };
  }
};
