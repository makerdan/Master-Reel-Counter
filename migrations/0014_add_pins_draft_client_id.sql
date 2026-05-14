-- Stable client-generated ID for draft (non-committed) pins.
-- Allows per-row upsert and deletion in replaceDraftPins so concurrent
-- collaborators' unlabeled edits are no longer silently overwritten.
ALTER TABLE pins ADD COLUMN IF NOT EXISTS draft_client_id TEXT;
