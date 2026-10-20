# Skill Installation Verification Plan

This is the bundled planning module of `skill-application-router`, not a
separate skill or installation prerequisite. Load it during the Router's
normal Install/Apply flow or when explicitly asked to plan or carry out
independent verification of a skill's installation or implementation.

## Purpose

Turn a request to verify another skill's installation or implementation into a
project-specific, evidence-linked task plan. The plan must distinguish what is
available to the agent from what is actually installed in the Project and from
what Replit's platform reports as complete.

This planner is portable across Projects and technology stacks. It has no fixed
repository, framework, task manager, test command, or implementation path.
Discover those anew for each target. It creates a plan; it does not itself prove
implementation. If the user also requests execution and a report, carry out the
approved plan only after the target Project and its files are available. Never
present a proposed check as a completed check.

Read the complete [delivery reconciliation policy](delivery-reconciliation.md).
Create a two-phase plan: freeze the authorized obligations before implementation,
then discover delivered details and resolve verification methods without
changing those obligations. Never derive the acceptance standard solely from
the installed output or fail solely on a disproven provisional method assumption.

## Source and scope rules

1. Identify the target Project from the active Project context or project
   resources. Do not assume the most recently opened Project is the intended
   one. If multiple Projects are plausible, inspect available evidence and ask
   one focused question only when the target remains ambiguous. Do not move work
   to an unrelated or newly created Project without authorization.
2. Read the canonical skill definition and its implementation and acceptance
   references from `.agents` in the target Project. Do not treat `.local`
   runtime mirrors, copied skill packages, chat history, or generated summaries
   as canonical skill sources. A runtime-visible definition may be recorded as
   a separate runtime snapshot for parity comparison, never as proof of source
   or Project installation. For a *planned new installation* whose destination
   file is not yet written, use the authorized original specification and
   expected `.agents` destination to plan discovery; leave source-dependent
   checks pending until the installed canonical files can be read.
3. If the canonical source or a referenced contract is unavailable, make that
   a blocked plan item with the exact source and responsible next action. Do not
   fill gaps from a mirror or silently invent acceptance criteria. A pending
   verification task may be proposed for a durably written installation task;
   it may not claim source parity or pass any source-dependent check yet.
4. Discover the target Project's actual repository root, instructions,
   plan/task format, validation commands, record stores, authorization sources,
   approval routes, completion writer, and recovery controls before naming
   commands or interfaces. Reuse verified host capabilities; mark missing or
   unavailable capabilities explicitly. Never carry paths, IDs, commands,
   owners, approvals, or assumptions over from another Project.
5. Keep the verification read-only except for the requested plan/report and
   explicitly authorized, safe validation activity. Do not alter the installed
   skill or enforcement implementation while auditing it.
6. Do not run destructive, production-affecting, hardware, or costly external
   checks without the required authorization and safe environment.

## Separate the claims

Report these as independent evidence tracks:

- **Skill source and runtime parity:** canonical `.agents` source, its
  implementation/acceptance references, and the text actually visible to the
  runtime. Record differences; source availability or parity does not prove
  installation.
- **Project-local installation and implementation:** actual Project files,
  executable host wiring, tests, persisted records, approval evidence, and
  behavior through the installed entry points. Documentation alone is not
  implementation.
- **Replit platform task lifecycle:** platform task status or completion is
  separate evidence. Do not claim that project code controls, blocks, or
  completes a platform task lifecycle unless a verified platform adapter and
  evidence establish that exact behavior.

Never use a skill being loadable, a task being marked complete, a README, a
fixture, or a passing isolated unit test as a substitute for end-to-end host
evidence.

## Build the task plan

### 1. Extract the contract

Read the canonical skill and every linked implementation or acceptance
reference. Convert each applicable invariant, acceptance case, and explicit
limitation into its own checkable plan item. Preserve the source's meaning;
don't make the implementation easier to pass by weakening a requirement.
If a verification-only source/reference is unavailable, record blocked discovery
and later extraction tasks rather than inventing target-specific requirements.
Deliver the requested staged plan/report honestly; an explicitly requested
already extracted matrix remains Partial/Blocked until its source is available.

For each item, define:

- requirement and source location;
- stable requirement ID, fixed expected outcome, and applicability;
- intended verification method and relevant host path, distinguishing verified
  details from fields explicitly pending delivery discovery;
- expected evidence (code, test, live run, raw record, approval, or other);
- responsible role (verification owner, implementation owner, reviewer, or
  platform owner);
- dependencies, safety/authorization preconditions, and pass/fail rule;
- report status: `verified`, `failed`, `blocked`, or `not applicable`.

Pin every requirement now when its authorized source is available. Do not invent
unknown implementation paths or commands. Record bounded discovery/resolution
rules for pending methods; at execution, unresolved required methods block the
affected check. Original and resolved matrices must retain complete coverage.

