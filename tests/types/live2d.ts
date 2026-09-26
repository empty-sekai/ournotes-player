// Compile-only check of the Live2D type declarations (npm run typecheck): "ournotes-player/live2d" and
// "ournotes-player/live2d/element" resolve through package.json "exports", and typical uses type-check. Nothing here runs.
import {
  AssetStore, MODEL_FRAME_RATE, ModelPlayer, ModelSession, OurnotesLive2DElement, defineOurnotesLive2D,
  type ExpressionOptions, type ManifestInfo, type ModelInfo, type ModelMotionCallback, type ModelPlayerEventMap,
  type ModelSessionOptions, type MotionEndDetail, type MotionOptions, type MotionStartDetail,
} from "ournotes-player/live2d";
import * as element from "ournotes-player/live2d/element";

export async function useModelPlayer(host: HTMLElement): Promise<string[]> {
  const player = await ModelPlayer.create(host, {
    src: "https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json",
    motion: "", expression: "", loop: false, physics: true, breath: true, seed: 1, paused: false, pixelRatio: 1,
    on: { progress: (e) => console.log(e.detail.loaded / e.detail.total), error: (e) => console.error(e.detail.error) },
  });
  player.addEventListener("ready", (e: CustomEvent<null>) => console.log(e.type));
  player.addEventListener("pause", () => console.log(player.paused));
  const motion: MotionOptions = { fade: 0.5, loop: true };
  const expression: ExpressionOptions = { fade: -1 };
  player.playMotion(player.motions[0] ?? player.defaultMotion, motion);
  player.setExpression(player.expressions[0] ?? player.defaultExpression, expression);
  player.physics = !player.hasPhysics;
  player.breath = false;
  player.pause();
  player.play();
  const info: ModelInfo | null = player.info;
  const character: number | undefined = info?.model?.character;
  const shown: string = info?.model?.names?.["zh-Hant"] ?? info?.model?.label ?? String(character ?? "");
  const names: string[] = [player.name, player.motion, player.expression, String(player.motionPlaying), String(info && info.id), shown];
  const root: HTMLDivElement = player.root, canvas: HTMLCanvasElement = player.canvas;
  console.log(root.tagName, canvas.width, player.session && player.session.time, player.disposed);
  await player.dispose();
  return names;
}

export async function useModelSession(gl: WebGL2RenderingContext): Promise<number> {
  const assets = await AssetStore.fromManifest("models/adv_live2d_rana_003_casual_spring_01.json");
  const manifest: ManifestInfo | null = assets.info;
  const opts: ModelSessionOptions = { gl, assets, seed: 7, width: 600, height: 900, physics: false };
  const session = await ModelSession.create(opts);
  session.playMotion(session.motions[1], { fade: 0.2 });
  session.setExpression(session.defaultExpression);
  session.setPhysics(true);
  session.setBreath(true);
  for (let i = 0; i < MODEL_FRAME_RATE; i++) if (!session.busy) await session.step({ draw: i === MODEL_FRAME_RATE - 1 });
  session.resize(300, 450);
  session.render();
  const t: number = session.time;
  const flags: boolean[] = [session.looping, session.physics, session.hasPhysics, session.breath, session.disposed];
  console.log(manifest && manifest.format, session.info, session.seed, session.name, flags);
  await session.dispose();
  return t;
}

export function useModelElement(): void {
  const cls: typeof OurnotesLive2DElement | null = defineOurnotesLive2D("my-model");
  const el = document.createElement("ournotes-live2d");
  const typed: OurnotesLive2DElement = el;
  el.src = "models/adv_live2d_rana_003_casual_spring_01.json";
  el.motion = "mtn_idle";
  el.loop = true;
  el.paused = false;
  el.addEventListener("ready", () => console.log(el.motions.length, el.expressions, el.defaultMotion, el.hasPhysics));
  void el.ready.then((p: ModelPlayer) => p.pause());
  void el.playMotion("mtn_idle", { fade: 0 }).then(() => el.setExpression("exp_smile01"));
  const events: (keyof ModelPlayerEventMap)[] = ["ready", "play", "pause", "error", "progress"];
  console.log(cls, typed.player, typed.info, events, element.ModelPlayer === ModelPlayer, element.AssetStore === AssetStore);
}

export function useMotionEvents(player: ModelPlayer, session: ModelSession, el: OurnotesLive2DElement): string[] {
  const seen: string[] = [];
  player.addEventListener("motionstart", (e) => seen.push(`${e.detail.name} ${e.detail.loop}`));
  player.addEventListener("motionend", (e: CustomEvent<MotionEndDetail>) => seen.push(e.detail.name));
  const onEnd = (e: CustomEvent<MotionEndDetail>) => seen.push(e.detail.name);
  el.addEventListener("motionend", onEnd);
  el.removeEventListener("motionend", onEnd);
  el.addEventListener("motionstart", (e) => seen.push(`${e.detail.name} ${e.detail.loop}`));
  el.addEventListener("click", (e: MouseEvent) => seen.push(String(e.button)));
  const state: [string, boolean, boolean, number, number | null] = [el.name, el.motionPlaying, el.looping, el.time, el.seed];
  const playerState: [boolean, number, number | null] = [player.looping, player.time, player.seed];
  console.log(state, playerState);
  const cb: ModelMotionCallback = (type, detail) => seen.push(`${type} ${detail.name}`);
  session.onmotion = cb;
  session.onmotion = null;
  const start: MotionStartDetail = { name: "mtn_idle", loop: true };
  const opts: Partial<ModelSessionOptions> = { onMotion: cb };
  console.log(start, opts);
  return seen;
}
