#!/usr/bin/env bash
# The macos-15-intel runners drop HTTP/3 (UDP 443) connections to Apple's ticket service,
# which `stapler staple` and `stapler validate` both call, while HTTPS over TCP works
# (actions/runner-images#14924). Blocking outbound UDP 443 makes stapler fall back to TCP.
# This is GitHub's tested rule set: it replaces the main pf ruleset, which on a throwaway
# runner drops only Apple's empty default anchors.
set -euo pipefail

echo "block return out quick proto udp from any to any port 443" | sudo pfctl -f -
sudo pfctl -E
if ! sudo pfctl -sr | grep -Eq 'block return out quick proto udp .*port = (443|https)'; then
  echo "::error::the UDP 443 block rule is not loaded"
  sudo pfctl -sr || true
  exit 1
fi
