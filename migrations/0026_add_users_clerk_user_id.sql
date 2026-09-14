-- Persist the immutable native Clerk identity separately from the local account ID.
-- Existing rows remain unlinked until the server verifies Clerk's externalId.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerk_user_id" varchar;

CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_user_id_unique"
  ON "users" ("clerk_user_id")
  WHERE "clerk_user_id" IS NOT NULL;

-- Roll back with migrations/rollback/0026_add_users_clerk_user_id.sql.