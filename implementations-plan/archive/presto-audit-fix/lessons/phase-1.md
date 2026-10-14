# Phase 1: the three bumps

2026-10-14, base `origin/main` @ `14c4085`.

## sharp 0.35.4 → 0.35.5 (override)

- `bun.lock` shows one dependent: `miniflare@5.20260918.0-alpha`, pulled in by `wrangler` 4.135.0. It
  pins `"sharp": "0.35.4"` exactly, so no lock-only move can reach 0.35.5, and moving wrangler is
  out of scope.
- Fix: an exact root `overrides` entry, `"sharp": "0.35.5"`, next to `ws` and `systeminformation`.
- **A plain `bun install` drifts the lock.** Besides sharp, it hoisted root `vite` from 8.2.2 to the
  8.3.0 the playground already had, and dropped the nested `@alejoamiras/presto-playground/vite`
  entry.
  - Fix: rebuild the lock from `HEAD`, taking only the `sharp` and `@img/sharp-*` entries (27)
    from the re-resolution, and add the override line. The splice script lives in the scratchpad
    and is not committed.
  - Check: from a clean `node_modules`, `bun install --frozen-lockfile` passes and the store holds
    `sharp@0.35.5`, `vite@8.2.2` and `vite@8.3.0`.
- Every `@img/sharp-*` package moves to 0.35.5, and libvips moves from 1.3.3 to 1.3.4. No platform
  package is added or removed.
  - Publication: sharp 0.35.5 at 2026-09-27T13:46Z, `@img/sharp-linux-x64` 0.35.5 at 13:45Z, and
    libvips-linux-x64 1.3.4 at 12:11Z.
  - Provenance: sharp and `@img/sharp-linux-x64` carry SLSA v1.

## source-map-js 1.2.1 → 1.2.2 (lock only)

- Its dependents, `postcss` and `@tailwindcss/node`, both ask for `^1.2.1`.
- Method: drop the lock entry, run `bun install`, then splice back only the `source-map-js` entry
  onto the committed lock. The diff is one line.
- The integrity `sha512-KGj/8Y43…Vw==` equals npm's `dist.integrity`.
- The publisher is the sole maintainer, the same as for 1.2.1. No provenance on either version.

## quinn-proto 0.11.17 → 0.11.19 (three Cargo locks)

- Ran `cargo update -p quinn-proto --precise 0.11.19` against `packages/presto/{core,server,src-tauri}`.
- Each lock changes only `version` and `checksum`. The checksum `0e750cca…befbe` equals crates.io's.
- Published 2026-09-30 by `djc`. The crate's owners are `djc` and `Ralith`, and 0.11.17 came from
  `Ralith`.

## Gates

- `bun run audit:dependencies`: 0 blocked, 13 accepted, 31 moderate/low reported, 8 RustSec
  informational. Exit 0.
  - It ran with cargo-audit 0.22.2, the version CI pins, installed with `--locked` into a scratch
    root outside `~/.cargo/bin`.
- `bun install --frozen-lockfile`, `bun run test`, `bun run lint`, `bun run lint:actions`: exit 0.
- The sdk-core, sdk, sdk-noir and playground builds: exit 0, the playground's licence step
  included.
- `cargo test --locked` passed for core, server and src-tauri, with 0 failures.
- `bun run lint:clippy` (all three crates) and `cargo check --locked --target x86_64-pc-windows-gnu
  --lib` (src-tauri): exit 0.
