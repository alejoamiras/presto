# Post-implementation — codex fix loop

Codex session `01a0def8-017c-76d1-a9d2-61c3d3cd3049` (GPT-6 Astra, `high`), over `b46898f..HEAD`.

## Round 1 — `findings`

| # | Finding | Verdict | Why / fix |
| --- | --- | --- | --- |
| 1 | [Medium] "Merge or close" the open pin PR, then re-run: closing drops that PR's versions (a presto-only re-run carries no noir) | **Adopted** (verified: presto-only selection emits no noir version) | Error message and runbook say merge; closing needs the manual fallback to carry its versions |
| 2 | [Medium] `published` filter misses `bunfig.toml`, whose isolated linker the swap script's paths depend on | **Adopted**, widened to `.bun-version` on the same reasoning | Both added to the filter and to the contract test's required list; neither is written by the Aztec updater |
| 3 | [Medium] `CLOUDFLARE_DEPLOYMENT.md` states fork exclusion as fact and omits the cutover sequence the plan assigned it | **Adopted** (the plan's Phase 4 did list "cutover order") | Fork exclusion labelled unverified; a five-step cutover section added (control, fork check with stop rule, merge, delayed token revocation) |
| 4 | [Low] File headers of `playground-pin.ts` and `workers-build.ts` narrate deployment mechanics | **Adopted** | Trimmed to usage/contract and the production-only invariant |

## Round 2 — `findings`

| # | Finding | Verdict | Why / fix |
| --- | --- | --- | --- |
| 1 | [Medium] Routing `bunfig.toml` (round-1 #2) re-creates the Aztec-bump deadlock: a bump that adds an `@aztec` transitive must edit `minimumReleaseAgeExcludes` by hand (`update-aztec-version.ts` says so; `bunfig-aztec-excludes.test.ts` enforces it) | **Adopted, simpler fix than proposed** (verified both files) | Codex proposed a content-based exemption; instead `bunfig.toml` leaves the filter and joins the contract test's must-not-route list. A linker change is rare and still fails closed on `main`. `.bun-version` stays routed (no Aztec bump edits it). Runbook notes that PRs on the production path wait out the fail-closed window too. Mutation-checked. |

Lesson: a widening accepted in a fix round must be re-checked against the plan's standing
constraints (here, "never route on a file an Aztec bump edits"), not only against the finding.

## Round 3 — `clean`

No new material findings after `b4455f1`. Loop converged in three rounds (5 findings adopted, 0
rejected; one adopted with a simpler fix than proposed).

## Live preview check — passed 2026-09-27

- Owner connected both Workers with the **default** build token (the custom one became optional
  hardening; docs updated). No production build of `main` ran on connect.
- Branch rebased onto `fe1b534` (#60 archived lna-consent; only `index.md` conflicted), pushed as
  `8d555cd`. Check runs `Workers Builds: presto-landing` and `Workers Builds: presto-playground`:
  both `success`. The check output carries only the dashboard build link, not the Preview URL (the
  URL comes as a PR comment); the URL is `<branch>-<worker>.alejo-amiras.workers.dev`.
- Landing preview: 200, `x-robots-tag: noindex`, COOP `same-origin`, no COEP. Playground preview:
  200, `noindex`, COOP + COEP `require-corp`, `crossOriginIsolated === true` in headless Chromium.
- Confirms I3 (npm ≥ 11 under `NODE_VERSION=24.20.0`: the preflight passed), I4 (`bunx wrangler
  preview --config` is accepted as the Preview command) and I8 (Worker-name check from the root).
