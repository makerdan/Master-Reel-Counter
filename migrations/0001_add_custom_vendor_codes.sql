ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "custom_vendor_codes" text[] NOT NULL DEFAULT '{}'::text[];
