# Failure Gate v4 — project-local implementation contract

Read this when installing or changing the project-local workflow. These are
interfaces and requirements to implement, not claims that commands already exist.

## Scope and migration

Inventory the host before editing. Reuse its existing build/validation tools,
project-local task lifecycle, baseline schema, and canonical instruction sources.
Do not install a second competing runner or weaken existing coverage.

## Host adaptation

The contract applies to web, mobile, desktop, CLI, libraries, embedded systems,
infrastructure, data pipelines, and documentation projects. Local tooling may
run in the developer environment; it need not run inside the deployed application
or on the target device. Do not add a backend to a static app merely to host a gate.
These are project-local task records, not Replit Agent's platform task records.

Record these mappings before choosing implementation details:

| Contract concept | Host mapping |
|---|---|
| Project identity | Verified project-local namespace; Git is optional. |
| Canonical instructions | Host instruction sources; `.agents` where supported, never generated mirrors. |
| Task/plan | Durable project-local record and plan, with semantic fields and version/digest mapping. |
| Tier | Existing check group or an explicitly approved grouping of real available checks. |
| Execution | Host-language process runner or build tool with the project's real checks. |
| Evidence | Actual source/artifact snapshot, relevant environment identity, and trustworthy result parser. |
| Storage | Durable transactional coordinator suited to the host's concurrency and availability. |
| Approval/completion | Recorded human/policy decision and project-local completion checker. |

No Node.js, Python, shell syntax, operating system, SQL engine, package manager,
specific number/order of tiers, or cloud provider is mandatory. Use portable
process and path APIs appropriate to the chosen host. Version-control commits
are optional snapshot aids, not the definition of tested content.

If tiers are absent, installation may propose a minimal registry based on actual
host checks. Register it only under approved installation policy; do not fabricate
smoke/standard/heavy commands. If no automated tests exist, identify real build,
lint, manual, or domain checks. A manual-only tier must record its approved scope,
reviewer and actual evidence and be reported as manual validation, never automated
test success. Unsupported required checks remain blocked, not silently no-op.

Optional memory, historical tasks, catalogs, and companion skills may be absent.
Do not invent their contents or make them installation prerequisites. Without a
baseline catalog there are no catalog-based ignores. Without earlier evidence,
unlisted failures cannot be proven pre-existing.

Pre-edit observations and retries use the host's approved risk policy. Device,
production, destructive migration, paid-service, and other side-effectful checks
need explicit safety constraints and authorization. Do not assume isolated tests
can safely replay an operation merely because the runner supports retries.

Create a capability manifest covering allocator, plan guards, planning discovery,
activation policy, tier registry, checked runner, diagnostics, results parser,
recorded approval route, local completion checker, persistence, and recovery.
State the verified interface for each. Do not claim integration with a platform
task lifecycle that cannot be demonstrated.

Illustrative source layout for a file-based host using `.agents`; none of these
paths is a universal runtime dependency. Map to existing host equivalents:

```text
.agents/skills/failure-gate-v4/
plans/<task-id>.md
docs/validation/failure-gate-policy.md
docs/validation/tier-registry.json
docs/validation/failure-baseline.json
scripts/failure-gate/                  # host-language implementation
tests/failure-gate/
```

Live registry storage is not a committed mutable JSON document. Use an appropriate
transactional store with durable persistence outside `.local/`; keep schema,
migrations, fixtures, policy, and implementation tracked. Document storage backup,
restart behavior, access permissions, and project-local scope. Never merge live
database binaries from task branches or assume a local database coordinates clones.

Install via a separately approved bootstrap operation using existing validation
commands. Bootstrap is limited to implementing the gate, logs its actual checks,
and cannot authorize ordinary tasks. Verify acceptance tests before enabling
enforcement. Migrate existing plans explicitly; do not invent historical IDs or
approval events. Pause affected work or let it finish under a recorded prior
policy. Activation must not leave old and new authorities competing.

## Authority and approvals

This workflow is a cooperative project control. A user approval may be recorded
with a real conversation/task reference and exact approved change. Label its
verification accurately: locally recorded approval is not cryptographic identity.
Never fabricate an approver or use an example reference in real state.

Initial activation may use either explicit approved-plan evidence or a deterministic
owner-approved policy mapping task scope to tiers. Store the policy version and
decision. An agent's discretion alone is not a standing activation policy.

Tier changes, obligation removal, baseline widening, and policy changes require
a recorded authorized approval. When that route is unavailable, stop the mutation.
A caller-written `approved: true`, actor name, or command flag alone is not an
approval record. These checks are procedural: a local record cannot authenticate
the human or resist deliberate edits by an agent with write access.
The skill does not install a human review service or catalog-maintenance route.
If no approved local route exists for either action, leave it blocked rather
than constructing a draft approval or silently widening baseline authority.

