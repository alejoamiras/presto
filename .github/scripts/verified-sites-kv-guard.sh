#!/usr/bin/env bash
# Decides whether the publish job may write the candidate envelope (the newest verified record) over
# what the Cloudflare KV API returned for `verified-sites.json`.
#   verified-sites-kv-guard.sh <http status> <response body file> <candidate envelope file>
# Prints `decision=write` or `decision=skip`. Refuses (exit 1) when KV holds a higher version, the
# same version with other list bytes, a list whose signature names another key, or anything it cannot
# read; only a 404 carrying Cloudflare's "key not found" (10009) counts as absent. The live signature
# is never verified here: it can only stop a write, and the candidate was verified before this runs.
set -euo pipefail

ENVELOPE_SCHEMA="presto-verified-sites-envelope-v1"
DOCUMENT_MAX_BYTES=98304

refuse() {
  echo "::error::$*" >&2
  exit 1
}

[ "$#" -eq 3 ] || refuse "usage: verified-sites-kv-guard.sh <http status> <body file> <candidate file>"
status="$1"
body="$2"
candidate="$3"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Reads an envelope into $work/<name>.{list,sig} and prints "<version> <key id>".
read_envelope() {
  local file="$1" name="$2" size version key_id
  [ -f "$file" ] || refuse "$name: no such file"
  size="$(wc -c <"$file")"
  [ "$size" -le "$DOCUMENT_MAX_BYTES" ] || refuse "$name: document over $DOCUMENT_MAX_BYTES bytes"
  jq -e --arg schema "$ENVELOPE_SCHEMA" \
    'type == "object" and (keys == ["list", "schema", "signature"]) and .schema == $schema
       and (.list | type) == "string" and (.signature | type) == "string"' \
    "$file" >/dev/null 2>&1 || refuse "$name: not a verified-sites envelope"
  jq -j .list "$file" | base64 -d >"$work/$name.list" 2>/dev/null || refuse "$name: list is not base64"
  jq -j .signature "$file" | base64 -d >"$work/$name.sig" 2>/dev/null ||
    refuse "$name: signature is not base64"
  version="$(jq -r '.version' "$work/$name.list" 2>/dev/null)" || refuse "$name: list is not JSON"
  [[ "$version" =~ ^[1-9][0-9]{0,15}$ ]] || refuse "$name: list has no positive integer version"
  # minisign displays the 8 key-ID bytes as one little-endian integer, as key.pub's comment does.
  key_id="$(sed -n 2p "$work/$name.sig" | base64 -d 2>/dev/null | od -An -v -tx1 -j2 -N8 |
    tr -s ' \n' '\n' | sed '/^$/d' | tac | tr -d '\n' | tr 'a-f' 'A-F')"
  [[ "$key_id" =~ ^[0-9A-F]{16}$ ]] || refuse "$name: signature carries no key ID"
  echo "$version $key_id"
}

read -r new_version new_key < <(read_envelope "$candidate" candidate) || exit 1

case "$status" in
  200) ;;
  404)
    if jq -e '.success == false and any(.errors[]?; .code == 10009)' "$body" >/dev/null 2>&1; then
      echo "decision=write"
      exit 0
    fi
    refuse "KV answered 404 without Cloudflare's key-not-found error"
    ;;
  *) refuse "KV answered HTTP $status" ;;
esac

read -r live_version live_key < <(read_envelope "$body" live) || exit 1

if [ "$live_key" != "$new_key" ]; then
  refuse "KV holds version $live_version signed by key ID $live_key, not $new_key: a key change needs the owner's KV delete first"
fi
if [ "$live_version" -gt "$new_version" ]; then
  refuse "KV holds version $live_version, ahead of the newest record ($new_version)"
fi
if [ "$live_version" -eq "$new_version" ]; then
  cmp -s "$work/live.list" "$work/candidate.list" ||
    refuse "KV holds a different list at version $new_version (equivocation)"
  # Same list: rewrite only to repair the envelope around it.
  if cmp -s "$body" "$candidate"; then
    echo "decision=skip"
    exit 0
  fi
fi
echo "decision=write"
