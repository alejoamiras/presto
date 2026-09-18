# Security Model

**Status:** accepted project policy

**Last reviewed:** 2026-09-18

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
- **`bb` is published by AztecProtocol.** Presto downloads it from the upstream `aztec-packages`
  GitHub releases and neither builds nor publishes it.
- **Desktop releases are published by this project.** macOS artifacts are signed and notarized;
  Windows first-install packages are intentionally unsigned. All updater payloads are Ed25519-signed
  and verified independently of any OS package signature.
- **npm packages are published by this project** through GitHub OIDC with provenance, and verified
  after publish.

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
  value, before the download is accepted.

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

The same reasoning governs the Windows `bb.exe` sidecar, which is pinned by SHA-256 in
`scripts/copy-bb.ts`. Pins are never auto-generated — downloading and recording whatever arrived is
circular — so each carries `provenance: "manual-review"` and the resolver fails closed on anything
else. `provenance: "attestation"` is reserved for when upstream signs.

Three further consequences follow from trusting the publisher, and none of them is a bug to report:

- **There is no minimum-safe-version floor.** The `x-aztec-version` header names an *Aztec* release,
  and many Aztec versions share one `bb`, so a "newer is safer" floor would break legitimate older
  dApps. Any well-formed version upstream published is accepted
  (`packages/presto/core/src/versions/version_policy.rs`).
- **Revocation is reactive and ships in an app release.** `KNOWN_VULNERABLE_VERSIONS` is a
  compile-time list and is currently **empty**. Withdrawing a version that is later found vulnerable
  requires publishing a new Presto, not a server-side flip.
- **Digest verification covers the version cache only.** A request for a *non-bundled* version
  executes a marker-verified cache entry and nothing else. A versionless request, or one naming the
  bundled version, walks a trusted, unverified search chain (`packages/presto/core/src/bb.rs`): the
  sidecar next to the executable, `~/.bb/bb`, and on Unix `bb` on `$PATH` (deliberately skipped on
  Windows, where a planted `bb.exe` could hijack it). An existing `BB_BINARY_PATH` operator override
  takes precedence over all of it, versioned requests included. Anyone who can write to those
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

## Not accepted

The decisions above do not authorize:

- binding a proving listener to a non-loopback interface;
- bypassing host or origin validation in the desktop app;
- sending a witness to a non-loopback SDK destination, or to a listener that never answered the
  health contract;
- persisting a plaintext-proving consent anywhere;
- installing an unsigned or incorrectly signed updater payload, or one exceeding the size ceiling;
- executing a requested cached `bb` version whose integrity marker is absent or invalid; or
- representing a same-origin digest as proof of an uncompromised upstream publisher.

## Audit history

Independent security audits live under [`audit/security/`](../audit/security/), newest last. The most
recent covers the Noir surface — the two proving routes, the shared transport, the adapters, the
playground panel, and the npm release path — and its five findings were fixed before the packages
were promoted to npm `latest`. Reports there may use the project's former name; see
[`audit/README.md`](../audit/README.md).

Report behavior outside these documented boundaries through [SECURITY.md](../SECURITY.md).
