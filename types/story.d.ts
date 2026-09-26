// Type declarations of ournotes-player/story (and ournotes-player/story/element, which also defines <ournotes-story>
// on import).
import type { AssetStore, FromManifestOptions } from "./index.js";

export { AssetStore } from "./index.js";
export type { FromManifestOptions };

/** Game time per step: the ADV's 30 frames per second. */
export const STORY_FRAME_RATE: 30;

/** The story languages. */
export type StoryLanguage = "ja" | "en" | "zh-Hant" | "zh-Hans" | "ko";

/** Language code -> the text field of episode.json. */
export const STORY_LANGUAGES: Readonly<Record<StoryLanguage, string>>;

/** AdvPlaybackSpeed: Normal 10, OnePointFive 15, OnePointSeven 17, Double 20 (the rate is value / 10). */
export type AdvPlaybackSpeed = 10 | 15 | 17 | 20;
export const ADV_PLAYBACK_SPEED: Readonly<{ Normal: 10; OnePointFive: 15; OnePointSeven: 17; Double: 20 }>;
export const ADV_PLAYBACK_SPEEDS: readonly AdvPlaybackSpeed[];
/** AdvPlaybackMode (MasterAdv._playbackMode). */
export const ADV_PLAYBACK_MODE: Readonly<{ Normal: 0; Overlay: 1 }>;
/** AdvCanvasLayer: the canvases of the story screen, back to front. */
export const ADV_CANVAS_LAYER: Readonly<{ Background: 0; Overlay: 1; Character: 2; Foreground: 3; Chat: 4; Frame: 5;
                                          Video: 6; Still: 7; Front: 8; Talk: 9 }>;
/** AdvCommand names by value (null for the values without a command). */
export const ADV_COMMAND: readonly (string | null)[];

/** An episode the player cannot play as the game does (an unsupported command, stage feature or talk window). */
export class StoryCommandError extends Error {}

/** A row of episode.json `commands`: `i` (the row's Index), `cmd` (the AdvCommand name) and its non-default fields. */
export interface StoryCommand {
  i: number | string;
  cmd: string;
  raw?: number;
  [field: string]: unknown;
}

/** A command handler: runs the row on the interpreter; resolves when the next row may start. */
export type StoryCommandHandler = (c: StoryCommand, player: StoryPlayerCore) => Promise<unknown>;

/** Registers the handler of an AdvCommand name (once per name). */
export function registerCommand(name: string, handler: StoryCommandHandler): void;
/** The registered command names in AdvCommand order. */
export function registeredCommands(): string[];
/** The command names (of rows or names) without a handler, in first-use order. */
export function unregisteredCommands(commands: Iterable<StoryCommand | string>): string[];

/** A view on a canvas layer of the story UI. */
export interface StoryUIView {
  render(frame: { gl: WebGL2RenderingContext; width: number; height: number; canvasWidth: number; canvasHeight: number }): void;
  update?(deltaTime: number): void;
}

export class StoryUILayer {
  constructor(index: number);
  readonly index: number;
  readonly views: StoryUIView[];
  add<V extends StoryUIView>(view: V): V;
  remove(view: StoryUIView): void;
}

export function createStoryUILayers(): StoryUILayer[];

/** The typewriter of a talk line. */
export interface StoryTyping {
  totalLength: number;
  finished: Promise<void>;
  cancel(): void;
}

