#!/usr/bin/env bash
# Both ends of the ephemeral updater smokes (smoke-updater-unix.yml, smoke-updater-windows.yml),
# built from the current ref: one run-local throwaway key signs N-1's artifacts, N's artifacts and the
# feed manifest, and its pubkey is stamped into both builds (swapping only the private key fails
# verification). Every bundle trusts only that key, so nothing built here may ship or be uploaded.
#
#   ephemeral-updater.sh keygen
#   ephemeral-updater.sh stamp <version> <src-tauri-dir>
#   ephemeral-updater.sh build <n-1|n> <version> <out-dir>
#   ephemeral-updater.sh feed <version> <platform-key> <dir>
#
# RUNNER_OS picks the bundle (macOS app, Linux AppImage, Windows NSIS). TARGET, the Rust triple, is
# set on unix only: Windows builds the host default into target/release. keygen appends
# TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) and EPHEMERAL_PUBKEY to GITHUB_ENV; the other commands read them.
set -euo pipefail

PRESTO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO=$(cd "$PRESTO/../.." && pwd)

# Never echo an argument back: a crafted value could carry a `::` workflow command.
usage() {
  echo "usage: ephemeral-updater.sh keygen | stamp <version> <src-tauri-dir> | build <n-1|n> <version> <out-dir> | feed <version> <platform-key> <dir>" >&2
  exit 2
}

# The validated SemVer alphabet, which also keeps the version inert inside sed and JSON.
check_version() {
  [[ "$1" =~ ^[0-9A-Za-z.-]+$ ]] || usage
}

runner_os() {
  case "${RUNNER_OS:-}" in
    macOS | Linux | Windows) ;;
    *) echo "::error::RUNNER_OS must be macOS, Linux or Windows" >&2; exit 2 ;;
  esac
}

keygen() {
  set +x
  : "${GITHUB_ENV:?GITHUB_ENV is required}"
  local priv pub
  # Global: the EXIT trap runs after this function's locals are gone.
  KEY_DIR=$(mktemp -d)
  trap 'rm -rf "$KEY_DIR"' EXIT
  # -w keeps the private key out of the CLI's output.
  (cd "$PRESTO" && bunx --no-install tauri signer generate --ci -p "" -w "$KEY_DIR/eph.key")
  priv=$(cat "$KEY_DIR/eph.key")
  pub=$(cat "$KEY_DIR/eph.key.pub")
  # A newline would end the GITHUB_ENV entry early and start another.
  if [ -z "$priv" ] || [ -z "$pub" ] || [[ "$priv$pub" == *$'\n'* ]]; then
    echo "::error::signer generate did not write a single-line key pair" >&2
    exit 1
  fi
  # Environment-file values are not masked, and the runner prints later steps' env.
  echo "::add-mask::$priv"
  {
    echo "TAURI_SIGNING_PRIVATE_KEY=$priv"
    echo "TAURI_SIGNING_PRIVATE_KEY_PASSWORD="
    # The .pub file is already the base64 document tauri.conf.json expects; encoding it again fails
    # the build at "Missing encoded key".
    echo "EPHEMERAL_PUBKEY=$pub"
  } >> "$GITHUB_ENV"
}

stamp() {
  local version=$1 dir=$2
  check_version "$version"
  [ -f "$dir/Cargo.toml" ] && [ -f "$dir/tauri.conf.json" ] || usage
  : "${EPHEMERAL_PUBKEY:?EPHEMERAL_PUBKEY is required}"
  # -i.bak is the in-place form both GNU and BSD sed accept.
  sed -i.bak "s/^version = \".*\"/version = \"$version\"/" "$dir/Cargo.toml"
  rm -f "$dir/Cargo.toml.bak"
  # A relative path, so the Windows run does not rely on MSYS converting /d/... for a native bun.
  (cd "$dir" && STAMP_VERSION="$version" bun -e "const f='tauri.conf.json';const c=JSON.parse(await Bun.file(f).text());c.version=process.env.STAMP_VERSION;c.plugins.updater.pubkey=process.env.EPHEMERAL_PUBKEY;await Bun.write(f,JSON.stringify(c,null,2)+'\n')")
}

