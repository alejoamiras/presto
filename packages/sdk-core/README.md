# @alejoamiras/presto-core

The transport and policy layer every Presto SDK adapter shares: how to find the local
[Presto](../presto/README.md) native prover on loopback, which protocol to trust, when a proof may go
native and when it must fall back, and the status a UI can show. It has no `@aztec/*` dependency, so
adapters for different proof systems can build on it without pulling in each other's toolchains.

You normally do not install this package directly:

- Aztec transactions: [`@alejoamiras/presto`](../sdk/README.md) (`PrestoProver`).
- Any Noir circuit: `@alejoamiras/presto-noir` (`PrestoUltraHonkBackend`).

Both depend on this package at an exact version.

## Installation

```bash
npm install @alejoamiras/presto-core
```

## API

- `PRESTO_SCHEME_CHONK`, `PRESTO_SCHEME_ULTRA_HONK` — the proving schemes a Presto advertises in
  `/health.schemes`; an adapter checks for the scheme its route needs before proving natively.

The client, transport, status types, and fallback rules move here from `@alejoamiras/presto` with
the next release of this package; until then this README documents only what the barrel exports.
