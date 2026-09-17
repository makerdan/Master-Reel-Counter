---
name: Failure Gate
description: >-
  Apply to every task plan and every task execution. Establish a test baseline,
  classify failures with evidence, enforce the plan's validation ceiling, and
  report ownership without fixing failures the task did not cause.
---

# Failure Gate

Failure Gate is a portable validation-ownership contract. It has one purpose:
make validation ownership explicit before work is declared complete. It applies
at two points:

1. **Plan time:** discover and document the baseline before writing the plan.
2. **Execute time:** classify new failures without treating a convenient retry
   as evidence of provenance.

The contract distinguishes test failures, which may be matched to authoritative
baseline evidence, from non-test failures. Typecheck, lint, audit, smoke, and
harness results never become ignorable test baselines merely because a host
project registers them in the same tier.

## Portability boundary

### Portable requirements

Every adopting project must provide:

- a task plan with baseline and validation-ceiling sections;
- a registry of valid validation commands or tiers;
- a fail-closed lock that binds task validation to the plan's command;
- an authoritative baseline mechanism with exact failure matching, lifecycle
  status, ownership, and expiry;
- execution reporting that distinguishes passed, failed, incomplete, and not
  reached work;
- evidence-based ownership and retry rules;
- immutable audit semantics: an audit step's configured command, threshold, and
  exit result cannot be weakened, ignored, or reclassified to make a run pass;
- a final completion-validation handoff for code-changing tasks.

The headings and semantic fields shown below are the portable interchange
contract. A host may implement them with different scripts or storage paths,
but must preserve their meaning and fail-closed behavior.

### Required host adaptation

Before use, each host project must map:

- its plan location and plan-creation workflow;
- its registered tier names, commands, step kinds, resource locks, and timeouts;
- its authoritative baseline catalog location and lifecycle maintenance;
- its local memory or historical-evidence sources, if any;
- its completion-validation interface and polling limit;
- its package/publishing path and any generated mirrors;
- application-specific suites, paths, startup checks, ports, databases,
  browsers, and external-service assumptions.

The concrete paths and commands in **Host-project adapter: this repository**
are examples for this repository, not universal requirements. Baseline records,
project memory, tier composition, and application paths must never be copied as
portable defaults.

## Non-negotiable contract

- Every plan has `## Pre-existing failures to ignore` and `## Validation`.
- `## Validation` has a real registered tier in `**Command:**`, a filled
  `**Why:**`, and `**Do not escalate:**`.
- The host-designated baseline catalog is the durable baseline source. A plan
  may reference only an authoritative, unexpired `active` record.
- `unknown`, `needs-review`, `intermittent`, `environment-limited`, and
  `resolved` records never authorize an ignore.
- A referenced baseline must declare exactly one plan ownership:
  `**Ignored baseline:**` for unrelated work or `**Owned baseline repair:**`
  when this task must fix it.
- Catalog membership never proves that a different suite, test, or failure
  signature is pre-existing. The observed failure must match the record.
- A retry that passes proves **intermittency only**. It does not prove that the
  failure pre-dates the task.
- A task-driven tier-lock problem fails closed. Only an explicit
  host-defined ad-hoc/non-task escape hatch may bypass a missing plan.
- A run is successful only if every required step passes. A step that starts but
  cannot produce a valid result is **incomplete**. Every later required step is
  **not reached**. Neither status is a pass or an ignorable baseline failure.
- Audit steps preserve their registered command, threshold, and result. Audit
  failures are task failures and cannot be baselined, waived by retries, or
  converted to harness limitations.

The session mandate, lint guard, tier runner, and this skill are one contract.
When changing the contract, update all relevant tracked surfaces together.
Do not edit generated `.local/custom_skills/` mirrors directly.

## Host-project adapter: this repository

This repository maps the portable contract to `.local/tasks/` plans,
`.agents/skills/validation-tiers/tiers.json` plus
`docs/validation/manifest.json`, and
`docs/validation/failure-baseline.json`. It uses `scripts/new-plan.mjs`,
`scripts/check-failure-gate.mjs`, `scripts/run-locked-tier.mjs`, and
`scripts/run-tier.mjs` as its enforcement commands.

`.local/tasks/` is gitignored environment-local archive state here. Bulk
archive repairs are not tracked deliverables. Keep this repository's
enforcement changes in tracked source, tests, session guidance, or published
assets. Other adopters must choose and document their own locations.

