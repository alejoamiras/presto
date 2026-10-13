# Phase 1: format, verifier, CLI, signing functions and fixtures

## Shipped

- `core/src/verified_sites/{mod,list,verify}.rs` as planned, plus two modules the plan's table did not
  name: `history.rs` (record reading, `plan_signing`, `classify_live`) and `report.rs` (the semantic
  diff as Markdown). Both are CI-only logic; putting them in the library rather than the example
  binary is what makes them unit-testable (`cargo test` does not run an example's tests).
- The CLI (`core/examples/verified-sites.rs`) gained a `live` subcommand next to the planned five:
  publish's verify job and the daily probe both need "where does the live document stand against
  history", which `check` computes internally anyway.
- `verify_document` accepts only the exact bytes `document()` builds, so a document's bytes identify
  it (publish's "skip if identical" and the client's cache compare bytes).
- Origins also refuse `<`, `>` and backticks: `url` lets a backtick through a domain host, and the
  summary's code spans must never close early.

## Gate (2026-10-08)

- `cargo test --locked` (core): 375 passed. `cargo clippy --all-targets -D warnings`: clean.
- `bun test packages/presto/scripts/verified-sites-fixtures.test.ts`: 2 pass (27 files byte for byte).
- `bun run test`: exit 0.
- Mutations, each failing at least one test, then reverted: `allow_legacy = true`; trusted-comment
  check skipped; equal-but-different judged `Accept`; `deny_unknown_fields` dropped from the list;
  `http` admitted.
- Stock minisign (`jedisct1/minisign` in Docker, `--network none`) verifies `list-4` and `list-5`
  under `test1.pub`, prints the same key ID (61A254A1DF31FE21), and refuses the wrong-key and tampered
  fixtures. It accepts the legacy `Ed` fixture, which our verifier refuses on purpose.

## Bitten

- **A mutation restored with `shutil.move` from a `.bak` copy keeps the copy's older mtime**, so Cargo
  reused the mutated build and two tests "failed" on correct code. Touch the file after restoring.
- `brand-sweep.test.ts` flags the release-bot App's login (it carries the retired product name) in
  any tracked file, plans included; the plan now says "the release-bot GitHub App".
