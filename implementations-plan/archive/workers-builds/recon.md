# Recon: landing + playground deploys → Cloudflare Workers Builds

Base: `origin/main` @ `f364570`. Two agents: a repo-wide reuse sweep (10 capabilities) and a Cloudflare
docs research pass (developers.cloudflare.com `.mdx` sources, read 2026-09-25).

## Reuse map

| Capability needed | Existing code | Verdict |
| --- | --- | --- |
| Build the playground against the published, provenance-verified SDK | `scripts/published-playground.ts` (+ `verify-sdk-package-signatures.ts`, `npm-pack-result.ts`, `.github/scripts/packaged-e2e-swap-sdk.sh`) | **adapt** — read versions from a committed pin instead of argv / the `testnet` dist-tag; noir from the pin instead of the workspace manifest |
| Know which published versions production runs | none — today the version is a `release-sdk` job output (`needs.publish-presto.outputs.version`) or `npm view …@testnet`. Searched: `testnet`, `PUBLISHED_VERSION`, `published-sdk`, `pin` in `scripts/`, `packages/playground/` | **build new** — a pin file; a dist-tag read is CDN-cached (lessons.md → npm publishing) and non-reproducible |
| Branch-aware build entry point for Workers Builds | none. Searched: `WORKERS_CI`, `workers-build`, `CF_PAGES`, `wrangler preview` across repo | **build new** — one small script; the only branch logic in the change |
| Open a bot PR after a release | `release-presto.yml` `bump-source` (App token, contents+PR write, `--auto --squash`); `_aztec-update.yml` `update` (create-or-update, stale-close, two-token split, opt-in CI-gated auto-merge) | **adapt** `_aztec-update.yml`'s job body inline (it is a `workflow_call` tied to dist-tag checks, not reusable as-is) |
| PR previews | `presto-previews.yml` (credential-split build/upload, `pr-N` alias, gated by `vars.PRESTO_PREVIEWS_ENABLED`) | **delete** — Workers Builds Worker Previews replace it |
| Landing production deploy | `deploy-landing.yml` | **delete** |
| Playground production deploy | `release-sdk.yml` `deploy-app` + the `mode` input | **delete**; `mode` only existed to select/skip it |
| Deploy contract tests | `scripts/cloudflare-deployment.test.ts`, `scripts/presto-preview-config.test.ts`, `scripts/sdk-release-contract.test.ts` (`deploy-app`, `mode`) | **adapt** / delete in the same change |
| Wrangler config shape | `packages/{landing,playground}/wrangler.jsonc`; pinned by `presto-domain.test.ts`, `cloudflare-deployment.test.ts` | **adapt** — add `"previews": {}` |
| Credential-free PR validation of the Worker configs | `landing.yml` (`wrangler deploy --dry-run` for landing + release-feed) | **reuse as-is**; drop its `deploy-landing.yml` filter line |
| Local production smoke of the playground | `app.yml` `production-smoke` → `scripts/test-production-smoke.sh` (local `vite preview`, no deployed URL) | **reuse as-is** |
| Origin allowlist | `packages/presto/verified-sites.json` + `VERIFIED_SITES.md:65-71` ("no preview or branch deployments") | **reuse as-is** — preview hosts stay unlisted |

## Facts the plan leans on

- `published-playground.ts` reads no env vars; shells out to `npm` (view, pack `--ignore-scripts`, install
  `--ignore-scripts`, `audit signatures --include-attestations`), `tar`, `bash`, `bun`. It rewrites
  `packages/playground/node_modules/@alejoamiras/{presto,presto-core,presto-noir}` in place, never
  `package.json` / `bun.lock`. Its only caller is `release-sdk.yml:245`. Its CLI path has no test.
- npm 10 omits verified attestations from its JSON signature-audit report (`release-sdk.yml:225`), so the
  published path needs npm ≥ 11.
