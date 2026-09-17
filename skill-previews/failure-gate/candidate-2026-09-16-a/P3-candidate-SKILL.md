---
name: Failure Gate
description: >-
  Apply to every task plan and every task execution. Establish a test baseline,
  classify failures with evidence, enforce the plan's validation ceiling, and
  report ownership without fixing failures the task did not cause.
---

<!-- P3 — Complete candidate -->

# Failure Gate

Failure Gate is a portable validation-ownership contract. It makes validation
ownership explicit before work is declared complete.

It applies at two points:

1. **Plan time:** discover and document the baseline before writing the plan.
2. **Execute time:** classify new failures without treating a convenient retry
   as evidence of provenance.

Test failures may be matched to authoritative baseline evidence. Typecheck,
lint, audit, smoke, and harness results never become ignorable test baselines
just because a host project registers them in the same tier.

## Portability boundary

### Portable requirements

Every adopting project must provide:

- a task plan with baseline and validation-ceiling sections;
- a registry of valid validation commands or tiers;
- a fail-closed lock binding task validation to the plan's command;
- an authoritative baseline mechanism with exact failure matching, lifecycle
  status, ownership, and expiry;
- execution reporting that distinguishes passed, failed, incomplete, and not
  reached work;
- evidence-based ownership and retry rules;
- immutable audit semantics: an audit step's configured command, threshold, and
  exit result cannot be weakened, ignored, or reclassified to make a run pass;
- a final completion-validation handoff for code-changing tasks.

The headings and semantic fields below are the portable interchange contract.
A host may use different scripts or storage paths, but must preserve their
meaning and fail-closed behavior.

### Required host adaptation

Before use, map:

- plan location and plan-creation workflow;
- registered tier names, commands, step kinds, resource locks, and timeouts;
- authoritative baseline catalog and lifecycle maintenance;
- local memory or historical-evidence sources, if any;
- completion-validation interface and polling limit;
- package/publishing path and generated mirrors; and
- application-specific suites, paths, startup checks, ports, databases,
  browsers, and external-service assumptions.

## Non-negotiable contract

- Every plan has `## Pre-existing failures to ignore` and `## Validation`.
- `## Validation` has a real registered tier in `**Command:**`, a filled
  `**Why:**`, and `**Do not escalate:**`.
- The host-designated baseline catalog is the durable source. A plan may
  reference only an authoritative, unexpired `active` record.
- `unknown`, `needs-review`, `intermittent`, `environment-limited`, and
  `resolved` records never authorize an ignore.
- A referenced baseline declares exactly one ownership:
  `**Ignored baseline:**` for unrelated work or
  `**Owned baseline repair:**` when this task must fix it.
- Catalog membership never proves that a different suite, test, or failure
  signature is pre-existing. The observed failure must match the record.
- A passing retry proves **intermittency only**; it does not prove that the
  failure pre-dates the task.
- A task-driven tier-lock problem fails closed. Only an explicit host-defined
  ad-hoc/non-task escape hatch may bypass a missing plan.
- A run succeeds only when every required step passes. A started step without a
  valid result is **incomplete**; every later required step is **not reached**.
  Neither status is a pass or an ignorable baseline failure.
- Audit steps preserve their registered command, threshold, and result. Audit
  failures are task failures and cannot be baselined, waived by retries, or
  converted to harness limitations.

The session mandate, lint guard, tier runner, and this skill are one contract.
When changing it, update all relevant tracked surfaces together. Do not edit
generated `.local/custom_skills/` mirrors directly.

## Host-project adapter: this repository

This repository maps the contract to `.local/tasks/` plans,
`.agents/skills/validation-tiers/tiers.json`,
`docs/validation/manifest.json`, and
`docs/validation/failure-baseline.json`. Enforcement uses
`scripts/new-plan.mjs`, `scripts/check-failure-gate.mjs`,
`scripts/run-locked-tier.mjs`, and `scripts/run-tier.mjs`.

`.local/tasks/` is gitignored environment-local archive state. Bulk archive
repairs are not tracked deliverables. Keep enforcement changes in tracked
source, tests, session guidance, or published assets. Other adopters must
choose and document their own locations.

## Plan time — Planner checklist

<HARD-GATE>
Complete this checklist before writing the first plan heading, and emit the
announcement in the next section before that heading.
</HARD-GATE>

1. Use `scripts/new-plan.mjs`; do not create a plan by hand. It requires a real
   `--why` and supplies the required stubs.
2. Read `.agents/memory/MEMORY.md` and linked entries about affected suites,
   files, or failure patterns.
3. Read `docs/validation/failure-baseline.json` for exact
   suite/test/signature matches. Non-active records are context only.
4. Search recent task descriptions for `pre-existing`, `known failure`,
   `flaky`, and affected suite names.
5. If backend/API-server code changes, run the primary backend suite once
   before editing and record failures; otherwise skip this check.
