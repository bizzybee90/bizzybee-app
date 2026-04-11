
-- Fix security definer views - set security_invoker = true so RLS is enforced per querying user
ALTER VIEW public.conversion_speed SET (security_invoker = true);
ALTER VIEW public.lead_stats SET (security_invoker = true);
ALTER VIEW public.revenue_pipeline SET (security_invoker = true);
;
