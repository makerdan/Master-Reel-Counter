# Bug Audit Typecheck

## What & Why
Run the Bug Audit skill in report-only mode against the TypeScript typecheck validation tool. Verify that the application and Playwright compiler configurations cover the intended source set, surface real failures, and do not silently pass unsafe or incomplete code.

## Done looks like
- A Bug Audit report covers the typecheck command, its configuration inputs, and its integration into the canonical validation tiers.
- Findings are verified in surrounding source, sorted by severity, and include file/line, category, realistic failure scenario, recommended fix, and severity.
- No production or validation code is changed by this report-only task; deferred fixes are explicit and actionable.

## Out of scope
- Fixing findings or changing compiler settings, scripts, or CI behavior.
- Auditing other validation tools except where their direct typecheck integration is necessary to explain a finding.
- Treating compiler warnings or unverified grep hits as bugs.

## Steps
1. **Inventory the typecheck path** — Trace the package scripts, TypeScript configurations, included/excluded files, and the tier/manifest entries that invoke typecheck.
2. **Run the Bug Audit passes** — Apply all relevant categories from the Bug Audit skill to the typecheck harness and its configuration, prioritizing false negatives, false positives, configuration drift, and failure-reporting defects.
3. **Verify and report findings** — Read context for every candidate, reproduce or demonstrate tool defects when feasible without changing files, and deliver the required severity-sorted report with no fixes applied.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This registered tier exercises the typecheck tool and the standard validation harness without requiring the heavy browser and release environment.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's deliverable is the Bug Audit report for the typecheck validation tool.

## Relevant files
- `package.json:11-13`
- `tsconfig.json`
- `tsconfig.playwright.json`
- `docs/validation/manifest.json:5-27`
- `scripts/run-tier.mjs:18-123`
