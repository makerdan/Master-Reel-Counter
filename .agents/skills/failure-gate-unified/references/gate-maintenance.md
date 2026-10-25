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
- ends when the provisioner, single-tier binding, plan guards and bound-tier
  runner work. The next implementation plan uses normal admission.

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

