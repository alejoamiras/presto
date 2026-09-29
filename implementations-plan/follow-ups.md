# Open follow-ups

What closed plans left open. Read when planning; delete an entry the moment it resolves.

Lifted from the three plans in `archive/` on 2026-09-18. Each entry says whether it was **verified
against `main`** that day or only carried from the log. Anything the sweep found already fixed was
dropped rather than carried — see "Closed by the sweep" at the bottom for what that covered.

## Dated — one cliff, 2026-11-30

- **All nine dependency-audit exceptions expire on the same day.**
  `scripts/dependency-audit-allowlist.json` accepts GHSA entries for `@opentelemetry/propagator-jaeger`,
  `undici` (×3), `deepmerge-ts`, `extract-zip` (×2), `serialize-javascript` and `js-yaml`, every one
  with `"expires": "2026-11-30"`. On 2026-12-01 the audit gate goes red on all nine at once. js-yaml
  4.3.2 only needs the release-age gate to clear plus a lockfile refresh; the rest are pinned by
  Aztec 5.2 or the WebdriverIO stack. (sharp left with wrangler 4.135.) **Verified 2026-09-26.**

## Owner actions

- **`@aztec/*` packaging is broader than the three packages already reported upstream.** Every
  `@aztec/*` package the playground bundles from aztec-packages or noir (23 at 5.2.0; `@aztec/viem`
  is the exception) ships no licence file, about twenty declare
  no `license` field, and `@aztec/bb.js` declares MIT while `barretenberg/` publishes only an
  Apache-2.0 text. The playground now vendors the upstream texts
  (`packages/playground/licensing/license-fallbacks.ts`); each rule there can go once upstream ships
  the file itself. **Verified 2026-09-21.**
- **The `bb.exe` text-mode I/O bug was never reported upstream.** Barretenberg reads and writes binary
  files in text mode on Windows, so key reads truncate at the first 0x1A and proof writes expand every
  0x0A. Presto routes around it with `--output_format json`; every other consumer on Windows silently
  gets corrupt reads. `archive/presto-noir/lessons/arc-1-review.md`. Not verified against upstream.
- ~~**`release-sdk.yml --dry_run` has never been exercised.**~~ **Resolved** — dry run
  `34280070511` (`packages=all`) ran after #32 and #33 merged, and real run `34280233253` followed;
  both are recorded in `archive/presto-noir/lessons/audit-fixes.md`. Kept struck through rather than
  deleted because an earlier phase log still states the opposite.
  `archive/presto-noir/lessons/phase-9.md`. Not verified.

## From aztec-v6 (closed 2026-09-29)

- **Switch off the testnet RPC forwarder (D36) once Aztec publishes the public v6 RPC.** Until then,
  `presto-testnet-rpc` makes the private node publicly reachable for `aztec_*`/`node_*` calls (Aztec
  acked this).
  - Point five places at the public RPC: `vite.config.ts`, `dev:testnet`, `test:e2e:remote`,
    `smoke-playground.yml` and the assertion in `sdk-release-contract.test.ts`.
  - Run a keyed `packages/testnet-rpc/scripts/forwarder.sh down`.
  - Remove the package and its wiring: the root workspaces and test scripts, `landing.yml`,
    CLAUDE.md and `docs/CLOUDFLARE_DEPLOYMENT.md`.
  - Revoke the Cloudflare token (it expires on its own).
  - `archive/aztec-v6/plan.md` (D36).
- **Re-arm the legacy SDK gate.** It went dormant on the v5→v6 major mismatch (A6). `presto`
  6.0.0-rc.1 now exists, so the fixture can target it. `archive/aztec-v6/plan.md` (A6).
- **Promote to `latest` when Aztec v6 goes stable:** `presto`, `presto-noir` and `presto-core` (all on
  `testnet` today). The promotion guard refuses prereleases, so the stable bump comes first.
- **The next app release should bundle v6 `bb`.** 1.1.3 downloads it on first use, which needs the
  release-metadata call below.
