# Presto Playground

Interactive web app for comparing in-browser WASM proving against native accelerated proving on Aztec. Deploy a token contract, transfer tokens, and see the speed difference side by side — or prove a Noir circuit with UltraHonk, no Aztec node needed.

[![App](https://github.com/alejoamiras/presto/actions/workflows/app.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/app.yml)

## Live Demo

[playground.presto.build](https://playground.presto.build)

## Features

- Side-by-side comparison of WASM vs accelerated proving
- Asks before it contacts Presto: the page starts in In-browser mode and sends nothing to this
  computer until the visitor connects
- Embedded wallet with in-browser PXE — no extensions required
- Token deploy and private transfer flow
- **Prove Noir Circuit**: the committed `hashchain` fixture (`fixtures/noir/hashchain`, 1,024 chained Pedersen hashes — about 10 s in WASM, about 2 s natively) proven with bb.js's UltraHonk in the browser or natively through Presto's `/prove/ultra-honk` (`@alejoamiras/presto-noir`), timed and checked byte-for-byte against the committed proof
- ASCII terminal animation showing proof phases in real time
- HTTPS recovery with diagnosis-specific guidance and a confirmed, current-tab-only HTTP escape hatch
- Diagnostics export for debugging

### Connecting to Presto

Chrome and Firefox ask before a site reaches apps on the visitor's computer, so the playground never
contacts Presto on load. It reads the site's stored decision without prompting
(`loopbackPermission()`): a site the browser already allowed connects with no click; a blocked site
shows how to allow it in site settings, with no dialog; anything else stays In-browser with
**Connect Presto →** in Services. Choosing Presto (that link or the mode switch) opens a dialog that
says the browser will ask, what the site uses the permission for and how to undo it; only
**Continue** makes the first request. While the browser may still be asking, a check that got no
answer shows "waiting for your browser" with **Try again**, never "not found". A block, or a reset to
"ask" after a grant, returns the page to In-browser mode and discards any check still running; the
permission is re-read before every run, so browsers that report no changes are covered too. Consent
lives in memory only; the browser's permission is the durable record. `PrestoStatusController`
(`src/presto-status.ts`) owns all of it. It shares the SDK consent example's known limit: permission
reads are asynchronous, so two that overlap a silent change can be applied out of order, and a request
may then meet the browser's question again. The browser still decides every request.

### HTTPS recovery

Browser proving is HTTPS-only by default. When HTTPS cannot connect, the playground keeps Local
Network Access permission guidance separate from secure-connection recovery, explains the SDK's
best available diagnosis, and offers **Retry secure connection**. **Use HTTP for this session** first
warns that private proving data may be exposed to another local user or process. On confirmation it
sets `httpsOnly: false` and `allowInsecureDowngrade: true` only on the in-memory prover and
force-refreshes status. The choice is not written to local storage, cookies, URL parameters, or
desktop configuration and resets on reload. There is no production `?httpsOnly=false` switch. The
consent applies to the Aztec actions only: the Noir panel keeps the browser's HTTPS-only default
and falls back to in-browser proving when HTTPS cannot connect.

## Development

### Prerequisites

- [Bun](https://bun.sh)
- An Aztec node URL (testnet or local sandbox)

### Dev Server

```bash
bun run playground   # from repo root
# or
cd packages/playground && bun run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZTEC_NODE_URL` | Yes | Aztec node RPC endpoint |

Injected at build time via Vite. The playground always pays fees through the **canonical salt=0 Sponsored FPC** (auto-deployed on the local sandbox; deployed + funded on v5 testnet) — no salt configuration needed.

## Testing

```bash
bun run test:unit              # Unit tests
bun run test:e2e               # E2E tests (mocked project)
bun run test:e2e:local-network # E2E tests against local Aztec sandbox
bun run test:e2e:lna           # Real Local Network Access gate (Chromium), playground and landing
bun run test:e2e:smoke         # Smoke tests against deployed environment
```

E2E tests use [Playwright](https://playwright.dev). Specs that prove natively select Presto with
`connectPresto(page)` (`e2e/connect.ts`), the way a visitor does. `test:e2e:lna` runs the page
against Chromium's real Local Network Access gate: a page-level request recorder on both Presto
ports proves nothing leaves the page before consent, on the playground and on the landing page. The
mocked project stays network-free: the Noir specs mock `/health` and `/prove/ultra-honk`, and the
offline-Presto case selects a stub WASM source with `?noirStub=true` (a test-only URL parameter; it
never proves) while blocking any CRS or worker download. The smoke project proves the fixture with
real bb.js WASM in Chromium and, with `PRESTO_URL` set, natively.

## Build and Deployment

```bash
bun run build   # Output: dist/
```

Deployed with Cloudflare Workers Static Assets at `playground.presto.build`. `app.yml` is the PR gate (lint, typecheck, unit, e2e). The live deploy is a manual `release-sdk.yml` dispatch: choose `sdk-and-playground` for a candidate SDK release plus deploy, or `playground-only` to deploy without publishing npm.

## License

[AGPL-3.0](../../LICENSE)
