# Performance

What a frame of the player costs on the CPU, which of that work the browser does in its own compiled code, and how
much is the player's JavaScript. The numbers below were measured with the version of the player this file ships
with, on the machine and charts listed; other versions, browsers, machines and charts give other numbers. They are
rounded.

The browser drew with a software rasterizer, so this page covers the CPU side only: the time the GPU (or the
rasterizer) takes to draw a frame is not measured.

## Conditions

| | |
|---|---|
| Browser | Chromium 154.0.8037.57, headless, on Linux (Debian 12) |
| Graphics | ANGLE on SwiftShader: WebGL2 rendered in software, in the browser's GPU process |
| Machine | 64 logical CPUs (AMD EPYC 9K65) |
| Canvas | 320 × 180 CSS pixels at a device pixel ratio of 1, so that the software rasterizer keeps up with 60 frames per second (at 1280 × 720 it draws about 8 frames per second and the main thread waits for it). The player makes the same draw calls at any canvas size (only values such as the screen size differ); at larger sizes the rasterizer's work grows |
| Player | `dist/ournotes-player.js`, `ChartPlayer` with `controls: false` and `seed: 1`; music and sound effects on, the manifest's quality |
| Charts | from a site built by nnnotes for the Taiwan server, version 1.0.1: 100015 expert (1 874 notes; of that region's 336 charts the one with the most notes and the most WebGL calls per frame), 100040 expert (1 161 notes; with its effects the second most WebGL calls per frame), 100001 expert (822 notes) |
| Span | 60 s of playback, starting 5 s after `play()` |

Each chart was played twice over the same span: once with a Chrome trace of the renderer's main thread (the thread
time of every task, summed per animation frame) and `performance.now()` around the session's simulation phases and
its `render()`; once under the V8 CPU profiler (100 µs sampling) for the split by kind of work.

## Per-frame CPU time in the browser

Main-thread time per animation frame, against the 16.7 ms of a 60 Hz frame:

| Chart | Frames per second | Median | 95th percentile | 99th percentile | Frames over 16.7 ms |
|---|---|---|---|---|---|
| 100015 expert | 57 | 3.5 ms | 6.1 ms | 8.9 ms | 14 of 3 428 (0.4 %) |
| 100040 expert | 58 | 3.7 ms | 6.1 ms | 11.9 ms | 21 of 3 471 (0.6 %) |
| 100001 expert | 60 | 2.7 ms | 4.4 ms | 8.6 ms | 15 of 3 578 (0.4 %) |

Headless Chromium produced slightly fewer than 60 animation frames per second here; the player then runs the steps
that are due (1.00 to 1.05 steps per animation frame in these runs) and draws once per animation frame.

| Chart | Simulation, per step | `render()`, per draw: JavaScript and WebGL calls |
|---|---|---|
| 100015 expert | 0.5 ms | 2.5 ms |
| 100040 expert | 0.6 ms | 2.6 ms |
| 100001 expert | 0.4 ms | 2.0 ms |

The main thread's busy time by kind of work (CPU profile):

| | 100015 expert | 100040 expert | 100001 expert |
|---|---|---|---|
| The player's JavaScript | 65 % | 64 % | 62 % |
| WebGL calls: the browser's validation and command encoding on the main thread | 16 % | 16 % | 17 % |
| Browser code outside JavaScript: task scheduling, frame production | 10 % | 12 % | 12 % |
| JavaScript garbage collector | 6 % | 5 % | 6 % |
| Other browser APIs the player calls: `MessageChannel` (the order of the loop's phases), timers, audio nodes | 3 % | 3 % | 3 % |

The measurement's own code took under 1 %. Within the player's JavaScript, the particle systems take about a
quarter, looking up and setting the shaders' uniforms and render state for each draw call about a sixth, the note
views about a tenth, and the chart simulation itself (note states, judgements, combo) about 1 %.

## What runs in the browser's compiled code

- **WebGL2.** The main thread validates each call and encodes it into the browser's command buffer (the WebGL share
  above). The GPU process executes the draw calls and compiles the game's GLSL ES 3.00 shaders, on the GPU or, as
  here, in the software rasterizer; neither runs on the main thread.
