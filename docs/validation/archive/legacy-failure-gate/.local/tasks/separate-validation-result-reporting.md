# Separate Validation Result Reporting

## What & Why
Make task reports distinguish the plan-locked task-validation tier from platform-managed completion validation. This prevents a broader platform check from being mistaken for an agent escalation beyond the plan ceiling, and makes it clear which checks produced each result.

## Done looks like
- Failure Gate guidance specifies separate report entries for the task tier and platform completion checks.
- Reports identify the task's registered tier and result, then identify completion validation and its result or explain why it was not reached or remains incomplete.
- Contract tests protect against wording that conflates the two validation processes.

## Out of scope
- Changing which checks platform-managed completion validation runs or how the platform schedules it.
- Allowing task agents to exceed the plan's validation ceiling.
- Changing validation-tier composition or task lifecycle state.

## Steps
1. **Define the reporting contract** — Specify distinct task-validation and completion-validation report fields, including selected command/tier, outcome, and incomplete or not-reached status where applicable.
2. **Update canonical guidance** — Align the Failure Gate skill and repository agent guidance so reports never describe broader completion checks as task-tier escalation or as part of the locked task command.
3. **Add a contract regression check** — Extend Failure Gate tests to assert that both validation processes are described and reported separately, including incomplete and not-reached completion outcomes.
4. **Refresh and verify published guidance** — Regenerate the published Failure Gate archive for canonical skill changes and check source, mirror, and archive parity.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
None recorded.

## Validation
**Command:** `test-standard`
**Why:** This tier runs the Failure Gate contract tests and parity checks for the reporting guidance and published skill.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** A task whose plan selects `test-standard` receives a broader platform completion check; the report must not describe that completion check as task validation or tier escalation.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`
**What it checks:** The reporting contract requires separate task-tier and completion-validation outcomes, preserves incomplete and not-reached status, and identifies which process each result belongs to.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `replit.md`
- `scripts/__tests__/failure-gate.test.mjs`
- `artifacts/bathyscan/public/failure-gate-skill.zip`