Use `not applicable` only with a reason. Use `blocked` when evidence, a
capability, an approval, or safe authorization is missing. Name a concrete
owner and next action for every blocked or failed item.

### 2. Discover before specifying

Plan a discovery task to inventory:

- canonical `.agents` source and linked references for the skill under review;
- runtime-visible skill text and source parity;
- Project-local implementation files and actual wired entry points;
- existing tests, run records, plan/task records, approval decisions, and
  recovery documentation;
- the actual final completion writer and any locks or isolation mechanisms;
- platform-owned task status separately from Project-local state.
- installer handoff, expected/actual Project mutations, delivered snapshot,
  and differences from the separate obligation and pre-install baselines.

Use evidence from the target Project itself. Link each claim to a path and line,
test name, run/record identifier, or approval reference. Never invent a path,
command, record, approval, owner, or test result.

### 3. Make the plan executable

Use the target host's verified task format. Order tasks by dependency and include:
owner, input, action, acceptance criteria, validation, evidence to retain, and
blocked-state handling for every task. If the host has no verified task
planner, provide a durable Markdown plan in the Project's established
documentation location and state that it is a plan, not activated work.

Do not assume a platform task number is a Project-local authorization ID, or
that a plan author's statement is approval. Where the reviewed skill requires
a local ID, authorization, reviewer decision, or exact execution profile, make
the plan verify the actual bound records and approval source.

For automatic handoffs, Phase A creates the fixed-obligation dependent task.
Phase B first establishes readiness, independently discovers actual delivery,
classifies differences, and resolves its method matrix through the permitted
route; substantive verification follows. Installer assertions cannot authorize
criteria changes. Apply the reconciliation policy's logged resolution,
method-only correction, and material-renewal routes, including payload readback
and affected-evidence invalidation. Keep verification read-only except for
authorized plan/report writes and safe validation activity.

## Handoff from a skill-application router

Read the complete [binding and recovery protocol](handoff-binding-and-recovery.md)
for every automatic handoff. Preserve all its baseline, payload, lifecycle,
readiness, and recovery checks; verification-only requests use its applicable
evidence rules without requiring an unrelated primary.

The router uses this bundled planner internally during its normal Install or Apply
flow, not through separate user wording. Accept the selected Project, canonical
`.agents` skill path and immutable specification/source/reference manifest
(future installed-source entries may be pending for planned installation), committed primary task
ID and plan digest (or direct-application record), outcome, and requested report
path. Recheck these inputs against the target Project; caller assertions are
not proof of installation. Never read a mirror to fill a missing canonical
source.
Accept the separate pre-install Project baseline, expected authorized mutations
where known, installer handoff destination, and bounded deferred-method fields.
Require a delivered implementation snapshot at execution, not an invented
future snapshot at planning. Verify the handoff independently; handle legacy
primaries without it under the reconciliation policy rather than silently
adding obligations or waiving required evidence.
The primary may be newly created or an existing task surfaced by Replit Agent
during the Router invocation. Eligibility depends on the verified durable
record and matching Install/Apply scope, not who created it or whether a create
response is available in this invocation. Do not demand a replacement primary.

- `definition-install-planned`: the primary installation task and full plan
  have been durably committed, but installation has not happened. Plan the
  later source/reference/runtime checks. If the destination is not written,
  use the authorized specification only for the *expected* obligations and
  require discovery of the installed canonical source when verification runs.
- `full-application-planned`: the primary implementation task and plan have
  been durably committed, but implementation has not happened. Plan later
  independent source, implementation, acceptance, and host-wiring checks.
- `definition-installed`: plan verification of the canonical skill file,
  referenced files, and runtime visibility/parity. Do not imply the behavior
  described by the skill was implemented.
- `fully-applied`: plan the source checks plus independent Project-local
  implementation, acceptance, host-wiring, approval, and live-behavior checks
  applicable to the target skill.
- A chat proposal, uncommitted draft, definitively failed/cancelled primary
  or uncommitted write, Invoke, or Audit
  is not an eligible installation-verification trigger. If follow-up is needed,
  label it as remediation or blocked work.