/** The story screen's front canvas as the commands drive it. */
export interface StoryUI {
  load(): Promise<void>;
  setTalkWindow(name: string): void;
  showTalk(duration?: number): void;
  hideTalk(duration?: number): void;
  hideTalkNextIndicator(): void;
  setSpeakerName(text: string): void;
  setTalk(text: string): StoryTyping;
  readonly isTyping: boolean;
  setAutoMode(on: boolean): void;
  setFastIconActive(on: boolean): void;
  setPlaybackSpeed(rate: number): void;
  showTitle(text: string): Promise<unknown>;
  showLocation(text: string): Promise<unknown>;
  transitionSettings(address: string): unknown;
  fadeOut(settings: unknown, color: { r: number; g: number; b: number; a: number }, duration: number): Promise<unknown>;
  fadeIn(settings: unknown, color: { r: number; g: number; b: number; a: number }, duration: number): Promise<unknown>;
  fadeInLetterBox(): Promise<unknown>;
  render(frame: { gl: WebGL2RenderingContext; width: number; height: number }): void;
  renderLetterBox(frame: { gl: WebGL2RenderingContext; screenWidth: number; screenHeight: number;
                           viewport: { x: number; y: number; w: number; h: number } }): void;
  dispose(): void;
  /** Indexed by ADV_CANVAS_LAYER. */
  readonly layers: StoryUILayer[];
  /** The talk windows it provides (optional: an episode naming another one is refused before loading). */
  readonly talkWindows?: string[];
}

/** Raises unless `ui` provides the StoryUI members; returns it. */
export function checkStoryUI<T extends StoryUI>(ui: T): T;

/** What a command handler reaches through `player.ctx`. */
export interface StoryContext {
  loop: any;
  camera: any;
  field: any;
  background: any;
  fieldRenderer: any;
  volume: any;
  characters: any;
  stages: Map<string, any>;
  ui: StoryUI;
  audio: any;
  quality: any;
  settings: { player: any; masterIds: any };
  localize(textId: string | number): string;
  lang: StoryLanguage;
  playbackMode: 0 | 1;
  titleTextId: number;
  episode: any;
  story: any;
  assets: AssetStore;
  renderer: any | null;
  gl: WebGL2RenderingContext | null;
}

/** The episode interpreter (AdvPlayer): shared by the command handlers. */
export class StoryPlayerCore {
  readonly ctx: StoryContext;
  readonly session: Record<string, any>;
  playbackSpeed: AdvPlaybackSpeed;
  autoPlay: boolean;
  forcedAutoPlay: boolean;
  isPause: boolean;
  readonly shortcut: boolean;
  readonly isAutoPlay: boolean;
  readonly isOverlay: boolean;
  /** The subtitle option: video subtitles shown (default true). */
  subtitlesEnabled: boolean;
  /** The list position of the row being played (AdvPlayerModel.CurrentEpisodeListIndex). */
  readonly currentEpisodeListIndex: number;
  /** A jump: PlayCommands goes on at this list position. */
  setCurrentEpisodeListIndex(index: number): void;
  onLog: ((entry: StoryLogEntry) => void) | null;
  speedRate(): number;
  calcDuration(duration: number, defaultDuration?: number): number;
  delay(seconds: number): Promise<boolean>;
  ease(name: string | undefined, defaultEase?: number): number;
  noWait(c: StoryCommand, task: Promise<unknown>): Promise<unknown>;
  execute(c: StoryCommand): Promise<unknown>;
  /** AdvPlayerUIEventHandler.OnNextButtonTapped. */
  tap(): void;
  /** SetAutoState and the next-step sync (no speed change). */
  setAuto(on: boolean): void;
  /** The story menu's Auto button: turning auto off at a speed other than x1 resets the speed to x1. */
  pressAuto(on: boolean): void;
  /** The story menu's Fast-forward button set to a speed: a speed other than x1 turns auto on. */
  pressFastForward(speed: AdvPlaybackSpeed): void;
  /** AdvPlayer.Stop: 1 is the game's Skip. */
  stop(reason?: number): void;
  static requiredCommands(episode: any, playerSettings: any): string[];
  static supportedCommands(): string[];
}

/** AdvCameraConfig.CreateAdvViewport: the 13:6 ADV viewport in a screen (pixels, GL bottom-left origin). */
export function advViewport(screenWidth: number, screenHeight: number): { x: number; y: number; w: number; h: number };
/** The Talk rows that show a line, in order. */
export function storyLines(episode: any): StoryCommand[];

