#!/usr/bin/env bash
# Commit exactly PATHS on a new branch as github-actions[bot] and push it with the credentials
# actions/checkout persisted. Never force-pushes: an existing branch fails the run, or with
# IF_EXISTS=skip is kept as pushed (rewriting it would orphan the commit its CI runs against).
# Env: BRANCH, MESSAGE, PATHS (one per line), IF_EXISTS (fail | skip).
# Outputs: pushed (true | false), head (the branch tip).
set -euo pipefail

: "${BRANCH:?}" "${MESSAGE:?}" "${PATHS:?}"
out="${GITHUB_OUTPUT:-/dev/null}"
case "${IF_EXISTS:-fail}" in
  fail | skip) ;;
  *) echo "::error::IF_EXISTS must be fail or skip"; exit 1 ;;
esac

if remote="$(git ls-remote --exit-code --heads origin "refs/heads/$BRANCH")"; then
  if [ "${IF_EXISTS:-fail}" = skip ]; then
    echo "Branch $BRANCH already exists on origin; keeping it as pushed"
    { echo "pushed=false"; echo "head=${remote%%[[:space:]]*}"; } >> "$out"
    exit 0
  fi
  echo "::error::branch $BRANCH already exists on origin"
  exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$BRANCH"

mapfile -t paths < <(printf '%s\n' "$PATHS" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d')
git add -- "${paths[@]}"
if git diff --cached --quiet; then
  echo "::error::none of the listed paths changed; nothing to commit"
  exit 1
fi
git commit -m "$MESSAGE"

# A change outside PATHS means the caller's list is stale: fail before anything leaves the runner.
leftover="$(git status --porcelain --untracked-files=all)"
if [ -n "$leftover" ]; then
  printf '%s\n' "$leftover"
  echo "::error::changes outside the listed paths were left behind; extend the paths input"
  exit 1
fi

git push origin "refs/heads/$BRANCH"
{ echo "pushed=true"; echo "head=$(git rev-parse HEAD)"; } >> "$out"
