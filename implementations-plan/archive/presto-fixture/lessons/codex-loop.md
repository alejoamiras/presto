# Codex loop (gpt-6.1-sol, high)

## Round 1: plan and fixture (`cfe86f1..887b0c1`)

**Verdict:** "The fixture change looks correct (high confidence)."

Codex checked the following independently:
- **Pins.** It downloaded and hashed both tarballs; each matches its pin.
- **The core pin.** The SDK pins core at exactly `1.2.1`, and core has no `@alejoamiras/*`
  dependencies of its own.
- **The installer.** It hashes both publications before extracting them, and keeps the installed
  core when it links the workspace graph.
- **The workflows.** Both pass the printed entry on to the test. The test requires `transmit` and
  rejects `fallback`.

It also noted that the proof itself stays unverified until the e2e runs.

**Findings:**
- **Fixed.** The plan's trust sentence overstated what the verifier proves. It now names the claims
  that are checked: the repository, `release-sdk.yml` on `main`, and the commit.
- **Not in this plan.** Two findings are about pre-existing code outside this diff: one in the
  shared verifier, and a comment nit in `_e2e-packaged.yml`. Both are routed to the owner.

## Round 2: the wording fix (`887b0c1..a383bc5`)

**Verdict:** "Clean (high confidence): no remaining findings in the reviewed diff or committed plan
files." The loop converged in two rounds.