build() {
  local role=$1 version=$2 out=$3
  case "$role" in n-1 | n) ;; *) usage ;; esac
  check_version "$version"
  [ -n "$out" ] || usage
  runner_os
  : "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY is required}"
  local src="$PRESTO/src-tauri" root bundle args
  root="$src/target/${TARGET:+$TARGET/}release"
  bundle="$root/bundle"
  args=(build)
  [ -z "${TARGET:-}" ] || args+=(--target "$TARGET")
  case "$RUNNER_OS" in
    macOS) args+=(--bundles app) ;;
    Linux) args+=(--bundles appimage) ;;
    Windows) args+=(--bundles nsis) ;;
  esac
  # N-1's output must not be collected as N's.
  if [ "$role" = n ]; then
    if [ "$RUNNER_OS" = Windows ]; then rm -rf "$bundle/nsis"; else rm -rf "$bundle"; fi
  fi
  stamp "$version" "$src"
  (cd "$PRESTO" && bunx --no-install tauri "${args[@]}")
  mkdir -p "$out"
  case "$RUNNER_OS" in
    macOS)
      bash "$PRESTO/scripts/assert-no-test-hooks.sh" "$bundle/macos/Presto.app"
      if [ "$role" = n ]; then
        cp "$bundle"/macos/*.app.tar.gz "$bundle"/macos/*.app.tar.gz.sig "$out/"
      else
        n1_dmg "$bundle/macos/Presto.app" "$out/Presto-N1.dmg"
      fi
      ;;
    Linux)
      if [ "$role" = n ]; then
        cp "$bundle"/appimage/*.AppImage "$bundle"/appimage/*.AppImage.sig "$out/"
      else
        cp "$bundle"/appimage/*.AppImage "$out/"
      fi
      bash "$PRESTO/scripts/assert-no-test-hooks.sh" "$out"/*.AppImage
      ;;
    Windows)
      # The installer is LZMA-compressed; the binary it packs is this one.
      bash "$PRESTO/scripts/assert-no-test-hooks.sh" "$root/Presto.exe"
      if [ "$role" = n ]; then
        cp "$bundle"/nsis/*-setup.nsis.zip "$bundle"/nsis/*-setup.nsis.zip.sig "$out/"
      else
        cp "$bundle"/nsis/*-setup.exe "$out/"
      fi
      ;;
  esac
  ls -la "$out"
}

# updater-smoke.sh installs N-1 from a DMG. A plain `hdiutil create` avoids tauri's Finder-scripted
# DMG layout, the chronically flaky part of DMG bundling on runners.
n1_dmg() {
  local app=$1 dmg=$2 stage
  stage="${RUNNER_TEMP:?RUNNER_TEMP is required}/n1-stage"
  mkdir -p "$stage"
  ditto "$app" "$stage/Presto.app"
  local attempt
  for attempt in 1 2 3; do
    if hdiutil create -volname Presto -srcfolder "$stage" -ov -format UDZO "$dmg"; then
      return 0
    fi
    [ "$attempt" = 3 ] || sleep 10
  done
  echo "::error::hdiutil create failed 3 times" >&2
  exit 1
}

feed() {
  local version=$1 platform=$2 dir=$3
  check_version "$version"
  [[ "$platform" =~ ^[a-z0-9_-]+$ ]] || usage
  [ -d "$dir" ] || usage
  runner_os
  # The feed runs from the repo root below.
  case "$dir" in /* | [A-Za-z]:*) ;; *) dir="$PWD/$dir" ;; esac
  local payloads=() payload feed pubkey host
  shopt -s nullglob
  case "$RUNNER_OS" in
    macOS) payloads=("$dir"/*.app.tar.gz) ;;
    Linux) payloads=("$dir"/*.AppImage) ;;
    Windows) payloads=("$dir"/*-setup.nsis.zip) ;;
  esac
  shopt -u nullglob
  if [ "${#payloads[@]}" -ne 1 ]; then
    echo "::error::expected exactly one N updater payload" >&2
    exit 1
  fi
  payload=${payloads[0]}
  feed="$dir/smoke-latest.json"
  pubkey="${RUNNER_TEMP:-$(mktemp -d)}/smoke-pubkey.b64"
  # Relative paths from the repo root, for the same MSYS reason as stamp.
  cd "$REPO"
  host=$(jq -er '.plugins.updater.endpoints[0] | capture("^https://(?<host>[A-Za-z0-9.-]+)/").host' packages/presto/src-tauri/tauri.conf.json)
  jq -n --arg version "$version" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg key "$platform" \
    --arg signature "$(tr -d '\r\n' < "$payload.sig")" \
    --arg url "https://$host/releases/download/$(basename "$payload")" \
    --argjson size "$(wc -c < "$payload" | tr -d ' ')" \
    '{version:$version,notes:"ephemeral updater smoke",pub_date:$date,
      platforms:{($key):{signature:$signature,url:$url,size:$size}}}' > "$feed"
  bash packages/presto/scripts/sign-smoke-feed.sh "$feed" "$PWD"
  # Verify against the stamped config: the key the built app will actually trust.
  jq -er '.plugins.updater.pubkey' packages/presto/src-tauri/tauri.conf.json > "$pubkey"
  cargo run --locked --manifest-path packages/presto/core/Cargo.toml --example update-manifest -- \
    verify --feed "$feed" --pubkey "$pubkey"
}

case "${1:-}" in
  keygen) [ "$#" -eq 1 ] || usage; keygen ;;
  stamp) [ "$#" -eq 3 ] || usage; stamp "$2" "$3" ;;
  build) [ "$#" -eq 4 ] || usage; build "$2" "$3" "$4" ;;
  feed) [ "$#" -eq 4 ] || usage; feed "$2" "$3" "$4" ;;
  *) usage ;;
esac
