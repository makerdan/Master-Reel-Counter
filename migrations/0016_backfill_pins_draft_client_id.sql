-- Backfill draft_client_id for existing draft (non-committed) pins that have
-- draft_client_id = NULL. This enables the ON CONFLICT (photo_id, draft_client_id)
-- upsert path in replaceDraftPins to correctly update existing rows without
-- conflicting with the pins_photo_label_unique or pins_photo_draft_client_id_unique
-- indexes.
-- gen_random_uuid() is built-in from PostgreSQL 13+.
UPDATE pins
  SET draft_client_id = gen_random_uuid()::text
  WHERE entry_id IS NULL
    AND draft_client_id IS NULL;
