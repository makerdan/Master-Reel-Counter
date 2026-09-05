#!/usr/bin/env bash
# ci.sh — compatibility entrypoint for the canonical test-heavy tier.
# The tracked manifest and scripts/run-tier.mjs are the source of truth.

set -euo pipefail

# CI_SMOKE_TEST=1 — fast-exit mode used by the serial-lock collision smoke test.
# Skips all steps and exits 0 immediately to keep the smoke test runtime short
# without running the full CI suite.
exec npm run test-heavy
