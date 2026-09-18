# Codex fix loop — implementation review (GPT-6 Astra, `high`, resumed session `01a08675-…`)

## Round 1 — 2026-09-09, verdict: conditional approve, "no material runtime or release blocker"

| # | Sev | Claim | Triage | Fix |
|---|---|---|---|---|
| 1 | P2 | The consumer profile's `import "…/register"` never resolves the entry's declarations: tsc emits no diagnostic for an unresolved side-effect import, so a broken `types` condition on `./register` would pass. | Correct (reproduced in reasoning; TypeScript's `noUncheckedSideEffectImports` exists for exactly this). | Named import of `definePrestoBanner` through `/register`; comment states why. |
| 2 | P3 | `SOURCE_ENTRY` accepted `./src/../x.ts`, `./src/node_modules/x.ts`, `./src/x.d.ts` and non-`./` subpath keys. | Correct; no current manifest hits it, but the contract said otherwise. | Segments are plain names; `node_modules` and subpath keys checked explicitly; six rejection cases in the test. |
| 3 | P3 | The deploy comment and the runbook said *every* playground package comes from a verified tarball; banners is bundled from the workspace (D-3). | Correct. | Both passages name the SDK trio and the banners exception. |
| 4 | P3 | README still documented `bun run typecheck`, a script Phase 1 renamed. | Correct. | `bun run test:lint`. |
| 5 | P3 | The `preparePublishManifest` doc comment listed the assignments visible below it. | Agreed. | Comment reduced to the contract (exact pins, discarded override + dev deps, preserved metadata). |

Fine per codex: existing manifests keep `main`/`types`/`exports`; dropping `devDependencies` does not
change consumer installs even though `presto`'s declarations reference `@aztec/simulator/client`
(a runtime dependency of `@aztec/bb-prover` already); the `deploy-app` expression, the
`playground-only` bypass and the output names; the playground has no poller, equal state writes do
not restart the morph; removing `.hidden` is right (the element owns `hidden`); the profile's
`lib`/`types` configuration.

## Round 2 — verdict: **approve, clean** (all five fixes verified against the repo; codex reran the 28 contract/rewrite tests and the scripts typecheck).

## Release record — 2026-09-09

- Owner bootstrapped `0.0.0-bootstrap.0` (tag `bootstrap`) and registered the trusted publisher from the
  CLI: `npm trust github @alejoamiras/presto-banners --file release-sdk.yml --repo alejoamiras/presto
  --env npm-publish --allow-publish --yes --otp=<code>` (npm 11.16; `--otp <code>` as two tokens is
  parsed as a positional — the `=` form is required). Trust id `31f14fd3-fb00-4312-9e0e-fcd93a4a0d6d`.
- `release-sdk.yml` run 34365289824 (`sdk-and-playground`, `packages=presto-banners`): plan → e2e +
  audit → pack → consume → OIDC publish → verify → deploy. Provenance commit 24bebcb.
- `bun run sdk:promote -- --package presto-banners 1.0.0 --yes --otp=<code>` (#43): uncached
  read-back verified `latest -> 1.0.0` while `npm view dist-tags` still showed the cached bootstrap.
  The bootstrap was deprecated with the same code in the same window.
