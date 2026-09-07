# Claude implementation reviews

## Arc 1 — round 1

Verdict: conditional approve.

Claude confirmed the exception and all workflow bypasses were removed, auth-probe and promote-only
semantics remained correct, unrelated credential/readiness/signing/monitoring machinery was
untouched, and failure modes remained closed. It requested:

1. A regression proving selection skips a newer wrong-key release for the greatest lower same-key
   release — adopted.
2. Exact error assertions instead of bare `toThrow()` in two rejection paths — adopted.
3. Removal of one implied workflow assertion — adopted.
4. Less repetitive runbook wording — adopted.
5. A comment describing the empty-key sentinel invariant rather than control flow — adopted.
6. Minor ordering and whitespace cleanup — adopted.

Session: `e45d368e-08bf-4a9f-b9b6-45dea20941c6`.

## Arc 1 — round 2

Verdict: approve.

Claude verified that the new wrong-key ordering case distinguishes the intended selector, the exact
error assertions reject unrelated failures, runbook repetition is gone, the sentinel comment is
useful, and no workflow/security behavior changed. No material findings remained.

## Arc 2 — round 1

Verdict: conditional approve.

Claude confirmed the dependency selection was broad, compatibility work was readable, all three
lockfiles were covered, Aztec exemptions were removed, and the policy used registry/release
timestamps. It requested:

1. Compare an automatically generated Aztec lockfile directly with `HEAD` because dispatch events
   have no meaningful base SHA — adopted.
2. Include nested workflows and composite Actions in the successful-result cache key — adopted.
3. Document reqwest 0.13's rustls/platform-verifier change and remove the obsolete headless OpenSSL
   installation — adopted and smoke-tested.
4. Select eligible Rust 1.98.0 instead of 1.97.0 — adopted and tested across all three crates.
5. Document that `dtolnay/rust-toolchain` has no GitHub Releases and remains unchanged; future pin
   changes fail closed rather than using commit dates — adopted.
6. Add narrow trust-boundary comments and Action/Cargo rejection tests — adopted.

Session: `60045700-6f8d-449e-a1a2-55dc57a423ca`.

## Arc 2 — round 2

Verdict: approve.

Claude verified all eight round-one findings were closed. It found no remaining policy, security,
behavioral, metric-compression, or unnecessary-indirection problem. Two low-severity documentation
corrections were adopted after approval: explicitly name the AWS-LC/CMake build dependency and fix
the core crate's stale claim that all rustls code is excluded from the headless graph.
