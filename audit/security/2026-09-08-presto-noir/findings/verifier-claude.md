# Verifier report — 2026-09-08-presto-noir (Phase 4)

Method: for each finding I read only the title + `Instances` list, re-read that source, wrote an
independent conclusion, then compared against the finding's full text. All line numbers below were
re-confirmed against `main` @ f331a78 by direct read (`grep -n` cross-checks included).

### F-001 — CONFIRMED

**Independent conclusion (pre-read):** `_publish-npm.yml`'s `publish` job holds `id-token: write` +
`contents: write` for its whole duration, packs the tarball, stores its path in `$GITHUB_ENV`
(`TARBALL`), then runs `scripts/sdk-tarball-consumer.sh` — three `npm install`s with lifecycle
scripts enabled plus an `npx`-fetched `tsc` — *before* `npm publish "$TARBALL"`. Any dependency
resolved by range during those installs can run arbitrary code in the job, and that code can simply
overwrite the file at `$TARBALL` before it gets signed and published. Checked whether ranges
actually exist in the packed manifest: `prepare-sdk-publish.ts` only rewrites `workspace:` deps to
exact pins; ordinary deps (`@logtape/logtape: "^2.3.2"` in all three package.json's) pass through
verbatim, confirmed by grep. So the precondition is real, not hypothetical. Exploit path exists.

**vs. the claim:** Matches exactly, including the "not an instance" comparison — I independently
verified `_ts-package-ci.yml`'s `tarball-consumer` job runs the identical script (`:159`) under
`permissions: contents: read` only (`:30-31`), no `id-token`, so it cannot substitute a
publishable/signable artifact. Also verified `verify-sdk-package-signatures.ts:51` already passes
`--ignore-scripts` while `sdk-tarball-consumer.sh:79/111` and `_publish-npm.yml:245` do not — the
finding's "mitigated in one place, not four" claim holds.

**Strengthened trace:** `packages/sdk/package.json` `@logtape/logtape: "^2.3.2"` (unpinned, verified
verbatim-preserved by `scripts/prepare-sdk-publish.ts:60-75`) → `scripts/tarball-consumer/host-manifest.ts:28` writes a host `package.json` with no lockfile → `scripts/sdk-tarball-consumer.sh:79` `npm install` (scripts on, fresh registry resolution, no lockfile pin) → a malicious `postinstall` inherits `$TARBALL`, `ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN` (injected into every step once `id-token: write` is granted at job level, `_publish-npm.yml:44`) → overwrites `$TARBALL` → `_publish-npm.yml:167` `npm publish "$TARBALL" --provenance` signs the substituted bytes. Minimal preconditions: (a) `@logtape/logtape` (or any other non-workspace range dep in any of the three packages) has a live malicious release on npm at publish time, (b) that release ships a lifecycle script or is imported at module scope by `runtime-check.mjs`. No further timing/race needed — deterministic once (a) holds.

**Fix check:** Splitting into an unprivileged build/pack/test job plus a privileged publish job that
re-hashes before publishing is the correct shape and is already demonstrated in-repo by
`_ts-package-ci.yml`'s `tarball-consumer` job (`contents: read` only). The interim mitigation
(hash `$TARBALL` right after packing, assert before publish; `--ignore-scripts` on the three
remaining installs; pin `typescript` exactly) is the smallest safe change and is independently
sufficient even without the job split — a hashed-and-asserted `$TARBALL` cannot be substituted by a
script that ran earlier, regardless of that script's permissions. Regression risk: low —
`--ignore-scripts` on `sdk-tarball-consumer.sh`'s installs could hide a real postinstall-dependent
package a consumer needs (none currently declared), and pinning `typescript@5.9.x` exactly needs a
version bump discipline the team already has for other pins.

**Final confidence:** high. **CVSS v4.0:** agree High band; `AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:N/VA:N/SC:H/SI:H/SA:L` — `AT:P` (a live upstream compromise coinciding with a release) is the sole factor keeping it below Critical, as the finding notes.

---

### F-002 — CONFIRMED

**Independent conclusion (pre-read):** Read `demoteHttpsPin()` (`presto-transport.ts:648-653`) —
confirmed it clears `#protocol`/`#statusCache` and does **not** touch `#generation`. Read `baseUrl`
(`:688-693`) — confirmed it re-reads `#protocol` live on every call. Read `prove()`
(`presto-client.ts:322-351`) and `#proveRemote` (`:360-407`) — the only await between `detectGen`
capture (`:322`) and the generation re-check (`:333`) is inside `checkStatus()`; on a cache hit that
await still yields one microtask (an `await` on an already-resolved value still queues). During that
single microtask hop, a *second*, further-along `prove()` call that just took a network-level HTTPS
failure can synchronously call `demoteHttpsPin()` (inside `#recoverFromNetworkFailure` →
`#retryOverHttp`) before its own `await isProtocolHealthy("http")`. The resuming first call's
generation check at `:333` still passes (no generation bump), and `baseUrl` at `:364` now yields
`http://…` with zero validation of that endpoint. This is a real, reachable race, not merely
theoretical — it requires only two overlapping `prove()` calls and the non-default
`allowInsecureDowngrade:true` policy (confirmed via `allowsHttpDowngrade`, `:632-634`, which returns
`this.#allowInsecureDowngrade` once `#httpsWasHealthy` is true).

**vs. the claim:** Matches exactly; same file:line trace, same precondition set, same root-cause
statement (destination read live, not part of the frozen `Snapshot`).

**Strengthened trace:** cached HTTPS status hit → `presto-client.ts:323` (`await checkStatus()`,
microtask yield) ⇄ concurrent proof's `presto-transport.ts:648` `demoteHttpsPin()` (synchronous, no
generation bump) → resumed call: `presto-client.ts:333` generation check (stale-passes) →
`presto-client.ts:364` / `presto-transport.ts:692` `baseUrl` (now `http://…`, unvalidated) →
`presto-transport.ts:958` POST. Minimal preconditions: two overlapping `prove()` calls on one
client; `{httpsOnly:false, allowInsecureDowngrade:true}`; one of the two calls suffers a genuine
HTTPS network-layer failure. A control the finding didn't flag as *already partial mitigation*: the
non-racing path (`#retryOverHttp`) *does* call `isProtocolHealthy("http")` before using its own
`httpRetryUrl` — the vulnerable path is specifically the *other* call's primary attempt, which never
goes through that gate because it never entered `#retryOverHttp` itself.

