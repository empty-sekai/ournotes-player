# Performance

Measure the player on the browser and device that will display it. Rendering cost depends on the product,
quality settings, canvas resolution, runtime dependencies and the number of active players.

## Profile a repeatable workload

1. Record the player version, product manifest, browser version, viewport, device pixel ratio and playback settings.
2. Load the same product once to separate initial transfer/decode work from steady playback.
3. Use browser performance tools to record a fixed playback interval. Include scenes with the effects used by
   your content, and exercise seeking separately from continuous playback.
4. Inspect main-thread work, frame duration, WebGL activity and memory. Use the network panel to distinguish
   transfer time from asset decoding and rendering.
5. Repeat with a cold cache when assessing first-load behavior. Compare equal viewports and settings.

Chart simulation advances at 60 Hz. Seeking resimulates state, so its workload differs from drawing a frame.
Stories can also spend time preparing glyph pages, model resources and media when loading or changing language.

## Control resource use

- Set the Live `pixelRatio` option to bound drawing resolution on high-density displays.
- Choose the story quality appropriate to the device; [story options](story.md) describe its rendering effects.
- Cache content-addressed assets with immutable cache headers so related products reuse shared resources.
- Dispose hidden or removed players to release their WebGL contexts and audio resources.
- Profile a single player before adding several concurrent instances.

## Check behavior after a change

Run the synthetic tests and package contracts, then replay the same workload with the same data and settings.
Compare completion, seeking, audio synchronization, selected language and visible output as well as frame cost.
[Embedding](embedding.md) covers cache and compression headers; [fidelity](fidelity.md) describes playback semantics.
