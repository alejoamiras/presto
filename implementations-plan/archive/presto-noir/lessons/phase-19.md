# Phase 19 — Docs

Date: 2026-09-08. Branch `presto-noir/playground-docs` (arc 5).

## What landed

- Root `README.md`: SDK Core / SDK Noir badges, Packages rows for `@alejoamiras/presto-noir` and
  `@alejoamiras/presto-core`, the architecture diagram with both adapters over `PrestoClient` and
  both routes, a "For Noir circuits" quick start mirroring the SDK block (Presto ≥ 1.1.0 note,
  same transport rules), build commands for the two new packages.
- `packages/sdk-core/README.md`: badges, links to both adapters, exact-pin rationale, Development
  and License sections. `packages/sdk-noir/README.md`: badges, peer/core/Presto-version notes,
  bundling note, **Fallback semantics** (a `FallbackReason` table against the presto's answers,
  phase trails, `PrestoHttpError`), **Compatibility** (runtime matrix + the tested pair
  `presto-noir 1.0.0 ↔ bb.js 5.2.0 ↔ Presto ≥ 1.1.0`), exports, Development (`test:identity`,
  `test:e2e` env contract). `packages/sdk/README.md`: core dependency paragraph with the pointer to
  presto-noir, `schemes?` / `versions?` on the available status.
- `docs/RELEASE_RUNBOOK.md`: the artifact table now lists the three npm packages with their version
  sources and dispatch selections; when an Aztec bump is (and is not) a core / adapter release; the
  exact-pin consequence (a core change reaches users only through adapter republishes); manifest
  versions bump in-tree; `sdk:promote --package <key>` per package with the dependency order and
  why installs do not depend on it; failure-classification note for sibling names/tags.
- `packages/presto/VERIFIED_SITES.md`: "Which origins qualify" (production only, no `www.`
  redirect hosts, no preview/branch deployments, one entry per product) and the
  `verified-sites.json` entry `https://yacana.network` (A-06, apex only, `addedAt` 2026-09-08).
- `CLAUDE.md`: SDK Core and SDK Noir bullets, the playground Noir panel, workspaces list, the
  `_ts-package-ci.yml` / `release-sdk.yml` gates, refreshed test counts (sdk-core 186, SDK 20,
  sdk-noir 38, playground 75, presto scripts 105, root scripts 179, release-feed 4; 16 mocked
  playground Playwright tests). `packages/playground/README.md`: the Noir panel and the test-only
  `?noirStub=true`.

## Notes

- The SDK unit count dropped from 107 to 20 because the transport tests moved to core with the
  code; the old "root scripts 125" was already stale (179 today).
- `cargo test verified_sites` needs the frontend bundle first (`build.rs` F-012 guard on a stale
  `bun.lock` ↔ bundle manifest); `bun run --cwd packages/presto frontend:build` then the test.
- The noir backend exposes no `setPrestoConfig`, so core's `endpoint-changed` reason is documented
  as reserved rather than reachable.

## Gate

`bun run test` exit 0 (lint + typecheck + unit) · `cargo test verified_sites` (embedded registry
loads the new entry) · `bun run lint:actions` ✓.
