#!/usr/bin/env bash
# Open the release bot's PR from BRANCH (or refresh the open one), apply LABEL, and with
# AUTO_MERGE=true enable squash auto-merge. `--match-head-commit` makes GitHub refuse unless the
# branch tip is still HEAD_SHA, the commit the workflow pushed; it does not stop a later push by
# someone with write access from riding along.
# Env: GH_TOKEN, BASE, BRANCH, TITLE, BODY, LABEL (optional), AUTO_MERGE (true | false), HEAD_SHA,
# MERGE_TOKEN (optional; enables auto-merge instead of GH_TOKEN, for a PR token that cannot merge).
# Outputs: number.
set -euo pipefail

: "${GH_TOKEN:?}" "${BASE:?}" "${BRANCH:?}" "${TITLE:?}" "${BODY:?}" "${GITHUB_REPOSITORY:?}"
out="${GITHUB_OUTPUT:-/dev/null}"
case "${AUTO_MERGE:-false}" in
  true) : "${HEAD_SHA:?auto-merge needs the pushed head}" ;;
  false) ;;
  *) echo "::error::AUTO_MERGE must be true or false"; exit 1 ;;
esac

# Same-repository PRs only: a fork can open a PR from a branch of the same name.
number="$(gh pr list --repo "$GITHUB_REPOSITORY" --base "$BASE" --head "$BRANCH" --state open \
  --json number,isCrossRepository \
  --jq '[.[] | select(.isCrossRepository | not) | .number][0] // empty')"
if [ -n "$number" ]; then
  gh pr edit "$number" --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body "$BODY" \
    ${LABEL:+--add-label "$LABEL"}
else
  url="$(gh pr create --repo "$GITHUB_REPOSITORY" --base "$BASE" --head "$BRANCH" \
    --title "$TITLE" --body "$BODY" ${LABEL:+--label "$LABEL"})"
  number="${url##*/}"
fi
case "$number" in
  '' | *[!0-9]*) echo "::error::could not resolve the PR number"; exit 1 ;;
esac
echo "number=$number" >> "$out"
echo "PR #$number: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/pull/$number"

if [ "${AUTO_MERGE:-false}" = true ]; then
  GH_TOKEN="${MERGE_TOKEN:-$GH_TOKEN}" gh pr merge "$number" --repo "$GITHUB_REPOSITORY" \
    --auto --squash --delete-branch --match-head-commit "$HEAD_SHA"
fi
