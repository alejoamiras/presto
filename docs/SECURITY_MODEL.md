# Security Model

**Status:** accepted project policy

**Last reviewed:** 2026-10-16

Presto moves proving work from browser WASM to a native `bb` process on the same machine. This
document states what the project protects, where it depends on other systems, and which residual
risks are consciously accepted. It is the reference the [security policy](../SECURITY.md) points at,
and the thing to read before reporting behavior that looks like a weakness.

## System and trust boundaries

The normal proving path is:

```text
dApp → adapter SDK → presto-core → loopback HTTP/HTTPS → local bb process → proof
```

- **The SDKs are application code**, running in the dApp's browser page, Web Worker, or Node/Bun
  process. `@alejoamiras/presto` (Aztec, `chonk` scheme) and `@alejoamiras/presto-noir` (any Noir
  circuit, `ultra_honk` scheme) are thin adapters over the shared transport in
  `@alejoamiras/presto-core`. `@alejoamiras/presto-banners` is presentational and reaches no Presto
  endpoint, but it does inject a Google Fonts stylesheet into the host page unless `fonts="none"`
  (`packages/banners/src/fonts.ts`).
- **The desktop app owns** the loopback listeners, the approval UI, the local `bb` cache, the
  certificate material, and the updater.
- **The headless server** reuses the same proving core but is a CI-only operator tool with no
  approval UI and no TLS.
- **`bb` is published by AztecProtocol.** Presto downloads it from the upstream `barretenberg`
  GitHub releases and neither builds nor publishes it.
- **Desktop releases are published by this project.** macOS artifacts are signed and notarized;
  Windows first-install packages are intentionally unsigned. All updater payloads are Ed25519-signed
  and verified independently of any OS package signature.
- **npm packages are published by this project** through GitHub OIDC with provenance, and verified
  after publish. Their Aztec dependencies are published upstream (see decision 6).
- **The verified-sites list is signed by this project in CI**, with a dedicated Ed25519 key that is
  never the updater's. Its seed sits in the `verified-sites-signing` GitHub environment, whose only
  reviewer is the owner. Every signed list is recorded in `packages/presto/verified-sites/history/`
  and served from `https://presto.build/releases/verified-sites.json`. The list is display-only: it
  puts a name and a ✓ beside an origin in the approval popup, and no authorization decision reads it
  (see decision 7).

The main confidential asset is the **private witness** sent to `/prove` or `/prove/ultra-honk`.
Approved-origin state, locally generated TLS private keys, updater state, and cached executable
integrity metadata are also treated as security-sensitive local state.

## Security goals and controls

The project is designed to:

- bind proving to loopback and reject non-loopback host authorities, with each listener enforcing a
  `Host` allowlist for **its own port**, so a `:59834` authority cannot pass on the `:59833`
  listener (`packages/presto/core/src/server.rs`);
- require a remembered user approval before a browser origin may prove — deny-by-default, and on the
  desktop that includes localhost origins, which are prompted once rather than silently trusted
  (`packages/presto/core/src/authorization.rs`);
- re-check approval *after* the admission queue **on `/prove/ultra-honk`**, so an origin revoked in
  Settings while its job was waiting is denied rather than served. The older `/prove` route has no
  equivalent re-check and proves on the approval it was admitted with
  (`packages/presto/core/src/server/prove.rs`);
- keep witness workspaces and sensitive state owner-only, clean them after proving, and reap
  abandoned ones conservatively on a later successful start;
- contain the `bb` child: timeout, kill-tree, inputs passed only as files and never as arguments,
  `verifier_target` parsed into a closed enum at ingress, and decoded-input size caps enforced
  before proving starts. This is resource containment of a **trusted** binary, not a sandbox — see
  decision 1;
- hold admission seats until a killed `bb` is confirmed reaped, so a cancelled request cannot let a
  new one start beside a process that is still dying;
- default browser proving to HTTPS, pin HTTPS after it succeeds, and never send an HTTP `/prove` or
  a witness without explicit, non-persisted session consent;
