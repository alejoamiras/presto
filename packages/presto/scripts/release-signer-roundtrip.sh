#!/usr/bin/env bash
# Runs the production updater signer end to end with a throwaway key: the pinned Tauri CLI and the
# built update-manifest tool, against a temporary repo root whose tauri.conf.json trusts that key.
# A prerelease must yield signed payloads, an rc-v1 latest-rc.json and both smoke twins but no
# latest.json; a stable one, its latest.json and v1 smoke feeds only. Every feed it signs, and the
# committed candidate fixtures, then go through each `verify` mode.
set -euo pipefail

tool_arg="${1:?usage: release-signer-roundtrip.sh <update-manifest-tool>}"
TOOL="$(cd "$(dirname "$tool_arg")" && pwd)/$(basename "$tool_arg")"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SMOKE_URL_PREFIX="https://updater-smoke.test/releases/download/"
FIXTURES="$REPO/packages/presto/core/tests/fixtures/updater/rc"

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

# expect_verify <ok | refusal text> <feed> <pubkey> <mode...>: a refusal must exit 1, not as a
# usage error, and name its reason.
expect_verify() {
  local want="$1" feed="$2" pubkey="$3"
  shift 3
  local status=0 label
  label="verify $* on $(basename "$(dirname "$feed")")/$(basename "$feed")"
  "$TOOL" verify --feed "$feed" --pubkey "$pubkey" "$@" > "$work/verify.out" 2>&1 || status=$?
  if [ "$want" = ok ]; then
    [ "$status" -eq 0 ] || fail "$label: exit $status, expected success: $(cat "$work/verify.out")"
  elif [ "$status" -ne 1 ] || ! grep -qF "$want" "$work/verify.out"; then
    fail "$label: exit $status, expected a refusal naming $want: $(cat "$work/verify.out")"
  fi
}
OFF_SMOKE_HOST="smoke feed downloads from"

for usage in "" "--channel stable --smoke" "--channel beta"; do
  status=0
  # shellcheck disable=SC2086 # each case is a list of flags
  "$TOOL" verify --feed "$FIXTURES/candidate.json" --pubkey "$FIXTURES/pubkey.b64" $usage \
    > /dev/null 2>&1 || status=$?
  [ "$status" -eq 2 ] || fail "verify '$usage' must be a usage error, got exit $status"
done
expect_verify ok "$FIXTURES/candidate.json" "$FIXTURES/pubkey.b64" --channel rc
expect_verify CandidateOffChannel "$FIXTURES/candidate.json" "$FIXTURES/pubkey.b64" --channel stable
expect_verify "$OFF_SMOKE_HOST" "$FIXTURES/candidate.json" "$FIXTURES/pubkey.b64" --smoke
for mode in "--channel stable" "--channel rc"; do
  # shellcheck disable=SC2086
  expect_verify PrereleaseNotCandidate "$FIXTURES/legacy-prerelease.json" "$FIXTURES/pubkey.b64" $mode
done
for mode in "--channel stable" "--channel rc" "--smoke"; do
  # shellcheck disable=SC2086
  expect_verify CandidateNotPrerelease "$FIXTURES/candidate-stable-version.json" "$FIXTURES/pubkey.b64" $mode
done
echo "fixtures: every verify mode OK"

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
  case "$version" in
    *-*) twins=4 ;;
    *) twins=0 ;;
  esac
  [ "$(find "$art" -name smoke-latest-rc.json | wc -l)" -eq "$twins" ] \
    || fail "$version: expected $twins rc-v1 smoke feeds"
  while IFS= read -r -d '' feed; do
    jq -e --arg prefix "$SMOKE_URL_PREFIX" '[.platforms[].url | startswith($prefix)] | all' "$feed" \
      >/dev/null || fail "$version: $feed downloads from a host other than updater-smoke.test"
    expect_verify ok "$feed" "$work/key.pub" --smoke
    case "$version" in
      *-*)
        expect_verify PrereleaseNotCandidate "$feed" "$work/key.pub" --channel stable
        expect_verify PrereleaseNotCandidate "$feed" "$work/key.pub" --channel rc
        ;;
    esac
  done < <(find "$art" -name smoke-latest.json -print0)
  while IFS= read -r -d '' feed; do
    jq -e --arg prefix "$SMOKE_URL_PREFIX" '[.platforms[].url | startswith($prefix)] | all' "$feed" \
      >/dev/null || fail "$version: $feed downloads from a host other than updater-smoke.test"
    expect_verify ok "$feed" "$work/key.pub" --smoke
    expect_verify ok "$feed" "$work/key.pub" --channel rc
    expect_verify CandidateOffChannel "$feed" "$work/key.pub" --channel stable
  done < <(find "$art" -name smoke-latest-rc.json -print0)
  case "$version" in
    *-*)
      [ ! -e "$art/latest.json" ] || fail "$version: a prerelease must not produce latest.json"
      [ -s "$art/latest-rc.json" ] || fail "$version: a prerelease must produce latest-rc.json"
      expect_verify ok "$art/latest-rc.json" "$work/key.pub" --channel rc
      expect_verify CandidateOffChannel "$art/latest-rc.json" "$work/key.pub" --channel stable
      expect_verify "$OFF_SMOKE_HOST" "$art/latest-rc.json" "$work/key.pub" --smoke
      ;;
    *)
      [ ! -e "$art/latest-rc.json" ] || fail "$version: a stable release must not produce latest-rc.json"
      [ -s "$art/latest.json" ] || fail "$version: a stable release must produce latest.json"
      expect_verify ok "$art/latest.json" "$work/key.pub" --channel stable
      expect_verify ok "$art/latest.json" "$work/key.pub" --channel rc
      expect_verify "$OFF_SMOKE_HOST" "$art/latest.json" "$work/key.pub" --smoke
      ;;
  esac
  echo "$version: signer round trip OK"
done
