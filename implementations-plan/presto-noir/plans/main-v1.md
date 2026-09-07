---
plan: presto-noir
tier: deep
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 3 agents (2 sweeps + 1 mapper); foreign reviewer codex/GPT-6 Astra at high; fable leg on Fable 5.1
status: DRAFT v1 (main-agent plan; codex + fable plans pending consolidation)
base: origin/main @ ae1cb9c
worktree: .claude/worktrees/presto-noir (branch worktree-presto-noir)
---

# presto-noir — generic UltraHonk (Noir circuit) proving through Presto

## Summary

Presto proves Aztec transactions natively (`bb --scheme chonk`) for a browser SDK. This plan adds a second bb scheme so any Noir circuit can be proven natively through the same app: a `POST /prove/ultra-honk` route riding every existing guard, a transport-only npm package `@alejoamiras/presto-core`, a drop-in `@alejoamiras/presto-noir` adapter with bb.js's `UltraHonkBackend` surface and WASM fallback, release CI for the new packages, a playground Noir section, and the tests that prove native and WASM proofs are byte-identical. First consumer: the yacana miner (out of scope here; its `WorkProver` seam is ready).

## Phase 0 answers (locked)

| Question | Answer |
|---|---|
| Tier | `deep` |
| TS package shape | core + 2 adapters (`presto-core`, `presto` on core, `presto-noir`) |
| App discriminator | new route `/prove/ultra-honk`; chonk `/prove` untouched |
| Version negotiation | keep `x-aztec-version`; expose bb mapping in `/health` (see D-06: identity mapping) |
| Validation layers | fast layers always; headless real-bb integration; playground mocked e2e; WebDriver 3-OS; byte-identity |
| `code_review` | off |
| `/harden security` | decide at the approval gate |
| Scope in | route + Rust; core extraction; presto-noir; PR-gate + release CI; app release story; tests; playground Noir section; docs |
| Scope out (follow-ups) | tray per-origin cumulative prove time + one-click revoke; per-proof overhead measurement / persistent bb |
| Quality bar | production |

---

## Architecture & Implementation

### Components

```
browser dApp / miner                       Presto app (Tauri) or presto-server (headless)
┌──────────────────────────────┐           ┌──────────────────────────────────────────┐
│ @alejoamiras/presto-noir     │  JSON     │ axum router (presto-core crate)          │
│  PrestoUltraHonkBackend ─────┼──────────▶│  /prove            → chonk handler       │
│   ├─ presto-core transport   │ /prove/   │  /prove/ultra-honk → ultra_honk handler  │
│   └─ @aztec/bb.js (peer)     │ ultra-honk│  /health           → + "schemes"         │
│      UltraHonkBackend (WASM) │           │  shared: origin auth, host guard, caps,  │
└──────────────────────────────┘           │  version resolve, lease, permit, status  │
                                           │  bb::prove_ultra_honk → bb binary        │
@alejoamiras/presto (Aztec chonk adapter)  └──────────────────────────────────────────┘
  └─ presto-core transport (unchanged behaviour)
```

Rust: one new module `packages/presto/core/src/server/ultra_honk.rs` (handler + request types) and one new function family in `bb.rs` (`prove_ultra_honk`). The guard sequence currently inlined in `prove()` becomes a shared template both handlers call (D-01). Headless and Tauri binaries pick the route up for free (they compose the same router, `server.rs:346-379`).

TS: `packages/presto-core` (transport, health classification, errors, wire types; zero `@aztec/*`), `packages/sdk` (unchanged public surface, now imports core), `packages/presto-noir` (adapter). Root-level `fixtures/noir/<circuit>/` holds the committed Noir fixture shared by Rust smoke, presto-noir tests, and the playground.

### Wire contract: `POST /prove/ultra-honk`

Request (`content-type: application/json`; body under the existing 50 MB cap and 30 s read deadline):

```json
{
  "bytecode": "<the compiled artifact's `bytecode` string verbatim (base64 of gzipped ACIR)>",
  "witness": "<base64 of the gzipped witness exactly as noir_js `execute` returns it>",
  "vk": "<base64 of the verification key>",            // optional
  "verifier_target": "noir-recursive-no-zk"            // required; one of bb's 8 targets
}
```

Headers: `x-aztec-version` (optional, same semantics as `/prove`: exact Aztec release == `@aztec/bb.js` version; absent → bundled bb).

Server-side validation at ingress, in this order and before any lease/permit: JSON shape (`serde_json::from_slice`, unknown fields rejected), `verifier_target` parsed into a `VerifierTarget` enum, base64 decode of each field (standard alphabet, padding required), per-field decoded caps (bytecode ≤ 16 MiB, witness ≤ 32 MiB, vk ≤ 64 KiB), gzip magic + ISIZE trailer sanity (≤ 1 GiB) on bytecode and witness. Failures map to new `ProveError` variants (`invalid_request` 400, `invalid_verifier_target` 400, `payload_too_large` 413 reused) with the existing `text/plain` JSON-string body.

bb invocation (in the private prove tempdir, files written 0600 via `write_witness`):

```
bb prove --scheme ultra_honk -b bytecode.gz -w witness.gz -t <target> -o out/ [-k vk] | [--write_vk]
```

