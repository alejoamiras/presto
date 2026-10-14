# Phase 3: the rc.3 bump and the Noir fixtures

## Bump

- `bun run aztec:update 6.0.0-rc.3` → targets `@aztec-labs/*` 6.0.0-rc.3, `@aztec-foundation/*`
  6.0.0-rc.6; it wrote the three manifests, `host-dependencies.json` and `CRS_CACHE_VERSION`
  (6.0.0-rc.6). `bun install`: 35 packages, and the lock changed only `@aztec-labs/*` and
  `@aztec-foundation/*` entries.
- **No new Aztec name.** `bunfig-aztec-excludes.test.ts` passes against the rc.3 lock in both
  directions, so the bunfig list (41 names) and the installer list (62 names) are unchanged, and no
  separate exclude commit exists.
- `bun install --frozen-lockfile`: exit 0, "no changes", with no min-age skip.
- The rc.3 typecheck forced no TS change.
- Commits: `e75321a` (Windows pin), `183117e` (bump, presto-noir 2.0.0-rc.2, fixtures, setup-aztec,
  allowlist reasons), `c1111a9` (tray label `· bb <version>`, Rust comments), `45af6f3` (docs).

## Manual items

- presto-noir: version 2.0.0-rc.2, `TESTED_BB_VERSIONS = ["6.0.0-rc.6"]` (its doc comment no longer
  claims bb.js shares the Aztec version), test literals, `runtime-check.mjs`, README (install line,
  tested-pairs row, the two integrator pointers). `follow-ups.md` drops presto-noir from the
  integrator-pointer entry.
- `setup-aztec`: allow-scripts `lmdb@3.5.7`, comment names rc.3. The cache salt is not bumped: the
  key already contains the Aztec version, so rc.3 starts a fresh cache.
- Windows pin `6.0.0-rc.6` → `d79cb3ee…d1ac`. Re-checked `git/ref/tags` for v6.0.0-rc.6 and
  v6.0.0-rc.1: both `commit 654cc60efa083aa31bd765656ec5149810360cca`, so the tag is not evidence;
  the review evidence is the digest match, the PE contents and the DLL import set (phase 0 notes).
- `presto.packaged-e2e.spec.ts` moved in phase 1.
- Audit allowlist: rc.3 still pins `undici ^5.28.5` (`@aztec-labs/foundation`) and resolves
  `@opentelemetry/core@1.30.1`, so every reason holds; the text names rc.3.

## Remaining `6.0.0-rc.1` references, each intended

- Historical: `docs/PLATFORM_SUPPORT.md:58` and `core/src/bb.rs` (rc.1 is where bb fixed the Windows
  text-mode write); `copy-bb.ts`'s rc.1 pin; presto-noir README's 2.0.0-rc.1 row.
- `packages/playground/published-sdk.json`: in `app.yml`'s `published` filter, moved by the owner's
  pin PR after publication.
- `license-fallbacks.ts` `AZTEC_TAG = "v6.0.0-rc.1"`: the vendored licence texts are pinned to the
  tag they were read from; the build accepts them for rc.3 packages.
- Script and unit-test sample data: `scripts/*.test.ts`, `scripts/tarball-consumer/*.test.ts`,
  `fpc-funding.test.ts`, `third-party-licenses.test.ts`, `testnet-rpc/src/index.test.ts`.
- The legacy interop fixture (`audit/fixtures/interop-sdk.json`) stays on presto 6.0.0-rc.1: dormant
  until presto 6.0.0-rc.3 is on npm, then it must move.

## Gate

- `bun run test` exit 0; `bun run lint:actions` exit 0.
- Builds `sdk-core`, `sdk`, `sdk-noir`, `playground`: exit 0 (the licence step emitted
  `third-party-licenses.txt` with no unmapped package).
- `pack-candidate.ts` + `sdk-tarball-consumer.sh` for `presto`, `presto-core`, `presto-noir`: exit 0.
  The packed `presto` pins `@aztec-labs/stdlib`, `bb-prover`, `foundation` at exactly `6.0.0-rc.3`
  and `@aztec-foundation/bb.js`, `noir-acvm_js`, `noir-noirc_abi` at exactly `6.0.0-rc.6`, plus
  `presto-core` `1.2.1` (unchanged). The packed `presto-noir` peers `@aztec-foundation/bb.js`
  `6.0.0-rc.6`. Packing left the tree clean.
