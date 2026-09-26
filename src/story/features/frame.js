import { StoryCommandError } from "../interfaces.js";
import { UIError, uiRoundToInt } from "../../engine/ugui.js";
import { CanvasAnimator, CanvasPrefab, bindCanvasProperty, compOf, compsOf } from "./canvas.js";
import { AnimRecords } from "./clips.js";
import { DOFloat } from "./dotween.js";
import { stretchView, storyScreen } from "./screen.js";
import { featureSlot, featureState } from "./state.js";
import { loopWaitUntil } from "./timing.js";

// Frames: AdvFrameView on UIAdvWidget/FrameCanvas and the AdvFrame prefab instances of frames.json
// (AdvEpisodeResourceLoader.LoadFrame: one instance per TargetAssetName, AdvFrame.Init at load).
//
// AdvFrame: _canvasGroup (the frame's CanvasGroup), _animator (optional), _screenPadding (optional; not in the data).
// IsShowing = gameObject.activeSelf. ShowFrame / HideFrame / Play below follow the game's methods; the awaits of the
// DOTween fades end when the tween is killed (completion or DOKill: UniTask ToUniTask(KillAndCancelAwait)).
// ENGINE: Animator.Play(hash) (layer -1, normalizedTime -Infinity) continues a state that is already current and
// starts any other one at time 0.

const SHOW = "Show", HIDE = "Hide";

// UniTask.WaitForSeconds(duration): Delay(Mathf.RoundToInt(duration * 1000) ms), scaled time at Update
const waitForSeconds = (loop, sec) => loop.delay(uiRoundToInt(sec * 1000) / 1000);

// AdvSlanderCommentTextHelper (StringInfo text elements over the NFC form).
// ENGINE: .NET StringInfo's text element rules; Intl.Segmenter grapheme clusters stand in for them.
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const elements = (s) => (segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s]);
export const slanderText = {
  userName: (n) => (n ? n.normalize("NFC") : ""),
  userId(n, id) {
    if (!id) return "";
    const max = 20 - 1 - elements(n ? n.normalize("NFC") : "").length;
    if (max < 1) return "";
    const e = elements(id.normalize("NFC"));
    return `@${e.length > max ? e.slice(0, max).join("") : e.join("")}`;
  },
  body(b) {
    if (!b) return "";
    let t = b.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const e = elements(t);
    if (!t.includes("\n") && e.length >= 21) t = `${e.slice(0, 20).join("")}\n${e.slice(20).join("")}`;
    return t;
  },
};

// AdvSlanderCommentFrame (IAdvFrameTextReceiver): comment patterns by Animator state name, 3 texts per node
class SlanderCommentFrame {
  constructor(prefab, comp) {
    this.patterns = (comp._patterns || []).map((p) => ({
      state: p._animatorStateName,
      nodes: (p._nodes || []).map((r) => {
        if (!r) return null;
        const c = compOf(prefab.ref(r).rec, "AdvSlanderCommentNode");
        const text = (f) => prefab.ref(compOf(prefab.ref(c[f]).rec, "UIText")._targetText);
        return { userName: text("_userName"), userId: text("_userId"), body: text("_body") };
      }),
    }));
  }

  _set(n, s) { if (n && n.tmp) n.tmp.text = s; }

  clearAll() { for (const p of this.patterns) for (const nd of p.nodes) if (nd) { this._set(nd.userName, ""); this._set(nd.userId, ""); this._set(nd.body, ""); } }

  setTexts(state, texts) {
    this.clearAll();
    const p = this.patterns.find((x) => x.state === state);
    if (!p) { console.warn(`frame comments: no pattern for state ${state}`); return; }
    if (texts.length !== p.nodes.length * 3) {
      console.warn(`frame comments: ${state} expects ${p.nodes.length * 3} texts, got ${texts.length}`);
      return;
    }
    p.nodes.forEach((nd, i) => {
      if (!nd) return;
      const [name, id, body] = texts.slice(3 * i, 3 * i + 3);
      this._set(nd.userName, slanderText.userName(name));
      this._set(nd.userId, slanderText.userId(name, id));
      this._set(nd.body, slanderText.body(body));
    });
  }
}