**Fix check:** The recommended fix — derive the attempt's protocol/URL from the `status` returned by
`checkStatus()` (or a `protocol` snapshot taken alongside `detectGen`) rather than live `baseUrl`,
and bump a generation on every `demoteHttpsPin()`/`setProtocol()` — is minimal and has a direct
in-repo template: `attempt.httpRetryUrl` is precisely such a precomputed, validated snapshot
(`urlFor("http", …)` + `isProtocolHealthy` gate, `presto-client.ts:449-453`). Mirroring that shape
for the *primary* URL closes both this and F-005. Regression risk: low; the main cost is plumbing
one more field through `Snapshot`/`Attempt`, and existing "endpoint-changed" fallback semantics
already cover the abort path.

**Final confidence:** high on mechanism, moderate on real-network timing (as claimed). **CVSS v4.0:**
agree Medium band; `AV:L/AC:H/AT:P/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` — `AC:H`/`AT:P` (race
window + non-default policy) hold it at Medium rather than High.

---

### F-003 — CONFIRMED

**Independent conclusion (pre-read):** Read `download_bb`/`download_tarball`/`verify_digest`
(`downloader.rs:20-60`, `:118-182`) — confirmed the full tarball (up to 64 MiB,
`MAX_DOWNLOAD_BYTES`) is fetched *before* `verify_digest` even requests the expected hash from
GitHub; a digest-fetch failure (e.g., GitHub API rate-limited) throws away the already-downloaded
bytes and caches nothing, so the *next* identical request repeats the full download. Read
`verify_cached_bb` (`cache_layout.rs:231-251`) — confirmed it calls `mark_in_use` (refreshing
`.last-used`) on *every* resolve, including cache hits. Read `resolve_version`/`acquire_prover`
(`prove.rs:51-91`, `:305-321`) — confirmed version resolution and download happen before the prove
permit and, on the UltraHonk route (`ultra_honk.rs:327-337`), before `decode_and_check` — a request
with syntactically-valid-but-garbage `bytecode`/`witness` still pays the download cost. Read the
retry logic (`version_policy.rs:370-392`) — confirmed the code's own "round 2" comment already
concedes the single retry doesn't loop; the literal phrase "finish the job" appears at `:388`.
Independent read agrees this is a real amplification: an approved origin can force unbounded
sequential downloads and can hold the cache over its 2 GiB cap indefinitely by refreshing
`.last-used` at less than the 5-minute active window.

