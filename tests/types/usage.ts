// Compile-only check of the published type declarations (npm run typecheck): the package entry points resolve through
// package.json "exports", and typical uses type-check. Nothing here runs.
import {
  AssetStore, ChartPlayer, ChartSession, LIVE_OPTIONS, LIVE_OPTION_GROUPS, LIVE_SPEEDS, LiveSettingsError,
  OurnotesPlayerElement, PLAYER_LANGUAGES, defineOurnotesPlayer, formatTime,
  type ChartInfo, type ChartPlayerEventMap, type LiveOptionItem, type LiveSettings, type LiveSettingsInput,
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

export async function useSettings(host: HTMLElement): Promise<void> {
  const saved: LiveSettingsInput = { NoteSpeed: 9.5, MirrorChart: false };
  const player = await ChartPlayer.create(host, { src: "charts/100001_expert.json", settings: saved, lang: PLAYER_LANGUAGES[1] });
  player.addEventListener("settingschange", (e) => console.log(e.detail.changed.join(", "), e.detail.settings.NoteSpeed));
  try {
    const changed: string[] = await player.setSettings({ LaneOpacity: 40, LiveMusicVolume: 60 });
    console.log(changed.length);
  } catch (e) {
    if (e instanceof LiveSettingsError && e.reload) console.log("reload", e.settings);
  }
  await player.setSettings({}, { reset: true });
  const now: LiveSettings | null = player.settings;
  const items: LiveOptionItem[] = player.optionItems().filter((i) => i.offered && !i.hidden);
  const groups = LIVE_OPTION_GROUPS.map((g) => g.sections.length);
  const ids = LIVE_OPTIONS.map((o) => o.id);
  const range: [number, number] | null = items.length ? items[0].range : null;
  player.lang = "ja";
  player.settings = { NoteSpeed: 6 };
  console.log(now && now.NoteSpeed, groups, ids, range, player.lang);
}

export async function useSession(gl: WebGL2RenderingContext, audioContext: AudioContext): Promise<number> {
  const assets = await AssetStore.fromManifest("charts/100001_expert.json", { onProgress: (a: number, b: number) => void (a / b) });
  const live = assets.json<{ scene: string }>("live.json");
  const session = await ChartSession.create({ gl, assets, audioContext, quality: 1, seed: 1, settings: { NoteSpeed: 7 } });
  const speed = session.settings.NoteSpeed;
  const names: string[] = await session.setSettings({ NoteTiming: 0.25 });
  console.log(speed, names, session.optionItems().length);
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
  el.settings = { NoteSpeed: 8.5 };
  void el.setSettings({ ComboCountDisplay: false });
  el.addEventListener("settingschange", (e) => console.log(e.detail.changed));
  el.addEventListener("ended", () => console.log("done", el.currentTime));
  void el.ready.then((p) => p.pause());
  const events: (keyof ChartPlayerEventMap)[] = ["ready", "play", "pause", "seeked", "timeupdate", "ended", "error", "progress",
                                                 "settingschange"];
  console.log(cls, events, element.ChartPlayer === ChartPlayer);
}
