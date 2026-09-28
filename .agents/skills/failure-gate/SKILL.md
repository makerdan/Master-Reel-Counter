---
name: failure-gate-v4
description: >-
  Apply task-ID-based validation authorization, failure ownership, and
  completion evidence to every project task. Discover host capabilities,
  preserve the approved tier, and block unsupported completion claims.
---

# Failure Gate v4

## Purpose and enforcement boundary

Separate the authorized tier, failure ownership, and applicable evidence for
completion. Installing this skill does not itself activate a runner, create
approval, dispatch a platform check, or make shell access tamper-proof.

- **Workflow mode:** checked project entry points and local completion checks
  prevent accidental bypass. An agent with unrestricted write/shell access can
  alter local code or records. Do not call this protected enforcement.
- **Protected mode:** an independently controlled service protects approvals,
  policy, execution evidence, and final acceptance from the task agent. Never
  claim it merely because local checks pass.

Read [implementation](reference/implementation.md) before changing enforcement
and [acceptance](reference/acceptance.md) when verifying it. The canonical source
is this tracked directory, not `.local/custom_skills/` or an archived ZIP.

## Discover host capabilities before use

Identify the host's task allocator or task service, namespace, plan format,
registered validation commands, plan guards, baseline storage, persistence,
approval authority, checked runner, result parser, recovery path, and every
completion route. Classify each as present, missing, or unavailable. Missing
optional memory/history/catalog is not a fabricated failure baseline or an
automatic setup blocker; missing required authorization or evidence is BLOCKED.
Examples in this skill are not portable dependencies. Do not install another
runner or second competing skill to compensate for a missing host capability.
Keep durable plans, policies, reports, and schemas outside `.local/`.

### Host adapter: this repository

This Node 20 project registers runtime tiers in `docs/validation/manifest.json`;
`.agents/skills/validation-tiers/tiers.json` is a packaged example contract,
not the authority for runtime changes. The existing scaffold and plan guards
are `scripts/new-plan.mjs`, `scripts/check-failure-gate.mjs`, and
`scripts/check-regression-guard.mjs`; the existing checked entry point is
`scripts/run-locked-tier.mjs`. Resource-aware execution is in
`scripts/run-tier.mjs` and `scripts/serial-lock.mjs`. Catalog authority, when
applicable, is `docs/validation/failure-baseline.json`. These are host
adaptations, not universal script requirements.

Use a durable transactional coordinator for task records, authorization,
audit, and run evidence; no `.local/tasks/` plan archive or caller-supplied
`TASK_PLAN_FILE` is a durable approval or independent task identity. The
platform's task reference is an external association, not a locally invented
approval. Project-local completion is procedural; platform-managed completion
remains BLOCKED absent verified platform-origin current task ID, exact approved
plan reference, a single checked invocation, run ID, and decision. Do not
modify `.replit` validation workflows or invent a fallback to evade that
boundary. The pre-edit bootstrap observation for task 907 is documented in
`docs/validation/task-907-bootstrap-observation.md`; it does not activate v4.

## Core invariants

- One authoritative active task ID in the project namespace has one
  authorized tier. Deny other tiers by default; do not create redundant
  per-tier allow/deny lists.
- The approved task record binds the canonical plan/reference and digest,
  tier-definition and permitted-parameter digests, policy version, and
  authorization version. A tier name alone is insufficient.
- A run binds the actual tested snapshot, relevant environment, actual
  arguments and results separately from task authorization. In-scope edits
  allow another run but invalidate affected prior evidence.
- A caller-supplied task ID, plan path, environment flag, or agent-authored
  `approved` field cannot establish identity or approval. Resolve the active
  assignment independently; reject another valid task's ID and plan.
- Policy inputs include the registry, runner, wrappers, checker, and completion
  adapter. A task's edits cannot authorize or validate that task under the
  changed policy without independent acceptance.
- Missing, malformed, stale, suspended, terminal, or conflicting
  authorization fails before commands start. Audit thresholds and commands
  cannot be weakened or waived to make a task pass.
