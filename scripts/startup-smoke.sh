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

check_postgres_version() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "  [startup-smoke] FAIL — DATABASE_URL is required for the PostgreSQL compatibility preflight." >&2
    echo "  [startup-smoke] Refusing to start without an explicit database connection; configure DATABASE_URL for the local or externally managed PostgreSQL instance." >&2
    exit 1
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "  [startup-smoke] FAIL — psql is required for the PostgreSQL compatibility preflight." >&2
    echo "  [startup-smoke] Refusing to start because the database client is unavailable; install PostgreSQL client tools or use the project-supported environment." >&2
    exit 1
  fi

  local server_probe
  if ! server_probe="$(psql "$DATABASE_URL" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT current_setting('server_version'), current_setting('server_version_num')" 2>&1
  )"; then
    echo "  [startup-smoke] FAIL — unable to query the configured database as PostgreSQL." >&2
    echo "  [startup-smoke] Refusing to start because the local database is unreachable, non-PostgreSQL, or externally managed with incompatible connection settings." >&2
    exit 1
  fi

  local server_version server_version_num
  if [[ "$server_probe" != *$'\t'* ]]; then
    echo "  [startup-smoke] FAIL — the configured database did not return PostgreSQL server version metadata." >&2
    echo "  [startup-smoke] Refusing to start rather than silently falling back to an unverified database." >&2
    exit 1
  fi
  IFS=$'\t' read -r server_version server_version_num _ <<< "$server_probe"
  if [[ -z "$server_version" || -z "$server_version_num" ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL server version metadata was incomplete." >&2
    echo "  [startup-smoke] Refusing to start rather than silently falling back to an unverified database." >&2
    exit 1
  fi

  local contract_probe
  if ! contract_probe="$(
    POSTGRES_SERVER_VERSION_NUM="$server_version_num" node --input-type=module <<'NODE'
import {
  postgresMajorVersion,
  SUPPORTED_POSTGRES_MAJOR_VERSION,
} from "./scripts/lib/github-actions-validation-contract.mjs";

const detectedMajor = postgresMajorVersion(process.env.POSTGRES_SERVER_VERSION_NUM);
process.stdout.write(`${detectedMajor}\t${SUPPORTED_POSTGRES_MAJOR_VERSION}`);
NODE
  )"; then
    echo "  [startup-smoke] FAIL — could not load the shared PostgreSQL validation contract." >&2
    echo "  [startup-smoke] Refusing to start because the connected database version cannot be compared with the CI contract." >&2
    exit 1
  fi

  local detected_major supported_major
  IFS=$'\t' read -r detected_major supported_major _ <<< "$contract_probe"
  if [[ "$detected_major" != "$supported_major" ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL major version drift detected." >&2
    echo "  [startup-smoke] Connected server: PostgreSQL ${server_version} (major ${detected_major}, server_version_num ${server_version_num})." >&2
    echo "  [startup-smoke] Supported validation version: PostgreSQL ${supported_major}." >&2
    echo "  [startup-smoke] Intentional upgrade path: update SUPPORTED_POSTGRES_MAJOR_VERSION in scripts/lib/github-actions-validation-contract.mjs and the postgres:<major> image in .github/workflows/validation.yml together, then rerun startup smoke." >&2
    exit 1
  fi

  echo "  [startup-smoke] PostgreSQL ${server_version} matches the validation contract (major ${supported_major})."
}

check_postgres_version

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
