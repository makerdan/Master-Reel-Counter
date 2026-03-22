ALTER TABLE "feedback" ALTER COLUMN "user_id" SET DATA TYPE varchar;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dismissed_duplicates_key_idx" ON "dismissed_duplicates" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dismissed_duplicates_session_key_idx" ON "dismissed_duplicates" USING btree ("session_id","key");--> statement-breakpoint
ALTER TABLE "counting_sessions" ADD CONSTRAINT "counting_sessions_status_check" CHECK ("counting_sessions"."status" IN ('active', 'completed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "counting_sessions" VALIDATE CONSTRAINT "counting_sessions_status_check";--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_status_check" CHECK ("feedback"."status" IN ('PENDING', 'REVIEWED', 'RESOLVED')) NOT VALID;--> statement-breakpoint
ALTER TABLE "feedback" VALIDATE CONSTRAINT "feedback_status_check";--> statement-breakpoint
ALTER TABLE "session_collaborators" ADD CONSTRAINT "session_collaborators_role_check" CHECK ("session_collaborators"."role" IN ('owner', 'editor', 'viewer')) NOT VALID;--> statement-breakpoint
ALTER TABLE "session_collaborators" VALIDATE CONSTRAINT "session_collaborators_role_check";--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_verdict_check" CHECK ("review_responses"."verdict" IN ('approved', 'flagged')) NOT VALID;--> statement-breakpoint
ALTER TABLE "review_responses" VALIDATE CONSTRAINT "review_responses_verdict_check";
