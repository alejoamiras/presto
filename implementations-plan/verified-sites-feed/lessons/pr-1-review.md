# PR 1: Codex fix loop

## Round 1 (2026-10-13, `gpt-6.1-sol`, high, fresh session)

Verdict: not ready, 3 material findings. All verified against the repository and accepted.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | The tripwire and the sign job's stale check covered `core/src/verified_sites` and the CLI only; `core/src/lib.rs`, `Cargo.toml`, `Cargo.lock` and `authorization.rs` (which `list.rs` imports) could change what the CLI prints without being listed | important | **Accepted.** `SIGNING_PATHS` now holds the whole core crate, `rust-toolchain.toml` and a root `.cargo/` (cargo reads config from the working directory up); the contract test requires them. |
| 2 | The round trip's equivocation case edited `.entries[0]`, so an empty list (documented as valid) failed the gate with `missing field origins` | important | **Accepted.** The case reuses the whitespace-tampered list: same version, other bytes, valid for any content. Run locally on an empty list: every case passes. |
| 3 | With no history, `plan_signing` and the repo test let the first list take any version, so a first record at 2^53 − 1 would wedge the counter | important | **Accepted.** Before the first record the bound counts from 0 (`prepare` and the repo test); new cases in the unit and repo tests. Mutations: removing either bound fails a test. |
| m1 | A backtick in a changed file name could close the summary's code span | minor | **Accepted.** Backticks show as `'`. The tripwire's `git diff` also moved out of the `elif` condition, where a failure read as "Unchanged". |
| m2 | The runbook's failed-record recovery skipped deleting the record branch, which `prepare` refuses past | minor | **Accepted.** |
| m3 | Two comments restated their code (the Worker's map, the registry count) | minor | **Accepted.** One removed, one cut to its why. |

Areas Codex reported as holding: artifact hash bindings, create-only record branches and the
retained-branch check, append-only enforcement, secret scoping, the KV guard's refusals, live and
history verification, Worker routing.
