# Apply Failure Gate V4

## What & Why
Upgrade the existing Failure Gate tooling to the user-approved v4 workflow-enforcement design. Extend the current runner, plan guards, baseline catalog, and resource locks rather than introducing a competing validation system. The existing implementation checks a caller-supplied plan's tier but lacks durable task authorization, independently assigned task context, run-bound snapshot evidence, and a completion decision based on complete results.

This is a bounded bootstrap implementation under the prior governing policy, not an ordinary task authorized by the gate it is building. User approval of this task authorizes implementation and bootstrap validation, not self-approval of the changed enforcement policy. Independently accepted policy and executable acceptance evidence are prerequisites for operational cutover.

## Done looks like
- A durable capability map identifies present, missing, and unavailable v4 interfaces, their actual host mappings, and the workflow enforcement boundary.
- Each activated task has one authorized tier, approved plan and policy versions, durable audit history, and transactional lifecycle controls; unauthorized or stale requests fail before launching checks.
- Recorded validation identifies the actual tested inputs and environment, preserves raw failures, accounts for every required step, and cannot be replaced with diagnostic or ad-hoc results.
- A project-local completion checker rejects incomplete, stale, mismatched, or unsupported evidence and distinguishes PASS, ACCEPTABLE_WITH_IGNORED_FAILURES, FAIL, BLOCKED, and INCOMPLETE.
- The existing canonical instructions and tracked documentation describe v4 coherently; existing coverage, audit thresholds, and resource safety remain intact.
- Platform-managed completion remains explicitly BLOCKED until independently supplied active task identity, exact approved plan reference, and one checked dispatch are verified across the platform boundary. Project tests do not impersonate that verification.
- Durable plans, policy, reports, schemas, tests, and documentation live outside .local; live coordinator state also persists outside .local and is not merged as database binaries.

## Out of scope
- Protected or tamper-proof enforcement, a new external authorization service, or claims that unrestricted shell access is prevented.
- Editing platform-owned workflow/dispatch configuration, inferring an active task from the newest plan or arbitrary environment variables, or adding a fallback to bypass missing platform context.
- Product API, authentication, application database, UI, or deployment changes; triggering remote CI, publishing, or production checks.
- Unrelated baseline repairs, publishing-concurrency work already proposed separately, bulk rewriting legacy plan archives, or silently changing existing tasks' approval history.
- Installing a second skill definition or copying a runtime mirror into the repository. Adapt the existing canonical Failure Gate guidance under .agents; leave unrelated skills and the routing catalog unchanged.

## Steps
1. **Establish the bootstrap contract** — Re-read the merged prerequisite work and the current v4 specification, capture prior policy and pre-edit evidence, and create the durable capability and acceptance maps. Identify every local and platform completion route and explicitly distinguish supported local operations from unavailable platform adapters.
2. **Add durable authorization storage** — Implement a transactional, single-workspace coordinator with namespace-scoped IDs, approved plan records, authorization versions, audit events, run leases, and permanent terminal history. Document persistence, backup, retention, restart behavior, and the absence of cross-workspace coordination.
3. **Separate planning and activation** — Extend the existing scaffold and guards with durable plan identity and bounded planning/discovery purposes, then add approval-backed activation and amendment controls. Keep legacy work under its recorded prior policy until an explicit cutover; do not invent past approvals or activate from an agent-written approval flag.
4. **Bind checked execution** — Extend the existing checked entry point to resolve the authorized tier from the coordinator and verify assigned task context, plan identity, policy inputs, allowed parameters, and run leases before launch. Preserve resource-lock behavior and deny missing context, task substitution, escaping paths, stale policy, and coverage-reducing overrides.
5. **Capture complete run evidence** — Execute against an isolated input snapshot and record actual arguments, dependency/runtime/configuration identities, step results, discovery counts, report digests, and relevant fixture/environment identity. Preserve raw nonzero outcomes and account for independent required steps even when an eligible ignored failure appears.
6. **Implement bounded diagnostics and ownership** — Add tier-owned retry/comparison capabilities and exact environment-aware baseline assessment while retaining owned-repair obligations. Require direct earlier-snapshot provenance plus independent corroboration; unresolved failures block completion without automatically expanding repair scope.
7. **Gate completion and recovery** — Implement the local checker and transactional terminal transition, including applicable full-tier evidence, final-input verification, safe lease recovery, and cancellation. Provide a fail-closed platform adapter boundary, not guessed task identity or a platform-managed completion workaround.
8. **Align canonical policy and migration** — Update existing canonical guidance, durable plan conventions, capability documentation, and approved distributable assets to remove conflicting older rules. Produce an explicit independently approved activation procedure and preserve existing task/reporting improvements without keeping competing authorities active.
9. **Prove and reconcile acceptance** — Add executable acceptance cases within the registered bootstrap tier, run its prior-policy validation, and produce a requirement-by-requirement outcome report. Keep enforcement inactive where prerequisites remain unavailable and report local implementation separately from blocked managed completion.

