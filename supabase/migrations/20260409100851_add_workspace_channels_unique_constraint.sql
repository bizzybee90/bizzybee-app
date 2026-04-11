-- Required for upsert operations in meta-auth-callback and other channel setup flows.
-- Each workspace can have at most one row per channel type.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_channels_workspace_channel_unique
  ON public.workspace_channels (workspace_id, channel);;
