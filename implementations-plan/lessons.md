# Lessons

Gotchas that already bit us and would bite again on unrelated work. **Read before starting a task.**

One line each, promoted when a plan closes. Budget ~8 KiB: every promotion is also a pruning pass —
deduplicate, merge, retire what it supersedes. A stale entry is worse than none, because it is read at
the start of every task. Sections are stable; append, never re-sort. What did not fit stays in the
per-phase logs under `archive/<plan>/lessons/`, which this file links into.
_Seeded 2026-09-18 from the three plans in `archive/`._

## Rust, Cargo and Clippy

- **Hoisting RAII guards into a struct reverses their drop order** — locals drop in reverse
  declaration order, struct fields in declaration order; nothing flags the inversion.
  `archive/presto-noir/lessons/phase-3.md`
- **A blocking `recv()` inside `#[tokio::test]` deadlocks the test** — the single-threaded runtime has
  no other thread to drive what the receiver waits on. `archive/presto-noir/lessons/phase-4.md`
- **`Guard::drop` runs before tokio reaps the child** — a confirm-the-kill wait inside `Drop` can only
  time out; use a spawned task with a cancel signal. `archive/presto-noir/lessons/arc-1-review.md`
- **Clippy scores macro-expanded code and `#[test]` bodies under `--all-targets`** — `tracing!` calls
  blow length and complexity limits while the source is well under them.
  `archive/presto-noir/lessons/phase-4.md`, `archive/presto-cleanup/lessons/phase-3.md`
- **An unfulfilled `#[expect]` is an error under `-D warnings`** — 26 of 39 suppressions went
  unfulfilled once the crate built clean, so the workaround became the build failure. Verify from a
  clean build, under every feature set. `archive/presto-cleanup/lessons/review-18.md`

## Build, bundling and dependencies

- **`minimumReleaseAge` is npm-only — Cargo has no equivalent** — an unconstrained `cargo update` took
  27 crates from inside the 7-day window. `archive/presto-cleanup/lessons/phase-2.md`
- **A blanket release-age floor cannot coexist with a nightly upstream** — it holds every `@aztec/*`
  bump red for a week; such scopes need a dated exemption.
  `archive/presto-cleanup/lessons/review-17.md`
- **Vite only bundles a *literal* `new URL("./f", import.meta.url)`** — composed from a variable it
  stays unrewritten: local warning, production 404. `archive/presto-noir/lessons/phase-17.md`
- **Vite's dev server treats extension-less files as JS and inflates `.gz`** — a binary fetch returns
  `export default "/@fs/…"` and `assetsInclude` does not apply to `/@fs/`. Embed binary fixtures at
  build time. `archive/presto-noir/lessons/phase-18.md`
- **reqwest 0.12→0.13 swaps the TLS backend and the CI toolchain** — rustls drops `libssl-dev`, adds
  AWS-LC/CMake, and pulls `tokio-rustls`, tripping deny-lists written for cert-*serving* crates.
  `archive/presto-cleanup/lessons/phase-2.md`

## Types and package boundaries

- **A class with private fields is nominal in TypeScript** — a complete structural drop-in still fails
  TS2739; express it as `Pick<Class, …>`. `archive/presto-noir/lessons/arc-4-review.md`
- **`tsc` emits nothing for an unresolved side-effect import** — `import "pkg/register"` validates
  nothing. Use a named import or `noUncheckedSideEffectImports`.
  `archive/presto-banners-publish/lessons/codex-loop.md`

## Tests

- **Validating a caller-supplied object then re-reading it after an `await` is a TOCTOU hole** — a
  mutating callback or changing getter redirected an already-validated request path. Recurred three
  times; fix with a frozen snapshot at entry. `archive/presto-noir/lessons/arc-3-review.md`
- **`vite preview` does not serve the deployment's headers** — no COOP/COEP means no
  `crossOriginIsolated`, no SharedArrayBuffer, no WASM threads. Assert it, don't assume it.
  `archive/presto-noir/lessons/arc-5-review.md`
- **wdio 9 wraps every worker in `xvfb-run` when `DISPLAY` is unset**, destroying the IPC channel
  (`write EINVAL`) before any test runs — it reads as a harness bug. It also runs under Node, not
  Bun, so shared helpers must be runtime-neutral. `archive/presto-noir/lessons/phase-6.md`
- **"Green" without a run ID is not green** — a PR with a failing Windows lane was treated as
  merged-clean. Assume any platform with no lane was never exercised.
  `archive/presto-noir/lessons/audit-fixes.md`

