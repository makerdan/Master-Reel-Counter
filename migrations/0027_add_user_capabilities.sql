-- Application-owned User capability state. Admin authority remains complete
-- regardless of this JSON document; unknown keys are ignored at runtime.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "capabilities" jsonb NOT NULL DEFAULT
    '{"session_create":false,"session_delete":false,"exports":false,"photo_management":true,"ai_scanning":false,"collaborator_management":false,"statistics":false,"account_settings":false}'::jsonb;

UPDATE "users"
SET "capabilities" = '{"session_create":false,"session_delete":false,"exports":false,"photo_management":true,"ai_scanning":false,"collaborator_management":false,"statistics":false,"account_settings":false}'::jsonb
WHERE "role" = 'User' AND ("capabilities" IS NULL OR jsonb_typeof("capabilities") <> 'object');

ALTER TABLE "users"
  ADD CONSTRAINT "users_capabilities_object_check"
  CHECK (jsonb_typeof("capabilities") = 'object') NOT VALID;

ALTER TABLE "users"
  VALIDATE CONSTRAINT "users_capabilities_object_check";