#!/usr/bin/env bash
# Sourced by updater-smoke.sh (macOS) and updater-smoke-linux.sh: how the app under test is
# launched and stopped, and the modes whose checks are identical on both. The caller defines
# APP_BIN, HEALTH, WORK, SERVE_DIR, CONFIG_DIR, N_VERSION, REPO_ROOT and log(). Written for macOS's
# bash 3.2.

# The feed's artifact prefix before it goes silent: well below any real payload.
# shellcheck disable=SC2034  # read by the sourcing script
STALL_AFTER_BYTES=65536

# The PID listening on /health's port, or nothing.
health_listener() {
  local port="${HEALTH##*:}"
  lsof -nP -iTCP:"${port%%/*}" -sTCP:LISTEN -t 2>/dev/null | head -1
}

# The version /health reports, or nothing.
health_version() {
  curl -sf --max-time 5 "$HEALTH" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true
}

# Starts the app as its own process-group leader, so stop_app ends exactly this app (the AppImage
# runtime's child included) and never another run's. NO_COLOR keeps its stdout grep-able. Returns
# once the group exists: until the child's setpgrp runs, every group check reads "exited".
launch_app() {
  NO_COLOR=1 perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or die "exec $ARGV[0]: $!\n"' \
    "$APP_BIN" > "$1" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 50); do
    kill -0 -"$APP_PID" 2>/dev/null && return 0
    kill -0 "$APP_PID" 2>/dev/null || break
    sleep 0.1
  done
  echo "::error::the app did not start (see $(basename "$1"))"
  return 1
}

# Ends the launched process group, then waits for /health to close so the next launch can bind it.
stop_app() {
  kill -TERM -"$APP_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -"$APP_PID" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL -"$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  for _ in $(seq 1 30); do
    curl -sf --max-time 3 "$HEALTH" >/dev/null 2>&1 || return 0
    sleep 1
  done
  echo "::error::/health still answers after the app's process group was killed"
  return 1
}

# wait_for_line <file> <ERE> <seconds>: fails early once the launched app is gone.
wait_for_line() {
  for _ in $(seq 1 "$3"); do
    grep -qE -- "$2" "$1" 2>/dev/null && return 0
    if ! kill -0 -"$APP_PID" 2>/dev/null; then
      echo "::error::the app exited before logging: $2"
      return 1
    fi
    sleep 1
  done
  echo "::error::nothing matched '$2' in $(basename "$1") within $3s"
  return 1
}

# Waits for the launched N-1 to answer /health and prints its version.
wait_for_n1() {
  local got
  for _ in $(seq 1 60); do
    got="$(health_version)"
    if [ -n "$got" ] && [ "$got" != "$N_VERSION" ]; then
      echo "$got"
      return 0
    fi
    sleep 1
  done
  echo "::error::N-1 never answered /health with a version other than $N_VERSION" >&2
  return 1
}

# Drives the app's tray menu over the session bus, as a tray host would (Linux: TRAY_CLICK=1).
tray_menu() {
  bun "$REPO_ROOT/packages/presto/scripts/tray-menu.ts" "$@"
}

# A schedule file holding only a 24 h snooze, in the shape the app writes.
write_snooze() {
  printf '{"schema":1,"snooze":{"version":"%s","until":%d}}\n' "$1" "$(($(date +%s) + 86400))" \
    > "$CONFIG_DIR/update-schedule.json"
}

# positive: N's own launch check, after /health first reported N at $1, must be on disk.
assert_schedule_written_by_n() {
  bun "$REPO_ROOT/packages/presto/scripts/assert-update-schedule.ts" \
    "$CONFIG_DIR/update-schedule.json" --by "$N_VERSION" --since "$1" --wait 90
}

