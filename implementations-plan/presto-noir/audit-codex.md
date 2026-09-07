# audit-codex.md — presto-noir (GPT-6 Astra via /codex, effort high)

Session `01a07d02-1d6c-7831-89ea-1bbb96109371` for rounds 1–3; the final pass is a fresh session (appended below when it completes).

## Round 1 — independent plan (planning leg)

## 1. Architecture & Implementation

**Recommendation: preserve API v1, share the existing security machinery, and make native proving usable without initializing WASM.** Confidence: **high** on the architectural boundaries; **moderate** on compatibility beyond the verified bb 5.2.0 release.

Three weaknesses need correction:

- Minimal `/health` currently hides everything needed for feature detection. Hiding `schemes` would prevent a new origin from reaching the authorization popup.
- Recon’s proposed reuse of `validate_proof_len` for public inputs is incorrect: that validator rejects empty output. Generic circuits may have zero public inputs.
- A backend exposing three methods needs an explicit execution contract for each. Silently implementing VK generation and verification in WASM would undermine native-only consumers.

### Wire contract

Use the single agreed route, `POST /prove/ultra-honk`, with a small operation discriminator. This preserves the chosen route while supporting the complete backend surface.

All requests use `application/json`, `x-aztec-version`, and a required `verifier_target`.

```ts
type Request =
  | {
      operation: "prove";
      bytecode: string;       // base64 of gzipped ACIR; not compiled JSON
      witness: string;        // base64 of compressed witness
      verifier_target: VerifierTarget;
      vk?: string;            // base64
    }
  | {
      operation: "verification-key";
      bytecode: string;
      verifier_target: VerifierTarget;
    }
  | {
      operation: "verify";
      bytecode: string;
      proof: string;          // base64
      public_inputs: string;  // base64 of concatenated 32-byte fields
      verifier_target: VerifierTarget;
    };

type Response =
  | { proof: string; public_inputs: string; vk?: string }
  | { vk: string }
  | { verified: boolean };
```

Accept the eight verified target spellings through a Rust enum. Normalize omitted **JS** options exactly as the pinned bb.js implementation does; send the resulting target explicitly. Do not independently invent defaults.

For proving, supplied VK means `-k`; absent VK means `--write_vk`, returning the generated VK. VK generation uses `write_vk`. Verification derives the circuit’s VK natively before `bb verify`, matching bb.js’s circuit-binding semantics. Never verify against an arbitrary response-supplied VK alone.

Keep existing error encoding. Add typed malformed-request, unsupported-target/version, and invalid-output errors. Invalid proofs return `verified:false`; spawning failures, VK-generation failures, timeouts and crashes remain errors. Establish bb’s verification exit semantics with real tests before implementing this distinction.

Keep `x-prove-duration-ms`, documenting its operation duration and exclusion of authorization/download/queue time. No chonk field-count prefix appears anywhere in UltraHonk responses.

### Shared Rust execution

Extract the roughly 150 guard lines from `server/prove.rs` into **two concrete stages**, rather than a generic handler framework:

1. `read_authorized_request`: authorization → shared inflight permit → declared-size rejection → bounded, timed body read.
2. `prepare_proving`: version resolution/download/status → version lease → shared prove permit → resolved threads.

Owned context structs retain every RAII guard through response construction. Chonk calls both stages without inspecting its opaque body; UltraHonk inserts structural validation between them. Preserve chonk’s existing ordering, errors, status sequence and response bytes.

Separately extract the contained child-execution sequence from `bb.rs`. Both scheme-specific wrappers reuse atomic spawn registration, stderr draining, timeout, process-tree termination and quiesce handling. UltraHonk owns its filenames, arguments and output validation; chonk retains its header transformation.

Perform expensive gzip validation under the execution permit on a blocking worker, with bounded work and cancellation checkpoints. Do not block Tokio’s event loop or start eight concurrent decompressions.

### Health and compatibility

Both minimal and detailed health responses add:

```json
{
  "status": "ok",
  "api_version": 1,
  "schemes": ["chonk", "ultra-honk"]
}
```

Only detailed health adds the identity mapping:

```json
{
  "versions": [
    { "aztec_version": "5.2.0", "bb_version": "5.2.0" }
  ]
}
```

Retain `aztec_version`, `available_versions`, and other existing fields. Derive both representations from one list. `bb_version` means the package/release selector, **not** the unrecorded binary build ID.

`schemes` advertises the app’s protocol capability, not compatibility with every downloadable bb. Initially certify 5.2.0 for UltraHonk; keep that route’s supported-version policy separate from chonk’s existing selection policy.

| Client | Existing app | Updated app |
|---|---|---|
| Existing Aztec SDK | Existing behavior | Existing behavior |
| Extracted Aztec adapter | Existing behavior | Existing behavior |
| Noir adapter | WASM, or typed failure when fallback disabled | Native for supported bb/target; classified fallback otherwise |