/** A story manifest without its file lists. */
export interface StoryManifestInfo {
  format?: string;
  advId?: number;
  /** The facts of the story (its listing entry). */
  story?: { advId?: number; titles?: Record<string, string>; commands?: string[]; playbackMode?: 0 | 1;
            [key: string]: unknown };
  /** The default language. */
  language?: StoryLanguage;
  /** The language this store holds. */
  loadedLanguage?: StoryLanguage;
  audio?: boolean;
  requires?: { commands?: string[]; cubismCore?: boolean; motionSync?: boolean };
  [key: string]: unknown;
}

export const STORY_MANIFEST_FORMAT: "ournotes.story-manifest/1";

/** Fetches a story manifest; refuses a story whose commands this player lacks. */
export function fetchStoryManifest(url: string | URL, options?: { fetch?: typeof globalThis.fetch; signal?: AbortSignal | null }):
  Promise<{ url: string; manifest: any }>;

export interface LoadStoryOptions extends FromManifestOptions {
  /** The language to load (default: the manifest's). */
  lang?: StoryLanguage | null;
  /** A manifest already fetched with fetchStoryManifest. */
  manifest?: { url: string; manifest: any } | null;
}

/** The AssetStore of one language of a story: the manifest's common files and that language's files. */
export function loadStoryStore(url: string | URL, options?: LoadStoryOptions): Promise<AssetStore>;

/** A talk log entry (AdvTalkHelper.AddLogEntry): Talk, Location, subtitles and chat rows, also those the shortcut
 *  passes. */
export interface StoryLogEntry {
  row: number | string;
  /** null: a caption without a speaker (Location). */
  speaker: string | null;
  text: string;
  voiceIds: number[];
}

export interface StorySessionOptions {
  lang?: StoryLanguage;
  /** ADV quality level 0 (Worst) .. 4 (Best, default). */
  quality?: number;
  /** Seed of UnityEngine.Random (eye blinks, pseudo lip sync); default from the clock. */
  seed?: number;
  /** Auto mode (default false). */
  auto?: boolean;
  speed?: AdvPlaybackSpeed;
  /** Start at this line (the game's shortcut to it). */
  line?: number;
  /** false: no voices. */
  voice?: boolean;
  /** false: no Web Audio (the sounds keep their timing silently). */
  sound?: boolean;
  audioContext?: AudioContext | null;
  /** false: the episode title is not shown. */
  title?: boolean;
  /** Start playing in the frame the loading ends. */
  autoplay?: boolean;
  /** A StoryUI instead of the story player's own. */
  ui?: (gl: WebGL2RenderingContext | null, loop: any, parts: any) => StoryUI;
  /** A sound manager instead of the story player's own. */
  audio?: (resolve: (soundId: number) => any, loop: any, options: { assets: AssetStore }) => any;
  onCommand?: (c: StoryCommand) => void;
  onLine?: (line: { index: number; row: number | string; speaker: string; text: string }) => void;
  onLog?: (entry: StoryLogEntry) => void;
  onEnded?: (e: { reason: number }) => void;
  /** Called in the frame the loading ends, before autoplay starts. */
  onLoaded?: () => void;
  /** A UnityRandom instead of one seeded with `seed`. */
  random?: any;
  width?: number;
  height?: number;
}

