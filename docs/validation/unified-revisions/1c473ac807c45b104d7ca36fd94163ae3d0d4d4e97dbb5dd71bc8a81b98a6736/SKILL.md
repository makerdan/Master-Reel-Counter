---
name: failure-gate-unified
description: >-
  Applies an end-to-end validation gate to task planning and execution. Use when
  a project adopts Failure Gate Unified and tasks need transactional IDs,
  one-tier authorization, baseline handling, bounded test runs, evidence-based
  failure classification, explicit completion states, and owner-directed
  installation, update and repair of the gate itself.
---

# Failure Gate Unified

Failure Gate Unified makes test ownership explicit and execution reliable
before work is declared complete. It bridges repositories with legacy failures
and technical debt with disciplined execution: no unmonitored test runs,
unauthorized validation-tier escalation, or silent failures.

Apply it to task planning and validation in adopting projects:

1. **Proposal:** prepare a complete, explicitly unadmitted native draft without ledger writes.
2. **Execution admission:** before implementation or validation, provision or reuse
   the unique local identity, inspect baselines, bind one adequate tier, seal and guard.
3. **Validation:** run the bound workload and classify failures from available evidence.

If the project's required provisioning, binding, or runner protections are
missing or broken, do not simulate them manually or claim the gate is enforced.
Name the exact failing check and the smallest fix. When the gate itself is
missing, incomplete or broken, follow "Installing, updating and repairing the
gate" below.

## Required references

The linked references are normative parts of this skill, not optional examples.
Read each in full when its stated trigger applies. If a required reference is
missing or unreadable, report the affected operation as blocked rather than
reconstructing its rules. Core and references form one revisioned contract;
see Gate maintenance for package-aware revision pinning.

## Project discovery and adaptation

Keep the guarantees in this contract fixed; adapt their implementation to the
host project rather than copying another project's architecture. Before installation
or workflow changes, inspect and document these mappings in ordinary project guidance:

- Canonical source and revision pin, baseline catalog and tier definitions.
- Actual draft-publication, provisioning, guarding, amendment, execution and
  maintenance routes, including each environment's read/write capabilities.
- Generated-state locations, retention limits, historical formats and supported recovery.
- Each tier's real command, coverage, dependencies, availability and finite timeout.
- Adopted companion skills and any shared validation targets or output resources.

This mapping is implementation documentation, not another approval receipt or
admission authority. Reuse supported project mechanisms. Script names and invocation
examples do not require a particular language, package manager, host service or
remote ledger. Preserve the contract's tier identifiers and baseline declarations;
workloads, storage mechanisms and supported tool routes are project-specific.

Apply companion requirements when those skills are adopted or otherwise explicitly
required. Do not automatically install Regression Guard, Port Authority, CI or
follow-up infrastructure because another project used it. Existing adopted controls
remain binding. Definition installation, executable enforcement and observed
acceptance are distinct outcomes; report which was actually delivered.

## Authorization and local enforcement boundary

Ordinary applicable task approval authorizes the Agent's work within its actual
scope and applicable revision. The Agent respects approval, cancellation, closure,
supersession and scope changes. Start, a local guard PASS or a workload PASS is
not independent approval. Stop affected work when actual permission is absent,
uncertain, withdrawn or exceeded; ask only for genuinely uncovered decisions.

The local gate validates sealed plans and local context and supervises the assigned
workload. It neither authenticates native task state nor intercepts platform actions.
Under no circumstances install, integrate, add, restore or enable custom native-host
admission for Unified, including optional or dormant adapters, hooks, plugins,
wrappers, callbacks, receipts or indirect dependencies that independently verify
native lifecycle, approval, revision or association to authorize or veto local work.
The prohibition follows function, not name or location. Do not propose such an
integration as an upgrade, repair, compatibility fix or prerequisite. Ordinary Agent
use of supported native tools, publication bookkeeping and local seal checks remain allowed.

Neither CLI, exported runner nor another supported dispatch route may require that
integration or return an equivalent native-integration-unavailable denial after valid
local checks. Do not replace it with an environment override, caller-supplied approved
flag, fabricated receipt or fixture callback. If a local result includes native
authorization observation, report NOT_OBSERVED, not an authorization verdict.
Native references are association/retry metadata, not Unified IDs or approval proof;
do not require a reference before native creation.

