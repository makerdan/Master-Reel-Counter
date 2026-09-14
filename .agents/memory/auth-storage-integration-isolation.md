---
name: Auth storage integration isolation
description: How to keep PostgreSQL auth-storage tests independent from local schema drift.
---

Auth-storage integration tests that create and remove identity mappings should run against a temporary PostgreSQL schema with the reviewed auth table shape, rather than assuming the shared development schema is fully migrated.

**Why:** The development database may lag tracked auth migrations and can also contain legacy columns. Broadly pushing or altering that schema just to run a test risks unrelated data and makes the test mutate shared state.

**How to apply:** Use an injected auth-storage database connection whose search path targets a per-test schema, apply only the migration under test, run the real storage methods, and drop the schema in `finally`.