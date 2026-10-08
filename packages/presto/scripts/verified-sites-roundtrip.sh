#!/usr/bin/env bash
# The PR gate's round trip of the signing path under a throwaway key: the production signer signs the
# source list exactly as the signing job does, the production CLI wraps and verifies it, stock
# minisign verifies it too, and every negative below must be refused.
#   verified-sites-roundtrip.sh <verified-sites CLI binary>
# The key is fresh per run unless VERIFIED_SITES_ROUNDTRIP_SEED (64 hex) is set; MINISIGN overrides
# the minisign command. The key has no authority: nothing pins it, and it dies with the run.
set -euo pipefail

[ "$#" -eq 1 ] || { echo "usage: verified-sites-roundtrip.sh <cli>" >&2; exit 2; }
cli="$(realpath "$1")"
presto="$(cd "$(dirname "$0")/.." && pwd)"
read -ra minisign <<<"${MINISIGN:-minisign}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

seed="${VERIFIED_SITES_ROUNDTRIP_SEED:-}"
[ -n "$seed" ] || seed="$(openssl rand -hex 32)"
cp "$presto/scripts/verified-sites-signer.ts" "$presto/verified-sites.json" .
mv verified-sites.json list.json
signer() {
  PRESTO_VERIFIED_SITES_SIGNING_SEED="$seed" \
    bun --no-install --no-env-file --config=/dev/null verified-sites-signer.ts "$@"
}
sign() { # <list> <pubkey> <out>
  signer sign --list "$1" --pubkey "$2" --expect-sha256 "$(sha256sum "$1" | cut -d' ' -f1)" --out "$3"
}
refused() { # <what> <expected error> <command...>: the command must fail, for that reason
  local what="$1" expected="$2" error
  shift 2
  if error="$("$@" 2>&1 >/dev/null)"; then
    echo "::error::round trip: $what was accepted"
    exit 1
  fi
  if [[ "$error" != *"$expected"* ]]; then
    echo "::error::round trip: $what failed for another reason: $error"
    exit 1
  fi
  echo "refused: $what"
}

[ -f "$presto/verified-sites/key.pub" ] || { echo "::error::verified-sites/key.pub is missing"; exit 1; }
signer pubkey >throwaway.pub
sha256="$(sha256sum list.json | cut -d' ' -f1)"
version="$(jq -e '.version' list.json)"
sign list.json throwaway.pub list.json.minisig
"$cli" document list.json list.json.minisig >document.json
"$cli" verify --document document.json --pubkey throwaway.pub \
  --expect-sha256 "$sha256" --expect-version "$version"
"${minisign[@]}" -V -H -q -m list.json -p throwaway.pub
echo "accepted: the source list, signed, wrapped and verified"

refused "a list verified under the production key" "signed by a different key" \
  "$cli" verify --document document.json --pubkey "$presto/verified-sites/key.pub"
refused "a signer whose seed is not the pinned key" "does not match the pinned public key" \
  sign list.json "$presto/verified-sites/key.pub" pinned.minisig

sed 's/"version": /"version":  /' list.json >tampered.json
cmp -s list.json tampered.json && { echo "::error::the tampered list is unchanged"; exit 1; }
"$cli" document tampered.json list.json.minisig >tampered-document.json
refused "a tampered list" "signature does not verify" "$cli" verify --document tampered-document.json --pubkey throwaway.pub

sed 's/^trusted comment: .*/trusted comment: presto-verified-sites-v2/' list.json.minisig >edited.minisig
"$cli" document list.json edited.minisig >edited-document.json
refused "an edited trusted comment" "unexpected trusted comment" "$cli" verify --document edited-document.json --pubkey throwaway.pub

jq '. + {comment: "not a field"}' list.json >unknown.json
sign unknown.json throwaway.pub unknown.json.minisig
"$cli" document unknown.json unknown.json.minisig >unknown-document.json
refused "a signed list with an unknown field" "unknown field" \
  "$cli" verify --document unknown-document.json --pubkey throwaway.pub

mkdir -p history retired-keys
cp list.json "history/$version.json"
cp list.json.minisig "history/$version.json.minisig"
jq '.entries[0].displayName = "Someone Else"' list.json >equivocating.json
refused "a different list at a recorded version" "must be above the newest record" \
  "$cli" check --source equivocating.json --history history --pubkey throwaway.pub \
  --retired retired-keys --live-absent --publish
