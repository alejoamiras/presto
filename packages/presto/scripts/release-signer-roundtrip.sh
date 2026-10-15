#!/usr/bin/env bash
# Runs the production updater signer end to end with a throwaway key: the pinned Tauri CLI and the
# built update-manifest tool, against a temporary repo root whose tauri.conf.json trusts that key.
# A prerelease must yield signed payloads and smoke feeds but no latest.json; a stable one, all three.
set -euo pipefail

tool_arg="${1:?usage: release-signer-roundtrip.sh <update-manifest-tool>}"
TOOL="$(cd "$(dirname "$tool_arg")" && pwd)/$(basename "$tool_arg")"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SMOKE_URL_PREFIX="https://updater-smoke.test/releases/download/"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
root="$work/repo"
mkdir -p "$root/packages/presto/src-tauri" "$root/packages/presto/node_modules/.bin"
ln -s "$REPO/packages/presto/node_modules/.bin/tauri" "$root/packages/presto/node_modules/.bin/tauri"
(cd "$REPO/packages/presto" && bunx tauri signer generate --ci -p roundtrip -w "$work/key") >/dev/null
jq --arg key "$(cat "$work/key.pub")" '.plugins.updater.pubkey = $key' \
  "$REPO/packages/presto/src-tauri/tauri.conf.json" > "$root/packages/presto/src-tauri/tauri.conf.json"

fail() {
  echo "::error::$*" >&2
  exit 1
}

for version in 9.9.9-rc.1 9.9.9; do
  art="$work/artifacts-$version"
  for pair in \
    "macos-arm64:Presto-$version-macOS-Apple-Silicon.app.tar.gz" \
    "macos-x86_64:Presto-$version-macOS-Intel.app.tar.gz" \
    "linux-x86_64:Presto-$version-Linux-x86_64.AppImage" \
    "windows-x86_64:Presto-$version-Windows-x86_64-setup.nsis.zip"; do
    mkdir -p "$art/unsigned-presto-${pair%%:*}"
    head -c 4096 /dev/urandom > "$art/unsigned-presto-${pair%%:*}/${pair#*:}"
  done

  TAURI_SIGNING_PRIVATE_KEY="$(cat "$work/key")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=roundtrip \
    bash "$REPO/packages/presto/scripts/sign-release-updater-artifacts.sh" \
    "$art" "$version" "presto-v$version" "$root" "$TOOL"

  [ "$(find "$art" -name '*.sig' | wc -l)" -eq 4 ] || fail "$version: expected four signed payloads"
  [ "$(find "$art" -name smoke-latest.json | wc -l)" -eq 4 ] || fail "$version: expected four smoke feeds"
  while IFS= read -r -d '' feed; do
    jq -e --arg prefix "$SMOKE_URL_PREFIX" '[.platforms[].url | startswith($prefix)] | all' "$feed" \
      >/dev/null || fail "$version: $feed downloads from a host other than updater-smoke.test"
  done < <(find "$art" -name smoke-latest.json -print0)
  case "$version" in
    *-*) [ ! -e "$art/latest.json" ] || fail "$version: a prerelease must not produce latest.json" ;;
    *) [ -s "$art/latest.json" ] || fail "$version: a stable release must produce latest.json" ;;
  esac
  echo "$version: signer round trip OK"
done
