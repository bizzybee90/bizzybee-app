-- workspace_channels has an RLS policy (workspace_channels_all) that permits
-- any workspace member to INSERT/UPDATE/DELETE rows scoped to their workspace,
-- but the authenticated role was only granted SELECT. PostgREST requires BOTH
-- the SQL grant AND a matching RLS policy, so toggling a channel from the app
-- was failing with "Failed to update channel".
--
-- Grant the write privileges that the RLS policy already authorises.

GRANT INSERT, UPDATE, DELETE ON public.workspace_channels TO authenticated;;
