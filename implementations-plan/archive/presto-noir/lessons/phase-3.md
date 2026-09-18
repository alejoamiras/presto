# Phase 3 — `prove.rs` split into `admit` / `acquire_prover`

Date: 2026-09-07.

## What landed

- `admit(state, request) -> Admitted { body, requested_version, _status, _inflight }`: authorize →
  inflight slot → declared-size reject → capped/timed body read → version header → `Proving`.
- `acquire_prover(state, &requested_version) -> Prover { version, threads, _permit, _version_lease }`:
  resolve → download (owning Downloading→Proving) → threads → lease → the single permit.
- `prove()` is now a 15-line orchestrator; its `#[expect(clippy::cognitive_complexity)]` is gone.
  `log_prove_outcome` and `set_duration_header` are the render helpers the ultra_honk handler reuses.

## Verified here

- Every existing test passes **unedited**: core 273 (server suite 62 incl. `prove_success_path_and_status_sequence`,
  `body_read_does_not_hold_the_prove_permit`, 429 shedding, error shapes), desktop crate suites.
- Drop order preserved by struct field order (Rust drops fields in declaration order): `Prover` releases
  the permit before the lease; `Admitted` emits Idle before releasing the inflight slot — the same
  sequence the inlined locals produced in reverse declaration order.

## Notes

- The lint-staged hook runs `rustfmt` on staged `.rs` files; on this box `~/.cargo/bin` must be on
  PATH for the commit to go through (the first Phase 2 commit attempt silently aborted on that).
- `#[expect]` is the right exception mechanism: removing the attribute after the split is what proved
  the handler no longer trips the rule (an `allow` would have hidden that).

## Gate

`bun run lint:rust` ✓ · `bun run lint:clippy` ✓ · core `cargo test --locked` (273) ✓ ·
src-tauri `cargo test --locked` ✓ — zero edits to existing tests.