# prompt: with auto-update off, N-1 presents N; a snooze for N holds the prompt back across a
# restart; a snooze for another version does not. Every launch reads only its own stdout file.
run_prompt_mode() {
  local v_re="${N_VERSION//./\\.}" n1
  local presented="Update prompt presented version=${v_re}\$"
  local snoozed="Update snoozed; prompt suppressed version=${v_re} "
  rm -f "$CONFIG_DIR/update-schedule.json"

  log "PROMPT 1/3: N-1 presents $N_VERSION"
  launch_app "$WORK/app-1.log" || return 1
  n1="$(wait_for_n1)" || return 1
  wait_for_line "$WORK/app-1.log" "$presented" 120 || return 1
  stop_app || return 1

  log "PROMPT 2/3: a snooze for $N_VERSION holds the prompt back after a restart"
  write_snooze "$N_VERSION"
  launch_app "$WORK/app-2.log" || return 1
  wait_for_line "$WORK/app-2.log" "$snoozed" 120 || return 1
  sleep 30
  if grep -qE "Showing update prompt|Update prompt presented" "$WORK/app-2.log"; then
    echo "::error::the prompt was shown within 30s although $N_VERSION is snoozed"
    return 1
  fi
  if [ "$(health_version)" != "$n1" ]; then
    echo "::error::N-1 ($n1) stopped answering /health during the snoozed launch"
    return 1
  fi
  # Only a manual check presents under a snooze, and none ran before the click, so the prompt
  # appearing now proves the real click → real feed → prompt path in a hook-free release binary.
  if [ "${TRAY_CLICK:-}" = 1 ]; then
    log "PROMPT 2b/3: the tray's Check for Updates… presents $N_VERSION despite the snooze"
    tray_menu click "Check for Updates…" || return 1
    wait_for_line "$WORK/app-2.log" "$presented" 120 || return 1
    tray_menu wait "Check for Updates…" 30 || return 1
  else
    log "PROMPT 2b/3: skipped, this OS exposes no scriptable tray menu"
  fi
  stop_app || return 1

  log "PROMPT 3/3: a snooze for another version does not hold $N_VERSION back"
  write_snooze "0.0.0"
  launch_app "$WORK/app-3.log" || return 1
  wait_for_line "$WORK/app-3.log" "$presented" 120 || return 1
  stop_app || return 1
  log "SUCCESS (prompt) — presented, held back by its snooze across a restart, presented again under another version's snooze"
}

# stall: the feed sends $STALL_AFTER_BYTES of N and goes silent. The download watchdog abandons it
# 60 s after the last byte; the same N-1 process keeps serving, and no install intent is recorded.
run_stall_mode() {
  local n1 pid_before last_chunk seen elapsed state="$CONFIG_DIR/updater-state.json"
  n1="$(wait_for_n1)" || return 1
  pid_before="$(health_listener)"
  [ -n "$pid_before" ] || { echo "::error::no process listens on /health's port"; return 1; }
  log "STALL: N-1 $n1 serves /health from PID $pid_before; waiting for the feed to go silent"

  wait_for_line "$WORK/feed.log" "feed-server: stalled .* last_chunk_at=[0-9]+\$" 120 || return 1
  last_chunk="$(grep -oE 'last_chunk_at=[0-9]+' "$WORK/feed.log" | head -1 | cut -d= -f2)"
  wait_for_line "$WORK/app.log" "Update download stalled; aborting" 150 || return 1
  seen="$(date +%s)"
  elapsed=$((seen - last_chunk))
  if [ "$elapsed" -lt 60 ] || [ "$elapsed" -gt 120 ]; then
    echo "::error::the watchdog fired ${elapsed}s after the last byte, outside 60–120s"
    return 1
  fi
  if [ "$(health_version)" != "$n1" ]; then
    echo "::error::/health no longer reports N-1 ($n1) after the stall"
    return 1
  fi
  if [ "$(health_listener)" != "$pid_before" ]; then
    echo "::error::a different process serves /health after the stall; N-1 restarted"
    return 1
  fi
  if [ -f "$state" ] && ! jq -e '.pending == null' "$state" >/dev/null; then
    echo "::error::updater-state.json records a pending install after an abandoned download"
    return 1
  fi
  log "SUCCESS (stall) — download abandoned ${elapsed}s after the last byte; N-1 $n1 still serving from PID $pid_before, nothing pending"
}

# rc-lifecycle staging, before the feed server starts: R's payload beside N's, and the directory the
# server's --feed-dir reads per request. $1 is the payload's name pattern. Reads R_VERSION and
# R_ARTIFACTS_DIR (R's payload and the feeds `ephemeral-updater.sh rc-feeds` signed over it).
stage_rc_lifecycle() {
  local payload name
  : "${R_VERSION:?rc-lifecycle needs R_VERSION}" "${R_ARTIFACTS_DIR:?rc-lifecycle needs R_ARTIFACTS_DIR}"
  payload="$(find "$R_ARTIFACTS_DIR" -name "$1" | head -1)"
  [ -n "$payload" ] || { echo "::error::no $1 among R's artifacts"; return 1; }
  cp "$payload" "$SERVE_DIR/"
  for name in smoke-latest-rc smoke-latest-rc-v1 smoke-latest-rc2 smoke-latest-old; do
    [ -f "$R_ARTIFACTS_DIR/$name.json" ] || { echo "::error::no $name.json among R's artifacts"; return 1; }
  done
  mkdir -p "$WORK/feeds"
  # The readiness probe reads latest.json before the first leg stages its own.
  cp "$WORK/latest.json" "$WORK/feeds/latest.json"
}

