
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
