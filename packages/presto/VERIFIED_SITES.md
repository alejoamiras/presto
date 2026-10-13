# Recognized Sites Registry

`verified-sites.json` is a curated list of origins that the Presto
maintainers recognize. When one of these origins requests authorization, the
popup shows the friendly name + a verified ✓ next to the raw origin, instead
of just the raw origin string.

## **NOT a security guarantee**

The verified ✓ means **we (the maintainers) recognize this origin string**.
It does **not** mean the site is currently trustworthy.

- If an attacker hijacks DNS for a listed domain, the popup will still show
  the verified ✓.
- If a listed Chrome extension's auto-update is compromised, the popup will
  still show the verified ✓.
- If you reuse a verified name in a phishing context (typosquatted origin
  not on the list, etc.), the badge will NOT appear — but the raw URL is
  always shown, so check it before clicking Allow.

The badge is a **recognition aid**, not a safety verdict. It helps users
notice when an origin they personally trust is the one asking for permission,
especially when origin strings are opaque (e.g. `chrome-extension://...`).
Nothing else reads the list: approvals, deny-by-default, cooldowns and
`/health` behave the same for listed and unlisted origins.

## Format

```json
{
  "$schema": "./verified-sites.schema.json",
  "schemaVersion": 1,
  "version": 1,
  "entries": [
    {
      "origins": ["https://nulo.sh", "chrome-extension://jlmiaokmjoicmclelpiiocdhncddkdmc"],
      "displayName": "Nulo",
      "description": "Wallet for the Aztec network",
      "curatedBy": "alejoamiras",
      "addedAt": "2026-05-28"
    }
  ]
}
```

One strict parser (`presto_core::verified_sites::list`) enforces these rules in
the PR gate and in CI's signing and publishing jobs. Unknown fields are refused
at every level, and the whole file is at most 64 KiB.

| Field | Required | Rules |
|-------|----------|-------|
| `$schema` | no | Exactly `./verified-sites.schema.json` (editor hints only). |
| `schemaVersion` | yes | `1`. Changes only with a breaking format change. |
| `version` | yes | Integer, 1 to 2^53 − 1. **Raise it in every PR that changes the file**, by 1 to 100 over the newest signed record, or 0 before the first (see Versions). |
| `entries` | yes | 0–256 entries. An empty list is valid: it removes every badge. |
| `entries[].origins[]` | yes | 1–16 per entry, unique across the list, at most 256 bytes each. `https` or `chrome-extension` only, in canonical form: `scheme://host[:port]`, lower case, no default port, no path, no trailing slash. ASCII only — use Punycode A-labels for IDN (`xn--nlo-zna.sh`, NOT `nülo.sh`). |
| `entries[].displayName` | yes | Shown in the popup. 1–64 printable ASCII characters, no `<`, `>` or backtick, no leading or trailing space. |
| `entries[].description` | no | Curator note, **NOT shown in the popup**. At most 200 bytes; no `<`, `>`, backtick, control, bidi or zero-width characters. |
| `entries[].curatedBy` | yes | GitHub username of the curator who reviewed or added the entry. |
| `entries[].addedAt` | yes | A real calendar date, `YYYY-MM-DD`; audit trail only. |

The bytes are signed exactly as committed, so keep the file's formatting as it
is; `.gitattributes` keeps Windows checkouts from rewriting its line endings.

## Versions

Every signed list has a version, and a signed list never replaces a newer one.
The PR gate requires the file's `version` to be above the newest record in
`verified-sites/history/` (or equal to it with identical bytes) and at most
100 above it, counting from 0 before the first record, so a typo cannot burn
the counter.

## Adding or changing an entry

1. Open a PR that edits `verified-sites.json` and raises `version`.
2. Use the canonical origin form. Validate locally: launch the Presto,
   trigger the popup from the listed origin, confirm the ✓ renders.
