# Phase 1 — The release says what it bundles, and the bundle is proven

## What landed

- `release-presto.yml` notes: `### Aztec versions` now sits right after the title, before the
  downloads. It replaces the trailing "Built against Aztec `X`".
- `release-contract.test.ts` pins the section's placement, its wording and its two links, and forbids
  the old phrase.
- `presto.packaged-e2e.spec.ts`: after the native proof, the detailed `/health.aztec_version` must
  equal the SDK's `@aztec-labs/stdlib` pin, which is what routes a proof to the bundled `bb`.

## Attempts

1. Biome `noTemplateCurlyInString` flagged the literal `${AZTEC_VER}` inside a quoted test string.
   A regex literal (`/…\$\{AZTEC_VER\}…/`) matches the same text and passes the lint.
2. Rendered the notes heredoc locally with `VERSION=1.2.0-rc.1 AZTEC_VER=6.0.0-rc.1`: the section
   reads as intended and the indentation strip still applies.

## Gate

- From `packages/presto`, `bun test scripts/release-contract.test.ts`: 32 pass.
- `bun run test` exit 0; `bun run lint:actions` exit 0.
- Branch pushed at `e6d3038`. `build-test-bundle.yml` runs, both concluded `success` at that SHA:
  - `37055445459` (`platform=all`): Build linux-x86_64, windows-x86_64 and macos-arm64. Packaged
    E2E passed on macOS (2 passed) and Linux https (2 passed), and Linux http passed. Full uninstall
    passed on Windows and Linux, and fresh install + state isolation passed on Linux.
  - `37055449680` (`platform=macos-x86_64`): Build macos-x86_64. This platform runs no packaged
    acceptance.
- Every build log, Intel included: `Aztec bb version: 6.0.0-rc.1`.
- Linux `.deb` sidecar `usr/bin/bb --version` → `6.0.0-rc.1`. Its sha256 `ba8bbb2b…29d9` equals
  `@aztec-foundation/bb.js@6.0.0-rc.1` `build/amd64-linux/bb`.
- Windows has no packaged proving E2E in this workflow. Its bundle evidence is the build log and the
  reviewed `bb.exe` 6.0.0-rc.1 pin. The release's own Windows smokes run at publish time.
