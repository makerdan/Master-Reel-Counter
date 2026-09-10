#!/usr/bin/env bash
set -euo pipefail

candidate_port="${RELEASE_SMOKE_PORT:-$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
candidate_host="${RELEASE_SMOKE_PUBLIC_HOST:-master-reel-counter-ai.replit.app}"
candidate_url="https://${candidate_host}"
candidate_id="$(node -e 'console.log(require("crypto").randomUUID())')"
server_log="${RELEASE_SERVER_LOG:-$(mktemp /tmp/managed-clerk-release-server.XXXXXX.log)}"
proxy_log="${RELEASE_PROXY_LOG:-$(mktemp /tmp/managed-clerk-release-proxy.XXXXXX.log)}"
tls_dir="${RELEASE_TLS_DIR:-$(mktemp -d /tmp/managed-clerk-release-tls.XXXXXX)}"
browser_diagnostic="${RELEASE_BROWSER_DIAGNOSTIC:-test-results/release-diagnostics/browser.json}"
server_pid="${RELEASE_SERVER_PID:-}"
proxy_pid="${RELEASE_PROXY_PID:-}"
release_status=0
cleanup_timeout_seconds="${RELEASE_CLEANUP_TIMEOUT_SECONDS:-10}"
diagnostics_dir="${RELEASE_DIAGNOSTICS_DIR:-test-results/release-diagnostics}"

redact_log() {
  if [[ -n "${RELEASE_REDACT_COMMAND:-}" ]]; then
    timeout --kill-after=1s "${cleanup_timeout_seconds}s" \
      "$RELEASE_REDACT_COMMAND"
  else
    timeout --kill-after=1s "${cleanup_timeout_seconds}s" \
      node scripts/redact-release-diagnostics.mjs
  fi
}
clerk_proxy_path="$(node --import tsx/esm --input-type=module -e 'import { CLERK_PROXY_PATH } from "./shared/clerk-config.ts"; process.stdout.write(CLERK_PROXY_PATH)')"
clerk_proxy_readiness_path="$(node --import tsx/esm --input-type=module -e 'import { CLERK_PROXY_READINESS_PATH } from "./shared/clerk-config.ts"; process.stdout.write(CLERK_PROXY_READINESS_PATH)')"

retain_failure_diagnostics() {
  mkdir -p "$diagnostics_dir"
  for source_and_name in "$server_log:candidate.log" "$proxy_log:proxy.log"; do
    local source="${source_and_name%%:*}"
    local name="${source_and_name#*:}"
    redact_log <"$source" |
      tail -n 300 >"$diagnostics_dir/$name"
  done
}

print_safe_log() {
  redact_log <"$1" | tail -n 300 >&2
}

print_failure_diagnostics() {
  if [[ -n "${RELEASE_DIAGNOSTICS_COMMAND:-}" ]]; then
    timeout --kill-after=1s "${cleanup_timeout_seconds}s" \
      "$RELEASE_DIAGNOSTICS_COMMAND" \
      "$browser_diagnostic" "$server_log" "$proxy_log" >&2
  else
    timeout --kill-after=1s "${cleanup_timeout_seconds}s" \
      node scripts/print-release-diagnostics.mjs \
      "$browser_diagnostic" "$server_log" "$proxy_log" >&2
  fi
}

stop_release_process() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() (
  set +e
  if [[ "$release_status" -ne 0 ]]; then
    retain_failure_diagnostics || \
      echo "Managed Clerk release diagnostic artifact retention failed." >&2
    print_failure_diagnostics || \
      echo "Managed Clerk release diagnostic printing failed." >&2
  fi
  stop_release_process "$server_pid"
  stop_release_process "$proxy_pid"
  rm -f "$server_log" "$proxy_log" || \
    echo "Managed Clerk release temporary log cleanup failed." >&2
  rm -rf "$tls_dir" || \
    echo "Managed Clerk release temporary TLS cleanup failed." >&2
  exit 0
)

on_exit() {
  release_status=$?
  trap - EXIT
  cleanup || echo "Managed Clerk release cleanup failed." >&2
  exit "$release_status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${RELEASE_CLEANUP_HARNESS:-0}" == "1" ]]; then
  exit "${RELEASE_CLEANUP_EXIT_STATUS:-1}"
fi

export VITE_CLERK_PROXY_URL="$clerk_proxy_path"
npm run build

NODE_ENV=production PORT="$candidate_port" RELEASE_CANDIDATE_ID="$candidate_id" \
  node dist/index.cjs >"$server_log" 2>&1 &
server_pid="$!"

if ! node scripts/wait-for-release-candidate.mjs \
  "http://127.0.0.1:${candidate_port}/api/healthz" "$candidate_id" "$server_pid" 60000; then
  print_safe_log "$server_log"
  exit 1
fi
kill -0 "$server_pid"

tls_port="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$tls_dir/key.pem" \
  -out "$tls_dir/cert.pem" \
  -subj "/CN=release-candidate" \
  -addext "subjectAltName=DNS:${candidate_host}" >/dev/null 2>&1
RELEASE_SMOKE_HTTPS_PORT="$tls_port" \
RELEASE_SMOKE_APP_PORT="$candidate_port" \
RELEASE_SMOKE_TLS_KEY="$tls_dir/key.pem" \
RELEASE_SMOKE_TLS_CERT="$tls_dir/cert.pem" \
RELEASE_SMOKE_PUBLIC_HOST="$candidate_host" \
node scripts/release-candidate-https-proxy.mjs >"$proxy_log" 2>&1 &
proxy_pid="$!"

if ! node scripts/wait-for-release-candidate.mjs \
  "https://127.0.0.1:${tls_port}${clerk_proxy_readiness_path}" "$candidate_id" "$proxy_pid" 10000 \
  --insecure-tls; then
  print_safe_log "$proxy_log"
  exit 1
fi

RELEASE_SMOKE_INTERNAL_CANDIDATE=1 \
RELEASE_SMOKE_CANDIDATE_HOST="$candidate_host" \
RELEASE_SMOKE_CANDIDATE_TLS_PORT="$tls_port" \
RELEASE_SMOKE_CANDIDATE_APP_ORIGIN="http://127.0.0.1:${candidate_port}" \
RELEASE_SMOKE_CANDIDATE_ID="$candidate_id" \
PRODUCTION_BASE_URL="$candidate_url" \
npm run verify:managed-clerk-release
kill -0 "$server_pid"
kill -0 "$proxy_pid"

echo "Managed Clerk production-candidate release gate passed."