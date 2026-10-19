# Bind Local Task Authorization

## What & Why
Establish the prerequisites for the existing Failure Gate v4 candidate to authorize one project-local task without inventing assignment or owner approval. Today the coordinator is fixture-only; its draft CLI explicitly grants no approval, and ordinary task validation cannot obtain a trusted task-to-plan binding. Keep the old gate active until these prerequisites are both real and separately reviewed.

## Done looks like
- A durable local record connects an independently issued active task ID to its exact approved, versioned plan, one registered tier, permitted parameters, effective policy and tier digests, and an audit trail; provisional drafts cannot validate.
- The owner can review the exact proposed policy/adapter and plan and provide a separately evidenced approval through a verified route, or an already approved deterministic activation policy applies. An agent-authored actor or approval field is never treated as that evidence.
- Missing trusted assignment, exact durable plan, independent review, or conflicting policy changes block activation with a specific explanation; historical and in-progress tasks are not automatically approved or migrated.
- The project records what authority is actually present and keeps the prior gate as sole active authority pending the separate cutover task. This is workflow-mode authorization, not a protected service.

## Out of scope
- Connecting the v4 candidate to the ordinary task launcher, executing a tier, or completing the cutover; those belong to the next task.
- Claiming that local writable records authenticate their author, bypassing owner review, retroactively approving task #922, editing platform-owned workflows, or installing a second skill definition.

## Steps
1. **Verify assignment and review channels** — Compare the attached v4 specification with the tracked canonical adaptation; inspect actual task identity, plan approval and owner-review capabilities plus the candidate coordinator. Record verified interfaces and safe pre-edit evidence under the previous gate, and stop if there is no defensible source for the required authority.
2. **Bind durable authorization** — Extend the existing project-local coordinator/plan flow only as necessary to bind an independently issued task and exact approved plan/version to a single tier, policy and permitted parameters with transactional audit. Keep draft and request interfaces non-authorizing and ensure concurrent or stale review requests cannot overwrite active authorization.
3. **Present an independent cutover decision** — Prepare the exact policy/adapter, tier, plan and parameter digests for the actual owner-controlled review path; record only a decision actually received. If no trusted owner decision is available, leave activation blocked and document the missing step without fabricating a pass.
4. **Test denial and retention** — Prove wrong task/plan, changed policy, unreviewed approvals, duplicate requests and interrupted transactions fail closed while terminal identity and audit history persist; update the capability record with observed results.

## Task identity
**Draft reference:** Non-authorizing proposal; bind the platform-issued task reference and exact approved plan/version only through the verified assignment route.

## Pre-existing failures to ignore
None known in the currently empty active catalog. Recheck before work and treat all new failures as potential regressions.

**Flaky-test rule:** A passing retry proves intermittency, not provenance.

## Task-local environment observations
The existing candidate coordinator has isolated fixture tests; there is no verified live owner-review adapter or platform-to-local task assignment as of planning. No validation tier has run for this proposal.

## Validation
**Command:** `test-standard`
**Why:** Its failure-gate-contract, unit, typecheck, parity, and manifest checks cover coordinator authorization, plan guard and policy identity behavior while retaining the current registered coverage.
**Do not escalate:** Run only after this task has its own independently authorized tier. Missing approval or report prerequisites block completion instead of permitting ad-hoc or broader checks.

## Regression Guard
**Covers:** A draft, caller-substituted task or self-authored approval becomes active authorization, or a concurrent review loses the plan/policy binding or audit event.
**Test location:** `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`
**What it checks:** Absent independent assignment/review and wrong task or plan deny activation; versioned tier/policy/parameter bindings and audit commit together; stale, duplicate, cancelled or interrupted transitions cannot grant permission or erase history.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/failure-gate/reference/implementation.md`
- `docs/validation/failure-gate-capabilities.md`
- `docs/validation/failure-gate-v4-cutover-acceptance.md`
- `docs/validation/failure-baseline.json`
- `docs/validation/manifest.json`
- `docs/validation/plans/failure-gate-v4-bootstrap.md`
- `scripts/new-plan.mjs`
- `scripts/failure-gate.mjs`
- `scripts/lib/failure-gate/coordinator.mjs`
- `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`
