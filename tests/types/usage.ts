// Compile-only check of the published type declarations (npm run typecheck): the package entry points resolve through
// package.json "exports", and typical uses type-check. Nothing here runs.
import {
  AssetStore, ChartPlayer, ChartSession, LIVE_SPEEDS, OurnotesPlayerElement, defineOurnotesPlayer, formatTime,
  type ChartInfo, type ChartPlayerEventMap,
} from "ournotes-player";
import * as element from "ournotes-player/element";

export async function usePlayer(host: HTMLElement): Promise<void> {
  const player = await ChartPlayer.create(host, {
    src: "https://example.org/site/charts/100001_expert.json",
    controls: true,
    speed: LIVE_SPEEDS[0],
    on: { progress: (e) => console.log(e.detail.loaded / e.detail.total) },
  });
  player.addEventListener("seeked", (e) => console.log(e.detail.time.toFixed(0)));
  player.addEventListener("error", (e) => console.error(e.detail.error));
  const reached: number = await player.seek(30_000);
  player.speed = 1.25;
  player.music = false;
  const info: ChartInfo | null = player.chart;
  console.log(reached, info && info.title, formatTime(player.currentTime), player.duration);
  await player.play();
  await player.dispose();
}

export async function useSession(gl: WebGL2RenderingContext, audioContext: AudioContext): Promise<number> {
  const assets = await AssetStore.fromManifest("charts/100001_expert.json", { onProgress: (a: number, b: number) => void (a / b) });
  const live = assets.json<{ scene: string }>("live.json");
  const session = await ChartSession.create({ gl, assets, audioContext, quality: 1, seed: 1 });
  await session.play();
  while (!session.ended) await session.step({ draw: false });
  const t = await session.seek(0);
  await session.dispose();
  return t + live.scene.length;
}

export function useElement(): void {
  const cls: typeof OurnotesPlayerElement | null = defineOurnotesPlayer("my-chart-player");
  const el = document.createElement("ournotes-player") as OurnotesPlayerElement;
  el.src = "charts/100001_expert.json";
  el.addEventListener("ended", () => console.log("done", el.currentTime));
  void el.ready.then((p) => p.pause());
  const events: (keyof ChartPlayerEventMap)[] = ["ready", "play", "pause", "seeked", "timeupdate", "ended", "error", "progress"];
  console.log(cls, events, element.ChartPlayer === ChartPlayer);
}
