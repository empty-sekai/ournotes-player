// Type declarations of ournotes-player/live2d (and ournotes-player/live2d/element, which also defines
// <ournotes-live2d> on import).
import type { AssetStore, FromManifestOptions, ManifestInfo } from "./index.js";

export { AssetStore } from "./index.js";
export type { FromManifestOptions, ManifestInfo };

/** Game time per step: the ADV's 30 frames per second. */
export const MODEL_FRAME_RATE: 30;

/** A model manifest without its `files` map (`id`, `key`, `model`, ... as the site provides them). */
export interface ModelInfo {
  format?: number;
  id?: string;
  key?: string;
  model?: { [key: string]: unknown };
  [key: string]: unknown;
}

export interface MotionOptions {
  /** Fade-in time in seconds; -1 (default) uses the motion's own. */
  fade?: number;
  /** Replay the motion whenever it ends (default false: the default motion follows it). */
  loop?: boolean;
}

export interface ExpressionOptions {
  /** Fade-in time in seconds; -1 (default) uses the expression's own. */
  fade?: number;
}

export interface ModelSessionOptions {
  /** The context to draw into; used by this session alone while it lives. */
  gl: WebGL2RenderingContext;
  /** The model's files: model.json and the files it names. */
  assets: AssetStore;
  /** Motion shown first (default: the model's default motion). */
  motion?: string;
  /** Expression shown first (default: the model's default expression). */
  expression?: string;
  /** Replay the first motion whenever it ends. */
  loop?: boolean;
  /** Physics on (default true). */
  physics?: boolean;
  /** Breath motion on (default true). */
  breath?: boolean;
  /** Seed of the eye blink's random intervals (default: from the clock). */
  seed?: number;
  /** Drawing buffer size in pixels (default: the canvas size). */
  width?: number;
  height?: number;
}

/** The DOM-free model session: step it at 30 steps per second of game time and render it. */
export class ModelSession {
  /** Loads the model, runs its warmup and shows it; resolves once shown. Rejects when Live2D Cubism Core is missing. */
  static create(options: ModelSessionOptions): Promise<ModelSession>;
  readonly gl: WebGL2RenderingContext;
  readonly assets: AssetStore;
  readonly info: ModelInfo | null;
  /** The model's name (root of its prefab). */
  readonly name: string;
  /** Motion names, in the model's order. */
  readonly motions: string[];
  /** Expression names, in the model's order. */
  readonly expressions: string[];
  readonly defaultMotion: string;
  readonly defaultExpression: string;
  /** The motion last started (the default motion while idle). */
  readonly motion: string;
  /** The expression last set. */
  readonly expression: string;
  /** The current motion is replayed when it ends. */
  readonly looping: boolean;
  /** A motion other than the default one is playing. */
  readonly motionPlaying: boolean;
  readonly physics: boolean;
  /** The model has physics (a CubismPhysicsController); without it `physics` stays false. */
  readonly hasPhysics: boolean;
  readonly breath: boolean;
  /** Game time in seconds since the session was created. */
  readonly time: number;
  /** A step is in progress. */
  readonly busy: boolean;
  readonly seed: number;
  readonly disposed: boolean;
  /** Plays a motion at the next step. Throws for an unknown name. */
  playMotion(name: string, options?: MotionOptions): void;
  /** Sets an expression at the next step. Throws for an unknown name. */
  setExpression(name: string, options?: ExpressionOptions): void;
  setPhysics(on: boolean): void;
  setBreath(on: boolean): void;
  /** One frame of game time (1/30 s), drawn unless `draw` is false. */
  step(options?: { draw?: boolean }): Promise<void>;
  render(): void;
  /** Drawing buffer size in pixels, applied by the next render(). */
  resize(width: number, height: number): void;
  dispose(): Promise<void>;
}

export interface ModelPlayerOptions {
  /** URL of a model manifest (models/<id>.json). */
  src?: string | URL;
  /** A loaded AssetStore instead of `src`. */
  assets?: AssetStore;
  motion?: string;
  expression?: string;
  loop?: boolean;
  physics?: boolean;
  breath?: boolean;
  seed?: number;
  /** Start paused (default false). */
  paused?: boolean;
  /** Device pixels per CSS pixel of the drawing buffer (default devicePixelRatio). */
  pixelRatio?: number;
  /** Cancels the loading. */
  signal?: AbortSignal;
  /** Listeners added before the loading starts. */
  on?: Partial<{ [K in keyof ModelPlayerEventMap]: (event: ModelPlayerEventMap[K]) => void }>;
}

export interface ModelPlayerEventMap {
  ready: CustomEvent<null>;
  play: CustomEvent<null>;
  pause: CustomEvent<null>;
  error: CustomEvent<{ error: unknown }>;
  progress: CustomEvent<{ loaded: number; total: number }>;
}

/** A model in a host element: canvas, WebGL2 context, requestAnimationFrame and events. */
export class ModelPlayer extends EventTarget {
  static create(host: Element | ShadowRoot, options?: ModelPlayerOptions): Promise<ModelPlayer>;
  readonly host: Element | ShadowRoot;
  /** The element the player appended to its host. */
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly session: ModelSession | null;
  readonly disposed: boolean;
  readonly info: ModelInfo | null;
  readonly name: string;
  readonly motions: string[];
  readonly expressions: string[];
  readonly defaultMotion: string;
  readonly defaultExpression: string;
  readonly motion: string;
  readonly expression: string;
  readonly motionPlaying: boolean;
  physics: boolean;
  readonly hasPhysics: boolean;
  breath: boolean;
  readonly paused: boolean;
  playMotion(name: string, options?: MotionOptions): void;
  setExpression(name: string, options?: ExpressionOptions): void;
  play(): void;
  pause(): void;
  /** Stops the player, releases its WebGL context and removes it from the host. */
  dispose(): Promise<void>;
  addEventListener<K extends keyof ModelPlayerEventMap>(type: K, listener: (event: ModelPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof ModelPlayerEventMap>(type: K, listener: (event: ModelPlayerEventMap[K]) => void,
                                                           options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

/** The <ournotes-live2d> element. */
export class OurnotesLive2DElement extends HTMLElement {
  src: string;
  /** The current motion once loaded; setting another name plays that motion (reflected to the attribute). */
  motion: string;
  /** The current expression once loaded; setting another name sets that expression (reflected to the attribute). */
  expression: string;
  loop: boolean;
  paused: boolean;
  physics: boolean;
  breath: boolean;
  readonly motions: string[];
  readonly expressions: string[];
  readonly defaultMotion: string;
  readonly defaultExpression: string;
  /** The model has physics (false until loaded). */
  readonly hasPhysics: boolean;
  readonly info: ModelInfo | null;
  /** The player of the current `src` (null until loaded). */
  readonly player: ModelPlayer | null;
  /** Resolves to the player of the current `src`. */
  readonly ready: Promise<ModelPlayer>;
  playMotion(name: string, options?: MotionOptions): Promise<void>;
  setExpression(name: string, options?: ExpressionOptions): Promise<void>;
  play(): void;
  pause(): void;
  addEventListener<K extends keyof ModelPlayerEventMap>(type: K, listener: (this: OurnotesLive2DElement, event: ModelPlayerEventMap[K]) => void,
                                                        options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

/** Defines the element under `tagName` (default "ournotes-live2d"); returns its class. */
export function defineOurnotesLive2D(tagName?: string): typeof OurnotesLive2DElement | null;

declare global {
  interface HTMLElementTagNameMap {
    "ournotes-live2d": OurnotesLive2DElement;
  }
}
