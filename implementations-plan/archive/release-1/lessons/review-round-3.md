# Codex fix round 3 (resumed; the hard stop)

This round verified the same-family fixes in `c315dce`. Verdict: 1 low, test-only finding
(demonstrated).

- The finding: `run(["npm","view",a]?.map(...))`, or a comment between `]` and `.concat`, still
  passed. The `(?!\s*[.[])` lookahead used a denylist.
- The fix: both regexes now require the literal array to be a whole argument, `(?=\s*[,)])`. Two
  refusal cases were added. The real publish-graph scan still finds no violations, which is the
  success control.
- No fourth Codex round, by the hard stop. The fix changes two characters in two test regexes. The
  contract suite passes (51/51), and so do `bun run test` (exit 0) and `bun run lint:actions`
  (exit 0).

Lesson: a syntactic guard that accepts a literal should allowlist what may follow it (`,` or `)`),
not denylist continuations. Each denylist entry invites the next bypass.
