#!/usr/bin/env bash
# ci.sh — Sequential CI gate: typecheck → lint:storage → e2e
# Prints a summary table at the end showing pass/fail per step.
# Exits non-zero if any step fails.

set -euo pipefail

STEPS=("typecheck" "lint:storage" "e2e")
CMDS=("npm run typecheck" "npm run lint:storage" "npm run test:e2e")

declare -A RESULTS

overall=0

for i in "${!STEPS[@]}"; do
  step="${STEPS[$i]}"
  cmd="${CMDS[$i]}"
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
