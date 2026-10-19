# Activate Local Failure Gate

## What & Why
Complete the existing Failure Gate v4 candidate as a **project-local workflow gate**, the scope selected by the user. Today the checked task launcher still uses a caller-supplied legacy plan and the v4 coordinator can run only in fixtures. Connect the existing coordinator to ordinary project-local task validation and local completion when a real task assignment, exact approved durable plan, and separately recorded human approval or previously owner-approved deterministic policy are available. Keep the previous gate in effect until an independently reviewed cutover; never present this as tamper-proof enforcement or as control over Replit's task-board completion.

## Done looks like
- For a genuinely assigned and approved task, the project-local checked launcher runs only its one authorized registered tier and records the approved plan/version, policy/parameter/tier digests, tested snapshot, raw step results, run ID, and local completion decision.
- Wrong task, plan, tier, stale policy, unsupported environment, incomplete reports, or missing approval launch no checks; edits after a run invalidate affected completion evidence. A provisional draft or ad-hoc run never authorizes completion.
- The actual owner reviews the exact cutover policy/adapter and approval mechanism before activation; without verifiable review or task-to-plan binding, the candidate remains inactive and reports the missing capability instead of issuing an approval.
- The prior gate and its coverage remain effective until cutover; after an accepted transition, there is one local authority with retained historical records and a recoverable failed-transition state.
- Task-validation and platform-managed completion reports remain separate. Platform-managed completion stays BLOCKED without a verified platform handoff, and protected enforcement is not claimed.

## Out of scope
- Installing a second skill definition, treating the uploaded archive or runtime mirror as canonical, or storing deliverables under `.local/`.
- Self-approving policy, inventing platform assignment or owner-review evidence, retroactively authorizing old tasks, or automatically running/approving the in-progress photo-handoff task.
- Changing `.replit` platform-owned completion workflows, publishing, production checks, registered validation coverage, dependency-audit thresholds, or unrelated product behavior.

## Steps
1. **Reconcile authority and baseline** — Compare the attached v4 specification with the tracked canonical adaptation and the current acceptance record; inspect real task assignment, durable plans, owner-review path, existing task/validation history, and every local completion route. Record supported versus unavailable interfaces and safe pre-edit observations under the previous governing policy; do not run production-facing checks or count prior fixtures as acceptance.
2. **Make approval and identity real** — Establish a durable, reviewable project-local binding between an independently issued active task ID, its exact approved plan/version, the selected tier and effective policy/parameter definitions. Require a separately observed human approval or previously owner-approved deterministic activation policy, with transactional audit and no agent-authored approval flag, inferred task context, or caller plan accepted as proof; if the host cannot provide these, stop activation and record the precise blocker.
3. **Connect the checked local lifecycle** — Reuse the existing coordinator, runtime manifest, snapshot/report adapters, resource locks, and launcher so ordinary authorized project-local validation resolves one tier and local completion recomputes against final inputs under writer coordination. Preserve concurrent-run recovery, raw failures, exact baseline/owned-repair policy, not-reached steps, terminal history, and fail-closed behavior; make legacy-to-v4 cutover atomic rather than running two authorities.
4. **Verify and report the boundary** — Add executable negative and positive checks for substitution, unauthorized activation, policy drift, stale evidence, race/interruption recovery, missing or skipped reports, and incomplete terminal decisions. Run only the independently authorized registered tier, document actual policy/adapter/plan/tier digests and run evidence, and separately mark platform-managed completion BLOCKED unless a genuine handoff is observed.

## Task identity
**Draft reference:** Non-authorizing plan proposal; bind the platform-issued task reference and exact approved durable plan/version before project-local activation.

## Pre-existing failures to ignore
None known as an eligible active catalog record at plan time. Treat new failures as potential regressions; recheck the catalog and pre-edit observations before work.

**Flaky-test rule:** A passing retry proves intermittency, not pre-existing provenance.

## Task-local environment observations
The tracked catalog is empty. The existing v4 candidate and its fixture acceptance are documented, but the local ordinary task path still uses the prior policy. Owner-controlled review and independently verified platform-to-local assignment were not established during planning; no task-tier validation was run for this proposal.

## Validation
**Command:** `test-standard`
**Why:** Its registered failure-gate-contract, parity, manifest, typecheck, and unit steps exercise the local policy, checked-launcher, approval and completion contract without the unrelated release/browser prerequisites in test-heavy. If implementation changes require coverage absent from this tier, suspend and request an approved tier amendment rather than escalating automatically.
**Do not escalate:** Execute only the active authorized tier. Missing approval, safe prerequisites, or complete reports block completion; no ad-hoc or broader tier may replace it.

## Regression Guard
**Covers:** A caller-supplied task/plan or self-authored approval triggers validation or local completion, or an incomplete/stale run is accepted during a cutover or concurrent lifecycle transition.
**Test location:** `scripts/__tests__/failure-gate-v4-execution.test.mjs`
**What it checks:** Before launching a command, wrong task/plan/tier, absent approval, changed policy and unsupported overrides are denied; only complete snapshot-bound evidence for the active authorization can reach a local terminal decision, and interrupted/concurrent cutover cannot leave two authorities or orphan an active run.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/failure-gate/reference/implementation.md`
- `.agents/skills/failure-gate/reference/acceptance.md`
- `docs/validation/failure-gate-v4-cutover-acceptance.md`
- `docs/validation/failure-gate-capabilities.md`
- `docs/validation/manifest.json`
- `docs/validation/failure-baseline.json`
- `scripts/new-plan.mjs`
- `scripts/check-failure-gate.mjs`
- `scripts/run-locked-tier.mjs`
- `scripts/failure-gate.mjs`
- `scripts/lib/failure-gate/coordinator.mjs`
- `scripts/lib/failure-gate/execution.mjs`
- `scripts/lib/failure-gate/host.mjs`
- `scripts/__tests__/failure-gate-v4-execution.test.mjs`
