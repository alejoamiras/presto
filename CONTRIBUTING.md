# Contributing

Contributions are welcome. Keep changes focused, explain the user-visible effect, and preserve the
project's fail-closed security and release behavior.

## Repository map

Eight Bun workspace packages, four of them published to npm:

| Path | What it owns |
|---|---|
| `packages/sdk-core` | `@alejoamiras/presto-core` — the transport and policy every adapter shares: loopback discovery, HTTPS-first pinning, scheme negotiation, fallback reasons. No `@aztec/*` dependency. |
| `packages/sdk` | `@alejoamiras/presto` — `PrestoProver` for Aztec dApps, a thin adapter over `PrestoClient`. |
| `packages/sdk-noir` | `@alejoamiras/presto-noir` — a drop-in for bb.js's `UltraHonkBackend` for any Noir circuit, with WASM fallback. |
| `packages/banners` | `@alejoamiras/presto-banners` — the zero-dependency `<presto-banner>` web component integrating dApps embed. |
| `packages/presto` | The Tauri desktop app (`src-tauri`), the GUI-independent proving core (`core`), and the headless CI server (`server`). |
| `packages/playground` | The demo at `playground.presto.build`: WASM vs native comparison, Aztec transfer and Noir circuit. |
| `packages/landing` | The site at `presto.build`. |
| `packages/release-feed` | The Worker that serves the signed updater feed from KV. |

Contracts that are easy to break from the outside: `.github/workflows` and
[`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) for release behavior,
`.github/filters/presto.yml` for CI routing, and
[`docs/CODE_QUALITY.md`](docs/CODE_QUALITY.md) for the complexity limits the PR gate enforces.

**Before changing a trust boundary, read [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md).** In
particular: origin approval and transport security are different controls, updater signatures are
independent of OS installer signing, and an upstream `bb` digest is not a publisher signature.

## Set up

Bun at the version in `.bun-version`, and the Rust toolchain pinned in `rust-toolchain.toml` (rustup
reads it automatically). `reqwest` builds against rustls with `aws-lc-rs`, so native builds need
**CMake**. Desktop builds also need the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host OS.

```sh
bun install --frozen-lockfile
```

Do not commit generated build output, local environment files, caches, certificate material, or
secrets.

## Develop and test

Run the smallest relevant check while iterating, then the repository gate before opening a pull
request:

```sh
bun run test            # lint + typecheck + unit tests across every package
bun run lint:actions    # actionlint, required if you touched a workflow
bun run audit:dependencies
```

Focused commands:

```sh
bun run --cwd packages/sdk-core test:unit
bun run --cwd packages/sdk-noir test:unit
bun run --cwd packages/playground test:unit
bun run --cwd packages/presto test:unit          # TypeScript build scripts
bun run --cwd packages/presto test:e2e:ui        # Playwright, mocked Tauri IPC
cargo test --locked --manifest-path packages/presto/core/Cargo.toml
cargo test --locked --manifest-path packages/presto/server/Cargo.toml
cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml
```

Some suites need setup or only run in CI: the WebDriver desktop E2E, the packaged-app and updater
smokes, `sdk-noir`'s `test:identity` (bb.js byte-for-byte reproduction of `fixtures/noir/`) and its
live `test:e2e` (needs a running Presto and `PRESTO_URL`). **Say in the pull request which checks you
could not run.**

Two traps worth knowing before they cost you an afternoon:

- Platform-gated Rust (`#[cfg(windows)]`, `target_os` branches) is invisible to a Linux-only check.
  Also run `cargo check --target x86_64-pc-windows-gnu --lib` from `src-tauri`.
- `implementations-plan/lessons.md` is the curated list of gotchas that have already bitten this
  repo. It is short on purpose. Read it first.

## Pull requests

- Open an issue first when a change alters a public API, a trust boundary, a release contract, or
  supported platform behavior.
- Add or update tests for behavior changes. Documentation-only changes should still keep links and
  commands accurate.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit subjects; commitlint
  enforces it, and Husky + lint-staged run on pre-commit.
- Keep lockfile changes intentional and explain any new production dependency. New dependencies are
  subject to the seven-day publication-age gate in `bunfig.toml`.
- Update user-facing documentation and migration notes in the same pull request.
- Do not weaken a required CI gate or fail-closed release behavior to make a change pass.

By contributing, you agree that your contribution is licensed under the repository's
[AGPL-3.0-only license](LICENSE). Report vulnerabilities privately under
[SECURITY.md](SECURITY.md), and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
