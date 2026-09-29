#!/usr/bin/env bash
# Deploys the forwarder with its upstream (`up`) or deletes the Worker (`down`). Runs only as an
# env-exec keyed run from deploy.env.example: the upstream reaches wrangler on stdin, never argv.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"

case "${1:-}" in
  up)
    : "${AZTEC_NODE_URL:?}"
    bunx wrangler deploy
    printf %s "$AZTEC_NODE_URL" | bunx wrangler secret put AZTEC_NODE_URL
    ;;
  down)
    bunx wrangler delete --force
    ;;
  *)
    echo "usage: forwarder.sh up|down" >&2
    exit 2
    ;;
esac
