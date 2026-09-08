# Workspace inventory — presto-noir surface (outer map)

Run `2026-09-08-presto-noir`, focus `security`, effort `high`. Scope chosen by the owner: the
surface added by the presto-noir plan (PRs #21–#25, `main` @ f331a78), not the whole repository.

| Package / area | Path | Purpose | Language |
|---|---|---|---|
| `@alejoamiras/presto-core` | `packages/sdk-core` | Transport + policy every Presto adapter shares: loopback discovery, HTTPS-first pinning, bounded readers, the prove error → fallback table, `PrestoClient` | TypeScript (Bun) |
| `@alejoamiras/presto-noir` | `packages/sdk-noir` | `PrestoUltraHonkBackend`, a drop-in for bb.js's `UltraHonkBackend`: native `generateProof` through `POST /prove/ultra-honk`, WASM fallback; peer `@aztec/bb.js@5.2.0` | TypeScript (Bun) |
| Presto app: UltraHonk route | `packages/presto/core` (`server/ultra_honk.rs`, `bb/ultra_honk.rs`, shared `server/prove.rs`, `server/auth.rs`, `bb.rs`, `versions/*`) + headless `packages/presto/server` | Accepts `{bytecode, witness, verifier_target, vk?}` from an approved origin, runs native `bb prove --scheme ultra_honk`, returns `{proof, public_inputs, vk?}`; `/health.schemes`/`versions` | Rust (axum, tokio) |
| Playground Noir panel | `packages/playground` (`src/noir.ts`, `src/noir-stub.ts`, `src/main.ts`, `vite.config.ts`, e2e) | Proves the committed `square` fixture in-browser (bb.js WASM) or natively through Presto | TypeScript (Vite) |
| Release path | `scripts/*.ts`, `scripts/tarball-consumer/*`, `.github/workflows/{release-sdk,_publish-npm,_ts-package-ci,sdk-noir,sdk-core}.yml`, `.github/scripts/packaged-e2e-swap-sdk.sh`, `.github/actions/start-headless-presto` | Publishes the three npm packages with OIDC trusted publishing and provenance; pre-merge tarball-consumer gates; identity + live presto gates for the adapter | TypeScript, Bash, YAML |
| Fixtures | `fixtures/noir/{square,nopub}`, `scripts/noir-fixture.ts` | Committed bb.js WASM references (artifact, witness, vk, proof, public inputs, manifest) that every layer checks byte identity against | Noir/JSON/binary |

Dependency direction: `presto-noir` → `presto-core`; `presto` (SDK) → `presto-core`; playground →
`presto`, `presto-noir`, `@aztec/bb.js`; release scripts → `npm-packages.ts` descriptor. The Rust
app depends on none of the TS packages; the TS packages depend on the app's wire contract.

Out of scope (owner decision): the desktop app beyond the route and its shared admission (trust
module, updater, tray, onboarding), `packages/presto` chonk `/prove` except where shared code is
reached from the UltraHonk route, `packages/landing`, `packages/banners`, `packages/release-feed`.
Excluded from finding-eligibility unless production-wired: `node_modules`, `dist`, `target`,
`test-results`, generated `packages/presto/src-tauri/gen`, and test/e2e code.

Per-package maps: `sdk-core.md`, `sdk-noir.md`, `route-ultra-honk.md`, `playground-and-release.md`.
