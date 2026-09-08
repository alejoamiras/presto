# route-ingress — security findings

Cluster: `POST /prove/ultra-honk` ingress (host guard → origin auth → admission → parse → decode →
bb). Files read fully: `server/ultra_honk.rs`, `server/prove.rs`, `server/auth.rs`, `server/host.rs`,
`server.rs`, `authorization.rs`; handoffs followed one function deep into `bb/ultra_honk.rs` and
`src-tauri/src/commands.rs` (`respond_auth`/`get_pending_auth`).

## Findings

### F-1: Untrusted JSON body is parsed synchronously on the async runtime, bypassing the route's own blocking-worker discipline

1. **Title**: `parse_request` runs attacker-sized JSON parsing directly on a tokio runtime thread instead of a blocking worker, unlike every other CPU-bound stage in the same handler.

2. **Impact factors**: Availability only (no C/I impact). Blast radius is every consumer of the shared tokio runtime behind this Presto instance — other approved origins' `/prove` and `/prove/ultra-honk` requests, and `/health` — not just the attacker's own request. Attack vector: loopback HTTP/HTTPS, reachable from JS in any browser tab whose origin the user has approved once, or from any local caller that simply omits the `Origin` header (a documented, ungated path — no consent needed at all). Attack complexity: low (a single crafted POST body). Privileges required: none for the no-Origin path; one-time user consent for the approved-origin path. User interaction: none for repeat requests.

3. **Evidence confidence**: moderate. The code path is confirmed by direct reading; the practical severity (how much runtime-thread time a ~49 MiB parse actually costs, and how much that degrades concurrent requests) was not measured (no benchmarks were run — repo is read-only for this audit), so the magnitude is an estimate, not a measurement.

4. **OWASP / CWE mapping**: CWE-400 (Uncontrolled Resource Consumption); CWE-770 (Allocation of Resources Without Limits or Throttling). OWASP API Security Top 10 API4:2023 (Unrestricted Resource Consumption).

5. **Trace**:
   - Source (untrusted, size-bounded but attacker-controlled input): request body, capped at `MAX_BODY_SIZE = 50 MiB` (`packages/presto/core/src/server/prove.rs:121`), buffered by `read_body` (`packages/presto/core/src/server/prove.rs:180-198`) inside `admit()` (`packages/presto/core/src/server/prove.rs:273`), called from `prove_ultra_honk` at `packages/presto/core/src/server/ultra_honk.rs:327`.
   - `packages/presto/core/src/server/ultra_honk.rs:329-330`: `let body = std::mem::take(&mut admitted.body); let parsed = parse_request(&body)?;` — called directly in the `async fn`, on the tokio worker thread that is running this task.
   - Sink: `parse_request` (`packages/presto/core/src/server/ultra_honk.rs:168-188`) calls `serde_json::from_slice::<RawRequest>(body)` (line 169), which drives the hand-written `Visitor::visit_map` (`packages/presto/core/src/server/ultra_honk.rs:124-152`) that copies the `bytecode`/`witness`/`vk` fields into owned `String`s — up to `encoded_cap(MAX_BYTECODE_BYTES) ≈ 22.9 MiB` and `encoded_cap(MAX_WITNESS_BYTES) ≈ 44.7 MiB` (caps defined at `packages/presto/core/src/server/ultra_honk.rs:35-36`, `encoded_cap` at line 162-164) — entirely synchronously, still on the tokio worker thread.
   - Contrast: every other CPU-bound stage in this same handler — base64 decode + gzip inflate dry-run (`decode_and_check`, line 248), workspace write (`UltraHonkWorkspace::create`), and output read (`bb::read_ultra_honk_outputs`) — is explicitly routed through `on_worker` (`packages/presto/core/src/server/ultra_honk.rs:286-304`), which uses `tokio::task::spawn_blocking` (line 296) precisely to keep CPU work off the async runtime. `parse_request` at line 330 is the one exception: it runs one line *before* the first `on_worker` call (line 338) and is not wrapped.

