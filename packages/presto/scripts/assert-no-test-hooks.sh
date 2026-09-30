#!/usr/bin/env bash
# Fails if a built artifact carries the WebDriver-only tray hooks. Each argument is a binary, a
# directory (an .app) or an AppImage, whose compressed payload is extracted first. A missing path
# fails, so a wrong path can never pass.
set -euo pipefail

NEEDLE="PRESTO_E2E_TRAY_REPORT"
[ "$#" -gt 0 ] || { echo "usage: $0 <binary|dir|AppImage>..." >&2; exit 2; }
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

for target in "$@"; do
  if [ ! -e "$target" ]; then
    echo "::error::$target does not exist"
    exit 1
  fi
  scan="$target"
  if [[ "$target" == *.AppImage ]]; then
    work=$(mktemp -d "$root/extract.XXXXXX")
    abs=$(cd "$(dirname "$target")" && pwd)/$(basename "$target")
    (cd "$work" && "$abs" --appimage-extract > /dev/null)
    scan="$work/squashfs-root"
    [ -d "$scan" ] || { echo "::error::$target did not extract"; exit 1; }
  fi
  if grep -rqa "$NEEDLE" "$scan"; then
    echo "::error::$target contains $NEEDLE: a WebDriver-only build reached a shipped artifact"
    exit 1
  fi
  echo "no test hooks in $target"
done
