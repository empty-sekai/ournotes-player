# UI prefab preview (experimental)

The optional `ournotes-player/ui` module previews serialized UI assets exported by `nnnotes ui`. It uses Canvas 2D
and is an inspector, not the game's GPU renderer or an implementation of every page Presenter. It does not change
the chart, story or Live2D entry points. The repository, example and npm package include no game assets.

## Load a library

Export data outside this repository with [nnnotes ui](https://github.com/MetaSekaiLab/nnnotes), then serve that data
over HTTP. Cross-origin resources need CORS. The index and packs use the
`ournotes-ui-library` / `ournotes-ui-pack` format (schema 1). Legacy library indexes with
`dependency-controllers.json` are also accepted.

```js
import { UILibrary, UIPlayer } from 'ournotes-player/ui';

const library = await UILibrary.load('/ui-data/index.json');
const entry = library.entries.find(e => e.kind === 'prefab' && e.file);
const player = await UIPlayer.create(document.querySelector('#stage'), { library, entry });
await player.playState('Open', { animator: player.animators[0].index });
player.play();
```

`UIPlayer.create(host, {src: '/ui-data/packs/ID.json'})` loads a standalone pack. A standalone pack can use an
inline controller; separately exported controllers require a `UILibrary`. Importing `ournotes-player/ui` does not
register elements or require a DOM at import time. Constructing the player requires a browser Canvas 2D context.
The [example viewer](../examples/ui/index.html) takes a user-supplied library URL and provides selection and motion
controls; it has no bundled sample data.

## Custom element

```html
<script type="module">import 'ournotes-player/ui/element';</script>
<ournotes-ui src="/ui-data/index.json" entry="YOUR_EXPORTED_KEY"></ournotes-ui>
```

Without `entry`, a library's first exported prefab is selected. A standalone pack URL needs no `entry`.
`src` and `entry` are also properties. `show-hidden` and `bounds` are boolean inspection attributes.
`ready` resolves to the current UIPlayer; replacing an in-flight source or disconnecting rejects that pending
promise with AbortError. Reconnecting creates a fresh player. A transient DOM move keeps the current player.
`playState`, `selectClip`, `selectSequence` and `seek` wait for ready; `play` and `pause` act on the loaded player.

## API and state

All UI motion times are **seconds**, unlike chart/story API times. `UILibrary.load(src, {fetch, signal})` loads an
index, while packs and controllers load on demand. `find` accepts an entry ID, exact catalog key, unique name or
an entry record. Ambiguous names throw; same-named controllers resolve by their serialized IDs.

`UISession(pack, {bindings: true})` is DOM-independent. It clones the input and provides:

- `edit(node, component, field, value)` for a node index, stable nodeId or unique path/name. `component: null`
  edits a node field; dotted field paths are supported and prototype-related paths are rejected.
- `setController(node, {document, resources})`, `playState(nameOrIndex)`, `selectClip(nameOrIndex)` and
  `selectSequence(node)`.
- `setParameter(name, value)`, `seek(seconds)`, `update(deltaSeconds)`, `reset()` and `prepare()`.

`prepare` returns a new preview pack. It applies edits, optional component bindings and the selected motion;
the input is unchanged. `bindings: false` leaves serialized state intact except for explicit edits and motion.
`reset` clears edits and motion while retaining loaded controllers. Parameter history is replayed on seek.

UIPlayer wraps the same session with `load`, `controller`, `playState`, `selectClip`, `selectSequence`,
`setParameter`, `edit`, `applyFixture`, `seek`, `reset`, `render`, `play`, `pause` and `destroy`. Options include
`viewport: [1920,1080]`, `assetBase`, `showHidden`, `bounds` and `bindings`. The player exposes `canvas`, `nodes`,
`animators`, `sequences`, `time`, `duration`, `paused`, `report` and `session`. `applyFixture({patches})` applies
caller-supplied `{node, component, field, value}` patches; `_previewSource` image URLs resolve against its optional
baseURL. Page-specific sample data and business rules belong to the caller.

For an external bitmap cropped from a Unity Sprite's `textureRect`, patch the
same `Image` with `_previewSpriteGeometry: {rect, textureRect, textureRectOffset,
pixelsPerUnit, border?}` from that Sprite's verified source metadata. The player
restores its transparent logical rectangle and trim offset, and the enclosing
AspectRatioFitter uses `rect.width / rect.height` as UIAddressableImage does.
This expects the export's integer crop (`floor(min)..ceil(max)`); mismatched
bitmap dimensions are rejected. A full texture bitmap already containing the
Sprite's logical rectangle must not be described as a trimmed crop. Without
geometry, existing `_previewSource` bindings retain their bitmap aspect.

Events are `ready`, `render`, `play`, `pause`, `timechange` and `error`, with CustomEvent details. Reports retain
applied numeric/Sprite counts, unsupported/missing-binding diagnostics and recorded animation events.
Recorded events do not execute arbitrary native callbacks. Destroying a player stops scheduled playback and
invalidates pending loads/renders.

## Rendering and limits

Implemented preview paths include Sprite crops, nine-slice/fill/tiled images, tint/gradients, basic masks,
RectTransform geometry, linear/grid layout, content/aspect fitting, basic text, component state bindings,
numeric and Sprite-reference curves, single-layer direct-motion Animator states, parameters/triggers,
exit-time transitions, crossfade, and the supported DOTween sequence/target subset. Unsupported motion and
callback cases are reported rather than executed.

Signed intermediate rectangles are retained; their positive stretched children must not be widened by clamping
the parent to zero. Isolated prefab canvases include graphics outside the root, while a screen Canvas retains
the requested viewport. Fixed-size layout children remain fixed inside flexible cells. Trailing text line feeds
do not add to visible vertical alignment. VibeMO ASCII faces use separate exported glyph metrics; available FZ
TTFs provide the fallback text face. Other font faces fall back to the browser font.

### Source-defined perspective and content framing

For a perspective Screen Space - Camera prefab, pass actual serialized Camera/Canvas fields and the source
CanvasScaler reference resolution. No camera parameters or card angles are inferred from the artwork:

```js
import { cameraProjection, UIPlayer } from 'ournotes-player/ui';

const projection = cameraProjection(cameraComponent, canvasComponent, referenceResolution);
const player = new UIPlayer(host, { assetBase, projection, framing: 'content' });
await player.load(pack);
await player.applyFixture({ patches });
const { bounds, regions, padding, scale } = await player.render();
```

Projection preserves serialized quaternion, local depth, scale and RectTransform pivot. Each planar subtree
is assembled with its original masks/painter order before projective mapping, including foreground extending
past a card frame. A Canvas 2D triangle mesh approximates the final texture projection. Nested nonplanar
subtrees, projection across an ancestor mask, shifted lenses, partial camera viewports and near-plane crossing
fail explicitly. Runtime camera composition and Presenter-driven scene sizing remain outside this path.

`framing: 'content'` uses visible graphic bounds, including labels and graphics outside the root, and crops
only the output canvas's transparent margins; source geometry is unchanged. Its bounds are conservative
RectTransform/mask bounds, not an alpha-pixel scan. Default `framing: 'root'` retains the previous viewport.
Render results expose `regions[nodeId || path]`, four projected corners in top-left, top-right, bottom-right,
bottom-left order for visible nodes. Coordinates are logical root coordinates before canvas padding/scale;
convert a point to bitmap coordinates as `(point - bounds.min + padding) * scale`. Stable IDs avoid ambiguity
for duplicate instance paths. Regions describe the node rectangle; caller input handling and mask-aware hit
testing remain the caller's responsibility.

TMP rich text, exact glyph layout/antialiasing, width-dependent preferred height and uGUI rebuild ordering,
CanvasGroup/mask details, custom GPU materials, particles, localization, dynamic lists, Presenter data,
Live2D/video/camera composition and complex Animator layers/BlendTrees are incomplete. Animator stepping and
crossfade are preview approximations; long Animator advances are limited to 1,000 seconds. Initial prefab text,
unbound images or active flags may be placeholders, not evidence that a component is obsolete. Use bindings,
edits or your own fixtures for its real use case.

The rendering review was based on international Android 1.0.1 (versionCode 25), not a full JP UI comparison.
The data reader accepts a separately exported JP library; differing schemas/fonts can remain unsupported.
Neither region is advertised as pixel-identical or runtime-complete.

## Evidence and verification

Game-specific state-binding rules were studied in the international binary's methods such as UIToggle.SwitchObjects
(`0x6ac4e74`), UIToggleButtonFrame (`0x647fcb8` / `0x64888e0`), DOTweenSequence.CreateSequence (`0x6aded88`) and
SimpleAnimationTrigger.PlayAnimation (`0x6b1f2f8`). Unity geometry/layout semantics are marked ENGINE in the helpers.
GetChildSizes' force-expand operation was checked in native instructions at `0xbd29fec..0xbd2a004`; its C dump
omitted that branch. These addresses are version-specific evidence, not runtime offsets or JP method identities.

Unit tests use only synthetic records/fonts and cover loading, cancellation, lifecycle, duplicate instances,
curves, state seek, sequence timing and layout invariants. Separate local visual review uses user-supplied data
outside the repository. A successful static render/curve audit is not pixel-fidelity verification.