## Non-negotiable contract

### Transactional task IDs

- Mint every task ID through the project's safe provisioning script (for
  example, `scripts/new-plan.mjs`), which must generate the plan and its
  required stubs.
- IDs are permanently unique and never reusable, including after a plan is
  deleted or cancelled.
- Allocation must safely reserve identities under the project's actual writer
  concurrency. Preserve consumed reservations after partial provisioning
  failures; do not reissue them or expose partially provisioned tasks as
  admitted. A supported retry may finish the same reservation for the same
   task, but must not assign it to different work. Publish admitted plans only after generation,
  single-tier binding, complete declarations and sealed-plan guards succeed.
  The storage and transaction mechanism remain project-specific.
- Random, collision-resistant IDs (such as UUIDs) satisfy uniqueness without a
  central allocator or a single authoritative workspace. When records from
  separate environments merge, preserve every known ID, tombstone and binding.
- Locate and verify the actual provisioning command in the project before
  relying on it. Do not invent a command or manually reuse an ID.

### Single-tier binding and default deny

- Bind each task ID to exactly one registered validation tier:
  `test-fast`, `test-standard`, `test-standard-plus`, or `test-heavy`.
- Select the lightest registered tier that adequately covers the task.
  Inspect the project's current tier definitions and actual check workloads;
  do not infer coverage from a tier's name or assume the four names have
  universal workloads. Record the definition reference and coverage rationale.
- The runner must reject execution of that task ID under any tier other than
  its registered tier. All other tiers must block the ID.
- Every tier change, including escalation or downgrade, must use the project's
  supported plan-and-binding amendment mechanism. Record the old/new tier,
  rationale and coverage evidence; re-seal, re-guard and satisfy the applicable
  approval policy before execution. Reject unsupported changes. Never silently
  switch tiers, lower coverage to avoid a failure/resource limit, or assume
  that this provision grants permission to downgrade.

### Baseline source and task metadata

- Treat `docs/validation/failure-baseline.json` as the durable source of truth
  for known pre-existing test failures. Match records by exact suite, test, and
  failure signature.
- Every baseline referenced by a plan must be identified as either
  `**Ignored baseline:**` or `**Owned baseline repair:**`.
- `.local/tasks/` is environment-local task archive state. Do not bulk-commit
  it as part of source deliverables.

## Portable execution

The guarantees above are fixed; their implementation is project-specific. Use
the simplest mechanism that enforces them where the project's tasks actually
run, including isolated task environments when the host uses them.

- Unified does not require workspace-identity or machine-bound admission
  checks, and projects should not add them by default: boot fingerprints,
  device/inode comparisons, workspace receipts, signed task identity, a single
  authoritative workspace, remote infrastructure, or a new tier. If the owner
  requires such a check, it must keep working across normal restarts and the
  host's task environments, or come with a coded recovery command that
  preserves the ledger.
- Removing, at owner direction, an implementation restriction the contract
  does not require is not weakening the gate. Never remove the contract's
  guarantees: unique IDs, single-tier binding, sealed and guarded plans,
  wrong-tier rejection, bounded execution and honest reporting.
- Establish readiness for the actual execution environment, not every possible
  host lifecycle. Confirm the provisioner, plan guards and bound-tier runner work
  there through bounded maintenance fixtures or non-destructive probes.
  Demonstrate durable identity/plan preservation and safe continuation across
  supported lifecycle boundaries relevant to that environment. Fresh processes,
  task-worker execution, workspace restart and restore are distinct observations;
  label which was checked. Source-only or simulated checks do not establish
  actual host behavior, and a single-session PASS does not prove restart safety.
- A workspace restart/resume observation is not a universal admission prerequisite
  when the host exposes no supported, non-disruptive way to obtain it. Record it
  as unverified, not passed. Its absence alone does not block ordinary admission
  when the applicable contract guarantees and actual execution-environment checks
  are supported. If a required guarantee depends on an unverified boundary, block
  that dependent operation or use a supported alternative that preserves it.
  Do not reboot a live host, restore live resources or add infrastructure merely
  to obtain an observation. Explicit owner-selected restart acceptance requirements
  remain binding until specifically amended; do not silently waive them.

