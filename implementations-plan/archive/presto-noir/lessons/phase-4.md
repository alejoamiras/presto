# Phase 4 — handler, route, health, per-origin slot, revocation ordering

Date: 2026-09-08.

## What landed

- `core/src/server/ultra_honk.rs`: `POST /prove/ultra-honk`. Manual `Deserialize` for the JSON body
  (unknown keys ignored, duplicate keys rejected, required keys named); cheap checks on the runtime
  thread (shape, `VerifierTarget`, encoded-length caps); the heavy work — padding-indifferent base64,
  gzip magic, capped inflate dry-run with a per-chunk cancel flag — on a `spawn_blocking` worker that
  **owns** `Admitted` + `Prover` (permit, lease, inflight slot, origin slot) until it returns;
  revocation re-check before and after the worker; `OriginSlots` (cap 4 per origin, RAII release);
  per-job info log (`scheme`, origin, target, ok, `elapsed_ms`) for the metering follow-up.
- `authorization.rs`: `Generation`, `AuthOutcome { decision, generation }` stamped at decision time
  in `resolve`/`resolve_active`; `with_generation`, `revoke(origin, apply)`, `persist_allow(origin,
  granted_at, apply)`, `revoked_since`; bounded revocation map. No approved-set mirror — the persisted
  config stays the only durable authority and the manager lock brackets its reads and writes.
- `server/auth.rs`: `authorize_origin` returns `Approval { origin, granted_at }`; a popup Allow older
  than a removal is dropped; a failed/read-only save still grants the current request and re-prompts.
- `server/prove.rs`: `admit(state, request, Option<&OriginSlots>)`; `Admitted` carries the approval
  and the origin slot (last in drop order).
- `server.rs`: `API_VERSION`, `SCHEMES`; `schemes` on both health bodies, identity `versions` pairs on
  the detailed body; `OriginQueueFull` (429), `InvalidRequest` (400), `InvalidVerifierTarget` (400);
  `ProveError::into_response` split into admission/prove halves for the 80-line rule; route mounted.
- `probe.rs` uses `API_VERSION`; `src-tauri/src/commands.rs` `remove_approved_origin` goes through
  `AuthorizationManager::revoke`.

## Verified here

- 13 new tests: request parsing (duplicates, unknown keys, missing fields, oversize, bad target),
  decode/gzip/inflate rules incl. cancellation, origin-slot cap/release, guard ownership across a
  dropped `JoinHandle`, render shape; router: raw outputs + key-only-when-computed + status sequence,
  named text/plain 400s, fifth-job shedding for one origin while another is admitted, revoked-while-
  queued 403, health bodies, manager revocation ordering, failed-persist still proves and re-prompts.
- Existing suites untouched and green: core 286, desktop 122 + 10 + 1, Playwright UI 84.

## Notes

- Clippy scores expanded `tracing` macros: the 19-arm `into_response` crossed 80 lines by three arms
  and was split by concern rather than carrying an `#[expect]`.
- A blocking `mpsc::recv()` inside a `#[tokio::test]` (single-threaded runtime) deadlocks the router
  request behind it; the popup loop in tests must be a plain thread.
- `cargo test` takes one positional filter; several go after `--`.
- Inside the desktop crate the crate is `crate::`, not `presto::` (the package name).

## Gate

`bun run lint:rust` ✓ · `bun run lint:clippy` ✓ · core `cargo test --locked` (286) ✓ · src-tauri
`cargo test --locked` ✓ · `cargo check --target x86_64-pc-windows-gnu --lib` ✓ ·
`bun run --cwd packages/presto test:unit` (103) ✓ · `bun run --cwd packages/presto test:e2e:ui` (84) ✓.
