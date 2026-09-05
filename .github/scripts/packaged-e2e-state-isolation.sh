#!/usr/bin/env bash
# This test seeds historical fixtures ONLY on a disposable GitHub-hosted Linux runner.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] || {
  echo "Refusing to seed historical state outside a disposable GitHub-hosted runner" >&2
  exit 1
}
LEGACY_NAME=$(jq -er '.stateDirectory' audit/fixtures/legacy-identity.json)
LEGACY_AUTOSTART=$(jq -er '.autostartFile' audit/fixtures/legacy-identity.json)
[[ "$LEGACY_NAME" == .* && "$LEGACY_NAME" != */* && "$LEGACY_AUTOSTART" != */* ]]
LEGACY_DIR="$HOME/$LEGACY_NAME"
LEGACY_ENTRY="$HOME/.config/autostart/$LEGACY_AUTOSTART"
test ! -e "$LEGACY_DIR"
test ! -e "$LEGACY_ENTRY"
test ! -e "$HOME/.presto"
mkdir -p "$LEGACY_DIR/certs" "$LEGACY_DIR/versions" "$HOME/.config/autostart"
printf '%s' '{"approved_origins":["https://historical.example"],"https_enabled":true}' > "$LEGACY_DIR/config.json"
printf '%s' 'historical certificate sentinel' > "$LEGACY_DIR/certs/ca.pem"
printf '%s' 'historical cache sentinel' > "$LEGACY_DIR/versions/sentinel"
printf '%s\n' '[Desktop Entry]' 'Name=Historical fixture' > "$LEGACY_ENTRY"
snapshot() {
  find "$LEGACY_DIR" -type f -exec sha256sum {} + | sort
  sha256sum "$LEGACY_ENTRY"
}
BEFORE=$(snapshot)
mapfile -t INSTALLERS < <(find app-artifact -name '*.deb')
test "${#INSTALLERS[@]}" -eq 1
PACKAGE=$(dpkg-deb -f "${INSTALLERS[0]}" Package)
sudo apt-get install -y "./${INSTALLERS[0]}"
dbus-launch Presto >/tmp/presto-state-isolation.log 2>&1 &
PRESTO_TEST_PID=$!
trap 'kill "$PRESTO_TEST_PID" 2>/dev/null || true' EXIT
READY=false
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:59833/health >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
test "$READY" = true
test "$BEFORE" = "$(snapshot)"
if [ -f "$HOME/.presto/config.json" ]; then
  jq -e '(.approved_origins // []) | index("https://historical.example") | not' "$HOME/.presto/config.json"
fi
kill "$PRESTO_TEST_PID" 2>/dev/null || true
wait "$PRESTO_TEST_PID" 2>/dev/null || true
Presto --prepare-uninstall
test "$BEFORE" = "$(snapshot)"
sudo apt-get remove -y "$PACKAGE"
test "$BEFORE" = "$(snapshot)"
echo "Historical state, certificate and autostart fixtures are byte-identical after install/launch/uninstall."
