ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_tester" boolean DEFAULT false NOT NULL;
UPDATE "users" SET "is_tester" = true WHERE "id" LIKE 'tester-%';
