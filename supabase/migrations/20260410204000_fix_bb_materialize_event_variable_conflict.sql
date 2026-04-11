CREATE OR REPLACE FUNCTION public.bb_materialize_event(p_event_id uuid)
RETURNS TABLE(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
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
    when 'voice' then 'phone'
    when 'phone' then 'phone'
    when 'facebook' then 'facebook'
    when 'instagram' then 'instagram'
    when 'google_business' then 'google_business'
    when 'webchat' then 'webchat'
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
      case
        when v_identifier_type in ('phone', 'whatsapp', 'facebook', 'instagram', 'google_business')
          then v_counterparty_norm
        else null
      end,
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
$function$;
