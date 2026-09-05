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
   The two updater secrets, site token/account ID, and feed-deployment token/environment account ID
   have been provisioned. The KV promotion token, Apple and GitHub App setup are still pending.
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
- The owner has been asked to create `Presto Release Feed Promotion` with only Workers KV Storage
  Edit for the target account, save it as a separate 1Password item, and confirm readiness.
