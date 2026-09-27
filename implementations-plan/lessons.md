# Lessons

Gotchas that bit us and would bite again on unrelated work. **Read before starting a task.**

One line each, ~8 KiB budget: every promotion is a pruning pass. Facts CLAUDE.md already states do
not belong here. Sections are stable; append, never re-sort.

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
- **An unfulfilled `#[expect]` is an error under `-D warnings`** — verify suppressions from a clean
  build, under every feature set. `archive/presto-cleanup/lessons/review-18.md`

## Build, bundling and dependencies

- **`minimumReleaseAge` is npm-only — Cargo has no equivalent** — an unconstrained `cargo update` took
  27 crates from inside the 7-day window. `archive/presto-cleanup/lessons/phase-2.md`
- **Vite only bundles a *literal* `new URL("./f", import.meta.url)`** — composed from a variable it
  stays unrewritten: local warning, production 404. `archive/presto-noir/lessons/phase-17.md`
- **`require.resolve` on a dual package picks the CJS entry, which Rolldown gives Node-mode interop**
  — `.default` became the whole `exports` object and an injected `Buffer` a plain object; misread as a
  Vite 8 miscompile for a month. Resolve the ESM entry from the `exports` map. (2026-09, Vite 8.3)

## Types and package boundaries

- **A class with private fields is nominal in TypeScript** — a complete structural drop-in still fails
  TS2739; express it as `Pick<Class, …>`. `archive/presto-noir/lessons/arc-4-review.md`
- **`tsc` emits nothing for an unresolved side-effect import** — `import "pkg/register"` validates
  nothing. Use a named import or `noUncheckedSideEffectImports`.
  `archive/presto-banners-publish/lessons/codex-loop.md`
- **A forced `checkStatus()` joins a probe already in flight** — a refresh fired by a permission
  change mid-probe gets the pre-change answer. Wait out the running check, then force.
  `archive/lna-consent/lessons/cross-arc-review.md`

## Tests

- **Validating a caller-supplied object then re-reading it after an `await` is a TOCTOU hole** —
  recurred three times; fix with a frozen snapshot at entry. `archive/presto-noir/lessons/arc-3-review.md`
- **`vite preview` does not serve the deployment's headers** — no COOP/COEP means no
  `crossOriginIsolated` and no WASM threads. Assert it. `archive/presto-noir/lessons/arc-5-review.md`
- **wdio 9 wraps every worker in `xvfb-run` when `DISPLAY` is unset**, killing the IPC channel
  (`write EINVAL`) before any test runs. It runs under Node, so shared helpers must be runtime-neutral.
  `archive/presto-noir/lessons/phase-6.md`
- **A test that self-skips with `return` reports `ok`** — two `#[ignore]`d hermetic tests asserted
  nothing in an `--ignored` lane for months. Grep the log for the skip message.
- **"Green" without a run ID is not green** — a failing Windows lane was treated as merged-clean.
  Assume any platform with no lane was never exercised. `archive/presto-noir/lessons/audit-fixes.md`
- **A regression test proves nothing until it fails against the old code** — twice a new test passed
  on the unfixed code (a stub answered like the fix; a prover built before `fetch` was stubbed).
  `archive/lna-consent/lessons/cross-arc-review.md`
- **A Presto-mode deploy passes on a silent in-browser fallback** — the smoke's native deploy went
  green against a Presto the HTTPS-only page could not reach. Assert the phase trail
  (`expectNativeProof`).
- **A refused loopback port and a Local Network Access block look the same to the page** — both are
  `Failed to fetch`; only CDP `Network.loadingFailed` carries `LocalNetworkAccessPermissionDenied`.
  `archive/lna-consent/lessons/arc-2-review.md`

## CI and release

- **A `workflow_dispatch` input is the empty string on every other trigger** — read it as
  `inputs.x || '<default>'`, written identically everywhere. `archive/presto-noir/lessons/phase-12.md`
