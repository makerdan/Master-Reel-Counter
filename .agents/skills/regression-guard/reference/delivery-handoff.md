# Requirement-to-delivery handoff

Adapt this template to the host's actual records; no new task API, ledger,
receipt service or mandatory identifier format is implied. Start the map at
planning time and update it with actual delivery without modifying sealed plans.
Store changes in supported delivery records and bind them to the admitted revision.

## Context

- Task reference and governing plan/contract revision.
- Regression Guard source revision actually adopted.
- Approved scope and classification rationale, including each material component.
- Admitted declaration form and any verified exception/deferral references.
- Delivered snapshot/diff and target; distinguish planned from actual content.
- Pre-implementation preflight outcome and any post-Start amendment references,
  authorization applicability, dispatch revision and disposition of already-made
  changes. Do not claim retrospective authorization or test delivery from plan edits.
- Assigned validation tier, workload reference and supported invocation when
  Unified applies; otherwise the verified host validation policy.

## Requirement map

| Local label | Recurrence / expected outcome | Planned guard or exception | Actual delivery and evidence | Gaps / disposition |
|---|---|---|---|---|
| R1 | Concrete failure and triggering input | Case/file/assertion, or specific permitted exception | Actual case and relevant assertion; observed run reference tied to delivered snapshot, or exception evidence | Delivered, deferred, failed, blocked or unverified; factual reason |

Use as many rows as material risks require. Labels organize this map only; they
are not allocated task IDs. Preserve original requirements and explain amendments.
Link retrievable records rather than require the user to produce original receipts.
Identify missing evidence plainly. A command line without its observed outcome is
not run evidence. Exception evidence must actually support the asserted limitation.

## Separate read-only verification, when selected

The handoff above is required; a separate verifier is not. Record the review
selection as either "not selected" or the exact owner selection/already-approved
requirement and its scope. Do not label unrequested review pending, create a
reviewer task automatically or block planning, gate maintenance or completion.
This does not excuse missing guard delivery, evidence or required validation.

When selected/required, for each row the verifier records:

- Whether actual approved scope is represented, including mixed material changes.
- Whether the case exists, reaches the affected layer, uses the triggering input
  and makes an assertion that would detect recurrence.
- Whether applicable execution evidence matches the delivered snapshot and required
  bound workload, or whether a valid N/A/deferral is still supported.
- Supported observations, failures, unknowns and remaining action, with references.

Review-only work must not run tests, create tasks, change task states, repair files,
edit plans, reseal or approve. If additional execution is needed, request/route it
through actual authorization and treat the missing evidence as unverified meanwhile.
Keep verifier findings distinct from executor self-report and native platform status.

After authorized repairs, retain the previous finding and update affected delivery
evidence. Obtain a new separate read-only assessment of affected results only
when review remains selected/required. Do not assert independent verification
just because this template was filled out or a verifier was proposed.
