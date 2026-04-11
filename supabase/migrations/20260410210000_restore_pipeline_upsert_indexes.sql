CREATE UNIQUE INDEX IF NOT EXISTS bb_customer_identities_ws_type_norm_uidx
  ON public.customer_identities (workspace_id, identifier_type, identifier_value_norm);

CREATE UNIQUE INDEX IF NOT EXISTS bb_conversation_refs_ws_channel_config_thread_uidx
  ON public.conversation_refs (workspace_id, channel, config_id, external_thread_id);

CREATE UNIQUE INDEX IF NOT EXISTS bb_messages_conversation_external_uidx
  ON public.messages (conversation_id, external_id);
