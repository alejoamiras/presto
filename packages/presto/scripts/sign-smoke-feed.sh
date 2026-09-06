#!/usr/bin/env bash
# Sign a synthesized updater-smoke feed IN PLACE (F-004 Layer A).
#
# The synthetic Windows smoke uses a throwaway key embedded in both test builds. Sign its
# local feed with that same key; production feeds use the isolated release signer instead.
#
# Encoding contract (kept in lockstep with presto_core::update_manifest):
#   - manifest     = base64(envelope.json bytes)
#   - manifest_sig = the .sig file content VERBATIM (tauri writes it as base64(minisign doc))
#
# Usage: sign-smoke-feed.sh <feed.json> <repo-root>
set -euo pipefail

FEED="$1"
REPO_ROOT="$2"
: "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY is required to sign the smoke feed}"

ENVELOPE="$(dirname "$FEED")/envelope.json"
# Envelope shape MUST match presto_core::update_manifest::SignedEnvelope (deny_unknown_fields):
# exactly {schema, version, pub_date, platforms:{key:{url,size,signature}}}. The feed's platform
# entries already carry exactly {signature,url,size}, so projecting them is field-name-exact.
jq '{schema: "presto-update-manifest-v1", version, pub_date, platforms}' "$FEED" > "$ENVELOPE"

# Sign the exact envelope bytes with the updater key (bunx resolves @tauri-apps/cli from the package).
( cd "$REPO_ROOT/packages/presto" && bunx tauri signer sign "$ENVELOPE" )

# base64 of the signed bytes; strip newlines (BSD + GNU base64 both wrap by default).
MANIFEST_B64="$(base64 < "$ENVELOPE" | tr -d '\n')"
MANIFEST_SIG="$(cat "$ENVELOPE.sig")" # already base64(minisign doc) — embed verbatim

jq --arg m "$MANIFEST_B64" --arg s "$MANIFEST_SIG" '. + {manifest: $m, manifest_sig: $s}' \
  "$FEED" > "$FEED.signed"
mv "$FEED.signed" "$FEED"
echo "── signed smoke feed: manifest + manifest_sig spliced ──"
