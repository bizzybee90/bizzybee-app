
-- Create missing pipeline infrastructure tables
CREATE TABLE IF NOT EXISTS public.pipeline_job_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  run_id uuid,
  queue_name text,
  job_payload jsonb,
  outcome text,
  error text,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  run_id uuid,
  severity text DEFAULT 'error',
  scope text,
  error text,
  context jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  level text DEFAULT 'info',
  message text,
  context jsonb,
  created_at timestamptz DEFAULT now()
);

-- Deadletter queue  
SELECT pgmq.create('bb_deadletter_jobs');

-- Grant service_role access
GRANT ALL ON public.pipeline_job_audit TO service_role;
GRANT ALL ON public.pipeline_errors TO service_role;
GRANT ALL ON public.pipeline_run_logs TO service_role;
;
