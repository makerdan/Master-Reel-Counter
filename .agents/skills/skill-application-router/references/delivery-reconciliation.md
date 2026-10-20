# Delivery reconciliation and two-phase verification

Mandatory for Router Install/Apply handoffs. Read with the verification planner
and binding/recovery protocol; it does not replace their safety, identity,
dependency, lifecycle, or evidence protections.

## Central policy

Pin the authorized obligations before implementation, but defer unresolved
implementation-specific verification details until delivery. At execution,
independently discover the delivered implementation and reconcile it against
those obligations. Expected changes to Project files, architecture, commands,
or configuration do not by themselves invalidate the verification plan.
Resolve verification methods without weakening requirements, broadening scope,
or bypassing approvals. Material obligation changes require authorized renewal.
Installer handoff records are discovery inputs, never proof of compliance or
authority to change acceptance criteria.

This is a two-phase verifier, not acceptance criteria generated solely from
the installed output. A fixed requirement such as denying unauthorized access
remains fixed even when its route, middleware, or test location changes.

## 1. Separate three baselines

Record these independently, with immutable identities where available:

| Baseline | Contents and use |
|---|---|
| Obligation | Authorized target contract, required transitive references/specification, primary plan, scope, safety boundaries, applicable acceptance requirements, and approved adaptations. Determines what must pass. |
| Pre-install Project | Starting revision and relevant configuration, required pre-edit checks, and evidenced pre-existing failures. Supports regression and failure ownership; it is not the expected final file layout or implementation digest. |
| Delivered implementation | Actual delivered revision/snapshot, files and wired entry points, and relevant configuration/environment inputs. Determines what was inspected and tested. |

Keep obligation/source digests distinct from implementation snapshot digests.
An implementation change is not automatically a changed obligation. Snapshot
changes after evidence collection still invalidate affected evidence under the
binding protocol. Capture only relevant inputs and required baseline checks;
do not add unrelated scans or exceed the target's validation ceiling.

For planned definition Install, the authorized original specification/package
is the initial obligation baseline; the future canonical destination is pending.
At delivery, check the installed package against that baseline and any explicitly
authorized transformations. Definition/source/runtime parity claims remain
separate from implementation behavior.

Apply does not authorize editing the target definition. No adaptation record,
semantic-equivalence claim, or installer statement overrides that boundary.
Where exact content parity is required, retain it; a hash mismatch is a
difference to investigate, not permission to waive parity. Approved adaptations
must identify the original requirement, transformation, authority, and retained
acceptance criterion before they can alter the expected definition.

## 2. Phase A: create a fixed-obligation, deferred-method task

Create the real dependent verifier through the existing verified route after
the primary-record barrier. Pin requirement coverage, scope, safety rules,
report destination, primary binding, and the reconciliation procedure now.

For each requirement, record:

- Stable requirement ID, authoritative source and meaning, applicability,
  expected outcome, and pass/fail rule.
- Known verification method and evidence locations, with their provenance.
- Unresolved method details marked `pending delivery discovery`, never guessed
  as mandatory paths, commands, framework choices, or architecture.
- Permitted discovery/resolution bounds, required authorization, relevant
  dependencies, and blocked-state owner/next action.

Every method must ultimately prove the original obligation. Pending discovery
is planning metadata, not an additional successful execution status. A planned
future check is neither verified nor automatically blocked at task creation.
At execution, unresolved required methods/evidence are reported blocked.

The initial executable payload must explicitly include Phase B and the bounded
method-resolution procedure. Method resolution is not a free-form right to
rewrite the persisted task.

## 3. Primary delivery handoff

For a newly planned primary, include publication of a concise installer handoff
in its authorized scope. Use the Project's established tracked evidence
location, or a descriptive tracked path recorded in the plan, never `.local/`.
For an existing primary lacking this obligation, use an authorized amendment
route rather than silently changing its plan.

Retain:

- Project/target identities, primary ID and authorized plan revision.
- Obligation manifest and approved adaptations, with authorization references.
- Delivered snapshot identity, changed files, and relevant configuration or
  environment identities; redact secrets and never copy credentials.
- Requirement-to-implementation mapping, wired entry points, actual validation
  commands, and validation evidence references.
- Adaptations, deviations, unresolved items, and known verification limitations.

Publish after the intended outputs are delivered and accessible, with the
primary's normal delivery controls. A handoff is not platform completion proof.

The verifier independently checks every relied-on claim. Installer tests may
support evidence but do not replace independent required checks. For older
primaries without a handoff, reconstruct discovery from authoritative evidence
and report the omission. Absence alone is not an implementation failure unless
handoff publication was an authorized requirement; missing required delivery,
authorization, or evidence still blocks its affected checks.

