# audit-fable.md — presto-noir (Fable 5.1 legs via the Agent tool, `subagent_type: Plan`)

Round 1 (independent plan) is archived at `plans/fable.md`. Dispositions for every finding below are in `plan.md` → Audit log and Decision ledger.

## Round 2 — contradiction check on the consolidated plan (v2), resumed planning subagent

1. **High** — Phase 9 gate cannot pass and breaches a hard limit: `release-sdk.yml`'s `assert-main` fails on any ref other than `refs/heads/main` (`.github/workflows/release-sdk.yml:41-45`) and the Post-implementation hard limits forbid dispatching a release. Fix: drop the dispatch from the gate; validate the tooling by `bun run lint:actions`, the parameterized `sdk-release-contract.test.ts`, and the `sdk.yml` tarball-consumer job. Note the `dry_run` input in the runbook as owner-only.
2. **High** — D-16's approval re-check contradicts Phase 0 and Phase 3: the change map put the persisted-approval re-check inside `acquire_prover` (shared by both handlers), changing `/prove`'s semantics for a queued, revoked origin and requiring `authorize_origin` (absent from the change map) to return the `CanonicalOrigin`. Fix: re-check in `ultra_honk.rs` after `acquire_prover` (UltraHonk-only), or surface under A-04.
3. **Med** — Phase 15 puts a network-bound WASM prove into the unit chain; `WasmWorker` under Bun 1.4 unproven. Fix: `packages/sdk-noir/e2e/` behind a `test:identity` script; keep `test:unit` hermetic.
4. **Med** — `app.yml`'s `relevant` filter (`.github/workflows/app.yml:25-40`) lists neither `packages/sdk-noir/**`, `packages/sdk-core/**`, nor `fixtures/noir/**`. Fix: add the globs in Phases 13/17.
5. **Med** — Compat matrix says a 404 is "classified as fallback", but the hoisted F14 table throws on unlisted statuses (`presto-prover.ts:750-752`). Fix: `PrestoClient.prove` returns `{ kind: "fallback", reason: "route-missing" }` for 404.
6. **Med** — Rejected position worth reopening (A-04): one-outstanding 429 → WASM fallback silently gives a second tab of an approved Noir dApp a ~6 s WASM proof instead of queueing ~1 s; recommend "drop", or bounded retry in presto-noir.
7. **Low** — Arc 1 builds `start-headless-presto` and `--port` with no consumer until Phase 15; D-15 vs Phase 15 lane inconsistency.
8. **Low** — Fixture `vk` provenance unspecified; generate via WASM `getVerificationKey` and assert native `--write_vk` equality.
9. **Low** — Phase 18's offline case would run a real WASM proof in the mocked project; assert phase/log/UI only.
10. **Low** — Phase 6 gate wording: `_e2e-webdriver.yml` is `workflow_call`-only; reachable via `presto.yml` `workflow_dispatch`.
11. **Low** — Phase 11 moves `logger.ts` to core but the barrel omits it while `presto-prover.ts` keeps ~20 `logger.*` calls.
12. **Low** — `prove_error_responses_stay_text_plain_json_string` and `health_minimal_for_unapproved_cross_origin` (`tests.rs:639-704`) assert key presence/absence only, so adding `schemes` to the minimal body does not break them.

Remaining after fixes: findings 2 and 6 need an owner call (A-04 scope); everything else editorial. 2 pending owner decision; 10 resolved by the proposed edits.

## Round 3 — double audit (v3), FRESH subagent (no prior context) — verdict: `conditional approve`

### A. Adversarial / security
- **A1 (High)** — The post-permit approval re-check 403s the request the user just approved: `authorize_origin` grants a popup Allow and persists via `config::lock_mutate_save_to`, which mutates a clone and commits to memory only after a successful save (`config.rs:650-665`); when `cap` is `None` nothing is written (`server/auth.rs:114-135`). "A disk error must never fail an already-approved proof" (`server/tests.rs:1333-1335`). Fix: `Authorized { origin, via: Persisted | Popup | Ungated }`, skip the re-check for `Popup`.
- **A2 (High)** — `presto-server --port` breaks the bind-ownership invariant: `start()` runs `sweep_cache_on_start` and `reap_orphaned_prove_workspaces` because winning `:59833` proves no other instance is mid-proof (`server.rs:268-290`). No data-dir override exists (`versions/cache_layout.rs:18`, `config.rs:150-154`). `start_on` must skip sweep/reap off-port, or a `PRESTO_HOME` override must land with it; I-11 too narrow.
- **A3 (Med)** — Client VK into bb's deserializer is the one input the WASM path never has (`backend.js:115` proves with an empty VK); I-03 untested. Test a wrong-circuit VK before shipping or drop `-k` in v1.
- **A4 (Med)** — `workspace:*` exact-pin rewrite has a silent-drift hole (core changed without a manifest bump). Compare packed integrity or require a bump when `packages/sdk-core/**` changes.
- **A5 (Low)** — `presto.yml` has no top-level `permissions:`; add job-level `permissions: contents: read` to the new job.
- **A6 (Low)** — Under `--allow-all` (`auth_manager: None`) `authorize_origin` returns before parsing Origin; the per-origin cap covers no origin there.
- **A7 (Low)** — Per-request memory becomes body + decoded copies × 8 inflight, ~2× today's peak, and base64 decode runs on the runtime thread. Decode on `spawn_blocking` or after the permit.
- **A8 (Low)** — Reusing `too_many_requests` muddles diagnostics; add `origin_queue_full`. `schemes` in the minimal body: accepted.
- **A9 (Low)** — Canonical-padding base64 strictness can 400 unpadded artifacts that bb.js's lenient `Buffer.from` accepts. Use indifferent padding.

