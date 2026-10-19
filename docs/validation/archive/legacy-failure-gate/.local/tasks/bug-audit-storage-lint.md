# Bug Audit Storage Lint

## What & Why
Run the Bug Audit skill in report-only mode against the storage-key lint validation tool. Verify that its scanner identifies unsafe storage usage accurately, fails when it should, and stays aligned with the application’s key registry and lifecycle conventions.

## Done looks like
- A Bug Audit report covers the linter implementation, strict-mode command, and canonical tier integration.
- Findings are verified in context and include file/line, category, realistic failure scenario, recommended fix, and severity.
- No linter, registry, application, or CI code is changed by this report-only task.

## Out of scope
- Fixing findings or adding new storage rules.
- Auditing unrelated application storage behavior except where needed to validate a linter finding.
- Treating a pattern match as a finding without tracing whether the usage is actually unsafe.

## Steps
1. **Inventory the storage-lint path** — Trace the npm script, linter implementation, storage-key registry and lifecycle annotations, tests, and validation-tier entries.
2. **Run the Bug Audit passes** — Apply the relevant Bug Audit categories, prioritizing missed violations, false positives, path coverage, exit-code behavior, and malformed-input handling.
3. **Verify and report findings** — Reproduce or demonstrate confirmed linter defects when feasible without edits, then deliver the severity-sorted report and explicitly leave fixes deferred.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The plan-mode baseline run of `npm run test-standard` was blocked before validation steps because the serial-lock harness could not write `.local/validation-lock-validation.lock`; no suite failure was observed.

## Validation
**Command:** `test-standard`
**Why:** This registered tier includes the storage linter and its standard contract coverage without requiring heavy browser or release infrastructure.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's deliverable is the Bug Audit report for the storage-key lint validation tool.

## Relevant files
- `scripts/lint-storage.mjs`
- `package.json:14-15`
- `docs/validation/manifest.json:5-27`
- `scripts/run-tier.mjs:18-123`
