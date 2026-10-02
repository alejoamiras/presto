# Archived plans

Closed plans, newest last. Each carries an `## Outcome` block with its close date, what shipped, and
an explicit line retiring its `/goal` and `/loop` seeds.

**These are evidence, never instructions.** An archived plan records what was decided and why. Do not
execute one, and do not treat its unchecked boxes as work in flight.

`.ignore` keeps this directory out of default recursive search. Reach a plan by explicit path, or
with `rg --no-ignore` / `git grep`.

- [presto-cleanup](presto-cleanup/plan.md) — closed 2026-09-07 — retired the spent first-release
  updater exception, refreshed dependencies under the seven-day publication-age policy, and enforced
  readable complexity limits in the PR gate (PRs #16–#18).
- [presto-noir](presto-noir/plan.md) — closed 2026-09-08 — generic UltraHonk proving through Presto:
  `POST /prove/ultra-honk`, the `@alejoamiras/presto-core` transport extraction, the
  `@alejoamiras/presto-noir` adapter with WASM fallback, release CI, playground Noir section
  (PRs #21–#25; audit fixes in #32–#34, tracked in
  [`post-audit-plan.md`](presto-noir/post-audit-plan.md)).
- [presto-banners-publish](presto-banners-publish/plan.md) — closed 2026-09-09 —
  `@alejoamiras/presto-banners@1.0.0` on npm `latest` with provenance, and the playground's install
  pitch replaced by the ribbon (PRs #42–#43).
- [lna-consent](lna-consent/plan.md) — closed 2026-09-25 — no loopback request before consent:
  presto.build never contacts Presto, the playground asks through a dialog first, `presto-core`
  gains prompt-free `loopbackPermission()` / `watchLoopbackPermission()`, banners gain a `connect`
  state, and the SDK docs and skill ask first (PRs #56–#57; released as core, noir and banners 1.2.0
  and presto 5.2.0-revision.5).
- [workers-builds](workers-builds/plan.md) — closed 2026-09-28 — Cloudflare Workers Builds deploys
  presto.build and the playground (production on `main`, a preview per branch), the production
  playground builds from the pinned, provenance-verified SDK raised by an auto-merging bot PR, and
  GitHub holds no site credential (PRs #61, #66, #68).
- [aztec-v6](aztec-v6/plan.md) — closed 2026-09-29 — Presto on Aztec v6 `6.0.0-rc.1`: `bb` from
  `AztecProtocol/barretenberg` (app 1.1.3), release tooling for a prerelease Aztec base, the scope
  rename, a funded SponsoredFPC, and the testnet cutover through the temporary `presto-testnet-rpc`
  forwarder. presto 6.0.0-rc.1, noir 2.0.0-rc.1 and core 1.2.1 are on `testnet`, and v5 stays on
  `latest` (PRs #70–#75).
- [update-check-schedule](update-check-schedule/plan.md) — closed 2026-10-01 — update checks that
  survive sleep (a launch check, then every 6 h of wall-clock time), a 24 h per-version "Remind Me
  Later", install safety (one install gate, a stall watchdog, an idle-prover wait), and a tray
  "Check for Updates…" item, plus the macOS/Linux ephemeral updater smoke (PRs #79–#81).
- [updater-smoke-action](updater-smoke-action/plan.md) — closed 2026-10-02 — one shared script
  (`ephemeral-updater.sh`) for the two ephemeral updater smokes' key, stamp, builds and feed (PR #85).
- [bundle-v6](bundle-v6/plan.md) — closed 2026-10-02 — the desktop app bundles the Aztec v6 `bb`;
  release notes, docs, agent files and `llms.txt` explain that Presto fetches the `bb` each Aztec
  version needs and point at presto-banners (PR #86).