Missing `schemes` means legacy app. Unknown schemes are ignored. Version details remain private before approval; the static scheme list is deliberately public.

### TypeScript boundaries

`packages/presto-core` exports:

- `PrestoTransport`, endpoint configuration and health/status types.
- API version constant, health parsing and version-negotiation helpers.
- Existing errors and a shared HTTP failure classifier.
- Existing phase callbacks and bounded response-reading machinery.

Move browser detection, HTTPS-policy resolution and witness-free diagnosis out of `presto-prover.ts` too. Merely moving its transport file would leave policy duplicated. Transport supports only the two known proof paths, preserving redirects, endpoint pinning and HTTPS rules.

`packages/sdk` retains Aztec simulation, serialization, inheritance and its dependency-derived version. Re-export existing public names so consumers retain source compatibility.

`packages/presto-noir` exposes:

```ts
new PrestoUltraHonkBackend(bytecode, {
  bbVersion,
  presto?,
  fallback?: "wasm" | "none", // default wasm
  apiFactory?: () => Promise<Barretenberg>
});
```

Its three methods match the pinned peer’s parameter and return types. All three attempt native execution. Lazily create one real WASM backend on fallback; default to lazy `Barretenberg.new`, with caller-supplied factories retaining API ownership. Destroy only internally owned resources.

Cache native VKs per backend instance and exact `(bytecode, bbVersion, target)`. Bound the cache by the finite target set; retain no witnesses. Do not share keys across targets merely because one pair happened to match.

Reuse existing fallback classifications, adding unsupported-feature handling. Malformed requests, unexpected server errors and malformed successful responses throw. No automatic native retry after an ambiguous timeout. `fallback:"none"` gives miners explicit backpressure instead of unexpectedly running WASM alongside busy native work.

### File-level change map

| Existing surface | Change |
|---|---|
| `core/src/server/prove.rs`, `server.rs`, `server/tests.rs` | Shared contexts, route, health, typed errors and regression coverage |
| `core/src/bb.rs`; new `bb/ultra_honk.rs` | Shared child runner; scheme-specific inputs/results |
| New `server/ultra_honk.rs` | JSON contract and validation |
| SDK transport/types/errors/prover and tests | Move neutral code/tests; preserve Aztec exports |
| New `packages/presto-core`, `packages/presto-noir` | Package manifests, implementation, declarations and tests |
| Root workspace/test chains, lockfile | Include both packages explicitly |
| Publish scripts/workflows and contract tests | Parameterize package identity, dependencies and provenance |
| `presto.yml`, filters, WebDriver specs | Real-bb coverage and dependency-aware routing |
| Playground `main.ts`, Vite config, mocked specs | Isolated Noir section using existing UI/results helpers |
| READMEs, `CLAUDE.md`, release runbook, verified-sites process | Protocol, compatibility, regeneration and release documentation |

The playground uses a committed public witness, requiring neither a wallet nor an Aztec node. Compare WASM/native proving and verification; label fallback honestly. Resolve workers from the same bb.js instance and add `@aztec/bb.js` deduplication.

## 2. Phases and Delivery

**Every phase’s fast gate:** `bun run test`, plus `cargo test` and `cargo clippy` in `packages/presto/core`. Ensure root Rust formatting includes the standalone core crate. These gates must include the new packages’ typechecks and unit suites.

1. **Extract Rust guard and child-execution seams.**  
   Preserve behavior before adding UltraHonk.  
   **Validation gate:** fast gate; `cargo test` in `packages/presto/src-tauri`; `bun run --cwd packages/presto test:unit`. Existing authorization, body limits, status, cancellation, containment and legacy-wire tests pass unchanged.

2. **Add native operations, protocol and fixtures.**  
   Commit Noir source, compiler manifest, public inputs, compiled artifact, compressed witness and regeneration instructions. Include a zero-public-input circuit. Record compiler/bb versions and artifact hashes.  
   **Validation gate:** fast gate; `bun run lint:actions`; `bun run bb:download`; `cargo build -p presto-server` in `packages/presto/server`; `bun run test:scripts` with the real-server environment enabled. Actual HTTP proofs verify through real `bb verify`; supplied/generated VK paths agree; altered proofs fail. Certify all advertised targets.

3. **Generalize npm release tooling.**  
   Introduce an allowlisted package descriptor and `_publish-npm.yml`; retain the existing SDK caller identity.  
   **Validation gate:** fast gate; `bun run test:scripts`; `bun run typecheck:scripts`; `bun run lint:actions`. Tests reject wrong package provenance, wrong workflow/commit/digest, tag races, unresolved workspace dependencies and unexpected registry failures.

4. **Extract core and migrate the Aztec adapter.**  
   Add core PR/release callers and preserve SDK public exports.  
   **Validation gate:** fast gate; `bun run --cwd packages/sdk test:unit`; `bun run --cwd packages/sdk test:lint`; `bun run --cwd packages/sdk build`. Fresh npm consumers install packed core plus packed SDK; core’s runtime graph and declarations contain zero `@aztec/*` dependencies. Existing native chonk CI remains green.