## Required contract details
### Host and authority
- Host discovery has verified Node 20, existing Node-based validation scripts, a runtime manifest, a separate packaged example tier registry, a baseline catalog, and process resource locks. The product's PostgreSQL database and product-level task tracker are not validation authorization infrastructure.
- Use a transactional local store such as SQLite with an explicitly supported Node 20 driver and a configured durable directory outside .local. Do not assume Node's newer built-in SQLite API exists. Namespace plus UUID identifiers are acceptable; never claim local state coordinates task-agent clones or repository-wide sequential allocation.
- Reuse the platform-assigned project task reference as an external association where available; do not fabricate platform IDs. The local allocator commits unique namespace-scoped identities before exposing them, never reuses committed IDs, and retains tombstones.
- Workflow approvals record actual owner approval evidence and the exact approved plan/policy change. A coordinator-held active assignment, established through the approved control route rather than supplied on each run, binds local invocation to current task identity. If that independent assignment cannot be established, execution is blocked; caller IDs, paths, actor strings, and environment flags are not independent identity.
- Local policy and state remain agent-writable in workflow mode: disclose this procedural limitation. Do not describe locally recorded approvals/results as cryptographic proof or protected attestation.

### Plans, transitions, and governing policy
- One authoritative task row binds namespace, task ID, lifecycle state, canonical approved plan content/reference/version/digest, authorized tier and its effective definition digest, permitted-parameter digest, policy version, authorization version, suspension, and at most one pending change.
- Support draft, active, completed, failed, and cancelled records. Only active unsuspended records authorize execution; terminal IDs cannot reopen. A failed validation run does not automatically terminate its task.
- Activation, amendments, tier moves, recovery, and terminal release atomically commit state and audit using uniqueness constraints, compare-and-swap, and idempotency keys. Audit failure rolls back state; failed plan projection leaves authorization suspended until verification.
- Initial activation requires approved-plan evidence or an owner-approved deterministic policy, not agent discretion. Changes to tiers, validation-relevant plan obligations, baselines, or enforcement require independent acceptance. Rejection cannot clear an unrelated suspension.
- Keep planning guards, baseline discovery, required-tier execution, diagnostic retry, provenance comparison, bootstrap/maintenance, and any separately authorized completion execution as distinct purposes. Only applicable required-tier results fulfill that validation obligation.
- The runtime manifest remains the effective host execution authority; scaffold, guards, runner, and checker must resolve the same effective tier definitions. The packaged registry is an explicit derivative/example, not a second live authority. Preserve coverage and the prerequisite heavy-tier rationale requirement.
- Governing inputs include wrappers, package scripts, runner, checker, tier configuration, and automation adapters. This task must validate under the prior accepted bootstrap policy, not treat its edited commands/checker as self-authorization. A changed policy cannot govern ordinary work until independently accepted.