- fetch an upstream release digest **before** its tarball, verify downloaded `bb` bytes against it,
  re-hash cached executables before use, fail closed on a missing or invalid marker, and budget
  downloads so a request cannot drive unbounded fetch churn;
- accept only correctly signed updater payloads, reject rollback and artifact confusion, and enforce
  an artifact size ceiling taken from the **signed envelope** rather than the feed's advertised
  value, before the download is accepted;
- admit a release candidate only on the release-candidate channel, which only the Settings window
  can choose, with developer mode on. A candidate is signed under its own envelope schema (`rc-v1`);
  the stable channel refuses one when it checks, before it acts or prompts, and again from the
  on-disk choice before it installs, and both channels refuse a prerelease signed as a stable. The
  feed Worker's routing is not the boundary: a signed candidate served on `latest.json` is refused
  there too.

These controls reduce risk within the boundaries below. They do not turn those boundaries into
cryptographic guarantees.

Two buffering residuals are accepted rather than fixed, and both are availability-only — neither can
make an unsigned payload install. The feed JSON is buffered before its signature is verified, and the
signed-size precheck bounds what the feed *advertises*, not what the server actually sends, so an
oversized real response is still read (`packages/presto/src-tauri/src/updater.rs`, documented at the
call sites).

## Accepted decisions

### 1. Depend on upstream `bb` publisher security

The runtime obtains both a `bb` release asset and its SHA-256 digest from AztecProtocol's GitHub
release infrastructure. The comparison detects transit corruption, incomplete downloads, cache
modification, and a release asset that changed after its digest was recorded. It does **not** provide
independent publisher authentication if the upstream publisher account or the shared GitHub control
plane is compromised.

The source is `AztecProtocol/barretenberg`, the only repository that releases `bb` for Aztec v6
(`aztec-packages` stopped at v5). Moving between two repositories of the same organisation leaves this
trust model unchanged. Barretenberg rebuilt v5.0.1, so its assets differ from `aztec-packages`' for that
one version. A copy already cached keeps verifying against its own recorded digest.

The same reasoning governs the Windows `bb.exe` sidecar, which is pinned by SHA-256 in
`scripts/copy-bb.ts`. Pins are never auto-generated — downloading and recording whatever arrived is
circular — so each carries `provenance: "manual-review"` and the resolver fails closed on anything
else. `provenance: "attestation"` is reserved for when upstream signs.

Three further consequences follow from trusting the publisher, and none of them is a bug to report:

