# Presto changelog

## 1.0.0 - Unreleased

- First Presto desktop and headless release, with a separate OS identity and fresh local state.
- Native proving remains wire-compatible with the previous product's SDK.
- Manual installation is required; no settings, certificates, caches, approvals, or binaries migrate.
- A fresh password-protected updater key and an offline recovery copy are required before RC1.
- RC1 is never promoted to the public feed. RC1 → 1.0.0 must pass the same-key updater matrix.
- SDK releases use npm trusted publishing and verified provenance.
- Publication and feed promotion remain separate and append-only.
