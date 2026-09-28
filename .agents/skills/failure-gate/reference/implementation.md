# Failure Gate v4 — installation reference

This document adapts the user-supplied v4 implementation contract to this
repository; it is not a claim of installed or activated capabilities. The
approved source ZIP is identified in
`docs/validation/task-907-bootstrap-observation.md`. The core skill remains
the authority for operation. Do not edit `.local/custom_skills/`.

## Host map and migration

| Concept | This host |
|---|---|
| Runtime tiers | `docs/validation/manifest.json`, including commands, resources and budgets |
| Packaged tier example | `.agents/skills/validation-tiers/tiers.json`; not the runtime registry |
| Plan scaffold and lint | `scripts/new-plan.mjs`, `scripts/check-failure-gate.mjs`, `scripts/check-regression-guard.mjs` |
| Existing checked entry | `scripts/run-locked-tier.mjs` into `scripts/run-tier.mjs` |
| Baselines | `docs/validation/failure-baseline.json` |
| Resource coordination | `scripts/serial-lock.mjs` |
| Completion | Project-local checker required; platform dispatch not verified |

Prior policy remains the authority for bootstrap task 907 until independent
acceptance of the new policy and actual cutover. Do not alter historic
authorization or create self-signed approval records. Workflow mode is
cooperative and does not prevent arbitrary shell execution.

## Coordinator and identity

Use a durable transactional store outside `.local/`, not a mutable JSON
read-modify-write loop. Record namespace, independent task ID, status, plan
reference and canonical content/digest/version, one active tier and its
effective definition digest, parameter digest, policy version, authorization
version, suspension, pending request, and audit history. Transactions commit
state and audit together; audit failure rolls back permission. Unique IDs
survive restarts and terminal transitions. Local state is limited to its
workspace; it is not a shared allocator across clones.

Existing platform task IDs may be associated externally but do not grant
authorization. If the task service assigns an ID after drafting, a provisional
reference can use only bounded planning guards and discovery. Verify the
service-issued ID and exact approved plan/version before atomic activation.
An agent-authored actor, approval flag, or current-task environment variable
is insufficient to prove independent assignment. Failed validations keep
tasks active for repairs; completed, cancelled and failed terminal IDs cannot
reopen. A changed governing runner, wrapper, checker, registry, or dispatch
requires independent acceptance before that task can validate under it.

## Plans and approvals

Separate non-authorizing discovery from active required-tier runs. Guards
check required baseline and validation fields, registered tier, applicability
and regression protections; use a verified scaffold. Initial activation
requires owner-approved plan evidence or a previously approved deterministic
selection policy. Amendments, tier moves, removal of obligations, and
baseline widening require a separate approved change. Exactly one pending
request is allowed; use compare-and-swap, idempotency and transactional audit.
An interrupted plan projection leaves execution suspended until matched to
committed canonical content. Rejection preserves independent suspension.

## Execution and evidence

Resolve the independently assigned current task before interpreting a caller
plan/ID. Reject namespace mismatch, different valid task, path escapes,
stale plan or tier/parameter digests, unsupported configuration and diagnostic
selectors before command launch. The runtime manifest owns the effective
commands. Keep raw results for every step; independent steps should continue
after eligible ignored test failures. A dependency may stop unsafe work, but
the run must then be incomplete with named not-reached steps.

Run snapshots must cover tracked and relevant untracked/generated inputs,
dependency lockfiles/runtime identity, config, fixtures and migrations; capture
environment identities without revealing secrets. Logs/reports are excluded
from executable inputs, but an agent's assertion of irrelevance is
insufficient. Coordinate writers or use isolated immutable contents: hashes
before/after an uncoordinated run alone cannot rule out a mid-run edit. Compare
the final manifest under the same coordination boundary as terminal release.
Actual report digests and test discovery counts are required for acceptance.

Keep purposes distinct: planning, discovery, full required tier, bounded
isolation retry, earlier-snapshot comparison, optional separately approved
completion execution, and maintenance/bootstrap. Diagnostics never fulfill a
full-tier obligation. No coverage-reducing argv/environment or shell
interpolation of task-controlled strings is permitted.

## Failure policy and recovery

An ignored baseline requires exact suite/test/signature, explicit
environment/variant, unambiguous matching, active lifecycle, reviewer and
unexpired review date. Eligibility is rechecked at completion. An owned
repair survives catalog expiry and requires positive evidence of the
proving test. Three authorized isolation retries after an initial unlisted
failure establish intermittency only; pre-existing provenance also needs a
verified earlier unaffected snapshot and independent corroboration.
Missing prerequisites, locks and conflicting work are named obstructions,
not fictitious passing checks.

Leases need owner identity, heartbeat and authorization version. Poll timeout
does not prove cancellation; confirm termination or quarantine before
replacement. Transition and release must coordinate with active leases.
Terminal failed/cancelled cleanup needs safe run handling, not passing tests.
Retain terminal tombstones, audit, and restart/backups. This local history is
not a protected attestation.

## Managed completion boundary

Project-local launcher tests establish local behavior only. Platform-managed
task completion needs a real platform-origin active task ID and exact approved
plan reference, one call into the existing checked validation entry point,
resulting run ID and acceptance decision. If the platform cannot supply both,
managed completion remains **BLOCKED**. The platform-owned `.replit` workflow
configuration must not be changed or replaced with an unlocked sweep/fallback
to simulate this cross-boundary dispatch.