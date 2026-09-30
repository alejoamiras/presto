#!/usr/bin/env bash
# Fails if a built artifact carries the WebDriver-only tray hooks. Each argument is a binary, a
# directory (an .app) or an AppImage, whose compressed payload is extracted first. Only a completed
# scan of a non-empty Presto executable passes: a missing or empty target, a directory without the
# executable, and a grep error all fail.
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
  if [ -d "$scan" ]; then
    if [ -z "$(find "$scan" -type f -name Presto -size +0c -print -quit)" ]; then
      echo "::error::$target holds no non-empty Presto executable"
      exit 1
    fi
  elif [ ! -s "$scan" ]; then
    echo "::error::$target is empty"
    exit 1
  fi
  status=0
  grep -rqa -- "$NEEDLE" "$scan" || status=$?
  case "$status" in
    0)
      echo "::error::$target contains $NEEDLE: a WebDriver-only build reached a shipped artifact"
      exit 1
      ;;
    1) echo "no test hooks in $target" ;;
    *)
      echo "::error::could not scan $target (grep exit $status)"
      exit 1
      ;;
  esac
done
