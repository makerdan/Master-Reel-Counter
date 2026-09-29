---
name: failure-gate-v4
description: >-
  Implement or operate project-neutral, task-ID-based validation controls.
  Discover host capabilities, assign one authorized tier per task, prevent
  unintended tier changes, classify failures using provenance, and require
  applicable recorded validation for completion. Use for task planning,
  task-driven validation, baseline ownership, or Failure Gate installation.
---

# Failure Gate v4

## Purpose and boundary

Separate three decisions: which tier a task may run, who owns each failure, and
whether recorded validation applies to the work being completed.

This skill defines a **project-local, cooperative workflow**; installing it
does not install the runner or registry or change Replit Agent's task lifecycle.
Never announce a lock, approval, test result, or completion check that has not
actually occurred. Checked entry points and a local completion checker can
reject unsupported results within this workflow. An agent with shell/write
access can run other commands or alter local state; this skill cannot prevent
that or require Replit's Task Board to use the local checker. Report this limit,
not tamper-proof enforcement.
The skill supplies no platform active-task binding, human approval service, or
baseline catalog-governance route. Use only verified project-local equivalents;
missing required authorization blocks the affected operation.

## 1. Discover, then install or operate

Discover the host's canonical instructions, languages/runtimes, operating system,
build and validation commands, project-local plan/task format, baseline storage,
persistence, and available project-local completion checks. No framework,
package manager, database, cloud, CI provider, task service, or preinstalled
companion skill is required.

Map the semantic contract to verified host interfaces in a capability manifest.
All example names, paths, tiers, and commands are illustrative, not dependencies.
Use existing equivalents rather than introducing a second project structure.
On hosts using `.agents`, keep canonical skill sources there; other instruction
files such as `replit.md` are discovery candidates only when present.

Classify each required capability as present, missing, or unavailable. Do not
assume named scripts or platform APIs exist. Read
[implementation.md](reference/implementation.md) for installation or changes to
enforcement; read [acceptance.md](reference/acceptance.md) when validating them.

- **Operate:** use verified host commands and interfaces.
- **Install:** implement the missing pieces only when installation is requested;
  preserve existing validation coverage and update canonical sources, not mirrors.
- **Unavailable:** report the exact blocker. Do not invent infrastructure or
  silently downgrade an already active gate.

Documentation-only authoring and non-project conversation are not project
validation runs. For project tasks, use the registered docs/no-op tier only when
its policy explicitly covers the work; never invent a passing validation result.
Keep deliverables outside `.local/`. Disposable archives are not durable plans.

## 2. Core invariants

- Within checked project tooling, one stable local task ID has one active
  authorized tier. All other tiers are denied by default; do not maintain
  redundant per-tier deny lists.
- The authoritative task record binds the canonical plan digest, tier-definition
  digest, permitted execution parameters, policy version, and authorization version.
- Each run separately binds the actual tested snapshot and relevant environment.
  Ordinary code edits do not require new tier authorization, but invalidate
  affected prior run evidence.
- A tier name is insufficient: changed commands, configuration, required steps,
  or coverage require policy review and affected authorization renewal.
- Missing, malformed, stale, conflicting, suspended, or terminal authorization
  fails closed. Never substitute a lighter or heavier tier.
- A task may not approve its own tier change, waive its owned repairs, broaden
  baselines, or silently modify governing enforcement.
- The local runner must verify that a supplied plan matches the project-local
  task record and namespace; reject another task's valid ID/plan. A local
  record cannot attest the identity of a Replit Agent platform task.
- Treat changes to the runner, tier definitions, and checker as policy changes:
  seek separate approval before using changed tooling for the same task.
  Project files alone cannot make this rule tamper-proof.
- Failure classification never changes tier authorization.
- A retry pass establishes intermittency, not pre-existing provenance.

## 3. Plan and activate

Reserve the ID through the authoritative allocator. Read available project memory,
recent task evidence, and the discovered baseline catalog. Missing optional memory
or history is not a setup failure. No catalog means no catalog-authorized ignores;
it does not by itself prevent validation or evidence-based task-local classification.
Select the lightest registered tier covering the task; if coverage is uncertain,
use the project's defined selection policy, not an invented “middle” tier.

Capture a pre-edit baseline observation when the approved host policy requires it
for the affected behavior or risk, whether frontend, backend, native, embedded,
data, infrastructure, or another project type. Use the separate project-local
planning capability, not authorization for a locally active task. Do not run
destructive, production-affecting, hardware, or costly external checks without
their necessary authorization and safe environment.
Run scaffold/plan guards through their separate planning capability. These
bounded capabilities exist before activation and cannot satisfy task completion.
If a required route is missing, report blocked setup.

Use the host scaffold once verified. The following Markdown illustrates required
semantic fields; other project-local task formats may map equivalent fields
without adopting these exact headings:

```markdown
## Task identity
**Task ID:** `TASK-001042`

## Pre-existing failures to ignore
None known at plan time. Treat new failures as potential regressions.
**Flaky-test rule:** A passing retry proves intermittency, not provenance.

## Task-local environment observations
None observed.

## Validation
**Command:** `<registered-tier>`
**Why:** Covers the changed behavior and its relevant integration boundary.
**Do not escalate:** Run only the authorized tier; request approval for changes.
```

Replace examples with real registered values. Record an exact matching baseline
as either `**Ignored baseline:** <ID>` or `**Owned baseline repair:** <ID>`,
never both. Include suite, test, applicable variant/environment, and signature.
Keep task-local observations separate from reusable catalog authority.

Preserve other host-required sections and regression protections. No companion
skill with a particular name is required.
Plan guards must pass before activation. Initial activation requires explicit
plan approval or a previously approved, deterministic activation policy.
Record which authority applies; an agent-written `approved: true` is not approval.
Activate atomically with its audit event and announce only the observed result.

