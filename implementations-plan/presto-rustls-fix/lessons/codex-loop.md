# Codex loop (gpt-6.1-sol, high)

## Round 1: plan, lock bump and provenance record

**Verdict:** "No code blocker found; the six-hour exception is defensible (moderate confidence)."
Codex read all 2,352 lines of the delta hunk by hunk. It found no unexplained source behaviour, no
weakened authentication or security default, and no newly logged secret. It independently checked:
- the archive hashes;
- crate == tag;
- the three locks moving only rustls.

It also found that #3354's approval predates its final force-push. The reviewed tree and the final
tree differ by one trailing comma.

Three documentation findings, all verified and fixed:

1. **Low, -0349 exposure.** I had written "reaches the reqwest downloads". That overstated it:
   `cargo tree -e features -i rustls` shows no `prefer-post-quantum` in any build, so X25519 is
   already the first key share. The text now says the code runs, but the downgrade needs conditions
   Presto does not meet.
2. **Low, "no dependency change".** The packaged `Cargo.lock` moves `itertools` from 0.10.5 to
   0.13.0, through `bindgen`. The text now limits the claim to the manifest and records the lock
   change.
3. **Nit, dependency inventory.** In core and server, rustls has no `ring` or `log` dependency. The
   text now states only what matters: no `brotli` or `brotli-decompressor` in any lock.
