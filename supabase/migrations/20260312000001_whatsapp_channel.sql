-- =============================================================================
-- WhatsApp Channel Setup
-- Creates workspace_channels table (if missing) and seeds WhatsApp config
-- =============================================================================

-- Create workspace_channels table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.workspace_channels (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id),
  channel_type    text        NOT NULL CHECK (channel_type IN ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat')),
  enabled         boolean     NOT NULL DEFAULT false,
  config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel_type)
);
ALTER TABLE public.workspace_channels ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  DROP POLICY IF EXISTS workspace_channels_select ON public.workspace_channels;
  CREATE POLICY workspace_channels_select ON public.workspace_channels
    FOR SELECT USING (public.bb_user_in_workspace(workspace_id));
EXCEPTION WHEN others THEN NULL;
END;
$$;
DO $$
BEGIN
  DROP POLICY IF EXISTS workspace_channels_all ON public.workspace_channels;
  CREATE POLICY workspace_channels_all ON public.workspace_channels
    FOR ALL USING (public.bb_user_in_workspace(workspace_id))
    WITH CHECK (public.bb_user_in_workspace(workspace_id));
EXCEPTION WHEN others THEN NULL;
END;
$$;
DO $$
BEGIN
  DROP POLICY IF EXISTS workspace_channels_service ON public.workspace_channels;
  CREATE POLICY workspace_channels_service ON public.workspace_channels
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN others THEN NULL;
END;
$$;
