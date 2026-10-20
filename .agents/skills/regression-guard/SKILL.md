---
name: regression-guard
description: >-
  Require concrete recurrence prevention in plans and delivery for material bug
  fixes, existing behavior/error-path changes, and material security/privacy,
  data-integrity, concurrency/lifecycle, performance/reliability or compatibility
  changes. Classify by substance, including mixed work. Support specific N/A,
  genuine self-satisfaction and documented deferral without forcing purely
  additive, cosmetic, deletion-marked or non-material work into bug-fix coverage.
  Compose with Failure Gate Unified when adopted; preserve historical contracts.
---

# Regression Guard

Before publication, a qualifying plan identifies the concrete recurrence, the
test at the affected layer and the assertion that catches it. The executor
delivers that guard or honors a valid documented exception. A section's presence
is not proof of test delivery, meaningful coverage or successful execution.

This skill owns `## Regression Guard`. Failure Gate Unified, when adopted, owns
baseline declarations, task admission, tier binding, validation and completion.
Do not install Unified just to use this skill or create a second execution or
approval authority. Otherwise use the project's verified governing policy.

Use canonical `.agents` sources and applicable references. Definition authoring
does not install app enforcement, publish a workspace skill or authorize app work.
Read [the enforcement and acceptance contract](reference/enforcement-contract.md)
when implementing, auditing or activating integration. Use
[the handoff template](reference/delivery-handoff.md) for delivery and verification.

## 1. Classify the actual work

Inspect requested scope, affected existing behavior and known implementation
boundaries, not only the title, metadata, file extension or a keyword match.
Classification must precede publication, not the provisioner's required inputs.

Qualifying work repairs or materially changes:

- Incorrect existing behavior or a user-visible malfunction.
- Existing feature behavior, defaults, flows, error handling, recovery or retries.
- Security/privacy boundaries: authorization, isolation, exposure, retention,
  redaction, secrets or protected data.
- Data integrity: validation, persistence, synchronization, transformations,
  migrations, idempotency, consistency or atomicity.
- Concurrency/lifecycle: scheduling, shared state, locks, cancellation, cleanup,
  workers, queues, disposal or shutdown.
- Performance/reliability: caching, resource use, timeouts, backpressure, latency,
  availability, degraded operation or exhaustion.
- Compatibility/contracts: existing APIs, schemas, serialization, configuration,
  storage, public types or supported consumers.

Material means an existing user, workflow, protected-data boundary, data
invariant, lifecycle/resource property or supported contract could be observably
harmed. Do not turn comment edits or equivalent internal refactors into material
error-path changes solely because their files contain `catch`, `auth` or `retry`.

### Exclusions and mixed work

No new bug-fix guard is required for work that is wholly:

- **Purely additive:** an independent capability with no existing behavior or
  contract replaced or materially altered. Ordinary new-feature testing remains
  governed by the host policy, not invented by this skill.
- **Cosmetic/copy-only:** wording or presentation with no material behavior,
  accessibility, security, privacy or contract change.
- **Non-material internal:** comments, dead code or equivalent refactoring with
  no material effect on the properties above.
- **Deletion-marked:** an actual task marked for deletion, not work to implement.
  A `DELETE` title prefix cannot exempt an executing change that removes product
  behavior; classify such a removal on its actual consequences.
- **Pure test/guard work:** only adds or improves tests/checks for otherwise
  unchanged behavior. Use the self-satisfying form when a declaration is wanted
  or required by the host's declared plan format; do not require a test of a test.

Any material component makes mixed work qualifying for that component. A
test-oriented title, a claim of "hardening," a negated phrase such as "not purely
additive," or an exclusion mentioned in examples/history does not exempt it.
Adding a test alongside changed production behavior is normal coverage, not
self-satisfaction. Guard/check/CI implementation that materially changes existing
admission or execution behavior also qualifies; its own delivered tests may supply
the normal guard without creating an infinite sequence of guards.

Record classification and a brief scope-based rationale in supported plan
metadata or associated revision-bound records. A marker communicates that decision;
it does not prove it. Unknown scope needs investigation, not an automatic exclusion.