# serve_feed <latest.json|latest-rc.json> <feed file | HTTP status>
serve_feed() {
  rm -f "$WORK/feeds/$1" "$WORK/feeds/$1.status"
  case "$2" in
    [1-5][0-9][0-9]) echo "$2" > "$WORK/feeds/$1.status" ;;
    *) cp "$2" "$WORK/feeds/$1" ;;
  esac
}

# rc-lifecycle's configs. Auto-update stays on, so a feed the app admits installs unasked.
seed_pre_channel() {
  echo '{"config_version":1,"safari_support":false,"approved_origins":[],"speed":"full","auto_update":true,"onboarding_version":1}' > "$CONFIG_DIR/config.json"
}
# seed_developer <true|false> <stable|rc>
seed_developer() {
  printf '{"config_version":2,"https_enabled":false,"approved_origins":[],"speed":"full","auto_update":true,"onboarding_version":1,"developer":{"enabled":%s,"update_channel":"%s"}}\n' \
    "$1" "$2" > "$CONFIG_DIR/config.json"
}

# The feed log's length: a launch reads only the requests after its mark.
feed_mark() {
  wc -l < "$WORK/feed.log" | tr -d ' '
}

# The paths requested since <mark>, in order.
feed_paths_since() {
  tail -n +"$(($1 + 1))" "$WORK/feed.log" | sed -nE 's/^feed-server: GET ([^ ]+) -> .*/\1/p'
}

# The feed requests since <mark>, in order, each followed by a space.
feeds_since() {
  feed_paths_since "$1" | grep -E '^/releases/latest(-rc)?\.json$' | tr '\n' ' '
}

# wait_for_feed <mark> <path> <seconds>
wait_for_feed() {
  local end
  end=$(($(date +%s) + $3))
  while [ "$(date +%s)" -lt "$end" ]; do
    feed_paths_since "$1" | grep -qxF "$2" && return 0
    sleep 1
  done
  echo "::error::the app never requested $2 within $3s"
  return 1
}

# wait_for_version <version> <seconds>
wait_for_version() {
  local end
  end=$(($(date +%s) + $2))
  while [ "$(date +%s)" -lt "$end" ]; do
    [ "$(health_version)" = "$1" ] && return 0
    sleep 2
  done
  echo "::error::/health never reported $1 within $2s (last: '$(health_version)')"
  return 1
}

# assert_refused <leg> <mark> <app log> <running version> <refusal>: the app fetched the stable feed
# alone, downloaded nothing and still serves <running version> 60 s on. The refusal line is read
# last, so a build that admits the feed fails on its download, not on a missing log line.
assert_refused() {
  local leg=$1 mark=$2 out=$3 running=$4 refusal=$5 end got
  wait_for_feed "$mark" /releases/latest.json 60 || return 1
  end=$(($(date +%s) + 60))
  while [ "$(date +%s)" -lt "$end" ]; do
    if feed_paths_since "$mark" | grep -q '^/releases/download/'; then
      echo "::error::$leg: the app downloaded an update it must refuse"
      return 1
    fi
    got="$(health_version)"
    if [ -n "$got" ] && [ "$got" != "$running" ]; then
      echo "::error::$leg: /health reports $got, not $running"
      return 1
    fi
    sleep 2
  done
  if [ "$(health_version)" != "$running" ]; then
    echo "::error::$leg: the app no longer serves /health as $running"
    return 1
  fi
  if feed_paths_since "$mark" | grep -qxF /releases/latest-rc.json; then
    echo "::error::$leg: the app requested latest-rc.json on the stable channel"
    return 1
  fi
  if ! grep -qE "update refused on channel stable: $refusal" "$out"; then
    echo "::error::$leg: no '$refusal' refusal in $(basename "$out")"
    return 1
  fi
}

