-- 1. Remove anon UPDATE on leads
DROP POLICY "Anon can update leads" ON public.leads;

-- 2. Remove anon INSERT on lead_events
DROP POLICY "Anon can insert events" ON public.lead_events;

-- 3. Drop orphaned SELECT policies for anon
DROP POLICY "Anon can read leads" ON public.leads;
DROP POLICY "Anon can read lead_events" ON public.lead_events;

-- Kept: "Anon can insert leads" (public quote form)
-- Kept: "Authenticated full access on leads"
-- Kept: "Authenticated full access on lead_events"
-- Kept: "Service role full access on leads"
-- Kept: "Service role full access on lead_events";
