# Tier 1: Validate the actual Clerk release candidate in CI

## What & Why
The manually dispatched Clerk workflow tests an existing URL rather than building/starting the exact candidate. CI also seeds removed is_tester fields, while green source contracts missed the observed runtime failures.

## Evidence
.github/workflows/managed-clerk-release.yml invokes verify:managed-clerk-release directly, omitting build/candidate startup/TLS transport/readiness identity. .github/workflows/validation.yml seeds legacy is_tester after schema push. Latest standard suite passed while heavy browser setup and both publishes failed. Actual remote activation/required status has not been verified.

## Done looks like
- Candidate validation uses the canonical release build harness with safe isolated fixtures and proves the exact revision, not an already published site.
- CI seeds current Clerk-only Admin/User schema and covers migration/schema prerequisites; removed tester fields cannot silently return.
- Coverage reports distinguish deterministic contracts, real browser execution, live-site checks, and production-key-dependent checks; unavailable credentials block rather than silently pass.
- The repaired path verifies script load, sign-in/session, local identity and role, protected navigation, and logout without weakening existing Google-provider coverage.

## Out of scope
No branch-policy changes, remote workflow dispatch, production credential copying, redundant replacement of the broader full-suite evidence task, or publishing by the agent.

## Pre-existing failures to ignore
None known at plan time. No authoritative baseline entries exist; observed failures are not authorized ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** Browser, release and lifecycle coverage requires the heavy registered tier.
**Do not escalate:** Run exactly this command. Unrelated failures do not authorize broader work.

## Task-local environment observations
Read-only evidence on 2026-09-11: fast, standard, standard-plus passed; heavy failed before browser execution with incomplete Clerk browser configuration; both newest publishes failed at missing users.role. No approved ignored baseline. Recheck prerequisites before implementation.

## Regression Guard
**Covers:** The manually dispatched Clerk workflow tests an existing URL rather than building/starting the exact candidate. CI also seeds removed is_tester fields, while green source contracts missed the observed runtime failures.
**Test location:** scripts/__tests__/managed-clerk-release.test.mjs plus disposable-schema and browser bootstrap tests from prerequisite tasks
**What it checks:** Workflow contracts reject direct live-URL-only validation as candidate proof and obsolete is_tester seeding; behavioral tests detect bad script host and missing role before a publish attempt.

## Steps
1. Inspect the current CI contract and remote activation read-only, then align the candidate workflow with the canonical build/start/identity/proxy harness. Keep a separately named live-site smoke only if useful; do not conflate it with candidate evidence.
2. Remove obsolete tester seed assumptions and use the isolated current-schema fixture lifecycle. Register executable configuration/schema regressions so textual source matches alone cannot satisfy them.
3. Integrate the active Google login work without overwriting it, retain browser transport/CSP checks and safe cleanup, and document which checks require matched production credentials at publish time.
4. Run the selected tier once after coherent changes and record the exact result and any blocked external prerequisites. Do not trigger remote workflows or change branch protection without explicit authorization.

## Relevant files
- `.github/workflows/managed-clerk-release.yml`
- `.github/workflows/validation.yml`
- `scripts/build-and-verify-release.sh`
- `scripts/__tests__/managed-clerk-release.test.mjs`
- `tests/global-setup.ts`
- `playwright.release.config.ts`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.

## Execution evidence

- Read-only GitHub repository, workflow, secret-metadata, and branch-policy requests returned HTTP 403 on September 14, 2026. No remote activation or required-status claim was made, and no workflow was dispatched.
- The ordinary validation workflow already seeded the current `Admin` role and rejected `is_tester` when implementation began. Its executable workflow and blank-database contract checks were preserved.
- `npm run test:managed-clerk-release-contract` passed all 36 deterministic release, schema, proxy, and secret-safety checks after the workflow repair.
- The single required locked `test-heavy` run passed startup, dependency audit, schema, skill, type, storage, unit, lock, port, manifest, collision, and HMR checks. Browser setup then failed before browser execution because the development database lacks `users.role` and the `account_role` values. A read-only schema check also confirmed that the development database still contains the removed `users.is_tester`, `user_settings.tester_password`, and `sessions` objects.
- The development cleanup migration was not applied because it deletes legacy tester accounts and session data. That project-data mutation is outside this CI-validation task.