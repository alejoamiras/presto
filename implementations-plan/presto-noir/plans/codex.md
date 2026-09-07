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