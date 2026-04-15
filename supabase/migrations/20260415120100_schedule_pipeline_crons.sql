-- Phase 0 ops migration: actually register the pipeline-worker crons.
--
-- Context (docs/plans/2026-04-15-onboarding-disaster-remediation.md Phase 0):
-- bb_schedule_pipeline_crons() has existed since 20260311 but was NEVER invoked
-- by any applied migration. Consequence: the import/ingest/classify/draft
-- workers had no consumers. bb_draft_jobs had 667 messages untouched for 5
-- days because nothing was scheduled to drain it.
--
-- PRECONDITIONS (must be met BEFORE this migration runs):
--   1) bb_worker_ingest_url, bb_worker_classify_url, bb_worker_draft_url
--      Vault secrets exist (plus the already-present bb_worker_import_url)
--   2) BB_WORKER_TOKEN edge env var matches vault.decrypted_secrets['bb_worker_token']
--
-- If either precondition fails, the crons will fire but every call will
-- return 401 — a symptom we've already observed 3,952 times.
--
-- Safety rails:
--   - select bb_schedule_pipeline_crons() internally unschedules then schedules,
--     so re-applying this migration is idempotent.
--   - Runs inside a DO block with a vault-existence pre-check so a missing
--     secret fails loudly instead of silently scheduling broken crons.

do $$
declare
  required_secrets text[] := array[
    'bb_worker_token',
    'bb_worker_import_url',
    'bb_worker_ingest_url',
    'bb_worker_classify_url',
    'bb_worker_draft_url'
  ];
  missing text[];
begin
  select array_agg(name order by name) into missing
  from unnest(required_secrets) as name
  where not exists (
    select 1 from vault.decrypted_secrets v where v.name = name
  );

  if missing is not null then
    raise exception
      'Missing Vault secrets required by bb_schedule_pipeline_crons: %. Create them before applying this migration.',
      missing;
  end if;
end
$$;

select public.bb_schedule_pipeline_crons();