6. Record the baseline with repeatable `--baseline-id` or
   `--owned-baseline-id`. Keep temporary environment observations under
   `## Task-local environment observations`; they are not durable provenance.
7. Choose the lightest registered tier covering the task, or the middle tier
   when uncertain, and add `## Validation` immediately after the baseline.
8. In single-file mode, run both guards and require exit 0:

   ```sh
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-failure-gate.mjs
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-regression-guard.mjs
   ```

Do not create the task until both guards pass.

### Required announcement

Before the first plan heading, emit exactly:

```text
[FAILURE-GATE] Discovery checklist complete. Pre-existing failures documented: <N>. Validation command: `<command>`.
```

Use `node scripts/new-plan.mjs --name <name> --why "<reason>"`; it accepts
repeatable `--baseline-id`, `--owned-baseline-id`, and
`--environment-observation` options.

### Required plan sections

Every plan includes this baseline, even when no failures are known:

```markdown
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not
pre-existing provenance. Use the execution evidence rules before assigning
ownership.
```

An active record may be referenced only with an exact suite, test, signature,
and one ownership marker:

```markdown
- **Ignored baseline:** `BASE-EXAMPLE` — suite › test; match only this signature: exact failure signature.
- **Owned baseline repair:** `BASE-EXAMPLE-REPAIR` — suite › test; this task explicitly owns repair of this signature: exact failure signature.
```

Temporary harness or resource limitations belong under
`## Task-local environment observations`, not durable provenance. Free-text
`--pre-existing` is task-local evidence and cannot weaken the execute-time gate.

`## Validation` must be immediately after the baseline:

```markdown
## Validation
**Command:** `test-standard`
**Why:** <filled one-line reason this tier covers the task>
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.
```

The lint guard is authoritative for tier names and placeholders. Its
`--fix-stub` mode adds missing structure only; invalid tiers and unfilled
explanations require a human decision.

## Execute time — Build agent decision path

<HARD-GATE>
Read the plan's baseline section before editing. If either required section is
missing, add a safe stub and stop to repair the plan before validation.
`**Command:**` is the validation ceiling.
</HARD-GATE>

### Task validation versus completion validation

- **Task validation** is the registered command under `## Validation` and is
  the required ceiling. Run exactly that command with the plan locked; never
  escalate above it.
- **Completion validation** is the platform-managed final check after task work.
  It may run registered commands beyond the task ceiling and is required for
  code-changing tasks.
- For an intentionally preview-only, no-file-change task, run task validation
  first. If completion review is not meaningful, give a specific validation
  skip reason; “no changes” or omission is not success.
- If completion validation remains **RUNNING** through its polling limit, classify
  it as **incomplete** because of a harness limitation, not a product failure
  or pass, and report checks not executed as **not reached**. Do not start or
  retry another completion validation while the original remains active.

### 1. Establish the tier lock

Set the plan path for every task-driven run:

```sh
export TASK_PLAN_FILE=.local/tasks/<name>.md
node scripts/run-locked-tier.mjs "$TASK_PLAN_FILE"
```

Use `scripts/run-locked-tier.mjs <plan-file>` when the plan selects the tier,
or invoke its registered command with `TASK_PLAN_FILE` set. Do not pass
`--allow-no-plan` as a task agent.

Missing, unreadable, malformed, or unparseable plan/tier data is a
**TIER-LOCK VIOLATION** and stops the run before validation. `--allow-no-plan`
is reserved for an explicitly ad-hoc/non-task caller. A requested-tier
mismatch also fails closed. Never exceed the plan ceiling.

The mechanics live in:

- `scripts/run-locked-tier.mjs`
- `scripts/lib/tier-lock-check.mjs`
- `scripts/run-tier.mjs`
- `scripts/serial-lock.mjs`
- `.agents/skills/validation-tiers/tiers.json`

An explicit ad-hoc caller may use:

```sh
node scripts/run-tier.mjs test-standard --allow-no-plan
```

Completion validation remains separate and may exceed the task ceiling; it
must not be skipped for code-changing tasks. A completion check that remains
running through its polling limit is incomplete, not a pass.

### 2. Classify each failure

Apply these rules in order:

1. Match an explicit active baseline's suite, test, and signature. If the task
   is unrelated, skip only that listed failure. If the plan owns repair, fix it.
2. For an unlisted failure, retry the failing test three times in isolation.
   A passing retry proves intermittent behavior only; record it and continue
   gathering provenance. Three failures are consistent evidence, not ownership.
3. Self-classify an unlisted failure as pre-existing only with at least two of:
   - the failing test and directly imported task-relevant files are untouched;
   - it also fails on the pre-task revision/main; or
   - a specific memory entry or recently merged task documents the pattern.
4. With insufficient evidence, treat it as a regression, fix it, or obtain the
   missing evidence. Never silently waive it.

Unknown, stale, resolved, intermittent, environment-limited, or mismatched
records follow steps 2–4 and are never auto-ignored.

