-- Phase 0 ops migration: add progress tables to supabase_realtime publication.
--
-- Context (docs/plans/2026-04-15-onboarding-disaster-remediation.md Phase 0):
-- Only `call_logs` was in the publication. Every UI postgres_changes
-- subscription on agent_runs / pipeline_runs / competitor_research_jobs /
-- email_import_progress was silently receiving zero events, which is why
-- the UI had to add 2-second polling as a band-aid.
--
-- REPLICA IDENTITY FULL is required so UPDATE events include the whole row
-- (default is primary-key-only, which makes progress payloads useless).

-- Idempotent add: alter publication ADD TABLE IF NOT EXISTS isn't supported,
-- so we guard each table individually.
do $$
declare
  t text;
  progress_tables text[] := array[
    'agent_runs',
    'agent_run_steps',
    'agent_run_events',
    'competitor_research_jobs',
    'scraping_jobs',
    'email_import_progress',
    'pipeline_runs',
    'faq_database',
    'competitor_sites'
  ];
begin
  foreach t in array progress_tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
      raise notice 'Added public.% to supabase_realtime publication', t;
    end if;
  end loop;

  -- Set REPLICA IDENTITY FULL for the tables whose UPDATEs the UI actually
  -- needs to consume with full payload (progress rows).
  foreach t in array array[
    'agent_runs',
    'competitor_research_jobs',
    'scraping_jobs',
    'email_import_progress',
    'pipeline_runs'
  ] loop
    execute format('alter table public.%I replica identity full;', t);
  end loop;
end
$$;
