---
name: Failure Gate
description: >-
  Apply to every task plan and every task execution. Establish a test baseline,
  classify failures with evidence, enforce the plan's validation ceiling, and
  report ownership without fixing failures the task did not cause.
---

# Failure Gate

Failure Gate makes test ownership explicit before work is declared complete. It
applies at plan time (discover and document the baseline before writing the
plan) and at execute time (classify new failures without treating a convenient
retry as evidence of provenance).

## Non-negotiable contract

- Every plan has `## Pre-existing failures to ignore` and `## Validation`.
- `## Validation` has a registered tier in `**Command:**`, a filled `**Why:**`,
  and `**Do not escalate:**`.
- `docs/validation/failure-baseline.json` is the durable baseline source. A
  plan may reference only an authoritative, unexpired `active` record.
- `unknown`, `needs-review`, `intermittent`, `environment-limited`, and
  `resolved` records never authorize an ignore.
- A referenced record declares exactly one ownership marker:
  `**Ignored baseline:**` or `**Owned baseline repair:**`.
- Catalog membership never proves that a different suite, test, or signature is
  pre-existing. The observed failure must match the record exactly.
- A passing retry proves intermittency only; it does not prove pre-task
  provenance.
- A task-driven tier-lock problem fails closed. Only explicit
  `--allow-no-plan` on an ad-hoc/non-task run may bypass a missing plan.
- `.local/tasks/` and `.local/custom_skills/` are environment-generated state.
  Do not commit archive repairs or edit the generated skill mirror directly.

The session mandate, lint guard, tier runner, and this skill are one contract.
Update all tracked surfaces together when the contract changes.

## Plan time

Before the first plan heading, emit:

```text
[FAILURE-GATE] Discovery checklist complete. Pre-existing failures documented: <N>. Validation command: `<command>`.
```

Use `node scripts/new-plan.mjs --name <name> --why "<reason>"`. It supplies the
required sections and accepts repeatable `--baseline-id`,
`--owned-baseline-id`, and `--environment-observation` options. The planner
must read `.agents/memory/MEMORY.md`, inspect exact active catalog matches,
search recent task descriptions, and spot-run the primary backend suite when
the task changes backend/API-server code.

Every plan includes this baseline, even when no failures are known:

```markdown
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not
pre-existing provenance. Use the execution evidence rules before assigning
ownership.
```

An active record may be referenced only with an exact suite, test, and failure
signature and one ownership marker:

```markdown
- **Ignored baseline:** `BASE-EXAMPLE` — suite › test; match only this signature: exact failure signature.
- **Owned baseline repair:** `BASE-EXAMPLE-REPAIR` — suite › test; this task explicitly owns repair of this signature: exact failure signature.
```

Temporary harness or resource limitations belong under
`## Task-local environment observations`; they are not durable provenance.
Free-text `--pre-existing` is task-local evidence and cannot weaken the
execute-time gate.

The plan's `## Validation` must be immediately after the baseline:

```markdown
## Validation
**Command:** `test-standard`
**Why:** <filled one-line reason this tier covers the task>
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.
```

Run both guards in single-file mode before accepting a plan:

```sh
TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-failure-gate.mjs
TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-regression-guard.mjs
```

## Execute time

Read the baseline and validation sections before editing. Set
`TASK_PLAN_FILE` for every task-driven validation run and run exactly the tier
named by the plan:

```sh
export TASK_PLAN_FILE=.local/tasks/<name>.md
node scripts/run-locked-tier.mjs "$TASK_PLAN_FILE"
```

Missing, unreadable, malformed, unregistered, or mismatched plan/tier data is a
**TIER-LOCK VIOLATION** and stops before validation begins. Never pass
`--allow-no-plan` as a task agent. An explicit ad-hoc caller may use:

```sh
node scripts/run-tier.mjs test-standard --allow-no-plan
```

The plan tier is the task-validation ceiling. Completion validation is a
separate platform-managed check and may run registered commands beyond that
ceiling; it must not be skipped for code-changing tasks. A completion check
that remains running through its polling limit is a harness limitation, not a
product failure.

