# Presto

Native prover for Aztec transactions and any Noir circuit. Bypasses browser WASM throttling by running the `bb` proving binary natively on your machine.

[![SDK](https://github.com/alejoamiras/presto/actions/workflows/sdk.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/sdk.yml)
[![SDK Core](https://github.com/alejoamiras/presto/actions/workflows/sdk-core.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/sdk-core.yml)
[![SDK Noir](https://github.com/alejoamiras/presto/actions/workflows/sdk-noir.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/sdk-noir.yml)
[![Presto](https://github.com/alejoamiras/presto/actions/workflows/presto.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/presto.yml)
[![App](https://github.com/alejoamiras/presto/actions/workflows/app.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/app.yml)
[![npm version](https://img.shields.io/npm/v/@alejoamiras/presto)](https://www.npmjs.com/package/@alejoamiras/presto)
[![SDKs: MIT](https://img.shields.io/badge/SDKs-MIT-green.svg)](packages/sdk-core/LICENSE)
[![App: AGPL-3.0](https://img.shields.io/badge/App-AGPL--3.0-blue.svg)](LICENSE)

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@alejoamiras/presto`](packages/sdk) | SDK — drop-in `PrestoProver` for Aztec dApps | [![npm](https://img.shields.io/npm/v/@alejoamiras/presto?label=npm)](https://www.npmjs.com/package/@alejoamiras/presto) |
| [`@alejoamiras/presto-noir`](packages/sdk-noir) | SDK — drop-in `UltraHonkBackend` for any Noir circuit, native through Presto with WASM fallback | [![npm](https://img.shields.io/npm/v/@alejoamiras/presto-noir?label=npm)](https://www.npmjs.com/package/@alejoamiras/presto-noir) |
| [`@alejoamiras/presto-core`](packages/sdk-core) | Transport and policy both SDKs share — loopback discovery, HTTPS-first pinning, fallback reasons | [![npm](https://img.shields.io/npm/v/@alejoamiras/presto-core?label=npm)](https://www.npmjs.com/package/@alejoamiras/presto-core) |
| [`packages/presto`](packages/presto) | Desktop tray app (macOS/Linux/Windows) + headless server for CI test acceleration; `/prove` (Aztec) and `/prove/ultra-honk` (Noir) | [![Presto](https://github.com/alejoamiras/presto/actions/workflows/presto.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/presto.yml) |
| [`packages/playground`](packages/playground) | [Live demo](https://playground.presto.build) — WASM vs accelerated comparison, Aztec transfer and Noir circuit | [![App](https://github.com/alejoamiras/presto/actions/workflows/app.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/app.yml) |
| [`packages/landing`](packages/landing) | Landing page at [presto.build](https://presto.build) | |
| [`@alejoamiras/presto-banners`](packages/banners) | `<presto-banner>` install banners for integrating dApps, keyed to `PrestoStatus` | [![Banners](https://github.com/alejoamiras/presto/actions/workflows/banners.yml/badge.svg)](https://github.com/alejoamiras/presto/actions/workflows/banners.yml) |

## Architecture

```
Aztec dApp                                   Noir dApp
    │  PrestoProver                              │  PrestoUltraHonkBackend
    │  (@alejoamiras/presto)                     │  (@alejoamiras/presto-noir)
    ▼                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  @alejoamiras/presto-core (PrestoClient)                            │
│  Browser: probe loopback HTTPS → healthy and scheme served? ───┐    │
│                            │ no                                │yes │
│                            ▼                                   ▼    │
│  witness-free HTTP diagnosis → WASM fallback      HTTPS POST /prove │
│                                                   or /prove/ultra-honk
└─────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
                                                ┌───────────────────┐
                                                │  Presto App       │
                                                │  (system tray)    │
                                                │       │           │
                                                │       ▼           │
                                                │   bb binary       │
                                                │   chonk | ultra_honk
                                                │       │           │
                                                │       ▼           │
                                                │     proof         │
                                                └───────────────────┘
```

## Quick Start

### For dApp developers (SDK)

```bash
npm install @alejoamiras/presto
```

```typescript
import { PrestoProver } from "@alejoamiras/presto";

const prover = new PrestoProver(); // zero-config; constructing it sends nothing
prover.setForceLocal(true); // proves in WASM until the visitor connects Presto
```

See the [SDK README](packages/sdk/README.md) for full API reference.

Browser prover instances are HTTPS-only by default. If HTTPS cannot connect, the SDK may issue one
bounded, witness-free HTTP health diagnostic so the dApp can distinguish disabled HTTPS, certificate
trust trouble, a privacy-limited reachable Presto, or an unconfirmed result. It never sends an
HTTP `/prove` or witness automatically; normal proving continues through WASM. A dApp may offer a
confirmed, current-tab-only HTTP escape hatch by setting both `httpsOnly: false` and
`allowInsecureDowngrade: true` on that prover instance.

> **Browser Local Network Access.** Public sites need permission in current Chrome and Firefox to
> reach the loopback presto, and the first request raises the prompt. Never check or prove on page
> load: read `loopbackPermission()` (it never prompts) and connect from an explained click, as in
> [Ask before you probe](packages/sdk/README.md#ask-before-you-probe). An explicit denial is surfaced as `permission-blocked` so an app
> can show site-permission guidance and Retry; under the browser HTTPS-only default, an
> unresolved/dismissed prompt normally appears as `secure-connection-unavailable` with an
> `unconfirmed` diagnosis. The SDK's loopback annotation does not bypass permission, and HTTPS is subject to the
> same address-space gate.

> **Versioning / dist-tags.** SDK `X.Y.Z` targets Aztec `X.Y.Z` — the published version is derived from the pinned `@aztec/stdlib` dependency. The standard release path publishes on npm's **`testnet`** dist-tag; **`latest`** is moved to it in a separate, deliberate step, so the two usually match and differ only while a newer line is being validated or after a rollback. The presto downloads the matching `bb` binary **at runtime**, so an Aztec version bump ships **SDK-only** — already-installed prestos need no re-release. `@alejoamiras/presto-core` and `@alejoamiras/presto-noir` carry their own semver (their `package.json` version, published once) and follow the same `testnet` → `latest` path. See the [release runbook](docs/RELEASE_RUNBOOK.md).

### For Noir circuits (`@alejoamiras/presto-noir`)

```bash
npm install @alejoamiras/presto-noir @aztec/bb.js@5.2.0
```

```typescript
import { Barretenberg } from "@aztec/bb.js";
import { PrestoUltraHonkBackend } from "@alejoamiras/presto-noir";
import circuit from "./target/circuit.json";

// Same surface as bb.js's UltraHonkBackend — native via Presto, WASM otherwise
const backend = new PrestoUltraHonkBackend(circuit.bytecode, () => Barretenberg.new());
backend.setForceLocal(true); // until the visitor connects Presto
const { proof, publicInputs } = await backend.generateProof(witness, {
  verifierTarget: "noir-recursive-no-zk",
});
```

Any circuit compiled with nargo, any bb verifier target, no Aztec node. Native proving needs
Presto **1.1.0** or newer (an older app does not advertise the scheme, so the backend proves in
WASM without sending anything); the transport
rules above — HTTPS-only in browsers, origin approval, no automatic HTTP `/prove` — are the same.
See the [presto-noir README](packages/sdk-noir/README.md).

### For users (Desktop App)

Download the latest release from [GitHub Releases](https://github.com/alejoamiras/presto/releases).

See the [Presto README](packages/presto/README.md) for installation and configuration.

## Security and privacy

Proving happens on your machine. A private witness goes to a loopback endpoint or to WASM in the
page — never to a server this project operates. [PRIVACY.md](PRIVACY.md) is the full account of what
is stored locally and what the software contacts over the network.

The [security model](docs/SECURITY_MODEL.md) records the trust boundaries and the trade-offs
consciously accepted at each one, including what the upstream `bb` digest check does and does not
prove, why browser proving is HTTPS-only by default while server runtimes are not, and why the
headless server is supported for single-tenant CI only. Read it before reporting something that
looks like a weakness.

Report vulnerabilities privately under [SECURITY.md](SECURITY.md). For installation help and bug
reports, see [SUPPORT.md](SUPPORT.md). Participation is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Development

```bash
bun install                              # Install dependencies
bun run test                             # Lint + typecheck + unit tests
bun run audit:dependencies               # npm + Rust security policy
bun run lint                             # Linting only (biome + pkg + rust)
bun run lint:fix                         # Auto-fix lint/format issues
bun run --cwd packages/playground dev    # Start playground dev server
bun run --cwd packages/sdk-core build     # Build the shared core
bun run --cwd packages/sdk build         # Build the Aztec SDK
bun run --cwd packages/sdk-noir build     # Build the Noir SDK
```

Fork deployments use Cloudflare Workers Static Assets plus KV; see the
[Cloudflare deployment guide](docs/CLOUDFLARE_DEPLOYMENT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository map, setup, testing, and pull-request
guidance. This project uses [conventional commits](https://www.conventionalcommits.org/) enforced by
commitlint; Husky + lint-staged run linting on pre-commit.

```bash
# Before pushing
bun run test             # Lint + typecheck + unit tests
bun run lint:actions     # Lint GitHub Actions workflows
```

| Tool | Purpose |
|------|---------|
| [Biome](https://biomejs.dev) | Linting and formatting (TS/JS/JSON) |
| [commitlint](https://commitlint.js.org) | Conventional commit message enforcement |
| [shellcheck](https://www.shellcheck.net) | Shell script linting |
| [actionlint](https://github.com/rhysd/actionlint) | GitHub Actions workflow linting |
| [cargo fmt](https://github.com/rust-lang/rustfmt) | Rust formatting (presto) |

## License

Split, deliberately.

**The four npm packages are [MIT](packages/sdk-core/LICENSE)** — `@alejoamiras/presto`,
`@alejoamiras/presto-core`, `@alejoamiras/presto-noir`, `@alejoamiras/presto-banners`. Each carries
its own `LICENSE`. They are client libraries: integrating one means bundling it and shipping that
bundle to your users, which is conveying a copy of it, and under AGPL that can require your combined
application to be AGPL-licensed too. MIT asks only that you keep the copyright and permission notice
with the code. Use them in closed-source products.

**Everything else is [AGPL-3.0-only](LICENSE)** — the desktop app, the headless server, the
playground, the landing site, and the build and release tooling. That is the part users run rather
than ship, so the copyleft falls on whoever distributes a modified prover or offers one over a
network, not on the dApps that call it. Third-party components keep their own terms regardless: the
desktop app's vendored fonts are SIL OFL 1.1 (see
[`packages/presto/src-tauri/frontend/fonts/LICENSES.md`](packages/presto/src-tauri/frontend/fonts/LICENSES.md)),
`@aztec/bb.js` and `@aztec/noir-acvm_js` are MIT, `@aztec/noir-noirc_abi` is MIT OR Apache-2.0, and
`@aztec/bb-prover`, `@aztec/foundation` and `@aztec/stdlib` ship no licence metadata but are
Apache-2.0 in the upstream `aztec-packages` repository at the pinned tag.

A contribution is accepted under the licence of the directory it lands in.

None of this is legal advice — if the boundary matters to your product, have counsel read it.
