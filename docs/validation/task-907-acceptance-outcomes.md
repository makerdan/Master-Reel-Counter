# Task 907 — Failure Gate v4 acceptance outcomes

This maps the supplied v4 `reference/acceptance.md` categories to **current
candidate code and named executable fixture tests**. A named test proves only
the exercised local behavior, not production integration, trusted platform
dispatch, protected attestation, or an independently approved cutover.

## Bootstrap and run record

- Prior-policy pre-edit revision: `d7f278e44bb734f139a0f81d054bb29950fbd66a`.
  The existing `docs/validation/manifest.json` and packaged
  `.agents/skills/validation-tiers/tiers.json` are unchanged. The checked
  `test-standard` bootstrap run failed at `clerk-release-contract` with raw
  exit **1** and eight failures caused by a missing legacy runtime mirror;
  later required steps were **not reached**. Preserve that raw observation
  in `task-907-bootstrap-observation.md`. It is not a catalog ignore.
- The final authorized checked post-change `test-standard` run exited **0**:
  all **10 required steps passed**; `failure-gate-contract` reported
  **72/72 tests passed, zero skipped**; parity and manifest parity passed.
  The retained **redacted** console record is
  `docs/validation/task-907-standard.log`, SHA-256
  `49d0069a4ff7ab45da2be62f6dd1d8356d561447fe5c7c291087eb91b6385372`.
  This is prior-policy bootstrap validation, **not** a v4 active-task run
  or operational approval. No v4 run ID or final-input snapshot identity
  is available to claim.
- The existing registered `failure-gate-contract` step is `node --test
  scripts/__tests__/failure-gate.test.mjs`; that file imports
  `failure-gate-v4-coordinator.test.mjs`,
  `failure-gate-v4-evidence.test.mjs`, and
  `failure-gate-v4-execution.test.mjs`. These are local contract tests, not
  the actual platform-managed completion handoff.

Here, **fixture coverage** means an executable named local case exists;
**gap** means required host integration or acceptance proof is unavailable;
**blocked** means a required external authority cannot be demonstrated.
No entry below asserts that the operational v4 gate is active.

