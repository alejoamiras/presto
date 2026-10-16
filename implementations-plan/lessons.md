# Lessons

Gotchas that bit us and would bite again on unrelated work. **Read before starting a task.**

One line each, ~8 KiB budget: every promotion is a pruning pass. Facts CLAUDE.md already states do
not belong here. Sections are stable; append, never re-sort.

## Rust, Cargo and Clippy

- **Hoisting RAII guards into a struct reverses their drop order** (fields drop in declaration order).
  `archive/presto-noir/lessons/phase-3.md`
- **A blocking `recv()` in `#[tokio::test]` deadlocks** — the single-threaded runtime cannot drive the
  sender. `archive/presto-noir/lessons/phase-4.md`
- **`Guard::drop` runs before tokio reaps the child** — confirm a kill from a spawned task, not `Drop`.
  `archive/presto-noir/lessons/arc-1-review.md`
- **Clippy scores `tracing!` expansions and `#[test]` bodies under `--all-targets`**.
  `archive/presto-cleanup/lessons/phase-3.md`
- **Tauri menu callbacks have no Tokio context** — use `tauri::async_runtime::spawn`; hold no lock
  across a menu setter. `archive/update-check-schedule/lessons/phase-3.md`
- **An unfulfilled `#[expect]` is an error under `-D warnings`** — check from a clean build, every
  feature set. `archive/presto-cleanup/lessons/review-18.md`
- **A path that goes on without the lock must still read what the lock guards**.
  `archive/verified-sites-feed/lessons/pr-2-review.md`
- **Tauri runs each async command as its own task** — two saves sent together take the lock in either
  order. `archive/rc-update-channel/lessons/arc-2-review.md`

## Build, bundling and dependencies

- **`minimumReleaseAge` is npm-only** — `cargo update` took 27 crates inside the 7-day window; diff a
  fresh `.crate` against its tag. `archive/presto-rustls-fix/lessons/phase-1.md`
- **A one-line `overrides` change makes `bun install` re-dedupe the whole lock** — splice only the
  target's entries. (2026-10, bun 1.4.0) `archive/presto-audit-fix/lessons/phase-1.md`
- **Vite only bundles a literal `new URL("./f", import.meta.url)`**.
  `archive/presto-noir/lessons/phase-17.md`
- **`require.resolve` on a dual package picks CJS, which Rolldown gives Node-mode interop** —
  `.default` became all of `exports`; resolve the ESM entry. (2026-09, Vite 8.3)
- **Wrangler: any bump fails `release-feed`'s typecheck** until `worker-configuration.d.ts` is
  regenerated; `kv key get --remote` errors on a missing key (list first). (2026-10, 4.135)
  `archive/rc-update-channel/lessons/phase-7.md`
- **`bun --config /dev/null <script>` exits 0 without running it**; only `--config=/dev/null` works.
  (2026-10, Bun 1.4.2) `archive/verified-sites-feed/lessons/phase-2.md`

## Types and package boundaries

- **A class with private fields is nominal in TypeScript** — use `Pick<Class, …>`.
  `archive/presto-noir/lessons/arc-4-review.md`
- **`tsc` checks nothing behind an unresolved side-effect import** — use a named import.
  `archive/presto-banners-publish/lessons/codex-loop.md`
- **A forced `checkStatus()` joins a probe already in flight** — wait it out, then force.
  `archive/lna-consent/lessons/cross-arc-review.md`

## Tests

- **Re-reading a validated caller object after an `await` is a TOCTOU hole** — snapshot at entry.
  `archive/presto-noir/lessons/arc-3-review.md`
- **`vite preview` serves no COOP/COEP** — no `crossOriginIsolated`, no WASM threads; assert it.
  `archive/presto-noir/lessons/arc-5-review.md`
- **wdio 9 wraps workers in `xvfb-run` when `DISPLAY` is unset**, killing their IPC.
  `archive/presto-noir/lessons/phase-6.md`
- **wdio `browser.refresh()` returns while the old document still answers** — wait for a fresh one.
  `archive/rc-update-channel/lessons/arc-1-review.md`
- **A test that self-skips with `return` reports `ok`** — grep the lane's log for the skip message.
- **"Green" without a run ID is not green**; a platform with no lane was never exercised.
  `archive/presto-noir/lessons/audit-fixes.md`
