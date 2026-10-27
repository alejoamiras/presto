# deps-1 review rounds

## Arc 1, round 1 (2026-10-25)

- Codex gpt-6.1-sol high, session `01a170fd-ed13-7a22-88eb-d3c6c2bcb790`, diff 1298669..b43cbd5:
  **clean**. It re-ran the stub, live and contract tests itself.
- Opus diff review: **clean**, with three minor local fixes, all applied with tests. A malformed or
  `null` manifest now names its file. A non-JSON bulk answer gets its own error. The doc comment
  states its failure contract. Dot entries are skipped inside `@scope` dirs too.
- Not changed: symlinked files inside a package (needs a tampered tree, KL-2).

## Arc 1, round 2

- Codex resume on the fix diff (cfaf6a1): **clean**. The loop converged in 2 rounds.

## Arc 2, round 1 (2026-10-25)

- Codex gpt-6.1-sol high, session `01a172ed-8f77-7863-97f5-d66a4a9946c5`, diff b85134c..a8fcf05:
  **0 material**. It ran an offline `bun update` dry run (nothing to update) and a live evaluation:
  only happy-dom stays blocked. Its one documentation note was the stale arc references after the
  regroup; fixed.
- Opus diff review: **1 material**, phase 4's gate allowed a red audit, now fixed. Two minor:
  D15/D19 bookkeeping, and the `npm/undici` lock-only note. Also noted: `braces` is stale,
  queued for arc 3's close-out.

## Arc 2, round 2

- Codex resume on the fix diff (a84a4ae): **clean**. The loop converged in 2 rounds.

## Arc 3, round 1

- Codex gpt-6.1-sol high, session `01a17eab-757f-7543-a6ac-7ebcc1a0d0ab`, diff c1d1f6f..28a82f6:
  **clean**. It found one minor note, which is fixed in the issue: #187 overstated that nothing
  names wrangler's inlined versions.
- Opus diff review: **1 material**. wrangler 4.151.1's `cli.js` path comments name `zod` 4.6.5
  (95 modules) and `undici` 7.29.1 (112 modules). Both fall inside the two advisories that P4-01
  accepts. Its reopening condition was therefore already met when #187 was filed.
  - Fixed: #187 records both copies, and its reopening condition now needs an advisory that no
    entry in force covers.
  - Fixed: `follow-ups.md` says to check `cli.js` before dropping either exception.
- Six minor notes, all applied:
  - three restored `lessons.md` phrases;
  - the `bun update` line's wording, which now matches phase 0;
  - an Outcome bullet that rendered under the wrong parent;
  - a stale banners comment, since happy-dom 21 loads no CSS by default;
  - the close-out commit's retirement count, reworded before any push.
- The Opus reviewer re-ran both suites against happy-dom 20.12.0. The `expect()` counts were the
  same (181 and 321), so the bump lost no assertion.

## Arc 3, round 2

- Codex resume (fix diff 97c4af7): **1 material**. #187's revised reopening condition was already
  met. `cli.js` inlines `shell-quote` 1.10.0, under critical GHSA-pqg4-j6r4-53mv, and no exception
  covers it.
- To end the piecemeal discovery, a one-off pass sent all 204 inlined names (221 store entries,
  from esbuild's path comments) to the bulk advisory endpoint. High and critical results:
  - `shell-quote` 1.10.0;
  - `fast-xml-parser` 4.4.1 (critical GHSA-m7jm-9gc2-mpf2, two high), parsing the inlined AWS SDK's
    XML answers;
  - `brace-expansion` 2.0.1 and 5.0.5, and `minimatch` 5.1.6, on patterns from the repository or
    the command line;
  - `undici` 7.29.1 and `zod` 4.6.5.
- The `shell-quote` path is unreachable: wrangler's `quote` wrapper passes `args.map(String)`, its
  `parse` wrapper drops comment tokens, and the only `quote()` output is logged.
- #187 now carries the baseline. It is re-taken on every wrangler bump, and it reopens on an
  advisory whose input an outsider controls during a build.
- An audit of the path comments stays out of scope: it would be a new source, with no completeness
  check.