6. **Missing control**: `parse_request` (or at least the `serde_json::from_slice` call inside it) should run on a blocking worker (`tokio::task::spawn_blocking`), exactly like the rest of the pipeline, or the handler should perform a cheap pre-check (e.g. reject on the first structurally-invalid byte without materializing full-size owned strings) before doing a full parse on the runtime thread.

7. **Exploit story**: An attacker (an approved-once origin, or any caller omitting `Origin`) builds a JSON body near the size cap: `bytecode`/`witness` filled with `encoded_cap(...)` bytes of arbitrary printable ASCII (need not be valid base64 or gzip — that is only checked later) and `verifier_target: "bogus"`. It sends up to `MAX_ULTRA_HONK_PER_ORIGIN = 4` (`packages/presto/core/src/server/ultra_honk.rs:31`) such requests concurrently per approved origin, or up to the full `MAX_INFLIGHT_PROVE = 8` (`packages/presto/core/src/server.rs:52`) if it omits `Origin` (no per-origin cap applies to that path — see Non-findings). Each request passes `admit()` cheaply, then spends real wall time inside the synchronous `parse_request` call on a tokio worker thread, then fails fast at `raw.verifier_target.parse::<VerifierTarget>()` (`packages/presto/core/src/server/ultra_honk.rs:171-174`) with a 400 before `acquire_prover` (line 333) is ever reached — so the request never touches the single `prove_semaphore` (`packages/presto/core/src/server.rs:52`, 1 permit) that serializes actual proving. Because failure is cheap and immediate, the attacker can resubmit as fast as its origin/inflight slot frees up, sustaining a steady stream of large synchronous parses that compete with other origins' `/prove`, `/prove/ultra-honk`, and `/health` requests for the same small pool of tokio worker threads.

8. **Preconditions**: network access to the loopback prove port, and either (a) an origin the user has approved at least once, or (b) the ability to send a request without an `Origin` header (any non-browser local HTTP client — curl, a script, the documented Node/Bun/SSR SDK path).

9. **Why mitigations fail**: the encoded-length caps (`MAX_BYTECODE_BYTES`/`MAX_WITNESS_BYTES`) bound the *size* of the strings but not the *cost of parsing/copying* them, which still happens synchronously; the per-origin (4) and global inflight (8) admission caps bound concurrency but do not change where the work runs; the single `prove_semaphore` that would otherwise serialize expensive work is never reached because the crafted request is designed to fail validation immediately after parsing, so this path is not rate-limited by the proving pipeline at all.

10. **Instances**: `packages/presto/core/src/server/ultra_honk.rs:330` (call site) and `packages/presto/core/src/server/ultra_honk.rs:168-188` (`parse_request` body, including the `serde_json::from_slice` at line 169 and the visitor at lines 109-153). One root cause, one call site.

## Non-findings considered

