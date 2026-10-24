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
DB_TIMEOUT="${SMOKE_DB_TIMEOUT:-10}"
EXPECTED_DATABASE="${SMOKE_EXPECTED_DATABASE:-}"
EXPECTED_SERVER_ADDRESS="${SMOKE_EXPECTED_SERVER_ADDRESS:-}"
EXPECTED_SERVER_PORT="${SMOKE_EXPECTED_SERVER_PORT:-}"
SERVER_ENTRYPOINT="${SMOKE_SERVER_ENTRYPOINT:-server/index.ts}"
SMOKE_LOG="$(mktemp /tmp/startup-smoke-XXXXXX.log)"
SERVER_PID=""
SERVER_PGID=""
CLEANUP_FAILED=0

fail_configuration() {
  echo "  [startup-smoke] FAIL — $1" >&2
  exit 1
}

require_positive_integer() {
  local name="$1"
  local value="$2"
  local maximum="${3:-}"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    fail_configuration "${name} must be a positive integer; received '${value}'."
  fi
  if [[ -n "$maximum" ]] && (( value > maximum )); then
    fail_configuration "${name} must be between 1 and ${maximum}; received '${value}'."
  fi
}

require_command() {
  local command_name="$1"
  local guidance="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail_configuration "${command_name} is required for startup smoke; ${guidance}"
  fi
}

