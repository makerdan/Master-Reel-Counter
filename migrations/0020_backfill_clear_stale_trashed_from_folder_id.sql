-- Backfill: clear stale trashed_from_folder_id on sessions that were moved to
-- a different folder while their original folder was in trash (before task #297
-- fixed the root cause). These rows have BOTH folder_id and
-- trashed_from_folder_id non-null, but pointing at different folders.
--
-- Without this cleanup such sessions could still be incorrectly relinked into
-- the original folder if it is ever restored.
--
-- Condition:
--   trashed_from_folder_id IS NOT NULL  → snapshot was set (folder was trashed)
--   folder_id IS NOT NULL               → session was subsequently moved elsewhere
--   folder_id != trashed_from_folder_id → it's actually a different folder
--
-- Safe to run multiple times (already-cleared rows satisfy none of the WHERE
-- conditions, so the UPDATE becomes a no-op on subsequent runs).
UPDATE counting_sessions
  SET trashed_from_folder_id = NULL
  WHERE trashed_from_folder_id IS NOT NULL
    AND folder_id IS NOT NULL
    AND folder_id != trashed_from_folder_id;
