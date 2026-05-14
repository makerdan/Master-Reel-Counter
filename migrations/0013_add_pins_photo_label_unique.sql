-- Prevent duplicate labeled pins on the same photo.
-- PostgreSQL unique indexes treat NULL values as distinct, so multiple
-- unlabeled (NULL-label) draft pins per photo remain permitted.
CREATE UNIQUE INDEX IF NOT EXISTS pins_photo_label_unique
  ON pins (photo_id, label);
