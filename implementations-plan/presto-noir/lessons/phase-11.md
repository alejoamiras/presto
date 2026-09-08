# Phase 11 — Move transport, add `PrestoClient`, re-base `PrestoProver`

Date: 2026-09-08. Branch `presto-noir/sdk-core` (arc 3).

## What landed

- `git mv` into `packages/sdk-core/src/lib/`: `presto-transport.ts` (+ test), `errors.ts`,
  `types.ts`, `legacy-wire-compatibility.test.ts`. The transport generalises `postProve` →
  `post(path, body, contentType, aztecVersion?, url?)`, `proveUrlFor` → `urlFor(protocol, path)`,
  `readProveBody` → `readJsonBody(response, cap?, timeout?)` (parsed JSON; the shape is the
  caller's). `isValidHealthBody` validates `schemes` (string array) and `versions`
  (`{aztec_version, bb_version}` pairs); `versions` joins the detailed-tier keys, `schemes` does not
  (it rides on the minimal body too, so its presence must not turn a minimal answer into
  `unconfirmed`).
- `types.ts` (minus `PrestoProverOptions`, which now lives in `presto-prover.ts`): `PrestoStatus`
  gains `schemes?` / `versions?`; new `PrestoClientOptions`, `ProveRequest`, `ProveOutcome`,
  `FallbackReason`, `PrestoVersionPair`.
- New `config.ts` (`resolvePrestoConfig`, `resolveHttpsOnly`, Worker-aware `isBrowserRuntime`),
  `base64.ts` (strict decode; native `Uint8Array.fromBase64` → `Buffer` → `atob`), `logger.ts`
  (`["presto", "core"]`).
- New `presto-client.ts`: `PrestoClient` hoists `checkStatus` (single-flight, generation),
  `#classifyHealth` (now surfacing `schemes` / `versions`), the probe-failure classification, and the
  whole prove path (endpoint snapshot, network recovery, validated HTTP retry, F14 table). `prove()`
  returns `{ kind: "native", body, durationMs } | { kind: "fallback", reason, phase? }`; the table
  gains `404 → route-missing`, and a `scheme` on the request degrades before anything is sent when
  `/health.schemes` (or its absence, meaning chonk only) lacks it — phase `version-mismatch`.
- `PrestoProver` is ~120 lines: builds the client with `aztecVersion` from the pinned
  `@aztec/stdlib`, serializes under the client's `serialize` phase, decodes with `decodeChonkProof`
  (string `proof`, strict base64, `fromBuffer`), runs WASM for every fallback and for a decode
  failure. `onPhase` is forwarded through the prover so `setOnPhase` after construction still reaches
  the client's phases. Barrel re-exports the same names from core.
- `packages/sdk/package.json`: `@alejoamiras/presto-core: workspace:*`; `ms` / `@types/ms` dropped
  (only the transport used them). `bun.lock` updated.
- Tests: core `presto-client.test.ts` (94 cases: the moved decision tables, rewritten against
  outcomes instead of a WASM spy, plus scheme gating, `responseCap`, no-version clients, the
  malformed `schemes` / `versions` rows); the transport suite now restores `fetch` after every test
  so a non-parallel `bun test` over the directory stays green; SDK `presto-prover.test.ts` is 11
  adapter-level cases (round trip with a real empty chonk proof, phase trails, decode failures,
  typed-error passthrough, `setForceLocal`, `setOnPhase`, `sdkAztecVersion`).
- `.github/scripts/packaged-e2e-swap-sdk.sh [sdk-tarball] [core-tarball]`: packs core too, builds a
  real `node_modules` for the swapped SDK (workspace entries symlinked, core extracted from its
  tarball with its own deps linked), asserts the SDK's core pin against the installed core
  (`scripts/tarball-consumer/assert-core-pin.ts`, tested), and proves core resolves to the packed
  copy. `scripts/published-playground.ts` resolves `workspace:*` to the sibling's version when
  comparing the published graph and asserts the installed core after the swap; tests extended.
- `MIGRATION.md`: core is a dependency, no API change. Core README documents `PrestoClient`.

## Notes

- `phase` on a network fallback: once HTTPS has answered at an endpoint the effective policy is
  secure-only, so a later HTTPS network failure reports `secure-connection-unavailable` (the old
  prover emitted the same phase; the moved test now asserts it).
- `readJsonBody` returning `null` for a JSON `null` body is deliberate — only unreadable bodies are
  `undefined`; adapters check shape.
- The `presto` tarball-consumer profile now needs the packed candidate core available to `npm
  install` (the SDK pins a core version that is not on the registry yet). That is phase 12's
  bootstrap mode; `sdk.yml`'s Tarball Consumer job would fail on this branch until then.
- Docs beyond MIGRATION (SDK README `PrestoStatus` fields, the packaged SKILL) are phase 19's.

## Gate

`bun run --cwd packages/sdk-core test:unit` 184 ✓ · `test:lint` ✓ · `build` ✓ ·
`bun run --cwd packages/sdk test:unit` 20 ✓ · `test:lint` ✓ · `build` ✓ ·
`bun run --cwd packages/playground typecheck` ✓ · `test:unit` 72 ✓ · `test:e2e` 13 ✓ ·
`bun run test` exit 0 · `bun run lint:actions` ✓ · swap script run locally: pin check, consumer
resolution, and packed-core resolution all reported OK.
