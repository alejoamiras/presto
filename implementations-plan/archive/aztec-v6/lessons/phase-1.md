# Phase 1: `bb` from barretenberg

## What changed

- Rust: `BB_RELEASE_REPO = "AztecProtocol/barretenberg"` feeds `download_url` and the digest API URL
  (`core/src/versions/release_metadata.rs`). The live-test fallback versions (`download_url_resolves`,
  `download_and_verify_bb`) move to 5.2.0, because barretenberg has no v4.x or pre-2026-06-30
  nightlies.
- TS: `copy-bb.ts` exports `BB_RELEASE_REPO`; `download-bb.ts` and `check-windows-bb-pin.ts` import it,
  following the existing root-scripts → `packages/presto/scripts` direction. The happy-path fetch stub
  in `download-bb.test.ts` now asserts both exact barretenberg URLs, so the end-to-end tests pin the
  source repository.
- `docs/SECURITY_MODEL.md`: the source repository and the v5.0.1 rebuild.

## Deviations from plan.md (verified 2026-09-28)

- **Pruned pins are 4.2.0, 4.3.1 and 5.0.1, not 4.2.0, 4.3.1 and 5.0.0-rc.1.** Asset-by-asset
  comparison of the two repositories' GitHub digests:
  - v5.0.0-rc.1, v5.0.0-rc.2, v5.0.0, v5.1.0, v5.2.0: all 17 assets identical.
  - v5.0.1: every `bb` asset differs (six tarballs, same sizes). Barretenberg rebuilt it. The
    Windows asset is `9ab16976…` there versus the pinned `f7a2d6b1…`, so that pin could never verify.
  - v4.2.0, v4.3.1: absent from barretenberg (404).
- **`README.md:194` untouched.** It is npm licence text (the `@aztec/*` packages are Apache-2.0 in
  aztec-packages), which is still true for v5; arc 3 re-keys it with the scope rename.
- The gate's `rg` for aztec-packages release URLs returns nothing, not even licence URLs.

## Gate evidence

- `bun run test`: exit 0 (sdk-core 195, sdk 31, sdk-noir 39, banners 33, playground 108, presto
  scripts 105, release-feed 4, root scripts 227 + 1 skip).
  - First run failed: `brand-sweep.test.ts` flagged the retired product name in `recon.md`. Reworded.
- `bun run lint`: exit 0; its two Biome warnings are pre-existing in untouched files.
- `cargo test --locked` (core): 305 passed.
- Live, each with a fresh real-disk `PRESTO_HOME` under `~/.cache/presto-aztec-v6/`:
  `download_and_verify_bb` passed for 5.2.0 and for 6.0.0-rc.1. The test deletes its own download on
  success; the `versions/` directory it created under each `PRESTO_HOME` shows it never touched
  `~/.presto`.
- `BB_VERSIONS_DIR=<private> bun run bb:download 5.2.0`: exit 0, "✓ 5.2.0 (36.5 MB, verified)".
- Scratch caches deleted afterwards.