### B. Assumption attack
- **B1 (Low)** — F-02: headless calls `start(state)`, which builds `router(state)` (`server.rs:264`).
- **B2 (Med)** — F-06/F-19: in Node/Bun without an explicit backend, `Barretenberg.new` falls back to `BackendType.Wasm` (single-thread), not `WasmWorker` (`dest/node/barretenberg/index.js:43-50`). Every Bun identity/regeneration script must pass `backend: WasmWorker`.
- **B3 (Med)** — I-07 is a fact: the legacy default is `noir-recursive` with ZK (`backend.js:69-75`). ZK proofs are randomized; byte identity only for `*-no-zk`; the 8-target Rust job must be verify-only for ZK targets.
- **B4 (Low)** — F-01, F-07, F-20, F-09 verified; `presto.yml`'s dispatch override sets every filter output (`presto.yml:30-46`).
- **B5 (Med)** — I-06 "one proof" false with a 4-per-origin cap.
- **B6 (Med)** — I-11 omits the cache sweep and workspace reaper.
- **B7 (Med)** — D-24 assumes `workflow_dispatch` works for brand-new workflow files; GitHub resolves dispatchable workflows against the default branch. Fallback: fold into `sdk.yml`.
- **B8 (Low)** — `isBrowserRuntime`/`resolveHttpsOnly` (Worker-aware, `presto-prover.ts:101`) must hoist into `PrestoClient`.
- **B9 (Low)** — I-09 holds.
- **B10 (Med)** — With an exact peer, `bbVersion` is derivable: default to a baked `TESTED_BB_VERSION`, removing the mandatory third argument and the installed-vs-declared footgun (`verifyProof` recomputes the VK with the installed WASM).
- **B11 (Med)** — `scripts/update-aztec-version.ts` lists only `packages/sdk` and `packages/playground` (`:12-13`); sdk-noir's devDep and the playground's direct `@aztec/bb.js` must join it.
- **B12 (Low)** — A-06: verified-sites is a recognition badge, not pre-approval.
- **B13 (Low)** — A-04: a multi-tab miner with `fallback: "none"` gets thrown 429s at tab 5; document that miners serialise submissions.

### C. Implementation critique
- **C1 (Med)** — `ProveOutcome.native` leaks `Response`; return parsed JSON under a cap.
- **C2 (Low)** — `admit(scheme)` reintroduces a scheme branch; pass `Option<&OriginSlots>`.
- **C3 (Med)** — `verifyProof` claim inconsistent: bb.js's `UltraHonkBackend.verifyProof` recomputes from bytecode (`backend.js:133-140`); a seeded VK needs `UltraHonkVerifierBackend`, which is VK-bound. Pick circuit-bound.
- **C4 (Med)** — `versionMode: "manifest"` vs the revision-suffix script: `1.0.0-revision.1` is a prerelease sorting below `1.0.0` that `promote` would tag latest. Fail closed instead.
- **C5 (Low)** — `run_bb` stderr tail log-only; inflate cap 64 MiB safer than 256 MiB.
- **C6 (Low)** — Gates are real; arc order correct; the only unreachable-gate risk is B7.
- **C7 (Low)** — Reuse matches recon; `PrestoClient` in core is the right home; would build B10, C3, A2 differently.

### D. Verdict
`conditional approve (with conditions: A1 — re-check must exempt popup-granted approvals; A2 — start_on off-port must skip sweep/reap or ship a data-dir override, I-11 rewritten; B3 — restrict all byte-identity assertions to *-no-zk and record the target in the manifest; B7 — verify branch dispatch of new workflow files before phase 12 or fold into sdk.yml; A4 and C4 — publish tooling fails closed on core drift and on manifest-mode re-publish; B10/B11 surfaced to the owner under A-02.)`

All conditions were adopted in plan.md v5 (D-31, D-42, D-35, D-37, D-32/D-48, D-44/D-49); C5's cap suggestion was rejected (D-50).
