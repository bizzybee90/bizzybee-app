
-- Drop the circular/self-referential policies that cause infinite recursion
DROP POLICY IF EXISTS "Users read workspace members" ON public.users;
DROP POLICY IF EXISTS "Users view workspace memberships" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners/admins manage memberships" ON public.workspace_members;

-- The remaining policies are safe:
-- users: "Users read own profile" (id = auth.uid()) — direct, no recursion
-- users: "Users update own profile" (id = auth.uid()) — direct
-- workspace_members: "Users view own memberships" (user_id = auth.uid()) — direct
-- workspaces: "Users can view their workspace" (id IN (SELECT workspace_id FROM users WHERE id = auth.uid())) — queries users which is direct
;
