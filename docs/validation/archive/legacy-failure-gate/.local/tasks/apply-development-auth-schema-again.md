# Apply Development Auth Schema

## What & Why
Repeat Task #667 because the current development database still lacks the merged authentication schema despite that task being marked merged. Apply the tracked schema through the configured post-merge process and verify the actual development database, while preserving the production boundary.

## Done looks like
- The configured post-merge process completes against the confirmed development database without an unresolved schema prompt or silent no-op.
- Read-only development schema checks confirm `users.role`, `users.clerk_user_id`, and `users.capabilities` exist; `account_role` contains `Admin` and `User`.
- The legacy tester column/password and application `sessions` table are absent where required by the tracked auth schema.
- No production database or production SQL is modified.

## Out of scope
- Applying or reviewing a development-to-production database diff.
- Running manual SQL changes against production, publishing, or republishing the application.
- Changing schema definitions, migration files, or application behavior.
- Automatically approving destructive or ambiguous schema changes.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This tier covers the tracked auth-schema preflight contract and backend behavior that depends on the Admin/User role and Clerk identity schema.
**Do not escalate:** Run exactly this command. A database, dependency, or environment failure is evidence to classify and report, not permission to bypass the normal schema flow or use a broader tier.

## Regression Guard
**Covers:** Development schema application preserves the required Admin/User role contract and durable Clerk identity column.
**Test location:** `scripts/__tests__/release-schema-preflight.test.mjs`
**What it checks:** The schema contract accepts both `account_role` values and rejects a target missing `users.role` or `users.clerk_user_id`; live read-only development metadata verification additionally prevents a prompted post-merge no-op from being reported as success.

## Steps
1. **Establish the development target** — Confirm the configured database target is development, not production or publication, and record the current read-only schema evidence before applying anything; stop if that boundary cannot be established.
2. **Run the normal post-merge process** — Execute the configured post-merge script without ad-hoc migration commands or manual production SQL. If Drizzle presents an ambiguous or destructive choice, stop and obtain explicit informed approval rather than accepting a silent no-op or blanket force.
3. **Verify the required schema read-only** — Inspect development metadata for the tracked role, identity, capability, and legacy-object state; do not count script exit status alone as proof of application.
4. **Run bounded validation and report** — Run the registered validation tier, classify failures under Failure Gate, and report the development schema evidence and confirmation that production was untouched.

## Relevant files
- `.replit:116-121`
- `scripts/post-merge.sh`
- `drizzle.config.ts`
- `shared/models/auth.ts`
- `migrations/0023_remove_tester_auth_add_account_roles.sql`
- `migrations/0026_add_users_clerk_user_id.sql`
- `migrations/0027_add_user_capabilities.sql`
- `scripts/release-schema-preflight.mjs`
- `scripts/__tests__/release-schema-preflight.test.mjs`
- `docs/release-database-migration.md`
- `docs/release/clerk-identity-mapping-migration.md`
