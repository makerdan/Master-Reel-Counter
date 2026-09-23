---
name: Auth storage integration isolation
description: How to keep PostgreSQL auth-storage tests independent from local schema drift.
---

Auth-storage integration tests that create and remove identity mappings should run against a temporary PostgreSQL schema with the reviewed auth table shape, rather than assuming the shared development schema is fully migrated.

**Why:** The development database may lag tracked auth migrations and can also contain legacy columns. Broadly pushing or altering that schema just to run a test risks unrelated data and makes the test mutate shared state.

**How to apply:** Use an injected auth-storage database connection whose search path targets a per-test schema, apply only the migration under test, run the real storage methods, and drop the schema in `finally`.

Route integration tests can preserve the real authentication and handler path without
inserting a user into a stale shared schema: patch only the auth-storage lookup for a
unique test identity, keep real session/resource rows, and restore the lookup in
cleanup. Track any fire-and-forget activity-log promises and await them before
deleting the owning session.

**Why:** Route handlers may start asynchronous audit writes after sending their
response; deleting the fixture session first creates misleading foreign-key errors
and can leave rejected background promises in an otherwise passing test.

**How to apply:** Wrap the activity-log method in the test context, drain pending
promises after server shutdown, then delete fixture rows and restore all patched
methods.