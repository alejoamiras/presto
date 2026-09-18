# Phase 17 — Playground Noir panel

Date: 2026-09-08. Branch `presto-noir/playground-docs` (arc 5, stacked on `presto-noir/sdk-noir`).

## What landed

- `packages/playground/src/noir.ts`: loads the committed `square` fixture through literal
  `new URL("../../../fixtures/noir/square/<file>", import.meta.url)` references (Vite emits the
  large ones as hashed assets and inlines the small ones as data URLs), one
  `PrestoUltraHonkBackend` per page seeded with the fixture key and sharing the `?httpsOnly=true`
  knob, `proveNoirFixture(mode, log, onPhase)` proving in the chosen mode (`setForceLocal` for
  in-browser) and comparing the result byte for byte with the reference (`matchesFixture`).
  `configureNoir({ fixture, api })` is the test/demo hook for the fixture and the WASM source.
- `src/noir-stub.ts`: a `Barretenberg` stand-in that answers bb.js's real `UltraHonkBackend` with
  the fixture bytes — deterministic and network-free (no CRS, no workers) while bb.js still parses
  the artifact and the witness. Used by the unit tests now and by the mocked e2e in phase 18.
- `index.html`: a "Prove Noir Circuit" action (no node or wallet needed) and a `noir-results` panel
  (in-browser vs Presto, tag "identical to fixture" / "differs from fixture") reusing `showResult`
  with the `noir-` prefix; `main.ts` wires it through the same dial and phase handling as the
  Aztec actions.
- Dependencies: the playground adds `@alejoamiras/presto-noir` (`workspace:*`) and a direct
  `@aztec/bb.js@5.2.0`; `vite.config.ts` dedupes `@aztec/bb.js` so the Aztec prover, the adapter's
  peer, and the page's import share one runtime. `app.yml` gates on `packages/sdk-noir/**` and
  `fixtures/noir/**`. `update-aztec-version.ts` bumps `packages/sdk-noir/package.json` and
  `peerDependencies` too (test); the adapter's `TESTED_BB_VERSIONS` stays a deliberate step.
- Tests (`noir.test.ts`, happy-dom): fixture loading from disk through the injectable fetch, the
  reference comparison (and two ways to differ), in-browser proving through bb.js with the stub
  (phases `proving`, `proved`; identical), Presto mode natively (mocked `/health` with `schemes`
  and `/prove/ultra-honk` asserting the wire job carries the seeded key) and the fallback when
  Presto is offline.

## Notes

- `new URL(dir, import.meta.url)` + `new URL(file, dir)` is NOT bundled by Vite ("doesn't exist
  at build time, it will remain unchanged"); only a literal per file is. The first build warned
  and would have 404'd in production.
- The Noir backend has its own `PrestoClient`; the page's HTTP-session consent configures only the
  Aztec prover (the adapter exposes no `setPrestoConfig`), so under `secure-connection-unavailable`
  the Noir action falls back to the browser. Acceptable for a demo; noted for the docs phase.

## Gate

`bun run --cwd packages/playground typecheck` ✓ · `test:unit` 75 ✓ · `build` ✓ (fixture assets
emitted) · `bun run test` exit 0 · `bun run lint:actions` ✓.