- **A `concurrency` group that ignores dispatch inputs cancels your own sibling runs**.
  `archive/presto-noir/lessons/arc-3-review.md`
- **`needs.<job>.result == 'skipped'` cannot tell "not selected" from "its gate failed"** — gate on
  the selection input too. `archive/presto-noir/lessons/arc-4-review.md`
- **Tool-version files must appear in the paths-filter groups** — `rust-toolchain.toml` matched none,
  so a compiler-only change skipped every Rust job. `archive/presto-cleanup/lessons/review-17.md`
- **Unauthenticated `api.github.com` calls from hosted runners are rate-limited by shared egress IP** —
  earlier greens were API luck. `archive/presto-noir/lessons/cross-arc-review.md`
- **A ruleset requiring contexts "up to date with main" forces a stack to land one level at a time** —
  those contexts only exist on a PR targeting `main`. `archive/presto-noir/lessons/cross-arc-review.md`

## npm publishing

- **`npm audit signatures` never checks the bytes you installed** — it re-fetches the manifest, so an
  equivocating registry passes. Bind the artifact to the verified statement's subject digest.
  `archive/presto-noir/lessons/audit-fixes.md`
- **`bun install --frozen-lockfile` still runs lifecycle scripts** — a publish job holding the OIDC
  identity should install nothing. `archive/presto-noir/lessons/audit-fixes.md`
- **npm's attestation endpoint 404s for minutes after a successful publish** — timing, not a missing
  signature; wait on a ten-minute scale. `archive/presto-noir/lessons/audit-fixes.md`
- **npm says "not found" rather than "forbidden", and registry reads are CDN-cached** — a write with
  an expired `npm login` 404s too (check `npm whoami`), and only an identified `E404` proves absence.
  Verify a promotion or deprecation through an uncached read. `archive/presto-noir/lessons/arc-2-review.md`
- **`npm trust` mis-parses `--otp <code>`; write `--otp=<code>`** (npm 11.16, 2026-09). Its web OTP
  flow cannot complete from a non-interactive shell. `archive/presto-banners-publish/lessons/codex-loop.md`
- **A publish job interrupted after `npm publish` strands the version** — no tag, release or
  verification, and the planner refuses to reuse it. Fix forward with `packages: all` (next revision,
  or a manifest bump), then deprecate the stranded one. `archive/lna-consent/plan.md`

## Windows

- **`bb.exe` does binary file I/O in text mode** — a key read stops at the first 0x1A and a proof
  write expands every 0x0A. `--output_format json` sidesteps both; `bb verify` has no JSON input.
  `archive/presto-noir/lessons/arc-1-review.md`
- **Rust's `Command` escapes embedded quotes as `\"`, which `cmd.exe` does not understand** — a quoted
  `cmd /C` argument mangles silently. Use `current_dir()` plus a relative name.
  `archive/presto-noir/lessons/audit-fixes.md`
- **Node-based actions cannot see Git Bash's `/tmp` on Windows runners** — a failure with no uploaded
  artifact is usually this. Use `$RUNNER_TEMP`. `archive/presto-noir/lessons/arc-1-review.md`

## Local tooling

- **zsh aborts the entire command line when any glob has no match** — `rm -f a/*.tgz b/*.tgz` runs
  *neither* removal if the first is empty. `archive/presto-noir/lessons/phase-16.md`
- **Tear down by process group, never by name or wrapper pid** — `pkill -f` matched the tool shell's
  own argv, and killing `npx vite preview &`'s pid left the server holding its port and the caller's
  pipe. Start it under `set -m`, then `kill -- -$pgid`. `archive/presto-noir/lessons/phase-5.md`
- **git hooks do not inherit your interactive PATH** — a lint-staged `rustfmt` step could not find its
  binary and the commit *silently aborted*. `archive/presto-noir/lessons/phase-3.md`
