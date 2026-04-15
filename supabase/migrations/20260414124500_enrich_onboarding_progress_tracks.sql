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
            'job_status', lcj.status,
            'current_domain', lcj.current_scraping_domain,
            'search_queries', coalesce(lr.input_snapshot -> 'search_queries', lcj.search_queries, '[]'::jsonb),
            'target_count', coalesce((lr.input_snapshot ->> 'target_count')::integer, lcj.target_count, 0),
            'output_summary', coalesce(lr.output_summary, '{}'::jsonb),
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
          'job_id', null,
          'job_status', null,
          'current_domain', null,
          'search_queries', '[]'::jsonb,
          'target_count', 0,
          'output_summary', '{}'::jsonb,
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
            'output_summary', coalesce(lr.output_summary, '{}'::jsonb),
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
          'output_summary', '{}'::jsonb,
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
            'job_status', lcj.status,
            'current_domain', lcj.current_scraping_domain,
            'selected_competitor_ids', coalesce(lr.input_snapshot -> 'selected_competitor_ids', '[]'::jsonb),
            'output_summary', coalesce(lr.output_summary, '{}'::jsonb),
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
          'job_id', null,
          'job_status', null,
          'current_domain', null,
          'selected_competitor_ids', '[]'::jsonb,
          'output_summary', '{}'::jsonb,
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

revoke all on function public.bb_get_onboarding_progress(uuid) from public, anon;
grant execute on function public.bb_get_onboarding_progress(uuid) to authenticated;
