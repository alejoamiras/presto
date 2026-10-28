# Lessons

Gotchas that bit us and would bite again on unrelated work. **Read before starting a task.**

One line each, ~8 KiB budget: every promotion is a pruning pass. Facts CLAUDE.md already states do
not belong here. Sections are stable; append, never re-sort.

## Rust, Cargo and Clippy

- **Hoisting RAII guards into a struct reverses their drop order** (fields drop in declaration order).
  `archive/presto-noir/lessons/phase-3.md`
- **`#[tokio::test]` is one thread**: a blocking `recv()` deadlocks it; a blocked task stalls its
  siblings, which `multi_thread` hides. `archive/presto-noir/lessons/phase-4.md`, `archive/tests-1/plan.md`
- **`Guard::drop` runs before tokio reaps the child** — confirm a kill from a spawned task, not `Drop`.
  `archive/presto-noir/lessons/arc-1-review.md`
- **Clippy scores `tracing!` expansions and `#[test]` bodies under `--all-targets`**.
  `archive/presto-cleanup/lessons/phase-3.md`
- **Tauri menu callbacks have no Tokio context** — use `tauri::async_runtime::spawn`; hold no lock
  across a menu setter; run read-then-set on the main thread.
  `archive/update-check-schedule/lessons/phase-3.md`, `archive/custom-bb/lessons/phase-3.md`
- **A path that skips the lock must still read what the lock guards**.
  `archive/verified-sites-feed/lessons/pr-2-review.md`
- **Tauri runs each async command as its own task** — two saves take the lock in either order.
  `archive/rc-update-channel/lessons/arc-2-review.md`
- **An `await` splits a check from its use** — re-check shared state under the lock that writes it;
  snapshot a validated caller object at entry.
  `archive/custom-bb/lessons/phase-3.md`, `archive/presto-noir/lessons/arc-3-review.md`
- **Linux cannot compile macOS `cfg` code** (`aws-lc-sys` needs Darwin) — CI's macOS lane is the
  first compile; check `libc` bindings by hand. `archive/custom-bb/lessons/phase-1.md`
- **An error's `to_string()` can name a local path and drop the OS reason** (tar, tempfile) — keep
  it off the wire; log `error = &e as &dyn Error` (prints `error.sources`). `archive/server-1/recon.md`
- **On Linux, Tauri's `.center()` and `prevent_overflow()` ignore the title bar, and
  `primary_monitor()` must run on the main thread** (GDK). `archive/windows-1/recon.md`

## Build, bundling and dependencies

- **`minimumReleaseAge` is npm-only** — `cargo update` took 27 crates under 7 days old; diff a fresh
  `.crate` against its tag. `archive/presto-rustls-fix/lessons/phase-1.md`
- **Wrangler: any bump fails `release-feed`'s typecheck** until `worker-configuration.d.ts` is
  regenerated (2026-10, 4.151); `kv key get --remote` errors on a missing key, so list first (4.135).
  `archive/deps-1/lessons/phase-1.md`, `archive/rc-update-channel/lessons/phase-7.md`
- **`bun --config /dev/null <script>` exits 0 without running it**; only `--config=/dev/null` works.
  (2026-10, Bun 1.4.2) `archive/verified-sites-feed/lessons/phase-2.md`
