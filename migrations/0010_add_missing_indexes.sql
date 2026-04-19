CREATE INDEX IF NOT EXISTS "photos_parent_photo_id_idx" ON "photos" ("parent_photo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_object_storage_key_idx" ON "photos" ("object_storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pins_label_idx" ON "pins" ("label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_logs_user_id_idx" ON "activity_logs" ("user_id");
