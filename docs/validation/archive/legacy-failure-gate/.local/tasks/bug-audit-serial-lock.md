# Bug Audit Serial Lock

## What & Why
Run the Bug Audit skill in report-only mode against the serial-lock validation tool. Inspect lock ownership, queueing, timeout, waiter isolation, process cleanup, and nested invocation behavior so concurrent validation cannot deadlock, collide, or report a misleading result.

## Done looks like
- A Bug Audit report covers the serial-lock implementation, its focused tests, and the validation runner integration.
- Findings are verified and include file/line, category, realistic failure scenario, recommended fix, and severity.
- No lock, runner, test, or process-management code is changed.

## Out of scope
- Fixing lock or concurrency findings.
- Running unrelated browser or production release suites.
- Treating normal queue delay as a defect without evidence of incorrect timeout or ownership behavior.

## Steps
1. **Inventory the lock path** — Trace `serial-lock.mjs`, lock-file/resource naming, priority and timeout handling, waiter manifests, nested tier execution, and focused tests.
2. **Run the Bug Audit passes** — Prioritize concurrency, lifecycle cleanup, crash recovery, stale ownership, fairness/priority, signal handling, and failure classification.
3. **Verify and report findings** — Use deterministic collision and interruption probes where feasible, then deliver the severity-sorted report without changing implementation.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The plan-mode baseline run of `npm run test-standard` was blocked before validation steps because the serial-lock harness could not write `.local/validation-lock-validation.lock`; no suite failure was observed.

## Validation
**Command:** `test-standard`
**Why:** This registered tier covers the serial-lock path through the standard runner and its focused contract tests.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's deliverable is the Bug Audit report for the serial-lock validation tool.

## Relevant files
- `scripts/serial-lock.mjs`
- `server/__tests__/ci-serial-lock.test.ts`
- `scripts/run-tier.mjs`
- `scripts/run-locked-tier.mjs`
- `.agents/memory/validation-lock-waiters.md`
