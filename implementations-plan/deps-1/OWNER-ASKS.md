# deps-1 owner asks

Nothing a person sees changes in this lane. The one ask below is a security acceptance: the
lane may not add an allowlist entry without your pick.

## Ask 1: the blocked packages that no in-scope bump can fix (#172)

**Answered: P4-01, Option A** (delegated by the owner, recorded by the orchestrator 2026-10-25). Arc 2
adds both entries below verbatim.

**Surface.** `scripts/dependency-audit-allowlist.json`. The `Dependency Audit` job gates both release
workflows (`docs/RELEASE_RUNBOOK.md:142`). Until each row below is fixed or accepted, every release
dispatch fails at `dependency-audit`.

**What ships now, without your pick.** Arc 1 (the wrangler bump, no `sharp` override, the audit of
npm's bundle). Arc 2's re-resolution of the caret `undici` copies, and arc 3's `happy-dom` bump after
2026-10-27. With no pick, the audit stays red on the rows below, and #172 stays open.

| Package and advisory | Who pins it | Reaches what users run? | Allowlist entry I would add | Wait for upstream |
|---|---|---|---|---|
| `zod` 4.4.3, GHSA-mrhx-c7xc-m3w5 (high): memory exhaustion while validating oversized constrained collections | `@aztec-labs/*` 6.0.0 require `~4.4.3`; the fix is 4.6.6 | **Yes.** It is a runtime dependency of `@aztec-labs/foundation`, `stdlib` and `aztec.js`. The playground page bundles it, and every app that installs `@alejoamiras/presto` 6.0.0 gets it. The Aztec RPC client validates each node answer (`response.result`) with `parseAsync`, and some outputs are arrays (for example `getBlocks`). The attacker is a node, or the RPC in front of it, that answers with a large invalid collection. Validation then allocates too many issues and can exhaust the client's memory: the tab, or an integrator's process. Trusting the node for chain data does not cover this. Exploitability: unknown; no application-level reproducer exists | expires **2026-11-30**. reason: "Aztec 6.0.0 requires zod ~4.4.3 (fixed in 4.6.6). zod validates Aztec node answers; a hostile node or RPC could exhaust the client's memory with an oversized invalid collection. Residual risk: client denial of service; no data or key exposure is known." upgrade: "Remove when the pinned Aztec release allows zod 4.6.6 or newer." | An Aztec release that allows `zod` ≥ 4.6.6; no date is known. A root `overrides` entry is a third route, untested with Aztec 6.0.0 and outside this lane |
| `undici` 7.29.1, GHSA-xjj6-f33q-929c (high): a hostile server's excessive content-encodings crash the client | `miniflare` exact-pins it in every wrangler through 4.152.0 (checked 2026-10-25) | **No: dev and build tooling only.** miniflare is wrangler's local Workers simulator. Whether `wrangler deploy` loads it is unverified | (one entry with the next row, see below) | A wrangler whose miniflare pins `undici` ≥ 7.30.1, then 7 days of age |
| `undici` 6.29.0 in npm 11.21.1's bundle, same advisory | npm 11.21.1, the newest 11.x, bundles it | **No, but it sits next to the deploy token.** Only `node-gyp/lib/download.js` in the bundle requires it (checked by grep). The playground's Workers Build runs this npm for `npm pack` and `npm audit signatures`, which never build a native addon | expires **2026-11-30**. One entry covers both `undici` rows. reason: "miniflare (wrangler 4.151.1) exact-pins undici 7.29.1 for local Workers tooling; npm 11.21.1 bundles undici 6.29.0 for node-gyp only, which the playground build never runs. Every other undici copy is 6.29.1 or 7.30.1." upgrade: "Remove when wrangler's miniflare pins undici 7.30.1 or newer and the playground's npm pin bundles undici 6.29.1 or newer." | An npm 11.x that bundles `undici` ≥ 6.29.1 (none exists yet), or a move of the pin to npm 12, which is outside this lane |

**The allowlist cannot split the two `undici` rows.** Its key is `ecosystem:id:package`, so one entry
accepts both copies, or none.

**Options.**
- **A. Accept both entries until 2026-11-30.** The audit goes green once arc 3 lands. Releases can
  run. Each entry expires on its date, so it comes back for review.
- **B. Accept `undici`, wait on `zod`.** The audit stays red on `zod` alone. Releases stay blocked
  until Aztec moves.
- **C. Accept `zod`, wait on `undici`.** It stays red until Cloudflare and npm both ship. Their usual
  pace is days to weeks.
- **D. Wait on both.** No entry, and releases stay blocked.

**Recommendation: A.** Both advisories are denials of service. Neither is known to expose data or
keys, and both entries expire in five weeks.
- `zod` is the row that reaches users. Its residual risk is real: a hostile node or RPC could exhaust
  a client's memory, which goes beyond the data the client already trusts it for. Exploitability is
  unknown.
- The `undici` copies run only in tooling.

Waiting keeps every release blocked, with no upstream date for `zod`.

`happy-dom` (GHSA-834v-8h66-3h79) is not part of this ask. Arc 3 fixes it with a bump.
