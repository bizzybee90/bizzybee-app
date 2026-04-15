BEGIN;
ALTER TABLE IF EXISTS public.automation_settings
  ADD COLUMN IF NOT EXISTS communication_model text,
  ADD COLUMN IF NOT EXISTS competitor_model text,
  ADD COLUMN IF NOT EXISTS faq_model text,
  ADD COLUMN IF NOT EXISTS enrichment_model text;
UPDATE public.automation_settings
SET communication_model = COALESCE(NULLIF(trim(email_model), ''), communication_model)
WHERE COALESCE(NULLIF(trim(communication_model), ''), '') = ''
  AND COALESCE(NULLIF(trim(email_model), ''), '') <> '';
COMMENT ON COLUMN public.automation_settings.communication_model IS
  'Claude model used for customer-facing classification and draft writing across channels.';
COMMENT ON COLUMN public.automation_settings.competitor_model IS
  'Claude model used for competitor review and ranking.';
COMMENT ON COLUMN public.automation_settings.faq_model IS
  'Claude model used for website FAQ generation.';
COMMENT ON COLUMN public.automation_settings.enrichment_model IS
  'Claude model used for lower-risk enrichment and background analysis.';
ALTER TABLE IF EXISTS public.api_usage
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS task_type text,
  ADD COLUMN IF NOT EXISTS input_tokens bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.api_usage.model IS
  'Model identifier used for the request when known.';
COMMENT ON COLUMN public.api_usage.task_type IS
  'High-level task classification such as communication_classification or faq_generation.';
COMMENT ON COLUMN public.api_usage.input_tokens IS
  'Prompt/input tokens billed by the provider.';
COMMENT ON COLUMN public.api_usage.output_tokens IS
  'Completion/output tokens billed by the provider.';
COMMENT ON COLUMN public.api_usage.cache_creation_tokens IS
  'Prompt caching write tokens when supported by the provider.';
COMMENT ON COLUMN public.api_usage.cache_read_tokens IS
  'Prompt caching read tokens when supported by the provider.';
COMMENT ON COLUMN public.api_usage.request_metadata IS
  'Non-sensitive metadata describing the request for analytics and debugging.';
CREATE INDEX IF NOT EXISTS idx_api_usage_workspace_task_created
  ON public.api_usage (workspace_id, task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_workspace_model_created
  ON public.api_usage (workspace_id, model, created_at DESC);
COMMIT;
