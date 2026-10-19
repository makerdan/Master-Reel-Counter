# Activate Checked Local Validation

## What & Why
Connect the existing Failure Gate v4 candidate to ordinary project-local task validation and local completion, but only after the preceding authorization task has delivered a verified task assignment, approved exact plan and separately accepted policy. The current checked launcher reads a caller-provided plan under the previous policy, while v4's execution and completion are fixture-only. Perform a controlled cutover without ever running two local authorities for the same task.

## Done looks like
- For a genuinely assigned and approved local task, the single checked entry point resolves its authorized registered tier from the durable record; a wrong task, plan, tier, stale digest, or unsupported override launches no steps.
- Runs bind actual tested inputs, environment, arguments, raw step statuses, complete test reports and discovery counts to a run ID. Diagnostics and ad-hoc commands cannot count as a required full tier, and changed final inputs invalidate affected evidence.
- A local completion checker recomputes the decision from the final authorized plan and complete evidence under writer coordination. Failure ownership, named not-reached checks, three supported isolation retries, leases, recovery and terminal history remain intact.
- Existing validation coverage, resource safety and dependency audit thresholds are unchanged. If cutover prerequisites are unavailable, the old gate remains active and v4 stays blocked with no fallback through a caller-supplied plan.
- Platform-managed completion remains separately BLOCKED unless the platform actually hands off the active task and approved plan for one checked dispatch; local workflow mode is not claimed to be protected enforcement.

## Out of scope
- Building owner approval or independently issued task identity from scratch; this task uses the prior task's verified binding, and stops otherwise.
- Editing `.replit` platform workflows, running production/destructive checks without approval, treating in-progress task #922 as already authorized, installing a second skill, or modifying unrelated application code.

## Steps
1. **Recheck the authorization boundary** — Confirm the preceding task's task-to-plan binding, owner review, effective digests and prior gate status from live evidence. If any required authority is absent, leave the candidate inactive and report the blocker rather than silently downgrading it.
2. **Connect checked execution** — Adapt the ordinary launcher to the existing coordinator, runtime manifest, snapshot/report adapters and resource locks, resolving one tier from the active record and rejecting mismatched task/plan/policy/parameters before launch. Preserve current commands and reject caller-selected alternate tiers or coverage-reducing environment/arguments.
3. **Cut over local lifecycle** — Coordinate legacy-to-v4 transition with active runs and writers, migrate only explicitly approved local task records, and keep failed cutover recoverable under one known authority. Wire local completion to the existing final-input checker; do not imply that Replit task-board completion calls it.
4. **Validate failure and recovery behavior** — Exercise positive and negative checked-launcher, snapshot, report, retry, lease and terminal scenarios; record raw results and the separate local assessment. Reconcile status documents against observed evidence and leave platform-managed completion BLOCKED unless independently verified.

## Task identity
**Draft reference:** Non-authorizing plan proposal; the exact approved plan and assigned task ID must be independently bound before executing its requested tier.

## Pre-existing failures to ignore
None known in the currently empty active catalog. Recheck the catalog and pre-edit failures before work; do not turn fixture results or old obstructions into ignores.

**Flaky-test rule:** A passing retry proves intermittency, not provenance.

## Task-local environment observations
The v4 execution and completion modules already have fixture coverage and heavy report adapters, but the ordinary checked launcher still uses the prior caller-plan route. No local v4 cutover or validation run was observed while planning.

## Validation
**Command:** `test-standard`
**Why:** The registered failure-gate-contract, unit, parity, manifest and typecheck checks exercise the checked launcher, report contracts and local completion without changing tier definitions. If newly affected behavior needs coverage absent from this tier, request a separate approved tier amendment before running it.
**Do not escalate:** Run only the independently authorized tier. Lack of activation, safe environment or complete reports is BLOCKED/INCOMPLETE, not permission to run ad-hoc or broader checks.

## Regression Guard
**Covers:** The old caller-plan path bypasses v4 authorization, two local gates simultaneously authorize a run, or stale, incomplete or unrelated evidence produces a local completion decision.
**Test location:** `scripts/__tests__/failure-gate-v4-execution.test.mjs`
**What it checks:** Wrong task/plan/tier, changed governing policy, unapproved cutover and coverage overrides launch no checks; valid full runs record snapshot-bound complete reports, while edits, interruption, concurrency, missing reports or unsafe lease recovery cannot complete the task.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/failure-gate/reference/acceptance.md`
- `docs/validation/failure-gate-v4-cutover-acceptance.md`
- `docs/validation/manifest.json`
- `scripts/run-locked-tier.mjs`
- `scripts/run-tier.mjs`
- `scripts/failure-gate.mjs`
- `scripts/lib/failure-gate/host.mjs`
- `scripts/lib/failure-gate/execution.mjs`
- `scripts/lib/failure-gate/evidence.mjs`
- `scripts/lib/failure-gate/runtime-tiers.mjs`
- `scripts/__tests__/failure-gate-v4-execution.test.mjs`
