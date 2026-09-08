#!/usr/bin/env bash
# B4 packaged-E2E: point the playground at the PACKED SDK tarball instead of the workspace source, so the
# composed proof exercises the exact artifact that would publish (not the workspace tree).
# Shared by the Linux + macOS legs of `_e2e-packaged.yml`: the workspace SDK is not a release gate. The
# tarball's packaging (files set, entry points, dep resolution) is ALSO gated by
# scripts/sdk-tarball-consumer.sh; this leg additionally proves it PROVES.
#
#   packaged-e2e-swap-sdk.sh [sdk-tarball] [core-tarball]
#
# Without arguments both packages are built and packed from the workspace. A release deployment
# supplies its provenance/integrity-verified published SDK tarball; the core tarball defaults to the
# workspace pack, and the SDK's exact core pin must match whatever core is installed.
set -euo pipefail

pack() {
  # pack <workspace-dir> → absolute tarball path on stdout
  local dir="$1"
  bun run --cwd "$dir" build >&2
  local tarball
  tarball="$(cd "$dir" && npm pack --silent | tail -1)"
  echo "$(cd "$dir" && pwd)/${tarball}"
}

if [ -n "${1:-}" ]; then
  ABS="$1"
else
  echo "Building the SDK..."
  ABS="$(pack packages/sdk)"
fi
if [ -n "${2:-}" ]; then
  CORE_ABS="$2"
else
  echo "Building the core..."
  CORE_ABS="$(pack packages/sdk-core)"
fi
for tarball in "${ABS}" "${CORE_ABS}"; do
  if [ ! -f "${tarball}" ]; then
    echo "::error::packed tarball not found at ${tarball}"
    exit 1
  fi
done
echo "Packed ${ABS}"
echo "Packed ${CORE_ABS}"

# Swap the packed tarball in for the workspace SDK. `bun add --cwd packages/playground "${ABS}"` LOOPS here:
# bun re-resolves the workspace and the tarball collides with the same-named workspace member
# (error: "@alejoamiras/presto@workspace:packages/sdk has a dependency loop"). Under the isolated
# linker the playground resolves the SDK through its OWN node_modules
# (packages/playground/node_modules/@alejoamiras/presto -> ../../../sdk — there is no hoisted root
# copy); replace that symlink IN PLACE with the EXTRACTED packed tarball, so the playground resolves the
# packed code with no bun re-resolution. The tarball ships no node_modules, so link the workspace SDK's own
# node_modules entries into it — the packed code resolves its deps (@aztec/*, ...) through the exact pinned
# graph the workspace SDK uses (one graph) — EXCEPT @alejoamiras/presto-core, which is the PACKED core
# (never the workspace source: the release ships two artifacts, and this leg must prove both). A failure
# here aborts the leg — never silently fall back to the workspace SDK (that would defeat the packed-SDK gate).
REPO_ROOT="$(pwd)"
DEST="packages/playground/node_modules/@alejoamiras/presto"
rm -rf "${DEST}"
mkdir -p "${DEST}"
# npm-pack tarballs nest everything under package/; --strip-components=1 drops that prefix.
tar -xzf "${ABS}" -C "${DEST}" --strip-components=1
test -f "${DEST}/package.json" || {
  echo "::error::tarball extraction produced no ${DEST}/package.json"
  exit 1
}
NM="${DEST}/node_modules"
mkdir -p "${NM}/@alejoamiras"
for entry in "${REPO_ROOT}"/packages/sdk/node_modules/*; do
  name="$(basename "${entry}")"
  [ "${name}" = "@alejoamiras" ] && continue
  ln -s "${entry}" "${NM}/${name}"
done
CORE_DEST="${NM}/@alejoamiras/presto-core"
mkdir -p "${CORE_DEST}"
tar -xzf "${CORE_ABS}" -C "${CORE_DEST}" --strip-components=1
test -f "${CORE_DEST}/package.json" || {
  echo "::error::core tarball extraction produced no ${CORE_DEST}/package.json"
  exit 1
}
ln -s "${REPO_ROOT}/packages/sdk-core/node_modules" "${CORE_DEST}/node_modules"

# The SDK's core pin must name the core that was just installed. A `workspace:` range (an unrewritten
# workspace pack) accepts the workspace version; a published SDK carries an exact pin.
bun "${REPO_ROOT}/scripts/tarball-consumer/assert-core-pin.ts" "${DEST}/package.json" "${CORE_DEST}/package.json"

# Prove the swap FROM THE CONSUMER: playground resolution must land inside the swapped dir. This is the
# guard against a layout change quietly re-routing resolution back to the workspace source — the exact
# silent fallback this gate exists to prevent (it happened once: a linker change removed the hoisted root
# symlink an earlier version of this script swapped, and the leg kept passing against the workspace SDK).
RESOLVED="$(bun -e "console.log(Bun.resolveSync('@alejoamiras/presto', '${REPO_ROOT}/packages/playground'))")"
case "${RESOLVED}" in
  "${REPO_ROOT}/${DEST}"/*)
    echo "Swap verified from the consumer: ${RESOLVED}"
    ;;
  *)
    echo "::error::packed-SDK swap ineffective — playground resolves ${RESOLVED} (expected inside ${DEST})"
    exit 1
    ;;
esac
# And the packed code must reach its own deps through the linked graph — core through the PACKED copy.
for dep in @logtape/logtape @aztec/bb-prover @alejoamiras/presto-core; do
  bun -e "Bun.resolveSync('${dep}', '${REPO_ROOT}/${DEST}')" || {
    echo "::error::packed SDK cannot resolve its dependency '${dep}' from ${DEST}"
    exit 1
  }
done
CORE_RESOLVED="$(bun -e "console.log(Bun.resolveSync('@alejoamiras/presto-core', '${REPO_ROOT}/${DEST}'))")"
case "${CORE_RESOLVED}" in
  "${REPO_ROOT}/${CORE_DEST}"/*)
    echo "Core resolves to the packed copy: ${CORE_RESOLVED}"
    ;;
  *)
    echo "::error::packed SDK resolves core at ${CORE_RESOLVED} (expected inside ${CORE_DEST})"
    exit 1
    ;;
esac

echo "Playground @alejoamiras/presto now resolves to the packed tarball (versions below):"
grep -m1 '"version"' "${DEST}/package.json" || true
grep -m1 '"version"' "${CORE_DEST}/package.json" || true