The checked runner records the actual invocation, local task ID, plan and policy
versions, tier digest, snapshot, raw results, and artifact references. The
project-local checker cross-checks this record and rejects an ad-hoc run or a
manually supplied `PASS` label as required-tier evidence. It cannot prove result
authenticity against someone able to alter the runner, results, or checker.

Resolve supplied IDs and plans against the project-local task record and
namespace; another valid local task's plan is not interchangeable. Never infer
a task from the newest plan. This does not establish which Replit Agent task is
currently active or control its platform completion.

## Identity and single-source authorization

Reserve monotonically increasing local display IDs such as `TASK-001042` in a
transaction in one project-local namespace. Only expose a reservation after
commit. Keep permanent tombstones; committed IDs are never reused after
abandonment or terminal states. Import existing IDs with uniqueness checks.
Do not claim repository-wide uniqueness or coordination across independent
workspaces. Namespace plus UUID identifiers are an alternative to local
sequential display IDs.

One task row is authoritative:

```json
{
  "taskId": "TASK-001042",
  "projectNamespace": "configured-local-namespace",
  "status": "active",
  "planReference": "<host-plan-path-or-record-id>",
  "planVersion": 1,
  "planDigest": "<canonical-plan-content-digest>",
  "authorizedTier": "<registered-tier>",
  "tierDefinitionDigest": "<digest>",
  "parametersDigest": "<digest>",
  "policyVersion": "4.0",
  "authorizationVersion": 1,
  "suspended": false,
  "pendingChangeId": null
}
```

The example is not live authorization. Constrain enums and fields with runtime
validation. Preserve original tier and transitions in history, not duplicate live
allow/deny lists. Absence of an active authorized tier means deny.

States: `draft`, `active`, `completed`, `failed`, `cancelled`.
Only active, unsuspended tasks may start required-tier runs. A pending change
does not authorize its target. Terminal records have no current authorized tier.
Never reopen terminal IDs; create a new linked task.
An unsuccessful validation run does not automatically terminate its task: keep
the task active for authorized investigation and repair. Terminal failure is a
separate explicit lifecycle decision.

## Transactional lifecycle

Use transactional storage with uniqueness constraints and compare-and-swap on
authorization versions. SQLite can suit a single supported local coordinator;
multi-instance access needs storage/concurrency semantics appropriate to the host.
Do not rely on a JSON read-modify-write loop or network-filesystem assumptions.

Activation, amendments, tier moves, recovery, and terminal release commit their
new state AND audit event in the same transaction. On audit-write failure, roll
back the mutation. Validate proposed plan contents before publishing their version.

Store the canonical approved plan content/digest with the transaction. A tracked
plan file is the working projection: execution must match its version and
semantic content to the approved record.
If file projection and database commit cannot be atomic, execution stays suspended
until projection verification succeeds. An interrupted projection never creates
permission to run a partially applied plan.

Compare-and-swap prevents stale or duplicate approvals from applying twice.
Use idempotency keys for retried operations. Do not silently heal corruption.
An authorized repair identifies the prior state, intended state, reason, evidence,
and actor; it cannot secretly change tiers or authorize terminal tasks.

## Separate authorization from run snapshots

Authorization binds approved obligations, not a frozen pre-edit code snapshot.
Each run captures a separate content manifest representing the files actually
executed. Relevant changes invalidate prior results, not permission to rerun
the same authorized tier within scope.

Include tracked files, relevant untracked/generated inputs, dependency lockfiles
and actual dependency/runtime identity, configuration, fixtures, and migration
state. Do not record secrets; record safe versions or non-secret identifiers.
Document exclusions such as logs and report outputs
so recording a run does not invalidate itself.

Prefer an isolated immutable run snapshot. For shared-worktree execution, coordinate
all writers and verify contents before/after the run; hashes alone cannot rule out
mid-run edits that were reverted. Without isolation or effective coordination,
report snapshot integrity as unknown and reject completion evidence.

Record external service/DB fixture identity and reset policy when tests depend on
them. A code hash does not establish external-state equivalence. Unknown relevant
environment equivalence blocks provenance claims.

Completion compares the required run against the final input manifest. Default to
rerunning on changes. A narrow documented policy may ignore proven irrelevant
changes; it must not accept the agent's unsupported assertion of irrelevance.
Coordinate the final manifest check and terminal transition with the same writer
and authorization locks, so an edit cannot slip between acceptance and completion.

## Tier registry and checked execution

Use one registry for scaffold, guards, runner, and completion checker. Each tier
defines argv-based commands, root/working directory, required steps, dependencies,
permitted parameters/environment, diagnostics, timeouts, reports, discovery
expectations, and coverage. Pin its canonical digest.

Treat the registry, runner, checker, and command wrappers as governing policy.
Compare the actual versions executed, including indirect script entry points,
with the approved local versions. If they changed, require separate approval
before accepting a run for the same task. This detects unapproved changes when
the checked tooling is used; an agent can still bypass or edit local checks.