- **A regression test proves nothing until it fails against the old code**.
  `archive/lna-consent/lessons/cross-arc-review.md`
- **A native-path smoke can pass on a silent WASM fallback** — assert the phase trail.
- **A refused loopback port and a Local Network Access block are both `Failed to fetch`** — only CDP
  `Network.loadingFailed` tells them apart. `archive/lna-consent/lessons/arc-2-review.md`
- **An Aztec local network accepts fake proofs** unless `DEBUG_FORCE_TX_PROOF_VERIFICATION=true`.
  (2026-10, 6.0.0-rc.3) `archive/presto-rc3/lessons/phase-4.md`
- **Pin a test host to `.test`, not `.invalid`** — resolvers may NXDOMAIN `.invalid` before the hosts
  file (RFC 6761 §6.4). `archive/rc-update-channel/lessons/phase-0.md`

## CI and release

- **A `workflow_dispatch` input is `''` on every other trigger** — read `inputs.x || '<default>'`.
  `archive/presto-noir/lessons/phase-12.md`
- **A `concurrency` group that ignores dispatch inputs cancels your own sibling runs**.
  `archive/presto-noir/lessons/arc-3-review.md`
- **`needs.<job>.result == 'skipped'` cannot tell "not selected" from "gate failed"**.
  `archive/presto-noir/lessons/arc-4-review.md`
- **Tool-version files must appear in the paths-filter groups**.
  `archive/presto-cleanup/lessons/review-17.md`
- **Anonymous `api.github.com` calls share 60/hour per egress address**.
  `archive/aztec-v6/lessons/releases.md`
- **A workflow change merged mid-`release-presto` fails its tag push** — redispatch from `main`.
  `archive/aztec-v6/lessons/releases.md`
- **A ruleset requiring up-to-date contexts lands a stack one level at a time**.
  `archive/presto-noir/lessons/cross-arc-review.md`
- **`bash -e` covers neither an `if` condition nor a `$(…)` inside an argument** — assign first.
  `archive/workers-builds/lessons/phase-3.md`
- **tauri-plugin-updater verifies minisign inside `download()`, and its `Update` has no timeout**
  — assert which refusal fired; bound the download yourself. (2026-10, plugin 2.11)
  `archive/rc-update-channel/lessons/phase-4.md`
- **A `release-sdk` dry run skips the dependency audit**. `archive/presto-rc3/lessons/phase-3.md`
- **Root `scripts/*.test.ts` pin workflow text** — a package's own tests miss them.
  `archive/rc-update-channel/lessons/phase-7.md`

## npm publishing

- **`npm audit signatures` never checks the bytes you installed** — bind the subject digest.
  `archive/presto-noir/lessons/audit-fixes.md`
- **A credentialed job installs nothing or the lockfile first** — `--frozen-lockfile` still runs
  lifecycle scripts, and `bunx` with no install fetches whatever npm serves.
  `archive/rc-update-channel/lessons/arc-3-review.md`
- **npm answers 404 for "not yet" and "forbidden", and caches reads** — wait, `npm whoami`, read
  uncached. `archive/presto-noir/lessons/arc-2-review.md`

## Windows

- **`bb.exe` does binary file I/O in text mode** (0x1A, 0x0A) — use `--output_format json`.
  `archive/presto-noir/lessons/arc-1-review.md`
- **`Command` escapes quotes as `\"`, which `cmd.exe` mangles** — use `current_dir()`.
  `archive/presto-noir/lessons/audit-fixes.md`
- **Node-based actions cannot see Git Bash's `/tmp`** — use `$RUNNER_TEMP`.
  `archive/presto-noir/lessons/arc-1-review.md`
- **A refused loopback connect takes ~2 s, and a path beneath a file is `NotFound`**.
  `archive/verified-sites-feed/lessons/phase-10.md`
- **A byte-compared fixture needs `-text` in `.gitattributes`** — the checkout makes it CRLF.
  `archive/rc-update-channel/lessons/phase-1.md`

## Local tooling

- **zsh aborts the whole line when any glob matches nothing**. `archive/presto-noir/lessons/phase-16.md`
- **git hooks do not inherit your PATH** — the commit silently aborted.
  `archive/presto-noir/lessons/phase-3.md`
- **Local shellcheck 0.11 passes what CI's 0.9 fails** — use `koalaman/shellcheck:v0.9.0`.
  `archive/workers-builds/lessons/post-impl.md`
