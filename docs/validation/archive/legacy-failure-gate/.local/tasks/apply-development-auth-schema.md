# Apply Development Auth Schema

## What & Why
Apply the merged authentication schema to the development database through the project’s configured post-merge process. This brings development in line with the tracked Drizzle schema while preserving the production boundary.

## Done looks like
- The configured post-merge process completes against the development database
- A read-only development schema check confirms `users.role` exists
- A read-only development schema check confirms `account_role` contains `Admin` and `User`
- A read-only development schema check confirms `users.clerk_user_id` exists
- No production database or production SQL is modified

## Out of scope
- Applying or reviewing a development-to-production database diff
- Running manual SQL changes against production
- Publishing or republishing the application
- Changing schema definitions, migration files, or application behavior

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This tier covers the tracked auth-schema preflight contract and the backend behavior that depends on the current Admin/User and Clerk identity schema.
**Do not escalate:** Run exactly this command. A database, dependency, or environment failure is evidence to classify and report, not permission to use a broader tier or bypass the normal schema flow.

## Regression Guard
**Covers:** Development schema application preserves the required Admin/User role contract and durable Clerk identity column.
**Test location:** `scripts/__tests__/release-schema-preflight.test.mjs`
**What it checks:** The schema contract accepts both `account_role` values and rejects a target missing `users.role` or `users.clerk_user_id`.

## Steps
1. **Establish the development target** — Confirm the configured database target is the development database and is not a production or publication target; stop if that boundary cannot be established.
2. **Run the normal post-merge process** — Execute the project’s configured post-merge script without substituting ad-hoc migration commands or manual SQL.
3. **Verify the required schema read-only** — Inspect development metadata to confirm `users.role`, `users.clerk_user_id`, and the `Admin` and `User` values of `account_role`; do not alter data during verification.
4. **Run bounded validation and report** — Run the registered validation tier, classify any failures under Failure Gate, and report the schema evidence and confirmation that production was untouched.

## Relevant files
- `.replit:116-121`
- `scripts/post-merge.sh`
- `drizzle.config.ts`
- `shared/models/auth.ts`
- `migrations/0023_remove_tester_auth_add_account_roles.sql`
- `migrations/0026_add_users_clerk_user_id.sql`
- `scripts/release-schema-preflight.mjs`
- `docs/release-database-migration.md`
- `docs/release/clerk-identity-mapping-migration.md`
