# Presto launch checklist

Execution checklist for the approved fork plan. Evidence and deployment versions live in
[the launch checkpoint](PRESTO_LAUNCH_STATUS.md). An unchecked item is not complete, even when its
implementation exists. Never merge or publish by bypassing an unresolved release gate.

## 1. Repository and operational identity

- [x] Synchronize the visual branch with the original main and preserve the full Git history.
- [x] Bootstrap the public `alejoamiras/presto` repository with deployment/release/scheduled workflows disabled.
- [x] Configure repository metadata, merge settings, branch protection, Dependabot and protected environments.
- [x] Review and merge the visual-only PR #1.
- [x] Open operational draft PR #6 on the merged visual main.
- [x] Rename packages, SDK API, crates, binaries, release assets, workflows and product-specific environment variables.
- [x] Establish fresh Presto state, certificate, autostart, registry and installation identities; no automatic migration.
- [x] Preserve ports 59833/59834 and the `/health` and `/prove` protocol and genuine Aztec ecosystem terminology.
- [x] Remove the obsolete planning tree; preserve historical audits and add the migration guide/branding guards.
- [x] Purchase and onboard `presto.build`; pin native identifier `build.presto.presto`.
- [x] Fix the missing Windows updater crash-recovery guard; Windows compilation, app/core unit tests and WebDriver pass on `e2f1235`.
- [x] Restore deliberately spaced autostart quoting fixtures and matching prefix-hijack decoy; Windows lifecycle passes on `eb2158a`.
- [x] Give the Windows packaging smoke a matching ephemeral public/private key pair without modifying production identity; packaging/install smoke passes on `eb2158a`.
- [x] Align the Windows NSIS harness runner with its renamed installation directory; real Windows certificate/hook CI passes on `6b7b6b0`.
- [x] Fix the published legacy SDK fixture installer under CI's npm 12 and add regression coverage; actual npm 12 installation and native-proof E2E pass locally.
- [ ] Refresh all remaining API/state/OS/release identity-contract and mutual wire-compatibility acceptance evidence.
- [ ] Verify actionable port-conflict behavior and no modification of the other installation.

## 2. Cloudflare and credentials

- [x] Save every new production credential in a clearly named Presto 1Password item and verify read-back before configuring GitHub. Updater, three Cloudflare tokens, Apple signing and release App backups are verified; existing keys are preserved. Apply the same rule to any subsequent credentials.
- [x] Create fresh landing, playground and release-feed Workers and `PRESTO_RELEASE_FEED` KV namespace.
- [x] Enable workers.dev fallback endpoints and version previews.
- [x] Deploy apex landing and playground Custom Domains plus the `/releases/*` feed route.
- [x] Verify HTTPS, canonical URLs, cross-origin isolation headers and the deliberately empty/no-store feed.
- [x] Implement same-repository-only PR preview uploads with stable PR aliases and isolated credentialed jobs.
- [x] Create/store the site deployment token in 1Password and GitHub; verify read-back, target zone/routes/Workers access, denied KV access, and successful landing/playground CI preview uploads.
- [x] Confirm the site token's resource policy: the owner's Cloudflare summary shows Zone Read and Workers Routes Edit only for `presto.build`, with Workers Scripts Edit at account level. An unrelated zone's Worker routes return 403. The API still exposes zone metadata, so zone listing alone is not used to reject the confirmed dashboard policy. Saved token unchanged.
- [x] Create/store the separate release-feed deployment token in 1Password and main-only `release-feed`; verify read-back, scoped API access and a real preview-version upload without changing production.
- [x] Create/store the separate KV promotion token in 1Password and main-only `release-feed`; verify exact read-back, distinct active tokens, denied Worker/route access, and a successful expiring KV write/read probe without touching the public manifest.
- [x] Enable and verify same-repository PR previews after credential setup; both stable PR aliases and deep links return 200 with isolation headers, without changing production deployments.
- [x] Generate a fresh password-protected Tauri updater key and verify its 1Password backup and signing; add only the public key to the repository.
- [x] Store updater private key/password in the main-only `release-signing` environment.
- [x] Confirm the owner-approved 1Password recovery backup: exact key/password read-back and signing passed. **On 2026-09-05 the owner explicitly removed the separate offline-copy requirement from the original plan.**
- [x] Make a permanent owner-only local copy of the encrypted updater key and public key; verify byte equality and record a recovery inventory.
- Independent offline backup is optional under that updated owner decision; it is not claimed complete and does not block setup or release. Existing local copies remain untouched.
- [x] Securely re-enter Apple signing/notarization credentials for the newly named app; verify the account with read-only notarization history, certificate/private-key and team matching, exact Presto 1Password read-back, and all six GitHub secrets. Original Apple credentials unchanged; release-CI acceptance remains pending.
- [x] Authorize the release GitHub App for Presto; verify exact App ID/PEM read-back from `Presto Release GitHub App`, authenticated App identity, preserved access to both repositories, and a narrowly scoped temporary token; configure GitHub without changing existing App keys. CI smoke acceptance is tracked below.
- [x] Pass the existing release-bot CI credential smoke (`33984288576`): temporary branch/PR creation, label/comment and CI triggering succeeded; PR #7 was closed without merging. This is App credential acceptance, not release or package acceptance.
- [ ] Verify credentials and environments without publishing; enable deployment/release workflows only when safe.

