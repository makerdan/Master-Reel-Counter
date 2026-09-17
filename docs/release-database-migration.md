# Release database migration prerequisite

The managed Clerk release candidate uses an isolated PostgreSQL database. By
default, the release build connects through the publishing `DATABASE_URL`,
creates a uniquely named, run-owned database, and removes it after all candidate
processes stop. The publishing credential must therefore be able to connect to
the `postgres` administrative database and create, terminate connections to,
and drop databases.

Operators may instead provide `RELEASE_SMOKE_DATABASE_URL` as an explicit,
already-isolated target. An explicit target is validated and is never replaced,
inherited from `DATABASE_URL`, or dropped by the release harness.

Target selection and automatic-database capability checks happen before
compilation or Clerk activity. The selected target is passed only to schema
preparation, candidate startup, and smoke fixtures. `DATABASE_URL` remains the
protected publication target used for isolation comparison and administration.
Success, setup failures, candidate failures, browser failures, and handled
termination all stop child processes before removing an automatically created
database. Creation or cleanup failure blocks release with a bounded,
credential-free diagnostic; the harness never falls back to publication data.

The isolation guard defines the writable physical target as normalized host,
effective PostgreSQL port (default `5432`), and decoded database name. Usernames,
passwords, URL protocol spelling, query ordering, and schema/search-path
parameters cannot make one physical database appear distinct. Different host
spellings are ambiguous without provider-specific identity data, so the guard
fails closed; candidate smoke must use an explicit different database on the
same PostgreSQL endpoint.

This isolated smoke proves that the candidate and smoke test agree on the
reviewed schema. It does **not** prove that the publishing database is current.

Currently published verification is separate and read-only. It receives no
database URL or Clerk secret, creates no identities, performs no stale-fixture
cleanup or schema preparation, and proves only anonymous authorization, live
Clerk proxy availability, and Google provider visibility.

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