5. **Implement Noir backend and its package pipeline.**  
   Add fallback, peer compatibility, VK cache and resource ownership.  
   **Validation gate:** fast gate; `bun run test:scripts` with real integration enabled. Generate the WASM proof **during the test** using bb.js under Bun with bounded threads; compare proof bytes and public inputs with the HTTP result for `noir-recursive-no-zk`. Compare verification semantics, rather than bytes, for randomized targets. Pack/install/typecheck actual artifacts with matching and conflicting peers.

6. **Playground, desktop acceptance and release readiness.**  
   **Validation gate:** fast gate; `bun run lint:actions`; `bun run --cwd packages/playground test:unit`; `bun run --cwd packages/playground typecheck`; `bun run --cwd packages/playground test:e2e`; `bun run --cwd packages/presto test:e2e:ui`; `bun run --cwd packages/presto test:e2e:webdriver` across macOS/Linux/Windows. For platform-gated changes, run `cargo check --target x86_64-pc-windows-gnu --lib` in `src-tauri`. Require actual packaged-sidecar proving after approval, denial without execution, clean shutdown and existing chonk coverage.

**Delivery:** six focused stacked PRs corresponding to these phases. Dependency order is Rust seams → native route → publish primitives → core extraction → Noir adapter → playground/acceptance. Each changes one concern and can be reverted from the stack tip; reverting a foundation requires reverting its dependents.

The app can release after phase 2 and its desktop acceptance subset, through existing `release-presto.yml`, independently of npm. Publish core before either dependent adapter; promote core before adapters.

At each arc boundary, run the codex fix loop with adversarial, scope and comment-quality checks; commit accepted fixes and resume review until no material findings remain. Stop and reassess after three materially unsuccessful rounds. Run a final cross-arc pass, then `gh stack sync`, `gh stack submit --auto`, and `gh pr checks --watch`. Merging and production releases remain explicit owner actions. Record lessons and update the plan index throughout. `code_review` stays off.

## 3. Security & Adversarial Considerations

**Threats:** unapproved websites triggering work; approved origins exhausting CPU/memory/disk; substituted binaries/packages; malicious PRs reaching publication privileges.

Proposed ingress limits, to verify against representative fixtures:

- Existing **50 MiB encoded body** cap.
- Decoded compressed bytecode ≤16 MiB, witness ≤32 MiB, VK ≤1 MiB; aggregate decoded input ≤36 MiB.
- Verify inputs: proof ≤16 MiB, public inputs ≤4 MiB, within the same aggregate cap.
- Expanded gzip limits: ACIR ≤256 MiB; witness ≤512 MiB. Stream into a counting sink, validating checksums and rejecting trailing/concatenated data unless explicitly supported.
- Strict standard base64, required fields, duplicate-field rejection, enum validation and fixed filenames. No supplied paths, URLs, CRS locations or command fragments.
- Output-specific caps; proof nonempty/aligned, public inputs aligned **but possibly empty**. SDK enforces matching response bounds.

These are proposed resource policies, not measured circuit requirements. Small inputs can still describe expensive computations; compressed-size limits do not establish a C++ memory bound.

Retain private tempdirs, restrictive file permissions, verified downloads, leases and contained subprocesses. Do not log witnesses or echo parser diagnostics. Corrupted-VK rejection does **not** prove valid-but-unrelated VKs are checked against bytecode.

For sustained mining, retain the global single execution permit and speed setting; admit at most one outstanding UltraHonk operation per browser origin, reject excess with 429, and recheck persisted approval before queued execution. Do not impose arbitrary lifetime mining quotas. Existing shutdown must terminate owned work; verify disconnect cancellation rather than assuming HTTP disconnect drops the handler. Per-origin metering/revoke UI remains deferred.

Integration harnesses reserve ports through the host registry, use owned process groups and real-disk data directories, and always tear down. Since headless startup currently fixes port 59833, add a narrowly scoped configurable headless listen port, preserving its default and matching Host validation.

CI uses read-only permissions by default, SHA-pinned actions, frozen installs and existing dependency-audit policy. Preserve the seven-day release-age gate and reviewed exceptions. Avoid adding Noir execution dependencies merely to use a fixed fixture.

