# Bug Audit Manifest Parity

## What & Why
Run the Bug Audit skill in report-only mode against the validation-manifest parity tool. Confirm that the runtime manifest, package scripts, registered tiers, and validation documentation are compared completely and that drift cannot be hidden by incomplete or asymmetric checks.

## Done looks like
- A Bug Audit report covers the parity script, manifest inputs, and its standard/plus/heavy tier use.
- Findings are verified and include file/line, category, realistic failure scenario, recommended fix, and severity.
- No manifest, registry, parity script, or documentation is changed.

## Out of scope
- Fixing any discovered drift.
- Redesigning the validation-tier contract or changing CI policy.
- Treating an intentional documented difference as a bug without checking the parity contract.

## Steps
1. **Inventory the parity path** — Trace the canonical manifest, tier registry, package scripts, parity validator, and tests that define expected equivalence.
2. **Run the Bug Audit passes** — Focus on completeness of comparisons, schema/error handling, path resolution, generated-versus-canonical boundaries, and false-pass behavior.
3. **Verify and report findings** — Exercise local parity checks where feasible, inspect surrounding code for each candidate, and deliver a severity-sorted report with no fixes.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The plan-mode baseline run of `npm run test-standard` was blocked before validation steps because the serial-lock harness could not write `.local/validation-lock-validation.lock`; no suite failure was observed.

## Validation
**Command:** `test-standard`
**Why:** This registered tier includes the manifest-parity check and the standard tier machinery it validates.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's deliverable is the Bug Audit report for the validation-manifest parity tool.

## Relevant files
- `scripts/validate-validation-manifest.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
- `docs/validation/manifest.json`
- `.agents/skills/validation-tiers/tiers.json`
- `scripts/run-tier.mjs`
- `package.json:28-43`
