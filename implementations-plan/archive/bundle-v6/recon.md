# bundle-v6 — recon

Base: `origin/main` @ `a9dbe84`. Two read-only explorers (integrator docs sweep; bundled-`bb` release
pipeline); every claim below that the plan rests on was re-checked by hand.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Choose the bundled `bb` | `packages/presto/scripts/copy-bb.ts:207-225` `resolveAztecBb()`: SDK `package.json` → `@aztec-labs/bb-prover` → its `@aztec-foundation/bb.js` → that package's version. Writes the gitignored `src-tauri/AZTEC_VERSION`; `build.rs:116-124` injects it as `AZTEC_BB_VERSION` | reuse-as-is: already resolves `6.0.0-rc.1` |
| Native `bb` per platform | `node_modules/.bun/@aztec-foundation+bb.js@6.0.0-rc.1/.../build/{arm64,amd64}-{macos,linux}/bb`; the only bb.js copy in the tree | reuse-as-is |
| Windows `bb.exe` | `copy-bb.ts:87-91` reviewed `6.0.0-rc.1` pin (sha256, manual-review note, 2026-09-28) | reuse-as-is |
| Bundle proof without publishing | `.github/workflows/build-test-bundle.yml` (`platform: all` → three unsigned builds + `_e2e-packaged.yml`) | reuse-as-is |
| Prerelease publish | `release-presto.yml` `-f version=X.Y.Z-rc.N` from `main`; `validate` marks `-` versions prerelease (`:82-90`), the build stamps the dispatched version into `Cargo.toml`/`tauri.conf.json` (`:239-262`); `docs/RELEASE_RUNBOOK.md` §1-2 | reuse-as-is |
| Release notes' version line | `release-presto.yml:975,1029-1030`: `AZTEC_VER` from `scripts/aztec-manifest.ts packages/sdk/package.json`, rendered "Built against Aztec \`${AZTEC_VER}\`" | adapt: wording implies one supported version |
| Version facts for integrators | Correct but buried: root `README.md:90` (blockquote), `packages/sdk/README.md:241-268,338`, `SKILL.md:217-239,321`, `packages/presto/README.md:338-353` | adapt: lead with them, one canonical section, links elsewhere |
| SDK sends its Aztec version | `packages/sdk/src/lib/presto-prover.ts:79-84` (`sdkAztecVersion()` from the pinned `@aztec-labs/stdlib`), sent as `x-aztec-version` by `packages/sdk-core/src/lib/presto-transport.ts:944`; `presto-noir` sends its resolved bb.js version (`presto-ultra-honk-backend.ts:108,114`) | reuse-as-is (document it) |
| Banners cross-links | Present in root `README.md:24,182`, `packages/sdk/README.md:178`, `SKILL.md:133-135`, the playground. **Absent** from `packages/sdk-core/README.md` and `packages/sdk-noir/README.md` (searched `-i banner`: no hits) and from `packages/sdk/AGENTS.md` | adapt |
| Agent-facing docs per package | Only `packages/sdk` has `AGENTS.md` + `.claude/skills/presto/SKILL.md`, both in its npm `files` | reuse; no new AGENTS.md elsewhere (see plan's alternatives) |
| Site-level agent entry point | **None**: no `llms.txt` / `robots.txt` anywhere (searched `-iname "llms*.txt"`, `-iname "robots*"`, excluding `node_modules`). `packages/landing/public/` holds `_headers`, `og-image.png`; Vite copies `public/` to the site root | build new: `packages/landing/public/llms.txt` |
| Doc-content guards | `packages/sdk/src/lib/public-contract.test.ts` (README/SKILL/AGENTS phrases, `files`), `packages/sdk-core/src/lib/public-contract.test.ts:62` and `packages/sdk-noir/src/lib/public-contract.test.ts:56` (`files` pinned with `toEqual`), `packages/presto/scripts/release-contract.test.ts` (reads `release-presto.yml`), `packages/landing/src/*.test.ts` (bun test) | adapt: extend, no new harness |

## Version surfaces a reader can mistake for "Presto is 5.2.0"

- GitHub release notes, 1.1.3: `### Aztec Version` / "Built against Aztec \`5.2.0\`".
- `/health` (detailed tier): `version` (app, e.g. `1.1.4-rc.1`) beside `aztec_version` (the bundled
  one), with `available_versions` and `versions` listing every cached one (`core/src/server.rs:481-490`).
- Tray: "v<app> · Aztec <bundled>" (`src-tauri/src/tray.rs:113-117`); the Versions submenu marks the
  bundled one "(bundled)".
- Install comments: root `README.md:61-62` "Aztec v5 (5.2.0), npm \`latest\`" (an SDK line, read as
  Presto's version); `SKILL.md:15` "Native v6 proving needs the Presto app 1.1.3 or later".

## Hardcoded `5.2.0` outside archives and changelogs

All test fixtures, test fallbacks or comments; none decides what ships:
`core/src/versions/downloader.rs:905`, `release_metadata.rs:295,329` (network-test defaults),
`core/src/server/tests.rs:1709,1747`, `src-tauri/src/main.rs:1295`, `scripts/tray-menu.test.ts` (fixtures),
`core/src/bb.rs:350-352`, `core/src/bb/ultra_honk.rs:6,28,218,324`, `core/tests/ultra_honk_real_bb.rs:17,201`,
`e2e-webdriver/ultra-honk.spec.ts:39` (comments). The UltraHonk comments describe workarounds that
stay needed while Presto still downloads 5.2.0 for v5 dApps; they are not stale by default.

## Facts that shape the trade-off

- The committed app version is already `1.1.4-rc.1` (`tauri.conf.json:4`, both `Cargo.toml:3`);
  the release overrides it from the dispatch input.
- `core/src/bb.rs:350-352`: bb 5.2.0 on Windows writes proofs in text mode, so v5 native proving on
  Windows already falls back to WASM; bb 6.0.0-rc.1 fixed it. Bundling v6 removes nothing Windows had.
- Every PR lane that runs a real `bb` (UltraHonk Real bb, Windows Prebuild/Build Smoke, WebDriver)
  goes through the live prebuild, so `main` already exercises bb 6.0.0-rc.1.

## Collision risks

- `sdk-core` / `sdk-noir` contract tests pin `files` with `toEqual`: shipping new files there breaks them.
- The SDK contract test forbids "Peer dependency" and a flat `interface PrestoStatus {` in the README.
- `packages/landing` must never contact Presto (`playground/e2e/lna.real.spec.ts` asserts zero
  requests to either port); a static `llms.txt` does not change that.
