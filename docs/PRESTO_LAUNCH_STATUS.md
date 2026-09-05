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

## Deployed preview infrastructure

| Service | workers.dev endpoint | Immutable Worker version |
| --- | --- | --- |
| Landing | https://presto-landing.alejo-amiras.workers.dev | ebe9f226-13f2-43ba-b491-c5d30d6ebc27 |
| Playground | https://presto-playground.alejo-amiras.workers.dev | 38b8ba65-8cc8-4c92-862b-06620d805659 |
| Feed | https://presto-release-feed.alejo-amiras.workers.dev/releases/latest.json | 91ae2b6f-ebd7-4af9-87ab-747e02604625 |

Fresh namespace: `PRESTO_RELEASE_FEED`, ID `41a6adef830f4a91bf63476a323cec98`.
Landing/playground respond successfully. Feed intentionally returns 503: no stable manifest has
been promoted. Preview deployments are work-in-progress snapshots, not the final reviewed release.

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
- Linux/Windows installer execution, packaged candidate and same-key updater matrices still require CI
  and real Presto RC/stable artifacts. Local NSIS and hermetic autostart harnesses require Docker.
- Three independent operational review areas were examined; identified high defects were corrected.
  Final approval must be refreshed against the exact commit after domain/key/credential work.

## Required operator inputs and remaining gates

1. Supply and onboard the permanent apex domain. Replace temporary URLs throughout the product,
   derive and freeze the native identifier, add landing/playground Custom Domains and feed route.
2. Generate a fresh password-protected updater key, commit its public key, store both secrets in
   the main-only `release-signing` environment, and confirm an offline recovery copy.
   The Tauri public-key field is intentionally empty; no inherited signing key is accepted.
3. Enter least-privilege, separate Cloudflare deployment/feed-deployment/feed-promotion tokens.
   Re-enter Apple credentials and authorize the release GitHub App for this repository.
   Enable `PRESTO_PREVIEWS_ENABLED` only after preview credentials are ready.
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
