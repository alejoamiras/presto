# Codex fix loop (gpt-6.1-sol, high)

Session `01a137d4-4494-75a0-8855-47d0ac2e4ab1`. The review covered the net diff from `14c4085`,
with the adversarial ask and the two verbatim rules.

## Round 1: 1 medium, 2 low, 1 nit. All verified and fixed.

1. **Medium: a transient npm failure read as "unpublished".** `npmView` mapped every non-zero exit
   to "missing", so `resolveTargets` could silently drop a package. A conflicting foundation pin
   from that package would then never be seen.
   - Verified: npm prints `{"error":{"code":"E404"}}` on stdout for a missing version.
   - Fix: `parseNpmDependencies` returns `undefined` only for E404 and throws on anything else. A
     regression test covers success, the empty output, E404, ETIMEDOUT and output with no error
     code.
   - Re-checked against real npm: `checkAztecUpdate` with the SDK manifest rewound to rc.1 still
     resolves `foundation 6.0.0-rc.6`.
2. **Low: the drift guarantee stops at the repository's install.** A consumer override, alias or
   forced dedupe could load a different bb.js than the one the SDK sends.
   - Fix: the SDK README says such setups are unsupported. No runtime mechanism was added.
3. **Low: stale inventory wording.** These still described Aztec versions or Aztec↔bb pairs:
   - SDK README: `needsDownload`, `versions`, the `checkPrestoStatus` paragraph, and the
     `downloading` phase row;
   - the skill's `downloading` row;
   - presto README "Version Compatibility".
   - Fix: they now say bb releases, and that both keys carry the same string. presto-core is
     untouched.
4. **Nit: workflow references in permanent comments.** Removed "(codex denylist-review #2)" and
   the speculative future-gate paragraph from `version_policy.rs`, and "(lessons from the 5.0.0-rc.2
   bump)" from the updater.

Gate after the fixes: `bun run test` exit 0.

## Round 2: all four fixes confirmed sound; 1 low, verified and fixed.

1. **Low: the presto README's `AZTEC_BB_VERSION` row still said "the Aztec version".** An operator
   following it would set `6.0.0-rc.3` beside an rc.6 binary. `/health` would then report the wrong
   inventory, and the SDK's rc.6 request would miss the bundled shortcut and download.
   - Fix: the row names the `bb` release and gives `6.0.0-rc.6` as the rc.3 example. Also updated:
     - the `BB_BINARY_PATH` row and the README's intro line;
     - the contradictory test comment at `version_policy.rs:906` and the revocation-list doc lines.
- Codex checked E404 detection against the npm 10.9.4, 11.19.0 and 12.0.2 sources. CI's npm is
  whatever the runner image ships (`node-version 24.20.0`), so a future npm that changes the error
  shape would fail closed, not silently.

Side finding in this round, made by the driver rather than Codex: phase 3 wrongly said
`release-sdk.yml` does not gate on the audit. It does, and phase 3 now carries the correction. The
director chose to keep this PR scoped and to file the audit failure as the rc.3 release blocker
(#101).

## Round 3: no material findings. The loop converged.

Codex confirmed the round-2 fix, that `packages/sdk-core` is unchanged and that
`git diff --check` is clean.