- **There is no minimum-safe-version floor.** The `x-aztec-version` header names the barretenberg
  release the client proves with (the SDK's bb.js version), and an older dApp needs its older `bb`,
  so a "newer is safer" floor would break legitimate older dApps. Any well-formed version upstream published is accepted
  (`packages/presto/core/src/versions/version_policy.rs`).
- **Revocation is reactive and ships in an app release.** `KNOWN_VULNERABLE_VERSIONS` is a
  compile-time list and is currently **empty**. Withdrawing a version that is later found vulnerable
  requires publishing a new Presto, not a server-side flip.
- **Digest verification covers the version cache only.** A request for a *non-bundled* version
  executes a marker-verified cache entry and nothing else, unless it names the one label a
  developer pinned to a file of their own (decision 8). A versionless request, or one naming the
  bundled version (unless that is the pinned label, which decision 8 routes first), walks a
  trusted, unverified search chain (`packages/presto/core/src/bb.rs`): the
  sidecar next to the executable, `~/.bb/bb`, and on Unix `bb` on `$PATH` (deliberately skipped on
  Windows, where a planted `bb.exe` could hijack it). An existing `BB_BINARY_PATH` operator override
  takes precedence over all of it, versioned requests included; only a request naming a custom
  `bb`'s label is refused instead (decision 8). Anyone who can write to those
  locations or set that variable already runs as the user.

For the same reason, the child-process controls above are **containment of a trusted binary, not a
sandbox**. A malicious `bb` running as the user can already reach the user's files; escapes available
only to a malicious child are explicitly out of scope, as the audit records
([`audit/security/2026-09-08-presto-noir/report.md`](../audit/security/2026-09-08-presto-noir/report.md)).

The project deliberately depends on AztecProtocol to introduce a publisher signature or attestation.
It will not maintain a parallel private signing scheme, a binary mirror, or claim that manual digest
review proves upstream authorship.

When upstream publishes a stable signing or attestation mechanism, adoption requires a deliberately
reviewed change: pin the upstream identity or key, verify the statement in CI and at runtime where
applicable, define migration behavior for older releases, and preserve fail-closed execution. Until
then the digest, cache re-hash and download budget remain defense in depth under an explicit
upstream-trust assumption.

### 2. Accept unauthenticated loopback discovery and explicit plaintext proving

The SDK discovers the service on fixed loopback ports and accepts a `/health` response only when it
matches the Presto health contract, including the scheme list for the route it intends to use. This
is a **shape check, not server authentication**.

Browser page and Web Worker clients use HTTPS for private proving by default. If that connection
fails, the SDK may make one bounded, witness-free HTTP `GET /health` request to produce a recovery
diagnosis. The diagnostic never serializes or transmits a witness, never POSTs over HTTP, never pins
HTTP, and cannot make the endpoint eligible for proving. Because any local process can bind the
fixed port and answer it, its output is best-effort repair guidance only.

**Node, Bun and SSR clients keep an HTTP-compatible default**, because the single-tenant headless CI
server is TLS-free. This is decided by runtime detection in `packages/sdk-core/src/lib/config.ts`,
not by the caller. A browser dApp may additionally expose an explicit, current-session escape hatch
on the one prover instance:

```ts
prover.setPrestoConfig({ httpsOnly: false, allowInsecureDowngrade: true });
await prover.checkPrestoStatus({ forceRefresh: true });
```

`allowInsecureDowngrade` is what re-opens HTTP after HTTPS has already worked — it clears the pin.
**Before HTTPS has ever succeeded in that client, `httpsOnly: false` is sufficient on its own**
(`packages/sdk-core/src/lib/presto-transport.ts`), so treat the pair as the correct thing to write,
not as two independent locks. Both must be real booleans — `"false"` is a truthy string, so coercing
would switch the opt-out *on* through a value that reads as off. A rejected setting throws and
changes nothing.

The equivalent on the shared client is `PrestoClient.configure()`.
`@alejoamiras/presto-noir` has no setter, but it accepts the same settings through its constructor's
`options.presto`, so a Noir integrator can opt into plaintext the same way. When Presto is
unavailable the backend proves in WASM, or throws under `fallback: "none"`.

In either plaintext mode, if proving is attempted while the real Presto is stopped, a hostile local
process — including one running as another user on a multi-user machine — can imitate `/health` on
the fixed HTTP port and receive the witness sent to `/prove`. Origin approval protects the *real*
service from browser sites; it cannot make an impostor enforce the same policy. A same-user
compromise can already reach the user's processes and files and is outside this threat model.

The SDK does not persist that choice. A reload or a new client is back to whatever the constructor
and the environment say — HTTPS-only unless the dApp itself passes the opt-out in again — and
integrating dApps must not copy it into local storage, cookies, URL parameters, or desktop
configuration.

### 3. Ship an unsigned Windows first installer

The Windows NSIS first installer is not Authenticode-signed, so SmartScreen shows **Unknown
publisher**. There is no signing configuration in `tauri.conf.json` or the release workflow; this is
an accepted distribution trade-off, not an oversight.

It does not relax the updater boundary: every subsequent updater payload must pass the embedded
Ed25519 verification, and the artifact size ceiling, before installation.

### 4. Restrict the headless server to single-tenant CI

The headless server has no approval UI and no desktop TLS lifecycle. It auto-approves localhost,
accepts `ALLOWED_ORIGINS` or `--allow-all`, and is supported only as an ephemeral CI test accelerator
on a single-tenant runner. Shared runners, long-running services, public listeners, and production
deployment are outside its supported threat model. Parallel instances require a private `PRESTO_HOME`
alongside `--port`, so two instances never share one config or version cache.

### 5. Per-origin admission is fairness, not protection from an approved attacker

A single origin may hold at most 4 `/prove/ultra-honk` jobs in flight, on top of the global inflight
cap. That bound exists so one busy dApp cannot monopolise the UltraHonk route, **not** to defend
against an origin the user has already approved.

It is narrower than it sounds, in three ways:

- **It is UltraHonk-only.** The Aztec `/prove` route admits with no per-origin cap at all
  (`packages/presto/core/src/server/prove.rs`), so an approved origin can occupy the global inflight
  capacity through that route alone.
- **Callers that send no `Origin` header are exempt**, and that is not only a dev/CI shape: the
  desktop app applies the same exemption (`packages/presto/core/src/server/auth.rs`). A non-browser
  local process is bounded only by the global cap.
- **`--allow-all` on the headless server** removes the origin dimension entirely.

So the honest claim is fairness between *browser* origins on *one* route. Availability against a
local process running as the user is not something this design provides.

### 6. Trust Aztec's npm scopes, including same-day publishes

From v6 the SDKs and the playground depend on `@aztec-labs/*` and `@aztec-foundation/*` (through v5,
`@aztec/*`). As of 2026-09-28:

- `@aztec-labs` is maintained by the npm users `nchamo` and `charlielye`;
- `@aztec-foundation` by a shared service account, `aztec-foundation-user-account`, and `ludamad`.

`@aztec-foundation/bb.js` carries SLSA provenance; the `@aztec-labs/*` packages carry none, as the
`@aztec/*` 5.x packages did not.

Every other dependency waits out a 7-day release-age quarantine. The Aztec names are exempt, in both
`bunfig.toml` (the workspace install) and `setup-aztec`'s npm configuration (the CLI installer's
separate, unlocked graph), because Aztec releases are consumed the day they ship. The exemption is
**exact names only**; a scope glob would let any new package under the scope skip quarantine
unreviewed. `scripts/bunfig-aztec-excludes.test.ts` holds the bunfig list equal to the lock, and
`scripts/aztec-installer-graph.ts` holds the installer list equal to what the installer resolved, on a
cache hit too, and fails any exempt `@aztec-labs` or `@aztec-foundation` package at a version other
than the release being installed. The residual risk is accepted: a compromised publish from either scope, including one
from the shared account, installs without an observation window.

