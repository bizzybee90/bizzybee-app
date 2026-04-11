
-- Grant authenticated users access to the users table
-- RLS policies already restrict to own row, but the base GRANT was missing
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;

-- Also grant on workspaces (needed by WorkspaceContext)
GRANT SELECT ON public.workspaces TO authenticated;

-- And workspace_members (needed by RLS policy)
GRANT SELECT ON public.workspace_members TO authenticated;
;