/** One story episode on a WebGL2 context, or headless (gl = null); no DOM access. */
export class StorySession {
  /** An Overlay episode (playbackMode 1) gets a SimpleStorySession. */
  static create(gl: WebGL2RenderingContext | null, store: AssetStore, options?: StorySessionOptions | SimpleStorySessionOptions): Promise<StorySession | SimpleStorySession>;
  /** The commands the episode executes, and those this player does not support (SimpleStorySession.requirements
   *  for an Overlay episode). */
  static requirements(store: AssetStore): { commands: string[]; unsupported: string[] } | SimpleStoryRequirements;
  readonly gl: WebGL2RenderingContext | null;
  readonly assets: AssetStore;
  readonly core: StoryPlayerCore;
  readonly ctx: StoryContext;
  readonly lang: StoryLanguage;
  readonly playbackMode: 0 | 1;
  readonly seed: number;
  readonly time: number;
  readonly frame: number;
  /** The current line (-1 before the first). */
  readonly line: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly isAuto: boolean;
  readonly speed: AdvPlaybackSpeed;
  readonly started: boolean;
  readonly ended: boolean;
  readonly endReason: number | null;
  readonly busy: boolean;
  readonly error: unknown;
  play(): void;
  tap(): void;
  setAuto(on: boolean): void;
  setSpeed(speed: AdvPlaybackSpeed): void;
  skip(): void;
  setVolume(category: "Bgm" | "Se" | "Voice", volume: number): void;
  step(options?: { draw?: boolean }): Promise<void>;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): Promise<void>;
}

/** The simple player's facts of an Overlay episode: the commands it runs, the rows it skips, the unsupported ones,
 *  and the row that makes the game's validator refuse the episode. */
export interface SimpleStoryRequirements {
  commands: string[];
  skipped: string[];
  unsupported: string[];
  invalid: { phase: number; row: number | string; reason: string } | null;
}

export interface SimpleStorySessionOptions extends StorySessionOptions {
  /** The Spine runtime for the home spot's characters (default: the page's global `spine`; null: none). */
  spine?: object | null;
}

/** The session of an Overlay episode (playbackMode 1: the home spot and live result talks): the game's simple story
 *  player in its host screen. Same driving interface as StorySession; auto and speed are the host's. */
export class SimpleStorySession {
  static create(gl: WebGL2RenderingContext | null, store: AssetStore, options?: SimpleStorySessionOptions): Promise<SimpleStorySession>;
  static isSimpleStory(store: AssetStore): boolean;
  static requirements(store: AssetStore): SimpleStoryRequirements;
  readonly gl: WebGL2RenderingContext | null;
  readonly assets: AssetStore;
  readonly lang: StoryLanguage;
  /** The host screen of host/host.json; "none": the talk alone on black. */
  readonly hostKind: "home" | "afterlive" | "none";
  /** What the session does not draw for this episode ("Spine runtime missing", "spot Volume post-processing"). */
  readonly missing: string[];
  readonly seed: number;
  readonly time: number;
  readonly frame: number;
  readonly line: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly isAuto: boolean;
  readonly speed: AdvPlaybackSpeed;
  readonly started: boolean;
  readonly ended: boolean;
  /** 0 played to its end, 1 stopped, 2 the game's validator refused the episode and nothing was shown. */
  readonly endReason: 0 | 1 | 2 | null;
  readonly busy: boolean;
  readonly error: unknown;
  play(): void;
  tap(): void;
  setAuto(on: boolean): void;
  setSpeed(speed: AdvPlaybackSpeed): void;
  skip(): void;
  setVolume(category: "Bgm" | "Se" | "Voice", volume: number): void;
  step(options?: { draw?: boolean }): Promise<void>;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): Promise<void>;
}

export interface StoryPlayerOptions {
  /** URL of a story manifest (stories/<advId>.json). */
  src?: string | URL;
  /** An AssetStore of the story instead of `src`. */
  assets?: AssetStore;
  lang?: StoryLanguage;
  auto?: boolean;
  speed?: AdvPlaybackSpeed;
  quality?: number;
  line?: number;
  autoplay?: boolean;
  /** Show the control bar (default true). */
  controls?: boolean;
  /** The language of the control labels (default: `lang`). */
  uiLang?: string;
  voice?: boolean;
  sound?: boolean;
  volumes?: Partial<Record<"Bgm" | "Se" | "Voice", number>>;
  seed?: number;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  pixelRatio?: number;
  on?: Partial<{ [K in keyof StoryPlayerEventMap]: (event: StoryPlayerEventMap[K]) => void }>;
}

