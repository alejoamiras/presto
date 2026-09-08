# Release runbook

This repository ships three npm packages and one native app, each versioned independently:

| Artifact | Version | Release entry point | Use it when |
|---|---|---|---|
| SDK (`@alejoamiras/presto`) | derived from the pinned `@aztec/stdlib` | `release-sdk.yml` (`packages=presto`, the default) | The SDK or pinned `@aztec/*` dependencies changed |
| Core (`@alejoamiras/presto-core`) | `packages/sdk-core/package.json` | `release-sdk.yml` (`packages=presto-core`) | Transport, status, or fallback policy changed |
| Noir adapter (`@alejoamiras/presto-noir`) | `packages/sdk-noir/package.json` | `release-sdk.yml` (`packages=presto-noir`) | The adapter changed, or its `@aztec/bb.js` peer pin moved |
| Desktop + headless presto | `packages/presto` | `release-presto.yml` | Native server, desktop UI, updater, trust, or bb download logic changed |

An Aztec protocol bump is normally SDK-only. Installed Presto apps download and verify the matching `bb` version at runtime; do not cut a native-app release merely to track an `@aztec/*` bump. It is also **not** a core release: core has no `@aztec/*` dependency. It is a `presto-noir` release only when the adapter's `@aztec/bb.js` peer pin (and `TESTED_BB_VERSIONS`) moves with it — `scripts/update-aztec-version.ts` bumps that pin in lockstep, so a bump that touches `packages/sdk-noir` publishes the adapter too.

Both SDKs depend on core at an **exact** version (`workspace:*` in the tree, pinned to the packed version at publish time), so a core change reaches users only through a publish of core **and** of every adapter that must pick it up: publish core, bump nothing else, and the adapters keep their previous core pin until they are republished.

## One-time production configuration

Keep the release setup small: neither GitHub environment requires reviewers, but both restrict deployment branches to `main`. For this solo-maintainer repository, environments scope secrets and OIDC claims to release jobs; they are not independent approval boundaries. A commit already trusted on `main` can change a workflow that consumes an environment secret. Add a reviewer or external signing service only if that stronger threat model becomes necessary.

### `release-signing` GitHub environment

Store both required environment secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Generate a new password-protected key for Presto. Commit only its public key. Neither secret
may exist at repository scope. Re-enter Apple signing/notarization credentials separately:
GitHub cannot export existing secrets.

The owner explicitly approved 1Password as the backup of record on 2026-09-05, removing the
separate offline-copy requirement from the original launch plan. Save the key and password in
1Password, verify exact read-back and successful signing, and record that public key as
`recoveredUpdaterPublicKey` in `infra/presto-identity.json`. Never claim recovery based only on a
GitHub upload. This attestation does not claim that an independent offline backup exists.
The signing job must verify every payload and manifest against the committed public key.

### Launch gates

The operational PR remains draft until the permanent `PRESTO_DOMAIN`, reverse-domain native
identifier, updater endpoint, Cloudflare routes, secrets, and all required tests are finalized.
`bun scripts/presto-release-readiness.ts` fails closed while any launch attestation is pending.
Only set `releaseReady` after these checks and all three independent reviews pass.

Workers may run on workers.dev before this gate; they are previews, not stable releases.
The fresh feed namespace is `41a6adef830f4a91bf63476a323cec98`; never reuse another product's KV,
updater key, certificates, native identifier, or installation.

Release sequence: SDK 5.2.0 to `testnet` with provenance; native `1.0.0-rc.1`; native
`1.0.0` using RC1 as its actual same-key baseline; stable feed promotion; full-stack consent
verification; then guarded SDK `latest` promotion. RCs must never enter the public feed.

### Cloudflare deployment credentials

Keep three distinct tokens, each saved/read-back verified in 1Password before GitHub setup:

