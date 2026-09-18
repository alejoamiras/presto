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

Commit 8647117. `sdk.yml` on it: `package=presto` run 34190048536 green (SDK E2E included),
`package=presto-core` run 34190050406 green — both ran concurrently, so the concurrency fix holds.

## Round 2 — 2026-09-08 (`response-1.md`)

"Not ready to approve": two of the round-1 fixes were bypassable. Both verified and fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `prove` validated `request.path` and then re-read the caller's property after the async probe and the `onPhase` callbacks; a handler mutating the object (or a getter) redirected the witness to port 30001 after the validation passed | The request is copied into a frozen snapshot at the top of `prove` (path, content type, body, scheme, cap) and every later read is from the snapshot; regression with a mutating `onPhase` handler and with a getter that changes its answer |
| 2 | Medium | `assert-local-dependency` compared basenames, and `--with` accepted the same name twice (the last one silently won), so a same-named tarball elsewhere passed the check | Content identity instead of paths: the hidden lockfile (`node_modules/.package-lock.json`) records the SHA-512 of the archive each copy was installed from, so the check is "exactly one `node_modules/<name>` entry at any depth, with the supplied tarball's integrity" (`npm ls --json` could not be used: it redacts ID-looking path segments as `***`); `parseLocalTarballs` rejects a duplicate name; tests for both |
| 3 | Nit | One review-history sentence left in `readJsonBounded`'s doc | Rewritten to the invariant |

The legacy installer passed its adversarial look (archive hashed against the committed SHA-512
before extraction, identity + Aztec-version checks, `dist` entry only, dependencies confined to the
two workspace graphs).

Commit 8dc7ac0.

## Round 3 — 2026-09-08 (`response-2.md`) — converged

> **Approve arc 3 at `8dc7ac0`. No new material findings. Confidence: high.**

Re-verified: the snapshot covers all five request properties and every later read is from it (an
extra mutation probe kept URL, headers, payload, and cap); the integrity binding hashes the supplied
archive and requires exactly one lockfile entry; duplicate `--with` names fail before installation.
One qualification, accepted as stated: the hidden lockfile is installation metadata under the trust
the consumer already places in executed dependency code (lifecycle scripts), not a tamper-proof
boundary — the check detects resolution drift under that model.

Three rounds. `sdk.yml` on 8dc7ac0: `package=presto` run 34190787712, `package=presto-core` run
34190789910 (results recorded in `phase-12.md`).