| Acceptance category | Candidate implementation and named test evidence | Outcome / limitation |
|---|---|---|
| Portability, optional memory/history/catalog | `evidence.mjs`, `assessment.mjs`; evidence: “portable fixture host snapshots include generated/untracked/dependency bytes without git or optional catalogs” | Fixture coverage; host adaptation remains Node-specific by design |
| No existing tiers/tests and manual-only discovery | `execution.mjs` requires registered nonempty steps and test report/discovery policy; evidence: “missing/skipped/zero/duplicate/truncated reports cannot pass or be ignored” | **Gap:** no manual-only or tierless host installation fixture |
| Safe discovery and side-effectful retries | `execution.mjs` requires `safe` registered diagnostic; execution: “three registered isolation attempts are durable and a fourth is denied” | Fixture coverage for selector; **gap:** no real production/hardware side-effect adapter or approved equivalent diagnostic |
| Allocator/restart/tombstones | `coordinator.mjs`; coordinator: “coordinator retains namespace-scoped UUIDs across restart and permanent terminal tombstones”; “real independent processes commit unique reservations without lost updates” | Fixture coverage, local namespace only |
| Service-assigned ID/provisional draft binding | `Coordinator.reserve` associates an optional external reference but allocates its own local UUID; coordinator: “activation requires independently resolved exact approval, guards, projection and policy” | **Gap:** no verified service-issued ID mapping or provisional-to-platform-ID atomic binding |
| Namespace isolation | `coordinator.mjs`; coordinator: “coordinator retains namespace-scoped UUIDs across restart and permanent terminal tombstones” | Fixture coverage for mismatch; no cross-workspace shared authority |
| Bootstrap planning guards before activation | Existing `new-plan.mjs` + both plan guards; coordinator: “activation requires independently resolved exact approval, guards, projection and policy” | Candidate planning path; **gap:** no integrated bounded pre-activation discovery linked to platform ID |
| Activation/approval provenance | `Coordinator.activate` needs injected control; coordinator: “activation requires independently resolved exact approval, guards, projection and policy”; execution: “concrete adapter readiness declaration grants no activation or approval” | Fixture coverage; real owner approval adapter/activation unavailable |
| Tier lock, defaults, denied arguments | `Coordinator.startRun`, `CheckedExecution.preflight`; coordinator: “launch denies substitution, stale policy, selectors and escaping projections before leases”; execution: “task, tier, plan, override and policy substitutions launch nothing” | Fixture coverage; not active on ordinary task routes |
| Path and task substitution | `execution.projectFile` and coordinator assignment; execution: “a symlink plan cannot pass path confinement”; coordinator: “launch denies substitution, stale policy, selectors and escaping projections before leases” | Fixture coverage; independent current platform task context unavailable |
| Policy edits and self-authorization | `host.policyDeclaration`, `execution.policyDigest`; execution: “task, tier, plan, override and policy substitutions launch nothing”; “concrete adapter readiness declaration grants no activation or approval” | Fixture coverage; independent production policy acceptance unavailable |
| Environment/selector override denial | `execution.checkedEnvironment`; execution: “environment policy preserves approved runtime values, excludes unknown selectors”; “task, tier, plan, override and policy substitutions launch nothing” | Fixture coverage; no live manifest-wide permitted-env policy installed |
| Workflow/protected modes | `candidateStatus`, `managedCompletion`; execution: “unavailable production control and platform dispatch never fall back to legacy” | Workflow candidate only; protected enforcement unavailable |
| Evidence forgery and copied run IDs | `assessRun`, report digest and coordinator IDs; evidence: “assessment ignores caller PASS and binds purpose, identity, snapshot, and version”; execution: “concrete local adapter isolates, resource-locks, verifies artifacts and recomputes completion” | Fixture coverage, **not** protected evidence/attestation |
| Completion routes/ad-hoc denial | `Coordinator.terminate`, `CheckedExecution.completion`; coordinator: “completion adapter executes inside transaction, rejects labels and preserves failure cleanup”; “diagnostics consume exactly three atomic retry slots, cannot reset by selector or satisfy completion” | Candidate local route; external task UI/API/automation routes uncontrolled |
| Approval change and rejection | `Coordinator.requestChange/resolveChange`; coordinator: “amendments are CAS and one pending only; rejection cannot erase suspension”; “approved amendment advances all digests atomically and invalidates earlier versions” | Fixture coverage; requires independently accepted real review |
| Audit/crash/projection safety | SQLite transaction + checked projection; coordinator: “audit failure rolls back task state, idempotency and assignment”; “real process crash rolls back transaction and exposes no partial reservation”; “activation requires independently resolved exact approval, guards, projection and policy” | Fixture coverage; no installed migration or live backup/recovery acceptance |
| Transition races/lease recovery | `Coordinator.startRun/heartbeat/recover`; coordinator: “launch leases serialize transitions; heartbeat CAS and recovery never interpret timeout as death”; “real launch versus suspension race has only one consistent winner” | Fixture coverage; production process-stop attestation adapter unavailable |
| Snapshot, untracked/generated/dependency inputs | `evidence.createSnapshot/inputManifest`; evidence: “portable fixture host snapshots include generated/untracked/dependency bytes without git or optional catalogs”; “safe internal dependency symlinks become independent files; escaping links are blocked” | Fixture coverage; external-state applicability needs host-supplied identity |
| Output exclusions and invalidation | `evidence.inputManifest`; evidence: “output exclusions do not invalidate evidence but config and dependency edits do” | Fixture coverage |
| Isolation/concurrent edits | `evidence.createSnapshot`; evidence: “snapshot destinations cannot overwrite worktree or use existing directories”; execution: “unknown snapshot integrity leaves lease unresolved, preventing replacement” | Fixture coverage; real final writer control must be independently provided |
| Provenance uncontaminated earlier snapshot | `CheckedExecution.compareEarlier`, `Coordinator.startRun`; execution: “registered earlier comparison is isolated, bounded and not completion evidence”; coordinator: “provenance comparison binds verified earlier snapshot and environment with bounded atomic attempts”; evidence: “provenance needs exactly three real retries and independent earlier evidence” | Fixture coverage of real isolated comparison with attempt limits; independent production earlier-source/reviewer unavailable |
| Retry bound and alternate diagnostics | `Coordinator.startRun`, `CheckedExecution.retryThree`; coordinator: “diagnostics consume exactly three atomic retry slots, cannot reset by selector or satisfy completion”; execution: “three registered isolation attempts are durable and a fourth is denied” | Fixture coverage; unsupported isolation blocks, no production equivalent |
| Independent corroboration | `assessment.assessProvenance`; evidence: “provenance needs exactly three real retries and independent earlier evidence” | Fixture coverage; real independently sourced review adapter unavailable |
| Exact matching and lifecycle | `assessment.matchingBaseline`; evidence: “exact authorized ignores preserve raw failures and expire at completion” | Fixture coverage for variant/environment/reviewer/expiry/ambiguity; catalog remains empty |
| Owned repair obligation | `assessment.assessRun`; evidence: “owned repairs survive catalog expiry, deletion, skip, and unapproved identity changes” | Fixture coverage; no actual owned catalog record in current empty catalog |
| Non-test failures and audit integrity | `assessment.assessRun`; evidence: “audit, typecheck, lint, smoke and harness failures never use test baselines”; existing heavy audit command unchanged | Fixture coverage; no claim of a heavy run |
| Obstructions and incomplete work | `execution.run`, `assessment.assessRun`; execution: “independent steps continue after a raw failure; unsafe dependents are named”; “unknown snapshot integrity leaves lease unresolved, preventing replacement” | Fixture coverage; bootstrap missing mirror is a recorded obstruction, not a pass |
| Complete reports and raw/assessed outcomes | `execution.readStepReport`, `assessRun`, `runtime-tiers.adaptRuntimeTiers/parseRuntimeReport`; execution: “actual runtime mapping preserves all argv, tiers, resource budgets and audit thresholds”; “Node machine-summary capture rejects partial npm chains, truncation and zero discovery”; “actual Node report capture runs unchanged argv and excludes raw secrets from evidence”; evidence: “missing/skipped/zero/duplicate/truncated reports cannot pass or be ignored”; “exact authorized ignores preserve raw failures and expire at completion” | Candidate maps unchanged actual manifest to report adapters; unsupported heavy `browser-tests` and `nested-tier-regression` deny before launch; no heavier-tier run or reduced heavy coverage |
| Local final completion/terminal cleanup | `CheckedExecution.terminate`, `Coordinator.terminate`; execution: “terminal completion recomputes inside the transaction and writer boundary”; “changed final input denies terminal acceptance despite earlier PASS”; “failed terminal cleanup requires approval but not passing validation”; “cancelled terminal cleanup requires approval but not passing validation” | Fixture coverage of atomic local terminal decision with injected writer lock, not live task completion/independent owner control |
| Platform capability and managed dispatch | `managedCompletion` fails closed; execution: “unavailable production control and platform dispatch never fall back to legacy” | **BLOCKED:** no platform-origin ID/plan + one verified checked invocation |
| Platform identity/ownership boundary | No platform dispatch configuration changed; execution: “unavailable production control and platform dispatch never fall back to legacy” | **BLOCKED:** local launcher tests cannot prove actual platform behavior |
| Security/report safety | `execution.projectFile/checkedEnvironment`, `evidence.readVerifiedReport/environmentIdentity`; evidence: “reports reject path escape, symlinks, swaps, malformed JSON, and over-budget contents”; “unknown fixture state and secret-looking environment identifiers fail closed” | Fixture coverage; no protected origin/authenticity claim |
| Legacy migration | Existing checked prior-policy route retained, candidate v4 CLI flags blocked; execution: “unavailable production control and platform dispatch never fall back to legacy” | **Gap:** no independently approved operational cutover or honest migration of live tasks; do not fabricate historical IDs |

## Acceptance decision

Candidate components and fixtures cover substantial v4 behavior; the
authorized prior-policy `test-standard` bootstrap tier passed. Two heavy
steps, `browser-tests` and `nested-tier-regression`, have no accepted
machine-discovery adapter: v4 heavy-tier preflight blocks **before launch**.
No heavy tier was run and no checks were removed to manufacture acceptance.
Independent current-task identity/owner approval/final-writer control have
not been provided for installation, and platform handoff remains blocked.
**Candidate code: prior-policy test-standard PASSED. Operational v4 activation:
NOT ACCEPTED. Managed completion: BLOCKED. Protected mode: UNAVAILABLE.**
The redacted log is not an attested v4 run identity or final snapshot.