do $$
begin
  begin
    perform pgmq.create('bb_onboarding_discovery_jobs');
  exception when others then
    raise notice 'Queue bb_onboarding_discovery_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_onboarding_website_jobs');
  exception when others then
    raise notice 'Queue bb_onboarding_website_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_onboarding_faq_jobs');
  exception when others then
    raise notice 'Queue bb_onboarding_faq_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_onboarding_supervisor_jobs');
  exception when others then
    raise notice 'Queue bb_onboarding_supervisor_jobs create skipped: %', sqlerrm;
  end;
end;
$$;
create or replace function public.bb_unschedule_onboarding_crons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_removed integer := 0;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'bb_pipeline_worker_onboarding_discovery',
      'bb_pipeline_worker_onboarding_website',
      'bb_pipeline_worker_onboarding_faq',
      'bb_pipeline_supervisor_onboarding'
    )
  loop
    perform cron.unschedule(v_job.jobid);
    v_removed := v_removed + 1;
  end loop;

  return v_removed;
end;
$$;
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
    '2 minutes',
    'select public.bb_trigger_worker(''bb_worker_onboarding_supervisor_url'')'
  );
end;
$$;
create or replace function public.bb_cleanup_old_queue_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_queues text[] := array[
    'bb_import_jobs', 'bb_ingest_jobs', 'bb_classify_jobs',
    'bb_draft_jobs', 'bb_deadletter_jobs',
    'bb_onboarding_discovery_jobs', 'bb_onboarding_website_jobs',
    'bb_onboarding_faq_jobs', 'bb_onboarding_supervisor_jobs'
  ];
  v_queue text;
  v_deleted bigint := 0;
  v_total bigint := 0;
  v_archive_table regclass;
begin
  foreach v_queue in array v_queues loop
    v_archive_table := to_regclass(format('pgmq.%I', 'a_' || v_queue));
    if v_archive_table is not null then
      execute format(
        'delete from %s where archived_at < now() - interval ''30 days''',
        v_archive_table
      );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
    end if;
  end loop;

  delete from public.pipeline_job_audit
  where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.pipeline_incidents
  where state = 'resolved'
    and resolved_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return jsonb_build_object('deleted_total', v_total);
end;
$$;
create or replace function public.bb_purge_archived_queues()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_queue text;
  v_count bigint;
begin
  foreach v_queue in array array[
    'bb_ingest_jobs', 'bb_classify_jobs', 'bb_draft_jobs',
    'bb_onboarding_discovery_jobs', 'bb_onboarding_website_jobs',
    'bb_onboarding_faq_jobs', 'bb_onboarding_supervisor_jobs'
  ] loop
    begin
      select pgmq.purge_queue(v_queue) into v_count;
      v_result := v_result || jsonb_build_object(v_queue, coalesce(v_count, 0));
    exception when others then
      v_result := v_result || jsonb_build_object(v_queue, sqlerrm);
    end;
  end loop;

  return v_result;
