-- Adds the server-anchored review cohort column to counting_sessions.
-- review_cohort stores a JSON-encoded sorted array of { userId, username }
-- objects that is set once (server-side) when the first reviewer opens the
-- review tab for a session. All clients read this field so every reviewer
-- computes identical entry→reviewer mappings regardless of WS join timing.
-- The post-merge setup script uses `npm run db:push` (drizzle-kit push) which
-- applies this column automatically; this file documents the change.
ALTER TABLE "counting_sessions" ADD COLUMN IF NOT EXISTS "review_cohort" text;
