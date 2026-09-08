#!/usr/bin/env bash
# Consume a PUBLISHED tarball the way a real dApp does — default `npm install` on a fresh Node — and
# prove two things nothing else in the repo checks:
#   1. the packed `dist` exports/types RESOLVE, typecheck, and load (workspace consumers use the source
#      `exports`, so a broken publish rewrite or missing dist would otherwise ship undetected);
#   2. for a package that pins `@aztec/stdlib`: default npm resolves an EXACT-version host to a SINGLETON
#      `@aztec/stdlib` graph. A conflicting-version host is recorded for comparison only.
#
# The host's files come from the package's profile under scripts/tarball-consumer/<profile>/ (see
# scripts/npm-packages.ts): index.ts, runtime-check.mjs, tsconfig.json, and optional
# host-dependencies.json. The tarball under test is always the host's own copy of the package; a
# profile extra cannot replace it with a registry version.
#
#   scripts/sdk-tarball-consumer.sh <absolute-path-to-tarball> [package-key]
set -euo pipefail

TARBALL="${1:?usage: sdk-tarball-consumer.sh <tarball> [package-key]}"
PACKAGE_KEY="${2:-presto}"
[ -f "$TARBALL" ] || { echo "tarball not found: $TARBALL" >&2; exit 2; }
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck disable=SC2016  # single quotes are deliberate: the JS must not shell-expand
read -r PACKAGE_NAME PROFILE < <(bun -e '
  import { CONSUMER_PROFILE_ROOT, resolvePackage } from "./scripts/npm-packages.ts";
  const pkg = resolvePackage(process.argv[1]);
  console.log(`${pkg.name} ${CONSUMER_PROFILE_ROOT}/${pkg.consumerProfile}`);
' "$PACKAGE_KEY")
PROFILE_DIR="$REPO_ROOT/$PROFILE"
[ -d "$PROFILE_DIR" ] || { echo "consumer profile not found: $PROFILE_DIR" >&2; exit 2; }
EXTRAS=""
[ -f "$PROFILE_DIR/host-dependencies.json" ] && EXTRAS="$PROFILE_DIR/host-dependencies.json"

# Count DISTINCT @aztec/stdlib install locations in a consumer dir (1 = singleton graph).
count_stdlib() {
  local dir="$1"
  ( cd "$dir" && find node_modules -type d -path '*@aztec/stdlib' 2>/dev/null | wc -l | tr -d ' ' )
}

make_host() {
  # make_host <dir> [aztec-version]
  local dir="$1" aztec="${2:-}"
  mkdir -p "$dir"
  bun "$REPO_ROOT/scripts/tarball-consumer/host-manifest.ts" "$dir" "$TARBALL" "$PACKAGE_NAME" "$aztec" "$EXTRAS"
  cp "$PROFILE_DIR/tsconfig.json" "$PROFILE_DIR/index.ts" "$PROFILE_DIR/runtime-check.mjs" "$dir/"
}

# The exact-host pin comes from the ARTIFACT UNDER TEST (scripts/tarball-consumer/exact-pin.ts): an
# aztec-derived package without it fails there; a package that does not ship the dependency gets a
# plain host and no singleton gate.
AZTEC_PIN="$(bun "$REPO_ROOT/scripts/tarball-consumer/exact-pin.ts" --package "$PACKAGE_KEY" "$TARBALL")"

echo "=== exact host (${AZTEC_PIN:-no @aztec/stdlib pin}): tarball resolution ==="
EXACT="$WORK/exact-host"
make_host "$EXACT" "$AZTEC_PIN"
( cd "$EXACT" && npm install --no-audit --no-fund --loglevel=error )

echo "--- typecheck the consumer against the PACKED dist (resolves the 'types' condition) ---"
# `--package=` is required: `typescript` ships both `tsc` and `tsserver`, so `npx typescript` cannot pick a binary.
( cd "$EXACT" && npx --yes --package=typescript@5.9 tsc --noEmit -p tsconfig.json )

echo "--- RUNTIME import: resolve + load the packed dist 'default' export ---"
( cd "$EXACT" && node runtime-check.mjs )

if [ -z "$AZTEC_PIN" ]; then
  echo "OK: packed tarball resolves, typechecks, and loads (no @aztec/stdlib dependency: singleton gate not applicable)"
  exit 0
fi

echo "--- npm ls @aztec/stdlib (exact host) ---"
( cd "$EXACT" && npm ls @aztec/stdlib || true )
EXACT_COUNT="$(count_stdlib "$EXACT")"
echo "exact host @aztec/stdlib install locations: $EXACT_COUNT"

echo "=== conflicting host (5.0.0): informational ==="
CONFLICT="$WORK/conflict-host"
make_host "$CONFLICT" "5.0.0"
( cd "$CONFLICT" && npm install --no-audit --no-fund --loglevel=error ) || echo "conflict host install returned non-zero (ERESOLVE?) — recorded"
echo "--- npm ls @aztec/stdlib (conflict host) ---"
( cd "$CONFLICT" && npm ls @aztec/stdlib || true )
echo "conflict host @aztec/stdlib install locations: $(count_stdlib "$CONFLICT")"

# The decisive gate: the exact host — the supported case — MUST resolve to a single @aztec/stdlib.
if [ "$EXACT_COUNT" != "1" ]; then
  echo "::error::exact-host resolved $EXACT_COUNT copies of @aztec/stdlib; expected a singleton graph" >&2
  exit 1
fi
echo "OK: packed tarball resolves + typechecks; exact-host @aztec graph is a singleton"
