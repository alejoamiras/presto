# Presto launch checkpoint

The operational rename is a draft, not a release-ready commit. Do not merge it or publish until
`bun scripts/presto-release-readiness.ts` passes and the remaining gates below are verified.
The same check is wired into Presto Status and both release entry points.

## Completed

- Full-history repository bootstrap and reviewed visual-only PR #1.
- Separate SDK API, native executable/crate names, fresh state/certificate/OS identities,
  repository URLs, release asset names, workflow paths and environment-variable names.
- Removed the planning tree; historical audits remain unchanged, with a historical identity
  fixture added for compatibility and isolated state tests.
- Removed inherited binary-rename cleanup so it cannot delete another installation.
- Kept ports 59833/59834 and the health/prove wire contract unchanged.
- Added the SDK migration guide, branding/identity guards, fail-closed release readiness,
  exact RC1 bootstrap restriction and paginated same-key baseline resolution.
- Feed promotion targets only the fresh KV namespace; updater smoke hostnames derive from Tauri.
- Replaced the obsolete packaged upgrade lane with fresh-install/state-isolation coverage.
- Playground release deployment consumes the integrity/provenance-verified published SDK.
- Same-repository-only static PR preview uploads use stable aliases and separate credentialed jobs.
- Operational draft PR #6: https://github.com/alejoamiras/presto/pull/6.
- Permanent domain `presto.build` registered by the owner through Cloudflare Registrar and verified
  active on 2026-09-05. Native identifier is `build.presto.presto`; homepage, updater endpoint,
  recognized playground origin, public links, social cards and feed probes use the permanent domain.
- Fixed the brand sweep's NUL-separated Git file parsing and escaped word boundary; it now actually
  checks each tracked file and asserts that the expected identity file is included.

## Deployed domain infrastructure (2026-09-05)

| Service | Production endpoint | Immutable Worker version |
| --- | --- | --- |
| Landing | https://presto.build | 7043a092-1556-4be0-a127-95cc3ef2a9dd |
| Playground | https://playground.presto.build | cfdd4dea-9eb3-4cf3-bd86-84706f0d53ac |
| Feed | https://presto.build/releases/latest.json | 678208cc-f854-4fa4-aef1-53f8274df9b7 |

Fallbacks remain enabled at `presto-landing.alejo-amiras.workers.dev`,
`presto-playground.alejo-amiras.workers.dev` and
`presto-release-feed.alejo-amiras.workers.dev/releases/latest.json`; version previews remain enabled.

Fresh namespace: `PRESTO_RELEASE_FEED`, ID `41a6adef830f4a91bf63476a323cec98`.
Landing/playground respond successfully. Feed intentionally returns 503: no stable manifest has
been promoted. These deployments are work-in-progress snapshots, not the final reviewed release.
The playground uses the public Aztec testnet endpoint and the workspace SDK candidate; the later
release deployment must consume the exact provenance-verified published SDK.

## Verification checkpoint

- Full local `bun run test:all` passed with a local Aztec network and Presto headless server,
  including native and WASM proving and the integrity-pinned published legacy SDK native-proof test.
- Rust desktop/core/headless tests and Clippy passed on macOS; core has 266 passing tests.
- All 84 desktop Playwright UI tests passed.
- The full-stack browser consent test passed against a production playground build and the real
  headless server: explicit HTTP consent, native proof, and HTTPS-only reset on reload.
- Typecheck, branding/release contracts, actionlint, ShellCheck and diff whitespace checks passed.
- Dependency audit: zero blocked findings; existing allowlist exceptions and informational findings
  remain visible. No new exceptions were added.
- Wrangler dry-runs passed for all three Workers; release-feed generated types are current.
- Domain cutover: landing/playground HTTPS 200 with canonical URLs and cross-origin isolation
  headers; feed HTTPS 503 with `no-store`; all three workers.dev fallbacks remain functional.
- Post-domain root script tests: 109 passed; all workspace typechecks and landing tests passed.
- Post-domain desktop script tests: 96 passed; Rust authorization tests: 44 passed; native verified-site
  tests: 7 passed. Generated social-card hashes passed the asset manifest check. Cargo normalized
  renamed package ordering in the core/desktop lockfiles without changing dependency versions.
