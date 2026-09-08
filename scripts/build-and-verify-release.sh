#!/usr/bin/env bash
set -euo pipefail

candidate_port="${RELEASE_SMOKE_PORT:-$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
candidate_host="${RELEASE_SMOKE_PUBLIC_HOST:-master-reel-counter-ai.replit.app}"
candidate_url="https://${candidate_host}"
candidate_id="$(node -e 'console.log(require("crypto").randomUUID())')"
server_log="$(mktemp /tmp/managed-clerk-release-server.XXXXXX.log)"
proxy_log="$(mktemp /tmp/managed-clerk-release-proxy.XXXXXX.log)"
tls_dir="$(mktemp -d /tmp/managed-clerk-release-tls.XXXXXX)"
server_pid=""
proxy_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$proxy_pid" ]] && kill -0 "$proxy_pid" 2>/dev/null; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  rm -f "$server_log" "$proxy_log"
  rm -rf "$tls_dir"
}
trap cleanup EXIT INT TERM

export VITE_CLERK_PROXY_URL="/api/__clerk"
export VITE_CLERK_PUBLIC_HOST="$candidate_host"
npm run build

NODE_ENV=production PORT="$candidate_port" RELEASE_CANDIDATE_ID="$candidate_id" \
  node dist/index.cjs >"$server_log" 2>&1 &
server_pid="$!"

if ! node scripts/wait-for-release-candidate.mjs \
  "http://127.0.0.1:${candidate_port}/api/healthz" "$candidate_id" "$server_pid" 60000; then
  cat "$server_log" >&2
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
  "https://127.0.0.1:${tls_port}/api/healthz" "$candidate_id" "$proxy_pid" 10000 \
  --insecure-tls; then
  cat "$proxy_log" >&2
  exit 1
fi

RELEASE_SMOKE_INTERNAL_CANDIDATE=1 \
RELEASE_SMOKE_CANDIDATE_HOST="$candidate_host" \
RELEASE_SMOKE_CANDIDATE_TLS_PORT="$tls_port" \
RELEASE_SMOKE_CANDIDATE_ID="$candidate_id" \
PRODUCTION_BASE_URL="$candidate_url" \
npm run verify:managed-clerk-release
kill -0 "$server_pid"
kill -0 "$proxy_pid"

echo "Managed Clerk production-candidate release gate passed."