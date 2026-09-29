# Cloudflare deployment

The landing page and playground are Workers Static Assets Workers that Cloudflare Workers Builds
builds from this repository: production on every push to `main`, a Worker Preview on every other
branch. The signed desktop update manifest is served by a small Worker from KV, deployed and promoted
by manual, environment-gated Actions workflows. No OpenTofu, S3, CloudFront, or build server is
required, and GitHub holds no credential for the sites.

## Presto production identity

The permanent domain is `presto.build` (Cloudflare Registrar), with native identifier
`build.presto.presto`. Do not change the identifier after the first RC ships.

- Landing Custom Domain: `https://presto.build`.
- Playground Custom Domain: `https://playground.presto.build`.
- Feed route: `presto.build/releases/*`, serving `https://presto.build/releases/latest.json`.

All three Workers retain `workers_dev: true` and `preview_urls: true` as fallback/preview endpoints.
Deploy the landing Custom Domain before the feed route so the apex has a proxied DNS record.
The fresh feed must remain empty (HTTP 503) until signed stable 1.0.0 is explicitly promoted.

## Workers Builds (landing and playground)

Each site Worker is connected to `alejoamiras/presto` in the Cloudflare dashboard (Worker → Settings
→ Build). These values are the source of truth; the dashboard holds only fixed strings, and every
branch decision lives in `scripts/workers-build.ts`.

| Setting | `presto-landing` | `presto-playground` |
| --- | --- | --- |
| Repository / production branch | `alejoamiras/presto` / `main` | same |
| Enable Preview Builds | on | on |
| Root directory | `/` | `/` |
| Build command | `bun scripts/workers-build.ts landing` | `bun scripts/workers-build.ts playground` |
| Deploy command | `bunx wrangler deploy --config packages/landing/wrangler.jsonc` | `bunx wrangler deploy --config packages/playground/wrangler.jsonc` |
| Preview command | `bunx wrangler preview --config packages/landing/wrangler.jsonc` | `bunx wrangler preview --config packages/playground/wrangler.jsonc` |
| Build variables | `BUN_VERSION=1.4.0`, `SKIP_DEPENDENCY_INSTALL=1` | same, plus `NODE_VERSION=24.20.0` |
| Build watch paths (include) | `packages/landing/*`, `scripts/*`, `package.json`, `bun.lock`, `bunfig.toml`, `.bun-version` | `packages/playground/*`, `packages/sdk/*`, `packages/sdk-core/*`, `packages/sdk-noir/*`, `packages/banners/*`, `fixtures/noir/*`, `scripts/*`, `.github/scripts/*`, `package.json`, `bun.lock`, `bunfig.toml`, `.bun-version`, `tsconfig.json` |
| API token | the custom build token below | same |

The build script installs with `--frozen-lockfile --ignore-scripts` (no dependency lifecycle script
runs next to the token), refuses a Bun other than `.bun-version`, and for the playground checks npm
≥ 11 (npm 10 omits verified attestations from `npm audit signatures --json`), `bash` and `tar` on
every branch, so a preview proves the image can run the production path. Keep `BUN_VERSION` equal to
`.bun-version`: a Bun bump that forgets the dashboard fails the build instead of building on the
wrong Bun. An empty commit bypasses watch paths and always builds.