3. Review by the curator (currently `@alejoamiras` — enforced via
   `.github/CODEOWNERS`).
4. The PR gate parses the list strictly, checks the version rules and every
   signed record, round-trips a throwaway signature through the production
   signer and verifier, and writes the change against the live list to the
   job summary.
5. After the merge, **Sign Verified Sites** waits for the curator's approval
   of the `verified-sites-signing` environment. Its summary shows the version,
   the SHA-256 of the exact bytes to sign (with the command that reproduces
   it), the changes, and any change to the signing path since the last
   signed list. Approve only what the summary shows.
6. The signed list lands as a release-bot PR adding
   `verified-sites/history/<version>.json` and its `.minisig`, which merges
   on its own once its checks pass. That merge runs **Publish Verified
   Sites**, which serves it at `https://presto.build/releases/verified-sites.json`.

### Which origins qualify

- **Production origins only** — the origin a user actually visits. A host
  that redirects (`www.` → apex) is not an origin the popup will ever show,
  so it gets no entry.
- **No preview or branch deployments.** Per-branch and per-PR hosts
  (`<branch>-<project>.<account>.workers.dev`, `*.pages.dev` previews,
  staging subdomains) change hands and content freely; listing one would
  let any preview build wear the badge. A `workers.dev` host qualifies only
  while it *is* the site's canonical deployment.
- **One entry per product**, listing every production origin of that product
  (`origins` is an array), its website and its Chrome extension alike. Add a
  second entry only for a distinct product.
- The `description` is a curator note (what the site is, which Presto route
  it uses); it is not rendered.

## Browser extensions

| Browser | Scheme | Curatable? |
|---------|--------|------------|
| Chrome | `chrome-extension://<id>` | **Yes** — IDs derive from the extension's manifest `key` (or the signing key) and are stable across installs. |
| Firefox | `moz-extension://<uuid>` | **No** — the UUID is random for each browser profile, so no single origin names the extension for every user. |
| Safari | `safari-web-extension://<id>` | **No** — same reason as Firefox. |

So the list accepts `https` and `chrome-extension` origins only.

## Removal

Open a PR removing the entry (and raising `version`). Reasons to remove:

- Project abandoned or domain ownership transferred.
- Scope no longer fits (e.g. the project is no longer Aztec-related).
- Identity changed (e.g. a major rebrand makes the existing `displayName`
  misleading).

## Signing and history

- **Key.** `verified-sites/key.pub` is a stock minisign public key, used for
  nothing else (the updater has its own). Its seed lives only in the
  `verified-sites-signing` environment and in the maintainer's password
  manager.
- **Signature.** Minisign's prehashed format with the fixed trusted comment
  `presto-verified-sites-v1`. Any record can be checked by hand:
  `minisign -Vm verified-sites/history/<N>.json -p verified-sites/key.pub`.
- **History.** `verified-sites/history/` holds every signed list, byte for
  byte, beside its signature. Only the release bot adds records, and the PR
  gate refuses any change to an existing one. After a key rotation, the old
  key moves to `verified-sites/retired-keys/<KEYID>.pub` so older records
  still verify.
- **Served document.** `https://presto.build/releases/verified-sites.json` is
  one compact JSON object, `{"schema":"presto-verified-sites-envelope-v1","list":"<base64>","signature":"<base64>"}`,
  holding the newest record and its signature.

Signing, publishing, recovery and key rotation are in
[`docs/RELEASE_RUNBOOK.md`](../../docs/RELEASE_RUNBOOK.md#verified-sites-list).

## In the app

The desktop app compiles `verified-sites.json` in at build time and reads that
copy. If it ever fails to load in a release build, the registry loads as empty
and a `tracing::error!` is logged; the popup falls back to showing only the
raw origin — no crash. Debug builds (`cargo tauri dev`) panic immediately so
developer errors surface loudly. `build.rs` also parses the file as JSON
during `cargo build`, so malformed JSON fails the build before it can ship.
