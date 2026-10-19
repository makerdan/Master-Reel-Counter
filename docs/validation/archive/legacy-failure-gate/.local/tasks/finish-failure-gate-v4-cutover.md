# Finish Failure Gate V4 Cutover

## What & Why
Complete the remaining project-local application of the canonical Failure Gate v4 contract. The prior implementation is an inactive candidate: local coordinator tests pass, but ordinary task runs still use a caller-supplied plan, two heavy-tier test reports lack approved adapters, and owner-controlled policy acceptance and platform task identity have not been demonstrated. Preserve the prior gate until an independently reviewed cutover is possible; never describe local workflow controls as protected enforcement or claim platform-managed completion without a real handoff.

## Done looks like
- A current capability and acceptance record distinguishes implemented, executable, blocked, and unavailable requirements, including each task/completion route and every registered tier; no historical task is silently authorized.
- Where independently issued task identity, exact plan approval, and owner-controlled policy acceptance are actually available, ordinary project-local task validation runs through one checked v4 path, enforces its single authorized tier, and records complete snapshot-bound results and a local completion decision. If any required authority is missing, that route fails closed and the record names the owner/platform action needed.
- Registered heavy-tier tests produce complete trustworthy per-test discovery and failure evidence, or the affected tier is explicitly blocked before launch without losing any registered checks.
- Executable acceptance cases cover wrong task/plan/tier, stale policy and plan, unauthorized changes, missing or skipped reports, interrupted and concurrent runs, failure provenance, and terminal decisions; existing validation commands and audit thresholds remain intact.
- Platform-managed completion is marked BLOCKED unless an actual platform-origin task ID and approved plan cause exactly one checked invocation and a verifiable run/decision. Protected mode is not claimed.

## Out of scope
- Fabricating an owner review, platform task assignment, protected service, or platform completion dispatch; changing platform-owned `.replit` workflows to simulate them.
- Retroactively approving legacy tasks or converting the cancelled prior cutover task into evidence of approval.
- Changing product features, weakening tier commands/audit thresholds, running production/destructive checks without separate authorization, or writing durable deliverables under `.local/`.

## Steps
1. **Reconcile the contract and authority** — Compare the current canonical skill and acceptance matrix with actual task service, runner, plan guard, baseline, persistence, and completion routes after the reporting and heavy-rationale work has landed. Record the pre-change snapshot, applicable earlier failures, missing independent control interfaces, and any conflicts without treating fixture tests or a cancelled approval task as cutover authorization.
2. **Complete local checked execution** — Connect the existing coordinator and snapshot/report components to the ordinary checked task entry and local completion route only through independently verified task assignment, exact approved plan/version, owner review, and writer coordination. Keep provisional drafts and ad-hoc diagnostics non-authorizing, fail closed when host controls are unavailable, and retain existing resource locks and lifecycle recovery.
3. **Cover remaining registered reports** — Add trustworthy bounded report/discovery handling for the currently unsupported browser and nested-tier test steps without filtering tests or changing command argv; preserve raw status, independent-step coverage, named not-reached steps, and exact baseline/owned-repair obligations. Reject missing, truncated, skipped, zero-discovery, or mismatched reports rather than manufacturing success.
4. **Independently review cutover** — Present the exact policy and adapter digests, plan/version, tier/parameters, and acceptance evidence to the actual owner-controlled approval path; activate only after that review is recorded atomically. Otherwise leave the prior policy in place, keep v4 inactive, and document the precise blocker rather than self-approving or making a task-authored flag authoritative.
5. **Verify and report boundaries** — Extend tests for identity substitution, approvals, policy drift, retries/provenance, snapshot races, heavy report completeness, and final-input invalidation. Run the approved checked tier only, reconcile each acceptance category with actual results, and separately report local task validation versus platform completion and unavailable protected enforcement.

## Task identity
**Draft reference:** `draft:finish-failure-gate-v4-cutover` (non-authorizing planning reference; bind to the independently assigned task ID and approved durable plan before execution).

## Pre-existing failures to ignore
None known as an eligible active catalog baseline at plan time. The recorded pre-edit obstruction for the earlier bootstrap task is not an ignore for this task. Treat new failures as potential regressions.

**Flaky-test rule:** A passing retry proves intermittency, not pre-existing provenance.

## Task-local environment observations
The v4 implementation is currently a candidate; the documented local bootstrap `test-standard` passed under the prior policy, while independent production approval, actual task binding, and managed completion dispatch are not verified. The baseline catalog is empty. Recheck these observations against the executor's starting snapshot.

## Validation
**Command:** `test-heavy`
**Why:** This work must prove the heavy-only browser-tests and nested-tier-regression report/discovery adapters against the actual registered commands, plus preserve the startup, audit, lock, and collision coverage used by this cutover. Do not execute unsafe external checks without their required authorization or silently substitute a lighter tier.
**Heavy-tier rationale:** The registered `browser-tests` and `nested-tier-regression` steps are not in `test-standard-plus` and are the two currently unsupported test-report adapters for v4 heavy-tier preflight.
**Do not escalate:** Run only this authorized tier after task binding and approval; if authorization, prerequisites, or a safe runtime are missing, mark the affected checks not reached and completion BLOCKED rather than executing ad hoc tiers.

## Regression Guard
**Covers:** A changed validation policy or wrong task/plan is used to launch another task's tier or mark incomplete, stale, interrupted, or unsupported validation as successful at local completion.
**Test location:** `scripts/__tests__/failure-gate-v4-execution.test.mjs`
**What it checks:** Before any command starts, mismatched identity, plan, tier, policy, or approval is rejected; accepted runs bind complete per-step reports and immutable tested inputs, and completion rejects stale, missing, skipped, or otherwise untrusted evidence. Include focused heavy-report cases for browser and nested-tier adapters in the same owning test layer.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/failure-gate/reference/implementation.md`
- `.agents/skills/failure-gate/reference/acceptance.md`
- `docs/validation/failure-gate-capabilities.md`
- `docs/validation/task-907-acceptance-outcomes.md`
- `docs/validation/manifest.json`
- `docs/validation/failure-baseline.json`
- `scripts/run-locked-tier.mjs`
- `scripts/lib/failure-gate/coordinator.mjs`
- `scripts/lib/failure-gate/host.mjs`
- `scripts/lib/failure-gate/runtime-tiers.mjs`
- `scripts/lib/failure-gate/execution.mjs`
- `scripts/__tests__/failure-gate-v4-execution.test.mjs`