`-k` when the client supplied a VK (`--vk_policy` left at `default`: a wrong VK breaks only that client's proof, verified fail-closed for malformed VKs); `--write_vk` otherwise, which is the only VK-less invocation bb 5.2.0 accepts (Facts F-03/F-04). Outputs read with `read_capped` (`proof`, `public_inputs`, and `vk` on the `--write_vk` path), validated 32-byte aligned via `validate_proof_len`, never routed through `bb::prove` (which prepends the chonk field-count header).

Response (`application/json`, plus `x-prove-duration-ms` exactly as `/prove`):

```json
{ "proof": "<base64>", "public_inputs": "<base64>", "vk": "<base64, only when the server computed it>" }
```

### `/health` addition (detailed body only)

```json
"schemes": ["chonk", "ultra_honk"]
```

`api_version` stays `1` (D-05) and gains a named Rust constant used at `server.rs:418,436` and `probe.rs:53`. No `versions` mapping array (D-06).

### `@alejoamiras/presto-core` surface

```ts
export class PrestoTransport { /* moved verbatim from packages/sdk/src/lib/presto-transport.ts */
  postProve(body: Uint8Array, aztecVersion?: string, url?: string): Promise<Response>;        // unchanged
  post(path: "/prove" | "/prove/ultra-honk", body: BodyInit, opts: { contentType: string; aztecVersion?: string; url?: string }): Promise<Response>; // new, postProve delegates
}
export function classifyHealth(body: unknown, opts: { expectedVersion?: string }): PrestoStatus; // extracted from PrestoProver#classifyHealth, pure
export class PrestoHttpError; export function parseServerError;                                  // moved
export type { PrestoConfig, PrestoProtocol, PrestoStatus, SecureConnectionDiagnosis, PrestoPhase, PrestoPhaseData, PrestoStatusCheckOptions };
export const PRESTO_API_VERSION = 1;
export const PRESTO_SCHEME_ULTRA_HONK = "ultra_honk";
```

`PrestoStatus` gains `schemes?: readonly string[]`. `PrestoProverOptions` (carries `simulator: CircuitSimulator`) stays in `packages/sdk` — it is the Aztec adapter's type. `@alejoamiras/presto` re-exports everything it exports today from core, so its public surface and `public-contract.test.ts` stay green.

### `@alejoamiras/presto-noir` surface

```ts
import type { Barretenberg, UltraHonkBackendOptions, ProofData, VerifierTarget } from "@aztec/bb.js"; // peer

export interface PrestoUltraHonkOptions {
  presto?: PrestoConfig;                 // ports/host/httpsOnly, same as the Aztec adapter
  bbVersion?: string;                    // your @aztec/bb.js version; sent as x-aztec-version; absent → bundled bb
  vk?: Uint8Array;                       // committed VK → `-k`, skips server VK recompute (0.26 s on W)
  onPhase?: (phase: PrestoPhase, data?: PrestoPhaseData) => void;
  forceLocal?: boolean;
}

export class PrestoUltraHonkBackend {
  /** Drop-in for `new UltraHonkBackend(bytecode, api)`. `api` may be a lazy factory so WASM (and its CRS download) loads only on fallback. */
  constructor(acirBytecode: string, api: Barretenberg | (() => Promise<Barretenberg>), options?: PrestoUltraHonkOptions);
  generateProof(compressedWitness: Uint8Array, options?: UltraHonkBackendOptions): Promise<ProofData>;   // native or WASM
  verifyProof(proofData: ProofData, options?: UltraHonkBackendOptions): Promise<boolean>;                // WASM (v1)
  getVerificationKey(options?: UltraHonkBackendOptions): Promise<Uint8Array>;                            // cached native vk if a prove returned one, else WASM (v1)
  checkPrestoStatus(opts?: PrestoStatusCheckOptions): Promise<PrestoStatus>;
  destroy(): Promise<void>;
}
```

`generateProof` decision table (mirrors `PrestoProver` so both adapters behave alike):

| Health / response | Action |
|---|---|
| presto unreachable, `api_version` ≠ 1, HTTPS policy blocks | WASM, phase `fallback` |
| detailed health, `schemes` absent or without `ultra_honk` (older app) | WASM, phase `version-mismatch` |
| minimal health (origin not yet approved → no `schemes`) | attempt native; the request triggers the approval popup |
| `404` from `/prove/ultra-honk` | WASM; mark unsupported for this health generation |
| `403` / `408` / `413` / `429` / `503`, `500 prove_failed|download_failed` | WASM (same table as the Aztec adapter) |
| `400`, unrecognised `500`, unexpected status | throw `PrestoHttpError` (misconfiguration must not hide behind "slow but working") |
| `200` | `{ proof: bytes, publicInputs: chunk32(public_inputs).map("0x"+hex) }` — identical shape to bb.js |

`verifyProof` and `getVerificationKey` stay WASM in v1 (Ask A-01 offers native `write_vk`/`verify` routes as a follow-up). The response `vk` is cached in the instance so `getVerificationKey()` after a native prove is free.

### Data & control flow (critical path, miner-shaped)

1. Page: `noir.execute(inputs)` → `witness` (gz). `backend.generateProof(witness, { verifierTarget })`.
2. presto-noir: `transport.configure()`/probe (cached per generation) → classify (`schemes`) → base64 witness, reuse artifact bytecode string, optional vk → `POST /prove/ultra-honk` with `x-aztec-version` if `bbVersion` set.
3. Server: `authorize_origin` → inflight slot → declared-size reject → `read_body` → parse + decode + caps → status `Proving` → `resolve_version` (download if needed) → `compute_threads` → lease → single prove permit → `bb::prove_ultra_honk` (tempdir, files, spawn under containment, 300 s timeout, capped stderr) → read `proof`/`public_inputs`(/`vk`) → JSON + `x-prove-duration-ms` → status `Idle`.
4. presto-noir: decode, chunk public inputs, phase `proved` with duration, return `ProofData`.

### File-level change map (cross-checked with recon.md)

| Area | Add | Modify | Notes |
|---|---|---|---|
| Rust core | `core/src/server/ultra_honk.rs` (handler, `UltraHonkRequest`, `VerifierTarget`, caps, gzip sanity), `bb::prove_ultra_honk` + `prove_ultra_honk_with_timeout` in `bb.rs`, `UltraHonkOutput {proof, public_inputs, vk: Option}` | `server/prove.rs` (extract guard template, D-01), `server.rs` (route mount, `API_VERSION` const, `schemes`, `ProveError` variants), `server/probe.rs` (use const), `server/tests.rs` (+ route tests, fake bb writes `proof`/`public_inputs`/`vk`) | reuse: `authorize_origin`, `try_enter`, `reject_declared_oversize`, `read_body`, `resolve_version`, `compute_threads`, lease, permit, `StatusGuard`, `find_bb`, `create_prove_tempdir`, `write_witness`, `containment`, `read_capped`, `validate_proof_len` |
| Fixture | `fixtures/noir/square/{Nargo.toml, src/main.nr, Prover.toml, circuit.json, witness.gz, vk, proof, public_inputs, manifest.json}`, `scripts/noir-fixture.ts` (regenerate; needs aztec-nargo + bb locally), `scripts/noir-fixture.test.ts` | `bunfig.toml` excludes (+`@aztec/noir-noir_js`) | manifest pins sha256 of every artifact + bb version used |
| Headless smoke | `packages/presto/scripts/ultra-honk-smoke.ts` (+ `.test.ts`): POST fixture, compare `proof` to fixture, `bb verify` | `.github/workflows/presto.yml` `smoke` (run-prebuild on, call the script), `.github/filters/presto.yml` (+ `fixtures/noir/**`) | copy-bb on Linux is a node_modules copy, cheap |
| WebDriver | `packages/presto/e2e-webdriver/ultra-honk.spec.ts` | — | reuse `waitForNewWindow`, `waitForActivePopup`, `clickBy`; asserts 200 + proof bytes |
| presto-core | `packages/presto-core/{package.json, tsconfig.json, README.md, src/index.ts, src/lib/presto-transport.ts, errors.ts, types.ts, classify-health.ts, *.test.ts}`, `.github/workflows/presto-core.yml` | root `package.json` (workspaces, test chains), `packages/sdk/*` (imports, `types.ts` shrinks to `PrestoProverOptions`), `sdk.yml` paths (+ `packages/presto-core/**`) | move, don't rewrite: `git mv` keeps history |
| presto-noir | `packages/presto-noir/{package.json (peer @aztec/bb.js), src/index.ts, src/lib/presto-ultra-honk-backend.ts, proof-data.ts, *.test.ts, README.md}`, `.github/workflows/presto-noir.yml`, `scripts/presto-noir-tarball-consumer.sh` | root chains, `bunfig.toml` if needed | tests: mock fetch + spy on real `UltraHonkBackend` (pattern from `presto-prover.test.ts:23-54`) |
| Release CI | `.github/workflows/_publish-npm.yml` (inputs: `package_dir`, `package_name`, `version_mode`), `scripts/npm-package-release-contract.test.ts` | `release-sdk.yml` (input `packages`: presto / presto-core / presto-noir / all-in-order), `scripts/{get-sdk-publish-version, sdk-release-verification, verify-sdk-package-signatures, promote-sdk-latest, prepare-sdk-publish}.ts` (package parameter; `workspace:*` rewrite), `docs/RELEASE_RUNBOOK.md` | trusted publisher must be configured on npmjs.com for each new name (owner action) |
| Playground | `packages/playground/src/noir.ts` (+ test), section in `index.html`, `e2e/noir.mocked.spec.ts` | `main.ts`, `spark-orbit.ts`/`phase-queue.ts` (`AnimationPhase` + `noir:*`), `package.json` (+ `@alejoamiras/presto-noir` workspace, `@aztec/noir-noir_js`), `vite.config.ts` (`resolve.dedupe` `@aztec/bb.js`) | one bb.js copy only (recon collision 6) |
| Docs | `packages/presto-core/README.md`, `packages/presto-noir/README.md` | root `README.md` (Packages table, "For Noir circuits"), `packages/presto/README.md` (route contract, `/health` example, compat matrix), `packages/sdk/README.md` + `MIGRATION.md` (core dependency note), `CLAUDE.md`, `packages/presto/VERIFIED_SITES.md` (yacana entry process), `docs/RELEASE_RUNBOOK.md` | |

### Non-obvious mechanics

- **Guard template (D-01).** `prove.rs` gets `async fn run_guarded<P, T>(state, request, prepare: FnOnce(&Bytes) -> Result<P, ProveError>, run: FnOnce(P, Option<&AztecVersion>, Option<usize>) -> Future<Output = Result<T, ProveError>>) -> Result<(T, Duration), ProveError>` holding `_inflight`, `_guard`, `_version_lease`, `_permit` in the same order as today. `prepare` runs after `read_body` and before status/lease/permit, so a malformed UltraHonk body is rejected without touching the prover; the chonk `prepare` is identity. The existing characterization tests (`prove_success_path_and_status_sequence`, `body_read_does_not_hold_the_prove_permit`, 429 shedding) pin the order and pass unchanged.
- **VK-less proving** uses `--write_vk`, not `--vk_policy recompute` (which still demands a file). The returned `vk` lets a client cache and send `-k` next time; the miner ships its committed VK from day one.
- **Byte identity is transitive.** The fixture's `proof` is generated by bb.js WASM at fixture-regeneration time (recorded in `manifest.json`). The headless lane asserts native == fixture; the presto-noir lane asserts WASM (bb.js in Bun) == fixture. No lane needs both provers.
- **gzip ISIZE is a sanity check, not a boundary.** The trailer is attacker-writable; the real bound is bb's own process (containment, 300 s timeout, kill tree, single permit), exactly as for chonk's gz-inside-msgpack today.
- **`workspace:*` at publish time.** `npm pack` does not rewrite `workspace:*`; `prepare-sdk-publish.ts` gains the rewrite to the exact published core version, and `release-sdk.yml` orders publishes core → presto → presto-noir when several are selected.

### Trade-offs & alternatives not taken

| Fork | Chosen | Rejected | Why |
|---|---|---|---|
| Guard sharing | closure template in `prove.rs` | copy the 150 lines; enum-parameterized handler | duplication drifts on the next security fix; an enum handler makes chonk's hot path branch on scheme and complicates the request-shape difference |
| VK | optional; `-k` or `--write_vk` | required; server VK cache by bytecode hash | required blocks generic dApps that don't ship a VK; a server cache is stateful disk + eviction for a 0.26 s gain the client can get by caching the returned vk |
| Request encoding | JSON + base64 | multipart; msgpack; octet-stream with layout header | payload for W is ~0.5 MB against a 50 MB cap; JSON is inspectable and needs no new Rust dep; msgpack would need a new dep and a schema anyway |
| Response | JSON + base64 (+ `x-prove-duration-ms`) | binary concatenation | symmetry with `/prove`, and the adapter must split public inputs into fields anyway |
| Feature detection | `api_version` 1 + `schemes` | bump to 2 | a bump strands every installed Aztec SDK on WASM until a lockstep SDK release; additive keys are safe across all four validators |
| bb mapping in `/health` | none; document identity; adapter `bbVersion` | `versions: [{aztec, bb}]` array | today both strings are equal by construction; a build-id field (`bb --version`) is future work if versions ever diverge |
| bb.js | peer dep (`>=5.2.0 <6`, Ask A-02) | exact dep like the SDK's F13 | presto-noir's user already has bb.js and a `Barretenberg` api; a second copy doubles WASM and breaks `instanceof`/worker resolution; the byte-identity test pins 5.2.0 as the tested pair |
| Fallback api | `Barretenberg | () => Promise<Barretenberg>` | always eager; construct internally with `Barretenberg.new` | lazy avoids 20 s of WASM+CRS init when Presto is available; eager is what plain bb.js users already have |
| `verifyProof`/`getVerificationKey` | WASM in v1 | two more routes now | the miner needs neither; keeps arc 1 small (Ask A-01) |
| Fixture | commit source + artifacts + manifest; regenerate locally | generate in CI with nargo | CI has no nargo; committed artifacts make every lane deterministic |
| Publish tooling | parameterize scripts + one `_publish-npm.yml` | clone per package | three copies of ~130-line scripts is the rot the code-organization rule forbids |
| Real-bb test | extend `smoke` with prebuild + bun script | new job; Rust `#[ignore]` test | `smoke` already builds and launches the server; copy-bb on Linux is cheap |

---

## Phases

Fast layers on every gate: `bun run lint`, `bun run test` (typecheck chain + unit chain), and for Rust phases `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` in `packages/presto/core` and `packages/presto/src-tauri`. Windows-gated Rust also runs `cargo check --target x86_64-pc-windows-gnu --lib` from `src-tauri`.

### Phase 1 — Noir fixture circuit and regeneration script

Commit `fixtures/noir/square/`: a small circuit (a few hundred gates, 2 public inputs, e.g. `assert(x*x == y)` plus a Poseidon2 hash to make it non-trivial), Noir source + `Nargo.toml`, `Prover.toml`, compiled `circuit.json` (aztec-nargo 5.2.0), `witness.gz`, `vk` (`bb write_vk -t noir-recursive-no-zk`), `proof` + `public_inputs` produced by **bb.js WASM** (Bun), and `manifest.json` (bb/bb.js version, verifier target, sha256 per file, field counts). `scripts/noir-fixture.ts` regenerates all of it (local only; requires `aztec-nargo` + bb) and `scripts/noir-fixture.test.ts` checks the manifest against the files. Add `@aztec/noir-noir_js` to `bunfig.toml` excludes.

Validation gate — `bun run test:scripts && bun run typecheck:scripts && bun run lint`; pass: manifest test green, sizes match field counts (proof % 32 == 0). Layers: lint/typecheck, unit.

### Phase 2 — `VerifierTarget`, request model, `bb::prove_ultra_honk`

Pure Rust: `VerifierTarget` (8 variants, `FromStr`, `as_flag`), `UltraHonkRequest` deserialization + decoding + caps + gzip sanity as pure functions; `bb::prove_ultra_honk_with_timeout` mirroring `prove_with_timeout` (files, args, containment, dual/triple output read, no header). Tests with the fake-bb shell script: exact argv for `-k` vs `--write_vk`, files written 0600, outputs read, missing `public_inputs` → error, oversize output → error, timeout path.

Validation gate — `cd packages/presto/core && cargo fmt --check && cargo clippy -- -D warnings && cargo test`; pass: new tests green, existing tests untouched. Layers: lint, unit.

### Phase 3 — Guard template, route, `/health` schemes

Refactor `prove()` onto `run_guarded` (behaviour-preserving; the characterization tests pass unchanged), add `ultra_honk::prove_ultra_honk`, mount `/prove/ultra-honk`, add `ProveError::{InvalidRequest, InvalidVerifierTarget}` with the `text/plain` wire shape (extend `prove_error_responses_stay_text_plain_json_string`), introduce `API_VERSION` const (server + probe), add `schemes` to the detailed health body. Router-level tests: success path returns proof/public_inputs (+vk on the write_vk path), status sequence `Proving→Idle`, 400s for bad JSON/target/base64/oversize field, 413 on declared oversize, 429 shedding, unapproved origin denied before body read, minimal health has no `schemes`, `x-prove-duration-ms` present.

Validation gate — core + src-tauri `cargo fmt --check && cargo clippy -- -D warnings && cargo test`; `cargo check --target x86_64-pc-windows-gnu --lib` in `src-tauri`; `bun run --cwd packages/presto test:unit`; pass: all green. Layers: lint, unit, integration (router with fake bb).

### Phase 4 — Headless real-bb integration in CI

`packages/presto/scripts/ultra-honk-smoke.ts` (+ unit test of its pure parts): POST the fixture to a running `presto-server` (`--allow-all`), assert 200, `proof` == fixture proof, `public_inputs` == fixture, run `bb verify` with the sidecar bb, assert the `--write_vk` path returns the fixture `vk`. Extend `presto.yml` `smoke`: `run-prebuild: "true"` (Linux copy-bb), keep `install-tauri-system-deps: "false"`, call the script; add `fixtures/noir/**` and the script to `.github/filters/presto.yml` (`headless_server`, `desktop_runtime`).

Validation gate — `bun run lint:actions && bun run --cwd packages/presto test:unit`; locally: build `presto-server`, run it with `--allow-all`, run the smoke script against it with `BB_BINARY_PATH` set → exit 0; then `gh run` of `presto.yml` `smoke` green on the branch (workflow_dispatch). Layers: lint, unit, integration with the real bb.

### Phase 5 — WebDriver desktop e2e for the route

`ultra-honk.spec.ts`: from the test page, POST the fixture to `/prove/ultra-honk`, approve the origin via the existing popup helpers, assert 200 + proof equality; a second case asserts a bad `verifier_target` yields 400 without a popup re-prompt.

Validation gate — `bun run --cwd packages/presto test:e2e:webdriver` locally on Linux; `presto.yml` `e2e-webdriver` matrix (macOS/Linux/Windows) green via workflow_dispatch. Layers: e2e (real app, real bb).

**Arc 1 boundary** (codex fix loop, then `gh stack add`).

### Phase 6 — `@alejoamiras/presto-core`

`git mv` transport/errors/types into `packages/presto-core`; extract `classifyHealth` as a pure function (+ `schemes`); `post()` generalization; package.json (`exports: ./src/index.ts`, `files`, `publishConfig`, `prepublishOnly`), tsconfig, README, tests moved (`presto-transport.test.ts`, `legacy-wire-compatibility.test.ts`, new `classify-health.test.ts`). Wire the workspace: root `workspaces`, `test:unit`/`test:typecheck` chains, `sdk.yml` and new `presto-core.yml` PR gate (changes → lint/typecheck/unit/tarball-consumer → status; SHA-pinned actions).

Validation gate — `bun run test && bun run --cwd packages/presto-core test:unit && bun run --cwd packages/presto-core build && bun run lint:actions`; pass: green, `scripts/action-pins.test.ts` green. Layers: lint/typecheck, unit.

### Phase 7 — `@alejoamiras/presto` on core

SDK imports from `@alejoamiras/presto-core` (`workspace:*`), `types.ts` keeps only `PrestoProverOptions`, `index.ts` re-exports unchanged names; `prepare-sdk-publish.ts` rewrites `workspace:*` to the exact core version; `sdk-tarball-consumer.sh` consumes a locally packed core tarball alongside; `public-contract.test.ts` green; `MIGRATION.md` note.

Validation gate — `bun run test && bun run --cwd packages/sdk build && bash scripts/sdk-tarball-consumer.sh <packed tarball>`; pass: green, consumer typechecks. Layers: lint/typecheck, unit, packaged-artifact integration.

**Arc 2 boundary.**

### Phase 8 — `@alejoamiras/presto-noir` adapter

Package skeleton with `@aztec/bb.js` peer + dev dep 5.2.0, `PrestoUltraHonkBackend` per the surface above, `proof-data.ts` (bytes ↔ `ProofData`), phases, the decision table, 404-sticky per generation, `bbVersion` header. Unit tests: mocked `fetch` route table; spy on the real `UltraHonkBackend` methods to prove fallback engaged/not engaged; every row of the decision table; `ProofData` conversion against the fixture's `proof`/`public_inputs`.

Validation gate — `bun run --cwd packages/presto-noir test:unit && bun run --cwd packages/presto-noir test:lint && bun run test`; pass: green. Layers: lint/typecheck, unit.

### Phase 9 — Byte-identity (WASM leg) and presto-noir PR gate

`packages/presto-noir/src/lib/byte-identity.test.ts`: prove the fixture witness with the real bb.js `UltraHonkBackend` in Bun (threads on) and assert bytes equal the fixture `proof` and `publicInputs` equal the chunked fixture; also run the same witness through `PrestoUltraHonkBackend` against a `Bun.serve` stub replaying the fixture and assert both `ProofData`s are deep-equal. `presto-noir.yml` PR gate (+ `scripts/presto-noir-tarball-consumer.sh` asserting peer semantics: peer satisfied → loads; missing → clear error).

Validation gate — `bun run --cwd packages/presto-noir test:unit` (byte-identity included), `bun run lint:actions`, `presto-noir.yml` green on the branch. Layers: unit, integration (WASM), packaged-artifact.

**Arc 3 boundary.**

### Phase 10 — Release/publish CI for three packages

`_publish-npm.yml` (reusable, `environment: npm-publish`, `id-token: write`, inputs `package_dir`, `package_name`, `version_mode: aztec-pin | package-json`, `dist_tag`); `release-sdk.yml` gains `packages` choice (`presto` | `presto-core` | `presto-noir` | `all-in-order`) and sequences core → presto → presto-noir; scripts take `--package`; `promote-sdk-latest.ts --package`; contract test parameterized over the three packages; `RELEASE_RUNBOOK.md` sections; a checklist for the owner to register `@alejoamiras/presto-core` and `@alejoamiras/presto-noir` as trusted-publisher packages on npmjs.com (no token).

Validation gate — `bun run test:scripts && bun run typecheck:scripts && bun run lint:actions`; `release-sdk.yml` dry-run path (`workflow_dispatch` with a `dry_run` input added in this phase) green. Layers: lint, unit, CI dry-run.

**Arc 4 boundary.**

### Phase 11 — Playground Noir section

`packages/playground/src/noir.ts`: load the fixture artifact, execute with `@aztec/noir-noir_js` (client-side witness), prove via `PrestoUltraHonkBackend` (WASM vs Presto per the existing mode toggle), show timings and a "proofs identical" check against the fixture; `AnimationPhase` extended with `noir:*` steps; `index.html` section; `vite.config.ts` `resolve.dedupe` for `@aztec/bb.js`; `e2e/noir.mocked.spec.ts` intercepting `/health` (with `schemes`) and `/prove/ultra-honk` (replaying the fixture), plus an offline-Presto case asserting the WASM path and no page errors.

Validation gate — `bun run --cwd packages/playground typecheck && test:unit && test:e2e` (mocked project); pass: green. Layers: lint/typecheck, unit, e2e (mocked).

### Phase 12 — Docs and compat matrix

README (Packages table, "For Noir circuits" quick start), `packages/presto-noir/README.md` (install, drop-in example, options, fallback semantics, compat matrix), `packages/presto-core/README.md`, `packages/presto/README.md` (route contract, health `schemes`, security note that the route rides the same trust boundary as `/prove`), `packages/sdk/README.md` + `MIGRATION.md`, `CLAUDE.md` current-state bullets, `VERIFIED_SITES.md` (entry process for the yacana domain: PR adding the origin with `curatedBy`/`addedAt`), `RELEASE_RUNBOOK.md`.

Validation gate — `bun run test` (doc-sync contract tests in sdk/core/noir green) + `bun run lint`. Layers: lint, unit.

**Arc 5 boundary**, then the cross-arc pass and Delivery.

---

## Delivery

Multi-arc, stacked PRs via `gh stack` (installed: `github/gh-stack` v0.1.0). `code_review: off` for every arc.

| Arc | Branch | Phases | Stacks on | Ships alone? |
|---|---|---|---|---|
| 1 `noir-route` | `worktree-presto-noir` (adopted as layer 1) | 1–5 | main | yes — app release (`release-presto.yml`) can go out with the route before any npm package |
| 2 `presto-core` | `presto-noir/core` | 6–7 | arc 1 (fixture reuse only) | yes — no public surface change for `@alejoamiras/presto` |
| 3 `presto-noir-adapter` | `presto-noir/adapter` | 8–9 | arc 2 | yes (WASM-only until an app with the route is installed) |
| 4 `npm-release-ci` | `presto-noir/release-ci` | 10 | arc 3 | yes |
| 5 `playground-docs` | `presto-noir/playground-docs` | 11–12 | arc 4 | yes |

`gh stack init --adopt worktree-presto-noir` at the start of arc 1; `gh stack add <branch>` at each boundary after that arc's codex loop converged; `gh stack submit --auto` only in the Delivery step; `gh stack merge` is the owner's call.

App release story: the route ships in the next Presto minor (Ask A-03 for the number). Compat matrix:

| SDK \ App | app without the route (`schemes` absent) | app with the route |
|---|---|---|
| `@alejoamiras/presto` (Aztec, any) | native chonk (unchanged) | native chonk (unchanged) |
| `@alejoamiras/presto-noir` | WASM fallback (phase `version-mismatch`; `404` sticky if health was minimal) | native `ultra_honk` |
| `@alejoamiras/presto-core` | `api_version` 1 recognised | `api_version` 1 recognised, `schemes` surfaced |

---

## Security & Adversarial Considerations

**Threat model.** (1) A malicious *approved* origin: already controls bytes bb parses via `/prove` (msgpack ACIR + witnesses handed straight to bb, `prove.rs:348`); the new route is the same class. It can burn CPU for hours (mining is the first such workload). (2) An *unapproved* origin: rejected by `authorize_origin` before the body is read; `/health` minimal body leaks nothing new (`schemes` is detailed-only). (3) DNS rebinding: the loopback Host guard applies router-wide. (4) Supply chain: three published packages, one new `@aztec/*` dev dependency, new workflows. (5) CI: new jobs must not gain write scopes.

**Ingress validation.** JSON with `deny_unknown_fields`; `verifier_target` typed enum (never interpolated into argv from a string); base64 strict decode; per-field decoded caps; gzip magic + ISIZE sanity; the 50 MB body cap and 30 s read deadline and inflight cap precede all of it. A client-supplied VK under `--vk_policy default` affects only that client's proof; malformed VKs and bytecode fail closed in bb (verified). Nothing from bb's stderr or the tempdir path reaches the client.

**Process isolation.** bb runs under the existing containment (own process group/Job Object, kill tree on timeout or client disconnect, 300 s cap, capped stderr, single prove permit) — the actual boundary against decompression bombs and pathological circuits. The speed setting caps threads via `HARDWARE_CONCURRENCY`.

**Sustained-CPU abuse (mining).** In scope now: the single permit is FIFO, so another site's tx proof waits at most one proof (~1 s for W); the tray shows the working state; revocation exists in Settings today. Deferred to the follow-up plan: per-origin cumulative time and one-click revoke in the tray. The plan does not add rate limiting per origin (Ask A-04 if the owner wants a cheap per-origin proofs-per-minute cap now).

**Least privilege.** New workflows default `permissions: contents: read`; `id-token: write` only inside `_publish-npm.yml`'s publish job in the `npm-publish` environment; no `NPM_TOKEN` anywhere (contract test asserts it); PR caches restore-only as today.

**Supply chain.** `bun.lock` committed, `--frozen-lockfile` in CI, 7-day `minimumReleaseAge` with `@aztec/*` excludes kept in parity (`@aztec/noir-noir_js` added), trusted publisher + `--provenance` for all three packages, provenance and signature verification after publish (`sdk-release-verification.ts`, `verify-sdk-package-signatures.ts` parameterized), SHA-pinned actions (`action-pins.test.ts` covers new files automatically). Peer dependency on `@aztec/bb.js`: the consumer chooses the bb.js copy; the tested pair (5.2.0) is documented and the byte-identity test pins it.

**Frontend.** The playground executes the fixture circuit only; no user-supplied ACIR is uploaded; no `innerHTML` from server data; COOP/COEP unchanged.

**Cryptography.** None new: Barretenberg (bb 5.2.0 native, bb.js 5.2.0 WASM) does all proving/verification.

---

## Assumptions

### Facts (verified)

- F-01 `/prove` hands the raw body to bb: `packages/presto/core/src/server/prove.rs:348` (`bb::prove(&body, …)`); guards at `prove.rs:224-345`.
- F-02 Router and layers: `packages/presto/core/src/server.rs:346-379`; headless composes it at `packages/presto/server/src/main.rs:94-110`.
- F-03 bb 5.2.0 `prove --scheme ultra_honk` fails without `-k` (`./target/vk`), also with `--vk_policy recompute`; `--write_vk` without `-k` succeeds and writes `vk` + `vk_hash` (main agent, this box, 2026-09-07).
- F-04 Timings on yacana W, 12 threads: `-k` 1.22 s, `--write_vk` 1.48 s, `write_vk` 0.52 s, `verify` 7 ms; proof sha256 `57799830…` equals yacana's WASM-produced fixture; identical with 4 threads and from raw gz bytecode.
- F-05 Corrupted/random VK and random bytecode make bb exit 1 with no output files.
- F-06 bb.js 5.2.0 `UltraHonkBackend(acirBytecode: string, api: Barretenberg)`, `generateProof → {proof: Uint8Array, publicInputs: "0x"+64-hex[]}` (`node_modules/.bun/@aztec+bb.js@5.2.0/.../barretenberg/backend.{d.ts,js}`, `proof/index.js:39-48`).
- F-07 `api_version` literal `1` at `server.rs:418,436`, `server/probe.rs:51-54`; SDK `PRESTO_API_VERSION` (`packages/sdk/src/lib/types.ts:13`) checked by equality in `presto-transport.ts:265-269`; validators tolerate unknown keys (`presto-transport.ts:288-321`, `packages/landing/src/presto-detection.ts:156-197`).
- F-08 Aztec version == `@aztec/bb.js` npm version == bb release tag: `packages/presto/scripts/copy-bb.ts:228-235`, `core/src/versions/version_policy.rs:240-249`; nothing runs `bb --version` (`version_policy.rs:292-294`).
- F-09 `presto-transport.ts` has zero `@aztec/*` imports; `types.ts:1` imports `CircuitSimulator` only for `PrestoProverOptions`.
- F-10 No `peerDependencies` anywhere in `packages/*/package.json`; SDK F13 chose deps (`scripts/sdk-tarball-consumer.sh` header).
- F-11 `smoke` job builds + launches `presto-server` and curls `/health` only, with `run-prebuild: "false"` (`.github/workflows/presto.yml:400-479`).
- F-12 `@aztec/noir-types`, `@aztec/noir-acvm_js`, `@aztec/noir-noirc_abi`, `@aztec/bb.js` are in `bun.lock` and `bunfig.toml` excludes; `@aztec/noir-noir_js` is not in the lockfile.
- F-13 `gh stack` v0.1.0 and `agent-worktree` are installed; codex login OK.
- F-14 Playground mocked e2e intercepts fixed loopback URLs via `page.route` (`packages/playground/e2e/demo.mocked.spec.ts:35-41`); Vite already sets COOP/COEP and resolves bb.js workers through `@aztec/bb-prover` (`vite.config.ts:20-77`).

### Inferences (unverified — attack these)

- I-01 Linux `copy-bb.ts` prebuild in the `smoke` job costs seconds (copies bb from `node_modules`), so extending `smoke` beats a new job. Not timed in CI.
- I-02 bb.js WASM proving of a few-hundred-gate fixture in Bun completes in well under a minute in CI and needs only a small CRS fetch from the internet. Not measured.
- I-03 `--vk_policy default` with a *valid but wrong* VK yields a proof that fails verification rather than a crash (only malformed VKs were tested).
- I-04 A closure-based `run_guarded` can hold the four RAII guards without lifetime gymnastics (`Bytes` is owned; the lease and permit are owned guards). Prototype in phase 3 before committing to the shape.
- I-05 `npm publish` of a package whose `dependencies` were rewritten from `workspace:*` to an exact version passes the existing fail-closed checks and provenance verification unchanged.
- I-06 The tokio `Semaphore` used for the prove permit is FIFO-fair, bounding a non-mining site's wait to one proof.
- I-07 aztec-nargo 5.2.0 output (`circuit.json`) is accepted by bb 5.2.0 (`-b` on the JSON artifact) — verified for yacana W, inferred for the new fixture.

### Asks (owner decisions)

- A-01 Native `verifyProof`/`getVerificationKey` routes (`/vk/ultra-honk`, `/verify/ultra-honk`) now, or defer to a follow-up? Recommendation: defer; v1 keeps them WASM.
- A-02 `@aztec/bb.js` peer range and initial versions: recommendation `>=5.2.0 <6` peer; `@alejoamiras/presto-core@1.0.0`, `@alejoamiras/presto-noir@1.0.0`, `@alejoamiras/presto` keeps its Aztec-versioned scheme.
- A-03 Presto app version that carries the route (next minor, `1.1.0`?), for the compat matrix and docs.
- A-04 Add a cheap per-origin proofs-per-minute cap now (default off), or leave all abuse handling to the metering follow-up? Recommendation: leave to the follow-up; the single permit already bounds cross-site impact.
- A-05 `/harden security` before the first stable publish of `presto-noir` (deferred from Phase 0 to this gate).

---

## Decision ledger

_To be filled at consolidation (step 2) with source per decision, rejected alternatives, and disputed items. D-01…D-06 references above are the main-agent draft's positions._

---

## Audit log

_Contradiction-check, double audit, and final codex pass verdicts (adopted vs rejected) land here._

---

## Post-implementation

Executed by the implementing session from this file (it may never load the blueprint skill).

1. **`/code-review`: not run.** `code_review: off` in the front matter; do not add it.
2. **Codex audit per arc** (`/codex high`, GPT-6 Astra): at each arc boundary — after the arc's phases are ✓ and BEFORE `gh stack add` — send codex the arc's diff, this plan.md + decision ledger, the arc map ("this is arc N of 5; later arcs build X on it"), the adversarial/security ask (*What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?*), and the two rules below verbatim.
3. **Iterative fix loop:** triage (verify codex's factual claims against the repo first), apply accepted fixes, commit, log the round in `implementations-plan/presto-noir/lessons/phase-N.md`, then RESUME the same codex session with the fix diff and ask for a re-review. Repeat until a round yields no new material findings; rejected nitpicks are not churn. Still material after 3 rounds → stop and surface to the owner (scope smell).
4. **Final cross-arc integration pass:** after all five arcs are ✓ and looped, a FRESH codex session over the net diff from `ae1cb9c`, asking for cross-arc issues (seams between arcs, duplication across arcs, drift from this plan), same loop-until-clean.
5. **Delivery** (the first time any PR is opened): `gh stack sync` if main moved, `gh stack submit --auto`, `gh pr edit` each PR with a proper body (no local paths), `gh pr checks --watch`. `gh stack merge` is the owner's call. Update `implementations-plan/index.md` and `agent-worktree status presto-noir "done: PRs #…"`.

**The no-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**The comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

**Post-implementation hardening:** `/harden security` before the first stable publish of `@alejoamiras/presto-noir` — owner decides at the gate (A-05).

**Failure-retry policy:** human-driven, 3 failures on a step → reassess; `/loop` autonomous, 5 → reassess with codex.

---

## Seeds (DRAFT — finalized after approval)

```
/goal All phases marked ✓ in implementations-plan/presto-noir/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/presto-noir/lessons/phase-N.md` in the transcript; `/code-review` was NOT run (code_review: off); the codex fix loop converged for EVERY reviewed diff — each of the 5 arcs at its boundary plus the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the Delivery section's 5-PR stack exists on GitHub, created only AFTER all loops converged (`gh stack view` output in the transcript); `bun run test` and `bun run lint:actions` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/presto-noir forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/presto-noir/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining step; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch; `gh stack view` for the whole stack). Without a PR but with CI configured, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it's actually progressing (`gh run watch <run-id>` up to 10 minutes; queued or stuck past that → inspect logs, log it as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. **No task in hand?** Pick the next pending step from plan.md and start it. After each meaningful edit, run the fast validation layers (`bun run lint` + the touched package's unit tests; `cargo fmt --check && cargo clippy -- -D warnings && cargo test` for Rust) — catch mistakes in-step, not phases later. Then commit → push (`gh stack push`; `gh stack sync` if main or a lower arc moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Exception — hard limits stay hard: never merge to main or release branches, never publish or deploy, never expand scope beyond plan.md; if the decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess the approach with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (commands + pass criteria — not generic vibes). Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/presto-noir/lessons/phase-N.md` in the transcript, advance to the next phase. Arc boundary crossed (per plan.md's Delivery section)? Run the arc's codex loop FIRST (`/code-review` is OFF for this plan — do not run it): codex with the arc map and the plan's no-over-engineering + comment-quality rules until a round yields nothing material — THEN `gh stack add <next-arc-branch>` before the next arc's work.
7. **All phases ✓ in plan.md?** Close out per plan.md's Post-implementation section: every arc already looped at its boundary — run only the final cross-arc integration pass: FRESH codex session over the net diff + cross-arc ask (seams between arcs, duplication across arcs, plan drift) + the no-over-engineering + comment-quality rules, same loop-until-clean. Then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync` then `gh stack submit --auto` + `gh pr edit` bodies, then `gh pr checks --watch`. Then write the wrap-up report: what shipped, every contentious decision codex and I debated — each with ELI5 context (what the question was, the options, why we picked ours) — and open items. Surface and stop.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```
