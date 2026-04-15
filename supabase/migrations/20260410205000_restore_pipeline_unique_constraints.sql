DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_identities_ws_type_norm_key'
      AND conrelid = 'public.customer_identities'::regclass
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS customer_identities_ws_type_norm_key
      ON public.customer_identities (workspace_id, identifier_type, identifier_value_norm);
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_refs_ws_channel_config_thread_key'
      AND conrelid = 'public.conversation_refs'::regclass
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_refs_ws_channel_config_thread_key
      ON public.conversation_refs (workspace_id, channel, config_id, external_thread_id);
  END IF;
END;
$$;
