// Type declarations of ournotes-player.

/** Chart metadata of a chart manifest (`chart` key). */
export interface ChartInfo {
  title?: string;
  bands?: string[];
  bandIds?: number[];
  level?: number;
  displayLevel?: number;
  notes?: number;
  fullComboCount?: number;
  durationMs?: number;
  sortOrder?: number;
  stageBand?: number;
  /** The language of `title` and `bands` (a site of several languages). */
  language?: string;
  /** The title per language. */
  titles?: Record<string, string>;
  /** The band names per language. */
  bandNames?: Record<string, string[]>;
  [key: string]: unknown;
}

/** A chart manifest without its `files` map. */
export interface ManifestInfo {
  format?: number;
  musicId?: number;
  difficulty?: string;
  quality?: number;
  audio?: boolean;
  audioFormat?: string;
  chart?: ChartInfo;
  /** The regions this manifest serves (a site of several regions). */
  regions?: string[];
  [key: string]: unknown;
}

export interface FromManifestOptions {
  /** Fetch function (default `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
  /** Called after each asset with the bytes loaded so far and the total. */
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  /** Aborts the requests; the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** URL the manifest's asset paths are relative to (default: the directory above the manifest's directory). */
  base?: string | URL;
  /** Requests in flight at a time (default 6). */
  concurrency?: number;
  /** Decoder of the encoded assets (`.gz`: "gzip", `.br`: "br") fetched with their stored length (default:
   *  `DecompressionStream`; brotli where the browser can construct `DecompressionStream("brotli")`, else such an asset
   *  must be served with `Content-Encoding: br`). */
  decode?: (bytes: Uint8Array, encoding: "gzip" | "br") => Promise<Uint8Array | ArrayBuffer>;
}

type PathMap<T> = Map<string, T> | Record<string, T>;

/** A reference to an object in an object's JSON: the object `<file>:<pathId>`. */
export interface ObjectRef {
  $ref: { file: string; pathId: string; class?: string; name?: string };
}

/** An object of a store's object table: its class, name and files by role (`json`, `image`, `index`,
 *  `program:<platform>/<name>`, `blob:<field>`). */
export interface ObjectEntry {
  class: string;
  name?: string | null;
  files: Record<string, string | Uint8Array | ArrayBuffer>;
}

/** A Texture2D object: its size, mip count, colour space and sampler settings. */
export interface TextureObject {
  id: string;
  name: string;
  width: number;
  height: number;
  mipCount: number;
  colorSpace: number;
  settings: Record<string, unknown>;
}

/** The files of one chart or product and the objects it uses (a product manifest's object table), read synchronously
 *  once loaded. An object id is `<serialized file>:<path id>`. */
export class AssetStore {
  constructor(files?: { text?: PathMap<string>; bytes?: PathMap<Uint8Array | ArrayBuffer>;
                        objects?: Record<string, ObjectEntry>; info?: ManifestInfo | null });
  static fromManifest(url: string | URL, options?: FromManifestOptions): Promise<AssetStore>;
  info: ManifestInfo | null;
  has(path: string): boolean;
  text(path: string): string;
  json<T = any>(path: string): T;
  /** A copy of the file's bytes. */
  bytes(path: string): Uint8Array;
  arrayBuffer(path: string): ArrayBuffer;
  /** A PNG decoded with its texel values as stored, row 0 at the bottom. */
  image(path: string): Promise<ImageBitmap>;
  list(prefix?: string): string[];
  hasObject(id: string): boolean;
  /** The object's class and name; throws for an unknown object or, with `cls`, an object of another class. */
  object(id: string, cls?: string | null): { class: string; name: string | null };
  /** The roles of the object's files. */
  roles(id: string): string[];
  objectText(id: string, role?: string): string;
  /** The parsed file (cached: callers must not change it). */
  objectJson<T = any>(id: string, role?: string): T;
  /** A copy of the file's bytes. */
  objectBytes(id: string, role: string): Uint8Array;
  /** The Texture2D's image, decoded as `image` decodes a PNG. */
  objectImage(id: string, role?: string): Promise<ImageBitmap>;
  /** The object id a reference names (null for null), checked to be an object of the store (of class `cls`). */
  ref(value: ObjectRef | null, cls?: string | null): string | null;
  /** A GameObject's hierarchy (prefab.json). */
  prefab(id: string): { name: string; nodes: any[] };
  material(id: string): any;
  clip(id: string): any;
  /** A MonoBehaviour's fields and `$script`. */
  mono(id: string): any;
  texture(id: string): TextureObject;
}

