---
plan: presto-banners-publish
tier: light (owner-lightened: self-written plan, one codex argument, codex fix loop after implementation)
driver: claude-code
code_review: off
eli5_mode: skipped (owner)
status: COMPLETED 2026-09-09 — PRs #42 (banners) and #43 (sdk:promote --yes/--otp=) merged; @alejoamiras/presto-banners@1.0.0 published with provenance (run 34365289824), promoted to latest, bootstrap deprecated; ribbon live on playground.presto.build
worktree: .claude/worktrees/presto-banners-publish (branch worktree-presto-banners-publish, off main @ bc25102)
---

# Publish `@alejoamiras/presto-banners` and dogfood it in the playground

## Goal

`packages/banners` (`<presto-banner>`, merged in #27, version `0.0.0`, never published) becomes the
fourth entry of the closed npm descriptor and ships through the same OIDC + provenance pipeline as
core / noir / presto: PR gate on the packed artifact, release job, signed verification, promote-to-
latest by the owner. The playground replaces its hand-rolled install strip with the ribbon so the
component is exercised by a real integrator from day one.

Done when: `@alejoamiras/presto-banners@1.0.0` is on npm with verified provenance under `testnet`,
promoted to `latest` by the owner; `banners.yml` is a thin caller of `_ts-package-ci.yml`;
playground.presto.build renders `<presto-banner variant="ribbon">` for the install pitch.

## Recon (reuse map)

| Capability | Existing code | Verdict |
|---|---|---|
| Package registry, version modes, tags, provenance subject | `scripts/npm-packages.ts` (`NPM_PACKAGES`, `manifest` mode) | reuse: one descriptor entry |
| PR gate for a publishable TS package | `_ts-package-ci.yml` (lint, `test:lint`, `test:unit`, `test:scripts`, packed-tarball consumer) via `sdk-core.yml` caller shape | reuse: `banners.yml` becomes the caller |
| Publish manifest rewrite | `scripts/prepare-sdk-publish.ts` — `PUBLISHED_EXPORTS` hardcodes one `"."` entry | **adapt**: derive the dist map from the source `exports` (banners has `.` + `./register`) |
| Tarball consumer host | `scripts/sdk-tarball-consumer.sh` + `scripts/tarball-consumer/<profile>/{index.ts,runtime-check.mjs,tsconfig.json}` | reuse: new `presto-banners` profile; no `@aztec/stdlib` pin ⇒ plain host, no singleton gate |
| Release plan / publish / verify / promote | `release-plan.ts` (`all` sweeps descriptor keys in dependency order; outputs `publish_<key>`), `_publish-npm.yml` (dist-tag default `testnet`), `sdk-release-verification.ts`, `promote-sdk-latest.ts` — all descriptor-driven | reuse: one `publish-banners` job + plan outputs + dispatch choice |
| Deploy of the playground on published artifacts | `published-playground.ts` + `packaged-e2e-swap-sdk.sh` — special-cased to sdk/core/noir | **leave alone** (decision D-3) |
| Install pitch in the playground | `index.html` `#accel-banner` + `main.ts` `showInstall` + `accel-banner-dismissed` localStorage; mocked e2e asserts `#accel-banner` (3 places), `test-helpers.ts` stub | **replace** with `<presto-banner>` (phase 3) |
| Trusted publisher bootstrap | RELEASE_RUNBOOK "npm-publish environment" + cross-arc-review lesson (owner bootstrapped core/noir `0.0.0-bootstrap.0` under `bootstrap`, then registered trust) | reuse the procedure (owner) |

Searched: `grep -rn presto-core scripts .github` for every package-specific touchpoint — the only
non-descriptor references are the contract tests (`sdk-release-contract.test.ts` job lists,
`ts-package-ci.test.ts` caller table), the workflow choice lists (`release-sdk.yml`, `sdk.yml`),
and `published-playground.ts`.

## Decisions (attack these)

- **D-1 Version `1.0.0`**, `manifest` mode (like core/noir). The kit is stable and documented; `0.x`
  would signal instability the SDK peers do not have.
- **D-2 `exports` rewrite becomes structural.** `preparePublishManifest` maps every source entry
  `./src/<name>.ts` → `{ types: ./dist/<name>.d.ts, default: ./dist/<name>.js }` (a string
  `exports` is `{ ".": … }`), sets `main`/`types` from `"."`, and fails closed on any entry outside
  that shape. Core/noir/presto keep today's `exports`/`main`/`types` (test pins it). It also
  **drops `devDependencies`** from every published manifest — the one visible change for the
  existing packages: banners' `@alejoamiras/presto: workspace:*` dev dependency would otherwise
  ship as a literal `workspace:` range (npm ignores it, but no published manifest of ours should
  carry one).
- **D-3 The playground consumes banners from the workspace**, not the published tarball. The
  deploy's swap path exists so the deployed playground proves the *published SDK proves*; the
  banners artifact is proven by the tarball-consumer job (typecheck + runtime import of the packed
  dist, both entries). Extending `published-playground.ts` / the swap script / `_e2e-packaged.yml`
  for a UI component is plumbing with no new evidence. Revisit if the playground ever needs to pin
  a banners release independently of its source.
- **D-4 Dist-tag `testnet`, promote to `latest` with the owner's OTP** — identical to the other
  packages (`bun run sdk:promote -- --package presto-banners 1.0.0`). The tag name is a misnomer for
  a network-agnostic kit but the promote step, the verifier and the runbook all key on it; a
  per-package tag is a separate change.
- **D-5 `publish-banners` waits on `e2e` + `dependency-audit` like every publish job** (the contract
  test asserts the `needs:` prefix) and `deploy-app` waits on it with the same success-or-unselected
  clause as core/noir/presto, so "a selected publication that failed blocks the deploy" stays one
  rule. Banners has no workspace dependencies (dev-only), so it needs no `noir-gates`-style gate and
  no ordering against core.
- **D-6 The consumer profile's runtime check imports both entries in Node**: the barrel is DOM-safe
  by design (`Base` falls back to `class {}`), `register` is a no-op without `customElements`
  (returns `false`); the check asserts `definePrestoBanner() === false` and one `stateFromStatus`
  mapping. `index.ts` typechecks both subpaths against the packed `types`.
- **D-7 Owner bootstraps the name first** (npm requires the package to exist before a trusted
  publisher can be attached): `npm publish` of `0.0.0-bootstrap.0` under `--tag bootstrap` from a
  2FA login, register the trusted publisher (`release-sdk.yml`, environment `npm-publish`,
  **direct `npm publish` enabled** — a staged-only trust cannot run `_publish-npm.yml`), deprecate
  the bootstrap. The plan's `decide()` treats the bootstrap as just another published
  version; `1.0.0` publishes normally.
- **D-8 The ribbon is the playground's install pitch only.** The playground owns richer recovery
  UI for the warn states (permission help, secure-connection help with retry and HTTP consent), so
  feeding it the full status would render a second fix-it strip beside them. `main.ts` drives
  `state` from its view model: `offline` when `showInstall`, `available` when connected (the morph
  plays only if the ribbon was showing), otherwise unset (hidden). Dismissals move to the element's
  own persistence. `fonts="none"`: the page already links the same faces.

## Phases

**Phase 1 — Descriptor, manifest rewrite, consumer profile.**
`npm-packages.ts` entry `presto-banners` (`packages/banners`, `manifest`, profile `presto-banners`);
`packages/banners/package.json` → `1.0.0`, add `test:lint` (`tsc --noEmit`; root `test:typecheck`
switches to it), keep `build`; `prepare-sdk-publish.ts` per D-2 with tests (three existing shapes
unchanged, two-entry map, malformed entry rejected, devDependencies dropped);
`scripts/tarball-consumer/presto-banners/{index.ts,runtime-check.mjs,tsconfig.json}` (D-6).
Gate: `bun test scripts/prepare-sdk-publish.test.ts scripts/npm-packages.test.ts scripts/release-plan.test.ts`
(the workflow contract tests go red until Phase 2 adds the choices), then locally
`bun scripts/pack-candidate.ts --package presto-banners --version 0.0.1-tarball-ci --out <tmp>` and
`bash scripts/sdk-tarball-consumer.sh <tarball> presto-banners`.

**Phase 2 — CI and release wiring.**
`banners.yml` → thin caller (`package: presto-banners`; filters `packages/banners/**`,
`packages/sdk-core/src/lib/types.ts`, `scripts/**`, `.github/workflows/_ts-package-ci.yml`, the
shared config files); `sdk.yml` dispatch choice; `release-sdk.yml`: `packages` choice, three plan
outputs, `publish-banners` job (D-5), `deploy-app` needs/if; contract tests: `publishJobs` lists,
`ts-package-ci.test.ts` caller table + `sdkCore`-style negative assertions.
Gate: `bun run lint:actions`, `bun run test:scripts`; dispatch `sdk.yml` with
`package=presto-banners` on the branch (the pre-registration path) and require it green.

**Phase 3 — Playground dogfood.**
`packages/playground/package.json` adds `@alejoamiras/presto-banners: workspace:*`; `main.ts`
imports `@alejoamiras/presto-banners/register` and sets `state` per D-8 from the controller's
render; `index.html` replaces the `#accel-banner` div with
`<presto-banner id="accel-banner" variant="ribbon" fonts="none">`; the old dismiss button and
`accel-banner-dismissed` key go; `test-helpers.ts` follows; the five mocked assertions and
`lna.real.spec.ts` keep `#accel-banner` (an unset ribbon renders nothing, so `toBeHidden` holds);
both `app.yml` filters (`relevant`, `lna_relevant`) add `packages/banners/**`.
Gate: `bun run --cwd packages/playground typecheck && bun run --cwd packages/playground test:unit && bun run --cwd packages/playground test:e2e`.

**Phase 4 — Docs, review, delivery.**
CLAUDE.md (banners bullet: published; CI bullet: `banners.yml` caller, release `packages` list),
RELEASE_RUNBOOK trusted-publisher list, banners README (npm install; drop the "publishing is a
follow-up" paragraph), `implementations-plan/index.md`, lessons. Codex fix loop on the full diff
(`/codex high`, until clean, hard stop at 3). One PR; `gh pr checks` green; merge.

## Owner steps (in order, after merge)

1. Bootstrap + trust (D-7): from `packages/banners`,
   `npm login` (2FA) → `npm publish --tag bootstrap --access public` of a manifest set to
   `0.0.0-bootstrap.0` (do it from a scratch copy so the repo stays at `1.0.0`), register the
   trusted publisher (`alejoamiras/presto`, `release-sdk.yml`, environment `npm-publish`,
   allowed action: direct `npm publish`), then
   `npm deprecate @alejoamiras/presto-banners@0.0.0-bootstrap.0 "bootstrap"`.
2. `gh workflow run release-sdk.yml --ref main -f mode=sdk-only -f packages=presto-banners -f dry_run=true`, then without `dry_run`.
3. `bun run sdk:promote -- --package presto-banners 1.0.0` (OTP).
4. `gh workflow run release-sdk.yml --ref main -f mode=playground-only` to deploy the ribbon.

## Security & adversarial considerations

- Publish credentials: OIDC only, delegated at the one new `publish-banners` call edge
  (`id-token: write` count test updated to 4). No token, no new secret, no new environment.
- The consumer host installs with lifecycle scripts off; the packed dist is what gets typechecked
  and loaded; the profile cannot swap the candidate (existing `host-manifest.ts` guard).
- The element sanitises `href` (http(s) only) and renders in Shadow DOM; the playground passes no
  attacker-controlled attribute. Fonts: the ribbon links Google Fonts into `<head>` unless
  `fonts="none"`; under the playground's COEP `credentialless` that is a plain cross-origin fetch.
- Supply chain: no new runtime dependency anywhere (banners is zero-dependency); `bun.lock` changes
  only for the new workspace edge.

## Post-implementation

Codex fix loop (`/codex high`, GPT-6 Astra) on the complete diff before the PR opens; triage claims
against the repo, apply, log rounds in `lessons/`. No `/code-review`. Commits carry the session
trailers; PR body ends with the Claude Code trailer.
