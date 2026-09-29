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

## Round 2: 1 MEDIUM, 1 LOW, no CRITICAL or HIGH

Codex accepted the rejection of the partial-install requirement ("merely missing a package does not
establish an unreviewed-code execution path"). It confirmed the budget holds: an invalid later
amount leaves zero mints, and the counters advance before the first `await`.

| # | Sev | Finding | Verdict | Change |
|---|---|---|---|---|
| 1 | MEDIUM | The `@aztec/viem` exception skipped version validation, so a second or versionless viem passed. | Accepted | Every name is held to its reviewed version: the release, or `VIEM_VERSION = "2.38.3"` for the fork (the playground's alias pins the same). A missing version reads as `"undefined"` and fails. |
| 2 | LOW | The `fpc-funding.ts` header still said every check precedes the key load; the mint plan is checked after the load and before signing. | Accepted | The header now says so. |

Gates: `bun run test` 0, `bun run lint` 0, `bun run lint:actions` 0. The scratch v6 tree still
matches (62 names).

## Round 3: converged

Codex, on the resumed session: "no new material findings. **No CRITICAL or HIGH finding remains.**"
It ran 13 targeted checks of the version guard (every scope, missing versions, nested viem
mismatches) and took a last pass over the whole arc: installer, legacy gate, pins, token flow,
fixture headers, licence rules. The `published`-filter intersection is still empty.

# Cross-arc pass: fresh Codex session over `4cdc2f2..HEAD`

## Round 1: 1 MEDIUM, 4 LOW, no CRITICAL or HIGH

Checked and fine, per Codex:
- manifest reads go through `aztec-manifest.ts` (the shipped SDK's local read is the packaging
  exception);
- bb.js, the pins, the Noir peer, `TESTED_BB_VERSION` and the fixtures agree on 6.0.0-rc.1;
- the in-memory R2 plan gives core 1.2.1, noir 2.0.0-rc.1, presto 6.0.0-rc.1, with banners reused,
  all on `testnet`;
- promotion refuses prereleases;
- noir publishing needs its gates;
- the `published` intersection is empty.

| # | Sev | Finding | Verdict | Change |
|---|---|---|---|---|
| 1 | MEDIUM | `validateVersion` in `update-aztec-version.ts` is weaker than arc 2's `isExactSemver`: it accepts `9007199254740993.0.0`, which npm reads as a tag. | Accepted | `validateVersion` also requires `isExactSemver`. The forced-version workflow runs the updater, so it gets the same check. A test case covers it. The validator predates the arcs; this is a one-line fix in a file arc 3 touches. |
| 2 | LOW | The sdk-noir README says the default bb version is `5.2.0`. | Accepted | The literal is gone; the default is `TESTED_BB_VERSION`, the bb.js release that version pins. |
| 3 | LOW | The `FOUNDATION_PACKAGES` comment calls the three names the only foundation release artifacts. | Accepted, deferred | `scripts/aztec-manifest.ts` is in `app.yml`'s `published` filter, which arc 3 must not touch. The edit was reverted and added to the close-out follow-ups in `plan.md`. |
| 4 | LOW | The plan's change map and D18 still say bb.js's licence comes from barretenberg. | Accepted | Both now record the deviation (aztec-packages' `barretenberg/LICENSE`). |
| 5 | LOW | `setup-aztec` comments: 16 lines of incident history, and an obsolete "repair" description beside a diagnose-only step. | Accepted | Cut to the invariants: an unlocked install needs the quarantine, snappy's wasm error is a red herring, and the step diagnoses only (a fix is a reviewed Aztec bump). The runtime error no longer asserts that `latest` is ahead of the pin. |

Gates: `bun run test` 0, `bun run lint` 0, `bun run lint:actions` 0. The `published` intersection
is empty.

## Round 2: converged

Codex, resumed session: "no new material findings. **No CRITICAL or HIGH finding remains.**" It
judged the deferral of the `FOUNDATION_PACKAGES` comment acceptable: the change is comment-only and
tracked, and touching `aztec-manifest.ts` would trigger the published-playground gate during the
intended v5/v6 mismatch. Its checks: 23 tests pass, and a malformed version fails the updater CLI.

# 7b delta (`940f6b2^..14167b3`), arc 3 session resumed

## Round 1: 1 HIGH, 1 MEDIUM

| # | Severity | Finding | Disposition | Fix |
|---|---|---|---|---|
| 1 | HIGH | The forwarder's echo scrub matched raw text only. A JSON body could spell the key with `\u` escapes, and `Content-Type` parameters and `x-aztec-*` values passed through unchecked. | Accepted | The pattern is case-insensitive and runs on the text with `\uXXXX` and `\/` decoded. Only an `application/json` answer passes, under a fixed `Content-Type`. An `x-aztec-*` header carrying a fragment is dropped. |
| 2 | MEDIUM | The upstream answer was buffered without a bound, so a small batch could exhaust the isolate's 128 MiB. | Accepted | The answer is read with a 16 MiB cap; overflow cancels the stream and returns a fixed 502. |

Codex's corrections:
- The Aztec client rejects an oversized single request instead of sending it alone. This is
  accepted; the forwarder's 8 MiB request cap is unaffected.
- It gave the fast-uri advisories a publication date of September 2. This is disputed:
  `gh api /advisories/<id>` gives `published_at` 2026-09-28 for both, and the global database is
  what `bun audit` reads. `phase-4.md` now says "in the GitHub Advisory Database since".

Gates: the forwarder has 24 tests. A mutation run removed each of 10 guards (the request and answer
caps, the method and origin allowlists, the JSON-only answer, the fixed content type, the scrub of
bodies and headers, and the scrub's case and escape handling), and each removal failed a test. The
first run missed the JSON-only guard: its fixture's upstream status was 502 already, so the fixture
now uses a 200 HTML page. The hardened Worker is redeployed through a keyed run before the next
round.
