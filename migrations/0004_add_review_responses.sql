CREATE TABLE IF NOT EXISTS "review_responses" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL,
  "entry_id" integer NOT NULL,
  "user_id" varchar NOT NULL,
  "username" text,
  "verdict" text NOT NULL,
  "flag_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_responses_session_entry_user_idx" ON "review_responses" ("session_id", "entry_id", "user_id");
