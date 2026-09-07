---
name: Support operations schema application
description: Development runtime schema must be updated after adding Drizzle columns or startup/test seed paths can fail before feature code runs.
---

The checked-in migration is the source of truth, but schema validation only verifies that the exported schema and migration files are consistent; it does not apply the migration to the current development database.

**Why:** Runtime queries select all columns from a Drizzle table, so an unapplied development migration can break unrelated endpoints such as test-owner setup before the new feature is exercised.

**How to apply:** After a support/schema change, apply the migration through the development database workflow before running authenticated browser or seed-path validation. Never apply this as a production startup side effect.