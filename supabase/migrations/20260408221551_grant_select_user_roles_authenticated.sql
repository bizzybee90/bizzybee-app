-- Grant SELECT on user_roles to authenticated role
-- The table already has an RLS policy "Users can view their own roles"
-- but PostgREST requires BOTH the SQL grant AND a matching RLS policy.
-- Without this grant, the frontend gets 403 when useUserRole hook fetches.

GRANT SELECT ON public.user_roles TO authenticated;;
