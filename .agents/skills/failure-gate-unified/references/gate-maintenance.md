## Installing, updating and repairing the gate

The gate cannot admit changes to itself. Installing, completing, updating and
repairing it is gate work. Gate work is done outside task admission on an
authentic owner instruction, visible in the active conversation or verifiable
in project records. No separate specification, reviewer, bootstrap route or
task is required. The exception covers gate maintenance, not application changes
included in a mixed request; admit that application work separately. All gate work:

- is limited to gate scripts, gate policy and the skill revision pin, tier
  definitions, the baseline catalog's structure, gate tests, the plan renderer
  and guards, and gate instructions;
- does not mint task IDs, edit or drop ledger records, tombstones or tier
  bindings, reset the ledger, change application code, or add baseline entries
  without evidence;
- verifies itself with the gate's own tests, reported as setup or maintenance
  checks, never as an ordinary task-tier PASS. Disposable fixture identities may
  exercise lifecycle behavior but must not enter the live ledger or imply task approval;
- reports delivery, acceptance and activation separately as described below.
  The next implementation plan still uses normal admission.

The no-ID rule concerns admitting this maintenance task into the live ledger;
it does not forbid disposable fixture records used by gate tests.

### Skill revision pin

The project records which revision of this skill is current, using a content
fingerprint of the canonical skill file (for example, a SHA-256 hash) or an
equivalent supported mechanism. Gate operations stop when the canonical file
does not match the pin. Each task records the revision it was sealed under and
is checked against that revision; a later pin update does not invalidate it.
New tasks use the current pin. Apply a newer revision to an existing task only
through a supported amendment.

For this modular package, revision identity must cover SKILL.md and every normative
reference, not only the core file. Use the package manifest's normative-contract
fingerprint or an equivalent supported full-contract mechanism. Preserve exact
snapshots of all governed files and their identities. A core-only fingerprint
cannot detect changed reference rules and is insufficient for new admissions
under this modular revision. Historical single-file revisions keep their original
identities and rules; migrate only through supported, owner-authorized maintenance.
The manifest records content identity, not native approval or proof that a runner
actually enforces the pin.

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

Adoption is prospective. Reconcile the complete package with actual project-local
readiness checks and instructions: distinguish obsolete unconditional host-restart
prerequisites from still-required persistence/safety controls and explicit owner
requirements. Remove or revise only the former through owner-authorized maintenance.
Do not simply toggle readiness or relabel old process probes as workspace acceptance.
Use supported environment-specific checks and preserve required regression coverage.
Do not import any other project's task-specific exception.

Replace the canonical skill file as a whole and update the pin in the same
change. In-flight tasks keep the revision they were sealed under.
Preserve an exact before snapshot and all historical revision/template/preflight
and adopted compatibility mappings. Add the new revision's necessary mappings
together; do not rewrite old seals, bindings or results. Inspect and reconcile
each adopting project's follow-up instructions and durable project guidance with
the [follow-up compatibility rule](planning-and-publication.md#follow-up-compatibility-in-adopting-projects), within owner-authorized scope. Installation and matching pins
are source maintenance, not proof of runtime acceptance or propagation to other
projects. Platform refreshes may replace local default instructions; disclose
that limit and retain the reconciliation rule in durable project guidance.

### Repairing the gate

When admission or a plan guard fails:

**Establish where the failure occurs first.** Read the failing executor's actual
policy, selected contract, runner and required dependency outputs. When a destination
environment is relevant, compare its current state separately. Main's successful
repair does not establish worker propagation; a worker's disabled policy does not
establish that main needs repair. Disclose inaccessible environments rather than
guessing their state.

Distinguish stale source or dependencies, task-specific admission problems, missing
authoritative state and actual gate defects. Use the smallest supported remedy.
Do not repeat project-wide activation maintenance for a stale worker or request
authorization already given for the same work. Follow the core's
[execution handoff rules](../SKILL.md#stale-task-environments-and-execution-handoff).
An execution handoff requires the prior task executor to remain idle and conflicting
operations to be reconciled. Unrelated development services may remain running unless
they interfere with the task's resources or safety guarantees. Do not require
whole-workspace shutdown merely to establish task-executor idleness.

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

### Missing authoritative state

Conduct a bounded search of accessible recovery sources and relevant task/delivery
records. Distinguish a complete recoverable checkpoint, partial historical evidence
and inaccessible environments. Missing files in the current environment do not prove
that other copies were destroyed.

If no complete candidate is accessible, stop repeating the restoration request.
Explain what is missing and present the smallest applicable decision: defer affected
work, restore from a newly identified valid source, or authorize a project-local
design for future operation with explicitly incomplete history.

Future operation after acknowledged state loss is not restoration. It requires
explicit authorization and must preserve known records and identity claims, prevent
identity reuse, retain unresolved obligations, and address the storage and concurrency
guarantees needed by the selected execution scope. It must not fabricate missing
history, reset an old ledger, silently rebind existing work or declare historical
acceptance. A partial snapshot is not proof of all previously consumed identities.

Do not prescribe a database, central allocator, identity format, remote journal or
worker-transfer system universally. Reuse supported project capabilities. Main-only
operation may be selected without implementing isolated-worker operation; unsupported
execution modes remain unavailable. This decision path does not authorize
implementation or activation by itself.

### Maintenance delivery, acceptance and stopping

Maintenance may conclude with verified readiness, or stop at the owner's direction
with delivered changes and explicit unresolved acceptance. Report implementation
delivery, maintenance-check results, activation state and native task status separately.

"Implementation delivered; acceptance deferred; activation disabled" is a valid scoped
delivery outcome, not a validation PASS or permission for ordinary execution. Preserve
failed and incomplete results and identify what must be resolved before the affected
capability is enabled. Do not disable unrelated, already accepted capabilities merely
because a separately scoped change is deferred.

Do not expand maintenance indefinitely merely to obtain a clean completion label.
Additional work must remain within the authorized scope. Deferral does not waive a
required check or satisfy an original acceptance criterion.

Use supported native closure actions honestly. Administrative archival is not a
successful validation result, and a board-status limitation does not require duplicate
implementation or resuming a stale executor.
