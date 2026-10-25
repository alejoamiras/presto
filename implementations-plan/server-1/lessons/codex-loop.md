# Codex fix loop (arc a1)

| Round | Reviewer | Finding | Disposition |
|---|---|---|---|
| 1 | Codex `gpt-6.1-sol`, high | Low: a custom-bb `Unavailable` returned before `bb_failure`'s log line, dropping a diagnostic the chonk route used to log | fixed: the log line comes first |
| 1 | Codex | Low: the `install_verified` and `for_status` doc comments restate their code | fixed: both deleted |
| 2 | Codex, resumed | verify round 1 and the merge of origin/main | clean |

## Same-family review (Opus, alongside round 1)

| Finding | Disposition |
|---|---|
| A custom `Unavailable` on `/prove` is no longer logged | already fixed in 1fab632 (Codex round 1, same finding) |
| "could not unpack" also covers install failures (eviction race, codesign) | rejected: the lane brief fixes the four cause phrases, "could not unpack" among them; the variant's doc says "extracted and installed" |
| The gated test's comment holds a run instruction whose reason does not follow | fixed: trimmed to the invariant |
| The workspace test's `prove-tmp` file trick needs a comment | fixed: one line, incl. why Windows proves only the fixed message |
| Nits: `expected_digest` doc repeats the fail-closed paragraph; `for_status` doc restates its body | fixed (the second in 1fab632) |
