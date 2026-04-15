-- Repair production schema drift for onboarding competitor review.
-- Some live environments are missing columns that the current review UI and
-- workflow inserts rely on, even though the feature migrations exist locally.

ALTER TABLE public.competitor_sites
  ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS location_data JSONB,
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER DEFAULT 0;

UPDATE public.competitor_sites
SET is_selected = true
WHERE is_selected IS NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_sites_job_selected
  ON public.competitor_sites(job_id, is_selected)
  WHERE is_selected = true;

COMMENT ON COLUMN public.competitor_sites.is_selected IS
  'User-togglable in review phase. true means the competitor will be analysed.';

COMMENT ON COLUMN public.competitor_sites.location_data IS
  'Raw location/provider metadata used during competitor review.';

COMMENT ON COLUMN public.competitor_sites.relevance_score IS
  'Score 0-100 used to rank discovered competitors during onboarding review.';;
