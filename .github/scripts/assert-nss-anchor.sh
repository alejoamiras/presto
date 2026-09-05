#!/usr/bin/env bash
# Read-only preservation assertion: use certutil's public interface, not mutable DB-file hashes.
set -euo pipefail
[[ "$#" -eq 3 ]] || { echo "usage: assert-nss-anchor.sh <nss-db> <nickname> <original-ca.pem>" >&2; exit 2; }
NSS_DB=$1
NSS_NICKNAME=$2
ORIGINAL_CA=$3
EXPECTED_HASH=$(openssl x509 -in "$ORIGINAL_CA" -outform DER | openssl dgst -sha256)
ACTUAL_HASH=$(certutil -L -d "sql:$NSS_DB" -n "$NSS_NICKNAME" -r | openssl dgst -sha256)
[[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]] || { echo "Legacy NSS certificate bytes changed" >&2; exit 1; }
TRUST_FLAGS=$(certutil -L -d "sql:$NSS_DB" | awk -v nick="$NSS_NICKNAME" '$1 == nick {print $2}')
[[ "$TRUST_FLAGS" == 'C,,' ]] || { echo "Legacy NSS trust flags changed" >&2; exit 1; }
certutil -V -u L -d "sql:$NSS_DB" -n "$NSS_NICKNAME" >/dev/null
