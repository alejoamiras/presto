#!/usr/bin/env bash
# The macos-15-intel runners drop HTTP/3 (UDP 443) connections to Apple's ticket service,
# which `stapler staple` and `stapler validate` both call, while HTTPS over TCP works
# (actions/runner-images#14924). Blocking outbound UDP 443 makes stapler fall back to TCP.
# This is GitHub's tested rule, loaded their way: it replaces the runner's main pf ruleset,
# which is acceptable only because the runner is disposable.
set -euo pipefail

pfctl() { sudo "${PFCTL:-pfctl}" "$@"; }

echo "block return out quick proto udp from any to any port 443" | pfctl -f -
pfctl -E
if ! pfctl -sr | grep -Eq 'block return out quick proto udp .*port = (443|https)'; then
  echo "::error::the UDP 443 block rule is not loaded"
  pfctl -sr || true
  exit 1
fi
