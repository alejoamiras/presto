#!/usr/bin/env bash
# Installed as `xcrun` ahead of the real one while tauri bundles for macOS. tauri runs
# `xcrun stapler staple` once and ignores its status, and Apple's ticket service
# (api.apple-cloudkit.com) drops runner connections often enough to ship an unstapled app.
# This retries the staple until the ticket validates; every other call passes straight through.
set -uo pipefail

real="${XCRUN_REAL:-/usr/bin/xcrun}"
log="${STAPLE_LOG:-/dev/null}"
attempts="${STAPLE_ATTEMPTS:-6}"
delay="${STAPLE_DELAY:-10}"

if [ "${1-}" != stapler ] || [ "${2-}" != staple ]; then
  exec "$real" "$@"
fi

# tauri passes the bundle last, relative to its working directory, which validate shares.
bundle="${!#}"
for ((attempt = 1; ; attempt++)); do
  if "$real" "$@" && "$real" stapler validate "$bundle"; then
    echo "stapled $bundle on attempt $attempt" >>"$log"
    exit 0
  fi
  echo "staple attempt $attempt/$attempts failed for $bundle" >>"$log"
  if ((attempt >= attempts)); then
    exit 1
  fi
  sleep $((delay * attempt))
done
