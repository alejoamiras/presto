# Final cross-arc review (Codex, gpt-6.1-sol, high, read-only)

A fresh session over the plan's four squash commits on `main` at `163e14e`: arc 0 `4f9fc19` (#130),
arc 1 `928ca7c` (#134), arc 2 `df8d527` (#135) and arc 3 `163e14e` (#137). The pass looked for seams
the per-arc loops could not see: contracts shared across arcs, end-to-end adversarial paths,
duplication, drift from the plan, and docs one arc left stale for another.

No finding in the shared contracts (feed names, schemas, verify modes, endpoint order, statuses,
smoke hosts), the cross-arc adversarial paths beyond the ledger's known limits, duplication (the
Worker and pipeline grammar copies have a drift test), or plan coverage.

## Round 1: three low findings, all verified

1. **`UPDATER_TESTING.md` lists the signing step's outputs without the candidate feeds.** It still
   named `latest.json` "for a stable release only" and only v1 smoke feeds. Fixed in the close-out:
   both production feeds and the `rc-v1` smoke twins.
2. **The Worker's fallback comment misstates the plugin** (`packages/release-feed/src/index.ts`). It
   says a body that is not a release is a hard error; in plugin 2.11.0 valid JSON that is not a
   release moves to the next endpoint, and only a non-JSON body is a hard error. Comment only.
3. **Arc 0's smoke-twin comment is stale after arc 2**
   (`packages/presto/scripts/sign-release-updater-artifacts.sh`). It says released clients accept
   smoke feeds whatever their version; channel clients refuse a v1 prerelease on both channels.
   Comment only.

Findings 2 and 3 touch code files, which the docs-only close-out does not; the director took both
as one comment-only commit in the close-out PR, with no behaviour or test change.