wait_for_process_group() {
  local pgid="$1"
  local attempts="${2:-50}"
  local attempt
  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if ! kill -0 -- "-${pgid}" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

signal_process_group() {
  local signal="$1"
  if [[ -n "$SERVER_PGID" ]] && kill -0 -- "-${SERVER_PGID}" 2>/dev/null; then
    kill "-${signal}" -- "-${SERVER_PGID}" 2>/dev/null || true
  fi
}

port_is_free() {
  node --input-type=module - "$SMOKE_PORT" <<'NODE'
import net from "node:net";

const port = Number(process.argv[2]);
const hosts = ["127.0.0.1", "::1"];

async function canBind(host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => {
      resolve(error?.code === "EADDRNOTAVAIL" || error?.code === "EAFNOSUPPORT");
    });
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

const results = await Promise.all(hosts.map(canBind));
process.exit(results.every(Boolean) ? 0 : 1);
NODE
}

cleanup() {
  local status=$?
  set +e

  if [[ -n "$SERVER_PGID" ]]; then
    signal_process_group TERM
    if ! wait_for_process_group "$SERVER_PGID" 50; then
      echo "  [startup-smoke] Cleanup deadline reached; force-stopping smoke server process group ${SERVER_PGID}." >&2
      signal_process_group KILL
      if ! wait_for_process_group "$SERVER_PGID" 20; then
        echo "  [startup-smoke] FAIL — smoke server process group ${SERVER_PGID} still exists after forced cleanup." >&2
        CLEANUP_FAILED=1
      fi
    fi
  fi
  if [[ -n "$SERVER_PID" ]]; then
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [[ -n "$SERVER_PID" ]] && ! port_is_free; then
    echo "  [startup-smoke] FAIL — smoke port ${SMOKE_PORT} is still listening after process cleanup." >&2
    CLEANUP_FAILED=1
  fi
  rm -f "$SMOKE_LOG"
  if (( CLEANUP_FAILED )); then
    status=1
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_positive_integer "SMOKE_TIMEOUT" "$TIMEOUT" 3600
require_positive_integer "SMOKE_DB_TIMEOUT" "$DB_TIMEOUT" 3600
require_positive_integer "SMOKE_PORT" "$SMOKE_PORT" 65535
if [[ -n "$EXPECTED_SERVER_PORT" ]]; then
  require_positive_integer "SMOKE_EXPECTED_SERVER_PORT" "$EXPECTED_SERVER_PORT" 65535
fi

require_command psql "install the PostgreSQL client tools in the validation environment."
require_command curl "install curl in the validation environment."
require_command timeout "install the coreutils timeout command in the validation environment."
require_command setsid "install util-linux so the smoke server can run in an owned process group."
require_command node "install Node.js in the validation environment."

check_postgres_version() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "  [startup-smoke] FAIL — DATABASE_URL is required for the PostgreSQL compatibility preflight." >&2
    echo "  [startup-smoke] Refusing to start without an explicit database connection; configure DATABASE_URL for the local or externally managed PostgreSQL instance." >&2
    exit 1
  fi

  local server_probe probe_status
  set +e
  server_probe="$(timeout --kill-after=2s "${DB_TIMEOUT}s" \
    env PGCONNECT_TIMEOUT="$DB_TIMEOUT" \
    psql "$DATABASE_URL" \
    --no-psqlrc \
    --quiet \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --set=ON_ERROR_STOP=1 \
    --command="SET statement_timeout = '${DB_TIMEOUT}s'; SELECT current_database(), current_setting('server_version'), current_setting('server_version_num'), COALESCE(inet_server_addr()::text, ''), COALESCE(inet_server_port()::text, '')" 2>&1
  )"
  probe_status=$?
  set -e

  if [[ "$probe_status" -eq 124 || "$probe_status" -eq 137 ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL readiness timeout after ${DB_TIMEOUT}s (connection or compatibility query deadline)." >&2
    echo "  [startup-smoke] Refusing to start because the configured database did not become ready within the validation deadline." >&2
    exit 1
  fi
  if [[ "$probe_status" -ne 0 ]]; then
    if grep -Eiq "statement timeout|canceling statement due to statement timeout|timeout expired" <<< "$server_probe"; then
      echo "  [startup-smoke] FAIL — PostgreSQL readiness timeout after ${DB_TIMEOUT}s (server-side connection or statement deadline)." >&2
      echo "  [startup-smoke] Refusing to start because the configured database did not become ready within the validation deadline." >&2
      exit 1
    fi
    echo "  [startup-smoke] FAIL — unable to query the configured database as PostgreSQL." >&2
    echo "  [startup-smoke] Refusing to start because the local database is unreachable, non-PostgreSQL, or externally managed with incompatible connection settings." >&2
    exit 1
  fi

  local database_name server_version server_version_num server_address server_port
  IFS=$'\t' read -r database_name server_version server_version_num server_address server_port _ <<< "$server_probe"
  if [[ -z "$database_name" || -z "$server_version" || -z "$server_version_num" ]]; then
    echo "  [startup-smoke] FAIL — the configured database did not return complete PostgreSQL identity and version metadata." >&2
    echo "  [startup-smoke] Refusing to start rather than silently falling back to an unverified database." >&2
    exit 1
  fi

  if [[ -n "$EXPECTED_DATABASE" && "$database_name" != "$EXPECTED_DATABASE" ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL database identity mismatch." >&2
    echo "  [startup-smoke] Expected database: ${EXPECTED_DATABASE}." >&2
    echo "  [startup-smoke] Connected database: ${database_name}." >&2
    echo "  [startup-smoke] Refusing to start against an unexpected validation target." >&2
    exit 1
  fi
  if [[ -n "$EXPECTED_SERVER_ADDRESS" && "$server_address" != "$EXPECTED_SERVER_ADDRESS" ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL server endpoint identity mismatch." >&2
    echo "  [startup-smoke] Expected server address: ${EXPECTED_SERVER_ADDRESS}." >&2
    echo "  [startup-smoke] Connected server address: ${server_address:-unknown}." >&2
    echo "  [startup-smoke] Refusing to start against an unexpected validation endpoint." >&2
    exit 1
  fi
  if [[ -n "$EXPECTED_SERVER_PORT" && "$server_port" != "$EXPECTED_SERVER_PORT" ]]; then
    echo "  [startup-smoke] FAIL — PostgreSQL server endpoint port mismatch." >&2
    echo "  [startup-smoke] Expected server port: ${EXPECTED_SERVER_PORT}." >&2
    echo "  [startup-smoke] Connected server port: ${server_port:-unknown}." >&2
    echo "  [startup-smoke] Refusing to start against an unexpected validation endpoint." >&2
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

  if [[ -n "$EXPECTED_DATABASE" ]]; then
    echo "  [startup-smoke] PostgreSQL ${server_version} and database ${database_name} match the validation target (major ${supported_major})."
  else
    echo "  [startup-smoke] PostgreSQL ${server_version} matches the validation contract (generic external database mode; major ${supported_major})."
  fi
}

check_postgres_version

echo "  [startup-smoke] Starting server on port ${SMOKE_PORT} ..."

node scripts/free-ports.mjs "$SMOKE_PORT"
PORT="$SMOKE_PORT" setsid node node_modules/tsx/dist/cli.mjs "$SERVER_ENTRYPOINT" > "$SMOKE_LOG" 2>&1 &
SERVER_PID=$!
SERVER_PGID="$SERVER_PID"

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
