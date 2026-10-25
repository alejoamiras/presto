# ci-1 phase 0: planning log

- 2026-10-25 recon: #169 head 49110f1 rebased onto f8a9f3b; failed jobs read with
  `gh run view --job <id> --log-failed` — one test (`verified-sites-workflows.test.ts:103`) in three
  jobs, plus the known happy-dom audit block.
- 2026-10-25 action review: separating the action's own code from bundled dependencies in an esbuild
  bundle works by its `// <module path>` markers; keeping only `lib/*.js`, `main.js` and `post.js`
  left a diff of licence comments only. Set diffs of URL literals, `"METHOD /route"` strings,
  `process.env` reads and `require()`s cover the rest without reading 2,400 changed lines.
- 2026-10-25 cherry-pick of 49110f1 rejected: Dependabot's body fails commitlint's
  `body-max-line-length` (checked with `bunx --no-install commitlint`).
- 2026-10-25 Codex R1 (plan audit, gpt-6.1-sol high, session 01a17538): conditional approve. The
  marker extraction skipped the bundle preamble (`__commonJS` changed) and literal-set diffs cannot
  see a changed URL branch; `grep '^[-+] '` patch equality passed an extra edit. Replaced with an
  expected-tree check: read-tree the merge base into a temp index, `git apply --cached` the PR's
  patch, `git diff --cached --exit-code HEAD`.
- 2026-10-25 final fresh Codex pass (gpt-6.1-sol high, session 01a17540): R1 conditional approve —
  inline-code commands wrapped across source lines break when copied raw (`bash -n` fails on a
  leading `&&`), the resume step needed its exact call, `gh pr checks --watch` needed a bound. All
  fixed; R2 approve.
