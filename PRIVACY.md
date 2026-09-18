# Privacy Notice

**Last updated:** 2026-09-18

Presto proves locally. There are no user accounts, and the project adds no product analytics, no
advertising trackers, no remote crash reporting, and no application telemetry to the SDK packages,
the desktop app, the landing site, or the playground.

Specifically: no analytics or error-reporting dependency appears in any first-party `package.json`
or `Cargo.toml`; neither public page loads a third-party script or beacon; no Worker is configured
with Analytics Engine, Logpush, or tail consumers; and the desktop app's webview is locked to
`connect-src ipc: http://ipc.localhost`, so it can make no off-origin request at all.

Two honest caveats to that, below: the web pages load Google Fonts, and the Aztec dependency graph
contains OpenTelemetry exporters that nothing here configures.

## Private proving data

The SDK sends a private witness only to the configured loopback Presto endpoint, or processes it in
the WASM fallback inside the page. It never reaches a server this project operates. The SDK refuses
any non-loopback host, and the `/prove` POST is issued with `redirect: "error"` so a redirect cannot
forward the body off the machine.

`bb` is a subprocess that reads files, so the witness **is** written to disk. Each request gets its
own `prove-<random>/` directory under `prove-tmp/` in the application data directory (see the table
below) — deliberately not the shared OS temp directory. The parent is created `0700`, the per-run
directory `0700`, and the witness file `0600` at creation rather than chmod'ed afterwards; on Windows
an owner-only DACL is applied before any byte is written, and the whole thing fails closed on a
pre-planted file or symlink. The directory tree is removed when the request ends, success or failure.

A crash, a quit mid-proof, or an update restart can leave a witness on disk. Recovery is a sweep at
the next successful start, which only touches `prove-*` directories in that private parent, never
follows symlinks, and only deletes entries older than **24 hours** — a proof may legitimately run for
minutes, so a tighter floor would delete live work. On macOS and Linux, if no application data
directory can be resolved, Presto falls back to the OS temp directory; residue left there is
deliberately **never** swept, because prefix-matching in a shared `/tmp` could delete someone else's
directory.

Witness content is never written to the logs and never returned in an HTTP error body. Browser
prover instances are HTTPS-only by default: no proving payload and no `/prove` request goes over
HTTP. After an HTTPS connection failure the SDK may make one bounded, witness-free HTTP
`GET /health` request purely to improve recovery guidance; its response cannot make HTTP eligible
for proving.

