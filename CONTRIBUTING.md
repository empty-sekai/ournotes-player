# Contributing

Thank you for helping. This document covers the commit conventions, the tests, and the data policy.

## Data policy

**Never commit game data.** This repository and its npm package contain no game assets: no chart files, textures,
shaders, audio, or files derived from them, and no screenshots or recordings of them in tests or fixtures. Tests use
synthetic inputs only; tests that need real charts read them from a directory outside the repository
(`OURNOTES_DATA`, below). The data format is documented in [docs/data-format.md](docs/data-format.md); producing the
data is outside this repository.

## Development

Node.js 20 or later. There are no runtime dependencies; the development dependencies are esbuild and TypeScript.

```sh
npm ci
npm test               # unit tests: node --test tests/unit/*.test.mjs
npm run typecheck      # type-checks tests/types/ against types/
npm run build          # dist/: ESM, minified ESM and IIFE bundles with source maps
node scripts/build.mjs --check   # builds twice and fails if the outputs differ
```

The source is plain JavaScript ES modules (`src/`), with type declarations in `types/`. Keep both in step when the
public API changes, and document it in [docs/api.md](docs/api.md).

### Tests

- `tests/unit/`: `node --test`, synthetic inputs only. Test behaviour the code documents: an expected value should come
  from the definition the module states (an easing formula, Unity's matrix convention, a documented algorithm), not
  from the current output of the code.
- `tests/data/` (opt-in): runs the player in Node with a no-op WebGL2 context and a no-op AudioContext over a real
  chart site, and checks that charts play to the end and that seeking, speed changes, pause and late frames keep the
  chart state exact. It is skipped unless `OURNOTES_DATA` names a site directory:

  ```sh
  OURNOTES_DATA=/path/to/site npm run test:data
  OURNOTES_DATA=/path/to/site OURNOTES_CHARTS=100001_expert,100040_expert OURNOTES_SEEK_CHART=100082_expert npm run test:data
  ```

  The same run checks that the read-set plan (`node scripts/read-set.mjs <chart> --plan`, which lists the files a chart
  reads without stepping it) equals the full simulation's read set; `OURNOTES_READSET_CHARTS=all OURNOTES_JOBS=<n>`
  checks every chart of the site, `n` at a time.

- `npm run validate-data -- <site dir> [chart id ...]` checks a site against the data format and the schemas in
  `schema/`.

Rendering changes cannot be verified by the tests alone; describe how you checked them in the pull request.

### Fidelity

The player follows the game's own code. Comments name the game class and method a piece of code follows. Behaviour that
lives in the engine's native code (Unity, CRI) rather than in the game's managed code is implemented from the engine's
documented semantics and marked with a comment starting `ENGINE:`; [docs/fidelity.md](docs/fidelity.md) lists these
places. Features of the viewer that the game does not have (the controls) are kept apart and documented as such.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), in English:

```
<type>(<optional scope>): <summary in the imperative, at most 100 characters>
```

Types: `feat`, `fix`, `perf`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `style`, `revert`. A breaking change
is marked with `!` after the type or a `BREAKING CHANGE:` footer. The `lint-commits` workflow checks the titles.

Release notes are generated from the commits with [git-cliff](https://git-cliff.org/) (`cliff.toml`): `feat`, `fix`,
`perf`, `docs` and breaking changes appear in them; the other types do not.

## Releases

Versions follow [SemVer](https://semver.org/); during `0.x` a minor version may change the API. A release is a tag
`vX.Y.Z` matching `version` in `package.json`; the release workflow runs the tests, builds, publishes the package to
npm with provenance, and creates the GitHub release with notes from git-cliff and the bundles attached.

## License

By contributing you agree that your contributions are licensed under the repository's license (AGPL-3.0-only, with
the browser exception in [LICENSE-EXCEPTION](LICENSE-EXCEPTION)).
