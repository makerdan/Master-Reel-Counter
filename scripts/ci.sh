#!/usr/bin/env bash
# ci.sh — Sequential CI gate: audit → typecheck → lint:storage → e2e
# Prints a summary table at the end showing pass/fail per step.
# Exits non-zero if any step fails.
#
# E2E skip options:
#   CI_SKIP_E2E=1          — explicitly opt out of browser tests
#   (auto) server unreachable — health-checks TEST_BASE_URL before running e2e;
#                               skips with a warning instead of timing out

set -euo pipefail

STEPS=("audit" "typecheck" "lint:storage" "e2e")
CMDS=("npm audit --audit-level=high" "npm run typecheck" "npm run lint:storage" "node scripts/free-ports.mjs && npm run test:e2e")

declare -A RESULTS
declare -A SKIP_REASONS

overall=0

# Resolve the base URL the same way playwright.config.ts does
E2E_BASE_URL="${TEST_BASE_URL:-http://localhost:5000}"

# ---------------------------------------------------------------------------
# Pre-flight: decide whether the e2e step should be skipped before the loop
# ---------------------------------------------------------------------------
e2e_skip_reason=""

if [[ "${CI_SKIP_E2E:-}" == "1" ]]; then
  e2e_skip_reason="CI_SKIP_E2E=1 is set"
else
  echo ""
  echo "  Pre-flight: checking app server at ${E2E_BASE_URL}/api/healthz ..."
  if ! curl --silent --fail --max-time 5 "${E2E_BASE_URL}/api/healthz" > /dev/null 2>&1; then
    e2e_skip_reason="app server unreachable at ${E2E_BASE_URL}/api/healthz"
  else
    echo "  App server is up — e2e will run."
  fi
fi

for i in "${!STEPS[@]}"; do
  step="${STEPS[$i]}"
  cmd="${CMDS[$i]}"

  # -------------------------------------------------------------------------
  # Skip e2e if the pre-flight check decided so
  # -------------------------------------------------------------------------
  if [[ "$step" == "e2e" && -n "$e2e_skip_reason" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  CI Step: ${step}"
    echo "  SKIPPED: ${e2e_skip_reason}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    RESULTS[$step]="SKIP ⚠"
    SKIP_REASONS[$step]="${e2e_skip_reason}"
    continue
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  CI Step: ${step}"
  echo "  Command: ${cmd}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if eval "${cmd}"; then
    RESULTS[$step]="PASS ✓"
  else
    RESULTS[$step]="FAIL ✗"
    overall=1
    echo ""
    echo "  !! Step '${step}' failed — stopping CI run."
    break
  fi
done

# Fill any remaining steps as SKIPPED if we broke early
for step in "${STEPS[@]}"; do
  if [[ -z "${RESULTS[$step]+x}" ]]; then
    RESULTS[$step]="SKIP —"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CI Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  %-20s %s\n" "Step" "Result"
printf "  %-20s %s\n" "----" "------"
for step in "${STEPS[@]}"; do
  printf "  %-20s %s\n" "${step}" "${RESULTS[$step]}"
  if [[ -n "${SKIP_REASONS[$step]+x}" ]]; then
    printf "  %-20s   reason: %s\n" "" "${SKIP_REASONS[$step]}"
  fi
done
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $overall -ne 0 ]]; then
  echo "  CI FAILED"
else
  echo "  CI PASSED"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit $overall
