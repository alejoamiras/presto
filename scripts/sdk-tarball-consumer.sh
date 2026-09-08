#!/usr/bin/env bash
# B7: consume a PUBLISHED tarball the way a real dApp does — default `npm install` on a fresh Node —
# and prove two things nothing else in the repo checks:
#   1. the packed `dist` exports/types actually RESOLVE + typecheck (the playground uses `workspace:*`, i.e.
#      the source `exports`, so a broken publish rewrite / missing dist would ship undetected);
#   2. the F13 deps-vs-peers decision, for packages that pin `@aztec/stdlib`: default npm's `@aztec/stdlib`
#      graph for an EXACT-version host is a SINGLETON (exact-pinned deps already deliver "one @aztec graph"),
#      and a CONFLICTING-version host is recorded. Peers are not better here — on a skew they ERESOLVE-fail
#      the install; reproducible evidence lives in implementations-plan/v2-release-train/evidence/f13-peer-vs-deps.sh.
#
# The consumer host's files (index.ts, runtime-check.mjs, tsconfig.json, optional host-dependencies.json)
# come from the package's profile under scripts/tarball-consumer/<profile>/ (scripts/npm-packages.ts).
#
#   scripts/sdk-tarball-consumer.sh <absolute-path-to-tarball> [package-key]
set -euo pipefail

TARBALL="${1:?usage: sdk-tarball-consumer.sh <tarball> [package-key]}"
PACKAGE_KEY="${2:-presto}"
[ -f "$TARBALL" ] || { echo "tarball not found: $TARBALL" >&2; exit 2; }
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The npm name and the profile directory come from the descriptor; a wrong key fails loud there.
# shellcheck disable=SC2016  # single quotes are deliberate: the JS must not shell-expand
read -r PACKAGE_NAME PROFILE < <(bun -e '
  import { CONSUMER_PROFILE_ROOT, resolvePackage } from "./scripts/npm-packages.ts";
  const pkg = resolvePackage(process.argv[1]);
  console.log(`${pkg.name} ${CONSUMER_PROFILE_ROOT}/${pkg.consumerProfile}`);
' "$PACKAGE_KEY")
PROFILE_DIR="$REPO_ROOT/$PROFILE"
[ -d "$PROFILE_DIR" ] || { echo "consumer profile not found: $PROFILE_DIR" >&2; exit 2; }

# Count DISTINCT @aztec/stdlib install locations in a consumer dir (1 = singleton graph).
count_stdlib() {
  local dir="$1"
  ( cd "$dir" && find node_modules -type d -path '*@aztec/stdlib' 2>/dev/null | wc -l | tr -d ' ' )
}

make_host() {
  # make_host <dir> [aztec-version]: the tarball under test plus the profile's extra host dependencies
  # (host-dependencies.json), plus an @aztec/stdlib pin when given.
  local dir="$1" aztec="${2:-}"
  mkdir -p "$dir"
  # shellcheck disable=SC2016  # single quotes are deliberate: the JS must not shell-expand
  bun -e '
    const [dir, tarball, name, aztec, extra] = process.argv.slice(1);
    const deps = { [name]: `file:${tarball}` };
    if (extra) Object.assign(deps, JSON.parse(require("fs").readFileSync(extra, "utf8")));
    if (aztec) deps["@aztec/stdlib"] = aztec;
    const host = { name: `host-${aztec || "default"}`, version: "0.0.0", private: true, dependencies: deps };
    require("fs").writeFileSync(`${dir}/package.json`, `${JSON.stringify(host, null, 2)}\n`);
  ' "$dir" "$TARBALL" "$PACKAGE_NAME" "$aztec" "$([ -f "$PROFILE_DIR/host-dependencies.json" ] && echo "$PROFILE_DIR/host-dependencies.json" || true)"
  cp "$PROFILE_DIR/tsconfig.json" "$PROFILE_DIR/index.ts" "$PROFILE_DIR/runtime-check.mjs" "$dir/"
}

# "Exact host" means: the host pins the SAME @aztec/stdlib version the tarball ships with, derived from
# the ARTIFACT UNDER TEST (scripts/tarball-consumer/exact-pin.ts explains why nothing else will do). An
# aztec-derived package without the pin fails there; a package that does not ship the dependency gets a
# plain host and no singleton gate.
AZTEC_PIN="$(bun "$REPO_ROOT/scripts/tarball-consumer/exact-pin.ts" --package "$PACKAGE_KEY" "$TARBALL")"

echo "=== exact host (${AZTEC_PIN:-no @aztec/stdlib pin}): tarball resolution ==="
EXACT="$WORK/exact-host"
make_host "$EXACT" "$AZTEC_PIN"
( cd "$EXACT" && npm install --no-audit --no-fund --loglevel=error )

echo "--- typecheck the consumer against the PACKED dist (resolves the 'types' condition) ---"
# `--package=` is required: `typescript` ships both `tsc` and `tsserver`, so `npx typescript` cannot pick a
# binary ("could not determine executable to run"). (codex B7 #1)
( cd "$EXACT" && npx --yes --package=typescript@5.9 tsc --noEmit -p tsconfig.json )

echo "--- RUNTIME import: resolve + load the packed dist 'default' export (types-check can't — codex #2) ---"
( cd "$EXACT" && node runtime-check.mjs )

if [ -z "$AZTEC_PIN" ]; then
  echo "OK: packed tarball resolves, typechecks, and loads (no @aztec/stdlib dependency: F13 singleton gate not applicable)"
  exit 0
fi

echo "--- npm ls @aztec/stdlib (exact host) ---"
( cd "$EXACT" && npm ls @aztec/stdlib || true )
EXACT_COUNT="$(count_stdlib "$EXACT")"
echo "exact host @aztec/stdlib install locations: $EXACT_COUNT"

echo "=== conflicting host (5.0.0): recorded for the F13 ledger (informational) ==="
CONFLICT="$WORK/conflict-host"
make_host "$CONFLICT" "5.0.0"
( cd "$CONFLICT" && npm install --no-audit --no-fund --loglevel=error ) || echo "conflict host install returned non-zero (ERESOLVE?) — recorded"
echo "--- npm ls @aztec/stdlib (conflict host) ---"
( cd "$CONFLICT" && npm ls @aztec/stdlib || true )
echo "conflict host @aztec/stdlib install locations: $(count_stdlib "$CONFLICT")"

# The decisive gate: the exact host — the supported case — MUST resolve to a single @aztec/stdlib. The
# conflict host is diagnostic only: default npm nests a duplicate here (deps degrade gracefully), whereas
# peers would ERESOLVE-fail the install — see the F13 ledger entry + evidence/f13-peer-vs-deps.sh.
if [ "$EXACT_COUNT" != "1" ]; then
  echo "::error::exact-host resolved $EXACT_COUNT copies of @aztec/stdlib; expected a singleton graph" >&2
  exit 1
fi
echo "OK: packed tarball resolves + typechecks; exact-host @aztec graph is a singleton"
