# Arc 2 review (Codex, GPT-6 Astra, `high`)

Session `01a0e986-7775-7c53-a7f0-1b329af12564`. The brief covered:
- the arc diff from `aebe62a` (excluding `implementations-plan/`);
- plan phases 2 and 3 and the arc map;
- an adversarial ask covering versions, order, promotion, the reader, shell and YAML failure
  propagation, the consumer split and CI routing;
- the two verbatim rules.

## Round 1: "findings", 4 findings, all verified

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Med | `EXACT_SEMVER` accepts strings npm reads as tags (`9007199254740993.0.0`, 258 characters), so an "exact" pin could be a mutable tag | accepted and confirmed with the installed npm's `npm-package-arg`. `isExactSemver` adds a 256-character bound and requires safe-integer numeric identifiers; `isValidVersion`, `exact-pin.ts` and `prepare-sdk-publish.ts` use it. This predates the arc, but the arc's gates run through it |
| 2 | Low | `aztecDerivedOrder` / `raisePin` misorder huge numeric identifiers (`Bun.semver.order` reverses 31×`1` vs 30×`9`; npm's semver does not) | accepted and confirmed. The comparator refuses what `isExactSemver` refuses; regression tests cover the comparator and `raisePin` |
| 3 | Low | the promotion comment claimed the testnet check keeps prereleases off `latest`, which is false because prereleases publish to `testnet` | accepted: comment rewritten |
| 4 | Low | `exact-pin.ts` doc cited "the F13 deps-vs-peers decision", a review reference | accepted: removed, rationale kept |

Fix commit: `19c8f63`. Gates: `bun run test` exit 0 (scripts 242), `lint` exit 0, `lint:actions` exit 0.

## Round 2: "findings", 1 LOW

The `isExactSemver` doc said npm reads every refused string as a tag. An unsafe-integer prerelease
number is still a version to npm; it is refused for ordering. Accepted; doc rewritten in `6d66da9`.

Codex's own checks this round:
- 40 focused tests passed;
- 72 boundary versions matched npm's classification;
- 1,296 prerelease comparisons matched npm's semver.

## Round 3: "clean"

> Confirmed `6d66da9` fixes the remaining comment finding and changes no executable code. No
> CRITICAL, HIGH, or new material finding remains. All previously reported findings are resolved.
> Confidence: high.

The loop converged in three rounds.