- Playground and landing build from workspace **source** (`exports: ./src/index.ts`); no `dist/` prebuild.
  The only build-time variable is `AZTEC_NODE_URL`, defaulting to the public testnet node on `build`.
- No `trustedDependencies` anywhere: `bun install` runs no dependency lifecycle scripts. The root
  `prepare: husky` no-ops without `.git` or with `HUSKY=0`.
- `bunfig.toml`: `linker = "isolated"`, `minimumReleaseAge = 604800` (resolution only; frozen installs
  unaffected). `.bun-version` = `1.4.0`. `wrangler` is a root devDependency pinned `4.127.1`.
- Published today: `@alejoamiras/presto@testnet` = `5.2.0-revision.3`; `presto-noir@testnet` = `1.1.0`
  (= workspace). Last `release-sdk` run 2026-09-21; #55 (COEP `require-corp`) merged 2026-09-25, so the
  live playground predates it.
- `follow-ups.md` already tracks this migration ("The three Cloudflare API tokens versus Workers Builds").

## Workers Builds (Cloudflare docs, 2026-09-25)

- Build image: Ubuntu 24.04 x86_64; Node 24.18.0 default (`NODE_VERSION`, `.nvmrc`), npm 10.9.2 listed,
  Bun 1.2.15 default (`BUN_VERSION`). `SKIP_DEPENDENCY_INSTALL=1` disables the automatic install. The exact
  automatic install command is undocumented. `bash`/`tar` not listed (git, curl, build-essential are).
- Config per Worker: root directory, build command, deploy command (default `npx wrangler deploy`), Preview
  command (default `npx wrangler preview`), production branch, "Enable Preview Builds", build watch paths
  (include/exclude, `*` wildcard), build variables + secrets (build-time only, secrets masked).
- Injected: `CI=true`, `WORKERS_CI=1`, `WORKERS_CI_BUILD_UUID`, `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BRANCH`.
- Worker Previews: need Wrangler ≥ 4.135.0 and a `previews` block (required, may be empty). Assets and
  `compatibility_date` stay top-level; routes / custom domains target production only. URL
  `<branch>-<worker>.<subdomain>.workers.dev` (noindex), plus immutable deployment URLs; public by default.
  100 previews per Worker on Free, oldest evicted. New Workers use Previews by default; Workers connected
  before Previews need a one-time irreversible switch.
- GitHub: PR comment with the Preview URL, one check run per Worker (no fixed name documented). Fork PR
  behaviour undocumented.
- Token: auto-generated user token with Workers Scripts edit, **Workers KV Storage edit**, R2 edit, Workers
  Routes edit on all zones, plus reads; a custom token can be selected instead. Whether build-step code can
  read it is undocumented.
- Worker `name` in the wrangler config must match the dashboard Worker or the build fails. A "configuration
  PR" is only opened when no wrangler config is found and the deploy command is the default.
- Deploy Hooks exist (URL is the credential, 10/min per Worker). API trigger needs a "Workers Builds
  Configuration: Edit" token. No tag builds documented. One repo can connect to many Workers (monorepo).
- Limits: 20-min build timeout, 8 GB RAM, 1 concurrent build on Free (6 Paid); assets 25 MiB per file,
  20k files Free.

## Collision risks

1. `cloudflare-deployment.test.ts` and `sdk-release-contract.test.ts` pin `deploy-landing.yml` and
   `deploy-app` literally; `presto-preview-config.test.ts` executes a script embedded in
   `presto-previews.yml`. All three change in the same commit as the workflows. The `_headers`
   COOP/COEP assertions in the preview test must survive its deletion.
2. `packages/presto/scripts/ci-filter-contract.test.ts:82` uses `deploy-landing.yml` as an "unrelated
   workflow" fixture string: keep it meaningful by pointing it at a file that still exists.
3. Three App-token PR sequences would exist after this (bump-source, `_aztec-update`, the pin bump).
4. `landing.yml`'s credential-free dry-run must stay.
