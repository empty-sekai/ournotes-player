import { StoryCommandError } from "../interfaces.js";
import { DOFloat } from "./dotween.js";
import { featureSlot, featureState } from "./state.js";

// PostEffect volumes: AdvGlobalVolume.ToggleVolume / AddChildVolume and AdvChildVolume (Toggle, FadeIn, FadeOut,
// Refresh). Each VolumeProfile of posteffects.json becomes one child volume of the global volume, keyed by the
// profile's name (Object.name = m_Name), created disabled with weight 0. A child is in the volume stack while it is
// enabled: enabling it appends it to the story volume's child list, disabling it removes it, so the list follows the
// volume manager's registration order.
// ENGINE: URP applies global volumes of equal priority in registration order (VolumeManager); a Volume registers in
// OnEnable and unregisters in OnDisable.

// AdvChildVolume
export class ChildVolume {
  constructor(ctx, profile) {
    this.ctx = ctx;
    this.name = profile.name;
    this.volume = { profile, weight: 0, enabled: false };       // AddChildVolume: weight 0, enabled false
    this.tween = null;
  }

  _setEnabled(on) {
    if (this.volume.enabled === on) return;
    this.volume.enabled = on;
    if (on) this.ctx.volume.addChildVolume(this.volume);
    else this.ctx.volume.removeChildVolume(this.volume);
  }

  _killTween() {                                              // _tween?.Kill(false)
    const t = this.tween;
    if (t) t.kill();
  }

  // Toggle: FadeOut when the volume is enabled, else FadeIn
  toggle(dur) { return this.volume.enabled ? this.fadeOut(dur) : this.fadeIn(dur); }

  // FadeIn: enabled, weight 1 at once for dur <= 0, else DOTween.To(weight -> 1, dur) (default ease), _tween = null
  // in the finally block
  fadeIn(dur) {
    this._setEnabled(true);
    this._killTween();
    if (!(dur > 0)) { this.volume.weight = 1; return Promise.resolve(); }
    const t = this.tween = new DOFloat(this.ctx.loop.tweens, () => this.volume.weight, (x) => { this.volume.weight = x; }, 1, dur, {
      onKill: () => { if (this.tween === t) this.tween = null; } });
    return t.promise;
  }

  // FadeOut: weight 0 and disabled at once for dur <= 0, else DOTween.To(weight -> 0, dur); the finally block clears
  // _tween and disables the volume. The finally runs inside a Kill (UniTask continues the awaiting method there), so
  // a fade-out killed by a second one disables the volume before the second tween starts.
  fadeOut(dur) {
    this._killTween();
    if (!(dur > 0)) { this.volume.weight = 0; this._setEnabled(false); return Promise.resolve(); }
    const t = this.tween = new DOFloat(this.ctx.loop.tweens, () => this.volume.weight, (x) => { this.volume.weight = x; }, 0, dur, {
      onKill: () => { if (this.tween === t) this.tween = null; this._setEnabled(false); } });
    return t.promise;
  }

  // Refresh: tween killed, the volume destroyed
  refresh() {
    const t = this.tween;
    this.tween = null;
    if (t) { t.onKill = null; t.kill(); }
    this._setEnabled(false);
  }
}

// the episode's post effects: posteffects.json profiles by TargetAssetName and the child volumes by profile name
export const postEffects = (ctx) => featureSlot(ctx, "postEffect", () => ({ profiles: new Map(), children: new Map() }));

export const loadPostEffects = async (ctx) => {
  const pe = postEffects(ctx), file = ctx.story && ctx.story.postEffects;
  if (!file) return pe;
  const doc = ctx.assets.json(file);
  for (const [name, profile] of Object.entries(doc.postEffects || {})) {
    if (profile.asset !== "VolumeProfile") throw new StoryCommandError(`post effect ${name}: not a VolumeProfile`);
    pe.profiles.set(name, profile);
  }
  const s = featureState(ctx);
  s.disposers.push(() => { for (const c of pe.children.values()) c.refresh(); pe.children.clear(); });
  s.snapshots = s.snapshots || [];
  s.snapshots.push(() => ({ postEffect: [...pe.children.values()].map((c) => [c.name, c.volume.enabled, c.volume.weight]) }));
  if (ctx.renderer) await ctx.renderer.post.loadVolumeTextures("", [...pe.profiles.values()], ctx.assets);
  return pe;
};

// AdvGlobalVolume.ToggleVolume(profile, fadeDuration): the main camera's stack is re-evaluated from now on
// (MarkUpdateOnceBaseCameras); a profile toggles its child volume (created on first use), no profile fades every
// child out. The fades run on (UniTask Forget).
export const toggleVolume = (ctx, profile, dur) => {
  const pe = postEffects(ctx);
  ctx.volume.markUpdateOnce();
  if (profile) {
    let c = pe.children.get(profile.name);
    if (!c) { c = new ChildVolume(ctx, profile); pe.children.set(profile.name, c); }
    c.toggle(dur);
  } else {
    for (const c of pe.children.values()) c.fadeOut(dur);
  }
};