Versions are held by **exact pins**, not dist-tags: `@aztec-foundation/bb.js`'s `prerelease` tag
already points at a v7 nightly. The SDK's published manifests keep those pins exact, and the playground's
production build installs only the adapter and core publications named in `published-sdk.json`, whose
provenance is verified. Upstream Aztec packages in that bundle are verified by lockfile integrity
only.

### 7. The verified-sites approver is a pause, not a second identity

The owner is the only required reviewer of `verified-sites-signing`, so the owner's own credentials,
or a token acting as the owner, can both land a list change and approve its signing. The review is a
deliberate pause before the seed is used, not an independent party.

This is accepted because the list is display-only. A forged list can put a ✓ and a chosen name beside
an origin, but it cannot approve that origin, bypass deny-by-default or a cooldown, or change what
`/health` returns, and the raw origin is always shown beside the name.

The controls narrow the gap rather than close it:

- the signing workflow takes no input, signs only the bytes whose SHA-256 its summary shows, and
  refuses if `main` no longer holds those bytes or the signing path it was approved with;
- the summary lists every signing-path change since the last signed list;
- every signed list lands as a public release-bot PR before it is published, and no job that holds
  the seed, the release-bot key or the KV token installs a dependency;
- publishing refuses a key change and a list that does not continue history, and a daily check
  alarms on either.

Residual: a malicious workflow change merged to `main` and then approved can exfiltrate the seed.
`main` is the trust boundary here as everywhere else, and the recovery is a key rotation
(`docs/RELEASE_RUNBOOK.md`, "Verified-sites list").

### 8. A developer's own `bb` for exactly one label

With developer mode on, Settings can pin one file of the user's own as the `bb` for one version
label (`packages/presto/core/src/custom_bb.rs`, `packages/presto/src-tauri/src/custom_bb.rs`). This
is the one deliberate exception to decision 1: no upstream digest vouches for that file, and Presto
runs it because the user chose it.

