---
name: Drizzle enum bootstrap
description: Non-obvious behavior when preparing an empty PostgreSQL database from this project's Drizzle schema.
---

An empty release-test database must create the reviewed PostgreSQL enum types
before applying exported schema SQL. In particular, the exported SQL can
reference `account_role` without declaring it, while a direct Drizzle push can
try to recreate an enum after dependent tables exist.

**Why:** A release candidate must be initialized without destructive
reconciliation and without touching the publishing database.

**How to apply:** For disposable release targets, validate the reviewed
migrations, create required enum types in the isolated target, apply the
current schema export, then run a read-only schema preflight before fixtures.