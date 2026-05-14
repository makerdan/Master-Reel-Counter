-- Tracks files written to object storage by POST /api/uploads/direct that
-- have not yet been registered as a photos row (step 2 of the two-step upload
-- flow). The hourly purge job deletes any row older than 24 h whose objectPath
-- has no matching photos.object_storage_key — indicating the client abandoned
-- the upload without completing photo registration.
--
-- The post-merge setup script runs `npm run db:push` (drizzle-kit push) which
-- applies the schema automatically; this file documents the change.
CREATE TABLE IF NOT EXISTS "upload_intents" (
  "id" serial PRIMARY KEY,
  "object_path" text NOT NULL,
  "user_id" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "upload_intents_object_path_unique" UNIQUE ("object_path")
);

CREATE INDEX IF NOT EXISTS "upload_intents_created_at_idx" ON "upload_intents" ("created_at");
CREATE INDEX IF NOT EXISTS "upload_intents_user_id_idx" ON "upload_intents" ("user_id");