**vs. the claim:** Matches; same two sub-mechanisms, same root cause, same line-level trace. I did
not find any additional mitigating control the finding missed.

**Strengthened trace:** `x-aztec-version` header (`prove.rs:374-379`) → `resolve_version`
(`:51-91`) → `verify_cached_bb`/`mark_in_use` (`cache_layout.rs:249`) or `download_bb` (uncached) →
`download_tarball` (64 MiB, `downloader.rs:131-149`) → `verify_digest` (`:157-182`, fetches expected
hash *after* the download) → on failure, bytes discarded, no cache write. Cap-bypass leg:
`version_policy.rs:379` `evict_if_unheld` deferred by `recently_active` (5 min,
`downloader.rs:216`) → single retry `:388-391` → no re-arm. Minimal preconditions: one approved
origin (headless auto-approves localhost, per coordinator notes — I did not re-verify this
sub-claim as it's outside the five findings), one version string cycling to trigger GitHub API
rate-limiting (~60/hr unauthenticated, confirmed unauthenticated client at `release_metadata.rs`),
or four concurrent per-origin invalid-but-parseable UltraHonk requests every <5 min to hold the cap
breach open.

**Fix check:** Fetching the digest before the tarball is the smallest safe change and directly
neutralizes the cheap-amplification variant (a failed digest lookup then costs one API call, not 64
MiB). A download cooldown/token-bucket is a reasonable but non-trivial (~1 day) addition; re-arming
the cleanup retry while `deferred_by_active_window` remains true is a small, well-scoped change
matching the existing retry's own shape. No existing in-repo pattern for a rate limiter, so this
piece has moderate implementation risk (needs care to avoid regressing legitimate multi-version
users); the two "hours"-effort items are safe.

**Final confidence:** high on both mechanisms, moderate on practical disk-fill magnitude (as
claimed — actual bb tarball sizes/version counts weren't measured by me either). **CVSS v4.0:** agree
Medium band; `AV:N/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` — `PR:L` reflecting the
origin-approval precondition (weakened, not absent, for headless auto-approve-localhost).

---

### F-004 — CONFIRMED (impact/precondition as claimed)

**Independent conclusion (pre-read):** Read `published-playground.ts:99-115` — `fetchVerified`
runs provenance verification, then signature verification (each against the registry/a discarded
temp copy), then a *third* `npm pack --ignore-scripts --json` and compares its `.integrity` to a
*fourth* registry call (`npm view … dist.integrity`). This last comparison is a real check, but it
validates internal consistency between `npm pack` and `npm view` — neither of which is the digest
that `fetchAndVerifySdkProvenance`/`verifySdkPackageSignatures` actually attested to (confirmed
`verifySdkPackageSignatures` returns `Promise<void>`, no digest surfaced). So the bytes that get
extracted into `node_modules` and deployed are never checked against the specific digest that was
cryptographically verified as provenance-attested. This is a real gap, but exploiting it needs the
registry (or a MITM) to serve *different* bytes to the provenance-fetch request than to the
pack/view requests for the same immutable version+dist-tag within one job run — a materially
stronger attacker than the "loopback, unauthenticated presto" model this audit otherwise assumes.

**vs. the claim:** Matches, including the explicitly flagged cross-model disagreement over the
precondition's realism; I independently reach the same split (gap: high-confidence real;
exploitability: low-confidence, stronger-than-assumed attacker).

**Strengthened trace:** `fetchAndVerifySdkProvenance` (`published-playground.ts:103`) → separate
`verifySdkPackageSignatures` temp dir (`:104`) → `npm pack --ignore-scripts --json` (`:107`, a
*third* registry fetch) → integrity self-check against `npm view dist.integrity` (`:111`, a
*fourth* call) → `.github/scripts/packaged-e2e-swap-sdk.sh` extracts into `node_modules` → `wrangler
deploy`. No hop carries forward the digest verified in the first two steps.

**Fix check:** Returning the verified sha512 from `fetchAndVerifySdkProvenance` and comparing it
locally to a hash of the actually-packed bytes is the smallest safe change and requires no new
network calls (`Bun.CryptoHasher("sha512")` over already-downloaded bytes). Low regression risk —
purely additive.

**Final confidence:** high that the binding is missing; low that it's practically exploitable, as
claimed. **CVSS v4.0:** agree Low band; `AV:N/AC:H/AT:P/PR:N/UI:N/VC:N/VI:H/VA:N` — the very high
`AC`/`AT` (registry/MITM must be response-inconsistent within one immutable version, one job) is
the dominant factor; a strict CVSS-only read might even push this toward informational, but I agree
Low is defensible given the guarantee it defeats is the code's stated purpose.

---

### F-005 — CONFIRMED (narrow persona, as claimed)

**Independent conclusion (pre-read):** Read `#proveRemote` (`presto-client.ts:360-407`) — `url` is
computed once at `:364` from live `baseUrl`, the last generation check is at `:385`, and
`Uint8Array.from(payload)` runs at `:396`, *after* that check. `Uint8Array.from` on a non-typed-array
iterable invokes the object's own `Symbol.iterator`/`next()`, which is caller code if
`ProveRequest.body()` returns such an object. If that caller code calls `configure()` during
iteration, the transport's generation bumps, but nothing re-checks it before the POST at `:401` uses
`attempt.url` (fixed since `:364`) and `attempt.payload`. Checked both shipped adapters
(`presto-prover.ts:162-166`, `presto-ultra-honk-backend.ts:120-126`): both supply plain
`() => Uint8Array.from(realArray)` closures returning genuine `Uint8Array`s, not exotic iterables —
neither can trigger this. So the only actor who can exploit this is a direct `PrestoClient` caller
building a deliberately malicious `body()`, i.e., subverting its own client. No externally-reachable
attacker gains anything.

**vs. the claim:** Matches exactly — same lines, same "caller subverting its own client" persona.

**Strengthened trace:** `ProveRequest.body` → `presto-client.ts:377` (`request.body()` called,
producing `payload`) → `:385` generation check (passes) → `:396` `Uint8Array.from(payload)`
re-enters caller code, which can call `configure()` → `:401` posts using the pre-`:396` `url`/
`payload` snapshot with no further check. Precondition: direct `PrestoClient` use with a
hand-crafted iterable `body()` — not reachable through either public SDK adapter.

**Fix check:** Moving `Uint8Array.from(payload)` above the `:385` check (or adding one more
check immediately before `#post`) is the minimal fix and is naturally bundled with the F-002 fix
(same generation-snapshot mechanism). No regression risk — pure reordering.

**Final confidence:** high on mechanism, low on security significance, as claimed. **CVSS v4.0:**
agree Low band; arguably this is better scored as a defense-in-depth/robustness gap than a true
vulnerability (no privilege boundary crossed — attacker == caller), so `AV:L/AC:L/AT:P/PR:H/UI:N/
VC:N/VI:N/VA:N` with `PR:H` reflecting that the "attacker" already has the exact privilege the
finding's own client would grant it. I would not move it, but I'd flag this as the finding I'm most
tempted to call sub-Low/informational rather than the consolidated report's Low.

---

## Verifier summary

| ID | Verdict | Final confidence | CVSS v4.0 band |
|---|---|---|---|
| F-001 | CONFIRMED | high | High (agree) |
| F-002 | CONFIRMED | high (mechanism) / moderate (timing) | Medium (agree) |
| F-003 | CONFIRMED | high (mechanism) / moderate (impact magnitude) | Medium (agree) |
| F-004 | CONFIRMED (gap real; precondition strong) | high (gap) / low (exploitability) | Low (agree) |
| F-005 | CONFIRMED (narrow persona) | high (mechanism) / low (significance) | Low (agree, borderline informational) |