end;
$$;
create or replace view public.bb_queue_depths as
select *
from (
  values
    ('bb_import_jobs'::text),
    ('bb_ingest_jobs'::text),
    ('bb_classify_jobs'::text),
    ('bb_draft_jobs'::text),
    ('bb_deadletter_jobs'::text),
    ('bb_onboarding_discovery_jobs'::text),
    ('bb_onboarding_website_jobs'::text),
    ('bb_onboarding_faq_jobs'::text),
    ('bb_onboarding_supervisor_jobs'::text)
) as q(queue_name)
cross join lateral (
  select public.bb_queue_visible_count(q.queue_name) as visible_messages
) depth;
create or replace function public.bb_get_onboarding_progress(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.bb_user_in_workspace(p_workspace_id) then
    raise exception 'Not authorized for workspace %', p_workspace_id;
  end if;

  with latest_runs as (
    select distinct on (ar.workflow_key)
      ar.id,
      ar.workspace_id,
      ar.workflow_key,
      ar.status,
      ar.current_step_key,
      ar.trigger_source,
      ar.source_job_id,
      ar.input_snapshot,
      ar.output_summary,
      ar.error_summary,
      ar.started_at,
      ar.completed_at,
      ar.last_heartbeat_at,
      ar.updated_at
    from public.agent_runs ar
    where ar.workspace_id = p_workspace_id
      and ar.workflow_key in ('competitor_discovery', 'own_website_scrape', 'faq_generation', 'email_import')
    order by ar.workflow_key, ar.created_at desc
  ),
  latest_competitor_job as (
    select crj.*
    from public.competitor_research_jobs crj
    where crj.workspace_id = p_workspace_id
    order by crj.created_at desc
    limit 1
  ),
  latest_scraping_job as (
    select sj.*
    from public.scraping_jobs sj
    where sj.workspace_id = p_workspace_id
    order by sj.created_at desc
    limit 1
  ),
  latest_email_progress as (
    select eip.*
    from public.email_import_progress eip
    where eip.workspace_id = p_workspace_id
    order by eip.updated_at desc nulls last
    limit 1
  ),
  latest_pipeline_run as (
    select pr.*
    from public.pipeline_runs pr
    where pr.workspace_id = p_workspace_id
      and pr.channel = 'email'
    order by pr.created_at desc
    limit 1
  ),
  faq_counts as (
    select
      count(*) filter (where coalesce(fd.is_own_content, false) = false and coalesce(fd.archived, false) = false) as competitor_faqs,
      count(*) filter (where coalesce(fd.is_own_content, false) = true and coalesce(fd.archived, false) = false) as own_faqs
    from public.faq_database fd
    where fd.workspace_id = p_workspace_id
  )
  select jsonb_build_object(
    'workspace_id', p_workspace_id,
    'tracks', jsonb_build_object(
      'discovery',
      coalesce(
        (
          select jsonb_build_object(
            'run_id', lr.id,
            'agent_status', lr.status,
            'current_step', lr.current_step_key,
            'trigger_source', lr.trigger_source,
            'job_id', coalesce((lcj.id)::text, (lr.source_job_id)::text),
            'search_queries', coalesce(lr.input_snapshot -> 'search_queries', lcj.search_queries, '[]'::jsonb),
            'target_count', coalesce((lr.input_snapshot ->> 'target_count')::integer, lcj.target_count, 0),
            'counts', jsonb_build_object(
              'sites_discovered', coalesce(lcj.sites_discovered, 0),
              'sites_validated', coalesce(lcj.sites_validated, 0),
              'sites_approved', coalesce(lcj.sites_approved, 0)
            ),
            'latest_error', coalesce(lr.error_summary ->> 'reason', lcj.error_message),
            'started_at', lr.started_at,
            'completed_at', lr.completed_at,
            'last_heartbeat_at', lr.last_heartbeat_at,
            'updated_at', lr.updated_at
          )
          from latest_runs lr
          left join latest_competitor_job lcj
            on lcj.id = lr.source_job_id or lr.source_job_id is null
          where lr.workflow_key = 'competitor_discovery'
        ),
        jsonb_build_object(
          'run_id', null,
          'agent_status', 'pending',
          'current_step', null,
          'search_queries', '[]'::jsonb,
          'target_count', 0,
          'counts', jsonb_build_object(
            'sites_discovered', 0,
            'sites_validated', 0,
            'sites_approved', 0
          ),
          'latest_error', null
        )
      ),
      'website',
      coalesce(
        (
          select jsonb_build_object(
            'run_id', lr.id,
            'agent_status', lr.status,
            'current_step', lr.current_step_key,
            'job_id', coalesce((lsj.id)::text, (lr.source_job_id)::text),
            'website_url', coalesce(lr.input_snapshot ->> 'website_url', lsj.website_url),
            'job_status', lsj.status,
            'counts', jsonb_build_object(
              'pages_found', coalesce(lsj.total_pages_found, 0),
              'pages_processed', coalesce(lsj.pages_processed, 0),
              'faqs_found', coalesce(lsj.faqs_found, 0)
            ),
            'latest_error', coalesce(lr.error_summary ->> 'reason', lsj.error_message),
            'started_at', lr.started_at,
            'completed_at', lr.completed_at,
            'last_heartbeat_at', lr.last_heartbeat_at,
            'updated_at', lr.updated_at
          )
          from latest_runs lr
          left join latest_scraping_job lsj
            on lsj.id = lr.source_job_id or lr.source_job_id is null
          where lr.workflow_key = 'own_website_scrape'
        ),
        jsonb_build_object(
          'run_id', null,
          'agent_status', 'pending',
          'current_step', null,
          'job_id', null,
          'website_url', null,
          'job_status', null,
          'counts', jsonb_build_object(
            'pages_found', 0,
            'pages_processed', 0,
            'faqs_found', 0
          ),
          'latest_error', null
        )
      ),
      'faq_generation',
      coalesce(
        (
          select jsonb_build_object(
            'run_id', lr.id,
            'agent_status', lr.status,
            'current_step', lr.current_step_key,
            'job_id', coalesce((lcj.id)::text, (lr.source_job_id)::text),
            'selected_competitor_ids', coalesce(lr.input_snapshot -> 'selected_competitor_ids', '[]'::jsonb),
            'counts', jsonb_build_object(
              'pages_scraped', coalesce(lcj.pages_scraped, 0),
              'sites_scraped', coalesce(lcj.sites_scraped, 0),
              'faqs_generated', coalesce(lcj.faqs_generated, 0),
              'faqs_after_dedup', coalesce(lcj.faqs_after_dedup, 0),
              'faqs_added', coalesce(fc.competitor_faqs, 0)
            ),
            'latest_error', coalesce(lr.error_summary ->> 'reason', lcj.error_message),
            'started_at', lr.started_at,
            'completed_at', lr.completed_at,
            'last_heartbeat_at', lr.last_heartbeat_at,
            'updated_at', lr.updated_at
          )
          from latest_runs lr
          left join latest_competitor_job lcj
            on lcj.id = lr.source_job_id or lr.source_job_id is null
          cross join faq_counts fc
          where lr.workflow_key = 'faq_generation'
        ),
        jsonb_build_object(
          'run_id', null,
          'agent_status', 'pending',
          'current_step', null,
          'counts', jsonb_build_object(
            'pages_scraped', 0,
            'sites_scraped', 0,
            'faqs_generated', 0,
            'faqs_after_dedup', 0,
            'faqs_added', 0
          ),
          'latest_error', null
        )
      ),
      'email_import',
      coalesce(
        (
          select jsonb_build_object(
            'run_id', null,
            'agent_status', coalesce(lpr.state, 'pending'),
            'current_step', coalesce(lep.current_phase, null),
            'pipeline_run_id', lpr.id,
            'counts', jsonb_build_object(
              'emails_received', coalesce(lep.emails_received, 0),
              'emails_classified', coalesce(lep.emails_classified, 0),
              'estimated_total_emails', coalesce(lep.estimated_total_emails, 0),
              'inbox_email_count', coalesce(lep.inbox_email_count, 0),
              'sent_email_count', coalesce(lep.sent_email_count, 0)
            ),
            'latest_error', coalesce(lep.last_error, lpr.last_error),
            'started_at', lpr.started_at,
            'completed_at', coalesce(lep.completed_at, lpr.completed_at),
            'last_heartbeat_at', lpr.last_heartbeat_at,
            'updated_at', coalesce(lep.updated_at, lpr.updated_at)
          )
          from latest_pipeline_run lpr
          full outer join latest_email_progress lep on true
        ),
        jsonb_build_object(
          'run_id', null,
          'agent_status', 'pending',
          'current_step', null,
          'counts', jsonb_build_object(
            'emails_received', 0,
            'emails_classified', 0,
            'estimated_total_emails', 0,
            'inbox_email_count', 0,
            'sent_email_count', 0
          ),
          'latest_error', null
        )
      ),
      'faq_counts',
      (
        select jsonb_build_object(
          'competitor_faqs', coalesce(fc.competitor_faqs, 0),
          'own_faqs', coalesce(fc.own_faqs, 0)
        )
        from faq_counts fc
      )
    )
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('workspace_id', p_workspace_id, 'tracks', '{}'::jsonb));
end;
$$;
revoke all on function public.bb_unschedule_onboarding_crons() from public, anon, authenticated;
revoke all on function public.bb_schedule_onboarding_crons() from public, anon, authenticated;
revoke all on function public.bb_get_onboarding_progress(uuid) from public, anon;
grant execute on function public.bb_unschedule_onboarding_crons() to service_role;
grant execute on function public.bb_schedule_onboarding_crons() to service_role;
grant execute on function public.bb_get_onboarding_progress(uuid) to authenticated, service_role;
