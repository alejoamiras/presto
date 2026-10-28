# release-2 arc 1 review

## Implementation notes

- `bun run test` was red once: `UPDATER_SMOKE_SCRIPTS[1].split` is TS2532 under the scripts
  tsconfig (indexed access may be undefined). The test now reads the Linux script by name.
- Biome flags `'${…}'` in a plain string (`noTemplateCurlyInString`); an escaped template
  (`` `\${…}` ``) passes without a suppression, as `release-contract.test.ts` already does.
- The contract test fails on both mutations: the operand removed, and the `mkdir` moved below the
  modes `source`.

## Codex round 1, 2026-10-28

gpt-6.1-sol at high, read-only, fresh session, over `git diff db9dbbd..HEAD` without the plan
folder. Verdict: clean, no findings. It checked the `mkdir` precedes `source` and every launch in
all five modes of both lanes, the expansion under `set -euo pipefail` (unset, empty and absolute
`XDG_CACHE_HOME`), that the swap's download, checksum, relaunch and refusal checks are unchanged,
and that exactly three `npm:<id>:undici` keys cover the five BLOCKED findings.

## Same-family review (Opus, general-purpose), alongside round 1

Verdict: approve; no correctness or security bug. Checked all ten `launch_app` call sites run after
the `mkdir`, neither caller overrides `HOME`, `XDG_*` or `TMPDIR`, an unwritable `~/.cache` turns
the smoke red (not green), and the three entries are byte-identical to GHSA-xjj6's.

- Low, accepted: the test sat in the describe named for the 2026-08-17 CDN incident. Moved to its
  own `describe("Linux updater smoke harness")`.
- Nit, accepted: name `tauri-plugin-updater` in the script comment, so a plugin change is greppable.
- Low, no change: an allowlist key has no version or source scope, so a new vulnerable undici copy
  added before 2026-11-30 would also be ACCEPTED. That is the schema's documented property
  (`docs/RELEASE_RUNBOOK.md`: an exception covers every copy of its package), shared by the
  existing entry; changing the schema is out of scope.
- Caveat, recorded: the dispatch-only ephemeral lane builds three bundles on the runner first, and
  the Tauri bundler caches its tools under the XDG cache dir, so that lane probably has `~/.cache`
  already and cannot reproduce the failure. Only the release lane, with a fresh home, proves the
  fix (plausible, unverified: the bundler's source is not in the local registry).
