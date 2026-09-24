#!/usr/bin/env bash
# ci.sh — compatibility entrypoint for the canonical test-heavy tier.
# The tracked manifest and scripts/run-tier.mjs are the source of truth.

set -euo pipefail

# CI_SMOKE_TEST=1 is consumed by run-tier only after it acquires the canonical
# validation lock; the collision smoke skips tier steps without bypassing lock
# acquisition.
exec npm run test-heavy
