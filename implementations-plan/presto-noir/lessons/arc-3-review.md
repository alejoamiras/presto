# Arc 3 — codex fix loop

Codex session `01a07f62-8e9a-7341-a9a6-5737a0f5972e` (GPT-6 Astra, `high`, read-only), over
`git diff 431b14d..ca9a1c8` with the arc map, the adversarial ask, and the two standing rules.

## Round 1 — 2026-09-08

Verdict: one high, two mediums, one low, comment nits, one moderate-confidence suspect. All verified
and all accepted; the suspect reproduced (see #6).

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `PrestoClient.prove` appended `request.path` to the validated authority unchecked: `path: "1/prove"` after `:3000` POSTs the witness to port 30001, an endpoint the probe never saw and the generation guard cannot detect | `assertRoutePath` (plain absolute path: `/` + `[A-Za-z0-9._~/-]*`) at the top of `prove`, before any phase or request; regression over `1/prove`, `prove`, `?`, `#`, `@`, space, empty |
| 2 | Medium | `published-playground.ts` installed the published SDK on a locally rebuilt core, so the playground never ran the verified core artifact | It now fetches the SDK's exact core pin with the same provenance + signature + integrity checks as the SDK and passes that tarball as the swap script's second argument; `assertCorePin` after the swap stays |
| 3 | Medium | `sdk.yml`'s concurrency group ignored the dispatch package, so two dispatches on one ref cancelled each other (observed: the `presto-core` run was cancelled by the `presto` run) | Group suffixed with `inputs.package \|\| 'presto'`; contract test |
| 4 | Low | `pack-candidate.ts --out <relative>` created one directory and told `npm pack` (running inside the package dir) to write into another | `resolve(out)` before use |
| 5 | Nit | Review-history references left in the moved transport (+ test), the swap script, a redundant `configure` comment, a duplicated error-policy intro | All stripped; invariants kept; `errors.ts` has one intro on the class |
| 6 | Medium (suspect, reproduced) | Bootstrap mode never checked that the candidate resolved the supplied core: with a pin/tarball mismatch npm nests a registry copy under the SDK and the runtime checks pass against it | `assert-local-dependency.ts` after `npm install`: exactly one installation of each `--with` dependency in `npm ls --json --all` (deduped references carry no `resolved`), resolved from the supplied tarball; unit test with a nested registry copy |

Two qualifications taken as stated: `fromBase64` validates alphabet + padding, not canonical
trailing bits (comment corrected); a readable body of the wrong shape is now received before the
adapter rejects it (the adapter test pins the exact phase trail for both cases).

CI on `ca9a1c8`: `sdk.yml` `package=presto-core` run 34189058843 green; `package=presto` run
34188806696 green except SDK E2E, where the legacy-compatibility test lost `ms` — the historical
tarball resolved its dependencies through a symlink to the SDK's `node_modules`, and the SDK no
longer depends on `ms`. `install-legacy-sdk.ts` now builds a real `node_modules` merging the SDK's
and core's entries (scopes merged one level down); verified locally (`ms`, `@logtape/logtape`,
`@aztec/bb-prover` resolve from the extracted package).