## Plan time — Planner checklist

<HARD-GATE>
Complete this checklist before writing the first plan heading. Emit the
announcement in the next section before that heading.
</HARD-GATE>

1. **Create safely.** Use `scripts/new-plan.mjs`; do not create a plan by hand.
   It requires a real `--why` and supplies the required section stubs.
2. **Scan memory.** Read `.agents/memory/MEMORY.md` and inspect linked entries
   about suites, files, or failure patterns touched by the task.
3. **Scan the catalog.** Read `docs/validation/failure-baseline.json` for exact
   suite/test/signature matches. Treat non-active records as context only.
4. **Scan recent tasks.** Search recent task descriptions for `pre-existing`,
   `known failure`, `flaky`, and the relevant suite names.
5. **Spot-run when applicable.** If the task changes backend/API-server code,
   run the project's primary backend suite once before editing and record its
   failures. Otherwise skip this expensive check.
6. **Record the baseline.** Use repeatable `--baseline-id` or
   `--owned-baseline-id` options with `scripts/new-plan.mjs`. Keep temporary
   environment observations under `## Task-local environment observations`;
   they are not durable provenance.
7. **Choose the ceiling.** Select the lightest registered validation tier that
   covers the task; use the middle tier when uncertain. Add `## Validation`
   immediately after the baseline section.
8. **Verify the plan.** In single-file mode, run both guards and require exit 0:

   ```sh
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-failure-gate.mjs
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-regression-guard.mjs
   ```

Do not call the task-creation operation until the plan passes both guards.

### Required announcement

Before the first plan heading, emit exactly:

```text
[FAILURE-GATE] Discovery checklist complete. Pre-existing failures documented: <N>. Validation command: `<command>`.
```

Use `node scripts/new-plan.mjs --name <name> --why "<reason>"`. It supplies the
required sections and accepts repeatable `--baseline-id`,
`--owned-baseline-id`, and `--environment-observation` options.

### Required plan sections

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

The lint guard is authoritative for valid tier names and placeholder rules.
Use its `--fix-stub` mode only to add missing structure; invalid tiers and
unfilled explanations still require a human decision.

## Execute time — Build agent decision path

<HARD-GATE>
Read the plan's baseline section before editing. If either required section is
missing, add a safe stub and stop to repair the plan before validation.
The plan's `**Command:**` is the validation ceiling.
</HARD-GATE>

### Task validation versus completion validation

- **Task validation** is the registered command named in the plan's
  `## Validation` section under **Command:**. It is the agent's required
  validation ceiling: run exactly that command with the task plan locked, and
  never escalate above it.
- **Completion validation** is the platform-managed final check after task work.
  It may run many registered commands and is not necessarily limited by the
  plan's task-validation ceiling. For code-changing tasks, it is required even
  when broad; do not skip it because it exceeds the task-validation ceiling.
- For an intentionally preview-only, no-file-change task, run task validation
  first. If completion review is not meaningful, provide a specific
  validation-skip reason; a generic "no changes" statement or an omitted check
  is not success.
- If completion validation remains **RUNNING** through its polling limit,
  classify that completion attempt as **incomplete** due to a
  validation-harness limitation, not a product failure or a pass. Report any
  checks it did not execute as **not reached**. Do not start or retry another
  completion validation while the original run remains active.

### 1. Establish the tier lock

Set the plan path for every task-driven validation run:

```sh
export TASK_PLAN_FILE=.local/tasks/<name>.md
node scripts/run-locked-tier.mjs "$TASK_PLAN_FILE"
```

Use `scripts/run-locked-tier.mjs <plan-file>` when the plan should choose the
tier, or invoke the registered command with `TASK_PLAN_FILE` set. Do not pass
`--allow-no-plan` as a task agent.

Missing, unreadable, malformed, or unparseable task-plan/tier data is a
**TIER-LOCK VIOLATION** and must stop the run before any validation step.
`--allow-no-plan` is the only bypass, and is reserved for an explicitly
ad-hoc/non-task caller. A mismatch between the requested tier and the plan
also fails closed. Never escalate above the plan ceiling.

The mechanical details live in:

- `scripts/run-locked-tier.mjs`
- `scripts/lib/tier-lock-check.mjs`
- `scripts/run-tier.mjs`
- `scripts/serial-lock.mjs`
- `.agents/skills/validation-tiers/tiers.json`

