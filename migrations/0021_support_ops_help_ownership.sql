-- Support operations: versioned first-run guidance and user-owned conversations.
-- Existing conversations are deliberately assigned an inaccessible sentinel
-- rather than being exposed to whichever user asks for the conversation list.
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "help_guide_version" integer NOT NULL DEFAULT 0;
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "help_guide_completed_at" timestamp;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "user_id" varchar NOT NULL DEFAULT 'legacy-unowned';
ALTER TABLE "conversations"
  ALTER COLUMN "user_id" DROP DEFAULT;
CREATE INDEX IF NOT EXISTS "conversations_user_id_idx"
  ON "conversations" ("user_id");