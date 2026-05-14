-- Unique index enabling per-row ON CONFLICT upsert keyed by (photo_id, draft_client_id).
-- PostgreSQL treats NULL values as distinct in standard unique indexes, so rows with
-- draft_client_id = NULL are never constrained — multiple unlabeled draft pins per
-- photo are still allowed.
-- Applied via drizzle-kit push; this file records the intent for migrate-based envs.
CREATE UNIQUE INDEX IF NOT EXISTS pins_photo_draft_client_id_unique
  ON pins (photo_id, draft_client_id);
