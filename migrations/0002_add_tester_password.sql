CREATE TABLE "user_wire_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"catalog" text NOT NULL,
	"vendor" text NOT NULL,
	"reel_length" integer NOT NULL,
	"description" text,
	"color" text,
	"jacket_type" text,
	"conductors" text,
	"ground_size" text,
	"wire_type" text
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "tester_password" text;