### Stale task environments and execution handoff

Main-workspace repairs do not prove an already-running isolated task received
them. Check the execution environment's complete runner, selected contract,
policy and required dependency outputs before admission. A readiness Boolean
alone or native dependency status is insufficient. Use supported synchronization
where available; never invent a main-to-task refresh operation.

If synchronization is unavailable, an owner-authorized handoff may execute the
same approved scope in a current supported environment. Establish one executor:
use actual supported status/control evidence or explicit owner confirmation that
the prior executor will remain idle. BLOCKED alone does not establish quiescence.
Preserve its work and records; do not auto-cancel, merge stale files or create a
replacement task merely to move execution.

Reconcile accessible admissions, reservations, uncertain writes and shared-state
ownership before retry. Native references are associations, not local Gate IDs.
Do not copy an isolated ledger over another, reset identities or silently rebind
existing seals. Use the destination's supported admission/transfer route and actual
namespace; retain links to known prior records. A missing handoff document alone
need not block an owner-authorized handoff when scope is available, the prior
executor remains idle and no unresolved safety dependency requires that document.
Disclose inaccessible state; absence in main is not proof of absence elsewhere.
Unknown ownership or potentially conflicting operations still require resolution.

Location changes do not waive scope, admission, tier or validation requirements.
Record the execution location and any actual scope-specific exception. An exception
for one task never automatically authorizes another. Report an unavailable transfer
capability precisely rather than requiring another general approval ceremony.

## Installing, updating and repairing the gate

Before installing, completing, updating or repairing the gate, read
[Gate maintenance](references/gate-maintenance.md) in full. It is a required part
of this contract: it defines owner-directed maintenance outside task admission,
its limits, revision pinning, historical preservation and the repair decision path.
The exception does not admit application work included in a mixed request.

## Plan-time procedure

Before drafting, publishing, admitting or proposing follow-up work, read
[Planning and publication](references/planning-and-publication.md) in full.
It is a required part of this contract, including the exact baseline and tier
sections, safe provisioning order, unknown-write reconciliation and real host
follow-up constraints. A complete UNADMITTED_NATIVE_DRAFT may be published;
implementation and validation must wait for execution admission.

## Approval, revisions and amendments

A guard PASS establishes plan validity, not permission to implement. Ordinary
task approval remains the authorization for the Agent's work on the covered
scope and revision. The Agent respects that boundary; the gate does not require
independent native-approval evidence or a second approval mechanism.

Use the project's supported local revision/seal mechanism to keep task ID, plan
contents and binding consistent with the authorized scope. A path or mutable title
alone is not a revision. Material scope, validation or baseline-ownership
changes require a supported amendment, an updated seal and guard result.
Obtain renewed approval when the change exceeds or invalidates the existing
authorization under project policy; do not carry approval forward by assumption
or request it again for unchanged authorized work.

Tier names alone do not establish unchanged coverage. If a tier's actual
workload materially changes, reassess the plan's coverage rationale and affected
validation/approval evidence through the supported mechanism before using it.
A matching alias is not permission to omit required checks. Do not turn
unrelated changes or purely cosmetic edits into blanket reapproval requirements.

## Pre-implementation preflight and post-Start amendments

For every governed task, perform preflight before implementation, not merely before
tests. Make it the executing Agent's first action after Start; do not add a custom
native-host admission hook or claim platform interception.
Read-only inspection and supported plan preparation may precede admission;
application edits, migrations, state-changing provider calls and validation workloads may not.
Starting a native task or changing its visible description is not gate admission.

Inspect actual scope, governing contract and local plan revision, baseline
declarations, one adequate registered tier and its workload, ordinary authorization,
and Regression Guard applicability/declaration when adopted. Reuse valid plans;
do not amend just to produce a new revision or demand redundant tests.