- **No-Origin / `--allow-all` callers exempt from the per-origin UltraHonk cap** (`packages/presto/core/src/server/prove.rs:257-260`, `packages/presto/core/src/server/auth.rs:80-84`): confirmed the gap is real (a caller that omits `Origin` gets no `OriginSlots` entry and is bounded only by the shared global `MAX_INFLIGHT_PROVE` cap), but this is explicitly documented and accepted design, not a new path: `implementations-plan/presto-noir/plan.md` states the per-origin cap is "admission fairness, not protection against an approved attacker" and spells out that no-Origin callers and `--allow-all` are exempt "documented as a dev/CI mode." Not re-reported per the DO-NOT-FLAG rule for accepted, documented trust boundaries.
- **Host guard bypass / DNS rebinding**: `host_is_trusted` (`server/host.rs:22-54`) is outermost, fails closed on absence/disagreement, rejects userinfo, alternate numeric/mapped IPv6 forms, and multi-dot trailing forms (tests at `server/host.rs:96-160`); no bypass found.
- **Origin canonicalization / homograph or trailing-dot collision**: `canonicalize_origin` (`authorization.rs:22-73`) rejects trailing-dot hosts, punycode-normalizes IDN hosts (no ASCII/homograph collision), validates extension-ID grammar exactly; no collision path found.
- **Popup cross-resolution / SEC-06**: `respond_auth`/`get_pending_auth` (`commands.rs:463-534`) bind the calling window to its own `request_id` via an unspoofable Tauri window label, and `resolve_active` (`authorization.rs:533-556`) only accepts the currently-active popup; a queued popup's webview cannot resolve itself even if coerced.
- **Revocation racing a queued UltraHonk job**: three `ensure_not_revoked` checks (`ultra_honk.rs:334,339,352`) cover pre-decode, post-decode, and pre-bb-run; the approval-read and generation-stamp happen under the same `AuthorizationManager` lock as `revoke()` (`authorization.rs:493,500`), so no window was found where a Settings removal fails to be observed.
- **Gzip/base64 bomb**: encoded-length caps run before decode (`ultra_honk.rs:175-186`), decode is capped again post-decode (`decode_field`, line 196-206), and `inflate_dry_run` (line 219-245) counts every concatenated gzip member against `MAX_INFLATED_BYTES` with per-chunk cancellation; all of this correctly runs inside `on_worker`/`spawn_blocking` (only `parse_request`, F-1, does not).
- **`verifier_target` reaching bb's argv unsanitized**: the client string is parsed into a closed 8-variant enum (`bb/ultra_honk.rs:31-98`) before any command is built; only `as_flag()`'s fixed literal reaches `Command::args` (`bb/ultra_honk.rs:262-263`). No injection path.
- **Client-key / cross-circuit key confusion**: a client-supplied `vk` can only spoil that client's own proof (accepted, documented in `packages/presto/README.md`); the Windows text-mode workaround (`bb/ultra_honk.rs:206,218-221`) sets the key aside and has bb recompute it rather than silently corrupting it — verified by the `command_carries_k_for_a_client_key_and_write_vk_without_one` test.
- **bb's own JSON output trusted blindly**: `read_outputs`/`parse_fields`/`FieldArray` (`bb/ultra_honk.rs:326-406`) stream-validate every hex field, cap the field count, and reject duplicate/trailing content before any byte reaches the HTTP response.
- **`/health` origin-tiering / CORS fingerprinting**: minimal vs. detailed body is gated by `health_is_detailed` (`server.rs:415-438`) using the same approval check as prove; `schemes` is intentionally exposed on both tiers (a static capability flag, not per-user data) so an unapproved caller can decide whether to attempt `/prove/ultra-honk` — not a new disclosure.
- **Premature admission release racing a killed/abandoned bb process**: matches the already-tracked item (PR #28, not yet on this branch); not re-reported.

## Out of cluster

- None found serious enough to flag; the GitHub-download digest-verification circular-trust caveat (`versions/downloader.rs`) and the auth-popup frontend HTML (origin string rendering) are outside this cluster's file list and were not read.

## Cross-rebuttal

**(1) What Codex missed.** Codex's report (`route-ingress-codex.md`) reports zero findings and does not examine where CPU-bound work in `prove_ultra_honk` actually runs. It never notes that `parse_request` (`packages/presto/core/src/server/ultra_honk.rs:330`, body at lines 168-188) is called directly on the async task rather than through `on_worker`/`spawn_blocking` — the exact discipline the same handler applies to every *other* CPU-bound stage (`decode_and_check`, `UltraHonkWorkspace::create`, `read_ultra_honk_outputs`, all via `on_worker` at `ultra_honk.rs:286-304`). This is my F-1: a real, concrete, in-cluster gap Codex's review did not surface.

**(2) Verification of Codex's non-findings.** Codex made no positive findings; I spot-checked its cited evidence for each non-finding against source, including two files it cites that I had not read line-by-line for my own report (`bb.rs`, `README.md`). All check out:

- **Origin omission / DNS rebinding** (`auth.rs:80`, `host.rs:69,79`) — VERIFIED. `host.rs:69/79` are the exact fail-closed match arms in `guard()`; `auth.rs:80` is the comment documenting the (accepted) no-Origin bypass, code path is `auth.rs:84`.
- **Origin aliasing** (`authorization.rs:25,41,62`) — VERIFIED. Line 41 is exactly the trailing-dot rejection (`host.ends_with('.')`); line 62 is the chrome-extension grammar arm.
- **Popup approval forgery / cross-popup disclosure** (`commands.rs:475,526`, `authorization.rs:533`) — VERIFIED. All three are the exact window-label-binding and `resolve_active` active-slot-only lines I independently traced.
- **Authorization backlog exhaustion** (`authorization.rs:451,459,439`) — VERIFIED (line 451 is one line off the actual `>= MAX_PIGGYBACK_SENDERS` check at 449, immaterial).
- **Delayed approval restoring revoked access** (`auth.rs:47`, `authorization.rs:500,510,317`) — VERIFIED, matches `revoke`/`persist_allow`/`revoked_since` exactly.
- **Queued proof surviving revocation** (`ultra_honk.rs:334,339,352`, `prove.rs:312`) — VERIFIED, the three `ensure_not_revoked` call sites I also traced for F-1's context.
- **Single-origin admission monopolization** (`prove.rs:257`) — VERIFIED, and I independently reached the same conclusion (documented/accepted in `implementations-plan/presto-noir/plan.md`); listed in my own Non-findings.
- **Oversized/stalled bodies** (`prove.rs:139,185,254`) — VERIFIED.
- **Base64/gzip bombs** (`ultra_honk.rs:175,196,225,296`) — VERIFIED.
- **JSON ambiguity/command injection** (`ultra_honk.rs:140`, `bb/ultra_honk.rs:92,251`) — VERIFIED, closed-enum + fixed-flag command construction confirmed.
- **Witness paths / cross-request files** (`bb/ultra_honk.rs:211`, `bb.rs:233,277`) — VERIFIED by direct read: line 233 is exactly `builder.permissions(...0o700)`, line 277 is exactly `options.write(true).create_new(true)` — precise, not approximate.
- **Health disclosure / CORS** (`server.rs:445,389`) — VERIFIED.
- **Raw stderr disclosure** (`bb.rs:477`, `bb/ultra_honk.rs:315`) — VERIFIED by direct read: line 477 is exactly the `// Never return stderr to HTTP clients` comment in `require_success`.
- **Known exclusions** (`bb.rs:359`, `README.md:84`) — VERIFIED: `README.md:84` is exactly the "Trust boundary" paragraph documenting the shared boundary and 4-per-origin/global caps; `bb.rs:359` sits in `run_bb`'s wait/containment-finish sequence, consistent with the tracked PR #28 issue.

I found no inaccurate citation and nothing to dispute; Codex's non-findings are sound as far as they go, they simply stop short of the async-runtime-blocking angle.

**(3) Revisions to my own findings.** No withdrawal or downgrade. Codex's independent pass corroborates every non-finding I separately reached (including the no-Origin per-origin-cap gap being accepted/documented, and the PR #28 exclusion), which raises my confidence that I am not missing an obvious counter-argument against F-1 — nothing in Codex's report explains why running `serde_json::from_slice` on a near-cap-size body synchronously on the tokio runtime is safe, and no other reviewer flagged a mitigating factor (e.g., a dedicated single-purpose runtime, or evidence the parse is negligible in practice). I am not strengthening the confidence rating either, since neither report includes a benchmark — F-1 stands as originally stated: moderate confidence, availability-only, bounded magnitude.
