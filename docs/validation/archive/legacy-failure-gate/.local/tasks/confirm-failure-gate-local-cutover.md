# Confirm Local Gate Cutover

## What & Why
Independently confirm, **after both implementation tasks are finished**, that the selected project-local Failure Gate v4 workflow was actually applied and behaves as intended. Review the tracked canonical contract and attachment as specifications, not as proof of activation. This is a separate verification task, not an automatic approval of the new policy or of any other project task.

## Done looks like
- A requirement-by-requirement acceptance record identifies implemented, verified, blocked, failed and not-applicable items with actual evidence, including identity, owner approval, one tier per task, exact plan/policy digests, reports, failure ownership, recovery, local completion and the cutover's single-authority property.
- Independent negative tests prove unauthorized or stale task/plan/tier requests start zero commands, incomplete/skipped/zero-discovery tests and changed snapshots cannot pass, and concurrent or interrupted transitions do not leave permissions open.
- Any in-scope error found is identified before repair, repaired in the owning layer if approved and safe, and retested without weakening checks. If a required authority or check is unavailable, the finding remains BLOCKED rather than being reported complete.
- Task-tier results and platform-managed completion are reported separately; no claim of protected enforcement, platform-controlled completion or approval based on a fixture/local file alone.

## Out of scope
- Expanding the project-local scope to protected mode or modifying Replit's platform-owned completion path.
- Reapproving task #922 or other historic plans, lowering tier coverage, changing dependency-audit thresholds, publishing, or repairing unrelated product issues.

## Steps
1. **Inspect the delivered cutover** — Read the actual implementation, owner decision and authorization records, task/plan binding, current canonical skill and acceptance matrix. Compare every intended outcome from both preceding plans with observed behavior rather than trusting their completion summaries.
2. **Reproduce the acceptance matrix** — Run focused approved tests for legitimate and wrong-task validation, plan and policy drift, failed review, stale/forged evidence, missing test discovery, raw failure ownership, isolated retries, snapshots, resource leases, interrupted cutover and final-input invalidation. Do not trigger real destructive or external checks without their separate approval; record each unexecuted case as not reached.
3. **Resolve in-scope gaps** — Report each discrepancy with its evidence, repair only authorized Failure Gate implementation defects in the owning layer, and rerun the affected guard plus the task's authorized tier. If a real owner approval or trusted host assignment is still missing, leave activation blocked instead of creating an approval record.
4. **Publish a bounded conclusion** — Update the durable acceptance record with tested revision, plan/policy/adapter/tier digests, run IDs, raw results and assessments, explicit limitations, and a separate platform-managed completion entry. Declare project-local workflow complete only if every applicable requirement has executable evidence and the actual owner-controlled cutover was accepted.

## Task identity
**Draft reference:** Non-authorizing proposed verification task; it does not inherit the implementation tasks' tier or approval.

## Pre-existing failures to ignore
None known in the currently empty active catalog. Recheck the catalog, earlier observed failures and applicability before classifying any new failure.

**Flaky-test rule:** A passing retry proves intermittency, not pre-existing provenance.

## Task-local environment observations
The checked local v4 gate is currently inactive; implementation and owner review are prerequisites, not assumed outcomes. No validation tier was run for this proposed confirmation task.

## Validation
**Command:** `test-standard`
**Why:** Its registered failure-gate-contract, unit, parity, manifest and typecheck checks cover the core local implementation and focused acceptance regressions; only the authorized tier may become completion evidence. If newly required coverage lies outside it, request a separately approved tier change.
**Do not escalate:** Run only after this task has its own independently authorized tier and the implementation tasks have completed. Missing reports or authority block the conclusion; never substitute an ad-hoc run.

## Regression Guard
**Self-satisfying** — the deliverable is independent acceptance verification and focused regression tests of the project-local Failure Gate cutover, especially `scripts/__tests__/failure-gate-v4-execution.test.mjs` and `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/failure-gate/reference/acceptance.md`
- `.agents/skills/failure-gate/reference/implementation.md`
- `docs/validation/failure-gate-v4-cutover-acceptance.md`
- `docs/validation/failure-gate-capabilities.md`
- `docs/validation/manifest.json`
- `scripts/run-locked-tier.mjs`
- `scripts/failure-gate.mjs`
- `scripts/lib/failure-gate/coordinator.mjs`
- `scripts/lib/failure-gate/execution.mjs`
- `scripts/__tests__/failure-gate-v4-execution.test.mjs`
- `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`