Automatically prepare concrete missing declarations, planned guard tests/assertions
and the lightest adequate registered tier from inspected evidence. This prepares
the plan; it does not deliver tests or justify weak coverage. Complete unsealed
drafts through provisioning in a writable execution environment. Current unadmitted
native tasks use the same route; native references are retry keys, not Unified IDs.
Do not bulk-retrofit historical work or imply its earlier activity was admitted.
Interrupted admission must preserve claims and consumed reservations; inspect them
before retrying, never silently mint duplicates. Missing write capability blocks
execution with an actionable prerequisite, not repeated attempts or alternate writes.
For an existing sealed task, apply a candidate through
the supported amendment/reseal/binding route when existing authorization covers the
scope and identifiable revision under project policy. Ask only for genuinely
uncovered decisions; do not infer that Start universally approves changed scope.
Record amendment rationale and authorization applicability, then rerun local guards.

An active task's native Plan may be editable where the host supports it. Keep that
dispatch description and the authoritative local sealed plan consistent through
the supported route; editing the description alone changes neither seal nor binding.
Preserve task identity, consumed IDs, history and ledger guarantees. Never manually
assign a Unified ID to historical native work that has no supported local binding.

If a gap is found after implementation begins, pause affected implementation and
validation, preserve observations and changes, and amend before proceeding. No
concurrent run may continue against a changing plan/binding; wait for verified
quiescence or use its supported authorized cancellation route. Do not stop unrelated
work. A later amendment cannot retroactively authorize edits or certify old results.
Assess already-made changes against the approved scope and rerun affected checks.

Immediately before local dispatch, establish agreement among task context,
sealed plan revision and binding using the project's local coordination checks.
The Agent remains responsible for native cancellation and scope changes.
Reject stale local context rather than
silently continuing after another amendment. Admission remains read-only on sealed
plans; preparation/amendment is a separate explicit operation with recorded results.

Document actual enforcement coverage. A local runner can deny its own dispatch;
it does not thereby intercept Replit's Start button or all Agent file edits.
An Agent-first preflight is cooperative instruction, not platform interception.
The documented CLI and exported runner execute a locally valid plan's bound
workload without custom native evidence. Recheck local revision and context after
coordination gaps. Never claim atomic host/editor interception or native approval
authentication from these checks.
If a supported amendment route is missing, report the exact prerequisite and use
owner-directed gate repair where applicable—not in-place edits, invented authority
or a blanket new reviewer/bootstrap requirement. Preserve historical contracts;
do not automatically retrofit old tasks on Start.

## Bounded execution

Set the plan path and task ID context for every validation run. For the
project's documented task ID, use:

```sh
export TASK_PLAN_FILE=.local/tasks/<task-id>.md
```

Follow the project's documented invocation for the bound validation tier.
At admission, require agreement among the task ID, supplied plan, current
sealed revision and registered tier.
Reject mismatched or stale context before workload execution. Use the host's
local context requirements; setting `TASK_PLAN_FILE` alone is not proof that
these checks passed. Do not execute a plan for one ID using another ID's binding.

The executing Agent must respect cancellation, supersession, closure and changed
scope before implementation or validation. The local gate does not independently
check native lifecycle. Historical revalidation still needs applicable
authorization and the original governing rules or a supported amendment; never
silently move historical seals to the current policy.

- **Tier lock:** A top-level tier invocation that does not match the ID's bound
  tier must be blocked immediately. Supported workload steps supervised by that
  tier are not separate tier assignments.
- **Bounded processes:** Use host-supported supervision with finite timeout and
  cleanup bounds. Do not leave orphaned daemons or unmanaged/unmonitored process
  trees. Document actual containment limits rather than claiming control over
  descendants or host actions the supervisor cannot govern.
- **Single flight:** Do not start duplicate top-level validation runs concurrently
  against the same target. A per-task lock protects one task identity; it does not
  by itself coordinate different tasks writing shared outputs. Use the project's
  supported resource coordination or isolated outputs for actual conflicts, without
  serializing independent checks or requiring another skill by default.
- **Honest reporting:** A command that was skipped, interrupted, timed out, or
  could not be observed to completion is not a passing check.

Retries, filtered checks and diagnostics must preserve task context and use a
supported route that enforces the binding and permits the requested operation.
A filtered retry does not replace the full required bound-tier workload.
Direct invocation is allowed when it is a supported entry point enforcing the
required admission and execution guards. Prohibit unguarded bypasses, not a
particular command shape. Supervised steps within the assigned tier remain
allowed; do not change filters/skip flags to omit required checks or use another
tier to evade admission. Separately authorized independent checks may inform
diagnosis, but cannot substitute for assigned-tier validation or establish its PASS.
No separate reviewer or independent-verifier task is required unless explicitly
selected or already required by an identifiable applicable requirement.