## 4. Phase B: readiness, discovery, reconciliation, then verification

1. Recheck Project/task identity, actual primary and verifier revisions/full
   payloads, lifecycle, dependency semantics, and delivered-input readiness.
2. Independently inspect the obligation baseline, delivered canonical package
   where applicable, actual host wiring, configuration, and handoff evidence.
3. Compare the delivered implementation with the obligations and the relevant
   pre-install baseline. Classify differences using the table below.
4. Resolve deferred methods against verified host capabilities. Produce a
   coverage-preserving resolved method/evidence matrix through the permitted
   route before substantive checks.
5. Run required safe, authorized checks; report outcomes and reconcile evidence
   against the tested snapshot again at acceptance.

Retain the original matrix alongside the resolved matrix and a change log.
Neither installed output nor the installer handoff can become the sole source
of acceptance criteria. Do not drop original obligations because the installed
definition, implementation, or handoff omits them.

## 5. Classify differences

| Class | Required treatment |
|---|---|
| Expected implementation change | Files, wiring, architecture, commands, or configuration changed within authorized scope while obligations are preserved. Resolve the method, record evidence of equivalence, and proceed under the applicable authorization. |
| Incorrect verification assumption | A pre-install path, command, capability, or method assumption is wrong. Correct the method through the documented route, retain all obligations/safety conditions, and record why the original assumption was wrong. |
| Material obligation change | Scope, applicability, acceptance outcomes, contract meaning, authorization boundaries, or required protections change. Block affected checks pending explicit authorized renewal; do not inherit an old pass. |
| Implementation defect | Delivered behavior or required package contents violate an unchanged obligation. Report failed with evidence and remediation ownership; do not revise criteria to excuse the defect. |
| Unresolved difference | Evidence cannot establish classification or equivalence. Report the affected check blocked, with a concrete owner and next action. |

Equivalent implementation is established by requirement-level evidence, not
an asserted digest, an agent-written approval flag, or a blanket declaration.
Do not label a required but unavailable capability `not applicable` merely
because installation did not provide it. Target applicability gates remain
authoritative. Record expected mutations where known; they are not exemptions
from regression checks for behavior that must remain intact.

## 6. Authorized resolution and amendments

Distinguish three operations:

- **Deferred-method resolution:** Fill explicitly pending method fields within
  the original payload's bounds. Preserve obligations, coverage, safety,
  primary binding, scope, and report destination. Record the resolved matrix
  revision/digest and supporting discovery evidence.
- **Method-only correction:** Correct a previously specified method without
  altering those invariants. Retain old/new instructions, reason, requirement
  mapping, authority, and evidence-impact assessment.
- **Material renewal:** Change an obligation, primary-plan revision, scope,
  safety boundary, or other protected binding. Obtain required authorization
  and follow the binding protocol's renewed-plan/generation route.

Use the host's verified, authorized amendment/resolution mechanism. The
initial plan may authorize bounded read-only discovery and tracked
plan/report resolution, but it cannot grant unavailable task-write permissions
or bypass a required host approval. If no permitted route exists, retain the
original task, publish the proposed reconciliation in the authorized report,
and block affected execution with owner/next action.

Prefer an authorized amendment to the existing dependent task where supported.
Pin and read back any revised executable payload before execution and at
acceptance. If the host requires a successor, explicitly link predecessor and
successor, record generations and the renewed binding, and preserve history.
Never silently delete, replace, reopen, activate, or duplicate a task.

Method resolution/correction with unchanged primary plan and semantic scope
preserves the duplicate key; its matrix or executable payload revision is
separate evidence. A changed primary-plan digest or semantic verification scope
requires explicit renewed binding and reconciliation with prior records.
Do not overwrite the old key or treat the new binding as an unrelated verifier.

Invalidate evidence affected by changed methods, requirements, payloads, or
tested inputs. Retain unaffected evidence only when its dependency/provenance
binding is established; uncertain impact blocks reuse. Any correction to a
failed check preserves the original result and justification for rerunning.

## 7. Report

Include all three baselines, original and resolved requirement/method matrices,
delivery/handoff references, classified differences, adaptations and authority,
amendment/generation history, tested snapshot, evidence-impact decisions, and
remaining owners/actions. Use the planner's `verified`, `failed`, `blocked`,
and justified `not applicable` outcomes. Readiness or reconciliation alone is
not a pass. Publish the report even when verification cannot finish.