# Failure Gate v4 reinstallation status

This is the current project-local status. The [approved design](../superpowers/specs/2026-09-28-failure-gate-v4-local-reinstallation-design.md)
defines the intended workflow. Earlier [capability](failure-gate-capabilities.md)
and [cutover](failure-gate-v4-cutover-acceptance.md) records describe prior
attempts, not current authorization.

## Installed and verified

- The attached ZIP's four files are installed without edits at
  `.agents/skills/failure-gate-v4/`; the old active
  `.agents/skills/failure-gate/` source is retired. The generated download
  `artifacts/bathyscan/public/failure-gate-skill.zip` has the same four entries.
  The package parity check compares every entry to its canonical source.
- The runtime tier registry remains `docs/validation/manifest.json` with
  `test-fast`, `test-standard`, `test-standard-plus`, and `test-heavy`. Its
  registered commands and audit threshold were not changed.
- The local SQLite coordinator's task-to-tier authorization is singular.
  Per-tier `ALLOWED`/`NOT ALLOWED` authorization is derived from that record
  and the registry, with audited snapshots on activation and changes. The
  displayed execution readiness is separate: an authorized tier is not a
  claim that policy, environment, plan, reviewer, or report preflight passed.
  Strict plan guards require the allocated local ID, the selected tier, and
  a qualifying Regression Guard. A non-material N/A requires an explicit
  `**Materiality:** non-material` field in `## Task identity` and a reason.
- The project CLI no longer offers a platform-managed completion operation.
  Project code does not dispatch or depend on a platform completion result.
  Direct package tier commands remain diagnostics, not ordinary task evidence.
- The local completion implementation now uses a cooperative OS file lock on
  `.failure-gate-state/input-writers.lock` (excluded from evidence inputs).
  The process retains the locked descriptor through final manifest reading,
  evidence assessment, and the synchronous coordinator transaction. The
  coordinator verifies actual in-process ownership instead of accepting a
  callback's `writerCoordinationHeld` assertion. Plan creation, plan-guard
  stub writes, and Failure Gate archive replacement acquire that same lock.
  A concurrent locked writer is proven to delay completion until its change
  can be detected by the final manifest check.

## Bootstrap validation

The user separately approved the exact reinstallation [bootstrap
plan](plans/failure-gate-v4-reinstallation-bootstrap.md) and **only**
`test-standard`. The [authorization record](failure-gate-v4-bootstrap-authorization.md)
states the decision's provenance and limits. The checked launcher accepts
only that digest-pinned plan and tier, then uses the existing strict guards
and resource-locked registered runner. It is not an ordinary task dispatcher.

The first two attempts stopped at `failure-gate-contract` with test fixture
failures and did not reach later steps. After those fixtures were repaired,
the subsequent checked `test-standard` run exited **0**: all **10 registered
steps passed**, including the Failure Gate contract, four-file package
parity, and manifest parity. No other tier was run for this bootstrap.
These results validate the bounded installation, **not** an ordinary local-ID
run or terminal decision. The later tracked-review adapter was not part of
that bootstrap run; its focused tests are diagnostic, not another approved
bootstrap tier.

## Ordinary local-ID cutover: BLOCKED

The project now has a tracked record location at
`docs/validation/reviews/`, a designated-reviewer
roster at `docs/validation/reviewers.json`, and a default coordinator check
for an exact recorded human decision. It reads roster and record from one
committed Git revision, verifies their working projections,
reviewer designation, real record path, action, full subject digest, and
explicit task, plan/version/digest, tier-definition/parameter, policy, and
authorization-version scope. The coordinator retains the used record digest
and source commit
with its audited decision. Focused fixture tests cover missing and altered
records, mismatched scope, and replay. The requesting human designated
themselves under the project-local ID `reviewer-primary`; see the
[designation record](reviewer-designation.md). **No actual task or policy
decision has been recorded.** A reviewer designation or review request is
not an approval.

The CLI still exposes only draft, review-request, status, and read-only
tier-status operations. It does not offer activation, assignment, ordinary
checked-run, or completion. No accepted runtime host-control adapter or
verified *complete* writer inventory is installed. The known script writers
above cooperate, but direct editor/shell/Git edits, tests writing source files,
build output, and other project-specific generators do not use this boundary.
The lock is therefore not a claim of stable inputs against every writer;
an uncoordinated edit can still intervene during a final check. The local
coordinator refuses completion without its actual lock, but this alone cannot
enable ordinary completion. Until the remaining writers are covered or an
isolated immutable final input is verified, and the separate reviewer and
host-control requirements are satisfied, no local-ID checked run or
terminal decision can be demonstrated; live cutover stays **BLOCKED**.
Do not manufacture a reviewer reference or substitute a caller-written
approval flag, ad-hoc tier result, fixture test, or bootstrap pass.

The project-local workflow is cooperative, not tamper-proof: people with
shell/write access can bypass or modify its local files. None of these
records controls Replit's task board. Historical task records and unrelated
task work were not reauthorized by the reinstallation.
## Mobile photo handoff (#922): prepared, NOT AUTHORIZED

The human requester approved using the existing photo-handoff plan as the
source for an owner-reviewed per-task request. A **draft** local ID,
`master-reel-counter:dbb04932-e28e-463c-837c-8c7a87bcf4fb`, is associated
with platform task #922 in this workspace's ignored `.failure-gate-state/`
coordinator. The tracked candidate plan is
[`plans/mobile-photo-handoff-922.md`](plans/mobile-photo-handoff-922.md)
(version 1, SHA-256
`97fa823a4c8b49e3ab40e151b46dd5158939d807f1db101238bab5a7bf4c30e2`).
It passed the strict plan and Regression Guard checks. Its only requested tier
is `test-heavy`, but **all four tiers currently report NOT ALLOWED** for this
draft. The platform association does not bind an isolated task agent or
authorize that agent to run a tier.

No reviewer-authored, committed decision binds this exact local ID, plan,
tier, parameters, policy, and authorization version. The checked CLI has no
accepted ordinary activation/assignment/run route or accepted runtime host
control. The requester's instruction in chat and the agent-prepared plan do
not substitute for those capabilities or a separate reviewer decision. Do
not claim approval is available, run `test-heavy` as checked task evidence,
or make a terminal decision until the missing controls are installed and
verified. Before reuse, verify the local draft still exists: ignored SQLite
state is not shared with isolated task-agent workspaces.
