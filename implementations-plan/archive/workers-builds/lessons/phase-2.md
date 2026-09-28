# Phase 2 — Pin and build entry point

- **Pin starts at the live versions**: presto 5.2.0-revision.5, noir 1.2.0 — what run 36195626527
  deployed. `main`'s graph (core 1.2.0, bb.js 5.2.0) matches them, so production builds today.
- **Published path from a clean `--ignore-scripts` install passes locally** (Node 24.21 / npm 11.19):
  `WORKERS_CI_BRANCH=main bun scripts/workers-build.ts playground` printed
  `Playground uses verified published @alejoamiras/presto@5.2.0-revision.5 on
  @alejoamiras/presto-core@1.2.0 with @alejoamiras/presto-noir@1.2.0`; `_headers` in `dist/` carries
  COOP `same-origin` + COEP `require-corp`; playground `deploy --dry-run` exit 0. No lifecycle script
  is needed by either site build (I9 holds).
- **Branch builds need no package `dist/`** — confirmed with none present: Vite resolves the SDKs
  from source.
- **The published swap survives `bun install`.** After a production build, the extracted tarballs
  replace `packages/playground/node_modules/@alejoamiras/*`; a later local install can leave them in
  place. Remove that directory before building from the workspace again. Cloudflare builds start
  clean, so this is local-only.
- **`AZTEC_NODE_URL` needs no build variable.** `vite.config.ts` defaults production builds to the
  public testnet node, and the `TESTNET_AZTEC_NODE_URL` override `deploy-app` read is set neither as
  a repository nor as an environment secret (names listed 2026-09-26).
- **The bump job needs no `bun install`**: `playground-pin.ts` imports only repository modules and
  `node:*`, so no dependency code runs next to the App token.
