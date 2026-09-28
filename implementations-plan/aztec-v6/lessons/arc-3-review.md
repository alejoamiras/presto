# Arc 3 review: Codex fix loop

Codex GPT-6 Astra at `high`, read-only. It was briefed with the arc diff (`4ecb68c..HEAD`, without
`implementations-plan/` and `fixtures/`), `plan.md`, the decision ledger, the arc map, an
adversarial and security ask, and the two verbatim rules.

## Round 1: 3 MEDIUM, 3 LOW, no CRITICAL or HIGH

| # | Sev | Finding | Verdict | Change |
|---|---|---|---|---|
| 1 | MEDIUM | `fundingBudget` trusts `getMintAmount()`. A 1-wei mint turns a 1-FJ bridge into 10¹⁸ signed mints, and only the first amount was checked before the bootstrap bridged. | Accepted | `fundingBudget(manager, minter, maxTotal, planned)` reads the mint size once and checks every planned amount before anything is signed. `MAX_MINTS = 20` bounds the plan and every bridge. The real handler needs 2. |
| 2 | MEDIUM | The graph check swallows disk-read errors, and the lock ∪ disk union hides packages missing from disk. | Partly accepted | Unexpected read or JSON errors now throw; only ENOENT/ENOTDIR mean "absent". Rejected: requiring every locked package on disk. A missing package makes the install fail loudly (`aztec` cannot load, and the snappy probe runs next). It cannot let an unreviewed package in, and that is this check's job. |
| 3 | MEDIUM | Exemption by name admits any version, and the check ignores versions. | Accepted | Checked on the real tree: every internal Aztec spec is exact, but the installer's root specs are `^6.0.0-rc.1`. The check now takes the release, and fails any `@aztec-labs` or `@aztec-foundation` package at another version. `@aztec/viem` is exempt (its own 2.38.3). A run against the scratch v6 tree with `6.0.0-rc.2` named all 61. |
| 4 | LOW | `readKeyFile` checks one path lookup and reads another, and follows symlinks. | Accepted | One `O_NOFOLLOW` descriptor, `fstat` (a regular file with mode 0600), read, close. The test adds a symlink (ELOOP). |
| 5 | LOW | `vite.config.ts` reads `@aztec-labs/stdlib` by name and falls back to `"unknown"`. | Accepted | `aztecVersionOf(sdkPkg)`, which throws on a missing or mixed-generation pin. The file is not in the `published` filter. The playground build is green and injects 6.0.0-rc.1. |
| 6 | LOW | Comments: `main.rs` names phases; the `action.yml` exemption comment runs ten lines of history. | Accepted | Both rewritten to the invariant. |

Gates after the fixes: `bun run test` 0, `bun run lint` 0, `bun run lint:actions` 0; playground
build 0.
