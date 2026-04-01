ALTER TABLE "user_settings" ALTER COLUMN "use_receiving_quality" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "receiving_photo_quality" SET DEFAULT 40;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "use_on_floor_quality" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "on_floor_photo_quality" integer DEFAULT 40 NOT NULL;
