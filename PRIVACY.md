# Privacy Notice

**Last updated:** 2026-09-18

Presto proves locally. There are no user accounts, and the project adds no product analytics, no
advertising trackers, no remote crash reporting, and no application telemetry to the SDK packages,
the desktop app, the landing site, or the playground. No analytics or error-reporting dependency
appears in any package manifest, and neither the landing site nor the playground loads a third-party
script.

## Private proving data

The SDK sends a private witness only to the configured loopback Presto endpoint, or processes it in
the WASM fallback inside the page. It never reaches a server this project operates.

On the machine, the desktop app and the headless server write the witness into an owner-only
temporary workspace under their private `prove-tmp` directory, so the local `bb` process can read
it. Inputs reach `bb` as files, never as command-line arguments. The workspace is removed when the
request ends; if a crash leaves residue, it is swept conservatively on a later successful start, and
only from that private parent directory.

Witness input is not intentionally written to the project's logs and is never sent to a
project-operated server. Browser prover instances are HTTPS-only by default: no private proving
payload and no `/prove` request goes over HTTP. After an HTTPS connection failure the SDK may make
one bounded, witness-free HTTP `GET /health` request purely to improve recovery guidance; its
response cannot make HTTP eligible for proving.

Node, Bun and SSR clients stay HTTP-compatible for the headless CI server, and a browser dApp can
offer HTTP after an informed, current-session confirmation. In either plaintext mode another local
process can impersonate a stopped Presto on the fixed HTTP port and receive a witness — the
[accepted boundary](docs/SECURITY_MODEL.md#2-accept-unauthenticated-loopback-discovery-and-explicit-plaintext-proving)
explains why. The SDK does not persist that consent anywhere, and an integrating dApp must not store
it in local storage, cookies, URL parameters, or desktop configuration.

## Data stored on your device

The desktop app keeps its state under `~/.presto`, or under `$PRESTO_HOME` when one is set:

- `config.json` — settings and approved origins (with `config.json.lock` and a temp sibling during
  writes);
- `versions/` — verified `bb` binaries and their integrity markers;
- `certs/` — locally generated HTTPS certificates, present only when Encrypted Connection is
  enabled;
- autostart, updater and ownership/recovery state.

**The local Certificate Authority is keyless.** Its signing key is generated in memory, signs one
`localhost` leaf, and is then discarded — it is never written to disk, so the trusted anchor can mint
nothing else. The CA is also name-constrained to `127.0.0.1`, `::1` and `localhost`.

Logs are daily-rotating, plus a `panic.log` that receives a one-line record on a crash. They live
outside the Presto home, in the OS application-data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/presto/logs/` |
| Linux | `~/.local/share/presto/logs/` |
| Windows | `%LOCALAPPDATA%/build.presto.presto/logs/` |

None of this leaves the device unless a feature explicitly makes a network request.

## Data in the browser

- `@alejoamiras/presto-banners` stores a dismissal per banner variant and state in `localStorage`,
  for seven days, or indefinitely if dismissed from the Sheet variant.
- The playground keeps a proving-cache version marker in `localStorage` and uses IndexedDB for
  `bb.js` proving data; it also deletes legacy Aztec wallet/PXE databases left by older visits.
  Wallet state and any confirmed HTTP fallback are in memory only and reset on reload.
- **The SDK packages store nothing in the browser** — no consent, no endpoint, no identifier.

Clearing site data in the browser removes all of the above.

## Network requests and service providers

Depending on the component and the feature in use, the software may contact:

- **GitHub** — the API and release asset service, for Presto releases, upstream AztecProtocol `bb`
  releases, and their published digests;
- **the project's own sites and updater feed** — `presto.build` and `playground.presto.build`, served
  by Cloudflare Workers Static Assets, and the signed updater feed, served by a narrowly scoped
  Cloudflare Worker reading from KV;
- **the npm registry** — when you install one of the SDK packages;
- **the configured Aztec node** — when using the playground or an integrating dApp. Which node that
  is, is your choice, not the project's.

Those providers receive routine request metadata — IP address, user agent, requested URL, time —
under their own terms and privacy policies. GitHub also processes issue, pull-request and
security-report interactions made through its service. The project does not combine any of that
provider metadata into an analytics profile.

## Uninstalling

The Windows uninstaller runs the teardown automatically. On macOS and Linux there is no uninstall
hook, so run `Presto --prepare-uninstall` before deleting the app: it removes the autostart entry,
the crash-recovery task, and — only if this install owns them — the certificate trust and generated
certs in `~/.presto/certs/`. It is ownership-checked, so a second install sharing the same account's
state is left alone.

Your `config.json` and approved origins are deliberately **not** removed, so that reinstalling keeps
your choices. Delete `~/.presto` and the log directory by hand if you want the state gone.

## Reports you send us

If you email a security or conduct report, what you send is used to investigate and respond to it,
and retained only as long as that or a legal obligation requires. Please review logs before sharing
them — they can contain approved origin names, local filesystem paths, and `bb` diagnostics — and
never send a real private witness, wallet material, or credentials.

Questions about this notice: [alejo@aztec.foundation](mailto:alejo@aztec.foundation).
