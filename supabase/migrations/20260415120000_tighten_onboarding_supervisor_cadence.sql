-- Tighten the onboarding supervisor cron from every-2-minutes to every-30-seconds.
--
-- Context (see docs/plans/2026-04-15-onboarding-disaster-remediation.md):
-- The 2-minute cadence matched the observed "Finding Competitors starts after
-- around 2 minutes" symptom exactly — because when wakeWorker's direct fetch
-- fails (e.g. during token rotation or cold-start), the supervisor cron is
-- the only thing that rescues a stuck run. 2 minutes is too long on a
-- flow that should take ~30s end-to-end.
--
-- We keep the supervisor's internal STALL_THRESHOLD_MS alone (5 min) because
-- the cadence change is enough to smooth over transient wake failures and
-- changing the threshold requires an edge-function deploy.
--
-- Idempotent: bb_schedule_onboarding_crons() calls bb_unschedule_onboarding_crons()
-- first so applying this migration twice is safe.

create or replace function public.bb_schedule_onboarding_crons()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bb_unschedule_onboarding_crons();

  perform cron.schedule(
    'bb_pipeline_worker_onboarding_discovery',
    '20 seconds',
    'select public.bb_trigger_worker(''bb_worker_onboarding_discovery_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_onboarding_website',
    '20 seconds',
    'select public.bb_trigger_worker(''bb_worker_onboarding_website_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_onboarding_faq',
    '20 seconds',
    'select public.bb_trigger_worker(''bb_worker_onboarding_faq_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_supervisor_onboarding',
    '30 seconds',
    'select public.bb_trigger_worker(''bb_worker_onboarding_supervisor_url'')'
  );
end;
$$;

select public.bb_schedule_onboarding_crons();
