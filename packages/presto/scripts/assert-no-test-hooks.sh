#!/usr/bin/env bash
# Fails if a built artifact carries a WebDriver-only test hook: any `PRESTO_E2E_` name. Each argument
# is a binary, a directory (an .app), an AppImage, a .tar.gz or a .deb, whose payload is extracted
# first. Only a completed scan of a non-empty Presto executable passes: a missing or empty target, a
# directory or payload without the executable as a regular file, and an extraction or grep error all
# fail. No symlink is followed, so nothing outside the target is ever scanned or counted.
set -euo pipefail

NEEDLE="PRESTO_E2E_"
[ "$#" -gt 0 ] || { echo "usage: $0 <binary|dir|AppImage|tar.gz|deb>..." >&2; exit 2; }
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

for target in "$@"; do
  if [ ! -e "$target" ]; then
    echo "::error::$target does not exist"
    exit 1
  fi
  scan="$target"
  case "$target" in
    *.AppImage | *.tar.gz | *.deb)
      work=$(mktemp -d "$root/extract.XXXXXX")
      abs=$(cd "$(dirname "$target")" && pwd)/$(basename "$target")
      scan="$work/payload"
      status=0
      case "$target" in
        *.AppImage)
          (cd "$work" && "$abs" --appimage-extract > /dev/null && mv squashfs-root payload) \
            || status=$?
          ;;
        *.tar.gz) (cd "$work" && mkdir payload && tar -xzf "$abs" -C payload) || status=$? ;;
        # A .deb is an ar archive; the installed tree is its one data.tar.* member.
        *.deb)
          (cd "$work" && ar x "$abs" && set -- data.tar.* && [ "$#" -eq 1 ] && mkdir payload \
            && tar -xf "$1" -C payload) || status=$?
          ;;
      esac
      if [ "$status" -ne 0 ] || [ ! -d "$scan" ]; then
        echo "::error::$target did not extract"
        exit 1
      fi
      ;;
  esac
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