## 3. Verification, review and merge

- [ ] Rerun `bun run test:all` against the final operational candidate.
- [ ] Run all Rust tests, Clippy and format checks on the required platforms.
- [x] Diagnose and fix the core fake-prover test-isolation race; 10 consecutive parallel full suites pass.
- [ ] Pass desktop WebDriver/Playwright, HTTPS/consent/LNA, certificate, installer, headless and release-contract gates.
- [ ] Pass packaged-native state-isolation/uninstall and full-stack browser consent tests using real candidate artifacts.
- [x] Wire the existing packaged checks to secretless `Build Test Bundle` dispatch (`platform=all`), with exact-SHA Linux/Windows/macOS artifacts and the existing HTTP consent/reset spec against an installed desktop app. Focused contracts, local checks and independent wiring reviews pass; hosted execution remains required.
- [ ] Pass dependency audit, actionlint, ShellCheck, Wrangler typecheck/dry-run and `git diff --check`.
- [ ] Refresh independent review: OS identity, uninstall, certificates and state isolation.
- [ ] Refresh independent review: SDK/API compatibility and witness transport.
- [ ] Refresh independent review: release/npm/Actions/Cloudflare and rollback safety.
- [ ] Fix all high/critical and justified medium findings; rerun affected gates.
- [x] Complete 1Password Git signing, push follow-up fixes as `e2f1235` and rerun remote CI.
- [ ] Approve release readiness only after domain, updater recovery, routes, credentials and pre-release gates are evidenced.
- [ ] Observe successful `Presto Status`, then replace the old native required-check name in the ruleset.
- [ ] Babysit required checks and merge only the exact reviewed commit; keep releases separately gated.

Packaged RC-to-stable updater evidence necessarily belongs to the later release steps, not a fabricated
pre-merge baseline. The first-RC exception is allowed only for exactly `1.0.0-rc.1` with no earlier
Presto releases; it must not waive other native acceptance checks.

## 4. npm bootstrap and release sequence

- [ ] Complete interactive npm login/2FA. **Owner interaction required.**
- [ ] Publish only `@alejoamiras/presto@0.0.0-bootstrap.0` under the `bootstrap` tag.
- [ ] Configure GitHub OIDC trust for this repo, `release-sdk.yml`, and `npm-publish` with direct publishing permission.
- [ ] Verify trust and deprecate the bootstrap version; never unpublish it.
- [ ] Publish SDK `5.2.0` to `testnet` from CI with provenance and its matching GitHub tag/release.
- [ ] Verify signatures/provenance and a clean tarball consumer install; deploy the exact published SDK to the playground.
- [ ] Publish `presto-v1.0.0-rc.1` using the fresh key and the tightly scoped initial-baseline exception.
- [ ] Keep the RC out of the public updater feed.
- [ ] Pass packaged acceptance and real same-key RC-to-1.0.0 updater smokes before stable publication.
- [ ] Publish `presto-v1.0.0` with the RC as its real same-key baseline.
- [ ] Promote the signed stable manifest to the fresh KV feed.
- [ ] Verify edge propagation, manifest signatures, exact assets, downloads, landing and production playground behavior.
- [ ] Run the automated full-stack browser consent test against the release candidate and packaged app.
- [ ] Promote SDK `5.2.0` from `testnet` to `latest` through the guarded interactive promotion flow.

## 5. Legacy retirement — only after Presto production is verified

- [ ] Open a separate retirement PR in the original repository.
- [ ] Replace its landing/playground with accessible migration pages linking to corresponding Presto pages; remove old download/prove actions.
- [ ] Add prominent retirement notices to the original README and repository metadata.
- [ ] Recognize Presto production origins in the old app without weakening consent.
- [ ] Add a one-time native migration window and permanent tray/menu migration link through the old domain.
- [ ] Store dismissal only in legacy state; keep legacy proving functional and never install/modify Presto.
- [ ] Publish/promote final legacy `3.1.0` using its existing updater key and real `3.0.0` baseline.
- [ ] Freeze its updater feed at `3.1.0`.
- [ ] After Presto production and npm/latest verification, deprecate every version of the legacy npm package with migration instructions.
- [ ] Observe redirects, downloads, feeds and migration messaging for 14 days with the original repo unarchived.
- [ ] Archive the original repo read-only only after a healthy observation window; keep retirement pages and frozen feed online.

## Rollback invariants

- [ ] Record and verify immutable Worker version rollback and prior signed KV-feed restoration before launch.
- [ ] Verify guarded npm dist-tag rollback and native feed rollback procedures.
- [ ] Keep published versions, release assets and GitHub releases append-only; fix defects forward.
