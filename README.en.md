# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player is a browser player for BanG Dream! Our Notes charts (WebGL2 + WebAudio) that can be embedded in other web pages as a component.

This is an unofficial fan project, not affiliated with the game's developer or publisher. The repository contains no game assets: the player reads chart data prepared in the [data format](docs/data-format.md), supplied by the user.

## Status

Under development. The data format and the public API are committed ahead of `0.1.0`; the API may still change during `0.x`.

## License

The repository is licensed under AGPL-3.0-only (see [LICENSE](LICENSE)). The browser bundles under `dist/` distributed through npm carry the additional browser linking permission in [LICENSE-EXCEPTION](LICENSE-EXCEPTION): loading an unmodified bundle in an end user's browser and linking it with your own front-end code does not by itself make that front-end code subject to the AGPL. Modifying the player, or running it on a server or in any other non-browser environment, remains under the full AGPL, including the source-disclosure obligation for network use.
