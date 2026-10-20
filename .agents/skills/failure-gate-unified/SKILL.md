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

Apply it to every task plan and validation execution in a project that adopts
Failure Gate Unified. Govern both phases:

1. **Plan time:** provision a transactional task ID, inspect the baseline
   catalog, establish known failures, and bind one validation tier.
2. **Execution time:** run only the bound tier and classify failures using the
   catalog and available evidence.

If the project's required provisioning, binding, or runner protections are
missing or broken, do not simulate them manually or claim the gate is enforced.
Name the exact failing check and the smallest fix. When the gate itself is
missing, incomplete or broken, follow "Installing, updating and repairing the
gate" below.

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
  task, but must not assign it to different work. Publish only after generation,
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
- Before calling an installation ready, confirm the provisioner, plan guards
  and bound-tier runner work where ordinary tasks run and after a normal
  workspace restart. Use bounded fixtures or non-destructive probes; do not
  reboot a live host, restore live resources or provision infrastructure to
  prove it. A single-session PASS alone is not proof.

## Installing, updating and repairing the gate

The gate cannot admit changes to itself. Installing, completing, updating and
repairing it is gate work. Gate work is done outside task admission on an
authentic owner instruction, visible in the active conversation or verifiable
in project records. No separate specification, reviewer, bootstrap route or
task is required. All gate work:

- is limited to gate scripts, gate policy and the skill revision pin, tier
  definitions, the baseline catalog's structure, gate tests, the plan renderer
  and guards, and gate instructions;
- does not mint task IDs, edit or drop ledger records, tombstones or tier
  bindings, reset the ledger, change application code, or add baseline entries
  without evidence;
- verifies itself with the gate's own tests, reported as setup or maintenance
  checks, never as a tier PASS;
- ends when the provisioner, single-tier binding, plan guards and bound-tier
  runner work. The next implementation plan uses normal admission.

### Skill revision pin

The project records which revision of this skill is current, using a content
fingerprint of the canonical skill file (for example, a SHA-256 hash) or an
equivalent supported mechanism. Gate operations stop when the canonical file
does not match the pin. Each task records the revision it was sealed under and
is checked against that revision; a later pin update does not invalidate it.
New tasks use the current pin. Apply a newer revision to an existing task only
through a supported amendment.

### Installing or completing the gate

- Install this skill at the project's canonical skill location and record its
  pin.
- Retire older Failure Gate skills, instructions, hooks and scripts so exactly
  one gate is active. Keep old reports and records as history, labelled as not
  instructions. Do not merge older rules into Unified.
- Define the four tiers from the project's actual checks. The owner approves
  the workloads; a tier with no meaningful workload is reported, not invented.
- Tasks created under an older gate keep their original IDs and records. Do not
  rebind them; finish, cancel or close them under their original rules or by
  owner direction.

### Updating this skill

Replace the canonical skill file as a whole and update the pin in the same
change. In-flight tasks keep the revision they were sealed under.

### Repairing the gate

When admission or a plan guard fails:

1. Find the exact failing check and its cause from current code, policy and
   records. Retrieve evidence yourself; do not ask for original receipts.
2. If the cause is task-specific, such as a wrong tier, a changed plan, stale
   task context or an unmatched baseline, fix it through the supported plan,
   amendment or retry route.
3. If the gate's own code, policy, pin, renderer or instructions are missing or
   defective, repair them as gate work under an owner instruction.
4. Without that owner instruction, mark the task `BLOCKED`, name the failing
   check and the smallest fix, and ask once for the instruction. Do not ask
   again for work already authorized, and do not substitute a generic request
   to "restore authority."

Record what changed and what was verified in the project's records without
exposing credentials. Gate work does not rebind tasks, waive a tier or turn
historical results into a fresh validation PASS.

## Plan-time procedure

Preparation and generated stubs are not publication of an implementation task.
Complete the following before proposing or publishing the plan. Follow the
supported provisioner's input order, including supplying a tier/specification
upfront when required; do not impose an impossible "no headings before a plan"
sequence.

1. **Establish scope and coverage.** Inspect the requested change, current
   tier definitions and actual workloads. Choose the lightest adequate
   registered tier and identify its supported invocation. Distinguish tier
   registration, adequate coverage and current execution availability. An
   unavailable required tier is not permission to select an inadequate one;
   record any execution blocker without misrepresenting plan readiness.
2. **Inspect the baseline catalog.** Read and validate
   `docs/validation/failure-baseline.json`; look for exact suite, test, and
   signature matches. Missing, unreadable or malformed data is not an empty
   catalog and must not be reported as "None known." Resolve that prerequisite
   through the supported route before declaring baseline admission complete.
3. **Provision and bind safely.** Use the verified project script to mint the
   unique ID and generate its plan/stubs with exactly one selected tier bound
   through the supported mechanism. Do not fabricate an ID or binding.
