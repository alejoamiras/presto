# Presto cleanup recon

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Release baseline selection | `packages/presto/scripts/resolve-updater-baseline.ts` and focused tests | adapt |
| Release DAG contracts | `release-contract.test.ts` and release workflow status gates | adapt |
| Dependency audits | `scripts/dependency-audit.ts`, three Cargo audit invocations, frozen installs | adapt |
| Aztec compatibility validation | `check-aztec-update.ts` and `update-aztec-version.ts` | adapt |
| CI bootstrap | `setup-presto` and `setup-aztec` composites | adapt |
| JS/TS lint | Root `biome.json` and package/root scripts | adapt |
| Rust lint | Three independent manifests plus existing prepared native CI jobs | adapt |
| New age policy | No resolved-entry/action publication-age verifier found; searched `scripts/`, `.github/`, and tests for age/timestamp/tag checks | build new |

## Conventions and collision risks

- Root tests use colocated `*.test.ts` files and Bun's test runner.
- Workflow behavior is pinned by string-level contract tests as well as actionlint.
- Release and updater jobs are security-sensitive; avoid touching auth probes, identity/readiness,
  monitoring, signing, promotion, or ordinary release machinery outside the named exception.
- Package aliases, three independent Cargo lockfiles, exact Aztec cohorts, and composite Action pins
  create four distinct dependency representations that the policy must reconcile.
- Generated release-feed bindings are excluded from lint and must remain excluded.
- Existing run isolation and platform CI should be reused; no new local fixed-port service path is needed.

## Search trail

Recon inspected root/package manifests, all three Cargo manifests and locks, `bunfig.toml`, Biome
configuration, Dependabot configuration, workflow/composite pins, release resolver/tests, dependency
audit/update scripts, root scripts, and current runbook/status documents. Git history confirmed the
first-release exception entered with the launch infrastructure commit; no later implementation exists
on the current branches to restore wholesale.
