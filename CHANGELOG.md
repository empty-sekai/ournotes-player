# Changelog

All notable changes to this package. Versions follow [Semantic Versioning](https://semver.org/).

## [unreleased]

### Bug Fixes
- cancel failed and aborted loads _(assets)_
- release MotionSync native resources _(live2d)_


## [0.1.6](https://github.com/empty-sekai/ournotes-player/compare/v0.1.5..v0.1.6) — 2026-09-30

### Features
- chart data page over nnnotes songs and chart-stats _(examples)_
- the chart data page reads nnnotes music-data _(examples)_
- the chart data page names the deck model commit _(examples)_
- play scenarios and accuracy sliders on the chart data page _(examples)_
- the chart detail shows the rank measure of every Gekisou range _(examples)_
- add single-skill aptitude functions and master factor conversion _(examples)_
- show Gekisou skill aptitude and chart factors in details _(examples)_
- label chart data and Gekisou aptitude as Beta _(examples)_
- refine chart data and add optional replay controls _(songs)_
- add experimental serialized prefab preview _(ui)_


### Bug Fixes
- the chart data page guide renders its definition lists; hedged wording _(examples)_
- keep mobile tables complete and contain replay controls _(songs)_
- keep engine notes consistent across line endings _(ui)_
- keep unsupported motion timing finite _(ui)_
- preserve notes and keep manual runs unpublished _(release)_


### Documentation
- the chart data page guide gives the rank 1 to rank 5 ratio _(examples)_
- chart data guide: figures come from a rewrite checked against the game's code _(examples)_
- chart data guide: how Gekisou skills work _(examples)_
- correct the Just-count support interaction claim _(examples)_
- record the scoped native whole-live verification _(examples)_


## [0.1.5](https://github.com/empty-sekai/ournotes-player/compare/v0.1.4..v0.1.5) — 2026-09-28

### Bug Fixes
- let a page's video keep its own clock, as CRI Mana does _(story)_
- catch up a late frame's game time up to Time.maximumDeltaTime _(story)_


### Performance
- drain the phases of a step in user-blocking tasks _(engine)_
- upload only the uniforms and blocks that changed; switch only changed vertex arrays _(engine)_
- draw a model from shared buffers; leave out the state a run of draws already set _(live2d)_


## [0.1.4](https://github.com/empty-sekai/ournotes-player/compare/v0.1.3..v0.1.4) — 2026-09-28

### Bug Fixes
- lay dialog texts and font fallbacks out with the game's line metrics _(story)_


## [0.1.3](https://github.com/empty-sekai/ournotes-player/compare/v0.1.2..v0.1.3) — 2026-09-28

### Bug Fixes
- lay open fonts out with the game's line metrics _(story)_


## [0.1.2](https://github.com/empty-sekai/ournotes-player/compare/v0.1.1..v0.1.2) — 2026-09-28

### Bug Fixes
- relay the log event and ignore taps while a session is replaced _(story)_


### Performance
- cache shader variants and pass states per material _(engine)_
- draw at the game's screen resolution, lighter frames on phones _(story)_


## [0.1.1](https://github.com/empty-sekai/ournotes-player/compare/v0.1.0..v0.1.1) — 2026-09-27

### Features
- read compressed assets and stories that reference their models


### Documentation
- describe the live, story and Live2D players in the README


## [0.1.0](https://github.com/empty-sekai/ournotes-player/releases/tag/v0.1.0) — 2026-09-27

### Features
- add the chart player, its API and the <ournotes-player> element
- add a Live2D model viewer
- support chart sites of several regions and languages
- describe regions, languages and model names in the manifests
- add read-set --plan: a chart's read set without stepping it
- add read-set --serve: many charts in one process
- add the game's Live settings and a note speed control
- add the Live2D story runtime, motion events and the URP post stack
- add bar lines and the flick arrows of note designs 2 and 3
- add the story player _(story)_
- chat phone, centered talk window, frame particles, URP-lit rooms, CRI Lips lip sync and emoji sprites _(story)_
- text underlines, named colours, missing glyphs, frame texts and video seek re-speed _(story)_
- frame canvas texts laid out and drawn through the story UI _(story)_
- text layout and drawing through TMP font fallback chains _(story)_
- particle effects draw from their own random stream _(story)_
- line and video bars in the control bar, seeking to a line or within a movie _(story)_
- a film-grain option, off by default; the grain tiles at the game's render size _(story)_
- seek within a clip; the control labels follow the story's language _(story)_
- the home spot's post-processing volume _(story)_


### Bug Fixes
- element state in ready, property setters, single play event
- model opacity curves and expression ids the model lacks _(live2d)_
- follow the host's visibility; check the Cubism Core before loading
- sort the ENGINE: notes list the same way on every platform
- accept any AudioContext sample rate and suspend it at the chart end
- simple talk window draws and checks text from fallback fonts _(story)_
- rebind every model's views after the Cubism Core heap grows _(live2d)_
- hide the backlog and choices at start, show letterbox bands in time, drop the menu _(story)_
- apply the UI stencil state, so the video curtain and masked UI draw _(engine)_
- drop the story page's line caption, which repeated the talk window with its tags _(examples)_
- a voice's PCM source made before the voice starts no longer drops the voice _(audio)_
- the story pages keep the core and motionsync query entries in their links _(examples)_
- a story motion that has ended holds its last pose instead of replaying _(live2d)_
- story videos play their sound and pause with the player _(story)_
- the story pages load a Spine runtime from ?spine= for home talks _(examples)_
- supply the sprite, camera and object built-ins that particle effects read _(story)_
- a float4 value on a float, float2 or float3 uniform uploads its leading components _(engine)_


### Performance
- build the per-draw uniform sheet on demand
- a forward clip seek plays on from the current session; cheaper undrawn steps _(story)_


### Documentation
- describe the chart data format, with JSON schemas and a validator
- write the readme, fidelity notes and contributing guide
- link nnnotes at its home, MetaSekaiLab/nnnotes
- install from GitHub until the package is on npm
- add performance.md: the CPU cost of a frame
- a file holds each controller and clip once; the validator checks every reference _(story)_



