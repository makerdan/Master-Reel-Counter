-- Prevent duplicate labeled pins on the same photo.
-- NULL labels (draft pins) are considered distinct by PostgreSQL unique indexes
-- so multiple draft/unlabeled pins per photo remain permitted.
CREATE UNIQUE INDEX IF NOT EXISTS pins_photo_label_unique
  ON pins (photo_id, label)
  WHERE label IS NOT NULL;
