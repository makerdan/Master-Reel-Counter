# Release database migration prerequisite

The managed Clerk release candidate is verified against the dedicated
`RELEASE_SMOKE_DATABASE_URL` target. The release build refuses to use the
publishing `DATABASE_URL` for candidate fixtures, prepares only the dedicated
target from the reviewed Drizzle schema, and runs a read-only auth-schema
preflight before any Clerk or database fixture write.

This isolated smoke proves that the candidate and smoke test agree on the
reviewed schema. It does **not** prove that the publishing database is current.

Before publishing a release that depends on the account-role migration:

1. Let the normal post-merge setup apply the schema to development.
2. Use the Publish flow to review and apply the development-to-production
   database diff. Do not run `drizzle-kit push`, custom production migration
   scripts, or startup-time DDL against production.
3. Verify the production schema read-only through the database pane or an
   approved production read-only query. Confirm `users.role` uses the
   `account_role` values `Admin` and `User`, and that the legacy tester/session
   objects are absent.
4. Stop and resolve any schema mismatch before enabling the release smoke.

Migration `0025_reconcile_legacy_tester_accounts.sql` is intentionally
fail-closed when a legacy account has the `Admin` role. No release check or
fixture cleanup authorizes deleting existing users, inventory, or historical
records.