Node, Bun and SSR clients stay HTTP-compatible for the headless CI server, and a browser dApp can
offer HTTP after an informed, current-session confirmation. In either plaintext mode another local
process can impersonate a stopped Presto on the fixed HTTP port and receive a witness — the
[accepted boundary](docs/SECURITY_MODEL.md#2-accept-unauthenticated-loopback-discovery-and-explicit-plaintext-proving)
explains why. **That consent is never persisted**, anywhere: not in storage, the URL, or desktop
configuration. Reloading restores HTTPS-only.

## Data stored on your device

Two roots, and they do not move together.

**`~/.presto/`** — configuration and the `bb` cache. `PRESTO_HOME` relocates these:

- `config.json` — settings and your **approved origins**, written atomically at `0600` in a `0700`
  directory;
- `versions/<version>/` — a verified `bb` binary, its integrity marker recording the archive and
  binary SHA-256, and a `.last-used` touch file. Retention is per release tier, under a 2 GiB cap.

**`~/.presto/certs/`**, the updater state, and the various lock and update-marker files also live
under `~/.presto`, but they resolve from your home directory **directly and ignore `PRESTO_HOME`** —
they are desktop-only concerns, and the headless server has neither TLS nor an updater.

**The local Certificate Authority is keyless.** Its signing key is generated in memory, signs one
`localhost` leaf, and is discarded — it is never written to disk, so the trusted anchor can mint
nothing else. It is also name-constrained to `127.0.0.1`, `::1` and `localhost`. If an older install
left a `ca.key` on disk, it is deleted on start, and HTTPS refuses to run if that deletion fails.

**The application data directory** holds the logs and the proving workspaces. It is
`$PRESTO_HOME/data/` when set, otherwise:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/presto/` |
| Linux | `~/.local/share/presto/` |
| Windows | `%LOCALAPPDATA%\build.presto.presto\` |

Logs rotate daily and **at most 7 files are kept**; they are also echoed to stdout. `panic.log` sits
beside them, appending one line per crash — it is neither rotated nor covered by that cap.

Presto also creates OS integration entries outside both roots when you enable the relevant features:
a login item or autostart entry, a crash-recovery task or user service, and the CA in your system or
browser trust store.

The **headless server persists no configuration at all** and logs only to stdout.

## Data in the browser

Three keys, all `localStorage`. No cookies are ever set, and there is no `sessionStorage`, no
service worker, and no storage library.

| Where | Key | What |
|---|---|---|
| Any site embedding `<presto-banner>` | `presto:banner:<variant>:<state>` | `{"until": <epoch ms>}`, 7 days by default — or `{"until":"never"}` if dismissed from the Sheet variant |
| `playground.presto.build` | `bb-crs-cache-version` | the proving-cache version marker |
| The desktop app's own windows | `presto.theme` | a cache of your theme choice; `config.json` stays authoritative |

An expired banner dismissal simply stops suppressing the banner; the key itself is not deleted. Every
storage access is guarded, so blocked site data degrades rather than breaks.

**The SDK packages persist nothing in the browser** — no consent flag, no endpoint, no identifier, no
cached status. The 10-second status cache is an in-memory private field on the client instance.

The playground uses IndexedDB only through `@aztec/bb.js`, which caches proving reference data there;
the playground's own code only *deletes* that store on a version bump, and sweeps legacy Aztec
wallet/PXE databases left by older visits. **Playground wallet state is ephemeral by design** — keys
are random per session and the store is created in ephemeral mode, so accounts do not survive a
reload. Clearing site data removes everything above. The landing site writes nothing.

## Network requests and service providers

**Automatic, on every page load of the landing site and the playground:**

- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — including `preconnect`, so the
  handshake happens early. Both pages set `Referrer-Policy: strict-origin-when-cross-origin`, so
  Google receives the origin rather than the full URL.
- **GitHub's API** — the landing page reads the current release tag.
- **`presto.build/releases/latest.json`** — the signed updater feed.

**If you embed `<presto-banner>` in your own dApp, it injects the same Google Fonts stylesheet into
your page** unless you set `fonts="none"`. The playground sets it; your site will not, unless you do.
This is published package behaviour, so it is your users' privacy, not just ours.

**On use:**

- **GitHub** — release assets and their published digests, when Presto downloads a `bb` version it
  does not have cached (rate-limited to 3 new versions per origin and 6 overall per 10 minutes). The
  updater request carries no version or platform in its URL, and polls 5 seconds after launch and
  then every 12 hours; `PRESTO_NO_UPDATE=1` disables it.
- **An Aztec node** — the playground ships a public testnet RPC endpoint as its default; an
  integrating dApp uses whatever node it configures.
- **A block explorer** — only when you click a transaction link in the playground.

The npm registry is a development-time destination only; installing the SDK is not something the
running software does.

Those providers receive routine request metadata — IP address, user agent, requested URL, time —
under their own terms and privacy policies. GitHub also processes issue, pull-request and
security-report interactions made through its service. The project does not combine any of that into
an analytics profile.

The Worker serving the updater feed reads only the request method and path, returns a stored file,
and stores nothing. It runs with Cloudflare's Workers Logs enabled at full sampling, so Cloudflare
retains request records for it under Cloudflare's own defaults.

### The OpenTelemetry caveat

`@aztec/telemetry-client` reaches the dependency graph transitively through `@aztec/*` packages, and
it bundles OpenTelemetry OTLP exporters. **No code in this repository imports, configures or
initialises them, and no OTLP endpoint is set anywhere**, so nothing is exported. The logging library
used by the SDKs is likewise obtained without configuring a sink, so it emits nothing unless your
application configures one. We cannot promise that the exporter code is fully removed from the
shipped playground bundle by tree-shaking — only that nothing activates it.

## Uninstalling

**Windows** runs the teardown automatically: it removes the CA from your trust store, deletes
`~/.presto/certs/`, and removes the autostart entry and crash-recovery task. If it cannot *verify*
the certificate removal, it leaves a file with manual instructions.

**macOS and Linux have no uninstall hook.** Dragging the app to the trash, or `apt-get remove`,
leaves everything behind — **including the trusted CA in your certificate store**. Run
`Presto --prepare-uninstall` first. It removes the autostart entry, the crash-recovery task, and —
only if this install owns them — the certificate trust and `~/.presto/certs/`. It is
ownership-checked, so a second copy sharing your account's state is left intact.
`Presto --remove-ca-trust` removes the trust alone.

**No uninstall path removes** `~/.presto/config.json` and your approved origins, the `bb` version
cache, the updater state, the logs, or the proving-workspace directory. That is deliberate — a
reinstall keeps your choices — so delete those by hand if you want the state gone. Inside the app you
can remove an approved site or remove certificate trust from Settings; there is no single "clear all
data" control.

## Reports you send us

If you email a security or conduct report, what you send is used to investigate and respond to it,
and retained only as long as that or a legal obligation requires.

**Review logs before sharing them.** They contain the origin of every dApp that has used Presto —
effectively a list of the Presto-enabled sites you visit — as well as local filesystem paths that
reveal your username and folder layout, `bb`'s own diagnostic output, Aztec version strings and
download URLs, and, on Linux, the paths of your Firefox profiles. A private witness is never logged.
Never send a real witness, wallet material, or credentials.

Questions about this notice: [alejo@aztec.foundation](mailto:alejo@aztec.foundation).
