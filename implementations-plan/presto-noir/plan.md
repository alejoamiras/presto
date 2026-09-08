---
plan: presto-noir
tier: deep
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 3 agents (2 sweeps + 1 mapper); foreign reviewer codex/GPT-6 Astra at high; fable leg on Fable 5.1
status: APPROVED 2026-09-07 (owner verdict: approve; A-01..A-07 resolved — see Assumptions → Asks); re-indexed 2026-09-07 onto main @ 667da60 after the presto-cleanup stack (#16–#18); implementation in progress from Phase 1
base: origin/main @ 667da60 (planning recon was taken at ae1cb9c; see "Re-index after presto-cleanup")
worktree: .claude/worktrees/presto-noir (branch worktree-presto-noir)
sources: plans/main-v1.md, plans/codex.md, plans/fable.md; recon.md
---

# presto-noir — generic UltraHonk (Noir circuit) proving through Presto

## Summary

Presto proves Aztec transactions natively (`bb --scheme chonk`) for a browser SDK. This plan adds a second bb scheme so any Noir circuit can be proven natively through the same app: a `POST /prove/ultra-honk` route riding every existing guard, a transport-only npm package `@alejoamiras/presto-core` (dir `packages/sdk-core`), a drop-in `@alejoamiras/presto-noir` adapter (dir `packages/sdk-noir`) with bb.js's `UltraHonkBackend` surface and WASM fallback, generalized npm release CI, a playground Noir section, and tests proving native and WASM proofs are byte-identical. First consumer: the yacana web miner (out of scope; its `WorkProver` seam is ready). Note that bb.js in Node/Bun already prefers a native backend when the `bb` binary is present (`Barretenberg.new` tries `NativeUnixSocket` first); Presto's value for Noir is the **browser** (and Windows, where bb.js ships no native binary).

## Phase 0 answers (locked)

| Question | Answer |
|---|---|
| Tier | `deep` |
| TS package shape | core + 2 adapters (`@alejoamiras/presto-core`, `@alejoamiras/presto` on core, `@alejoamiras/presto-noir`) |
| App discriminator | new route `/prove/ultra-honk`; chonk `/prove` behaviour untouched |
| Version negotiation | keep `x-aztec-version`; expose the bb mapping in `/health` (identity today, D-07) |
| Validation layers | fast layers always; headless real-bb integration; playground mocked e2e; WebDriver 3-OS; byte-identity |
| `code_review` | off |
| `/harden security` | decide at the approval gate (A-05) |
| Scope in | route + Rust; core extraction; presto-noir; PR-gate + release CI; app release story; tests; playground Noir section; docs |
| Scope out (follow-ups) | tray per-origin cumulative prove time + one-click revoke UI; per-proof overhead measurement / persistent bb |
| Quality bar | production |

---

## Re-index after presto-cleanup (#16–#18, main @ 667da60)

The recon and every `file:line` citation below were taken at `ae1cb9c`. The cleanup stack merged before implementation started; this section is the delta. Line numbers in the rest of the document are the `ae1cb9c` ones unless marked; the implementer reads current code, this table says where things moved.

**Constraints the implementation must satisfy from the first commit** (`docs/CODE_QUALITY.md`, enforced by `scripts/complexity-policy.test.ts`):

- Biome over all handwritten TS/JS incl. root scripts and the new packages: cognitive complexity ≤ 15, ≤ 80 non-blank lines per function (IIFEs included), no nested test suites; only `describe()`/`test.skipIf()` callbacks may carry a narrow `biome-ignore` with a reason.
- Clippy in all three crates, `--all-targets` (test functions are **not** exempt): `cognitive_complexity` ≤ 25, `too_many_lines` ≤ 80, both `deny`; exceptions only as `#[expect(clippy::…, reason = "…")]` on one function. `bun run lint:clippy` is **not** part of `bun run lint` — every Rust gate below now names it explicitly.
- Rust pinned to 1.98.0 (`rust-toolchain.toml`); any new workflow that pins a toolchain must match or the policy test fails. `reqwest` 0.13 (rustls + `aws-lc-rs`) makes CMake a build prerequisite (hosted runners have it; document it for headless/container builds). `base64` is **0.23** (not 0.22). TypeScript is 7.0.2. The headless dep-tree tripwire in `presto.yml` now expects `tokio-rustls`.
- `release-presto.yml` has **no bootstrap escape**: the 1.1.0 release must resolve a same-key lower baseline (1.0.x exists, so it will) or fail closed.
- `presto.yml` already lints and tests the `server` crate; `app.yml`'s filter already includes `rust-toolchain.toml`.

**What the refactor already did (reuse, do not re-split):**

| Area | Now | Consequence for this plan |
|---|---|---|
| `core/src/server/prove.rs` | `prove()` is 216–309 (with `#[expect(clippy::cognitive_complexity)]`), calling `requested_version` 311–316, `download_if_needed` 318–346, `spawn_cache_cleanup` 348–365, `acquire_version_lease` 367–379; `resolve_version` 50–90 + `parse_selectable_version` 92–105; `compute_threads` 109–118; `reject_declared_oversize` 132–174; `read_body` 182–200; `try_enter` 206–210; `MAX_BODY_SIZE` 120, `BODY_READ_TIMEOUT` 126 | D-01's `admit` / `acquire_prover` are thin compositions of these helpers (authorize → slot → `try_enter` → `reject_declared_oversize` → `read_body` → `requested_version` → status; and `resolve_version` → `download_if_needed` → `compute_threads` → `acquire_version_lease` → permit). Goal: `prove()` and `prove_ultra_honk()` each become ~20-line orchestrators and the `#[expect]` on `prove()` can go. |
| `core/src/bb.rs` | `prove_with_timeout` 293–352 orchestrates `ProveWorkspace` 365–384, `build_prove_command` 386–417, `containment::spawn_and_register`, `wait_for_bb` 419–430, `log_bb_stderr` 432–446, `require_success` 448–457, `read_capped` 461–468, `validate_proof_len` 473–489; `prepend_field_count_header` 1011–1017; reaper split into `is_stale_prove_workspace` 179–197 / `remove_prove_workspace` 199–210 | `run_bb` is still net-new but small: `spawn_and_register` → `wait_for_bb` → `log_bb_stderr` → `require_success`. `prove_ultra_honk` reuses `ProveWorkspace` (extended to write several input files) and adds `build_ultra_honk_command`. |
| `core/src/server/auth.rs` | `authorize_origin` 15–41 orchestrates `parse_request_origin` 43–66, `origin_is_approved` 68–73, `request_authorization` 75–107, `map_request_error` 109–120, `persist_approved_origin` 122–153; signature still `Result<(), ProveError>` | D-52's `Approval` return and manager-lock wrapping land in `origin_is_approved` / `persist_approved_origin`; the orchestrator barely changes. |
| `core/src/server.rs` | Only a CORS `.vary([ORIGIN])` line was added; `health` 415–463 with `api_version` literals at **421** and **439**; `ProveError` 472–604; `start` 252–300 unchanged | No named `API_VERSION` const exists yet — still this plan's job. |
| `core/src/config.rs` | `lock_mutate_save_to` 658–680; `load_with_cap_from` split into `load_config_contents` / `load_migrated_config` + `LoadedConfig::{read_only, persistable}` | Citations shift +14; semantics unchanged. |
| `packages/sdk/src/lib/presto-prover.ts` | `#proveRemote` 477–551 now delegates to `#recoverFromNetworkFailure` 553–576 and `#retryProofOverHttp` 578–626; `#classifyHealth` 355–423; `#fallbackOrThrowHttp` 683–737; `#getAztecVersion` 753–762 | `PrestoClient` hoists these helpers as-is. |
| `packages/sdk/src/lib/presto-transport.ts` | `readTextBounded` split into `readJsonBounded` 334–346, `readUnstreamedText`, `cancelReader`, `appendStreamChunk`, `readStreamedText` 400–440, `readTextBounded` 446–458; class shifted +19 (`postProve` 935–978, headers 948–951) | `git mv` still applies; `readJsonBody` = today's `readJsonBounded`. |
| `scripts/promote-sdk-latest.ts` | `main()` split into `parsePromotionOptions`, `verifyPromotionCandidate`, `printPromotionCandidate`, `confirmPromotion`, `readBackLatest`, `promoteLatest` | Phase 8's `--package` threads through these; `prepare-sdk-publish.ts`, `sdk-tarball-consumer.sh`, `packaged-e2e-swap-sdk.sh` are unchanged. |
| `.github/workflows/presto.yml` | `smoke` 393–473; `presto-status` needs 777–797; `clippy` job runs `bun run lint:rust` + `bun run lint:clippy`; `test` job runs `cargo test --locked` for all three manifests | Phase 5's new job joins the existing shape. |

Unchanged (0 diff): `probe.rs` 51–54, `lib.rs:30`, `cache_layout.rs:17`, `leases.rs`, `downloader.rs:429`, `commands.rs:403–414`, `tls.rs:31`, `types.ts`, `prepare-sdk-publish.ts`, `sdk-tarball-consumer.sh`, `packaged-e2e-swap-sdk.sh`, `app.yml` filter (+`rust-toolchain.toml` at 36), `release-sdk.yml` assert-main 38–44 and publish permissions 58–64.

---

## Architecture & Implementation

### Components and boundaries

```
Noir dApp / yacana web miner                        Aztec dApp
  @alejoamiras/presto-noir  (packages/sdk-noir)      @alejoamiras/presto  (packages/sdk)
  PrestoUltraHonkBackend — bb.js surface             PrestoProver — PrivateKernelProver
        │ JSON job ↔ ProofData                              │ msgpack steps ↔ Chonk proof
        └────────────► @alejoamiras/presto-core ◄───────────┘   (packages/sdk-core, zero @aztec deps)
                       PrestoClient: probe + HTTPS pin + status cache + generation,
                       downgrade policy, F14 fallback table, phases, bounded fetch/readers
                                      │ POST /prove | /prove/ultra-honk (+ x-aztec-version)
                       Presto app (Tauri) / presto-server (headless) — one axum router:
                         admit() → [scheme-specific validation] → acquire_prover() → bb::{prove, prove_ultra_honk}
                         /health: + schemes, + versions (identity)
```

Rust: `packages/presto/core/src/server/prove.rs` is split into two behaviour-preserving stages (`admit`, `acquire_prover`) both handlers call; `bb.rs` gains a shared child runner (`run_bb`) and a sibling `prove_ultra_honk`; a new `server/ultra_honk.rs` holds the JSON contract, validation, and handler. Headless and Tauri binaries pick the route up unchanged (both compose `router_for_port`, `server.rs:346-379`; HTTPS listener via `src-tauri/src/server/tls.rs:31`).

### Wire contract: `POST /prove/ultra-honk`

Request — `content-type: application/json`; same 50 MB body cap, 30 s read deadline, inflight cap, origin authorization, and `x-aztec-version` semantics as `/prove` (exact Aztec release == `@aztec/bb.js` version; absent → bundled bb):

```json
{
  "bytecode": "<the compiled artifact's `bytecode` string verbatim (base64 of gzipped ACIR)>",
  "witness": "<base64 of the gzipped witness exactly as noir_js `execute` returns it>",
  "vk": "<base64 verification key>",                   // optional
  "verifier_target": "noir-recursive-no-zk"            // required; bb's 8 targets
}
```

Unknown keys are tolerated (forward-compatible, matching the four health validators); duplicate keys and missing required keys are rejected. Cheap validation runs on the runtime thread before any download, lease, or permit: JSON shape → `verifier_target` parsed into the `VerifierTarget` value object → encoded-length caps (base64 length bounds the decoded size: bytecode ≤ 16 MiB, witness ≤ 32 MiB, vk ≤ 64 KiB decoded). The heavy steps — base64 decode (standard alphabet, padding-indifferent like bb.js's decoder), gzip magic on bytecode/witness, the **capped inflate dry-run** (stream through the existing `CappedReader` pattern, cap 256 MiB, output discarded), and the tempdir writes — run on a blocking worker that **owns the prove permit for its whole life** (moved into the closure, returned when it exits), so at most one decode/inflate is ever in flight even if the client disconnects mid-way. Failures map to `ProveError::InvalidRequest` (400 `invalid_request`) and `ProveError::InvalidVerifierTarget` (400 `invalid_verifier_target`) with the existing `text/plain` JSON-string body; oversize declared bodies keep 413; the per-origin cap answers 429 `origin_queue_full` (distinct from the auth backlog's `too_many_requests`). Per origin, at most **4** UltraHonk jobs (half of `MAX_INFLIGHT_PROVE`) are admitted at a time — the slot is taken right after authorization, before the body is buffered; 429 `origin_queue_full` beyond it; no-Origin local callers exempt, and under the headless `--allow-all` mode (which returns before parsing any Origin) the cap covers nothing — documented as a dev/CI mode. This is **admission fairness, not protection against an approved attacker**: the same origin can still fill the inflight cap through chonk `/prove` (untouched by Phase 0 lock), two approved origins can fill it through UltraHonk, and a shed fifth request falls back to WASM on the same machine (more CPU, not less) unless the dApp set `fallback: "none"`. It keeps a multi-tab dApp queuing on the FIFO permit like chonk while stopping one Noir origin from shedding every other site (A-04).

bb invocation, in the private prove tempdir with 0600 files (`write_witness`):

```
bb prove --scheme ultra_honk -b bytecode.gz -w witness.gz -t <target> -o out/   plus   -k vk   |   --write_vk
```

`-k` when the client supplied a VK (`--vk_policy` stays `default`: a wrong VK breaks only that client's proof; malformed VKs fail closed, F-05); `--write_vk` otherwise — the only VK-less invocation bb 5.2.0 accepts (F-03). Outputs: `proof` via `read_capped` + `validate_proof_len` (non-empty, 32-byte aligned); `public_inputs` via `read_capped` + alignment only (**empty is valid**, F-15); `vk` (≤ 64 KiB) on the `--write_vk` path. The chonk field-count header is never applied (`bb::prove` is not reused).

Response — `application/json` + `x-prove-duration-ms` (the bb wall time only, excluding auth, queue, and download, as for `/prove`):

```json
{ "proof": "<base64>", "public_inputs": "<base64, may be empty>", "vk": "<base64, only when the server computed it>" }
```

### `/health` additions

Minimal and detailed bodies both gain the static capability list; only the detailed body gains the identity mapping:

```json
{ "status": "ok", "api_version": 1, "schemes": ["chonk", "ultra_honk"] }
```

```json
"versions": [ { "aztec_version": "5.2.0", "bb_version": "5.2.0" } ]
```

`bb_version` is defined as the `@aztec/bb.js` release selector (identical to `aztec_version` by construction, F-08), not bb's binary build id. `api_version` stays `1` and gains a named Rust constant shared by `server.rs:418,436` and `probe.rs:53`. Scheme identifiers use bb's spelling (`ultra_honk`); the URL path uses the hyphen.

### Rust change map (cross-checked with recon.md)

| File | Change |
|---|---|
| `core/src/server/prove.rs` | Split the inlined guard sequence into two `pub(super)` async fns, **no behaviour change for chonk**: `admit(state, request, origin_slots: Option<&OriginSlots>) -> Admitted { body, requested_version, approval, _origin_slot, _inflight, _status }` (authorize (now returning the `Approval` it already computes — `auth.rs` change) → **when `origin_slots` is `Some` (UltraHonk passes its slot table, chonk passes `None`): per-origin slot (cap 4), 429 `origin_queue_full` beyond it** → inflight slot → declared-size reject → capped/timed body read → header → `Proving` + `StatusGuard`) and `acquire_prover(state, &requested_version) -> Prover { version, threads, _lease, _permit }` (resolve → download with `Downloading`/`Proving` → threads → lease → permit). `prove()` = `admit(None) → acquire_prover → bb::prove → render`. Drop order preserved (permit, lease, status, inflight, origin slot). The characterization tests (`prove_success_path_and_status_sequence`, `body_read_does_not_hold_the_prove_permit`, 429 shedding, error shapes) pass **unedited** — that is the refactor's proof. |
| `core/src/server/ultra_honk.rs` (new) | `UltraHonkRequest` (`Deserialize`), `decode_field(name, &str, cap)`, gzip magic, `VerifierTarget` (8 variants, `FromStr`, `as_flag`), the capped inflate dry-run, the per-origin slot type, and the handler `prove_ultra_honk = admit(Some(slots)) → cheap validation on the runtime thread (JSON shape, enum, encoded-length caps — base64 length bounds the decoded size) → acquire_prover → revocation check → blocking worker: base64 decode (padding-indifferent, as bb.js's lenient decode), gzip magic, capped inflate dry-run, tempdir writes → revocation check → bb::prove_ultra_honk → render`. Decoded copies therefore exist only under the permit (one request at a time), never 8× on the runtime thread. **Worker ownership:** the blocking worker holds the prove permit, the version lease, the inflight slot, and the origin slot **moved into the closure and returned on completion** — a dropped request future (client disconnect) cannot release them while the worker still runs (tokio blocking tasks are not cancellable); the `CappedReader` loop checks a cancellation flag set by the handler's drop guard every chunk; a regression test drops the request mid-inflate and asserts the permit is released only after the worker exits. Revocation check = "was this origin revoked after this request's approval?" (see `authorization.rs`), UltraHonk only; chonk keeps authorize-once. Pure functions unit-tested without the router. |
| `core/src/authorization.rs` | `AuthorizationManager` becomes the single ordering authority for approval and revocation: one mutex holds the pending prompts, a monotonic `Generation`, and the revocation log; **it holds no independent copy of approved origins** — the persisted config (`approved_origins`) stays the only durable authority, and the manager lock **wraps** every read of it and every `lock_mutate_save_to` that changes it, so a stale-generation check and the config write are one serialized step, never a manager check followed by an independently locked write. `Generation` is assigned **at decision time**: `Allow`, `Deny`, and `revoke(origin)` each take the next generation under the lock, and the `Allow` decision delivered to a popup waiter carries that generation as `granted_at` (there is exactly one epoch; an open prompt is **not** cancelled by a revocation — a later `Allow` simply gets a newer generation and wins, which is the user's most recent intent). `authorize_origin` returns `Approval { origin: Option<CanonicalOrigin>, via: Persisted \| Popup \| Ungated, granted_at: Generation }` with the approval read and the token creation in the same critical section. A delayed popup waiter (`auth.rs:45-135`) whose `granted_at` is older than a revocation of that origin is **dropped, not persisted** — it can never restore a removed origin. **Persistence failure semantics are unchanged**: a failed or read-only save (`config.rs:650-665` commits to memory only after a successful save; a config-write error must not fail an approved prove, pinned by `server/tests.rs:1333-1335`) grants the already-approved request only; because there is no mirror, later requests re-prompt exactly as today. The UltraHonk re-check rejects **only** when a revocation of that origin is newer than `granted_at`; `--allow-all`, auto-approved localhost, and no-Origin callers are never rejected. Tests: Allow → remove → delayed waiter (origin stays revoked, on disk and in memory); removal interleaved with a waiter's persistence (single winner, disk reloaded and asserted); removal between approval lookup and token creation (request rejected); failed save → next request re-prompts; revoked-while-queued (403). |
| `src-tauri/src/commands.rs` | `remove_approved_origin` (`commands.rs:404-414`, today a config-only `retain`) additionally calls the manager's `revoke(origin)` so Settings removal bumps the generation; the headless server has no removal path (config is read at start). |
| `core/src/bb.rs` | Extract `run_bb(cmd, timeout) -> io::Result<ExitStatus>` composing the helpers #18 already split out (`containment::spawn_and_register` → `wait_for_bb` → `log_bb_stderr` → `require_success`; stderr stays log-only); `prove_with_timeout` becomes `ProveWorkspace` + `build_prove_command` + `run_bb` + read + header. `ProveWorkspace` gains a multi-file constructor for the UltraHonk inputs. New `prove_ultra_honk(job, version, threads) -> UltraHonkOutput { proof, public_inputs, vk: Option<Vec<u8>> }` with the same lease/tempdir/containment/timeout (`PROVE_TIMEOUT` 300 s), same `prove-` prefix and reaper. |
| `core/src/server.rs` | `.route("/prove/ultra-honk", post(ultra_honk::prove_ultra_honk))`; `API_VERSION` const; `schemes` in both health bodies; `versions` in the detailed body; `ProveError::{InvalidRequest, InvalidVerifierTarget}` + `IntoResponse` arms; `AppState.ultra_honk_inflight`. |
| `core/src/server/probe.rs` | Use `API_VERSION` (no behaviour change). |
| `core/src/server/auth.rs` | `authorize_origin` returns the `Approval` above (origin it already parses, `None` for no-Origin/`--allow-all`, plus the generation); callers ignoring it are unchanged. At 667da60 the function is already an orchestrator over `parse_request_origin`, `origin_is_approved`, `request_authorization`, `persist_approved_origin`; the manager-lock wrapping lands inside the last two. |
| `core/src/server/tests.rs` | Router tests with the fake-bb script (writes `proof` + `public_inputs`, and `vk` when argv has `--write_vk`): 200 paths (`-k` and `--write_vk`), empty `public_inputs` accepted, every 400 code, text/plain shape (extend `prove_error_responses_stay_text_plain_json_string`), CORS preflight for `application/json`, status sequence identical to chonk, per-origin 429, revoked-while-queued 403, minimal health carries `schemes` but not `versions`. |
| `core/tests/ultra_honk_real_bb.rs` (new, `#[ignore]`) | Real-bb integration: router `oneshot` with the fixtures (target `noir-recursive-no-zk`, read from `manifest.json`) → 200 → `proof` bytes == expected → `public_inputs` == expected → spawn `bb verify` natively (exit 0) → `--write_vk` path returns bytes equal to the fixture `vk` (which is WASM-generated: the VK byte-identity check) → all 8 targets prove + `bb verify` for `square` (**byte equality only for the four `*-no-zk` targets; ZK targets are randomized, so verification is the assertion**) → tampered proof fails `bb verify` (exit 1). Run by the `presto.yml` job `ultra-honk-real-bb` (added to `presto-status`'s explicit `needs`/result lists) together with the HTTP smoke script; `sdk.yml`'s dispatchable package lane runs the TS live e2e; both launch the server through the shared `start-headless-presto` action with a per-run `PRESTO_HOME` (bb's CRS cache deliberately stays shared). |
| `server/src/main.rs` + `core/src/server.rs` `start` | `presto-server --port <n>` / `PRESTO_PORT` (default 59833) so parallel integration runs on one machine own their port (host registry per the run-isolation rule). Core's `start(state)` binds the `PORT` const today (`server.rs:265-266`) and builds `router(state)`; it becomes `start_on(state, port)` using `router_for_port(port)` so the Host guard matches; the desktop app keeps calling the default. **Winning the port is what makes cache eviction and workspace reaping safe (`server.rs:270-275`, `versions/leases.rs`: leases are in-process, "exactly one instance serves at a time")**, and no data-dir override exists today (`versions/cache_layout.rs:18`, `config.rs:150-154` derive from the home dir; prove workspaces, the startup reaper, and logs live under `runtime_data_dir()` = `dirs::data_local_dir()/presto` — `lib.rs:30`, `bb.rs:94`), so this phase adds one: `PRESTO_HOME` roots **both** `.presto/{config,versions}` and the runtime data dir (`prove-tmp`, logs) for core (default: unchanged), and `presto-server` refuses `--port` unless `PRESTO_HOME` is set to a directory other than the defaults. Tests assert the resolved workspace, reaper, cache, and config paths under `PRESTO_HOME`, not merely that two servers answer concurrently. bb's own CRS cache (`~/.bb-crs`, which bb guards with its own `crs.lock`) stays shared. The smoke script and the composite action always run with a per-run `PRESTO_HOME` on real disk (the `tmp`-is-tmpfs rule). Two concurrent servers on different ports with different `PRESTO_HOME`s are tested; a shared `.presto` across instances stays unsupported and documented. `BindOwnedGuard` stays per-process and unchanged; the implementer confirms the version-floor tracker it feeds is desktop-only before shipping (I-11). |

### TypeScript change map

| Package | Content |
|---|---|
| `packages/sdk-core` — `@alejoamiras/presto-core` (deps: `ms`, `@logtape/logtape`; zero `@aztec/*`) | `git mv` `presto-transport.ts`, `errors.ts`, `logger.ts`, `types.ts` (minus `PrestoProverOptions`) and their tests. Transport generalizes `postProve` → `post(path, body, contentType, aztecVersion?, url?)`, `proveUrlFor` → `urlFor(protocol, path)`, `readProveBody` → `readJsonBody(response, cap, timeout)`. **New `PrestoClient`** hoists the security-reviewed policy out of `PrestoProver`: `checkStatus()` (single-flight, generation), health probe + classification (`schemes`, `versions`), `isBrowserRuntime` (Worker-aware) + `resolveHttpsOnly` (the miner runs in a Worker; the `httpsOnly` default depends on this), the HTTPS-pin/downgrade rules, `isProtocolHealthy`, and the F14 fallback table. Surface: `new PrestoClient({ presto?, aztecVersion?, onPhase? })`, `prove({ path, contentType, body: () => Uint8Array, responseCap }) => Promise<ProveOutcome>` with `ProveOutcome = { kind: "native", body: unknown /* JSON parsed under responseCap by the one bounded reader */, durationMs } \| { kind: "fallback", reason, phase }` — no `Response` leaks out of core; throws `PrestoHttpError` only on misconfiguration. The hoisted F14 table gains one row: `404` → `{ kind: "fallback", reason: "route-missing" }` (today's table throws on unlisted statuses; harmless for chonk, required for the Noir adapter against an older app). `packages/sdk` keeps a one-line `logger.ts` (`getLogger(["presto", "prover"])`); core logs under `["presto", "core"]`. `PrestoStatus` gains `schemes?: readonly string[]`, `versions?: readonly { aztecVersion: string; bbVersion: string }[]`. Base64 helpers (`Uint8Array.fromBase64/toBase64` with a `Buffer`/`atob` fallback). Barrel: `PrestoClient`, `PrestoHttpError`, `PRESTO_API_VERSION`, `PRESTO_SCHEME_ULTRA_HONK`, all types; `PrestoTransport` stays internal. |
| `packages/sdk` — `@alejoamiras/presto` | `PrestoProver` shrinks to serialize/decode around `client.prove({ path: "/prove", contentType: "application/octet-stream", body })` → `ChonkProofWithPublicInputs` or `super.createChonkProof`; depends on core `workspace:*` (rewritten to the exact version at publish); barrel re-exports the same names (pinned by `public-contract.test.ts` and the tarball consumer); `#getAztecVersion` becomes the `aztecVersion` client option. Decision-table tests move to core; adapter tests keep serialize/decode/phase order. |
| `packages/sdk-noir` — `@alejoamiras/presto-noir` (peer `@aztec/bb.js` exact, dev `5.2.0`) | `PrestoUltraHonkBackend(acirBytecode: string, api: Barretenberg \| () => Promise<Barretenberg>, options?: { bbVersion?: string; presto?: PrestoConfig; verificationKey?: { bytes: Uint8Array; verifierTarget: VerifierTarget }; fallback?: "wasm" \| "none"; allowUntestedBbVersion?: boolean; onPhase? })` — a true drop-in for `new UltraHonkBackend(bytecode, api)`: with an exact peer there is exactly one installable bb.js, so `bbVersion` defaults to the adapter's baked `TESTED_BB_VERSION` (`"5.2.0"` at v1) and is only an override. `generateProof(compressedWitness, opts)` → `client.prove({ path: "/prove/ultra-honk", contentType: "application/json", body })` → native: `proof = b64decode`, `publicInputs = deflattenFields(b64decode(public_inputs))` (same `0x`+64-hex format as bb.js); fallback: lazily construct the real `UltraHonkBackend` from the resolved `api`, or throw a typed `PrestoUnavailableError` when `fallback: "none"` (**scoped to `generateProof` only**; `verifyProof` and a cold `getVerificationKey` still run locally in v1, documented and tested — A-01). **VK cache** keyed by `(bbVersion, verifierTarget)` per instance (bytecode is fixed per instance; VKs differ by hash family, F-17): a server-returned `vk` is cached only to send `-k` on later proofs of the same key, which can only affect this client's own proofs. `verifyProof` is **circuit-bound exactly like bb.js**: it always delegates to WASM `UltraHonkBackend.verifyProof`, which recomputes the VK from the bytecode — no seeded or server-returned key is ever used for verification (a VK-bound `UltraHonkVerifierBackend` path would change the drop-in's semantics). `getVerificationKey`: seeded → WASM-derived (server-derived keys are not returned in v1). `getSolidityVerifier(vk, options)` and `generateRecursiveProofArtifacts(proof, numPublicInputs, options)` are thin delegates to the same lazily resolved WASM backend with option forwarding, so any consumer of bb.js's `UltraHonkBackend` can substitute the class; a compile-time `satisfies` check against bb.js's public method signatures and a runtime method-list test pin the surface. `checkPrestoStatus`, `setForceLocal`, `setOnPhase`, `destroy` (only internally created resources). The wire `verifier_target` is always explicit: one `resolveVerifierTarget(options)` mirrors bb.js's `getProofSettingsFromOptions` for **all three methods** — the omitted-option default, the legacy `keccak`/`keccakZK`/`starknet`/`starknetZK` flags, and the "legacy flags cannot be combined with `verifierTarget`" error — tested for defaults, legacy flags, conflicts, and target changes (P14). **Native/fallback version consistency:** an explicit `bbVersion` override is validated against the adapter release's closed list of tested pairings (`["5.2.0"]` at v1) and rejected otherwise unless `allowUntestedBbVersion: true` is passed, so a consumer cannot silently get native proofs from one bb release and WASM proofs (and WASM-recomputed VKs) from another (A-02). |

### Critical path (native, miner-shaped)

`generateProof` → `client.prove` → `detect` (probe or cached status; `schemes` without `ultra_honk` → fallback, phase `version-mismatch`) → `serialize` (body factory: bytecode passthrough, witness base64, cached/seeded vk for this target) → `transmit`/`proving` → bounded POST → server `admit` (auth → per-origin slot → inflight → Content-Length → 50 MB body → status) → cheap validation on the runtime thread (JSON shape, enum, encoded-length caps) → `acquire_prover` (version/download/threads/lease/permit) → revocation check → blocking worker owning the permit (base64 decode, gzip magic, inflate dry-run, tempdir writes) → revocation check → `bb::prove_ultra_honk` (~1.2 s for W, 12 threads) → `{proof, public_inputs, vk?}` → `proved` with `durationMs` → `receive` → `ProofData`. A `404` (app without the route) is classified as fallback and remembered per client generation.

### Non-obvious mechanics

- **bb.js `Barretenberg.new()` prefers native in Node/Bun** (`NativeUnixSocket` first when a `bb` binary is in the package, then WASM — `dest/node/barretenberg/index.js:25-49`). Every byte-identity test must pin `backend: BackendType.WasmWorker`, or it compares native to native.
- **VK-less proving** uses `--write_vk`, not `--vk_policy recompute` (which still demands a file, F-03). The returned `vk` lets a client cache and send `-k` next time (−0.26 s/proof on W); the miner seeds its committed VK via `verificationKey`.
- **Byte identity is checked both ways, and only for deterministic targets.** ZK targets (`evm`, `noir-recursive`, `noir-rollup`, `starknet`) add prover randomness, so only the `*-no-zk` targets yield reproducible bytes; every fixture, smoke, identity, and playground call passes the fixture's recorded target (`noir-recursive-no-zk`) explicitly, never bb.js's implicit default (which is a ZK target). Fixture `proof` files are generated by bb.js WASM (`WasmWorker`) at regeneration time and recorded in `manifest.json`. The Rust real-bb job asserts native == fixture; the sdk-noir identity test recomputes WASM at test time and asserts WASM == fixture (a stale peer or a bb.js regression shows up there, not only at regeneration). A failing identity assertion is surfaced as a supported-platform finding, never silently downgraded to "verifies".
- **Empty public inputs are a valid output** (F-15) — a distinct validator from `validate_proof_len`.
- **`bb verify` exits 1 for an invalid proof and for failures alike** (F-16); any future verify route must parse the result line. This plan's v1 keeps verification in WASM (A-01).
- **Proof and VK sizes depend on the target's hash family** (F-17): the adapter never assumes 410 fields; caps are generous (proof ≤ `MAX_PROOF_BYTES`).
- **`npm pack` does not rewrite `workspace:*`**: `preparePublishManifest` pins `@alejoamiras/presto-core` to the workspace core version. **Two modes, so the first release can bootstrap:** (1) *pre-merge integration* (PR gates, dispatched lanes): when the pinned core version is unpublished, or its published tag differs from `packages/sdk-core` at the current SHA, consumer profiles install the **packed candidate core** alongside the packed adapter — that is the only way a core+adapter change can be validated before either exists on npm; (2) *authorized release* (`release-sdk.yml`): publish and verify core first, then **rerun the adapter consumer profiles against the registry core** before publishing any adapter; an adapter-only release fails closed unless (a) the pinned core version is on npm with verified provenance and a matching git tag and (b) `packages/sdk-core` at the release SHA is byte-identical to the tree at that core tag (`git diff --quiet <core-tag> -- packages/sdk-core`) — so a core edit without a version bump can never ship adapters tested against source but resolved against an older registry core. Preflight checks that need no registry core (identity, collision, own provenance inputs) run for every candidate up front; dependency-provenance checks run after the dependency exists. `scripts/published-playground.ts` and the packaged-e2e SDK swap script (`.github/scripts/packaged-e2e-swap-sdk.sh`) handle **every published package the playground consumes** — `presto`, `presto-noir`, and their pinned core — selecting the verified candidate for each and asserting the playground resolves the packaged entries, with the deployment behaviour defined per release selection (e.g. `presto-noir` alone → deploy the playground with the published noir at its pinned core and the current published presto).
- **CRS**: bb fetches `~/.bb-crs` on first UltraHonk use; the real-bb job caches it (`actions/cache`), and the IPA targets (`noir-rollup*`) additionally need the Grumpkin CRS.

### Alternatives not taken

| Fork | Chosen | Rejected | Why |
|---|---|---|---|
| Guard sharing | two-stage prelude (`admit`, `acquire_prover`) + `run_bb` | closure template (main v1); scheme enum in one handler; copy the ~150 lines | scheme validation must sit between body read and download/permit — a closure or single prelude cannot express that cleanly; an enum handler makes chonk's hot path branch on scheme; duplication drifts on the next security fix |
| VK | optional; `-k` or `--write_vk`; client cache + seed | required VK; server VK cache keyed by bytecode hash | required forces a WASM `getVerificationKey` before the first native proof; a server cache is disk state with a poisoning surface and eviction logic |
| Request encoding | JSON + base64, unknown keys tolerated | multipart; msgpack; octet-stream + layout header; `deny_unknown_fields` | W is ~0.5 MB against a 50 MB cap; `serde_json` + `base64` are existing deps; curl-able; tolerant keys keep the protocol additively evolvable like `/health` |
| Response | JSON + base64 | binary concatenation | proofs are ~8–16 KB regardless of circuit size; one bounded JSON reader serves both routes |
| Feature detection | `api_version` 1 + `schemes` in **both** health bodies | bump to 2; `schemes` detailed-only with 404-sticky | a bump strands every installed Aztec SDK on WASM (four sites incl. `probe.rs`); a public static capability list costs a two-bucket fingerprint (old/new app) and removes the popup-before-knowing ambiguity for new Noir origins |
| bb mapping in `/health` | identity `versions` array in the detailed body + docs + required `bbVersion` option | docs only (fable, main v1); `x-bb-version` alias; `bb --version` build id | honours the Phase 0 answer; identity is defined as the release selector; a build id would need a per-binary subprocess and nothing records it today (A-07 lets the owner drop the field) |
| bb.js dependency | peer, exact `5.2.0` at v1 with a closed tested-pairing list (A-02) | exact dep like the SDK's F13; range peer `>=5.2.0 <6` | the consumer already owns a bb.js + `Barretenberg`; a second WASM copy breaks worker resolution and `instanceof`; F13's reasons (adapter-owned `@aztec/stdlib` graph) do not apply; the wire contract and byte identity are tested for 5.2.0 only |
| Fallback api | positional `api: Barretenberg \| factory` + `fallback: "wasm" \| "none"` | options-only constructor (codex); eager `Barretenberg.new` inside | positional keeps the drop-in; lazy avoids 20 s of WASM+CRS init when Presto is available; `"none"` gives miners backpressure instead of surprise WASM |
| `verifyProof` / `getVerificationKey` | WASM in v1 with cached VK | native `write_vk` / `verify` operations now (codex) | the miner needs neither; verify's exit-code ambiguity needs its own tests (F-16); kept as A-01 |
| Fixture | commit `square` + `nopub` source, artifact, witness, vk, WASM proof, manifest; verify in CI, regenerate locally | generate in CI with nargo; commit yacana W | CI has no nargo; W belongs to yacana and is 300 KB per witness; an env-gated local W cross-check is offered instead |
| Playground witness | committed `witness.gz` | execute with `@aztec/noir-noir_js` in-page | no new `@aztec` dependency, no bunfig exclude churn; the demo compares provers, not witness generation |
| Publish tooling | parameterize scripts by a closed package descriptor + one `_publish-npm.yml` | clone per package | three copies of ~130-line scripts is the rot the code-organization rule forbids |
| Real-bb test home | new `presto.yml` job running the `#[ignore]`d Rust test + sdk-noir live e2e via a shared composite action | extend `smoke` (main v1, codex) | `smoke` is deliberately bb-free and fast; a separate job keeps that guard |
| Arc order | route → publish tooling → core → noir → playground/docs | route → core → noir → tooling (main v1) | core cannot be published, and thus the SDK cannot be released, until the tooling knows two packages |
| Directory names | `packages/sdk-core`, `packages/sdk-noir` | `packages/presto-core`, `packages/presto-noir` | `packages/presto/core` is already the Rust crate (recon collision 8) |

---

## Phases

Fast layers on every gate: `bun run lint`, `bun run test` (typecheck + unit chains, which grow with each new package), and for Rust phases `bun run lint:rust && bun run lint:clippy` (all three crates, `--all-targets`, `-D warnings`) plus `cargo test --locked` in `packages/presto/core`, `packages/presto/server`, and `packages/presto/src-tauri`; `cargo check --target x86_64-pc-windows-gnu --lib` from `src-tauri` whenever platform-gated code moves. `bun run lint:actions` whenever a workflow changes. Wherever a phase below says "cargo fmt --check && cargo clippy -- -D warnings && cargo test", read it as this line. On this box `~/.cargo/bin` is not on the tool shell's PATH; prefix Rust commands with `PATH="$HOME/.cargo/bin:$PATH"`.

### Arc 1 — app route (shippable alone; app release first)

**Phase 1 ✓ (2026-09-07, gate green; lessons/phase-1.md) — Fixtures and regeneration script.** Commit `fixtures/noir/square/` (`fn main(x, y: pub) -> pub Field { assert(x*x == y); pedersen_hash([x, y]) }`, 19 ACIR opcodes / 28,680 gates, 2 public inputs) and `fixtures/noir/nopub/` (zero public inputs), target `noir-recursive-no-zk` recorded in each manifest and passed explicitly by every consumer: `Nargo.toml`, `src/main.nr`, `Prover.toml`, `circuit.json`, `witness.gz`, and — all generated by bb.js WASM (`BackendType.WasmWorker`) so native output can be checked against them — `vk` (`getVerificationKey`), `proof` + `public_inputs` (`generateProof`), plus `manifest.json` (sha256 per file, nargo/bb/bb.js versions, target, field counts). `scripts/noir-fixture.ts --verify | --regenerate` (regenerate needs `aztec-nargo` + the installed bb.js native `bb`, local only) with `noir-fixture.test.ts`. `scripts/update-aztec-version.ts` gains a fixture-staleness check (bump → `noir-fixture.ts --verify` fails until regenerated) and, in later phases, `packages/sdk-noir/package.json` and the playground's direct `@aztec/bb.js` join its lockstep set so one bump cannot leave two bb.js versions in the tree.
Gate — `bun run test:scripts && bun run typecheck:scripts && bun run lint`; `bun scripts/noir-fixture.ts --verify` exit 0. Layers: lint/typecheck, unit.

**Phase 2 ✓ (2026-09-07, gate green; lessons/phase-2.md) — `bb.rs`: `run_bb`, `VerifierTarget`, `prove_ultra_honk`.** Extract the runner (chonk tests unchanged), add the sibling function and its fake-bb tests: exact argv for `-k` vs `--write_vk`, three input files written 0600, `proof`/`public_inputs`/`vk` read with caps, empty `public_inputs` accepted, missing output → error, oversize → error, timeout → kill tree.
Gate — `cd packages/presto/core && cargo fmt --check && cargo clippy -- -D warnings && cargo test`; `cargo check --target x86_64-pc-windows-gnu --lib` from `src-tauri`. Layers: lint, unit.

**Phase 3 ✓ (2026-09-07, gate green; lessons/phase-3.md) — `prove.rs` split into `admit` / `acquire_prover`.** Behaviour-preserving for chonk (`admit(Chonk)` takes no origin slot; no approval re-check).
Gate — `cd packages/presto/core && cargo test` with **zero edits to existing tests**; `cd packages/presto/src-tauri && cargo test`. Layers: unit, integration (router, fake bb).

**Phase 4 ✓ (2026-09-08, gate green; lessons/phase-4.md) — Handler, route, health, per-origin slot.** `ultra_honk.rs`, `ProveError` variants, route mount, `API_VERSION`, `schemes` + `versions`, per-origin slot (cap 4) in `admit(UltraHonk)`, inflate dry-run owning the permit inside `spawn_blocking` with the cancellation flag, revocation generation in `authorization.rs` and the re-check, router tests listed in the change map (incl. per-origin 429 with five concurrent requests, revoked-while-queued 403, fresh-approval-with-failed-persist still proves, disconnect-mid-inflate releases the permit only after the worker exits); `packages/presto` UI tests untouched.
Gate — core + src-tauri `cargo fmt --check && cargo clippy -- -D warnings && cargo test`; `bun run --cwd packages/presto test:unit`; `bun run --cwd packages/presto test:e2e:ui`. Layers: lint, unit, integration.

**Phase 5 ✓ (2026-09-08, gate green; lessons/phase-5.md) — Real-bb CI job, HTTP smoke, headless `--port`.** `core/tests/ultra_honk_real_bb.rs` (`#[ignore]`, in-process router with the real bb: the six targets bb 5.2.0 proves + `bb verify`, the starknet pair pinned as bb's own `prove_failed` refusal (F-25), byte equality for the `*-no-zk` targets, `--write_vk` returns the fixture vk, tampered proof fails) **and** `packages/presto/scripts/ultra-honk-smoke.ts` (+ unit test of its pure parts) that POSTs the fixtures over HTTP to a launched `presto-server --allow-all --port <n>` (per-run `PRESTO_HOME` on real disk) and asserts 200, proof/public_inputs equality (fixture target passed explicitly), and native `bb verify` — the first real HTTP consumer, so arc 1 is proven end to end without any SDK. `presto.yml` job `ultra-honk-real-bb` (job-level `permissions: contents: read` — `presto.yml` has no top-level block; setup-presto with prebuild on, `install-tauri-system-deps: "false"`, `BB_BINARY_PATH`, CRS cache keyed by bb version) runs both and joins `presto-status`'s `needs`/result lists; composite action `.github/actions/start-headless-presto` (build + launch on a chosen port with a per-run `PRESTO_HOME` + poll + teardown of the owned process group; reused in arc 4); a two-servers-coexist test; `.github/filters/presto.yml` (`headless_server`, `sdk_integration`: `fixtures/noir/**`, `packages/presto/core/tests/**`, the smoke script); `PRESTO_HOME` override + `start_on(state, port)` in core + `presto-server --port` refusing to run without an isolated `PRESTO_HOME`. Also here: the wrong-circuit VK probe as a Rust real-bb test (F-21).
Gate — `bun run lint:actions && bun run --cwd packages/presto test:unit && bun run test:scripts` (filter contract test); locally `cargo test --test ultra_honk_real_bb -- --ignored` with `BB_BINARY_PATH` → green and the smoke script → exit 0 against a locally launched server on a registry-allocated port; `presto.yml` dispatched on the branch (`workflow_dispatch` bypasses the filters; `presto.yml` is already registered on main) with the new job green. Layers: lint, unit, integration with the real bb (in-process and over HTTP).

**Phase 6 ✓ (2026-09-08, gate green; lessons/phase-6.md) — WebDriver desktop e2e.** `packages/presto/e2e-webdriver/ultra-honk.spec.ts`, **added to the explicit `specs` list in `wdio.conf.ts`** (between `auth-flow` and `autostart`): unknown origin → popup → Allow → 200 → proof bytes == fixture for the fixture's `*-no-zk` target, plus sidecar `bb verify` exit 0 as a separate assertion (a byte mismatch on any platform is a real finding to surface, I-01 — never a silent downgrade to "verifies"); denied origin → 403 without execution; bad `verifier_target` → 400 without a re-prompt.
Gate — `bun run --cwd packages/presto test:e2e:webdriver` locally (Linux); `presto.yml` dispatched on the branch with the `e2e-webdriver` matrix (macOS/Linux/Windows) green (`_e2e-webdriver.yml` is `workflow_call`-only; `presto.yml` is its dispatchable caller). Layers: e2e (real app, real bb).

**Phase 7 ✓ (2026-09-08, gate green; lessons/phase-7.md) — App docs.** `packages/presto/README.md` (route contract, `/health` example with `schemes`/`versions`, trust-boundary note), `CLAUDE.md` current-state bullets, `docs/RELEASE_RUNBOOK.md` note that the next app minor carries the route (A-03).
Gate — `bun run test` (doc-sync tests) + `bun run lint`. Layers: lint, unit.

### Arc 2 — npm publish tooling generalization (behaviour-preserving)

**Phase 8 ✓ (2026-09-08, gate green; lessons/phase-8.md) — Scripts.** `scripts/npm-packages.ts`: closed descriptor `{ presto: { dir: "packages/sdk", versionMode: "aztec-derived", consumerProfile: "presto" }, "presto-core": { dir: "packages/sdk-core", versionMode: "manifest", … }, "presto-noir": { … } }` (the two new entries land with their packages; the descriptor and validation land here). `versionMode: "manifest"` never auto-suffixes: an already-published manifest version is either reused (identical tag + verified provenance, per the `all` semantics) or a hard failure demanding a bump — the `-revision.N` suffix (a prerelease that sorts below the base and that promotion would tag `latest`) stays exclusive to `aztec-derived`. `--package` on `get-sdk-publish-version.ts`, `sdk-release-verification.ts` (package name through `verifyProvenanceStatement`/purl/source dependency), `verify-sdk-package-signatures.ts`, `promote-sdk-latest.ts`; `preparePublishManifest(pkg, version, workspaceVersions)` rewriting `workspace:*`; `sdk-tarball-consumer.sh <tarball> <profile-dir>` with today's inline heredocs moved to `scripts/tarball-consumer/presto/`. All existing tests pass; new tests cover the descriptor, the rewrite, wrong-package provenance rejection, and the exact-pin fail-closed rule.
Gate — `bun run test:scripts && bun run typecheck:scripts && bun run lint` (shellcheck). Layers: lint/typecheck, unit.

**Phase 9 ✓ (2026-09-08, gate green; lessons/phase-9.md) — Workflow.** `_publish-sdk.yml` → `_publish-npm.yml` (inputs `package`, `dist_tag`, `release_asset`; `environment: npm-publish`; declares `id-token: write` + `contents: write`, which the **calling job in `release-sdk.yml` delegates exactly as today** — no OIDC in build/test jobs; npm trusted publishing stays configured against the top-level `release-sdk.yml`, per its existing comment). `release-sdk.yml` calls it for `presto` unchanged and gains a `packages` choice (`presto` default | `presto-core` | `presto-noir` | `all`) with this DAG: **up-front preflight** of every selected candidate for the checks that need no registry dependency (identity, version collision, own provenance inputs, core-unchanged-since-tag when core is already published); for `all`, a dependency whose exact manifest version is already published with a matching tag and verified provenance is **reused, not republished, and not treated as a collision**; publish core → verify it → **only then** run the dependency-provenance checks and the registry-core consumer reruns for the adapters (deferred, because an unpublished core cannot be verified earlier) → publish adapters; a `dry_run` input (pre-flight only, no publish) that **reports which dependency checks were deferred**; a release-DAG test covering a previously unpublished core; documented recovery after a partial publish (fix forward: bump the failed package, rerun with the same selection; never delete). `sdk-release-contract.test.ts` parameterized over the descriptor (asserts no `NPM_TOKEN`, OIDC only at the call edge); runbook: trusted-publisher registration for the two new names is an owner action before the first publish.
Gate — `bun run lint:actions && bun run test:scripts`; `sdk.yml` dispatched on the branch with the tarball-consumer job green. The `release-sdk.yml` `dry_run` cannot run from a branch (it asserts `refs/heads/main`); it is exercised by the owner from main after merge, recorded as a Delivery follow-up, not a phase gate. Layers: lint, unit, packaged-artifact.

### Arc 3 — `presto-core` and `presto` on core

**Phase 10 ✓ (2026-09-08, gate green; lessons/phase-10.md) — Scaffold `packages/sdk-core`.** package.json (`exports: ./src/index.ts`, `files`, `publishConfig`, `prepublishOnly`), tsconfig, README skeleton + doc-sync test, root `workspaces` + `test:unit`/`test:typecheck` chains, descriptor entry.
Gate — `bun run test`. Layers: lint/typecheck.

**Phase 11 ✓ (2026-09-08, gate green; lessons/phase-11.md) — Move transport, add `PrestoClient`, re-base `PrestoProver` (one phase: the SDK imports these modules locally, so the move and the consumer migration must land under one gate).** `git mv` transport/errors/logger/types + tests into `packages/sdk-core`; `PrestoClient` with the hoisted policy and the moved decision-table tests; `legacy-wire-compatibility.test.ts` (moved) still replays the historical `/prove` contract; `PrestoProver` re-based on `PrestoClient` with the barrel re-exporting the same names; `public-contract.test.ts` green; the existing chonk regressions (`packages/sdk/e2e/proving.test.ts` native-path phase trail, `legacy-compatibility.test.ts`) retained; `scripts/published-playground.ts` and the packaged-e2e SDK swap script (+ tests) resolve `workspace:*` to the pinned core version and assert the installed core matches; `MIGRATION.md` note (core is a dependency; no API change).
Gate — `bun run --cwd packages/sdk-core test:unit && bun run --cwd packages/sdk-core test:lint && bun run --cwd packages/sdk-core build`; `bun run --cwd packages/sdk test:unit && bun run --cwd packages/sdk test:lint && bun run --cwd packages/sdk build`; `bun run --cwd packages/playground typecheck && bun run --cwd packages/playground test:unit && bun run --cwd packages/playground test:e2e`; `bun run test`. Layers: lint/typecheck, unit, integration (`Bun.serve` round trip), e2e (mocked).

**Phase 12 ✓ (2026-09-08, gate green; lessons/phase-12.md) — CI.** A reusable `_ts-package-ci.yml` (`workflow_call`, input `package` from the descriptor: lint/typecheck/unit/tarball-consumer with that package's profile, plus optional `identity`/`live` jobs used by `presto-noir`); `sdk.yml` — already registered on main, hence dispatchable on the feature ref — gains a `workflow_dispatch` input `package` (default `presto`) that invokes the reusable for any descriptor entry; the per-package PR gates `sdk-core.yml` (and later `sdk-noir.yml`) are thin `pull_request` callers of the same reusable (they become dispatchable only after merge, which is why the gate below dispatches `sdk.yml`); `sdk.yml` and `app.yml` paths gain `packages/sdk-core/**`; the sdk consumer profile installs packed sdk against the packed candidate core pre-merge (bootstrap mode) and against the registry core in the release rerun; `release-sdk.yml` `all` publishes core, reruns the presto consumer against registry core, then publishes presto.
Gate — `bun run lint:actions && bun run test:scripts`; `sdk.yml` dispatched on the branch with `package=presto-core` and with `package=presto` (its e2e lane with `build_presto: true` included, native chonk parity) both green. PRs do not exist before Delivery, so dispatch of a registered workflow is the gate. Layers: lint, unit, packaged-artifact, e2e (sandbox + native presto in CI).

**Phase 13 — (merged into 11–12; number kept so later references stay stable).**

### Arc 4 — `presto-noir`

**Phase 14 ✓ (2026-09-08, gate green; lessons/phase-14.md) — Adapter and workflow scaffold.** `packages/sdk-noir` package (peer `@aztec/bb.js`, dev `5.2.0`), `PrestoUltraHonkBackend`, `proof-data.ts`, unit tests: mocked `fetch` route table; spy on the real `UltraHonkBackend`/`UltraHonkVerifierBackend` to prove fallback engaged or not; every row of the decision table incl. `schemes`, 404, `fallback: "none"` (throws from `generateProof` only; `verifyProof`/cold `getVerificationKey` run locally); VK cache keyed by `(bbVersion, verifierTarget)` and the seed's target binding; `verifyProof` never uses a server-returned key; `verifier_target` default resolution equals bb.js's; `ProofData` conversion against the fixtures incl. empty public inputs; `resolveVerifierTarget` shared by all three methods with legacy-flag and conflict tests; `bbVersion` tested-pairing validation. `sdk-noir.yml` scaffolded here as a thin `pull_request` caller of `_ts-package-ci.yml`, descriptor entry.
Gate — `bun run --cwd packages/sdk-noir test:unit && bun run --cwd packages/sdk-noir test:lint && bun run --cwd packages/sdk-noir build`; `bun run test`; `bun run lint:actions`; `sdk.yml` dispatched with `package=presto-noir` green. Layers: lint/typecheck, unit.

**Phase 15 ✓ (2026-09-08, gate green; lessons/phase-15.md) — Byte identity and live e2e** (both outside the hermetic `test:unit` chain, under `packages/sdk-noir/e2e/` with their own scripts). `e2e/wasm-identity.test.ts` (`test:identity`): forced-WASM (`BackendType.WasmWorker`, proven to run under Bun 1.4 by the yacana spike script, F-19) proof + VK of each fixture == committed `proof`/`public_inputs`/`vk`; `e2e/native.test.ts` (`test:e2e`): constructed with `fallback: "none"`, asserts the phase trail contains `transmit` and never `fallback` (a WASM fallback cannot pass), adapter proof == fixture for the fixture target, `vk` returned when omitted, `verifyProof` true; **in CI the live environment is required** (`PRESTO_URL` unset → the suite fails, no silent skip; `PRESTO_NOIR_SKIP_LIVE=1` is the explicit local opt-out); optional `describe.skipIf(!PRESTO_NOIR_W_FIXTURE_DIR)` cross-check against yacana W's artifact/witness/vk on a dev box. `_ts-package-ci.yml` gains the `identity` job (CRS cached) and the `live` job using `start-headless-presto` for `presto-noir`.
Gate — `bun run --cwd packages/sdk-noir test:identity` green locally; `sdk.yml` dispatched with `package=presto-noir` and both jobs green; `bun run test` stays hermetic and fast. Layers: integration (WASM), e2e (live headless + real bb).

**Phase 16 ✓ (2026-09-08, gate green; lessons/phase-16.md) — Tarball profile and release addition.** `presto-noir` consumer profile (host installs `@aztec/bb.js@5.2.0` and core — the packed candidate pre-merge, the registry artifact in the release rerun; asserts a singleton bb.js; asserts a clear error when the peer is absent), `release-sdk.yml` `all` = core → (rerun consumers against registry core) → noir → presto with **Noir's production gates at the release SHA**: the identity job, the live job against a headless build of that SHA, and the consumer profile must pass before `presto-noir` publishes (the existing chonk e2e gate stays for `presto`); `published-playground.ts` + the swap script extended to `presto-noir` and core; README + doc-sync test.
Gate — `bun run lint:actions && bun run test:scripts`; `sdk.yml` dispatched with `package=presto-noir` and green incl. the consumer job. Layers: lint, unit, packaged-artifact.

### Arc 5 — Playground and docs

**Phase 17 ✓ (2026-09-08, gate green; lessons/phase-17.md) — Noir panel.** `packages/playground/src/noir.ts` (+ test): load `fixtures/noir/square` via `new URL(..., import.meta.url)`, `PrestoUltraHonkBackend` seeded with the fixture VK, WASM-vs-Presto proving with timings and a "proof identical to fixture" check, reusing `appendLog`/`setStatus`/`SparkOrbitController` (`AnimationPhase` + `noir:*`); `index.html` section; direct `@aztec/bb.js@5.2.0` + `@alejoamiras/presto-noir` (`workspace:*`); `vite.config.ts` `resolve.dedupe` for `@aztec/bb.js`; `app.yml` paths gain `packages/sdk-noir/**` and `fixtures/noir/**`; the playground's direct `@aztec/bb.js` and `packages/sdk-noir/package.json` join `update-aztec-version.ts`'s lockstep set.
Gate — `bun run --cwd packages/playground typecheck && bun run --cwd packages/playground test:unit && bun run --cwd packages/playground build`. Layers: lint/typecheck, unit.

**Phase 18 ✓ (2026-09-08, gate green; lessons/phase-18.md) — Mocked and smoke e2e.** `e2e/noir.mocked.spec.ts`: `page.route` on `/health` (with `schemes`) and `/prove/ultra-honk` on both loopback URLs, asserting request shape and rendered result; offline-Presto case using a **test-only stub WASM backend** (selected by a URL param the way `?httpsOnly=true` is today; returns the fixture `ProofData` deterministically) so the fallback phase, log line, and UI state are asserted while the spec **blocks and fails on** any CRS or bb.js worker network request — the mocked project stays network-free like the existing suite. One real-browser Noir fixture proof (real WASM, then Presto when present) is added to the `smoke` project so browser worker packaging stays a release guarantee.
Gate — `bun run --cwd packages/playground test:e2e` (mocked project); `bun run --cwd packages/playground test:e2e:smoke` locally. Layers: e2e (mocked), e2e (real browser WASM).

**Phase 19 ✓ (2026-09-08, gate green; lessons/phase-19.md) — Docs.** Root `README.md` (Packages table rows, "For Noir circuits" quick start mirroring the SDK block), `packages/sdk-core/README.md`, `packages/sdk-noir/README.md` (install, drop-in example, options, fallback semantics, compat matrix, tested bb.js pair), `packages/sdk/README.md`, `docs/RELEASE_RUNBOOK.md` (three-package release + promotion), `packages/presto/VERIFIED_SITES.md` (entry process) plus the `verified-sites.json` entry for `https://yacana.network` (A-06; apex only, no preview hosts), `CLAUDE.md`.
Gate — `bun run test` (doc-sync tests) + `bun run lint`. Layers: lint, unit.

---

## Delivery

Multi-arc, stacked PRs via `gh stack` (installed: `github/gh-stack` v0.1.0). `code_review: off` for every arc.

| Arc | Branch | Phases | Stacks on | Revert story |
|---|---|---|---|---|
| 1 `noir-route` | `worktree-presto-noir` (adopted as layer 1) | 1–7 | main | leaves an unused route + fixtures; app release (`release-presto.yml`) can go out with the route before any npm package |
| 2 `npm-tooling` | `presto-noir/npm-tooling` | 8–9 | arc 1 | behaviour-preserving tooling; SDK release path unchanged |
| 3 `sdk-core` | `presto-noir/sdk-core` | 10–12 | arc 2 | reverts to the single-package SDK; published core stays inert |
| 4 `sdk-noir` | `presto-noir/sdk-noir` | 14–16 | arc 3 | additive package |
| 5 `playground-docs` | `presto-noir/playground-docs` | 17–19 | arc 4 | additive UI + docs |

`gh stack init --adopt worktree-presto-noir` at the start; `gh stack add <branch>` at each boundary after that arc's codex loop converged; `gh stack submit --auto` only in the Delivery step; `gh stack merge` is the owner's call. App release after arc 1 (next minor, A-03); npm publishes after arcs 3/4 (core first). Owner follow-ups after merge (not agent actions): register the two new package names with npm trusted publishing; run `release-sdk.yml` with `dry_run` from main before the first real three-package publish.

Compatibility claims in the matrix below are about the wire protocol; "native for the requested `bbVersion`" additionally requires that bb release's CLI to accept the same flags (tested only for 5.2.0 — the tested pair is documented and the adapter's peer range is A-02).

### Compat matrix

| Client \ App | app without the route (`schemes` absent) | app with the route (`schemes` has `ultra_honk`) |
|---|---|---|
| `@alejoamiras/presto` (any published version) | native chonk, unchanged | native chonk, unchanged |
| `@alejoamiras/presto` on core (new) | native chonk, unchanged | native chonk, unchanged (`schemes` surfaced in status) |
| `@alejoamiras/presto-noir` | WASM (phase `version-mismatch`; a stray 404 is also classified as fallback) or a typed error with `fallback: "none"` | native `ultra_honk` for the requested `bbVersion` when cached/downloadable; classified fallback otherwise |
| `@alejoamiras/presto-core` | `api_version` 1 recognised | `api_version` 1 recognised |

---

## Security & Adversarial Considerations

**Threat model.** (1) A malicious *approved* origin (or any no-Origin local process, which auth already trusts): resource exhaustion via crafted inputs and sustained CPU — it already controls the bytes bb parses through `/prove` (F-01); the route is the same class. (2) An *unapproved* origin: `admit` runs `authorize_origin` before any byte of the job is parsed; the only new public bit is the static `schemes` list (a two-bucket old/new-app signal, accepted). (3) DNS rebinding: the loopback Host guard is router-wide. (4) Supply chain: three published packages, a peer dependency, new workflows, no new `@aztec` dependency in the repo. (5) CI: new jobs must not gain write scopes.

**Ingress validation.** Before download/lease/permit, on the runtime thread: JSON via `serde_json` (default recursion limit), required fields, duplicate-key rejection, typed `VerifierTarget` (never a string in argv), encoded-length caps that bound the decoded sizes (16 MiB / 32 MiB / 64 KiB), fixed filenames, no client-supplied paths, URLs, CRS locations, or command fragments; `reject_declared_oversize`, `read_body` cap/timeout, and the inflight cap are reused. Under the prove permit, owned by the blocking worker for its whole life: base64 decode (padding-indifferent), gzip magic, the capped inflate dry-run (256 MiB) with cancellation checks, and the tempdir writes, bracketed by the revocation check. These caps are resource policy, not measured circuit requirements: small inputs can still describe expensive computations, so the real boundary stays bb's contained process (own group/Job Object, kill tree on timeout or disconnect, 300 s cap, capped stderr, single prove permit, `HARDWARE_CONCURRENCY` from the speed setting). Egress: `read_capped` + alignment on `proof`/`public_inputs`, VK cap, stderr retained ≤ 64 KiB and never returned; tempdir paths never reach the client. A client-supplied VK is that client's own integrity concern (a wrong VK yields a proof its verifier rejects; malformed bytes fail closed, F-05); `--write_vk` output is recomputed from the bytecode each time, so the server never persists or reuses a VK.

**Sustained-CPU abuse (mining).** In scope now: the single FIFO permit means another site's request waits behind whatever is queued (bounded by the inflight cap, ~1 s per W proof, not "one proof"); at most 4 UltraHonk jobs per origin (half the inflight cap), the slot taken right after authorization and before the body is buffered — admission fairness only: it stops one Noir origin from shedding every other site to WASM, but the same origin can still fill the cap via chonk `/prove`, two Noir origins can fill it together, and a shed request burns WASM CPU on the same machine unless the dApp chose `fallback: "none"`; the inflate dry-run runs under the prove permit owned by the worker (one at a time, disconnect-safe); revocation is re-checked after the permit on the UltraHonk path so a Settings "remove" applies to queued work (a fresh approval whose persist failed is not a revocation); `scheme`, canonical origin, and `elapsed_ms` are logged at info to feed the metering follow-up; the speed setting and `PROVE_TIMEOUT` cap each job. Deferred: cumulative per-origin time and one-click revoke in the tray; lifetime quotas (they would break the motivating consumer).

**Least privilege.** New workflows default `permissions: contents: read`; `id-token: write` + `contents: write` appear only on the publish call edge — declared by `_publish-npm.yml`'s publish job (environment `npm-publish`) and delegated by the calling job in `release-sdk.yml`, exactly as today — never in build/test/identity/live jobs; npm trusted publishing is configured against `release-sdk.yml` (the top-level workflow) for each package name; no `NPM_TOKEN` anywhere (contract test); PR Rust caches restore-only as today.

**Supply chain.** `bun.lock` committed, `--frozen-lockfile` in CI, 7-day `minimumReleaseAge` with the `@aztec/*` excludes unchanged (no new `@aztec` dependency; the playground's direct `@aztec/bb.js@5.2.0` is already in the lock), trusted publisher + `--provenance` for all three packages with provenance and signature verification after publish (parameterized scripts), SHA-pinned actions (`action-pins.test.ts` covers new files). Peer dependency on `@aztec/bb.js`: the consumer's lockfile chooses the bb.js; the tested pair (5.2.0) is documented and asserted by the byte-identity test; the tarball profile asserts a singleton copy.

**Run isolation.** Integration harnesses take their port from the host registry (`presto-server --port`), run with a per-run `PRESTO_HOME` on real disk (private config, version cache, prove workspaces, and logs, because cache eviction and workspace reaping assume the port winner is the only instance; bb's CRS cache stays shared under its own lock), use owned process groups, and always tear down.

**Frontend.** The playground proves a committed fixture only; no user-supplied ACIR; no `innerHTML` from server data; COOP/COEP unchanged.

**Cryptography.** None new: Barretenberg (bb 5.2.0 native, bb.js 5.2.0 WASM) does all proving/verification.

---

## Assumptions

### Facts (verified)

- F-01 `/prove` hands the raw body to bb: `packages/presto/core/src/server/prove.rs:348`; guard sequence and drop order `prove.rs:224-379`. (At 667da60: `bb::prove` at 278, handler 216–309 over the helpers listed in the re-index table.)
- F-02 Router and layers: `packages/presto/core/src/server.rs:346-379`; the headless binary calls `presto_core::server::start(state)` (`packages/presto/server/src/main.rs:94-110`), which builds `router(state)` and binds the `PORT` const (`server.rs:264-266`); HTTPS listener `src-tauri/src/server/tls.rs:31`.
- F-03 bb 5.2.0 `prove --scheme ultra_honk` fails without `-k` (`./target/vk`), also with `--vk_policy recompute`; `--write_vk` without `-k` succeeds and writes `vk` + `vk_hash` (main agent, this box, 2026-09-07).
- F-04 Timings on yacana W, 12 threads: `-k` 1.22 s, `--write_vk` 1.48 s, `write_vk` 0.52 s, `verify` 7 ms; proof sha256 `57799830…` equals yacana's WASM-produced fixture; identical with 4 threads and from raw gz bytecode.
- F-05 Corrupted/random VK and random bytecode make bb exit 1 with no output files.
- F-06 bb.js 5.2.0 `UltraHonkBackend(acirBytecode: string, api: Barretenberg)`, `generateProof → {proof: Uint8Array, publicInputs: "0x"+64-hex[]}`, `deflattenFields` (`dest/node/proof/index.js:16-49`), `Barretenberg.new` backend order in Node/Bun: `NativeUnixSocket` → **`Wasm` (single-threaded)**; `WasmWorker` is only the browser default (`dest/node/barretenberg/index.js:25-59`), so every Bun-side WASM test/regeneration must pass `backend: BackendType.WasmWorker` explicitly; `BackendType.{Wasm, WasmWorker, NativeUnixSocket, NativeSharedMemory}` (`bb_backends/index.d.ts:4-12`). bb.js's implicit target when `verifierTarget` is omitted is `noir-recursive` **with ZK** (`backend.js:69-75`).
- F-07 `api_version` literal `1` at `server.rs:418,436` (667da60: 421, 439), `server/probe.rs:51-54`; SDK `PRESTO_API_VERSION` (`packages/sdk/src/lib/types.ts:13`) checked by equality in `presto-transport.ts:265-269`; validators tolerate unknown keys (`presto-transport.ts:288-321`, `packages/landing/src/presto-detection.ts:156-197`).
- F-08 Aztec version == `@aztec/bb.js` npm version == bb release tag: `packages/presto/scripts/copy-bb.ts:228-235`, `core/src/versions/version_policy.rs:240-249`; nothing runs `bb --version` (`version_policy.rs:292-294`); `bb --version` prints `5.2.0-nightly.20260807`.
- F-09 `presto-transport.ts` has zero `@aztec/*` imports; `types.ts:1` imports `CircuitSimulator` only for `PrestoProverOptions`; `scripts/prepare-sdk-publish.ts:17` preserves dependencies verbatim.
- F-10 No `peerDependencies` anywhere in `packages/*/package.json`; SDK F13 chose deps (`scripts/sdk-tarball-consumer.sh` header).
- F-11 `smoke` job builds + launches `presto-server` and curls `/health` only, with `run-prebuild: "false"` (`.github/workflows/presto.yml:400-479`). Real-bb chonk coverage exists in the SDK e2e lane (`packages/sdk/e2e/proving.test.ts:83-105` asserts `transmit` without `fallback` against a built presto); there is no generic UltraHonk fixture test anywhere.
- F-12 `@aztec/noir-types`, `@aztec/noir-acvm_js`, `@aztec/noir-noirc_abi`, `@aztec/bb.js@5.2.0` are in `bun.lock` and the `bunfig.toml` excludes; `@aztec/noir-noir_js` is not in the lockfile (and is not added by this plan).
- F-13 `gh stack` v0.1.0 and `agent-worktree` are installed; codex login OK; `aztec-nargo` 1.0.0-beta.25 at `~/.aztec/current/bin` (Aztec 5.2.0).
- F-14 Playground mocked e2e intercepts fixed loopback URLs via `page.route` (`packages/playground/e2e/demo.mocked.spec.ts:35-41`); Vite sets COOP/COEP and resolves bb.js workers through `@aztec/bb-prover` (`vite.config.ts:20-77`); `CappedReader` exists (`core/src/versions/downloader.rs:429`).
- F-15 A zero-public-input circuit makes bb write an **empty** `public_inputs` file and still verifies (probe `nopub`, this box).
- F-16 `bb verify` exits 1 both on a tampered proof (`Proof verification failed`) and on a target-size mismatch; 0 with `Proof verified successfully`.
- F-17 Proof/VK sizes depend on the target's hash family (`evm` 8,384 B / vk 1,888 B; `noir-recursive-no-zk` 13,120 B / 3,680 B; `noir-rollup-no-zk` 15,360 B / 3,680 B); VK equal between zk and no-zk variants of one family; all outputs 32-byte aligned; proof size independent of circuit size.
- F-18 Probe fixture `square` compiles with aztec-nargo beta.25 (Poseidon2 is no longer in std; pedersen is): 19 ACIR opcodes, 28,680 gates, PK 34 ms, artifact 90 KB, witness.gz 211 B.
- F-19 bb.js `BackendType.WasmWorker` with N threads runs under Bun 1.4 (yacana's `packages/work-circuit/scripts/wasm-prove.ts:27` does exactly that; its 6.31 s W timing is that path).
- F-20 `app.yml`'s `relevant` filter lists `packages/playground/**` and `packages/sdk/**` only (`.github/workflows/app.yml:26-40`); `authorize_origin` returns `Result<(), ProveError>` (`core/src/server/auth.rs:15-18`).
- F-21 A valid VK from a *different* circuit (`nopub`'s vk for `square`) under `--vk_policy default`: bb exits 0 and writes a proof; `bb verify` against the correct VK exits 1 (`Proof verification failed`). No crash, no hang — the wrong VK harms only that client's own proof (was I-03).
- F-22 Prove workspaces, the startup reaper, and logs live under `runtime_data_dir()` = `dirs::data_local_dir()/presto` (`core/src/lib.rs:30`, `bb.rs:94`), not under the home-dir `.presto` tree.
- F-23 `remove_approved_origin` (`src-tauri/src/commands.rs:404-414`) is a config-only `retain`; `authorize_origin` reads approval from `state.config` directly (`auth.rs:44-50`) and each popup waiter persists its own `Allow` (`auth.rs:45-135`) — no ordering with respect to removals exists today.
- F-24 bb.js 5.2.0 `UltraHonkBackend` also exposes `getSolidityVerifier(vk, options)` and `generateRecursiveProofArtifacts(proof, numPublicInputs, options)` (`backend.d.ts:52-53`).
- F-25 bb 5.2.0 lists `starknet` / `starknet-no-zk` after `-t` but refuses both at prove time with `Invalid proof system settings: oracle_hash_type='starknet', disable_zk=…, ipa_accumulation=0` (exit 1); the other six targets prove and `bb verify`. The route passes the strings through unchanged, so a bb that adds them needs no Presto change; `starknet_targets_are_refused_by_bb` flips when that happens.
- F-26 bb.exe 5.2.0 (the Windows release asset) reads the `-k` key file in text mode: the 3,680-byte `square` key came back as 983 bytes, exactly the offset of its first 0x1A byte (`verification key has wrong size: expected 3680, got 983`, run 34181934669); bytecode (which also contains 0x1A) and witness are read in binary mode. Presto sets a client key aside on Windows and lets bb recompute it. Upstream bug to report (owner follow-up). It also WRITES its output files in text mode: the 13,120-byte proof came back as 13,173 bytes, exactly one extra byte per 0x0A (53). `--output_format json` (proof / public_inputs / vk as `0x`-hex 32-byte fields, verified byte-identical to the binary files on Linux) is immune, so Presto uses it on every platform. `-k` accepts only the binary key (a JSON key is refused as `wrong size`). `bb verify` reads its binary inputs the same way and has no JSON input form, so the Windows WebDriver gate asserts byte identity with the bb.js reference and skips the sidecar verification (run 34183869544: byte-identical, sidecar verify false).

### Inferences (unverified — attack these)

- I-01 UltraHonk proof bytes are identical across OS/arch (verified only across thread counts and input forms on one Linux box); the WebDriver spec keeps a sidecar `bb verify` fallback assertion.
- I-02 bb.js WASM proving of the fixtures in Bun with `WasmWorker` completes in seconds and needs one small CRS fetch; cached in CI.
- I-03 (promoted to F-21).
- I-04 The `admit`/`acquire_prover` split holds the four RAII guards in owned structs with the same drop order; the unedited characterization tests are the proof.
- I-05 `npm publish` of a manifest whose `workspace:*` was rewritten to an exact version passes the fail-closed checks and provenance verification unchanged.
- I-06 tokio's `Semaphore` is FIFO-fair, so a non-mining site's wait is bounded by the queue depth (≤ inflight cap) times one proof, not by a single proof.
- I-07 (promoted to F-06) — bb.js's implicit default is `noir-recursive` with ZK, hence randomized; the adapter forwards it as such and never claims byte identity for it.
- I-08 `Uint8Array.fromBase64/toBase64` exist in the supported browsers and Bun (ES2025 target); keep the `Buffer`/`atob` fallback regardless.
- I-09 axum's CORS layer answers preflight for unknown paths, so an old app yields a JS-visible 404 rather than a network error.
- I-10 The Linux `copy-bb.ts` prebuild in a headless-deps-only job costs seconds (copies bb from `node_modules`).
- I-11 `BindOwnedGuard` (`server.rs`, acquired after the bind) feeds a version-floor tracker that only the desktop app consults; a headless `--port` run acquiring it on a non-default port has no effect on the desktop. Confirm in phase 5 before shipping `start_on`.
- I-12 `workflow_dispatch` on a workflow file that has never existed on the default branch is not available from the GitHub API/UI, so new gate workflows are unreachable before merge; invoking their jobs through a reusable workflow from the registered `sdk.yml` is reachable on the feature ref (GitHub's documented rule; the gates in phases 12–16 depend on it).
- I-13 ZK verifier targets produce randomized proof bytes; only `*-no-zk` targets are reproducible (verified for `noir-recursive-no-zk` only, F-04; inferred for the other three).
- I-14 With `PRESTO_HOME` rooting config, the version cache, and the runtime data dir (D-51), nothing else in core writes to shared per-user state during a prove; bb's CRS cache is shared by design under bb's own lock.

### Asks — RESOLVED at the approval gate (2026-09-07)

| Ask | Owner decision |
|---|---|
| A-01 | **Defer** native `verifyProof`/`getVerificationKey`; v1 keeps them WASM; `fallback: "none"` covers `generateProof` only (documented + tested) |
| A-02 | **Exact peer `@aztec/bb.js@5.2.0`**; `bbVersion` defaults to `TESTED_BB_VERSION`; overrides validated; `@alejoamiras/presto-core@1.0.0`, `@alejoamiras/presto-noir@1.0.0`, manifest semver |
| A-03 | The route ships in Presto **1.1.0** (next minor) |
| A-04 | Per-origin UltraHonk admission **cap of 4** (half the inflight cap); chonk uncapped |
| A-05 | **`/harden security` before the first stable publish** of `@alejoamiras/presto-noir` (recorded; not auto-run) |
| A-06 | Origin **`https://yacana.network`** (the miner runs at `https://yacana.network/mine/`, same origin; supplied by the elixir session from the yacana repo's Cloudflare config on 2026-09-07). It is the only production origin: `www.` redirects to the apex; branch/version previews live on `*.workers.dev` hosts and must **not** carry the badge. Lands in Phase 19 as a `verified-sites.json` entry with `curatedBy`/`addedAt` per `VERIFIED_SITES.md`. |
| A-07 | **Keep** the identity `versions` table in `/health` |

Original asks, for the record:

- A-01 Native `getVerificationKey` / `verifyProof` (bb `write_vk` / `verify` operations) now, or defer? Recommendation: defer; v1 keeps them WASM (seeded or WASM-derived VK), which means `fallback: "none"` covers `generateProof` only — a native-only consumer still loads WASM for `verifyProof` or a cold `getVerificationKey`. Codex argues for the native operations now so that contract is genuinely native-only.
- A-02 `@aztec/bb.js` peer range and initial versions: recommendation **exact peer `5.2.0`** for v1 (the wire contract, byte identity, and the CLI flags are tested against 5.2.0 only; widen to a range once a version matrix exists — codex's argument, adopted after the contradiction check; fable/main proposed `>=5.2.0 <6`), and the adapter accepts only `bbVersion` values in its closed tested-pairing list (`["5.2.0"]`) unless `allowUntestedBbVersion: true` — a wider native selection is an explicit compatibility decision, not a default. Initial versions `@alejoamiras/presto-core@1.0.0`, `@alejoamiras/presto-noir@1.0.0`, manifest semver bumped by PR; `@alejoamiras/presto` keeps the Aztec-derived scheme.
- A-03 Presto app version that carries the route (next minor `1.1.0`?), for the compat matrix and docs.
- A-04 Per-origin admission cap for UltraHonk: (a) none (fable: 429 → WASM fallback would silently slow a second tab of an approved dApp; the single permit already serialises); (b) one outstanding per origin (codex); (c) **cap of 4 = half the inflight cap (recommended)** — a miner cannot shed other sites to WASM by filling all eight slots, a multi-tab dApp still queues on the FIFO permit as chonk does. It is admission fairness, not protection (see Security). A miner with `fallback: "none"` sees thrown 429s at its fifth concurrent submission; the presto-noir README tells miners to serialise their own submissions (one proof in flight per worker). Chonk keeps no cap (Phase 0 lock).
- A-05 `/harden security` before the first stable publish of `@alejoamiras/presto-noir`?
- A-06 The yacana browser origin(s) for `verified-sites.json` (not inferred; the miner Worker's page origin is what needs the entry). Note: verified-sites is a recognition badge in the approval popup, not pre-approval — the user still clicks Allow.
- A-07 Keep the identity `versions` array in `/health` (honours the Phase 0 answer) or drop it in favour of documentation only (fable/main v1)?

---

## Decision ledger

| # | Decision | Source | Rejected (by whom) | Status |
|---|---|---|---|---|
| D-01 | Two-stage guard prelude `admit` / `acquire_prover` with owned RAII contexts; `run_bb` extracted in `bb.rs` | codex + fable (convergent) | closure template (main v1); enum handler; duplication | adopted |
| D-02 | Optional VK: `-k` or `--write_vk`, vk returned, client cache + `verificationKey` seed; server stateless | all three | required VK; server VK cache | adopted |
| D-03 | JSON + base64 request/response; unknown keys tolerated | all three (tolerance: fable) | multipart/msgpack/binary; `deny_unknown_fields` (main v1) | adopted |
| D-04 | `api_version` stays 1; `schemes` in **both** health bodies | codex | detailed-only + 404-sticky (main v1, fable); bump to 2 | adopted; 404 still classified as fallback |
| D-05 | Scheme identifiers use bb spelling `ultra_honk`; path `/prove/ultra-honk` | main | `ultra-honk` in `schemes` (codex, fable) | adopted (cosmetic) |
| D-06 | Cheap validation before download/lease/permit; capped inflate dry-run on a blocking worker **under the prove permit** | fable (dry-run) + codex (blocking worker, under permit) | ISIZE trailer only (main v1); dry-run before the permit (v2 draft — reverted at the contradiction check: one origin could run eight concurrent inflates) | adopted |
| D-07 | Identity `versions: [{aztec_version, bb_version}]` in detailed health; `bbVersion` adapter option (~~required~~ — **superseded by D-44**: optional, defaults to the tested version) | codex (array) + fable (option) | docs only (fable, main v1) | adopted per Phase 0 answer; **A-07** lets the owner drop the array |
| D-08 | `@aztec/bb.js` as a **peer** dependency, dev `5.2.0`; tarball profile asserts a singleton; exact `5.2.0` recommended for v1 | peer: main + fable + codex; exact: codex (adopted at the contradiction check) | exact dep (F13 pattern); range `>=5.2.0 <6` (main, fable) | adopted; range is **A-02** |
| D-09 | Constructor `(bytecode, api \| factory, options)` with `fallback: "wasm" \| "none"` | main + fable (positional) + codex (`fallback`) | options-only constructor (codex) | adopted |
| D-10 | `verifyProof`/`getVerificationKey` WASM in v1 with cached VK | fable + main | operation discriminator with native vk/verify (codex) | adopted; **A-01** |
| D-11 | Fixtures `square` + `nopub`, committed source/artifact/witness/vk/WASM proof/manifest; verify in CI, regenerate locally; env-gated W cross-check | main (square) + codex (zero-public-input, WASM at test time) + fable (manifest, `--verify`) | commit yacana W (fable ask); nargo in CI | adopted |
| D-12 | `PrestoClient` in core hoisting probe/pin/generation/F14 table/phases | fable | pure `classifyHealth` only (main v1) | adopted |
| D-13 | Publish tooling parameterized by a closed descriptor; one `_publish-npm.yml`; `release-sdk.yml` remains the single entry; `workspace:*` rewrite fails closed | codex + fable + main | clone per package | adopted |
| D-14 | Arc order route → tooling → core → noir → playground/docs | codex + fable | route → core → noir → tooling (main v1) | adopted |
| D-15 | Real-bb test: new `presto.yml` job + `#[ignore]`d Rust test + shared `start-headless-presto` action; `smoke` stays bb-free | fable | extend `smoke` (main v1, codex) | adopted |
| D-16 | Per-origin UltraHonk admission cap of 4 (slot right after authorization, 429 beyond) + approval re-check after the permit, **UltraHonk path only** | codex (cap) → main (cap size 4 after fable's multi-tab objection) | no cap (fable); one-outstanding (codex); slot after buffering and re-check for both schemes (v2 draft — reverted) | adopted; **A-04** |
| D-26 | `PrestoClient` classifies `404` as `{ kind: "fallback", reason: "route-missing" }` | fable (contradiction check) | throw on unlisted status (today's table) | adopted |
| D-27 | Identity/live tests live under `packages/sdk-noir/e2e/` with `test:identity` / `test:e2e` scripts; `test:unit` stays hermetic | fable (contradiction check) | identity test in the unit chain (v2 draft) | adopted |
| D-28 | Fixture `vk` is WASM-generated; the Rust job asserts native `--write_vk` bytes equal it | fable (contradiction check) | unspecified provenance (v2 draft) | adopted |
| D-29 | `--port` requires isolated state; shared cache across concurrent instances unsupported; two-servers test (~~via per-run `HOME`~~ — **superseded by D-42**: `PRESTO_HOME`, which also roots the runtime data dir per D-51) | codex (double audit) | port-only isolation (v3) | adopted |
| D-30 | Inflate worker owns permit/lease/slots inside `spawn_blocking`, cancellation flag per chunk, revocation check before and after | codex (double audit) | guards held by the request future (v3) | adopted |
| D-31 | Revocation generation in `AuthorizationManager`; re-check rejects only revocations newer than the request's approval (ordering contract in D-52) | codex (double audit) | "absent from persisted config = revoked" (v3) | adopted |
| D-32 | Adapter publish requires core unchanged since its release tag, `all` reuses completed dependency releases, preflight-all-first, fix-forward recovery, Noir production gates at the release SHA; registry core in consumer profiles **during release reruns** (pre-merge bootstrap mode uses the packed candidate — D-53) | codex (double audit) | "exact version on npm" only (v3) | adopted |
| D-33 | Per-origin cap documented as admission fairness, not protection; five-concurrent tests with both fallback modes | codex (double audit) | protection claim (v3) | adopted |
| D-34 | OIDC declared by the reusable, delegated by the `release-sdk.yml` call edge; trusted publisher configured on `release-sdk.yml` | codex (double audit) | "only in the reusable" wording (v3) | adopted |
| D-35 | Byte equality only for `*-no-zk` targets; fixture target passed explicitly everywhere; ZK targets verify-only; mismatches surfaced, never downgraded | codex (double audit) | equality for all targets (v3) | adopted |
| D-36 | `bbVersion` validated against a closed tested-pairing list with an explicit escape hatch | codex (double audit) | free-form `bbVersion` (v3) | adopted; A-02 |
| D-37 | `_ts-package-ci.yml` reusable invoked by a `workflow_dispatch` input on the registered `sdk.yml`; per-package PR gates are thin callers | codex (double audit) | dispatching unregistered new workflows (v3) | adopted |
| D-38 | wdio spec list entry; live e2e uses `fallback: "none"` + phase trail and fails without `PRESTO_URL` in CI; new Rust job in `presto-status` | codex (double audit) | tests that pass on fallback or skip (v3) | adopted |
| D-39 | `published-playground.ts` + packaged-e2e swap script resolve `workspace:*` and assert the installed core | codex (double audit) | absent from the change map (v3) | adopted |
| D-40 | One `resolveVerifierTarget` for all three adapter methods incl. legacy flags and conflicts | codex (double audit) | default-only normalization (v3) | adopted |
| D-41 | Mocked offline case uses a test-only stub backend and fails on external requests; one real-browser Noir proof in the `smoke` project | codex (double audit) | phase-only assertion with real WASM still running (v3) | adopted |
| D-42 | `PRESTO_HOME` data-dir override; `--port` requires it | fable (double audit) | bare per-run `HOME` (v4); skip sweep/reap off-port | adopted — explicit override beats an env trick; sweeping a private tree is harmless |
| D-43 | Decode + magic + inflate + tempdir writes all in the permit-owning blocking worker; only shape/enum/encoded-length checks on the runtime thread | fable (double audit) | decode on the runtime thread (v4) | adopted |
| D-44 | `bbVersion` optional, defaults to the baked tested version (exact peer ⇒ one installable bb.js); override validated | fable (double audit) | mandatory `bbVersion` (v4) | adopted — restores the true drop-in |
| D-45 | `verifyProof` always circuit-bound via WASM `UltraHonkBackend.verifyProof`; a seeded VK serves `-k` and `getVerificationKey`; a server-returned VK serves `-k` only (never verification, never returned) | fable (double audit) | seeded VK via `UltraHonkVerifierBackend` (v4) | adopted |
| D-46 | `PrestoClient.prove` returns parsed JSON under a cap, never a `Response` | fable (double audit) | `Response` in the outcome (v4) | adopted |
| D-47 | `admit(Option<&OriginSlots>)` instead of a `Scheme` enum in the prelude | fable (double audit) | `admit(scheme)` (v4) | adopted |
| D-48 | `versionMode: "manifest"` never auto-suffixes; republish = reuse-if-identical or hard failure | fable (double audit) | shared revision-suffix logic (v4) | adopted |
| D-49 | Distinct 429 code `origin_queue_full`; padding-indifferent base64; job-level `permissions` on the new `presto.yml` job; `--allow-all` cap caveat documented; `update-aztec-version.ts` lockstep additions; verified-sites = badge | fable (double audit) | — | adopted |
| D-50 | Inflate cap stays 256 MiB | main | 64 MiB (fable) | rejected — witnesses of 2^20-gate circuits exceed 64 MiB uncompressed; the cap is a bomb guard, not a policy on circuit size |
| D-51 | `PRESTO_HOME` also roots `runtime_data_dir()` (prove workspaces, reaper, logs); path-resolution tests | codex (final pass) | config + versions only (v5) | adopted |
| D-52 | Approval/revocation ordering contract: one manager mutex wrapping every config read and write of approvals (no separate approved-set mirror), one epoch (`granted_at` = the `Allow` decision's generation, carried to waiters; open prompts not cancelled), delayed popup `Allow` dropped after a newer revocation, failed persistence still grants only the current request, Settings removal calls `revoke` | codex (final pass, rounds 1–2) | comparison-only generation (v4/v5); a manager-held approved-set mirror (v6) | adopted |
| D-56 | Release preflight order: registry-independent checks up front; dependency-provenance and registry-core reruns deferred until core is published and verified; `dry_run` reports deferred checks; unpublished-core DAG test | codex (final pass, round 2) | preflight-all-first incl. dependency provenance (v6) | adopted |
| D-53 | Bootstrap mode: pre-merge consumer profiles use the packed candidate core when the pinned core is unpublished/changed; releases publish core, rerun consumers against registry core, then publish adapters | codex (final pass) | registry-only rule (v4/v5) | adopted |
| D-54 | `getSolidityVerifier` and `generateRecursiveProofArtifacts` delegates + signature pinning; full bb.js surface is the compatibility claim | codex (final pass) | three-method surface (v2–v5) | adopted |
| D-55 | `published-playground.ts` + swap script cover `presto`, `presto-noir`, and core; deployment behaviour defined per release selection | codex (final pass) | Aztec adapter only (v4/v5) | adopted |
| D-22 | VK cache keyed by `(bbVersion, verifierTarget)`; `fallback: "none"` scoped to `generateProof`; ~~`verifyProof` may use the seeded VK~~ — **superseded by D-45** (always WASM circuit-bound) | codex (contradiction check) | unqualified cache; server VK trusted for verification (v2 draft) | adopted |
| D-23 | Phase 5 proves arc 1 over real HTTP (`ultra-honk-smoke.ts` against a launched `presto-server`) in addition to the in-process real-bb Rust test; `start_on(state, port)` in core | codex (contradiction check) | in-process test only (v2 draft) | adopted |
| D-24 | Gates use `workflow_dispatch` on the new/existing PR-gate workflows before PRs exist; the release `dry_run` is an owner follow-up from main | codex (contradiction check) | "PR gate green on the branch" wording; branch dry-run (v2 draft) | adopted |
| D-25 | Phases 11–12 merged (move + `PrestoClient` + `PrestoProver` re-base under one gate) | codex (contradiction check) | separate phases with a red intermediate gate (v2 draft) | adopted |
| D-17 | `presto-server --port` for run isolation | codex | fixed port | adopted |
| D-18 | Playground uses the committed witness; no `@aztec/noir-noir_js` | fable + codex | in-page execution with noir_js (main v1) | adopted |
| D-19 | Directory names `packages/sdk-core`, `packages/sdk-noir` | fable | `packages/presto-core`, `packages/presto-noir` (main v1) | adopted |
| D-20 | Byte identity: fixture proofs are WASM-generated; Rust job asserts native == fixture; sdk-noir asserts WASM (`WasmWorker`) == fixture at test time | codex (fresh WASM) + fable (`WasmWorker`) + main (transitive) | committed proof only | adopted |
| D-21 | App docs ship in arc 1 (phase 7) | fable | docs last only | adopted |

Disputed and left to the owner: A-01, A-02 (range), A-04, A-07.

---

## Audit log

### Contradiction check — codex (resumed session, 10 findings)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | Per-origin slot taken after buffering/inflate lets one origin fill all inflight slots and run concurrent inflates; FIFO "one proof" claim wrong | **adopted** — slot right after authorization; dry-run under the prove permit; claim corrected (D-06, D-16) |
| 2 | High | Approval re-check in `acquire_prover` changes chonk behaviour while claiming a behaviour-preserving split | **adopted** — re-check on the UltraHonk path only (D-16) |
| 3 | High | VK cache unqualified across targets; `verifyProof` trusting a server-returned key breaks bb.js's circuit-bound semantics | **adopted** — cache keyed by `(bbVersion, verifierTarget)`; seeds carry a target; `verifyProof` never uses a server key (D-22) |
| 4 | High | Phase 11 gate cannot pass: SDK imports the moved modules locally until phase 12 | **adopted** — phases merged (D-25) |
| 5 | High | Phase 5's oneshot test never proves over HTTP; `--port` needs a core `start` change, not only `main.rs` | **adopted** — HTTP smoke script added; `start_on(state, port)` (D-23) |
| 6 | High | Unreachable gates: `_e2e-webdriver.yml` is `workflow_call`-only; branch `dry_run` conflicts with the main-only assertion; "PR gates green" before PRs exist; `sdk-noir.yml` used before it is created | **adopted** — dispatch `presto.yml`; dry-run is an owner follow-up from main; dispatch the gate workflows; scaffold `sdk-noir.yml` in phase 14 (D-24) |
| 7 | Med | `bun run --cwd pkg a && b && c` shorthand invokes non-existent commands | **adopted** — every gate spells out each `bun run --cwd` |
| 8 | Med | `fallback: "none"` semantics silently fixed while A-01 is nominally open | **adopted** — scoped to `generateProof`, documented and tested; A-01 restated with the consequence |
| 9 | Med | Range peer not justified by the dedupe argument; "cached/downloadable" does not establish CLI compatibility | **adopted** — exact `5.2.0` recommended for v1 (A-02); matrix qualified |
| 10 | Low | "Drop-in" overstated with a mandatory third argument | **adopted** — wording corrected; README shows the migration |

### Contradiction check — fable (resumed planning subagent, 12 findings)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | Phase 9 branch `dry_run` cannot pass (main-only assertion) and dispatching a release breaches a hard limit | **adopted** (same as codex #6) — owner follow-up from main |
| 2 | High | Approval re-check in the shared stage changes chonk semantics; `authorize_origin` must return the origin | **adopted** (same as codex #2) — UltraHonk-only; `auth.rs` added to the change map |
| 3 | Med | Network-bound WASM identity test inside the hermetic unit chain; `WasmWorker` under Bun unproven | **adopted** — moved to `e2e/` with `test:identity` (D-27); Bun support is a Fact (F-19) |
| 4 | Med | `app.yml` filter misses `sdk-core`, `sdk-noir`, `fixtures/noir` | **adopted** — phases 12 and 17 |
| 5 | Med | Hoisted F14 table throws on 404; matrix says fallback | **adopted** — explicit `route-missing` row (D-26) |
| 6 | Med | One-outstanding cap sheds a second tab of an approved dApp to WASM (regression vs chonk) | **partially adopted** — cap raised to 4 = half the inflight cap; A-04 lists all three options |
| 7 | Low | Arc 1 builds `--port` + action with no consumer | **resolved by codex #5** — the HTTP smoke script consumes both in phase 5; lanes clarified |
| 8 | Low | Fixture `vk` provenance unspecified | **adopted** — WASM-generated; Rust job asserts native equality (D-28) |
| 9 | Low | Phase 18 offline case would run real WASM in the mocked project | **adopted** — assert phase/UI only |
| 10 | Low | Phase 6 gate wording | **adopted** (same as codex #6) |
| 11 | Low | `logger.ts` move leaves `presto-prover.ts` without a logger | **adopted** — sdk keeps a one-line logger |
| 12 | Low | Health tests assert presence only; no action | noted |

### Double audit — codex (resumed session; verdict on v3: `reject`, 7 blocking; all 16 findings adopted → v4)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | `--port` breaks the single-instance eviction/reaping model (`server.rs:270-275`, `leases.rs`) | **adopted** — isolated per-run `HOME` required, refusal otherwise, two-servers test (D-29) |
| 2 | High | Permit held by the request future does not serialize a `spawn_blocking` inflate after disconnect | **adopted** — worker owns the guards, cancellation flag, regression test (D-30) |
| 3 | Med | Re-check vs persisted config rejects fresh approvals whose persist failed; `--allow-all` has no origin | **adopted** — revocation generation (D-31) |
| 4 | High | "Exact version on npm" ≠ tested dependency graph | **adopted** — core-unchanged-since-tag check, registry core in profiles (D-32) |
| 5 | Med | Cap of 4 is admission policy, not protection | **adopted** — claim narrowed, tests added (D-33) |
| 6 | Med | OIDC "only in the reusable" misstated | **adopted** — call-edge delegation wording (D-34) |
| 7 | Low | F-11 overstates missing coverage | **adopted** — reworded |
| 8 | Med | ZK targets are randomized; identity gates must pin deterministic targets | **adopted** (D-35) |
| 9 | Med | Stale contradictory text (I-06, Security, Phase 4, Alternatives peer row) | **adopted** — all four fixed |
| 10 | Med | Native/fallback version consistency for `bbVersion` | **adopted** — closed tested-pairing list (D-36, A-02) |
| 11 | High | New workflows cannot be dispatched before they exist on main | **adopted** — reusable + `sdk.yml` dispatch input (D-37) |
| 12 | High | Tests that can pass without exercising the behaviour (wdio spec list, live e2e on fallback, silent skips, `presto-status`) | **adopted** (D-38) |
| 13 | High | `published-playground.ts` / packaged-e2e swap script reject or bypass the extracted core | **adopted** (D-39) |
| 14 | High | Release DAG lacks Noir gates, repeat-release semantics, recovery | **adopted** (D-32) |
| 15 | Med | Legacy bb.js options and conflicts not normalized across methods | **adopted** (D-40) |
| 16 | Med | Mocked offline case still runs real WASM | **adopted** (D-41) |

### Double audit — fable (fresh subagent; verdict on v3: `conditional approve`)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| A1 | High | Re-check vs persisted config 403s a freshly popup-approved origin whose save failed | **adopted** (= codex #3) — `Approval.via` + revocation generation (D-31) |
| A2 | High | `--port` breaks the bind-ownership invariant; no data-dir override exists | **adopted** (= codex #1) — `PRESTO_HOME` override (D-42) |
| A3 | Med | Client VK is the one input WASM never feeds bb; wrong-circuit VK untested | **adopted** — probed now (F-21) and kept as a real-bb test |
| A4 | Med | `workspace:*` rewrite drift hole | **adopted** (= codex #4) (D-32) |
| A5 | Low | New `presto.yml` job needs job-level `permissions` | **adopted** (D-49) |
| A6 | Low | `--allow-all` returns before parsing Origin; cap covers nothing there | **adopted** — documented (D-49) |
| A7 | Low | Decoded copies ×8 on the runtime thread | **adopted** (D-43) |
| A8 | Low | Distinct 429 code | **adopted** (D-49) |
| A9 | Low | Canonical-padding strictness | **adopted** — padding-indifferent (D-49) |
| B1 | Low | F-02 misstated | **adopted** — reworded |
| B2 | Med | Node/Bun default falls back to single-threaded `Wasm`, not `WasmWorker` | **adopted** — F-06 corrected; explicit `WasmWorker` everywhere |
| B3 | Med | ZK default is randomized; identity only for `*-no-zk` | **adopted** (= codex #8) (D-35) |
| B4 | Low | Facts verified | noted |
| B5 | Med | I-06 stale | **adopted** (= codex #9) |
| B6 | Med | I-11 too narrow | **adopted** — `PRESTO_HOME` covers the version cache; the runtime data dir (workspaces/reaper) was still missed until the final codex pass (D-51) |
| B7 | Med | Dispatch of brand-new workflow files | **adopted** (= codex #11) (D-37) |
| B8 | Low | `isBrowserRuntime`/`resolveHttpsOnly` must hoist | **adopted** — added to the core row |
| B9 | Low | I-09 holds | noted |
| B10 | Med | Exact peer makes `bbVersion` derivable | **adopted** (D-44) |
| B11 | Med | `update-aztec-version.ts` lockstep set | **adopted** (D-49) |
| B12 | Low | verified-sites is a badge | **adopted** — A-06 note |
| B13 | Low | Miner with `fallback: "none"` at tab 5 | **adopted** — A-04 + README note |
| C1 | Med | `ProveOutcome` leaks `Response` | **adopted** (D-46) |
| C2 | Low | `admit(scheme)` reintroduces a scheme branch | **adopted** (D-47) |
| C3 | Med | `verifyProof` seeded-VK claim inconsistent with bb.js | **adopted** (D-45) |
| C4 | Med | Manifest mode vs revision suffix | **adopted** (D-48) |
| C5 | Low | stderr tail log-only; inflate cap 64 MiB | log-only confirmed; cap **rejected** (D-50) |
| C6 | Low | Gates real; B7 the only risk | noted |
| C7 | Low | Would build B10/C3/A2 differently | **adopted** (D-42, D-44, D-45) |

### Final fresh-context pass — codex (new session; verdict on v5: `reject`, 2 blocking; all 6 adopted → v6, re-review pending)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | Revocation generations need an atomic ordering contract: approval read outside the manager, delayed popup `Allow` waiters can restore a removed origin, Settings removal not in the change map | **adopted** (D-52); `commands.rs` row added; two race tests added |
| 2 | Med | `PRESTO_HOME` does not cover `runtime_data_dir()` (prove workspaces, reaper) | **adopted** (D-51); fable B6 disposition corrected |
| 3 | High | Registry-core consumer rule cannot bootstrap the first core release; recurs whenever core + adapters change together | **adopted** (D-53) — packed candidate pre-merge, registry rerun in release |
| 4 | Med | `getSolidityVerifier` / `generateRecursiveProofArtifacts` missing from the drop-in surface | **adopted** (D-54) |
| 5 | Med | `published-playground.ts` + swap script cover only the Aztec adapter | **adopted** (D-55) |
| 6 | Med | Superseded ledger rows still operative (D-07/D-44, D-22/D-45, D-45 wording, D-43 vs Security/Critical path, D-29/D-42) | **adopted** — rows marked superseded; Critical path, Security, and Run isolation reconciled |

### Final fresh-context pass — codex round 2 (same session) on v6 — verdict: **`conditional approve`** (4 conditions, all adopted → v7)

| # | Sev | Condition | Disposition |
|---|---|---|---|
| 1 | Med | The v6 manager "mirror" needed persistence semantics: a failed save must grant only the current request; stale-generation check and config write must be serialized with removal | **adopted** — no mirror; the manager lock wraps config reads/writes; failure semantics unchanged; two more tests (D-52) |
| 2 | Med | Two approval epochs named (decision time vs prompt creation) | **adopted** — single epoch: `granted_at` = the `Allow` decision's generation; open prompts not cancelled (D-52) |
| 3 | Med | Phase 9 still preflighted dependency provenance before core existed | **adopted** — registry-independent checks up front, dependency checks deferred, `dry_run` reports deferrals, unpublished-core DAG test (D-56) |
| 4 | Low | Stale per-run `HOME` wording in the real-bb row and Phase 5 | **adopted** — `PRESTO_HOME` everywhere; CRS stays shared |

**Final foreign-reviewer verdict for the approval gate: `conditional approve` — conditions 1–4 above are incorporated in v7; no open conditions remain from the reviewer's side. The owner's Asks A-01..A-07 remain open by protocol.**

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

**Hard limits for the implementing session:** never merge to main or release branches; never publish to npm or dispatch a release; never register trusted publishers or touch credentials; never expand scope beyond this plan.

---

## ELI5 companion

Artifact (primary): https://claude.ai/code/artifact/7e4beb08-4015-44b9-861f-12efb2126a6d — source `implementations-plan/presto-noir/eli5.html` (redeploy the same path to update the same URL).

## Seeds (FINAL — approved scope, unchanged from the draft; run them INSIDE the `presto-noir` worktree: `agent-worktree resume presto-noir`)

```
/goal All 19 phases marked ✓ in implementations-plan/presto-noir/plan.md (the per-phase headers in the file — not the chat, not the task list; phase 13 is merged into 11–12 and counts as ✓ with them), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/presto-noir/lessons/phase-N.md` in the transcript; `/code-review` was NOT run (code_review: off); the codex fix loop converged for EVERY reviewed diff — each of the 5 arcs at its boundary plus the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the Delivery section's 5-PR stack exists on GitHub, created only AFTER all loops converged (`gh stack view` output in the transcript); `bun run test` and `bun run lint:actions` both report exit 0 in the transcript; no npm publish, release dispatch, or merge was performed.
```

```
/loop 15m Drive implementations-plan/presto-noir forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/presto-noir/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining step; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch; `gh stack view` for the whole stack). Without a PR but with CI configured, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI is fine** — confirm it's actually progressing (`gh run watch <run-id>` up to 10 minutes; queued or stuck past that → inspect logs, log it as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. **No task in hand?** Pick the next pending step from plan.md and start it. After each meaningful edit, run the fast validation layers (`bun run lint` + the touched package's unit tests; `cargo fmt --check && cargo clippy -- -D warnings && cargo test` for Rust) — catch mistakes in-step, not phases later. Then commit → push (`gh stack push`; `gh stack sync` if main or a lower arc moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Exception — hard limits stay hard: never merge to main or release branches, never publish or deploy, never register trusted publishers or touch credentials, never expand scope beyond plan.md; if the decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess the approach with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (commands + pass criteria — not generic vibes). Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/presto-noir/lessons/phase-N.md` in the transcript, advance to the next phase. Arc boundary crossed (per plan.md's Delivery section)? Run the arc's codex loop FIRST (`/code-review` is OFF for this plan — do not run it): codex with the arc map and the plan's no-over-engineering + comment-quality rules until a round yields nothing material — THEN `gh stack add <next-arc-branch>` before the next arc's work.
7. **All phases ✓ in plan.md?** Close out per plan.md's Post-implementation section: every arc already looped at its boundary — run only the final cross-arc integration pass: FRESH codex session over the net diff + cross-arc ask (seams between arcs, duplication across arcs, plan drift) + the no-over-engineering + comment-quality rules, same loop-until-clean. Then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync` then `gh stack submit --auto` + `gh pr edit` bodies, then `gh pr checks --watch`. Then write the wrap-up report: what shipped, every contentious decision codex and I debated — each with ELI5 context (what the question was, the options, why we picked ours) — and open items. Surface and stop.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```