## 2. Declare the recurrence guard

Every qualifying plan has exactly one `## Regression Guard` section using exactly
one applicable form. A future test file may be planned before it exists; delivery
must establish the actual file, assertion and execution evidence.

### Normal form

```markdown
## Regression Guard
**Covers:** <concrete triggering input/scenario and material failure that must not return>
**Test location:** <project-relative test/check file, identifying the case when known>
**What it checks:** <observable assertion that fails if that failure returns>
```

Fill all three fields with real content, not `TODO`, `TBD`, angle-bracket
instructions, circular promises such as "tests the fix," or a bare directory.
Existing coverage is acceptable only when a specific case and assertion are
identified and shown to detect the recurrence; do not demand a redundant new test.
Multiple material risks can share a section with explicitly mapped scenarios,
test locations and assertions. Cover each risk; one convenient test is not a
blanket guard for unrelated changes.

Match the test to the affected boundary: backend behavior needs backend coverage;
a frontend store needs frontend coverage; a cross-boundary failure needs coverage
at the responsible boundary or a genuine end-to-end assertion. File naming alone
does not establish the layer. Implementation-detail assertions are insufficient
when they can pass while the material failure returns.

Example:

```markdown
## Regression Guard
**Covers:** Saving two edits to the same record must not let a stale response overwrite the latest saved value.
**Test location:** src/store/__tests__/record-save.test.ts — ignores an older response.
**What it checks:** Resolve save B before save A; assert the stored value and visible saved state remain B after A resolves.
```

Place the section after baseline and Validation sections when present, before
`## Relevant files` when present. Unified's required sections remain its own
contract; this skill does not invent them in other hosts.

### Specific N/A form

```markdown
## Regression Guard
**N/A**
**Why N/A:** <permitted category, concrete affected scenario, evidence it applies, and why no feasible automated assertion at the affected boundary exists>
```

Permitted reasons:

- Genuine real-timing concurrency cannot be reproduced by a faithful deterministic
  harness, scheduler, controlled ordering or boundary-level test.
- Unmockable external-service behavior cannot be faithfully reproduced at the
  relevant boundary.
- The defect is purely visual and no applicable screenshot/pixel-diff capability
  exists; distinguish visual correctness from testable state/DOM behavior.
- The affected feature is entirely removed, leaving no recurrence path. Still
  guard material removal side effects or surviving contracts normally.

These are factual exceptions, not keywords to paste into a reason. Inspect the
available harness and narrower-layer alternatives. "Hard to test," expense alone,
an absent fixture that can reasonably be built, unnamed existing coverage or
"test later" is not N/A. Document residual risk and any feasible manual evidence
in the handoff; do not represent it as an automated test PASS.

### Genuinely self-satisfying form

```markdown
## Regression Guard
**Self-satisfying** — The entire implementation scope is the test/check itself: <file, case and assertion>. No separate material behavior change is included.
```

Verify that description against the full scope. Verification-only work may
reference the actual existing check and evidence rather than create a new test.
If verification adds a material repair, amend to normal coverage before that work.
Self-satisfaction prevents recursive meta-testing; it never means an untested
guard implementation is correct or that an announced check was delivered.

### Documented deferral

When a feasible guard cannot fit the task, normal-form fields may name an actual
accepted follow-up using the host's real stable reference, planned test location
and concrete assertion. At publication, verify that the follow-up exists, is
committed under the host's actual lifecycle (not merely a disposable proposal),
owns that recurrence and is covered by applicable approval for the deferral.
Record why it cannot land here, responsibility, dependency/risk disposition and
retrievable evidence. A pasted "(accepted)" label is not verification.

Do not mandate numeric platform references, universal status names, a new approval
service or repeated permission where valid authorization already covers it.
Recheck deferral eligibility before execution and delivery. Cancellation or scope
loss requires supported amendment/resolution, not a silent waiver. Report deferred
coverage as deferred, never as a delivered guard.

## 3. Publish and amend through the actual routes

