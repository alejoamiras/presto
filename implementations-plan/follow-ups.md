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

## Owner actions

- **`@aztec/*` packaging is broader than the three packages already reported upstream.** Every
  `@aztec/*` package the playground bundles from aztec-packages or noir (23 at 5.2.0; `@aztec/viem`
  is the exception) ships no licence file, about twenty declare
  no `license` field, and `@aztec/bb.js` declares MIT while `barretenberg/` publishes only an
  Apache-2.0 text. The playground now vendors the upstream texts
  (`packages/playground/licensing/license-fallbacks.ts`); each rule there can go once upstream ships
  the file itself. **Verified 2026-09-21.**
- **The three Cloudflare API tokens versus Workers Builds.** `CLOUDFLARE_DEPLOY_API_TOKEN` and
  `CLOUDFLARE_RELEASE_FEED_DEPLOY_API_TOKEN` are long-lived deploy tokens in repository secrets that
  connecting the repo to Workers Builds would retire; `CLOUDFLARE_RELEASE_FEED_API_TOKEN` writes the
  updater feed's KV from the promote job and has to stay. Not verified.
- **The `bb.exe` text-mode I/O bug was never reported upstream.** Barretenberg reads and writes binary
  files in text mode on Windows, so key reads truncate at the first 0x1A and proof writes expand every
  0x0A. Presto routes around it with `--output_format json`; every other consumer on Windows silently
  gets corrupt reads. `archive/presto-noir/lessons/arc-1-review.md`. Not verified against upstream.
- ~~**`release-sdk.yml --dry_run` has never been exercised.**~~ **Resolved** — dry run
  `34280070511` (`packages=all`) ran after #32 and #33 merged, and real run `34280233253` followed;
  both are recorded in `archive/presto-noir/lessons/audit-fixes.md`. Kept struck through rather than
  deleted because an earlier phase log still states the opposite.
  `archive/presto-noir/lessons/phase-9.md`. Not verified.

## Untested paths, carried from the logs

None of these were re-checked on 2026-09-18.

- **The chonk `/prove` path on Windows was never tested for the same text-mode corruption** that the
  UltraHonk route was fixed for. `archive/presto-noir/lessons/arc-1-review.md`
- **Windows proof verification is skipped, not passing** — the identity spec skips the sidecar step
  there because `bb verify` has no JSON input form; byte identity is the assertion instead.
  `archive/presto-noir/lessons/arc-1-review.md`
- **The playground's Noir action ignores the page's HTTP-session consent** — the adapter exposes no
  `setPrestoConfig`, so under `secure-connection-unavailable` it falls back to the browser. As a
  consequence core's `endpoint-changed` reason is documented as reserved rather than reachable.
  `archive/presto-noir/lessons/phase-17.md`
- **Per-job metering is logged but not consumed** — `/prove/ultra-honk` emits a per-job info log
  (scheme, origin, target, ok, elapsed_ms) for a metering follow-up that does not exist yet.
  `archive/presto-noir/lessons/phase-4.md`
- **Three features were scoped out of presto-noir and never re-planned** — the plan's own "scope out
  (follow-ups)" row names a **tray per-origin cumulative prove time** display and a **one-click revoke
  UI** (the metering log above is the data source for the first), and **per-proof overhead
  measurement / persistent bb**. `archive/presto-noir/plan.md` (Scope table)
- **Native `verifyProof` / `getVerificationKey` were deferred by owner decision (A-01)** — v1 keeps
  both on WASM so verification stays circuit-bound, and `fallback: "none"` covers `generateProof`
  only. Documented and tested as such; revisit only with a reason to move verification native.
  `archive/presto-noir/plan.md` (Asks → A-01)
- **`test:e2e:smoke` never ran against the ask-first playground** — it needs a reachable HTTPS Presto.
  The sandbox, packaged, mocked, production-smoke and real-Chromium lanes did run.
  `archive/lna-consent/lessons/phase-6.md`
- **`test-production-smoke.sh` orphans `vite preview`** — it kills the `npx` wrapper, not the node
  server, so the port stays bound and a caller piping its output hangs until the server is killed.
  **Verified 2026-09-25.**
- **The `presto` tarball ships test files** — `src/lib/*.test.ts`, now also `docs-examples.test.ts`.
  Harmless at runtime; trim with the package's `files`. **Verified 2026-09-25.**
- **`app.yml` has no workflow-level `permissions: contents: read`** — scoped out of lna-consent.
  Not re-verified.

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
- **11 `#[expect(clippy::cognitive_complexity)]` remain in production Rust** (plus one in
  `src-tauri/tests/autostart_heal.rs`), concentrated in `updater.rs`, `update_marker.rs`, `main.rs`
  and `commands.rs`. They guard long linear security transactions — the widest is the updater's
  verify → stage → replace → roll back → clean sequence, judged safer to review in one control flow
  than behind forwarding helpers. `archive/presto-cleanup/lessons/phase-3.md`. **Verified 2026-09-18.**
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
- **Permission reads can land out of order (lna-consent A5)** — the consent example and the
  playground apply asynchronous reads in completion order, so two that overlap a change nobody
  reported may leave the page one decision behind until the next read; a request may then meet the
  browser's question again. The browser still decides every request. A serialising read queue was
  declined as more machinery than the risk warrants. Neither the SDK nor the example can stop a
  status check or proof already running (A3); an SDK-enforced consent mode or an abortable
  check would close both, and both were scoped out. `archive/lna-consent/plan.md`

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
