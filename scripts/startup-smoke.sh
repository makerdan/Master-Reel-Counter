#!/usr/bin/env bash
# startup-smoke.sh — Starts the server briefly and verifies:
#   1. It binds to the port without crashing (exit 0 within timeout).
#   2. Stderr contains no ERR_ERL_KEY_GEN_IPV6 validation errors.
#
# Usage: bash scripts/startup-smoke.sh
# Exit codes: 0 = pass, 1 = fail

set -euo pipefail

SMOKE_PORT="${SMOKE_PORT:-5001}"
TIMEOUT="${SMOKE_TIMEOUT:-20}"
SMOKE_LOG="$(mktemp /tmp/startup-smoke-XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SMOKE_LOG"
}
trap cleanup EXIT

echo "  [startup-smoke] Starting server on port ${SMOKE_PORT} ..."

node scripts/free-ports.mjs "$SMOKE_PORT"
PORT="$SMOKE_PORT" npx tsx server/index.ts > "$SMOKE_LOG" 2>&1 &
SERVER_PID=$!

# Wait up to TIMEOUT seconds for the server to listen or crash
elapsed=0
bound=0
while [[ $elapsed -lt $TIMEOUT ]]; do
  sleep 1
  elapsed=$((elapsed + 1))

  # Check if the process already exited (crash)
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "  [startup-smoke] FAIL — server process exited early."
    echo "  ---- server output ----"
    cat "$SMOKE_LOG"
    echo "  -----------------------"
    exit 1
  fi

  # Check for the IPv6 validation error in output so far
  if grep -q "ERR_ERL_KEY_GEN_IPV6" "$SMOKE_LOG" 2>/dev/null; then
    echo "  [startup-smoke] FAIL — ERR_ERL_KEY_GEN_IPV6 detected in server output."
    echo "  ---- server output ----"
    cat "$SMOKE_LOG"
    echo "  -----------------------"
    exit 1
  fi

  # Check if the server is listening (curl health check)
  if curl --silent --fail --max-time 2 "http://localhost:${SMOKE_PORT}/api/healthz" > /dev/null 2>&1; then
    bound=1
    break
  fi
done

if [[ $bound -eq 0 ]]; then
  echo "  [startup-smoke] FAIL — server did not bind to port ${SMOKE_PORT} within ${TIMEOUT}s."
  echo "  ---- server output ----"
  cat "$SMOKE_LOG"
  echo "  -----------------------"
  exit 1
fi

# Final check: no IPv6 rate-limiter error anywhere in the output
if grep -q "ERR_ERL_KEY_GEN_IPV6" "$SMOKE_LOG" 2>/dev/null; then
  echo "  [startup-smoke] FAIL — ERR_ERL_KEY_GEN_IPV6 found in server output after startup."
  echo "  ---- server output ----"
  cat "$SMOKE_LOG"
  echo "  -----------------------"
  exit 1
fi

echo "  [startup-smoke] PASS — server started cleanly on port ${SMOKE_PORT} with no rate-limiter validation errors."
exit 0
