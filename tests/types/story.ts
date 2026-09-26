// Compile-only check of the story type declarations (npm run typecheck): "ournotes-player/story" and
// "ournotes-player/story/element" resolve through package.json "exports", and typical uses type-check. Nothing here runs.
import {
  ADV_CANVAS_LAYER, ADV_PLAYBACK_SPEEDS, AssetStore, STORY_FRAME_RATE, SimpleStorySession, StoryCommandError, StoryPlayer, StorySession,
  OurnotesStoryElement, advViewport, defineOurnotesStory, loadStoryStore, parseStorySpeed, registerCommand,
  registeredCommands, storyStrings,
  type AdvPlaybackSpeed, type StoryCommand, type StoryLogEntry, type StoryManifestInfo, type StoryPlayerCore,
  type StoryPlayerEventMap, type StorySessionOptions, type StoryUIView,
} from "ournotes-player/story";
import * as element from "ournotes-player/story/element";

export async function useStoryPlayer(host: HTMLElement): Promise<string[]> {
  const player = await StoryPlayer.create(host, {
    src: "https://example.org/site/stories/10462.json", lang: "en", auto: true, speed: 15, quality: 4, line: 0,
    controls: true, volumes: { Bgm: 0.5 },
    on: { line: (e) => console.log(e.detail.index, e.detail.text), error: (e) => console.error(e.detail.error) },
  });
  player.addEventListener("ended", (e: StoryPlayerEventMap["ended"]) => console.log(e.detail.reason));
  player.addEventListener("log", (e) => console.log(e.detail.speaker, e.detail.text, e.detail.voiceIds.length));
  player.play();
  player.next();
  player.setAuto(!player.auto);
  const speed: AdvPlaybackSpeed = ADV_PLAYBACK_SPEEDS[1] ?? 10;
  player.setSpeed(speed);
  player.setVolume("Voice", 0.8);
  await player.seekToLine(3);
  await player.setLanguage("zh-Hant");
  player.skip();
  const info: StoryManifestInfo | null = player.info;
  const title = info?.story?.titles?.["en"] ?? "";
  await player.dispose();
  return [title, player.speaker, player.text, String(player.line), String(player.lineCount), ...player.languages];
}

export async function useStorySession(gl: WebGL2RenderingContext | null): Promise<number> {
  const store: AssetStore = await loadStoryStore("stories/10462.json", { lang: "ja" });
  const opts: StorySessionOptions = { quality: 4, seed: 1, auto: true, autoplay: true, sound: false,
                                      onCommand: (c: StoryCommand) => console.log(c.i, c.cmd),
                                      onLog: (e: StoryLogEntry) => console.log(e.row, e.text),
                                      onLoaded: () => console.log("loaded") };
  const s = await StorySession.create(gl, store, opts);
  const req = StorySession.requirements(store);
  while (!s.ended && s.frame < 30 * 60 * STORY_FRAME_RATE) { await s.step({ draw: false }); if (s.line === 2) s.tap(); }
  if (s instanceof StorySession) {
    s.core.pressFastForward(15); s.core.pressAuto(false);
    s.core.subtitlesEnabled = false;
    s.core.setCurrentEpisodeListIndex(s.core.currentEpisodeListIndex + 1);
  }
  else if (s instanceof SimpleStorySession) console.log(s.hostKind, s.missing.join(", "), SimpleStorySession.isSimpleStory(store));
  const vp = advViewport(1920, 1080);
  await s.dispose();
  return vp.h + req.unsupported.length + s.lineCount;
}

export function extend(): void {
  registerCommand("Shake", (c: StoryCommand, p: StoryPlayerCore) => p.noWait(c, p.delay(p.calcDuration(Number(c.Duration) || 0, 0))));
  const view: StoryUIView = { render: ({ width, height }) => console.log(width, height) };
  const names: string[] = registeredCommands();
  const layer: number = ADV_CANVAS_LAYER.Frame;
  const err = new StoryCommandError(`${names.length} ${layer}`);
  console.log(view, err.message, parseStorySpeed("1.7"), storyStrings("ko").next);
}

export function useElement(): void {
  const C: typeof OurnotesStoryElement | null = defineOurnotesStory("my-story");
  const el = document.createElement("ournotes-story");
  el.src = "stories/10462.json";
  el.speed = 2;
  el.addEventListener("line", (e) => console.log(e.detail.speaker));
  el.ready.then((p: StoryPlayer) => p.play());
  const E: typeof OurnotesStoryElement = element.OurnotesStoryElement;
  console.log(C, E, el.lineCount);
}