What bounds it:

- **One file, one label.** Only a request whose `x-aztec-version` equals the label reaches the
  file; every other request, versionless ones included, takes the official path. The label passes
  the same gate as a request (canonical semver, no build metadata, not revoked), so a revoked label
  cannot be pinned, and a label revoked later stops routing.
- **The hash is the pin.** Presto records the SHA-256 that Settings showed, and rehashes the file
  before every spawn. A changed, missing or newly unsafe file answers `503 custom_bb_unavailable`
  and never falls back to the official `bb`. The wire text is fixed: a site sees
  `x-presto-bb: custom` and never a path, a hash or `bb` output.
- **No other account may be able to change it**, checked when it is picked and at every spawn:
  - **Unix:** the file and every ancestor belong to the user or root, and nothing is
    world-writable. Group write is allowed only through the user's private group or a sticky
    directory, and an ACL entry that lets anyone else write is refused. The private-group test
    reads the account database through NSS, so a source that does not enumerate (sssd's
    default) can hide a second member; the rehash before every spawn catches a change made
    before it, and such an account can still race the hash and the spawn (#155).
  - **Windows:** the file must sit under `%USERPROFILE%`.
  - **macOS:** a quarantined file is refused, and so is one with no code signature on Apple
    Silicon. Presto checks that a signature is present, not that it is valid: the `--version` test
    run shows whether it lets the file start, and since the kernel checks pages as they are first
    used, a proof can still be killed on a page the test run never touched. Settings gives a
    command to copy; Presto never changes quarantine, signatures or the exec bit itself.
- **The user sees it.**
  - Before saving, the file runs once (`--version`), only after the user ticks that they built it
    or fully trust whoever did, and the run must pass.
  - While a pin is set, Settings opens on a banner, the tray names the label, and the approval
    popup says when a site's request will reach the file.
  - Turning developer mode off deletes the pin. While `BB_BINARY_PATH` is set, the label is refused
    rather than sent to the override.

Accepted residuals:

- **A local caller without `Origin` reaches it** with inputs of its choice and no popup, as it
  reaches the official `bb` (decision 5). A debug or sanitizer build raises what such a caller can
  learn.
- **An approved origin decides when the file runs**, by sending the label, and can infer the label
  from how responses differ. Approval is per origin, not per binary, and a site approved before the
  pin sees no new popup.
- **Same-user attacks stay out of scope**, as in decision 1. Malware running as the user can swap
  the file between the rehash and the spawn, or write a pin of its own. The libraries and
  configuration the file loads are not hashed. On Windows, a profile ACL the user loosened is
  trusted.
- **A wrong proof is still a 200.** Presto does not check what the custom build returns.
- **Uninstalling keeps the pin**, like every other setting, so a reinstall with developer mode on
  resumes routing.

## Not accepted

The decisions above do not authorize:

- binding a proving listener to a non-loopback interface;
- bypassing host or origin validation in the desktop app;
- sending a witness to a non-loopback SDK destination, or to a listener that never answered the
  health contract;
- persisting a plaintext-proving consent anywhere;
- installing an unsigned or incorrectly signed updater payload, or one exceeding the size ceiling;
- installing a release candidate on an install that has not chosen release candidates in Settings;
- letting the verified-sites list grant, skip or shorten an approval, or signing it with the updater
  key;
- executing a requested cached `bb` version whose integrity marker is absent or invalid;
- running a custom `bb` for any label but its own, with developer mode off, or once its hash or
  its file permissions fail the checks of decision 8, or answering its label with another `bb`;
  or
- representing a same-origin digest as proof of an uncompromised upstream publisher.

## Audit history

Independent security audits live under [`audit/security/`](../audit/security/), newest last. The most
recent covers the Noir surface — the two proving routes, the shared transport, the adapters, the
playground panel, and the npm release path — and its five findings were fixed before the packages
were promoted to npm `latest`. Reports there may use the project's former name; see
[`audit/README.md`](../audit/README.md).

Report behavior outside these documented boundaries through [SECURITY.md](../SECURITY.md).