export interface StoryPlayerEventMap {
  ready: CustomEvent<null>;
  play: CustomEvent<null>;
  pause: CustomEvent<null>;
  error: CustomEvent<{ error: unknown }>;
  progress: CustomEvent<{ loaded: number; total: number }>;
  line: CustomEvent<{ index: number; lineCount: number; speaker: string; text: string }>;
  log: CustomEvent<StoryLogEntry>;
  command: CustomEvent<{ index: number | string; cmd: string }>;
  ended: CustomEvent<{ reason: number }>;
}

/** A story in a host element: canvas, control bar, requestAnimationFrame and events. */
export class StoryPlayer extends EventTarget {
  static create(host: Element | ShadowRoot, options?: StoryPlayerOptions): Promise<StoryPlayer>;
  constructor(host: Element | ShadowRoot, options?: StoryPlayerOptions);
  /** Loads the story; resolves once it is ready. */
  load(): Promise<void>;
  readonly host: Element | ShadowRoot;
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly session: StorySession | null;
  readonly disposed: boolean;
  readonly info: StoryManifestInfo | null;
  readonly line: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly auto: boolean;
  readonly speed: AdvPlaybackSpeed;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly lang: StoryLanguage | null;
  readonly languages: string[];
  /** Starts the episode (call it from a user gesture so that audio may start) or resumes it. */
  play(): void;
  pause(): void;
  /** A tap on the story screen: the next line. */
  next(): void;
  setAuto(on: boolean): void;
  setSpeed(speed: AdvPlaybackSpeed): void;
  setLanguage(lang: StoryLanguage): Promise<void>;
  /** Restarts at line i with the game's shortcut. */
  seekToLine(i: number): Promise<void>;
  /** The game's Skip: the playback stops. */
  skip(): void;
  setVolume(category: "Bgm" | "Se" | "Voice", volume: number): void;
  dispose(): Promise<void>;
  addEventListener<K extends keyof StoryPlayerEventMap>(type: K, listener: (event: StoryPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof StoryPlayerEventMap>(type: K, listener: (event: StoryPlayerEventMap[K]) => void,
                                                           options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

/** "1", "1.5", "1.7", "2" (or 10, 15, 17, 20) -> AdvPlaybackSpeed (10 otherwise). */
export function parseStorySpeed(s: string | number): AdvPlaybackSpeed;

/** The labels of the story controls per language. */
export const STORY_STRINGS: Readonly<Record<StoryLanguage, Readonly<Record<string, string>>>>;
export function storyStrings(lang: string): Readonly<Record<string, string>>;

/** The <ournotes-story> element. */
export class OurnotesStoryElement extends HTMLElement {
  src: string;
  lang: string;
  auto: boolean;
  /** 1, 1.5, 1.7 or 2. */
  speed: number;
  readonly line: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly ended: boolean;
  readonly languages: string[];
  readonly info: StoryManifestInfo | null;
  /** The player of the current `src` (null until loaded). */
  readonly player: StoryPlayer | null;
  /** Resolves to the player of the current `src`. */
  readonly ready: Promise<StoryPlayer>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  skip(): Promise<void>;
  seekToLine(i: number): Promise<void>;
  setVolume(category: "Bgm" | "Se" | "Voice", volume: number): Promise<void>;
  addEventListener<K extends keyof StoryPlayerEventMap>(type: K, listener: (this: OurnotesStoryElement, event: StoryPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

/** Defines the element under `tagName` (default "ournotes-story"); returns its class. */
export function defineOurnotesStory(tagName?: string): typeof OurnotesStoryElement | null;

declare global {
  interface HTMLElementTagNameMap {
    "ournotes-story": OurnotesStoryElement;
  }
}