- `bun run --cwd packages/presto prebuild`: copied bb.js rc.6's `bb`, wrote `AZTEC_VERSION` =
  `6.0.0-rc.6`.
- Fixtures: `--regenerate` with the rc.1 install's nargo (`1.0.0-rc.3+5a7ee9bf`). Against `main`,
  only the three `manifest.json` files changed, each only `toolchain.bbJs` (rc.1 → rc.6). ACIR, keys,
  witnesses, proofs and public inputs are byte-identical. `--verify` exit 0;
  `sdk-noir test:identity`: 4 pass.
- Rust: `cargo test --locked` (core) 375 + 5 pass, 4 ignored; `bun run lint:clippy` exit 0;
  `cargo check --target x86_64-pc-windows-gnu --lib` exit 0. The first attempt failed on setup, not
  code: the frontend bundles were unbuilt (`build.rs` F-012), and the Windows target was not
  installed. Fixed by `frontend:build` and `rustup target add x86_64-pc-windows-gnu`.
- Live Noir: a branch `presto-server` (sidecar bb, `AZTEC_BB_VERSION=6.0.0-rc.6`, `--allow-all`),
  run under `env -i` with a private `PRESTO_HOME` on real disk and a port claimed from
  `~/.agents/ports.md`. `/health` named `6.0.0-rc.6` with `schemes: [chonk, ultra_honk]`.
  `sdk-noir test:e2e`: 6 pass, 1 skip (the optional W cross-check, no fixture dir), 0 fail. The
  process group and the port row were gone afterwards.
- `git diff --name-only origin/main...` ∩ `app.yml`'s 14-entry `published` list: empty.
- **Dependency audit: not green, and not caused by this branch.**
  - `cargo-audit` is not installed on this host. The Cargo locks are unchanged, so the bun half was
    evaluated with the repo's own `parseAllowlist` / `parseBunAudit` / `evaluateFindings`. Result:
    13 accepted, 31 reported, 2 blocked (`sharp` GHSA-wq5f-xc86-pv6w, `source-map-js`
    GHSA-68fv-2mgg-jv7q), 0 stale.
  - `main`'s scheduled `dependency-audit.yml` has failed since 2026-10-12 on the same two plus
    `quinn-proto` RUSTSEC-2026-0338/0340/0343 in all three Cargo locks. Patched releases exist:
    sharp 0.35.5 (2026-09-27) and source-map-js 1.2.2 (2026-09-30). No issue tracks it.
  - The PR's `dependency-audit` job will fail for this reason. It is not a required gate and
    `release-sdk.yml` does not call it, but `release-presto.yml` does.

## Container install

- Image `presto-rc3-aztec:local` `sha256:a6b98db66b35d3d63cf3ad0e90d3d1bc01c5c6a56a1312d7e649da8dc4720794`,
  built from `ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`.
- Installer: `install.aztec.network/6.0.0-rc.3/install` (setup-aztec's URL), sha256
  `f7f2349e500dc3c25c445f1b661aa63ec3e9724ba0cc818d98c38078b23055d6`. That equals the reviewed copy.
  It ran unmodified, as CI runs it (noirup and foundryup included).
- The run:
  - `--user uid:gid --cap-drop ALL --security-opt no-new-privileges --network host`;
  - node 24.21.0 and npm 12.0.2 read-only; `home`, `aztec`, `run` under `~/.cache/presto-rc3/`
    read-write;
  - env exactly `HOME PATH SHELL CI npm_config_min_release_age NPM_CONFIG_USERCONFIG`;
  - the npmrc built from the committed list and the committed allow-scripts loop.
- The first run failed in `install_noir`: noirup's installer could not detect a shell and exited, 3
  retries. CI has `SHELL`; adding `SHELL=/bin/bash` fixed it.
- Result:
  - `npm config get min-release-age-exclude` equals the list (62);
  - no ETARGET and no blocked-scripts warning;
  - versions file: noir 1.0.0-rc.3, foundry 1.4.1, node 24.12.0;
  - `aztec --version` 6.0.0-rc.3; snappy loads;
  - `aztec-installer-graph.ts <prefix> <list> 6.0.0-rc.3 6.0.0-rc.6` matches (62 names);
  - script-bearing packages are exactly the seven pins, `lmdb@3.5.7` included.
- The phase-0 host scratch install was deleted before this run.
