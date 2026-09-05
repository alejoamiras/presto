#!/usr/bin/env bash
# This test seeds historical fixtures ONLY on a disposable GitHub-hosted Linux runner.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] || {
  echo "Refusing to seed historical state outside a disposable GitHub-hosted runner" >&2
  exit 1
}
LEGACY_NAME=$(jq -er '.stateDirectory' audit/fixtures/legacy-identity.json)
LEGACY_AUTOSTART=$(jq -er '.autostartFile' audit/fixtures/legacy-identity.json)
LEGACY_CA_CN=$(jq -er '.caCommonName' audit/fixtures/legacy-identity.json)
LEGACY_NICK_PREFIX=$(jq -er '.nssNicknamePrefix' audit/fixtures/legacy-identity.json)
[[ "$LEGACY_NAME" == .* && "$LEGACY_NAME" != */* && "$LEGACY_AUTOSTART" != */* ]]
[[ "$LEGACY_NICK_PREFIX" =~ ^[a-z0-9-]+-$ ]]
LEGACY_DIR="$HOME/$LEGACY_NAME"
LEGACY_ENTRY="$HOME/.config/autostart/$LEGACY_AUTOSTART"
NSS_STORES=("$HOME/.pki/nssdb" "$HOME/.mozilla/firefox/presto-isolation.default")
FIREFOX_PROFILES="$HOME/.mozilla/firefox/profiles.ini"
test ! -e "$LEGACY_DIR"
test ! -e "$LEGACY_ENTRY"
test ! -e "$HOME/.presto"
test ! -e "$FIREFOX_PROFILES"
for database in "${NSS_STORES[@]}"; do test ! -e "$database"; done
mkdir -p "$LEGACY_DIR/certs" "$LEGACY_DIR/versions" "$HOME/.config/autostart"
printf '%s' '{"approved_origins":["https://historical.example"],"https_enabled":true}' > "$LEGACY_DIR/config.json"
TRUST_FIXTURE_DIR=$(mktemp -d)
trap 'rm -rf "$TRUST_FIXTURE_DIR"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$LEGACY_CA_CN" \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$TRUST_FIXTURE_DIR/ca-key.pem" -out "$LEGACY_DIR/certs/ca.pem" >/dev/null 2>&1
LEGACY_NICK_SUFFIX=$(openssl x509 -in "$LEGACY_DIR/certs/ca.pem" -outform DER | sha256sum | cut -c1-8)
LEGACY_NICKNAME="$LEGACY_NICK_PREFIX$LEGACY_NICK_SUFFIX"
for database in "${NSS_STORES[@]}"; do
  mkdir -p "$database"
  certutil -N --empty-password -d "sql:$database"
  certutil -A -d "sql:$database" -n "$LEGACY_NICKNAME" -t 'C,,' -i "$LEGACY_DIR/certs/ca.pem"
done
printf '%s\n' '[Profile0]' 'Name=Isolation fixture' 'IsRelative=1' 'Path=presto-isolation.default' > "$FIREFOX_PROFILES"
printf '%s' 'historical cache sentinel' > "$LEGACY_DIR/versions/sentinel"
printf '%s\n' '[Desktop Entry]' 'Name=Historical fixture' > "$LEGACY_ENTRY"
snapshot() {
  find "$LEGACY_DIR" -type f -exec sha256sum {} + | sort
  sha256sum "$LEGACY_ENTRY"
  sha256sum "$FIREFOX_PROFILES"
}
BEFORE=$(snapshot)
assert_legacy_unchanged() {
  test "$BEFORE" = "$(snapshot)"
  for database in "${NSS_STORES[@]}"; do
    bash .github/scripts/assert-nss-anchor.sh "$database" "$LEGACY_NICKNAME" "$LEGACY_DIR/certs/ca.pem"
  done
}
assert_legacy_unchanged
mapfile -t INSTALLERS < <(find app-artifact -name '*.deb')
test "${#INSTALLERS[@]}" -eq 1
PACKAGE=$(dpkg-deb -f "${INSTALLERS[0]}" Package)
sudo apt-get install -y "./${INSTALLERS[0]}"
dbus-launch Presto >/tmp/presto-state-isolation.log 2>&1 &
PRESTO_TEST_PID=$!
trap 'kill "$PRESTO_TEST_PID" 2>/dev/null || true; rm -rf "$TRUST_FIXTURE_DIR"' EXIT
READY=false
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:59833/health >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
test "$READY" = true
assert_legacy_unchanged
if [ -f "$HOME/.presto/config.json" ]; then
  jq -e '(.approved_origins // []) | index("https://historical.example") | not' "$HOME/.presto/config.json"
fi
kill "$PRESTO_TEST_PID" 2>/dev/null || true
wait "$PRESTO_TEST_PID" 2>/dev/null || true
Presto --prepare-uninstall
assert_legacy_unchanged
sudo apt-get remove -y "$PACKAGE"
assert_legacy_unchanged
echo "Historical files remain byte-identical and the original CA remains trusted in Chromium and Firefox NSS stores after install/launch/uninstall."