- Follow-up fixes restore the Windows `CrashRecoveryGuard` without restoring legacy binary cleanup.
  All 108 desktop Rust tests and desktop/core/headless Clippy pass locally. Windows CI must rerun.
- Reproduced npm 12's package-keyed JSON output; shared npm 11/12 parsing now preserves pinned
  identity, safe filenames and independent integrity checks in both tarball consumers. The actual
  npm 12 legacy fixture installation and full local `bun run test:all` pass, including a real native
  proof through the published legacy SDK (8 E2E passed; 3 remote-network-only cases skipped).
- Added frozen legacy health/prove contract coverage, incumbent-listener preservation and headless
  conflict guidance tests. The packaged isolation job now verifies `--prepare-uninstall` too.
- Preview uploads generate trusted SPA configuration without executing PR code in the credentialed
  job. Both sites' deep-link fallback and isolation headers pass against the local Workers runtime.
  Config dates now match pinned Wrangler 4.124.0's supported `2026-08-22`; all three dry-runs pass.
  The deployed versions listed above are unchanged by these local checks.
- Follow-up script tests: 113 passed; workspace lint/typechecks/unit tests, actionlint, ShellCheck
  and dependency audit pass (zero blocked findings, no new audit exceptions).
- A full local core run exposed a test-isolation race: six authorization tests reached the global
  fake prover without sharing its serialization lock, overwriting containment state and leaking
  test children. The isolated cleanup test passed 20 times; the partially corrected suite still
  failed, confirming that every successful authorization reader needed the lock. After adding all
  six annotations, all 266 core tests passed in 10 consecutive default-parallel full runs, with
  no remaining child processes or captured-output hangs. Core Clippy and format checks pass.
  Production containment behavior was not changed.
- Independent reviewers found no remaining high/critical or justified medium code defects in the
  follow-up fixes. Final approval still needs the exact release-ready commit and OS artifact evidence.
- Launch readiness remains intentionally blocked until signing/recovery/credentials are finalized.
- Follow-up commit `e2f1235a146ba10639b224e24beaa400d7b160a5` is signed, GitHub-verified and pushed.
  Its SDK, App, Landing and infrastructure lint workflows pass. Windows app/core compilation,
  unit tests, TLS/trust and WebDriver tests now pass too, confirming the recovery-guard fix.
- The Windows autostart lifecycle test exposed another rename-only fixture regression: the test
  directory lost its space while the negative-control decoy retained an unrelated prefix.
  Shared deliberately spaced fixture paths and a derived decoy restore the test's intended
  conditions. A cross-platform regression guard reproduces the missing-space failure before the
  fix. Real Windows lifecycle acceptance requires the subsequent CI rerun.
- The Windows installer was produced, but its smoke signing step rejected the deliberately empty
  production public key. The smoke now supplies a matching throwaway public key through a temporary
  build-config overlay, without modifying the committed production identity or readiness gate.
  The packaging/install smoke must rerun with that overlay.
- On `eb2158a`, Windows packaging/install smoke and the real autostart lifecycle pass. The remaining
  non-readiness failure is the NSIS hook harness runner looking under its old temporary directory
  while the harness installs under `presto-hooks-harness`. The runner now matches the actual NSIS
  install directory; a contract compares the Windows and Wine runners against that declaration.
  The contract fails before the correction and passes afterward. CI must verify the real hook run.
- The harness follow-up is signed, GitHub-verified and pushed as `6b7b6b0`. All functional jobs in
  Presto run `33976311599` pass, including Windows certificate/hook, packaging/install and WebDriver
  checks. SDK, App, Landing and Actionlint also pass. Only the intentional launch-readiness gate
  prevents an overall green status; no signing or readiness bypass was used.
