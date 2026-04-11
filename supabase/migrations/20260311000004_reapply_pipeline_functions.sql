-- =============================================================================
-- BizzyBee Catch-Up Migration: Re-apply Pipeline Functions (functions only)
-- Generated: 2026-03-12
-- Purpose: Re-creates pipeline functions from earlier migrations that may have
--          failed. Only includes function definitions, no data manipulation.
-- Safety: All functions use CREATE OR REPLACE (idempotent).
-- =============================================================================

-- Ensure pgmq extension exists
create extension if not exists pgmq;
-- Drop views that will be re-created with potentially different column order
DROP VIEW IF EXISTS public.bb_open_incidents CASCADE;
DROP VIEW IF EXISTS public.bb_needs_classification CASCADE;
DROP VIEW IF EXISTS public.bb_pipeline_progress CASCADE;
DROP VIEW IF EXISTS public.bb_queue_depths CASCADE;
DROP VIEW IF EXISTS public.bb_stalled_events CASCADE;
-- Add missing unique constraints for pipeline tables
DO $$
BEGIN
  ALTER TABLE public.customer_identities
    ADD CONSTRAINT customer_identities_ws_type_norm_key
    UNIQUE (workspace_id, identifier_type, identifier_value_norm);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER TABLE public.message_events
    ADD CONSTRAINT message_events_ws_channel_config_ext_key
    UNIQUE (workspace_id, channel, config_id, external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER TABLE public.conversation_refs
    ADD CONSTRAINT conversation_refs_ws_channel_config_thread_key
    UNIQUE (workspace_id, channel, config_id, external_thread_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
-- Add conversations.config_id if missing
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS config_id uuid;
-- From unified_pipeline
create or replace function public.bb_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::timestamptz;
exception
  when others then
    return null;
end;
$$;
create or replace function public.bb_norm_identifier(p_type text, p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_type text := lower(coalesce(p_type, 'other'));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_digits text;
begin
  if v_value is null then
    return null;
  end if;

  if v_type = 'email' then
    return lower(v_value);
  end if;

  if v_type in ('phone', 'whatsapp', 'sms') then
    v_digits := regexp_replace(v_value, '[^0-9+]', '', 'g');
    if v_digits like '00%' then
      v_digits := '+' || substring(v_digits from 3);
    end if;
    if v_digits !~ '^\+' then
      v_digits := '+' || regexp_replace(v_digits, '[^0-9]', '', 'g');
    end if;
    v_digits := regexp_replace(v_digits, '[^0-9+]', '', 'g');
    if length(v_digits) < 8 then
      return lower(v_value);
    end if;
    return v_digits;
  end if;

  return lower(v_value);
end;
$$;
create or replace function public.bb_queue_send(
  queue_name text,
  message jsonb,
  delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_msg_id bigint;
begin
  select pgmq.send(queue_name, message, greatest(delay_seconds, 0))
    into v_msg_id;
  return v_msg_id;
end;
$$;
create or replace function public.bb_queue_send_batch(
  queue_name text,
  messages jsonb[],
  delay_seconds integer default 0
)
returns bigint[]
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_ids bigint[] := '{}'::bigint[];
  v_message jsonb;
  v_msg_id bigint;
begin
  if messages is null or array_length(messages, 1) is null then
    return v_ids;
  end if;

  foreach v_message in array messages loop
    v_msg_id := public.bb_queue_send(queue_name, v_message, delay_seconds);
    v_ids := array_append(v_ids, v_msg_id);
  end loop;

  return v_ids;
end;
$$;
create or replace function public.bb_queue_read(
  queue_name text,
  vt_seconds integer,
  n integer
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
begin
  return query
  select
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  from pgmq.read(queue_name, greatest(vt_seconds, 1), greatest(n, 1)) as r(
    msg_id bigint,
    read_ct integer,
    enqueued_at timestamptz,
    vt timestamptz,
    message jsonb
  );
end;
$$;
create or replace function public.bb_queue_delete(
  queue_name text,
  msg_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pgmq, pg_catalog
as $$
  select pgmq.delete(queue_name, msg_id);
$$;
create or replace function public.bb_queue_archive(
  queue_name text,
  msg_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pgmq, pg_catalog
as $$
  select pgmq.archive(queue_name, msg_id);
$$;
create or replace function public.bb_record_incident(
  p_workspace_id uuid,
  p_run_id uuid,
  p_severity text,
  p_scope text,
  p_error text,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.pipeline_incidents (
    workspace_id,
    run_id,
    severity,
    scope,
    error,
    context
  )
  values (
    p_workspace_id,
    p_run_id,
    case
      when p_severity in ('info', 'warning', 'error', 'critical') then p_severity
      else 'error'
    end,
    coalesce(nullif(btrim(p_scope), ''), 'pipeline'),
    coalesce(nullif(btrim(p_error), ''), 'Unknown pipeline incident'),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;
create or replace function public.bb_touch_pipeline_run(
  p_run_id uuid,
  p_metrics_patch jsonb default '{}'::jsonb,
  p_state text default null,
  p_last_error text default null,
  p_mark_completed boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_run_id is null then
    return;
  end if;

  update public.pipeline_runs
  set
    last_heartbeat_at = now(),
    metrics = coalesce(public.pipeline_runs.metrics, '{}'::jsonb) || coalesce(p_metrics_patch, '{}'::jsonb),
    state = case
      when p_state in ('running', 'paused', 'failed', 'completed') then p_state
      else public.pipeline_runs.state
    end,
    last_error = coalesce(p_last_error, public.pipeline_runs.last_error),
    completed_at = case
      when p_mark_completed then coalesce(public.pipeline_runs.completed_at, now())
      else public.pipeline_runs.completed_at
    end,
    updated_at = now()
  where id = p_run_id;
end;
$$;
create or replace function public.bb_ingest_unified_messages(
  p_workspace_id uuid,
  p_config_id uuid,
  p_run_id uuid,
  p_channel text,
  p_messages jsonb
)
returns table (
  received_count integer,
  enqueued_count integer,
  run_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received_count integer := 0;
  v_enqueued_count integer := 0;
  v_jobs jsonb[] := '{}'::jsonb[];
  v_row record;
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'p_messages must be a JSON array';
  end if;

  if p_channel not in ('email', 'whatsapp', 'sms', 'facebook', 'voice') then
    raise exception 'unsupported channel: %', p_channel;
  end if;

  for v_row in
    with payload as (
      select
        item,
        nullif(btrim(item->>'external_id'), '') as external_id,
        nullif(btrim(item->>'thread_id'), '') as thread_id,
        lower(coalesce(nullif(btrim(item->>'direction'), ''), 'inbound')) as direction,
        nullif(btrim(item->>'from_identifier'), '') as from_identifier,
        nullif(btrim(item->>'from_name'), '') as from_name,
        nullif(btrim(item->>'to_identifier'), '') as to_identifier,
        nullif(btrim(item->>'subject'), '') as subject,
        nullif(item->>'body', '') as body,
        nullif(item->>'body_html', '') as body_html,
        coalesce(public.bb_try_timestamptz(item->>'timestamp'), now()) as message_ts,
        case
          when lower(coalesce(item->>'is_read', '')) in ('true', 'false')
            then (item->>'is_read')::boolean
          else true
        end as is_read,
        coalesce(item->'metadata', '{}'::jsonb) as metadata,
        item->'raw_payload' as raw_payload
      from jsonb_array_elements(p_messages) as item
    ),
    valid as (
      select *
      from payload
      where external_id is not null
        and thread_id is not null
        and from_identifier is not null
        and to_identifier is not null
        and direction in ('inbound', 'outbound')
    ),
    upserted as (
      insert into public.message_events (
        workspace_id,
        run_id,
        channel,
        config_id,
        external_id,
        thread_id,
        direction,
        from_identifier,
        from_name,
        to_identifier,
        subject,
        body,
        body_html,
        "timestamp",
        is_read,
        metadata,
        raw_payload,
        status,
        updated_at
      )
      select
        p_workspace_id,
        p_run_id,
        p_channel,
        p_config_id,
        v.external_id,
        v.thread_id,
        v.direction,
        v.from_identifier,
        v.from_name,
        v.to_identifier,
        v.subject,
        v.body,
        v.body_html,
        v.message_ts,
        v.is_read,
        coalesce(v.metadata, '{}'::jsonb),
        v.raw_payload,
        'received',
        now()
      from valid v
      on conflict (workspace_id, channel, config_id, external_id)
      do update
      set
        run_id = coalesce(excluded.run_id, message_events.run_id),
        thread_id = excluded.thread_id,
        direction = excluded.direction,
        from_identifier = excluded.from_identifier,
        from_name = coalesce(excluded.from_name, message_events.from_name),
        to_identifier = excluded.to_identifier,
        subject = coalesce(excluded.subject, message_events.subject),
        body = coalesce(excluded.body, message_events.body),
        body_html = coalesce(excluded.body_html, message_events.body_html),
        "timestamp" = excluded."timestamp",
        is_read = excluded.is_read,
        metadata = coalesce(excluded.metadata, message_events.metadata),
        raw_payload = coalesce(excluded.raw_payload, message_events.raw_payload),
        status = case
          when message_events.status in ('materialized', 'classified', 'decided', 'drafted')
            then message_events.status
          else 'received'
        end,
        last_error = null,
        updated_at = now()
      returning id, status
    )
    select * from upserted
  loop
    v_received_count := v_received_count + 1;

    if v_row.status = 'received' then
      v_jobs := array_append(
        v_jobs,
        jsonb_build_object(
          'job_type', 'MATERIALIZE',
          'event_id', v_row.id,
          'workspace_id', p_workspace_id,
          'run_id', p_run_id,
          'channel', p_channel,
          'config_id', p_config_id
        )
      );
    end if;
  end loop;

  if array_length(v_jobs, 1) is not null then
    perform public.bb_queue_send_batch('bb_ingest_jobs', v_jobs, 0);
    v_enqueued_count := array_length(v_jobs, 1);
  end if;

  return query
  select v_received_count, v_enqueued_count, p_run_id;
end;
$$;
create or replace function public.bb_materialize_event(
  p_event_id uuid
)
returns table (
  did_work boolean,
  workspace_id uuid,
  run_id uuid,
  channel text,
  config_id uuid,
  conversation_id uuid,
  message_id uuid,
  needs_classify boolean,
  target_message_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.message_events%rowtype;
  v_identifier_type text;
  v_counterparty_identifier text;
  v_counterparty_norm text;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_last_inbound_message_id uuid;
  v_last_classified_message_id uuid;
  v_last_classify_enqueued_message_id uuid;
  v_needs_classify boolean := false;
  v_target_message_id uuid;
  v_initial_status text;
begin
  select *
    into v_event
  from public.message_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'message_event % not found', p_event_id;
  end if;

  workspace_id := v_event.workspace_id;
  run_id := v_event.run_id;
  channel := v_event.channel;
  config_id := v_event.config_id;
  conversation_id := v_event.materialized_conversation_id;
  message_id := v_event.materialized_message_id;
  needs_classify := false;
  target_message_id := null;

  if v_event.status in ('materialized', 'classified', 'decided', 'drafted')
    and v_event.materialized_message_id is not null then
    did_work := false;
    return next;
    return;
  end if;

  did_work := true;

  v_identifier_type := case v_event.channel
    when 'email' then 'email'
    when 'whatsapp' then 'phone'
    when 'sms' then 'phone'
    when 'facebook' then 'facebook'
    else 'other'
  end;

  if v_event.direction = 'inbound' then
    v_counterparty_identifier := v_event.from_identifier;
  else
    v_counterparty_identifier := v_event.to_identifier;
  end if;

  v_counterparty_norm := public.bb_norm_identifier(v_identifier_type, v_counterparty_identifier);
  if v_counterparty_norm is null then
    v_counterparty_norm := format('unknown:%s:%s', v_event.channel, v_event.external_id);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('bb_identity:%s:%s:%s', v_event.workspace_id, v_identifier_type, v_counterparty_norm),
      0
    )
  );

  select ci.customer_id
    into v_customer_id
  from public.customer_identities ci
  where ci.workspace_id = v_event.workspace_id
    and ci.identifier_type = v_identifier_type
    and ci.identifier_value_norm = v_counterparty_norm
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      workspace_id,
      name,
      email,
      phone,
      preferred_channel,
      created_at
    )
    values (
      v_event.workspace_id,
      coalesce(v_event.from_name, nullif(v_counterparty_identifier, ''), 'Unknown Customer'),
      case when v_identifier_type = 'email' then v_counterparty_norm else null end,
      case when v_identifier_type in ('phone', 'whatsapp') then v_counterparty_norm else null end,
      v_event.channel,
      now()
    )
    returning id into v_customer_id;

    insert into public.customer_identities (
      workspace_id,
      customer_id,
      identifier_type,
      identifier_value,
      identifier_value_norm,
      verified,
      source_channel
    )
    values (
      v_event.workspace_id,
      v_customer_id,
      v_identifier_type,
      v_counterparty_identifier,
      v_counterparty_norm,
      false,
      v_event.channel
    )
    on conflict (workspace_id, identifier_type, identifier_value_norm)
    do update
      set
        identifier_value = excluded.identifier_value,
        verified = customer_identities.verified or excluded.verified,
        source_channel = coalesce(customer_identities.source_channel, excluded.source_channel)
    returning customer_id into v_customer_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('bb_thread:%s:%s:%s:%s', v_event.workspace_id, v_event.channel, v_event.config_id, v_event.thread_id),
      0
    )
  );

  select cr.conversation_id
    into v_conversation_id
  from public.conversation_refs cr
  where cr.workspace_id = v_event.workspace_id
    and cr.channel = v_event.channel
    and cr.config_id = v_event.config_id
    and cr.external_thread_id = v_event.thread_id
  limit 1;

  if v_conversation_id is null then
    v_initial_status := case
      when v_event.direction = 'inbound' and coalesce(v_event.is_read, true) = false then 'new'
      else 'open'
    end;

    insert into public.conversations (
      workspace_id,
      customer_id,
      external_conversation_id,
      title,
      channel,
      status,
      created_at,
      updated_at
    )
    values (
      v_event.workspace_id,
      v_customer_id,
      v_event.thread_id,
      coalesce(v_event.subject, 'Conversation ' || v_event.thread_id),
      v_event.channel,
      v_initial_status,
      now(),
      now()
    )
    returning id into v_conversation_id;

    insert into public.conversation_refs (
      workspace_id,
      channel,
      config_id,
      external_thread_id,
      conversation_id
    )
    values (
      v_event.workspace_id,
      v_event.channel,
      v_event.config_id,
      v_event.thread_id,
      v_conversation_id
    )
    on conflict (workspace_id, channel, config_id, external_thread_id)
    do update
      set conversation_id = conversation_refs.conversation_id
    returning conversation_id into v_conversation_id;
  else
    update public.conversations
      set
        customer_id = coalesce(public.conversations.customer_id, v_customer_id),
        updated_at = now()
    where id = v_conversation_id;
  end if;

  insert into public.messages (
    conversation_id,
    actor_type,
    actor_name,
    direction,
    channel,
    body,
    is_internal,
    raw_payload,
    created_at,
    external_id,
    external_thread_id,
    config_id
  )
  values (
    v_conversation_id,
    case when v_event.direction = 'inbound' then 'customer' else 'agent' end,
    coalesce(
      v_event.from_name,
      v_event.from_identifier,
      'Unknown'
    ),
    v_event.direction,
    v_event.channel,
    coalesce(v_event.body, ''),
    false,
    coalesce(v_event.raw_payload, jsonb_build_object('metadata', v_event.metadata)),
    coalesce(v_event."timestamp", now()),
    v_event.external_id,
    v_event.thread_id,
    v_event.config_id
  )
  on conflict (conversation_id, external_id)
  do update
    set
      body = coalesce(excluded.body, messages.body),
      raw_payload = coalesce(messages.raw_payload, excluded.raw_payload),
      channel = excluded.channel
  returning id into v_message_id;

  if v_event.direction = 'inbound' then
    update public.conversations
      set
        last_inbound_message_id = v_message_id,
        last_inbound_message_at = coalesce(v_event."timestamp", now()),
        status = case
          when public.conversations.status in ('escalated', 'resolved') then public.conversations.status
          when coalesce(v_event.is_read, true) = false then 'new'
          else 'open'
        end,
        updated_at = now()
    where id = v_conversation_id;
  else
    update public.conversations
      set updated_at = now()
    where id = v_conversation_id;
  end if;

  select
    c.last_inbound_message_id,
    c.last_classified_message_id,
    c.last_classify_enqueued_message_id
  into
    v_last_inbound_message_id,
    v_last_classified_message_id,
    v_last_classify_enqueued_message_id
  from public.conversations c
  where c.id = v_conversation_id
  for update;

  if v_event.direction = 'inbound'
    and v_last_inbound_message_id is not null
    and v_last_inbound_message_id is distinct from v_last_classified_message_id
    and v_last_classify_enqueued_message_id is distinct from v_last_inbound_message_id then

    update public.conversations
      set last_classify_enqueued_message_id = v_last_inbound_message_id,
          updated_at = now()
    where id = v_conversation_id;

    perform public.bb_queue_send(
      'bb_classify_jobs',
      jsonb_build_object(
        'job_type', 'CLASSIFY',
        'workspace_id', v_event.workspace_id,
        'run_id', v_event.run_id,
        'config_id', v_event.config_id,
        'channel', v_event.channel,
        'event_id', v_event.id,
        'conversation_id', v_conversation_id,
        'target_message_id', v_last_inbound_message_id
      ),
      0
    );

    v_needs_classify := true;
    v_target_message_id := v_last_inbound_message_id;
  end if;

  update public.message_events
    set
      materialized_customer_id = v_customer_id,
      materialized_conversation_id = v_conversation_id,
      materialized_message_id = v_message_id,
      status = 'materialized',
      last_error = null,
      updated_at = now()
  where id = v_event.id;

  workspace_id := v_event.workspace_id;
  run_id := v_event.run_id;
  channel := v_event.channel;
  config_id := v_event.config_id;
  conversation_id := v_conversation_id;
  message_id := v_message_id;
  needs_classify := v_needs_classify;
  target_message_id := v_target_message_id;

  return next;
end;
$$;
create or replace function public.bb_queue_visible_count(p_queue_name text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table regclass;
  v_count bigint := 0;
begin
  v_table := to_regclass(format('pgmq.%I', 'q_' || p_queue_name));
  if v_table is null then
    return 0;
  end if;

  execute format('select count(*)::bigint from %s where vt <= now()', v_table)
    into v_count;

  return coalesce(v_count, 0);
end;
$$;
create or replace function public.bb_user_in_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_has_access boolean := false;
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  if v_uid is null then
    return false;
  end if;

  if to_regclass('public.workspace_members') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'user_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and user_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'member_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and member_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  if to_regclass('public.workspaces') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'owner_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and owner_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'created_by'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and created_by = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  return false;
end;
$$;
create or replace function public.bb_trigger_worker(
  p_url_secret_name text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
  v_worker_token text;
  v_request_id bigint;
begin
  select ds.decrypted_secret
    into v_url
  from vault.decrypted_secrets ds
  where ds.name = p_url_secret_name
  limit 1;

  if v_url is null then
    raise exception 'Missing Vault secret: %', p_url_secret_name;
  end if;

  select ds.decrypted_secret
    into v_anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_anon_key'
  limit 1;

  if v_anon_key is null then
    raise exception 'Missing Vault secret: bb_worker_anon_key';
  end if;

  select ds.decrypted_secret
    into v_worker_token
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_token'
  limit 1;

  if v_worker_token is null then
    raise exception 'Missing Vault secret: bb_worker_token';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key,
      'x-bb-worker-token', v_worker_token
    ),
    body := coalesce(p_body, '{}'::jsonb)
  )
  into v_request_id;

  return v_request_id;
end;
$$;
create or replace function public.bb_unschedule_pipeline_crons()
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
      'bb_pipeline_worker_import',
      'bb_pipeline_worker_ingest',
      'bb_pipeline_worker_classify',
      'bb_pipeline_worker_draft',
      'bb_pipeline_supervisor'
    )
  loop
    perform cron.unschedule(v_job.jobid);
    v_removed := v_removed + 1;
  end loop;

  return v_removed;
end;
$$;
create or replace function public.bb_schedule_pipeline_crons()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bb_unschedule_pipeline_crons();

  perform cron.schedule(
    'bb_pipeline_worker_import',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_import_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_ingest',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_ingest_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_classify',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_classify_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_draft',
    '25 seconds',
    'select public.bb_trigger_worker(''bb_worker_draft_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_supervisor',
    '2 minutes',
    'select public.bb_trigger_worker(''bb_worker_supervisor_url'')'
  );
end;
$$;
-- From pipeline_fixes
create or replace function public.bb_norm_identifier(p_type text, p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_type text := lower(coalesce(p_type, 'other'));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_digits text;
begin
  if v_value is null then
    return null;
  end if;

  if v_type = 'email' then
    return lower(v_value);
  end if;

  if v_type in ('phone', 'whatsapp', 'sms') then
    v_digits := regexp_replace(v_value, '[^0-9+]', '', 'g');

    -- International prefix with 00
    if v_digits like '00%' then
      v_digits := '+' || substring(v_digits from 3);
    end if;

    -- UK national format: 07... → +447...
    if v_digits like '0%' and length(v_digits) >= 10 and length(v_digits) <= 12 then
      v_digits := '+44' || substring(v_digits from 2);
    end if;

    -- Ensure + prefix for any remaining digits-only values
    if v_digits !~ '^\+' then
      v_digits := '+' || regexp_replace(v_digits, '[^0-9]', '', 'g');
    end if;

    -- Clean any stray non-digit/non-plus chars
    v_digits := regexp_replace(v_digits, '[^0-9+]', '', 'g');

    -- Too short to be a real phone number — return as-is
    if length(v_digits) < 8 then
      return lower(v_value);
    end if;

    return v_digits;
  end if;

  return lower(v_value);
end;
$$;
create or replace function public.bb_merge_customers(
  p_workspace_id uuid,
  p_winner_id uuid,
  p_loser_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved_identities int := 0;
  v_moved_conversations int := 0;
begin
  -- Safety checks
  if p_winner_id = p_loser_id then
    return jsonb_build_object('error', 'winner and loser are the same customer');
  end if;

  if not exists (select 1 from customers where id = p_winner_id and workspace_id = p_workspace_id) then
    return jsonb_build_object('error', 'winner customer not found');
  end if;

  if not exists (select 1 from customers where id = p_loser_id and workspace_id = p_workspace_id) then
    return jsonb_build_object('error', 'loser customer not found');
  end if;

  -- Move identities from loser to winner (skip duplicates)
  with moved as (
    update customer_identities
    set customer_id = p_winner_id
    where customer_id = p_loser_id
      and workspace_id = p_workspace_id
      and not exists (
        select 1 from customer_identities ci2
        where ci2.workspace_id = p_workspace_id
          and ci2.customer_id = p_winner_id
          and ci2.identifier_type = customer_identities.identifier_type
          and ci2.identifier_value_norm = customer_identities.identifier_value_norm
      )
    returning id
  )
  select count(*) into v_moved_identities from moved;

  -- Delete duplicate identities that couldn't move
  delete from customer_identities
  where customer_id = p_loser_id
    and workspace_id = p_workspace_id;

  -- Move conversations from loser to winner
  with moved as (
    update conversations
    set customer_id = p_winner_id, updated_at = now()
    where customer_id = p_loser_id
      and workspace_id = p_workspace_id
    returning id
  )
  select count(*) into v_moved_conversations from moved;

  -- Copy useful fields from loser to winner (fill gaps only)
  update customers set
    name = coalesce(customers.name, loser.name),
    email = coalesce(customers.email, loser.email),
    phone = coalesce(customers.phone, loser.phone),
    notes = case
      when loser.notes is not null and customers.notes is not null
        then customers.notes || E'\n[Merged] ' || loser.notes
      else coalesce(customers.notes, loser.notes)
    end,
    updated_at = now()
  from (select * from customers where id = p_loser_id) as loser
  where customers.id = p_winner_id;

  -- Delete the loser
  delete from customers where id = p_loser_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'moved_identities', v_moved_identities,
    'moved_conversations', v_moved_conversations
  );
end;
$$;
-- From b645d282
create or replace function public.bb_wake_worker(p_url_secret_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
  v_worker_token text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = p_url_secret_name limit 1;

  if v_url is null then return; end if;

  select ds.decrypted_secret into v_anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_anon_key' limit 1;

  if v_anon_key is null then return; end if;

  select ds.decrypted_secret into v_worker_token
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_token' limit 1;

  if v_worker_token is null then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key,
      'x-bb-worker-token', v_worker_token
    ),
    body := '{}'::jsonb
  );
end;
$$;
create or replace function public.bb_ingest_unified_messages(p_workspace_id uuid, p_config_id uuid, p_run_id uuid, p_channel text, p_messages jsonb)
returns table(received_count integer, enqueued_count integer, run_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received_count integer := 0;
  v_enqueued_count integer := 0;
  v_jobs jsonb[] := '{}'::jsonb[];
  v_row record;
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'p_messages must be a JSON array';
  end if;
  if p_channel not in ('email','whatsapp','sms','facebook','voice') then
    raise exception 'unsupported channel: %', p_channel;
  end if;

  for v_row in
    with payload as (
      select item,
        nullif(btrim(item->>'external_id'),'') as external_id,
        nullif(btrim(item->>'thread_id'),'') as thread_id,
        lower(coalesce(nullif(btrim(item->>'direction'),''),'inbound')) as direction,
        nullif(btrim(item->>'from_identifier'),'') as from_identifier,
        nullif(btrim(item->>'from_name'),'') as from_name,
        nullif(btrim(item->>'to_identifier'),'') as to_identifier,
        nullif(btrim(item->>'subject'),'') as subject,
        nullif(item->>'body','') as body,
        nullif(item->>'body_html','') as body_html,
        coalesce(public.bb_try_timestamptz(item->>'timestamp'), now()) as message_ts,
        case when lower(coalesce(item->>'is_read','')) in ('true','false') then (item->>'is_read')::boolean else true end as is_read,
        coalesce(item->'metadata','{}'::jsonb) as metadata,
        item->'raw_payload' as raw_payload
      from jsonb_array_elements(p_messages) as item
    ),
    valid as (
      select * from payload
      where external_id is not null and thread_id is not null and from_identifier is not null and to_identifier is not null and direction in ('inbound','outbound')
    ),
    upserted as (
      insert into public.message_events (
        workspace_id, run_id, channel, config_id, external_id, thread_id, direction,
        from_identifier, from_name, to_identifier, subject, body, body_html,
        "timestamp", is_read, metadata, raw_payload, status, updated_at
      )
      select p_workspace_id, p_run_id, p_channel, p_config_id,
        v.external_id, v.thread_id, v.direction, v.from_identifier, v.from_name,
        v.to_identifier, v.subject, v.body, v.body_html, v.message_ts, v.is_read,
        coalesce(v.metadata,'{}'::jsonb), v.raw_payload, 'received', now()
      from valid v
      on conflict (workspace_id, channel, config_id, external_id)
      do update set
        run_id = coalesce(excluded.run_id, message_events.run_id),
        thread_id = excluded.thread_id,
        direction = excluded.direction,
        from_identifier = excluded.from_identifier,
        from_name = coalesce(excluded.from_name, message_events.from_name),
        to_identifier = excluded.to_identifier,
        subject = coalesce(excluded.subject, message_events.subject),
        body = coalesce(excluded.body, message_events.body),
        body_html = coalesce(excluded.body_html, message_events.body_html),
        "timestamp" = excluded."timestamp",
        is_read = excluded.is_read,
        metadata = coalesce(excluded.metadata, message_events.metadata),
        raw_payload = coalesce(excluded.raw_payload, message_events.raw_payload),
        status = case when message_events.status in ('materialized','classified','decided','drafted') then message_events.status else 'received' end,
        last_error = null,
        updated_at = now()
      returning id, status
    )
    select * from upserted
  loop
    v_received_count := v_received_count + 1;
    if v_row.status = 'received' then
      v_jobs := array_append(v_jobs, jsonb_build_object(
        'job_type','MATERIALIZE','event_id',v_row.id,
        'workspace_id',p_workspace_id,'run_id',p_run_id,
        'channel',p_channel,'config_id',p_config_id));
    end if;
  end loop;

  if array_length(v_jobs, 1) is not null then
    perform public.bb_queue_send_batch('bb_ingest_jobs', v_jobs, 0);
    v_enqueued_count := array_length(v_jobs, 1);
  end if;

  -- Wake up the ingest worker immediately for live messages (not bulk imports)
  if p_run_id is null then
    begin
      perform public.bb_wake_worker('bb_worker_ingest_url');
    exception when others then
      raise warning 'bb_wake_worker failed: %', SQLERRM;
    end;
  end if;

  return query select v_received_count, v_enqueued_count, p_run_id;
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
    'bb_draft_jobs', 'bb_deadletter_jobs'
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
-- From task_list_patches
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
  foreach v_queue in array array['bb_ingest_jobs', 'bb_classify_jobs', 'bb_draft_jobs'] loop
    begin
      -- Purge archived messages (processed/completed)
      select pgmq.purge_queue(v_queue) into v_count;
      v_result := v_result || jsonb_build_object(v_queue, coalesce(v_count, 0));
    exception when others then
      v_result := v_result || jsonb_build_object(v_queue, sqlerrm);
    end;
  end loop;

  return v_result;
end;
$$;
create or replace view public.bb_open_incidents as
select
  pi.id,
  pi.workspace_id,
  pi.run_id,
  pi.severity,
  pi.scope,
  pi.error,
  pi.context,
  pi.created_at
from public.pipeline_incidents pi
where pi.resolved_at is null
order by pi.created_at desc;
create or replace view public.bb_stalled_events as
select
  me.id,
  me.workspace_id,
  me.run_id,
  me.channel,
  me.config_id,
  me.external_id,
  me.thread_id,
  me.status,
  me.created_at,
  me.updated_at,
  now() - me.updated_at as age
from public.message_events me
where (
    me.status = 'received' and me.updated_at < now() - interval '10 minutes'
  )
  or (
    me.status = 'materialized' and me.updated_at < now() - interval '10 minutes'
  )
  or (
    me.status = 'classified' and me.updated_at < now() - interval '10 minutes'
  )
order by me.updated_at asc;
create or replace view public.bb_pipeline_progress as
select
  pr.id as run_id,
  pr.workspace_id,
  pr.config_id,
  pr.channel,
  pr.mode,
  pr.state,
  pr.started_at,
  pr.completed_at,
  pr.last_heartbeat_at,
  now() - pr.last_heartbeat_at as heartbeat_age,
  count(me.id) as total_events,
  count(me.id) filter (where me.status = 'received') as received_events,
  count(me.id) filter (where me.status = 'materialized') as materialized_events,
  count(me.id) filter (where me.status = 'classified') as classified_events,
  count(me.id) filter (where me.status = 'decided') as decided_events,
  count(me.id) filter (where me.status = 'drafted') as drafted_events,
  count(me.id) filter (where me.status = 'failed') as failed_events,
  pr.metrics,
  pr.last_error
from public.pipeline_runs pr
left join public.message_events me
  on me.run_id = pr.id
group by pr.id;
create or replace view public.bb_queue_depths as
select *
from (
  values
    ('bb_import_jobs'::text),
    ('bb_ingest_jobs'::text),
    ('bb_classify_jobs'::text),
    ('bb_draft_jobs'::text),
    ('bb_deadletter_jobs'::text)
) as q(queue_name)
cross join lateral (
  select public.bb_queue_visible_count(q.queue_name) as visible_messages
) depth;
create or replace view public.bb_needs_classification as
select
  c.id as conversation_id,
  c.workspace_id,
  c.channel,
  c.status,
  c.last_inbound_message_id,
  c.last_classified_message_id,
  c.last_classify_enqueued_message_id,
  c.updated_at
from public.conversations c
where c.last_inbound_message_id is not null
  and c.last_inbound_message_id is distinct from c.last_classified_message_id;
