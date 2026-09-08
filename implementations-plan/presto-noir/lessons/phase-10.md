# Phase 10 — Scaffold `packages/sdk-core`

Date: 2026-09-08. Branch `presto-noir/sdk-core` (arc 3, stacked on `presto-noir/npm-tooling`).

## What landed

- `packages/sdk-core`: `@alejoamiras/presto-core` 1.0.0, `type: module`, source `exports:
  ./src/index.ts` (the publish rewrite repoints it at `dist/`), `files: [src, dist]`,
  `publishConfig.access: public`, scripts `build` / `test:lint` / `test:unit` / `prepublishOnly`
  mirroring the SDK; dependencies `@logtape/logtape` + `ms` only (the transport moves in phase 11 and
  needs both); no `@aztec/*` anywhere, which `public-contract.test.ts` asserts.
- Real barrel, not a placeholder: `src/lib/schemes.ts` exports `PRESTO_SCHEME_CHONK`,
  `PRESTO_SCHEME_ULTRA_HONK`, and the `PrestoScheme` union — the `/health.schemes` identifiers both
  adapters will check. `PRESTO_API_VERSION` arrives with `types.ts` in phase 11.
- README skeleton (what the package is, who depends on it, the two exports) with a doc-sync test
  that reads the README and the manifest.
- Root `package.json`: `packages/sdk-core` first in `workspaces`; `test:typecheck` and `test:unit`
  run the new package before `packages/sdk`.
- Descriptor entry `presto-core` (`versionMode: manifest`, `consumerProfile: presto-core`) plus
  `scripts/tarball-consumer/presto-core/{index.ts, runtime-check.mjs, tsconfig.json}`.
  `release-plan.test.ts` now uses the real entry and injects only `presto-noir`;
  `npm-packages.test.ts` expects `presto, presto-core` in the unknown-key message.
- `bun.lock` gains the workspace entry (13 lines, no new resolutions).

## Notes

- `prepare-sdk-publish.ts` is manifest-relative, not package-keyed: it runs from the package
  directory with the version as its first positional. Passing `--package` makes it read a manifest
  named after the key. The consumer script is the keyed half (`sdk-tarball-consumer.sh <tarball>
  presto-core`).
- Local reproduction of the CI tarball job for the new package: build → rewrite → `npm pack` →
  restore manifest → consumer script. Result: "packed tarball resolves, typechecks, and loads (no
  @aztec/stdlib dependency: singleton gate not applicable)".
- Biome's import sorter puts `export type` before value re-exports; run `biome check --write` on new
  barrels before the gate.

## Gate

`bun run test` exit 0 (biome, sort-package-json over 7 manifests, shellcheck, cargo fmt, typecheck
incl. `packages/sdk-core`, unit: sdk-core 3 · sdk 189 · playground 72 · presto scripts 105 ·
release-feed 4 · root scripts 157). Tarball consumer for `presto-core`: OK locally.