export interface ChartSessionOptions {
  /** The context to draw into; used by this session alone while it lives. */
  gl: WebGL2RenderingContext;
  assets: AssetStore;
  /** An AudioContext at any sample rate (default: a 48 kHz one created, and closed on dispose, by the session). */
  audioContext?: AudioContext;
  /** The game's Live options by name (default: the chart data's preset-1 values). */
  settings?: LiveSettingsInput | null;
  /** LiveQuality 0..2 when settings.LiveQuality is not given (default: the manifest's `quality`, else 1). */
  quality?: number;
  /** Seed of the particle random stream (default: from the clock). */
  seed?: number;
  /** Drawing buffer size in pixels (default: the canvas size). */
  width?: number;
  height?: number;
}

/** A Live option value: float / int options are numbers, switches booleans, choices ids. */
export type LiveSettingValue = number | boolean;
/** The Live options in effect, by the game's option name (NoteSpeed, LaneOpacity, LiveMusicVolume, ...). */
export type LiveSettings = Readonly<Record<string, LiveSettingValue>>;
export type LiveSettingsInput = Partial<Record<string, LiveSettingValue>>;
export interface LiveOptionItem {
  name: string;
  /** App.Options.OptionItemType */
  id: number;
  /** "basic" | "detail" | "display1" | "display2" | "sound" */
  group: string;
  section: string;
  type: "float" | "int" | "bool" | "enum";
  /** "boot" | "live" | "reload" | "none" */
  apply: string;
  default: LiveSettingValue;
  value: LiveSettingValue;
  /** [min, max] in the option screen's unit, or null. */
  range: [number, number] | null;
  /** The values the chart offers, or null for any value in the range. */
  values: LiveSettingValue[] | null;
  offered: boolean;
  hidden: boolean;
  /** The mute option of a volume. */
  mute: string | null;
}
export class LiveSettingsError extends RangeError {
  /** ChartSession.setSettings: the change selects other files; create a new session with `settings`. */
  reload?: boolean;
  settings?: LiveSettings;
}
export const LIVE_OPTIONS: readonly { name: string; id: number; type: string; section: string; apply: string; def: string }[];
export const LIVE_OPTION_GROUPS: readonly { key: string; sections: string[] }[];
export const PLAYER_LANGUAGES: readonly string[];

/** The DOM-free chart session: step it at 60 steps per second of game time and render it. */
export class ChartSession {
  /** Loads the chart and runs the intro to the chart start; resolves paused at the start. */
  static create(options: ChartSessionOptions): Promise<ChartSession>;
  readonly gl: WebGL2RenderingContext;
  readonly assets: AssetStore;
  /** "load" | "intro" | "start" | "playing" | "ended" */
  readonly state: string;
  readonly paused: boolean;
  readonly started: boolean;
  readonly ended: boolean;
  readonly playing: boolean;
  /** A seek or a step is in progress (no step may start). */
  readonly busy: boolean;
  readonly seeking: boolean;
  readonly speed: number;
  readonly musicOn: boolean;
  readonly seOn: boolean;
  readonly audioAvailable: boolean;
  readonly audioContext: AudioContext;
  readonly chart: ChartInfo | null;
  /** The Live options in effect. */
  readonly settings: LiveSettings;
  /** Every Live option with this chart's default, value, range and offered values. */
  optionItems(): LiveOptionItem[];
  /** Changes Live options; resolves to the names changed. Rejects with LiveSettingsError (reload: true for options
   *  that select other files). */
  setSettings(values: LiveSettingsInput, options?: { reset?: boolean }): Promise<string[]>;
  /** Chart time of the last live update in ms (0 before the chart starts). */
  positionMs(): number;
  /** Length of the music in ms. */
  durationMs(): number;
  /** Resumes the AudioContext (call from a user gesture); at the end: from the start. */
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Resolves to the chart time reached: the last frame at or before `ms`. */
  seek(ms: number): Promise<number>;
  /** One frame of game time (1/60 s x speed), drawn unless `draw` is false. */
  step(options?: { draw?: boolean }): Promise<void>;
  render(): void;
  /** Drawing buffer size in pixels, applied by the next render(). */
  resize(width: number, height: number): void;
  setSpeed(speed: number): void;
  setMusic(on: boolean): void;
  setSe(on: boolean): void;
  dispose(): Promise<void>;
}

/** The playback speeds the controls offer. */
export const LIVE_SPEEDS: readonly number[];

