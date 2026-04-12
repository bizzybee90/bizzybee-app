do $$
declare
  v_base_url text := 'https://atukvssploxwyqpwjmrc.supabase.co/functions/v1';
  v_secret_id uuid;
begin
  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'bb_worker_onboarding_discovery_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_base_url || '/pipeline-worker-onboarding-discovery',
      'bb_worker_onboarding_discovery_url',
      'Supabase Edge Function URL for onboarding discovery worker'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_base_url || '/pipeline-worker-onboarding-discovery',
      'bb_worker_onboarding_discovery_url',
      'Supabase Edge Function URL for onboarding discovery worker'
    );
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'bb_worker_onboarding_website_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_base_url || '/pipeline-worker-onboarding-website',
      'bb_worker_onboarding_website_url',
      'Supabase Edge Function URL for onboarding website worker'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_base_url || '/pipeline-worker-onboarding-website',
      'bb_worker_onboarding_website_url',
      'Supabase Edge Function URL for onboarding website worker'
    );
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'bb_worker_onboarding_faq_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_base_url || '/pipeline-worker-onboarding-faq',
      'bb_worker_onboarding_faq_url',
      'Supabase Edge Function URL for onboarding FAQ worker'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_base_url || '/pipeline-worker-onboarding-faq',
      'bb_worker_onboarding_faq_url',
      'Supabase Edge Function URL for onboarding FAQ worker'
    );
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'bb_worker_onboarding_supervisor_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_base_url || '/pipeline-supervisor-onboarding',
      'bb_worker_onboarding_supervisor_url',
      'Supabase Edge Function URL for onboarding supervisor worker'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_base_url || '/pipeline-supervisor-onboarding',
      'bb_worker_onboarding_supervisor_url',
      'Supabase Edge Function URL for onboarding supervisor worker'
    );
  end if;
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
    '*/2 * * * *',
    'select public.bb_trigger_worker(''bb_worker_onboarding_supervisor_url'')'
  );
end;
$$;

select public.bb_schedule_onboarding_crons();
