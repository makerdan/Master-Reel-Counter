# Failure Gate v4 cutover acceptance — current candidate

## Authority and starting evidence

Starting revision: `930471e025cd3d7e15417e7ee3e23b6265fc425b`.
The tracked baseline catalog contained no records; no failure is authorized
for ignore or owned-repair treatment. The task description supplies
`draft:finish-failure-gate-v4-cutover` in `.local/tasks/`, not a durable,
independently approved plan/version. The platform message names task 914,
but the application has no independently verifiable platform task-assignment
adapter supplying that identity to the coordinator. Neither this message,
the cancelled prior cutover effort, nor task 907's prior-policy passing
`test-standard` grants review or activates v4. No earlier failure is an
eligible baseline for this task.

The canonical v4 contract is `.agents/skills/failure-gate/SKILL.md` and its
`reference/implementation.md` and `reference/acceptance.md`. The prior
plan-guarded `run-locked-tier.mjs` route remains in force; its caller-supplied
plan cannot grant v4 authority. V4 selectors are denied, including
assignment-like flags and extra arguments, with no fallback to legacy
execution. The candidate local coordinator and snapshot/report/terminal
checker are executable in isolated fixture tests but **not installed as an
ordinary task validation authority**.

## Routes and prerequisites

| Route | Current status and authority needed |
|---|---|
| Draft/review-request CLI | Executable planning only; returns no authorization. Need independent task assignment and exact durable approved plan/version. |
| Ordinary task `run-locked-tier.mjs` | Prior-policy plan route only. V4-shaped requests fail before launch. Need trusted current assignment, exact plan and independently accepted owner policy, parameter/environment policy and writer coordination before routing ordinary tasks through the checked coordinator. |
| Direct `npm run test-{fast,standard,standard-plus,heavy}` | Ad-hoc diagnostic route; `--allow-no-plan` cannot support task completion. Existing commands unchanged. |
| Candidate `CheckedExecution.run` and local completion/terminal | Executable with injected controls in isolated fixtures; not authorized for live task 914. Unavailable independent production review, task binding and coordinated final writer lock block activation. |
| Task UI/API/automation success | Not shown to consult the local decision; uncontrolled, not a protected gate. |
| Platform-managed completion | **BLOCKED**: no observed platform-origin active ID + exact approved plan + exactly one checked invocation + resulting run/decision. Never substitute the task-validation report for this separate report. |
| Protected enforcement | **UNAVAILABLE**: project-local writable code, reports and SQLite are workflow controls, not an independent protected service. |

## Registered tiers and reports

The runtime manifest retains every step, argv, timeout, priority and the
`npm audit --audit-level=high` threshold. `test-fast`, `test-standard`,
and `test-standard-plus` map their registered Node/serial-lock test steps
to bounded candidate summaries. `test-heavy` additionally maps
`nested-tier-regression` to seven exact named harness checks plus its
terminal marker, and `browser-tests` to a bounded Playwright JSON report
from its unchanged wrapper command. The browser config writes that JSON
only for the checked runner's isolated environment; ordinary HTML reports
remain unchanged. Missing, truncated, malformed, mismatched, zero-discovery,
or skipped reports cannot pass. Playwright cases have stable opaque
project-and-test identities and failure fingerprints, without storing raw
logs. The browser wrapper's database preparation is not authorized by a
synthetic fixture. There is **no real heavy-tier execution evidence** for
this task; both heavy report adapters have focused synthetic contract
coverage, not demonstrated live browser/database coverage. The affected
checked tier remains blocked by missing activation authority before any
step launches. In a future approved run, prerequisite/setup failure must
be incomplete and name each unexecuted step, not count as pass.

## Acceptance matrix (current observation)

| Contract category | Result |
|---|---|
| Portability/discovery | Candidate Node host mapping exercised; no claim about other hosts. |
| Identity/namespace and activation | Fixture UUID/tombstone and approval checks executable; real independent assignment, approved plan/version and owner review **BLOCKED**. |
| Tier lock/override and policy changes | Fixture substitutions, stale plan/policy and unsupported reports deny before launch. Legacy task route is still prior policy, not v4 activation. |
| Change approval and concurrent lifecycle | Fixture CAS, audit rollback, leases, recovery and suspension tests exist; no live owner service or final writer coordinator. |
| Snapshot integrity and run completeness | Isolated fixture snapshots and report digests exercised; real heavy run **NOT REACHED**. |
| Retries/provenance and catalog ownership | Three bounded fixture retries and earlier-snapshot comparisons exercised; no active catalog ignore, real earlier provenance or owner-reviewed baseline. |
| Terminal decision | Local fixture checker recomputes under injected writer lock and rejects changed final input. Live local completion **BLOCKED**. |
| Security/migration | Bounded reports and path checks are procedural; prior gate and commands retained, no historical authorization. |
| Platform handoff | **BLOCKED**; no real dispatch evidence. |

## Separate reports for this cutover attempt

**Task-validation report:** trusted task ID and approved durable plan/version
not supplied to the local coordinator; authorized tier in the draft is
`test-heavy`, but no authorization record exists. Checked run ID, tested
snapshot and runtime environment: **not supplied**. Raw required-tier result:
**NOT REACHED**. All manifest steps — `startup-smoke`,
`startup-smoke-boundaries`, `security-audit`, `schema-check`,
`release-schema-contract`, `workspace-skill-contract`, `typecheck`,
`storage-lint`, `port-reference-scan`, `storage-lint-contract`,
`unit-tests`, `vite-hmr-recovery-tests`, `serial-lock-tests`,
`port-authority-tests`, `failure-gate-parity`, `manifest-parity`,
`nested-tier-regression`, `collision-smoke`, `browser-tests` — are
**not reached** as an authorized task validation run. Assessment: **BLOCKED**,
not PASS. Focused local fixture checks are diagnostic evidence only.

**Platform-managed completion-validation report:** dispatch **NOT REACHED**;
platform-origin task ID, exact approved plan, same active task lock and one
checked dispatch have not been verified. Selected platform command/tier,
run ID and raw result: **not supplied**. Assessment: **BLOCKED**. No
unsupported broader completion check is an exemption.

## Independent acceptance needed before cutover

Candidate identifiers at this revision (SHA-256 over the coordinator's
canonical digest inputs): policy input digest
`f85339dcd565f2d2873f7a20927a1b8e13febd0df24f47ef2f2a7a286d93232f`,
adapter digest
`56807fc9ffaa5c74e1309c717a0c9743df6ab3cb2e7a89248c2359d910fd4c8a`,
runtime tiers digest
`c64d4cfd80b1768baaae522659ac2c1adce1fe5657384dadfb01d556efe0401a`,
and heavy definition digest
`3ecd3282197ad13ea5e5254da68369a2ce8474ddee39bfd2d8c6dc9bb777892e`.
These are **review candidates, not acceptance signatures**. No approved
parameter digest, environment policy, canonical plan digest/version,
authorization version, reviewer reference, or live run ID exists. A source
edit invalidates these candidate digests and requires recomputation and
independent review.

The actual workspace owner/platform must supply an independently verifiable
current assignment and exact approved durable plan/version, then review the
effective policy and adapter digests, tier definition and permitted parameters,
environment identity and this evidence through an owner-controlled route.
Authorization and audit must be committed together before the checked launcher
can execute. A plan path, agent-authored review flag, fixture reviewer, or
developer environment variable cannot provide this acceptance. A separate
platform-origin handoff must be demonstrated for managed completion; leave
`.replit` unchanged. Until both boundaries are met, keep v4 inactive and do
not run the destructive/production-facing heavy command as an ad-hoc tier.