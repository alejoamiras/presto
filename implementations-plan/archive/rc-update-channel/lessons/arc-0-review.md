# Arc 0 review (Codex, gpt-6.1-sol, high, read-only)

Branch `rc-update-channel-stop-v1-prerelease-feed`, reviewed at `b87d526`, fixed in `ed9dffc`.

## Round 1: fix (3 low)

No functional regression: hosts entries, SANs, cleanup and expected URLs agree across every mode of
the three smoke scripts; nothing else reads `signed-update-feed` for a prerelease; the
production-key assertion is real. Codex also attacked `.test` and kept it (RFC 6761 §6.2 allows
private resolution and has no resolver special case; CA/B Baseline Requirements forbid public
certificates for internal names).

1. Docs overstated the guarantee: ephemeral feeds use a throwaway key, not the production one, and
   `.test` is out of reach only for servers on public DNS with publicly trusted certificates (a
   private CA plus private DNS can still answer it). Verified; wording scoped in
   `UPDATER_TESTING.md` and the signer comment.
2. The ephemeral URL was pinned only by the string `"updater-smoke.test"` being present. Verified:
   changing the URL expression kept the suite green. The test now pins the script's one `host=` line
   and its one download URL; the same mutation now fails it.
3. A stale `release-presto.yml` comment ("omit its already-produced latest.json") and two
   provenance labels in the smoke scripts. Verified; rewritten and removed.

Gate after the fix: `bun run test` 0, `bun run lint:actions` 0, shellcheck 0.9.0 clean.

## Round 2: clean

"No new material findings… VERDICT: clean". Converged.