## 4. Execute under the task ID

Use the verified checked runner with local task ID and approved plan reference.
Pass these through validated arguments or a local interface; `TASK_PLAN_FILE`
is an optional file-based adapter, not a requirement. Resolve file plans
inside the registered project root and verify namespace, identity, and version.
Reject another task's plan.
The runner resolves the single authorized tier from the registry and validates
the entire authorization before starting its commands.

Execute required steps without coverage-reducing overrides. Authorized diagnostic
selectors may retry a failed test or compare a verified earlier snapshot; these
are distinct run purposes, not alternative tiers or full-tier completion evidence.
Do not remove the local task ID from checked runner inputs, borrow another local
task's authorization, or relabel required validation as ad hoc.

Record run identity, purpose, authorization version, actual arguments, snapshot,
environment/configuration identity, raw results, and complete report references.
Do not stop a multi-step tier merely because an ignored failure appeared;
account for every required step. Unsafe dependent steps may stop, but the run
is then incomplete rather than acceptable.

Relevant edits after a run require renewed applicable validation. Hash actual
tested inputs, not just the commit ID of a dirty tree. Isolate runs from concurrent
edits; if snapshot integrity is unknown, reject the evidence.

## 5. Classify failures without expanding scope

Apply in order:

1. **Owned repair:** verify the declared obligation and fix it within task scope.
   Expiry or reclassification cannot erase ownership. A deleted, skipped,
   filtered, renamed, or undiscovered test is not proof of repair.
2. **Explicit ignore:** ignore only an exact match to an authoritative, unexpired
   active catalog record applicable to this environment. Do not repair unrelated
   failures. Preserve the raw failing result.
3. **Unlisted failure:** run exactly three authorized isolation retries when the
   diagnostic capability supports that failure. Record each attempt; the initial
   failure is not a retry. Crashes, skips, missing reports, and zero-test runs
   are not passing attempts. Do not retry until lucky.
4. **Provenance:** classify as pre-existing only with direct evidence of the same
   failure on a verified earlier, task-unaffected snapshot plus independent
   corroboration. Match environment applicability as well as failure identity.
5. **Insufficient evidence:** report an unresolved potential regression and block
   completion. Investigate within authorization; do not automatically fix
   unrelated code or label unknown ownership as proven task causation.

Direct evidence is a verified comparison run or a trustworthy earlier run.
Corroboration may be independently sourced task/memory evidence, an applicable
catalog record, or verified unchanged relevant inputs including transitive,
configuration, fixture, migration, generated, and dependency inputs. References
copied from the same observation count once. Narrative memory plus untouched
files without direct provenance is insufficient.

If isolation is impossible or unsafe, use a registry-defined equivalent diagnostic
policy with explicit coverage and attempt limits. Otherwise classification is
blocked; missing diagnostics do not authorize a broader tier.

Typecheck failures remain failures under the host's typecheck policy, not
test-baseline waivers. Harness failures remain blocked/incomplete, not proven
product regressions. Promote a baseline to the catalog only through a verified
project-local maintenance approval route. Record evidence, applicability,
matching rule, review deadline, and the owner/reviewer or policy authority
required by that route. Without it, do not promote; keep the failure task-local.

## 6. Change authorization deliberately

Request a tier change only for a concrete coverage/scope need—not a known failure
or extra confidence. Permit one pending request. Suspend validation if current
coverage is inadequate; otherwise the old tier remains the only authorized tier.

Approval must identify the recorded project-local human or previously authorized
policy authority and the exact decision evidence. If the required approval route
is unavailable, block the change; do not invent an owner-review service.
Move authorization atomically: update tier, plan version/digest, parameter and
tier digests, authorization version, request state, and durable audit event.
Run plan guards against the proposed plan before publishing the change.
Rejection cannot clear an independent suspension or violation.

Validation-relevant plan amendments follow the same approval/versioning rule,
even without a tier change. Code edits inside approved scope do not.
Serialize transitions with active runs; do not orphan a run or accept stale
results. Keep using the prior governing policy until a change is separately
approved; this is a workflow rule, not tamper-proof enforcement.

## 7. Decide completion and report accurately

Keep raw exit status separate from assessment:

- `PASS`: all required obligations executed successfully.
- `ACCEPTABLE_WITH_IGNORED_FAILURES`: complete results contain only qualifying
  unrelated failures; owned repairs and other mandatory checks are satisfied.
- `FAIL`: a regression, unmet repair, or other required product check failed.
- `BLOCKED`: authorization, evidence, required capability, or environment is missing.
- `INCOMPLETE`: execution/results are unfinished or untrustworthy.

The project-local completion checker must examine applicable full-tier run
records and all observed failures, not accept a summary or a manually supplied
`PASS` label. Diagnostics cannot replace full-tier validation. Unexpected
zero-test runs, missing reports, and skipped required steps cannot become
acceptable through baseline classification. Ad-hoc runs are not recorded as
required-tier validation for a project-local task. The checker can reject
inconsistent local evidence, but cannot authenticate evidence against an agent
who can edit the runner and records.

Require the local checker before marking a task complete **in this workflow**.
This does not gate Replit Agent's Task Board or any platform-owned success path.
If a required external check cannot be run or verified, report local completion
as blocked; never impersonate it or silently omit it.

A still-running check is incomplete. A polling timeout is not cancellation.
Do not start a replacement while the original remains active; use documented
recovery. After acceptance, failure, or cancellation, release authorization
atomically and retain IDs/history. Failed/cancelled tasks need no passing validation
to release safely after run handling.

Report local task ID, authorized tier, run IDs, tested snapshot, raw results,
assessment, failure ownership/evidence, and workflow limitations. Never call
an ignored failing suite a clean pass.