**Production playground.** A playground build of `main` installs the SDK publications named in
`packages/playground/published-sdk.json`, verified against their signed provenance
(`scripts/published-playground.ts`), instead of the workspace SDK. Every other build, previews
included, uses the workspace. The pin moves through the release flow in
[`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md#releasing-the-sdk-candidate).

**Previews.** Worker Previews give each branch a stable, public, `noindex` URL
(`<branch>-<worker>.<subdomain>.workers.dev`) and post it on the PR. Wrangler ≥ 4.135 and the
`previews` block in each `wrangler.jsonc` are required; routes and custom domains stay
production-only. Previews never enter `verified-sites.json`, so Presto treats them as ordinary
deny-by-default origins. Cloudflare keeps the latest 100 per Worker.

**Build token.** The token builds deploy with never leaves Cloudflare. The one Cloudflare creates on
connect also grants KV, R2 and all-zone route edit, so both Workers use a custom token (Settings →
Build → API token) with only Account › Workers Scripts Edit, Account › Account Settings Read, Zone
`presto.build` › Workers Routes Edit and Zone Read, User › User Details Read and Memberships Read.
It removes direct KV/R2 access, not the account-wide boundary below. If a production deploy fails
on the custom domains, add Zone `presto.build` › DNS Edit. Install the Cloudflare GitHub App on
`alejoamiras/presto` only.

**The real boundary is the account.** Workers Scripts Edit is account-wide, so any code that runs
in a build (a preview branch included) could in the worst case redeploy any Worker in the account,
the release-feed Worker among them. Clients verify the feed's Ed25519 signature, so the worst case
on the updater path is a withheld or replayed older signed feed; on the landing it is altered
download links. Builds come from pushes to branches of this repository (the owner and the
release-bot App). Cloudflare's docs say nothing about fork PRs; the cutover's fork check passed on
2026-09-27 (a fork PR touching `scripts/` got no build, check or comment), so recheck it after any
change to the Builds connection or Cloudflare's preview behaviour. Build variables are compiled
into public bundles; never put a secret in one.
`AZTEC_NODE_URL` defaults to the public testnet node at build time; set it only to override.

**Rollback.** A dashboard or `wrangler rollback` is overwritten by the next production build.
Revert the offending commit on `main` (preferred), or roll back and pause builds until the fix
merges. Reverting this whole setup also means disconnecting Workers Builds, whose build command
would otherwise run a deleted script.

### Cutover from the Actions deploys

1. Scope the Cloudflare GitHub App to this repository and connect both Workers with the table
   above. If a "Set up Worker Previews" banner shows, complete it. A
   production build of `main` may run on connect and fail before this setup merges; nothing deploys.
2. Same-repository control: push an empty commit to a branch. Both preview builds must go green,
   both Preview URLs must load, the playground's with `crossOriginIsolated === true` and COEP
   `require-corp`, and its build log must show npm ≥ 11.
3. Fork check, right after: from a fork you control, open a PR changing a file under `scripts/`
   (watched by both Workers). Pass means that ten minutes later neither Worker's build list shows a
   queued, running or finished build for the fork commit, and the PR carries no Workers Builds check
   or comment. On failure, turn preview builds off on both Workers, cancel any fork build, and stop.
   Skipping this check is an explicit, recorded owner decision.
4. Merge. Both production builds on the merge commit must be green, and production must serve the
   isolation headers and the pinned SDK.
5. After a day of normal operation, revoke the old site token in Cloudflare, then
   `gh secret delete CLOUDFLARE_DEPLOY_API_TOKEN` and `gh variable delete PRESTO_PREVIEWS_ENABLED`.
   Until then, reverting the setup (and disconnecting Builds) restores the Actions path.

## Fork setup

1. Run `wrangler login` and finish the browser OAuth flow. Verify with `wrangler whoami`.
2. Create a namespace with `wrangler kv namespace create PRESTO_RELEASE_FEED` and replace the namespace ID
   in `packages/release-feed/wrangler.jsonc` and `.github/workflows/release-presto.yml`.
3. Change the Worker names and custom-domain routes in each `wrangler.jsonc` for the fork's account.
4. Create `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_RELEASE_FEED_DEPLOY_API_TOKEN`, and
   `CLOUDFLARE_RELEASE_FEED_API_TOKEN` GitHub Actions secrets. Store the latter two on the
   `release-feed` environment, not at repository scope. Keep the promotion token limited to KV
   read/write, and the release-feed deployment token separate from the site build token.
5. Inspect existing DNS and routes for conflicts before deployment; do not overwrite unrelated
   records. Connect the landing Worker to Workers Builds first (its production build creates the
   apex Custom Domain), then deploy the release-feed route and connect the playground. Verify all
   three public endpoints immediately. Do not seed `latest.json` with test data or a prerelease:
   promotion waits for a verified signed stable release.

The release-feed Worker deploy is manual and uses the protected `release-feed` GitHub environment.
Feed content promotion remains a separate workflow operation with a KV-only credential.

## Testnet RPC forwarder (temporary)

`presto-testnet-rpc` (`packages/testnet-rpc`, workers.dev only) stands in for Aztec's public v6
testnet RPC until Aztec publishes one: it forwards node JSON-RPC to the private RPC, held only as
its `AZTEC_NODE_URL` secret. It is deployed and deleted by owner-approved keyed runs of
`scripts/forwarder.sh up|down` with `deploy.env.example`, never from Actions or Workers Builds. Its
token is Workers Scripts Edit with an expiry, so it shares the account-wide boundary above. Once the
public RPC exists, the playground, SDK and smoke move to it and the Worker is deleted.
