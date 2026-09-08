-- Redacted provider telemetry for owner-scoped AI usage reporting.
-- No prompts, images, provider bodies, credentials, or request identifiers are stored.
ALTER TABLE "ai_usage_logs"
  ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'replit-openai-compatible',
  ADD COLUMN IF NOT EXISTS "endpoint" text,
  ADD COLUMN IF NOT EXISTS "route" text,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS "latency_ms" integer,
  ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fallback_state" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "cache_state" text NOT NULL DEFAULT 'not-applicable';

CREATE INDEX IF NOT EXISTS "ai_usage_logs_provider_idx"
  ON "ai_usage_logs" ("provider");