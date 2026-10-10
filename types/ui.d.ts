/** Serialized prefab preview. Canvas 2D output does not claim Unity pixel parity. */
export type UINodeSelector = number | string;
export interface UIEntry { id: string; name: string; key?: string; kind: string; file?: string; status?: string; [key: string]: unknown }
export interface UIPack { schema?: number; resourceBase?: string; document: { nodes?: Array<Record<string, any>>; [key: string]: any }; resources: { textures?: Record<string, string>; sprites?: Record<string, any>; fonts?: Record<string, string>; fontMetrics?: string; [key: string]: any } }
export interface UIController { document: Record<string, any>; resources?: UIPack['resources'] }
export interface UIReport { applied: number; numericApplied: number; objectApplied: number; missing: unknown[]; diagnostics: unknown[]; state?: string; events?: unknown[]; [key: string]: unknown }
export interface UIProjection { fieldOfView: number; referenceViewport: [number, number]; canvasPlaneDistance: number; nearClipPlane?: number }
export interface UIOptions { src?: string; entry?: UIEntry | string; library?: UILibrary; assetBase?: string; viewport?: [number, number]; showHidden?: boolean; bounds?: boolean; bindings?: boolean; projection?: UIProjection; framing?: 'root' | 'content' }
export interface UIRenderResult { canvas: HTMLCanvasElement; width: number; height: number; bounds: {minX: number; minY: number; maxX: number; maxY: number}; metrics: Record<string, number>; regions: Record<string, Array<{x: number; y: number}>>; scale: number; padding: number }
/** Serialized perspective Camera + Screen Space Camera Canvas, with source CanvasScaler reference resolution. */
export function cameraProjection(camera: Record<string, unknown>, canvas: Record<string, unknown>, referenceViewport: [number, number]): UIProjection;
export class UILibrary {
  static load(src: string, options?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<UILibrary>;
  constructor(index: { assets: UIEntry[]; embedded?: UIEntry[]; [key: string]: any }, baseURL: string, fetcher?: typeof fetch);
  readonly entries: UIEntry[]; readonly controllers: UIEntry[]; readonly baseURL: string;
  find(key: string | UIEntry): UIEntry;
  loadPack(entry: string | UIEntry, options?: { signal?: AbortSignal }): Promise<{ pack: UIPack; entry: UIEntry; assetBase: string }>;
  loadController(pack: UIPack, nodeIndex: number, entry?: UIEntry, options?: { signal?: AbortSignal }): Promise<UIController>;
}
export class UISession {
  constructor(pack: UIPack, options?: { bindings?: boolean });
  readonly raw: UIPack; readonly nodes: Array<Record<string, any>>; readonly animators: Array<{index: number; path: string; name: string}>; readonly sequences: Array<{index: number; path: string; name: string}>;
  time: number; root: number; bindings: boolean; readonly report: UIReport | null;
  edit(node: UINodeSelector, component: string | null, field: string, value: unknown): this;
  setController(node: UINodeSelector, controller: UIController): this;
  playState(state: string | number): this; selectClip(clip: string | number): this; selectSequence(node: UINodeSelector): this;
  setParameter(name: string, value: number | boolean): this; seek(time: number): this; update(delta: number): this; reset(): this; prepare(): UIPack;
}
export class UIPlayer extends EventTarget {
  static create(host: HTMLElement, options: UIOptions): Promise<UIPlayer>;
  constructor(host: HTMLElement, options?: UIOptions);
  readonly canvas: HTMLCanvasElement; readonly nodes: UISession['nodes']; readonly animators: UISession['animators']; readonly sequences: UISession['sequences'];
  readonly time: number; readonly duration: number; readonly report: UIReport | null; readonly paused: boolean; readonly destroyed: boolean;
  readonly session: UISession | null; options: Omit<UIOptions, 'src' | 'entry' | 'library'>;
  load(source: string | UIEntry | UIPack): Promise<this>;
  controller(node?: UINodeSelector): Promise<UIController>;
  playState(state: string | number, options?: { animator?: UINodeSelector }): Promise<this>;
  selectClip(clip: string | number, options?: { animator?: UINodeSelector }): Promise<this>;
  selectSequence(node: UINodeSelector): Promise<this>;
  setParameter(name: string, value: number | boolean): Promise<this>; edit(node: UINodeSelector, component: string | null, field: string, value: unknown): Promise<this>;
  applyFixture(fixture: { patches: Array<{node: UINodeSelector; component?: string | null; field: string; value: unknown}> }, baseURL?: string): Promise<this>;
  seek(time: number): Promise<this>; reset(): Promise<this>; render(): Promise<UIRenderResult | {canvas: HTMLCanvasElement; sprites: number} | null>; play(): void; pause(): void; destroy(): void;
}
export class OurnotesUIElement extends HTMLElement {
  src: string; entry: string; readonly ready: Promise<UIPlayer>; readonly player: UIPlayer | null; readonly time: number;
  playState(state: string | number, options?: { animator?: UINodeSelector }): Promise<UIPlayer>; selectClip(clip: string | number, options?: { animator?: UINodeSelector }): Promise<UIPlayer>;
  selectSequence(node: UINodeSelector): Promise<UIPlayer>; seek(time: number): Promise<UIPlayer>; play(): void; pause(): void;
}
export function defineOurnotesUI(name?: string): typeof OurnotesUIElement;
declare global { interface HTMLElementTagNameMap { 'ournotes-ui': OurnotesUIElement } }