| Purpose | GitHub location | Permissions |
| --- | --- | --- |
| Landing/playground and PR previews | Repository: `CLOUDFLARE_DEPLOY_API_TOKEN` | Account Workers Scripts Edit; Presto zone Workers Routes Edit and Zone Read |
| Feed Worker code | Main-only `release-feed`: `CLOUDFLARE_RELEASE_FEED_DEPLOY_API_TOKEN` | Account Workers Scripts Edit only |
| Signed feed promotion | Main-only `release-feed`: `CLOUDFLARE_RELEASE_FEED_API_TOKEN` | Account Workers KV Storage Edit only |

Feed deployment uses `wrangler versions upload` and deploys the exact returned version ID at 100%.
It does not run `wrangler deploy` or `wrangler triggers deploy`: route changes require the separately
scoped site token and an explicit infrastructure operation. Keep the configured feed route in place.
The uploaded version is selected from Wrangler's structured output, validating the Worker name and
version ID before activation. This follows Cloudflare's separation of
[versions, deployments and triggers](https://developers.cloudflare.com/workers/wrangler/commands/workers/).
Uploading a version alone does not promote the stable manifest or change production traffic.

### First-release historical note

The one-time `1.0.0-rc.1` baseline exception was used for the initial launch and is now retired.
The dated launch status and checklist retain its evidence. Do not recreate, delete, or rewrite that
release; resolve future failures under the ordinary append-only release rules.

### `npm-publish` GitHub environment and npm trusted publisher

The environment has no npm secret. Configure each package's [npm GitHub Actions trusted publisher](https://docs.npmjs.com/trusted-publishers/) exactly as follows — one registration per npm name in `scripts/npm-packages.ts` (`@alejoamiras/presto`, and `@alejoamiras/presto-core` / `@alejoamiras/presto-noir` before their first publish; registering a new name is an owner action, never a workflow step):

| Field | Value |
|---|---|
| Organization or user | `alejoamiras` |
| Repository | `presto` |
| Workflow filename | `release-sdk.yml` |
| Environment | `npm-publish` |
| Allowed action | Direct `npm publish` enabled; npm also grants staged publishing |

`_publish-npm.yml` is intentionally `workflow_call`-only. npm validates the calling workflow name for reusable workflows, so the trusted-publisher filename is `release-sdk.yml`; the reusable's `publish` job declares `id-token: write` and only the `publish-*` jobs in `release-sdk.yml` delegate it. The reusable's other jobs run with `contents: read`: `pack` builds and packs the candidate and records its SHA-256 as a job output, `consumer-test` installs the artifact from the registry with lifecycle scripts off, and `verify` performs the post-publish fresh install. The `publish` job re-asserts the recorded digest before `npm publish`, so nothing resolved from the registry ever runs beside the OIDC identity and no job that does can swap the artifact.

Bootstrap the package interactively with npm login and 2FA. Publish only
`@alejoamiras/presto@0.0.0-bootstrap.0` under the `bootstrap` tag, configure the trust above,
then deprecate that version after trust verification. Never request `latest` for the bootstrap.
On 2026-09-06 npm nevertheless assigned `latest` on the first publication and rejected its
authenticated removal with HTTP 400. The owner approved leaving that tag on the deprecated,
non-functional bootstrap temporarily. This does not authorize early promotion of the real SDK:
publish 5.2.0 to `testnet`, then move `latest` only after the normal final-promotion gates.
The real 5.2.0 release must be produced by CI with provenance; there is no token fallback.

## Preflight for every release

- Work from a clean `main` checkout at the intended commit.
- Require all CI checks to be green.
- Confirm no release workflow is queued or running.
- Run the repository checks:

```bash
bun install --frozen-lockfile
bun run test
bun run lint:actions
bun run audit:dependencies
bun run --cwd packages/presto frontend:build
cargo test --locked --manifest-path packages/presto/core/Cargo.toml
cargo test --locked --manifest-path packages/presto/server/Cargo.toml
cargo test --locked --manifest-path packages/presto/src-tauri/Cargo.toml
```

`audit:dependencies` combines `bun audit` with `cargo audit` over all three Rust lockfiles. Both release workflows run the same audit as a publication gate. New npm high/critical findings and every RustSec vulnerability block. npm moderate/low findings and RustSec informational warnings are reported. A blocking finding may be accepted only in `scripts/dependency-audit-allowlist.json` with an exact package/advisory pair, rationale, upgrade path, and future expiry. Never extend an expired exception just to make a release green.

## Releasing the presto

Publishing and promotion are separate, serialized events. Publish creates a tested GitHub release but never changes the live updater feed. Promotion verifies an already-published stable release and moves the feed; the same operation is the rollback lever.

**Next app minor: 1.1.0.** `POST /prove/ultra-honk` (generic UltraHonk proving of any Noir circuit, advertised as `ultra_honk` in `/health.schemes`) is an additive route and ships in Presto **1.1.0** — publish it as `1.1.0` (after `1.1.0-rc.N` if a canary is wanted), never as a 1.0.x patch, so clients can map the scheme to an app minor. The `bump-source` flow sets the source version as usual.

### 1. Publish

```bash
gh workflow run release-presto.yml --ref main -f version=X.Y.Z
# or prerelease:
gh workflow run release-presto.yml --ref main -f version=X.Y.Z-rc.N
```

Every ordinary publish requires a complete, published, lower release using the current updater key.
The resolver includes prereleases and selects the greatest compatible version. Missing baselines
fail closed. Future key rotation requires a separately reviewed migration. There is no dispatch override.

The release path is:

```text
validate/main-only + 3-OS WebDriver
  → 4 desktop builds + 4 headless builds
  → isolated production updater signing
  → resolve the greatest lower complete same-key updater baseline
  → notarization, launch, updater, and tamper-rejection smokes
  → draft release
  → packaged E2E against the draft's own assets
  → tag the dispatched commit
  → re-check asset digests and publish the draft
```

Desktop builds use fresh throwaway updater keys so a new binary can be produced without exposing the production key. Their temporary signatures are excluded. The `release-signing` job then signs the four exact updater payloads with the production key and verifies every payload and feed against the embedded public key. That job does not build, install, launch, or smoke-test applications. Smokes consume only the pre-signed artifacts. The updater baseline may be a prerelease: this is intentional, so RC2 exercises RC1 and GA exercises the newest same-key RC instead of falling back to an older incompatible key.

The packaged composed-proof legs replace the playground's workspace SDK with the packed tarball, build the production playground, and serve that bundle only on `127.0.0.1:5173`. They deliberately do not use Vite's development dependency optimizer. Playwright is exact-pinned identically in the desktop and playground packages, and every browser install resolves from the consuming workspace instead of allowing a root-context `bunx` to fetch a different release. Each composed-proof step has a 35-minute ceiling; a failure or cancellation retains the presto, node, preview-server, and Playwright trace output in the attempt-specific Actions artifact.

A prerelease is public with `--latest=false` and omits `latest.json`. A stable release includes `latest.json`, but publishing still does not write KV, alter what installed clients receive, or mark the release GitHub Latest. After a real forward GA promotion verifies the signed public feed, the workflow marks that release GitHub Latest. A rollback changes only the authoritative updater feed and deliberately leaves GitHub Latest on the newest GA.

### Expected assets

Every release has 16 binary assets:

- two macOS DMGs and two macOS updater `.app.tar.gz` files;
- Linux `.deb` and `.AppImage` files;
- Windows first-install `.exe` and updater `.nsis.zip` files;
- four headless server `.tar.gz` files, each with a `.sha256` sidecar.

A stable release has a seventeenth asset: signed `latest.json` containing exactly `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, and `windows-x86_64`.

The Windows installer is deliberately not Authenticode-signed. SmartScreen therefore shows **Unknown publisher** on first install; users select **More info → Run anyway**. This is an accepted distribution limitation, not a release blocker. The updater payload is independently Ed25519-signed and verified before application.

### 2. Verify the published release

- Confirm the workflow finalized the draft and the Git tag resolves to the dispatched commit.
- Confirm the exact asset count: 16 for a prerelease, 17 for stable.
- Confirm macOS signature and notarization jobs passed.
- Confirm macOS, Linux, and Windows updater smokes passed, including negative tamper controls.
- For a stable, download its `latest.json` asset and confirm its version, four platform entries, non-empty signatures, sizes, and exact release URLs.
- For Windows trust/certificate/HTTPS changes, complete the manual Windows composed-proof check in the [presto README](../packages/presto/README.md#windows-composed-proof--manual-pre-ga-check).

Do not promote a release that needs unexplained retries or manual asset replacement. Published releases and tags are append-only; fix forward with a new version.

### 3. Promote the live updater feed

Rehearse the exact validation without writing production:

```bash
gh workflow run release-presto.yml --ref main \
  -f version=X.Y.Z -f mode=promote-only -f dry_run=true
```

For an ordinary GA, flip and verify the feed, mark the release GitHub Latest, and open the source-version bump PR:

```bash
gh workflow run release-presto.yml --ref main \
  -f version=X.Y.Z -f mode=promote-only -f bump_source=true
```

Promotion independently requires a published, non-draft, non-prerelease release with the exact 17 assets. It verifies the release's own signed manifest, exact platform URLs, and reachable payloads before uploading those same manifest bytes. The KV write is authoritative, and a separate job polls the public feed until it serves the requested version and passes cryptographic verification. Only then does an organic-GA promotion (`bump_source=true`) update GitHub's Latest badge. Rollback promotions leave that human-facing badge unchanged.

Merge the source-version bump PR after an organic GA. Never request `bump_source` for a rollback.

### Presto rollback

Move the live feed back to an intact previous stable; do not delete or rebuild any release:

```bash
gh workflow run release-presto.yml --ref main \
  -f version=<PREVIOUS_GOOD> -f mode=promote-only -f dry_run=true

gh workflow run release-presto.yml --ref main \
  -f version=<PREVIOUS_GOOD> -f mode=promote-only
```

This stops new updater uptake and moves landing-page downloads back. It does not downgrade clients that already updated. Fix forward under the next version.

The first stable release has no previous stable Presto release to restore. Do not use the RC or
another product's feed as a rollback target. Likewise, the SDK bootstrap is not a functional
rollback version. Preserve published versions and fix forward; these rollback commands become
applicable only when a verified earlier stable version exists.

### Site and feed-Worker rollback

Before deployment, record each Worker's active version ID in the launch checkpoint. For the
affected package (`landing`, `playground` or `release-feed`), list deployments and choose the
explicit, previously verified version; do not infer it from a PR preview or list ordering:

```bash
bunx wrangler deployments list --config packages/landing/wrangler.jsonc --json
bunx wrangler versions view '<VERIFIED_VERSION_ID>' --config packages/landing/wrangler.jsonc
bunx wrangler versions deploy '<VERIFIED_VERSION_ID>@100' --config packages/landing/wrangler.jsonc --dry-run
```

After reviewing the target and its bindings, the deliberate mutation is:

```bash
bunx wrangler rollback '<VERIFIED_VERSION_ID>' --config packages/landing/wrangler.jsonc
```

Repeat the read-back and public endpoint checks after a rollback. A Worker rollback changes code
and assets, **not KV contents**; signed-feed restoration still uses the guarded native promotion
flow above. Keep the namespace and other bound resources intact. Cloudflare limits rollback to
recent versions, so revalidate availability before each release rather than assuming a saved ID
remains deployable forever. See [Cloudflare rollback semantics](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Releasing the SDK candidate

`release-sdk.yml` has one manual entry point, three modes, a package selection, and a dry run:

```bash
# Default: publish the SDK candidate, then deploy the testnet playground
gh workflow run release-sdk.yml --ref main -f mode=sdk-and-playground

# Publish only
gh workflow run release-sdk.yml --ref main -f mode=sdk-only

# Deploy playground only; no npm mutation
gh workflow run release-sdk.yml --ref main -f mode=playground-only

# One sibling package, or every package in dependency order (core before its adapters)
gh workflow run release-sdk.yml --ref main -f mode=sdk-only -f packages=presto-core
gh workflow run release-sdk.yml --ref main -f mode=sdk-only -f packages=all

# Plan and preflight only: publishes nothing, reports what would publish, reuse, or be deferred
gh workflow run release-sdk.yml --ref main -f mode=sdk-only -f packages=all -f dry_run=true
```

The `plan` job (`scripts/release-plan.ts`) decides before anything is published:

- `@alejoamiras/presto` (`aztec-derived`) always publishes, with a revision suffix when its base is taken.
- A `manifest`-versioned package (`presto-core`, `presto-noir`) publishes its `package.json` version exactly once. A version already on npm is **reused** — not republished, not a collision — when its release tag and provenance name the same commit and the package's sources are unchanged since that commit; otherwise the run fails before publishing anything, and the fix is forward: bump the version and rerun with the same selection. Nothing is ever deleted or overwritten.
- A package that depends on a sibling published in the same run cannot have that dependency's provenance, or its consumer rerun against the registry dependency, checked up front; the plan lists those as **deferred**, and the adapter's publish job performs them after the dependency is published and verified. With `dry_run=true` the summary shows exactly which checks would be deferred.
- A `workspace:` dependency that is neither selected nor already on npm at the pinned version fails the plan.

After a partial publish (a dependency published, an adapter failed), rerun with the same selection: the published dependency is reused and only the remaining packages publish.

Publish order is core → `presto-noir` → `presto`, each adapter's consumer profile rerun against the registry core before it publishes. With `mode=sdk-and-playground` the playground deploys once every selected package has published (or was reused); a package not selected is consumed at its current published version — `packages=presto-noir` alone deploys the published adapter with the SDK currently on `testnet`. The deployment consumes only tarballs whose bytes hash to the integrity that both the provenance statement and npm's signature audit vouched for; a download that differs from what was verified aborts the deploy. `@alejoamiras/presto` keeps the sandbox e2e (native chonk parity) as its gate; `@alejoamiras/presto-noir` has its own production gates at the release SHA, run by the `noir-gates` job through `_ts-package-ci.yml`: bb.js WASM must reproduce the committed Noir fixtures byte for byte, and the adapter must prove natively (`fallback: "none"`) against a headless presto built from that commit with the real `bb`. Either failing blocks the adapter's publish and, through the order above, the SDK's.

`testnet` is the npm candidate dist-tag used by the public testnet playground. It is not an npm network or a lesser form of the package. There is no separate `mainnet` publish path today: accepted candidates are deliberately promoted from `testnet` to npm's default `latest` tag. The old npm nightly publish path is retired; the historical `nightlies` dist-tag is left untouched.

### Candidate version and gates

The SDK package's checked-in version remains `0.0.0`. The workflow derives a version from the pinned `@aztec/stdlib` version. If the base already exists, it chooses `<base>-revision.N` for a stable base or appends `.N` to a prerelease base. `presto-core` and `presto-noir` publish the version in their `package.json` verbatim, so a change to either starts with a version bump in the tree (a `manifest` version is never suffixed).

Preview the derived version (`--package <key>` for a sibling; the base comes from the package's manifest):

```bash
bun scripts/get-sdk-publish-version.ts --package presto
```

Before dispatching, verify the derived npm version, matching Git tag, and GitHub release are all absent. The workflow repeats these checks, builds and rewrites the package manifest, packs one exact tarball and records its digest (`pack`), runs the consumer test against that tarball in a read-only job (`consumer-test`), then re-checks the digest and publishes those bytes with OIDC to `testnet` (`publish`).

After npm accepts the package, the workflow requires all of the following before creating the tag/release:

- the exact version is readable from npm;
- `testnet` points to it;
- npm's current verifier cryptographically validates registry signatures and the SLSA attestation for the exact installed package;
- the verified attestation subject digest matches npm's exact tarball integrity, and its source dependency identifies `alejoamiras/presto`, `.github/workflows/release-sdk.yml`, `refs/heads/main`, and the dispatched commit.

It then tags the commit and creates a non-latest GitHub release; a final read-only job verifies the records and a fresh registry install. npm publication is irreversible, so if npm accepted the package but a later step failed, do not redispatch blindly; inspect and repair only the missing record.

### HTTPS-by-default candidate canary

Before promoting an SDK candidate that changes browser transport or recovery UI, validate the
`testnet` package together with the deployed testnet playground. Do not promote until all of these
hold in supported browsers:

- trusted HTTPS reaches native proving and `/prove` is sent only to the HTTPS port;
- HTTPS unavailable produces `secure-connection-unavailable`, then
  `secure-connection-unavailable` → `fallback`, with WASM completing normally;
- each health diagnosis renders the intended Encrypted Connection/certificate/install guidance;
- the post-failure HTTP diagnostic is a bounded `GET /health` with no witness, no POST, no redirect,
  and no change to proof eligibility or protocol pinning;
- `permission-blocked` retains its separate browser site-permission recovery;
- HTTP proving is unavailable until the user confirms the warning, after which both
  `httpsOnly: false` and `allowInsecureDowngrade: true` apply only to the current prover instance;
- reload/new prover restores HTTPS-only, with no consent in storage, cookies, URL parameters, or
  desktop configuration; and
- the landing page explains recovery but cannot activate or persist HTTP.

If any transport invariant, status classification, prompt, or session-reset behavior regresses,
stop promotion. Fix forward under a new derived SDK revision and redeploy the testnet playground.
If a regression is discovered only after promotion, move `latest` back with the SDK rollback command
below and restore the last known-good playground deployment; never delete or republish the bad npm
version.

### First OIDC canary

For the first run after enabling trusted publishing:

1. Double-check the npm trusted-publisher fields and `npm publish` allowed action.
2. Keep the old token stored but ensure it is not referenced by either workflow.
3. Dispatch `sdk-only` from `main`.
4. Confirm the publish step reports trusted publishing/OIDC, `testnet` moved, provenance passes, the Git tag/release exist, and a clean install succeeds.
5. Remove the old automation token from GitHub and revoke it on npm.

An authentication failure before npm contains the derived version is safe to retry after fixing the trusted-publisher configuration. npm does not validate the configuration when it is saved, so filename, owner, repository, environment, runner type, and `id-token: write` are the first things to inspect.

## Promoting the SDK to `latest`

Promotion is intentionally local and interactive so proof of presence/2FA stays with the maintainer:

```bash
npm login
bun run sdk:promote -- <VERSION> --dry-run
bun run sdk:promote -- <VERSION>
```

Every package publishes under `testnet` and is promoted on its own with `--package <key>`
(`presto`, the default, `presto-core`, `presto-noir`); one command moves one package's tag:

```bash
bun run sdk:promote -- --package presto-core <CORE_VERSION> --dry-run
bun run sdk:promote -- --package presto-core <CORE_VERSION>
bun run sdk:promote -- --package presto-noir <NOIR_VERSION>
bun run sdk:promote -- <SDK_VERSION>
```

Promote in dependency order — core, then the adapters — so `latest` reads coherently. Installs do
not depend on that order: an adapter pins its core exactly, so a bare `npm install
@alejoamiras/presto-noir` resolves the pinned core version whatever `latest` points at.

The script refuses to mutate npm unless:

- no `release-sdk.yml` run is queued or active;
- the version exists and `testnet` points to it;
- provenance matches this repository, `release-sdk.yml`, `main`, and a concrete commit;
- `npm audit signatures` cryptographically verifies the exact package's SLSA attestation;
- the remote Git tag resolves to that provenance commit;
- the matching GitHub release exists.

The non-dry run prints the evidence, asks for `y`, then immediately rechecks active workflows and uncached `latest`/`testnet` state before executing `npm dist-tag add` and reading back `latest`. npm has no compare-and-swap operation for dist-tags, so this deliberately small residual race is accepted for the solo-maintainer workflow; do not run two promotion commands concurrently. This needs a locally authenticated npm identity with package write access and the account's 2FA policy. npm access tokens do not have a promotion-only permission; the safety boundary is the interactive script's checks, dry run, confirmation, and absence of a CI token.

Moving a dist-tag changes new bare/`@latest` installs only. It does not remove the candidate or change consumers already pinned by a lockfile or semver range. Rollback is explicit, must target a lower version, and does not require the old version to remain on `testnet`:

```bash
bun run sdk:promote -- <PREVIOUS_GOOD> --rollback --dry-run
bun run sdk:promote -- <PREVIOUS_GOOD> --rollback
```

Rollback accepts provenance from the current `release-sdk.yml` identity or the retired, exact `publish-testnet.yml` identity so pre-migration releases remain usable. Ordinary forward promotion accepts only `release-sdk.yml` provenance and still requires `testnet` to identify the candidate.

Never delete or re-publish an npm version. Fix forward under a new derived revision/version.

## Failure classification

Always read external state before retrying (substitute the sibling's npm name for a core or
adapter release; the `presto-core` / `presto-noir` release tags are `@alejoamiras/<name>@<version>`
like the SDK's):

```bash
npm view @alejoamiras/presto versions dist-tags --json
gh run list --workflow release-sdk.yml --limit 20
```

- **Version absent:** no npm publish landed. Fix the root cause, then redispatch.
- **Version present, `testnet` missing/wrong:** stop and inspect the publish output and registry state; do not mint another revision automatically.
- **Version and `testnet` correct, tag/release missing:** publication landed. Do not redispatch; repair the missing Git/GitHub record only after matching it to provenance.
- **Promotion command printed the successful `+latest` mutation but read-back failed:** do not immediately reverse it. Inspect the uncached registry state first; registry reads can lag writes.
- **Unexpected third version/tag:** stop all mutation and investigate.

For the partial-publish case, first run both verifiers and record the provenance commit printed by the first command:

```bash
bun scripts/sdk-release-verification.ts <VERSION>
bun scripts/verify-sdk-package-signatures.ts <VERSION>
```

Then confirm the exact tag and release are absent, fetch the printed commit from `origin`, and inspect it before creating anything. Only when the package digest, source dependency, workflow, branch, and commit all match may you repair the append-only records:

```bash
TAG="@alejoamiras/presto@<VERSION>"
COMMIT="<PROVENANCE_COMMIT>"
git fetch origin main
git show --stat "$COMMIT"
git ls-remote --exit-code origin "refs/tags/$TAG" && exit 1 || true
gh release view "$TAG" && exit 1 || true
git tag "$TAG" "$COMMIT"
git push origin "refs/tags/$TAG"
gh release create "$TAG" --title "$TAG" --notes "Recovered the release record for the provenance-verified npm package." --latest=false packages/sdk/MIGRATION.md
```

Those last three commands mutate public state. Run them only as a deliberate repair after the read-only checks; never use them to replace an existing tag or release.

## User diagnostics

| Platform | Logs |
|---|---|
| macOS | `~/Library/Application Support/presto/logs/` |
| Linux | `~/.local/share/presto/logs/` |
| Windows | `%LOCALAPPDATA%/build.presto.presto/logs/` |

Configuration is stored in `~/.presto/config.json` on macOS/Linux and the equivalent user profile location on Windows.

- **Port 59833 in use:** another presto instance or local process owns the HTTP listener. Inspect it before terminating anything.
- **bb unavailable:** inspect the health payload and logs; versioned proof requests should trigger a verified on-demand download.
- **bb verification failed:** preserve the logs. Runtime downloads fail closed when the upstream digest is missing or mismatched.
- **Updater failure:** inspect the published release's `latest.json`, exact platform URL, payload size/signature, and application logs. Never work around it by hand-editing the live feed.
