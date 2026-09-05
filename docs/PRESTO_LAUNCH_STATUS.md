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
- The harness follow-up is staged locally: Git signing failed to complete its 1Password approval.
  Commit/push and real Windows CI verification remain pending; no signing bypass was used.
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
Never overwrite or delete existing signing identities. Only public keys enter Git. Keep release
readiness blocked until the owner confirms a separate offline updater-key recovery copy.

The new `Presto Production Updater Signing Key` item was created with its generated password on
2026-09-05. Key generation, saved-key verification and GitHub provisioning are separate steps;
creating the item alone is not evidence that those later steps or offline recovery are complete.
The password read did not complete its approval, so no new key pair has been generated and no
release secrets have been configured in GitHub. Resume from the existing item; do not generate a
replacement password or duplicate item. Offline recovery destination/confirmation is still required.

## Required operator inputs and remaining gates

1. Domain onboarding and production routes are complete. Preserve `presto.build` and native
   identifier `build.presto.presto` before and after the first RC.
2. Generate a fresh password-protected updater key, commit its public key, store both secrets in
   the main-only `release-signing` environment, and confirm an offline recovery copy.
   The Tauri public-key field is intentionally empty; no inherited signing key is accepted.
3. Enter least-privilege, separate Cloudflare deployment/feed-deployment/feed-promotion tokens.
   Re-enter Apple credentials and authorize the release GitHub App for this repository.
   Enable `PRESTO_PREVIEWS_ENABLED` only after preview credentials are ready.
   On 2026-09-05 the repository and three protected environments had no secrets configured;
   Git signing and vault listing later succeeded, but the separate saved-item listing request
   timed out. No release signing secrets were generated, read or stored during these attempts.
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