// AdvFrame
export class FrameInstance {
  constructor(view, name, doc) {
    const screen = view.screen, canvas = screen.canvas.frame;
    this.view = view; this.name = name; this.screen = screen;
    const prefab = this.prefab = new CanvasPrefab(doc.nodes, null, canvas);
    const rootRec = doc.nodes[0], comp = compOf(rootRec, "AdvFrame");
    if (!comp) throw new UIError(`frame ${name}: no AdvFrame`);
    this.root = prefab.root;
    this.group = prefab.ref(comp._canvasGroup);
    if (!this.group || !this.group.canvasGroup) throw new UIError(`frame ${name}: no CanvasGroup`);
    if (comp._screenPadding) throw new UIError(`frame ${name}: AdvFrameScreenPadding not implemented`);
    // Animators of the prefab (the AdvFrame's own one drives the states)
    this.animators = [];
    for (const rec of doc.nodes)
      for (const a of compsOf(rec, "Animator")) {
        const node = prefab.node(rec.path);
        const an = new CanvasAnimator(node, a, (b) => bindCanvasProperty(node, b, (n, prop) => this._bindExtra(n, prop)),
                                    `${name}:${rec.path}`, view.records);
        this.animators.push(an);
        screen.animators.push(an);
        if (comp._animator && comp._animator.gameObject === rec.path) this.animator = an;
      }
    if (comp._animator && !this.animator) throw new UIError(`frame ${name}: Animator ${comp._animator.gameObject} missing`);
    // StretchPosition (MonoBehaviour Update: offsetMax.x = -(positionPercent / 100) x parent width)
    for (const n of prefab.nodes.values())
      if (n.stretch) screen.updaters.push(() => {
        if (!n.stretch.enabled || !n.activeInHierarchy || !n.parent.rect) return;
        // offsetMax = anchoredPosition + sizeDelta x (1 - pivot): keep offsetMin, move offsetMax.x
        const w = n.parent.rect.w, target = -(n.stretch.positionPercent / 100) * w;
        const offMin = n.anchoredPosition.x - n.sizeDelta.x * n.pivot.x, offMax = n.anchoredPosition.x + n.sizeDelta.x * (1 - n.pivot.x);
        const d = target - offMax;
        n.sizeDelta.x += d;
        n.anchoredPosition.x = offMin + n.sizeDelta.x * n.pivot.x;
      });
    const sl = compOf(rootRec, "AdvSlanderCommentFrame");
    this.receiver = sl ? new SlanderCommentFrame(prefab, sl) : null;
    this.init();
  }

  _bindExtra(n, prop) {
    if (prop === "StretchPosition.positionPercent")
      return n.stretch ? { get: () => n.stretch.positionPercent, set: (v) => { n.stretch.positionPercent = v; } } : null;
    if (prop.startsWith("ParticleSystem.")) return this.screen.particleProperty ? this.screen.particleProperty(n, prop) : null;
    return undefined;
  }

  get cg() { return this.group.canvasGroup; }
  get isShowing() { return this.root.activeSelf; }

  // AdvFrame.SpeedRate: Animator.speed
  set speedRate(v) { if (this.animator) this.animator.speed = v; }

  // GameObjectExtension.SetActiveFast: nothing when activeSelf already has the value
  setActive(v) {
    if (this.root.activeSelf === !!v) return;
    this.root.activeSelf = !!v;
    if (v) for (const a of this.animators) if (a.node.activeInHierarchy) a.onEnable();
    if (this.receiver && !v) this.receiver.clearAll();                  // AdvSlanderCommentFrame.OnDisable
  }

  killFade() { this.screen.dotween.kill(this.cg); }                     // _canvasGroup.DOKill()

  fade(to, dur) {
    const cg = this.cg;
    const t = new DOFloat(this.screen.ctx.loop.tweens, () => cg.alpha, (v) => { cg.alpha = v; }, to, dur);
    this.screen.dotween.add(cg, t);
    return t.promise;
  }

  // Init: the Animator initialised once active, keepAnimatorStateOnDisable on; inactive; tweens killed
  init() {
    if (this.animator) { this.setActive(true); this.animator.keepStateOnDisable = true; }
    this.setActive(false);
    this.killFade();
  }

  // Animator.Play(hash): see the module comment
  _playState(name) {
    const cur = this.animator.currentState();
    if (!(cur && cur.state.name === name)) this.animator.play(name, 0);
  }

