# Post-implementation review

## Round 1 (2026-10-25)

- **Codex** (sol, high, session `01a17104`): findings 2.
  1. case_24 passed a list check that waits 300 ms, then blocks 2 s: 20 checks were already in by
     then. Demonstrated with that mutant (3/3 passed). Fix: the 1 s sleep must also end before
     `FEED_TIMEOUT`, since on one thread the block holds it up too. After the fix, this mutant and
     the phase 2 mutant both fail 3/3 ("a 1 s sleep took 2.45 s" / "2.16 s"); healthy 20/20; the
     feed suite 9 passed. KL1's text is updated.
  2. The `fireProveRequest` doc said "the 60s server timeout"; it is the popup's decision deadline,
     and a queued request waits up to 660 s. Fixed.