Classify failures in this order:

1. Match suite, test, and signature to an active, unexpired record. Skip an
   unrelated ignored record; repair an owned record.
2. For an unlisted failure, retry the failing test three times in isolation.
   Any pass is recorded as intermittent, never as pre-existing provenance.
3. Self-classify only with at least two of: untouched failing test and directly
   imported task files; failure on the pre-task revision/main; a specific
   memory or recent-task record documenting the pattern.
4. Insufficient evidence is a regression: fix it or gather missing evidence.

For each self-classification emit:

```text
[SELF-CLASSIFIED PRE-EXISTING] <suite or test> — evidence: <factor1>, <factor2>
```

Do not promote a task-local observation into the catalog merely because it was
seen during this task. Promotion requires retry results, two-factor evidence,
exact matching fields, dated evidence, an owner, and a review deadline; use
`needs-review` until a separate maintenance change establishes authority.

Complete only when every failure is explicitly ignored and unrelated,
self-classified with the required evidence, or fixed because this task owns it.
Do not escalate above the plan tier because of a baseline, intermittent retry,
or self-classification.

## Regression Guard composition

Failure Gate owns `## Pre-existing failures to ignore` and `## Validation`.
Regression Guard owns `## Regression Guard` for material bug fixes, behavior
changes, error paths, and material security/privacy, data-integrity,
concurrency/lifecycle, performance/reliability, or compatibility changes.
Pure-hardening tasks, purely additive features, DELETE-prefixed tasks, cosmetic
error-string edits, and genuinely non-material internal changes are excluded.

Qualifying plans use:

```markdown
## Regression Guard
**Covers:** <concrete scenario, boundary, invariant, lifecycle, reliability property, or contract>
**Test location:** <file path of the test>
**What it checks:** <specific assertion that fails if the old behavior returns>
```

Valid alternatives are:

```markdown
## Regression Guard
**Self-satisfying** — this task's deliverable is the regression test/guard itself (<name it>).
```

or a specific valid N/A reason (real wall-clock race, unmockable external API,
visual regression without screenshot infrastructure, or feature removal).
“Hard to test”, unnamed existing coverage, or an unaccepted future task are
not valid reasons. A deferred guard must name a concrete non-PROPOSED task ref.

Before a qualifying plan heading emit:

```text
[REGRESSION-GUARD] Classification: <classification>. Guard: <covered — test file | N/A — reason | self-satisfying>.
```

`scripts/check-regression-guard.mjs` supports strict mode, `--fix-stub`,
`--stubs-only`, and `TASK_PLAN_FILE` single-file scoping. A scoped path must
end in `.md` and exist. The validation pipeline runs `--fix-stub` before the
strict check; the fixer adds structure only and cannot make a real decision.

## Archive, maintenance, and project boundaries

Archive inspection is opt-in:

```sh
node scripts/check-failure-gate.mjs --archive
```

It is not an ordinary tier dependency, and `.local/tasks/` is never tracked
output. `scripts/check-failure-gate.mjs --fix-stub` is scoped to the current
plan when `TASK_PLAN_FILE` is set.

Run the project-adapted maintenance report periodically:

```sh
npm run maintain:validation-baseline
```

It reports active records nearing review deadlines, stale verification, and
expired records without making them referenceable or failing unrelated task
validation. Lifecycle statuses are documented in
`docs/validation/failure-baseline.md`.

## Reference

- Plan scaffold: `scripts/new-plan.mjs`
- Failure Gate lint: `scripts/check-failure-gate.mjs`
- Regression Guard lint: `scripts/check-regression-guard.mjs`
- Tier registry: `.agents/skills/validation-tiers/tiers.json`
- Tier runner: `scripts/run-tier.mjs`
- Tier lock: `scripts/lib/tier-lock-check.mjs`
- Baseline catalog: `docs/validation/failure-baseline.json`
- Catalog lifecycle: `docs/validation/failure-baseline.md`
- Capability checklist: `docs/validation/failure-gate-capabilities.md`
- Published snapshot: `artifacts/bathyscan/public/failure-gate-skill.zip`