Only protected release jobs receive OIDC; isolate GitHub tag/release write permission from package builds. Configure each package’s trusted publisher and explicitly permit direct publication where required by current npm settings. [npm trusted-publishing documentation](https://docs.npmjs.com/trusted-publishers/)

## 4. Assumptions

**Facts — high confidence, inspected source:**

- Guard ordering and lease-before-queue behavior: `packages/presto/core/src/server/prove.rs:224`.
- Contained process execution is embedded inside chonk proving: `packages/presto/core/src/bb.rs:340`.
- Chonk unconditionally adds its count header: `packages/presto/core/src/bb.rs:427`.
- Empty output is rejected by the existing validator: `packages/presto/core/src/bb.rs:444`.
- Minimal health omits capability/version details: `packages/presto/core/src/server.rs:418`.
- Exact API-version recognition: `packages/sdk/src/lib/presto-transport.ts:265`.
- Current fallback classification is broader than denial/unavailability: `packages/sdk/src/lib/presto-prover.ts:699`.
- Publish preparation preserves dependencies verbatim: `scripts/prepare-sdk-publish.ts:17`.
- Headless smoke skips bb prebuild: `.github/workflows/presto.yml:416`.
- bb behavior/timings are supplied recon evidence, not independently rerun in this planning pass.

**Inferences:**

- **High:** API v1 plus public static capabilities avoids lockstep deployment.
- **High:** A committed expected proof alone cannot detect regressions in the current WASM peer.
- **Moderate:** The proposed size limits cover intended consumers; measure before freezing them.
- **Unknown:** Native byte identity across every target/platform. Promise it only where exercised.
- **Unknown:** New npm names’ reservation/trusted-publisher readiness; establish this before release, without inventing a token fallback.

**Asks for the approval gate:**

- Whether to run `/harden security` before the first stable publish.
- The exact yacana origin and ownership evidence needed by `VERIFIED_SITES.md`. Do not infer a domain or preapprove it.

## 5. Explicit Design-Fork Decisions

| Fork | Decision and reasoning |
|---|---|
| **a. Guards** | Two-stage guarded prelude returning owned RAII contexts. A scheme-wide handler couples payloads unnecessarily; duplication creates security drift. |
| **b. VK** | Optional VK plus `--write_vk`; cache per client instance. Required VK forces setup before native proving. Server caching adds persistent state, eviction and attacker-controlled churn. |
| **c. Request encoding** | JSON/base64. The 50 MiB cap is encoded size; document the reduced usable payload. Multipart and custom binary framing add parsing complexity without demonstrated need. Msgpack would introduce another public protocol dependency. |
| **d. Response encoding** | JSON/base64, including optional VK. Proofs are small relative to proving cost; binary framing adds little value here. |
| **e. Detection** | Keep API v1; expose static schemes publicly and version mappings only in detailed health. Never interpret missing private version details as absence. |
| **f. Mapping** | Identity entries derived from existing release selectors. No invented build-ID mapping and no `bb --version` subprocess on health requests. |
| **g. Peer/fallback** | Exact tested `@aztec/bb.js` peer initially, with matching dev dependency. This deliberate F13 exception allows the consumer and adapter to share one WASM API/worker installation. Lazy default API creation plus optional factory; precise ownership and cleanup. |
| **h. Fixtures** | Commit source, compiled artifact, witness and generation metadata. Generate VKs during integration; optionally retain versioned VKs for supplied-key tests. Expected proofs are diagnostic extras. Regenerate locally with pinned nargo; CI needs only existing bb setup and bb.js. |
| **i. Publishing** | Parameterize existing scripts and one reusable workflow using a closed package descriptor. Rewrite `workspace:*` to exact published core versions before packing. Core uses independent semver; adapters retain backend-aligned versioning. Parameterize promotion’s provenance, package tags, active-run checks and readback; retain operator-authenticated promotion rather than assuming publish OIDC authorizes dist-tag mutation. |
| **j. Topology** | Rust first permits app-first delivery. Publish primitives precede core extraction so migration cannot strand SDK releases. New package PR filters include transitive core changes; existing SDK/playground filters expand accordingly. |
| **k. Real integration** | Extend the existing headless smoke with prebuild enabled and an environment-gated Bun integration suite run through `bun run test:scripts`. Explicitly fail if the enabled lane skips tests. Obtain fresh WASM proofs during execution; keep ordinary fast tests bb-free. |

## Round 2 — contradiction check on the consolidated plan (v2)

1. **High — “Critical path” / “Ingress validation” / “Sustained-CPU abuse” / D-06, D-16.** The per-origin slot is acquired **after** buffering and decompression. One origin can therefore occupy all eight inflight slots and run concurrent inflate jobs, contradicting the claimed protection. Acquire the origin slot immediately after authorization, before body buffering. Restore serialized decompression under the execution permit, or provide a separate bounded validation permit retained until the worker actually finishes. FIFO also does not bound another origin’s wait to one proof when multiple origins or chonk requests are queued; correct that claim.

2. **High — Locked Phase 0 / Rust change map / Phase 3 / D-01.** `acquire_prover` adds an approval recheck to **both** handlers while calling the extraction behavior-preserving. Existing `/prove` authorizes once (`server/prove.rs:234`) and never rechecks after queuing. Restrict the new recheck to UltraHonk. Applying it to chonk requires an explicit exception to the locked behavior constraint; unchanged existing tests cannot prove otherwise.

3. **High — TypeScript change map / D-02, D-10 / F-17 / Phase 14.** The adapter has an unqualified cached/seeded VK despite supporting target changes whose VKs differ by family. It also changes `verifyProof` from deriving the constructor circuit’s key to trusting that cache. Restore cache binding to exact bytecode, bb version and target; seeds need target metadata. Preserve circuit-bound verification using an independently derived or trusted circuit VK, rather than treating any server-returned key as interchangeable.

4. **High — Phases 11–12 versus their mandatory fast gates.** Phase 11 moves transport/errors/logger/types, but Phase 12 updates their SDK consumers. Current `presto-prover.ts` and `src/index.ts` import those local files directly, so Phase 11’s `bun run test` fails. Combine the move and consumer migration into one gated phase, or explicitly retain compatible forwarding modules until Phase 12.

5. **High — Phase 5 / Rust change map / Arc 1 “shippable alone.”** The specified real-bb test uses router `oneshot`; it does not prove through the launched headless server. The first explicit HTTP consumer appears in Phase 15. Add an actual fixture POST and native verification to Phase 5. Also extend core startup: `server.rs:265–266` currently calls `router(state)` and binds fixed `PORT`; changing only `server/src/main.rs` cannot implement `--port`. A separate job is acceptable; these omissions do not require restoring my proposed smoke-job extension.

6. **High — Phases 6, 9, 13, 15–16 / Post-implementation Delivery.** Several CI gates are unreachable as ordered. `_e2e-webdriver.yml` has only `workflow_call`, so Phase 6 must dispatch its `presto.yml` caller. Phase 9’s branch dry-run conflicts with `release-sdk.yml`’s main-only assertion unless explicitly given a secretless branch path. Phase 13 requires PR gates before Delivery allows PR creation: use dispatchable equivalents. Phase 15 requires `sdk-noir.yml` before Phase 16 creates it: move workflow scaffolding earlier.

7. **Med — Gates in Phases 11, 12, 14, 17.** Commands such as `bun run --cwd packages/sdk test:unit && test:lint && build` invoke nonexistent shell commands after the first script. Repeat `bun run --cwd <package>` for every script. Apply the same correction to playground chains.

8. **Med — A-01 / D-09, D-10 / TypeScript change map.** `fallback:"none"` throws for unavailable native proving, but `verifyProof` and a cold `getVerificationKey` still execute locally. My native-operation alternative remains preferable for a genuinely native-only backend. If deferred, explicitly scope this option to `generateProof`, document the other methods’ local execution, and test that contract. Otherwise A-01 is nominally open while its consequential semantics are silently fixed.

9. **Med — A-02 / Alternatives “bb.js dependency” / Compat matrix.** The rationale rejects **exact peer** by arguing against duplicate dependencies. An exact peer also shares the consumer’s installation; that argument does not justify `>=5.2.0 <6`. Restore exact `5.2.0` as the recommendation until a version matrix supports widening. “Cached/downloadable” likewise does not establish CLI/API compatibility; qualify the matrix accordingly.

10. **Low — Summary / D-09 / constructor signature.** A mandatory third `{bbVersion}` argument makes the adapter positionally similar, not a two-argument drop-in replacement. Correct the claim and show the migration explicitly.

Confidence: high on the concrete conflicts; moderate on the preferred resolutions to A-01/A-02.

10 findings remain.

## Round 3 — double audit (v3) — verdict: reject (7 blocking); all 16 findings adopted in v4

## A. Adversarial / security

1. **High — `--port` breaks the existing isolation model.** Phase 5 checks only `BindOwnedGuard`, but `core/src/server.rs:272` starts cache eviction and workspace cleanup on the assumption that winning **59833** excludes other instances. `versions/leases.rs:27–41` explicitly limits leases to one process. Different ports with shared directories permit cross-process eviction. Require isolated version-cache, runtime and CRS directories for additional instances, or implement cross-process ownership. Test two simultaneous servers; merely allocating ports is insufficient.

2. **High — Holding the permit outside `spawn_blocking` does not guarantee serialized inflation.** Dropping the request future releases its guards while a started blocking worker continues; Tokio explicitly documents this behavior in `task/blocking.rs:106`. Move permit ownership into the blocking operation and return it on completion, retaining admission accounting until work actually stops. Add bounded cancellation checks and a cancellation regression test. Recheck authorization **before** expensive inflation, retaining the final pre-spawn check.

3. **Med — The approval recheck loses authorization provenance.** `auth.rs:119–150` allows the current request even when persistence fails or configuration is read-only; `lock_mutate_save_to` leaves memory unchanged on failure. A subsequent persisted-membership check rejects that freshly approved request. `--allow-all` also returns before parsing an origin. Preserve fresh consent and ungated/no-Origin modes while detecting actual revocation; do not equate “absent from persisted configuration” with “revoked.”

4. **High — “Exact version exists on npm” does not establish the tested dependency graph.** A developer can change workspace core without bumping its manifest version; local candidate-pair tests pass, while published adapters resolve the older registry core. Verify the intended core artifact’s provenance/integrity and test adapters against that exact artifact. Add a changed-core-with-unchanged-version rejection. Core-before-adapters ordering alone does not close this gap.

5. **Med — The four-request cap is admission policy, not protection against an approved attacker.** The same origin can fill all slots through unrestricted chonk `/prove`; two approved origins can fill them through UltraHonk. A fifth legitimate request also starts WASM under the default policy, increasing CPU use rather than applying backpressure. Narrow the security claim, document this consequence, and test five concurrent requests with both fallback modes. No additional chonk restriction is necessary within the locked scope.

6. **Med — The OIDC permission rule is incorrectly stated.** Phase 9 and Least privilege put `id-token: write` “only” in the reusable workflow. The calling release job must grant it too; the existing caller already does. Specify permission delegation at that call edge, with no OIDC in test/build jobs. Configure trusted publishing against `release-sdk.yml`, not `_publish-npm.yml`. [npm documents both requirements](https://docs.npmjs.com/trusted-publishers/).

## B. Assumption attack

**Facts**

7. **Low — F-11 overstates missing coverage.** `packages/sdk/e2e/proving.test.ts:88–100` already asserts native transmission without fallback, and `legacy-compatibility.test.ts` exercises a published legacy SDK. Rewrite the fact as “no existing generic UltraHonk fixture test”; retain these existing chonk regressions during extraction.

**Inferences**

8. **Med — Byte-identity gates must specify deterministic targets.** bb.js `src/barretenberg/backend.ts:77–89,122–133` confirms the default enables ZK; `noir-recursive-no-zk` disables it. Explicitly record and pass the fixture target in regeneration, HTTP smoke, SDK identity and playground calls. For randomized targets require verification, not golden-byte equality. Phase 6 must not silently replace a failing deterministic identity assertion with verification; surface the mismatch and its supported-platform consequence.

9. **Med — Several supposedly adopted corrections remain contradictory.** I-06 still promises a one-proof wait; Security still places *all* validation before the permit; Phase 4 still says “one-outstanding”; Alternatives still recommends the broad peer range rejected by D-08/A-02. Remove these stale instructions before implementation. The audit log cannot override contradictory executable phase descriptions reliably.

**Asks**

10. **Med — A-02 needs a native/fallback version-consistency rule.** Exact peer `5.2.0` does not prevent callers supplying `bbVersion:"5.3.0"` and receiving native proofs from one release and fallback proofs from another. Recommend accepting only the tested native/peer pairing initially, with constructor validation and tests. If wider native selection is intentional, make that an explicit compatibility decision under A-02.

## C. Implementation critique

11. **High — New workflow dispatch gates remain unreachable before registration.** Phases 12 and 15 dispatch newly introduced workflows before merge or any prior run. GitHub requires default-branch presence for initial `workflow_dispatch` activation. My previous correction missed this prerequisite. Give the new suites reusable entry points and invoke them from an already registered workflow dispatched at the feature ref, or provide another explicit pre-PR trigger. [GitHub workflow-dispatch rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)

12. **High — Required tests can pass without exercising the intended behavior.** `packages/presto/wdio.conf.ts:18` explicitly enumerates specs; Phase 6 must add `ultra-honk.spec.ts` there. Phase 15’s fixture equality and successful verification also pass after WASM fallback: use `fallback:"none"` and assert native execution. Require the live environment in CI rather than allowing silent skips. Add the new Rust job to `presto-status`’s explicit dependency/result lists.

13. **High — Existing published-playground tooling will reject the extracted SDK.** `scripts/published-playground.ts:16–19` compares published dependency strings directly with workspace strings: exact core `1.0.0` cannot equal `workspace:*`. It is absent from the change map. Moreover, `packaged-e2e-swap-sdk.sh` links the workspace dependency tree into the packed SDK, potentially testing source core instead of published core. Update both helpers and their tests; demonstrate that the composed packaged test resolves the intended core artifact.

14. **High — The release DAG does not specify Noir’s production gates or repeat-release behavior.** The existing `release-sdk.yml:45–59` gates publishing through chonk E2E. Require Noir identity/live tests and package consumers at the release SHA before Noir publication. Also define `all` when unchanged manifest-versioned core already exists: the inherited collision check rejects republishing it. Verify and reuse completed dependency releases, preflight all candidates, and document recovery after partial publication. Never silently republish or reinterpret collisions.

15. **Med — The backend option contract is broader than the plan’s normalization test.** bb.js supports legacy `keccak`, `keccakZK`, `starknet`, `starknetZK`, their precedence, and conflicts with `verifierTarget` (`backend.ts:30–133`). `verifyProof` and `getVerificationKey` also accept these options. Normalize consistently across all three methods, or explicitly narrow the advertised surface. Test conflicting options, legacy options and target changes, not just omitted defaults.

16. **Med — Phase 18’s assertion change does not suppress real WASM execution.** Observing only the fallback phase still lets `generateProof` continue into the real backend and CRS requests. Introduce a test-only backend/module substitution that returns deterministic fixture data, and assert unexpected external requests fail. Keep one explicit real-browser fixture check outside the mocked suite if browser worker packaging is part of the release guarantee.

## D. Verdict

reject (with blocking findings: #1 cross-process state isolation; #2 blocking-worker ownership; #4 published dependency identity; #11 unreachable gates; #12 ineffective required tests; #13 broken published-playground integration; #14 incomplete release gating and recovery)

## Round 4 — final fresh-context pass (NEW session `01a07d29-9824-7a83-a98d-b29670c4aaf8`) on v5 — verdict: reject (2 blocking); all 6 findings adopted in v6

## A. Adversarial / security

1. **High — Revocation generations need an atomic ordering contract. Confidence: high.** D-31’s comparison alone does not guarantee that Settings removal invalidates queued work. Currently, approval is read separately from authorization-manager state, and each popup waiter independently persists an `Allow` in [auth.rs](packages/presto/core/src/server/auth.rs:45). A delayed waiter can process an earlier Allow **after removal**, restore the origin to config, and potentially receive a post-removal generation. Subsequent requests then appear freshly authorized.

   Assign the approval generation when the decision occurs, prevent stale Allow handlers from restoring revoked approval, and coordinate persisted-approval reads with revocation ordering. Include the actual [Settings removal command](packages/presto/src-tauri/src/commands.rs:404) in the change map. Test Allow → remove → delayed waiter, plus removal between approval lookup and token creation. The existing “revoked while queued” test alone does not exercise these races.

The selected process runner, fixed argv, bounded readers, and circuit-bound verification are appropriate reuse. The source review does not establish memory-safety guarantees for bb’s parsers; the recorded malformed-input probes establish only those particular cases.

## B. Assumption attack

**Facts**

The central F-06 claims match installed bb.js: default recursive proofs use ZK, Node prefers native, and `verifyProof` recomputes the circuit VK. I did not rerun the recorded proving timings or malformed-input experiments; those remain prior experimental evidence.

**Inferences**

2. **Med — I-14 and D-42 do not isolate all mutable runtime state. Confidence: high.** `PRESTO_HOME` is specified to relocate `.presto/{config,versions}`, but prove workspaces use [`runtime_data_dir()`](packages/presto/core/src/lib.rs:30), which calls `dirs::data_local_dir()`. [`prove_tmp_parent()`](packages/presto/core/src/bb.rs:94) places witnesses and the startup reaper there. Two different `PRESTO_HOME`s therefore still share that directory under the proposed implementation.

   Extend the override to runtime data and test the resolved workspace/reaper paths, not merely successful simultaneous HTTP requests. The 24-hour reaping floor reduces immediate interference; it does not make the directory private to a run. The audit disposition claiming that `PRESTO_HOME` already covers sweep/reap is incorrect.

**Asks**

A-01–A-07 remain visibly identified. I found no evidence that the owner has answered them; finalize their dispositions before enabling the implementation seeds. In particular, A-01 and A-02 are recommendations embedded in executable instructions, not yet owner decisions.

## C. Implementation critique

3. **High — The first-release dependency creates an unreachable gate. Confidence: high.** Phase 16 requires the Noir tarball consumer to install **registry core**, while Delivery postpones publishing core until after merge and postpones opening PRs until every phase passes. A new core version cannot satisfy that sequence. The same problem recurs whenever core and adapters change together.

   Phase 12’s “freshly packed core when publishing both” exception is insufficient: these are pre-merge validation runs, and Phase 16 has no corresponding exception. D-32’s registry-only rule and Phase 9’s preflight of dependency provenance also need a bootstrap distinction.

   Use packed candidate core for pre-merge integration when that version is unpublished. During an authorized release, publish and verify core first, then rerun adapter consumers against the registry artifact before publishing adapters. Specify which preflight checks can run before core exists. This preserves the supply-chain requirement without requiring publication to complete development.

4. **Med — The advertised bb.js surface is incomplete. Confidence: high.** Installed `UltraHonkBackend` also exposes [`getSolidityVerifier` and `generateRecursiveProofArtifacts`](node_modules/.bun/@aztec+bb.js@5.2.0/node_modules/@aztec/bb.js/src/barretenberg/backend.ts:228). Neither appears in the adapter contract or tests. Existing consumers using either method cannot make the advertised drop-in substitution.

   Add thin delegates to the same lazily resolved backend, with option forwarding and public-method signature checks. This requires no new native operations. If intentionally excluded, narrow the compatibility claim explicitly; constructor compatibility alone is insufficient.

5. **Med — Published-playground handling still covers only the Aztec adapter. Confidence: high.** Phase 17 adds `presto-noir` through `workspace:*`, but D-39 modifies existing scripts primarily to resolve core’s version. [`published-playground.ts`](scripts/published-playground.ts:25) fetches and verifies only `@alejoamiras/presto`; its swap helper replaces only that package. Consequently, a release deployment can still bundle workspace Noir source while claiming to consume the published candidate.

   Extend candidate selection and artifact replacement to the Noir adapter and its core dependency. Assert the playground resolves the verified packaged entries. Also define deployment behavior for each new release selection, especially `presto-noir` alone.

The two-stage Rust prelude and shared TypeScript client are otherwise sensible boundaries. I would retain both and fix these specific seams.

## D. Ledger review

6. **Med — Superseded decisions remain operative in conflicting sections. Confidence: high.** These are consequential contradictions:

   - D-07 requires `bbVersion`; D-44 makes it optional.
   - D-22 permits seeded keys for verification; D-45 and the adapter contract forbid them.
   - D-45 mentions server keys for `getVerificationKey`; the adapter contract explicitly excludes returning them.
   - D-43 moves decoding and gzip checks under the blocking worker’s permit; Security and Critical Path still place those checks before acquisition.
   - D-29 and Run Isolation prescribe changing `HOME`; D-42 rejects that approach in favor of `PRESTO_HOME`.

   Mark old entries **superseded by D-xx** and reconcile all implementation-facing sections. Otherwise, an implementer can follow a documented security rule and contradict the intended implementation.

No rejected architectural alternative clearly deserves wholesale reinstatement. The registry-only policy needs the staged exception in finding 3; native verification need not be pulled into scope merely to resolve these findings.

## E. Verdict

reject (with blocking findings: 1 — revocation ordering is underspecified and permits stale approval restoration; 3 — pre-merge registry dependency gates cannot bootstrap the first core release)

## Round 5 — re-review of v6 (same fresh session) — verdict: conditional approve (4 conditions, all adopted in v7)

## A. Adversarial / security

1. **Med — The new approval mirror needs explicit persistence semantics. Confidence: high.** D-52 fixes approval lookup/token ordering, but introduces another copy of authorization state. Today, [`lock_mutate_save_to`](packages/presto/core/src/config.rs:650) updates in-memory config only after saving succeeds. An approved request survives a failed save, but later requests must seek approval again.

   Specify that failed persistence grants only the already-approved requests; it must not leave the manager mirror authorizing future requests. Also require the stale-generation check and config mutation to be serialized with removal—not a manager check followed by an independently locked config write. Test failed save → subsequent request, and removal interleaved with waiter persistence; assert both manager state and reloaded disk state.

The Settings hook and additional race tests substantially address my previous security finding. This remaining condition concerns maintaining the invariant across the newly introduced mirror and existing persistence layer.

## B. Assumption attack

**Facts:** F-22–F-24 match the inspected source. Runtime storage was outside `.presto`; removal was config-only; both additional bb.js methods exist.

**Inferences:** D-51 now addresses the isolation gap, including workspace/reaper path assertions. D-53 provides a reachable bootstrap sequence without weakening registry verification before adapter publication.

**Asks:** A-01–A-07 are deliberately pending owner decisions. Keeping them open with DRAFT seeds is appropriate; I do not treat that as a finding.

## C. Implementation critique

The substantive fixes to isolation, package bootstrap, adapter surface, and published-playground consumption address my previous findings.

The added bb.js methods should remain thin delegates, as specified. Signature checks against the **public method shape** avoid depending on bb.js’s private class members.

The two consumer modes are the right distinction: packed candidates establish pre-merge compatibility; registry reruns establish compatibility with the dependency consumers will actually install. D-55 now includes every playground package and explicitly handles Noir-only publication.

## D. Ledger review

2. **Med — D-52 still names two different approval epochs. Confidence: high.** The authorization row assigns generations **at decision time**, but subsequently says an Allow waiter carries the generation **when its prompt was created**. These differ if a prompt spans a revocation. Define `granted_at` as the Allow decision’s generation and carry it in the decision delivered to waiters. If revocation should invalidate an already-open prompt, specify that cancellation separately. Otherwise, implementers can derive opposite outcomes from the same row.

3. **Med — Phase 9 retains the bootstrap-blocking preflight order. Confidence: high.** It still requires preflighting every candidate’s “provenance of dependencies” **before publishing anything**. That contradicts D-53 and the revised mechanics bullet when core does not yet exist. Rewrite Phase 9 to defer those checks until core is published and verified. Add a release-DAG test for a previously unpublished core; the dry run should report deferred dependency checks explicitly.

4. **Low — Old `HOME` instructions remain outside the reconciled paragraphs. Confidence: high.** The real-bb change-map row and Phase 5 still prescribe per-run `HOME`, including the composite action. Replace those references with `PRESTO_HOME` so the implementation consistently preserves the deliberately shared CRS cache.

The previously conflicting VK and optional-version ledger entries are now sufficiently reconciled. None of these findings warrants changing the selected architecture or reopening the owner’s locked decisions.

## E. Verdict

conditional approve (with conditions: specify mirror/persistence ordering and failure behavior in finding 1; reconcile approval epochs in finding 2; correct Phase 9’s preflight order in finding 3; remove stale HOME instructions in finding 4)