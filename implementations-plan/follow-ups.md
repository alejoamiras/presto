# Open follow-ups

What closed plans left open. Read when planning; delete an entry the moment it resolves.

Lifted from the three plans in `archive/` on 2026-09-18. Each entry says whether it was **verified
against `main`** that day or only carried from the log. Anything the sweep found already fixed was
dropped rather than carried — see "Closed by the sweep" at the bottom for what that covered.

## Dated — one cliff, 2026-11-30

- **All ten dependency-audit exceptions expire on the same day.**
  `scripts/dependency-audit-allowlist.json` accepts GHSA entries for `@opentelemetry/propagator-jaeger`,
  `undici` (×3), `deepmerge-ts`, `extract-zip` (×2), `serialize-javascript`, `js-yaml` and `sharp`,
  every one with `"expires": "2026-11-30"`. On 2026-12-01 the audit gate goes red on all ten at once.
  Two are already fixable without upstream movement: js-yaml 4.3.2 only needs the release-age gate to
  clear plus a lockfile refresh, and sharp 0.35.4 needs wrangler's miniflare to move. The rest are
  pinned by Aztec 5.2 or the WebdriverIO stack. **Verified 2026-09-18.**

## Open in code

- **The bb download client silently drops its own deadlines.**
  `packages/presto/core/src/versions/release_metadata.rs:22` — `http_client()` ends
  `.build().unwrap_or_else(|_| reqwest::Client::new())`, so if the builder ever fails the 300 s
  request and 30 s connect timeouts vanish and an in-request download can hang unbounded. The
  token-bearing `metadata_client()` deliberately errors instead, precisely to avoid a fallback client;
  the download path never got the same treatment. **Verified 2026-09-18.**
- **Node, Bun and SSR consumers still default to plaintext.**
  `packages/sdk-core/src/lib/config.ts` resolves `httpsOnly` from `isBrowserRuntime()`, so the
  HTTPS-only default that closed the port-squat witness-capture window for browsers does not apply to
  server runtimes. Deliberate — the headless CI server is TLS-free — but it is an accepted boundary
  that belongs in the security model, not an oversight. **Verified 2026-09-18.**
- **`packages/presto` is typechecked by nothing.** `tsconfig.scripts.json` includes `scripts/**/*.ts`
  at the repo root only, the package has no `typecheck` script, and wdio strips types with tsx — so
  type errors in `packages/presto/scripts` and the WebDriver e2e suite reach CI only as runtime
  failures. Pre-existing, explicitly deferred rather than widened.
  `archive/presto-noir/lessons/phase-6.md`. **Verified 2026-09-18.**
- **`windows-schema.json` is still out of step with its siblings.** It carries 4 `set_theme` entries
  where `desktop-schema.json`, `linux-schema.json` and `macOS-schema.json` each carry 8, so every
  `cargo check --target x86_64-pc-windows-gnu` regenerates it and dirties the worktree. Called out as
  "worth a one-line hygiene commit on main" and never made.
  `archive/presto-noir/lessons/phase-5.md`. **Verified 2026-09-18.**
- **The playground is held on Vite 7 while the landing site runs Vite 8.** `packages/playground`
  pins `^7.3.6`, `packages/landing` `^8.2.2`. Vite 8's Rolldown production build miscompiles the
  playground's Aztec sqlite-opfs ordered-key path; the upstream bug is unfixed and was never filed.
  `archive/presto-cleanup/lessons/phase-2.md`. **Verified 2026-09-18.**

## Owner actions

- **The `bb.exe` text-mode I/O bug was never reported upstream.** Barretenberg reads and writes binary
  files in text mode on Windows, so key reads truncate at the first 0x1A and proof writes expand every
  0x0A. Presto routes around it with `--output_format json`; every other consumer on Windows silently
  gets corrupt reads. `archive/presto-noir/lessons/arc-1-review.md`. Not verified against upstream.
- **`gh pr merge --auto` is rejected on this repo** ("Auto merge is not allowed"), so every automated
  bump PR needs a manual merge. Either enable auto-merge in the repository settings or stop emitting
  the flag. `archive/presto-noir/lessons/audit-fixes.md`. Not verified.
- **`release-sdk.yml --dry_run` has never been exercised.** It asserts `refs/heads/main`, so it could
  not run from the feature branch, and running it from `main` after merge was left as an owner
  follow-up. The release DAG's dry-run path is untested end to end.
  `archive/presto-noir/lessons/phase-9.md`. Not verified.

## Untested paths, carried from the logs

None of these were re-checked on 2026-09-18.

- **The chonk `/prove` path on Windows was never tested for the same text-mode corruption** that the
  UltraHonk route was fixed for. `archive/presto-noir/lessons/arc-1-review.md`