4. **Complete baseline declarations.** Include the following section in every plan,
   including when no failures are known:

   ```markdown
   ## Pre-existing failures to ignore
   None known at plan time. Treat every failure as a potential regression.

   **Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.
   ```

   Replace the default statement with the exact known issues and their required
   `**Ignored baseline:**` or `**Owned baseline repair:**` labels when
   applicable. Do not treat a retry, by itself, as proof that a failure
   predates the task. Use "None known" only after successful catalog inspection
   establishes no applicable known entries, not when inspection is unavailable.
5. **Complete, seal and guard.** Fill in scope, baseline declarations and the
   validation section, then seal through the project's supported mechanism.
   Run local plan guards against that revision and resolve admission errors.

Before proposing or publishing an implementation task, confirm the provisioner
generated its unique ID, exactly one adequate registered tier is bound, baseline
declarations are complete, and the sealed plan passes local plan guards.
A diagnostic or prerequisite record is not an admitted implementation plan.

Every plan must include this section, naming exactly one authorized tier:

```markdown
## Validation
**Command:** `test-standard`
**Why:** <one-line reason this tier covers the task>
**Coverage evidence:** <current tier definition/workload reference and supported invocation>
**Do not switch tiers:** This task ID is strictly bound to this tier. Other tiers will block execution; changes require a supported amendment.
```

Replace `test-standard` with the chosen registered tier. Keep the rationale
specific to the task.

## Approval, revisions and amendments

A guard PASS establishes plan validity, not permission to implement. Before
implementation, verify the project's supported approval policy is satisfied
for this task and identifiable sealed plan revision. Valid prior authorization
may suffice when it actually covers that scope and revision; do not invent a
universal extra owner click, approval service, signature, or receipt format.

Use the host's supported revision/seal mechanism to keep the task ID, plan
contents, binding and approval evidence consistent. A path or mutable title
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

For every task governed by this contract, automatically perform a preflight before
implementation—not merely before tests. Use a verified host pre-dispatch hook when
available; otherwise make it the executing Agent's first action after Start.
Read-only inspection and supported plan preparation may precede admission;
application edits, migrations, provider calls and validation workloads may not.
Starting a native task or changing its visible description is not gate admission.

Inspect actual scope, governing contract and plan revision, eligibility, baseline
declarations, one adequate registered tier and its workload, approval evidence,
and Regression Guard applicability/declaration when adopted. Reuse valid plans;
do not amend just to produce a new revision or demand redundant tests.

Automatically prepare concrete missing declarations, planned guard tests/assertions
and the lightest adequate registered tier from inspected evidence. This prepares
the plan; it does not deliver tests or justify weak coverage. Complete unsealed
drafts through provisioning. For an existing sealed task, apply a candidate through
the supported amendment/reseal/binding route when existing authorization covers the
scope and identifiable revision under project policy. Ask only for genuinely
uncovered decisions; do not infer that Start universally approves changed scope.
Record amendment rationale and approval applicability, then rerun admission.

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

Immediately before implementation dispatch, establish agreement among the current
task, admitted plan revision, binding, lifecycle and approval evidence using the
host's supported revision/concurrency checks. Reject stale context rather than
silently continuing after another amendment. Admission remains read-only on sealed
plans; preparation/amendment is a separate explicit operation with recorded results.

Document actual enforcement coverage. A local runner can deny its own dispatch;
it does not thereby intercept Replit's Start button or all Agent file edits.
An Agent-first preflight is cooperative instruction, not platform interception.
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
sealed/admitted revision, registered tier and applicable approval evidence.
Reject mismatched or stale context before workload execution. Use the host's
actual context requirements; setting `TASK_PLAN_FILE` alone is not proof that
these checks passed. Do not execute a plan for one ID using another ID's binding.

Check current task eligibility under the host's supported lifecycle before
implementation or validation. Cancellation, supersession or closure must not
silently retain permission for ordinary execution. Historical revalidation may
use an explicitly authorized supported route without reopening the task or
reassigning its ID. Do not impose universal lifecycle labels or a new approval
step when existing authorization already covers that operation.

- **Tier lock:** A top-level tier invocation that does not match the ID's bound
  tier must be blocked immediately. Supported workload steps supervised by that
  tier are not separate tier assignments.
- **Bounded processes:** Use clean timeout bounds. Do not leave orphaned
  daemons, unmanaged child processes, or unmonitored process trees.
- **Single flight:** Do not start duplicate top-level validation runs
  concurrently against the same target.
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
   recent pattern. Record a brief agent note that names the observed evidence.
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
report `PASS` when required checks were skipped, unverified, or failed.

Associate validation evidence with its task ID, admitted plan revision, assigned
tier, applicable workload definition and tested implementation/target through
supported project records. A correct-tier PASS from before relevant source,
configuration or target changes does not automatically validate the current
work. Reuse unaffected evidence when its applicability is supported; rerun
affected required checks and disclose remaining gaps. Do not impose arbitrary
expiry, a universal fingerprint format or blanket full-suite retesting.

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
