import { LiveIntro } from "./intro.js";
import { LiveLane } from "./lane.js";

// LiveStage: the 3D lane (LiveLane) and the start timeline (LiveIntro), updated in the loop phases and submitted
// to LiveRenderer each frame. The scene is `assets.json("livescene/scene.json")` (infinities are written as 1e999,
// which JSON.parse reads as Infinity).
//
// Use (the chart session):
//   const stage = new LiveStage(renderer, scene, loop); await stage.load(); stage.attach(loop);
//   stage.startIntro()  at MusicStartAnimationStateNode.Enter (the intro timeline runs on game time from here;
//                       stage.intro.done / stage.intro.onEnd tell the session when to PlayMusic)
//   render hook:        stage.submit(renderer) before renderer.render()
export class LiveStage {
  constructor(renderer, scene, loop) {
    this.r = renderer; this.scene = scene; this.loop = loop;
    this.lane = new LiveLane(renderer, scene);
    this.intro = LiveIntro ? new LiveIntro(this) : null;
  }

  async load() {
    await this.lane.load();
    if (this.intro) await this.intro.load();
  }

  attach(loop) { if (this.intro) this.intro.attach(loop); }

  startIntro() {
    if (!this.intro) throw new Error("LiveIntro missing");
    this.intro.start();
  }

  submit() {
    this.lane.submit();
    if (this.intro) this.intro.submit();
  }

  debugState() {
    const P = this.r.prefab;
    return { laneActive: this.lane.active, tapAlpha: +this.lane.tapArea.animationAlpha.toFixed(4),
             stageScale: this.r.canvas.stage.localScale, intro: this.intro ? this.intro.debugState() : null,
             liveGameView: P.activeInHierarchy("LiveGameView") };
  }
};
