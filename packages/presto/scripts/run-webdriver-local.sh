#!/usr/bin/env bash
# Local WebDriver E2E: builds the webdriver-featured app, supervises it (and, when needed, an
# owned Xvfb/DBus/stalonetray stack mirroring _e2e-webdriver.yml), runs the WDIO suite, and tears
# down ONLY what it started. Fails fast when the host cannot provide a display; fix with
#   sudo apt install xvfb stalonetray dbus-x11
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG_DIR"

OWNED_PGIDS=()
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/presto-webdriver.XXXXXX")"
cleanup() {
  for pgid in "${OWNED_PGIDS[@]:-}"; do
    if [ -n "$pgid" ]; then
      kill -- "-$pgid" 2>/dev/null || true
    fi
  done
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT INT TERM

port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

require_port() {
  if ! port_free "$1"; then
    echo "ERROR: port $1 is already in use (a real presto or another run?):" >&2
    ss -ltnp "sport = :$1" 2>/dev/null || true
    exit 1
  fi
}

# ── Display preflight ──
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  if ! command -v Xvfb >/dev/null || ! command -v stalonetray >/dev/null; then
    echo "ERROR: no display and Xvfb/stalonetray are not installed." >&2
    echo "Fix: sudo apt install xvfb stalonetray dbus-x11   (then rerun)" >&2
    echo "Or defer this suite to CI at PR time (deferred-with-consent)." >&2
    exit 2
  fi
  echo "No display: starting owned Xvfb + DBus + stalonetray (as CI does)"
  setsid Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
  OWNED_PGIDS+=("$!")
  export DISPLAY=:99
  sleep 1
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-launch >/dev/null; then
    eval "$(dbus-launch --sh-syntax)"
    export DBUS_SESSION_BUS_ADDRESS
    [ -n "${DBUS_SESSION_BUS_PID:-}" ] && OWNED_PGIDS+=("$DBUS_SESSION_BUS_PID")
  fi
  setsid stalonetray >/dev/null 2>&1 &
  OWNED_PGIDS+=("$!")
fi

# ── Port preflight (4445 = tauri-plugin-webdriver, 59833 = the app's server) ──
require_port 4445
require_port 59833

# ── Build with the webdriver feature ──
echo "Building webdriver-featured app (this can take a while cold)..."
bun run frontend:build
( cd src-tauri && cargo build --features webdriver )

BIN="src-tauri/target/debug/Presto"
[ -x "$BIN" ] || BIN="src-tauri/target/debug/presto"
if [ ! -x "$BIN" ]; then
  echo "ERROR: built binary not found under src-tauri/target/debug" >&2
  exit 1
fi

# ── The loopback verified-sites feed, in its own process group (as _e2e-webdriver.yml) ──
LOG_DIR="${WEBDRIVER_LOG_DIR:-implementations-plan/presto-visual-rebrand/lessons}"
mkdir -p "$PKG_DIR/../../$LOG_DIR" 2>/dev/null || LOG_DIR="."
export VERIFIED_SITES_E2E_FEED_STATE="$RUN_DIR/verified-sites-feed.json"
FEED_LOG="$PKG_DIR/../../$LOG_DIR/webdriver-verified-sites-feed.log"
setsid bun scripts/verified-sites-e2e-feed.ts --state "$VERIFIED_SITES_E2E_FEED_STATE" >"$FEED_LOG" 2>&1 &
OWNED_PGIDS+=("$!")
for _ in $(seq 1 100); do
  [ -s "$VERIFIED_SITES_E2E_FEED_STATE" ] && break
  sleep 0.1
done
if [ ! -s "$VERIFIED_SITES_E2E_FEED_STATE" ]; then
  echo "ERROR: the verified-sites feed wrote no state; log: $FEED_LOG" >&2
  exit 1
fi
# The key is a two-line document whose final newline `$(...)` strips, so it is put back.
field() {
  F="$1" bun -e 'const s = await Bun.file(process.env.VERIFIED_SITES_E2E_FEED_STATE).json()
    process.stdout.write(String(s[process.env.F]))'
}
PRESTO_E2E_VERIFIED_SITES_URL=$(field url)
PRESTO_E2E_VERIFIED_SITES_PUBKEY="$(field pubkey)"$'\n'
export PRESTO_E2E_VERIFIED_SITES_URL PRESTO_E2E_VERIFIED_SITES_PUBKEY
# The app's WebDriver-only tray driver writes here, and tray-update.spec.ts reads it.
export PRESTO_E2E_TRAY_REPORT="$RUN_DIR/tray-report.json"
# The custom bb picker's answer: a copy of the sidecar in this run's private (0700) directory, since
# Presto refuses a file another account could change.
TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
install -m 755 "src-tauri/binaries/bb-$TRIPLE" "$RUN_DIR/bb"
export PRESTO_E2E_CUSTOM_BB_PATH="$RUN_DIR/bb"

# ── Launch the app in its own process group, logs captured ──
APP_LOG="$PKG_DIR/../../$LOG_DIR/webdriver-app.log"
setsid "$BIN" >"$APP_LOG" 2>&1 &
OWNED_PGIDS+=("$!")

# ── Readiness: BOTH the webdriver port and the health endpoint, and the app still alive ──
APP_PID="${OWNED_PGIDS[${#OWNED_PGIDS[@]}-1]}"
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "ERROR: the app exited during startup; log: $APP_LOG" >&2
    exit 1
  fi
  if ! port_free 4445 && curl -fsS "http://127.0.0.1:59833/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "ERROR: webdriver (4445) + health (59833) never both became ready; app log: $APP_LOG" >&2
  exit 1
fi

# ── Run the suite ──
bun run test:e2e:webdriver
