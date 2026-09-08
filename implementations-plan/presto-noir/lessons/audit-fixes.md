
## Step 3b — F-002 + F-005 (`fix/core-attempt-snapshot`)

The audit's fix text also suggested bumping a generation inside `demoteHttpsPin()`. Not done: the
attempt that demotes is the one that legitimately retries over validated HTTP, and bumping the
generation there would make its own final check fail. Binding the destination to the protocol that
answered the attempt's health check (`urlFor(status.protocol, path)`) closes the race on its own:
the demoted pin is never read after the check. Regression test tries eight microtask alignments of
the second proof against the first's failure; on the unfixed client one alignment returned
`kind: "native"` from the foreign HTTP listener (the witness had been posted there).
F-005: the payload copy (`Uint8Array.from`, caller-supplied iterator) now runs before the last
generation check, beside `body()` and the phase callbacks. Manifests: core and noir → 1.0.1.

### Codex loop (session `01a082c2-b260-7491-b734-657dc8ab2220`, GPT-6 Astra, high)

**Round 1** — "request changes: the race fix works, but trusting the mutable public status
introduces an HTTPS-only bypass."
- Medium (accepted): `checkStatus()` hands out the cached status object, and `prove()` now routes
  by `status.protocol`, so a caller mutating `status.protocol = "http"` under `httpsOnly: true`
  posted its witness to HTTP with no health check. Same "caller subverting its own client" persona
  as F-005, but a real policy bypass through the public API. Fix: `cacheStatus` freezes the object;
  regression test asserts the freeze and that the witness still goes to HTTPS.
- Low (accepted): the depth sweep could silently stop covering the race if promise scheduling
  changes. Codex proposed a deferred-promise single-ordering test, but B's continuation has no hook
  (cache hit resolves synchronously inside `checkStatus`); instead the sweep now asserts that at
  least one depth placed B's HTTPS POST after A's HTTP health check — the alignment where B chose
  its URL after A's demotion — so lost coverage fails loudly.
- Low (accepted): focused F-005 test (an iterable payload that calls `configure()` while being
  copied → `endpoint-changed`, nothing posted).
- Low (accepted): `bun.lock` records workspace versions; bumped to 1.0.1 by hand (`bun install`
  does not rewrite them) and validated with `--frozen-lockfile`.
- Comment (accepted): `demoteHttpsPin`'s doc claimed the caller uses its return value; it does not.
Codex confirmed no demotion generation bump is needed and found no internal sequence that yields an
HTTPS-only policy with a cached HTTP status.
