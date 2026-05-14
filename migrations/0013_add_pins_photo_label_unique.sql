-- Prevent duplicate labeled pins on the same photo.
-- PostgreSQL unique indexes treat NULL values as distinct, so multiple
-- unlabeled (NULL-label) draft pins per photo remain permitted.

-- Step 1: Remove any duplicate (photo_id, label) rows before creating the index.
-- Keeps the row with the highest id (most recently inserted) for each duplicate group.
-- Only non-NULL labels can form duplicates under this constraint.
DELETE FROM pins
  WHERE label IS NOT NULL
    AND id NOT IN (
      SELECT MAX(id)
        FROM pins
       WHERE label IS NOT NULL
       GROUP BY photo_id, label
    );

-- Step 2: Create the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS pins_photo_label_unique
  ON pins (photo_id, label);
