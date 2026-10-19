# Review Agent Build Failures

## What & Why
Analyze Replit/Agent build failures from the last 30 days and produce a tracked, evidence-based report. The review should identify recurring root causes, separate application defects from validation-harness and environment failures, and recommend practical ways to prevent failures or detect them earlier without changing build behavior in this task.

## Done looks like
- A tracked report covers the available Replit/Agent build and task evidence from the last 30 days and states any evidence-access or retention gaps
- Failed builds are grouped by root cause, with frequency, impact, confidence, representative evidence, and whether the cause recurred
- The report distinguishes product regressions, test or validation defects, dependency or configuration failures, environment limitations, and inconclusive cases
- Existing safeguards are mapped to the failure patterns they already address, including active work such as Task #595 (Harden release diagnostics), without duplicating its scope
- Prevention and earlier-detection recommendations are prioritized by expected value, effort, and confidence; each recommendation identifies the failure pattern it addresses
- No product, build, validation, or deployment behavior is changed

## Out of scope
- Implementing any recommended prevention or detection changes
- Analyzing GitHub Actions except where repository evidence is needed to explain a Replit/Agent failure
- Treating retries, task summaries, or undocumented assumptions as proof of root cause
- Reconstructing unavailable or expired logs without evidence

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-light`
**Why:** This task adds a tracked Markdown analysis only and does not change application or validation behavior; type checking and storage-boundary linting are the lightest registered project checks.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Task-local environment observations
- The plan scaffold command could not write in Planner mode because workspace files were read-only, so this plan was created through the Planner's permitted task-plan writer.
- The tracked repository does not contain a complete dated archive of Replit/Agent build logs. The executor must use available platform records and clearly document retention or access gaps rather than infer missing outcomes.
- The durable failure baseline catalog contains no active records at plan time.

## Regression Guard
**N/A**

**Why N/A:** This is a report-only analysis and changes no product, validation, error-handling, or reliability behavior.

## Steps
1. **Define the review population** — Enumerate Replit/Agent builds and task executions in the 30-day window using available platform records. Record inclusion criteria, counts, status definitions, missing records, and retention limitations so the denominator is auditable.
2. **Extract failure evidence** — For each failed build, capture the failing stage, stable error signature, affected task, retry or eventual outcome, and the strongest available evidence. Redact sensitive values and label records with insufficient evidence as inconclusive.
3. **Classify root causes** — Group failures into evidence-supported categories such as application regression, test or validation defect, dependency or configuration issue, environment or resource limitation, task integration conflict, and unknown. Do not classify a passing retry as proof that a failure was pre-existing.
4. **Identify patterns and safeguards** — Quantify repeated signatures and contributing conditions, identify where failures were first detectable, and compare them with current validation, diagnostics, baseline, and task-planning safeguards. Account for active Task #595 without duplicating or presuming its results.
5. **Prioritize recommendations** — Recommend prevention and earlier-detection measures tied to observed patterns, ranked by expected impact, implementation effort, confidence, and likely ownership. Separate quick checks from larger follow-up work and avoid proposing safeguards unsupported by the evidence.
6. **Publish the report** — Write the tracked report with an executive summary, methodology, coverage limitations, categorized findings, trend table, representative incidents, safeguard-gap matrix, and prioritized follow-up recommendations. State explicitly that this task is report-only.

## Relevant files
- `.github/workflows/validation.yml`
- `.github/workflows/managed-clerk-release.yml`
- `docs/validation/github-actions.md`
- `docs/validation/failure-baseline.json`
- `docs/validation/failure-baseline.md`
- `docs/validation/manifest.json`
- `docs/ux-audit-report.md`
- `package.json`
- `scripts/run-tier.mjs`
- `server/lib/taskTracker.ts`
