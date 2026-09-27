#!/usr/bin/env bash
# Build the playground, start vite preview, run Playwright production smoke tests.
# Properly captures the Playwright exit code and cleans up the preview server.
set -euo pipefail

echo "Building playground..."
bun run build

echo "Starting vite preview on port 4173..."
# Job control puts the preview in its own process group, so cleanup reaches the server npx spawns,
# not only the wrapper; a surviving server keeps 4173 bound and a caller reading this output waiting.
set -m
npx vite preview --port 4173 --strictPort &
PREVIEW_PGID=$!
set +m
trap 'kill -- "-$PREVIEW_PGID" 2>/dev/null || true' EXIT

# Poll until the server is ready (max 15s)
echo "Waiting for preview server..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4173/ > /dev/null 2>&1; then
    echo "Preview server ready after ${i}x500ms"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "::error::Preview server not ready after 15s"
    exit 1
  fi
  sleep 0.5
done

echo "Running production smoke tests..."
RESULT=0
bunx playwright test --project=production-smoke || RESULT=$?

exit "$RESULT"
