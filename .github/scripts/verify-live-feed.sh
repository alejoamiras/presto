#!/usr/bin/env bash
# Polls a public updater feed route until it serves <version> (KV reads cache for 60 s and promotion
# propagates at the edge), then requires the four platforms, every download answering, and the
# production verifier admitting the exact body on <channel>. This is the only check on the bytes
# installed apps really receive.
#   verify-live-feed.sh <feed url> <version> <stable|rc> <update-manifest tool> <pubkey file> <body out>
set -euo pipefail

[ "$#" -eq 6 ] || { echo "::error::usage: verify-live-feed.sh <url> <version> <channel> <tool> <pubkey> <out>"; exit 2; }
url="$1" expected="$2" channel="$3" tool="$4" pubkey="$5" body="$6"

got=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 15 -o "$body" "$url" 2>/dev/null; then
    got=$(jq -r '.version // empty' "$body" 2>/dev/null || true)
    [ "$got" = "$expected" ] && break
  fi
  sleep 10
done
if [ "$got" != "$expected" ]; then
  echo "::error::$url still not $expected after ~10 min (got '${got:-<none>}')"
  exit 1
fi
echo "✅ $url serves $expected"

jq -e '.platforms | has("darwin-aarch64") and has("darwin-x86_64") and has("linux-x86_64") and has("windows-x86_64")' \
  "$body" >/dev/null || { echo "::error::$url is missing a platform key"; exit 1; }
# `while read` over process substitution (not a pipe) so `exit 1` exits the script, not a subshell.
while read -r u; do
  ok=""
  for _ in $(seq 1 5); do
    code=$(curl -fsIL --max-time 30 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null || echo ERR)
    if [ "$code" = "200" ]; then ok=1; break; fi
    sleep 5
  done
  [ -n "$ok" ] || { echo "::error::asset URL not reachable (last=$code): $u"; exit 1; }
  echo "✅ 200 $u"
done < <(jq -r '.platforms[].url' "$body")

# Version and reachable URLs survive a corrupted or dropped manifest_sig, which every client rejects.
"$tool" verify --feed "$body" --pubkey "$pubkey" --channel "$channel"
echo "✅ $url verified on the $channel channel: $expected, all assets reachable, manifest signature valid"
