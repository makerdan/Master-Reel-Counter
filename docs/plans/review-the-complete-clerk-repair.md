# Task: Tier 1: Review and verify the complete Clerk repair

# Review The Complete Clerk Repair

## What & Why
Review the combined merged changes from all six repair tasks and the existing Google Admin/User login task. Independent task passes are insufficient: verify that configuration, schema lifecycle, script delivery, recovery, caching, realtime authorization and release validation work together.

## Done looks like
- Independent code review of the combined changes identifies no unresolved critical or high-severity integration defects.
- A current canonical heavy-tier result and a scenario-by-scenario evidence matrix distinguish passed, failed, blocked and not exercised.
- Real preview and exact release candidate checks cover Clerk script loading, session completion, local identity and Admin/User roles, protected navigation and logout.
- Provider or production prerequisites that cannot be exercised are explicitly blocked; no claim of successful publishing without evidence from a new user-triggered publish.
- Durable plans and the final redacted review report live under docs, not .local.

## Pre-existing failures to ignore
None known at plan time. The authoritative baseline is empty; known observations do not authorize ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** This is the final integrated review of browser authentication, release configuration, schema prerequisites, service workers and realtime lifecycle after all repairs merge.
**Do not escalate:** Run exactly this command. Unrelated failures do not authorize a broader repair scope.

## Task-local environment observations
On 2026-09-11 fast, standard and standard-plus passed; heavy stopped at incomplete Clerk browser configuration. The two newest publishes compiled then failed inserting users.role, and the preview Clerk script hostname failed TLS hostname verification. These are baseline observations to close with new evidence, not proof of current state after dependencies merge.

## Regression Guard
**Covers:** Integration regressions across all Clerk repairs, including stale merged code reintroducing overrides or incompatible fixtures.
**Test location:** Existing and prerequisite bootstrap/recovery, release-schema, worker, WebSocket and Google browser suites; scripts/__tests__/managed-clerk-release.test.mjs.
**What it checks:** One coherent revision passes the combined scenario matrix; regression tests would detect the original invalid-host, missing-role, cached-error, unrecovered-loader and unbounded-pre-auth cases. No success is inferred from text matches, another revision, an existing live URL or unexecuted browser tests.

## Steps
1. Confirm all prerequisite changes are merged into the reviewed revision and preserve tracked plan copies under docs/plans. Review the combined diff and final code independently for conflicting assumptions, obsolete overrides, secrets exposure, authorization failures, destructive migrations and overwritten Google coverage.
2. Build an evidence matrix across development versus production, signed-out and approved Admin/User, pending/rejected users, script outage/retry, protected navigation, logout, account transition, worker upgrade and bounded realtime authentication. Reuse existing coverage and identify missing integration assertions without duplicating unrelated draft tasks.
3. Fix only integration defects introduced by these repairs and add focused regressions. Report unrelated findings with evidence and ownership rather than silently broadening scope. Re-review material corrections.
4. Run the canonical heavy tier after coherent corrections. Verify the real preview and exact production candidate through the safe harness when credentials and isolated fixtures permit; never bypass TLS, authentication or the release gate. Verify production migration prerequisites read-only.
5. Write a redacted final report under docs/validation with the reviewed revision, commands, outcomes, remaining blockers and publish-readiness conclusion. If publishing is required for matched production credentials, request user-triggered publishing and inspect that new build; otherwise clearly leave production validation blocked. Do not publish or trigger remote workflows yourself.

## Out of scope
No auth-provider migration, production credential copying, destructive schema changes without explicit approval, broad backlog repair or replacement of the existing dependency-remediation full-suite task. This task verifies the combined Clerk repair specifically.

## Relevant files
- `client/src/App.tsx`
- `tests/global-setup.ts`
- `tests/release/managed-clerk-auth.spec.ts`
- `scripts/build-and-verify-release.sh`
- `scripts/__tests__/managed-clerk-release.test.mjs`
- `client/public/sw.js`
- `server/routes.ts`
- `.github/workflows/managed-clerk-release.yml`
- `.github/workflows/validation.yml`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.