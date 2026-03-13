CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"entry_id" integer,
	"photo_id" integer,
	"parent_comment_id" integer,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counting_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"folder_id" integer,
	"name" text NOT NULL,
	"location" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"last_photo_index" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"photo_id" integer,
	"aisle" text NOT NULL,
	"section" text NOT NULL,
	"position" text,
	"pallet_id" text,
	"reel_tag" text,
	"wire_type" text,
	"gauge" text,
	"footage" integer,
	"reel_count" integer DEFAULT 1,
	"color" text,
	"manufacturer" text,
	"notes" text,
	"conductors" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"page" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"parent_folder_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"uploaded_by" text,
	"object_storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"exif_timestamp" timestamp,
	"exif_gps" text,
	"rotation" integer DEFAULT 0,
	"aisle" text,
	"section" text,
	"notes" text,
	"is_detail_shot" boolean DEFAULT false,
	"parent_photo_id" integer,
	"pin_scale" real DEFAULT 1,
	"file_size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"entry_id" integer,
	"x_percent" real NOT NULL,
	"y_percent" real NOT NULL,
	"label" text,
	"reel_count" integer DEFAULT 1,
	"wire_details" text,
	"vendor_code" text,
	"footage" integer,
	"flagged" boolean DEFAULT false,
	"flag_reason" text
);
--> statement-breakpoint
CREATE TABLE "scan_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"pin_id" integer NOT NULL,
	"pin_label" text,
	"raw_text" text,
	"readable" boolean DEFAULT false,
	"scanned_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scan_results_pin_id_unique" UNIQUE("pin_id")
);
--> statement-breakpoint
CREATE TABLE "session_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text,
	"role" text DEFAULT 'editor' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_invite_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"token" varchar NOT NULL,
	"created_by" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "session_invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"encoding_enabled" boolean DEFAULT false NOT NULL,
	"encryption_key" text,
	"encryption_salt" text,
	"default_export_format" varchar(10) DEFAULT 'pdf' NOT NULL,
	"company_name" text,
	"company_logo_key" text,
	"export_footer_text" text,
	"photo_quality" integer DEFAULT 85 NOT NULL,
	"use_receiving_quality" boolean DEFAULT false NOT NULL,
	"receiving_photo_quality" integer DEFAULT 50 NOT NULL,
	"default_aisle_prefix" text,
	"section_advance_step" integer DEFAULT 1 NOT NULL,
	"default_unit" varchar(10) DEFAULT 'feet' NOT NULL,
	"default_theme" varchar(10) DEFAULT 'system' NOT NULL,
	"thumbnail_size" varchar(10) DEFAULT 'medium' NOT NULL,
	"larger_touch_targets" boolean DEFAULT false NOT NULL,
	"text_size" varchar(20) DEFAULT 'default' NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/Chicago' NOT NULL,
	"custom_vendor_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"custom_avatar_key" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "counting_sessions" ADD CONSTRAINT "counting_sessions_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");