### Runs and evidence
- Resolve plans inside the registered root and reject traversal/escaping symlinks; remote adapters, if supported, validate namespace, task identity, version, and access. Reject another valid active task's plan just as strictly as a malformed one.
- Acquire authorization-version-bound leases and serialize launch with approval, cancellation, amendment, and release. Reuse existing resource locks rather than replacing their scheduling or process-ownership behavior.
- Capture tracked, relevant untracked/generated, lockfile, actual dependency/runtime, configuration, fixture, and migration inputs without secret-bearing values. Define safe exclusions for output-only reports and logs.
- Prefer an immutable isolated run snapshot; hashes before/after an uncontrolled worktree are insufficient to prove no transient edits. Unknown isolation or environment applicability blocks acceptable evidence.
- Record run purpose, identities/versions, timestamps, argv, environment/configuration identity, raw exit/signal status, every step's outcome, discovery expectations, report locations and digests, and assessment. Bound and validate report reads; missing reports, unexpected zero tests, skipped obligations, crashes, and truncation cannot pass.
- Continue independent steps safely rather than stop solely on an eligible ignored failure. Unsafe dependent steps remain unexecuted/incomplete and cannot yield acceptable completion. Non-test audit/typecheck/lint/smoke/harness failures retain the existing stricter policy; no baseline waiver or threshold weakening.
- Direct/ad-hoc/smoke-only execution and filtered diagnostics never satisfy task completion. Reject coverage-reducing argv/environment/configuration, including CI_SMOKE_TEST for required runs, without indiscriminately removing legitimate runtime variables.

### Failures, completion, and recovery
- Assess owned repair first, exact explicit eligible ignore second, and unlisted failure third. An owned obligation survives catalog expiry/reclassification and cannot be satisfied by deleting, skipping, renaming, or failing to discover the proving test.
- An unlisted supported failure receives exactly three authorized isolation retries after the initial failure. Passing retry establishes intermittency only; crashes, skips, zero tests, and missing results are not passes. Unsupported/unsafe isolation requires an approved bounded equivalent or blocks classification.
- Provenance needs the same failure on a verified earlier unaffected snapshot with applicable environment plus independently sourced corroboration. Memory and unchanged direct files alone are insufficient; copied references to one observation count once, and transitive/configuration/generated/dependency inputs matter.
- Extend baseline applicability/matching policy explicitly with environment/variant, reviewer, authoritative clock, normalization rules, review expiry, renewal/revocation, and ambiguity handling. Check eligibility through completion, do not broaden records automatically, and keep the currently empty catalog empty unless separate maintenance is authorized.
- The completion checker recomputes acceptance from complete applicable evidence, not an agent's PASS field; binds final input state and terminal transition under the same coordination boundary; rejects stale plans, snapshots, policy, copied run IDs, swapped artifacts, and diagnostic substitutions. Workflow tamper resistance must not be overstated.
- Leases have process/coordinator identity, heartbeat, and version. Poll timeout is not process death or cancellation: confirm stop or quarantine unresolved runs before replacement. Handle failed/cancelled cleanup safely without demanding a passing tier, revoke active authorization atomically, retain history, and never kill unrelated services.
- Inventory all host success routes. Locally controlled routes consult the same decision; uncontrolled platform routes are disclosed as workflow bypasses, not enforced controls. Managed completion requires platform-origin task ID and exact approved plan reference with one checked invocation; local launcher tests cannot prove the platform made that invocation. Do not modify .replit validation workflows to evade this boundary.