# assert_installed <leg> <mark> <feed order>: this launch's feed requests began in that order, and
# an artifact was downloaded.
assert_installed() {
  local feeds
  feeds="$(feeds_since "$2")"
  case "$feeds" in
    "$3"*) ;;
    *) echo "::error::$1: feed requests were '$feeds', expected them to begin '$3'"; return 1 ;;
  esac
  if ! feed_paths_since "$2" | grep -q '^/releases/download/'; then
    echo "::error::$1: /health changed version without a download from this feed"
    return 1
  fi
}

assert_developer_rc() {
  if ! jq -e '.developer == {"enabled": true, "update_channel": "rc"}' "$CONFIG_DIR/config.json" >/dev/null; then
    echo "::error::$1: config.json no longer holds developer {enabled, rc}: $(cat "$CONFIG_DIR/config.json")"
    return 1
  fi
}

# rc-lifecycle: one installed app, N-1 → R → N, through the candidate channel's transitions. A1 and
# A2 refuse R on the stable channel; B opts in and installs R through latest-rc.json, whose 0.0.1
# alternative on latest.json would end a reversed check with nothing; C1 leaves and refuses a newer
# candidate; C2 opts in again and takes N from latest.json while latest-rc.json answers 503.
run_rc_lifecycle_mode() {
  local feeds="$R_ARTIFACTS_DIR" n1 mark

  log "A1: the stable channel refuses R's rc-v1 feed"
  seed_pre_channel
  serve_feed latest.json "$feeds/smoke-latest-rc.json"
  serve_feed latest-rc.json "$feeds/smoke-latest-rc.json"
  mark="$(feed_mark)"
  launch_app "$WORK/app-a1.log" || return 1
  n1="$(wait_for_n1)" || return 1
  [ "$n1" != "$R_VERSION" ] || { echo "::error::N-1 already runs R ($R_VERSION)"; return 1; }
  assert_refused A1 "$mark" "$WORK/app-a1.log" "$n1" CandidateOffChannel || return 1
  stop_app || return 1

  log "A2: the stable channel refuses R's v1 feed, a prerelease"
  seed_pre_channel
  serve_feed latest.json "$feeds/smoke-latest-rc-v1.json"
  serve_feed latest-rc.json "$feeds/smoke-latest-rc-v1.json"
  mark="$(feed_mark)"
  launch_app "$WORK/app-a2.log" || return 1
  wait_for_version "$n1" 60 || return 1
  assert_refused A2 "$mark" "$WORK/app-a2.log" "$n1" PrereleaseNotCandidate || return 1
  stop_app || return 1

  log "B: opted in, the launch check installs R from latest-rc.json"
  seed_developer true rc
  serve_feed latest-rc.json "$feeds/smoke-latest-rc.json"
  serve_feed latest.json "$feeds/smoke-latest-old.json"
  mark="$(feed_mark)"
  launch_app "$WORK/app-b.log" || return 1
  wait_for_version "$R_VERSION" 300 || return 1
  assert_installed B "$mark" "/releases/latest-rc.json " || return 1
  if feed_paths_since "$mark" | grep -qxF /releases/latest.json; then
    echo "::error::B: the app fell back to latest.json although latest-rc.json answered"
    return 1
  fi
  assert_developer_rc B || return 1
  stop_app || return 1

  log "C1: developer mode off, R refuses a newer candidate"
  seed_developer false stable
  serve_feed latest.json "$feeds/smoke-latest-rc2.json"
  serve_feed latest-rc.json "$feeds/smoke-latest-rc2.json"
  mark="$(feed_mark)"
  launch_app "$WORK/app-c1.log" || return 1
  wait_for_version "$R_VERSION" 60 || return 1
  assert_refused C1 "$mark" "$WORK/app-c1.log" "$R_VERSION" CandidateOffChannel || return 1
  stop_app || return 1

  log "C2: on the channel again, R takes $N_VERSION from latest.json while latest-rc.json answers 503"
  seed_developer true rc
  serve_feed latest-rc.json 503
  serve_feed latest.json "$WORK/latest.json"
  mark="$(feed_mark)"
  launch_app "$WORK/app-c2.log" || return 1
  wait_for_version "$N_VERSION" 300 || return 1
  assert_installed C2 "$mark" "/releases/latest-rc.json /releases/latest.json " || return 1
  assert_developer_rc C2 || return 1
  if grep -l "running read-only" "$WORK"/app-*.log; then
    echo "::error::a launch ran with a read-only config"
    return 1
  fi
  log "SUCCESS (rc-lifecycle) — refused R twice on stable, installed R on rc, refused a newer candidate after leaving, took $N_VERSION through the fallback"
}