Return the plan and a proposed verification-task payload; the planner cannot
claim a task exists. For a newly written primary, the Router checks the
successful write and finalized readback; for an existing/surfaced primary, it
checks authoritative committed/finalized-record evidence and matching identity,
plan/version/digest, scope, and dependencies without a new create response.
Reconcile uncertain write responses before declaring non-delivery; recovered
commits use the existing-record route, not a replacement primary.
An already finalized record does not need an artificial rewrite or wait for
a new writer. If its writer is still active, wait with bounded polling and
verify finalization; a timer, unchanged repeated reads, or platform status alone
does not prove it. Then use the verified Project task-creation
interface, link the new task as dependent on the primary task, and record its
returned ID. Check the primary revision immediately before/after linkage and at
execution; enforce observed mismatches through blocked/reconciliation handling.
Key duplicate detection by stable Project identity, exact target skill ID,
primary namespace/ID, committed primary-plan digest, and canonical scope using
the protocol's versioned unambiguous encoding. Persist the key;
record the source digest as separately checked evidence, not a substitute key
once installation delivers that source. Before creating, reconcile matching
existing verifiers including legacy source-or-plan keys against the primary,
plan, scope, full persisted payload, real dependency, lifecycle, and evidence
freshness. Repeated surfacing before/after installation
must reuse the same verifier. A changed primary-plan version/scope needs a
newly bound verification plan through the permitted route; source drift
invalidates affected evidence and must not silently create another verifier
or inherit a prior pass. A later primary task may require a new verification
even at the same source digest. Report `created`, `already
exists`, or `blocked` with the actual task ID or reason, and state any
non-atomic duplicate risk. Do not mark the task active, approved, passing, or
complete merely because it was created. Verify dependency release semantics
and require the protocol's execution readiness check/resume route when release
does not prove actual delivery. Read back the complete
verifier and validate its executable payload/coverage, report path, dependency,
duplicate key, and lifecycle before reporting
successful creation; mismatch requires an explicit blocked/repair result.
Revalidate the verifier's actual executable revision/full payload immediately
before substantive checks and at report acceptance, not only at linkage.
Changed verifier instructions require blocked/authorized reconciliation and
invalidate affected prior evidence.
Expected delivery changes and method assumptions use the explicit reconciliation
classification, not blanket source-drift exemptions. Preserve the task key for
bounded method resolution/correction with unchanged primary plan and semantic
scope; pin resolved matrices/payload revisions separately. Actual primary-plan
or scope changes require renewed binding and linked history, not silent duplicates.
Cancelled/failed or blocked required verifiers are not satisfied follow-ups;
completed verification needs current accepted snapshot/manifest-bound evidence.
Do not launch a replacement for a running verifier or silently reopen a
terminal one. Any retry/replan must use an authorized documented route.

Keep the verifier independent of the application task's own success statement.
The verifier must inspect actual host evidence and publish its report in the
selected Project. Creation of the follow-up task is not itself a skill
application event; do not recursively create another verification task.
Use the [task-handoff acceptance cases](router-task-handoff-acceptance.md)
when verifying this Router integration; surfaced-primary support does not
weaken authorization, finalization, dependency, or duplicate protections.

## Failure Gate Unified verification profile

Use this profile when verifying Failure Gate Unified installation or enforcement.
Read the complete current canonical `.agents` definition and any references it
actually requires; do not assume fixed implementation or acceptance filenames.
For other target skills, derive checks from their own contracts and compose with
Unified only when the project has adopted it.

Separate authorized gate maintenance from ordinary admitted implementation.
Unified installation, update and repair do not require the gate to admit changes
to itself or a separate reviewer/bootstrap specification. Do not make this
Router's paired task protocol a prerequisite for that maintenance. Maintenance
checks are not a tier PASS; subsequent ordinary tasks use normal admission.

Derive discrete evidence checks from applicable current requirements, including:

- Transactionally reserved, permanently unique IDs, retained failed reservations
  and tombstones, and publication only after complete valid generation. Verify
  actual concurrency/merge behavior without inventing a central allocator.
- Exactly one adequate registered tier per ordinary task, actual workload
  coverage, wrong-tier rejection and supported plan/binding amendments.
- Complete baseline declarations from a successfully inspected catalog, sealed
  and guarded plans, and applicable approval for the identifiable revision.
  Reuse valid covered authorization; do not invent universal extra owner clicks.
- Canonical revision-pin alignment, per-task governing revisions and preservation
  of historical/in-flight contracts, identities, bindings and evidence.
- Actual pre-implementation preflight, native/sealed reconciliation where present,
  stale-context rejection, and supported quiescent post-Start amendments.
  Agent-first preflight is cooperative instruction, not a platform interceptor.
- Supported supervised execution with task/revision context, finite bounds,
  single-flight behavior, owned-process cleanup and honest raw outcomes.
- Exact active-baseline matching and ignored/owned handling; supported diagnostics
  and evidence-based classification of unlisted failures. A passing retry proves
  intermittency, not pre-existing provenance. Stale-baseline maintenance warnings
  are not automatic execution blockers.
- Evidence associated with the tested task/revision/tier/workload/target and honest
  PASS, FAIL, BLOCKED or INCOMPLETE reporting. Owner-directed administrative closure
  is not a passing test result.
- Portable provisioning, guards and runner operation in actual task environments
  and after a normal restart, using bounded non-destructive probes. Do not reboot
  a live host, require machine-bound receipts or provision new infrastructure.