Abstract interface to implement in the host's native tooling, not a command to
copy into a shell:

```text
run(taskId, planReference, purpose = required_tier_validation)
  -> runId, rawResults, evidenceReferences
```

Adapt language and command to the host. Never recommend this command before it
exists and passes checks. Resolve the tier from the task record; if a requested
tier is supplied, reject any mismatch rather than overriding the record.

Before launch:

1. Resolve local project identity and plan reference. Reject traversal and
   escaping symlinks. Reject another task's plan and mismatched plan
   content/identity.
2. Validate active state, suspension, approval, version, tier digest, parameters,
   policy, referenced ignore eligibility, and absence of unresolved recovery.
   Expired records cannot authorize ignores but do not erase owned repair obligations.
3. Acquire a run lease against the current authorization version, atomically
   recording the run and its audit event. Coordinate with transition locks.
4. Capture the tested snapshot/environment and launch only approved argv.

Do not interpolate untrusted strings into a shell command. Validate diagnostic
selectors and neutralize coverage-reducing environment/config overrides without
blindly removing runtime variables the host needs. Validate report paths and bound
output; truncated/missing machine reports cannot substantiate acceptance.

Collect each required step's real status and reports. Continue independent steps
where safe even after an ignored failure; never conceal unexecuted obligations.
Return nonzero for raw failing runs; the completion checker separately records
whether policy accepts their accounted-for failures.

All project-local checked entry points delegate to this runner. Unmanaged
execution is not accepted by the local checker, but cannot be prevented.

## Planning, diagnostics, maintenance, and completion

Run purposes are explicit:

| Purpose | Authorization | Can satisfy required task validation? |
|---|---|---|
| Planning guards | Bounded pre-activation policy | No |
| Baseline discovery | Registered planning policy | No |
| Required tier | Active task authorization | Yes |
| Diagnostic retry | Current tier's diagnostic capability | No |
| Provenance comparison | Registered comparison capability | No |
| Completion execution | Separate explicit completion policy | Only its own obligation |
| Maintenance/bootstrap | Explicit bounded maintenance approval | No |

Planning guards operate on a reserved draft before activation, resolving the
bootstrap deadlock. They cannot invoke arbitrary tests. Baseline discovery is
similarly narrow and records the pre-edit snapshot without activating work.

Diagnostic retries remain subordinate to the current tier; they are not filtered
substitutes for full validation. Comparison runs use isolated verified earlier
contents without resetting the user's working tree or touching production data.

The project-local completion checker is required. Its result controls the local
workflow's completed status only. Replit Agent may perform its own checks and
move its platform task to Ready or Done without invoking this checker; do not
claim that a local test proves otherwise or modify platform-owned dispatch as
a workaround.

## Run evidence, baseline policy, and completion

Runs contain task/run IDs, purpose, authorization/plan/tier versions, snapshot and
environment identity, actual timestamps, per-step raw statuses, artifacts/digests,
discovery counts, and policy assessment. Preserve failures individually.

Baseline policy defines failure matching, permitted volatile-field normalization,
environment applicability, authoritative clock, expiry boundary, reviewer authority,
and renewal/revocation. Preserve meaningful assertion, exception, endpoint, variant,
and stack distinctions. Ambiguous matches fail closed.
If no verified project-local catalog-maintenance approval route exists, do not
promote new baselines; task-local evidence cannot create catalog authority.

Check ignore eligibility at planning, activation, launch, classification, and
completion. Default: expiry/revocation before completion invalidates the ignore;
request separate review rather than self-renewing it. Repair ownership survives
expiry. Historical/non-active records may corroborate but never directly authorize
an ignore. Promotion is separate maintenance, never an automatic task side effect.

The checker evaluates complete evidence, exact applicable baseline matches,
provenance, fixed owned obligations, and any required external completion results.
It cannot trust a run's agent-supplied `PASS` label. A procedural human review may
be needed for semantic provenance; record the reviewer and mode honestly.

All unknown statuses, missing results, or unaccounted failures block success.
Preserve raw exit statuses even when assessment is acceptable.

## Recovery and retention

Run leases include coordinator/process identity, start time, heartbeat, and version.
A timed-out poll or expired heartbeat does not prove process death. Confirm stop,
cancel safely, or quarantine unresolved runs before authorizing replacement.
Coordinate process groups carefully; never indiscriminately kill unrelated services.

Prevent authorization transitions racing with a launch or active run. Wait, safely
cancel, or suspend; do not retroactively make stale runs acceptable.
Terminal cleanup revokes active permission and retains tombstones/history.
Failure/cancellation cleanup does not require passing validation.

Audit mutations, denied launches, runs, classifications, approvals, recovery, and
completion. Sanitize agent-supplied text, bound logs, and exclude secrets.
Define retention/backups and access controls; never delete ID tombstones during
routine log pruning. Workflow-local logs are not tamper-evident evidence.