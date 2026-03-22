ALTER TABLE "counting_sessions" ADD COLUMN "deleted_at" timestamp;
CREATE INDEX "idx_counting_sessions_deleted_at" ON "counting_sessions" ("deleted_at");
