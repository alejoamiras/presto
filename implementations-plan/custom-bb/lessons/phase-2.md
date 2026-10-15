# Phase 2: core route, spawn gate, wire, popup version

## Status (2026-10-15)

- Built on the local stand-in of the RC-channel contract (709cf63 + 67bb2f3, one `chore(stand-in)`
  commit that is dropped before any push). P1 step 3 and T6 run on it.
- Gate, all exit 0 on Linux x86_64:
  - `cargo test --locked` for core (426), server (14) and `src-tauri` (152 unit tests plus the
    integration suites);
  - `bun run lint:clippy`;
  - the Windows cross-check (`--lib --bins` from `src-tauri`, plus `--tests` on core).
- The Windows check caught a `cfg(windows)` test that still called `run_bb` with the old signature.
  It is the second time a Linux-only check missed a Windows compile break (see CLAUDE.md).

## Shape

- `BbBinary::Exact(Arc<dyn SpawnGate>)` carries the gate.
- The gate's `verify` (the D7 policy and the rehash) runs on `spawn_blocking`. Then `admit`
  returns a guard holding the config read lock across the synchronous spawn.
- `ConfigStore::hold_custom_bb` returns that guard only while the pin is still in effect and the
  store may persist. A stop takes the write lock, so it either precedes the check or follows the
  spawn.
- The admit guard is `!Send`, so admitting before the async verify does not compile: the proof
  future would stop being `Send`. The type system rules out the ordering T3 case 5 guards, and the
  test also covers it at run time.
- The custom route skips the download, the budget, the lease and the cache check. The first test
  exhausts the origin's download budget and still gets two 200s.
- The `/prove` and `/prove/ultra-honk` failure paths share `bb_failure`: a site sees
  `503 custom_bb_unavailable` or `500 prove_failed` with the text "bb prove failed", and Settings'
  activity record keeps the detail.
- `AppState.on_custom_bb_changed` is an `Option` the desktop sets in P3, so arc 1 changes no
  constructor signature.
- `AuthorizationManager::request` takes the request's parsed version (malformed → `None`). `peek`
  returns `(origin, active, version)`, and src-tauri ignores the third field until P3.

## T3 mapping

| Plan case | Test |
|---|---|
| 1, 2 | both routes return 200 and `x-presto-bb: custom`, which is in `access-control-expose-headers`; the budget is exhausted |
| 3 | changed file → 503, no path or hash in the body, fake never ran, tray callback fired |
| 4 | withdrawn while waiting on the permit (single-threaded runtime: once `Proving` is seen, the request has parked on the permit) |
| 5 | a gate wrapper withdraws the pin inside `verify`; the real `CustomRoute::admit` refuses; fake never ran |
| 6 | crash → 500 `prove_failed`, fixed text; the detail is in the activity record; no refusal callback |
| 7 | a store with `cap: None` (the headless server's shape) holding a record resolves to the official route; `BB_BINARY_PATH` refuses the label |

## Mutation check

| Stub | Result |
|---|---|
| admit before verify | does not compile (see Shape) |
| gate admits whatever the config says | T3 cases 4 and 5 fail |
| bundled shortcut before the label | T5 fails |
| env override ignored | the override test fails |
| custom failure text passed through | the crash test fails |
| refusal reported as 500 | T3 cases 3 and 4 fail |

## Assumptions checked

- **I5:** the release bb (bb.js 6.0.0-rc.6, `amd64-linux`) is 44.7 MB and hashes in 0.18 s with
  64 KiB reads. That figure is a stand-in from Python's OpenSSL hashing; the Rust `sha2` crate is
  in the same range. A 500 MB debug build would take about 2 s per proof, small beside a proof.

## Arc 1 Codex fix loop

**Round 1** (`gpt-6.1-sol`, high, session `01a14169-ee8f-7dc0-9836-f9256232afe2`): **reject**,
findings 1–3 blocking. Each was triaged against the code and accepted.

| # | Severity | Claim | Disposition |
|---|---|---|---|
| 1 | high | The private-group exception checks the group's name and its member list but not other accounts' primary gid. A second account created with `-g alice` gets group write through "alice's private group". | Fixed. `is_private_group` also requires that no other account has the gid as its primary group. On glibc the accounts come from `getpwent_r` under a process mutex, and an error drops the exception. Other Unix systems (macOS, where accounts default to `staff`) get no exception. Pure counterexample test added. Residual: accounts that an NSS source declines to enumerate (sssd's default) are not seen. |
| 2 | medium | On Windows, `Guard::finish` only disarms, so children bb left in the job survive the permit's release. | Fixed: `finish` terminates the job first, the Unix group kill's equivalent. A Windows-only regression test (`start /B ping`, then the job must hold no processes) was compile-checked here; it runs in CI. |
| 3 | medium | `/prove/ultra-honk` maps a workspace-creation error with `prove_failed(e)`, so on the custom route the temp path reaches the body. | Fixed: it goes through `bb_failure`. Test: `prove-tmp` is a file and `TMPDIR` doesn't exist, so the request gets a 500 with no path, the detail reaches the activity record, and the fake never ran. |
| 4 | low | No test proves that the test run holds the prove permit while bb runs. | Test added: a fake that marks its start and sleeps; while it runs, `take_test_permit` is `Busy`, and afterwards the permit is back. |
| 5 | low | Narrating comments on `BbBinary` and `BbSource`; `AdmitGuard`'s deliberate `!Send` is undocumented. | Fixed. |

Mutation check: dropping the permit at the top of `test_run_within` fails the new permit test.
Binding the parameter as `_` is an equivalent mutant, because a function argument lives until the
function returns. Reverting the ultra-honk mapping fails the workspace test. Dropping the account
scan fails the group test.

Observed, out of scope: `verified_sites::store::tests::a_save_waits_for_the_lock_and_releases_it`
failed once in five full runs at `assert!(held.is_some())`, and never when run alone. It looks
pre-existing: a concurrent test's fork can inherit the lock fd (`O_CLOEXEC` releases it only at
exec) just as the save drops it.