An explicit ad-hoc caller may use:

```sh
node scripts/run-tier.mjs test-standard --allow-no-plan
```

The plan tier is the task-validation ceiling. Completion validation is a
separate platform-managed check and may run registered commands beyond that
ceiling; it must not be skipped for code-changing tasks. A completion check
that remains running through its polling limit is incomplete because of a
harness limitation, not a product failure or a successful result.

### 2. Classify each failure

Apply these rules in order:

1. **Explicit baseline, unrelated task:** first match the observed suite, test,
   and signature to the active record. If all match, skip the listed failure;
   do not investigate or fix it.
2. **Explicit baseline, validation-repair task:** match the record, then fix it
   when the plan says this task owns it. A baseline label never prevents
   explicit repair ownership.
3. **Not listed:** retry the failing test three times in isolation.
   - Any passing retry means **intermittent**, not pre-existing. Record the
     result, then continue gathering provenance; do not self-classify from the
     pass alone.
   - Three failures are consistent evidence, not ownership by themselves.
4. **Evidence gate:** self-classify an unlisted failure as pre-existing only
   with at least two of these three facts:
   - the failing test and its directly imported task-relevant files are
     untouched;
   - it also fails on the pre-task revision/main;
   - a specific memory entry or recently merged task documents the pattern.
5. **Insufficient evidence:** treat the failure as a regression, fix it, or
   obtain the missing evidence. Do not silently waive it.

Unknown, stale, resolved, intermittent, environment-limited, or mismatched
records follow steps 3–5; they are never auto-ignored.

Only failures from steps registered with the host's test kind may follow the
baseline ownership path. Typecheck, lint, audit, smoke, and harness failures
remain task failures. In particular, do not alter an audit command, threshold,
lockfile, or dependency graph merely to obtain a passing result; any intentional
change needs task scope and review on its own merits.

For each self-classification emit:

```text
[SELF-CLASSIFIED PRE-EXISTING] <suite or test> — evidence: <factor1>, <factor2>
```

Do not promote a task-local observation into the catalog merely because it was
seen during this task. Promotion requires retry results, two-factor evidence,
exact matching fields, dated evidence, an owner, and a review deadline; use
`needs-review` until a separate maintenance change establishes authority.

Record intermittent outcomes separately from pre-existing provenance. A passing
retry may be reported as intermittent only; it cannot satisfy the two-factor
evidence gate.

### 3. Complete without escalation

Complete only when every remaining failure is either:

- explicitly listed and not owned by this task;
- self-classified with the required evidence and log; or
- fixed because this task explicitly owns it.

Do not escalate above the plan tier because of a baseline, intermittent retry,
or self-classification.

### 4. Report incomplete and not-reached work

For every required step, report exactly one terminal classification:

- **passed** — the step completed and met its registered contract;
- **failed** — the step completed with a valid failing result;
- **incomplete** — the step started but no valid result was produced, including
  timeout, signal termination, runner failure, or exhausted completion polling;
- **not reached** — the step was required but never started because an earlier
  failure or incomplete result stopped the run.

Fail and incomplete both make the run unsuccessful. List every not-reached step
by name; do not omit it, describe it as skipped, or imply it passed. Retry only
under the failure-classification rules, and retain the original attempt in the
evidence. A passing retry establishes intermittency, never provenance and never
erases an incomplete attempt.

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

## Archive and remediation boundaries

The validation pipeline may run a scoped `--fix-stub` pass for the current
`TASK_PLAN_FILE`. Archive inspection requires the explicit maintenance command:

```sh
node scripts/check-failure-gate.mjs --archive
```

It is never an ordinary managed-tier dependency. `.local/tasks/` is not tracked
output; do not instruct an agent to bulk-edit that archive as part of a commit.
If durable behavior must change, edit the tracked lint, runner, tests, session
mandate, and regenerate the published asset.

The pipeline's `--fix-stub` and strict-check ordering is an implementation
detail, not a substitute for a filled plan. The canonical mechanics are in
`scripts/check-failure-gate.mjs` and `scripts/validation-steps.mjs`.

Run the project-adapted maintenance report periodically:

```sh
npm run maintain:validation-baseline
```

It reports active records nearing review deadlines, stale verification, and
expired records without making them referenceable or failing unrelated task
validation. Lifecycle statuses are documented in
`docs/validation/failure-baseline.md`, including warning-window options,
finding categories, and exit codes.

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