Use the project's supported plan creation, provisioning, amendment and sealing
mechanisms. They must represent all permitted forms and exclusions without
forcing a normal three-field declaration onto N/A or self-satisfying work.
Draft preparation may generate placeholders, but placeholders cannot pass
publication or execution admission.

For new/current-contract plans, the shared validation decision must reject:

- Missing required, duplicate, mixed, empty, contradictory or placeholder
  declarations; unsupported exclusions, N/A, self-satisfaction or deferral.
- Missing concrete recurrence, mismatched test layer or non-detecting assertion.
- Metadata/declaration mismatch, ambiguous classification or a material component
  hidden by a title, negation or unrelated exclusion statement.
- Incorrect task/plan revision context, unsupported contract changes or stale
  exception evidence under the project's existing lifecycle rules.

Validate candidate inputs before publishing a provisioned plan or amendment.
Safe reservations/stubs may exist according to the provisioner's transaction
contract; do not expose them as admitted plans on failure or reuse consumed IDs.
Failed amendments leave the last admitted sealed revision intact.

Plan validation and supported bound execution are **read-only with respect to
sealed plans**. Reject invalid current declarations before running workloads.
Never wire automatic `--fix-stub` rewriting into validation, CI or execution.
Draft-only helpers, if provided, must be explicit, detect draft status through the
real host mechanism and never mutate admitted/sealed revisions. An amendment
creates the supported new revision; it does not edit a sealed plan in place.

Mechanical validation checks structure and recorded classification evidence.
Semantic adequacy still requires Planner/executor review of scope and coverage;
do not claim that keyword heuristics prove a recurrence is covered. Unresolved
material contradictions must be resolved before admission, not silently accepted.

### Pre-implementation preflight, including after Start

Automatically reassess actual scope and the applicable declaration before any
implementation, not only when validation launches. Use a verified pre-dispatch
hook where supported; otherwise the executing Agent performs this as its first
action after Start. Read-only inspection and supported plan preparation are allowed;
implementation and workloads wait for valid admission and applicable authorization.

If already adequate, reuse the declaration. Otherwise automatically prepare the
concrete recurrence, appropriate test location and detecting assertion, or justified
exception/exclusion. This is planned coverage, not a delivered test. Apply a candidate
through draft creation or the supported amendment/reseal route when the project's
existing authorization actually covers it; do not demand another click for already
authorized work. Obtain renewed approval only for uncovered changes. Under Unified,
coordinate its task ID, baseline, binding and adequate assigned tier in that revision.

An Agent may update an active native Plan where supported, but that edit alone
does not update a local sealed plan or tier binding. Keep both consistent through
the actual revision/dispatch route. Recheck the current admitted revision before
implementation dispatch; reject stale context. No silent sealed-plan rewriting.

If the gap appears after work begins, pause affected work, preserve observations
and changes, establish no conflicting validation run remains active and amend
before resuming. Do not rewrite requirements to fit an observed result, erase the
gap or claim the amendment retroactively authorized earlier work. Reassess existing
changes and renew affected execution evidence through the supported routes.

Record which entry points actually enforce this. Agent-first preflight does not
prove interception of Replit's Start button, arbitrary edits or platform completion.
Missing integration requires scoped authorized repair, not a new universal reviewer,
historical retrofit, bootstrap specification or permission to bypass admission.

## 4. Compose with Unified without changing its contract

Use exactly the task's adequate assigned tier and supported supervised steps.
The guard's test must be covered by that tier's verified workload or supported
invocation; a named file outside its actual workload is not execution evidence.
If required coverage is unavailable, report it. If a tier change is necessary,
use Unified's supported plan/binding amendment with coverage and approval evidence.
Never silently escalate, downgrade, invent a fifth tier or weaken checks to fit.

New installations and updates preserve historical sealed plans, their contract
revisions, IDs, reservations/tombstones, bindings, ledgers, baselines and existing
tier workloads. Record the applicable Regression Guard revision/cutover through
the host's actual contract mechanism. New plans use the adopted current revision;
historical tasks retain their original rules until an authorized supported
amendment applies a newer revision. Do not retrofit archives, reject all old plans
using current-only syntax, or treat unknown revision mapping as grandfathering.

