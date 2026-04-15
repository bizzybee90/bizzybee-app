-- agent_runs.source_job_id is workflow-specific:
-- - own_website_scrape -> scraping_jobs.id
-- - competitor_discovery -> competitor_research_jobs.id
-- Keeping a single FK to scraping_jobs breaks non-website workflows.
ALTER TABLE public.agent_runs
DROP CONSTRAINT IF EXISTS agent_runs_source_job_id_fkey;

COMMENT ON COLUMN public.agent_runs.source_job_id IS
'Workflow-specific source job identifier. References different job tables depending on workflow_key.';