- Tier authorization does not change because a test fails or a retry passes.
  A passing retry proves intermittency, never pre-existing provenance.

## Plan and activation

Use the host's real task-identity flow. An allocator may reserve a unique
committed ID before drafting. If the task service assigns IDs only after draft
creation, use a non-authorizing provisional reference; bind it to the
independently issued ID, exact approved plan/version, authorization, and audit
in one transaction. A provisional draft may run bounded guards/discovery but
cannot run a tier or complete a task. Do not invent IDs or approvals.

Read available project memory, recent evidence, and the catalog. Capture
approved safe pre-edit observations according to task risk; never run
production/destructive checks without appropriate authorization. Select the
lightest registered tier covering the task or the host's defined selection
policy when uncertain. Use the verified scaffold and run both plan guards
before activation. The host's Markdown semantic fields are:

```markdown
## Task identity
**Task ID:** <independently assigned ID, or non-authorizing draft reference>

## Pre-existing failures to ignore
None known at plan time. Treat new failures as potential regressions.
**Flaky-test rule:** A passing retry proves intermittency, not provenance.

## Task-local environment observations
None observed.

## Validation
**Command:** <registered tier>
**Why:** <specific coverage reason>
**Do not escalate:** Run only the authorized tier; request approval for changes.
```

An exact referenced catalog baseline must declare one ownership:
`**Ignored baseline:**` or `**Owned baseline repair:**`, with suite, test,
environment/variant and signature. Non-active, ambiguous, or expired records
cannot authorize ignores. Preserve Regression Guard sections where applicable.
Before first activation, revalidate guards, actual identity, exact plan and
version, and explicit owner approval or a previously approved deterministic
activation policy. Commit authorization and audit atomically; agent discretion
alone is not an activation policy. Do not rewrite legacy task history.

## Checked execution

Invoke only the host's checked entry point with the independently resolved
current task ID and approved plan reference; resolve the tier from the task
record. A requested tier mismatch is denied, not overridden. Verify active,
unsuspended state, current plan and policy digests, exact authorization version,
allowed parameters, baseline eligibility, resource/lease state, and namespace
before launch. Reject path traversal, symlink escapes, substituted tasks,
coverage-reducing argv/config/environment, and stale plans. The existing
`TASK_PLAN_FILE` adapter is not proof of identity. No `--allow-no-plan` ad-hoc
run can become task completion evidence.

Run all independent required steps even when an unrelated failure qualifies
for an ignore. If dependent steps are unsafe, report every unexecuted step by
name as **not reached**. Preserve raw nonzero exit status; separately assess
whether a complete run can be acceptable with ignored failures. Record
machine-readable complete step reports and discovery counts; a zero-test,
skipped, missing, or truncated report is not a pass. Coordinate writers or
use immutable snapshots; an unknown or changed tested input cannot support
completion. Do not interpolate task-controlled values into shell commands.

## Failure ownership and diagnostics

Classify in this order:

1. **Owned repair:** prove that its test still runs and its obligation was
   fixed. Expiry, reclassification, deletion, renaming, or skipping never
   discharges an owned repair.
2. **Explicit ignore:** only an exact eligible active, unexpired, unambiguous
   catalog match in the applicable environment may waive an unrelated test
   failure; retain the raw failing result.
3. **Unlisted test failure:** run exactly three authorized isolation retries
   after the initial failure where safe. Crashes, skips, missing results, and
   zero tests are not passes; don't retry until lucky. If isolation is unsafe,
   use a registered bounded equivalent or block classification.
4. **Pre-existing provenance:** require the same failure on a verified
   earlier, task-unaffected snapshot in an applicable environment **and**
   independent corroboration. Corroboration may be truly independent memory
   or task evidence, an applicable catalog record, or verified unchanged
   transitive/configuration/generated/dependency inputs. Copied references
   to the same observation count once; untouched direct files plus a
   narrative alone do not establish provenance.
5. Without sufficient evidence, report an unresolved potential regression
   and block completion. Do not automatically repair unrelated code or call
   uncertain causation proven.

