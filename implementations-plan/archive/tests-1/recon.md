# tests-1 recon

Base: `main` at `80b562e`. One Sonnet reuse sweep plus the driver's own reproductions. Paths are
relative to `packages/presto/` unless they start with `implementations-plan/` or `.github/`.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| Run one Rust test alone in a child process | One inline copy: `core/src/server/tests.rs:2107-2133` (`current_exe()` + `--exact <name> --test-threads=1` + an env marker, asserts `1 passed`). No shared helper; the only `#[cfg(test)]` helper in `core/src/lib.rs` is `ScopedPrestoHome` (:111-141). Searched `current_exe`, `--exact`, `test-threads`, `_CHILD` over `core`, `src-tauri`, `server`. | adapt (only if the panel picks isolation) |
| Bounded lock wait | `core/src/file_lock.rs:106` `lock_exclusive_within` (polls `try_lock_exclusive` every 20 ms); the store waits `LOCK_WAIT` = 1 s (`store.rs:13`). | reuse-as-is (only if the panel picks a wait) |
| Lock-is-free probes | `store.rs:211` `Dir::lock_is_free`, asserted at :342, :358, :372, :398; the precondition `held.is_some()` at :385; `config.rs:1076` (`try_acquire_config_write_lock_nb(..).is_some()` after a drop). `update_schedule/tests.rs:454` asserts held, not free; `versions/leases.rs` leases are in-process mutexes. | the class #141 belongs to |
| Process spawns in the same test binary | `core/src/bb.rs` tests (`/bin/sh`, `sleep`, `ping`), `custom_bb/tests.rs:241` (`/bin/chmod`), `server/tests.rs:2123` (self re-run). | the cause |
| Proof that a task never blocks | No `flavor = "current_thread"` anywhere; plain `#[tokio::test]` is current-thread. `update_schedule/tests.rs` uses `start_paused` rigs and the `cfg(test)` `LOOP_WAKEUPS` counter, which an integration test cannot see. Every case in `src-tauri/tests/verified_sites_feed.rs` is `multi_thread`. | adapt: case_24 on the default (current-thread) runtime |
| Hook that ends a pending `/prove` | `e2e-webdriver/verified-sites.spec.ts:146-158` closes windows, then awaits; `trust-boundary.spec.ts:198-210` detaches the promise, then closes. No `AbortController` in `e2e-webdriver/`. | reuse the verified-sites order |
| Origin per test | `ultra-honk.spec.ts:26-27` uses `ALLOW_ORIGIN` and `DENY_ORIGIN`. `auth-flow.spec.ts:17` shares one origin across both tests. `removeOriginViaUI` is a no-op for an origin not on disk (`helpers.ts:158`). | reuse the ultra-honk shape |

## Facts the issues rest on

- **#141.** `a_save_waits_for_the_lock_and_releases_it` asserts `held.is_some()` at `store.rs:385`.
  Full `cargo test --locked` of presto-core on this 188-core Linux host failed 7 of 40 runs, in
  three tests, always at a lock-is-free check right after a save (:342 ×3, :372 ×3, :385 ×1). The
  store tests run serially (`--test-threads=1`, store tests only): 40 of 40 pass. An instrumented
  build named the holder at 5 failures: this process held no descriptor for the lock, exactly one
  child process existed, and the lock was free 19–36 µs later. A standalone program (scratch, not
  committed): 20,000 open-lock-drop-`try_lock` cycles see the lock held 0 times alone and 30 and
  42 times beside one thread spawning `/bin/true`. Rust opens with `O_CLOEXEC`, so the child's copy
  lives only from the fork to the exec. **Hypothesis confirmed (demonstrated).** Production impact:
  none; every save polls the lock for up to `LOCK_WAIT`.
- **#136.** The bound is `worst < Duration::from_millis(250)` at `tests/verified_sites_feed.rs:595`
  (the `assert!` opens at :594). Healthy runs here: 99 checks, worst gap 11 ms (multi-thread); 95
  checks, worst 12 ms (current-thread). A mutant list check that sends its request and then blocks
  its thread for 2 s **passes the current test** (99 checks, worst 13 ms, one request: the other
  worker threads keep the update task on time). On a current-thread runtime the same mutant fails
  at the count (6–7 checks) in 3 of 3 runs; a mutant blocking before the request gives 1 check.
  The hung path itself makes no blocking call (`src-tauri/src/verified_sites.rs:153-183`,
  `core/src/verified_sites/fetch.rs:55-68`; the only `spawn_blocking` is `persist`, reached only
  after a successful fetch).
- **#98.** `auth-flow.spec.ts:49-54` awaits `pendingProve` and closes nothing; Mocha's hook
  timeout is 30 s (`wdio.conf.ts:45`); the decision deadline is 60 s (`core/src/server.rs:64`,
  armed per active popup at `src-tauri/src/commands.rs:757`; the request itself waits at most
  `AUTH_QUEUE_BACKSTOP`, 660 s, at `core/src/server.rs:71-76`). Closing a popup resolves Deny
  (`commands.rs:781`) and every Deny records a 30 s per-origin cooldown
  (`core/src/authorization.rs:230`, :486, :551). Both tests use one origin, so after a cleanup
  deny in test 1 the Deny test's request is refused at once with no popup, and its
  `waitForNewWindow` fails after 15 s (code trace; plausible until run).

## Collisions

Open issues touching these files: none besides #141, #136, #98. Closed `known-limit` issues
searched (`lock`, `flake`, `test`, full list read): none in this area. Sibling lanes (`release-1`,
`deps-1`) touch neither the Rust crates nor `e2e-webdriver/`.

## Running the touched suites

- Core: `cargo test --locked` from `core/` (5 s here).
- Feed: `cargo test --locked --test verified_sites_feed` from `src-tauri/`; needs `bun run
  frontend:build` and an empty `src-tauri/binaries/bb-x86_64-unknown-linux-gnu`; a plain build
  rewrites `src-tauri/gen/schemas/linux-schema.json`, so restore it before committing.
- WebDriver on a headless Linux host: `implementations-plan/archive/verified-sites-feed/lessons/phase-9.md`
  §"Running the WebDriver suite locally" and `implementations-plan/archive/custom-bb/lessons/phase-5.md`
  (stalonetray via `apt-get download` + `dpkg -x`, `dbus-run-session -- bash
  scripts/run-webdriver-local.sh`, a scratch copy of the runner ending in `--spec`).