## Failure classification and evidence gate

For each test failure, apply these rules in order:

1. **Active ignored baseline:** If the failure exactly matches an active
   catalog record marked as ignored, classify it as pre-existing for this run.
   Skip it; do not investigate or fix it as part of the current task.
2. **Owned baseline repair:** If the plan owns repair of the matching baseline,
   fix it and verify the resolution.
3. **Unlisted failure:** Retry the failing test in isolation through a
   supported diagnostic/retry route preserving task context and tier controls.
   If no such route is available, record that limitation rather than bypassing
   admission or claiming a retry occurred. A passing retry establishes
   intermittency only; it does not establish pre-existing provenance.
4. **Pragmatic evidence gate:** An unlisted failure may be self-classified as
   pre-existing only when strong contextual evidence supports that conclusion,
   such as relevant files being untouched by the task's diff or a documented
   recent pattern. Untouched files are contextual evidence, not proof that changed
   dependencies, configuration or shared state are unrelated. Record the observed
   evidence and why it supports the classification.
   Use available project and run evidence; do not require the user to produce
   original receipts.
5. **Insufficient evidence:** Treat any failure that cannot be verified as a
   potential regression. Fix it or obtain clear, attributable confirmation
   before classifying it otherwise.

For every self-classified unlisted failure, emit a classification log:

```text
[SELF-CLASSIFIED PRE-EXISTING] <suite or test> — evidence: <file-diff untouched / known pattern / recent memory>
```

Do not use an isolated pass on retry as the evidence in this log. Preserve the
distinction between an observed fact and an inference.

## Completion and closure

Conclude every task in exactly one of these states:

- **PASS:** All required checks succeed, and any owned repairs are fulfilled.
- **FAIL:** A required product check or owned repair failed.
- **BLOCKED:** Required environment, tools, permissions, or enforcement
  machinery are unavailable.
- **INCOMPLETE:** Work is unfinished or the results are untrustworthy.

Report the state with the validation command and its observed result. Do not
report `PASS` when required checks were skipped, unverified, or failed. Distinguish
plan-guard validity, observed workload results, task acceptance and external
activation. A merged native task or passing package test alone proves none of
the other outcomes.

Associate validation evidence with its task ID, admitted plan revision, assigned
tier, applicable workload definition and tested implementation/target through
supported project records. A correct-tier PASS from before relevant source,
configuration or target changes does not automatically validate the current
work. Reuse unaffected evidence when its applicability is supported; rerun
affected required checks and disclose remaining gaps. Do not impose arbitrary
expiry, a universal fingerprint format or blanket full-suite retesting.

### Local completion and native task status

Report local gate assessment, implementation delivery and native task-board status
separately. Supported completion in an authorized destination can satisfy the same
task's scope without rerunning implementation in its stale isolated environment.
Native status reconciliation reads the actual delivery and bound validation evidence;
it is not new application execution or another live admission. Use only supported
Agent-native task interfaces with applicable authority, never project-code proxies.
If unavailable, report the precise remaining task-board action without claiming a
status change. Do not fabricate completion, duplicate the task or resume the old
executor just to update a label. Relevant changed inputs still require applicable
revalidation; reconciliation alone does not invalidate sound existing evidence.

### Owner-directed administrative closure

An authentic owner instruction may direct closure without passing tests—for
example, when the owner changes the task's experimental scope. In that case:

- Set `completionMode: owner_direction`.
- Record the owner's direction and state that this is **administrative
  closure**, not a successful test run.
- Do not represent the task as `PASS` solely because it was administratively
  closed.
- Use an owner direction visible in the active conversation or verifiable in
  the project's task records. Do not ask for original receipts. If the
  direction or authority cannot be verified, do not use this closure mode.

## Baseline maintenance

Maintenance scripts that check for expired or stale ignored-baseline records
surface **warnings**, not hard execution blockers. Keep routine feature work
moving while reporting those warnings for separate maintenance work. A warning
does not make a stale record safe to ignore indefinitely; report the affected
record and its status.