Only failures from steps registered with the host's `test` kind may follow the
baseline path. Typecheck, lint, audit, smoke, and harness failures remain task
failures. Do not alter an audit command, threshold, lockfile, or dependency
graph merely to pass; an intentional change needs task scope and separate
review.

For each self-classification emit:

```text
[SELF-CLASSIFIED PRE-EXISTING] <suite or test> — evidence: <factor1>, <factor2>
```

Do not promote a task-local observation to the catalog merely because it
appeared during this task. Promotion requires retry results, two-factor
evidence, exact fields, dated evidence, an owner, and a review deadline; use
`needs-review` until separate maintenance establishes authority. Record
intermittent outcomes separately; a passing retry cannot satisfy the evidence
gate.

### 3. Complete without escalation

Complete only when every remaining failure is explicitly listed and unrelated,
self-classified with the required evidence and log, or fixed because this task
owns it. Do not escalate above the plan tier because of a baseline,
intermittent retry, or self-classification.

### 4. Report incomplete and not-reached work

Report exactly one terminal status for every required step:

- **passed** — completed and met its registered contract;
- **failed** — completed with a valid failing result;
- **incomplete** — started but produced no valid result, including timeout,
  signal termination, runner failure, or exhausted completion polling; or
- **not reached** — required but never started because an earlier failure or
  incomplete result stopped the run.

Failed and incomplete both make the run unsuccessful. Name every not-reached
step; do not call it skipped, imply it passed, or erase the original attempt.
Retry only under the classification rules. A passing retry establishes
intermittency, never provenance and never erases an incomplete attempt.

## Regression Guard composition

Failure Gate owns `## Pre-existing failures to ignore` and `## Validation`.
Regression Guard owns `## Regression Guard` for material bug fixes, behavior
changes, error paths, and material security/privacy, data-integrity,
concurrency/lifecycle, performance/reliability, or compatibility changes.
Pure-hardening, purely additive, DELETE-prefixed, cosmetic error-string, and
genuinely non-material internal changes are excluded.

Qualifying plans use:

```markdown
## Regression Guard
**Covers:** <concrete scenario, boundary, invariant, lifecycle, reliability property, or contract>
**Test location:** <file path of the test>
**What it checks:** <specific assertion that fails if the old behavior returns>
```

Valid alternatives are a named self-satisfying guard or a specific valid N/A
reason: real wall-clock race, unmockable external API, visual regression
without screenshot infrastructure, or feature removal. “Hard to test,” unnamed
existing coverage, and an unaccepted future task are invalid. A deferred guard
must name a concrete non-PROPOSED task ref.

Before a qualifying plan heading emit:

```text
[REGRESSION-GUARD] Classification: <classification>. Guard: <covered — test file | N/A — reason | self-satisfying>.
```

`scripts/check-regression-guard.mjs` supports strict mode, `--fix-stub`,
`--stubs-only`, and scoped `TASK_PLAN_FILE` mode. A scoped path must be an
existing `.md` file. The pipeline may fix stubs before strict checking; the
fixer adds structure only and cannot make the decision.

## Archive and remediation boundaries

Scoped `--fix-stub` may run for the current plan. Archive inspection requires:

```sh
node scripts/check-failure-gate.mjs --archive
```

It is not an ordinary managed-tier dependency. `.local/tasks/` is not tracked
output; do not bulk-edit it for a commit. To change durable behavior, edit the
tracked lint, runner, tests, session mandate, and published asset.

The pipeline's `--fix-stub` and strict-check ordering is an implementation
detail, not a substitute for a filled plan. Canonical mechanics are in
`scripts/check-failure-gate.mjs` and `scripts/validation-steps.mjs`.

Run the adapted maintenance report periodically:

```sh
npm run maintain:validation-baseline
```

It reports active records nearing review deadlines, stale verification, and
expired records without making them referenceable or failing unrelated task
validation. Lifecycle statuses, warning options, finding categories, and exit
codes are in `docs/validation/failure-baseline.md`.

## Reference

- Session mandate: `replit.md` § Agent rules
- Plan scaffold: `scripts/new-plan.mjs`
- Failure Gate lint guard: `scripts/check-failure-gate.mjs`
- Regression Guard lint guard: `scripts/check-regression-guard.mjs`
- Validation tiers: `.agents/skills/validation-tiers/SKILL.md`
- Tier registry: `.agents/skills/validation-tiers/tiers.json`
- Tier runner: `scripts/run-tier.mjs`
- Tier lock: `scripts/lib/tier-lock-check.mjs`
- Baseline catalog: `docs/validation/failure-baseline.json`
- Catalog lifecycle guidance: `docs/validation/failure-baseline.md`
- Capability checklist: `docs/validation/failure-gate-capabilities.md`
- Known project patterns: `.agents/memory/MEMORY.md`
- Published snapshot: `artifacts/bathyscan/public/failure-gate-skill.zip`