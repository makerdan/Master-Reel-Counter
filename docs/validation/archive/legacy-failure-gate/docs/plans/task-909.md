# Heavy validation reports for candidate completion checking

## Task identity
**Task ID:** 909

The owner approved additive Playwright JSON and named reentrancy assertion adapters and the `test-heavy` run for this task. The candidate remains inactive; this plan does not grant v4 activation.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** The change adds machine reports to the two actual heavy-only test steps; only the complete heavy tier exercises both alongside the existing audit and checks.
**Heavy-tier rationale:** Playwright browser validation and nested reentrancy run only in test-heavy, so lighter tiers cannot cover these adapters.
**Do not escalate:** Run only the approved test-heavy tier; do not replace it with ad-hoc checks for completion.

## Regression Guard
**Covers:** Missing, partial, skipped, duplicate or failing heavy reports being mistaken for complete passing tests, or test identity being lost.
**Test location:** scripts/__tests__/failure-gate-v4-execution.test.mjs
**What it checks:** The actual command mapping remains unchanged and both heavy adapters expose per-test identities while rejecting incomplete, duplicate and truncated evidence.

## Relevant files
- scripts/lib/failure-gate/runtime-tiers.mjs
- scripts/lib/failure-gate/execution.mjs
- playwright.config.ts
- scripts/__tests__/failure-gate-v4-execution.test.mjs