export interface ChartPlayerOptions {
  /** URL of a chart manifest (charts/<id>.json). */
  src?: string | URL;
  /** A loaded AssetStore instead of `src`. */
  assets?: AssetStore;
  /** Show the control bar (default true). */
  controls?: boolean;
  /** Start playing once loaded (default false). */
  autoplay?: boolean;
  speed?: number;
  music?: boolean;
  se?: boolean;
  /** The game's Live options by name. */
  settings?: LiveSettingsInput | null;
  /** Language of the controls (BCP 47; default: the page's). */
  lang?: string;
  quality?: number;
  seed?: number;
  /** An AudioContext at any sample rate (default: the player's own, 48 kHz). */
  audioContext?: AudioContext;
  /** Device pixels per CSS pixel of the drawing buffer (default devicePixelRatio). */
  pixelRatio?: number;
  /** Cancels the loading. */
  signal?: AbortSignal;
  /** Listeners added before the loading starts. */
  on?: Partial<{ [K in keyof ChartPlayerEventMap]: (event: ChartPlayerEventMap[K]) => void }>;
}

export interface ChartPlayerEventMap {
  ready: CustomEvent<null>;
  play: CustomEvent<null>;
  pause: CustomEvent<null>;
  seeked: CustomEvent<{ time: number }>;
  timeupdate: CustomEvent<{ time: number }>;
  ended: CustomEvent<null>;
  error: CustomEvent<{ error: unknown }>;
  progress: CustomEvent<{ loaded: number; total: number }>;
  settingschange: CustomEvent<{ settings: LiveSettings; changed: string[] }>;
}

interface PlayerControls {
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Resolves to the chart time reached (ms). */
  seek(ms: number): Promise<number>;
  /** Chart time in ms; setting it seeks. */
  currentTime: number;
  /** Length of the music in ms (NaN before the chart is loaded). */
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  speed: number;
  music: boolean;
  se: boolean;
  readonly chart: ChartInfo | null;
  /** Changes Live options by name; resolves to the names changed. */
  setSettings(values: LiveSettingsInput, options?: { reset?: boolean }): Promise<string[]>;
}

/** A chart player in a host element: canvas, WebGL2 context, requestAnimationFrame, control bar and events. */
export class ChartPlayer extends EventTarget implements PlayerControls {
  static create(host: Element | ShadowRoot, options?: ChartPlayerOptions): Promise<ChartPlayer>;
  readonly host: Element | ShadowRoot;
  /** The element the player appended to its host. */
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly session: ChartSession | null;
  readonly disposed: boolean;
  readonly audioAvailable: boolean;
  controls: boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<number>;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  speed: number;
  music: boolean;
  se: boolean;
  readonly chart: ChartInfo | null;
  /** The Live options in effect (null until ready); setting it replaces them. */
  settings: LiveSettings | null;
  setSettings(values: LiveSettingsInput, options?: { reset?: boolean }): Promise<string[]>;
  optionItems(): LiveOptionItem[];
  /** Language of the controls. */
  lang: string;
  /** Stops the player, releases its WebGL context and audio, and removes it from the host. */
  dispose(): Promise<void>;
  addEventListener<K extends keyof ChartPlayerEventMap>(type: K, listener: (event: ChartPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof ChartPlayerEventMap>(type: K, listener: (event: ChartPlayerEventMap[K]) => void,
                                                           options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

/** The <ournotes-player> element. */
export class OurnotesPlayerElement extends HTMLElement implements PlayerControls {
  src: string;
  controls: boolean;
  autoplay: boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<number>;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  speed: number;
  music: boolean;
  se: boolean;
  readonly chart: ChartInfo | null;
  /** The Live options in effect once loaded, else those of the `settings` attribute; setting it writes the attribute. */
  settings: LiveSettingsInput | null;
  setSettings(values: LiveSettingsInput, options?: { reset?: boolean }): Promise<string[]>;
  /** The player of the current `src` (null until loaded). */
  readonly player: ChartPlayer | null;
  /** Resolves to the player of the current `src`. */
  readonly ready: Promise<ChartPlayer>;
  addEventListener<K extends keyof ChartPlayerEventMap>(type: K, listener: (this: OurnotesPlayerElement, event: ChartPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

/** Defines the element under `tagName` (default "ournotes-player"); returns its class. */
export function defineOurnotesPlayer(tagName?: string): typeof OurnotesPlayerElement | null;

/** "m:ss" of a time in ms. */
export function formatTime(ms: number): string;

declare global {
  interface HTMLElementTagNameMap {
    "ournotes-player": OurnotesPlayerElement;
  }
}
