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
- [verified-sites-feed](verified-sites-feed/plan.md) — closed 2026-10-13 — the verified-sites list
  is signed in CI with its own key, published by the release-feed Worker and fetched by the app,
  which takes the newest signed version whole and caches it, so a badge changes without an app
  release (PRs #92, #93, #100).
- [presto-audit-fix](presto-audit-fix/plan.md) — closed 2026-10-14 — the dependency audit green again:
  sharp 0.35.5 (exact override, miniflare pins it), source-map-js 1.2.2 and quinn-proto 0.11.19, with
  no other lock movement (PR #107).
- [presto-rc3](presto-rc3/plan.md) — closed 2026-10-14 — Aztec 6.0.0-rc.3: the SDK sends its
  bb.js pin as `x-aztec-version` (labs rc.3, foundation and `bb` rc.6), split-target tooling, and
  released servers proven against a verifying local rc.3 network; no server release (PR #105).
- [presto-rustls-fix](presto-rustls-fix/plan.md) — closed 2026-10-14 — the dependency audit green
  again: rustls 0.23.46 for RUSTSEC-2026-0346..0349, a same-day crate taken after it diffed equal to
  its upstream tag with a fully traced delta (PR #108).
- [presto-fixture](presto-fixture/plan.md) — closed 2026-10-14 — the published-SDK gate re-armed:
  the interop fixture names presto 6.0.0-rc.3, its integrity taken from the npm signature audit and
  SLSA verification, never typed (PR #110).
- [presto-verifier-identity](presto-verifier-identity/plan.md) — closed 2026-10-14 — the verifier
  binds a provenance statement to its signing identity at every consumer, while the OIDC publish job
  stays dependency-free (PR #111).
- [rc-update-channel](rc-update-channel/plan.md) — closed 2026-10-16 — an opt-in release-candidate
  update channel behind Settings → Advanced → Developer mode: an `rc-v1` manifest schema the stable
  channel refuses at every admission point, a `latest-rc.json` feed route served only above the
  stable, candidate promote and `withdraw-rc`, and release smokes that prove the refusal and the
  install (PRs #130, #134, #135, #137).
- [updater-smoke-stable](updater-smoke-stable/plan.md) — closed 2026-10-16 — every publish run
  smokes the update from the live stable as well as from the greatest lower release; the stable is
  the release the signed feed serves, bound to its asset digest, and a different key or an outage
  fails closed. 14 green legs on the 1.2.0 publish (PR #123).
- [custom-bb](custom-bb/plan.md) — closed 2026-10-16 — developer mode pins one user-chosen,
  hash-pinned `bb` to one version label: core route and inspection, Settings review, test run
  and save, tray and popup lines; T13 proves it on three OSes (PRs #143, #145).
- [release-1](release-1/plan.md) — closed 2026-10-25 — the release scripts' registry calls share one
  bounded spawn and the 180 s deadline, the credentialed-job guard follows the move, and the dead
  `publish-testnet.yml` rollback allowance goes (PR #174; open: #173).
- [server-1](server-1/plan.md) — closed 2026-10-25 — client-facing error bodies carry no path the
  presto derived: `download_failed` names only the failed step, every `prove_failed` is fixed text,
  and the log keeps the error with its source chain (PR #180).
- [tests-1](tests-1/plan.md) — closed 2026-10-25 — the store and config lock probes run alone in a
  child test process, feed case_24 proves independence on one thread, and auth-flow closes its
  popup before awaiting (PR #176; known limits #177, #179).
- [windows-1](windows-1/plan.md) — closed 2026-10-25 — a window that does not fit the screen's
  usable area is built to fit it (Tauri's `prevent_overflow` on Windows and macOS, `fit_to_work_area`
  on Linux), proven on a 1280×672 Linux WebDriver lane; the P5-01 privacy sentence (PR #182; known
  limits #183, #184, #185).
- [ci-1](ci-1/plan.md) — closed 2026-10-25 — Dependabot's create-github-app-token v3.3.0 and
  rust-toolchain v1 bumps, with a reviewed re-pin of the App-key tripwire test (PR #186, supersedes #169).
- [deps-1](deps-1/plan.md) — closed 2026-10-27 — wrangler 4.151.1 without the `sharp` override, the
  audit covers the pinned npm's bundled tree and fails closed, and #172's red audit is cleared by
  bumps plus the owner's dated `zod` and `undici` acceptance (PRs #175, #181, #189; known limits
  #187, #188).
- [sdk-1](sdk-1/plan.md) — closed 2026-10-27 — presto-core reports a `500 download_failed` as
  `download-failed` instead of `transient`, through both adapters; core 1.3.0, presto-noir 2.1.0 and
  presto-banners 1.2.1, merged right before their release (PRs #178, #190; known limits none).
- [release-2](release-2/plan.md) — closed 2026-10-28 — the Linux updater smoke creates the XDG
  cache dir that tauri-plugin-updater's AppImage swap needs on ubuntu-26.04, and the owner's dated
  acceptance of three undici advisories turns the audit green (PR #191; known limit #192).
