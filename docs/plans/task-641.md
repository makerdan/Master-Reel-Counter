# Task #641: Tier 1: Make release schema checks safe and migration-aware

# Tier 1: Make release schema checks safe and migration-aware

## What & Why
Both newest publishes compile then fail inserting users.role. The candidate and smoke inherit DATABASE_URL without schema preparation; test setup must not depend on an unmigrated live database.

## Evidence
Builds 8c9c04f2-a0a3-4b98-b813-a1c93f643600 and 3802832b-36d9-410d-8515-cca798784fc1 on 2026-09-11 fail managed-clerk-auth.spec.ts:184 with column role of relation users does not exist. Migration 0023 defines the role; 0025 deletes legacy tester data. The shell starts candidate before schema reconciliation, health checks only connectivity, and stale fixture cleanup mutates data before this failure.

## Done looks like
- The exact candidate runs against an explicitly isolated release-test database or schema initialized to its reviewed migration state; candidate and smoke use the same target.
- Read-only schema preflight fails before creating or deleting fixtures if required auth schema is absent.
- The actual publishing database migration prerequisite is documented and verified safely; passing an isolated smoke is not presented as proof live schema is current.
- No existing users or inventory are deleted as an incidental build/test repair; persisted Admin/User assertions remain.

## Out of scope
No removal of role assertions, production force-push, unauthorized data deletion, or claim that local isolation proves production migrations ran.

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
**Covers:** Both newest publishes compile then fail inserting users.role. The candidate and smoke inherit DATABASE_URL without schema preparation; test setup must not depend on an unmigrated live database.
**Test location:** New release schema lifecycle integration tests and scripts/__tests__/managed-clerk-release.test.mjs
**What it checks:** Reproduce missing users.role against a disposable pre-migration fixture; migration-aware isolation succeeds, mismatched target fails closed, and no production or non-owned fixture is touched.

## Steps
1. Identify the release database lifecycle and inspect development/production schema using approved read-only database tooling. Establish safe isolation and required schema before any fixture mutation.
2. Initialize a dedicated disposable test target from the reviewed candidate schema/migrations, propagate it to every candidate/smoke connection, and guard against accidentally targeting production. A transaction on one connection is not sufficient isolation.
3. Add migration/schema preflight before fixture provisioning, preserve primary errors through cleanup, and restrict cleanup to owned fixtures. Preserve the active Google login work when integrating shared release configuration.
4. Prepare a controlled production migration procedure and stop for explicit approval of destructive changes, especially legacy tester deletion; never run blind schema push or runtime auto-migration.
5. Add integration fixtures for pre-role schema, current schema, interrupted setup, cleanup, and candidate/smoke target mismatch; prove preflight catches the observed failure before provider or database writes.

## Relevant files
- `scripts/build-and-verify-release.sh`
- `tests/release/managed-clerk-auth.spec.ts`
- `migrations/0023_remove_tester_auth_add_account_roles.sql`
- `migrations/0025_reconcile_legacy_tester_accounts.sql`
- `server/index.ts`
- `drizzle.config.ts`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.