- **A cold v6 `bb` download fails on a busy shared address.** The digest check reads GitHub's release
  metadata anonymously (60 calls an hour per address). R2's live-site check hit 403 on this host, and
  the page correctly fell back to WASM. Users behind CGNAT or a corporate proxy can hit the same.
  The server's hint is `GITHUB_TOKEN`; a non-API digest source would remove the dependency.
  `archive/aztec-v6/lessons/releases.md`.
- **`FOUNDATION_PACKAGES`' doc comment in `scripts/aztec-manifest.ts` is wrong.** It calls the three
  names "only these are Aztec release artifacts". The file is in `app.yml`'s `published` filter, so
  fix it in a PR that may run the published-playground gate.
- **Vite warns that the root `package.json` lacks `"type": "module"`,** since `vite.config.ts` imports
  `scripts/aztec-manifest.ts`. It is harmless under today's loader, but will matter under Vite's
  future `configLoader: 'native'` default.

## Untested paths, carried from the logs

None of these were re-checked on 2026-09-18.

- **The chonk `/prove` path on Windows was never tested for the same text-mode corruption** that the
  UltraHonk route was fixed for. `archive/presto-noir/lessons/arc-1-review.md`
- **Windows proof verification is skipped, not passing** — the identity spec skips the sidecar step
  there because `bb verify` has no JSON input form; byte identity is the assertion instead.
  `archive/presto-noir/lessons/arc-1-review.md`
- **The playground's Noir action ignores the page's HTTP-session consent** — the adapter exposes no
  `setPrestoConfig`, so under `secure-connection-unavailable` it falls back to the browser. As a
  consequence core's `endpoint-changed` reason is documented as reserved rather than reachable, and
  the testnet smoke skips its native Noir proof against the headless server; the packaged e2e proves
  it through the page over HTTPS. `archive/presto-noir/lessons/phase-17.md`
- **Per-job metering is logged but not consumed** — `/prove/ultra-honk` emits a per-job info log
  (scheme, origin, target, ok, elapsed_ms) for a metering follow-up that does not exist yet.
  `archive/presto-noir/lessons/phase-4.md`
- **Three features were scoped out of presto-noir and never re-planned** — the plan's own "scope out
  (follow-ups)" row names a **tray per-origin cumulative prove time** display and a **one-click revoke
  UI** (the metering log above is the data source for the first), and **per-proof overhead
  measurement / persistent bb**. `archive/presto-noir/plan.md` (Scope table)
- **Connect still shows on phones and tablets, where Presto cannot be installed** — scoped out of
  lna-consent for a mobile-aware-detection plan that does not exist yet. The load-time probe that
  made Android Chrome prompt is gone; the button itself remains. `archive/lna-consent/plan.md` (Out)
- **Native `verifyProof` / `getVerificationKey` were deferred by owner decision (A-01)** — v1 keeps
  both on WASM so verification stays circuit-bound, and `fallback: "none"` covers `generateProof`
  only. Documented and tested as such; revisit only with a reason to move verification native.
  `archive/presto-noir/plan.md` (Asks → A-01)

## Accepted residual risk — standing decisions, not work

- **Every site build runs next to an account-wide Workers token (workers-builds A3)** — Workers
  Scripts Edit cannot be narrowed below the account, so build-time code on any branch of this repo
  could redeploy any Worker, the release-feed Worker included. Mitigated by `--ignore-scripts`, the
  release-age floor and a repo-scoped GitHub App; since 2026-09-27 the builds use a narrowed custom
  token, which drops KV and R2 but cannot change this boundary. Fork PRs do not build (checked
  2026-09-27). Accepted by the owner 2026-09-25. `archive/workers-builds/plan.md` (Security)
- **Aztec's scopes are exempt from the seven-day release-age floor.** This was an owner decision
  (2026-08-18, extended to v6's `@aztec-labs/*` and `@aztec-foundation/*` on 2026-09-28).
  - The names are exact: 42 in `bunfig.toml`, and 62 in `installer-aztec-packages.txt` for
    `setup-aztec`'s npmrc. A glob is silently ignored.
  - Each list must cover the full resolved graph. `scripts/aztec-installer-graph.ts` fails on drift
    and on any version other than the release.
  - Aztec releases are consumed the same day by design, so these scopes get no observation window.
  - This is a permanent exposure on the dependency surface the product leans on hardest.
  **Verified 2026-09-29.**
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
