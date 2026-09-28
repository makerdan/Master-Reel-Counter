# Failure Gate v4 capability and cutover map

For the later cutover attempt and its current (still inactive) candidate,
see [cutover acceptance](failure-gate-v4-cutover-acceptance.md). The task 907
record below is historical bootstrap evidence, not current approval.

This tracks **verified pre-bootstrap interfaces** and the current **candidate**
modules, not an assertion that v4 is active. Task 907 is authorized to build the
candidate under prior policy; its implementation cannot accept its own policy.
See `task-907-bootstrap-observation.md` for the raw pre-edit failure and
`task-907-acceptance-outcomes.md` for category-by-category candidate test
evidence and remaining gaps. The canonical candidate contract is
`.agents/skills/failure-gate/SKILL.md`.

| Capability | Host interface | Bootstrap status |
|---|---|---|
| Runtime tier registry | `docs/validation/manifest.json` | Present; preserve registered steps, resources, timeouts, audit threshold |
| Packaged example tier contract | `.agents/skills/validation-tiers/tiers.json` | Present; not effective runtime registry |
| Plan scaffold and guards | `scripts/new-plan.mjs`, `scripts/check-failure-gate.mjs`, `scripts/check-regression-guard.mjs` | Existing prior-policy interfaces; candidate coordinator's `validatePlan` requires injected owner control, not a proved project-wide activation |
| Checked task entry | `scripts/run-locked-tier.mjs`, `scripts/run-tier.mjs`; candidate `scripts/lib/failure-gate/execution.mjs` | Legacy checked path and separate candidate local adapter; unapproved v4 CLI flags are blocked rather than falling back; no installed task-wide v4 dispatch |
| Resource coordination | `scripts/serial-lock.mjs` | Present; retain resource locks and recovery safety |
| Baseline catalog | `docs/validation/failure-baseline.json` | Present and empty; grants no ignores |
| Task identity | Platform task service assigns external task references; local coordinator reserves namespace UUIDs | `coordinator.mjs` fixture tests unique durable IDs and assigned-task substitution; external platform-to-local identity binding remains unavailable |
| Durable authorization and audit | `scripts/lib/failure-gate/coordinator.mjs` (SQLite with fixture root outside `.local/`) | Candidate implementation tested in separate-process fixture; no live coordinator approved or installed |
| Approved activation and tier changes | `Coordinator` requires injected `control.review` + `control.validatePlan`, compares exact digests | Candidate fixture tests approval, audit rollback, idempotency, one pending request; no independent production reviewer/activation |
| Run-bound snapshot/report | `evidence.mjs`, `execution.mjs`, `host.mjs`, `runtime-tiers.mjs` | Candidate `createRuntimeHost` derives approved argv/limits from the unchanged manifest, captures bounded Node machine summaries; unsupported heavy browser/nested-report adapters deny the tier before launch instead of reducing coverage |
| Diagnostics and failure assessment | `assessment.mjs`, `Coordinator.startRun`, `CheckedExecution.retryThree` and `compareEarlier` | Candidate fixture tests exact matching, three retries, bounded isolated earlier-snapshot comparison and provenance; no production earlier-snapshot owner/reviewer service verified |
| Completion checker | `CheckedExecution.assessCompletion` and `terminate` under injected writer lock | Candidate fixture recomputes inside terminal transaction under writer boundary; independent control covering all project writers and external success routes unavailable |
| Platform-managed completion dispatch | Platform-origin active ID and exact approved plan to one checked invocation | **BLOCKED**: no verified cross-boundary handoff; `.replit` is platform-owned and out of scope |
| Protected enforcement | Independent service outside task-writable policy/state | Unavailable; no protected-mode claim |

## Every known success route and validation provenance

The candidate local terminal transition invokes its checker only under an
injected writer lock; its fixtures do not demonstrate that the project task
service consults it. External task UI/API/automation routes are not shown to
consult it; treat them as **uncontrolled workflow bypasses**, not enforced
success gates. A local launcher test alone cannot establish that the platform
made a checked completion call. Do not add a direct tier sweep or edit `.replit`
to mask this limitation.

The manifest and packaged tier registry are unchanged from the pre-edit
revision `d7f278e44bb734f139a0f81d054bb29950fbd66a`. The existing
registered `test-standard` `failure-gate-contract` entry imports all three
candidate `failure-gate-v4-*.test.mjs` fixture modules. The final authorized
checked `test-standard` run exited **0**, with all **10 required steps passed**;
the Failure Gate contract had **72/72 passed, zero skipped**. A redacted
console record is `docs/validation/task-907-standard.log` (SHA-256
`49d0069a4ff7ab45da2be62f6dd1d8356d561447fe5c7c291087eb91b6385372`).
This verifies the prior-policy bootstrap tier, **not** a v4 active-task
run, v4 run ID/final snapshot, independent policy acceptance, or platform
completion. Do not infer those from the log.

## Bootstrap and cutover

1. Record v4 source identity and prior policy, then run the checked
   `test-standard` bootstrap tier; preserve raw statuses and obstructions.
   Initial run was not a pass; it encountered the absent legacy runtime mirror.
   User approved proceeding with implementation despite that failed baseline.
2. Build candidate code and executable acceptance under the prior governing
   policy. Candidate parity must compare canonical tracked sources and
   published archive only, never a platform-owned disposable mirror. Changing
   this prior gate is not itself independent acceptance of new enforcement.
3. Post-change prior-policy `test-standard` passed; independently approve
   policy changes before cutting over task authorization. Legacy plans/history cannot be
   retroactively approved or fabricated.
4. Document the separate platform handoff requirement. Even with passing
   local checks, managed completion stays BLOCKED until genuine dispatch
   evidence binds active task, plan, one invocation, run and decision.

This capability inventory must be reconciled against **actual executable
results** before any activation claim. A pending implementation is not
automatically upgraded to present by adding files or documentation.