ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "registration_key" varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS "photos_session_registration_key_unique"
  ON "photos" USING btree ("session_id", "registration_key");