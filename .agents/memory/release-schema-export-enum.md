---
name: Release schema export owns enum DDL
description: The reviewed release database bootstrap must account for Drizzle export emitting the account-role enum.
---

The PostgreSQL SQL emitted by `drizzle-kit export` includes the `account_role` enum and both `Admin` and `User` values.

**Why:** Adding a second unconditional `CREATE TYPE account_role` makes an otherwise empty isolated release database fail during bootstrap with a duplicate-type error.

**How to apply:** Validate the generated SQL contains the reviewed enum, then execute the export output once and let the schema preflight verify the resulting database.