Distinguish fixture evidence, installed caller integration and actual operational
acceptance. Missing evidence affects only the dependent claim; it is not proof
that the entire installation failed or that unrelated planning is blocked.
Do not add a mandatory platform final-writer race or claim control over Replit
task completion, tamper-proof enforcement or automatic lifecycle interception.
Any separately requested host-integration check needs actual capabilities and
authorization; never improvise it against production or active user work.

## Required plan output

Use the host's format where possible; preserve these fields:

```markdown
# Verification plan: [skill name] in [Project]

## Objective and scope
[What will be independently verified; what is explicitly out of scope.]

## Source and evidence baseline
- Canonical skill/specification baseline: [immutable revisions/digests/snapshots;
  planned future source explicitly pending]
- Pre-install Project baseline: [starting revision/relevant inputs, required
  baseline checks, and evidenced pre-existing failures]
- Delivered implementation baseline: [pending until delivery; then the actual
  independently established tested snapshot and relevant inputs]
- Implementation/acceptance references: [complete required closure and manifest]
- Runtime-visible text: [source and parity status]
- Project/task identity: [verified Project path and local IDs, if applicable]
- Verifier payload/key: [canonical encoding, exact primary revision and scope,
  complete coverage, safety conditions, report destination]
- Delivery/evidence binding: [readiness/resume strategy, tested snapshot and
  relevant environment inputs; lifecycle and freshness checks]
- Installer handoff: [tracked destination/reference, delivery mapping,
  independently checked claims, and omissions]
- Two-phase resolution: [fixed requirement matrix, pending method fields/bounds,
  resolved matrix revision, classified differences, and authorized amendments]

## Guardrails
[Read-only boundaries, required approvals, safe environment, and unavailable
capabilities.]

## Ordered tasks
| ID | Task and acceptance criteria | Owner | Depends on | Evidence to retain |
|---|---|---|---|---|
| V-01 | Discover available source, references, Project format, and host capabilities; keep future wiring pending | ... | — | Available input manifest and provenance; pending delivery fields |
| V-02 | Pin clause-by-clause obligations; record provisional methods and permitted resolution bounds | ... | V-01 | Original matrix, obligation/pre-install identities, and delivered identity explicitly pending |
| V-03 | After primary delivery, verify readiness and handoff, independently rediscover wiring, and classify differences | ... | V-02 and delivered primary | Delivered snapshot, discovery evidence, handoff checks, difference log |
| V-04 | Resolve/correct methods through the authorized route without changing obligations; read back any revised executable payload | ... | V-03 | Original/resolved matrices, authority, revision and evidence-impact record |
| V-05 | Run applicable required checks and recheck evidence binding at report acceptance | ... | V-04 | Raw required evidence, tested snapshot, per-requirement outcomes |
| ... | ... | ... | ... | ... |

## Required report
[Project-relative tracked report path, evidence-link convention, and required
status vocabulary.]

## Blocked conditions and owners
[Concrete next action and responsible role for each missing prerequisite.]

## Planning delivery criteria
[Requested evidence-linked plan is durably delivered; planned blocked checks
retain owners/next actions and do not mean verification passed. If the requested
deliverable itself needs unavailable content, report its delivery Partial/Blocked.]

## Verification execution criteria
[No verification-success claim unless each applicable required check is
evidenced; all other items are failed, blocked, or justified not applicable.]
```

If the user specifies a report path, use that exact path. Otherwise follow the
target Project's established tracked validation-report location; if none exists,
propose a descriptive path and state it in the plan. For Failure Gate Unified,
`docs/validation/failure-gate-unified-verification.md` is a candidate only when
no owner-selected or established location exists. The report must include the
applicable clause-by-clause matrix,
evidence links, and ownership; distinguish source parity, Project-local
implementation, and platform completion; and list blocked checks with the next
responsible action. Do not mark a check verified until its evidence exists.

## Completion discipline

- A task plan is not an implementation result, approval, or test run.
- Report planning delivery separately from verification execution: Complete
  plan delivery may contain blocked future checks with owners/next actions;
  it never means those checks passed. Missing content needed for the requested
  plan itself yields Partial/Blocked delivery, not an invented complete matrix.
- If asked to execute, use the Project's verified interfaces and authorization
  routes; preserve the raw evidence and report observed outcomes only.
- Keep all durable deliverables in tracked paths of the selected Project, never
  under `.local/`.
- If an execution prerequisite cannot be established, publish the closest
  honest partial result and label unmet verification blocked, not passed.
  A durably delivered staged discovery plan may still satisfy a planning-only
  request; preserve the narrower scope and source-dependent blocked items.
- Report all three baselines, original/resolved matrices, classified differences,
  handoff checks, authorization/amendment history, and evidence impact. Expected
  implementation change is not a pass; a stale method assumption is not proof
  of an implementation defect. Verify the fixed obligations against delivery.