Historical preservation is not historical-policy consultation for new work.
Retired skill definitions and reports must not become competing instructions,
approval sources or prerequisites. Do not require archive-wide reconstruction or
old receipts to install/repair the guard or admit an unrelated current plan.
An unresolved old contract affects only work that actually depends on that record;
preserve it and report the specific limitation while independent authorized work
continues.

Changing workload contents is a separately scoped host-policy change, not an
implicit consequence of installing this definition. Respect the host's real route
for authorized guard-integration maintenance, including Unified's owner-directed
gate work where it actually applies. Do not invent bootstrap specifications,
signed task identities, machine-bound authority or a second approval registry.

## 5. Execute and hand off actual delivery

Before work, verify the admitted declaration and governing revision. Implement
the promised guard or the valid exception within approved scope. If feasibility,
layer, assertion or material scope changes, pause affected work and use the
supported amendment before departing from the contract. Do not edit a sealed
revision in place; supported post-Start amendments remain available.

For a delivered normal guard, establish the triggering input, actual assertion,
correct layer and a credible way it detects the recurrence. Prefer a safe
negative control, isolated old-behavior fixture or equivalent reasoning/evidence.
Never reintroduce unsafe behavior into live resources to demonstrate a red test.
Run through the supported assigned-tier route; skipped, timed-out or unobserved
checks are not passing. An exception does not waive other required checks.

Maintain a revision-bound requirement-to-delivery handoff from planning through
delivery. For each material recurrence or exception, map a stable local requirement
label to the planned form, actual files/cases/assertions or exception evidence,
tested implementation/target, observed results and remaining gaps. These labels
are not new task IDs or a second ledger.

The handoff is required; separate **read-only verification is optional** unless
the owner explicitly selects it or an identifiable already-approved requirement
calls for it. Cite that selection/requirement when review is required. This skill
does not create an independent approval, bootstrap task or reviewer prerequisite
for ordinary planning, installation, gate repair, execution or completion.
Absent optional review is not BLOCKED, INCOMPLETE or pending required acceptance.
Required guard delivery, executor assessment and validation still apply.

Keep the approved scope, applicable skill/plan revisions, delivered snapshot/diff,
requirement map and retrievable evidence ready for a verifier. Do not automatically
create a review task/service or ask again for review the owner has not requested.
Record optional review as "not selected," not "pending." If review is required,
identify its actual scope and supported route without inventing another authority.

When selected/required, a separate read-only verifier assesses actual delivery,
reports supported, failed, blocked or unverified findings and distinguishes
observations from inference. Creating the handoff is not completed verification.
The verifier does not patch, reseal, approve or start workloads in read-only mode.
Missing evidence is a finding, not permission to fabricate a run. Repairs and new
runs use authorized execution routes; update the handoff after repairs. Renew
affected separate review only when it remains selected/required. Never claim a
pre-repair review certifies changed delivery; retain applicable unaffected evidence.

## 6. Enforcement claims and reporting

Document the actual cooperative boundary: which provisioners, amendments, plan
validators and execution entry points enforce which revision, and which callers
are outside it. Source presence, a metadata marker or a native task Done status
does not prove enforcement. The skill cannot control Replit platform task
completion, prevent an editor from bypassing local scripts, or authenticate its own
records. Never claim platform-wide, tamper-proof or distributed enforcement.

Report definition delivery, installed integration, plan validity, guard delivery,
validation results and separate verification distinctly. Use the governing host's
completion states; under Unified this skill does not replace PASS/FAIL/BLOCKED/
INCOMPLETE or turn administrative closure into a successful test run.

### Planner announcement

Before publishing the plan, emit a concise announcement (not a prerequisite to
the provisioner's first heading or candidate inputs):

```text
[REGRESSION-GUARD] Classification: <applicable categories or not-applicable>. Guard: <covered — case/location | N/A — specific reason | self-satisfying — case/location | deferred — verified ref | excluded — reason>.
```

It is a searchable summary, not a substitute for the admitted declaration,
classification evidence or approval. Do not label excluded additive work
self-satisfying unless it actually delivers a test/check.