## CI and release

- **A `workflow_dispatch` input is the empty string on every other trigger** — read it as
  `inputs.x || '<default>'`, written identically everywhere. `archive/presto-noir/lessons/phase-12.md`
- **A `concurrency` group that ignores dispatch inputs cancels your own sibling runs**.
  `archive/presto-noir/lessons/arc-3-review.md`
- **`needs.<job>.result == 'skipped'` cannot tell "not selected" from "its gate failed"** — a
  downstream publish accepted a skipped sibling. Gate on the selection input too.
  `archive/presto-noir/lessons/arc-4-review.md`
- **Tool-version files must appear in the paths-filter groups** — `rust-toolchain.toml` matched none,
  so a compiler-only change skipped every Rust job. Route them into filters for jobs that compile
  *indirectly* too. `archive/presto-cleanup/lessons/review-17.md`
- **Unauthenticated `api.github.com` calls from hosted runners are rate-limited by shared egress IP** —
  earlier green runs just had API luck. `archive/presto-noir/lessons/cross-arc-review.md`
- **A ruleset requiring contexts "up to date with main" forces a stack to land one level at a time** —
  those contexts only exist on a PR targeting `main`.
  `archive/presto-noir/lessons/cross-arc-review.md`

## npm publishing

- **`npm audit signatures` never checks the bytes you installed** — it re-fetches via
  `pacote.manifest()` and verifies against *that*, so an equivocating registry can serve malicious
  bytes to the install and genuine signed material to the audit. Bind your artifact to the subject
  digest inside the verified statement. `archive/presto-noir/lessons/audit-fixes.md`
- **`bun install --frozen-lockfile` still runs lifecycle scripts** — a "reproducible" install inside a
  privileged OIDC publish job executes third-party code beside the release identity. A publish job
  should install nothing. `archive/presto-noir/lessons/audit-fixes.md`
- **npm's attestation endpoint 404s for minutes after a successful publish** — a post-publish check
  needs a ten-minute-scale wait; that 404 is timing, not a missing signature.
  `archive/presto-noir/lessons/audit-fixes.md`
- **npm says "not found" rather than "forbidden", and dist-tag reads are CDN-cached** — only an
  identified `E404` proves absence, and a post-promote `npm view` can return the old tag. Verify a
  promotion through an uncached read. `archive/presto-noir/lessons/arc-2-review.md`,
  `archive/presto-banners-publish/lessons/codex-loop.md`
- **Every npm write demands an OTP and only `--otp=<code>` parses** — the space form binds as a
  positional, and the web flow cannot complete non-interactively.
  `archive/presto-banners-publish/lessons/codex-loop.md`

## Windows

- **`bb.exe` does binary file I/O in text mode** — a key read stops at the first 0x1A (3680 bytes read
  as 983) and a proof write expands every 0x0A. `--output_format json` sidesteps both, but `bb verify`
  has no JSON input form. `archive/presto-noir/lessons/arc-1-review.md`
- **Rust's `Command` escapes embedded quotes as `\"`, which `cmd.exe` does not understand** — a quoted
  `cmd /C` argument mangles silently, so the command "runs" and produces nothing. Use `current_dir()`
  plus a relative name. `archive/presto-noir/lessons/audit-fixes.md`
- **Node-based actions cannot see Git Bash's `/tmp` on Windows runners** — a Windows failure with no
  uploaded artifact is usually this, not a crash before logging. Use `$RUNNER_TEMP`.
  `archive/presto-noir/lessons/arc-1-review.md`

## Local tooling

- **zsh aborts the entire command line when any glob has no match** — `rm -f a/*.tgz b/*.tgz` runs
  *neither* removal if the first is empty. `archive/presto-noir/lessons/phase-16.md`
- **`pkill -f` / `pgrep -f` match the invoking shell's own argv** — a cleanup pattern killed the tool
  shell itself. Kill by recorded pid, or use the `[p]rocess` bracket trick.
  `archive/presto-noir/lessons/phase-5.md`
- **git hooks do not inherit your interactive PATH** — a lint-staged `rustfmt` step could not find its
  binary and the commit *silently aborted*. `archive/presto-noir/lessons/phase-3.md`
- **bb advertises verifier targets it refuses to prove** — `starknet`/`starknet-no-zk` are in 5.2.0's
  accepted-values list but `bb prove` exits 1. Never read an accepted-enum list as a capability list;
  pin the refusal in a test. `archive/presto-noir/lessons/phase-5.md`
