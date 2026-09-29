# Arc 1 review (Codex, GPT-6 Astra, `high`)

Session `01a0e96e-20da-70e1-8c1a-4ed31bd0dd1a`. The brief covered the arc diff from `4cdc2f2` (excluding
`implementations-plan/`), plan.md phase 1, the barretenberg asset comparison, an adversarial ask and
the two verbatim rules: no CRITICAL or HIGH finding, and no new material finding.

## Round 1: "findings", 2 findings, both verified against the code

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Med | `scripts/download-bb.ts`: the digest lookup followed redirects, which Rust refuses, so a redirect could supply the digest the tarball is checked against | accepted: the lookup uses `redirect: "error"`, and the tarball fetch still follows redirects. The new test "the lookup refuses redirects" fails on the old code (`Expected: "error", Received: undefined`) |
| 2 | Low | comments carried workflow history: the plan path "Tracking" line and the `q7e3-F-08` prefix in `release_metadata.rs`, "core-extraction Phase 3b" in `copy-bb.ts`, the G2 paragraph in `download-bb.ts` | accepted: removed, or compressed to the enduring constraint |

Things it confirmed:

- no aztec-packages release URL remains;
- the Rust redirect refusal is intact;
- cache markers are unchanged, so a cached aztec-packages 5.0.1 still verifies against its own marker;
- the `copy-bb.ts` import from root scripts has no side effects;
- Windows fails closed on an unpinned version.

Fix commit: `447c2a1`.

## Round 2: "clean"

> Both findings are resolved. No new material findings or CRITICAL/HIGH issues in the full arc diff. Confidence: high.

The loop converged in two rounds.
