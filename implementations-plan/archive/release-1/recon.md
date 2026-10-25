# release-1 recon

Base: `main` at 80b562e. One Explore agent (Sonnet) plus direct reads. Line numbers are from that base.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Bounded spawn that names the command | `scripts/registry-consistency.ts:33-51` `NPM_TIMEOUT_MS = 180_000`, `run(command, cwd, timeoutMs)` (spawnSync `timeout`, throws `<cmd> gave no answer within <n> s`), test at `registry-consistency.test.ts:83-91` | **adapt**: move both, unchanged, into a leaf module (`scripts/npm-command.ts`); `cwd` becomes optional |
| `npm view … --json`, E404 → absent | `release-plan.ts:279-296` `npmViewJson` + `publishedVersions`; `get-sdk-publish-version.ts:105-121` `getPublishedVersions` (async copy of `publishedVersions`) | **adapt**: one bounded `npmViewJson` + `publishedVersions` in `get-sdk-publish-version.ts`, which `release-plan.ts` already imports |
| Plain `npm view <spec> <field>` | `sdk-release-verification.ts:46-57` `npmView` | **adapt**: body becomes the leaf `run` |
| Fetch deadline | `packages/presto/scripts/resolve-updater-baseline.ts:46,168` `AbortSignal.timeout(FEED_TIMEOUT_MS)`; `download-bb.ts:158` | **reuse the idiom**; no shared fetch helper exists (searched `AbortSignal` in `scripts/`, `packages/*/scripts`) |
| Fetch-timeout test | none (searched `Bun.serve` in `scripts/*.test.ts`) | **build new**: a stalled loopback `Bun.serve`; Bun 1.4.2 aborts both a stalled header and a stalled body with `TimeoutError` (probed) |
| Spawn-timeout test | `registry-consistency.test.ts:83-91` (`sleep 30`, 200 ms) | **reuse as-is** (moves with `run`) |
| Fresh registry install in `verify` | `verify-sdk-package-signatures.ts` → `auditSignatures` (`registry-consistency.ts:103-130`): fresh temp dir, `npm install --ignore-scripts --no-audit --no-fund --loglevel=error`, installed version must equal the requested one, 180 s deadline | **reuse**: the shell step `_publish-npm.yml:340-352` repeats it seconds later with the same flags |

## Constraints that shape the design

- `sdk-release-contract.test.ts:278-288`: `release-plan.ts`, `promote-sdk-latest.ts` and `published-playground.ts` must not contain the string `registry-consistency`. A consumer cannot import `run` from there.
- `sdk-release-verification.ts` importing `registry-consistency.ts` would be an import cycle (`registry-consistency.ts:8-12` imports it).
- `sdk-release-contract.test.ts:240-257` scans every module the credentialed `publish` job reaches (`registry-consistency.ts`, `sdk-release-verification.ts`, `npm-packages.ts`) with `codeViolations` (lines 72-96). Its `run(` call check applies only in the file that defines `function run(command: string[]`. Moving `run` to a leaf would leave the callers' `run([...])` calls unchecked unless the check becomes graph-wide. `view` accepts identifier arguments only, so `--json` cannot enter that graph.
- `sdk-release-contract.test.ts:224-229`: the `verify` job must contain `npm install --ignore-scripts` (pins the step this plan removes).
- `sdk-release-contract.test.ts:293-299`: regex pins promote's `verifySdkPackageSignatures(version, pkg, undefined, allowedWorkflows, rollback ? …)` call.
- `docs/RELEASE_RUNBOOK.md:617` already tells the operator that a `Verify <package>` failure with `gave no answer within` means "re-run within 30 days".

## Release-path registry calls (inventory)

Bounded today: `auditSignatures`' `npm install` and `npm audit signatures`.

Unbounded, named by #132: `release-plan.ts:279` `npmViewJson`; `sdk-release-verification.ts:46` `npmView` and `:140` `fetch(url)`; `published-playground.ts:114` `run` (`npm pack`, `tar`); `_publish-npm.yml:346` verify-job `npm install`.

Unbounded, not named by #132:
- `get-sdk-publish-version.ts:106` `getPublishedVersions`: pack job, twin of `publishedVersions`.
- Shell steps in `_publish-npm.yml`: pack-job `npm view` preflight (L120); publish-job `npm publish` (L287) and its `npm view` loop (L292-293); consumer-test `sdk-tarball-consumer.sh` (`npm install` ×2, `npx tsc`).
- `bun install --frozen-lockfile` in every job; `dependency-audit.ts` `bun audit`; `install-legacy-sdk.ts` (e2e, legacy gate only); Sigstore TUF refresh inside `@sigstore/tuf`; `workers-build.ts` `bun install`.
- `promote-sdk-latest.ts` (`npm view`, `npm dist-tag add`, the read-back `fetch`): local and interactive, never in CI (`docs/RELEASE_RUNBOOK.md:474`; no workflow references it).
- Not registry, also unbounded: `release-plan.ts` `git ls-remote` and `gh release view`.

Job ceilings: plan 5 min; pack 15; consumer-test 15; publish 20; verify 10; release-records 10; Cloudflare/`app.yml` published-build 15.

## #133 facts

- `sdk-release-verification.ts:11` `LEGACY_SDK_RELEASE_WORKFLOW = ".github/workflows/publish-testnet.yml"`; used only by `promote-sdk-latest.ts:11,182` and `sdk-release-verification.test.ts:4,85-93`.
- `provenance-identity.ts:28-37` `RELEASE_IDENTITY.buildConfig = SDK_RELEASE_WORKFLOW` for every signer; `bindToSigningIdentity` (`:175-191`) requires the statement's workflow to equal it. A `publish-testnet.yml` statement fails twice: the policy's build-config OID and the binding.
- `archive/presto-verifier-identity/plan.md:136`: `publish-testnet.yml` signed no publication on npm for any of the four packages.
- `allowedWorkflows` is threaded through `verifyProvenanceStatement`, `fetchAndVerifySdkProvenance`, `verifyRegistryConsistency`, `verifySdkPackageSignatures` and `SignedProvenanceOptions`; promote's rollback is the only production caller that passes a non-default value.
- Runbook mention: `docs/RELEASE_RUNBOOK.md:521`. No README, `SKILL.md` or `llms.txt` mentions it. `audit/security/2026-07-*` reports mention it as frozen history.
- `.github/workflows/publish-testnet.yml` and `_publish-sdk.yml` no longer exist; `ROLLBACK_SIGNERS` (`provenance-identity.ts:22-25`) keeps `_publish-sdk.yml` for presto 5.2.0 and stays (out of scope).

## Open work

`gh issue list --state open`: no collision. #167 (dependency audit) belongs to the `deps-1` lane. No closed `known-limit` issue matches "npm timeout" or "rollback provenance".
