# Phase 1 — Noir fixtures and regeneration script

Date: 2026-09-07. Base: main @ 667da60 (post presto-cleanup), branch `worktree-presto-noir`.

## What landed

- `fixtures/noir/{square,nopub}/`: Noir source, `Prover.toml`, compiled `circuit.json` (aztec-nargo
  1.0.0-beta.25 / Aztec 5.2.0), `witness.gz`, and the bb.js **WASM** reference `vk`, `proof`,
  `public_inputs`, plus `manifest.json` (sha256 + size per file, field counts, target, toolchain).
- `scripts/noir-fixture.ts` (`--verify` default, `--regenerate [names]`) and `noir-fixture.test.ts`.
- `fixtures/noir/README.md`.

## Verified here

- WASM regeneration (bb.js 5.2.0, `BackendType.WasmWorker`, 11 threads) of both fixtures: 4.6 s wall
  total including CRS from the local cache; `square` → 410 proof fields / 2 public inputs, `nopub` →
  410 / 0.
- Native cross-check (bb 5.2.0-nightly.20260807): `bb prove -k fixtures/noir/square/vk` reproduces
  the WASM `proof` and `public_inputs` byte for byte; `bb prove --write_vk` on `nopub` reproduces both
  the WASM `proof` and the WASM `vk`. `bb verify` exits 0 on the committed artifacts. The transitive
  byte-identity claim (D-20/D-35) therefore holds for the committed reference set.
- `fieldCount` throws on partial fields; an empty `public_inputs` verifies (F-15).

## Notes for later phases

- `**/target` is already gitignored, so nargo's build output inside a fixture directory never lands
  in the tree; the committed artifacts are copied out of it by `--regenerate`.
- Root scripts cannot `import type` from `@aztec/bb.js` (not resolvable from the root tsconfig), so
  the script declares a minimal structural interface and resolves the package at runtime from the SDK
  tree, the same path `copy-bb.ts` uses. The typo `Barretenberg: { new (…) }` (a construct signature)
  vs `{ new: (…) => … }` (a static method) cost one typecheck round.
- `--verify` compares `manifest.toolchain.bbJs` with the installed bb.js version, which is the
  fixture-staleness tripwire an Aztec bump needs (Phase 1 requirement) without touching
  `update-aztec-version.ts`.
- Biome's `noUncheckedIndexedAccess`-style typing forbids `arr[i] ^= x` on `Uint8Array` in tests;
  `fill(v, i, i + 1)` is the idiom.

## Gate

`bun run typecheck:scripts` ✓ · `bun run test:scripts` (125 pass) ✓ · `bun scripts/noir-fixture.ts --verify` ✓ ·
`bun run lint` ✓.