  // UniTaskWaitForPlayUntil(animator, 0, 1): one frame, then every Update until the layer-0 normalized time >= 1
  async waitForPlayUntil(stop) {
    const a = this.animator;
    if (!a || !a.enabled) return;
    await this.screen.ctx.loop.yield("Update");
    if (stop()) return;
    await loopWaitUntil(this.screen.ctx.loop, () => a.normalizedTime() >= 1, stop);
  }

  // ShowFrame(duration)
  async show(dur, stop) {
    this.cg.alpha = 0;
    this.killFade();
    this.setActive(true);
    const a = this.animator;
    if (a && a.hasState(SHOW)) {
      if (dur > 0 && !await waitForSeconds(this.screen.ctx.loop, dur)) return;
      if (stop()) return;
      this.cg.alpha = 1;
      this._playState(SHOW);
      await this.waitForPlayUntil(stop);
      return;
    }
    if (a && a.animator) { const cur = a.currentState(); a.play(cur.state.name, 0); }   // Play(fullPathHash, 0, 0)
    if (!(dur > 0)) { this.cg.alpha = 1; return; }
    await this.fade(1, dur);
  }

  // HideFrame(duration): with a Hide state the fade is not used; alpha 0 and inactive at the end (no finally)
  async hide(dur, stop) {
    this.cg.alpha = 1;
    this.killFade();
    const a = this.animator;
    if (a && a.hasState(HIDE)) {
      this._playState(HIDE);
      await this.waitForPlayUntil(stop);
    } else if (dur > 0) await this.fade(0, dur);
    if (stop()) return;
    this.cg.alpha = 0;
    this.setActive(false);
  }

  // Play(stateName): a hidden frame is shown at alpha 1 first; the state restarts from time 0
  async play(state, stop) {
    const a = this.animator;
    if (a && a.hasState(state)) {
      if (!this.isShowing) { this.cg.alpha = 1; this.killFade(); this.setActive(true); }
      a.play(state, 0);
      await this.waitForPlayUntil(stop);
    } else console.warn(`frame ${this.name}: Animator has no state ${state}`);
  }

  snapshot() {
    const a = this.animator && this.animator.currentState();
    return [this.name, this.isShowing, this.cg.alpha, a ? [a.state.name, a.time] : null,
            this.view.node.children.indexOf(this.root)];
  }
}

// AdvFrameView (FrameCanvas) and the loader's frame map
export class FrameView {
  constructor(ctx) {
    this.ctx = ctx;
    this.screen = storyScreen(ctx);
    this.node = stretchView(this.screen.canvas.frame.root, "AdvFrameView");
    this.frames = new Map();                 // TargetAssetName -> FrameInstance
    this.current = null;
  }

  // AdvEpisodeResourceLoader.LoadFrame for every Frame row (IgnoreData rows are not preloaded)
  load(doc) {
    this.records = new AnimRecords(doc, UIError);
    for (const c of this.ctx.episode.commands) {
      if (c.cmd !== "Frame" || c.IgnoreData) continue;
      const name = c.TargetAssetName ?? "";
      if (!name.trim() || this.frames.has(name)) continue;
      const d = doc.frames[name];
      if (!d) throw new StoryCommandError(`frame ${name} is not in the story data`);
      this.frames.set(name, new FrameInstance(this, name, d));
    }
  }

  loaded(name) { return this.frames.get(name ?? "") || null; }

  // AdvFrameView.SetFrame: reparented under the view, last sibling, localPosition 0
  setFrame(frame) {
    this.current = frame;
    if (!frame) return;
    frame.root.setParentLast(this.node);
    frame.root.zeroLocalPosition();
  }

  snapshot() { return [...this.frames.values()].map((f) => f.snapshot()); }
}

export const frameView = (ctx) => featureSlot(ctx, "frame", () => new FrameView(ctx));

export const loadFrames = (ctx) => {
  const file = ctx.story && ctx.story.frames;
  const uses = ctx.episode.commands.some((c) => c.cmd === "Frame" && !c.IgnoreData && (c.TargetAssetName ?? "").trim());
  if (!uses) return null;
  if (!file) throw new StoryCommandError("the story data has no frames.json");
  const v = frameView(ctx);
  v.load(ctx.assets.json(file));
  const s = featureState(ctx);
  s.snapshots = s.snapshots || [];
  s.snapshots.push(() => ({ frames: v.snapshot() }));
  return v;
};