Only host-registered test-kind failures can use test baseline rules. Typecheck,
lint, audit, smoke, and harness results retain their own required contracts.
Catalog promotion is separate reviewed maintenance, not an execution side
effect. A missing installed dependency, expired ignore, validation lock, or
concurrent-work conflict is an obstruction: name it and the affected unexecuted
steps without reclassifying it as a product failure or pass.

## Changes, recovery, and completion

A change to tier, validation obligations, baseline breadth, or governing
policy requires authorized approval evidence. At most one pending request
exists. Suspend work when current coverage is inadequate; otherwise the
existing tier remains the only authorized tier. Validate the proposed plan,
then atomically update plan/tier/parameter digests, authorization version,
request state and audit. Rejecting a request must not clear unrelated
suspension. Serialize transitions with active runs.

Record run leases with coordinator/process identity, heartbeat and version.
Poll timeout is neither process death nor cancellation. Confirm stop or
quarantine an unresolved run before replacement; never kill unrelated
services. Completion compares complete applicable full-tier evidence against
the final manifest under the same coordination boundary as its terminal
transition. Diagnostics and ad-hoc runs cannot substitute for required runs.
Recheck ignored baselines at completion; owned repairs survive expiry.
Failed/cancelled cleanup revokes permission after safe run handling without
requiring a passing validation. Retain audit and task tombstones.

Assessment is separate from raw status:

- `PASS`: all required obligations completed successfully;
- `ACCEPTABLE_WITH_IGNORED_FAILURES`: complete results include only eligible
  unrelated failures and all mandatory obligations are met;
- `FAIL`: observed regressions or unmet repairs/required product checks;
- `BLOCKED`: missing authorization, evidence, required capability or environment;
- `INCOMPLETE`: unfinished or untrustworthy execution/results.

Report task ID, authorized tier, run IDs, tested snapshot, raw results,
assessment, evidence for ownership, obstruction, every not-reached check,
enforcement mode, and limitations. Every locally controlled success route
must consult the same decision; uncontrolled platform routes remain disclosed
bypasses, not enforced controls.

### Separate task and completion validation reports

Keep two independent report entries. A task-tier result is not the result of
platform-managed completion validation, and neither result may be copied into
or used as evidence for the other.

**Task-validation report**

- Record the trusted task ID, exact approved plan reference/version, authorized
  registered tier and selected command, run ID, tested snapshot, and relevant
  environment.
- Record each required step's raw status/result and complete report reference,
  including named **not reached** steps; then record the overall raw status and
  the separate assessment.

**Platform-managed completion-validation report**

- Record dispatch state as `NOT REACHED`, `STARTED`, `COMPLETED`, or `UNKNOWN`.
  Explain why dispatch was not reached; if it started but has no trustworthy
  final result, report the raw result as incomplete and assess it as
  `INCOMPLETE`, rather than treating a timeout as cancellation or success.
- Record the completion check's actual selected command/tier, run ID, raw
  status/result, and separate assessment only when supplied by the platform.
  If a field or result was not supplied, say so; do not infer it from task-tier
  validation.
- State whether trusted task identity, the exact approved plan reference, the
  same active task lock, and a single checked dispatch resolving the same
  authorized tier were verified. Assess a missing or unverified handoff as
  `BLOCKED`.
- Assess an unsupported broader dispatch as `BLOCKED`, not an automatic
  escalation exemption. Its raw result cannot replace the task-tier result or
  count as authorized evidence. Keep raw status/result distinct from the
  assessment in this entry too.

Managed completion is supported only with actual cross-boundary evidence:
the platform provides the authoritative active task ID and exact approved
plan reference, dispatches exactly once through the checked task-validation
entry point, and accepts its result. A local launcher test cannot prove the
platform made that invocation. If the handoff is missing or unverified,
report managed completion **BLOCKED**, not protected or successful. Broader
completion checks require separate explicit authorization; unsupported broader
dispatch must be assessed **BLOCKED** and cannot be treated as an automatic
exemption from the task's authorized tier.