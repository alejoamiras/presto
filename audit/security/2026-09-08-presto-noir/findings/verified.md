# Verified findings — 2026-09-08-presto-noir (security)

Phase 4: two independent verifiers (Claude Sonnet, Codex GPT-6 Astra at `xhigh`), each re-deriving
every finding from the source before reading the consolidated claim (`verifier-claude.md`,
`verifier-codex.md`). Verified in severity order: High → Medium → Low; all five were covered.

| ID | Band (final) | Claude | Codex | Final confidence | Fix refinement adopted |
|---|---|---|---|---|---|
| F-001 | **High** | CONFIRMED, high | CONFIRMED, high | high | Pack, hash, and upload the artifact **before** any registry code runs; the consumer test and the publish are separate jobs that consume the artifact by recorded digest (a hash computed after the consumer install is itself mutable) |
| F-002 | **Medium** | CONFIRMED, high (mechanism) / moderate (timing) | CONFIRMED, high | high | Bind dispatch to `status.protocol` from the check that authorised the attempt, through the existing explicit-protocol `urlFor()` (`presto-transport.ts:935-938`); reading the live transport protocol after an await keeps the race |
| F-003 | **Medium** | CONFIRMED, high (mechanism) / moderate (impact) | CONFIRMED, high | high | Digest-first download is the smallest amplification fix; count **every attempted cache miss** (failures and repeats included) against the download budget; coalesce duplicate in-flight downloads |
| F-004 | **Low** (conditional) | CONFIRMED (gap real, precondition strong), low exploitability | CONFIRMED, conditional, moderate | moderate | Carry the digest of the **cryptographically verified** attestation (the signature audit), not merely the parsed statement, and compare the consumed file before extraction |
| F-005 | **Low — informational** | CONFIRMED (narrow persona), borderline informational | PARTIAL: mechanism only, would band none | high on mechanism, low on significance | Move the payload copy above the existing final generation check (mirrors `presto-client.ts:376-385`); no second check needed. Shipped with F-002 |

## Per-finding notes

### F-001 — CONFIRMED (High)
Both verifiers reproduced the trace independently: `prepare-sdk-publish.ts:60` keeps range
dependencies; `sdk-tarball-consumer.sh:79`/`:111` install them fresh with lifecycle scripts enabled
inside the `_publish-npm.yml` `publish` job, which holds `id-token: write` and `contents: write`
(`:43-45`); `$TARBALL` is exported at `:158` and published at `:167`. Every later check verifies the
published bytes, so a substituted tarball ships with valid provenance. The Codex verifier corrected
the coordinator's fix: hashing after the consumer install, in the same job, is still mutable. Adopted
sequence: (1) build → pack → `sha256sum` → `upload-artifact`, with no registry execution in between;
(2) consumer test in a job with `contents: read`, no `id-token`, on the downloaded artifact;
(3) publish job downloads the artifact, asserts the digest recorded by job (1), then `npm publish`.
Interim same-day mitigations remain valid: `--ignore-scripts` on `:79`, `:111`, `:245`; exact
`typescript` pin at `:93`. Existing pattern to mirror: `_ts-package-ci.yml`'s `tarball-consumer` job
(unprivileged) and `verify-sdk-package-signatures.ts:51` (`--ignore-scripts`).

### F-002 — CONFIRMED (Medium)
Line-level trace re-derived by both: cached HTTPS status (`presto-client.ts:323`) → a concurrent
attempt's `demoteHttpsPin()` (`:450` → `presto-transport.ts:648-653`, no generation bump) → the
victim attempt reads `baseUrl` live (`presto-client.ts:364`, `presto-transport.ts:688-693`) → POST
to the HTTP port that was never health-checked. Preconditions: `{httpsOnly:false,
allowInsecureDowngrade:true}`, overlapping `prove()` calls, an HTTPS network failure, a scheduling
window. Real-browser timing not exercised (Codex reproduced with in-memory fetch mocks). Fix:
snapshot the protocol with the eligibility check and build the URL with `urlFor(protocol, path)`;
have `demoteHttpsPin` bump a generation the final check compares.

### F-003 — CONFIRMED (Medium)
Both verifiers confirmed the two mechanisms and the ordering that makes them cheap: version
resolution and `mark_in_use` run before payload decoding (`ultra_honk.rs:333` before `:338`); the
tarball is fetched before the digest (`downloader.rs:38` → `:44`), so once the unauthenticated
GitHub API rate limit is hit every request for an uncached version downloads and discards 64 MiB;
the deferred cleanup fires once and does not re-arm under continued refresh
(`version_policy.rs:458-478`). Fix order: digest first; a per-origin/global download budget that
counts every attempted miss; coalesce duplicate downloads; re-arm the deferred cleanup.

### F-004 — CONFIRMED, conditional (Low)
The binding gap is real (three registry conversations never tied to one digest;
`published-playground.ts:103`, `:104`, `:107`, `:111`); exploitation needs the registry or a TLS
MITM to serve inconsistent bytes for one immutable version within one job. Codex refined the fix:
the digest must come from the cryptographically verified attestation (`npm audit signatures`
output), not from `fetchAndVerifySdkProvenance`'s parsed statement alone. Cross-model disagreement
on realism recorded; kept at Low because the fix is small and the guarantee is the code's purpose.

### F-005 — PARTIAL / informational (Low)
Mechanism confirmed by both (`Uint8Array.from(payload)` at `presto-client.ts:396` runs a
caller-supplied iterator after the last generation check at `:385`). Neither shipped adapter can
reach it; the only persona is a caller subverting its own client. Codex would assign no band; Claude
"borderline informational". Reported as informational, fixed alongside F-002 by moving the copy
above the check.

## Verifier disagreements
- F-005 band: Codex none vs Claude Low → reported Low/informational.
- F-004 exploitability: Claude low vs Codex moderate → final moderate confidence, Low band.
- No verdict disagreements on F-001..F-003.
