# Bug Audit Collision Smoke

## What & Why
Run the Bug Audit skill in report-only mode against the CI collision smoke validation tool. Verify that simultaneous validation/resource scenarios are isolated, that collisions are actually exercised, and that timeout or cleanup failures cannot be reported as passing.

## Done looks like
- A Bug Audit report covers the collision smoke script, its serial-lock/process dependencies, and heavy-tier/CI integration.
- Findings are verified and include file/line, category, realistic failure scenario, recommended fix, and severity.
- No collision harness, lock, CI, or process code is changed.

## Out of scope
- Fixing concurrency findings.
- Starting competing live workflows outside isolated local probes.
- Auditing all serial-lock behavior beyond the collision tool’s direct assumptions.

## Steps
1. **Inventory the collision path** — Trace the collision test’s child processes, shared resources, timing and exit assertions, cleanup, serial-lock integration, and CI invocation.
2. **Run the Bug Audit passes** — Prioritize concurrency, process lifecycle, timeout handling, resource isolation, nondeterministic assertions, and false-pass/error masking.
3. **Verify and report findings** — Use deterministic local probes where feasible, read surrounding implementation before recording findings, and deliver the severity-sorted report without edits.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The plan-mode baseline run of `npm run test-standard` was blocked before validation steps because the serial-lock harness could not write `.local/validation-lock-validation.lock`; no suite failure was observed.

## Validation
**Command:** `test-heavy`
**Why:** Collision smoke is a heavy-tier concurrency check and requires the complete process, lock, startup, and browser validation context around it.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's deliverable is the Bug Audit report for the CI collision smoke validation tool.

## Relevant files
- `scripts/ci-collision-test.mjs`
- `scripts/serial-lock.mjs`
- `scripts/run-tier.mjs`
- `.github/workflows/validation.yml`
- `docs/port-authority.md`
