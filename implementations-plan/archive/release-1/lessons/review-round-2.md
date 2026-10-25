# Review round 2

## Codex fix round 2 (resumed session)

Verdict: **clean**. It verified both round-1 fixes. Its checks also confirmed three cases:
- malformed error JSON fails closed;
- the other leaf-path spellings are refused;
- the success controls still pass.

## Same-family review (Opus, general-purpose, read-only; ran beside round 1)

It confirmed the timeouts, the #133 removal, the verify-step deletion, the comments, and that no
dead code was left. It independently found both round-1 defects, already fixed in `dc2d20f`, and
two new findings, both low and both test-only. Both were adopted:

1. **Chained literal arrays bypass the call check** (demonstrated).
   - Examples: `run(["npm","view",a].map(() => "bunx"))` and
     `Bun.spawnSync(["npm","view",a].concat(["exec"]))`.
   - Both passed, because the regex captured the literal and ignored what followed it.
   - Fix: the array branch of both regexes requires `(?!\s*[.[])`.
   - Two refusal cases added. The real graph modules still produce no violations.
2. **The contract test missed two easy regressions** (demonstrated by the regex).
   - `release-plan.ts` calling its local unbounded git `run(["npm", …])`.
   - `get-sdk-publish-version.ts` going back to `Bun.spawnSync(command)`.
   - Both are now refused.

Process note: while it probed spawn timeouts, the reviewer ran `pkill -f "sleep 8"`, scoped to its
own uid. That is the broad by-name cleanup the run-isolation rule forbids. It reports that the
command most likely killed only its own probe. A future reviewer brief should forbid `pkill` and
`killall` outright.

Gate after the fixes: `bun run test` exit 0.