- Linux packaged isolation now seeds a real historical CA in fresh Chromium and Firefox NSS stores
  and checks exact certificate bytes, trust flags and CA validation across the existing lifecycle.
  Local disposable-database controls detect deletion, distrust and replacement. The historical
  autostart fixture uses the original code's exact case-sensitive filename. This strengthens the
  existing acceptance check; real packaged execution and other-platform isolation remain pending.
- Linux/Windows installer execution, packaged candidate and same-key updater matrices still require CI
  and real Presto RC/stable artifacts. Local NSIS and hermetic autostart harnesses require Docker.
- Three independent operational review areas were examined; identified high defects were corrected.
  Final approval must be refreshed against the exact commit after domain/key/credential work.

## Credential custody

Every new production key, password and deployment credential must be saved in a clearly named
Presto item in the owner's Personal 1Password vault and read-back verified before configuring GitHub.
Never overwrite or delete existing signing identities. Only public keys enter Git. On 2026-09-05
the owner explicitly approved 1Password as the backup of record and removed the separate offline
copy requirement from the original plan. This newer decision supersedes the earlier backup pause;
independent offline recovery is not claimed. All other release gates remain mandatory.

The `Presto Production Updater Signing Key` item in Personal now contains the fresh encrypted key,
its generated 64-character password and public key. On 2026-09-05, exact read-back comparisons
passed; the key rejected an incorrect password and successfully signed an artifact verified by
the production verifier. Public key ID: `f92b1e05e0cef393`. The public key is added to Tauri config.
The verified backup supplied `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
to GitHub's `release-signing` environment at 16:08 UTC, after confirming its main-only branch policy.
GitHub does not permit secret-value read-back; these entries are not yet release-CI acceptance.
No existing signing key was changed. The verified 1Password backup now satisfies the owner-approved
recovery policy; `recoveredUpdaterPublicKey` records that public key while `releaseReady` stays false
for the remaining credentials and acceptance gates. Do not generate a replacement password,
duplicate item or replacement key when resuming.

## Required operator inputs and remaining gates

Backup-priority checkpoint, 2026-09-05:

- All functional CI jobs on the public-key commit `f3c0805` pass, including Windows packaging,
  certificate/hooks and desktop WebDriver. Run `33977053211` is terminal; its only failures are
  the intentional launch-readiness gate and aggregate Presto Status. No CI wait remains active.
- The owner saved `Presto Site Deployment` in Personal. Repeated vault reads matched and the token
  is active. Read-only checks succeed for the Presto zone, routes and Workers; KV access is denied.
  The scoped template requested Workers Scripts Edit and target-zone Routes Edit/Zone Read;
  token-policy introspection was denied, so these checks are not a complete permission audit.
  The token and account ID were copied to repository secrets at 16:24 UTC. Actual preview-upload
  acceptance remains pending; preview/deployment switches were not enabled.
- Current vault evidence resolves the earlier misleading item-ID association: a separate legacy
  feed-promotion item remains present, active and distinct from the Presto site token. The legacy
  updater signing item, feed-deploy item and Apple Developer item remain present with modification
  dates predating this setup. No credential was deleted, rotated or overwritten by the agent.
- The encrypted Presto key and public key were copied to the owner's permanent
  `Documents/Presto-Recovery` folder (0700, key files 0600) and compared byte-for-byte. Its README
  records credential sources and verification limits without secret values. The password is not
  stored alongside that encrypted key. This is not yet a complete independent recovery backup.
- Setup was paused for extra-backup assurance; the owner's subsequent explicit decision accepts
  the verified 1Password backup and resumes setup without a separate offline file. Preserve all
  existing copies. Do not copy plaintext passwords to an unencrypted folder or treat GitHub secrets
  as recovery backups. No independent offline backup is claimed.
- After resuming, `PRESTO_PREVIEWS_ENABLED=true` and rerun `33977053079` passed both builds and
  credential-isolated uploads. Stable aliases `pr-6-presto-landing.alejo-amiras.workers.dev` and
  `pr-6-presto-playground.alejo-amiras.workers.dev` return 200 for root/deep links with COOP
  `same-origin` and COEP `credentialless`. Preview versions are
  `9eeb5b28-fba3-4baa-94e1-abd39d9b7064` and `c64e5216-9b70-4856-b048-5287e9de0600`.
  Cloudflare's deployment API confirms production remains on the versions listed above.
  This completes preview write-access acceptance; production deployment workflows remain disabled.

1. Domain onboarding and production routes are complete. Preserve `presto.build` and native
   identifier `build.presto.presto` before and after the first RC.
2. Updater generation, owner-approved 1Password recovery, read-back/signature verification and
   main-only GitHub secret provisioning are complete. Release-CI use remains to be verified;
   an independent offline copy is optional under the updated owner decision.
3. Enter least-privilege, separate Cloudflare deployment/feed-deployment/feed-promotion tokens.
   Re-enter Apple credentials and authorize the release GitHub App for this repository.
   Enable `PRESTO_PREVIEWS_ENABLED` only after preview credentials are ready.
   The two updater secrets, all three Cloudflare tokens, and required account IDs have been
   provisioned. Apple and GitHub App credentials are also backed up and configured. Site-token
   zone restriction and credential use in release CI remain to be verified.
   All new credentials require the same 1Password
   save/read-back custody checks. The backup-priority pause is resolved by the updated owner decision.
4. Complete interactive npm bootstrap/login/2FA and configure the trusted publisher before publishing
   the real SDK candidate from CI. No npm versions or dist-tags have been changed.
5. Run all remaining OS, installer, packaged-app, consent and updater gates. Set readiness only after
   evidence is available, rerun three independent reviews, and merge the exact reviewed commit.
6. Change the remote required check from the visual PR's native status name to `Presto Status`
   only after the latter succeeds. Deployment/release/scheduled workflows remain disabled meanwhile.
7. Follow the release runbook: SDK testnet → native RC1 → native stable → stable feed → SDK latest.
   Retirement of the legacy product must be a separate PR after production Presto is verified.
   Its final release, npm deprecation, 14-day observation period and archive have not begun.

Published versions/releases remain append-only. Rollback uses Worker versions, a verified prior KV
feed, and npm dist-tags; do not unpublish or rewrite release assets.

## Feed-deployment credential checkpoint (2026-09-05)

- Owner-created `Presto Release Feed Deployment` was read-back verified in 1Password and confirmed
  active. It can read feed Worker settings; KV and route access are denied. The separate site token
  remains backed up, active and unchanged. Both vault item names exist independently.
- The token and account ID were copied to the main-only `release-feed` environment at 17:18 UTC.
  The deployment workflow remains disabled until the operational rename reaches main safely.
- The scoped token uploaded preview version `30b60a29-8325-472a-b23b-c2c37a71a94a` at
  `credential-check-presto-release-feed.alejo-amiras.workers.dev`; the exact-version deployment
  dry-run passed. Preview and production feeds return 503/no-store with no promoted manifest.
  The deployment API confirms production remains on `678208cc-f854-4fa4-aef1-53f8274df9b7`.
- Feed deployment now uploads and activates an exact version instead of using route-managing
  `wrangler deploy`, matching the script-only token permission boundary. The real upload's structured
  output passes the workflow's Worker-name/version-ID parser. Its existing contract reproduced the
  old command mismatch and passes after correction; all 212 script tests and actionlint pass.
  Focused independent release review found no concrete safety/correctness issues.
- The owner subsequently created and saved `Presto Release Feed Promotion`; verified provisioning
  and write-access evidence are recorded in the checkpoint below.

## Promotion-token handoff and scope follow-up (2026-09-05)

- After the owner approved 1Password access, exact promotion-token read-back passed. All three
  Cloudflare tokens are separately backed up, active and distinct; the previously verified site
  and feed-deployment token IDs are unchanged. The updater item is also present, untouched.
  The promotion token can access the fresh KV namespace and is denied Worker settings and zone
  routes (403). The initial key-list probe used an invalid page size of 1; correcting it to
  Cloudflare's documented minimum of 10 resolved the 400 error without any token change.
  `CLOUDFLARE_RELEASE_FEED_API_TOKEN` was added to main-only `release-feed` at 17:47 UTC;
  existing GitHub secrets were not overwritten.
- Pinned Wrangler 4.124.0 successfully wrote and read back a non-secret credential probe in
  `PRESTO_RELEASE_FEED`, with a 120-second expiry. Only the uniquely named probe key was written;
  `latest.json` and all legacy KV data were untouched. The public feed still returns 503/no-store.
  This verifies actual KV write access without promoting a release or changing Worker deployments.
- The owner reports no Presto zone filter was selected when creating the Cloudflare tokens.
  Account-level Workers Scripts and KV permissions do not require a zone filter. The site token's
  Zone Read and Workers Routes Edit must be restricted to `presto.build`: the site-token API audit
  confirmed Presto plus nine other zones are visible. Have the owner edit the existing token policy
  in the dashboard; do not rotate or replace it simply to change resource permissions. Full policy
  introspection is unavailable with the scoped credentials, so route-write scope still needs that
  dashboard confirmation.
  This remains a pre-launch follow-up, not a reason to modify legacy resources.
- Operational head is `16b5954a359236b735995dbdc12f40dc74bdbfae`. SDK, App, Landing,
  infrastructure/workflow lint and PR previews pass. Native run `33981048209` completed at the
  17:41 UTC checkpoint: all functional jobs passed, including Windows packaging, installation,
  launch and health checks. Only launch readiness and its aggregate Presto Status failed, as
  intended while setup remains incomplete. No CI wait remains active; no stable release or
  feed promotion has occurred. Cloudflare token provisioning is complete; site scope and the
  remaining credential/acceptance checks still prevent launch readiness. Apple and App credential
  setup are completed below.

## Apple signing credential checkpoint (2026-09-05)

- The owner's supplied Apple ID successfully authenticated with the saved team and app-specific
  password using read-only `notarytool history`. No notarization submission, keychain import or
  credential rotation occurred; the email is saved in 1Password rather than committed here.
- Two direct-to-file reads of the existing encrypted `developer-id.p12` match byte-for-byte and
  its 3061-byte attachment size. Direct file output avoids binary-to-UTF-8 alteration in captured
  stdout. Temporary copies are owner-only (directory 0700, files 0600); the original vault item
  and its 2026-03-18 modification timestamp remain unchanged.
- The saved password opens the PKCS#12; its private key matches the certificate public key, the
  team matches, and the saved abbreviated signing name resolves exactly to its full Developer ID
  Application name. The certificate is valid through 2027-02-01 22:12:15 UTC. No identity changed.
- New `Presto Apple Signing` in Personal stores all six release values, including the encrypted
  certificate as recoverable base64 and the verified Apple ID. Exact read-back passed before
  GitHub provisioning. `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` were added at repository scope, matching the
  existing build job, at 18:10 UTC. Production build/notarization acceptance in CI is still pending.
- The historical release PR identified the existing release GitHub App; its public lookup returned
  404 and the initial vault inventory had no clearly named App backup. The owner's subsequent
  installation update and verified backup resolve that setup dependency, as recorded below.

## Release GitHub App credential checkpoint (2026-09-05)

- The owner confirmed the existing App, added Presto to its installation, and saved the App ID
  and PEM attachment in `Presto Release GitHub App` in Personal. Two exact reads matched.
  App-authenticated GitHub calls verify App ID `3941590` and installation `137485954`, with both
  Presto and the original repository still authorized. Public App lookup returning 404 was not
  evidence that the App was missing; authenticated verification succeeds.
- A temporary installation token was minted with access only to `alejoamiras/presto` and the
  existing workflow's contents/pull-requests/issues write permissions (plus metadata read).
  GitHub's repository listing confirmed that exact one-repository scope. The verification token
  was revoked immediately afterward. No existing App key or installation was modified by the agent.
- `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` were added to Presto repository secrets at
  18:28 UTC, only after vault read-back and GitHub authentication passed. Existing secrets were
  not overwritten. The dispatch-only release-bot diagnostic was enabled and run at operational
  head `16b5954a359236b735995dbdc12f40dc74bdbfae`; production deployment and release workflows
  stay disabled.
- Release-bot run `33984288576` passed. It exercised the GitHub-stored key, temporary branch and
  PR creation, labels/comments and CI triggering; temporary PR #7 is closed and was not merged.
  The temporary branch is absent, every triggered run is terminal, and main remains `ae3b252`.
  This is credential/automation acceptance only: its branch was based on the still-visual main,
  so it does not claim operational native/package test acceptance or replace required PR checks.

## Candidate acceptance wiring and scope verification (2026-09-05)

- Three independent reviews of `16b5954` found no remaining high/critical production defects.
  SDK review verified the 189-test CI result, actual published-legacy-SDK native proving against
  Presto and tarball consumer checks. OS and release reviews identified an execution gap: packaged
  acceptance was reachable only through the main-gated release workflow, and artifact staging
  omitted macOS arm64. The unsigned test builder also needed to disable updater artifacts.
- `Build Test Bundle` now supports `platform=all`: three disposable installer builds, no signing
  secrets, an installer-only Tauri configuration overlay, and existing reusable packaged acceptance
  pinned to the dispatch SHA. Explicit artifact names replace the incomplete architecture glob.
  Separate Linux HTTPS/HTTP runners exercise the existing proof and consent/reset specs against
  the installed app, with the packed SDK. Existing isolation and uninstall checks stay intact.
  Production release readiness, main-only release gates, updater keys and feed behavior are unchanged.
- Both OS and release reviewers approved this bounded wiring diff. All 22 release-contract tests,
  actionlint, `git diff --check` and `bun run test` pass locally (478 unit/script tests; the existing
  skipped test remains skipped). This is wiring approval, not a claim that hosted packaged checks
  have already run. Exact final-commit CI and review still precede readiness and merge.
- After the owner edited the site token, it remains active with the same ID and verified vault
  value. Direct access to another zone's Worker routes is denied (403), but zone listing still
  returns all ten zones and a direct unrelated-zone detail read succeeds (200). The remaining
  Zone Read scope needs the owner's dashboard summary; no token replacement or external writes
  were performed during these probes.

## Owner scope confirmation and Windows workflow diagnosis (2026-09-05)

- The owner's Cloudflare token-summary screenshot confirms account-level Workers Scripts Edit
  and `presto.build`-only Zone Read / Workers Routes Edit. Together with the unrelated-route 403,
  this resolves the dashboard-policy gate. The observed broader zone metadata reads remain an
  API behavior caveat, not a request for another token edit. No credential changed.
- Candidate `20139a3` passed SDK, App, Landing, previews and workflow lint. Native functional
  checks also passed; only readiness and its aggregate remain intentionally blocked.
- Candidate build run `33985354120` built Linux and macOS successfully. Windows failed because
  the generic builder requested MSI, whose version format rejects `1.0.0-rc.1`. Match the existing
  release path by building NSIS only on Windows; retain the committed version and unsigned overlay.
- Ephemeral updater run `33985355163` built both synthetic versions but failed before launching
  them: `smoke-latest.json` was missing. The runtime smoke correctly requires an already-signed
  feed, while its standalone caller did not prepare one. Add the missing caller step using the
  existing smoke-feed signer and run-local key, followed by the production Rust manifest verifier.
  Do not restore production signing credentials to smoke jobs or weaken verification.
- Both workflow regressions are reproduced by the focused contract checks before the fixes.
  Hosted re-execution is required to establish actual installer and updater acceptance.
- After correction, all 23 release contracts, actionlint, ShellCheck and `git diff --check` pass.
  The first full local run timed out in an unchanged SDK test after a 510-second scheduling gap;
  the isolated rerun passed in two seconds and the subsequent complete `bun run test` passed
  (479 tests). No SDK code or timeout was changed. The dependency audit reports zero blockers,
  nine existing accepted exceptions, 15 moderate/low advisories and 20 informational RustSec
  warnings; this is policy acceptance, not a claim that dependencies have no advisories.
- Focused independent release review approves the corrected Windows-only bundle override and
  ephemeral feed preparation, conditional on hosted execution. The pinned Tauri CLI help confirms
  that `all` is not a CLI bundle name, so non-Windows platforms keep their configuration defaults.

## Signed candidate verification checkpoint (2026-09-06)

- Owner-approved 1Password Git signing completed; GitHub verifies commit
  `76686a50a35e8a21c70617110ca65e5c8b4369be`. Both earlier signing attempts ended without creating
  a commit; edits remained staged and no release key changed. Operational PR #6 now points at
  this signed candidate.
- All three reviewers confirm exact-commit code approval, conditional on the required execution,
  readiness and merge checks. This is not authorization to bypass an unfinished gate.
- Candidate installer/packaged run `34030192155` and ephemeral Windows updater-barrier run
  `34030193781` are executing. No release or feed promotion was dispatched.
- Pinned Wrangler 4.124.0 dry-runs pass for landing, playground and release feed. Feed binding
  type generation is current and its TypeScript check passes. These commands performed no upload;
  fresh KV binding and custom routes remain as committed. Workflow lint, landing and PR-preview
  CI have passed; the other candidate checks are still running at this checkpoint.

## Packaged execution and bounded uninstall probe (2026-09-06)

- At `76686a5`, all functional native PR jobs passed, including Rust, Clippy, certificate trust,
  SDK native E2E and the desktop browser/WebDriver matrix. Readiness and its aggregate remain
  deliberately blocked; no production release was attempted.
- Windows ephemeral updater-barrier run `34030193781` passed end-to-end. The NSIS-only candidate
  build and signed smoke-feed caller fixes are now supported by hosted execution, not only contracts.
- Candidate run `34030192155` passed all three installer builds, Linux fresh-install/state isolation,
  Linux uninstall and both Linux packaged HTTPS proving / HTTP consent checks. Windows uninstall
  removed Run/task/certificate state, retained config bytes and stopped the app, but the install
  directory survived its bounded wait. The log did not identify the residual file. Add a read-only
  directory listing to that failure path and rerun the unchanged uninstall assertions before
  deciding on a product fix; do not delete residuals from the test to make it pass.
- Reuse the existing Linux HTTP packaged runner to execute the literal `bun run test:all` command
  against its installed app, before the SDK tarball swap. This includes the published legacy SDK
  fixture and avoids touching the owner's local native state. Independent release review approves
  this bounded wiring addition; its hosted execution remains required.

## Confirmed Windows data collision and combined conflict acceptance (2026-09-06)

- Signed, GitHub-verified candidate `bcb5556ead8b68fd24bf7ad67bc88fa6471fd789` completed packaged
  run `34031198087`. Linux/macOS packaged proving, HTTP consent, Linux state isolation and uninstall
  passed. The literal `bun run test:all` passed against the installed Linux app, including eight
  SDK E2E tests (three remote-network cases remain explicitly skipped). Functional native PR jobs
  also passed; readiness remains false.
- The Windows diagnostic identified exactly `Presto/logs`, its current log file and `Presto/prove-tmp`
  inside LocalAppData. Windows case-insensitivity made the renamed runtime directory collide with
  the default installation directory. No executable, task, Run entry or certificate survived.
- Separate Windows runtime data into `LocalAppData/build.presto.presto`, sharing the resolver between
  logs and private proof workspaces. Preserve existing platform paths elsewhere and all permission
  hardening. No migration, fallback read of the previous directory or deletion is introduced.
  Update Windows smoke log readers and user documentation; add a Windows-native path regression.
  The unchanged real uninstaller remains the end-to-end acceptance gate.
- Independent SDK review identified a combined acceptance gap: occupied-socket and legacy-state
  tests existed separately, but no packaged conflict test covered both. Extend the existing
  disposable Linux isolation check with the checksum-pinned, published legacy headless `3.0.0`
  binary as the incumbent. Require the installed Presto's actual conflict guidance, keep both
  processes alive through that assertion, and verify incumbent health, binary bytes and seeded
  historical files/trust remain intact through Presto uninstall. The tray's existing guidance is
  now also written to its normal error log. No new framework or local OS-state test is introduced.
- Local core Windows cross-check (including tests), core Clippy, formatting, workflow lint and
  ShellCheck passed. Desktop Windows cross-check cannot finish locally because the MinGW C compiler
  is absent; hosted Windows compilation and all affected runtime checks remain mandatory.
- All three independent reviewers approve this bounded delta, conditional on hosted Windows
  uninstall/updater and Linux coexistence execution. The complete local `bun run test` passes.
  Isolation failures now upload the existing runner logs; reaped Presto PIDs are cleared before
  subsequent fixture work so cleanup does not retain a stale process handle.

## Rollback preflight without production mutation (2026-09-06)

- Signed candidate `a4dd5b9cf9afebcd7c0a491d038af52660a6e99f` is on PR #6. Packaged run
  `34032670064` and ephemeral Windows updater run `34032671223` are in progress.
- Wrangler deployment read-back confirms unchanged active versions: landing
  `7043a092-1556-4be0-a127-95cc3ef2a9dd`, playground `cfdd4dea-9eb3-4cf3-bd86-84706f0d53ac`,
  release feed `678208cc-f854-4fa4-aef1-53f8274df9b7`. Select the latest deployment by its timestamp,
  not array position: Wrangler's returned list was chronological, oldest first.
- Pinned Wrangler 4.124.0 accepted each explicit version at 100% in `versions deploy --dry-run`.
  All three commands exited successfully before deployment; this verifies the preparation path,
  not a claim that production was rolled back. The runbook now separates Worker code/assets from
  the guarded restoration of KV manifest bytes.
- No Presto GitHub releases exist yet, and the public feed still returns the intended 503 with
  `Cache-Control: no-store`. There is no prior stable native manifest or functional SDK release
  available as a rollback target for the first launch; never substitute an RC, bootstrap package,
  legacy feed or deleted/rebuilt release. Actual prior-stable restoration remains a later gate.
- All three reviewers carried code approval to exact `a4dd5b9`, conditional on execution. The
  dependency audit was rerun: zero blockers, nine existing accepted exceptions, 15 moderate/low
  advisories and 20 informational RustSec warnings. All three deployment dry-runs also pass again
  on this candidate; the earlier full local test includes the current feed-binding typecheck.
- Candidate `34032670064` now passes Windows full uninstall: the installation directory, Run
  entry, scheduled task and certificates are removed; config bytes are retained and the app stops.
  The Linux coexistence/isolation leg also passes with the checksum-verified published incumbent.
  Its real health endpoint remains available after Presto uninstall, with binary, historical files
  and Chromium/Firefox trust preserved. The Windows data-path fix is verified end-to-end; browser
  proving and the updater rerun are still pending at this checkpoint.

## Pre-merge acceptance complete (2026-09-06)

- Candidate `a4dd5b9` completed packaged run `34032670064` successfully on every leg, including
  literal full-workspace checks, Linux/macOS native browser proving, HTTP consent/reset, legacy
  coexistence/state/trust isolation and Linux/Windows uninstall. Windows updater-barrier run
  `34032671223` passed with the relocated log directory. All functional native PR jobs in
  `34032667039`, SDK `34032667014`, App `34032667020`, landing, workflow lint and PR previews passed.
  Only the deliberately withheld readiness check and its aggregate failed on that candidate.
- Credential-name inventory and branch-policy read-back confirm the recorded repo secrets and
  main-only `release-signing`, `release-feed` and `npm-publish` environments remain configured.
  No credential value was printed, rotated or replaced. Production Apple/updater use is still
  verified by the release workflow after merge; protected release workflows remain disabled now.
- Set `releaseReady=true` based on the accepted candidate and the previously verified permanent
  identity, key recovery and routes. This attestation changes no native/SDK executable source and
  does not waive any release-time baseline, signing, notarization, publication or promotion gate.
  The final readiness/documentation commit still needs local checks, exact review and successful
  required CI. Rename the old required native check only after `Presto Status` actually succeeds;
  merge only the reviewed head. No Presto package, release or public updater manifest exists yet.
