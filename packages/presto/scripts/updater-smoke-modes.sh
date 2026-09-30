#!/usr/bin/env bash
# Sourced by updater-smoke.sh (macOS) and updater-smoke-linux.sh: how the app under test is
# launched and stopped, and the modes whose checks are identical on both. The caller defines
# APP_BIN, HEALTH, WORK, CONFIG_DIR, N_VERSION, REPO_ROOT and log(). Written for macOS's bash 3.2.

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