- **`bun.lock` records a bundling package's declared deps, not its `bundleDependencies`** — `bun
  audit` misses the copy Node loads, and all that esbuild inlined (wrangler's `cli.js`, #187).
  (2026-10, Bun 1.4.2) `archive/deps-1/recon.md`
- **`bun update <transitive>` re-resolves every copy within its ranges**; a scripted edit that
  breaks its JSON makes Bun re-resolve the whole tree. (2026-10, Bun 1.4.2)
  `archive/deps-1/lessons/phase-0.md`

## Types and package boundaries

- **A class with private fields is nominal in TypeScript** — use `Pick<Class, …>`.
  `archive/presto-noir/lessons/arc-4-review.md`
- **`tsc` checks nothing behind an unresolved side-effect import** — use a named import.
  `archive/presto-banners-publish/lessons/codex-loop.md`

## Tests

- **`vite preview` serves no COOP/COEP** — no `crossOriginIsolated`, no WASM threads; assert it.
  `archive/presto-noir/lessons/arc-5-review.md`
- **wdio 9 wraps workers in `xvfb-run` when `DISPLAY` is unset**, killing their IPC.
  `archive/presto-noir/lessons/phase-6.md`
- **wdio `browser.refresh()` returns while the old document still answers** — wait for a fresh one.
  `archive/rc-update-channel/lessons/arc-1-review.md`
- **A test that self-skips with `return` reports `ok`; "green" without a run ID is not green** —
  grep the lane's log for the skip; a platform with no lane never ran.
  `archive/presto-noir/lessons/audit-fixes.md`
- **A refused loopback port and an LNA block are both `Failed to fetch`** — only CDP
  `Network.loadingFailed` tells them apart. `archive/lna-consent/lessons/arc-2-review.md`
- **An Aztec local network accepts fake proofs** unless `DEBUG_FORCE_TX_PROOF_VERIFICATION=true`.
  (2026-10, 6.0.0-rc.3) `archive/presto-rc3/lessons/phase-4.md`
- **Pin a test host to `.test`, not `.invalid`** — resolvers may NXDOMAIN `.invalid` before the hosts
  file (RFC 6761 §6.4). `archive/rc-update-channel/lessons/phase-0.md`
- **Env vars and `flock` probes need the test process alone** (a var leaks into concurrent tests; a
  spawned child holds every fd until exec) — use core's `run_alone()`.
  `archive/custom-bb/lessons/phase-2.md`, `archive/tests-1/lessons/phase-0.md`
- **Playwright's `reuseExistingServer` on a fixed port tests whichever worktree's server is up** —
  check the port first. `archive/custom-bb/lessons/phase-4.md`

## CI and release

- **A `workflow_dispatch` input is `''` on every other trigger** — read `inputs.x || '<default>'`.
  `archive/presto-noir/lessons/phase-12.md`
- **A `concurrency` group that ignores dispatch inputs cancels sibling runs**.
  `archive/presto-noir/lessons/arc-3-review.md`
- **`needs.<job>.result == 'skipped'` cannot tell "not selected" from "gate failed"**.
  `archive/presto-noir/lessons/arc-4-review.md`
- **Tool-version files must appear in the paths-filter groups**.
  `archive/presto-cleanup/lessons/review-17.md`
- **A workflow change merged mid-`release-presto` fails its tag push** — redispatch from `main`.
  `archive/aztec-v6/lessons/releases.md`
- **A ruleset requiring up-to-date contexts lands a stack one level at a time**.
  `archive/presto-noir/lessons/cross-arc-review.md`
- **`bash -e` covers neither an `if` condition nor a `$(…)` inside an argument** — assign first.
  `archive/workers-builds/lessons/phase-3.md`
- **A syntactic guard accepting a literal must allowlist what follows it** (`,` `)`), not denylist
  `.map`. `archive/release-1/lessons/review-round-3.md`
- **A lane staging artifacts by a fixed name list drops a new one silently** — grep every per-OS
  lane when the signer adds a file. (#144)
- **`ubuntu-latest` is Ubuntu 26.04, with `/tmp` on its own device** — tauri-plugin-updater 2.11's
  AppImage swap then aborts unless the XDG cache dir exists. (2026-10) `archive/release-2/recon.md`

## npm publishing

- **`npm audit signatures` never checks the bytes you installed** — bind the subject digest.
  `archive/presto-noir/lessons/audit-fixes.md`
- **A credentialed job installs nothing or the lockfile first** — `--frozen-lockfile` still runs
  lifecycle scripts; a bare `bunx` fetches whatever npm serves.
  `archive/rc-update-channel/lessons/arc-3-review.md`
- **npm answers 404 for "not yet" and "forbidden", and caches reads** — wait, `npm whoami`, read
  uncached. `archive/presto-noir/lessons/arc-2-review.md`
- **npm's stderr echoes registry text** — read absence from `npm view --json`'s `error.code`.
  `archive/release-1/lessons/review-round-1.md`

## Windows

- **`bb.exe` does binary file I/O in text mode** (0x1A, 0x0A) — use `--output_format json`.
  `archive/presto-noir/lessons/arc-1-review.md`
- **`Command` escapes quotes as `\"`, which `cmd.exe` mangles** — use `current_dir()`.
  `archive/presto-noir/lessons/audit-fixes.md`
- **A refused loopback connect takes ~2 s, and a path beneath a file is `NotFound`**.
  `archive/verified-sites-feed/lessons/phase-10.md`
- **A byte-compared fixture needs `-text` in `.gitattributes`** — the checkout makes it CRLF.
  `archive/rc-update-channel/lessons/phase-1.md`

## Local tooling

- **Local shellcheck 0.11 passes what CI's 0.9 fails** — use `koalaman/shellcheck:v0.9.0`.
  `archive/workers-builds/lessons/post-impl.md`
- **A fresh worktree needs `frontend:build` and the `binaries/bb-<triple>` placeholders before any
  `src-tauri` cargo command**, and any build there can rewrite `gen/schemas/*.json`.
  `archive/custom-bb/lessons/phase-1.md`