- **Windows proof verification is skipped, not passing** — the identity spec skips the sidecar step
  there because `bb verify` has no JSON input form; byte identity is the assertion instead.
  `archive/presto-noir/lessons/arc-1-review.md`
- **The reqwest 0.13 rustls graph has never been compiled on Windows or macOS** — those legs are
  "prepared CI evidence rather than claims based on local Linux execution", and the desktop suite
  leaves 7 platform tests ignored locally. `archive/presto-cleanup/lessons/phase-4.md`
- **Two known CI flakes left unfixed** — a 5 s timeout in the legacy NSS trust test (`test:scripts`)
  that passes on re-run and wants a timeout bump, and the Windows launch smoke, which timed out once
  and passed on a rerun. `archive/presto-noir/lessons/cross-arc-review.md`
- **The playground's Noir action ignores the page's HTTP-session consent** — the adapter exposes no
  `setPrestoConfig`, so under `secure-connection-unavailable` it falls back to the browser. As a
  consequence core's `endpoint-changed` reason is documented as reserved rather than reachable.
  `archive/presto-noir/lessons/phase-17.md`
- **Per-job metering is logged but not consumed** — `/prove/ultra-honk` emits a per-job info log
  (scheme, origin, target, ok, elapsed_ms) for a metering follow-up that does not exist yet.
  `archive/presto-noir/lessons/phase-4.md`

## Accepted residual risk — standing decisions, not work

- **`@aztec/*` is exempt from the seven-day release-age floor** (owner decision 2026-08-18, 31 exact
  package names in `bunfig.toml`; a glob is silently ignored, and the list must cover the full
  resolved transitive graph). Aztec releases are consumed same-day by design, so for this scope
  specifically there is no observation window. Every other scope keeps the full quarantine. This is a
  permanent exposure on the dependency surface the product leans on hardest.
  **Verified 2026-09-18.**
- **Automated cumulative age enforcement was reverted during review and is not on `main`** — the
  registry-age checker, its composite action and the thirteen workflow wirings were all removed. What
  remains is bunfig's npm-resolution-time floor plus a 7-day cooldown on the github-actions Dependabot
  entry; Cargo and Action age enforcement is manual sweeps only. Phase-2 and phase-4 evidence in the
  archive describes code that no longer exists. `archive/presto-cleanup/lessons/review-17.md`
- **Dependency-age composites no-op on dispatch-only workflows** — by design, since those execute
  reviewed `main` and pull-request installs are the fail-closed gate. A dispatch-triggered run gets no
  age enforcement at all. `archive/presto-cleanup/lessons/phase-4.md`
- **12 `#[expect(clippy::cognitive_complexity)]` remain in production Rust**, concentrated in
  `updater.rs`, `update_marker.rs`, `main.rs` and `commands.rs`. They guard long linear security
  transactions — the widest is the updater's verify → stage → replace → roll back → clean sequence,
  judged safer to review in one control flow than behind forwarding helpers.
  `archive/presto-cleanup/lessons/phase-3.md`. **Verified 2026-09-18.**
- **Client and server response caps stay asymmetric** — Rust accepts up to 64 MiB of proof output plus
  4 MiB of inputs/key; the adapter inherits core's 8 MiB JSON cap. Over 100× headroom for real
  proofs, deliberately not raised: matching the server ceiling would only enlarge what a malicious
  Presto can make a page allocate. A future circuit with larger output fails client-side.
  `archive/presto-noir/lessons/cross-arc-review.md`
- **The dependency-resolution check is drift detection, not a tamper boundary** — the hidden lockfile
  is installation metadata under the trust the consumer already places in executed dependency code.
  `archive/presto-noir/lessons/arc-3-review.md`
- **Two test-coverage gaps accepted** — no delayed-wallet-init E2E (the mocked project cannot bring
  the wallet to "ready") and no unit test around `main.ts` (an entry module wiring the DOM at import
  time over the whole `@aztec` graph). The wallet-readiness boolean is covered by inspection only.
  `archive/presto-noir/lessons/arc-5-review.md`

## Closed by the sweep

Checked on 2026-09-18 and found already resolved, so not carried above:

- npm promotion to `latest` — all four packages are on `latest`
  (`presto` 5.2.0-revision.2, `presto-core` 1.0.1, `presto-noir` 1.0.1, `presto-banners` 1.0.0), and
  every `0.0.0-bootstrap.0` placeholder is deprecated.
- Cancellation releasing admission guards before the killed bb is reaped — closed by the confirmed
  reap (`bb::run_bb` cancel + `server::prove::on_task`).
- `presto-noir` being a dispatch choice with no descriptor entry — arc 4 landed it.
- The unbudgeted in-request bb download — closed by the digest-first fetch and `versions::DownloadBudget`
  (3 per origin, 6 overall, per 10 min).
