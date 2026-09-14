-- Rollback removes only the native Clerk lookup link. Local account IDs and
-- authorization state remain intact, but legacy identities again require
-- Clerk externalId resolution after each server restart.
ALTER TABLE "users" DROP COLUMN IF EXISTS "clerk_user_id";