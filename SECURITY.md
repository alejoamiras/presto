# Security Policy

## Supported versions

Security fixes are provided on a fix-forward basis for:

| Component | Supported line |
|---|---|
| Presto desktop app | Current stable GitHub release |
| `@alejoamiras/presto` | Version on npm's `latest` dist-tag |
| `@alejoamiras/presto-core` | Version on npm's `latest` dist-tag |
| `@alejoamiras/presto-noir` | Version on npm's `latest` dist-tag |
| `@alejoamiras/presto-banners` | Version on npm's `latest` dist-tag |
| Prereleases and the `testnet` dist-tag | Best effort while actively being evaluated |
| Older releases, and the deprecated `bootstrap` tag | No guaranteed fixes |

When practical, update to the latest stable version before reporting. A security fix may require a
new release rather than a patch to an older line.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email
[alejo@aztec.foundation](mailto:alejo@aztec.foundation) with the subject `[presto security]` and
include:

- the affected component and version;
- operating system, and browser or runtime, where relevant;
- impact, and the assumptions required to reproduce it;
- minimal reproduction steps or a proof of concept; and
- any suggested mitigation.

Do not include real private witnesses, credentials, signing keys, tokens, or third-party personal
data. Use synthetic test data, and encrypt especially sensitive supporting material before sending
it — ask for a preferred transfer method in the initial email.

This is a solo-maintained project, not a staffed security desk. The target is to acknowledge a
complete report within three business days and give an initial assessment within seven, but those
are best-effort targets rather than an SLA. Please allow a reasonable remediation and release window
before disclosure.

## Scope

Reports may cover the four npm packages, the desktop app, the headless CI server, the
updater and release path, and the project-hosted landing and playground code. Vulnerabilities in
Aztec, `bb`/Barretenberg, GitHub, npm, Cloudflare, Tauri, browsers, or other dependencies should also
be reported to their respective maintainers where the defect is upstream.

**Read [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md) before reporting.** It records the trust
boundaries this project has consciously accepted — upstream `bb` publisher trust, unauthenticated
loopback service discovery, plaintext proving on server runtimes, the unsigned Windows installer, and
the CI-only headless server. Re-reporting one of those as a novel finding costs us both time.

A **bypass** of one of those boundaries, a **broader impact** than the one documented, or a
**materially different precondition** is still in scope and should be reported privately. So is
anything that contradicts what that document claims the code does.

Good-faith research that avoids privacy violations, service disruption, destructive actions, and
access to data that is not yours is welcome. No bug bounty or payment program is currently offered.

## What this project already does

So you can tell a finding from a design:

- Proving is local. A private witness goes to a loopback endpoint or to WASM in the page, never to a
  project-operated server. See [PRIVACY.md](PRIVACY.md).
- Browser proving is HTTPS-only by default, and a failed HTTPS attempt cannot silently become an
  HTTP one.
- Origin approval is deny-by-default, with a curated verified-sites registry for display only.
- Updater payloads are Ed25519-signed and verified independently of any OS package signature.
- Cached `bb` binaries are digest-checked on download and re-checked before execution; a requested
  version with a missing or invalid marker fails closed.
- Releases publish with npm provenance and are verified after publish.