## Acceptance coverage
Create executable host-adapted tests for every applicable v4 acceptance category: adapters/optional capabilities and safe discovery; allocation/namespace/restart/tombstones; planning/activation; tier/path/task-substitution/override denial; workflow limitations; policy self-authorization denial; atomic approvals, duplicate requests, crashes and races; snapshot isolation and input invalidation; report completeness and output exclusions; exactly-three diagnostics and uncontaminated provenance; independent corroboration and baseline matching/lifecycle/ownership; raw versus assessed outcomes; local completion/ad-hoc rejection; managed-dispatch missing/wrong context and explicit unverified platform boundary; lease recovery, terminal cleanup, injection/path/secret/report safety; and honest legacy migration. Include fixture-host cases demonstrating that example paths, tiers, optional memory/history/catalog, or companion skills are not universal prerequisites. Record actual platform dispatch as BLOCKED, never fixture-verified production behavior.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression. The authoritative catalog is empty; historical task snippets and memory do not authorize ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Require direct earlier-snapshot evidence plus independent corroboration before classifying an unlisted failure as pre-existing; do not automatically repair unrelated failures.

## Validation
**Command:** `test-standard`
**Why:** The runtime tier includes Failure Gate contract tests, plan/parity checks, typecheck, storage checks, and backend/unit coverage. Add the v4 acceptance fixtures to its Failure Gate contract coverage; browser, production, and heavy-only checks are not required for this tooling-only change.
**Do not escalate:** Run only this registered bootstrap tier through the existing checked task-validation entry point under prior accepted policy. Capture a pre-edit run and post-change applicable evidence; request approval for any policy/tier change rather than validating altered enforcement with its own authority. Do not run a broader completion sweep as a substitute for the missing platform handoff.

## Task-local environment observations
- User approved workflow enforcement and explicit blocking of unsupported platform completion. This is not approval for protected enforcement or an invented platform adapter.
- No validation tier was run during planning; repository inspection only. No product backend changes are planned, so the backend-specific pre-edit planning spot check is not applicable; the executor must capture the approved bootstrap baseline before edits.
- The prescribed scaffold invocation was attempted but denied by Plan-mode filesystem permissions. The task submission plan was therefore authored through the permitted planning file tool; durable implementation plans and deliverables must be recorded outside .local by the executor.
- Routing catalog status is changed: failure-gate-v4 is absent from its catalog. The complete currently selected v4 contract and its implementation/acceptance references were read directly; no catalog refresh is in scope.
- No v4 authorization is claimed for this bootstrap task. Use its actual assigned project task reference and approved plan as bootstrap evidence; reserve operational v4 identities only through the implemented allocator.

## Regression Guard
**Covers:** Replacing a caller-plan-only tier lock with task-bound authorization, transactional lifecycle, snapshot evidence, failure assessment, and completion checks must not reintroduce task substitution, coverage bypass, partial activation, stale success, or lost repair ownership.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`, with new focused v4 fixture modules registered by the same contract-test entry point.
**What it checks:** Real child-process and transactional fixture cases assert denied requests launch zero commands, concurrent transitions cannot leave partially runnable authorization, policy edits do not authorize themselves, relevant edits invalidate evidence, ignored failures cannot hide missing obligations, and completion remains blocked without authentic active-task dispatch context. Preserve existing tier/lock/audit/parity regressions.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/validation-tiers/SKILL.md`
- `.agents/skills/validation-tiers/tiers.json`
- `replit.md`
- `package.json`
- `.replit`
- `docs/validation/manifest.json`
- `docs/validation/failure-gate-capabilities.md`
- `docs/validation/failure-baseline.json`
- `docs/validation/failure-baseline.md`
- `scripts/new-plan.mjs`
- `scripts/check-failure-gate.mjs`
- `scripts/check-regression-guard.mjs`
- `scripts/run-locked-tier.mjs`
- `scripts/run-tier.mjs`
- `scripts/lib/tier-lock-check.mjs`
- `scripts/lib/tiers.mjs`
- `scripts/lib/baseline.mjs`
- `scripts/serial-lock.mjs`
- `scripts/validation-steps.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
- `scripts/check-failure-gate-parity.mjs`
- `scripts/publish-failure-gate.mjs`
- `artifacts/bathyscan/public/failure-gate-skill.zip`
