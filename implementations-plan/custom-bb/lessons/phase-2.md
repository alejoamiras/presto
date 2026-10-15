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
