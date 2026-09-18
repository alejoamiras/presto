# Phase 16 — Tarball profile and release addition

Date: 2026-09-08. Branch `presto-noir/sdk-noir` (arc 4).

## What landed

- Consumer profile `presto-noir` (from phase 14: ESM host, `host-dependencies.json` installs the
  `@aztec/bb.js` peer, `index.ts` typechecks the surface incl. bb.js's types, `runtime-check.mjs`
  loads the dist and walks the drop-in's methods) now also asserts that every peer the host
  installs is a **singleton** (`scripts/tarball-consumer/assert-singletons.ts`: exactly one
  `node_modules/<name>` at any depth; a nested second bb.js would be two WASM runtimes and two
  `Barretenberg` types). The rule applies to any profile with host dependencies; `presto` and
  `presto-core` have none. Pre-merge the host gets the packed core (`--with`, bootstrap mode);
  the release rerun in `_publish-npm.yml` resolves core from the registry.
- A missing or unexpected `@aztec/bb.js` peer is one actionable error at the first WASM use
  (`loadUltraHonkBackend` in the adapter; unit test with `mock.module` replacing the peer). The
  native path never loads the peer.
- `release-sdk.yml`: `noir-gates` (the reusable with `identity: true`, `live: true`, at the release
  SHA, no `id-token`) gates `publish-noir`; `publish-presto` now also waits for `publish-noir`
  (success or skipped) so the order is core → noir → presto and the playground deployment sees
  both adapters. Contract test extended; runbook documents the order and the gates.
- `packaged-e2e-swap-sdk.sh [sdk] [core] [noir]`: when the playground depends on
  `@alejoamiras/presto-noir`, the adapter is swapped too (its own extracted copy, its workspace
  graph linked, the SAME packed core, pin asserted, consumer-side resolution proven); a no-op
  until arc 5 adds the dependency. `published-playground.ts`: `assertPublishedManifest` for any
  package, the noir candidate at the workspace version when the playground depends on it,
  `sharedCorePin` requires every adapter to pin one core, and that verified core is what gets
  installed. Tests for the pure parts.

## Notes

- zsh aborts a whole command line when a glob has no match (`rm -f a/*.tgz b/*.tgz`): the earlier
  commands did not run either. Name files explicitly or `setopt nullglob` in scripts.
- The noir consumer profile passes with the singleton assertion; all three profiles green locally.

## Gate

`bun run lint:actions` ✓ · `bun run test:scripts` ✓ · `bun run test` exit 0 ·
`sdk.yml package=presto-noir` incl. the consumer job: run id below once dispatched.