- **WebAudio.** `decodeAudioData` decodes the FLAC and AAC files (at the context's sample rate) when the chart
  loads; mixing and output run on the browser's audio thread. On the main thread the player only creates and
  schedules sources and gains (under 1 % of its busy time).
- **Images.** `createImageBitmap` decodes the PNG textures when the chart loads or a texture is first used.
- **Live2D.** Cubism Core, which the page supplies, is compiled code.
- **JavaScript.** V8 compiles the player's frequently run code to machine code.

## The JavaScript share

The player's JavaScript and its garbage collection take about two thirds of the main thread's busy time: at the
median, 1.9 to 2.6 ms per frame. An implementation of that work that took no time at all would save at most that
much per frame; the WebGL calls and the browser's own work would stay. At the median the frames already leave
13 ms or more of the 16.7 ms unused.

## Live2D model viewer

`ModelPlayer` with the model `adv_live2d_rana_003_casual_spring_01` on a 720 × 720 canvas, measured over 60 s from
5 s after `play()`, under the same conditions otherwise: 60 animation frames per second and 30 model steps per
second (idle motion, eye blink, breath, physics). A frame that steps and draws the model takes about 5 ms of
main-thread time (99th percentile 9 ms; 3 frames of 3 599 over 16.7 ms); a frame without a step about 1 ms. Per
step, the model update (motions, physics and the Cubism Core update) takes 1.8 ms and the draw 3.3 ms.

| The main thread's busy time | |
|---|---|
| The player's JavaScript | 41 % |
| WebGL calls | 23 % |
| Cubism Core | 22 % |
| Browser code outside JavaScript | 10 % |
| JavaScript garbage collector | 2 % |
| Other browser APIs | 2 % |

## Node.js without a browser

`scripts/read-set.mjs` in full mode runs a whole chart in Node.js with a WebGL2 context and an AudioContext that do
nothing: every frame is simulated and its draw calls are made, nothing is drawn or played. This measures the
player's own work without any WebGL implementation. Per step, one process at a time on the same machine, Node.js
22.23.3, two runs per chart:

| Chart | Frames | Step: median | 95th percentile | 99th percentile | Of the step, draw submission (median) | `read-set.mjs` full mode, load and every frame |
|---|---|---|---|---|---|---|
| 100015 expert | 10 462 | 1.6 ms | 2.5 to 2.7 ms | 3.4 to 3.7 ms | 1.1 ms | 18 s |
| 100040 expert | 6 678 | 1.6 to 1.7 ms | 2.7 to 3.0 ms | 4.6 to 5.4 ms | 1.1 to 1.2 ms | 12 s |
| 100001 expert | 6 001 | 1.3 ms | 2.0 ms | 2.4 ms | 0.9 ms | 8 s |

Over the region's 336 charts, the median chart makes about 2 900 WebGL calls and 88 draw calls per frame; 100015
expert makes the most, 5 530 and 166.

## Reproducing the measurement

1. Build the player (`npm ci`, `npm run build`) and serve a site and the player's `dist/` from one origin. For
   `performance.now()` at its finest resolution, serve the pages cross-origin isolated
   (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
2. Start Chromium, for example headless through the DevTools protocol, with
   `--autoplay-policy=no-user-gesture-required` (and, without a GPU, `--use-angle=swiftshader
   --enable-unsafe-swiftshader`). On a page with a 320 × 180 element, create a `ChartPlayer` with
   `controls: false` and `seed: 1`, call `play()`, wait 5 s, then measure 60 s between two `performance.mark()`s.
3. Per frame: record a trace (`Tracing.start` with the categories `toplevel`, `devtools.timeline` and
   `blink.user_timing`) and sum the thread time (`tdur`) of the main thread's top-level tasks from one
   `FireAnimationFrame` event to the next.
4. Split: over a second playback of the same span, run the CPU profiler (`Profiler.setSamplingInterval` with 100 µs,
   `Profiler.start`, `Profiler.stop`) and sum each node's self time: the player's bundle (by the source module each
   `// src/...` section of `dist/ournotes-player.js` names), the methods of `WebGL2RenderingContext`,
   `(garbage collector)`, `(program)` and `(idle)`.
5. Node.js: `node scripts/read-set.mjs <site>/charts/<chart>.json` prints the frames and seconds of a full run. For
   per-step times, run the same loop yourself (`ChartSession.create` with `headlessGL()` and `HeadlessAudioContext`
   from `scripts/lib/headless.mjs`, `setMusic(false)`, `play()`, then `step()` until the state is `"ended"`) with
   `performance.now()` around each step.
